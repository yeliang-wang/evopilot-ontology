import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {listenStandalone} from '../../dist/standalone/http.js';
import {grantReviewer} from '../../dist/installation/reviewer.js';
import {hash,hashBytes,canonical} from '../../dist/standalone/validation.js';
import {verifyDeliveryBundle} from '@evopilot-next/ontology/native-v2';
import {fixture,prepare,configuration,terminal,model,modelText,shapeText,definition,source,expected} from '../helpers/v090-validation.mjs';

test.before(()=>assert(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Actual pinned engines required; no mock or skip'));
const revision=(s,f)=>s.request(f.read('project.inspect'),f.token).revision;
const write=(s,f,op,input,requestId,token=f.token)=>s.request(f.write(op,input,requestId,revision(s,f)),token);
const side=(modelDigest,validationTaskId=null,viewDigest=null)=>({modelDigest,validationTaskId,viewDigest});
function pages(s,f,op,input,maxBytes=65536){
  let content='',offset=0,first,last;
  do{last=s.request(f.read(op,{...input,offset,maxBytes}),f.token);first??=last;assert.equal(last.documentDigest,first.documentDigest);content+=last.content;offset=last.nextOffset;}while(offset!==null);
  assert.equal(hashBytes(content),first.documentDigest);return {report:JSON.parse(content),page:first,content,last};
}
const compare=(s,f,from,to,maxBytes)=>pages(s,f,'model.compare.read',{assetId:'services',from,to},maxBytes);
async function validate(s,f,modelDigest,name,status='MATCHED'){
  const taskId=write(s,f,'validation.start',{assetId:'services',modelDigest},name).result.taskId;
  assert.equal((await terminal(s,f,taskId)).formalStatus,status);return taskId;
}
function edited(p,text=modelText,shapes=shapeText){
  const value=model(p.intentDigest,p.sourceSetDigest,p.expectationsDigest,p.modelDigest,shapes),doc=value.closure.documents[0];
  doc.content=text;doc.digest=hashBytes(text);
  for(const m of value.mappings)for(const a of m.anchors)if(a.documentId===doc.id)Object.assign(a,{documentDigest:doc.digest,start:0,end:Buffer.byteLength(text),fragmentDigest:doc.digest});
  return value;
}
const removeAccess=text=>text.replace(':svc a owl:NamedIndividual, :Service ; :accesses :data .',':svc a owl:NamedIndividual, :Service .');
async function reason(s,f,modelDigest,task,name){
  const taskId=write(s,f,'reasoning.start',{assetId:'services',modelDigest,task},name).result.taskId,end=Date.now()+30000;
  while(Date.now()<end){const r=s.request(f.read('reasoning.inspect',{taskId}),f.token);if(r.state==='FINISHED'){assert.equal(r.formalStatus,'COMPLETED');return taskId;}await new Promise(r=>setTimeout(r,25));}throw Error('Actual reasoning did not finish');
}
async function view(s,f,modelDigest,name,entities=['urn:demo:svc']){
  const taskId=await reason(s,f,modelDigest,{kind:'realization',entities,direct:false},name+'-task');
  return write(s,f,'view.record',{assetId:'services',modelDigest,taskIds:[taskId]},name).result.viewDigest;
}
function reviewer(f){
  const result=grantReviewer({root:f.root,workspaceId:f.setup.workspaceId,serviceId:f.setup.serviceId,projectId:'demo',principalId:'synthetic-evolution-reviewer',grantId:'evolution-reviewer',expiresAt:new Date(Date.now()+86400000).toISOString()});
  return readFileSync(result.credentialFile,'utf8');
}
async function deliver(s,f,p,validationTaskId,token,version,previousDeliveryDigest=null,comparisonDigest=null){
  const explanationTaskIds=[];
  for(const c of p.expectations.cases.filter(c=>c.kind==='owl-entailment'&&c.expectedStatus==='ENTAILED'))explanationTaskIds.push(await reason(s,f,p.modelDigest,{kind:'explanation',target:'entailment',query:c.query},'explain-'+version+'-'+c.id));
  const c=write(s,f,'review.prepare',{assetId:'services',modelDigest:p.modelDigest,version,previousDeliveryDigest,validationTaskId,explanationTaskIds},'candidate-'+version).result;
  const review=write(s,f,'review.decide',{assetId:'services',candidateDigest:c.candidateDigest,reportDigest:c.reportDigest,previousDecisionDigest:null,decision:'APPROVE',rationale:'Synthetic evolution fixture; comparison '+(comparisonDigest??'not applicable to first delivery'),instruction:{reference:'urn:test:synthetic-evolution-review:'+version,content:'Synthetic fixture approval of this exact candidate. Not actual Host or business approval.'},requirementIds:['r1','r2']},'review-'+version,token).result;
  return write(s,f,'delivery.record',{assetId:'services',candidateDigest:c.candidateDigest,reviewDigest:review.reviewDigest},'delivery-'+version).result.deliveryDigest;
}

test('removing a real premise identifies lost entailment and a fixed-case regression without proving negation',async t=>{
  const f=fixture(t);let s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),oldTask=await validate(s,f,p.modelDigest,'before'),oldView=await view(s,f,p.modelDigest,'before-view');
  const changed=edited(p,removeAccess(modelText)),next=write(s,f,'model.record',{draft:changed},'remove-premise').result.modelDigest,newTask=await validate(s,f,next,'after','MISMATCH'),newView=await view(s,f,next,'after-view');
  const from=side(p.modelDigest,oldTask,oldView),to=side(next,newTask,newView),beforeRevision=revision(s,f),value=compare(s,f,from,to,4096),c=value.report.formal.cases.find(c=>c.id==='sensitive-positive');
  assert.equal(c.conclusionTransition,'LOST_ENTAILMENT');assert.equal(c.matchTransition,'REGRESSED_FIXED_CASE');assert.equal(c.before.actual,'ENTAILED');assert.equal(c.after.actual,'NOT_ENTAILED');assert.equal(c.expectationChanged,false);
  assert.equal(value.report.formal.beforeStatus,'MATCHED');assert.equal(value.report.formal.afterStatus,'MISMATCH');assert.equal(value.report.claims.notEntailedMeansNegation,false);assert.equal(value.report.claims.semanticEquivalence,'NOT_PROVEN');
  assert(value.report.requirementImpact.find(r=>r.requirementId==='r1').reasons.includes('FIXED_CASE_OBSERVATION_CHANGED'));
  assert.equal(value.report.projection.comparable,true);assert(value.report.projection.observedOnlyBefore.some(t=>t.subject==='urn:demo:svc'&&t.object==='urn:demo:SensitiveService'&&t.taskIds.length===1));
  assert.equal(value.page.freshness.from.currentModelBinding,false);assert.equal(value.page.freshness.to.currentModelBinding,true);assert.equal(revision(s,f),beforeRevision);
  assert.throws(()=>write(s,f,'review.prepare',{assetId:'services',modelDigest:next,version:'bad',previousDeliveryDigest:null,validationTaskId:newTask,explanationTaskIds:[]},'cannot-review-mismatch'),{code:'CANDIDATE_NOT_READY'});
  await s.close();s=createStandaloneService(f.setup);const historical=compare(s,f,from,to);assert.equal(historical.content,value.content);assert.equal(historical.page.freshness.to.configuredValidationMatches,false);assert.equal(historical.page.reportDigest,value.page.reportDigest);
});

test('weakened SHACL constraint exposes the negative fixture regression even when candidate data conforms',async t=>{
  const f=fixture(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),oldTask=await validate(s,f,p.modelDigest,'before');
  const next=write(s,f,'model.record',{draft:edited(p,modelText,shapeText.replace('sh:minCount 1','sh:minCount 0'))},'weaken').result.modelDigest,newTask=await validate(s,f,next,'after','MISMATCH'),r=compare(s,f,side(p.modelDigest,oldTask),side(next,newTask)).report;
  const c=r.formal.cases.find(c=>c.id==='owner-negative');assert.equal(c.before.actual,'NONCONFORMING');assert.equal(c.after.actual,'CONFORMS');assert.equal(c.matchTransition,'REGRESSED_FIXED_CASE');assert(c.flags.includes('CANDIDATE_SHAPES_CHANGED'));assert.equal(r.formal.baseChecks.find(c=>c.id==='model-shacl').after.matched,true);assert.equal(r.declarations.shapeDocuments[0].id,'constraints');
});

test('new source snapshot and independent oracle changes support substantive new delivery while preserving the old bytes',async t=>{
  const f=fixture(t),token=reviewer(f),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),oldTask=await validate(s,f,p.modelDigest,'before'),first=await deliver(s,f,p,oldTask,token,'1.0.0'),oldExport=pages(s,f,'delivery.export.read',{assetId:'services',deliveryDigest:first});
  // The new fixture's facts and oracle are fixed here before the changed model
  // is generated or executed. This is synthetic source evidence, not a user decision.
  const newSource={...source,revision:'v2',content:source.content+' Snapshot v2: svc no longer accesses sensitive data; backupSvc accesses the sensitive dataset. 两个服务均保留 owner。'};newSource.digest=hashBytes(newSource.content);
  const newDefinition=structuredClone(definition),{content:_,format:__,...binding}=newSource;newDefinition.sources=[binding];newDefinition.mode='composition';newDefinition.requirements[0].statement+=' Snapshot v2 classifies backupSvc, while svc has no remaining access premise.';
  const intentDigest=write(s,f,'intent.record',{definition:newDefinition,previousDigest:p.intentDigest},'source-change-intent').result.intentDigest;
  const sourceSet={schema:'ontology-source-set/v2',sources:[newSource],fragments:[{id:'rule',sourceId:newSource.id,sourceDigest:newSource.digest,selector:{kind:'document'},fragmentDigest:newSource.digest}]},sourceSetDigest=write(s,f,'source.admit',{intentDigest,sourceSet},'source-change-admit').result.sourceSetDigest;
  const expectations=expected(intentDigest,sourceSetDigest,p.expectationsDigest);expectations.cases[0].expectedStatus='NOT_ENTAILED';expectations.cases[0].rationale='The fixed v2 source removes this sole premise; non-entailment does not prove non-sensitivity.';
  const positive=structuredClone(expectations.cases[0]);positive.id='backup-sensitive-positive';positive.expectedStatus='ENTAILED';positive.query.content=positive.query.content.replace(':svc',':backupSvc');positive.query.digest=hashBytes(positive.query.content);positive.rationale='The fixed v2 source explicitly gives backupSvc sensitive access.';expectations.cases.push(positive);
  const expectationsDigest=write(s,f,'expectations.record',{definition:expectations},'source-change-expected').result.expectationsDigest;
  const next={intentDigest,sourceSetDigest,expectationsDigest,expectations,modelDigest:p.modelDigest};next.model=edited(next,removeAccess(modelText)+' :backupSvc a owl:NamedIndividual, :Service ; :accesses :data ; :owner "operations" .');next.modelDigest=write(s,f,'model.record',{draft:next.model},'source-change-model').result.modelDigest;
  const newTask=await validate(s,f,next.modelDigest,'after'),comparison=compare(s,f,side(p.modelDigest,oldTask),side(next.modelDigest,newTask)),r=comparison.report,c=r.formal.cases.find(c=>c.id==='sensitive-positive');
  assert.equal(r.formal.beforeStatus,'MATCHED');assert.equal(r.formal.afterStatus,'MATCHED');assert.equal(c.conclusionTransition,'LOST_ENTAILMENT');assert.equal(c.matchTransition,'NOT_COMPARABLE');assert.equal(c.expectationChanged,true);assert(c.flags.includes('EXPECTED_OUTCOME_CHANGED'));assert(r.formal.cases.find(c=>c.id==='backup-sensitive-positive').flags.includes('CASE_ADDED'));
  assert(r.declarations.sourceDocuments.length>0);assert(r.declarations.fragments.length>0);assert(r.requirementImpact.find(r=>r.requirementId==='r1').reasons.includes('INDEPENDENT_EXPECTATION_CHANGED'));
  const second=await deliver(s,f,next,newTask,token,'2.0.0',first,comparison.page.reportDigest),newExport=pages(s,f,'delivery.export.read',{assetId:'services',deliveryDigest:second});assert.equal(newExport.report.previousDeliveryDigest,first);assert.equal(verifyDeliveryBundle(newExport.report,second).modelDigest,next.modelDigest);assert.equal(pages(s,f,'delivery.export.read',{assetId:'services',deliveryDigest:first}).content,oldExport.content);
  assert.equal(s.request(f.read('delivery.inspect',{assetId:'services',deliveryDigest:first}),f.token).currentModelBinding,false);assert.equal(s.request(f.read('delivery.inspect',{assetId:'services',deliveryDigest:second}),f.token).currentModelBinding,true);
  const baseline=s.request(f.read('review.inspect',{assetId:'services',candidateDigest:oldExport.report.candidateDigest}),f.token);assert.equal(baseline.candidate.modelDigest,p.modelDigest);assert.equal(baseline.candidate.validation.taskId,oldTask);
});

