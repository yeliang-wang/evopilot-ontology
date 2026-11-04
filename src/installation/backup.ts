import {mkdirSync,readdirSync,unlinkSync,openSync,closeSync,fsyncSync} from 'node:fs';
import {join,dirname,basename,resolve,isAbsolute} from 'node:path';
import type {Json} from '../standalone/types.js';
import {fail} from '../standalone/types.js';
import {exact,id,digest} from '../standalone/validation.js';
import {openWorkspace,privatePath,privateRead,readMaintenanceBarrier,requireMaintenanceAvailable,MAINTENANCE_FILE} from '../standalone/workspace.js';
import type {WorkspaceStore,MaintenanceBarrier,MaintenancePermit} from '../standalone/workspace.js';
import {readInstallation,currentRun} from './manager.js';
import type {Installation} from './manager.js';
import {operatorLock,outsideSource,assertSeparate} from './files.js';
import {verifyRuntime} from './runtime.js';
import {processPresent} from './control.js';
import {readToolchainLedger} from './toolchains.js';
import {readDLToolchain} from '../reasoning/toolchain.js';
import {readSHACLToolchain} from '../native-v2/shacl-toolchain.js';
import {completedTaskWorkerEvidence} from '../native-v2/task-recovery.js';
import {requireWorkerMaintenanceComplete,currentWorkerAttempts,withWorkerJournalHistory} from './worker-journal.js';
import {workerFilePresent} from './worker-archives.js';
import {BACKUP_LIMITS,backupHash,backupRequestDigest,backupReceipt,validateBackupPlan,validateBackupOwner} from './backup-contract.js';
import type {BackupPlan,BackupOwner,BackupRecord,BackupEnvelope,AbortReceipt} from './backup-contract.js';
import {backupNode,backupInventory,readBackupPlan,copyBackupObject,verifyBackupObjects,verifyBackup,writeBackupJSON} from './backup-files.js';

import {backupControlRecords as records,saveBackupControl as save,pendingBackupCompletion} from './backup-control.js';

