import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {listenStandalone} from '../../dist/standalone/http.js';
import {grantReviewer,revokeReviewer} from '../../dist/installation/reviewer.js';
import {verifyDeliveryBundle} from '@evopilot-next/ontology/native-v2';
import {hash,hashBytes,canonical} from '../../dist/standalone/validation.js';
import {fixture,prepare,configuration,terminal,model,shapeText,source} from '../helpers/v090-validation.mjs';
test.before(()=>assert(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Actual pinned engines required; no mock or skip'));
function setup(t){
 const f=fixture(t),grantInput={root:f.root,workspaceId:f.setup.workspaceId,serviceId:f.setup.serviceId,projectId:'demo',principalId:'synthetic-reviewer',grantId:'reviewer-test',expiresAt:new Date(Date.now()+86400000).toISOString()},grant=grantReviewer(grantInput);
 f.reviewerToken=readFileSync(grant.credentialFile,'utf8');f.grantInput=grantInput;return f;
}
const revision=(s,f)=>s.request(f.read('project.inspect'),f.token).revision;
function write(s,f,operation,input,requestId,token=f.token){return s.request(f.write(operation,input,requestId,revision(s,f)),token);}
async function formal(s,f,p,task,name){
 const receipt=write(s,f,'reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task},name),taskId=receipt.result.taskId,end=Date.now()+30000;
 while(Date.now()<end){const r=s.request(f.read('reasoning.inspect',{taskId}),f.token);if(r.state==='FINISHED'){assert.equal(r.formalStatus,'COMPLETED',JSON.stringify(r.result));return taskId;}await new Promise(r=>setTimeout(r,20));}throw Error('Actual explanation did not finish');
}
const explain=(s,f,p,name='explain')=>formal(s,f,p,{kind:'explanation',target:'entailment',query:p.expectations.cases.find(c=>c.kind==='owl-entailment'&&c.expectedStatus==='ENTAILED').query},name);
async function checked(s,f,p){const v=write(s,f,'validation.start',{assetId:'services',modelDigest:p.modelDigest},'validate');assert.equal((await terminal(s,f,v.result.taskId)).formalStatus,'MATCHED');return {validationTaskId:v.result.taskId,explanationTaskIds:[await explain(s,f,p)]};}
function candidate(s,f,p,tasks,version='1.0.0',previousDeliveryDigest=null){return write(s,f,'review.prepare',{assetId:'services',modelDigest:p.modelDigest,version,previousDeliveryDigest,...tasks},'candidate-'+version).result;}
function decisionInput(c,decision='APPROVE',previousDecisionDigest=null){return {assetId:'services',candidateDigest:c.candidateDigest,reportDigest:c.reportDigest,previousDecisionDigest,decision,rationale:'Synthetic test decision after inspecting the exact candidate.',instruction:{reference:'urn:test:explicit-review-instruction',content:'Synthetic fixture only: '+decision+' this exact candidate and all of its declared requirements.'},requirementIds:decision==='APPROVE'?['r1','r2']:[]};}
function readJSON(s,f,operation,input){let content='',offset=0,first;do{const page=s.request(f.read(operation,{...input,offset,maxBytes:4096}),f.token);first??=page;content+=page.content;offset=page.nextOffset;}while(offset!==null);assert.equal(hashBytes(content),first.documentDigest);return JSON.parse(content);}

test('real source/model/check/explanation/review/delivery cycle has independent approval and pinned offline readback',async t=>{
 const f=setup(t);let s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),tasks=await checked(s,f,p),c=candidate(s,f,p,tasks);
 assert.equal(c.status,'AWAITING_DECISION');assert.equal(s.context(f.token).writeOperations.includes('review.decide'),false);assert.deepEqual(s.context(f.reviewerToken).writeOperations,['review.decide']);
 const report=readJSON(s,f,'review.report.read',{assetId:'services',candidateDigest:c.candidateDigest});assert.equal(hash(report),c.reportDigest);assert.equal(report.sourceSet.sources[0].content,source.content);assert.equal(report.explanations[0].report.sourceLinkPrecision,'DOCUMENT_MAPPING_NOT_AXIOM_BYTE_LOCATION');assert.equal(report.explanations[0].report.sourceLinksComplete,true);
 const explanation=readJSON(s,f,'explanation.read',{assetId:'services',modelDigest:p.modelDigest,taskId:tasks.explanationTaskIds[0]});assert(explanation.support.length>0);assert.equal(explanation.support[0].documents[0].mappings[0].sourceFragments[0].id,'rule');
 assert.throws(()=>write(s,f,'review.decide',decisionInput(c),'forbidden'),{code:'FORBIDDEN'});assert.throws(()=>write(s,f,'model.record',{draft:p.model},'reviewer-cannot-author',f.reviewerToken),{code:'FORBIDDEN'});
 const decisionRequest=f.write('review.decide',decisionInput(c),'approve',revision(s,f)),approved=s.request(decisionRequest,f.reviewerToken);assert.equal(approved.result.principalId,'synthetic-reviewer');assert.equal(approved.result.delivered,false);
 const deliveryRequest=f.write('delivery.record',{assetId:'services',candidateDigest:c.candidateDigest,reviewDigest:approved.result.reviewDigest},'deliver',revision(s,f)),delivered=s.request(deliveryRequest,f.token),deliveryDigest=delivered.result.deliveryDigest;
 const bundle=readJSON(s,f,'delivery.export.read',{assetId:'services',deliveryDigest}),verified=verifyDeliveryBundle(bundle,deliveryDigest);assert.equal(verified.integrityVerified,true);assert.equal(verified.externalInstructionVerified,false);assert.equal(verified.formalExecutionReplayed,false);assert.equal(bundle.visibility,'private');assert.equal(bundle.identity.version,'1.0.0');assert.equal(bundle.parts.find(p=>p.kind==='source-set').content.includes('accessing sensitive data'),true);
 const path=join(f.base,'offline-delivery.json');writeFileSync(path,JSON.stringify(bundle),{mode:0o600});
 s.close();s=createStandaloneService(configuration(f));assert.deepEqual(s.request(decisionRequest,f.reviewerToken),approved);assert.deepEqual(s.request(deliveryRequest,f.token),delivered);assert.equal(s.request(f.read('delivery.inspect',{assetId:'services',deliveryDigest}),f.token).isLatestDelivery,true);
 s.close();s=createStandaloneService(f.setup);assert.equal(verifyDeliveryBundle(readJSON(s,f,'delivery.export.read',{assetId:'services',deliveryDigest}),deliveryDigest).integrityVerified,true);
 assert.equal(JSON.parse(readFileSync(path,'utf8')).parts.length,bundle.parts.length);assert.throws(()=>verifyDeliveryBundle(bundle,hash({different:'owner'})),{code:'DELIVERY_DIGEST'});
 const tampered=structuredClone(bundle);tampered.parts.find(p=>p.kind==='model').content+=' ';assert.throws(()=>verifyDeliveryBundle(tampered,hash(tampered)),{code:'DELIVERY_PART'});
 const mixed=structuredClone(bundle),part=mixed.parts.find(p=>p.kind==='validation'),evidence=JSON.parse(part.content),check=evidence.result.result.checks.find(c=>c.id==='model-shacl');check.result.requestDigest=hash({foreign:true});check.resultDigest=hash(check.result);
 // Keep canonical byte hashes coherent so this checks native result binding,
 // not merely detection of an unmodified outer checksum.
 part.content=canonical(evidence);part.digest=hashBytes(part.content);assert.throws(()=>verifyDeliveryBundle(mixed,hash(mixed)),{code:'EVIDENCE_SCOPE'});
});
test('missing explanations and mismatched checks cannot prepare a semantic review',async t=>{
 const f=setup(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),v=write(s,f,'validation.start',{assetId:'services',modelDigest:p.modelDigest},'validation');assert.equal((await terminal(s,f,v.result.taskId)).formalStatus,'MATCHED');
 assert.throws(()=>candidate(s,f,p,{validationTaskId:v.result.taskId,explanationTaskIds:[]}),{code:'EXPLANATION_COVERAGE'});const before=revision(s,f);
 const weak=model(p.intentDigest,p.sourceSetDigest,p.expectationsDigest,p.modelDigest,shapeText.replace('sh:minCount 1','sh:minCount 0'));p.modelDigest=write(s,f,'model.record',{draft:weak},'weak').result.modelDigest;
 const bad=write(s,f,'validation.start',{assetId:'services',modelDigest:p.modelDigest},'invalid');assert.equal((await terminal(s,f,bad.result.taskId)).formalStatus,'MISMATCH');
 assert.throws(()=>candidate(s,f,p,{validationTaskId:bad.result.taskId,explanationTaskIds:[]},'2.0.0'),{code:'CANDIDATE_NOT_READY'});assert.equal(revision(s,f),before+2);
});
test('wrong report, missing requirement acknowledgement and stale candidate cannot be approved',async t=>{
 const f=setup(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),tasks=await checked(s,f,p),c=candidate(s,f,p,tasks),d=decisionInput(c);
 assert.throws(()=>write(s,f,'review.decide',{...d,reportDigest:hash({})},'wrong-report',f.reviewerToken),{code:'REVIEW_BINDING'});
 assert.throws(()=>write(s,f,'review.decide',{...d,requirementIds:['r1']},'missing-req',f.reviewerToken),{code:'REVIEW_REQUIREMENTS'});
 const revised=structuredClone(p.model);revised.previousDigest=p.modelDigest;revised.label='A new exact candidate';write(s,f,'model.record',{draft:revised},'new-model');
 assert.equal(s.request(f.read('review.inspect',{assetId:'services',candidateDigest:c.candidateDigest}),f.token).current,false);
 assert.throws(()=>write(s,f,'review.decide',d,'stale-approval',f.reviewerToken),{code:'STALE_CANDIDATE'});
 const rejected=write(s,f,'review.decide',decisionInput(c,'REJECT'),'reject-stale',f.reviewerToken);assert.equal(rejected.result.decision,'REJECT');assert.equal(s.request(f.read('model.inspect',{assetId:'services',modelDigest:null}),f.token).label,revised.label);
});
test('rejection blocks delivery, preserves draft and can only be superseded by an explicit parented decision',async t=>{
 const f=setup(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),tasks=await checked(s,f,p),c=candidate(s,f,p,tasks),rejected=write(s,f,'review.decide',decisionInput(c,'REJECT'),'reject',f.reviewerToken);
 assert.throws(()=>write(s,f,'delivery.record',{assetId:'services',candidateDigest:c.candidateDigest,reviewDigest:rejected.result.reviewDigest},'rejected-delivery'),{code:'REVIEW_REJECTED'});
 assert.equal(s.request(f.read('model.inspect',{assetId:'services',modelDigest:null}),f.token).modelDigest,p.modelDigest);assert.deepEqual(s.request(f.read('delivery.list',{assetId:'services',afterDigest:null,limit:10}),f.token).records,[]);
 assert.throws(()=>write(s,f,'review.decide',decisionInput(c),'unparented',f.reviewerToken),{code:'REVIEW_CONFLICT'});
 const approved=write(s,f,'review.decide',decisionInput(c,'APPROVE',rejected.result.reviewDigest),'approve',f.reviewerToken);assert.throws(()=>write(s,f,'delivery.record',{assetId:'services',candidateDigest:c.candidateDigest,reviewDigest:rejected.result.reviewDigest},'old-review'),{code:'STALE_REVIEW'});
 assert.equal(write(s,f,'delivery.record',{assetId:'services',candidateDigest:c.candidateDigest,reviewDigest:approved.result.reviewDigest},'delivery').result.status,'DELIVERED');
});
test('new versions retain lineage and old bytes; same name cannot overwrite a delivered identity',async t=>{
 const f=setup(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),tasks=await checked(s,f,p),c=candidate(s,f,p,tasks),approved=write(s,f,'review.decide',decisionInput(c),'approve1',f.reviewerToken),first=write(s,f,'delivery.record',{assetId:'services',candidateDigest:c.candidateDigest,reviewDigest:approved.result.reviewDigest},'delivery1').result.deliveryDigest,old=readJSON(s,f,'delivery.export.read',{assetId:'services',deliveryDigest:first});
 assert.throws(()=>write(s,f,'review.prepare',{assetId:'services',modelDigest:p.modelDigest,version:'1.0.0',previousDeliveryDigest:first,...tasks},'duplicate-version'),{code:'VERSION_EXISTS'});assert.throws(()=>candidate(s,f,p,tasks,'2.0.0',null),{code:'DELIVERY_CONFLICT'});
 const next=candidate(s,f,p,tasks,'2.0.0',first),review=write(s,f,'review.decide',decisionInput(next),'approve2',f.reviewerToken),second=write(s,f,'delivery.record',{assetId:'services',candidateDigest:next.candidateDigest,reviewDigest:review.result.reviewDigest},'delivery2').result.deliveryDigest;
 assert.notEqual(second,first);assert.deepEqual(readJSON(s,f,'delivery.export.read',{assetId:'services',deliveryDigest:first}),old);assert.equal(s.request(f.read('delivery.inspect',{assetId:'services',deliveryDigest:first}),f.token).isLatestDelivery,false);assert.equal(s.request(f.read('delivery.inspect',{assetId:'services',deliveryDigest:second}),f.token).previousDeliveryDigest,first);
});
test('approval and delivery receipt faults roll back state and revisions without redispatch',async t=>{
 const f=setup(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),tasks=await checked(s,f,p),c=candidate(s,f,p,tasks);
 const db=new DatabaseSync(join(f.root,'ontology.sqlite'));db.exec("CREATE TRIGGER lifecycle_receipt_fault BEFORE INSERT ON receipts WHEN NEW.request_id IN ('approve-fault','delivery-fault') BEGIN SELECT RAISE(ABORT,'synthetic lifecycle fault'); END;");db.close();
 const before=revision(s,f);assert.throws(()=>write(s,f,'review.decide',decisionInput(c),'approve-fault',f.reviewerToken),/synthetic lifecycle fault/);assert.equal(revision(s,f),before);assert.equal(s.request(f.read('review.inspect',{assetId:'services',candidateDigest:c.candidateDigest}),f.token).reviewDigest,null);
 const approved=write(s,f,'review.decide',decisionInput(c),'approve',f.reviewerToken);assert.throws(()=>write(s,f,'delivery.record',{assetId:'services',candidateDigest:c.candidateDigest,reviewDigest:approved.result.reviewDigest},'delivery-fault'),/synthetic lifecycle fault/);assert.equal(revision(s,f),before+1);assert.deepEqual(s.request(f.read('delivery.list',{assetId:'services',afterDigest:null,limit:1}),f.token).records,[]);
});
test('an expectation change after approval prevents delivery while retaining the actual earlier decision',async t=>{
 const f=setup(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),tasks=await checked(s,f,p),c=candidate(s,f,p,tasks),approved=write(s,f,'review.decide',decisionInput(c),'approve',f.reviewerToken);
 const next=structuredClone(p.expectations);next.previousDigest=p.expectationsDigest;next.requirements[0].rationale='Revised independent source interpretation';write(s,f,'expectations.record',{definition:next},'change-expectations');
 assert.throws(()=>write(s,f,'delivery.record',{assetId:'services',candidateDigest:c.candidateDigest,reviewDigest:approved.result.reviewDigest},'stale-delivery'),{code:'STALE_CANDIDATE'});
 const historical=s.request(f.read('review.inspect',{assetId:'services',candidateDigest:c.candidateDigest}),f.token);assert.equal(historical.current,false);assert.equal(historical.decision.decision,'APPROVE');assert.deepEqual(s.request(f.read('delivery.list',{assetId:'services',afterDigest:null,limit:1}),f.token).records,[]);
});
test('a derived-view delivery retains and independently reconstructs its named projection evidence',async t=>{
 const f=setup(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),taskId=await formal(s,f,p,{kind:'realization',entities:['urn:demo:svc'],direct:false},'realize'),view=write(s,f,'view.record',{assetId:'services',modelDigest:p.modelDigest,taskIds:[taskId]},'view').result;
 const v=write(s,f,'validation.start',{assetId:'services',modelDigest:p.modelDigest,view:{kind:'derived',viewDigest:view.viewDigest}},'validate');assert.equal((await terminal(s,f,v.result.taskId)).formalStatus,'MATCHED');
 const tasks={validationTaskId:v.result.taskId,explanationTaskIds:[await explain(s,f,p)]},c=candidate(s,f,p,tasks),approved=write(s,f,'review.decide',decisionInput(c),'approve',f.reviewerToken),delivery=write(s,f,'delivery.record',{assetId:'services',candidateDigest:c.candidateDigest,reviewDigest:approved.result.reviewDigest},'deliver');
 const bundle=readJSON(s,f,'delivery.export.read',{assetId:'services',deliveryDigest:delivery.result.deliveryDigest});assert.equal(bundle.parts.filter(p=>p.kind==='projection-task').length,1);assert.equal(verifyDeliveryBundle(bundle,delivery.result.deliveryDigest).modelDigest,p.modelDigest);
});
test('reviewer operator issuance resumes exactly, refuses live owner and cannot restore revoked authority',async t=>{
 const f=setup(t);assert.equal(grantReviewer(f.grantInput).credentialFile.endsWith('reviewer-token-reviewer-test'),true);let s=createStandaloneService(configuration(f));t.after(()=>s.close());
 assert.throws(()=>grantReviewer(f.grantInput),{code:'WORKSPACE_BUSY'});s.close();revokeReviewer({...f.setup,grantId:'reviewer-test'});assert.throws(()=>grantReviewer(f.grantInput),{code:'GRANT_CONFLICT'});
 s=createStandaloneService(configuration(f));assert.throws(()=>s.context(f.reviewerToken),{code:'UNAUTHENTICATED'});
 const result=spawnSync(process.execPath,['dist/standalone/cli.js','reviewer-revoke','--root',f.root,'--workspace',f.setup.workspaceId,'--service',f.setup.serviceId,'--grant-id','reviewer-test','--json'],{encoding:'utf8'});assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).error.code,'WORKSPACE_BUSY');assert(!result.stdout.includes(f.reviewerToken));
});
test('official MCP transport enforces reviewer scope and performs exact approval plus private delivery',async t=>{
 const f=setup(t),seed=createStandaloneService(configuration(f)),p=prepare(seed,f),tasks=await checked(seed,f,p);seed.close();const server=await listenStandalone(configuration(f));t.after(()=>server.close());
 const author=new Client({name:'synthetic-author',version:'1'}),reviewer=new Client({name:'synthetic-reviewer',version:'1'});t.after(()=>Promise.all([author.close(),reviewer.close()]));
 await author.connect(new StreamableHTTPClientTransport(new URL(server.origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+f.token}}}));await reviewer.connect(new StreamableHTTPClientTransport(new URL(server.origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+f.reviewerToken}}}));
 const call=async (client,name,args)=>{const r=await client.callTool({name,arguments:args});assert(!r.isError,JSON.stringify(r));return r.structuredContent.result;};
 const c=(await call(author,'ontology_write',f.write('review.prepare',{assetId:'services',modelDigest:p.modelDigest,version:'1.0.0',previousDeliveryDigest:null,...tasks},'candidate',7))).result;
 const forbidden=await author.callTool({name:'ontology_write',arguments:f.write('review.decide',decisionInput(c),'forbidden',8)});assert.equal(forbidden.isError,true);assert.equal(forbidden.structuredContent.error.code,'FORBIDDEN');
 const approved=await call(reviewer,'ontology_write',f.write('review.decide',decisionInput(c),'approve',8)),delivery=await call(author,'ontology_write',f.write('delivery.record',{assetId:'services',candidateDigest:c.candidateDigest,reviewDigest:approved.result.reviewDigest},'deliver',9));
 const view=await call(author,'ontology_read',f.read('delivery.inspect',{assetId:'services',deliveryDigest:delivery.result.deliveryDigest}));assert.equal(view.visibility,'private');assert.equal(view.currentDecisionMatches,true);
});
