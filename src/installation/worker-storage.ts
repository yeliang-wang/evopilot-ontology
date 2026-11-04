import {join,isAbsolute} from 'node:path';
import {privateRead} from '../standalone/workspace.js';
import {exact,id,digest} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import {backupHash,validateNode} from './backup-contract.js';
import {writeBackupJSON} from './backup-files.js';
import {readVerifiedRestoreStage} from './restore-stage.js';
import {ARCHIVE_LIMIT,JOURNAL_BYTES,readArchiveCatalog,journalImage,journalFilename,workerFilePresent} from './worker-archives.js';
import type {JournalImage,ArchiveCatalog} from './worker-archives.js';

export const WORKER_STORAGE='worker-storage.json';
const BYTES=2*1024*1024,GENERATIONS=128;
interface Move {original:JournalImage;previous:JournalImage;restored:JournalImage;}
interface Generation {requestId:string;activationDigest:string;backupManifestDigest:string;previousDigest:string|null;journals:Move[];}
interface Record {generation:Generation;digest:string;}
interface Storage {schema:'ontology-worker-storage/v1';root:string;records:Record[];}
const equal=(a:unknown,b:unknown)=>backupHash(a)===backupHash(b);
function image(v:unknown):asserts v is JournalImage {
  exact(v,['journalId','file','device','inode','bytes','digest']);id(v.journalId);digest(v.digest);
  validateNode({device:v.device,inode:v.inode,mode:0o600});
  if(v.file!=='worker-journal.sqlite'&&v.file!==journalFilename(v.journalId)||!Number.isSafeInteger(v.bytes)||(v.bytes as number)<1||(v.bytes as number)>JOURNAL_BYTES)fail('WORKER_STORAGE_EVIDENCE','Invalid restored journal image',409);
}
const content=(i:JournalImage)=>({journalId:i.journalId,file:i.file,bytes:i.bytes,digest:i.digest});
function validate(v:unknown,root:string,catalog:ArchiveCatalog|null):asserts v is Storage {
  exact(v,['schema','root','records']);
  if(v.schema!=='ontology-worker-storage/v1'||v.root!==root||!isAbsolute(root)||!Array.isArray(v.records)||!v.records.length||v.records.length>GENERATIONS||Buffer.byteLength(JSON.stringify(v))>BYTES)fail('WORKER_STORAGE_EVIDENCE','Invalid bounded worker storage lineage',409);
  const originals=new Map((catalog?.archives??[]).map(r=>[r.plan.source.journalId,r.plan.source])),latest=new Map<string,JournalImage>(),requests=new Set<string>();let previous:string|null=null;
  for(const r of v.records){
    exact(r,['generation','digest']);digest(r.digest);const g=r.generation;exact(g,['requestId','activationDigest','backupManifestDigest','previousDigest','journals']);id(g.requestId);digest(g.activationDigest);digest(g.backupManifestDigest);
    if(g.previousDigest!==previous||backupHash(g)!==r.digest||requests.has(g.requestId)||!Array.isArray(g.journals)||g.journals.length>ARCHIVE_LIMIT)fail('WORKER_STORAGE_EVIDENCE','Broken worker storage generation chain',409);
    const seen=new Set<string>();
    for(const m of g.journals){
      exact(m,['original','previous','restored']);image(m.original);image(m.previous);image(m.restored);const k=m.original.journalId;
      if(seen.has(k)||!equal(m.original,originals.get(k))||!equal(m.previous,latest.get(k)??m.original)||!equal(content(m.original),content(m.restored)))fail('WORKER_STORAGE_EVIDENCE','Journal origin, byte identity or previous physical location differs',409);
      seen.add(k);latest.set(k,m.restored);
    }
    if([...latest.keys()].some(k=>!seen.has(k)))fail('WORKER_STORAGE_EVIDENCE','Restoration dropped earlier worker storage lineage',409);
    requests.add(g.requestId);previous=r.digest;
  }
}
function read(root:string,logicalRoot:string,catalog:ArchiveCatalog|null):Storage|null {
  const file=join(root,WORKER_STORAGE);
  if(workerFilePresent(file+'.pending'))fail('WORKER_STORAGE_PENDING','Finish the exact worker storage restoration before use',409);
  if(!workerFilePresent(file))return null;
  const v:unknown=JSON.parse(privateRead(file,BYTES));validate(v,logicalRoot,catalog);return v;
}
/** Immutable rotation plans keep their original inode. Only a separately
 * validated restoration chain may translate that image to current storage. */
