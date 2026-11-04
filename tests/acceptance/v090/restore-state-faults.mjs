import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,openSync,closeSync,writeSync,unlinkSync,existsSync,lstatSync,readdirSync,statfsSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

// The mount and filler are explicitly owned test infrastructure. No production
// volume, business owner, package installation or activation is modified.
const o=Object.fromEntries(process.argv.slice(2).map(v=>{const p=v.indexOf('=');assert.ok(p>2);return [v.slice(2,p),v.slice(p+1)];}));
assert.deepEqual(Object.keys(o).sort(),['out','root','runtime']);for(const p of Object.values(o))assert.ok(isAbsolute(p));assert.equal(process.platform,'linux');assert.equal(process.versions.node,'24.14.0');
const pkg=join(o.runtime,'node_modules/@evopilot-next/ontology'),installed=p=>import(pathToFileURL(join(pkg,'dist',p)).href);
const {inspectRuntime}=await installed('installation/runtime.js'),runtime=inspectRuntime(o.runtime);
const {privatePath,openWorkspace}=await installed('standalone/workspace.js');
const {prepareInstallation}=await installed('installation/manager.js');
const {createStandaloneService}=await installed('standalone/service.js');
const {inspectInstallationBackup,backupInstallation}=await installed('installation/backup.js');
const {backupInventory}=await installed('installation/backup-files.js');
const {inspectRestoreStage,stageInstallationRestore}=await installed('installation/restore-stage.js');
const {inspectRestoreState,prepareRestoreState,verifyPreparedRestoreState,newRestoreGeneration}=await installed('installation/restore-state.js');
const {hash,hashBytes}=await installed('standalone/validation.js');
privatePath(o.root,true);assert.deepEqual(readdirSync(o.root),['fixture-owner.json']);const budget=128*1024*1024;
assert.deepEqual(JSON.parse(readFileSync(join(o.root,'fixture-owner.json'))),{schema:'ontology-restore-state-fault-fixture/v1',root:o.root,maximumBytes:budget});const filesystem=statfsSync(o.root);assert.equal(filesystem.type,0x01021994);assert.ok(filesystem.bsize*filesystem.blocks<=budget);
const results=[],fillers=new Set();let failure=null;
const available=()=>statfsSync(o.root).bavail*statfsSync(o.root).bsize;
async function fixture(name,records,mib=0){
  const i=prepareInstallation({root:join(o.root,name+'-installation'),workspaceRoot:join(o.root,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot:o.runtime,runtimeDigest:runtime.digest,mode:'create'}),service=createStandaloneService({...i,root:i.workspaceRoot}),token=readFileSync(i.credentialFile,'utf8');
  const call=(operation,input,requestId,expectedRevision)=>service.request({workspaceId:i.workspaceId,serviceId:i.serviceId,projectId:'demo',operation,input,requestId,expectedRevision},token);
  call('project.create',{label:'Synthetic recovery transaction'},'create',0);let previous=null;
  for(let n=0;n<records;n++){const definition={purpose:'Private recovery fixture '+n+' '+('x'.repeat(3000)),mode:'forward',scope:'Synthetic owner only',exclusions:['Live data'],sources:[{id:'source',locator:'urn:test:private-recovery',revision:'one',digest:hashBytes('Independent synthetic requirement'),origin:'requirement'}],requirements:[{id:'requirement',statement:'Preserve original evidence'}]};previous=call('intent.record',{definition,previousDigest:previous},'intent-'+n,n+1).result.intentDigest;}await service.close();
  if(mib){const fd=openSync(join(i.workspaceRoot,'00-large'),'wx',0o600),block=Buffer.alloc(1024*1024,113);try{for(let n=0;n<mib;n++)writeSync(fd,block);}finally{closeSync(fd);}}
  const backupRoot=join(o.root,name+'-backup'),r=inspectInstallationBackup(i.root,backupRoot,'backup'),b=backupInstallation(i.root,{backupRoot,requestId:'backup',expectedReportDigest:r.reportDigest});
  const s={backupRoot,expectedManifestDigest:b.receipt.manifestDigest,stageRoot:join(o.root,name+'-stage'),requestId:'stage'},sr=inspectRestoreStage(s),stage=stageInstallationRestore(s,sr.reportDigest),snapshot={root:s.stageRoot,manifestDigest:stage.receipt.manifestDigest};
  const input={snapshot,retained:null,root:join(o.root,name+'-prepared'),requestId:'prepare',generation:newRestoreGeneration(),rekeyExpiresAt:new Date(Date.now()+86400000).toISOString()},report=inspectRestoreState(input);
  return {i,input,reportDigest:report.reportDigest,source:hash(backupInventory(i)),workspace:join(input.root,'workspace'),bytes:mib*1024*1024};
}
function fill(name,leave){const file=join(o.root,name+'-filler'),fd=openSync(file,'wx',0o600),block=Buffer.alloc(1024*1024);fillers.add(file);let bytes=0;try{for(;;){const free=available();if(free<=leave)break;bytes+=writeSync(fd,block,0,Math.min(block.length,free-leave));assert.ok(bytes<=budget);}}finally{closeSync(fd);}assert.equal(available(),leave);return file;}
function release(file){assert.ok(fillers.has(file));unlinkSync(file);fillers.delete(file);}
async function killed(f){
  const module=pathToFileURL(join(pkg,'dist/installation/restore-state.js')).href,script='const {prepareRestoreState}=await import(process.argv[1]);prepareRestoreState(JSON.parse(process.argv[2]),process.argv[3]);';
  const child=spawn(process.execPath,['--input-type=module','-e',script,module,JSON.stringify(f.input),f.reportDigest],{stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_NO_WARNINGS:'1'}});let ended=false,killed=false,output='';child.stdout.on('data',b=>{output+=b;if(output.length>65536)child.kill('SIGKILL');});child.stderr.resume();const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{ended=true;resolve({code,signal});});});
  const file=join(f.workspace,'00-large');try{const deadline=performance.now()+30000;while(!ended&&performance.now()<deadline){if(existsSync(file)){const n=lstatSync(file).size;if(n>1024*1024&&n<f.bytes){killed=child.kill('SIGKILL');break;}}await delay(1);}if(!killed)child.kill('SIGKILL');const exit=await closed;assert.equal(killed,true,output);assert.equal(exit.signal,'SIGKILL');const prefix=readFileSync(file);assert.ok(prefix.length>0&&prefix.length<f.bytes);return {exit,file,prefix};}finally{if(!ended){child.kill('SIGKILL');await closed;}}
}
try{
  {
    const f=await fixture('transaction',100),before=hashBytes(readFileSync(join(f.i.workspaceRoot,'ontology.sqlite'))),filler=fill('transaction',64*1024);let code=null;
    try{prepareRestoreState(f.input,f.reportDigest);}catch(e){code=e.code;}assert.equal(code,'STATE_LIMIT');assert.equal(inspectRestoreState(f.input).status,'PENDING');assert.throws(()=>openWorkspace(f.workspace,f.i),e=>e.code==='RESTORE_STAGED');
    const partial=new DatabaseSync(join(f.workspace,'ontology.sqlite'),{readOnly:true});let version,tables;try{version=partial.prepare('PRAGMA user_version').get().user_version;tables=partial.prepare('SELECT name FROM sqlite_master').all();assert.equal(version,0);assert.deepEqual(tables,[]);}finally{partial.close();}
    assert.equal(hashBytes(readFileSync(join(f.i.workspaceRoot,'ontology.sqlite'))),before);assert.equal(hash(backupInventory(f.i)),f.source);const freeAfterRollback=available();release(filler);
    const done=prepareRestoreState(f.input,f.reportDigest);assert.equal(verifyPreparedRestoreState(f.input.root,done.receipt.manifestDigest).status,'VERIFIED');assert.equal(hash(backupInventory(f.i)),f.source);
    results.push({name:'actual-sqlite-full-atomic-rollback-and-same-request-recovery',status:'PASS',availableBeforePrepare:65536,freeAfterRollback,code,partialStateVersion:version,partialTables:tables,sourceUnchanged:true,receipt:done.receipt});
  }
  {
    const f=await fixture('killed',1,20),fault=await killed(f),before=hashBytes(readFileSync(join(f.workspace,'ontology.sqlite')));
    assert.equal(inspectRestoreState(f.input).status,'PENDING');assert.throws(()=>openWorkspace(f.workspace,f.i),e=>e.code==='RESTORE_STAGED');
    const corrupt=Buffer.from(fault.prefix);corrupt[corrupt.length-1]^=1;writeFileSync(fault.file,corrupt);assert.throws(()=>prepareRestoreState(f.input,f.reportDigest),e=>e.code==='RESTORE_EVIDENCE');assert.equal(hashBytes(readFileSync(fault.file)),hashBytes(corrupt));assert.equal(hashBytes(readFileSync(join(f.workspace,'ontology.sqlite'))),before);
    // Explicit fixture repair of the corrupted prefix, not product cleanup.
    writeFileSync(fault.file,fault.prefix);const done=prepareRestoreState(f.input,f.reportDigest);assert.equal(hashBytes(readFileSync(fault.file).subarray(0,fault.prefix.length)),hashBytes(fault.prefix));assert.equal(hashBytes(readFileSync(join(f.workspace,'ontology.sqlite'))),before);assert.equal(verifyPreparedRestoreState(f.input.root,done.receipt.manifestDigest).status,'VERIFIED');assert.equal(hash(backupInventory(f.i)),f.source);
    results.push({name:'actual-post-commit-sigkill-corrupt-prefix-refusal-and-exact-resume',status:'PASS',exit:fault.exit,partialBytes:fault.prefix.length,databaseUnchangedAcrossRetries:true,sourceUnchanged:true,receipt:done.receipt});
  }
  assert.equal(inspectRuntime(o.runtime).digest,runtime.digest);
}catch(e){failure={code:e.code??null,name:e.name,message:e.message,stack:e.stack};}finally{for(const file of [...fillers])release(file);}
const artifacts=['installation/restore-state.js','installation/restore-stage.js','installation/restore-files.js','installation/workspace.js','installation/reviewer.js','standalone/recovery.js','standalone/types.js','standalone/validation.js','standalone/service.js','standalone/workspace.js'].map(path=>({path:'dist/'+path,digest:hashBytes(readFileSync(join(pkg,'dist',path)))}));
writeFileSync(o.out,JSON.stringify({schema:'ontology-restore-state-fault-probe/v1',runtime,fixture:{root:o.root,filesystem:'tmpfs',maximumBytes:budget},artifacts,collectorDigest:hashBytes(readFileSync(new URL(import.meta.url))),results,failure,acceptance:'NOT_EVALUATED',limitations:['Synthetic owner data in an explicitly isolated filesystem','Prepared state remains inactive; no owner/filesystem activation or Codex Host journey is claimed','Current state freshness and worker/storage cutover still require activation evidence']},null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({cases:results.length,pass:results.length,fail:failure?1:0,report:o.out,failure}));if(failure)process.exitCode=1;
