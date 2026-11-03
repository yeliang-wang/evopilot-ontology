import {DatabaseSync} from 'node:sqlite';
import {existsSync,openSync,closeSync,lstatSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {outsideSource} from './files.js';
import {privatePath} from '../standalone/workspace.js';
import {exact,hash,id,digest,text} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

export const WORKER_PROTOCOL='ontology-owned-worker/v1';
export interface WorkerPlan {
  schema:typeof WORKER_PROTOCOL;requestId:string;requestDigest:string;configurationDigest:string;toolchainDigest:string;
  executable:string;args:string[];env:Record<string,string>;stdinDigest:string;stdinBytes:number;
  timeoutMs:number;outputBytes:number;diagnosticBytes:number;
}
export interface WorkerReference {root:string;journalId:string;attemptId:string;intentDigest:string;}
export interface ProcessRecord {pid:number;recordedAt:string;}
export interface WorkerOutcome {
  state:'EXITED'|'NOT_STARTED';reason:null|'OWNER_LOST'|'CANCELLED'|'TASK_DEADLINE'|'OUTPUT_LIMIT'|'DIAGNOSTIC_LIMIT'|'SPAWN_FAILED'|'INPUT_INVALID'|'DISPATCH_REJECTED';
  workerPid:number|null;exitCode:number|null;signal:string|null;stdoutDigest:string;stderrDigest:string;stdoutBytes:number;stderrBytes:number;recordedAt:string;
}
export interface WorkerAttempt {reference:WorkerReference;intent:WorkerPlan;supervisor:ProcessRecord|null;worker:ProcessRecord|null;outcome:WorkerOutcome|null;outcomeDigest:string|null;}
const encoded=(value:unknown)=>JSON.stringify(value);
const sha=(value:unknown)=>hash(value as Json);
export function validateWorkerPlan(value:unknown):asserts value is WorkerPlan {
  exact(value,['schema','requestId','requestDigest','configurationDigest','toolchainDigest','executable','args','env','stdinDigest','stdinBytes','timeoutMs','outputBytes','diagnosticBytes']);
  if(value.schema!==WORKER_PROTOCOL)fail('WORKER_PROTOCOL','Unknown owned worker protocol');
  text(value.requestId,256);for(const key of ['requestDigest','configurationDigest','toolchainDigest','stdinDigest'])digest(value[key]);
  text(value.executable,4096);if(!isAbsolute(value.executable))fail('UNSAFE_PATH','Explicit installed executable required');
  if(!Array.isArray(value.args)||value.args.length>128||value.args.some(x=>typeof x!=='string'||x.includes('\0')||Buffer.byteLength(x)>24576))fail('WORKER_PROTOCOL','Invalid worker arguments');
  if(!value.env||typeof value.env!=='object'||Array.isArray(value.env)||Object.entries(value.env).length>32||Object.entries(value.env).some(([k,v])=>!/^[A-Z_][A-Z_0-9]*$/.test(k)||typeof v!=='string'||v.includes('\0')||Buffer.byteLength(v)>8192))fail('WORKER_PROTOCOL','Invalid worker environment');
  for(const [key,min,max] of [['stdinBytes',1,50*1024*1024],['timeoutMs',1,120000],['outputBytes',1,17*1024*1024],['diagnosticBytes',1,65536]] as const){if(!Number.isSafeInteger(value[key])||(value[key] as number)<min||(value[key] as number)>max)fail('WORKER_PROTOCOL','Worker budget exceeds fixed envelope');}
  if(Buffer.byteLength(encoded(value))>32768)fail('WORKER_PROTOCOL','Worker intent byte budget exceeded');
}
function open(root:string,create=false){
  privatePath(root,true);if(outsideSource(root)!==root)fail('UNSAFE_PATH','Canonical worker root required');
  const file=join(root,'worker-journal.sqlite');let fresh=false;
  if(!existsSync(file)){if(!create)fail('WORKER_EVIDENCE_MISSING','Worker journal is absent',409);const fd=openSync(file,'wx',0o600);closeSync(fd);fresh=true;}
  privatePath(file);const anchor=lstatSync(file),db=new DatabaseSync(file,{timeout:1000});
  try{
    db.exec('PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    if(fresh){db.exec('BEGIN IMMEDIATE; CREATE TABLE identity(value TEXT NOT NULL); CREATE TABLE attempts(id TEXT PRIMARY KEY,intent TEXT NOT NULL,intent_digest TEXT NOT NULL,supervisor TEXT,supervisor_digest TEXT,worker TEXT,worker_digest TEXT,outcome TEXT,outcome_digest TEXT); PRAGMA user_version=1;');db.prepare('INSERT INTO identity VALUES(?)').run(encoded({schema:'ontology-worker-journal/v1',root,journalId:randomUUID()}));db.exec('COMMIT');}
    if(db.prepare('PRAGMA user_version').get()?.user_version!==1||db.prepare('PRAGMA journal_mode').get()?.journal_mode!=='delete')fail('WORKER_EVIDENCE_INVALID','Unknown worker journal schema',409);
    const bytes=Number(db.prepare('PRAGMA page_count').get()?.page_count)*Number(db.prepare('PRAGMA page_size').get()?.page_size);if(bytes>64*1024*1024)fail('WORKER_JOURNAL_LIMIT','Worker journal exceeds its fixed budget',409);
    db.exec('PRAGMA max_page_count='+Math.floor(64*1024*1024/Number(db.prepare('PRAGMA page_size').get()?.page_size)));
    const identities=db.prepare('SELECT value FROM identity').all();if(identities.length!==1)fail('WORKER_EVIDENCE_INVALID','Worker journal identity is ambiguous',409);
    const identity:unknown=JSON.parse(String(identities[0].value));exact(identity,['schema','root','journalId']);id(identity.journalId);
    if(identity.schema!=='ontology-worker-journal/v1'||identity.root!==root)fail('WORKER_EVIDENCE_INVALID','Worker journal owner differs',409);
    const guard=()=>{privatePath(file);const s=lstatSync(file);if(s.ino!==anchor.ino||s.dev!==anchor.dev)fail('WORKER_EVIDENCE_INVALID','Worker journal was replaced',409);if(existsSync(file+'-journal'))privatePath(file+'-journal');};
    guard();return {db,journalId:identity.journalId,guard};
  }catch(e){db.close();throw e;}
}
export function createWorkerAttempt(root:string,intent:WorkerPlan):WorkerReference {
  validateWorkerPlan(intent);const j=open(root,true);
  try{
    const last=j.db.prepare('SELECT id,intent_digest FROM attempts ORDER BY rowid DESC LIMIT 1').get();
    if(last)readWorkerAttempt({root,journalId:j.journalId,attemptId:String(last.id),intentDigest:String(last.intent_digest)});
    j.db.exec('BEGIN IMMEDIATE');j.guard();
    if(j.db.prepare('SELECT id FROM attempts WHERE outcome IS NULL LIMIT 1').get())fail('WORKER_RECOVERY_REQUIRED','Earlier worker exit is unproven; no replacement was dispatched',409);
    if(Number(j.db.prepare('SELECT count(*) AS n FROM attempts').get()!.n)>=4096)fail('WORKER_JOURNAL_LIMIT','Worker history reached its fixed attempt budget',409);
    const reference={root,journalId:j.journalId,attemptId:randomUUID(),intentDigest:sha(intent)};
    j.db.prepare('INSERT INTO attempts(id,intent,intent_digest) VALUES(?,?,?)').run(reference.attemptId,encoded(intent),reference.intentDigest);j.db.exec('COMMIT');return reference;
  }finally{j.db.close();}
}
function referenceCheck(value:unknown):asserts value is WorkerReference {exact(value,['root','journalId','attemptId','intentDigest']);text(value.root,4096);id(value.journalId);id(value.attemptId);digest(value.intentDigest);}
export function readWorkerAttempt(reference:WorkerReference):WorkerAttempt {
  referenceCheck(reference);const j=open(reference.root);
  try{
    if(j.journalId!==reference.journalId)fail('WORKER_EVIDENCE_INVALID','Worker journal identity differs',409);
    const r=j.db.prepare('SELECT * FROM attempts WHERE id=?').get(reference.attemptId);if(!r||r.intent_digest!==reference.intentDigest)fail('WORKER_EVIDENCE_MISSING','Exact worker attempt is absent',409);
    const field=(name:string)=>{if(r[name]===null){if(r[name+'_digest']!==null)fail('WORKER_EVIDENCE_INVALID','Partial worker evidence',409);return null;}const value:unknown=JSON.parse(String(r[name]));if(sha(value)!==r[name+'_digest'])fail('WORKER_EVIDENCE_INVALID','Worker evidence digest differs',409);return value;};
    const intent=field('intent');validateWorkerPlan(intent);
    const processRecord=(value:unknown):ProcessRecord|null=>{if(value===null)return null;exact(value,['pid','recordedAt']);text(value.recordedAt,40);if(!Number.isSafeInteger(value.pid)||(value.pid as number)<1)fail('WORKER_EVIDENCE_INVALID','Invalid retained process identity',409);return value as unknown as ProcessRecord;};
    const supervisor=processRecord(field('supervisor')),worker=processRecord(field('worker')),raw=field('outcome');
    if(worker&&!supervisor)fail('WORKER_EVIDENCE_INVALID','Worker lacks its supervisor identity',409);
    let outcome:WorkerOutcome|null=null;
    if(raw!==null){
      exact(raw,['state','reason','workerPid','exitCode','signal','stdoutDigest','stderrDigest','stdoutBytes','stderrBytes','recordedAt']);
      if(!['EXITED','NOT_STARTED'].includes(raw.state as string)||![null,'OWNER_LOST','CANCELLED','TASK_DEADLINE','OUTPUT_LIMIT','DIAGNOSTIC_LIMIT','SPAWN_FAILED','INPUT_INVALID','DISPATCH_REJECTED'].includes(raw.reason as null|string))fail('WORKER_EVIDENCE_INVALID','Invalid worker outcome',409);
      digest(raw.stdoutDigest);digest(raw.stderrDigest);text(raw.recordedAt,40);
      if(raw.workerPid!==(worker?.pid??null)||raw.state==='EXITED'&&!worker||raw.state==='NOT_STARTED'&&worker||raw.exitCode!==null&&!Number.isSafeInteger(raw.exitCode)||raw.signal!==null&&typeof raw.signal!=='string'||![raw.stdoutBytes,raw.stderrBytes].every(x=>Number.isSafeInteger(x)&&(x as number)>=0))fail('WORKER_EVIDENCE_INVALID','Worker exit identity or counters differ',409);
      if(raw.state==='EXITED'&&raw.exitCode===null&&raw.signal===null)fail('WORKER_EVIDENCE_INVALID','Exited worker lacks an exit status',409);
      outcome=raw as unknown as WorkerOutcome;
    }
    j.guard();return {reference:{...reference},intent,supervisor,worker,outcome,outcomeDigest:r.outcome_digest===null?null:String(r.outcome_digest)};
  }finally{j.db.close();}
}
export function recordWorkerEvidence(reference:WorkerReference,field:'supervisor'|'worker'|'outcome',value:ProcessRecord|WorkerOutcome):void {
  readWorkerAttempt(reference);const j=open(reference.root);
  try{j.guard();if(j.journalId!==reference.journalId)fail('WORKER_EVIDENCE_INVALID','Worker journal changed',409);
    const condition=field==='supervisor'?' AND outcome IS NULL AND worker IS NULL':field==='worker'?' AND outcome IS NULL AND supervisor IS NOT NULL':'';
    const changed=j.db.prepare(`UPDATE attempts SET ${field}=?,${field}_digest=? WHERE id=? AND intent_digest=? AND ${field} IS NULL${condition}`).run(encoded(value),sha(value),reference.attemptId,reference.intentDigest);
    if(changed.changes!==1)fail('WORKER_EVIDENCE_CONFLICT','Worker evidence is immutable',409);
  }finally{j.db.close();}
  readWorkerAttempt(reference);
}
export function taskWorkerReferences(root:string,taskId:string):WorkerReference[]{
  id(taskId);privatePath(root,true);if(!existsSync(join(root,'worker-journal.sqlite')))return [];
  const j=open(root);try{
    const prefix=taskId+'-',rows=j.db.prepare("SELECT id,intent_digest FROM attempts WHERE json_extract(intent,'$.requestId')=? OR substr(json_extract(intent,'$.requestId'),1,?)=? ORDER BY id LIMIT 4097").all(taskId,prefix.length,prefix);
    if(rows.length>4096)fail('WORKER_JOURNAL_LIMIT','Worker history exceeds its fixed attempt budget',409);
    return rows.map(r=>({root,journalId:j.journalId,attemptId:String(r.id),intentDigest:String(r.intent_digest)}));
  }finally{j.db.close();}
}
/** Caller has stopped the owning service. This CAS fences a not-yet-started
 * supervisor; recordWorkerEvidence cannot launch through the committed fence. */
export function sealWorkerNotStarted(reference:WorkerReference):void {
  const a=readWorkerAttempt(reference);if(a.supervisor||a.worker)fail('WORKER_EXIT_UNPROVEN','Supervisor already started; an actual exit receipt is required',409);
  if(a.outcome)return;
  const value:WorkerOutcome={state:'NOT_STARTED',reason:'DISPATCH_REJECTED',workerPid:null,exitCode:null,signal:null,stdoutDigest:'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',stderrDigest:'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',stdoutBytes:0,stderrBytes:0,recordedAt:new Date().toISOString()};
  const j=open(reference.root);try{
    if(j.journalId!==reference.journalId)fail('WORKER_EVIDENCE_INVALID','Worker journal changed',409);j.guard();
    const changed=j.db.prepare('UPDATE attempts SET outcome=?,outcome_digest=? WHERE id=? AND intent_digest=? AND supervisor IS NULL AND worker IS NULL AND outcome IS NULL').run(encoded(value),sha(value),reference.attemptId,reference.intentDigest);
    if(changed.changes!==1)fail('RECOVERY_CONFLICT','Worker launch state changed during recovery; inspect it again',409);
  }finally{j.db.close();}
}
