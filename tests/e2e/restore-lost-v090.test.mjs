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
import {inspectInstallationBackup,backupInstallation,abortInstallationBackup} from '../../dist/installation/backup.js';
import {backupInventory,backupNode} from '../../dist/installation/backup-files.js';
import {inspectRestoreStage,stageInstallationRestore} from '../../dist/installation/restore-stage.js';
import {inspectLostRestore,activateLostRestore,abortLostRestore} from '../../dist/installation/restore-lost.js';
import {readArchiveCatalog,verifyJournalImage} from '../../dist/installation/worker-archives.js';
import {WORKER_STORAGE} from '../../dist/installation/worker-storage.js';
import {backupControlRecords} from '../../dist/installation/backup-control.js';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {readConnection,sendRequest} from '../../dist/standalone/client.js';
import {openWorkspace,RESTORE_ACTIVATION_BARRIER} from '../../dist/standalone/workspace.js';
import {grantReviewer,revokeReviewer} from '../../dist/installation/reviewer.js';
import {inspectInstallationWorkerRotation,rotateInstallationWorkerJournal} from '../../dist/installation/worker-rotation.js';
import {maintainInstallationWorkers} from '../../dist/installation/worker-maintenance.js';
import {reconcileInstallationTask} from '../../dist/installation/task-recovery.js';
import {hash,hashBytes} from '../../dist/standalone/validation.js';
import {definition,prepare as prepareModel} from '../helpers/v090-native.mjs';
import {prepare as prepareValidation,terminal} from '../helpers/v090-validation.mjs';

const source=fileURLToPath(new URL('../..',import.meta.url));let base,runtime,runtimeRoot,cliFile;
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:60000,maxBuffer:16*1024*1024,...options},(e,out,err)=>{if(e){let code;try{code=JSON.parse(out).error?.code;}catch{}reject(Object.assign(Error(out+'\n'+err),{code}));}else resolve(out);}));
const cli=async(...args)=>{const v=JSON.parse(await execute(process.execPath,[cliFile,...args,'--json'],{env:{...process.env,NODE_NO_WARNINGS:'1'}}));assert.equal(v.ok,true);return v.result;};
before(async()=>{base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-restore-lost-')));runtimeRoot=join(base,'runtime');mkdirSync(runtimeRoot,{mode:0o700});const pack=JSON.parse(await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',base],{cwd:source}));await execute('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',runtimeRoot,join(base,pack[0].filename)],{cwd:base});runtime=inspectRuntime(runtimeRoot);cliFile=join(runtime.packageRoot,'dist/standalone/cli.js');});
after(()=>{if(base)rmSync(base,{recursive:true,force:true});});
function fixture(name,mib=0){
  const i=prepareInstallation({root:join(base,name+'-installation'),workspaceRoot:join(base,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot,runtimeDigest:runtime.digest,mode:'create'}),token=readFileSync(i.credentialFile,'utf8');
  if(mib){const fd=openSync(join(i.workspaceRoot,'00-large'),'wx',0o600),block=Buffer.alloc(1024*1024,113);try{for(let n=0;n<mib;n++)writeSync(fd,block);}finally{closeSync(fd);}}
  const read=(operation,input={})=>({workspaceId:i.workspaceId,serviceId:i.serviceId,projectId:'demo',operation,input}),write=(operation,input,requestId,expectedRevision)=>({...read(operation,input),requestId,expectedRevision});
  return {i,root:i.workspaceRoot,setup:{...i,root:i.workspaceRoot},workRoot:join(i.root,'formal-work'),token,read,write,ordinal:0};
}
function stage(f){const n=++f.ordinal,backupRoot=join(base,f.i.workspaceId+'-backup-'+n),generation=JSON.parse(readFileSync(join(f.root,'identity.json'))).recovery?.generation,requestId=(generation?'r'+generation+'.':'')+'backup-'+n,r=inspectInstallationBackup(f.i.root,backupRoot,requestId),b=backupInstallation(f.i.root,{backupRoot,requestId,expectedReportDigest:r.reportDigest});const input={backupRoot,expectedManifestDigest:b.receipt.manifestDigest,stageRoot:join(base,f.i.workspaceId+'-stage-'+n),requestId:'stage-'+n},inspected=inspectRestoreStage(input),done=stageInstallationRestore(input,inspected.reportDigest);return {root:input.stageRoot,manifestDigest:done.receipt.manifestDigest};}
const selection=(f,snapshot,name='restore')=>({snapshot,recoveryRoot:join(base,f.i.workspaceId+'-'+name),requestId:name,rekeyExpiresAt:new Date(Date.now()+86400000).toISOString()});
const args=(command,v,report)=>[command,'--snapshot',v.snapshot.root,'--snapshot-manifest',v.snapshot.manifestDigest,'--recovery-root',v.recoveryRoot,'--request-id',v.requestId,'--rekey-expires-at',v.rekeyExpiresAt,...(report?['--expected-report',report]:[])];
function lose(f,suffix='lost'){for(const root of [f.i.root,f.root])renameSync(root,root+'-'+suffix);}
async function killed(v,report,observe){
  const child=spawn(process.execPath,[cliFile,...args('restore-lost-apply',v,report),'--json'],{stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_NO_WARNINGS:'1'}});let ended=false,didKill=false,output='';child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{ended=true;resolve({code,signal});});});
  try{const deadline=performance.now()+45000;while(!ended&&performance.now()<deadline){if(observe()){didKill=child.kill('SIGKILL');break;}await delay(1);}if(!didKill)child.kill('SIGKILL');const exit=await closed;assert.equal(didKill,true,output);assert.equal(exit.signal,'SIGKILL');return exit;}finally{if(!ended){child.kill('SIGKILL');await closed;}}
}

