import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,openSync,closeSync,writeSync,unlinkSync,existsSync,lstatSync,readdirSync,statfsSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

// Explicit isolated 128 MiB Linux tmpfs fault fixture. Mount provisioning is
// external test infrastructure, never product behavior or a restore shortcut.
const o=Object.fromEntries(process.argv.slice(2).map(v=>{const p=v.indexOf('=');assert.ok(p>2);return [v.slice(2,p),v.slice(p+1)];}));
assert.deepEqual(Object.keys(o).sort(),['out','root','runtime']);for(const path of Object.values(o))assert.ok(isAbsolute(path));
assert.equal(process.platform,'linux');assert.equal(process.versions.node,'24.14.0');
const pkg=join(o.runtime,'node_modules/@evopilot-next/ontology'),installed=p=>import(pathToFileURL(join(pkg,'dist',p)).href);
const {inspectRuntime}=await installed('installation/runtime.js'),runtime=inspectRuntime(o.runtime),cli=join(pkg,'dist/standalone/cli.js');
const {privatePath,openWorkspace}=await installed('standalone/workspace.js');
const {prepareInstallation}=await installed('installation/manager.js');
const {inspectInstallationBackup,backupInstallation,abortInstallationBackup}=await installed('installation/backup.js');
const {backupInventory,verifyBackup}=await installed('installation/backup-files.js');
const {hash,hashBytes}=await installed('standalone/validation.js');
privatePath(o.root,true);assert.deepEqual(readdirSync(o.root),['fixture-owner.json']);
const owner=JSON.parse(readFileSync(join(o.root,'fixture-owner.json'))),budget=128*1024*1024;
assert.deepEqual(owner,{schema:'ontology-backup-fault-fixture/v1',root:o.root,maximumBytes:budget});
const filesystem=statfsSync(o.root);assert.equal(filesystem.type,0x01021994);assert.ok(filesystem.bsize*filesystem.blocks<=budget);
const results=[],fillers=new Set();let failure=null;
const sourceIdentity=i=>hash(backupInventory(i));
const available=()=>statfsSync(o.root).bavail*statfsSync(o.root).bsize;
function fixture(name,mib=6){
  const i=prepareInstallation({root:join(o.root,name+'-installation'),workspaceRoot:join(o.root,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot:o.runtime,runtimeDigest:runtime.digest,mode:'create'});
  const file=join(i.root,'00-large'),fd=openSync(file,'wx',0o600),block=Buffer.alloc(1024*1024,113);try{for(let n=0;n<mib;n++)writeSync(fd,block);}finally{closeSync(fd);}
  const backupRoot=join(o.root,name+'-backup'),report=inspectInstallationBackup(i.root,backupRoot,'backup'),request={backupRoot,requestId:'backup',expectedReportDigest:report.reportDigest},e=report.report.entries.find(e=>e.path==='00-large');
  return {i,backupRoot,report,request,object:join(backupRoot,'objects',e.digest.slice(7)),source:sourceIdentity(i),bytes:mib*1024*1024,reserve:join(i.root,'backup-requests/backup.reserve')};
}
function fill(name,leave){
  const file=join(o.root,name+'-filler'),fd=openSync(file,'wx',0o600),block=Buffer.alloc(1024*1024);fillers.add(file);let bytes=0,code=null;
  try{
    for(;;){const free=available();if(leave&&free<=leave)break;const n=leave?Math.min(block.length,free-leave):block.length;
      try{bytes+=writeSync(fd,block,0,n);}catch(e){if(e.code!=='ENOSPC')throw e;code=e.code;break;}
      assert.ok(bytes<=budget+block.length,'Fixture filler exceeded filesystem budget');
    }
  }finally{closeSync(fd);}
  if(!leave){assert.equal(code,'ENOSPC');assert.equal(available(),0);}return {file,bytes,code,free:available()};
}
function release(file){assert.ok(fillers.has(file));unlinkSync(file);fillers.delete(file);}
function copyUntilFull(f){
  const filler=fill(f.i.workspaceId,2*1024*1024);let code=null;
  try{backupInstallation(f.i.root,f.request);}catch(e){code=e.code;}
  assert.equal(code,'ENOSPC');assert.equal(available(),0);assert.equal(inspectInstallationBackup(f.i.root,f.backupRoot,'backup').status,'PENDING');
  assert.ok(lstatSync(f.reserve).blocks*512>=128*1024);const bytes=lstatSync(f.object).size;assert.ok(bytes>0&&bytes<f.bytes);
  assert.throws(()=>openWorkspace(f.i.workspaceRoot,f.i),e=>e.code==='BACKUP_PENDING');
  return {filler,code,partialBytes:bytes,partialDigest:hashBytes(readFileSync(f.object))};
}
async function killAfterManifest(f){
  const child=spawn(process.execPath,[cli,'backup-apply','--installation',f.i.root,'--backup',f.backupRoot,'--request-id','backup','--expected-report',f.report.reportDigest,'--json'],{stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_NO_WARNINGS:'1'}});let ended=false,killed=false,output='';
  child.stdout.on('data',b=>{output+=b;if(output.length>65536)child.kill('SIGKILL');});child.stderr.resume();
  const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{ended=true;resolve({code,signal});});});
  try{
    const deadline=performance.now()+30000;
    while(!ended&&performance.now()<deadline){if(existsSync(join(f.backupRoot,'manifest.json'))){killed=child.kill('SIGKILL');break;}await delay(1);}
    if(!killed)child.kill('SIGKILL');const exit=await closed;assert.equal(killed,true,output);assert.equal(exit.signal,'SIGKILL');
    assert.equal(inspectInstallationBackup(f.i.root,f.backupRoot,'backup').status,'PENDING');assert.ok(existsSync(f.reserve));
    return {exit,manifestDigest:JSON.parse(readFileSync(join(f.backupRoot,'manifest.json'))).manifestDigest};
  }finally{if(!ended){child.kill('SIGKILL');await closed;}}
}
try{
  {
    const f=fixture('full-abort'),fault=copyUntilFull(f),aborted=abortInstallationBackup(f.i.root,'backup',f.report.reportDigest);
    assert.equal(aborted.receipt.partialCopyRetained,true);assert.equal(hashBytes(readFileSync(f.object)),fault.partialDigest);assert.equal(existsSync(f.reserve),false);assert.equal(sourceIdentity(f.i),f.source);
    const store=openWorkspace(f.i.workspaceRoot,f.i);store.close();assert.deepEqual(abortInstallationBackup(f.i.root,'backup',f.report.reportDigest).receipt,aborted.receipt);
    results.push({name:'actual-enospc-abort-without-external-space-release',status:'PASS',code:fault.code,partialBytes:fault.partialBytes,partialDigest:fault.partialDigest,availableAfterAbort:available(),receipt:aborted.receipt,sourceUnchanged:true});release(fault.filler.file);
  }
  {
    const f=fixture('full-resume'),fault=copyUntilFull(f);release(fault.filler.file);const completed=backupInstallation(f.i.root,f.request);
    assert.equal(completed.verification,'VERIFIED');assert.equal(hashBytes(readFileSync(f.object).subarray(0,fault.partialBytes)),fault.partialDigest);assert.equal(sourceIdentity(f.i),f.source);assert.equal(existsSync(f.reserve),false);
    assert.equal(verifyBackup(f.backupRoot,completed.receipt.manifestDigest).manifestDigest,completed.receipt.manifestDigest);
    results.push({name:'actual-enospc-resume-original-request-after-explicit-space-release',status:'PASS',code:fault.code,partialBytes:fault.partialBytes,receipt:completed.receipt,sourceUnchanged:true});
  }
  {
    const f=fixture('completion',32),fault=await killAfterManifest(f),fd=openSync(f.object,'r+');try{writeSync(fd,Buffer.from([0]),0,1,lstatSync(f.object).size-1);}finally{closeSync(fd);}
    const corrupted=hashBytes(readFileSync(f.object)),filler=fill('completion',0),completed=backupInstallation(f.i.root,f.request);
    assert.equal(completed.completionReconciled,true);assert.equal(completed.verification,'NOT_RUN');assert.equal(completed.receipt.manifestDigest,fault.manifestDigest);assert.equal(existsSync(f.reserve),false);
    assert.equal(hashBytes(readFileSync(f.object)),corrupted);assert.equal(sourceIdentity(f.i),f.source);assert.throws(()=>verifyBackup(f.backupRoot,fault.manifestDigest),e=>e.code==='BACKUP_EVIDENCE');
    const store=openWorkspace(f.i.workspaceRoot,f.i);store.close();assert.deepEqual(backupInstallation(f.i.root,f.request).receipt,completed.receipt);
    results.push({name:'actual-post-manifest-sigkill-corruption-and-enospc-completion',status:'PASS',interruption:fault,availableBeforeCompletion:filler.free,availableAfterCompletion:available(),currentPayloadHealth:'BACKUP_EVIDENCE',corruptedPayloadPreserved:true,sourceUnchanged:true,receipt:completed.receipt});release(filler.file);
  }
  assert.equal(inspectRuntime(o.runtime).digest,runtime.digest);
}catch(e){failure={code:e.code??null,name:e.name,message:e.message,stack:e.stack};}
finally{for(const file of [...fillers])release(file);}
const artifacts=['installation/files.js','installation/backup.js','installation/backup-control.js','installation/backup-contract.js','installation/backup-files.js','standalone/workspace.js','standalone/cli.js'].map(path=>({path:'dist/'+path,digest:hashBytes(readFileSync(join(pkg,'dist',path)))}));
writeFileSync(o.out,JSON.stringify({schema:'ontology-backup-fault-probe/v1',runtime,fixture:{root:o.root,filesystem:'tmpfs',maximumBytes:budget},artifacts,collectorDigest:hashBytes(readFileSync(new URL(import.meta.url))),results,failure,acceptance:'NOT_EVALUATED',limitations:['Synthetic private owner data; not an actual Codex Host journey','Restore/upgrade and full fixed maintenance acceptance remain required','Reservation cannot prevent unrelated processes from consuming released filesystem space']},null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({cases:results.length,pass:results.length,fail:failure?1:0,report:o.out,failure}));if(failure)process.exitCode=1;