export function workerStorageImage(root:string,original:JournalImage):JournalImage {
  const storage=read(root,root,readArchiveCatalog(root));
  const moves=storage?.records.at(-1)?.generation.journals??[],m=moves.find(m=>m.original.journalId===original.journalId);
  if(m&&!equal(m.original,original))fail('WORKER_STORAGE_EVIDENCE','Requested archive differs from retained original image',409);
  return m?.restored??original;
}
/** The caller holds recovery ownership and keeps the candidate blocked. Input
 * is re-derived from a fully verified stage, never caller-supplied checksums.
 * Current journals remain mutable and acquire an immutable image on rotation. */
export function restoreWorkerStorage(stageRoot:string,stageManifestDigest:string,physicalRoot:string,requestId:string,activationDigest:string):string|null {
  id(requestId);digest(activationDigest);const stage=readVerifiedRestoreStage(stageRoot,stageManifestDigest),backup=stage.plan.backup,plan=backup.manifest.plan,logicalRoot=join(plan.installation.root,'formal-work'),source=join(stageRoot,'installation/formal-work');
  const catalog=readArchiveCatalog(source,logicalRoot);if(catalog?.pending)fail('WORKER_ROTATION_PENDING','Unfinished rotation cannot be restored',409);
  if(!equal(catalog,readArchiveCatalog(physicalRoot,logicalRoot)))fail('WORKER_STORAGE_EVIDENCE','Copied archive catalog differs from verified snapshot',409);
  const previous=read(source,logicalRoot,catalog);
  if(!catalog&&!previous){if(workerFilePresent(join(physicalRoot,WORKER_STORAGE))||workerFilePresent(join(physicalRoot,WORKER_STORAGE+'.pending')))fail('WORKER_STORAGE_EVIDENCE','Unselected storage lineage was preserved',409);return null;}
  if((previous?.records.length??0)>=GENERATIONS)fail('WORKER_STORAGE_LIMIT','Restoration lineage is full; no history was pruned',409);
  const prior=new Map((previous?.records.at(-1)?.generation.journals??[]).map(m=>[m.original.journalId,m.restored]));
  const journals=(catalog?.archives??[]).map(r=>{
    const original=r.plan.source,expected=prior.get(original.journalId)??original,entry=plan.entries.find(e=>e.scope==='installation'&&e.path==='formal-work/'+original.file);
    if(!entry||entry.kind!=='file'||!equal(expected,{journalId:original.journalId,file:original.file,device:entry.device,inode:entry.inode,bytes:entry.bytes,digest:entry.digest}))fail('WORKER_STORAGE_EVIDENCE','Backup storage inventory does not close the original journal lineage',409);
    const restored=journalImage(physicalRoot,{journalId:original.journalId,file:original.file});
    if(!equal(content(original),content(restored)))fail('WORKER_STORAGE_EVIDENCE','Restored archive bytes differ from the immutable original',409);
    return {original,previous:expected,restored};
  });
  const generation:Generation={requestId,activationDigest,backupManifestDigest:backup.manifestDigest,previousDigest:previous?.records.at(-1)?.digest??null,journals},record={generation,digest:backupHash(generation)},next:Storage={schema:'ontology-worker-storage/v1',root:logicalRoot,records:[...(previous?.records??[]),record]};
  validate(next,logicalRoot,catalog);writeBackupJSON(join(physicalRoot,WORKER_STORAGE),next);read(physicalRoot,logicalRoot,catalog);return record.digest;
}