test('actual installed lost-owner restoration retains customizations and receipts, rekeys without reviewer authority and restarts for new business work',async()=>{
  const f=fixture('lost-basic'),grant=grantReviewer({...f.setup,projectId:'demo',principalId:'reviewer',grantId:'reviewer',expiresAt:new Date(Date.now()+86400000).toISOString()}),reviewer=readFileSync(grant.credentialFile,'utf8');
  let s=createStandaloneService(f.setup);const model=prepareModel(s,f),knownRequest=f.write('intent.record',{definition:{...definition,scope:'Retained exact receipt'},previousDigest:model.intentDigest},'known',4),known=s.request(knownRequest,f.token);await s.close();
  writeFileSync(join(f.i.root,'plugin/private-customization.txt'),'private customization\n',{mode:0o600});const snapshot=stage(f),backups=backupControlRecords(f.i),raw=readFileSync(join(f.root,'ontology.sqlite')),v=selection(f,snapshot);lose(f);
  const r=await cli(...args('restore-lost-inspect',v)),done=await cli(...args('restore-lost-apply',v,r.reportDigest));assert.equal(done.status,'ACTIVATED');assert.equal(done.serviceStarted,false);assert.equal(done.receipt.credentialPolicy,'REKEY_LOST_OWNER');assert.equal(readFileSync(join(f.i.root,'plugin/private-customization.txt'),'utf8'),'private customization\n');assert.deepEqual(backupControlRecords(f.i),backups);assert.deepEqual(readFileSync(join(f.root+'-lost','ontology.sqlite')),raw);
  const token=readFileSync(f.i.credentialFile,'utf8');assert.notEqual(token,f.token);s=createStandaloneService(f.setup);assert.equal(s.context(token).recovery.decisionHeadPolicy,'SELECTED_SNAPSHOT_LATER_DECISIONS_UNKNOWN');
  try{assert.throws(()=>s.context(f.token),{code:'UNAUTHENTICATED'});assert.throws(()=>s.context(reviewer),{code:'UNAUTHENTICATED'});assert.deepEqual(s.request(knownRequest,token),known);assert.throws(()=>s.request({...knownRequest,requestId:'missing'},token),{code:'REQUEST_OUTCOME_UNKNOWN'});assert.deepEqual(s.context(token).permissions,['read','write']);}finally{await s.close();}
  await cli('start','--installation',f.i.root);
  try{const connection=readConnection(join(f.i.root,'connection.json')),project=await sendRequest(connection,f.read('project.inspect'),false);const fresh=await sendRequest(connection,f.write('intent.record',{definition:{...definition,scope:'After loss recovery'},previousDigest:known.result.intentDigest},done.receipt.requestIdPrefix+'fresh',project.revision),true);assert.equal(fresh.revision,project.revision+1);assert.deepEqual((await cli(...args('restore-lost-apply',v,r.reportDigest))).receipt,done.receipt);}finally{await cli('stop','--installation',f.i.root);}
  rmSync(snapshot.root,{recursive:true});lose(f,'unavailable');assert.deepEqual(activateLostRestore(v,r.reportDigest).receipt,done.receipt);
});

