import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync,symlinkSync,linkSync,rmSync,existsSync,readdirSync,lstatSync,cpSync,chmodSync,openSync,closeSync,writeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile,spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {inspectRuntime} from '../../dist/installation/runtime.js';
import {prepareInstallation,startInstallation,stopInstallation,bindInstallationToolchains} from '../../dist/installation/manager.js';
import {inspectInstallationBackup,backupInstallation,abortInstallationBackup} from '../../dist/installation/backup.js';
import {verifyBackup,writeBackupJSON} from '../../dist/installation/backup-files.js';
import {openWorkspace} from '../../dist/standalone/workspace.js';
import {grantReviewer,revokeReviewer} from '../../dist/installation/reviewer.js';
import {createWorkerAttempt,sealWorkerNotStarted,readWorkerAttempt} from '../../dist/installation/worker-journal.js';
import {inspectInstallationWorkerRotation,rotateInstallationWorkerJournal} from '../../dist/installation/worker-rotation.js';
import {hash,hashBytes} from '../../dist/standalone/validation.js';

const source=fileURLToPath(new URL('../..',import.meta.url));
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:60000,maxBuffer:8*1024*1024,...options},(e,out,err)=>e?reject(Object.assign(Error('Command failed '+e.code+' '+out+'\n'+err),{output:out})):resolve(out)));
let base,runtime,runtimeRoot,cli;
before(async()=>{
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-backup-')));runtimeRoot=join(base,'runtime');mkdirSync(runtimeRoot,{mode:0o700});
  const pack=JSON.parse(await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',base],{cwd:source}));
  await execute('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',runtimeRoot,join(base,pack[0].filename)],{cwd:base});
  runtime=inspectRuntime(runtimeRoot);cli=join(runtime.packageRoot,'dist/standalone/cli.js');
});
after(()=>{if(base)rmSync(base,{recursive:true,force:true});});
function fixture(name){
  const i=prepareInstallation({root:join(base,name+'-installation'),workspaceRoot:join(base,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot,runtimeDigest:runtime.digest,mode:'create'});
  return {i,backup:join(base,name+'-backup')};
}
const inspect=(f,id='backup')=>inspectInstallationBackup(f.i.root,f.backup,id);
const input=(f,r,id='backup')=>({backupRoot:f.backup,requestId:id,expectedReportDigest:r.reportDigest});
const args=(f,r,id='backup')=>['backup-apply','--installation',f.i.root,'--backup',f.backup,'--request-id',id,'--expected-report',r.reportDigest,'--json'];
const command=async args=>JSON.parse(await execute(process.execPath,[cli,...args])).result;
const code=expected=>e=>e.code===expected;
const nodePlan=requestId=>({schema:'ontology-owned-worker/v1',requestId,requestDigest:hash(requestId),configurationDigest:hash('config'),toolchainDigest:hash('tool'),executable:process.execPath,args:[],env:{},stdinDigest:hashBytes('x'),stdinBytes:1,timeoutMs:100,outputBytes:100,diagnosticBytes:100});
function large(f){
  // A real 64 MiB private file supplies an observable copy window. No product
  // pause hook or fabricated partial copy substitutes for the killed process.
  const file=join(f.i.root,'00-large-customization'),fd=openSync(file,'wx',0o600),block=Buffer.alloc(1024*1024,113);
  try{for(let n=0;n<64;n++)writeSync(fd,block);}finally{closeSync(fd);}return file;
}
async function interrupt(f,r){
  const e=r.report.entries.find(e=>e.path==='00-large-customization'),object=join(f.backup,'objects',e.digest.slice(7));
  const child=spawn(process.execPath,[cli,...args(f,r)],{stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_NO_WARNINGS:'1'}});let ended=false,output='';
  child.stdout.on('data',b=>{output+=b;if(output.length>65536)child.kill('SIGKILL');});child.stderr.resume();
  const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{ended=true;resolve({code,signal});});});
  const deadline=performance.now()+20000;let selected=false;
  try{
    while(!ended&&performance.now()<deadline){
      if(existsSync(object)){const bytes=lstatSync(object).size;if(bytes>1024*1024&&bytes<e.bytes){selected=child.kill('SIGKILL');break;}}
      await delay(1);
    }
    if(!selected)child.kill('SIGKILL');const exit=await closed;
    assert.ok(selected,'Actual copy window must be observed '+output);assert.equal(exit.signal,'SIGKILL');
    const retained=lstatSync(object).size;assert.ok(retained>0&&retained<e.bytes,'Actual partial object required');return {object,retained};
  }finally{if(!ended){child.kill('SIGKILL');await closed;}}
}

