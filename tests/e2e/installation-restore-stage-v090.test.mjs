import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync,symlinkSync,linkSync,rmSync,existsSync,readdirSync,lstatSync,chmodSync,openSync,closeSync,writeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile,spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {inspectRuntime} from '../../dist/installation/runtime.js';
import {prepareInstallation,bindInstallationToolchains} from '../../dist/installation/manager.js';
import {inspectInstallationBackup,backupInstallation} from '../../dist/installation/backup.js';
import {inspectRestoreStage,stageInstallationRestore,verifyRestoreStage} from '../../dist/installation/restore-stage.js';
import {openWorkspace,requireMaintenanceAvailable,RESTORE_STAGE_BARRIER} from '../../dist/standalone/workspace.js';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {grantReviewer,revokeReviewer} from '../../dist/installation/reviewer.js';
import {createWorkerAttempt,sealWorkerNotStarted,readWorkerAttempt} from '../../dist/installation/worker-journal.js';
import {inspectInstallationWorkerRotation,rotateInstallationWorkerJournal} from '../../dist/installation/worker-rotation.js';
import {hash,hashBytes} from '../../dist/standalone/validation.js';

const source=fileURLToPath(new URL('../..',import.meta.url));
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:60000,maxBuffer:8*1024*1024,...options},(e,out,err)=>e?reject(Object.assign(Error('Command failed '+e.code+' '+out+'\n'+err),{output:out})):resolve(out)));
let base,runtime,runtimeRoot,cli;
before(async()=>{
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-restore-stage-')));runtimeRoot=join(base,'runtime');mkdirSync(runtimeRoot,{mode:0o700});
  const pack=JSON.parse(await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',base],{cwd:source}));
  await execute('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',runtimeRoot,join(base,pack[0].filename)],{cwd:base});
  runtime=inspectRuntime(runtimeRoot);cli=join(runtime.packageRoot,'dist/standalone/cli.js');
});
after(()=>{if(base)rmSync(base,{recursive:true,force:true});});
const code=expected=>e=>e.code===expected;
const command=async args=>JSON.parse(await execute(process.execPath,[cli,...args])).result;
function fixture(name){
  const i=prepareInstallation({root:join(base,name+'-installation'),workspaceRoot:join(base,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot,runtimeDigest:runtime.digest,mode:'create'});
  return {i,backupRoot:join(base,name+'-backup'),stageRoot:join(base,name+'-stage'),requestId:'restore'};
}
function backup(f){
  const report=inspectInstallationBackup(f.i.root,f.backupRoot,'backup'),result=backupInstallation(f.i.root,{backupRoot:f.backupRoot,requestId:'backup',expectedReportDigest:report.reportDigest});
  f.expectedManifestDigest=result.receipt.manifestDigest;return report.report;
}
const input=f=>({backupRoot:f.backupRoot,expectedManifestDigest:f.expectedManifestDigest,stageRoot:f.stageRoot,requestId:f.requestId});
const args=(f,report)=>['restore-stage-apply','--backup',f.backupRoot,'--expected-manifest',f.expectedManifestDigest,'--stage-root',f.stageRoot,'--request-id',f.requestId,'--expected-report',report.reportDigest,'--json'];
const inspect=f=>inspectRestoreStage(input(f));
const apply=(f,r)=>stageInstallationRestore(input(f),r.reportDigest);
const nodePlan=requestId=>({schema:'ontology-owned-worker/v1',requestId,requestDigest:hash(requestId),configurationDigest:hash('config'),toolchainDigest:hash('tool'),executable:process.execPath,args:[],env:{},stdinDigest:hashBytes('x'),stdinBytes:1,timeoutMs:100,outputBytes:100,diagnosticBytes:100});
function large(f){const file=join(f.i.root,'00-large-customization'),fd=openSync(file,'wx',0o600),block=Buffer.alloc(1024*1024,113);try{for(let n=0;n<64;n++)writeSync(fd,block);}finally{closeSync(fd);}return file;}
async function interrupt(f,r){
  const file=join(f.stageRoot,'installation/00-large-customization'),child=spawn(process.execPath,[cli,...args(f,r)],{stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_NO_WARNINGS:'1'}});let ended=false,output='';
  child.stdout.on('data',b=>{output+=b;if(output.length>65536)child.kill('SIGKILL');});child.stderr.resume();
  const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{ended=true;resolve({code,signal});});});
  let killed=false;const deadline=performance.now()+20000;
  try{
    while(!ended&&performance.now()<deadline){if(existsSync(file)){const size=lstatSync(file).size;if(size>1024*1024&&size<64*1024*1024){killed=child.kill('SIGKILL');break;}}await delay(1);}
    if(!killed)child.kill('SIGKILL');const result=await closed;assert.ok(killed,'Observe actual copy window '+output);assert.equal(result.signal,'SIGKILL');
    const bytes=readFileSync(file);assert.ok(bytes.length>0&&bytes.length<64*1024*1024);return {file,bytes};
  }finally{if(!ended){child.kill('SIGKILL');await closed;}}
}