test('mixed loss, occupied destinations, expired credential admission and changed snapshots cannot overwrite an existing owner',async()=>{
  const f=fixture('refusal'),s=createStandaloneService(f.setup);prepareModel(s,f);await s.close();const snapshot=stage(f),v=selection(f,snapshot);
  assert.throws(()=>inspectLostRestore(v),{code:'RESTORE_LOCATION_CONFLICT'});renameSync(f.root,f.root+'-lost');assert.throws(()=>inspectLostRestore(v),{code:'RESTORE_LOCATION_CONFLICT'});renameSync(f.i.root,f.i.root+'-lost');
  assert.throws(()=>inspectLostRestore({...v,rekeyExpiresAt:'2001-01-01T00:00:00.000Z'}),{code:'INVALID_INPUT'});const r=inspectLostRestore(v);mkdirSync(f.i.root,{mode:0o700});writeFileSync(join(f.i.root,'foreign'),'preserve',{mode:0o600});assert.throws(()=>activateLostRestore(v,r.reportDigest),{code:'RESTORE_LOCATION_CONFLICT'});assert.equal(readFileSync(join(f.i.root,'foreign'),'utf8'),'preserve');assert.equal(existsSync(v.recoveryRoot),false);
});

test('installed backup commands preserve old receipts, refuse absent older requests without mutation and admit genuinely new recovery-namespace work',async()=>{
  const f=fixture('operator-backup'),s=createStandaloneService(f.setup);prepareModel(s,f);await s.close();const snapshot=stage(f),known=backupControlRecords(f.i)[0],v=selection(f,snapshot);lose(f);const r=inspectLostRestore(v),done=activateLostRestore(v,r.reportDigest),prefix=done.receipt.requestIdPrefix,backupRoot=join(base,'post-restore-backup'),before=hash(backupInventory(f.i)),history=backupControlRecords(f.i);
  const original=await cli('backup-apply','--installation',f.i.root,'--backup',known.backupRoot,'--request-id',known.requestId,'--expected-report',known.reportDigest);assert.equal(original.replayed,true);assert.deepEqual(original.receipt,known.receipt);
  await assert.rejects(cli('backup-inspect','--installation',f.i.root,'--backup',backupRoot,'--request-id','old-missing'),{code:'REQUEST_OUTCOME_UNKNOWN'});
  await assert.rejects(cli('backup-apply','--installation',f.i.root,'--backup',backupRoot,'--request-id','old-missing','--expected-report',known.reportDigest),{code:'REQUEST_OUTCOME_UNKNOWN'});
  await assert.rejects(cli('backup-abort','--installation',f.i.root,'--request-id','old-missing','--expected-report',known.reportDigest),{code:'REQUEST_OUTCOME_UNKNOWN'});
  assert.throws(()=>abortInstallationBackup(f.i.root,prefix+'not-admitted',known.reportDigest),{code:'BACKUP_MISSING'});assert.equal(existsSync(backupRoot),false);assert.equal(hash(backupInventory(f.i)),before);assert.deepEqual(backupControlRecords(f.i),history);
  const inspect=await cli('backup-inspect','--installation',f.i.root,'--backup',backupRoot,'--request-id',prefix+'new-backup'),created=await cli('backup-apply','--installation',f.i.root,'--backup',backupRoot,'--request-id',prefix+'new-backup','--expected-report',inspect.reportDigest);assert.equal(created.replayed,false);assert.equal(created.receipt.requestId,prefix+'new-backup');assert.equal(hash(backupInventory(f.i)),before);assert.equal(backupControlRecords(f.i).length,history.length+1);
  const changed={...known,requestId:'old-missing'};assert.throws(()=>backupInstallation(f.i.root,{backupRoot,requestId:changed.requestId,expectedReportDigest:inspect.reportDigest}),{code:'REQUEST_OUTCOME_UNKNOWN'});
});