test('format-only bytes remain distinct without asserting semantic equivalence or unobserved formal comparison',async t=>{
  const f=fixture(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),oldTask=await validate(s,f,p.modelDigest,'before');
  const changed=edited(p,modelText+'\n# 原始字节与语义不同层次\n');changed.label='保留原始字节';const next=write(s,f,'model.record',{draft:changed},'format').result.modelDigest,newTask=await validate(s,f,next,'after'),r=compare(s,f,side(p.modelDigest,oldTask),side(next,newTask)).report;
  assert.equal(r.declarations.ontologyDocuments.length,1);assert(r.formal.cases.every(c=>c.matchTransition==='UNCHANGED'));assert.equal(r.claims.semanticEquivalence,'NOT_PROVEN');
  const missing=compare(s,f,side(p.modelDigest),side(next));assert.equal(missing.report.formal.status,'NOT_EVALUATED');assert(missing.report.formal.cases.every(c=>c.matchTransition==='NOT_EVALUATED'));assert.equal(missing.report.projection.status,'NOT_EVALUATED');
  const byteOffset=Buffer.byteLength(missing.content.slice(0,missing.content.indexOf('保留')))+1;
  assert.throws(()=>s.request(f.read('model.compare.read',{assetId:'services',from:side(p.modelDigest),to:side(next),offset:byteOffset,maxBytes:4}),f.token),{code:'INVALID_INPUT'});
  assert.equal(compare(s,f,side(p.modelDigest),side(next),257).content,missing.content);
});

