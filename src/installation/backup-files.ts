import {constants,openSync,closeSync,readSync,writeSync,fsyncSync,lstatSync,fstatSync,readdirSync,renameSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import type {BigIntStats} from 'node:fs';
import type {Installation} from './manager.js';
import {privatePath,privateRead,MAINTENANCE_FILE} from '../standalone/workspace.js';
import {outsideSource} from './files.js';
import {workerFilePresent} from './worker-archives.js';
import {exact,id,digest} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import {BACKUP_LIMITS,BACKUP_RECORDS,backupHash,backupReceipt,validateBackupPlan,validateBackupOwner} from './backup-contract.js';
import type {NodeIdentity,BackupEntry,BackupPlan,BackupOwner,BackupEnvelope,BackupManifest} from './backup-contract.js';

export function backupNode(path:string,directory=true):NodeIdentity {
  privatePath(path,directory);const s=lstatSync(path,{bigint:true});return {device:String(s.dev),inode:String(s.ino),mode:Number(s.mode&0o777n)};
}
const stamp=(s:BigIntStats)=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.mode].join(':');
function privateFile(fd:number):BigIntStats {
  const s=fstatSync(fd,{bigint:true});if(!s.isFile()||s.nlink!==1n||s.uid!==BigInt(process.getuid!())||(s.mode&0o077n)!==0n)fail('BACKUP_EVIDENCE','Expected a private owned unlinked regular file',409);return s;
}
function fileHash(path:string):{bytes:number;digest:string} {
  privatePath(path);const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=privateFile(fd);if(before.size>BigInt(BACKUP_LIMITS.fileBytes))fail('BACKUP_LIMIT','Owner file exceeds backup budget',409);
    const h=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let bytes=0;
    for(;;){const n=readSync(fd,buffer);if(!n)break;bytes+=n;if(bytes>BACKUP_LIMITS.fileBytes)fail('BACKUP_LIMIT','Owner file grew beyond backup budget',409);h.update(buffer.subarray(0,n));}
    if(stamp(privateFile(fd))!==stamp(before)||stamp(lstatSync(path,{bigint:true}))!==stamp(before)||BigInt(bytes)!==before.size)fail('BACKUP_SOURCE_CHANGED','Owner file changed during inventory',409);
    return {bytes,digest:'sha256:'+h.digest('hex')};
  }finally{closeSync(fd);}
}
const excluded=(scope:BackupEntry['scope'],path:string)=>scope==='installation'?[BACKUP_RECORDS,'operator.sqlite','operator.sqlite-journal',MAINTENANCE_FILE,MAINTENANCE_FILE+'.pending','formal-work/'+MAINTENANCE_FILE,'formal-work/'+MAINTENANCE_FILE+'.pending'].includes(path):['writer.sqlite','writer.sqlite-journal',MAINTENANCE_FILE,MAINTENANCE_FILE+'.pending'].includes(path);
export function backupInventory(i:Installation):BackupEntry[] {
  const entries:BackupEntry[]=[];let bytes=0;
  for(const [scope,root] of [['installation',i.root],['workspace',i.workspaceRoot]] as const){
    const anchor=backupNode(root);
    const visit=(directory:string,prefix:string,depth:number):void=>{
      if(depth>BACKUP_LIMITS.depth)fail('BACKUP_LIMIT','Owner directory nesting exceeds backup budget',409);
      const before=backupNode(directory);
      for(const name of readdirSync(directory).sort()){
        const relative=prefix?prefix+'/'+name:name;if(excluded(scope,relative))continue;
        if(/\.sqlite-(journal|wal|shm)$/.test(name))fail('BACKUP_SIDECAR','Unresolved SQLite sidecar prevents a consistent cold backup',409);
        if(entries.length>=BACKUP_LIMITS.entries)fail('BACKUP_LIMIT','Owner inventory exceeds its count budget',409);
        const path=join(directory,name),s=lstatSync(path),kind=s.isDirectory()?'directory':'file',node=backupNode(path,kind==='directory'),content=kind==='file'?fileHash(path):{bytes:0,digest:null};
        bytes+=content.bytes;if(bytes>BACKUP_LIMITS.totalBytes)fail('BACKUP_LIMIT','Owner inventory exceeds aggregate backup budget',409);
        entries.push({scope,path:relative,kind,...node,...content});if(kind==='directory')visit(path,relative,depth+1);
      }
      if(backupHash(backupNode(directory))!==backupHash(before))fail('BACKUP_SOURCE_CHANGED','Owner directory was replaced',409);
    };
    visit(root,'',1);if(backupHash(backupNode(root))!==backupHash(anchor))fail('BACKUP_SOURCE_CHANGED','Owner root was replaced',409);
  }
  return entries;
}
function header(owner:Pick<BackupOwner,'requestDigest'>,e:BackupEntry):Buffer {
  return Buffer.from(JSON.stringify({schema:'ontology-backup-object/v1',requestDigest:owner.requestDigest,digest:e.digest,bytes:e.bytes})+'\n');
}
function readAt(fd:number,buffer:Buffer,position:number,length=buffer.length):void {
  let offset=0;while(offset<length){const n=readSync(fd,buffer,offset,length-offset,position+offset);if(!n)fail('BACKUP_EVIDENCE','Unexpected end of retained backup bytes',409);offset+=n;}
}
function writeAt(fd:number,buffer:Buffer,position:number):void {
  let offset=0;while(offset<buffer.length){const n=writeSync(fd,buffer,offset,buffer.length-offset,position+offset);if(!n)fail('BACKUP_IO','Backup write made no progress',409);offset+=n;}
}
/** Deterministic protocol documents use a fixed private staging file. A crash
 * before rename resumes an exact byte prefix; unrelated material is retained.
 * No generated timestamps enter these content-addressed receipts. */
