import {constants,openSync,closeSync,fstatSync,lstatSync,readSync,readdirSync,unlinkSync,rmdirSync,fsyncSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {Json} from '../standalone/types.js';
import {fail} from '../standalone/types.js';
import {exact,id,digest,hash} from '../standalone/validation.js';
import {privatePath} from '../standalone/workspace.js';
import type {WorkspaceStore} from '../standalone/workspace.js';
import {boundedJSON} from '../reasoning/request.js';
import type {Installation} from './manager.js';
import {readWorkerAttempt,withWorkerJournal,withWorkerJournalHistory,requireWorkerMaintenanceComplete} from './worker-journal.js';
import type {WorkerReference} from './worker-journal.js';
import {retireSystemdUnit,systemdUnitPresent} from './systemd-worker.js';
import {completedTaskWorkerEvidence} from '../native-v2/task-recovery.js';

import {withStoppedWorkerInstallation} from './worker-operator.js';

interface NodeIdentity {device:string;inode:string;}
interface FileIdentity extends NodeIdentity {name:'input'|'stdout'|'stderr';bytes:number;digest:string;}
interface Entry {reference:WorkerReference;outcomeDigest:string;terminalDigest:string|null;directory:NodeIdentity|null;files:FileIdentity[];}
interface Plan {schema:'ontology-worker-maintenance-plan/v1';installationId:string;workRoot:string;task:ReturnType<typeof completedTaskWorkerEvidence>;base:NodeIdentity|null;entries:Entry[];}
interface Request {projectId:string;taskId:string;requestId:string;expectedReportDigest:string;}
interface Receipt {schema:'ontology-worker-maintenance-receipt/v1';requestId:string;requestDigest:string;planDigest:string;taskResultDigest:string;selectedFileBytes:number;jobDirectoriesAbsent:number;managerUnitsAbsent:number;recordedAt:string;authority:false;}
interface Record {requestId:string;requestDigest:string;plan:Plan;planDigest:string;receipt:Receipt|null;}
const sha=(value:unknown)=>hash(value as Json);
const table="CREATE TABLE IF NOT EXISTS worker_maintenance(request_id TEXT PRIMARY KEY,request_digest TEXT NOT NULL,plan TEXT NOT NULL,plan_digest TEXT NOT NULL,receipt TEXT,receipt_digest TEXT,receipt_space BLOB)";
const hasTable=(db:DatabaseSync)=>Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='worker_maintenance'").get());
const absent=(path:string)=>{try{lstatSync(path);return false;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return true;throw e;}};
const identity=(path:string):NodeIdentity=>{privatePath(path,true);const s=lstatSync(path,{bigint:true});return {device:String(s.dev),inode:String(s.ino)};};
const fdIdentity=(fd:number):NodeIdentity=>{const s=fstatSync(fd,{bigint:true});return {device:String(s.dev),inode:String(s.ino)};};
function validateNode(v:unknown):asserts v is NodeIdentity {
  exact(v,['device','inode']);for(const field of ['device','inode'])if(typeof v[field]!=='string'||!/^\d{1,24}$/.test(v[field] as string))fail('WORKER_MAINTENANCE_EVIDENCE','Invalid retained directory identity',409);
}
function validatePlan(v:unknown,installation:Installation,root:string):asserts v is Plan {
  boundedJSON(v,512*1024);exact(v,['schema','installationId','workRoot','task','base','entries']);
  if(v.schema!=='ontology-worker-maintenance-plan/v1'||v.installationId!==installation.installationId||v.workRoot!==root)fail('WORKER_MAINTENANCE_EVIDENCE','Foreign cleanup owner',409);
  exact(v.task,['workspaceId','serviceId','projectId','taskId','resultDigest','lastEventDigest','references']);
  if(v.task.workspaceId!==installation.workspaceId||v.task.serviceId!==installation.serviceId)fail('WORKER_MAINTENANCE_EVIDENCE','Foreign cleanup workspace',409);
  id(v.task.projectId);id(v.task.taskId);digest(v.task.resultDigest);digest(v.task.lastEventDigest);
  if(v.base!==null)validateNode(v.base);
  if(!Array.isArray(v.entries)||v.entries.length>128||!Array.isArray(v.task.references)||v.task.references.length!==v.entries.length)fail('WORKER_MAINTENANCE_EVIDENCE','Invalid bounded worker selection',409);
  const seen=new Set<string>();
  for(let n=0;n<v.entries.length;n++){
    const e=v.entries[n];exact(e,['reference','outcomeDigest','terminalDigest','directory','files']);exact(e.reference,['root','journalId','attemptId','intentDigest']);
    id(e.reference.journalId);id(e.reference.attemptId);digest(e.reference.intentDigest);digest(e.outcomeDigest);if(e.terminalDigest!==null)digest(e.terminalDigest);
    if(e.reference.root!==root||seen.has(e.reference.attemptId as string)||sha(e.reference)!==sha(v.task.references[n]))fail('WORKER_MAINTENANCE_EVIDENCE','Cleanup attempt identity differs',409);seen.add(e.reference.attemptId as string);
    if(e.directory!==null){validateNode(e.directory);if(v.base===null)fail('WORKER_MAINTENANCE_EVIDENCE','Job lacks its parent identity',409);}
    if(!Array.isArray(e.files)||e.files.length>3||e.directory===null&&e.files.length)fail('WORKER_MAINTENANCE_EVIDENCE','Invalid retained job file selection',409);
    const names=new Set<string>();for(const f of e.files){
      exact(f,['name','device','inode','bytes','digest']);validateNode({device:f.device,inode:f.inode});digest(f.digest);
      if(!['input','stdout','stderr'].includes(f.name as string)||names.has(f.name as string)||!Number.isSafeInteger(f.bytes)||(f.bytes as number)<0||(f.bytes as number)>50*1024*1024)fail('WORKER_MAINTENANCE_EVIDENCE','Invalid fixed cleanup file identity',409);names.add(f.name as string);
    }
  }
}
function requestDigest(i:Installation,input:Request):string {
  exact(input,['projectId','taskId','requestId','expectedReportDigest']);
  id(input.projectId);id(input.taskId);id(input.requestId);digest(input.expectedReportDigest);
  return sha({installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,projectId:input.projectId,taskId:input.taskId,expectedReportDigest:input.expectedReportDigest});
}
export function workerMaintenanceRecords(i:Installation,root:string,selection?:{requestId?:string;projectId:string;taskId:string},journalId?:string):Record[] {
  return withWorkerJournalHistory(root,j=>{
    if(journalId!==undefined&&j.journalId!==journalId||!hasTable(j.db))return [];
    const rows=selection?j.db.prepare("SELECT * FROM worker_maintenance WHERE request_id=? OR (json_extract(plan,'$.task.projectId')=? AND json_extract(plan,'$.task.taskId')=?) OR receipt IS NULL ORDER BY rowid LIMIT 4097").all(selection.requestId??'',selection.projectId,selection.taskId):j.db.prepare('SELECT * FROM worker_maintenance ORDER BY rowid LIMIT 4097').all();if(rows.length>4096)fail('WORKER_MAINTENANCE_LIMIT','Maintenance history exceeds its budget',409);
    return rows.map(r=>{
      id(r.request_id);digest(r.request_digest);digest(r.plan_digest);
      if(typeof r.plan!=='string'||Buffer.byteLength(r.plan)>512*1024)fail('WORKER_MAINTENANCE_EVIDENCE','Invalid retained plan envelope',409);
      const plan:unknown=JSON.parse(r.plan);validatePlan(plan,i,root);if(sha(plan)!==r.plan_digest||requestDigest(i,{projectId:plan.task.projectId,taskId:plan.task.taskId,requestId:String(r.request_id),expectedReportDigest:String(r.plan_digest)})!==r.request_digest)fail('WORKER_MAINTENANCE_EVIDENCE','Retained maintenance request differs',409);
      let receipt:Receipt|null=null;
      if(r.receipt!==null){
        if(typeof r.receipt!=='string'||Buffer.byteLength(r.receipt)>4096)fail('WORKER_MAINTENANCE_EVIDENCE','Invalid receipt envelope',409);
        const v:unknown=JSON.parse(r.receipt);exact(v,['schema','requestId','requestDigest','planDigest','taskResultDigest','selectedFileBytes','jobDirectoriesAbsent','managerUnitsAbsent','recordedAt','authority']);
        if(sha(v)!==r.receipt_digest||v.schema!=='ontology-worker-maintenance-receipt/v1'||v.requestId!==r.request_id||v.requestDigest!==r.request_digest||v.planDigest!==r.plan_digest||v.taskResultDigest!==plan.task.resultDigest||v.selectedFileBytes!==plan.entries.flatMap(e=>e.files).reduce((n,f)=>n+f.bytes,0)||v.jobDirectoriesAbsent!==plan.entries.filter(e=>e.directory).length||v.managerUnitsAbsent!==plan.entries.length||typeof v.recordedAt!=='string'||v.recordedAt.length>40||v.authority!==false)fail('WORKER_MAINTENANCE_EVIDENCE','Retained cleanup receipt differs',409);
        receipt=v as unknown as Receipt;
        if(r.receipt_space!==null)fail('WORKER_MAINTENANCE_EVIDENCE','Completed receipt retains an unexpected reservation',409);
      }else if(r.receipt_digest!==null||!(r.receipt_space instanceof Uint8Array)||r.receipt_space.length!==4096)fail('WORKER_MAINTENANCE_EVIDENCE','Partial maintenance receipt or missing completion reservation',409);
      return {requestId:String(r.request_id),requestDigest:String(r.request_digest),plan,planDigest:String(r.plan_digest),receipt};
    });
  }).flat();
}
function fileIdentity(path:string,name:FileIdentity['name'],limit:number):FileIdentity {
  privatePath(path);const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const s=fstatSync(fd,{bigint:true});if(!s.isFile()||s.nlink!==1n||s.uid!==BigInt(process.getuid!())||(s.mode&0o077n)!==0n||s.size>BigInt(limit))fail('WORKER_MAINTENANCE_EVIDENCE','Unsafe or oversized job file',409);
    const h=createHash('sha256'),buffer=Buffer.alloc(65536);let bytes=0;
    for(;;){const n=readSync(fd,buffer);if(!n)break;bytes+=n;if(bytes>limit)fail('WORKER_MAINTENANCE_EVIDENCE','Job file grew during inspection',409);h.update(buffer.subarray(0,n));}
    const after=fstatSync(fd,{bigint:true}),named=lstatSync(path,{bigint:true});
    if(after.size!==s.size||after.mtimeNs!==s.mtimeNs||after.ctimeNs!==s.ctimeNs||named.ino!==s.ino||named.dev!==s.dev||BigInt(bytes)!==s.size)fail('WORKER_MAINTENANCE_EVIDENCE','Job file changed during inspection',409);
    return {name,device:String(s.dev),inode:String(s.ino),bytes,digest:'sha256:'+h.digest('hex')};
  }finally{closeSync(fd);}
}
function entry(reference:WorkerReference):Entry {
  const a=readWorkerAttempt(reference);
  if(!a.intent.systemd||!a.outcome||a.unit&&!a.terminal||!a.unit&&(!a.fence||a.outcome.state!=='NOT_STARTED'))fail('WORKER_EXIT_UNPROVEN','Only closed selected-systemd attempts can release job files',409);
  const neverLaunched=!a.unit&&a.outcome.state==='NOT_STARTED',path=join(reference.root,'unit-jobs',reference.attemptId),directory=absent(path)?null:identity(path),files:FileIdentity[]=[];
  if(!directory&&!neverLaunched)fail('WORKER_MAINTENANCE_EVIDENCE','Job files disappeared without a retained cleanup plan',409);
  if(directory){
    const names=readdirSync(path).sort();if(names.some(n=>!['input','stdout','stderr'].includes(n))||!neverLaunched&&names.length!==3)fail('WORKER_MAINTENANCE_EVIDENCE','Job contains unexpected or missing files',409);
    for(const name of names as FileIdentity['name'][]){
      const limit=name==='input'?a.intent.stdinBytes:name==='stdout'?a.intent.outputBytes:a.intent.diagnosticBytes,f=fileIdentity(join(path,name),name,limit);
      if(!neverLaunched&&(f.digest!==(name==='input'?a.intent.stdinDigest:name==='stdout'?a.outcome.stdoutDigest:a.outcome.stderrDigest)||f.bytes!==(name==='input'?a.intent.stdinBytes:name==='stdout'?a.outcome.stdoutBytes:a.outcome.stderrBytes)))fail('WORKER_MAINTENANCE_EVIDENCE','Job bytes differ from original worker evidence',409);
      files.push(f);
    }
  }
  return {reference,outcomeDigest:a.outcomeDigest!,terminalDigest:a.terminalDigest,directory,files};
}
function makePlan(i:Installation,store:WorkspaceStore,root:string,projectId:string,taskId:string):Plan {
  const task=completedTaskWorkerEvidence(store,projectId,taskId,[root]),basePath=join(root,'unit-jobs');
  if(!task.references.length)fail('WORKER_MAINTENANCE_EMPTY','This completed task has no worker resources to release',409);
  const plan:Plan={schema:'ontology-worker-maintenance-plan/v1',installationId:i.installationId,workRoot:root,task,base:absent(basePath)?null:identity(basePath),entries:task.references.map(entry)};
  validatePlan(plan,i,root);return plan;
}
export async function inspectInstallationWorkerMaintenance(path:string,projectId:string,taskId:string):Promise<Json> {
  return withStoppedWorkerInstallation<Json>(path,async(i,store,root):Promise<Json>=>{
    const task=completedTaskWorkerEvidence(store,projectId,taskId,[root]);
    if(!task.references.length)return {status:'NOT_NEEDED',requestId:null,report:null,reportDigest:null,receipt:null,authority:false};
    const saved=workerMaintenanceRecords(i,root,{projectId,taskId}).find(r=>r.plan.task.taskId===taskId&&r.plan.task.projectId===projectId);
    if(saved){if(sha(task)!==sha(saved.plan.task))fail('WORKER_MAINTENANCE_EVIDENCE','Original task changed',409);return {status:saved.receipt?'COMPLETED':'PENDING',requestId:saved.requestId,report:saved.plan as unknown as Json,reportDigest:saved.planDigest,receipt:saved.receipt as unknown as Json,authority:false};}
    requireWorkerMaintenanceComplete(root);const plan=makePlan(i,store,root,projectId,taskId);
    return {status:'READY',requestId:null,report:plan as unknown as Json,reportDigest:sha(plan),receipt:null,authority:false};
  });
}
function removeFiles(plan:Plan,e:Entry):void {
  const base=join(plan.workRoot,'unit-jobs'),path=join(base,e.reference.attemptId);
  if(!plan.base){if(!absent(base))fail('WORKER_MAINTENANCE_EVIDENCE','Unselected job directory appeared',409);return;}
  if(sha(identity(base))!==sha(plan.base))fail('WORKER_MAINTENANCE_EVIDENCE','Job parent was replaced',409);
  const parent=openSync(base,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW),anchored='/proc/self/fd/'+parent+'/'+e.reference.attemptId;
  try{
    if(sha(fdIdentity(parent))!==sha(plan.base))fail('WORKER_MAINTENANCE_EVIDENCE','Job parent changed during open',409);
    if(absent(anchored))return;
    if(!e.directory||sha(identity(anchored))!==sha(e.directory)||sha(identity(path))!==sha(e.directory))fail('WORKER_MAINTENANCE_EVIDENCE','Job directory was replaced',409);
    const fd=openSync(anchored,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{
      if(sha(fdIdentity(fd))!==sha(e.directory))fail('WORKER_MAINTENANCE_EVIDENCE','Job directory changed during open',409);
      const retained='/proc/self/fd/'+fd,names=readdirSync(retained);
      if(names.some(n=>!e.files.some(f=>f.name===n)))fail('WORKER_MAINTENANCE_EVIDENCE','Unselected job file appeared',409);
      for(const f of e.files){
        if(sha(identity(base))!==sha(plan.base)||sha(identity(path))!==sha(e.directory))fail('WORKER_MAINTENANCE_EVIDENCE','Job path changed during cleanup',409);
        const file=join(retained,f.name);if(absent(file))continue;
        if(sha(fileIdentity(file,f.name,f.bytes))!==sha(f))fail('WORKER_MAINTENANCE_EVIDENCE','Retained job file changed; cleanup is paused',409);
        unlinkSync(file);fsyncSync(fd);
      }
      if(readdirSync(retained).length||sha(identity(path))!==sha(e.directory)||sha(identity(base))!==sha(plan.base))fail('WORKER_MAINTENANCE_EVIDENCE','Job changed before directory removal',409);
      rmdirSync(anchored);fsyncSync(parent);
    }finally{closeSync(fd);}
  }finally{closeSync(parent);}
}
export async function maintainInstallationWorkers(path:string,input:Request):Promise<Json> {
  return withStoppedWorkerInstallation(path,async(i,store,root)=>{
    const requested=requestDigest(i,input),task=completedTaskWorkerEvidence(store,input.projectId,input.taskId,[root]);
    if(!task.references.length)fail('WORKER_MAINTENANCE_EMPTY','This completed task has no worker resources to release',409);
    const history=workerMaintenanceRecords(i,root,input);let record=history.find(r=>r.requestId===input.requestId);
    if(record){
      if(record.requestDigest!==requested)fail('REQUEST_CONFLICT','Maintenance request ID binds different parameters',409);
      if(sha(completedTaskWorkerEvidence(store,input.projectId,input.taskId,[root]))!==sha(record.plan.task))fail('WORKER_MAINTENANCE_EVIDENCE','Original completed task changed',409);
      if(record.receipt)return {receipt:record.receipt as unknown as Json,replayed:true,authority:false};
    }else{
      requireWorkerMaintenanceComplete(root);
      if(history.some(r=>r.plan.task.projectId===input.projectId&&r.plan.task.taskId===input.taskId))fail('WORKER_ALREADY_MAINTAINED','Inspect the original task maintenance receipt',409);
      const plan=makePlan(i,store,root,input.projectId,input.taskId),planDigest=sha(plan);
      if(planDigest!==input.expectedReportDigest)fail('WORKER_MAINTENANCE_CONFLICT','Inspected cleanup evidence changed',409);
      record={requestId:input.requestId,requestDigest:requested,plan,planDigest,receipt:null};
      withWorkerJournal(root,j=>{
        j.db.exec('BEGIN IMMEDIATE');j.guard();j.db.exec(table);
        if(Number(j.db.prepare('SELECT count(*) AS n FROM worker_maintenance').get()!.n)>=4096)fail('WORKER_MAINTENANCE_LIMIT','Rotate the closed worker journal before another maintenance request',409);
        if(j.db.prepare('SELECT request_id FROM worker_maintenance WHERE receipt IS NULL LIMIT 1').get())fail('WORKER_MAINTENANCE_PENDING','Another original cleanup request is unfinished',409);
        // Reserve the bounded receipt's row space before releasing any files.
        j.db.prepare('INSERT INTO worker_maintenance(request_id,request_digest,plan,plan_digest,receipt_space) VALUES(?,?,?,?,zeroblob(4096))').run(input.requestId,requested,JSON.stringify(plan),planDigest);j.db.exec('COMMIT');
      });
    }
    for(const e of record.plan.entries){
      store.guard();const a=readWorkerAttempt(e.reference);
      if(a.outcomeDigest!==e.outcomeDigest||a.terminalDigest!==e.terminalDigest)fail('WORKER_MAINTENANCE_EVIDENCE','Original execution evidence changed',409);
      await retireSystemdUnit(e.reference);store.guard();removeFiles(record.plan,e);
    }
    store.guard();
    for(const e of record.plan.entries)if(!absent(join(root,'unit-jobs',e.reference.attemptId))||systemdUnitPresent(e.reference))fail('WORKER_MAINTENANCE_PENDING','Selected cleanup effects are not confirmed',409);
    if(sha(completedTaskWorkerEvidence(store,input.projectId,input.taskId,[root]))!==sha(record.plan.task))fail('WORKER_MAINTENANCE_EVIDENCE','Business evidence changed during maintenance',409);
    const receipt:Receipt={schema:'ontology-worker-maintenance-receipt/v1',requestId:input.requestId,requestDigest:requested,planDigest:record.planDigest,taskResultDigest:record.plan.task.resultDigest,selectedFileBytes:record.plan.entries.flatMap(e=>e.files).reduce((n,f)=>n+f.bytes,0),jobDirectoriesAbsent:record.plan.entries.filter(e=>e.directory).length,managerUnitsAbsent:record.plan.entries.length,recordedAt:new Date().toISOString(),authority:false};
    withWorkerJournal(root,j=>{
      j.guard();const changed=j.db.prepare('UPDATE worker_maintenance SET receipt=?,receipt_digest=?,receipt_space=NULL WHERE request_id=? AND request_digest=? AND plan_digest=? AND receipt IS NULL').run(JSON.stringify(receipt),sha(receipt),input.requestId,requested,record!.planDigest);
      if(changed.changes!==1)fail('WORKER_MAINTENANCE_EVIDENCE','Cleanup receipt could not be committed',409);
    });
    return {receipt:receipt as unknown as Json,replayed:false,authority:false};
  });
}
