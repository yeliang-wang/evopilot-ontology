import { DatabaseSync } from 'node:sqlite';
import { constants, openSync, closeSync, readFileSync, lstatSync, realpathSync, readdirSync, fstatSync } from 'node:fs';
import { resolve, join, isAbsolute, dirname } from 'node:path';
import { fail, LIMITS } from './types.js';
import type { WorkspaceIdentity, Credentials } from './types.js';
import { validateIdentity, validateCredentials, hashBytes,exact,id,digest,text } from './validation.js';

export const STATE_VERSION = 14;
export const FILES = Object.freeze({identity:'identity.json', credentials:'credentials.json', db:'ontology.sqlite', lease:'writer.sqlite'});
export const MAINTENANCE_FILE='maintenance-barrier.json';
export interface MaintenancePermit {requestId:string;requestDigest:string;}
export interface MaintenanceBarrier extends MaintenancePermit {schema:'ontology-maintenance-barrier/v1';operation:'BACKUP';root:string;backupRoot:string;installationId:string;workspaceId:string;serviceId:string;reportDigest:string;}
export function readMaintenanceBarrier(root:string):MaintenanceBarrier|null {
  const file=join(root,MAINTENANCE_FILE);try{lstatSync(file);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
  const v:unknown=JSON.parse(privateRead(file,65536));exact(v,['schema','operation','root','backupRoot','installationId','workspaceId','serviceId','requestId','requestDigest','reportDigest']);
  for(const k of ['installationId','workspaceId','serviceId','requestId'])id(v[k]);digest(v.requestDigest);digest(v.reportDigest);text(v.backupRoot,4096);
  if(v.schema!=='ontology-maintenance-barrier/v1'||v.operation!=='BACKUP'||v.root!==root||!isAbsolute(v.backupRoot))fail('MAINTENANCE_EVIDENCE','Invalid retained maintenance barrier',409);
  return v as unknown as MaintenanceBarrier;
}
export function requireMaintenanceAvailable(root:string,permit?:MaintenancePermit):void {
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
