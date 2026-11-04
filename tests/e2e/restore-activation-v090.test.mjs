import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,lstatSync,openSync,writeSync,closeSync,unlinkSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile,spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {inspectRuntime} from '../../dist/installation/runtime.js';
import {prepareInstallation,bindInstallationToolchains} from '../../dist/installation/manager.js';
import {inspectInstallationBackup,backupInstallation} from '../../dist/installation/backup.js';
import {backupInventory,backupNode} from '../../dist/installation/backup-files.js';
import {inspectRestoreStage,stageInstallationRestore} from '../../dist/installation/restore-stage.js';
import {inspectRestoreActivation,activateRestore,abortRestoreActivation} from '../../dist/installation/restore-activate.js';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {readConnection,sendRequest} from '../../dist/standalone/client.js';
import {openWorkspace,RESTORE_ACTIVATION_BARRIER} from '../../dist/standalone/workspace.js';
import {grantReviewer,revokeReviewer} from '../../dist/installation/reviewer.js';
import {inspectInstallationWorkerRotation,rotateInstallationWorkerJournal} from '../../dist/installation/worker-rotation.js';
import {hash,hashBytes} from '../../dist/standalone/validation.js';
import {definition,prepare as prepareModel} from '../helpers/v090-native.mjs';
import {prepare as prepareValidation,terminal} from '../helpers/v090-validation.mjs';