for(const phase of ['copying','installation-copying','prepared','installation-moved','workspace-moved'])test('actual installed lost-owner SIGKILL at '+phase+' resumes the exact generation and never releases an incomplete owner',async()=>{
  const f=fixture('kill-'+phase,64),s=createStandaloneService(f.setup);prepareModel(s,f);await s.close();
  if(phase==='installation-copying'){renameSync(join(f.root,'00-large'),join(f.i.root,'00-large'));}
  const snapshot=stage(f),v=selection(f,snapshot);lose(f);const r=inspectLostRestore(v),payload=phase==='installation-copying'?join(v.recoveryRoot,'installation/00-large'):join(v.recoveryRoot,'state/workspace/00-large');
  await killed(v,r.reportDigest,()=>phase.endsWith('copying')?existsSync(payload)&&lstatSync(payload).size>1024*1024&&lstatSync(payload).size<64*1024*1024:existsSync(join(v.recoveryRoot,phase+'.json'))&&!existsSync(join(v.recoveryRoot,'activated.json')));
  const admission=readFileSync(join(v.recoveryRoot,'plan.json'));if(existsSync(f.root))assert.throws(()=>openWorkspace(f.root,f.i),e=>['RESTORE_STAGED','RESTORE_ACTIVATION_PENDING'].includes(e.code));
  if(['installation-moved','workspace-moved'].includes(phase)){assert.throws(()=>abortLostRestore(v.recoveryRoot,v.requestId,r.reportDigest),{code:'RESTORE_SWITCH_ADMITTED'});rmSync(snapshot.root,{recursive:true});}
  const done=activateLostRestore(v,r.reportDigest);assert.equal(done.status,'ACTIVATED');assert.deepEqual(readFileSync(join(v.recoveryRoot,'plan.json')),admission);const token=readFileSync(f.i.credentialFile,'utf8'),owner=createStandaloneService(f.setup);try{assert.equal(owner.context(token).recovery.requestIdPrefix,done.receipt.requestIdPrefix);}finally{await owner.close();}
});

test('an interrupted corrupt candidate is preserved and explicit abort leaves original destinations absent',async()=>{
  const f=fixture('abort',64),s=createStandaloneService(f.setup);prepareModel(s,f);await s.close();const snapshot=stage(f),v=selection(f,snapshot);lose(f);const r=inspectLostRestore(v),file=join(v.recoveryRoot,'state/workspace/00-large');await killed(v,r.reportDigest,()=>existsSync(file)&&lstatSync(file).size>1024*1024&&lstatSync(file).size<64*1024*1024);
  const data=readFileSync(file);data[0]^=1;writeFileSync(file,data);assert.throws(()=>activateLostRestore(v,r.reportDigest),{code:'RESTORE_EVIDENCE'});const result=await cli('restore-lost-abort','--recovery-root',v.recoveryRoot,'--request-id',v.requestId,'--expected-report',r.reportDigest);assert.equal(result.receipt.cutover,'NOT_STARTED');assert.deepEqual(readFileSync(file),data);assert.equal(existsSync(f.i.root),false);assert.equal(existsSync(f.root),false);assert.throws(()=>activateLostRestore(v,r.reportDigest),{code:'RESTORE_ABORTED'});
});

test('committed lost-owner cleanup refuses foreign and ambiguous barriers while retaining exact historical completion',async()=>{
  const f=fixture('cleanup'),s=createStandaloneService(f.setup);prepareModel(s,f);await s.close();const snapshot=stage(f),v=selection(f,snapshot);lose(f);const r=inspectLostRestore(v),done=activateLostRestore(v,r.reportDigest),p=JSON.parse(readFileSync(join(v.recoveryRoot,'prepared.json')));
  // Explicit synthetic cleanup metadata; actual killed directory transitions
  // are covered independently above.
  unlinkSync(join(v.recoveryRoot,'released.json'));rmSync(snapshot.root,{recursive:true});const stageMarker=join(f.root,'restore-stage-barrier.json'),barrier=join(f.i.root,RESTORE_ACTIVATION_BARRIER),marker={schema:'ontology-restore-activation-barrier/v1',root:f.i.root,recoveryRoot:v.recoveryRoot,installationId:f.i.installationId,workspaceId:f.i.workspaceId,serviceId:f.i.serviceId,requestId:v.requestId,requestDigest:r.reportDigest};
  writeFileSync(stageMarker,JSON.stringify(p.stageBarrier)+'\n',{mode:0o600});writeFileSync(barrier,JSON.stringify({...marker,requestId:'foreign'})+'\n',{mode:0o600});assert.throws(()=>activateLostRestore(v,r.reportDigest),{code:'RESTORE_EVIDENCE'});assert.equal(existsSync(stageMarker),true);
  writeFileSync(barrier,JSON.stringify(marker)+'\n');writeFileSync(barrier+'.pending','{',{mode:0o600});assert.throws(()=>activateLostRestore(v,r.reportDigest),{code:'RESTORE_EVIDENCE'});assert.equal(readFileSync(barrier+'.pending','utf8'),'{');unlinkSync(barrier+'.pending');writeFileSync(stageMarker+'.pending','{',{mode:0o600});assert.throws(()=>activateLostRestore(v,r.reportDigest),{code:'RESTORE_EVIDENCE'});unlinkSync(stageMarker+'.pending');
  const replay=activateLostRestore(v,r.reportDigest);assert.deepEqual(replay.receipt,done.receipt);assert.equal(replay.verification,'NOT_RUN');const owner=createStandaloneService(f.setup);await owner.close();
});

