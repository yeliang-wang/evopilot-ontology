import {constants,openSync,closeSync,lstatSync,fstatSync,readSync,writeSync,fsyncSync,fchmodSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import type {BigIntStats} from 'node:fs';
import {privatePath} from '../standalone/workspace.js';
import {fail} from '../standalone/types.js';
import {backupNode} from './backup-files.js';
import {backupHash} from './backup-contract.js';
import type {BackupEntry,BackupEnvelope,NodeIdentity} from './backup-contract.js';
import {workerFilePresent} from './worker-archives.js';

const stamp=(s:BigIntStats)=>[s.dev,s.ino,s.mode,s.size,s.mtimeNs,s.ctimeNs].join(':');
function heldFile(fd:number):BigIntStats {
  const s=fstatSync(fd,{bigint:true});if(!s.isFile()||s.nlink!==1n||s.uid!==BigInt(process.getuid!())||(s.mode&0o077n)!==0n)fail('RESTORE_EVIDENCE','Private owned regular restore file required',409);return s;
}
function readAt(fd:number,b:Buffer,position:number,length=b.length):void {
  let offset=0;while(offset<length){const n=readSync(fd,b,offset,length-offset,position+offset);if(!n)fail('RESTORE_EVIDENCE','Incomplete restore input',409);offset+=n;}
}
function writeAt(fd:number,b:Buffer,position:number):void {
  let offset=0;while(offset<b.length){const n=writeSync(fd,b,offset,b.length-offset,position+offset);if(!n)fail('RESTORE_IO','Restore write made no progress',409);offset+=n;}
}
export function syncRestoreDirectory(path:string):void {privatePath(path,true);const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}

/** Copy only the verified object payload, never its backup framing. Resume is
 * append-only over an exact payload prefix; copied historical metadata is opaque. */
export function restoreBackupFile(backupRoot:string,backup:BackupEnvelope,e:BackupEntry,target:string):void {
  if(e.kind!=='file'||!e.digest)fail('RESTORE_EVIDENCE','Restore file required',409);
  const object=join(backupRoot,'objects',e.digest.slice(7)),prefix=Buffer.from(JSON.stringify({schema:'ontology-backup-object/v1',requestDigest:backup.manifest.requestDigest,digest:e.digest,bytes:e.bytes})+'\n');
  const sourceRoot=backupNode(backupRoot),objectsRoot=backupNode(join(backupRoot,'objects'));
  copyPayload(object,e,target,prefix);
  if(backupHash(backupNode(backupRoot))!==backupHash(sourceRoot)||backupHash(backupNode(join(backupRoot,'objects')))!==backupHash(objectsRoot))fail('RESTORE_EVIDENCE','Backup source directory changed',409);
}
export function restoreStagedFile(source:string,e:BackupEntry,target:string):void {
  const parent=dirname(source),anchor=backupNode(parent);copyPayload(source,e,target,Buffer.alloc(0));
  if(backupHash(backupNode(parent))!==backupHash(anchor))fail('RESTORE_EVIDENCE','Staged source directory changed',409);
}
function copyPayload(object:string,e:BackupEntry,target:string,prefix:Buffer):void {
  if(e.kind!=='file'||!e.digest)fail('RESTORE_EVIDENCE','Restore file required',409);
  const parent=dirname(target),anchor=backupNode(parent);
  privatePath(object);const input=openSync(object,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let output:number|undefined;
  try{
    const source=heldFile(input);if(source.size!==BigInt(prefix.length+e.bytes))fail('RESTORE_EVIDENCE','Backup object length differs',409);
    const header=Buffer.alloc(prefix.length);readAt(input,header,0);if(!header.equals(prefix))fail('RESTORE_EVIDENCE','Backup object framing differs',409);
    const present=workerFilePresent(target);if(present)privatePath(target);
    const prior=present?lstatSync(target):null;
    const finished=prior?.size===e.bytes&&(prior.mode&0o777)===e.mode;
    output=finished?openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK):present?openSync(target,constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK):openSync(target,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    const dest=heldFile(output),oldBytes=Number(dest.size),named=lstatSync(target,{bigint:true});
    if(oldBytes>e.bytes||named.dev!==dest.dev||named.ino!==dest.ino||!finished&&Number(dest.mode&0o777n)!==0o600)fail('RESTORE_EVIDENCE','Foreign or oversized candidate file was preserved',409);
    const buffer=Buffer.alloc(1024*1024),existing=Buffer.alloc(1024*1024),h=createHash('sha256');let offset=0;
    while(offset<e.bytes){
      const n=Math.min(buffer.length,e.bytes-offset);readAt(input,buffer,prefix.length+offset,n);h.update(buffer.subarray(0,n));
      const retained=Math.max(0,Math.min(n,oldBytes-offset));if(retained){readAt(output,existing,offset,retained);if(!existing.subarray(0,retained).equals(buffer.subarray(0,retained)))fail('RESTORE_EVIDENCE','Changed candidate prefix was preserved',409);}
      if(retained<n)writeAt(output,buffer.subarray(retained,n),offset+retained);offset+=n;
    }
    const after=lstatSync(target,{bigint:true});
    if('sha256:'+h.digest('hex')!==e.digest||stamp(heldFile(input))!==stamp(source)||stamp(lstatSync(object,{bigint:true}))!==stamp(source)||after.dev!==dest.dev||after.ino!==dest.ino||heldFile(output).size!==BigInt(e.bytes)||backupHash(backupNode(parent))!==backupHash(anchor))fail('RESTORE_EVIDENCE','Restore source or destination changed',409);
    if(!finished){fchmodSync(output,e.mode);fsyncSync(output);}syncRestoreDirectory(parent);
  }finally{closeSync(input);if(output!==undefined)closeSync(output);}
}

export function restoredFileImage(path:string,e:BackupEntry):NodeIdentity {
  const node=backupNode(path,false);if(node.mode!==e.mode)fail('RESTORE_EVIDENCE','Candidate file mode differs',409);
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=heldFile(fd);if(before.size!==BigInt(e.bytes)||String(before.dev)!==node.device||String(before.ino)!==node.inode)fail('RESTORE_EVIDENCE','Candidate length or identity differs',409);
    const h=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
    while(offset<e.bytes){const n=Math.min(buffer.length,e.bytes-offset);readAt(fd,buffer,offset,n);h.update(buffer.subarray(0,n));offset+=n;}
    if('sha256:'+h.digest('hex')!==e.digest||stamp(heldFile(fd))!==stamp(before)||stamp(lstatSync(path,{bigint:true}))!==stamp(before))fail('RESTORE_EVIDENCE','Candidate bytes changed',409);
    return node;
  }finally{closeSync(fd);}
}
