import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdirSync,readdirSync,lstatSync,unlinkSync,rmdirSync,openSync,closeSync,fsyncSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {readInstallation,currentRun} from './manager.js';
import type {Installation} from './manager.js';
import {operatorLock} from './files.js';
import {verifyRuntime,fileDigest} from './runtime.js';
import {processPresent} from './control.js';
import {writeBackupJSON} from './backup-files.js';
import {WORKSPACE_TABLES} from './workspace.js';
import {currentToolchainBinding} from './toolchains.js';
import {requireWorkerMaintenanceComplete,readWorkerAttempt} from './worker-journal.js';
import {systemdUnitPresent} from './systemd-worker.js';
import {completedTaskWorkerEvidence} from '../native-v2/task-recovery.js';
import {openWorkspace,privatePath,privateRead,FILES,requireMaintenanceAvailable} from '../standalone/workspace.js';
import type {WorkspaceStore,MaintenancePermit} from '../standalone/workspace.js';
import {RESET_RECORDS,RESET_BYTES,resetKey,resetReceipt,readResetRecords,validateResetPlan} from '../standalone/reset-records.js';
import type {ResetPlan,ResetCopy,ResetReference,ResetRequestReference} from '../standalone/reset-records.js';
import {hash,hashBytes,canonical,id,digest} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