test('installed backup preserves customization, private grants and exact source bytes; independent verification detects corruption',async()=>{
  const f=fixture('complete'),custom=join(f.i.root,'plugin','local-settings.json');writeFileSync(custom,'{"locale":"zh-CN","custom":true}',{mode:0o600});
  const parent=join(base,'portable-parent');mkdirSync(parent,{mode:0o700});f.backup=join(parent,'backup');
  grantReviewer({...f.i,root:f.i.workspaceRoot,projectId:'demo',principalId:'reviewer',grantId:'reviewer',expiresAt:new Date(Date.now()+86400000).toISOString()});
  const before=inspect(f);assert.equal(before.status,'READY');assert.ok(before.report.entries.some(e=>e.path==='reviewer-token-reviewer'));
  const first=await command(args(f,before));assert.equal(first.verification,'VERIFIED');assert.equal(first.replayed,false);
  for(const e of before.report.entries.filter(e=>e.kind==='file')){
    const raw=readFileSync(join(f.backup,'objects',e.digest.slice(7))),split=raw.indexOf(10),bytes=raw.subarray(split+1);
    assert.equal(hashBytes(bytes),e.digest);assert.equal(bytes.length,e.bytes);
    assert.equal(hashBytes(readFileSync(join(e.scope==='installation'?f.i.root:f.i.workspaceRoot,e.path))),e.digest);
  }
  const replay=await command(args(f,before));assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,first.receipt);assert.equal(replay.verification,'NOT_RUN');
  assert.equal((await command(['backup-verify','--backup',f.backup,'--expected-manifest',first.receipt.manifestDigest,'--json'])).status,'VERIFIED');
  assert.equal(inspect(f).status,'COMPLETED');assert.throws(()=>backupInstallation(f.i.root,{...input(f,before),expectedReportDigest:hash('other')}),code('REQUEST_CONFLICT'));
  assert.throws(()=>abortInstallationBackup(f.i.root,'backup',before.reportDigest),code('BACKUP_COMPLETED'));
  const portable=join(base,'portable');cpSync(f.backup,portable,{recursive:true});
  const privatize=path=>{const dir=lstatSync(path).isDirectory();chmodSync(path,dir?0o700:0o600);if(dir)for(const name of readdirSync(path))privatize(join(path,name));};privatize(portable);
  assert.equal(verifyBackup(portable,first.receipt.manifestDigest).receipt.manifestDigest,first.receipt.manifestDigest);
  const object=join(portable,'objects',before.report.entries.find(e=>e.path==='credentials.json').digest.slice(7)),raw=readFileSync(object);raw[raw.length-1]^=1;writeFileSync(object,raw);
  assert.throws(()=>verifyBackup(portable,first.receipt.manifestDigest),code('BACKUP_EVIDENCE'));
  // Subsequent grants/revocations remain writable and do not alter the old copy.
  revokeReviewer({...f.i,root:f.i.workspaceRoot,grantId:'reviewer'});
  assert.equal(verifyBackup(f.backup,first.receipt.manifestDigest).receipt.manifestDigest,first.receipt.manifestDigest);
  const next={...f,backup:join(base,'second-backup')},second=inspect(next,'second');assert.equal(second.report.priorBackups.length,1);assert.equal(second.report.priorBackups[0].state,'COMPLETED');
  renameSync(parent,join(base,'moved-parent'));assert.equal(inspect(f).status,'COMPLETED');assert.deepEqual((await command(args(f,before))).receipt,first.receipt);
});