interface Request {backupRoot:string;requestId:string;expectedReportDigest:string;}
const equal=(a:unknown,b:unknown)=>backupHash(a)===backupHash(b);
const syncDirectory=(root:string)=>{const fd=openSync(root,'r');try{fsyncSync(fd);}finally{closeSync(fd);}};
function target(i:Installation,path:string):string {
  if(!isAbsolute(path)||resolve(path)!==path)fail('UNSAFE_PATH','Canonical absolute backup destination required');
  const parent=dirname(path);privatePath(parent,true);if(outsideSource(parent)!==parent)fail('UNSAFE_PATH','Canonical private backup parent required');
  for(const root of [i.root,i.workspaceRoot,i.runtime.root])assertSeparate(path,root);
  return join(parent,basename(path));
}
function marker(i:Installation,r:BackupRecord,root:string):MaintenanceBarrier {
  return {schema:'ontology-maintenance-barrier/v1',operation:'BACKUP',root,backupRoot:r.backupRoot,installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,requestId:r.requestId,requestDigest:r.requestDigest,reportDigest:r.reportDigest};
}
function barrierRoots(i:Installation):string[] {
  const worker=join(i.root,'formal-work');return [i.workspaceRoot,i.root,...(workerFilePresent(worker)?[worker]:[])];
}
function barriers(i:Installation,r:BackupRecord,action:'check'|'set'|'clear'):void {
  const roots=barrierRoots(i);if(action==='clear')roots.reverse();
  // Validate every existing marker before removing any; a foreign marker is
  // never silently adopted or deleted, including during explicit abort.
  for(const root of roots){const found=readMaintenanceBarrier(root);if(found&&!equal(found,marker(i,r,root)))fail('BACKUP_PENDING','Another maintenance owner holds this root',409);}
  for(const root of roots){
    let found=readMaintenanceBarrier(root);const file=join(root,MAINTENANCE_FILE);
    if(action==='clear'&&workerFilePresent(file+'.pending')){writeBackupJSON(file,marker(i,r,root));found=readMaintenanceBarrier(root);}
    if(action==='set'&&!found)writeBackupJSON(file,marker(i,r,root));
    if(action==='clear'&&found){unlinkSync(file);syncDirectory(root);}
  }
}
function clearTerminalBarriers(i:Installation,r:BackupRecord):void {
  barriers(i,r,'check');
  if(!barrierRoots(i).some(root=>workerFilePresent(join(root,MAINTENANCE_FILE))||workerFilePresent(join(root,MAINTENANCE_FILE+'.pending'))))return;
  const store=openWorkspace(i.workspaceRoot,i,r);try{barriers(i,r,'clear');}finally{store.close();}
}
function stopped(i:Installation):void {
  const run=currentRun(i);
  if(run&&!['STOPPED','FAILED'].includes(run.state)&&processPresent(run.pid)!==false)fail('INSTALLATION_RUNNING','Stop the exact owner before backup',409);
}
function makePlan(i:Installation,store:WorkspaceStore,backupRoot:string,priorBackups:BackupRecord[]):BackupPlan {
  verifyRuntime(i.runtime);stopped(i);
  const ledger=readToolchainLedger(i),binding=ledger.records.at(-1)??null,run=currentRun(i);
  if(run?.toolchainBindingDigest&&!ledger.records.some(r=>r.digest===run.toolchainBindingDigest))fail('TOOLCHAIN_BINDING_MISSING','Managed run requires its original tool history',409);
  const tasks=store.db.prepare('SELECT id,project_id,state FROM native_reasoning_tasks ORDER BY id LIMIT 4097').all();
  if(tasks.length>4096)fail('BACKUP_LIMIT','Formal task inventory exceeds backup budget',409);
  if(tasks.some(t=>t.state!=='FINISHED'))fail('TASK_RECOVERY_REQUIRED','Resolve unfinished formal tasks before backup',409);
  let workerAttempts=0,workerJournals=0;const roots:string[]=[];
  if(binding){
    const b=binding.binding,root=b.workRoot;roots.push(root);privatePath(root,true);
    if(!equal(JSON.parse(privateRead(join(root,'owner.json'),4096)),{schema:'ontology-managed-work/v1',installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,root}))fail('WORK_ROOT_CONFLICT','Foreign worker root',409);
    const dl=readDLToolchain(b.dl.toolchainFile),shacl=readSHACLToolchain(b.shacl.toolchainFile);
    if(dl.digest!==b.dl.toolchainDigest||shacl.digest!==b.shacl.toolchainDigest)fail('TOOLCHAIN_BINDING_DRIFT','Original toolchain manifest differs',409);
    for(const external of [dl.root,dl.javaRoot,shacl.root,shacl.runtimeRoot])assertSeparate(backupRoot,external);
    requireWorkerMaintenanceComplete(root);
    const counts=withWorkerJournalHistory(root,j=>Number(j.db.prepare('SELECT count(*) AS n FROM attempts').get()!.n));
    if(counts.some(n=>n>4096))fail('BACKUP_LIMIT','Worker history exceeds backup budget',409);workerJournals=counts.length;workerAttempts=counts.reduce((n,c)=>n+c,0);
    if(workerJournals)for(const a of currentWorkerAttempts(root).attempts){
      if(!a.outcome||a.intent.systemd&&(a.unit&&!a.terminal||!a.unit&&(!a.fence||a.outcome.state!=='NOT_STARTED')))fail('WORKER_EXIT_UNPROVEN','Worker exit evidence is required before backup',409);
    }
  }
  for(const t of tasks)completedTaskWorkerEvidence(store,String(t.project_id),String(t.id),roots);
  store.guard();
  const plan:BackupPlan={schema:'ontology-backup-plan/v1',installation:i,backupRoot,targetParent:backupNode(dirname(backupRoot)),roots:{installation:backupNode(i.root),workspace:backupNode(i.workspaceRoot)},entries:backupInventory(i),priorBackups,toolchainBindingDigest:binding?.digest??null,formalTasks:tasks.length,workerAttempts,workerJournals};
  validateBackupPlan(plan);return plan;
}
function assertSource(i:Installation,store:WorkspaceStore,plan:BackupPlan,r:BackupRecord):void {
  store.guard();barriers(i,r,'check');
  if(!equal(readInstallation(i.root),plan.installation)||!equal(backupNode(i.root),plan.roots.installation)||!equal(backupNode(i.workspaceRoot),plan.roots.workspace)||!equal(backupNode(dirname(r.backupRoot)),plan.targetParent)||!equal(backupInventory(i),plan.entries)||!equal(records(i).filter(v=>v.requestId!==r.requestId),plan.priorBackups))fail('BACKUP_SOURCE_CHANGED','Inspected source changed; preserve partial copy and abort the original backup',409);
}
function destination(plan:BackupPlan,r:BackupRecord):BackupOwner {
  const root=plan.backupRoot,objects=join(root,'objects'),ownerFile=join(root,'owner.json');
  if(!workerFilePresent(root)){mkdirSync(root,{mode:0o700});syncDirectory(dirname(root));}privatePath(root,true);
  let owner:BackupOwner;
  if(workerFilePresent(ownerFile)){const v:unknown=JSON.parse(privateRead(ownerFile,65536));validateBackupOwner(v,plan);owner=v;}
  else{
    const names=readdirSync(root);if(names.some(n=>!['objects','owner.json.pending'].includes(n)))fail('BACKUP_EVIDENCE','Unowned destination material was preserved',409);
    if(!workerFilePresent(objects)){mkdirSync(objects,{mode:0o700});syncDirectory(root);}privatePath(objects,true);
    if(readdirSync(objects).length)fail('BACKUP_EVIDENCE','Unowned object directory is occupied',409);
    owner={schema:'ontology-backup-owner/v1',installationId:r.installationId,workspaceId:r.workspaceId,serviceId:r.serviceId,requestId:r.requestId,requestDigest:r.requestDigest,reportDigest:r.reportDigest,backupRoot:root,root:backupNode(root),objects:backupNode(objects)};writeBackupJSON(ownerFile,owner);
  }
  if(owner.requestId!==r.requestId||owner.requestDigest!==r.requestDigest||!equal(backupNode(root),owner.root)||!equal(backupNode(objects),owner.objects))fail('BACKUP_EVIDENCE','Destination owner or physical identity changed',409);
  if(workerFilePresent(join(root,'plan.json'))){if(!equal(readBackupPlan(root),plan))fail('BACKUP_EVIDENCE','Destination plan differs',409);}else writeBackupJSON(join(root,'plan.json'),plan);
  if(readdirSync(root).some(n=>!['owner.json','plan.json','plan.json.pending','objects','manifest.json','manifest.json.pending'].includes(n)))fail('BACKUP_EVIDENCE','Unselected destination material was preserved',409);
  return owner;
}
function request(i:Installation,input:Request):BackupRecord {
  exact(input,['backupRoot','requestId','expectedReportDigest']);id(input.requestId);digest(input.expectedReportDigest);
  if(!isAbsolute(input.backupRoot)||resolve(input.backupRoot)!==input.backupRoot)fail('UNSAFE_PATH','Canonical absolute backup reference required');
  return {schema:'ontology-backup-request/v1',installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,requestId:input.requestId,requestDigest:backupRequestDigest(i,input.backupRoot,input.expectedReportDigest),reportDigest:input.expectedReportDigest,backupRoot:input.backupRoot,state:'PENDING',receipt:null};
}
export function inspectInstallationBackup(path:string,backupRoot:string,requestId:string):Json {
  id(requestId);const i=readInstallation(path),unlock=operatorLock(i.root);
  try{
    const history=records(i),saved=history.find(r=>r.requestId===requestId);
    if(saved){if(saved.backupRoot!==backupRoot)fail('REQUEST_CONFLICT','Backup request binds another destination',409);return {status:saved.state,requestId,reportDigest:saved.reportDigest,receipt:saved.receipt as unknown as Json,authority:false};}
    target(i,backupRoot);
    if(history.some(r=>r.state==='PENDING'))fail('BACKUP_PENDING','Resolve the original backup first',409);
    if(history.length>=BACKUP_LIMITS.requests)fail('BACKUP_LIMIT','Backup request history is full',409);
    requireMaintenanceAvailable(i.root);stopped(i);if(workerFilePresent(backupRoot))fail('BACKUP_EXISTS','A new backup requires an absent destination',409);
    const store=openWorkspace(i.workspaceRoot,i);try{const plan=makePlan(i,store,backupRoot,history);return {status:'READY',requestId,report:plan as unknown as Json,reportDigest:backupHash(plan),authority:false};}finally{store.close();}
  }finally{unlock();}
}
export function backupInstallation(path:string,input:Request):Json {
  const i=readInstallation(path),unlock=operatorLock(i.root);
  try{
    const selected=request(i,input),history=records(i);let r=history.find(v=>v.requestId===input.requestId);
    if(r&&r.requestDigest!==selected.requestDigest)fail('REQUEST_CONFLICT','Backup request ID binds different parameters',409);
    if(r?.state==='ABORTED')fail('BACKUP_ABORTED','Original backup was aborted; inspect its retained receipt',409);
    if(r?.state==='COMPLETED'){clearTerminalBarriers(i,r);return {receipt:r.receipt as unknown as Json,replayed:true,verification:'NOT_RUN',authority:false};}
    if(r){
      const completed=pendingBackupCompletion(r);
      if(completed){barriers(i,r,'check');save(i,{...r,state:'COMPLETED',receipt:completed.receipt},true);clearTerminalBarriers(i,r);return {receipt:completed.receipt as unknown as Json,replayed:false,verification:'NOT_RUN',completionReconciled:true,authority:false};}
    }
    target(i,input.backupRoot);
    if(history.some(v=>v.state==='PENDING'&&v.requestId!==input.requestId))fail('BACKUP_PENDING','Another backup request is unfinished',409);
    barriers(i,selected,'check');stopped(i);
    const permit:MaintenancePermit=selected,store=openWorkspace(i.workspaceRoot,i,permit);
    try{
      let plan:BackupPlan;
      if(r&&workerFilePresent(join(r.backupRoot,'plan.json'))){plan=readBackupPlan(r.backupRoot);if(backupHash(plan)!==r.reportDigest)fail('BACKUP_EVIDENCE','Original backup plan differs',409);}
      else{
        if(!r&&workerFilePresent(input.backupRoot))fail('BACKUP_EXISTS','A new backup requires an absent destination',409);
        if(!r&&history.length>=BACKUP_LIMITS.requests)fail('BACKUP_LIMIT','Backup request history is full',409);
        plan=makePlan(i,store,input.backupRoot,history.filter(v=>v.requestId!==input.requestId));
        if(backupHash(plan)!==input.expectedReportDigest)fail('BACKUP_SOURCE_CHANGED','Source differs from the reviewed backup inventory',409);
      }
      if(!r){r=selected;save(i,r);}
      const owner=destination(plan,r);barriers(i,r,'set');
      let envelope:BackupEnvelope;
      if(workerFilePresent(join(r.backupRoot,'manifest.json'))){
        const raw:unknown=JSON.parse(privateRead(join(r.backupRoot,'manifest.json'),BACKUP_LIMITS.manifestBytes));exact(raw,['manifest','manifestDigest','receipt']);digest(raw.manifestDigest);
        envelope=verifyBackup(r.backupRoot,raw.manifestDigest);
      }else{
        assertSource(i,store,plan,r);
        for(const e of plan.entries){store.guard();if(e.kind==='file')copyBackupObject(plan,owner,e);}
        verifyBackupObjects(r.backupRoot,owner,plan);syncDirectory(join(r.backupRoot,'objects'));assertSource(i,store,plan,r);
        const manifest={schema:'ontology-backup-manifest/v1' as const,requestId:r.requestId,requestDigest:r.requestDigest,plan,reportDigest:r.reportDigest};
        envelope={manifest,manifestDigest:backupHash(manifest),receipt:backupReceipt(manifest)};writeBackupJSON(join(r.backupRoot,'manifest.json'),envelope);
      }
      const verified=verifyBackup(r.backupRoot,envelope.manifestDigest);
      save(i,{...r,state:'COMPLETED',receipt:verified.receipt},true);barriers(i,r,'clear');
      return {receipt:verified.receipt as unknown as Json,replayed:false,verification:'VERIFIED',objects:verified.objects,storedBytes:verified.storedBytes,authority:false};
    }finally{store.close();}
  }finally{unlock();}
}
export function abortInstallationBackup(path:string,requestId:string,expectedReportDigest:string):Json {
  id(requestId);digest(expectedReportDigest);const i=readInstallation(path),unlock=operatorLock(i.root);
  try{
    const r=records(i).find(v=>v.requestId===requestId);if(!r)fail('BACKUP_MISSING','Original backup request is not retained',404);
    if(r.reportDigest!==expectedReportDigest)fail('REQUEST_CONFLICT','Backup report differs from original request',409);
    if(r.state==='COMPLETED')fail('BACKUP_COMPLETED','Completed backup cannot be aborted',409);
    if(r.state==='ABORTED'){clearTerminalBarriers(i,r);return {receipt:r.receipt as unknown as Json,replayed:true,authority:false};}
    let completed:BackupEnvelope|null=null;
    // An explicit abort depends on the retained owner request, not on a healthy
    // destination. Unreadable/foreign completion bytes remain untouched.
    try{completed=pendingBackupCompletion(r);}catch{}
    if(completed)fail('BACKUP_COMPLETED_PENDING','A matching durable manifest exists; resume backup-apply to retain its original receipt and verify payload health separately',409);
    barriers(i,r,'check');stopped(i);
    const store=openWorkspace(i.workspaceRoot,i,r);
    try{
      const receipt:AbortReceipt={schema:'ontology-backup-abort-receipt/v1',requestId:r.requestId,requestDigest:r.requestDigest,reportDigest:r.reportDigest,backupRoot:r.backupRoot,partialCopyRetained:true,authority:false};
      save(i,{...r,state:'ABORTED',receipt},true);barriers(i,r,'clear');return {receipt:receipt as unknown as Json,replayed:false,authority:false};
    }finally{store.close();}
  }finally{unlock();}
}