const source=fileURLToPath(new URL('../..',import.meta.url));let base,runtime,runtimeRoot,cliFile;
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:60000,maxBuffer:16*1024*1024,...options},(e,out,err)=>{if(e){let code;try{code=JSON.parse(out).error?.code;}catch{}reject(Object.assign(Error(out+'\n'+err),{code}));}else resolve(out);}));
const cli=async(...args)=>{const v=JSON.parse(await execute(process.execPath,[cliFile,...args,'--json'],{env:{...process.env,NODE_NO_WARNINGS:'1'}}));assert.equal(v.ok,true);return v.result;};
before(async()=>{base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-restore-activation-')));runtimeRoot=join(base,'runtime');mkdirSync(runtimeRoot,{mode:0o700});const pack=JSON.parse(await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',base],{cwd:source}));await execute('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',runtimeRoot,join(base,pack[0].filename)],{cwd:base});runtime=inspectRuntime(runtimeRoot);cliFile=join(runtime.packageRoot,'dist/standalone/cli.js');});
after(()=>{if(base)rmSync(base,{recursive:true,force:true});});
function fixture(name,mib=0){
  const i=prepareInstallation({root:join(base,name+'-installation'),workspaceRoot:join(base,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot,runtimeDigest:runtime.digest,mode:'create'}),token=readFileSync(i.credentialFile,'utf8');
  if(mib){const fd=openSync(join(i.workspaceRoot,'00-large'),'wx',0o600),block=Buffer.alloc(1024*1024,113);try{for(let n=0;n<mib;n++)writeSync(fd,block);}finally{closeSync(fd);}}
  const read=(operation,input={})=>({workspaceId:i.workspaceId,serviceId:i.serviceId,projectId:'demo',operation,input}),write=(operation,input,requestId,expectedRevision)=>({...read(operation,input),requestId,expectedRevision});
  return {i,root:i.workspaceRoot,setup:{...i,root:i.workspaceRoot},workRoot:join(i.root,'formal-work'),token,read,write,ordinal:0};
}
function stage(f){const n=++f.ordinal,backupRoot=join(base,f.i.workspaceId+'-backup-'+n),generation=JSON.parse(readFileSync(join(f.root,'identity.json'))).recovery?.generation,requestId=(generation?'r'+generation+'.':'')+'backup-'+n,r=inspectInstallationBackup(f.i.root,backupRoot,requestId),b=backupInstallation(f.i.root,{backupRoot,requestId,expectedReportDigest:r.reportDigest});const input={backupRoot,expectedManifestDigest:b.receipt.manifestDigest,stageRoot:join(base,f.i.workspaceId+'-stage-'+n),requestId:'stage-'+n},inspected=inspectRestoreStage(input),done=stageInstallationRestore(input,inspected.reportDigest);return {root:input.stageRoot,manifestDigest:done.receipt.manifestDigest};}
const selection=(f,snapshot,retained,name='restore')=>({installationRoot:f.i.root,snapshot,retained,recoveryRoot:join(base,f.i.workspaceId+'-'+name),requestId:name});
const args=(command,v,report)=>[command,'--installation',v.installationRoot,'--snapshot',v.snapshot.root,'--snapshot-manifest',v.snapshot.manifestDigest,'--retained',v.retained.root,'--retained-manifest',v.retained.manifestDigest,'--recovery-root',v.recoveryRoot,'--request-id',v.requestId,...(report?['--expected-report',report]:[])];
const dbHash=f=>hashBytes(readFileSync(join(f.root,'ontology.sqlite')));

test('installed restore activates selected drafts at the original path, retains current grants and exact receipts, and starts a real owner for new work',async()=>{
  const f=fixture('current'),grant=grantReviewer({...f.setup,projectId:'demo',principalId:'reviewer',grantId:'reviewer',expiresAt:new Date(Date.now()+86400000).toISOString()});
  let s=createStandaloneService(f.setup);const model=prepareModel(s,f);await s.close();const snapshot=stage(f);
  s=createStandaloneService(f.setup);const draft={...model.model,label:'Newer retained model',previousDigest:model.modelDigest},request=f.write('model.record',{draft},'later',4),known=s.request(request,f.token);await s.close();revokeReviewer({...f.setup,grantId:'reviewer'});
  writeFileSync(join(f.i.root,'plugin','custom-policy.txt'),'Private user customization\n',{mode:0o600});const retained=stage(f),v=selection(f,snapshot,retained),before=dbHash(f),old=backupNode(f.root),installation=hash(backupInventory(f.i,['installation'])),credentials=readFileSync(join(f.root,'credentials.json'));
  const inspected=await cli(...args('restore-current-inspect',v)),done=await cli(...args('restore-current-apply',v,inspected.reportDigest));assert.equal(done.status,'ACTIVATED');assert.equal(done.serviceStarted,false);assert.notDeepEqual(backupNode(f.root),old);assert.deepEqual(backupNode(done.receipt.previousWorkspaceRoot),old);assert.equal(hashBytes(readFileSync(join(done.receipt.previousWorkspaceRoot,'ontology.sqlite'))),before);assert.deepEqual(readFileSync(join(f.root,'credentials.json')),credentials);assert.equal(hash(backupInventory(f.i,['installation'])),installation);
  assert.throws(()=>openWorkspace(done.receipt.previousWorkspaceRoot,f.i),e=>['RESTORE_ACTIVATION_EVIDENCE','RESTORE_ACTIVATION_PENDING'].includes(e.code));
  await cli('start','--installation',f.i.root);
  try{
    const connection=readConnection(join(f.i.root,'connection.json')),context=await cli('context','--connection',join(f.i.root,'connection.json'));assert.equal(context.recovery.requestIdPrefix,done.receipt.requestIdPrefix);
    assert.deepEqual(await sendRequest(connection,request,true),known);assert.equal((await sendRequest(connection,f.read('model.inspect',{assetId:'services',modelDigest:null}),false)).modelDigest,model.modelDigest);
    assert.equal((await sendRequest(connection,f.read('model.inspect',{assetId:'services',modelDigest:known.result.modelDigest}),false)).current,false);
    await assert.rejects(sendRequest(connection,{...request,requestId:'missing-before-restore'},true),{code:'REQUEST_OUTCOME_UNKNOWN'});
    const project=await sendRequest(connection,f.read('project.inspect'),false),fresh=f.write('intent.record',{definition:{...definition,scope:'New work after actual activation'},previousDigest:model.intentDigest},done.receipt.requestIdPrefix+'new-intent',project.revision),result=await sendRequest(connection,fresh,true);assert.equal(result.revision,project.revision+1);
    const reviewerConnection={...connection,credentialFile:grant.credentialFile};await assert.rejects(sendRequest(reviewerConnection,f.read('project.inspect'),false),{code:'UNAUTHENTICATED'});
    const replayed=await cli(...args('restore-current-apply',v,inspected.reportDigest));assert.deepEqual(replayed.receipt,done.receipt);assert.equal(replayed.verification,'NOT_RUN');
  }finally{await cli('stop','--installation',f.i.root);}
  rmSync(snapshot.root,{recursive:true});rmSync(retained.root,{recursive:true});renameSync(f.i.root,join(base,'current-installation-unavailable'));renameSync(f.root,join(base,'current-workspace-unavailable'));assert.deepEqual(activateRestore(v,inspected.reportDigest).receipt,done.receipt);
});

test('stale current snapshots, active writers and changed workspace birth identity are refused before admission',async()=>{
  const f=fixture('freshness');let s=createStandaloneService(f.setup);const model=prepareModel(s,f);await s.close();const snapshot=stage(f),v=selection(f,snapshot,snapshot);
  s=createStandaloneService(f.setup);assert.throws(()=>inspectRestoreActivation(v),{code:'WORKSPACE_BUSY'});s.request(f.write('intent.record',{definition:{...definition,scope:'New current state'},previousDigest:model.intentDigest},'later',4),f.token);await s.close();assert.throws(()=>inspectRestoreActivation(v),{code:'RESTORE_SOURCE_CHANGED'});assert.equal(existsSync(v.recoveryRoot),false);
  const retained=stage(f),current=selection(f,snapshot,retained),report=inspectRestoreActivation(current),file=join(f.root,'credentials.json'),creds=JSON.parse(readFileSync(file));creds.grants[0].revoked=true;writeFileSync(file,JSON.stringify(creds));assert.throws(()=>activateRestore(current,report.reportDigest),{code:'RESTORE_SOURCE_CHANGED'});assert.equal(existsSync(current.recoveryRoot),false);
  // Deliberately inconsistent immutable birth metadata, not a supported edit.
  const identityFile=join(f.root,'identity.json'),identity=JSON.parse(readFileSync(identityFile));identity.createdAt='2001-01-01T00:00:00.000Z';const raw=JSON.stringify(identity)+'\n';writeFileSync(identityFile,raw);const db=new DatabaseSync(join(f.root,'ontology.sqlite'));db.prepare('UPDATE workspace SET identity=?').run(raw);db.close();const altered=stage(f);assert.throws(()=>inspectRestoreActivation(selection(f,snapshot,altered,'birth-conflict')),{code:'RESTORE_OWNER_CONFLICT'});
});

test('two actual activations keep earlier generations known and missing older requests unknown',async()=>{
  const f=fixture('repeat');let s=createStandaloneService(f.setup);const model=prepareModel(s,f);await s.close();const snapshot=stage(f),v=selection(f,snapshot,snapshot),report=inspectRestoreActivation(v),first=activateRestore(v,report.reportDigest);
  s=createStandaloneService(f.setup);const request=f.write('intent.record',{definition:{...definition,scope:'Retained between activations'},previousDigest:model.intentDigest},first.receipt.requestIdPrefix+'later',5),known=s.request(request,f.token);await s.close();const retained=stage(f),next=selection(f,snapshot,retained,'second'),r=inspectRestoreActivation(next),second=activateRestore(next,r.reportDigest);
  assert.notEqual(first.receipt.requestIdPrefix,second.receipt.requestIdPrefix);s=createStandaloneService(f.setup);try{assert.deepEqual(s.request(request,f.token),known);assert.throws(()=>s.request({...request,requestId:first.receipt.requestIdPrefix+'unknown'},f.token),{code:'REQUEST_OUTCOME_UNKNOWN'});}finally{await s.close();}
});

async function killed(v,report,observe){
  const child=spawn(process.execPath,[cliFile,...args('restore-current-apply',v,report),'--json'],{stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_NO_WARNINGS:'1'}});let ended=false,didKill=false,output='';child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{ended=true;resolve({code,signal});});});
  try{const deadline=performance.now()+45000;while(!ended&&performance.now()<deadline){if(observe()){didKill=child.kill('SIGKILL');break;}await delay(1);}if(!didKill)child.kill('SIGKILL');const exit=await closed;assert.equal(didKill,true,output);assert.equal(exit.signal,'SIGKILL');return exit;}finally{if(!ended){child.kill('SIGKILL');await closed;}}
}
test('an interrupted admission cannot freeze a concurrently acquired writer or stale state before obtaining its writer lease',async()=>{
  const f=fixture('admission-race',64);let s=createStandaloneService(f.setup);const model=prepareModel(s,f);await s.close();const snapshot=stage(f),v=selection(f,snapshot,snapshot),r=inspectRestoreActivation(v),barrier=join(f.root,RESTORE_ACTIVATION_BARRIER);
  await killed(v,r.reportDigest,()=>existsSync(join(v.recoveryRoot,'plan.json'))&&!existsSync(barrier));assert.equal(existsSync(barrier),false);
  s=createStandaloneService(f.setup);try{assert.throws(()=>activateRestore(v,r.reportDigest),{code:'WORKSPACE_BUSY'});assert.equal(existsSync(barrier),false);assert.equal(existsSync(join(f.i.root,RESTORE_ACTIVATION_BARRIER)),false);s.request(f.write('intent.record',{definition:{...definition,scope:'Legitimate concurrent authoring'},previousDigest:model.intentDigest},'concurrent',4),f.token);}finally{await s.close();}
  const current=dbHash(f);assert.throws(()=>activateRestore(v,r.reportDigest),{code:'RESTORE_SOURCE_CHANGED'});assert.equal(existsSync(barrier),false);abortRestoreActivation(v.recoveryRoot,v.requestId,r.reportDigest);assert.equal(dbHash(f),current);
});
for(const phase of ['copying','prepared','old-moved','new-installed'])test('actual installed SIGKILL at '+phase+' retains owner barriers and resumes the original activation',async()=>{
  const f=fixture('kill-'+phase,64),s=createStandaloneService(f.setup);prepareModel(s,f);await s.close();const snapshot=stage(f),v=selection(f,snapshot,snapshot),r=inspectRestoreActivation(v),before=dbHash(f),oldNode=backupNode(f.root),payload=join(v.recoveryRoot,'state/workspace/00-large');
  await killed(v,r.reportDigest,()=>phase==='copying'?existsSync(payload)&&lstatSync(payload).size>1024*1024&&lstatSync(payload).size<64*1024*1024:existsSync(join(v.recoveryRoot,phase+'.json'))&&!existsSync(join(v.recoveryRoot,phase==='prepared'?'switch.json':'activated.json')));
  assert.throws(()=>openWorkspace(f.root,f.i),e=>['ENOENT','RESTORE_STAGED','RESTORE_ACTIVATION_PENDING'].includes(e.code));
  if(phase==='prepared'){
    // Synthetic partial-marker bytes after an actual killed prepared phase.
    const file=join(v.recoveryRoot,'state/workspace',RESTORE_ACTIVATION_BARRIER),marker={schema:'ontology-restore-activation-barrier/v1',root:f.root,recoveryRoot:v.recoveryRoot,installationId:f.i.installationId,workspaceId:f.i.workspaceId,serviceId:f.i.serviceId,requestId:v.requestId,requestDigest:r.reportDigest};if(existsSync(file))unlinkSync(file);writeFileSync(file+'.pending',JSON.stringify(marker).slice(0,40),{mode:0o600});
  }
  if(!['copying','prepared'].includes(phase))assert.throws(()=>abortRestoreActivation(v.recoveryRoot,v.requestId,r.reportDigest),{code:'RESTORE_SWITCH_ADMITTED'});
  const admission=readFileSync(join(v.recoveryRoot,'plan.json')),done=activateRestore(v,r.reportDigest);assert.equal(done.status,'ACTIVATED');assert.deepEqual(readFileSync(join(v.recoveryRoot,'plan.json')),admission);assert.deepEqual(backupNode(done.receipt.previousWorkspaceRoot),oldNode);assert.equal(hashBytes(readFileSync(join(done.receipt.previousWorkspaceRoot,'ontology.sqlite'))),before);
  const owner=createStandaloneService(f.setup);try{assert.equal(owner.context(f.token).recovery.requestIdPrefix,done.receipt.requestIdPrefix);}finally{await owner.close();}
});

