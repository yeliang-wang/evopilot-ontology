import {mkdirSync,lstatSync,readdirSync,unlinkSync,openSync,closeSync,fsyncSync} from 'node:fs';
import {join} from 'node:path';
import type {Installation} from './manager.js';
import {privatePath,privateRead} from '../standalone/workspace.js';
import {id} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import {workerFilePresent} from './worker-archives.js';
import {writeBackupJSON,readBackupManifest} from './backup-files.js';
import {BACKUP_LIMITS,BACKUP_RECORDS,backupHash,validateBackupRecord} from './backup-contract.js';
import type {BackupRecord,BackupEnvelope} from './backup-contract.js';

const syncDirectory=(root:string)=>{const fd=openSync(root,'r');try{fsyncSync(fd);}finally{closeSync(fd);}};
const reserveDocument=(r:BackupRecord)=>({schema:'ontology-backup-reservation/v1',installationId:r.installationId,workspaceId:r.workspaceId,serviceId:r.serviceId,requestId:r.requestId,requestDigest:r.requestDigest,reportDigest:r.reportDigest,backupRoot:r.backupRoot,padding:' '.repeat(BACKUP_LIMITS.completionReserveBytes)});
const reserveText=(r:BackupRecord)=>JSON.stringify(reserveDocument(r))+'\n';
const reserveLimit=BACKUP_LIMITS.completionReserveBytes+16*1024;
export function backupControlRecords(i:Installation):BackupRecord[] {
  const root=join(i.root,BACKUP_RECORDS);if(!workerFilePresent(root))return [];privatePath(root,true);
  const names=readdirSync(root).sort();if(names.length>8*BACKUP_LIMITS.requests)fail('BACKUP_LIMIT','Backup control material exceeds its budget; no records were pruned',409);
  const committed:BackupRecord[]=[];
  for(const name of names){
    const match=/^(.*)(\.json\.pending(?:-COMPLETED|-ABORTED)?|\.reserve(?:\.pending)?)$/.exec(name);
    if(match){id(match[1]);privatePath(join(root,name));if(lstatSync(join(root,name)).size>(match[2].startsWith('.reserve')?reserveLimit:65536))fail('BACKUP_LIMIT','Staged backup control material exceeds its budget',409);continue;}
    if(!name.endsWith('.json'))fail('BACKUP_EVIDENCE','Unresolved backup control material was preserved',409);
    const v:unknown=JSON.parse(privateRead(join(root,name),65536));validateBackupRecord(v,i);
    if(name!==v.requestId+'.json')fail('BACKUP_EVIDENCE','Backup record name differs from request',409);committed.push(v);
  }
  if(committed.length>BACKUP_LIMITS.requests)fail('BACKUP_LIMIT','Backup request history exceeds its budget',409);return committed;
}
/** Reserve real owner-side blocks before admitting a new request. This is not
 * a promise against unrelated concurrent consumers of the same filesystem. */
function reserve(i:Installation,r:BackupRecord):void {
  const path=join(i.root,BACKUP_RECORDS,r.requestId+'.reserve');writeBackupJSON(path,reserveDocument(r));
  if(lstatSync(path).blocks*512<BACKUP_LIMITS.completionReserveBytes)fail('BACKUP_RESERVATION','Filesystem did not retain the bounded completion-space allocation',409);
}
function releaseReserve(i:Installation,r:BackupRecord):void {
  const root=join(i.root,BACKUP_RECORDS),expected=reserveText(r);
  for(const suffix of ['.reserve','.reserve.pending']){
    const path=join(root,r.requestId+suffix);if(!workerFilePresent(path))continue;
    const before=lstatSync(path),content=privateRead(path,reserveLimit);
    if(suffix==='.reserve'?content!==expected:!expected.startsWith(content))fail('BACKUP_EVIDENCE','Foreign completion reservation was preserved',409);
    const now=lstatSync(path);if(now.dev!==before.dev||now.ino!==before.ino)fail('BACKUP_EVIDENCE','Completion reservation was replaced',409);
    unlinkSync(path);syncDirectory(root);
  }
}
export function saveBackupControl(i:Installation,r:BackupRecord,replace=false):void {
  validateBackupRecord(r,i);const root=join(i.root,BACKUP_RECORDS);
  if(!workerFilePresent(root)){mkdirSync(root,{mode:0o700});syncDirectory(i.root);}privatePath(root,true);
  const file=join(root,r.requestId+'.json');
  if(r.state==='PENDING'){
    if(readdirSync(root).length>8*BACKUP_LIMITS.requests-8)fail('BACKUP_LIMIT','Backup control history lacks bounded completion headroom',409);
    reserve(i,r);writeBackupJSON(file,r,replace);return;
  }
  releaseReserve(i,r);
  // Preserve an incompatible interrupted terminal write. Abort never rewrites
  // a partial completion record, and vice versa. An exact legacy prefix can
  // still finish in its original staging location.
  let stage:'pending'|'pending-COMPLETED'|'pending-ABORTED'=r.state==='COMPLETED'?'pending-COMPLETED':'pending-ABORTED';
  if(workerFilePresent(file+'.pending')&&(JSON.stringify(r)+'\n').startsWith(privateRead(file+'.pending',65536)))stage='pending';
  writeBackupJSON(file,r,replace,stage);
}
/** A valid durable manifest proves the original completion point, even when
 * copied payloads are now missing or corrupt. It does not prove present health. */
export function pendingBackupCompletion(r:BackupRecord):BackupEnvelope|null {
  const file=join(r.backupRoot,'manifest.json');if(!workerFilePresent(file))return null;
  const v=readBackupManifest(r.backupRoot),i=v.manifest.plan.installation;
  validateBackupRecord({...r,state:'COMPLETED',receipt:v.receipt},i);
  if(v.manifest.plan.backupRoot!==r.backupRoot||v.manifest.reportDigest!==r.reportDigest||backupHash(v.manifest.plan)!==r.reportDigest)fail('BACKUP_EVIDENCE','Completion belongs to another inspected snapshot',409);
  return v;
}
