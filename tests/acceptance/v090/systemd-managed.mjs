import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,isAbsolute,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {inspectRuntime} from '../../../dist/installation/runtime.js';
import {privatePath} from '../../../dist/standalone/workspace.js';
import {hash,hashBytes} from '../../../dist/standalone/validation.js';
import {definition,sourceSet,expected,model} from '../../helpers/v090-validation.mjs';

// Actual installed-package/MCP/engine integration in an explicitly selected
// private Linux environment. Synthetic business inputs; not actual Codex Host
// acceptance or complete standards conformance. No production/daily changes.
const options=Object.fromEntries(process.argv.slice(2).map(v=>{const p=v.indexOf('=');assert.ok(p>2);return [v.slice(2,p),v.slice(p+1)];}));
assert.deepEqual(Object.keys(options).sort(),['dl','out','root','runtime','shacl']);
assert.equal(process.platform,'linux');assert.equal(process.versions.node,'24.14.0');
for(const value of Object.values(options))assert.ok(isAbsolute(value));
privatePath(dirname(options.root),true);privatePath(dirname(options.out),true);mkdirSync(options.root,{mode:0o700});
const runtime=inspectRuntime(options.runtime),cli=join(runtime.packageRoot,'dist/standalone/cli.js');
// Recovery must use the exact installed runtime that launched the unit. A
// second compiled checkout has a different supervisor executable path.
const installed=path=>import(pathToFileURL(join(runtime.packageRoot,'dist',path)).href);
const {processPresent}=await installed('installation/control.js');
const {prepareInstallation,startInstallation,stopInstallation,bindInstallationToolchains}=await installed('installation/manager.js');
const {inspectInstallationTaskRecovery,reconcileInstallationTask}=await installed('installation/task-recovery.js');
const {inspectSystemdBinding,ownerProcess,ownerPresent,systemdCall}=await installed('installation/systemd-binding.js');
const {taskWorkerReferences,readWorkerAttempt,workerUnitName}=await installed('installation/worker-journal.js');
const {reconcileSystemdWorker}=await installed('installation/systemd-worker.js');
const binding=inspectSystemdBinding();
const tools={dl:{toolchainFile:options.dl,toolchainDigest:JSON.parse(readFileSync(options.dl)).digest},shacl:{toolchainFile:options.shacl,toolchainDigest:JSON.parse(readFileSync(options.shacl)).digest}};
const results=[],fixtures=[],references=new Map();let failure=null;
const command=args=>new Promise((resolve,reject)=>execFile(process.execPath,[cli,...args],{timeout:30000,maxBuffer:2*1024*1024,env:{...process.env,NODE_NO_WARNINGS:'1'}},(e,out,err)=>e?reject(Object.assign(Error('Installed operator failed'),{code:e.code,output:out,diagnostic:err})):resolve(JSON.parse(out).result)));
async function until(check,ms=45000){const end=performance.now()+ms;for(;;){const value=await check();if(value)return value;assert.ok(performance.now()<end,'Required installed state was not observed');await delay(20);}}
const unitCall=(r,method,signature,tail=[])=>systemdCall(binding,'/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager',method,signature,[workerUnitName(r),...tail]);
function retain(f,taskId){const found=taskWorkerReferences(f.workRoot,taskId);for(const r of found)references.set(r.attemptId,r);return found;}
async function fixture(name){
  const setup=prepareInstallation({root:join(options.root,name+'-installation'),workspaceRoot:join(options.root,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot:options.runtime,runtimeDigest:runtime.digest,mode:'create'});
  const f={name,setup,workRoot:join(setup.root,'formal-work'),clients:[],tasks:[],runs:[]};fixtures.push(f);
  f.input={requestId:'bind',previousBindingDigest:null,...tools,systemd:binding};
  const bindArgs=['toolchains-bind','--installation',setup.root,'--request-id','bind','--previous-binding','none','--dl-toolchain',options.dl,'--dl-digest',tools.dl.toolchainDigest,'--shacl-toolchain',options.shacl,'--shacl-digest',tools.shacl.toolchainDigest,'--systemd-digest'];
  await assert.rejects(command([...bindArgs,hash('wrong-systemd-selection'),'--json']),e=>JSON.parse(e.output).error.code==='WORKER_ISOLATION_DRIFT');
  assert.equal(existsSync(join(setup.root,'toolchain-bindings.json')),false);
  f.bound=await command([...bindArgs,binding.digest,'--json']);
  assert.equal(f.bound.receipt.binding.schema,'ontology-managed-toolchain-binding/v2');assert.equal(f.bound.receipt.binding.systemd.digest,binding.digest);
  f.start=async()=>{const r=await startInstallation(setup.root);f.runs.push(r.run);assert.equal(r.run.toolchainBindingDigest,f.bound.receipt.digest);return r.run;};
  f.call=async(client,name,args={})=>{const r=await client.callTool({name,arguments:args},{timeout:15000});assert.notEqual(r.isError,true,JSON.stringify(r));return r.structuredContent.result;};
  f.connect=async()=>{const config=JSON.parse(readFileSync(join(setup.root,'plugin/.mcp.json'))).mcpServers['evopilot-ontology'];const client=new Client({name:'isolated-installed-probe',version:'1'});f.clients.push(client);await client.connect(new StdioClientTransport({...config,cwd:options.root,stderr:'pipe'}),{timeout:10000});return client;};
  f.request=(operation,input={})=>({workspaceId:setup.workspaceId,serviceId:setup.serviceId,projectId:'demo',operation,input});
  f.finished=(client,operation,taskId)=>until(async()=>{const r=await f.call(client,'ontology_read',f.request(operation,{taskId}));return r.state==='FINISHED'&&r;});
  return f;
}
async function seed(f,client){
  let revision=0;
  const write=async(operation,input,requestId)=>{const request={...f.request(operation,input),requestId,expectedRevision:revision},receipt=await f.call(client,'ontology_write',request);revision=receipt.revision;if(receipt.result.taskId)f.tasks.push(receipt.result.taskId);return {request,receipt};};
  await write('project.create',{label:'Synthetic isolated formal workflow'},'project');
  const intentDigest=(await write('intent.record',{definition,previousDigest:null},'intent')).receipt.result.intentDigest;
  const sourceSetDigest=(await write('source.admit',{intentDigest,sourceSet},'sources')).receipt.result.sourceSetDigest;
  const expectationsDigest=(await write('expectations.record',{definition:expected(intentDigest,sourceSetDigest)},'expectations')).receipt.result.expectationsDigest;
  const modelDigest=(await write('model.record',{draft:model(intentDigest,sourceSetDigest,expectationsDigest)},'model')).receipt.result.modelDigest;
  return {write,modelDigest};
}
function signalFixtureOwner(birth,signal){assert.equal(ownerPresent(birth),true);process.kill(birth.pid,signal);}
try{
  const inspected=await command(['worker-isolation-inspect','--json']);assert.equal(inspected.digest,binding.digest);
  {
    const f=await fixture('normal'),first=await f.start(),client=await f.connect(),p=await seed(f,client);
    const v=await p.write('validation.start',{assetId:'services',modelDigest:p.modelDigest},'validate');const taskId=v.receipt.result.taskId,result=await f.finished(client,'validation.inspect',taskId);
    assert.equal(result.formalStatus,'MATCHED');assert.equal(result.complete,true);
    const refs=retain(f,taskId);assert.equal(refs.length,6);
    for(const r of refs){const a=readWorkerAttempt(r);assert.equal(a.intent.schema,'ontology-owned-worker/v2');assert.equal(a.intent.systemd.binding.digest,binding.digest);assert.equal(a.outcome.state,'EXITED');assert.equal(a.outcome.exitCode,0);assert.equal(a.terminal.empty,true);}
    assert.deepEqual(bindInstallationToolchains(f.setup.root,f.input).receipt,f.bound.receipt);
    assert.throws(()=>bindInstallationToolchains(f.setup.root,{...f.input,systemd:undefined}),e=>['REQUEST_CONFLICT','INVALID_INPUT'].includes(e.code));
    await stopInstallation(f.setup.root);const second=await f.start();assert.notEqual(first.runId,second.runId);
    assert.deepEqual(await f.call(client,'ontology_write',v.request),v.receipt);assert.equal(retain(f,taskId).length,refs.length);
    assert.equal((await f.finished(client,'validation.inspect',taskId)).resultDigest,result.resultDigest);
    results.push({name:'installed-mcp-validation-and-restart',status:'PASS',bindingReceipt:f.bound.receipt,taskId,result,attempts:refs.map(readWorkerAttempt)});
  }
  for(const kind of ['dl','shacl']){
    const f=await fixture('lost-'+kind),run=await f.start(),birth=ownerProcess(run.pid),client=await f.connect(),p=await seed(f,client);
    const original=await p.write(kind==='dl'?'reasoning.start':'validation.start',{assetId:'services',modelDigest:p.modelDigest,...(kind==='dl'?{task:{kind:'consistency'}}:{})},'original');const taskId=original.receipt.result.taskId;
    const a=await until(()=>{for(const ref of retain(f,taskId)){const x=readWorkerAttempt(ref);if(x.worker&&!x.outcome&&(kind==='dl'?x.intent.executable.endsWith('/bin/java'):x.intent.executable.includes('/bin/python')))return x;}return null;});
    assert.throws(()=>inspectInstallationTaskRecovery(f.setup.root,'demo',taskId),e=>e.code==='INSTALLATION_RUNNING');
    // Faults target this fixture's exact current owner birth and unit invocation.
    // Product recovery never signals a retained PID.
    unitCall(a.reference,'KillUnit','ssi',['main','19']);signalFixtureOwner(birth,'SIGKILL');await until(()=>!ownerPresent(birth));unitCall(a.reference,'KillUnit','ssi',['main','9']);
    // A dead/zombie owner can still await reaping by this test process. Honor
    // the installed operator's conservative liveness check before inspection.
    await until(()=>processPresent(birth.pid)===false);
    const before=await until(()=>{const value=inspectInstallationTaskRecovery(f.setup.root,'demo',taskId);f.lastRecoveryInspection=value;return value.report.ready&&value;});
    assert.equal(before.report.schema,'ontology-task-recovery-report/v2');assert.equal(before.report.formalResultRecovered,false);
    // Actual worker-journal reconciliation commits before the business owner,
    // simulating the resumable boundary without editing any retained records.
    assert.equal(reconcileSystemdWorker(a.reference),true);
    const after=inspectInstallationTaskRecovery(f.setup.root,'demo',taskId);assert.equal(after.reportDigest,before.reportDigest);
    assert.equal(readWorkerAttempt(a.reference).outcome.state,'GROUP_TERMINATED');
    const input={projectId:'demo',taskId,requestId:'recover',expectedReportDigest:before.reportDigest};
    const recovered=await command(['task-reconcile','--installation',f.setup.root,'--project','demo','--task',taskId,'--request-id','recover','--expected-report',before.reportDigest,'--json']);assert.equal(recovered.replayed,false);
    assert.deepEqual(reconcileInstallationTask(f.setup.root,input).receipt,recovered.receipt);
    assert.throws(()=>reconcileInstallationTask(f.setup.root,{...input,expectedReportDigest:hash('changed')}),e=>e.code==='REQUEST_CONFLICT');
    await f.start();const result=await f.finished(client,kind==='dl'?'reasoning.inspect':'validation.inspect',taskId);assert.equal(result.formalStatus,'FAILED');assert.equal(result.complete,false);assert.equal(result.result.error.code,'OWNER_INTERRUPTED');
    const count=retain(f,taskId).length;assert.deepEqual(await f.call(client,'ontology_write',original.request),original.receipt);assert.equal(retain(f,taskId).length,count);
    const next=await p.write('reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task:{kind:'consistency'}},'explicit-new-task');assert.equal((await f.finished(client,'reasoning.inspect',next.receipt.result.taskId)).formalStatus,'COMPLETED');retain(f,next.receipt.result.taskId);
    results.push({name:'installed-'+kind+'-supervisor-loss-recovery',status:'PASS',taskId,report:before,recovery:recovered,originalReceiptDigest:hash(original.receipt),originalAttempt:readWorkerAttempt(a.reference),result});
  }
  assert.equal(inspectRuntime(options.runtime).digest,runtime.digest);
}catch(e){failure={code:e.code??null,name:e.name,message:e.message,stack:e.stack,output:e.output??null,diagnostic:e.diagnostic??null};}
finally{
  for(const f of fixtures){for(const c of f.clients)try{await c.close();}catch{}try{await stopInstallation(f.setup.root);}catch(e){failure??={code:e.code??null,message:'Fixture owner cleanup failed'};}for(const id of f.tasks)try{retain(f,id);}catch{}}
  for(const r of references.values()){try{unitCall(r,'StopUnit','ss',['replace']);}catch{}try{unitCall(r,'ResetFailedUnit','s');}catch{}}
}
const artifacts=['../../../dist/installation/toolchains.js','../../../dist/installation/systemd-binding.js','../../../dist/installation/systemd-worker.js','../../../dist/reasoning/runner.js','../../../dist/native-v2/shacl-toolchain.js','../../../dist/native-v2/shacl-runner.js','../../../dist/native-v2/validation-runner.js','../../../dist/native-v2/tasks.js','../../../dist/native-v2/task-recovery.js','../../../dist/standalone/cli.js','./systemd-managed.mjs'].map(path=>({path,digest:hashBytes(readFileSync(new URL(path,import.meta.url)))}));
writeFileSync(options.out,JSON.stringify({schema:'ontology-systemd-managed-probe/v1',binding,runtime,tools,artifacts,results,failure,recoveryObservations:fixtures.filter(f=>f.lastRecoveryInspection).map(f=>({fixture:f.name,...f.lastRecoveryInspection})),acceptance:'NOT_EVALUATED',limitations:['Synthetic installed-package and MCP evidence; not an actual Codex Host session','No published distribution/provisioning, complete conformance or selected asset reset']},null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({cases:results.length,pass:results.length,fail:failure?1:0,skip:0,report:options.out,failure}));if(failure)process.exitCode=1;
