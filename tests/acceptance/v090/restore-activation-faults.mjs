import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,openSync,closeSync,writeSync,unlinkSync,existsSync,lstatSync,readdirSync,statfsSync,mkdirSync,rmSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {prepare as prepareValidation,terminal} from '../../helpers/v090-validation.mjs';

// Only the explicitly owned tmpfs and newly created synthetic owners are changed.
// Runtime/toolchains are immutable installed inputs outside the fault volume.
const o=Object.fromEntries(process.argv.slice(2).map(v=>{const p=v.indexOf('=');assert.ok(p>2);return [v.slice(2,p),v.slice(p+1)];}));
assert.deepEqual(Object.keys(o).sort(),['dl','out','root','runtime','shacl']);for(const p of Object.values(o))assert.ok(isAbsolute(p));assert.equal(process.platform,'linux');assert.equal(process.versions.node,'24.14.0');
const pkg=join(o.runtime,'node_modules/@evopilot-next/ontology'),installed=p=>import(pathToFileURL(join(pkg,'dist',p)).href);
const {inspectRuntime}=await installed('installation/runtime.js'),runtime=inspectRuntime(o.runtime),{privatePath,openWorkspace}=await installed('standalone/workspace.js');
const {prepareInstallation,bindInstallationToolchains,startInstallation,stopInstallation}=await installed('installation/manager.js');
const {createStandaloneService}=await installed('standalone/service.js'),{readConnection,sendRequest}=await installed('standalone/client.js');
const {inspectInstallationBackup,backupInstallation}=await installed('installation/backup.js'),{backupInventory,backupNode}=await installed('installation/backup-files.js');
const {inspectRestoreStage,stageInstallationRestore}=await installed('installation/restore-stage.js');
const {inspectRestoreActivation,activateRestore,abortRestoreActivation}=await installed('installation/restore-activate.js');
const {inspectSystemdBinding}=await installed('installation/systemd-binding.js');
const {inspectInstallationWorkerMaintenance,maintainInstallationWorkers}=await installed('installation/worker-maintenance.js');
const {hash,hashBytes}=await installed('standalone/validation.js');
privatePath(o.root,true);assert.deepEqual(readdirSync(o.root),['fixture-owner.json']);const budget=128*1024*1024;
assert.deepEqual(JSON.parse(readFileSync(join(o.root,'fixture-owner.json'))),{schema:'ontology-restore-activation-fault-fixture/v1',root:o.root,maximumBytes:budget});const filesystem=statfsSync(o.root);assert.equal(filesystem.type,0x01021994);assert.ok(filesystem.bsize*filesystem.blocks<=budget);
const results=[],fillers=new Set(),cases=new Set();let failure=null;
const available=()=>statfsSync(o.root).bavail*statfsSync(o.root).bsize;
function fixture(name,mib=0){
  const root=join(o.root,name);mkdirSync(root,{mode:0o700});cases.add(root);
  const i=prepareInstallation({root:join(root,'installation'),workspaceRoot:join(root,'workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot:o.runtime,runtimeDigest:runtime.digest,mode:'create'}),token=readFileSync(i.credentialFile,'utf8');
  if(mib){const fd=openSync(join(i.workspaceRoot,'00-large'),'wx',0o600),block=Buffer.alloc(1024*1024,113);try{for(let n=0;n<mib;n++)writeSync(fd,block);}finally{closeSync(fd);}}
  const read=(operation,input={})=>({workspaceId:i.workspaceId,serviceId:i.serviceId,projectId:'demo',operation,input}),write=(operation,input,requestId,expectedRevision)=>({...read(operation,input),requestId,expectedRevision});
  return {root,i,setup:{...i,root:i.workspaceRoot},workRoot:join(i.root,'formal-work'),token,read,write,ordinal:0,bytes:mib*1024*1024};
}
function stage(f){const n=++f.ordinal,backupRoot=join(f.root,'backup-'+n),r=inspectInstallationBackup(f.i.root,backupRoot,'backup-'+n),b=backupInstallation(f.i.root,{backupRoot,requestId:'backup-'+n,expectedReportDigest:r.reportDigest});const input={backupRoot,expectedManifestDigest:b.receipt.manifestDigest,stageRoot:join(f.root,'stage-'+n),requestId:'stage-'+n},sr=inspectRestoreStage(input),done=stageInstallationRestore(input,sr.reportDigest);return {root:input.stageRoot,manifestDigest:done.receipt.manifestDigest};}
const selection=(f,snapshot,retained=snapshot)=>({installationRoot:f.i.root,snapshot,retained,recoveryRoot:join(f.root,'restore'),requestId:'restore'});
function clearCase(f){assert.ok(cases.has(f.root));privatePath(f.root,true);rmSync(f.root,{recursive:true});cases.delete(f.root);}
function fill(){const file=join(o.root,'owned-filler'),fd=openSync(file,'wx',0o600),block=Buffer.alloc(1024*1024);fillers.add(file);try{while(available()>0)writeSync(fd,block,0,Math.min(block.length,available()));}finally{closeSync(fd);}assert.equal(available(),0);return file;}
function releaseFiller(file){assert.ok(fillers.has(file));unlinkSync(file);fillers.delete(file);}
async function kill(v,report,observe){
  const module=pathToFileURL(join(pkg,'dist/installation/restore-activate.js')).href,script='const {activateRestore}=await import(process.argv[1]);activateRestore(JSON.parse(process.argv[2]),process.argv[3]);';
  const child=spawn(process.execPath,['--input-type=module','-e',script,module,JSON.stringify(v),report],{stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_NO_WARNINGS:'1'}});let ended=false,killed=false,output='';child.stdout.on('data',b=>{output+=b;if(output.length>65536)child.kill('SIGKILL');});child.stderr.resume();const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{ended=true;resolve({code,signal});});});
  try{const deadline=performance.now()+45000;while(!ended&&performance.now()<deadline){if(observe()){killed=child.kill('SIGKILL');break;}await delay(1);}if(!killed)child.kill('SIGKILL');const exit=await closed;assert.equal(killed,true,output);assert.equal(exit.signal,'SIGKILL');return exit;}finally{if(!ended){child.kill('SIGKILL');await closed;}}
}
try{
  {
    const f=fixture('full-abort',20),s=createStandaloneService(f.setup);s.request(f.write('project.create',{label:'Synthetic disk-full restore'},'create',0),f.token);await s.close();const snapshot=stage(f),v=selection(f,snapshot),r=inspectRestoreActivation(v),before=hash(backupInventory(f.i)),payload=join(v.recoveryRoot,'state/workspace/00-large');
    const exit=await kill(v,r.reportDigest,()=>existsSync(payload)&&lstatSync(payload).size>1024*1024&&lstatSync(payload).size<f.bytes),prefix=readFileSync(payload),filler=fill();let code;
    try{activateRestore(v,r.reportDigest);}catch(e){code=e.code;}assert.ok(['ENOSPC','STATE_LIMIT'].includes(code),String(code));assert.equal(available(),0);assert.equal(hash(backupInventory(f.i)),before);assert.throws(()=>openWorkspace(f.i.workspaceRoot,f.i),e=>e.code==='RESTORE_ACTIVATION_PENDING');
    const abort=abortRestoreActivation(v.recoveryRoot,v.requestId,r.reportDigest),after=available();assert.ok(after>0);assert.equal(hash(backupInventory(f.i)),before);assert.equal(hashBytes(readFileSync(payload).subarray(0,prefix.length)),hashBytes(prefix));const owner=createStandaloneService(f.setup);try{assert.equal(owner.context(f.token).recovery,undefined);}finally{await owner.close();}
    results.push({name:'actual-zero-free-space-refusal-and-abort-with-owned-reservation',status:'PASS',exit,code,partialBytes:prefix.length,freeBeforeAbort:0,freeAfterAbort:after,sourceUnchanged:true,partialCandidateRetained:true,receipt:abort.receipt});releaseFiller(filler);clearCase(f);
  }
  {
    const f=fixture('switch-resume',20),s=createStandaloneService(f.setup);s.request(f.write('project.create',{label:'Synthetic cutover recovery'},'create',0),f.token);await s.close();const snapshot=stage(f),v=selection(f,snapshot),r=inspectRestoreActivation(v),node=backupNode(f.i.workspaceRoot),database=hashBytes(readFileSync(join(f.i.workspaceRoot,'ontology.sqlite')));
    const exit=await kill(v,r.reportDigest,()=>existsSync(join(v.recoveryRoot,'old-moved.json'))&&!existsSync(join(v.recoveryRoot,'activated.json')));assert.throws(()=>abortRestoreActivation(v.recoveryRoot,v.requestId,r.reportDigest),e=>e.code==='RESTORE_SWITCH_ADMITTED');
    // Explicit removal of this fixture's staged source proves admitted switch
    // recovery uses retained prepared bytes, not a newly substituted snapshot.
    rmSync(snapshot.root,{recursive:true});const done=activateRestore(v,r.reportDigest);assert.equal(done.status,'ACTIVATED');assert.deepEqual(backupNode(done.receipt.previousWorkspaceRoot),node);assert.equal(hashBytes(readFileSync(join(done.receipt.previousWorkspaceRoot,'ontology.sqlite'))),database);
    const owner=createStandaloneService(f.setup);try{const prefix=owner.context(f.token).recovery.requestIdPrefix;assert.equal(prefix,done.receipt.requestIdPrefix);assert.throws(()=>owner.request(f.write('project.create',{label:'Missing old request'},'missing-before-restore',2),f.token),e=>e.code==='REQUEST_OUTCOME_UNKNOWN');}finally{await owner.close();}
    results.push({name:'actual-post-rename-sigkill-resume-with-source-stage-unavailable',status:'PASS',exit,previousWorkspacePreserved:true,unknownOldOutcomeRefused:true,receipt:done.receipt});clearCase(f);
  }
  {
    const f=fixture('formal'),dl={toolchainFile:o.dl,toolchainDigest:JSON.parse(readFileSync(o.dl)).digest},shacl={toolchainFile:o.shacl,toolchainDigest:JSON.parse(readFileSync(o.shacl)).digest},systemd=inspectSystemdBinding();bindInstallationToolchains(f.i.root,{requestId:'tools',previousBindingDigest:null,dl,shacl,systemd});
    const configuration={reasoning:{toolchainFile:o.dl,workRoot:f.workRoot,systemd},validation:{toolchainFile:o.shacl,workRoot:f.workRoot,systemd}};let s=createStandaloneService({...f.setup,...configuration});const model=prepareValidation(s,f),request=f.write('validation.start',{assetId:'services',modelDigest:model.modelDigest},'validate',5),first=s.request(request,f.token),task=await terminal(s,f,first.result.taskId);assert.equal(task.formalStatus,'MATCHED');await s.close();const snapshot=stage(f),v=selection(f,snapshot),r=inspectRestoreActivation(v),workers=hash(backupInventory(f.i,['installation'])),done=activateRestore(v,r.reportDigest);assert.equal(hash(backupInventory(f.i,['installation'])),workers);
    let freshTask;
    await startInstallation(f.i.root);
    try{
      const c=readConnection(join(f.i.root,'connection.json'));assert.deepEqual(await sendRequest(c,request,true),first);assert.deepEqual(await sendRequest(c,f.read('validation.inspect',{taskId:first.result.taskId}),false),task);const project=await sendRequest(c,f.read('project.inspect'),false),next=await sendRequest(c,f.write('validation.start',{assetId:'services',modelDigest:model.modelDigest},done.receipt.requestIdPrefix+'fresh-validation',project.revision),true);freshTask=next.result.taskId;let result;
      for(let n=0;n<1600;n++){result=await sendRequest(c,f.read('validation.inspect',{taskId:freshTask}),false);if(result.state==='FINISHED')break;await delay(25);}assert.equal(result.formalStatus,'MATCHED');
    }finally{await stopInstallation(f.i.root);}
    for(const [n,taskId] of [first.result.taskId,freshTask].entries()){const observed=await inspectInstallationWorkerMaintenance(f.i.root,'demo',taskId);await maintainInstallationWorkers(f.i.root,{projectId:'demo',taskId,requestId:'maintenance-'+n,expectedReportDigest:observed.reportDigest});}
    results.push({name:'actual-installed-activation-start-new-java-python-systemd-work-and-maintenance',status:'PASS',originalRequestReceiptPreserved:true,originalWorkerStoragePreserved:true,newFormalTaskMatched:true,systemdDigest:systemd.digest,receipt:done.receipt});clearCase(f);
  }
  assert.equal(inspectRuntime(o.runtime).digest,runtime.digest);
}catch(e){failure={code:e.code??null,name:e.name,message:e.message,stack:e.stack};}finally{for(const file of [...fillers])releaseFiller(file);}
const artifacts=['installation/restore-activate.js','installation/restore-state.js','installation/backup.js','installation/backup-files.js','installation/restore-stage.js','installation/manager.js','standalone/recovery.js','standalone/workspace.js','standalone/cli.js','native-v2/task-recovery.js'].map(path=>({path:'dist/'+path,digest:hashBytes(readFileSync(join(pkg,'dist',path)))}));
writeFileSync(o.out,JSON.stringify({schema:'ontology-restore-activation-fault-probe/v1',runtime,fixture:{root:o.root,filesystem:'tmpfs',maximumBytes:budget,caseDirectoriesRemaining:[...cases]},artifacts,collectorDigest:hashBytes(readFileSync(new URL(import.meta.url))),results,failure,acceptance:'NOT_EVALUATED',limitations:['Synthetic private owners on a separately owned fault filesystem','Retained-current activation only; missing-owner activation and copied worker lineage remain required','Installed service journeys do not establish actual Codex Host acceptance or all version criteria']},null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({cases:results.length,pass:results.length,fail:failure?1:0,report:o.out,failure}));if(failure)process.exitCode=1;