test('SIGKILL during actual installed copying retains barriers and resumes the same request without overwriting the prefix',async()=>{
  const f=fixture('interrupted');large(f);const r=inspect(f),partial=await interrupt(f,r),prefixHash=hashBytes(readFileSync(partial.object));
  assert.equal(inspect(f).status,'PENDING');assert.throws(()=>openWorkspace(f.i.workspaceRoot,f.i),code('BACKUP_PENDING'));await assert.rejects(startInstallation(f.i.root),code('BACKUP_PENDING'));
  assert.throws(()=>inspect(f,'another'),code('BACKUP_PENDING'));
  const unrelated=fixture('unrelated'),store=openWorkspace(unrelated.i.workspaceRoot,unrelated.i);store.close();
  const result=await command(args(f,r));assert.equal(result.replayed,false);assert.equal(hashBytes(readFileSync(partial.object).subarray(0,partial.retained)),prefixHash);
  const reopened=openWorkspace(f.i.workspaceRoot,f.i);reopened.close();assert.equal(existsSync(join(f.i.root,'maintenance-barrier.json')),false);
  assert.equal(verifyBackup(f.backup,result.receipt.manifestDigest).receipt.manifestDigest,result.receipt.manifestDigest);
});

test('source drift after interruption refuses completion; exact abort preserves partial bytes and permits later owner work',async()=>{
  const f=fixture('drift');const file=large(f),r=inspect(f),partial=await interrupt(f,r),retained=hashBytes(readFileSync(partial.object));
  const original=readFileSync(partial.object),changed=Buffer.from(original);changed[changed.length-1]^=1;writeFileSync(partial.object,changed);
  await assert.rejects(command(args(f,r)),e=>JSON.parse(e.output).error.code==='BACKUP_EVIDENCE');assert.equal(hashBytes(readFileSync(partial.object)),hashBytes(changed));writeFileSync(partial.object,original);
  const fd=openSync(file,'r+');try{writeSync(fd,Buffer.from([1]),0,1,0);}finally{closeSync(fd);}
  await assert.rejects(command(args(f,r)),e=>JSON.parse(e.output).error.code==='BACKUP_SOURCE_CHANGED');
  assert.throws(()=>abortInstallationBackup(f.i.root,'backup',hash('wrong')),code('REQUEST_CONFLICT'));
  const result=await command(['backup-abort','--installation',f.i.root,'--request-id','backup','--expected-report',r.reportDigest,'--json']);assert.equal(result.receipt.partialCopyRetained,true);
  assert.equal(hashBytes(readFileSync(partial.object)),retained);assert.equal(inspect(f).status,'ABORTED');assert.deepEqual(abortInstallationBackup(f.i.root,'backup',r.reportDigest).receipt,result.receipt);
  assert.throws(()=>backupInstallation(f.i.root,input(f,r)),code('BACKUP_ABORTED'));const store=openWorkspace(f.i.workspaceRoot,f.i);store.close();
  await startInstallation(f.i.root);try{assert.deepEqual(abortInstallationBackup(f.i.root,'backup',r.reportDigest).receipt,result.receipt);}finally{await stopInstallation(f.i.root);}
});

