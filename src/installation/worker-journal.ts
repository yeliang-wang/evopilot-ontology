import {DatabaseSync} from 'node:sqlite';
import {openSync,closeSync,lstatSync,fsyncSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {JOURNAL_BYTES,journalLocation,readArchiveCatalog,verifyJournalImage,requireNoRotation,journalFilename,workerFilePresent} from './worker-archives.js';
import type {JournalHead} from './worker-archives.js';
import {outsideSource} from './files.js';
import {privatePath} from '../standalone/workspace.js';
import {exact,hash,id,digest,text} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {validateSystemdSelection} from './systemd-binding.js';
import type {SystemdSelection} from './systemd-binding.js';

export const WORKER_PROTOCOL='ontology-owned-worker/v1';
export const ISOLATED_WORKER_PROTOCOL='ontology-owned-worker/v2';
export interface WorkerPlan {
  schema:typeof WORKER_PROTOCOL|typeof ISOLATED_WORKER_PROTOCOL;systemd?:SystemdSelection;requestId:string;requestDigest:string;configurationDigest:string;toolchainDigest:string;
  executable:string;args:string[];env:Record<string,string>;stdinDigest:string;stdinBytes:number;
  timeoutMs:number;outputBytes:number;diagnosticBytes:number;
}
export interface WorkerReference {root:string;journalId:string;attemptId:string;intentDigest:string;}
export interface ProcessRecord {pid:number;recordedAt:string;}
export interface WorkerOutcome {
  state:'EXITED'|'NOT_STARTED'|'GROUP_TERMINATED';reason:null|'OWNER_LOST'|'CANCELLED'|'TASK_DEADLINE'|'OUTPUT_LIMIT'|'DIAGNOSTIC_LIMIT'|'SPAWN_FAILED'|'INPUT_INVALID'|'DISPATCH_REJECTED'|'MEMORY_LIMIT'|'SUPERVISOR_LOST';
  workerPid:number|null;exitCode:number|null;signal:string|null;stdoutDigest:string;stderrDigest:string;stdoutBytes:number;stderrBytes:number;recordedAt:string;
}
export interface UnitRecord {schema:'ontology-worker-unit/v1';unitName:string;invocationId:string;bootId:string;supervisorPid:number;configurationDigest:string;controlGroup:string;device:string;inode:string;recordedAt:string;}
export interface LaunchFence {reason:NonNullable<WorkerOutcome['reason']>;recordedAt:string;}
export interface UnitTerminal {unit:UnitRecord;activeState:string;subState:string;result:string;execMainPid:number;execMainCode:number;execMainStatus:number;mainPid:0;empty:true;memoryPeak:number|null;recordedAt:string;}
export interface WorkerAttempt {reference:WorkerReference;intent:WorkerPlan;supervisor:ProcessRecord|null;worker:ProcessRecord|null;outcome:WorkerOutcome|null;outcomeDigest:string|null;unit:UnitRecord|null;fence:LaunchFence|null;terminal:UnitTerminal|null;terminalDigest:string|null;}
const encoded=(value:unknown)=>JSON.stringify(value);
const sha=(value:unknown)=>hash(value as Json);
const reasons:WorkerOutcome['reason'][]=[null,'OWNER_LOST','CANCELLED','TASK_DEADLINE','OUTPUT_LIMIT','DIAGNOSTIC_LIMIT','SPAWN_FAILED','INPUT_INVALID','DISPATCH_REJECTED','MEMORY_LIMIT','SUPERVISOR_LOST'];
export const workerUnitName=(reference:WorkerReference)=>'ontology-worker-'+sha(reference).slice(7,39)+'.service';
function validateUnitRecord(value:unknown,reference:WorkerReference):asserts value is UnitRecord {
  exact(value,['schema','unitName','invocationId','bootId','supervisorPid','configurationDigest','controlGroup','device','inode','recordedAt']);
  if(value.schema!=='ontology-worker-unit/v1'||value.unitName!==workerUnitName(reference)||typeof value.invocationId!=='string'||! /^[0-9a-f]{32}$/.test(value.invocationId)||!Number.isSafeInteger(value.supervisorPid)||(value.supervisorPid as number)<1||typeof value.controlGroup!=='string'||!value.controlGroup.startsWith('/user.slice/')||!value.controlGroup.endsWith('/'+value.unitName))fail('WORKER_EVIDENCE_INVALID','Invalid retained unit identity',409);
  digest(value.configurationDigest);text(value.bootId,36);text(value.controlGroup,4096);text(value.recordedAt,40);
  for(const field of ['device','inode'])if(typeof value[field]!=='string'||!/^\d+$/.test(value[field] as string))fail('WORKER_EVIDENCE_INVALID','Invalid kernel group identity',409);
}
export function validateWorkerPlan(value:unknown):asserts value is WorkerPlan {
  exact(value,['schema','requestId','requestDigest','configurationDigest','toolchainDigest','executable','args','env','stdinDigest','stdinBytes','timeoutMs','outputBytes','diagnosticBytes'],['systemd']);
  if(![WORKER_PROTOCOL,ISOLATED_WORKER_PROTOCOL].includes(value.schema as string))fail('WORKER_PROTOCOL','Unknown owned worker protocol');
  if(value.schema===ISOLATED_WORKER_PROTOCOL)validateSystemdSelection(value.systemd);
  else if(value.systemd!==undefined)fail('WORKER_PROTOCOL','A bounded executor requires its versioned protocol');
  text(value.requestId,256);for(const key of ['requestDigest','configurationDigest','toolchainDigest','stdinDigest'])digest(value[key]);
  text(value.executable,4096);if(!isAbsolute(value.executable))fail('UNSAFE_PATH','Explicit installed executable required');
  if(!Array.isArray(value.args)||value.args.length>128||value.args.some(x=>typeof x!=='string'||x.includes('\0')||Buffer.byteLength(x)>24576))fail('WORKER_PROTOCOL','Invalid worker arguments');
  if(!value.env||typeof value.env!=='object'||Array.isArray(value.env)||Object.entries(value.env).length>32||Object.entries(value.env).some(([k,v])=>!/^[A-Z_][A-Z_0-9]*$/.test(k)||typeof v!=='string'||v.includes('\0')||Buffer.byteLength(v)>8192))fail('WORKER_PROTOCOL','Invalid worker environment');
  for(const [key,min,max] of [['stdinBytes',1,50*1024*1024],['timeoutMs',1,120000],['outputBytes',1,17*1024*1024],['diagnosticBytes',1,65536]] as const){if(!Number.isSafeInteger(value[key])||(value[key] as number)<min||(value[key] as number)>max)fail('WORKER_PROTOCOL','Worker budget exceeds fixed envelope');}
  if(Buffer.byteLength(encoded(value))>32768)fail('WORKER_PROTOCOL','Worker intent byte budget exceeded');
}
function openFile(root:string,file:string,create=false,expectedId?:string,readOnly=false){
  privatePath(root,true);if(outsideSource(root)!==root)fail('UNSAFE_PATH','Canonical worker root required');
  let fresh=false;
  if(!workerFilePresent(file)){if(!create)fail('WORKER_EVIDENCE_MISSING','Worker journal is absent',409);const fd=openSync(file,'wx',0o600);closeSync(fd);fresh=true;}
  privatePath(file);for(const suffix of ['-journal','-wal','-shm'])if(workerFilePresent(file+suffix))privatePath(file+suffix);
  const anchor=lstatSync(file),db=new DatabaseSync(file,{timeout:1000,readOnly});
  try{
    db.exec('PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    if(create&&expectedId&&db.prepare('PRAGMA user_version').get()?.user_version===0&&db.prepare("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1").get()===undefined)fresh=true;
    if(fresh){db.exec('BEGIN IMMEDIATE; CREATE TABLE identity(value TEXT NOT NULL); CREATE TABLE attempts(id TEXT PRIMARY KEY,intent TEXT NOT NULL,intent_digest TEXT NOT NULL,supervisor TEXT,supervisor_digest TEXT,worker TEXT,worker_digest TEXT,outcome TEXT,outcome_digest TEXT); PRAGMA user_version=1;');db.prepare('INSERT INTO identity VALUES(?)').run(encoded({schema:'ontology-worker-journal/v1',root,journalId:expectedId??randomUUID()}));db.exec('COMMIT');}
    if(db.prepare('PRAGMA user_version').get()?.user_version!==1||db.prepare('PRAGMA journal_mode').get()?.journal_mode!=='delete')fail('WORKER_EVIDENCE_INVALID','Unknown worker journal schema',409);
    const bytes=Number(db.prepare('PRAGMA page_count').get()?.page_count)*Number(db.prepare('PRAGMA page_size').get()?.page_size);if(bytes>JOURNAL_BYTES)fail('WORKER_JOURNAL_LIMIT','Worker journal exceeds its fixed budget',409);
    if(!readOnly)db.exec('PRAGMA max_page_count='+Math.floor(JOURNAL_BYTES/Number(db.prepare('PRAGMA page_size').get()?.page_size)));
    const identities=db.prepare('SELECT value FROM identity').all();if(identities.length!==1)fail('WORKER_EVIDENCE_INVALID','Worker journal identity is ambiguous',409);
    const identity:unknown=JSON.parse(String(identities[0].value));exact(identity,['schema','root','journalId']);id(identity.journalId);
    if(identity.schema!=='ontology-worker-journal/v1'||identity.root!==root||expectedId!==undefined&&identity.journalId!==expectedId)fail('WORKER_EVIDENCE_INVALID','Worker journal owner differs',409);
    const guard=()=>{privatePath(file);const s=lstatSync(file);if(s.ino!==anchor.ino||s.dev!==anchor.dev)fail('WORKER_EVIDENCE_INVALID','Worker journal was replaced',409);if(workerFilePresent(file+'-journal'))privatePath(file+'-journal');};
    guard();return {db,journalId:identity.journalId,guard};
  }catch(e){db.close();throw e;}
}
function open(root:string,create=false,journalId?:string,readOnly=false){
  const location=journalLocation(root,journalId,!readOnly),file=join(root,location.head?.file??'worker-journal.sqlite');
  if(location.image)verifyJournalImage(root,location.image);
  const j=openFile(root,file,create&&location.head===null,location.head?.journalId,readOnly),guard=()=>{
    j.guard();const current=journalLocation(root,journalId,!readOnly);
    if(current.head?.journalId!==location.head?.journalId||current.head?.file!==location.head?.file)fail('WORKER_EVIDENCE_INVALID','Journal routing changed',409);
    if(location.image)verifyJournalImage(root,location.image);
  };
  try{guard();return {...j,guard};}catch(e){j.db.close();throw e;}
}
/** Only a recorded pending rotation may initialize its exact fresh shard. */
export function prepareNextWorkerJournal(root:string,next:JournalHead):void {
  const c=readArchiveCatalog(root);
  if(!c?.pending||sha(c.pending.next)!==sha(next)||next.file!==journalFilename(next.journalId))fail('WORKER_ROTATION_PENDING','Exact pending rotation is required',409);
  const file=join(root,next.file),j=openFile(root,file,true,next.journalId);
  try{
    j.guard();if(j.db.prepare('SELECT id FROM attempts LIMIT 1').get()||j.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('identity','attempts') LIMIT 1").get())fail('WORKER_ARCHIVE_EVIDENCE','Next journal is occupied',409);
  }finally{j.db.close();}
  const fd=openSync(file,'r'),dir=openSync(root,'r');try{fsyncSync(fd);fsyncSync(dir);}finally{closeSync(fd);closeSync(dir);}
}
/** Read historical shards through exact immutable routing. */
export function withWorkerJournalHistory<T>(root:string,use:(journal:ReturnType<typeof open>)=>T):T[] {
  const c=readArchiveCatalog(root),heads=c?[...c.archives.map(r=>r.plan.source),c.current]:[undefined];
  if(!c&&!workerFilePresent(join(root,'worker-journal.sqlite')))return [];
  return heads.map(h=>{const j=open(root,false,h?.journalId,true);try{const result=use(j);j.guard();return result;}finally{j.db.close();}});
}
/** Internal synchronous journal access; callers must retain owner leases. */
export function withWorkerJournal<T>(root:string,use:(journal:ReturnType<typeof open>)=>T):T {
  const journal=open(root);try{return use(journal);}finally{journal.db.close();}
}
function requireNoMaintenance(db:DatabaseSync):void {
  if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='worker_maintenance'").get()&&db.prepare('SELECT request_id FROM worker_maintenance WHERE receipt IS NULL LIMIT 1').get())fail('WORKER_MAINTENANCE_PENDING','Resume the original worker maintenance request before new execution',409);
}
export function requireWorkerMaintenanceComplete(root:string):void {
  requireNoRotation(root);
  for(const r of readArchiveCatalog(root)?.archives??[])verifyJournalImage(root,r.plan.source);
  if(workerFilePresent(join(root,'worker-journal.sqlite')))withWorkerJournal(root,j=>requireNoMaintenance(j.db));
}
function requireAdmissionCapacity(db:DatabaseSync,root:string,intent:WorkerPlan):void {
  const pageSize=Number(db.prepare('PRAGMA page_size').get()?.page_size),used=(Number(db.prepare('PRAGMA page_count').get()?.page_count)-Number(db.prepare('PRAGMA freelist_count').get()?.freelist_count))*pageSize;
  let unmaintained=0;
  if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='systemd_workers'").get()){
    const hasMaintenance=Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='worker_maintenance'").get());
    const cleaned=hasMaintenance?"AND s.attempt_id NOT IN (SELECT json_extract(e.value,'$.reference.attemptId') FROM worker_maintenance m,json_each(m.plan,'$.entries') e WHERE m.receipt IS NOT NULL)":'';
    unmaintained=Number(db.prepare('SELECT count(*) AS n FROM systemd_workers s WHERE 1=1 '+cleaned).get()!.n);
  }
  // 1 MiB remains for bounded transaction/maintenance overhead; 8 KiB per
  // unmaintained unit plus three encoded root copies reserves its later
  // plan/receipt even for long or escaped paths; 128 KiB closes this launch.
  const cleanupBytes=8192+3*Buffer.byteLength(JSON.stringify(root));
  if(used+1024*1024+(unmaintained+(intent.systemd?1:0))*cleanupBytes+128*1024+Buffer.byteLength(encoded(intent))*2>JOURNAL_BYTES)fail('WORKER_JOURNAL_LIMIT','Rotate the closed worker journal before admitting another executor',409);
}
export function createWorkerAttempt(root:string,intent:WorkerPlan):WorkerReference {
  validateWorkerPlan(intent);requireNoRotation(root);
  for(const r of readArchiveCatalog(root)?.archives??[])verifyJournalImage(root,r.plan.source);
  const j=open(root,true);
  try{
    const last=j.db.prepare('SELECT id,intent_digest FROM attempts ORDER BY rowid DESC LIMIT 1').get();
    if(last)readWorkerAttempt({root,journalId:j.journalId,attemptId:String(last.id),intentDigest:String(last.intent_digest)});
    j.db.exec('BEGIN IMMEDIATE');j.guard();requireNoMaintenance(j.db);
    if(j.db.prepare('SELECT id FROM attempts WHERE outcome IS NULL LIMIT 1').get())fail('WORKER_RECOVERY_REQUIRED','Earlier worker exit is unproven; no replacement was dispatched',409);
    if(j.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='systemd_workers'").get()&&j.db.prepare("SELECT a.id FROM attempts a JOIN systemd_workers s ON s.attempt_id=a.id WHERE s.terminal IS NULL AND NOT(s.fence IS NOT NULL AND s.unit IS NULL AND json_extract(a.outcome,'$.state')='NOT_STARTED') LIMIT 1").get())fail('WORKER_RECOVERY_REQUIRED','Earlier unit termination is unproven; no replacement was dispatched',409);
    if(Number(j.db.prepare('SELECT count(*) AS n FROM attempts').get()!.n)>=4096)fail('WORKER_JOURNAL_LIMIT','Worker history reached its fixed attempt budget',409);
    requireAdmissionCapacity(j.db,root,intent);
    const reference={root,journalId:j.journalId,attemptId:randomUUID(),intentDigest:sha(intent)};
    j.db.prepare('INSERT INTO attempts(id,intent,intent_digest) VALUES(?,?,?)').run(reference.attemptId,encoded(intent),reference.intentDigest);
    if(intent.systemd){
      j.db.exec('CREATE TABLE IF NOT EXISTS systemd_workers(attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),unit TEXT,unit_digest TEXT,fence TEXT,fence_digest TEXT,terminal TEXT,terminal_digest TEXT)');
      j.db.prepare('INSERT INTO systemd_workers(attempt_id) VALUES(?)').run(reference.attemptId);
    }
    j.db.exec('COMMIT');return reference;
  }finally{j.db.close();}
}
function referenceCheck(value:unknown):asserts value is WorkerReference {exact(value,['root','journalId','attemptId','intentDigest']);text(value.root,4096);id(value.journalId);id(value.attemptId);digest(value.intentDigest);}
function readAttempt(j:ReturnType<typeof open>,reference:WorkerReference):WorkerAttempt {
    if(j.journalId!==reference.journalId)fail('WORKER_EVIDENCE_INVALID','Worker journal identity differs',409);
    const r=j.db.prepare('SELECT * FROM attempts WHERE id=?').get(reference.attemptId);if(!r||r.intent_digest!==reference.intentDigest)fail('WORKER_EVIDENCE_MISSING','Exact worker attempt is absent',409);
    const field=(name:string)=>{if(r[name]===null){if(r[name+'_digest']!==null)fail('WORKER_EVIDENCE_INVALID','Partial worker evidence',409);return null;}const value:unknown=JSON.parse(String(r[name]));if(sha(value)!==r[name+'_digest'])fail('WORKER_EVIDENCE_INVALID','Worker evidence digest differs',409);return value;};
    const intent=field('intent');validateWorkerPlan(intent);
    const processRecord=(value:unknown):ProcessRecord|null=>{if(value===null)return null;exact(value,['pid','recordedAt']);text(value.recordedAt,40);if(!Number.isSafeInteger(value.pid)||(value.pid as number)<1)fail('WORKER_EVIDENCE_INVALID','Invalid retained process identity',409);return value as unknown as ProcessRecord;};
    const supervisor=processRecord(field('supervisor')),worker=processRecord(field('worker')),raw=field('outcome');
    let unit:UnitRecord|null=null,fence:LaunchFence|null=null,terminal:UnitTerminal|null=null,terminalDigest:string|null=null;
    if(intent.systemd){
      const resource=j.db.prepare('SELECT * FROM systemd_workers WHERE attempt_id=?').get(reference.attemptId);
      if(!resource)fail('WORKER_EVIDENCE_MISSING','Bound unit journal is missing',409);
      const retained=(key:string)=>{if(resource[key]===null){if(resource[key+'_digest']!==null)fail('WORKER_EVIDENCE_INVALID','Partial unit evidence',409);return null;}const value=JSON.parse(String(resource[key]));if(sha(value)!==resource[key+'_digest'])fail('WORKER_EVIDENCE_INVALID','Unit evidence digest differs',409);return value;};
      unit=retained('unit');fence=retained('fence');terminal=retained('terminal');terminalDigest=resource.terminal_digest===null?null:String(resource.terminal_digest);
      if(unit){validateUnitRecord(unit,reference);if(unit.supervisorPid!==supervisor?.pid||unit.bootId!==intent.systemd.owner.bootId)fail('WORKER_EVIDENCE_INVALID','Unit supervisor or boot differs',409);}
      if(supervisor&&!unit)fail('WORKER_EVIDENCE_INVALID','Bound supervisor has no unit identity',409);
      if(fence){exact(fence,['reason','recordedAt']);text(fence.recordedAt,40);if(!reasons.includes(fence.reason)||fence.reason===null)fail('WORKER_EVIDENCE_INVALID','Unknown launch fence',409);}
      if(terminal){
        exact(terminal,['unit','activeState','subState','result','execMainPid','execMainCode','execMainStatus','mainPid','empty','memoryPeak','recordedAt']);
        if(!unit||sha(terminal.unit)!==sha(unit)||terminal.execMainPid!==unit.supervisorPid||terminal.mainPid!==0||terminal.empty!==true||!['active/exited','failed/failed'].includes(terminal.activeState+'/'+terminal.subState)||![terminal.execMainCode,terminal.execMainStatus].every(Number.isSafeInteger)||terminal.memoryPeak!==null&&(!Number.isSafeInteger(terminal.memoryPeak)||terminal.memoryPeak<0))fail('WORKER_EVIDENCE_INVALID','Unit closure differs from its retained identity',409);
        text(terminal.result,64);text(terminal.recordedAt,40);
      }
    }
    if(worker&&!supervisor)fail('WORKER_EVIDENCE_INVALID','Worker lacks its supervisor identity',409);
    let outcome:WorkerOutcome|null=null;
    if(raw!==null){
      exact(raw,['state','reason','workerPid','exitCode','signal','stdoutDigest','stderrDigest','stdoutBytes','stderrBytes','recordedAt']);
      if(!['EXITED','NOT_STARTED','GROUP_TERMINATED'].includes(raw.state as string)||!reasons.includes(raw.reason as WorkerOutcome['reason']))fail('WORKER_EVIDENCE_INVALID','Invalid worker outcome',409);
      digest(raw.stdoutDigest);digest(raw.stderrDigest);text(raw.recordedAt,40);
      if(raw.workerPid!==(worker?.pid??null)||raw.state==='EXITED'&&!worker||raw.state==='NOT_STARTED'&&worker||raw.exitCode!==null&&!Number.isSafeInteger(raw.exitCode)||raw.signal!==null&&typeof raw.signal!=='string'||![raw.stdoutBytes,raw.stderrBytes].every(x=>Number.isSafeInteger(x)&&(x as number)>=0))fail('WORKER_EVIDENCE_INVALID','Worker exit identity or counters differ',409);
      if(raw.state==='EXITED'&&raw.exitCode===null&&raw.signal===null)fail('WORKER_EVIDENCE_INVALID','Exited worker lacks an exit status',409);
      if(raw.state==='GROUP_TERMINATED'&&(!intent.systemd||!fence||!terminal||raw.reason===null||raw.exitCode!==null||raw.signal!==null))fail('WORKER_EVIDENCE_INVALID','Group termination requires a durable fence and actual unit closure, without an invented child exit status',409);
      outcome=raw as unknown as WorkerOutcome;
    }
    return {reference:{...reference},intent,supervisor,worker,outcome,outcomeDigest:r.outcome_digest===null?null:String(r.outcome_digest),unit,fence,terminal,terminalDigest};
}
export function readWorkerAttempt(reference:WorkerReference):WorkerAttempt {
  referenceCheck(reference);const j=open(reference.root,false,reference.journalId,true);
  try{j.db.exec('BEGIN');const result=readAttempt(j,reference);j.guard();return result;}finally{j.db.close();}
}
/** One consistent read-only snapshot for bounded stopped-owner archival. */
export function currentWorkerAttempts(root:string):{journalId:string;attempts:WorkerAttempt[]} {
  const j=open(root,false,undefined,true);
  try{
    j.db.exec('BEGIN');const rows=j.db.prepare('SELECT id,intent_digest FROM attempts ORDER BY rowid LIMIT 4097').all();
    if(rows.length>4096)fail('WORKER_JOURNAL_LIMIT','Worker history exceeds its attempt budget',409);
    const attempts=rows.map(r=>readAttempt(j,{root,journalId:j.journalId,attemptId:String(r.id),intentDigest:String(r.intent_digest)}));
    j.guard();return {journalId:j.journalId,attempts};
  }finally{j.db.close();}
}
export function recordWorkerEvidence(reference:WorkerReference,field:'supervisor'|'worker'|'outcome',value:ProcessRecord|WorkerOutcome):void {
  const before=readWorkerAttempt(reference);if(before.intent.systemd&&field!=='outcome')fail('WORKER_PROTOCOL','Bound unit process claims require atomic launch admission');const j=open(reference.root,false,reference.journalId);
  try{j.guard();if(j.journalId!==reference.journalId)fail('WORKER_EVIDENCE_INVALID','Worker journal changed',409);
    const condition=field==='supervisor'?' AND outcome IS NULL AND worker IS NULL':field==='worker'?' AND outcome IS NULL AND supervisor IS NOT NULL':'';
    const changed=j.db.prepare(`UPDATE attempts SET ${field}=?,${field}_digest=? WHERE id=? AND intent_digest=? AND ${field} IS NULL${condition}`).run(encoded(value),sha(value),reference.attemptId,reference.intentDigest);
    if(changed.changes!==1)fail('WORKER_EVIDENCE_CONFLICT','Worker evidence is immutable',409);
  }finally{j.db.close();}
  readWorkerAttempt(reference);
}
export function taskWorkerReferences(root:string,taskId:string):WorkerReference[]{
  id(taskId);privatePath(root,true);
  const refs=withWorkerJournalHistory(root,j=>{
    const prefix=taskId+'-',rows=j.db.prepare("SELECT id,intent_digest FROM attempts WHERE json_extract(intent,'$.requestId')=? OR substr(json_extract(intent,'$.requestId'),1,?)=? ORDER BY id LIMIT 4097").all(taskId,prefix.length,prefix);
    if(rows.length>4096)fail('WORKER_JOURNAL_LIMIT','Task worker history exceeds its fixed budget',409);
    j.guard();return rows.map(r=>({root,journalId:j.journalId,attemptId:String(r.id),intentDigest:String(r.intent_digest)}));
  }).flat();
  if(refs.length>4096||new Set(refs.map(r=>r.attemptId)).size!==refs.length)fail('WORKER_EVIDENCE_INVALID','Task worker history is oversized or ambiguous',409);
  return refs;
}
/** Caller has stopped the owning service. This CAS fences a not-yet-started
 * supervisor; recordWorkerEvidence cannot launch through the committed fence. */
export function sealWorkerNotStarted(reference:WorkerReference):void {
  let a=readWorkerAttempt(reference);if(a.intent.systemd){fenceSystemdWorker(reference,'DISPATCH_REJECTED');a=readWorkerAttempt(reference);}if(a.supervisor||a.worker)fail('WORKER_EXIT_UNPROVEN','Supervisor already started; an actual exit receipt is required',409);
  if(a.outcome)return;
  const value:WorkerOutcome={state:'NOT_STARTED',reason:a.fence?.reason??'DISPATCH_REJECTED',workerPid:null,exitCode:null,signal:null,stdoutDigest:'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',stderrDigest:'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',stdoutBytes:0,stderrBytes:0,recordedAt:new Date().toISOString()};
  const j=open(reference.root,false,reference.journalId);try{
    if(j.journalId!==reference.journalId)fail('WORKER_EVIDENCE_INVALID','Worker journal changed',409);j.guard();
    const changed=j.db.prepare('UPDATE attempts SET outcome=?,outcome_digest=? WHERE id=? AND intent_digest=? AND supervisor IS NULL AND worker IS NULL AND outcome IS NULL').run(encoded(value),sha(value),reference.attemptId,reference.intentDigest);
    if(changed.changes!==1)fail('RECOVERY_CONFLICT','Worker launch state changed during recovery; inspect it again',409);
  }finally{j.db.close();}
}

/** Claim the manager-created supervisor and exact invocation in one transaction.
 * A delayed unit cannot pass a previously committed no-launch fence. */
export function claimSystemdSupervisor(reference:WorkerReference,unit:UnitRecord):void {
  const a=readWorkerAttempt(reference);validateUnitRecord(unit,reference);
  if(!a.intent.systemd||unit.supervisorPid!==process.pid||unit.bootId!==a.intent.systemd.owner.bootId)fail('WORKER_PROTOCOL','The actual bound unit supervisor must claim itself');
  const j=open(reference.root,false,reference.journalId);
  try{
    j.db.exec('BEGIN IMMEDIATE');j.guard();
    const resource=j.db.prepare('SELECT * FROM systemd_workers WHERE attempt_id=?').get(reference.attemptId);
    if(!resource||resource.fence!==null||resource.unit!==null)fail('WORKER_LAUNCH_FENCED','Unit launch is already claimed or permanently fenced',409);
    const value={pid:process.pid,recordedAt:new Date().toISOString()};
    const changed=j.db.prepare('UPDATE attempts SET supervisor=?,supervisor_digest=? WHERE id=? AND intent_digest=? AND supervisor IS NULL AND worker IS NULL AND outcome IS NULL').run(encoded(value),sha(value),reference.attemptId,reference.intentDigest);
    if(changed.changes!==1)fail('WORKER_LAUNCH_FENCED','Worker attempt can no longer launch',409);
    j.db.prepare('UPDATE systemd_workers SET unit=?,unit_digest=? WHERE attempt_id=?').run(encoded(unit),sha(unit),reference.attemptId);j.db.exec('COMMIT');
  }finally{j.db.close();}
}
/** Kernel placement already exists for the supervisor and is inherited by its
 * child. The durable fence and this actual spawn serialize on the same DB. */
export function launchSystemdChild<T extends {pid?:number;kill:(signal:'SIGKILL')=>boolean}>(reference:WorkerReference,launch:()=>T):T {
  const a=readWorkerAttempt(reference);
  if(!a.intent.systemd||!a.unit||a.supervisor?.pid!==process.pid)fail('WORKER_PROTOCOL','Exact admitted unit supervisor required');
  const j=open(reference.root,false,reference.journalId);let child:T|undefined;
  try{
    j.db.exec('BEGIN IMMEDIATE');j.guard();
    const resource=j.db.prepare('SELECT * FROM systemd_workers WHERE attempt_id=?').get(reference.attemptId),attempt=j.db.prepare('SELECT * FROM attempts WHERE id=?').get(reference.attemptId);
    if(!resource||resource.fence!==null||resource.unit_digest!==sha(a.unit)||!attempt||attempt.outcome!==null||attempt.worker!==null||attempt.supervisor_digest!==sha(a.supervisor))fail('WORKER_LAUNCH_FENCED','Executor launch is permanently fenced or already claimed',409);
    child=launch();if(!child.pid)fail('WORKER_SPAWN_FAILED','Kernel executor spawn failed');
    const value={pid:child.pid,recordedAt:new Date().toISOString()};
    j.db.prepare('UPDATE attempts SET worker=?,worker_digest=? WHERE id=?').run(encoded(value),sha(value),reference.attemptId);
    j.db.exec('COMMIT');return child;
  }catch(e){child?.kill('SIGKILL');throw e;}finally{j.db.close();}
}
export function fenceSystemdWorker(reference:WorkerReference,reason:LaunchFence['reason']):LaunchFence {
  const a=readWorkerAttempt(reference);if(!a.intent.systemd||!reasons.includes(reason)||reason===null)fail('WORKER_PROTOCOL','A bound unit and explicit stop reason are required');
  const j=open(reference.root,false,reference.journalId);
  try{
    j.db.exec('BEGIN IMMEDIATE');j.guard();
    const old=j.db.prepare('SELECT fence,fence_digest FROM systemd_workers WHERE attempt_id=?').get(reference.attemptId);
    if(!old)fail('WORKER_EVIDENCE_MISSING','Unit journal missing',409);
    if(old.fence!==null){const saved=JSON.parse(String(old.fence));if(sha(saved)!==old.fence_digest)fail('WORKER_EVIDENCE_INVALID','Launch fence changed',409);j.db.exec('COMMIT');return saved;}
    const value={reason,recordedAt:new Date().toISOString()};
    j.db.prepare('UPDATE systemd_workers SET fence=?,fence_digest=? WHERE attempt_id=? AND fence IS NULL').run(encoded(value),sha(value),reference.attemptId);
    j.db.exec('COMMIT');return value;
  }finally{j.db.close();}
}
export function recordUnitTerminal(reference:WorkerReference,value:UnitTerminal):UnitTerminal {
  const a=readWorkerAttempt(reference);if(a.terminal)return a.terminal;
  if(!a.unit||sha(value.unit)!==sha(a.unit))fail('WORKER_EVIDENCE_INVALID','Foreign unit terminal record',409);
  const j=open(reference.root,false,reference.journalId);
  try{
    j.guard();const changed=j.db.prepare('UPDATE systemd_workers SET terminal=?,terminal_digest=? WHERE attempt_id=? AND unit_digest=? AND terminal IS NULL').run(encoded(value),sha(value),reference.attemptId,sha(a.unit));
    if(changed.changes!==1)fail('WORKER_EVIDENCE_CONFLICT','Unit terminal evidence changed',409);
  }finally{j.db.close();}
  return readWorkerAttempt(reference).terminal!;
}