test('inconsistent changed model is not reported as gained or lost ordinary business entailment',async t=>{
  const f=fixture(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),oldTask=await validate(s,f,p.modelDigest,'before'),next=write(s,f,'model.record',{draft:edited(p,modelText+' :Service owl:disjointWith :SensitiveService .')},'inconsistent').result.modelDigest,newTask=await validate(s,f,next,'after','MISMATCH'),r=compare(s,f,side(p.modelDigest,oldTask),side(next,newTask)).report;
  assert.equal(r.formal.baseChecks.find(c=>c.id==='model-consistency').after.actual,'INCONSISTENT');assert(r.formal.cases.filter(c=>c.before.kind==='owl').every(c=>c.conclusionTransition==='NOT_COMPARABLE'));
});

test('changed queries and projection selection are visible and cannot establish comparable regressions',async t=>{
  const f=fixture(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),oldTask=await validate(s,f,p.modelDigest,'before'),a=await view(s,f,p.modelDigest,'svc'),b=await view(s,f,p.modelDigest,'public',['urn:demo:publicService']);
  const views=compare(s,f,side(p.modelDigest,oldTask,a),side(p.modelDigest,oldTask,b)).report.projection;assert.equal(views.selectionMatches,false);assert.equal(views.comparable,false);assert.equal(views.absenceMeans,'NOT_IN_SELECTED_PROJECTION');
  const changed=structuredClone(p.expectations);changed.previousDigest=p.expectationsDigest;changed.cases[0].query.content='Prefix(:=<urn:demo:>) Ontology(ClassAssertion(:Service :svc))';changed.cases[0].query.digest=hashBytes(changed.cases[0].query.content);
  const expectationsDigest=write(s,f,'expectations.record',{definition:changed},'change-query').result.expectationsDigest,next=write(s,f,'model.record',{draft:edited({...p,expectationsDigest})},'bind-query').result.modelDigest,newTask=await validate(s,f,next,'after'),r=compare(s,f,side(p.modelDigest,oldTask),side(next,newTask)).report,c=r.formal.cases.find(c=>c.id==='sensitive-positive');assert(c.flags.includes('PROBE_CHANGED'));assert.equal(c.conclusionTransition,'NOT_COMPARABLE');assert.equal(c.matchTransition,'NOT_COMPARABLE');
  assert.throws(()=>compare(s,f,side(p.modelDigest,oldTask),side(next,oldTask)),{code:'NOT_FOUND'});assert.throws(()=>compare(s,f,side(p.modelDigest),side(next,newTask,a)),{code:'COMPARISON_SCOPE'});
  assert.throws(()=>s.request({...f.read('model.compare.read',{assetId:'services',from:side(p.modelDigest),to:side(next),offset:0,maxBytes:65536}),projectId:'foreign'},f.token),{code:'FORBIDDEN'});
});

