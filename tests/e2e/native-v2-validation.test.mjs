import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {listenStandalone} from '../../dist/standalone/http.js';
import {hashBytes} from '../../dist/standalone/validation.js';
import {fixture,prepare,configuration,terminal,model,shapeText,definition,sourceSet,expected} from '../helpers/v090-validation.mjs';
test.before(()=>assert(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Actual pinned DL and SHACL executors required; no mock or skip'));

test('actual owner validation matches independently fixed OWL/SHACL cases and survives exact replay/restart',async t=>{
 const f=fixture(t);let s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),input={assetId:'services',modelDigest:p.modelDigest};
 const request=f.write('validation.start',input,'validate',5),receipt=s.request(request,f.token);assert.equal(receipt.result.state,'QUEUED');
 const result=await terminal(s,f,receipt.result.taskId);assert.equal(result.formalStatus,'MATCHED',JSON.stringify(result.result));assert.equal(result.complete,true);assert.equal(result.current,true);assert.equal(result.result.expectationsDigest,p.expectationsDigest);assert.equal(result.result.result.checks.length,6);assert.deepEqual(result.result.result.missingCheckIds,[]);assert.equal(result.result.result.businessConfirmed,false);
 assert.equal(result.events.filter(e=>e.event==='CHECK_FINISHED').length,6);const count=result.eventCount;
 s.close();s=createStandaloneService(configuration(f));assert.deepEqual(s.request(request,f.token),receipt);assert.equal(s.request(f.read('validation.inspect',{taskId:receipt.result.taskId}),f.token).eventCount,count);
 const list=s.request(f.read('validation.list',{assetId:'services',afterTaskId:null,limit:1}),f.token);assert.equal(list.tasks[0].taskId,receipt.result.taskId);assert.equal(list.nextCursor,null);
 assert.throws(()=>s.request(f.read('reasoning.inspect',{taskId:receipt.result.taskId}),f.token),{code:'NOT_FOUND'});
 let text='',offset=0;do{const page=s.request(f.read('validation.result.read',{taskId:receipt.result.taskId,offset,maxBytes:1024}),f.token);text+=page.content;offset=page.nextOffset;}while(offset!==null);assert.deepEqual(JSON.parse(text),result.result);
});
test('weakening a candidate constraint cannot make its independent negative oracle pass',async t=>{
 const f=fixture(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),weak=model(p.intentDigest,p.sourceSetDigest,p.expectationsDigest,p.modelDigest,shapeText.replace('sh:minCount 1','sh:minCount 0'));
 const changed=s.request(f.write('model.record',{draft:weak},'weaken',5),f.token),receipt=s.request(f.write('validation.start',{assetId:'services',modelDigest:changed.result.modelDigest},'validate-weak',6),f.token),result=await terminal(s,f,receipt.result.taskId);
 assert.equal(result.formalStatus,'MISMATCH',JSON.stringify(result.result));assert.equal(result.complete,true);
 const negative=result.result.result.checks.find(c=>c.id==='owner-negative');assert.equal(negative.expected,'NONCONFORMING');assert.equal(negative.actual,'CONFORMS');assert.equal(negative.matched,false);
 assert.equal(s.request(f.read('expectations.inspect',{assetId:'services',expectationsDigest:null}),f.token).expectationsDigest,p.expectationsDigest);
});
test('wrong named violation oracle and vacuous OWL query cannot certify semantic coverage',async t=>{
 const f=fixture(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f,e=>{e.requirements.find(r=>r.requirementId==='r2').constraintShapeIris=['urn:demo:OtherConstraint'];e.cases.find(c=>c.id==='owner-negative').expectedViolationShapeIris=['urn:demo:OtherConstraint'];e.cases.find(c=>c.id==='sensitive-positive').query={format:'functional',content:'Ontology()',digest:hashBytes('Ontology()')};});
 const receipt=s.request(f.write('validation.start',{assetId:'services',modelDigest:p.modelDigest},'wrong-oracle',5),f.token),result=await terminal(s,f,receipt.result.taskId);
 assert.equal(result.formalStatus,'MISMATCH');const c=result.result.result.checks.find(c=>c.id==='owner-negative');assert.equal(c.actual,'NONCONFORMING');assert.equal(c.matched,false);
 const vacuous=result.result.result.checks.find(c=>c.id==='sensitive-positive');assert.equal(vacuous.actual,'ENTAILED');assert.equal(vacuous.result.result.vacuous,true);assert.equal(vacuous.matched,false);
});
test('changing only the independent expectations makes prior results stale and requires a model rebind',async t=>{
 const f=fixture(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),receipt=s.request(f.write('validation.start',{assetId:'services',modelDigest:p.modelDigest},'first',5),f.token);assert.equal((await terminal(s,f,receipt.result.taskId)).formalStatus,'MATCHED');
 const next=structuredClone(p.expectations);next.previousDigest=p.expectationsDigest;next.requirements[0].rationale='An explicitly revised source interpretation';s.request(f.write('expectations.record',{definition:next},'revised',6),f.token);
 assert.equal(s.request(f.read('validation.inspect',{taskId:receipt.result.taskId}),f.token).current,false);
 assert.throws(()=>s.request(f.write('validation.start',{assetId:'services',modelDigest:p.modelDigest},'stale',7),f.token),{code:'STALE_MODEL'});
});
test('missing fixed case coverage and inline expected overrides cannot queue validation',t=>{
 const f=fixture(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f,e=>{e.cases=e.cases.filter(c=>c.id!=='sensitive-negative');});
 const request=f.write('validation.start',{assetId:'services',modelDigest:p.modelDigest},'incomplete',5);assert.throws(()=>s.request(request,f.token),{code:'EXPECTATIONS_INCOMPLETE'});
 request.input.expectations={accept:true};assert.throws(()=>s.request(request,f.token),{code:'INVALID_INPUT'});assert.equal(s.request(f.read('project.inspect'),f.token).revision,5);
});
test('DL and validation share a single durable execution queue, cancellation and deadlines are incomplete',async t=>{
 const f=fixture(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f),input={assetId:'services',modelDigest:p.modelDigest},receipt=s.request(f.write('validation.start',input,'active',5),f.token);
 assert.throws(()=>s.request(f.write('reasoning.start',{...input,task:{kind:'consistency'}},'concurrent-dl',6),f.token),{code:'REASONER_BUSY'});
 await new Promise(r=>setImmediate(r));s.request(f.write('validation.cancel',{taskId:receipt.result.taskId},'cancel',6),f.token);const stopped=await terminal(s,f,receipt.result.taskId);assert.equal(stopped.formalStatus,'CANCELLED');assert.equal(stopped.complete,false);
 const timed=s.request(f.write('validation.start',{...input,timeoutMs:1},'timeout',7),f.token),timeout=await terminal(s,f,timed.result.taskId);assert.equal(timeout.formalStatus,'TIMEOUT');assert.equal(timeout.complete,false);
});
test('post-queue receipt failure never dispatches a suite, and an interrupted queued owner is never replayed',async t=>{
 const f=fixture(t);let s=createStandaloneService(configuration(f));const p=prepare(s,f);s.close();
 const db=new DatabaseSync(join(f.root,'ontology.sqlite'));db.exec("CREATE TRIGGER reject_validation BEFORE INSERT ON receipts WHEN NEW.request_id='fault' BEGIN SELECT RAISE(ABORT,'injected validation failure'); END");db.close();
 s=createStandaloneService(configuration(f));const input={assetId:'services',modelDigest:p.modelDigest};assert.throws(()=>s.request(f.write('validation.start',input,'fault',5),f.token),/injected validation failure/);await new Promise(r=>setImmediate(r));assert.equal(existsSync(join(f.workRoot,'operator.sqlite')),false);s.close();
 const url=new URL('../../dist/standalone/service.js',import.meta.url).href,code=`import {readFileSync} from 'node:fs';import {createStandaloneService} from ${JSON.stringify(url)};const v=JSON.parse(process.argv[1]);const s=createStandaloneService(v.setup);s.request(v.request,readFileSync(v.setup.credentialFile,'utf8'));process.exit(0);`;
 const request=f.write('validation.start',input,'queued-death',5),child=spawnSync(process.execPath,['--input-type=module','-e',code,JSON.stringify({setup:configuration(f),request})],{encoding:'utf8',timeout:10000});assert.equal(child.status,0,child.stderr);
 s=createStandaloneService(configuration(f));t.after(()=>s.close());const receipt=s.request(f.read('receipt.read',{requestId:'queued-death'}),f.token),interrupted=s.request(f.read('validation.inspect',{taskId:receipt.result.taskId}),f.token);assert.equal(interrupted.state,'INTERRUPTED');assert.equal(interrupted.complete,false);assert.deepEqual(s.request(request,f.token),receipt);assert.equal(existsSync(join(f.workRoot,'operator.sqlite')),false);
 assert.throws(()=>s.request(f.write('reasoning.start',{...input,task:{kind:'consistency'}},'new-task',6),f.token),{code:'REASONER_BUSY'});
});
test('actual HTTP admits the same immutable suite and returns its retained formal result',async t=>{
 const f=fixture(t),s=createStandaloneService(f.setup),p=prepare(s,f);s.close();const http=await listenStandalone(configuration(f));t.after(()=>http.close());
 const post=async value=>{const response=await fetch(http.origin+'/v1/request',{method:'POST',headers:{authorization:'Bearer '+f.token,'content-type':'application/json'},body:JSON.stringify(value)});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body.result;};
 const receipt=await post(f.write('validation.start',{assetId:'services',modelDigest:p.modelDigest},'http',5));let result;
 for(let i=0;i<1000;i++){result=await post(f.read('validation.inspect',{taskId:receipt.result.taskId}));if(result.state==='FINISHED')break;await new Promise(r=>setTimeout(r,25));}
 assert.equal(result.formalStatus,'MATCHED',JSON.stringify(result));assert.equal(result.complete,true);assert.deepEqual(await post(f.read('receipt.read',{requestId:'http'})),receipt);
});
test('official MCP client performs independent expectation authoring, model binding and actual validation',async t=>{
 const f=fixture(t),server=await listenStandalone(configuration(f)),client=new Client({name:'native-v2-validation-probe',version:'0.0.0'},{versionNegotiation:{mode:'auto'}});t.after(async()=>{await client.close();await server.close();});
 await client.connect(new StreamableHTTPClientTransport(new URL(server.origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+f.token}}}),{timeout:5000});
 const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args},{timeout:5000});assert.notEqual(r.isError,true,JSON.stringify(r));return r.structuredContent.result;};
 const context=await call('ontology_context');assert.equal(context.validationExecutionConfigured,true);assert.equal(context.acceptanceStatus,'EXTERNAL_EVIDENCE_REQUIRED');
 await call('ontology_write',f.write('project.create',{label:'MCP validation journey'},'create',0));
 const intent=await call('ontology_write',f.write('intent.record',{definition,previousDigest:null},'intent',1));
 const source=await call('ontology_write',f.write('source.admit',{intentDigest:intent.result.intentDigest,sourceSet},'sources',2));
 const e=expected(intent.result.intentDigest,source.result.sourceSetDigest),oracle=await call('ontology_write',f.write('expectations.record',{definition:e},'oracle',3));
 const draft=model(intent.result.intentDigest,source.result.sourceSetDigest,oracle.result.expectationsDigest),asset=await call('ontology_write',f.write('model.record',{draft},'model',4));
 const receipt=await call('ontology_write',f.write('validation.start',{assetId:'services',modelDigest:asset.result.modelDigest},'validate',5));let result;
 for(let i=0;i<1000;i++){result=await call('ontology_read',f.read('validation.inspect',{taskId:receipt.result.taskId}));if(result.state==='FINISHED')break;await new Promise(r=>setTimeout(r,25));}
 assert.equal(result.formalStatus,'MATCHED',JSON.stringify(result));assert.equal(result.complete,true);assert.equal(result.result.result.checks.length,6);
 assert.deepEqual(await call('ontology_read',f.read('receipt.read',{requestId:'validate'})),receipt);
});