test('corrupt interrupted copies are preserved and can be explicitly aborted before the switch; no automatic cleanup or grant rollback',async()=>{
  const f=fixture('abort',64),s=createStandaloneService(f.setup);prepareModel(s,f);await s.close();const snapshot=stage(f),v=selection(f,snapshot,snapshot),r=inspectRestoreActivation(v),before=dbHash(f),payload=join(v.recoveryRoot,'state/workspace/00-large');
  await killed(v,r.reportDigest,()=>existsSync(payload)&&lstatSync(payload).size>1024*1024&&lstatSync(payload).size<64*1024*1024);
  const bytes=readFileSync(payload);bytes[0]^=1;writeFileSync(payload,bytes);assert.throws(()=>activateRestore(v,r.reportDigest),{code:'RESTORE_EVIDENCE'});assert.deepEqual(readFileSync(payload),bytes);
  const done=await cli('restore-current-abort','--recovery-root',v.recoveryRoot,'--request-id',v.requestId,'--expected-report',r.reportDigest);assert.equal(done.receipt.cutover,'NOT_STARTED');assert.equal(dbHash(f),before);assert.deepEqual(readFileSync(payload),bytes);assert.throws(()=>activateRestore(v,r.reportDigest),{code:'RESTORE_ABORTED'});
  const owner=createStandaloneService(f.setup);try{assert.equal(owner.context(f.token).recovery,undefined);assert.deepEqual(abortRestoreActivation(v.recoveryRoot,v.requestId,r.reportDigest).receipt,done.receipt);}finally{await owner.close();}
});