test('installed restore staging preserves original receipts and credentials, remains inactive and does not roll back the live owner',async()=>{
  const f=fixture('preserve'),token=readFileSync(f.i.credentialFile,'utf8');
  const owner=createStandaloneService({...f.i,root:f.i.workspaceRoot});
  const request={workspaceId:f.i.workspaceId,serviceId:f.i.serviceId,projectId:'demo',operation:'project.create',input:{label:'Original business project'},requestId:'original',expectedRevision:0};
  const original=owner.request(request,token);await owner.close();
  grantReviewer({...f.i,root:f.i.workspaceRoot,projectId:'demo',principalId:'reviewer',grantId:'reviewer',expiresAt:new Date(Date.now()+86400000).toISOString()});
  writeFileSync(join(f.i.root,'plugin/local-settings.json'),'{"locale":"zh-CN"}',{mode:0o400});
  const originalPlan=backup(f),r=inspect(f);assert.equal(r.status,'READY_TO_STAGE');assert.equal(existsSync(f.stageRoot),false);
  // Later revocation is deliberately absent from the snapshot; candidate
  // activation must reconcile it, and this staging operation does not claim to.
  revokeReviewer({...f.i,root:f.i.workspaceRoot,grantId:'reviewer'});
  const currentCredentials=hashBytes(readFileSync(join(f.i.workspaceRoot,'credentials.json'))),currentDB=hashBytes(readFileSync(join(f.i.workspaceRoot,'ontology.sqlite')));
  const result=await command(args(f,r));assert.equal(result.verification,'VERIFIED');assert.equal(result.receipt.activation,'BLOCKED');
  for(const e of originalPlan.entries.filter(e=>e.kind==='file')){
    const file=join(f.stageRoot,e.scope,e.path);assert.equal(hashBytes(readFileSync(file)),e.digest);assert.equal(lstatSync(file).mode&0o777,e.mode);
  }
  assert.equal(hashBytes(readFileSync(join(f.i.workspaceRoot,'credentials.json'))),currentCredentials);assert.equal(hashBytes(readFileSync(join(f.i.workspaceRoot,'ontology.sqlite'))),currentDB);
  const stagedDB=new DatabaseSync(join(f.stageRoot,'workspace/ontology.sqlite'),{readOnly:true});try{assert.deepEqual(JSON.parse(stagedDB.prepare('SELECT receipt FROM receipts WHERE request_id=?').get('original').receipt),original);}finally{stagedDB.close();}
  assert.throws(()=>openWorkspace(join(f.stageRoot,'workspace'),f.i),code('RESTORE_STAGED'));assert.throws(()=>requireMaintenanceAvailable(join(f.stageRoot,'installation')),code('RESTORE_STAGED'));
  await assert.rejects(command(['serve','--root',join(f.stageRoot,'workspace'),'--workspace',f.i.workspaceId,'--service',f.i.serviceId,'--json']),e=>JSON.parse(e.output).error.code==='RESTORE_STAGED');
  const checked=await command(['restore-stage-verify','--stage-root',f.stageRoot,'--expected-manifest',result.receipt.manifestDigest,'--json']);assert.equal(checked.status,'VERIFIED');assert.equal(checked.credentials,'SNAPSHOT_ONLY');assert.equal(checked.runtimeDependencies,'NOT_VERIFIED');
  const replay=apply(f,r);assert.deepEqual(replay.receipt,result.receipt);assert.equal(replay.verification,'NOT_RUN');assert.equal(inspect(f).status,'STAGED');
  const live=createStandaloneService({...f.i,root:f.i.workspaceRoot});try{assert.deepEqual(live.request(request,token),original);}finally{await live.close();}
});

test('a real SIGKILL leaves a guarded exact prefix and the same installed request resumes without changing source state',async()=>{
  const f=fixture('killed');large(f);backup(f);const r=inspect(f),before=hashBytes(readFileSync(join(f.i.workspaceRoot,'ontology.sqlite'))),partial=await interrupt(f,r);
  assert.equal(inspect(f).status,'PENDING');assert.throws(()=>openWorkspace(join(f.stageRoot,'workspace'),f.i),code('RESTORE_STAGED'));
  const finished=await command(args(f,r));assert.equal(hashBytes(readFileSync(partial.file).subarray(0,partial.bytes.length)),hashBytes(partial.bytes));assert.equal(verifyRestoreStage(f.stageRoot,finished.receipt.manifestDigest).status,'VERIFIED');
  assert.equal(hashBytes(readFileSync(join(f.i.workspaceRoot,'ontology.sqlite'))),before);
});