test('cold backup refuses live owners, changed plans, sidecars, links, oversized files and occupied destinations',async()=>{
  const f=fixture('guards'),r=inspect(f);const store=openWorkspace(f.i.workspaceRoot,f.i);
  try{assert.throws(()=>inspect(f),code('WORKSPACE_BUSY'));}finally{store.close();}
  await startInstallation(f.i.root);try{assert.throws(()=>inspect(f),code('INSTALLATION_RUNNING'));}finally{await stopInstallation(f.i.root);}
  assert.throws(()=>backupInstallation(f.i.root,input(f,r)),code('BACKUP_SOURCE_CHANGED'));assert.equal(existsSync(f.backup),false);
  const foreign=join(f.i.workspaceRoot,'foreign');symlinkSync('/no-such-backup-source',foreign);assert.throws(()=>inspect(f),code('UNSAFE_PATH'));unlinkSync(foreign);
  linkSync(join(f.i.workspaceRoot,'operator-token'),foreign);assert.throws(()=>inspect(f),code('UNSAFE_PATH'));unlinkSync(foreign);
  writeFileSync(join(f.i.workspaceRoot,'ontology.sqlite-wal'),'',{mode:0o600});assert.throws(()=>inspect(f),code('BACKUP_SIDECAR'));unlinkSync(join(f.i.workspaceRoot,'ontology.sqlite-wal'));
  const fd=openSync(foreign,'wx',0o600);try{writeSync(fd,Buffer.from([0]),0,1,64*1024*1024);}finally{closeSync(fd);}assert.throws(()=>inspect(f),code('BACKUP_LIMIT'));unlinkSync(foreign);
  mkdirSync(f.backup,{mode:0o700});writeFileSync(join(f.backup,'keep'),'unselected',{mode:0o600});assert.throws(()=>inspect(f),code('BACKUP_EXISTS'));assert.equal(readFileSync(join(f.backup,'keep'),'utf8'),'unselected');
});

test('closed archived and current worker evidence is included; unfinished workers cannot be backed up',async()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Actual managed tool bindings required');
  const f=fixture('workers'),selection=k=>({toolchainFile:process.env[k],toolchainDigest:JSON.parse(readFileSync(process.env[k])).digest});
  const binding=bindInstallationToolchains(f.i.root,{requestId:'bind',previousBindingDigest:null,dl:selection('EVOPILOT_TEST_DL_TOOLCHAIN'),shacl:selection('EVOPILOT_TEST_SHACL_TOOLCHAIN')}),root=join(f.i.root,'formal-work');
  const first=createWorkerAttempt(root,nodePlan('first'));assert.throws(()=>inspect(f),code('WORKER_EXIT_UNPROVEN'));sealWorkerNotStarted(first);
  const old=readWorkerAttempt(first),rotate=await inspectInstallationWorkerRotation(f.i.root);await rotateInstallationWorkerJournal(f.i.root,{requestId:'rotate',expectedReportDigest:rotate.reportDigest});
  const second=createWorkerAttempt(root,nodePlan('second'));sealWorkerNotStarted(second);const r=inspect(f);
  assert.equal(r.report.toolchainBindingDigest,binding.receipt.digest);assert.equal(r.report.workerAttempts,2);assert.equal(r.report.workerJournals,2);
  const result=await command(args(f,r));assert.equal(verifyBackup(f.backup,result.receipt.manifestDigest).manifest.plan.workerJournals,2);assert.deepEqual(readWorkerAttempt(first),old);
});

test('protocol staging resumes exact partial metadata and a durable manifest completes the original receipt after interruption',async()=>{
  const f=fixture('metadata'),r=inspect(f),result=backupInstallation(f.i.root,input(f,r)),record=join(f.i.root,'backup-requests/backup.json'),saved=JSON.parse(readFileSync(record));
  const pending={...saved,state:'PENDING',receipt:null};writeFileSync(record,JSON.stringify(pending)+'\n');
  // This is a specifically identified post-manifest crash-state fixture. The
  // real process-kill test above covers the payload-copy boundary separately.
  writeFileSync(record+'.pending',(JSON.stringify(saved)+'\n').slice(0,180),{mode:0o600});
  assert.throws(()=>abortInstallationBackup(f.i.root,'backup',r.reportDigest),code('BACKUP_COMPLETED_PENDING'));
  const done=await command(args(f,r));assert.deepEqual(done.receipt,result.receipt);assert.equal(existsSync(record+'.pending'),false);
  const path=join(base,'metadata.json'),value={private:'synthetic',ordinal:1},raw=JSON.stringify(value)+'\n';writeFileSync(path+'.pending',raw.slice(0,7),{mode:0o600});writeBackupJSON(path,value);assert.equal(readFileSync(path,'utf8'),raw);
  unlinkSync(path);writeFileSync(path+'.pending','foreign',{mode:0o600});assert.throws(()=>writeBackupJSON(path,value),code('BACKUP_EVIDENCE'));assert.equal(readFileSync(path+'.pending','utf8'),'foreign');
});
