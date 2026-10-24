import { nativeAssertJSON, nativeExact, nativeText, nativeDigest, nativeStableSerialize, nativeSha256, nativeFrozenClone, nativePackageDigest, validateNativePackage, referenceForPackage } from '../../vendor/compatibility/v1/native.mjs';
import { verifyDecisionEvidence } from '../../vendor/compatibility/v1/decision-evidence.mjs';
import type { NativeValidationContext } from '../../vendor/compatibility/v1/native.mjs';
import type { Store } from '../persistence-types.js';
import type { Scope } from '../types.js';
import type { OntologyNativeRequest, OntologyNativeOutput, NativeOntologyRecord, NativeOntologyReceipt, NativeOntologyValidation } from './types.js';
import { inspectOntologyStandard } from './standard.js';
import { validateOntologyPackage } from './package.js';
import { validateNativeOntology, verifyOntologyToolchain, ontologyAdapterDigest } from './validator.js';
import { fail, slug } from '../state.js';
import {requireNativeAuthoring, type NativeAuthoringAdmission} from '../../vendor/usability/v1/authoring.mjs';
export const ontologyNativeOperations = Object.freeze(['standard.inspect','native.package.put','native.package.inspect','native.package.list','native.package.validate','native.package.review','native.package.decide','native.package.publish','native.package.readback','native.package.reconcile','native.receipt.inspect']);
const writes=new Set(['native.package.put','native.package.validate','native.package.review','native.package.decide','native.package.publish','native.package.reconcile']);
function table(store:Store):boolean{return !!store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='native_packages'").get();}
function setup(store:Store):void{store.db.exec('CREATE TABLE IF NOT EXISTS native_packages (scope TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL, data TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(scope,id,version)); CREATE TABLE IF NOT EXISTS native_audit (revision INTEGER PRIMARY KEY, scope TEXT NOT NULL, request_id TEXT NOT NULL, receipt TEXT NOT NULL);'); if(Number(store.db.prepare('PRAGMA user_version').get()!.user_version)<2)store.db.exec('PRAGMA user_version=2');}
function read(store:Store,scope:Scope,id:string,version:string):NativeOntologyRecord{
  if(!table(store))fail('NOT_FOUND','No corrected native package');
  const row=store.db.prepare('SELECT data,digest FROM native_packages WHERE scope=? AND id=? AND version=?').get(nativeStableSerialize(scope),id,version) as {data:string;digest:string}|undefined;
  if(!row)fail('NOT_FOUND','Native package absent in scope');
  const record=JSON.parse(row.data) as NativeOntologyRecord;
  validateNativePackage(record.package,{owner:'ontology'});
  if(nativeSha256(record)!==row.digest||record.packageDigest!==nativePackageDigest(record.package)||nativeStableSerialize(record.scope)!==nativeStableSerialize(scope)||record.id!==id||record.version!==version)fail('CORRUPT_STATE','Native record identity mismatch');
  store.verifyBlob(scope,record);
  return record;
}
function save(store:Store,record:NativeOntologyRecord):void{
  if(record.authoring&&Number(store.db.prepare('PRAGMA user_version').get()!.user_version)<4)store.db.exec('PRAGMA user_version=4');
  if(Buffer.byteLength(nativeStableSerialize(record))>8388608)fail('LIMIT','Native record limit');
  store.blob(record.scope,record);
  store.db.prepare('INSERT INTO native_packages(scope,id,version,data,digest) VALUES(?,?,?,?,?) ON CONFLICT(scope,id,version) DO UPDATE SET data=excluded.data,digest=excluded.digest').run(nativeStableSerialize(record.scope),record.id,record.version,nativeStableSerialize(record),nativeSha256(record));
}
function authoring(store:Store,scope:Scope,pkg:NativeOntologyRecord['package'],retained?:NativeAuthoringAdmission):NativeAuthoringAdmission{
  const bindings=JSON.parse(pkg.files[pkg.manifest.sourceBindingRef]);
  return requireNativeAuthoring(store.trustedProviders.resolveNativeAuthoring,{workspaceId:store.identity.id,scope,owner:'ontology',packageDigest:nativePackageDigest(pkg),sourceBindingsDigest:nativeSha256(bindings),sourceDirection:bindings.direction},retained);
}
function requireDraftAuthoring(store:Store,record:NativeOntologyRecord):void{
  if(record.reference)return;
  if(!record.authoring)fail('AUTHORING_CONTEXT_REQUIRED','Legacy draft requires a new bound authoring admission');
  authoring(store,record.scope,record.package,record.authoring);
}
function verifyContext(context:NativeValidationContext,scope:Scope,workspaceId:string):NativeValidationContext{
  nativeExact(context,['workspaceId','scope','projectCandidateDigest','claimId','inputDigest','effectiveConfigDigest','sourceScopeDigest','requirementSetDigest']);
  nativeExact(context.scope,['visibility','projectId']);slug(context.scope.projectId);if(!['public','private'].includes(context.scope.visibility))fail('SCOPE_MISMATCH','Consumer visibility invalid');
  if(context.workspaceId!==workspaceId||scope.visibility==='private'&&nativeStableSerialize(context.scope)!==nativeStableSerialize(scope))fail('SCOPE_MISMATCH','Validation context must bind this owner workspace and scope');
  nativeText(context.claimId);
  for(const k of ['projectCandidateDigest','inputDigest','effectiveConfigDigest','sourceScopeDigest','requirementSetDigest'] as const)nativeDigest(context[k]);
  return nativeFrozenClone(context);
}
export function createNativeOntologyOperations(getStore:()=>Store|null,isClosed:()=>boolean){
  const active=new Set<string>();
  function current():Store{if(isClosed())fail('CLOSED','Service is closed');const store=getStore();if(!store)fail('NOT_INITIALIZED','Explicit initialize required');store.guard();return store;}
  function validateRequest(request:OntologyNativeRequest):void{
    nativeAssertJSON(request);if(!ontologyNativeOperations.includes(request.operation))fail('UNSUPPORTED_OPERATION','Unknown native operation');
    nativeExact(request,['operation','scope','input'],writes.has(request.operation)?['requestId','expectedRevision']:[]);
    nativeExact(request.scope,['visibility','projectId']);slug(request.scope.projectId);if(!['private','public'].includes(request.scope.visibility))fail('INVALID_REQUEST','Explicit native visibility required');
    const fields:Record<string,string[]>={'standard.inspect':[],'native.package.put':['package'],'native.package.list':[],'native.receipt.inspect':['requestId'],'native.package.decide':['id','version','reviewDigest','decision','humanEvidenceRef']};
    nativeExact(request.input,fields[request.operation]??['id','version'],request.operation==='native.package.validate'?['context']:[]);
    if('id'in request.input){nativeText(request.input.id);nativeText(request.input.version);}
    if(writes.has(request.operation)){if(!('requestId'in request)||!('expectedRevision'in request))fail('INVALID_REQUEST','Mutation identity and CAS required');slug(request.requestId);if(typeof request.expectedRevision!=='number'||!Number.isSafeInteger(request.expectedRevision)||request.expectedRevision<0)fail('INVALID_REQUEST','Nonnegative revision required');}
  }
  function transact(r:OntologyNativeRequest,fn:(store:Store)=>unknown):NativeOntologyReceipt{
    const store=current(),db=store.db;if(!('requestId'in r))fail('INVALID_REQUEST','Mutation request required');
    const key=nativeStableSerialize(r.scope),digest=nativeSha256({operation:r.operation,scope:r.scope,input:r.input});
    db.exec('BEGIN IMMEDIATE');
    try{
      const old=db.prepare('SELECT digest,receipt FROM receipts WHERE scope=? AND request_id=?').get(key,r.requestId) as {digest:string;receipt:string}|undefined;
      if(old){if(old.digest!==digest)fail('REQUEST_CONFLICT','Request id binds different content');db.exec('COMMIT');return JSON.parse(old.receipt) as NativeOntologyReceipt;}
      const revision=db.prepare('SELECT revision FROM state WHERE singleton=1').get()!.revision as number;
      if(revision!==r.expectedRevision)fail('REVISION_CONFLICT','Owner revision changed');
      if((db.prepare('SELECT COUNT(*) AS count FROM receipts').get()!.count as number)>=10000)fail('LIMIT','Receipt limit');
      if(!Number.isSafeInteger(revision+1))fail('LIMIT','Owner revision limit');setup(store);
      const result=fn(store),receipt={requestId:r.requestId,scope:r.scope,operation:r.operation,requestDigest:digest,revision:revision+1,uid:store.uid,result};
      db.prepare('UPDATE state SET revision=? WHERE singleton=1').run(revision+1);
      db.prepare('INSERT INTO receipts(scope,request_id,digest,receipt) VALUES(?,?,?,?)').run(key,r.requestId,digest,nativeStableSerialize(receipt));
      db.prepare('INSERT INTO audit(revision,uid,operation,request_digest,result_digest) VALUES(?,?,?,?,?)').run(revision+1,store.uid,r.operation,digest,nativeSha256(result));
      db.prepare('INSERT INTO native_audit(revision,scope,request_id,receipt) VALUES(?,?,?,?)').run(receipt.revision,key,r.requestId,nativeStableSerialize(receipt));
      db.exec('COMMIT');return nativeFrozenClone(receipt);
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function requireCurrent(record:NativeOntologyRecord):void{
    const standard=inspectOntologyStandard();
    if(record.standardPins.standardDigest!==standard.standardDigest||record.standardPins.standardLockDigest!==standard.standardLockDigest||record.package.manifest.contractDigest!==standard.contractDigest)fail('REVIEW_REQUIRED','Installed standard or contract changed');
  }
  function reviewOf(store:Store,record:NativeOntologyRecord){
    requireCurrent(record);
    if(record.validation?.status!=='CONFORMS'||record.validation.packageDigest!==record.packageDigest)fail('VALIDATION_REQUIRED','Actual current native report required');
    if(!store.trustedProviders.nativeToolchain)fail('TOOLCHAIN_NOT_READY','Installed native toolchain required');
    const toolchain=verifyOntologyToolchain(store.trustedProviders.nativeToolchain);
    if(record.validation.toolchainLockDigest!==toolchain.lockDigest||record.validation.adapterDigest!==ontologyAdapterDigest())fail('REVIEW_REQUIRED','Validation used different toolchain');
    const {reportDigest,...content}=record.validation;if(nativeSha256(content)!==reportDigest)fail('CORRUPT_STATE','Native validation report digest differs');
    const review={packageDigest:record.packageDigest,validationDigest:reportDigest,standardPins:record.standardPins,workspace:store.identity,scope:record.scope};
    return {...review,reviewDigest:nativeSha256(review)};
  }
  function dependencies(store:Store,record:NativeOntologyRecord):void{
    for(const ref of record.package.manifest.dependencies){
      if(ref.product!=='ontology')fail('UNSUPPORTED_DEPENDENCY','Ontology only consumes published Ontology dependencies');
      const dep=read(store,{projectId:record.scope.projectId,visibility:ref.visibility},ref.id,ref.version);
      if(!dep.reference||nativeStableSerialize(dep.reference)!==nativeStableSerialize(ref))fail('DEPENDENCY_NOT_PUBLISHED','Dependency must resolve to exact published owner record');
      if(record.scope.visibility==='public'&&ref.visibility==='private')fail('SCOPE_MISMATCH','Private dependency cannot enter public delivery');
    }
  }
  async function native(request:OntologyNativeRequest):Promise<unknown>{
    if(isClosed())fail('CLOSED','Service is closed');validateRequest(request);const r=nativeFrozenClone(request) as OntologyNativeRequest;
    if(r.operation==='standard.inspect')return inspectOntologyStandard();
    const store=current();
    if(r.operation==='native.receipt.inspect'){
      const row=store.db.prepare('SELECT receipt FROM receipts WHERE scope=? AND request_id=?').get(nativeStableSerialize(r.scope),r.input.requestId) as {receipt:string}|undefined;
      if(!row)fail('NOT_FOUND','Native receipt absent');const receipt=JSON.parse(row.receipt) as NativeOntologyReceipt;
      if(!receipt.operation.startsWith('native.'))fail('HISTORICAL_ONLY','Old receipt is not corrected-native evidence');
      return nativeFrozenClone(receipt);
    }
    if(r.operation==='native.package.list'){
      if(!table(store))return [];
      return store.db.prepare('SELECT id,version FROM native_packages WHERE scope=? ORDER BY id,version').all(nativeStableSerialize(r.scope)).map(row=>{const record=read(store,r.scope,row.id as string,row.version as string);return {id:record.id,version:record.version,packageDigest:record.packageDigest,reference:record.reference};});
    }
    if(r.operation==='native.package.inspect'||r.operation==='native.package.readback'){
      const record=read(store,r.scope,r.input.id,r.input.version);
      if(r.operation==='native.package.readback'&&!record.reference)fail('NOT_PUBLISHED','Immutable published native delivery required');
      if(record.claim?.status==='RUNNING'&&!active.has(record.claim.requestId))record.claim.status='UNKNOWN';
      return nativeFrozenClone(record);
    }
    if(r.operation==='native.package.validate'){
      if(!store.trustedProviders.nativeToolchain)fail('TOOLCHAIN_NOT_READY','Installed toolchain unavailable');
      const tools=verifyOntologyToolchain(store.trustedProviders.nativeToolchain);
      let admitted=false;
      const admission=transact(r,s=>{
        const record=read(s,r.scope,r.input.id,r.input.version);requireCurrent(record);requireDraftAuthoring(s,record);
        if(record.claim?.status==='RUNNING')fail('UNKNOWN','Reconcile previous validation before another attempt');
        const context=r.input.context?verifyContext(r.input.context,r.scope,s.identity.id):null;
        record.claim={requestId:r.requestId,status:'RUNNING',attempt:(record.claim?.attempt??0)+1,packageDigest:record.packageDigest,context};
        // Published asset bytes and its original publication validation remain immutable.
        if(!record.reference){record.validation=null;record.review=null;record.decision=null;}
        save(s,record);admitted=true;return {status:'RUNNING',packageDigest:record.packageDigest,context};
      });
      if(!admitted)return admission;
      active.add(r.requestId);
      try{
        const before=read(store,r.scope,r.input.id,r.input.version);
        const validation=await validateNativeOntology(before.package,tools,before.claim!.context);
        const s=current(),db=s.db;db.exec('BEGIN IMMEDIATE');
        try{
          const record=read(s,r.scope,r.input.id,r.input.version);
          if(record.claim?.requestId!==r.requestId||record.claim.status!=='RUNNING'||record.packageDigest!==validation.packageDigest)fail('REVIEW_REQUIRED','Package changed during validation');
          requireCurrent(record);requireDraftAuthoring(s,record);record.claim.status='COMPLETE';
          if(!record.reference)record.validation=validation;
          save(s,record);
          const revision=(db.prepare('SELECT revision FROM state WHERE singleton=1').get()!.revision as number)+1;
          const receipt={...admission,revision,result:validation};
          db.prepare('UPDATE state SET revision=? WHERE singleton=1').run(revision);
          db.prepare('UPDATE receipts SET receipt=? WHERE scope=? AND request_id=?').run(nativeStableSerialize(receipt),nativeStableSerialize(r.scope),r.requestId);
          db.prepare('INSERT INTO audit(revision,uid,operation,request_digest,result_digest) VALUES(?,?,?,?,?)').run(revision,s.uid,r.operation,admission.requestDigest,nativeSha256(validation));
          db.prepare('INSERT INTO native_audit(revision,scope,request_id,receipt) VALUES(?,?,?,?)').run(revision,nativeStableSerialize(r.scope),r.requestId,nativeStableSerialize(receipt));
          s.blob(r.scope,validation);db.exec('COMMIT');return nativeFrozenClone(receipt);
        }catch(e){db.exec('ROLLBACK');throw e;}
      }finally{active.delete(r.requestId);}
    }
    return transact(r,s=>{
      if(r.operation==='native.package.put'){
        const pkg=validateOntologyPackage(r.input.package,r.scope);const m=pkg.manifest;
        let prior:NativeOntologyRecord|null=null;try{prior=read(s,r.scope,m.id,m.version);}catch(e){if(!(e instanceof Error&&'code'in e&&e.code==='NOT_FOUND'))throw e;}
        if(prior?.reference)fail('IMMUTABLE_VERSION','Published native bytes cannot be replaced');
        if(prior?.claim?.status==='RUNNING')fail('UNKNOWN','Reconcile outstanding validation before editing');
        const admission=authoring(s,r.scope,pkg);
        const record:NativeOntologyRecord={authoring:admission,scope:r.scope,workspace:s.identity,id:m.id,version:m.version,package:pkg,packageDigest:nativePackageDigest(pkg),standardPins:m.standardPins,validation:null,claim:null,review:null,decision:null,reference:null};
        dependencies(s,record);save(s,record);return {id:m.id,version:m.version,packageDigest:record.packageDigest,standardPins:record.standardPins};
      }
      if(!('id'in r.input))fail('INVALID_REQUEST','Native identity required');
      const record=read(s,r.scope,r.input.id,r.input.version);
      if(r.operation==='native.package.reconcile'){
        if(record.claim?.status==='RUNNING'&&!active.has(record.claim.requestId)){record.claim.status='UNKNOWN';save(s,record);}
        return {claim:record.claim,validation:record.validation,redispatched:false};
      }
      if(record.reference)fail('IMMUTABLE_VERSION','Published delivery decisions are immutable');
      requireDraftAuthoring(s,record);
      if(r.operation==='native.package.review'){record.review=reviewOf(s,record);record.decision=null;save(s,record);return record.review;}
      const currentReview=reviewOf(s,record);
      if(!record.review||record.review.reviewDigest!==currentReview.reviewDigest)fail('REVIEW_REQUIRED','Exact current review required');
      if(r.operation==='native.package.decide'){
        nativeDigest(r.input.reviewDigest);nativeText(r.input.humanEvidenceRef);
        if(!['APPROVE','REJECT'].includes(r.input.decision)||r.input.reviewDigest!==currentReview.reviewDigest)fail('REVIEW_MISMATCH','Decision must bind exact reviewed candidate');
        verifyDecisionEvidence(r.input.humanEvidenceRef,{owner:'ontology',operation:'native.package.decide',workspaceId:s.identity.id,scope:r.scope,reviewDigest:currentReview.reviewDigest,decision:r.input.decision});
        record.decision={reviewDigest:r.input.reviewDigest,decision:r.input.decision,humanEvidenceRef:r.input.humanEvidenceRef,uid:s.uid};save(s,record);return record.decision;
      }
      if(r.operation!=='native.package.publish')fail('INVALID_REQUEST','Unsupported native mutation');
      if(record.decision?.decision!=='APPROVE'||record.decision.reviewDigest!==currentReview.reviewDigest)fail('APPROVAL_REQUIRED','Exact human domain decision required');
      verifyDecisionEvidence(record.decision.humanEvidenceRef,{owner:'ontology',operation:'native.package.decide',workspaceId:s.identity.id,scope:r.scope,reviewDigest:currentReview.reviewDigest,decision:'APPROVE'});
      dependencies(s,record);record.reference=referenceForPackage(record.package);save(s,record);return {reference:record.reference,packageDigest:record.packageDigest,validationDigest:record.validation!.reportDigest,authority:false};
    });
  }
  return async <R extends OntologyNativeRequest>(request:R):Promise<OntologyNativeOutput<R['operation']>> => await native(request) as OntologyNativeOutput<R['operation']>;
}