test('corrupt partial candidates and unselected material are preserved and cannot be silently resumed',async()=>{
  const f=fixture('changed');large(f);backup(f);const r=inspect(f),partial=await interrupt(f,r),bytes=Buffer.from(partial.bytes);bytes[bytes.length-1]^=1;writeFileSync(partial.file,bytes);
  assert.throws(()=>apply(f,r),code('RESTORE_EVIDENCE'));assert.equal(hashBytes(readFileSync(partial.file)),hashBytes(bytes));
  writeFileSync(partial.file,partial.bytes);const foreign=join(f.stageRoot,'workspace/unselected');writeFileSync(foreign,'preserve',{mode:0o600});assert.throws(()=>apply(f,r),code('RESTORE_EVIDENCE'));assert.equal(readFileSync(foreign,'utf8'),'preserve');unlinkSync(foreign);
  const result=apply(f,r);assert.equal(verifyRestoreStage(f.stageRoot,result.receipt.manifestDigest).status,'VERIFIED');
});

test('source byte integrity, exact destination, request and report identity are required before copying',()=>{
  const f=fixture('guards'),plan=backup(f),r=inspect(f);
  assert.throws(()=>stageInstallationRestore(input(f),hash('wrong-report')),code('REQUEST_CONFLICT'));assert.equal(existsSync(f.stageRoot),false);
  const object=join(f.backupRoot,'objects',plan.entries.find(e=>e.path==='credentials.json').digest.slice(7)),raw=readFileSync(object),bad=Buffer.from(raw);bad[bad.length-1]^=1;writeFileSync(object,bad);
  assert.throws(()=>apply(f,r),code('BACKUP_EVIDENCE'));assert.equal(existsSync(f.stageRoot),false);writeFileSync(object,raw);
  assert.throws(()=>inspectRestoreStage({...input(f),stageRoot:join(f.i.workspaceRoot,'nested')}),code('UNSAFE_PATH'));
  mkdirSync(f.stageRoot,{mode:0o700});writeFileSync(join(f.stageRoot,'keep'),'unselected',{mode:0o600});assert.throws(()=>apply(f,r),code('RESTORE_EVIDENCE'));assert.equal(readFileSync(join(f.stageRoot,'keep'),'utf8'),'unselected');
  unlinkSync(join(f.stageRoot,'keep'));assert.throws(()=>apply(f,r),code('RESTORE_UNOWNED'));
});

test('complete stage verification is independent of old roots and detects payload, mode and physical-lineage changes',()=>{
  const f=fixture('independent');backup(f);const r=inspect(f),done=apply(f,r),file=join(f.stageRoot,'workspace/ontology.sqlite'),bytes=readFileSync(file);
  rmSync(f.backupRoot,{recursive:true});rmSync(f.i.root,{recursive:true});rmSync(f.i.workspaceRoot,{recursive:true});
  assert.deepEqual(apply(f,r).receipt,done.receipt);assert.equal(verifyRestoreStage(f.stageRoot,done.receipt.manifestDigest).status,'VERIFIED');
  const corrupt=Buffer.from(bytes);corrupt[corrupt.length-1]^=1;writeFileSync(file,corrupt);assert.throws(()=>verifyRestoreStage(f.stageRoot,done.receipt.manifestDigest),code('RESTORE_EVIDENCE'));assert.equal(apply(f,r).verification,'NOT_RUN');writeFileSync(file,bytes);
  chmodSync(file,0o400);assert.throws(()=>verifyRestoreStage(f.stageRoot,done.receipt.manifestDigest),code('RESTORE_EVIDENCE'));chmodSync(file,0o600);
  renameSync(file,file+'.original');writeFileSync(file,bytes,{mode:0o600});const original=readFileSync(file+'.original');unlinkSync(file+'.original');assert.deepEqual(bytes,original);assert.throws(()=>verifyRestoreStage(f.stageRoot,done.receipt.manifestDigest),code('RESTORE_EVIDENCE'));
});

