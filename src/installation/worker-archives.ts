import {constants,openSync,closeSync,lstatSync,fstatSync,readSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {writePrivate} from './files.js';
import {privatePath,privateRead} from '../standalone/workspace.js';
import {exact,id,digest,hash} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {workerStorageImage} from './worker-storage.js';

export const JOURNAL_BYTES=64*1024*1024;
export const ARCHIVE_LIMIT=16;
export const ARCHIVE_CATALOG='worker-archives.json';
export interface JournalHead {journalId:string;file:string;}
export interface JournalImage extends JournalHead {device:string;inode:string;bytes:number;digest:string;}
export interface RotationPlan {
  schema:'ontology-worker-rotation-plan/v1';installationId:string;workspaceId:string;serviceId:string;workRoot:string;
  source:JournalImage;attempts:number;maintenanceRequests:number;archives:number;
}
export interface RotationReceipt {
  schema:'ontology-worker-rotation-receipt/v1';requestId:string;requestDigest:string;planDigest:string;
  archivedJournalId:string;activeJournalId:string;archiveDigest:string;archiveBytes:number;recordedAt:string;authority:false;
}
export interface RotationRecord {requestId:string;requestDigest:string;plan:RotationPlan;planDigest:string;next:JournalHead;receipt:RotationReceipt|null;}
export interface ArchiveCatalog {schema:'ontology-worker-archives/v1';root:string;current:JournalHead;archives:RotationRecord[];pending:RotationRecord|null;}
const sha=(v:unknown)=>hash(v as Json);
export const journalFilename=(journalId:string)=>{id(journalId);return 'worker-journal-'+journalId+'.sqlite';};
function head(v:unknown):asserts v is JournalHead {
  exact(v,['journalId','file']);id(v.journalId);
  if(v.file!=='worker-journal.sqlite'&&v.file!==journalFilename(v.journalId))fail('WORKER_ARCHIVE_EVIDENCE','Invalid journal filename',409);
}
export function rotationRequestDigest(plan:RotationPlan):string {
  return sha({installationId:plan.installationId,workspaceId:plan.workspaceId,serviceId:plan.serviceId,workRoot:plan.workRoot,expectedReportDigest:sha(plan)});
}
function record(v:unknown,root:string):asserts v is RotationRecord {
  exact(v,['requestId','requestDigest','plan','planDigest','next','receipt']);id(v.requestId);digest(v.requestDigest);digest(v.planDigest);head(v.next);
  const p=v.plan;exact(p,['schema','installationId','workspaceId','serviceId','workRoot','source','attempts','maintenanceRequests','archives']);
  id(p.installationId);id(p.workspaceId);id(p.serviceId);
  if(p.schema!=='ontology-worker-rotation-plan/v1'||p.workRoot!==root)fail('WORKER_ARCHIVE_EVIDENCE','Foreign rotation owner',409);
  exact(p.source,['journalId','file','device','inode','bytes','digest']);head({journalId:p.source.journalId,file:p.source.file});digest(p.source.digest);
  for(const k of ['device','inode'])if(typeof p.source[k]!=='string'||!/^\d{1,24}$/.test(p.source[k] as string))fail('WORKER_ARCHIVE_EVIDENCE','Invalid archived file identity',409);
  for(const [n,x,min,max] of [['bytes',p.source.bytes,1,JOURNAL_BYTES],['attempts',p.attempts,1,4096],['maintenanceRequests',p.maintenanceRequests,0,4096],['archives',p.archives,0,ARCHIVE_LIMIT-1]] as const){
    if(!Number.isSafeInteger(x)||(x as number)<min||(x as number)>max)fail('WORKER_ARCHIVE_EVIDENCE','Invalid rotation '+n,409);
  }
  if(sha(p)!==v.planDigest||rotationRequestDigest(p as unknown as RotationPlan)!==v.requestDigest||v.next.file!==journalFilename(v.next.journalId)||v.next.journalId===p.source.journalId)fail('WORKER_ARCHIVE_EVIDENCE','Rotation identity differs',409);
  if(v.receipt!==null){
    const r=v.receipt;exact(r,['schema','requestId','requestDigest','planDigest','archivedJournalId','activeJournalId','archiveDigest','archiveBytes','recordedAt','authority']);
    if(r.schema!=='ontology-worker-rotation-receipt/v1'||r.requestId!==v.requestId||r.requestDigest!==v.requestDigest||r.planDigest!==v.planDigest||r.archivedJournalId!==p.source.journalId||r.activeJournalId!==v.next.journalId||r.archiveDigest!==p.source.digest||r.archiveBytes!==p.source.bytes||typeof r.recordedAt!=='string'||r.recordedAt.length>40||r.authority!==false)fail('WORKER_ARCHIVE_EVIDENCE','Rotation receipt differs',409);
  }
}
export function workerFilePresent(path:string):boolean {
  try{lstatSync(path);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}
}
/** Reserve bounded completion metadata before publishing a pending request. */
export function writeArchiveCatalog(root:string,catalog:ArchiveCatalog,replace:boolean):void {
  if(Buffer.byteLength(JSON.stringify(catalog)+'\n')+(catalog.pending?4096:0)>128*1024)fail('WORKER_ARCHIVE_LIMIT','Archive catalog capacity is insufficient; existing history remains unchanged',409);
  writePrivate(join(root,ARCHIVE_CATALOG),catalog,replace);
}
export function readArchiveCatalog(root:string,logicalRoot=root):ArchiveCatalog|null {
  privatePath(root,true);const file=join(root,ARCHIVE_CATALOG);
  if(!workerFilePresent(file)){if(readdirSync(root).some(n=>/^worker-journal-.+\.sqlite$/.test(n)))fail('WORKER_ARCHIVE_EVIDENCE','Archive catalog is missing while journal shards remain',409);return null;}
  const v:unknown=JSON.parse(privateRead(file,128*1024));exact(v,['schema','root','current','archives','pending']);head(v.current);
  if(v.schema!=='ontology-worker-archives/v1'||v.root!==logicalRoot||!Array.isArray(v.archives)||v.archives.length>ARCHIVE_LIMIT)fail('WORKER_ARCHIVE_EVIDENCE','Invalid archive catalog',409);
  const requests=new Set<string>(),journals=new Set<string>();let previous:JournalHead|null=null;
  for(const [n,r] of [...v.archives,...(v.pending===null?[]:[v.pending])].entries()){
    record(r,logicalRoot);
    if(requests.has(r.requestId)||journals.has(r.plan.source.journalId)||r.plan.archives!==n||n===0&&r.plan.source.file!=='worker-journal.sqlite'||previous&&sha(previous)!==sha({journalId:r.plan.source.journalId,file:r.plan.source.file})||n<v.archives.length&&!r.receipt||n===v.archives.length&&r.receipt)fail('WORKER_ARCHIVE_EVIDENCE','Broken archive chain',409);
    requests.add(r.requestId);journals.add(r.plan.source.journalId);previous=r.next;
  }
  const expected=v.pending===null?previous:(v.pending as RotationRecord).plan.source;
  if(expected&&sha(v.current)!==sha({journalId:expected.journalId,file:expected.file})||journals.has(previous?.journalId??'')||v.pending!==null&&v.archives.length>=ARCHIVE_LIMIT)fail('WORKER_ARCHIVE_EVIDENCE','Archive current journal differs',409);
  if(!v.archives.length&&(v.current.file!=='worker-journal.sqlite'||v.pending===null))fail('WORKER_ARCHIVE_EVIDENCE','Original journal is missing',409);
  return v as unknown as ArchiveCatalog;
}
/** Streaming hash with descriptor/path guards. Cache only an unchanged inode,
 * size and nanosecond change/modify times; no caller-supplied checksum is trusted. */
const verified=new Map<string,{stamp:string;image:JournalImage}>();
export function journalImage(root:string,h:JournalHead):JournalImage {
  head(h);const file=join(root,h.file);privatePath(file);
  for(const suffix of ['-journal','-wal','-shm'])if(workerFilePresent(file+suffix))fail('WORKER_ARCHIVE_EVIDENCE','A journal sidecar prevents immutable archival',409);
  const before=lstatSync(file,{bigint:true}),stamp=[before.dev,before.ino,before.size,before.mtimeNs,before.ctimeNs].join(':');
  if(before.size>BigInt(JOURNAL_BYTES))fail('WORKER_JOURNAL_LIMIT','Worker journal exceeds its byte budget',409);
  const cached=verified.get(file);if(cached?.stamp===stamp&&cached.image.journalId===h.journalId)return {...cached.image};
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const s=fstatSync(fd,{bigint:true});if(s.dev!==before.dev||s.ino!==before.ino||!s.isFile()||s.nlink!==1n||s.uid!==BigInt(process.getuid!())||(s.mode&0o077n)!==0n)fail('WORKER_ARCHIVE_EVIDENCE','Journal changed during open',409);
    const digest=createHash('sha256'),buffer=Buffer.alloc(65536);let bytes=0;
    for(;;){const n=readSync(fd,buffer);if(!n)break;bytes+=n;if(bytes>JOURNAL_BYTES)fail('WORKER_JOURNAL_LIMIT','Journal grew during hashing',409);digest.update(buffer.subarray(0,n));}
    const after=fstatSync(fd,{bigint:true}),named=lstatSync(file,{bigint:true});
    if(after.size!==s.size||after.mtimeNs!==s.mtimeNs||after.ctimeNs!==s.ctimeNs||named.ino!==s.ino||named.dev!==s.dev||BigInt(bytes)!==s.size)fail('WORKER_ARCHIVE_EVIDENCE','Journal changed during hashing',409);
    const image={...h,device:String(s.dev),inode:String(s.ino),bytes,digest:'sha256:'+digest.digest('hex')};
    if(verified.size>=64)verified.clear();verified.set(file,{stamp,image});return {...image};
  }finally{closeSync(fd);}
}
export function verifyJournalImage(root:string,expected:JournalImage):void {
  const physical=workerStorageImage(root,expected);
  if(sha(journalImage(root,{journalId:expected.journalId,file:expected.file}))!==sha(physical))fail('WORKER_ARCHIVE_EVIDENCE','Archived journal identity or bytes changed',409);
}
export function requireNoRotation(root:string):void {
  if(readArchiveCatalog(root)?.pending)fail('WORKER_ROTATION_PENDING','Resume the original journal rotation before execution or maintenance',409);
}
export function journalLocation(root:string,journalId:string|undefined,writable:boolean):{head:JournalHead|null;image:JournalImage|null;archived:boolean} {
  const c=readArchiveCatalog(root);if(!c)return {head:null,image:null,archived:false};
  if(writable&&c.pending)fail('WORKER_ROTATION_PENDING','Resume the original journal rotation before execution or maintenance',409);
  if(journalId===undefined||journalId===c.current.journalId)return {head:c.current,image:c.pending?.plan.source??null,archived:false};
  const saved=c.archives.find(r=>r.plan.source.journalId===journalId);
  if(!saved)fail('WORKER_EVIDENCE_MISSING','Requested journal is not retained',409);
  if(writable)fail('WORKER_JOURNAL_ARCHIVED','Archived worker evidence is immutable',409);
  return {head:{journalId,file:saved.plan.source.file},image:saved.plan.source,archived:true};
}
