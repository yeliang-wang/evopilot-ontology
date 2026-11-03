import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {listenStandalone} from '../../dist/standalone/http.js';
import {fixture,prepare,draft,ttl,query} from '../helpers/v090-native.mjs';
const binding=process.env.EVOPILOT_TEST_DL_TOOLCHAIN;
test.before(()=>assert(binding,'An actual installed DL toolchain is required; no skip/mocked reasoning'));
const configuration=f=>({toolchainFile:binding,workRoot:f.workRoot});
async function terminal(s,f,taskId){
 const end=Date.now()+20000;while(Date.now()<end){const r=s.request(f.read('reasoning.inspect',{taskId}),f.token);if(r.state==='FINISHED')return r;await new Promise(r=>setTimeout(r,25));}throw new Error('Actual task did not finish');
}
test('actual entailment is durable, exact replay does not rerun it, and premise removal invalidates old conclusions',async t=>{
 const f=fixture(t);let s=createStandaloneService({...f.setup,reasoning:configuration(f)});t.after(()=>s.close());const p=prepare(s,f);
 const request=f.write('reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task:{kind:'entailment',query}},'reason',4),receipt=s.request(request,f.token),taskId=receipt.result.taskId;
 const result=await terminal(s,f,taskId);assert.equal(result.formalStatus,'ENTAILED');assert.equal(result.complete,true);assert.equal(result.current,true);assert.equal(result.result.requestId,taskId);assert.equal(result.result.closureDigest,result.closureDigest);
 const events=result.events.length;s.close();s=createStandaloneService({...f.setup,reasoning:configuration(f)});
 assert.deepEqual(s.request(request,f.token),receipt);assert.equal(s.request(f.read('reasoning.inspect',{taskId}),f.token).events.length,events);
 const changed=draft(p.intentDigest,p.sourceSetDigest,ttl.replace(' ; :accesses :data',''),p.modelDigest);
 const next=s.request(f.write('model.record',{draft:changed},'remove-premise',5),f.token);assert.equal(s.request(f.read('reasoning.inspect',{taskId}),f.token).current,false);
 assert.throws(()=>s.request(f.write('reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task:{kind:'consistency'}},'stale',6),f.token),{code:'STALE_MODEL'});
 const second=s.request(f.write('reasoning.start',{assetId:'services',modelDigest:next.result.modelDigest,task:{kind:'entailment',query}},'reason-next',6),f.token);
 assert.equal((await terminal(s,f,second.result.taskId)).formalStatus,'NOT_ENTAILED');
 let text='',offset=0;do{const page=s.request(f.read('reasoning.result.read',{taskId,offset,maxBytes:64}),f.token);text+=page.content;offset=page.nextOffset;}while(offset!==null);assert.deepEqual(JSON.parse(text),result.result);
});
test('queued/active requests are single-worker, cancellation requires observed exit and timeout is incomplete',async t=>{
 const f=fixture(t),s=createStandaloneService({...f.setup,reasoning:configuration(f)});t.after(()=>s.close());const p=prepare(s,f);
 const input={assetId:'services',modelDigest:p.modelDigest,task:{kind:'consistency'}},first=s.request(f.write('reasoning.start',input,'first',4),f.token);
 assert.throws(()=>s.request(f.write('reasoning.start',input,'concurrent',5),f.token),{code:'REASONER_BUSY'});
 await new Promise(r=>setImmediate(r));const cancelled=s.request(f.write('reasoning.cancel',{taskId:first.result.taskId},'cancel',5),f.token);assert.equal(cancelled.result.state,'CANCEL_REQUESTED');
 const stopped=await terminal(s,f,first.result.taskId);assert.equal(stopped.formalStatus,'CANCELLED');assert.equal(stopped.complete,false);
 const timed=s.request(f.write('reasoning.start',{...input,timeoutMs:1},'timeout',6),f.token);const result=await terminal(s,f,timed.result.taskId);assert.equal(result.formalStatus,'TIMEOUT');assert.equal(result.complete,false);
});
test('missing configuration and post-queue receipt failure never dispatch a formal task',async t=>{
 const f=fixture(t);let s=createStandaloneService(f.setup);const p=prepare(s,f);
 const request=f.write('reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task:{kind:'consistency'}},'fault',4);
 assert.throws(()=>s.request(request,f.token),{code:'TOOLCHAIN_NOT_READY'});s.close();
 const db=new DatabaseSync(join(f.root,'ontology.sqlite'));db.exec("CREATE TRIGGER fail_task_receipt BEFORE INSERT ON receipts WHEN NEW.request_id='fault' BEGIN SELECT RAISE(ABORT,'injected failure'); END");db.close();
 s=createStandaloneService({...f.setup,reasoning:configuration(f)});t.after(()=>s.close());assert.throws(()=>s.request(request,f.token),/injected failure/);await new Promise(r=>setImmediate(r));
 assert.equal(s.request(f.read('project.inspect'),f.token).revision,4);assert.equal(existsSync(join(f.workRoot,'operator.sqlite')),false);
 s.close();const check=new DatabaseSync(join(f.root,'ontology.sqlite'));try{assert.equal(check.prepare('SELECT count(*) AS n FROM native_reasoning_tasks').get().n,0);}finally{check.close();}
});
test('actual owner death after queued receipt retains interruption and blocks implicit redispatch',async t=>{
 const f=fixture(t);const s=createStandaloneService(f.setup),p=prepare(s,f);s.close();
 const url=new URL('../../dist/standalone/service.js',import.meta.url).href;
 const code=`import {readFileSync} from 'node:fs';import {createStandaloneService} from ${JSON.stringify(url)};const o=JSON.parse(process.argv[1]);const s=createStandaloneService(o.setup);s.request(o.request,readFileSync(o.setup.credentialFile,'utf8'));process.exit(0);`;
 const setup={...f.setup,reasoning:configuration(f)},request=f.write('reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task:{kind:'consistency'}},'queued-death',4);
 const child=spawnSync(process.execPath,['--input-type=module','-e',code,JSON.stringify({setup,request})],{encoding:'utf8',timeout:10000});assert.equal(child.status,0,child.stderr);
 const restarted=createStandaloneService(setup);t.after(()=>restarted.close());const receipt=restarted.request(f.read('receipt.read',{requestId:'queued-death'}),f.token);
 const task=restarted.request(f.read('reasoning.inspect',{taskId:receipt.result.taskId}),f.token);assert.equal(task.state,'INTERRUPTED');assert.equal(task.complete,false);assert.equal(task.result,null);
 assert.deepEqual(restarted.request(request,f.token),receipt);assert.equal(existsSync(join(f.workRoot,'operator.sqlite')),false);
 assert.throws(()=>restarted.request(f.write('reasoning.start',request.input,'replacement',5),f.token),{code:'REASONER_BUSY'});
});
test('actual HTTP exposes asynchronous task receipts and the same fixed formal result',async t=>{
 const f=fixture(t),s=createStandaloneService(f.setup),p=prepare(s,f);s.close();const http=await listenStandalone({...f.setup,reasoning:configuration(f)});t.after(()=>http.close());
 const post=async request=>{const r=await fetch(http.origin+'/v1/request',{method:'POST',headers:{authorization:'Bearer '+f.token,'content-type':'application/json'},body:JSON.stringify(request)});const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body.result;};
 const receipt=await post(f.write('reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task:{kind:'entailment',query}},'http-reason',4));let result;
 for(let i=0;i<400;i++){result=await post(f.read('reasoning.inspect',{taskId:receipt.result.taskId}));if(result.state==='FINISHED')break;await new Promise(r=>setTimeout(r,25));}
 assert.equal(result.formalStatus,'ENTAILED');assert.equal(result.complete,true);assert.deepEqual(await post(f.read('receipt.read',{requestId:'http-reason'})),receipt);
});