test('real Java/Python archived worker tasks retain original references across two lost-owner restores, intervening rotation and new installed formal work',async()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Actual tools required');const f=fixture('worker'),selected=k=>({toolchainFile:process.env[k],toolchainDigest:JSON.parse(readFileSync(process.env[k])).digest});bindInstallationToolchains(f.i.root,{requestId:'tools',previousBindingDigest:null,dl:selected('EVOPILOT_TEST_DL_TOOLCHAIN'),shacl:selected('EVOPILOT_TEST_SHACL_TOOLCHAIN')});
  const configuration={reasoning:{toolchainFile:process.env.EVOPILOT_TEST_DL_TOOLCHAIN,workRoot:f.workRoot},validation:{toolchainFile:process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,workRoot:f.workRoot}},s=createStandaloneService({...f.setup,...configuration}),model=prepareValidation(s,f),first=s.request(f.write('validation.start',{assetId:'services',modelDigest:model.modelDigest},'validate',5),f.token),oldTask=await terminal(s,f,first.result.taskId);assert.equal(oldTask.formalStatus,'MATCHED');await s.close();
  const rotation=await inspectInstallationWorkerRotation(f.i.root),rotated=await rotateInstallationWorkerJournal(f.i.root,{requestId:'rotate',expectedReportDigest:rotation.reportDigest}),originalCatalog=readFileSync(join(f.workRoot,'worker-archives.json'));const snapshot=stage(f),v=selection(f,snapshot);lose(f);const unsafe=join(JSON.parse(readFileSync(process.env.EVOPILOT_TEST_DL_TOOLCHAIN)).root,'unselected-recovery');assert.throws(()=>inspectLostRestore({...v,recoveryRoot:unsafe}),{code:'UNSAFE_PATH'});assert.equal(existsSync(unsafe),false);const r=inspectLostRestore(v),done=activateLostRestore(v,r.reportDigest);assert.deepEqual(readFileSync(join(f.workRoot,'worker-archives.json')),originalCatalog);assert.deepEqual((await inspectInstallationWorkerRotation(f.i.root,'rotate')).receipt,rotated.receipt);
  const firstLineage=JSON.parse(readFileSync(join(f.workRoot,WORKER_STORAGE)));assert.equal(firstLineage.records.length,1);const move=firstLineage.records[0].generation.journals[0];assert.notEqual(move.original.inode,move.restored.inode);assert.equal(move.original.digest,move.restored.digest);
  const prefix=done.receipt.requestIdPrefix,toolHistory=JSON.parse(readFileSync(join(f.i.root,'toolchain-bindings.json'))),originalTools=toolHistory.records[0],currentTools={requestId:'missing-tools',previousBindingDigest:originalTools.digest,dl:originalTools.binding.dl,shacl:originalTools.binding.shacl},unchanged=hash(backupInventory(f.i));
  assert.equal(bindInstallationToolchains(f.i.root,{...currentTools,requestId:'tools',previousBindingDigest:null}).replayed,true);assert.throws(()=>bindInstallationToolchains(f.i.root,currentTools),{code:'REQUEST_OUTCOME_UNKNOWN'});
  await assert.rejects(inspectInstallationWorkerRotation(f.i.root,'missing-rotation'),{code:'REQUEST_OUTCOME_UNKNOWN'});await assert.rejects(inspectInstallationWorkerRotation(f.i.root,prefix+'never-rotated'),{code:'WORKER_ROTATION_MISSING'});
  await assert.rejects(rotateInstallationWorkerJournal(f.i.root,{requestId:'missing-rotation',expectedReportDigest:rotation.reportDigest}),{code:'REQUEST_OUTCOME_UNKNOWN'});
  await assert.rejects(maintainInstallationWorkers(f.i.root,{projectId:'demo',taskId:first.result.taskId,requestId:'missing-cleanup',expectedReportDigest:rotation.reportDigest}),{code:'REQUEST_OUTCOME_UNKNOWN'});
  assert.throws(()=>reconcileInstallationTask(f.i.root,{projectId:'demo',taskId:first.result.taskId,requestId:'missing-reconcile',expectedReportDigest:rotation.reportDigest}),{code:'REQUEST_OUTCOME_UNKNOWN'});assert.throws(()=>reconcileInstallationTask(f.i.root,{projectId:'demo',taskId:'task-not-in-snapshot',requestId:'missing-reconcile',expectedReportDigest:rotation.reportDigest}),{code:'REQUEST_OUTCOME_UNKNOWN'});assert.equal(hash(backupInventory(f.i)),unchanged);
  const rebind=bindInstallationToolchains(f.i.root,{...currentTools,requestId:prefix+'new-tools'});assert.equal(rebind.replayed,false);assert.equal(bindInstallationToolchains(f.i.root,{...currentTools,requestId:prefix+'new-tools'}).replayed,true);
  await cli('start','--installation',f.i.root);let fresh,freshTask;
  try{const connection=readConnection(join(f.i.root,'connection.json'));assert.deepEqual(await sendRequest(connection,f.read('validation.inspect',{taskId:first.result.taskId}),false),oldTask);const project=await sendRequest(connection,f.read('project.inspect'),false);fresh=await sendRequest(connection,f.write('validation.start',{assetId:'services',modelDigest:model.modelDigest},done.receipt.requestIdPrefix+'validation',project.revision),true);for(let n=0;n<1600;n++){freshTask=await sendRequest(connection,f.read('validation.inspect',{taskId:fresh.result.taskId}),false);if(freshTask.state==='FINISHED')break;await delay(25);}assert.equal(freshTask.formalStatus,'MATCHED');}finally{await cli('stop','--installation',f.i.root);}
  const secondRotation=await inspectInstallationWorkerRotation(f.i.root);await rotateInstallationWorkerJournal(f.i.root,{requestId:done.receipt.requestIdPrefix+'rotate-two',expectedReportDigest:secondRotation.reportDigest});const nextSnapshot=stage(f),next=selection(f,nextSnapshot,'second');lose(f,'second-lost');const inspected=await cli(...args('restore-lost-inspect',next)),second=await cli(...args('restore-lost-apply',next,inspected.reportDigest));assert.notEqual(second.receipt.requestIdPrefix,done.receipt.requestIdPrefix);
  const lineage=JSON.parse(readFileSync(join(f.workRoot,WORKER_STORAGE)));assert.deepEqual(lineage.records[0],firstLineage.records[0]);assert.equal(lineage.records[1].generation.journals.length,2);assert.deepEqual(lineage.records[1].generation.journals[0].previous,move.restored);
  await cli('start','--installation',f.i.root);try{const connection=readConnection(join(f.i.root,'connection.json'));assert.deepEqual(await sendRequest(connection,f.read('validation.inspect',{taskId:first.result.taskId}),false),oldTask);assert.deepEqual(await sendRequest(connection,f.read('validation.inspect',{taskId:fresh.result.taskId}),false),freshTask);}finally{await cli('stop','--installation',f.i.root);}
  const archive=readArchiveCatalog(f.workRoot).archives[0].plan.source,file=join(f.workRoot,archive.file),bytes=readFileSync(file);renameSync(file,file+'.held');writeFileSync(file,bytes,{mode:0o600});assert.throws(()=>verifyJournalImage(f.workRoot,archive),{code:'WORKER_ARCHIVE_EVIDENCE'});unlinkSync(file);renameSync(file+'.held',file);verifyJournalImage(f.workRoot,archive);
  const lineageFile=join(f.workRoot,WORKER_STORAGE),raw=readFileSync(lineageFile);writeFileSync(lineageFile,JSON.stringify({...lineage,records:lineage.records.slice(1)}));assert.throws(()=>verifyJournalImage(f.workRoot,archive),{code:'WORKER_STORAGE_EVIDENCE'});writeFileSync(lineageFile,raw);verifyJournalImage(f.workRoot,archive);
});