test('candidate metadata binds owner/request and refuses links, unexpected files and absent activation barriers',()=>{
  const f=fixture('paths');backup(f);const r=inspect(f),done=apply(f,r);
  assert.throws(()=>inspectRestoreStage({...input(f),requestId:'other'}),code('REQUEST_CONFLICT'));
  assert.throws(()=>verifyRestoreStage(f.stageRoot,hash('other')),code('RESTORE_EVIDENCE'));
  const extra=join(f.stageRoot,'workspace/extra');symlinkSync(join(f.i.workspaceRoot,'operator-token'),extra);assert.throws(()=>verifyRestoreStage(f.stageRoot,done.receipt.manifestDigest),code('RESTORE_EVIDENCE'));unlinkSync(extra);
  const token=join(f.stageRoot,'workspace/operator-token'),saved=readFileSync(token);unlinkSync(token);linkSync(join(f.i.workspaceRoot,'operator-token'),token);assert.throws(()=>verifyRestoreStage(f.stageRoot,done.receipt.manifestDigest),code('UNSAFE_PATH'));unlinkSync(token);writeFileSync(token,saved,{mode:0o600});
  const marker=join(f.stageRoot,'workspace',RESTORE_STAGE_BARRIER);unlinkSync(marker);assert.throws(()=>verifyRestoreStage(f.stageRoot,done.receipt.manifestDigest));
});

test('explicit partial-metadata fixtures resume the admitted bootstrap and exact completion without replacing foreign bytes',()=>{
  const f=fixture('metadata');backup(f);const r=inspect(f),barrier={schema:'ontology-restore-stage-barrier/v1',stageRoot:f.stageRoot,requestId:f.requestId,reportDigest:r.reportDigest,activation:'BLOCKED'};
  // Synthetic metadata boundaries supplement, not replace, the real process
  // death and filesystem-capacity evidence in separate tests/collectors.
  mkdirSync(f.stageRoot,{mode:0o700});const pending=join(f.stageRoot,RESTORE_STAGE_BARRIER+'.pending');writeFileSync(pending,'{',{mode:0o600});
  assert.throws(()=>apply(f,r),code('RESTORE_UNOWNED'));assert.equal(readFileSync(pending,'utf8'),'{');
  writeFileSync(pending,(JSON.stringify(barrier)+'\n').slice(0,-15));
  assert.equal(inspect(f).status,'PENDING');const done=apply(f,r),file=join(f.stageRoot,'manifest.json'),raw=readFileSync(file,'utf8');
  unlinkSync(file);writeFileSync(file+'.pending',raw.slice(0,200),{mode:0o600});const reconciled=apply(f,r);assert.deepEqual(reconciled.receipt,done.receipt);assert.equal(existsSync(file+'.pending'),false);
  unlinkSync(file);writeFileSync(file+'.pending','foreign retained metadata',{mode:0o600});assert.throws(()=>apply(f,r),e=>e.code==='BACKUP_EVIDENCE');assert.equal(readFileSync(file+'.pending','utf8'),'foreign retained metadata');assert.throws(()=>openWorkspace(join(f.stageRoot,'workspace'),f.i),code('RESTORE_STAGED'));
});

test('archived worker catalogs and original receipts remain byte-for-byte with separate destination lineage',async()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Actual toolchain bindings required');
  const f=fixture('archives'),selected=k=>({toolchainFile:process.env[k],toolchainDigest:JSON.parse(readFileSync(process.env[k])).digest});
  bindInstallationToolchains(f.i.root,{requestId:'tools',previousBindingDigest:null,dl:selected('EVOPILOT_TEST_DL_TOOLCHAIN'),shacl:selected('EVOPILOT_TEST_SHACL_TOOLCHAIN')});
  const root=join(f.i.root,'formal-work'),worker=createWorkerAttempt(root,nodePlan('one'));sealWorkerNotStarted(worker);const old=readWorkerAttempt(worker),rotation=await inspectInstallationWorkerRotation(f.i.root);await rotateInstallationWorkerJournal(f.i.root,{requestId:'rotate',expectedReportDigest:rotation.reportDigest});
  const originalCatalog=readFileSync(join(root,'worker-archives.json'));backup(f);const r=inspect(f),done=apply(f,r),work=join(f.stageRoot,'installation/formal-work');
  assert.deepEqual(readFileSync(join(work,'worker-archives.json')),originalCatalog);assert.deepEqual(readWorkerAttempt(worker),old);assert.throws(()=>createWorkerAttempt(work,nodePlan('must-not-run')),code('RESTORE_STAGED'));
  const manifest=JSON.parse(readFileSync(join(f.stageRoot,'manifest.json'))).manifest,source=r.report.backup.manifest.plan.entries;
  for(const e of source.filter(e=>e.scope==='installation'&&e.path.endsWith('.sqlite')&&e.path.startsWith('formal-work/'))){const image=manifest.entries.find(x=>x.scope===e.scope&&x.path===e.path);assert.notEqual(image.node.inode,e.inode);assert.equal(hashBytes(readFileSync(join(f.stageRoot,e.scope,e.path))),e.digest);}
  assert.equal(verifyRestoreStage(f.stageRoot,done.receipt.manifestDigest).status,'VERIFIED');
});
