import type {DatabaseSync} from 'node:sqlite';
import type {Json,Grant,WorkspaceIdentity} from '../standalone/types.js';
import {fail} from '../standalone/types.js';
import {canonical,exact,hash,hashBytes,id,digest} from '../standalone/validation.js';
import {modelStore} from './model-store.js';
import {sourceStore} from './store.js';
import {expectationStore} from './expectations-store.js';
import {viewStore} from './view-store.js';
import {loadTask} from './task-evidence.js';
import type {ReviewCandidate} from './candidate-contracts.js';
import type {ReviewDecision} from './review-contracts.js';
import type {DeliveryBundle} from './delivery-contracts.js';
import {LIFECYCLE_SCHEMA_DIGEST,checkCandidate,checkDecision,checkBundle} from './lifecycle-contract.js';
import {makeCandidate,reviewReport,verifyDecision,makeBundle,verifyDeliveryBundle} from './delivery-bundle.js';
import type {CandidateMaterial} from './delivery-bundle.js';
import type {ValidationPlan} from './validation-runner.js';

export const LIFECYCLE_TABLES=`
 CREATE TABLE native_review_candidates(project_id TEXT NOT NULL,asset_id TEXT NOT NULL,digest TEXT NOT NULL,schema_digest TEXT NOT NULL,document TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,asset_id,digest));
 CREATE TABLE native_reviews(project_id TEXT NOT NULL,asset_id TEXT NOT NULL,candidate_digest TEXT NOT NULL,digest TEXT NOT NULL,document TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(project_id,asset_id,digest),FOREIGN KEY(project_id,asset_id,candidate_digest) REFERENCES native_review_candidates(project_id,asset_id,digest));
 CREATE TABLE native_review_heads(project_id TEXT NOT NULL,asset_id TEXT NOT NULL,candidate_digest TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(project_id,asset_id,candidate_digest),FOREIGN KEY(project_id,asset_id,digest) REFERENCES native_reviews(project_id,asset_id,digest));
 CREATE TABLE native_deliveries(project_id TEXT NOT NULL,asset_id TEXT NOT NULL,version TEXT NOT NULL,digest TEXT NOT NULL,schema_digest TEXT NOT NULL,document TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,asset_id,digest),UNIQUE(project_id,asset_id,version));
 CREATE TABLE native_delivery_heads(project_id TEXT NOT NULL,asset_id TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(project_id,asset_id),FOREIGN KEY(project_id,asset_id,digest) REFERENCES native_deliveries(project_id,asset_id,digest));
`;
export function lifecycleStore(db:DatabaseSync,identity:WorkspaceIdentity,tools:{dl:string|null;validation:string|null;verify:()=>void}){
  const models=modelStore(db),sources=sourceStore(db),expectations=expectationStore(db),views=viewStore(db);
  const tx=()=>{if(!db.isTransaction)fail('TRANSACTION_REQUIRED','Lifecycle requires owner transaction');};
  function deliveryHead(projectId:string,assetId:string):string|null {tx();const row=db.prepare('SELECT digest FROM native_delivery_heads WHERE project_id=? AND asset_id=?').get(projectId,assetId);return row?String(row.digest):null;}
  function decisionHead(projectId:string,assetId:string,candidateDigest:string):string|null {tx();const r=db.prepare('SELECT digest FROM native_review_heads WHERE project_id=? AND asset_id=? AND candidate_digest=?').get(projectId,assetId,candidateDigest);return r?String(r.digest):null;}
  function material(projectId:string,c:Pick<ReviewCandidate,'identity'|'modelDigest'|'intentDigest'|'sourceSetDigest'|'expectationsDigest'|'projectionDigest'>&{validation:{taskId:string};explanations:readonly {taskId:string}[]}):CandidateMaterial {
    const model=models.load(projectId,c.identity.assetId,c.modelDigest),intent=db.prepare('SELECT document FROM intents WHERE project_id=? AND digest=?').get(projectId,c.intentDigest);
    if(!intent)fail('CORRUPT_STATE','Review intent is missing',409);
    const m:CandidateMaterial={intent:JSON.parse(String(intent.document)),sourceSet:sources.load(projectId,c.sourceSetDigest).sourceSet,model:model.draft,expectations:expectations.load(projectId,c.identity.assetId,c.expectationsDigest).definition,
      validation:loadTask(db,projectId,model,c.validation.taskId,'validation'),explanations:c.explanations.map(e=>loadTask(db,projectId,model,e.taskId,'dl')),projection:null};
    if(c.projectionDigest){const view=views.load(projectId,c.identity.assetId,c.projectionDigest).view;m.projection={view,tasks:view.tasks.map(e=>loadTask(db,projectId,model,e.taskId,'dl'))};}
    return m;
  }
  function loadCandidate(projectId:string,assetId:string,candidateDigest:string):{candidate:ReviewCandidate;material:CandidateMaterial}{
    tx();id(assetId);digest(candidateDigest);const r=db.prepare('SELECT * FROM native_review_candidates WHERE project_id=? AND asset_id=? AND digest=?').get(projectId,assetId,candidateDigest);
    if(!r)fail('NOT_FOUND','Review candidate absent in selected project/asset',404);
    if(r.schema_digest!==LIFECYCLE_SCHEMA_DIGEST)fail('UNSUPPORTED_LIFECYCLE','Original lifecycle reader required',409);
    const candidate:unknown=JSON.parse(String(r.document));checkCandidate(candidate);
    if(hash(candidate as unknown as Json)!==candidateDigest||candidate.identity.projectId!==projectId||candidate.identity.assetId!==assetId||candidate.identity.workspaceId!==identity.workspaceId||candidate.identity.serviceId!==identity.serviceId)fail('CORRUPT_STATE','Review candidate identity differs',409);
    const m=material(projectId,candidate);if(hash(makeCandidate(candidate.identity,candidate.previousDeliveryDigest,m) as unknown as Json)!==candidateDigest)fail('CORRUPT_STATE','Review candidate no longer matches exact retained evidence',409);
    return {candidate,material:m};
  }
  function loadDecision(projectId:string,assetId:string,reviewDigest:string):ReviewDecision {
    tx();digest(reviewDigest);const r=db.prepare('SELECT * FROM native_reviews WHERE project_id=? AND asset_id=? AND digest=?').get(projectId,assetId,reviewDigest);
    if(!r)fail('NOT_FOUND','Review decision absent in selected project/asset',404);
    const decision:unknown=JSON.parse(String(r.document));checkDecision(decision);
    if(hash(decision as unknown as Json)!==reviewDigest||decision.candidateDigest!==r.candidate_digest)fail('CORRUPT_STATE','Review decision identity differs',409);return decision;
  }
  function current(projectId:string,c:ReviewCandidate,m:CandidateMaterial):boolean {
    const model=models.load(projectId,c.identity.assetId,c.modelDigest);
    return models.current(projectId,model)&&deliveryHead(projectId,c.identity.assetId)===c.previousDeliveryDigest&&tools.validation!==null&&c.validation.toolchainDigest===tools.validation&&c.explanations.every(e=>e.toolchainDigest===tools.dl)&&(!m.projection||m.projection.view.tasks.every(e=>e.toolchainDigest===tools.dl));
  }
  function requireCurrent(projectId:string,c:ReviewCandidate,m:CandidateMaterial):void {if(!current(projectId,c,m))fail('STALE_CANDIDATE','Model, source, expectations, toolchain or previous delivery changed; prepare a fresh candidate',409);tools.verify();}
  function prepare(projectId:string,input:unknown,revision:number,createdAt:string):Json {
    tx();exact(input,['assetId','modelDigest','version','previousDeliveryDigest','validationTaskId','explanationTaskIds']);id(input.assetId);digest(input.modelDigest);id(input.version);id(input.validationTaskId);if(input.previousDeliveryDigest!==null)digest(input.previousDeliveryDigest);
    if(!Array.isArray(input.explanationTaskIds)||input.explanationTaskIds.length>32||new Set(input.explanationTaskIds).size!==input.explanationTaskIds.length)fail('INVALID_INPUT','Distinct bounded explanation task IDs required');input.explanationTaskIds.forEach(id);
    if(deliveryHead(projectId,input.assetId)!==input.previousDeliveryDigest)fail('DELIVERY_CONFLICT','Previous delivery changed',409);
    if(db.prepare('SELECT digest FROM native_deliveries WHERE project_id=? AND asset_id=? AND version=?').get(projectId,input.assetId,input.version))fail('VERSION_EXISTS','Published local asset version is immutable',409);
    const model=models.load(projectId,input.assetId,input.modelDigest),validation=loadTask(db,projectId,model,input.validationTaskId,'validation'),plan=validation.request as unknown as ValidationPlan;
    const seed={identity:{workspaceId:identity.workspaceId,serviceId:identity.serviceId,projectId,assetId:input.assetId,version:input.version},modelDigest:model.digest,intentDigest:model.draft.intentDigest,sourceSetDigest:model.draft.sourceSetDigest,expectationsDigest:model.draft.expectationsDigest!,validation:{taskId:input.validationTaskId},explanations:(input.explanationTaskIds as string[]).map(taskId=>({taskId})),projectionDigest:plan.view.kind==='derived'?plan.view.projectionDigest:null};
    // Only addressing fields are used to load material; makeCandidate owns the
    // complete schema and all evidence checks before any row is written.
    const m=material(projectId,seed),candidate=makeCandidate(seed.identity,input.previousDeliveryDigest,m);requireCurrent(projectId,candidate,m);
    const candidateDigest=hash(candidate as unknown as Json),reportDigest=hash(reviewReport(candidate,m));
    db.prepare('INSERT OR IGNORE INTO native_review_candidates VALUES(?,?,?,?,?,?,?)').run(projectId,input.assetId,candidateDigest,LIFECYCLE_SCHEMA_DIGEST,canonical(candidate as unknown as Json),revision,createdAt);
    return {candidateDigest,reportDigest,assetId:input.assetId,version:input.version,modelDigest:model.digest,status:'AWAITING_DECISION',businessConfirmed:false,authority:false};
  }
  function decide(projectId:string,grant:Grant,input:unknown,revision:number,recordedAt:string):Json {
    tx();if(!grant.permissions.includes('review'))fail('FORBIDDEN','A separately granted reviewer credential is required',403);
    exact(input,['assetId','candidateDigest','reportDigest','previousDecisionDigest','decision','rationale','instruction','requirementIds']);id(input.assetId);digest(input.candidateDigest);digest(input.reportDigest);if(input.previousDecisionDigest!==null)digest(input.previousDecisionDigest);
    const {candidate,material:m}=loadCandidate(projectId,input.assetId,input.candidateDigest);
    if(decisionHead(projectId,input.assetId,input.candidateDigest)!==input.previousDecisionDigest)fail('REVIEW_CONFLICT','Review decision parent changed',409);
    const value={schema:'ontology-review-decision/v2',candidateDigest:input.candidateDigest,reportDigest:input.reportDigest,previousDigest:input.previousDecisionDigest,decision:input.decision,principalId:grant.principalId,grantId:grant.id,requirementIds:input.requirementIds,rationale:input.rationale,instruction:input.instruction,instructionDigest:hash(input.instruction as Json),instructionVerification:'AUTHENTICATED_REVIEWER_SUBMISSION',authorityScope:'MODEL_SEMANTICS_ONLY',recordedAt};checkDecision(value);verifyDecision(value,candidate,m);
    if(value.decision==='APPROVE')requireCurrent(projectId,candidate,m);
    const reviewDigest=hash(value as unknown as Json);db.prepare('INSERT INTO native_reviews VALUES(?,?,?,?,?,?)').run(projectId,input.assetId,input.candidateDigest,reviewDigest,canonical(value as unknown as Json),revision);
    db.prepare('INSERT INTO native_review_heads VALUES(?,?,?,?) ON CONFLICT(project_id,asset_id,candidate_digest) DO UPDATE SET digest=excluded.digest').run(projectId,input.assetId,input.candidateDigest,reviewDigest);
    return {candidateDigest:input.candidateDigest,reviewDigest,decision:value.decision,principalId:grant.principalId,instructionVerification:value.instructionVerification,authorityScope:value.authorityScope,delivered:false,softwareReleaseAuthority:false};
  }
  function inspect(projectId:string,input:unknown):Json {
    exact(input,['assetId','candidateDigest']);id(input.assetId);digest(input.candidateDigest);const {candidate,material:m}=loadCandidate(projectId,input.assetId,input.candidateDigest),head=decisionHead(projectId,input.assetId,input.candidateDigest),decision=head?loadDecision(projectId,input.assetId,head):null;
    if(decision)verifyDecision(decision,candidate,m);
    return {candidate:candidate as unknown as Json,candidateDigest:input.candidateDigest,reportDigest:hash(reviewReport(candidate,m)),current:current(projectId,candidate,m),reviewDigest:head,decision:decision as unknown as Json,status:decision?decision.decision==='APPROVE'?'APPROVED':'REJECTED':'AWAITING_DECISION',softwareReleaseAuthority:false};
  }
  function page(content:string,input:Record<string,unknown>,metadata:Json):Json {
    if(!Number.isSafeInteger(input.offset)||(input.offset as number)<0||!Number.isSafeInteger(input.maxBytes)||(input.maxBytes as number)<4||(input.maxBytes as number)>65536)fail('INVALID_INPUT','Bounded UTF-8 page required');
    const bytes=Buffer.from(content),start=input.offset as number;if(start>bytes.length||start<bytes.length&&(bytes[start]&0xC0)===0x80)fail('INVALID_INPUT','Offset splits UTF-8 or exceeds document');
    let end=Math.min(bytes.length,start+(input.maxBytes as number));while(end<bytes.length&&(bytes[end]&0xC0)===0x80)end--;
    return {...metadata as Record<string,Json>,documentDigest:hashBytes(bytes),content:bytes.subarray(start,end).toString('utf8'),offset:start,nextOffset:end===bytes.length?null:end,complete:end===bytes.length,authority:false};
  }
  function reportRead(projectId:string,input:unknown):Json {
    exact(input,['assetId','candidateDigest','offset','maxBytes']);id(input.assetId);digest(input.candidateDigest);const {candidate,material:m}=loadCandidate(projectId,input.assetId,input.candidateDigest),report=reviewReport(candidate,m);
    return page(canonical(report),input,{candidateDigest:input.candidateDigest,reportDigest:hash(report),current:current(projectId,candidate,m)});
  }
  function deliver(projectId:string,principalId:string,input:unknown,revision:number,recordedAt:string):Json {
    tx();exact(input,['assetId','candidateDigest','reviewDigest']);id(input.assetId);digest(input.candidateDigest);digest(input.reviewDigest);const {candidate,material:m}=loadCandidate(projectId,input.assetId,input.candidateDigest);requireCurrent(projectId,candidate,m);
    if(decisionHead(projectId,input.assetId,input.candidateDigest)!==input.reviewDigest)fail('STALE_REVIEW','Delivery requires the current decision for this candidate',409);
    const decision=loadDecision(projectId,input.assetId,input.reviewDigest),bundle=makeBundle(candidate,decision,m,principalId,recordedAt),deliveryDigest=hash(bundle as unknown as Json);
    if(db.prepare('SELECT digest FROM native_deliveries WHERE project_id=? AND asset_id=? AND version=?').get(projectId,input.assetId,candidate.identity.version))fail('VERSION_EXISTS','Asset version is already delivered',409);
    db.prepare('INSERT INTO native_deliveries VALUES(?,?,?,?,?,?,?,?)').run(projectId,input.assetId,candidate.identity.version,deliveryDigest,LIFECYCLE_SCHEMA_DIGEST,canonical(bundle as unknown as Json),revision,recordedAt);
    db.prepare('INSERT INTO native_delivery_heads VALUES(?,?,?) ON CONFLICT(project_id,asset_id) DO UPDATE SET digest=excluded.digest').run(projectId,input.assetId,deliveryDigest);
    return {deliveryDigest,identity:{...bundle.identity},candidateDigest:bundle.candidateDigest,reviewDigest:bundle.reviewDigest,previousDeliveryDigest:bundle.previousDeliveryDigest,visibility:'private',status:'DELIVERED',softwareReleaseAuthority:false};
  }
  function loadDelivery(projectId:string,assetId:string,deliveryDigest:string):DeliveryBundle {
    tx();id(assetId);digest(deliveryDigest);const row=db.prepare('SELECT * FROM native_deliveries WHERE project_id=? AND asset_id=? AND digest=?').get(projectId,assetId,deliveryDigest);
    if(!row)fail('NOT_FOUND','Delivery absent in selected project/asset',404);if(row.schema_digest!==LIFECYCLE_SCHEMA_DIGEST)fail('UNSUPPORTED_LIFECYCLE','Original delivery reader required',409);
    const bundle:unknown=JSON.parse(String(row.document));checkBundle(bundle);verifyDeliveryBundle(bundle,deliveryDigest);
    if(bundle.identity.workspaceId!==identity.workspaceId||bundle.identity.serviceId!==identity.serviceId||bundle.identity.projectId!==projectId||bundle.identity.assetId!==assetId||bundle.identity.version!==row.version)fail('CORRUPT_STATE','Delivery owner identity differs',409);return bundle;
  }
  function deliveryInspect(projectId:string,input:unknown):Json {
    exact(input,['assetId','deliveryDigest']);id(input.assetId);digest(input.deliveryDigest);const bundle=loadDelivery(projectId,input.assetId,input.deliveryDigest),{parts,...metadata}=bundle;
    const candidate=JSON.parse(parts.find(p=>p.kind==='candidate')!.content) as ReviewCandidate,model=models.load(projectId,input.assetId,candidate.modelDigest);
    return {...metadata,deliveryDigest:input.deliveryDigest,isLatestDelivery:deliveryHead(projectId,input.assetId)===input.deliveryDigest,currentModelBinding:models.current(projectId,model),parts:parts.map(({content,...p})=>({...p,bytes:Buffer.byteLength(content)})),currentDecisionMatches:decisionHead(projectId,input.assetId,bundle.candidateDigest)===bundle.reviewDigest,authority:false} as unknown as Json;
  }
  function exportRead(projectId:string,input:unknown):Json {
    exact(input,['assetId','deliveryDigest','offset','maxBytes']);id(input.assetId);digest(input.deliveryDigest);const bundle=loadDelivery(projectId,input.assetId,input.deliveryDigest);
    return page(canonical(bundle as unknown as Json),input,{deliveryDigest:input.deliveryDigest,identity:{...bundle.identity},visibility:'private'});
  }
  function list(projectId:string,input:unknown,kind:'review'|'delivery'):Json {
    tx();exact(input,['assetId','afterDigest','limit']);id(input.assetId);if(input.afterDigest!==null)digest(input.afterDigest);if(!Number.isSafeInteger(input.limit)||(input.limit as number)<1||(input.limit as number)>100)fail('INVALID_INPUT','Page limit must be 1–100');
    const table=kind==='review'?'native_review_candidates':'native_deliveries',rows=db.prepare('SELECT digest,revision,created_at FROM '+table+' WHERE project_id=? AND asset_id=? AND digest>? ORDER BY digest LIMIT ?').all(projectId,input.assetId,input.afterDigest??'',(input.limit as number)+1),page=rows.slice(0,input.limit as number);
    return {kind,records:page.map(r=>({digest:String(r.digest),revision:Number(r.revision),createdAt:String(r.created_at)})),nextCursor:rows.length>page.length?String(page.at(-1)!.digest):null,authority:false};
  }
  return {prepare,decide,inspect,reportRead,deliver,deliveryInspect,exportRead,list};
}
