import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {hash,hashBytes,canonical} from '../../dist/standalone/validation.js';
import {fixture,prepare,configuration,terminal,source,sourceSet,definition,expected,model} from '../helpers/v090-validation.mjs';
const type='http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
test.before(()=>assert(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Actual pinned DL and SHACL executors required; no mock or skip'));
async function reason(s,f,p,task,name='reason'){
 const revision=s.request(f.read('project.inspect'),f.token).revision;
 const receipt=s.request(f.write('reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task},name,revision),f.token),taskId=receipt.result.taskId;
 const end=Date.now()+30000;
 while(Date.now()<end){const result=s.request(f.read('reasoning.inspect',{taskId}),f.token);if(result.state==='FINISHED'){assert.equal(result.formalStatus,'COMPLETED',JSON.stringify(result.result));return taskId;}await new Promise(r=>setTimeout(r,20));}throw Error('Reasoning did not finish');
}
function materialize(s,f,p,taskIds,name='view'){
 const revision=s.request(f.read('project.inspect'),f.token).revision,request=f.write('view.record',{assetId:'services',modelDigest:p.modelDigest,taskIds},name,revision),receipt=s.request(request,f.token);return {viewDigest:receipt.result.viewDigest,request,receipt};
}
function queryView(s,f,viewDigest,filter={}){return s.request(f.read('view.query',{assetId:'services',viewDigest,subject:null,predicate:null,object:null,offset:0,limit:100,...filter}),f.token);}
test('actual named classification is retained separately with exact task provenance, paging, replay and restart',async t=>{
 const f=fixture(t);let s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),taskId=await reason(s,f,p,{kind:'realization',entities:['urn:demo:svc'],direct:false}),v=materialize(s,f,p,[taskId]);
 const found=queryView(s,f,v.viewDigest,{subject:'urn:demo:svc',predicate:type,object:'urn:demo:SensitiveService'});assert.equal(found.total,1);assert.deepEqual(found.triples[0].taskIds,[taskId]);assert.equal(found.queryScope,'DERIVED_COMPONENT_ONLY');assert.equal(found.sourceSetDigest,p.sourceSetDigest);assert.equal(found.allLogicalConsequences,false);
 const original=s.request(f.read('model.document.read',{assetId:'services',modelDigest:p.modelDigest,documentId:'model',offset:0,maxBytes:65536}),f.token);assert.equal(original.content,p.model.closure.documents[0].content);assert(!original.content.includes(':svc a :SensitiveService'));
 let content='',offset=0;do{const page=s.request(f.read('view.read',{assetId:'services',viewDigest:v.viewDigest,format:'json',offset,maxBytes:97}),f.token);content+=page.content;offset=page.nextOffset;}while(offset!==null);
 const retained=JSON.parse(content);assert.equal(hash(retained),v.viewDigest);assert.equal(retained.tasks[0].resultDigest,s.request(f.read('reasoning.inspect',{taskId}),f.token).resultDigest);
 s.close();s=createStandaloneService(configuration(f));assert.deepEqual(s.request(v.request,f.token),v.receipt);assert.equal(s.request(f.read('view.inspect',{assetId:'services',viewDigest:v.viewDigest}),f.token).configuredToolchainMatches,true);assert.equal(s.request(f.read('view.list',{assetId:'services',afterDigest:null,limit:1}),f.token).views[0].viewDigest,v.viewDigest);
 assert.equal(queryView(s,f,v.viewDigest,{object:'urn:demo:Unknown'}).absenceMeans,'NOT_IN_THIS_PROJECTION');
 assert.throws(()=>s.request(f.read('view.query',{assetId:'services',viewDigest:v.viewDigest,subject:null,predicate:null,object:null,offset:0,limit:101}),f.token),{code:'INVALID_INPUT'});
 s.close();s=createStandaloneService(f.setup);assert.equal(s.request(f.read('view.inspect',{assetId:'services',viewDigest:v.viewDigest}),f.token).configuredToolchainMatches,false);
 assert.throws(()=>s.request(f.write('view.record',v.request.input,'unconfigured',7),f.token),{code:'STALE_TOOLCHAIN'});assert.equal(s.request(f.read('project.inspect'),f.token).revision,7);
});
test('actual hierarchy and identity tasks project RDF directions and explicit finite scopes',async t=>{
 const f=fixture(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),ids=[];
 const revised=structuredClone(p.model);revised.previousDigest=p.modelDigest;const document=revised.closure.documents[0];document.content+=' :accesses a owl:SymmetricProperty .';document.digest=hashBytes(document.content);const anchor=revised.mappings[0].anchors[0];anchor.documentDigest=document.digest;anchor.fragmentDigest=document.digest;anchor.end=Buffer.byteLength(document.content);p.modelDigest=s.request(f.write('model.record',{draft:revised},'symmetric',5),f.token).result.modelDigest;
 for(const [kind,entity] of [['classHierarchy','urn:demo:SensitiveService'],['objectPropertyHierarchy','urn:demo:accesses'],['dataPropertyHierarchy','urn:demo:owner'],['identity','urn:demo:svc']])ids.push(await reason(s,f,p,{kind,entities:[entity],...(kind==='identity'?{}:{direct:false})},kind));
 const v=materialize(s,f,p,ids),triples=queryView(s,f,v.viewDigest).triples;
 assert(triples.some(t=>t.subject==='urn:demo:SensitiveService'&&t.predicate==='http://www.w3.org/2000/01/rdf-schema#subClassOf'&&t.object==='urn:demo:Service'));
 assert(triples.some(t=>t.subject==='urn:demo:accesses'&&t.predicate==='http://www.w3.org/2000/01/rdf-schema#subPropertyOf'&&t.object==='http://www.w3.org/2002/07/owl#topObjectProperty'));
 assert(triples.some(t=>t.subject==='urn:demo:owner'&&t.predicate==='http://www.w3.org/2000/01/rdf-schema#subPropertyOf'&&t.object==='http://www.w3.org/2002/07/owl#topDataProperty'));
 assert(triples.some(t=>t.subject==='urn:demo:svc'&&t.predicate==='http://www.w3.org/2002/07/owl#sameAs'&&t.object==='urn:demo:svc'));
 const inspect=s.request(f.read('view.inspect',{assetId:'services',viewDigest:v.viewDigest}),f.token);assert.equal(inspect.tasks.length,4);assert.equal(inspect.scope,'NAMED_REQUESTED_ENTITIES');assert(inspect.tasks.find(t=>t.kind==='objectPropertyHierarchy').omittedInverseExpressions>0);
});
function classificationPrepare(s,f){
 // Independent synthetic requirement/oracles: the selected graph must expose
 // the sensitive type, while the original OWL model derives it from access.
 const original={...source,content:'A service accessing sensitive data is sensitive. The selected graph must explicitly contain the sensitive type for svc; a graph without that type fails the classification constraint.'};original.digest=hashBytes(original.content);
 const {content,format,...binding}=original,def={...definition,sources:[binding],requirements:[definition.requirements[0],{id:'r2',statement:'The selected graph must contain svc rdf:type SensitiveService.'}]},set={...sourceSet,sources:[original],fragments:[{id:'rule',sourceId:original.id,sourceDigest:original.digest,selector:{kind:'document'},fragmentDigest:original.digest}]};
 s.request(f.write('project.create',{label:'Derived graph classification'},'create',0),f.token);
 const intentDigest=s.request(f.write('intent.record',{definition:def,previousDigest:null},'intent',1),f.token).result.intentDigest,sourceSetDigest=s.request(f.write('source.admit',{intentDigest,sourceSet:set},'source',2),f.token).result.sourceSetDigest;
 const e=expected(intentDigest,sourceSetDigest);e.cases.filter(c=>c.kind==='shacl').forEach(c=>{const text=c.expectedConforms?'@prefix : <urn:demo:> . :svc a :SensitiveService .':'@prefix : <urn:demo:> . :svc a :Service .';const d=c.closure.documents[0];d.content=text;d.digest=hashBytes(text);});
 const expectationsDigest=s.request(f.write('expectations.record',{definition:e},'expected',3),f.token).result.expectationsDigest;
 const shapes='@prefix : <urn:demo:> . @prefix sh: <http://www.w3.org/ns/shacl#> . :ServiceShape a sh:NodeShape ; sh:targetNode :svc ; sh:property :OwnerConstraint . :OwnerConstraint a sh:PropertyShape ; sh:path <'+type+'> ; sh:hasValue :SensitiveService .';
 const draft=model(intentDigest,sourceSetDigest,expectationsDigest,null,shapes),modelDigest=s.request(f.write('model.record',{draft},'model',4),f.token).result.modelDigest;return {modelDigest,model:draft,intentDigest,sourceSetDigest,expectationsDigest};
}
test('actual SHACL checks the explicitly selected asserted or asserted-plus-derived graph',async t=>{
 const f=fixture(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=classificationPrepare(s,f),input={assetId:'services',modelDigest:p.modelDigest};
 const asserted=s.request(f.write('validation.start',{...input,view:{kind:'asserted'}},'asserted',5),f.token),a=await terminal(s,f,asserted.result.taskId);assert.equal(a.formalStatus,'MISMATCH',JSON.stringify(a.result));assert.equal(a.result.result.checks.find(c=>c.id==='model-shacl').actual,'NONCONFORMING');assert.equal(a.result.viewKind,'asserted');
 const taskId=await reason(s,f,p,{kind:'realization',entities:['urn:demo:svc'],direct:false}),v=materialize(s,f,p,[taskId]);
 const revision=s.request(f.read('project.inspect'),f.token).revision,derived=s.request(f.write('validation.start',{...input,view:{kind:'derived',viewDigest:v.viewDigest}},'derived',revision),f.token),d=await terminal(s,f,derived.result.taskId);
 assert.equal(d.formalStatus,'MATCHED',JSON.stringify(d.result));assert.equal(d.viewKind,'derived');assert.equal(d.projectionDigest,v.viewDigest);assert.notEqual(d.result.viewDigest,a.result.viewDigest);assert.equal(d.result.result.checks.find(c=>c.id==='model-shacl').result.result.viewKind,'derived');
 assert.equal(d.result.result.checks.find(c=>c.id==='owner-negative').result.result.viewKind,'asserted');assert.equal(d.result.result.businessConfirmed,false);
});
test('model and expectation changes stale views without rewriting historical derived documents',async t=>{
 const f=fixture(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),taskId=await reason(s,f,p,{kind:'realization',entities:['urn:demo:svc'],direct:false}),v=materialize(s,f,p,[taskId]);
 const next=structuredClone(p.expectations);next.previousDigest=p.expectationsDigest;next.requirements[0].rationale='Revised interpretation remains independently recorded';s.request(f.write('expectations.record',{definition:next},'revised-expectation',7),f.token);
 assert.equal(s.request(f.read('view.inspect',{assetId:'services',viewDigest:v.viewDigest}),f.token).current,false);assert.equal(queryView(s,f,v.viewDigest).current,false);
 assert.throws(()=>s.request(f.write('view.record',{assetId:'services',modelDigest:p.modelDigest,taskIds:[taskId]},'stale-view',8),f.token),{code:'STALE_MODEL'});
 const latest=s.request(f.read('expectations.inspect',{assetId:'services',expectationsDigest:null}),f.token).expectationsDigest,changed=model(p.intentDigest,p.sourceSetDigest,latest,p.modelDigest),updated=s.request(f.write('model.record',{draft:changed},'new-model',8),f.token).result.modelDigest;
 assert.throws(()=>s.request(f.write('validation.start',{assetId:'services',modelDigest:updated,view:{kind:'derived',viewDigest:v.viewDigest}},'stale-validation',9),f.token),{code:'STALE_VIEW'});
 assert.throws(()=>s.request(f.write('view.record',{assetId:'services',modelDigest:updated,taskIds:[taskId]},'foreign-task',9),f.token),{code:'PROJECTION_TASK_SCOPE'});
});
test('inline triples, incomplete tasks and nonprojection results cannot create a view or consume revisions',async t=>{
 const f=fixture(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),queued=s.request(f.write('reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task:{kind:'realization',entities:['urn:demo:svc'],direct:false}},'queued',5),f.token),input={assetId:'services',modelDigest:p.modelDigest,taskIds:[queued.result.taskId]};
 assert.throws(()=>s.request(f.write('view.record',input,'early',6),f.token),{code:'PROJECTION_INCOMPLETE'});
 assert.throws(()=>s.request(f.write('view.record',{...input,triples:[]},'injected',6),f.token),{code:'INVALID_INPUT'});
 s.request(f.write('reasoning.cancel',{taskId:queued.result.taskId},'cancel',6),f.token);assert.throws(()=>s.request(f.write('view.record',input,'cancelled',7),f.token),{code:'PROJECTION_INCOMPLETE'});
 const taskId=await reason(s,f,p,{kind:'consistency'},'consistency');assert.throws(()=>s.request(f.write('view.record',{...input,taskIds:[taskId]},'nonprojection',8),f.token),{code:'PROJECTION_TASK_KIND'});
 assert.throws(()=>s.request(f.write('validation.start',{assetId:'services',modelDigest:p.modelDigest,view:{kind:'derived',viewDigest:hash({}),document:{content:'forged'}}},'inject-validation',8),f.token),{code:'INVALID_INPUT'});assert.equal(s.request(f.read('project.inspect'),f.token).revision,8);
});
test('view read verifies derivation from retained task results even when a forged document has a matching hash',async t=>{
 const f=fixture(t);let s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),taskId=await reason(s,f,p,{kind:'realization',entities:['urn:demo:svc'],direct:false}),v=materialize(s,f,p,[taskId]);await s.close();
 const db=new DatabaseSync(join(f.root,'ontology.sqlite'));const row=db.prepare('SELECT document FROM native_views WHERE digest=?').get(v.viewDigest),view=JSON.parse(row.document);view.triples.push({subject:'urn:demo:fake',predicate:type,object:'urn:demo:SensitiveService',taskIds:[taskId]});const digest=hash(view);db.prepare('UPDATE native_views SET document=?,digest=? WHERE digest=?').run(canonical(view),digest,v.viewDigest);db.close();
 s=createStandaloneService(configuration(f));assert.throws(()=>s.request(f.read('view.inspect',{assetId:'services',viewDigest:digest}),f.token),{code:'CORRUPT_STATE'});
});
test('a receipt failure rolls back the derived view and its project revision atomically',async t=>{
 const f=fixture(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),taskId=await reason(s,f,p,{kind:'realization',entities:['urn:demo:svc'],direct:false});
 const db=new DatabaseSync(join(f.root,'ontology.sqlite'));db.exec("CREATE TRIGGER reject_view_receipt BEFORE INSERT ON receipts WHEN NEW.request_id='atomic-view' BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END;");db.close();
 const request=f.write('view.record',{assetId:'services',modelDigest:p.modelDigest,taskIds:[taskId]},'atomic-view',6);assert.throws(()=>s.request(request,f.token),/synthetic receipt failure/);
 assert.equal(s.request(f.read('project.inspect'),f.token).revision,6);assert.deepEqual(s.request(f.read('view.list',{assetId:'services',afterDigest:null,limit:1}),f.token).views,[]);assert.throws(()=>s.request(f.read('receipt.read',{requestId:'atomic-view'}),f.token),{code:'NOT_FOUND'});
 const repaired=new DatabaseSync(join(f.root,'ontology.sqlite'));repaired.exec('DROP TRIGGER reject_view_receipt');repaired.close();assert.equal(s.request(request,f.token).revision,7);
});
