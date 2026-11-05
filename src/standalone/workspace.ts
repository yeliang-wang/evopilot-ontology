import { DatabaseSync } from 'node:sqlite';
import {readResetRecords} from './reset-records.js';
import {validateUpgradeCompletionEnvelope} from '../installation/upgrade-receipt.js';
import { constants, openSync, closeSync, readFileSync, lstatSync, realpathSync, readdirSync, fstatSync } from 'node:fs';
import { resolve, join, isAbsolute, dirname } from 'node:path';
import { fail, LIMITS } from './types.js';
import type { WorkspaceIdentity, Credentials, Json } from './types.js';
import { validateIdentity, validateCredentials, hashBytes,hash,exact,id,digest,text } from './validation.js';

export const STATE_VERSION = 14;
export const FILES = Object.freeze({identity:'identity.json', credentials:'credentials.json', db:'ontology.sqlite', lease:'writer.sqlite'});
export const MAINTENANCE_FILE='maintenance-barrier.json';
export const RESTORE_STAGE_BARRIER='restore-stage-barrier.json';
export const RESTORE_ACTIVATION_BARRIER='restore-activation-barrier.json';
export const UPGRADE_BARRIER='upgrade-barrier.json';
export const UPGRADE_RECORDS='upgrade-requests';
export interface MaintenancePermit {requestId:string;requestDigest:string;operation?:'UPGRADE'|'BACKUP'|'RESET';}
export interface UpgradeBarrier {schema:'ontology-upgrade-barrier/v1';root:string;upgradeRoot:string;installationId:string;workspaceId:string;serviceId:string;requestId:string;requestDigest:string;reportDigest:string;}
export interface RestoreActivationBarrier extends MaintenancePermit {schema:'ontology-restore-activation-barrier/v1';root:string;recoveryRoot:string;installationId:string;workspaceId:string;serviceId:string;}
export function readRestoreActivationBarrier(root:string):RestoreActivationBarrier|null {
  const file=join(root,RESTORE_ACTIVATION_BARRIER);try{lstatSync(file);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
  const v:unknown=JSON.parse(privateRead(file,65536));exact(v,['schema','root','recoveryRoot','installationId','workspaceId','serviceId','requestId','requestDigest']);
  for(const k of ['installationId','workspaceId','serviceId','requestId'])id(v[k]);digest(v.requestDigest);text(v.recoveryRoot,4096);
  if(v.schema!=='ontology-restore-activation-barrier/v1'||v.root!==root||!isAbsolute(v.recoveryRoot))fail('RESTORE_ACTIVATION_EVIDENCE','Foreign restore activation barrier',409);
  return v as unknown as RestoreActivationBarrier;
}
export interface MaintenanceBarrier extends MaintenancePermit {schema:'ontology-maintenance-barrier/v1';operation:'BACKUP';root:string;backupRoot:string;installationId:string;workspaceId:string;serviceId:string;reportDigest:string;}
export function readMaintenanceBarrier(root:string):MaintenanceBarrier|null {
  const file=join(root,MAINTENANCE_FILE);try{lstatSync(file);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
  const v:unknown=JSON.parse(privateRead(file,65536));exact(v,['schema','operation','root','backupRoot','installationId','workspaceId','serviceId','requestId','requestDigest','reportDigest']);
  for(const k of ['installationId','workspaceId','serviceId','requestId'])id(v[k]);digest(v.requestDigest);digest(v.reportDigest);text(v.backupRoot,4096);
  if(v.schema!=='ontology-maintenance-barrier/v1'||v.operation!=='BACKUP'||v.root!==root||!isAbsolute(v.backupRoot))fail('MAINTENANCE_EVIDENCE','Invalid retained maintenance barrier',409);
  return v as unknown as MaintenanceBarrier;
}
/** The installation anchor closes the admission-to-barrier crash window.
 * Exact terminal receipts remain readable after backups relocate their files. */
export const upgradeControlKey=(requestId:string):string=>{id(requestId);return Buffer.from(requestId,'utf8').toString('hex');};
const controlName=/^([a-f0-9]{2,192})(\.aborted\.json|\.released\.json|\.stage\.json|\.switch\.json|\.completed\.json|\.reserve|\.json)(\.pending)?$/;
export function upgradeControlNames(root:string):string[] {
  const directory=join(root,UPGRADE_RECORDS);
  if(!readdirSync(root).includes(UPGRADE_RECORDS))return [];
  privatePath(directory,true);const names=readdirSync(directory).sort();
  if(names.length>1024)fail('UPGRADE_LIMIT','Upgrade history exceeds its retained control budget',409);
  let bytes=0;
  for(const name of names){
    const match=controlName.exec(name);
    if(!match)fail('UPGRADE_EVIDENCE','Unknown upgrade control material was preserved',409);
    const requestId=Buffer.from(match[1]!,'hex').toString('utf8');id(requestId);if(upgradeControlKey(requestId)!==match[1])fail('UPGRADE_EVIDENCE','Invalid upgrade control name',409);const file=join(directory,name);privatePath(file);
    const size=lstatSync(file).size;bytes+=size;
    if(size>8*1024*1024||bytes>64*1024*1024)fail('UPGRADE_LIMIT','Upgrade control records exceed their metadata budget',409);
  }
  return names;
}
function requireUpgradeAvailable(root:string,permit?:MaintenancePermit):void {
  const names=upgradeControlNames(root),directory=join(root,UPGRADE_RECORDS),requests=new Set<string>();
  for(const n of names)requests.add(Buffer.from(controlName.exec(n)![1]!,'hex').toString('utf8'));
  if(requests.size>128)fail('UPGRADE_LIMIT','Upgrade request history exceeds its budget',409);
  for(const requestId of requests){
    const key=upgradeControlKey(requestId);
    if(permit?.operation==='UPGRADE'&&permit.requestId===requestId)continue;
    if(!names.includes(key+'.released.json'))fail('UPGRADE_PENDING','Resume or abort the original upgrade before using this installation',409);
    const a:unknown=JSON.parse(privateRead(join(directory,key+'.json'),8*1024*1024));
    exact(a,['schema','input','report','reportDigest','requestDigest','controlNode']);
    const r:unknown=JSON.parse(privateRead(join(directory,key+'.released.json'),65536));
    if(r&&typeof r==='object'&&!Array.isArray(r)&&'schema' in r&&r.schema==='ontology-upgrade-released/v2'){
      const stage:unknown=JSON.parse(privateRead(join(directory,key+'.stage.json'),65536));
      const switched:unknown=JSON.parse(privateRead(join(directory,key+'.switch.json'),65536));
      const completed:unknown=JSON.parse(privateRead(join(directory,key+'.completed.json'),65536));
      validateUpgradeCompletionEnvelope(a,stage,switched,completed,r);
      if(completed.requestId!==requestId||names.some(n=>controlName.exec(n)![1]===key&&!['.json','.stage.json','.switch.json','.completed.json','.released.json'].some(s=>n===key+s)))fail('UPGRADE_EVIDENCE','Released upgrade has unresolved or foreign control material',409);
      continue;
    }
    exact(r,['schema','requestId','requestDigest','reportDigest','admissionDigest','abortDigest','authority'],['stageDigest']);
    const aborted:unknown=JSON.parse(privateRead(join(directory,key+'.aborted.json'),65536));
    exact(aborted,['schema','requestId','requestDigest','reportDigest','upgradeRoot','runtimeActivated','serviceStarted','partialMaterialRetained','authority']);
    if(a.schema!=='ontology-upgrade-admission/v1'||r.schema!=='ontology-upgrade-released/v1'||aborted.schema!=='ontology-upgrade-abort/v1'||r.requestId!==requestId||aborted.requestId!==requestId||r.requestDigest!==a.requestDigest||aborted.requestDigest!==a.requestDigest||r.reportDigest!==a.reportDigest||aborted.reportDigest!==a.reportDigest||r.admissionDigest!==hash(a as Json)||r.abortDigest!==hash(aborted as Json)||hash(a.report as Json)!==a.reportDigest||r.authority!==false||aborted.authority!==false||aborted.runtimeActivated!==false||aborted.serviceStarted!==false||aborted.partialMaterialRetained!==true)fail('UPGRADE_EVIDENCE','Upgrade terminal evidence differs from its admission',409);
    if(r.stageDigest!==undefined){digest(r.stageDigest);const stage:unknown=JSON.parse(privateRead(join(directory,key+'.stage.json'),65536));if(hash(stage as Json)!==r.stageDigest)fail('UPGRADE_EVIDENCE','Retained upgrade stage identity differs',409);}
    if(names.some(n=>controlName.exec(n)![1]===key&&![ '.json','.aborted.json','.released.json',...(r.stageDigest!==undefined?['.stage.json']:[])].some(s=>n===key+s)))fail('UPGRADE_EVIDENCE','Released upgrade has unresolved control material',409);
  }
  const marker=join(root,UPGRADE_BARRIER),pending=UPGRADE_BARRIER+'.pending',entries=readdirSync(root);
  if(entries.includes(pending))fail('UPGRADE_PENDING','Complete the original partial upgrade barrier before using this owner',409);
  if(entries.includes(UPGRADE_BARRIER)){
    const v:unknown=JSON.parse(privateRead(marker,65536));exact(v,['schema','root','upgradeRoot','installationId','workspaceId','serviceId','requestId','requestDigest','reportDigest']);
    for(const k of ['installationId','workspaceId','serviceId','requestId'])id(v[k]);digest(v.requestDigest);digest(v.reportDigest);
    if(v.schema!=='ontology-upgrade-barrier/v1'||v.root!==root||typeof v.upgradeRoot!=='string'||!isAbsolute(v.upgradeRoot))fail('UPGRADE_EVIDENCE','Foreign upgrade barrier was preserved',409);
    if(permit?.operation!=='UPGRADE'||v.requestId!==permit.requestId||v.requestDigest!==permit.requestDigest)fail('UPGRADE_PENDING','Resume or abort the original upgrade before using this owner',409);
  }
}
export function requireMaintenanceAvailable(root:string,permit?:MaintenancePermit):void {
  readResetRecords(root,permit);
  requireUpgradeAvailable(root,permit);
  // A materialized snapshot is not an activated owner. Even an interrupted
  // barrier write must fail closed before identity/credentials or tasks open.
  if(readdirSync(root).some(n=>n===RESTORE_STAGE_BARRIER||n===RESTORE_STAGE_BARRIER+'.pending'))fail('RESTORE_STAGED','Restore candidate is inactive; owner activation and request/history reconciliation are required',409);
  const recovery=readRestoreActivationBarrier(root);
  if(recovery?(!permit||recovery.requestId!==permit.requestId||recovery.requestDigest!==permit.requestDigest):readdirSync(root).includes(RESTORE_ACTIVATION_BARRIER+'.pending'))fail('RESTORE_ACTIVATION_PENDING','Resume the original owner restore before using this workspace or installation',409);
  const marker=readMaintenanceBarrier(root);
  if(marker&&(!permit||marker.requestId!==permit.requestId||marker.requestDigest!==permit.requestDigest))fail('BACKUP_PENDING','Resume or abort the original installation backup before using this owner',409);
}
export function privatePath(path: string, directory = false): void {
  const s = lstatSync(path);
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1) || s.uid !== process.getuid?.() || (s.mode & 0o077) !== 0) fail('UNSAFE_PATH', 'Private owned regular workspace path required');
}
export function privateRead(path: string, max: number): string {
  privatePath(path);
  const before=lstatSync(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened=fstatSync(fd);
    if (opened.ino!==before.ino || opened.dev!==before.dev || !opened.isFile() || opened.nlink!==1 || opened.uid!==process.getuid?.() || (opened.mode&0o077)) fail('UNSAFE_PATH','Protected file changed during read');
    if (opened.size>max) fail('INPUT_LIMIT','Protected configuration exceeds limit',413);
    const content = readFileSync(fd); if (content.length > max) fail('INPUT_LIMIT', 'Protected configuration exceeds limit', 413); return content.toString('utf8');
  }
  finally { closeSync(fd); }
}
/** A committed empty SQLite header lets later lease acquisition remain read-only,
 * including when backup payloads have filled the filesystem. Initialization is
 * serialized by the same exclusive lease and never touches business state. */