test('complete evidence is checked beyond outer hashes and unfinished selected evidence is refused',async t=>{
  const f=fixture(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),taskId=await validate(s,f,p.modelDigest,'validate'),db=new DatabaseSync(join(f.root,'ontology.sqlite'));t.after(()=>db.close());const row=db.prepare('SELECT result,result_digest FROM native_reasoning_tasks WHERE id=?').get(taskId);
  function replace(mutator){const value=JSON.parse(row.result);mutator(value);db.prepare('UPDATE native_reasoning_tasks SET result=?,result_digest=? WHERE id=?').run(canonical(value),hash(value),taskId);}
  replace(r=>{r.result.checks[0].matched=false;});assert.throws(()=>compare(s,f,side(p.modelDigest,taskId),side(p.modelDigest,taskId)),{code:'EVIDENCE_INCOMPLETE'});
  replace(r=>{r.result.checks[0].result.requestDigest=hash({different:true});r.result.checks[0].resultDigest=hash(r.result.checks[0].result);});assert.throws(()=>compare(s,f,side(p.modelDigest,taskId),side(p.modelDigest,taskId)),{code:'EVIDENCE_SCOPE'});
  db.prepare('UPDATE native_reasoning_tasks SET result=?,result_digest=?,state=? WHERE id=?').run(row.result,row.result_digest,'INTERRUPTED',taskId);assert.throws(()=>compare(s,f,side(p.modelDigest,taskId),side(p.modelDigest,taskId)),{code:'EVIDENCE_INCOMPLETE'});
  db.prepare('UPDATE native_reasoning_tasks SET state=? WHERE id=?').run('FINISHED',taskId);
  assert.equal(compare(s,f,side(p.modelDigest,taskId),side(p.modelDigest,taskId)).report.lineage.sameModel,true);
});

test('official MCP exposes the same read-only comparison and owner evolution guidance',async t=>{
  const f=fixture(t),seed=createStandaloneService(configuration(f)),p=prepare(seed,f);await seed.close();const server=await listenStandalone(f.setup);t.after(()=>server.close());const client=new Client({name:'synthetic-comparison-client',version:'1'});t.after(()=>client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(server.origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+f.token}}}));
  const context=await client.callTool({name:'ontology_context',arguments:{}});assert(context.structuredContent.result.readOperations.includes('model.compare.read'));assert(!context.structuredContent.result.writeOperations.includes('model.compare.read'));
  const result=await client.callTool({name:'ontology_read',arguments:f.read('model.compare.read',{assetId:'services',from:side(p.modelDigest),to:side(p.modelDigest),offset:0,maxBytes:65536})});assert(!result.isError,JSON.stringify(result));const report=JSON.parse(result.structuredContent.result.content);assert.equal(report.lineage.sameModel,true);assert.equal(report.formal.status,'NOT_EVALUATED');
  const guide=await client.callTool({name:'ontology_read',arguments:f.read('guide.read',{topic:'evolution'})});assert(guide.structuredContent.result.operations.includes('model.compare.read'));
});