test('terminal cutover cleanup replays exact ownership without snapshot sources and refuses a foreign marker',async()=>{
  const f=fixture('release'),s=createStandaloneService(f.setup);prepareModel(s,f);await s.close();const snapshot=stage(f),v=selection(f,snapshot,snapshot),r=inspectRestoreActivation(v),done=activateRestore(v,r.reportDigest),a=JSON.parse(readFileSync(join(v.recoveryRoot,'plan.json'))),p=JSON.parse(readFileSync(join(v.recoveryRoot,'prepared.json')));
  // Synthetic post-commit/pre-release state. The actual SIGKILL tests above
  // cover real filesystem transitions; this fixture checks release ownership.
  unlinkSync(join(v.recoveryRoot,'released.json'));writeFileSync(join(f.root,'restore-stage-barrier.json'),JSON.stringify(p.stageBarrier)+'\n',{mode:0o600});
  const marker={schema:'ontology-restore-activation-barrier/v1',root:f.root,recoveryRoot:v.recoveryRoot,installationId:f.i.installationId,workspaceId:f.i.workspaceId,serviceId:f.i.serviceId,requestId:v.requestId,requestDigest:a.reportDigest};
  writeFileSync(join(f.root,RESTORE_ACTIVATION_BARRIER),JSON.stringify({...marker,requestDigest:hashBytes('Foreign request')})+'\n',{mode:0o600});rmSync(snapshot.root,{recursive:true});assert.throws(()=>activateRestore(v,r.reportDigest),{code:'RESTORE_ACTIVATION_PENDING'});
  writeFileSync(join(f.root,RESTORE_ACTIVATION_BARRIER),JSON.stringify(marker)+'\n');
  const partial=join(f.root,RESTORE_ACTIVATION_BARRIER+'.pending');writeFileSync(partial,'{',{mode:0o600});assert.throws(()=>activateRestore(v,r.reportDigest),{code:'RESTORE_ACTIVATION_EVIDENCE'});assert.equal(readFileSync(partial,'utf8'),'{');unlinkSync(partial);
  const stagePartial=join(f.root,'restore-stage-barrier.json.pending');writeFileSync(stagePartial,'{',{mode:0o600});assert.throws(()=>activateRestore(v,r.reportDigest),{code:'RESTORE_ACTIVATION_EVIDENCE'});assert.equal(readFileSync(stagePartial,'utf8'),'{');unlinkSync(stagePartial);
  const replay=activateRestore(v,r.reportDigest);assert.deepEqual(replay.receipt,done.receipt);assert.equal(replay.verification,'NOT_RUN');const owner=createStandaloneService(f.setup);await owner.close();
});