export function privateLease(path:string,busyCode:string,busyMessage:string):DatabaseSync {
  privatePath(path);const before=lstatSync(path);if(before.size>65536)fail('LEASE_EVIDENCE','Private lease store exceeds its fixed metadata budget',409);
  const sidecar=path+'-journal';if(readdirSync(dirname(path)).includes(sidecar.slice(sidecar.lastIndexOf('/')+1)))privatePath(sidecar);
  const db=new DatabaseSync(path,{timeout:0});
  try{
    try{db.exec('PRAGMA locking_mode=EXCLUSIVE;PRAGMA synchronous=FULL;BEGIN EXCLUSIVE');}catch{fail(busyCode,busyMessage,409);}
    const after=lstatSync(path);if(after.dev!==before.dev||after.ino!==before.ino)fail('UNSAFE_PATH','Private lease file was replaced',409);
    const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);
    if(![0,1].includes(version)||db.prepare("SELECT name FROM sqlite_master LIMIT 1").get()||db.prepare('PRAGMA journal_mode').get()?.journal_mode!=='delete')fail('LEASE_EVIDENCE','Foreign private lease store was preserved',409);
    if(version===0)db.exec('PRAGMA user_version=1;COMMIT;BEGIN EXCLUSIVE');
    return db;
  }catch(e){db.close();throw e;}
}
export function workspacePath(path: string): string {
  if (!isAbsolute(path)) fail('UNSAFE_PATH', 'Absolute workspace path required');
  privatePath(path, true);
  const root = realpathSync(path);
  for (let p = root; ; p = dirname(p)) {
    if (readdirSync(p).includes('.git')) fail('UNSAFE_PATH', 'Workspace cannot be inside a source repository');
    if (dirname(p) === p) break;
  }
  return root;
}
export interface WorkspaceStore {
  root: string; identity: WorkspaceIdentity; db: DatabaseSync;
  guard(): void; credentials(): Credentials; close(): void;
}
export function openWorkspace(path: string, expected: {workspaceId: string; serviceId: string},maintenance?:MaintenancePermit): WorkspaceStore {
  const root = workspacePath(path), identityPath = join(root, FILES.identity);requireMaintenanceAvailable(root,maintenance);
  const raw = privateRead(identityPath, 4096), identity: unknown = JSON.parse(raw);
  validateIdentity(identity);
  if (identity.workspaceId !== expected.workspaceId || identity.serviceId !== expected.serviceId) fail('IDENTITY_MISMATCH', 'Workspace/service identity mismatch', 403);
  const identityHash = hashBytes(raw);
  for (const name of [FILES.db, FILES.lease]) privatePath(join(root, name));
  const dbPath = join(root, FILES.db), leasePath = join(root, FILES.lease);
  const anchors = new Map([root, identityPath, dbPath, leasePath].map(p => { const s=lstatSync(p); return [p, {ino:s.ino, dev:s.dev}]; }));
  let lease: DatabaseSync | undefined, db: DatabaseSync | undefined, closed = false;
  try {
    lease = privateLease(leasePath,'WORKSPACE_BUSY','Another writer owns this workspace');
    db = new DatabaseSync(dbPath, {timeout:0});
    db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
    const version = db.prepare('PRAGMA user_version').get()?.user_version;
    if (version !== STATE_VERSION) fail('UNSUPPORTED_STATE', 'Unknown state schema; no implicit migration');
    if(db.prepare('PRAGMA journal_mode').get()?.journal_mode!=='delete')fail('UNSUPPORTED_STATE','Independent state requires rollback-journal mode');
    const pageSize=Number(db.prepare('PRAGMA page_size').get()?.page_size);
    const pages=Number(db.prepare('PRAGMA page_count').get()?.page_count);
    if(!Number.isSafeInteger(pageSize)||pageSize<=0||!Number.isSafeInteger(pages)||pages*pageSize>LIMITS.stateBytes)fail('STATE_LIMIT','Protected state exceeds its byte budget',409);
    db.exec('PRAGMA max_page_count='+Math.floor(LIMITS.stateBytes/pageSize));
    const stored = db.prepare('SELECT identity FROM workspace WHERE singleton=1').get();
    if (!stored || stored.identity !== raw) fail('CORRUPT_STATE', 'Database identity mismatch');
    const guard = (): void => {
      if (closed) fail('CLOSED', 'Workspace is closed', 503);
      requireMaintenanceAvailable(root,maintenance);
      privatePath(root, true);
      for (const [p, a] of anchors) { const s=lstatSync(p); privatePath(p, p===root); if (s.ino!==a.ino || s.dev!==a.dev) fail('WORKSPACE_CHANGED', 'Workspace file identity changed', 409); }
      if (hashBytes(privateRead(identityPath,4096)) !== identityHash) fail('WORKSPACE_CHANGED', 'Workspace identity changed',409);
      for (const name of ['ontology.sqlite-journal','writer.sqlite-journal']) if (readdirSync(root).includes(name)) privatePath(join(root,name));
    };
    const credentials = (): Credentials => {
      guard(); const value: unknown=JSON.parse(privateRead(join(root,FILES.credentials), 512*1024));
      validateCredentials(value, identity); return value;
    };
    credentials();
    return {root, identity, db, guard, credentials, close() { if (!closed) {closed=true; try {db?.close();} finally {lease?.close();}} }};
  } catch (e) {try {db?.close();} finally {lease?.close();} throw e;}
}
