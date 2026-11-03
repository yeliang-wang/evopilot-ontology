import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,rmdirSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,isAbsolute,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createWorkerCgroup,inspectWorkerCgroup,killWorkerCgroup,WORKER_MEMORY_BYTES} from '../../../dist/installation/worker-cgroup.js';
import {readDLToolchain,verifyDLToolchain,javaClasspath} from '../../../dist/reasoning/toolchain.js';
import {DL_JVM_ARGUMENTS} from '../../../dist/reasoning/runner.js';
import {hash,hashBytes} from '../../../dist/standalone/validation.js';
import {closureDigest,validateDLRequest} from '../../../dist/reasoning/request.js';
import {privatePath} from '../../../dist/standalone/workspace.js';
import {request,query,sensitive,readonly,keyed} from '../../fixtures/v090/reasoning.mjs';

// Explicit Linux-only mechanism collector. It does not provision delegation,
// install products, certify an owner task, or mark any fixed acceptance variant.
const options=Object.fromEntries(process.argv.slice(2).map(v=>{
  const index=v.indexOf('=');assert.ok(index>2,'Use --root= --toolchain= --out=');return [v.slice(2,index),v.slice(index+1)];
}));
assert.deepEqual(Object.keys(options).sort(),['out','root','toolchain']);
assert.equal(process.platform,'linux');assert.equal(process.versions.node,'24.14.0');
assert.ok(isAbsolute(options.out));privatePath(dirname(options.out),true);
const binding=readDLToolchain(options.toolchain);verifyDLToolchain(binding);
const entry=fileURLToPath(new URL('../../fixtures/v090/cgroup-entry.mjs',import.meta.url));
const results=[];
function launch(identity,executable,args,input=''){
  const child=spawn(process.execPath,[entry,JSON.stringify(identity),executable,...args],{stdio:['pipe','pipe','pipe'],env:{NODE_NO_WARNINGS:'1',PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});
  const output=[],errors=[];let bytes=0,errorBytes=0,limitFailure=null;
  const stop=()=>{killWorkerCgroup(identity).catch(e=>{limitFailure??=e;});};
  const timer=setTimeout(()=>{limitFailure=Error('Probe deadline exceeded');stop();},35000);
  child.stdout.on('data',part=>{bytes+=part.length;if(bytes>4*1024*1024){limitFailure=Error('Probe output exceeded');stop();}else output.push(part);});
  child.stderr.on('data',part=>{errorBytes+=part.length;if(errorBytes>65536){limitFailure=Error('Probe diagnostics exceeded');stop();}else errors.push(part);});
  child.stdin.on('error',()=>{});child.stdin.end(input);
  const complete=new Promise((resolve,reject)=>{
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('close',(code,signal)=>{clearTimeout(timer);if(limitFailure)reject(limitFailure);else resolve({code,signal,stdout:Buffer.concat(output).toString(),stderr:Buffer.concat(errors).toString()});});
  });
  return {child,complete};
}
async function run(name,executable,args,input='',expected={code:0}){
  const identity=createWorkerCgroup(options.root),before=inspectWorkerCgroup(identity);
  try{
    const actual=await launch(identity,executable,args,input).complete;
    const after=inspectWorkerCgroup(identity);assert.equal(after.populated,false);
    for(const [field,value] of Object.entries(expected))assert.equal(actual[field],value,actual.stderr);
    if(expected.signal==='SIGKILL')assert.ok(after.memoryEvents.oom_kill>0&&after.memoryEvents.oom_group_kill>0);
    else assert.equal(after.memoryEvents.oom_kill,0);
    results.push({name,status:'PASS',before,after,exitCode:actual.code,signal:actual.signal,stdoutDigest:hashBytes(actual.stdout),stderrDigest:hashBytes(actual.stderr)});
    return actual;
  }finally{await killWorkerCgroup(identity);rmdirSync(identity.path);}
}
await run('normal-worker',process.execPath,['-e',"const x=Buffer.alloc(16*1024*1024,1);console.log('NORMAL',x.length)"]);
await run('python-memory-2GiB','/usr/bin/python3',['-B','-c','x=[]\nfor i in range(192): x.append(bytearray(16*1024*1024))\nprint("UNEXPECTED_ALLOCATION_SUCCESS")'],'',{code:null,signal:'SIGKILL'});
await run('java-direct-memory-2GiB',join(binding.javaRoot,'bin/java'),['-Xmx64m','-XX:MaxDirectMemorySize=3g','-XX:ActiveProcessorCount=1','-XX:+UseSerialGC','--source','21',fileURLToPath(new URL('../../fixtures/v090/NonHeapProbe.java',import.meta.url))],'',{code:null,signal:'SIGKILL'});

for(const [name,body,task,expected] of [
  ['sensitive-classification',sensitive,{kind:'entailment',query:query('ClassAssertion(:SensitiveService :api)')},'ENTAILED'],
  ['removed-premise',sensitive.replace('ObjectPropertyAssertion(:accesses :api :data)',''),{kind:'entailment',query:query('ClassAssertion(:SensitiveService :api)')},'NOT_ENTAILED'],
  ['key-identity',keyed,{kind:'entailment',query:query('SameIndividual(:a :b)')},'ENTAILED'],
  ['read-only-conflict',readonly,{kind:'consistency'},'INCONSISTENT'],
]){
  const r=request(body,task,name);validateDLRequest(r);
  const envelope={...r,schema:'ontology-dl-worker-request/v1',requestDigest:hash(r),closureDigest:closureDigest(r.closure),
    configurationDigest:hash({jvm:[...DL_JVM_ARGUMENTS],memoryMax:WORKER_MEMORY_BYTES,swapMax:0,timeoutMs:30000}),timeoutMs:30000};
  const actual=await run(name,join(binding.javaRoot,'bin/java'),[...DL_JVM_ARGUMENTS,'-cp',javaClasspath(binding),'io.evopilot.ontology.Worker'],JSON.stringify(envelope));
  const response=JSON.parse(actual.stdout);assert.equal(response.status,expected);assert.equal(response.complete,true);
  for(const key of ['requestId','requestDigest','closureDigest','configurationDigest'])assert.equal(response[key],envelope[key]);
  Object.assign(results.at(-1),{expected,response});
}

{
  const identity=createWorkerCgroup(options.root);
  try{
    const descendant="setInterval(()=>{},1000)";
    const code="const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',"+JSON.stringify(descendant)+"],{detached:true,stdio:'inherit'});c.once('spawn',()=>console.log('TREE_READY'));setInterval(()=>{},1000)";
    const execution=launch(identity,process.execPath,['-e',code]);
    let ready=false;
    const onData=chunk=>{if(chunk.includes(Buffer.from('TREE_READY')))ready=true;};execution.child.stdout.on('data',onData);
    const deadline=performance.now()+10000;
    while(!ready){assert.ok(performance.now()<deadline,'Fixture was not ready');await new Promise(resolve=>setTimeout(resolve,10));}
    const exited=once(execution.child,'exit');execution.child.kill('SIGKILL');await exited;
    const lost=inspectWorkerCgroup(identity);assert.equal(lost.populated,true);
    const after=await killWorkerCgroup(identity);assert.equal(after.populated,false);
    const actual=await execution.complete;assert.equal(actual.signal,'SIGKILL');
    results.push({name:'supervisor-loss-descendant-recovery',status:'PASS',lost,after});
  }finally{await killWorkerCgroup(identity);rmdirSync(identity.path);}
}

{
  const identity=createWorkerCgroup(options.root),names=[];
  try{
    for(const [name,changed] of [
      ['wrong-boot',{...identity,bootId:randomUUID()}],
      ['wrong-inode',{...identity,inode:String(BigInt(identity.inode)+1n)}],
      ['wrong-parent',{...identity,rootInode:String(BigInt(identity.rootInode)+1n)}],
      ['wrong-budget',{...identity,memoryMax:1}],
      ['foreign-path',{...identity,path:'/sys/fs/cgroup'}],
    ]){
      assert.throws(()=>inspectWorkerCgroup(changed),e=>e.code==='WORKER_ISOLATION_IDENTITY');
      await assert.rejects(killWorkerCgroup(changed),e=>e.code==='WORKER_ISOLATION_IDENTITY');names.push(name);
    }
    writeFileSync(join(identity.path,'memory.max'),'1073741824');
    assert.throws(()=>inspectWorkerCgroup(identity),e=>e.code==='WORKER_ISOLATION_DRIFT');names.push('changed-kernel-budget');
    writeFileSync(join(identity.path,'memory.max'),String(WORKER_MEMORY_BYTES));
  }finally{await killWorkerCgroup(identity);rmdirSync(identity.path);}
  assert.throws(()=>inspectWorkerCgroup(identity),e=>e.code==='ENOENT');
  await assert.rejects(killWorkerCgroup(identity),e=>e.code==='ENOENT');names.push('missing-group');
  mkdirSync(identity.path,{mode:0o700});
  try{assert.throws(()=>inspectWorkerCgroup(identity),e=>e.code==='WORKER_ISOLATION_IDENTITY');await assert.rejects(killWorkerCgroup(identity),e=>e.code==='WORKER_ISOLATION_IDENTITY');names.push('replaced-group');}
  finally{rmdirSync(identity.path);}
  results.push({name:'refuse-stale-foreign-or-drifted-identity',status:'PASS',variants:names});
}
verifyDLToolchain(binding);
const artifacts=['../../../dist/installation/worker-cgroup.js','../../fixtures/v090/cgroup-entry.mjs','../../fixtures/v090/NonHeapProbe.java','./worker-cgroup.mjs'].map(path=>({path,digest:hashBytes(readFileSync(new URL(path,import.meta.url)))}));
const report={schema:'ontology-worker-cgroup-probe/v1',node:process.versions.node,platform:process.platform,arch:process.arch,toolchainDigest:binding.digest,
  memoryMax:WORKER_MEMORY_BYTES,artifacts,results,acceptance:'NOT_EVALUATED',limitations:['Not wired into managed installation or owned-worker dispatch','No durable launch fence or owner task reconciliation','Not full OWL conformance or reference-corpus acceptance']};
writeFileSync(options.out,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({cases:results.length,pass:results.length,fail:0,skip:0,report:options.out}));