const DELETIONS=['native_delivery_heads','native_deliveries','native_review_heads','native_reviews','native_review_candidates','native_views','native_reasoning_events','native_reasoning_tasks','native_model_heads','native_models','native_expectation_heads','native_expectations','native_source_heads','native_source_admissions','native_source_sets','intents','receipts'] as const;
const deletionSet=new Set<string>(DELETIONS);
const checksum=(value:unknown)=>hash(value as Json);
const present=(path:string)=>{try{lstatSync(path);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}};
const sync=(root:string)=>{const fd=openSync(root,'r');try{fsyncSync(fd);}finally{closeSync(fd);}};
function stopped(i:Installation):void {const run=currentRun(i);if(run&&!['STOPPED','FAILED'].includes(run.state)&&processPresent(run.pid)!==false)fail('INSTALLATION_RUNNING','Stop the exact owner before asset reset',409);}
function proofWorkers(i:Installation,store:WorkspaceStore,projects:string[]):void {
 const binding=currentToolchainBinding(i),root=binding?.binding.workRoot;
 if(root)requireWorkerMaintenanceComplete(root);
 const tasks=store.db.prepare('SELECT id,project_id,state FROM native_reasoning_tasks').all().filter(t=>projects.includes(String(t.project_id)));
 for(const t of tasks){
  if(t.state!=='FINISHED')fail('TASK_RECOVERY_REQUIRED','Resolve the original unfinished task before asset reset',409);
  const evidence=completedTaskWorkerEvidence(store,String(t.project_id),String(t.id),root?[root]:[]);
  for(const reference of evidence.references){
   const a=readWorkerAttempt(reference);
   if(present(join(reference.root,'unit-jobs',reference.attemptId))||a.intent.systemd&&systemdUnitPresent(reference))fail('WORKER_MAINTENANCE_REQUIRED','Release original task resources through worker maintenance before asset reset',409);
  }
 }
}
function copyInventory(root:string,projects:string[]):ResetCopy[] {
 const result:ResetCopy[]=[];let bytes=0;
 const visit=(path:string,depth:number):void=>{
  if(depth>8||result.length>=4096)fail('RESET_LIMIT','Selected copy inventory exceeds budget',409);
  const absolute=join(root,path),s=lstatSync(absolute),directory=s.isDirectory();privatePath(absolute,directory);
  if(!directory&&(s.size>64*1024*1024||(bytes+=s.size)>512*1024*1024))fail('RESET_LIMIT','Selected copies exceed byte budget',409);
  result.push({path,kind:directory?'directory':'file',device:String(s.dev),inode:String(s.ino),bytes:directory?0:s.size,digest:directory?null:fileDigest(absolute,64*1024*1024)});
  if(directory)for(const name of readdirSync(absolute).sort())visit(path+'/'+name,depth+1);
 };
 for(const base of ['asset-exports','asset-cache']){
  const directory=join(root,base);if(!present(directory))continue;privatePath(directory,true);
  for(const project of projects){const path=base+'/'+Buffer.from(project).toString('hex');if(present(join(root,path)))visit(path,1);}
 }
 return result;
}
function databaseInventory(store:WorkspaceStore,projects:string[],requestId:string){
 const db=store.db,reference=new DatabaseSync(':memory:');
 const schema=(d:DatabaseSync)=>d.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
 try{reference.exec(WORKSPACE_TABLES);if(checksum(schema(db))!==checksum(schema(reference)))fail('RESET_SCHEMA','Unknown state layout cannot be partially cleared',409);}finally{reference.close();}
 const selected=new Set(projects),taskIds=new Set(db.prepare('SELECT id,project_id FROM native_reasoning_tasks').all().filter(r=>selected.has(String(r.project_id))).map(r=>String(r.id)));
 const all=createHash('sha256'),keep=createHash('sha256'),references:ResetReference[]=[],requests:ResetRequestReference[]=[],tableCounts:Record<string,number>={};let count=0,selectedRows=0;
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>String(r.name));
 for(const table of tables){
  const info=db.prepare('PRAGMA table_info('+table+')').all(),keys=info.filter(c=>Number(c.pk)>0).sort((a,b)=>Number(a.pk)-Number(b.pk)).map(c=>String(c.name));
  for(const raw of db.prepare('SELECT * FROM '+table+' ORDER BY '+keys.join(',')).iterate()){
   if(++count>100000)fail('RESET_LIMIT','Workspace row inventory exceeds reset budget',409);
   const row=raw as unknown as Record<string,Json>,isSelected=deletionSet.has(table)&&(table==='native_reasoning_events'?taskIds.has(String(row.task_id)):selected.has(String(row.project_id)));
   const encoded=canonical({table,row});all.update(encoded+'\n');
   if(isSelected){
    selectedRows++;tableCounts[table]=(tableCounts[table]??0)+1;
    if(typeof row.digest==='string'&&table!=='receipts')references.push({projectId:String(row.project_id),table,value:row.digest});
    if(table==='native_reasoning_tasks')references.push({projectId:String(row.project_id),table,value:String(row.id)});
    if(table==='receipts')requests.push({projectId:String(row.project_id),principalId:String(row.principal_id),requestId:String(row.request_id),requestDigest:String(row.digest),receiptDigest:hashBytes(String(row.receipt))});
   }else if(table==='projects'&&selected.has(String(row.id))){const {revision,...identity}=row;keep.update(canonical({table,row:identity})+'\n');}
   else if(table==='project_heads'&&selected.has(String(row.project_id))){keep.update(canonical({table,row:{project_id:row.project_id,intent_digest:null}})+'\n');}
   else if(!(table==='audit'&&row.operation==='maintenance.asset-reset'&&row.principal_id==='asset-reset-operator'&&row.request_id===requestId)){keep.update(encoded+'\n');}
  }
 }
 return {databaseDigest:'sha256:'+all.digest('hex'),preservedDigest:'sha256:'+keep.digest('hex'),selectedRows,tableCounts,references,requests};
}
function plan(i:Installation,store:WorkspaceStore,projects:string[],requestId:string):ResetPlan {
 id(requestId);if(!projects.length||projects.length>128||new Set(projects).size!==projects.length)fail('INVALID_INPUT','Explicit unique project IDs required');projects.forEach(id);projects=[...projects].sort();
 for(const project of projects)if(!store.db.prepare('SELECT id FROM projects WHERE id=?').get(project))fail('NOT_FOUND','Selected reset project does not exist',404);
 proofWorkers(i,store,projects);
 const value:ResetPlan={schema:'ontology-asset-reset-plan/v1',installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,workspaceRoot:store.root,requestId,projectIds:projects,...databaseInventory(store,projects,requestId),identityDigest:hashBytes(privateRead(join(store.root,FILES.identity),4096)),credentialsDigest:hashBytes(privateRead(join(store.root,FILES.credentials),512*1024)),copies:copyInventory(store.root,projects)};
 validateResetPlan(value);if(Buffer.byteLength(JSON.stringify(value))>RESET_BYTES-1024)fail('RESET_LIMIT','Reset plan exceeds envelope budget',409);store.guard();return value;
}
export function inspectAssetReset(path:string,projectIds:string[],requestId:string):Json {
 id(requestId);const i=readInstallation(path),unlock=operatorLock(i.root);
 try{
  requireMaintenanceAvailable(i.root);stopped(i);const directory=join(i.workspaceRoot,RESET_RECORDS),file=join(directory,resetKey(requestId)+'.json');
  if(present(file)){
   const saved=JSON.parse(privateRead(file,RESET_BYTES)) as {plan:ResetPlan;planDigest:string};validateResetPlan(saved.plan);
   const records=readResetRecords(i.workspaceRoot,{operation:'RESET',requestId,requestDigest:saved.planDigest}),r=records.find(r=>r.plan.requestId===requestId)!;
   if(checksum([...projectIds].sort())!==checksum(r.plan.projectIds))fail('REQUEST_CONFLICT','Reset request binds another project selection',409);
   return {status:r.completed?'COMPLETED':'PENDING',report:r.plan as unknown as Json,reportDigest:r.planDigest,receipt:r.completed?resetReceipt(r.plan):null,authority:false};
  }
  const store=openWorkspace(i.workspaceRoot,i);try{verifyRuntime(i.runtime);const p=plan(i,store,projectIds,requestId);return {status:'READY',report:p as unknown as Json,reportDigest:checksum(p),authority:false};}finally{store.close();}
 }finally{unlock();}
}
function removeCopies(root:string,p:ResetPlan):void {
 const selected=new Map(p.copies.map(c=>[c.path,c]));
 // Unknown files are never removed, even after the database deletion committed.
 for(const current of copyInventory(root,p.projectIds)){const old=selected.get(current.path);if(!old||checksum(old)!==checksum(current))fail('RESET_COPY_CHANGED','Selected asset copy changed; retain the original journal and resolve the exact conflict',409);}
 for(const c of [...p.copies].reverse()){
  const path=join(root,c.path);if(!present(path))continue;const s=lstatSync(path);privatePath(path,c.kind==='directory');
  if(String(s.dev)!==c.device||String(s.ino)!==c.inode||c.kind==='file'&&(s.size!==c.bytes||fileDigest(path,64*1024*1024)!==c.digest))fail('RESET_COPY_CHANGED','Selected copy identity differs',409);
  if(c.kind==='directory')rmdirSync(path);else unlinkSync(path);sync(dirname(path));
 }
}
export function applyAssetReset(path:string,value:unknown,expectedReportDigest:string):Json {
 validateResetPlan(value);digest(expectedReportDigest);const p=value,planDigest=checksum(p);if(planDigest!==expectedReportDigest)fail('RESET_EVIDENCE','Exact inspected reset report required',409);
 const i=readInstallation(path),unlock=operatorLock(i.root),permit:MaintenancePermit={operation:'RESET',requestId:p.requestId,requestDigest:planDigest};
 try{
  if(p.installationId!==i.installationId||p.workspaceId!==i.workspaceId||p.serviceId!==i.serviceId||p.workspaceRoot!==i.workspaceRoot)fail('IDENTITY_MISMATCH','Reset report belongs to another owner',403);
  requireMaintenanceAvailable(i.root);stopped(i);verifyRuntime(i.runtime);
  const records=readResetRecords(i.workspaceRoot,permit),saved=records.find(r=>r.plan.requestId===p.requestId),directory=join(i.workspaceRoot,RESET_RECORDS),file=join(directory,resetKey(p.requestId)+'.json');
  if(saved&&saved.planDigest!==planDigest)fail('REQUEST_CONFLICT','Original reset has different bindings',409);
  if(saved?.completed)return {receipt:resetReceipt(p),replayed:true,verification:'NOT_RUN',authority:false};
  const store=openWorkspace(i.workspaceRoot,i,permit);
  try{
   if(!saved){if(checksum(plan(i,store,p.projectIds,p.requestId))!==planDigest)fail('RESET_SOURCE_CHANGED','State differs from the inspected reset inventory',409);if(!present(directory)){mkdirSync(directory,{mode:0o700});sync(store.root);}writeBackupJSON(file,{plan:p,planDigest});}
   if(hashBytes(privateRead(join(store.root,FILES.identity),4096))!==p.identityDigest||hashBytes(privateRead(join(store.root,FILES.credentials),512*1024))!==p.credentialsDigest)fail('RESET_SOURCE_CHANGED','Identity or credentials changed during reset',409);
   const marker=()=>store.db.prepare("SELECT * FROM audit WHERE operation='maintenance.asset-reset' AND principal_id='asset-reset-operator' AND request_id=?").all(p.requestId);
   const committed=marker();
   if(committed.length){if(committed.length!==p.projectIds.length||committed.some(r=>!p.projectIds.includes(String(r.project_id))||r.request_digest!==planDigest||r.receipt_digest!==checksum(resetReceipt(p))))fail('RESET_EVIDENCE','Reset transaction receipt differs',409);}
   else{
    if(databaseInventory(store,p.projectIds,p.requestId).databaseDigest!==p.databaseDigest)fail('RESET_SOURCE_CHANGED','Original database inventory changed',409);
    store.db.exec('PRAGMA secure_delete=ON; BEGIN IMMEDIATE');
    try{
     for(const project of p.projectIds){
      for(const table of DELETIONS){if(table==='native_reasoning_events')store.db.prepare('DELETE FROM native_reasoning_events WHERE task_id IN (SELECT id FROM native_reasoning_tasks WHERE project_id=?)').run(project);else store.db.prepare('DELETE FROM '+table+' WHERE project_id=?').run(project);}
      store.db.prepare('UPDATE project_heads SET intent_digest=NULL WHERE project_id=?').run(project);
      store.db.prepare('UPDATE projects SET revision=revision+1 WHERE id=?').run(project);
      store.db.prepare('INSERT INTO audit(project_id,principal_id,request_id,operation,request_digest,receipt_digest,recorded_at) VALUES(?,?,?,?,?,?,?)').run(project,'asset-reset-operator',p.requestId,'maintenance.asset-reset',planDigest,checksum(resetReceipt(p)),new Date().toISOString());
     }
     if(store.db.prepare('PRAGMA foreign_key_check').get())fail('RESET_EVIDENCE','Reset would leave broken owner references',409);
     store.db.exec('COMMIT');
    }catch(e){if(store.db.isTransaction)store.db.exec('ROLLBACK');throw e;}
   }
   // A retry may repeat compaction, never the committed deletion transaction.
   store.db.exec('VACUUM');removeCopies(store.root,p);
   const after=databaseInventory(store,p.projectIds,p.requestId);
   if(after.selectedRows!==0||after.preservedDigest!==p.preservedDigest||copyInventory(store.root,p.projectIds).length||store.db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok'||store.db.prepare('PRAGMA foreign_key_check').get())fail('RESET_VERIFY','Independent post-reset state differs from the selected plan',409);
   store.guard();writeBackupJSON(file+'.completed',resetReceipt(p));readResetRecords(store.root);
   return {receipt:resetReceipt(p),replayed:false,verification:'VERIFIED',authority:false};
  }finally{store.close();}
 }finally{unlock();}
}
