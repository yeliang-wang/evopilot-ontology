import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {inspectSystemdBinding,systemdCall} from '../../../dist/installation/systemd-binding.js';
import {runOwnedWorker} from '../../../dist/installation/worker-process.js';
import {readWorkerAttempt,workerUnitName,fenceSystemdWorker,createWorkerAttempt} from '../../../dist/installation/worker-journal.js';
import {reconcileSystemdWorker} from '../../../dist/installation/systemd-worker.js';
import {readDLToolchain,verifyDLToolchain,javaClasspath} from '../../../dist/reasoning/toolchain.js';
import {DL_JVM_ARGUMENTS} from '../../../dist/reasoning/runner.js';
import {hash,hashBytes} from '../../../dist/standalone/validation.js';
import {closureDigest,validateDLRequest} from '../../../dist/reasoning/request.js';
import {privatePath} from '../../../dist/standalone/workspace.js';
import {request,query,sensitive,readonly,keyed} from '../../fixtures/v090/reasoning.mjs';

// Explicit Linux mechanism collector. Test-owned processes and units only.
// This is not managed-installation/Host acceptance or OWL conformance proof.
const entry=fileURLToPath(import.meta.url),manager='/org/freedesktop/systemd1',iface='org.freedesktop.systemd1.Manager';
const options=Object.fromEntries(process.argv.slice(2).map(v=>{const p=v.indexOf('=');assert.ok(p>2);return [v.slice(2,p),v.slice(p+1)];}));
const save=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n',{mode:0o600,flag:'wx'});
const idle="const{spawn}=require('node:child_process');spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'inherit'});setInterval(()=>{},1000)";
const binding=inspectSystemdBinding();
function args(root,name,code=idle,timeoutMs=15000){
  return {workRoot:root,requestId:name,requestDigest:hash(name),configurationDigest:hash({binding:binding.digest,timeoutMs}),toolchainDigest:hash('synthetic-node-probe'),
    executable:process.execPath,args:['-e',code],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',NODE_NO_WARNINGS:'1'},input:'synthetic',timeoutMs,outputBytes:1024,diagnosticBytes:4096,systemd:binding};
}
async function until(fn,ms=20000){const deadline=performance.now()+ms;for(;;){const r=await fn();if(r)return r;assert.ok(performance.now()<deadline,'Probe did not reach its required state');await delay(25);}}
if(options.owner){
  const settings=JSON.parse(readFileSync(options.owner,'utf8'));
  try{const r=await runOwnedWorker({...args(settings.root,settings.name,idle,settings.timeoutMs),beforeDispatch:ref=>save(join(settings.root,'reference.json'),ref)});save(join(settings.root,'owner-result.json'),r.outcome);}
  catch(e){save(join(settings.root,'owner-error.json'),{code:e.code??null,message:e.message});process.exitCode=1;}
}else{
  assert.deepEqual(Object.keys(options).sort(),['out','root','toolchain']);
  assert.equal(process.platform,'linux');assert.equal(process.versions.node,'24.14.0');
  assert.ok(isAbsolute(options.root)&&isAbsolute(options.out));privatePath(dirname(options.root),true);privatePath(dirname(options.out),true);mkdirSync(options.root,{mode:0o700});
  const dl=readDLToolchain(options.toolchain);verifyDLToolchain(dl);
  const results=[],references=[],owners=[];let failure=null;
  const unitCall=(r,method,signature,tail=[])=>systemdCall(binding,manager,iface,method,signature,[workerUnitName(r),...tail]);
  const retained=r=>{const a=readWorkerAttempt(r);assert.ok(a.outcome);assert.ok(a.terminal?.empty);assert.equal(a.terminal.mainPid,0);return a;};
  async function direct(name,extra={},inspect=()=>{},action){
    const root=join(options.root,name);mkdirSync(root,{mode:0o700});let ref;
    const execution=runOwnedWorker({...args(root,name,"process.stdout.write('normal')"),...extra,beforeDispatch:r=>{ref=r;references.push(r);save(join(root,'reference.json'),r);if(name==='delayed-launch-fence')fenceSystemdWorker(r,'DISPATCH_REJECTED');}});
    // Preserve rejection while the fault injector waits for dispatch evidence.
    const settled=execution.then(value=>({value}),error=>({error}));
    if(action)await action(()=>ref,root);
    const done=await settled;if(done.error)throw done.error;
    const a=readWorkerAttempt(ref);await inspect(done.value,a,root);
    results.push({name,status:'PASS',attempt:a});console.log(JSON.stringify({name,status:'PASS'}));return a;
  }
  async function orphan(name,timeoutMs,inject,inspect){
    const root=join(options.root,name);mkdirSync(root,{mode:0o700});const config=join(root,'owner.json');save(config,{root,name,timeoutMs});
    const child=spawn(process.execPath,[entry,'--owner='+config],{stdio:['ignore','ignore','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',NODE_NO_WARNINGS:'1'}});owners.push(child);
    const done=once(child,'close');child.stderr.resume();
    const ref=await until(()=>existsSync(join(root,'reference.json'))&&JSON.parse(readFileSync(join(root,'reference.json'),'utf8')));references.push(ref);
    await until(()=>readWorkerAttempt(ref).worker);
    assert.throws(()=>createWorkerAttempt(root,readWorkerAttempt(ref).intent),e=>e.code==='WORKER_RECOVERY_REQUIRED');
    await inject(ref,child);await done;
    await until(()=>reconcileSystemdWorker(ref),timeoutMs+10000);
    const a=retained(ref);inspect(a);results.push({name,status:'PASS',attempt:a});console.log(JSON.stringify({name,status:'PASS'}));return ref;
  }
  try{
    await direct('normal',{},(r,a)=>{assert.equal(r.stdout.toString(),'normal');assert.equal(r.outcome.exitCode,0);assert.equal(r.outcome.reason,null);retained(a.reference);});
    await direct('python-memory-2GiB',{executable:'/usr/bin/python3',args:['-B','-c','x=[]\nfor i in range(192): x.append(bytearray(16*1024*1024))'],timeoutMs:30000},(r,a)=>{assert.equal(r.outcome.state,'GROUP_TERMINATED');assert.equal(r.outcome.reason,'MEMORY_LIMIT');assert.equal(a.terminal.result,'oom-kill');assert.equal(r.outcome.exitCode,null);});
    await direct('java-direct-memory-2GiB',{executable:join(dl.javaRoot,'bin/java'),args:['-Xmx64m','-XX:MaxDirectMemorySize=3g','-XX:ActiveProcessorCount=1','-XX:+UseSerialGC','--source','21',fileURLToPath(new URL('../../fixtures/v090/NonHeapProbe.java',import.meta.url))],timeoutMs:30000},(r,a)=>{assert.equal(r.outcome.reason,'MEMORY_LIMIT');assert.equal(a.terminal.result,'oom-kill');});
    for(const [name,body,task,expected] of [
      ['sensitive-classification',sensitive,{kind:'entailment',query:query('ClassAssertion(:SensitiveService :api)')},'ENTAILED'],
      ['removed-premise',sensitive.replace('ObjectPropertyAssertion(:accesses :api :data)',''),{kind:'entailment',query:query('ClassAssertion(:SensitiveService :api)')},'NOT_ENTAILED'],
      ['key-identity',keyed,{kind:'entailment',query:query('SameIndividual(:a :b)')},'ENTAILED'],
      ['read-only-conflict',readonly,{kind:'consistency'},'INCONSISTENT'],
    ]){
      const req=request(body,task,name);validateDLRequest(req);
      const envelope={...req,schema:'ontology-dl-worker-request/v1',requestDigest:hash(req),closureDigest:closureDigest(req.closure),configurationDigest:hash({binding:binding.digest,jvm:[...DL_JVM_ARGUMENTS]}),timeoutMs:30000};
      await direct(name,{requestDigest:envelope.requestDigest,configurationDigest:envelope.configurationDigest,toolchainDigest:dl.digest,executable:join(dl.javaRoot,'bin/java'),args:[...DL_JVM_ARGUMENTS,'-cp',javaClasspath(dl),'io.evopilot.ontology.Worker'],input:JSON.stringify(envelope),timeoutMs:30000,outputBytes:4*1024*1024,diagnosticBytes:65536},(r,a)=>{
        assert.equal(r.outcome.exitCode,0);assert.equal(r.outcome.reason,null);retained(a.reference);const response=JSON.parse(r.stdout);assert.equal(response.status,expected);assert.equal(response.complete,true);
        for(const k of ['requestId','requestDigest','closureDigest','configurationDigest'])assert.equal(response[k],envelope[k]);
      });
    }
    await direct('output-limit',{args:['-e',"process.stdout.write('x'.repeat(65536));setInterval(()=>{},1000)"]},(r,a)=>{assert.equal(r.outcome.reason,'OUTPUT_LIMIT');assert.equal(r.outcome.stdoutBytes,r.stdout.length);assert.ok(r.stdout.length<=1024);retained(a.reference);});
    await direct('diagnostic-limit',{args:['-e',"process.stderr.write('x'.repeat(65536));setInterval(()=>{},1000)"]},(r,a)=>{assert.equal(r.outcome.reason,'DIAGNOSTIC_LIMIT');assert.equal(r.outcome.stderrBytes,r.stderr.length);assert.ok(r.stderr.length<=4096);retained(a.reference);});
    const controller=new AbortController();
    await direct('cancellation',{args:['-e',idle],signal:controller.signal},(r,a)=>{assert.equal(r.outcome.reason,'CANCELLED');retained(a.reference);},async get=>{await until(()=>get()&&readWorkerAttempt(get()).worker);controller.abort();});
    await direct('delayed-launch-fence',{args:['-e',"require('node:fs').writeFileSync('UNEXPECTED_ENGINE_START','bad')"]},async(r,a,root)=>{assert.equal(r.outcome.state,'NOT_STARTED');assert.equal(r.outcome.reason,'DISPATCH_REJECTED');assert.equal(a.worker,null);await delay(1000);assert.equal(existsSync(join(root,'UNEXPECTED_ENGINE_START')),false);assert.equal(readWorkerAttempt(a.reference).unit,null);});
    await orphan('owner-loss',10000,async(r,child)=>{child.kill('SIGKILL');},a=>{assert.equal(a.outcome.state,'GROUP_TERMINATED');assert.equal(a.outcome.reason,'OWNER_LOST');assert.equal(a.outcome.signal,null);});
    await orphan('supervisor-loss',10000,async(r,child)=>{unitCall(r,'KillUnit','ssi',['main','9']);child.kill('SIGKILL');},a=>{assert.equal(a.outcome.state,'GROUP_TERMINATED');assert.equal(a.outcome.reason,'SUPERVISOR_LOST');assert.equal(a.outcome.exitCode,null);assert.equal(a.outcome.signal,null);});
    await orphan('manager-deadline-after-observer-loss',2500,async(r,child)=>{unitCall(r,'KillUnit','ssi',['main','19']);child.kill('SIGKILL');},a=>{assert.equal(a.outcome.state,'GROUP_TERMINATED');assert.equal(a.outcome.reason,'TASK_DEADLINE');assert.equal(a.terminal.result,'timeout');assert.equal(a.outcome.exitCode,null);});
    const previous=references[0],before=readWorkerAttempt(previous);
    // Committed evidence remains replayable after manager garbage collection.
    unitCall(previous,'StopUnit','ss',['replace']);await delay(100);
    assert.equal(reconcileSystemdWorker(previous),true);
    assert.equal(readWorkerAttempt(previous).terminalDigest,before.terminalDigest);
    results.push({name:'terminal-replay-after-unit-removal',status:'PASS'});
    {
      const root=join(options.root,'missing-unit-without-proof');mkdirSync(root,{mode:0o700});const config=join(root,'owner.json');save(config,{root,name:'missing-unit-without-proof',timeoutMs:10000});
      const child=spawn(process.execPath,[entry,'--owner='+config],{stdio:'ignore',env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',NODE_NO_WARNINGS:'1'}});owners.push(child);const done=once(child,'close');
      const ref=await until(()=>existsSync(join(root,'reference.json'))&&JSON.parse(readFileSync(join(root,'reference.json'),'utf8')));references.push(ref);await until(()=>readWorkerAttempt(ref).worker);
      child.kill('SIGKILL');await done;unitCall(ref,'StopUnit','ss',['replace']);await delay(200);try{unitCall(ref,'ResetFailedUnit','s');}catch{}await delay(200);
      const original=readWorkerAttempt(ref);assert.equal(original.terminal,null);
      assert.throws(()=>reconcileSystemdWorker(ref),e=>['WORKER_MANAGER_UNAVAILABLE','WORKER_UNIT_CHANGED'].includes(e.code));
      assert.throws(()=>createWorkerAttempt(root,original.intent),e=>e.code==='WORKER_RECOVERY_REQUIRED');
      assert.equal(readWorkerAttempt(ref).terminal,null);results.push({name:'missing-unit-without-proof-retains-barrier',status:'PASS',attempt:readWorkerAttempt(ref)});
    }
    verifyDLToolchain(dl);
  }catch(e){failure={name:e.name,code:e.code??null,message:e.message,stack:e.stack};}
  finally{
    for(const child of owners)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
    for(const r of references){try{unitCall(r,'StopUnit','ss',['replace']);}catch{}try{unitCall(r,'ResetFailedUnit','s');}catch{}}
  }
  const artifacts=['../../../dist/installation/systemd-binding.js','../../../dist/installation/systemd-worker.js','../../../dist/installation/worker-process.js','../../../dist/installation/worker-supervisor.js','../../../dist/installation/worker-journal.js','./systemd-worker.mjs'].map(path=>({path,digest:hashBytes(readFileSync(new URL(path,import.meta.url)))}));
  save(options.out,{schema:'ontology-systemd-worker-probe/v1',binding,toolchainDigest:dl.digest,node:process.versions.node,platform:process.platform,arch:process.arch,artifacts,results,failure,acceptance:'NOT_EVALUATED',limitations:['Internal dispatcher selection only; not wired into managed installation or owner-task reconciliation','No complete OWL conformance or actual Host acceptance','No product maintenance/provisioning path yet']});
  console.log(JSON.stringify({cases:results.length,pass:results.length,fail:failure?1:0,skip:0,report:options.out,failure}));if(failure)process.exitCode=1;
}