export function writeBackupJSON(path:string,value:unknown,replace=false):void {
  const root=dirname(path),anchor=backupNode(root),bytes=Buffer.from(JSON.stringify(value)+'\n'),temp=path+'.pending';
  if(bytes.length>BACKUP_LIMITS.manifestBytes)fail('BACKUP_LIMIT','Backup protocol document exceeds its envelope',409);
  if(workerFilePresent(path)){
    const old=privateRead(path,BACKUP_LIMITS.manifestBytes);if(old===bytes.toString())return;
    if(!replace)fail('BACKUP_EVIDENCE','Existing backup protocol document differs',409);
  }
  const fd=workerFilePresent(temp)?(privatePath(temp),openSync(temp,constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK)):openSync(temp,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{
    const held=privateFile(fd);if(held.size>BigInt(bytes.length))fail('BACKUP_EVIDENCE','Oversized staged protocol bytes were preserved',409);
    const prefix=Buffer.alloc(Number(held.size));readAt(fd,prefix,0);if(!prefix.equals(bytes.subarray(0,prefix.length)))fail('BACKUP_EVIDENCE','Changed staged protocol bytes were preserved',409);
    const named=lstatSync(temp,{bigint:true});if(named.dev!==held.dev||named.ino!==held.ino)fail('BACKUP_EVIDENCE','Staged protocol file changed',409);
    writeAt(fd,bytes.subarray(prefix.length),prefix.length);fsyncSync(fd);
    const after=lstatSync(temp,{bigint:true});if(after.dev!==held.dev||after.ino!==held.ino||backupHash(backupNode(root))!==backupHash(anchor))fail('BACKUP_EVIDENCE','Protocol directory or file changed',409);
    if(workerFilePresent(path))privatePath(path);renameSync(temp,path);
    const parent=openSync(root,'r');try{fsyncSync(parent);}finally{closeSync(parent);}
  }finally{closeSync(fd);}
}
/** Existing object bytes must be an exact header/source prefix. Resume only
 * appends missing bytes; foreign or corrupted partial material is preserved. */
export function copyBackupObject(plan:BackupPlan,owner:BackupOwner,e:BackupEntry):void {
  if(e.kind!=='file'||!e.digest)fail('BACKUP_EVIDENCE','File object required',409);
  const source=join(e.scope==='installation'?plan.installation.root:plan.installation.workspaceRoot,e.path),objects=join(plan.backupRoot,'objects'),target=join(objects,e.digest.slice(7)),prefix=header(owner,e);
  if(backupHash(backupNode(plan.backupRoot))!==backupHash(owner.root)||backupHash(backupNode(objects))!==backupHash(owner.objects)||backupHash(backupNode(source,false))!==backupHash({device:e.device,inode:e.inode,mode:e.mode}))fail('BACKUP_SOURCE_CHANGED','Source or backup destination was replaced',409);
  const input=openSync(source,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let output:number|undefined;
  try{
    const before=privateFile(input);if(Number(before.size)!==e.bytes||String(before.dev)!==e.device||String(before.ino)!==e.inode||Number(before.mode&0o777n)!==e.mode)fail('BACKUP_SOURCE_CHANGED','Source identity or byte count changed',409);
    if(workerFilePresent(target)){privatePath(target);output=openSync(target,constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
    else output=openSync(target,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    const held=privateFile(output),oldBytes=Number(held.size),namedBefore=lstatSync(target,{bigint:true});
    if(namedBefore.dev!==held.dev||namedBefore.ino!==held.ino)fail('BACKUP_EVIDENCE','Backup object changed during open',409);
    if(oldBytes>prefix.length+e.bytes)fail('BACKUP_EVIDENCE','Unselected trailing object bytes were preserved',409);
    const oldHeader=Buffer.alloc(Math.min(oldBytes,prefix.length));readAt(output,oldHeader,0);
    if(!oldHeader.equals(prefix.subarray(0,oldHeader.length)))fail('BACKUP_EVIDENCE','Foreign partial backup header was preserved',409);
    if(oldHeader.length<prefix.length)writeAt(output,prefix.subarray(oldHeader.length),oldHeader.length);
    const present=Math.max(0,oldBytes-prefix.length),buffer=Buffer.alloc(1024*1024),existing=Buffer.alloc(1024*1024),h=createHash('sha256');let offset=0;
    while(offset<e.bytes){
      const n=Math.min(buffer.length,e.bytes-offset);readAt(input,buffer,offset,n);h.update(buffer.subarray(0,n));
      const retained=Math.max(0,Math.min(n,present-offset));if(retained){readAt(output,existing,prefix.length+offset,retained);if(!existing.subarray(0,retained).equals(buffer.subarray(0,retained)))fail('BACKUP_EVIDENCE','Changed partial backup bytes were preserved',409);}
      if(retained<n)writeAt(output,buffer.subarray(retained,n),prefix.length+offset+retained);offset+=n;
      const named=lstatSync(target,{bigint:true});if(named.dev!==held.dev||named.ino!==held.ino)fail('BACKUP_EVIDENCE','Backup object was replaced during copy',409);
    }
    if('sha256:'+h.digest('hex')!==e.digest||stamp(privateFile(input))!==stamp(before)||stamp(lstatSync(source,{bigint:true}))!==stamp(before))fail('BACKUP_SOURCE_CHANGED','Source bytes changed during copy',409);
    fsyncSync(output);
    const namedAfter=lstatSync(target,{bigint:true});if(namedAfter.dev!==held.dev||namedAfter.ino!==held.ino||privateFile(output).size!==BigInt(prefix.length+e.bytes))fail('BACKUP_EVIDENCE','Backup object changed before completion',409);
    if(backupHash(backupNode(plan.backupRoot))!==backupHash(owner.root)||backupHash(backupNode(objects))!==backupHash(owner.objects))fail('BACKUP_EVIDENCE','Backup directory was replaced during copy',409);
  }finally{closeSync(input);if(output!==undefined)closeSync(output);}
}
export function verifyBackupObjects(root:string,owner:BackupOwner,plan:BackupPlan):{objects:number;storedBytes:number} {
  const directory=join(root,'objects'),anchor=backupNode(directory),expected=new Map<string,BackupEntry>();
  for(const e of plan.entries)if(e.kind==='file'){
    const key=e.digest!.slice(7),old=expected.get(key);if(old&&old.bytes!==e.bytes)fail('BACKUP_EVIDENCE','Ambiguous content object length',409);expected.set(key,e);
  }
  const names=readdirSync(directory).sort();if(backupHash(names)!==backupHash([...expected.keys()].sort()))fail('BACKUP_EVIDENCE','Backup objects are missing or contain unselected entries',409);
  let storedBytes=0;
  for(const [name,e] of expected){
    const path=join(directory,name),prefix=header(owner,e);privatePath(path);const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{
      const before=privateFile(fd);if(before.size!==BigInt(prefix.length+e.bytes))fail('BACKUP_EVIDENCE','Incomplete or oversized backup object',409);
      const actual=Buffer.alloc(prefix.length);readAt(fd,actual,0);if(!actual.equals(prefix))fail('BACKUP_EVIDENCE','Backup object header differs',409);
      const h=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
      while(offset<e.bytes){const n=Math.min(buffer.length,e.bytes-offset);readAt(fd,buffer,prefix.length+offset,n);h.update(buffer.subarray(0,n));offset+=n;}
      if('sha256:'+h.digest('hex')!==e.digest||stamp(privateFile(fd))!==stamp(before)||stamp(lstatSync(path,{bigint:true}))!==stamp(before))fail('BACKUP_EVIDENCE','Backup object bytes changed',409);
      storedBytes+=prefix.length+e.bytes;
    }finally{closeSync(fd);}
  }
  if(backupHash(backupNode(directory))!==backupHash(anchor))fail('BACKUP_EVIDENCE','Backup objects directory changed',409);return {objects:expected.size,storedBytes};
}
export function readBackupPlan(root:string):BackupPlan {
  const plan:unknown=JSON.parse(privateRead(join(root,'plan.json'),BACKUP_LIMITS.manifestBytes));validateBackupPlan(plan);return plan;
}
export function verifyBackup(root:string,expectedManifestDigest:string):BackupEnvelope & {objects:number;storedBytes:number} {
  digest(expectedManifestDigest);privatePath(root,true);if(outsideSource(root)!==root)fail('UNSAFE_PATH','Canonical private backup root required');const anchor=backupNode(root);
  const value:unknown=JSON.parse(privateRead(join(root,'manifest.json'),BACKUP_LIMITS.manifestBytes));exact(value,['manifest','manifestDigest','receipt']);digest(value.manifestDigest);
  const manifest=value.manifest;exact(manifest,['schema','requestId','requestDigest','plan','reportDigest']);id(manifest.requestId);digest(manifest.requestDigest);digest(manifest.reportDigest);validateBackupPlan(manifest.plan);
  if(manifest.schema!=='ontology-backup-manifest/v1'||value.manifestDigest!==expectedManifestDigest||backupHash(manifest)!==expectedManifestDigest||backupHash(manifest.plan)!==manifest.reportDigest||backupHash(readBackupPlan(root))!==manifest.reportDigest)fail('BACKUP_EVIDENCE','Backup manifest identity differs',409);
  const owner:unknown=JSON.parse(privateRead(join(root,'owner.json'),65536));validateBackupOwner(owner,manifest.plan);
  const receipt=backupReceipt(manifest as unknown as BackupManifest);
  if(owner.requestId!==manifest.requestId||owner.requestDigest!==manifest.requestDigest||backupHash(value.receipt)!==backupHash(receipt))fail('BACKUP_EVIDENCE','Backup completion receipt differs',409);
  const names=readdirSync(root).sort();if(backupHash(names)!==backupHash(['manifest.json','objects','owner.json','plan.json']))fail('BACKUP_EVIDENCE','Unselected backup root material was preserved',409);
  const verified=verifyBackupObjects(root,owner,manifest.plan);if(backupHash(backupNode(root))!==backupHash(anchor))fail('BACKUP_EVIDENCE','Backup root changed during verification',409);
  return {...value as unknown as BackupEnvelope,...verified};
}