test('actual Java/Python tasks and archived worker references survive activation and a restarted installed owner executes new formal work',async()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Actual tools required');const f=fixture('formal'),selected=k=>({toolchainFile:process.env[k],toolchainDigest:JSON.parse(readFileSync(process.env[k])).digest});
  bindInstallationToolchains(f.i.root,{requestId:'tools',previousBindingDigest:null,dl:selected('EVOPILOT_TEST_DL_TOOLCHAIN'),shacl:selected('EVOPILOT_TEST_SHACL_TOOLCHAIN')});const configuration={reasoning:{toolchainFile:process.env.EVOPILOT_TEST_DL_TOOLCHAIN,workRoot:f.workRoot},validation:{toolchainFile:process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,workRoot:f.workRoot}};
  let s=createStandaloneService({...f.setup,...configuration});const model=prepareValidation(s,f),first=s.request(f.write('validation.start',{assetId:'services',modelDigest:model.modelDigest},'validate',5),f.token),oldTask=await terminal(s,f,first.result.taskId);assert.equal(oldTask.formalStatus,'MATCHED');await s.close();const snapshot=stage(f);
  const rotation=await inspectInstallationWorkerRotation(f.i.root);await rotateInstallationWorkerJournal(f.i.root,{requestId:'rotate',expectedReportDigest:rotation.reportDigest});
  s=createStandaloneService({...f.setup,...configuration});const revision=s.request(f.read('project.inspect'),f.token).revision,second=s.request(f.write('validation.start',{assetId:'services',modelDigest:model.modelDigest},'validate-current',revision),f.token),currentTask=await terminal(s,f,second.result.taskId);assert.equal(currentTask.formalStatus,'MATCHED');await s.close();const retained=stage(f),v=selection(f,snapshot,retained),r=inspectRestoreActivation(v),workerBefore=hash(backupInventory(f.i,['installation'])),done=activateRestore(v,r.reportDigest);assert.equal(hash(backupInventory(f.i,['installation'])),workerBefore);
  await cli('start','--installation',f.i.root);
  try{
    const connection=readConnection(join(f.i.root,'connection.json'));assert.deepEqual(await sendRequest(connection,f.read('validation.inspect',{taskId:first.result.taskId}),false),oldTask);assert.deepEqual(await sendRequest(connection,f.read('validation.inspect',{taskId:second.result.taskId}),false),currentTask);
    const project=await sendRequest(connection,f.read('project.inspect'),false),fresh=await sendRequest(connection,f.write('validation.start',{assetId:'services',modelDigest:model.modelDigest},done.receipt.requestIdPrefix+'new-validation',project.revision),true);let result;
    for(let n=0;n<1600;n++){result=await sendRequest(connection,f.read('validation.inspect',{taskId:fresh.result.taskId}),false);if(result.state==='FINISHED')break;await delay(25);}assert.equal(result.formalStatus,'MATCHED');
  }finally{await cli('stop','--installation',f.i.root);}
});
