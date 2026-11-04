import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,openSync,closeSync,writeSync,unlinkSync,existsSync,lstatSync,readdirSync,statfsSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

// Explicit isolated Linux tmpfs, <=128 MiB. Provisioning/filling this fixture is
// external test infrastructure; installed product commands only stage recovery.
const o=Object.fromEntries(process.argv.slice(2).map(v=>{const p=v.indexOf('=');assert.ok(p>2);return [v.slice(2,p),v.slice(p+1)];}));
assert.deepEqual(Object.keys(o).sort(),['out','root','runtime']);for(const p of Object.values(o))assert.ok(isAbsolute(p));
assert.equal(process.platform,'linux');assert.equal(process.versions.node,'24.14.0');
const pkg=join(o.runtime,'node_modules/@evopilot-next/ontology'),installed=p=>import(pathToFileURL(join(pkg,'dist',p)).href);
const {inspectRuntime}=await installed('installation/runtime.js'),runtime=inspectRuntime(o.runtime),cli=join(pkg,'dist/standalone/cli.js');
const {privatePath,openWorkspace}=await installed('standalone/workspace.js');
const {prepareInstallation}=await installed('installation/manager.js');
const {inspectInstallationBackup,backupInstallation}=await installed('installation/backup.js');
const {backupInventory,verifyBackup}=await installed('installation/backup-files.js');
const {inspectRestoreStage,stageInstallationRestore,verifyRestoreStage}=await installed('installation/restore-stage.js');
const {hash,hashBytes}=await installed('standalone/validation.js');
privatePath(o.root,true);assert.deepEqual(readdirSync(o.root),['fixture-owner.json']);const budget=128*1024*1024;
assert.deepEqual(JSON.parse(readFileSync(join(o.root,'fixture-owner.json'))),{schema:'ontology-restore-stage-fault-fixture/v1',root:o.root,maximumBytes:budget});
const filesystem=statfsSync(o.root);assert.equal(filesystem.type,0x01021994);assert.ok(filesystem.bsize*filesystem.blocks<=budget);
const results=[],fillers=new Set();let failure=null;
const available=()=>statfsSync(o.root).bavail*statfsSync(o.root).bsize;
function fixture(name,mib=6){
  const i=prepareInstallation({root:join(o.root,name+'-installation'),workspaceRoot:join(o.root,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot:o.runtime,runtimeDigest:runtime.digest,mode:'create'});
  const fd=openSync(join(i.root,'00-large'),'wx',0o600),block=Buffer.alloc(1024*1024,113);try{for(let n=0;n<mib;n++)writeSync(fd,block);}finally{closeSync(fd);}
  const backupRoot=join(o.root,name+'-backup'),report=inspectInstallationBackup(i.root,backupRoot,'backup'),b=backupInstallation(i.root,{backupRoot,requestId:'backup',expectedReportDigest:report.reportDigest});
  const input={backupRoot,expectedManifestDigest:b.receipt.manifestDigest,stageRoot:join(o.root,name+'-stage'),requestId:'restore'},inspected=inspectRestoreStage(input);
  return {i,input,report:inspected.report,reportDigest:inspected.reportDigest,source:hash(backupInventory(i)),file:join(input.stageRoot,'installation/00-large'),bytes:mib*1024*1024};
}
function fill(name,leave){
  const file=join(o.root,name+'-filler'),fd=openSync(file,'wx',0o600),block=Buffer.alloc(1024*1024);fillers.add(file);let bytes=0,code=null;
  try{for(;;){const free=available();if(leave&&free<=leave)break;const n=leave?Math.min(block.length,free-leave):block.length;try{bytes+=writeSync(fd,block,0,n);}catch(e){if(e.code!=='ENOSPC')throw e;code=e.code;break;}assert.ok(bytes<=budget+block.length);}}
  finally{closeSync(fd);}if(!leave){assert.equal(code,'ENOSPC');assert.equal(available(),0);}return {file,free:available()};
}
function release(file){assert.ok(fillers.has(file));unlinkSync(file);fillers.delete(file);}
function unchanged(f){assert.equal(hash(backupInventory(f.i)),f.source);verifyBackup(f.input.backupRoot,f.input.expectedManifestDigest);}
function full(f){
  const filler=fill(f.i.workspaceId,2*1024*1024);assert.throws(()=>stageInstallationRestore(f.input,f.reportDigest),e=>e.code==='ENOSPC');
  const partial=readFileSync(f.file);assert.ok(partial.length>0&&partial.length<f.bytes);assert.equal(inspectRestoreStage(f.input).status,'PENDING');assert.throws(()=>openWorkspace(join(f.input.stageRoot,'workspace'),f.i),e=>e.code==='RESTORE_STAGED');
  return {filler,bytes:partial.length,digest:hashBytes(partial)};
}
async function killDuringCopy(f){
  const a=['restore-stage-apply','--backup',f.input.backupRoot,'--expected-manifest',f.input.expectedManifestDigest,'--stage-root',f.input.stageRoot,'--request-id',f.input.requestId,'--expected-report',f.reportDigest,'--json'];
  const child=spawn(process.execPath,[cli,...a],{stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_NO_WARNINGS:'1'}});let ended=false,killed=false,output='';
  child.stdout.on('data',b=>{output+=b;if(output.length>65536)child.kill('SIGKILL');});child.stderr.resume();
  const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{ended=true;resolve({code,signal});});});
  try{
    const deadline=performance.now()+30000;while(!ended&&performance.now()<deadline){if(existsSync(f.file)){const size=lstatSync(f.file).size;if(size>1024*1024&&size<f.bytes){killed=child.kill('SIGKILL');break;}}await delay(1);}
    if(!killed)child.kill('SIGKILL');const exit=await closed;assert.equal(killed,true,output);assert.equal(exit.signal,'SIGKILL');const bytes=readFileSync(f.file);assert.ok(bytes.length>0&&bytes.length<f.bytes);return {exit,bytes:bytes.length,digest:hashBytes(bytes)};
  }finally{if(!ended){child.kill('SIGKILL');await closed;}}
}
try{
  {
    const f=fixture('resume'),fault=full(f),zero=fill('zero',0);
    assert.throws(()=>stageInstallationRestore(f.input,f.reportDigest),e=>e.code==='ENOSPC');assert.equal(hashBytes(readFileSync(f.file)),fault.digest);assert.equal(available(),0);
    // The same original owner remains usable at true zero free space. Its
    // initialized leases must not require a replacement state or barrier reset.
    const owner=openWorkspace(f.i.workspaceRoot,f.i);owner.close();unchanged(f);
    release(zero.file);release(fault.filler.file);const done=stageInstallationRestore(f.input,f.reportDigest);assert.equal(hashBytes(readFileSync(f.file).subarray(0,fault.bytes)),fault.digest);assert.equal(verifyRestoreStage(f.input.stageRoot,done.receipt.manifestDigest).status,'VERIFIED');unchanged(f);
    results.push({name:'actual-enospc-and-zero-free-retry-then-exact-resume',status:'PASS',partialBytes:fault.bytes,zeroFreeBytes:zero.free,sourceUnchanged:true,receipt:done.receipt});
  }
  {
    const f=fixture('corruption'),fault=full(f);release(fault.filler.file);
    const e=f.report.backup.manifest.plan.entries.find(e=>e.path==='credentials.json'),object=join(f.input.backupRoot,'objects',e.digest.slice(7)),raw=readFileSync(object),bad=Buffer.from(raw);bad[bad.length-1]^=1;writeFileSync(object,bad);
    assert.throws(()=>stageInstallationRestore(f.input,f.reportDigest),e=>e.code==='BACKUP_EVIDENCE');assert.equal(hashBytes(readFileSync(f.file)),fault.digest);assert.equal(hashBytes(readFileSync(object)),hashBytes(bad));assert.equal(hash(backupInventory(f.i)),f.source);
    writeFileSync(object,raw);const done=stageInstallationRestore(f.input,f.reportDigest);assert.equal(verifyRestoreStage(f.input.stageRoot,done.receipt.manifestDigest).status,'VERIFIED');unchanged(f);
    results.push({name:'post-enospc-corrupt-backup-refuses-resume-and-preserves-prefix',status:'PASS',partialBytes:fault.bytes,sourceOwnerUnchanged:true,corruptCopyPreserved:true,receipt:done.receipt});
  }
  {
    const f=fixture('killed',20),fault=await killDuringCopy(f);assert.equal(inspectRestoreStage(f.input).status,'PENDING');assert.throws(()=>openWorkspace(join(f.input.stageRoot,'workspace'),f.i),e=>e.code==='RESTORE_STAGED');
    const done=stageInstallationRestore(f.input,f.reportDigest);assert.equal(hashBytes(readFileSync(f.file).subarray(0,fault.bytes)),fault.digest);assert.equal(verifyRestoreStage(f.input.stageRoot,done.receipt.manifestDigest).status,'VERIFIED');unchanged(f);
    results.push({name:'actual-installed-cli-sigkill-and-guarded-resume',status:'PASS',interruption:fault,sourceUnchanged:true,receipt:done.receipt});
  }
  assert.equal(inspectRuntime(o.runtime).digest,runtime.digest);
}catch(e){failure={code:e.code??null,name:e.name,message:e.message,stack:e.stack};}
finally{for(const file of [...fillers])release(file);}
const artifacts=['installation/files.js','installation/restore-stage.js','installation/restore-files.js','installation/backup-files.js','installation/backup-contract.js','standalone/workspace.js','standalone/cli.js'].map(path=>({path:'dist/'+path,digest:hashBytes(readFileSync(join(pkg,'dist',path)))}));
writeFileSync(o.out,JSON.stringify({schema:'ontology-restore-stage-fault-probe/v1',runtime,fixture:{root:o.root,filesystem:'tmpfs',maximumBytes:budget},artifacts,collectorDigest:hashBytes(readFileSync(new URL(import.meta.url))),results,failure,acceptance:'NOT_EVALUATED',limitations:['Synthetic private owner data; not an actual Codex Host journey','Candidate staging only; no activation, credential rollback or request redispatch','Full restore/upgrade and fixed MAINT-01 acceptance remain required']},null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({cases:results.length,pass:results.length,fail:failure?1:0,report:o.out,failure}));if(failure)process.exitCode=1;
