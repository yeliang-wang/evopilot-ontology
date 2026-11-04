import {constants,openSync,closeSync,lstatSync,fstatSync,readSync,writeSync,fsyncSync,ftruncateSync,renameSync,realpathSync} from 'node:fs';
import type {BigIntStats} from 'node:fs';
import {basename,dirname,isAbsolute,resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fail,ServiceError} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

export interface PreparationNode {device:string;inode:string;mode:number;}
const DEFAULT_BYTES=8*1024*1024,MAX_BYTES=64*1024*1024,SMALL_BYTES=65536,CHUNK=65536;
function evidence(message:string):never {return fail('DISTRIBUTION_PREPARATION_EVIDENCE',message,409);}
function limited(message:string):never {return fail('DISTRIBUTION_PREPARATION_LIMIT',message,413);}
const stamp=(s:BigIntStats):string=>[s.dev,s.ino,s.uid,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
const identity=(s:BigIntStats):string=>[s.dev,s.ino,s.uid,s.mode].join(':');
const node=(s:BigIntStats):PreparationNode=>({device:String(s.dev),inode:String(s.ino),mode:Number(s.mode&0o777n)});
function linux():void {if(process.platform!=='linux')fail('DISTRIBUTION_PREPARATION_UNSUPPORTED','Preparation writes require Linux descriptor-rooted paths',409);}
function canonical(path:string):void {
  if(typeof path!=='string'||path.length>4096||!isAbsolute(path)||resolve(path)!==path||/[\\\x00]/u.test(path))evidence('Canonical absolute preparation path required');
}
function bounded(bytes:number,maximum=MAX_BYTES):void {
  if(!Number.isSafeInteger(bytes)||bytes<1||bytes>maximum)limited('Preparation byte budget must be a positive bounded safe integer');
}
function privateNode(s:BigIntStats,directory:boolean):void {
  if((directory?!s.isDirectory():!s.isFile()||s.nlink!==1n)||process.getuid===undefined||s.uid!==BigInt(process.getuid())||(s.mode&0o077n)!==0n)evidence('Private owned preparation directory or single-link regular file required');
}
export function preparationFilePresent(path:string):boolean {
  try{lstatSync(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
}

/** Physical identity only. This does not establish a request's ownership. */
export function preparationNode(path:string,directory=true):PreparationNode {
  canonical(path);const before=lstatSync(path,{bigint:true});privateNode(before,directory);
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK|(directory?constants.O_DIRECTORY:0));
  try{
    const held=fstatSync(fd,{bigint:true});privateNode(held,directory);
    if(stamp(held)!==stamp(before)||stamp(lstatSync(path,{bigint:true}))!==stamp(held))evidence('Preparation node changed while its identity was read');
    return node(held);
  }finally{closeSync(fd);}
}
export function assertPreparationNode(path:string,expected:PreparationNode,directory=true):void {
  const actual=preparationNode(path,directory);
  if(!expected||actual.device!==expected.device||actual.inode!==expected.inode||actual.mode!==expected.mode)evidence('Original preparation node was replaced or changed');
}

interface Directory {
  path:string;fd:number;
  file(name:string):string;
  guard():void;
  sync():void;
  close():void;
}
/** Mutations use the held directory, and separately reject a renamed/replaced
 * logical path. Callers still must prove the root's complete request owner. */
function openDirectory(path:string,writing:boolean,expected?:PreparationNode):Directory {
  if(writing)linux();canonical(path);
  const parent=dirname(path);if(path===parent)evidence('Filesystem root cannot own preparation control');
  const p=lstatSync(parent,{bigint:true}),s=lstatSync(path,{bigint:true});privateNode(p,true);privateNode(s,true);
  if(realpathSync(parent)!==parent||realpathSync(path)!==path)evidence('Preparation directories must not traverse symbolic links');
  const parentFd=openSync(parent,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let fd:number|undefined;
  const rooted=(directoryFd:number,logical:string,name:string)=>process.platform==='linux'?'/proc/self/fd/'+directoryFd+'/'+name:join(logical,name);
  try{
    if(identity(fstatSync(parentFd,{bigint:true}))!==identity(p))evidence('Preparation parent changed before open');
    fd=openSync(rooted(parentFd,parent,basename(path)),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const held=fd;
    const guard=():void=>{
      const currentParent=fstatSync(parentFd,{bigint:true}),current=fstatSync(held,{bigint:true});privateNode(currentParent,true);privateNode(current,true);
      if(expected&&(String(current.dev)!==expected.device||String(current.ino)!==expected.inode||Number(current.mode&0o777n)!==expected.mode))evidence('Preparation directory differs from its admitted physical owner');
      if(identity(currentParent)!==identity(p)||identity(lstatSync(parent,{bigint:true}))!==identity(p)||identity(current)!==identity(s)||identity(lstatSync(rooted(parentFd,parent,basename(path)),{bigint:true}))!==identity(s)||realpathSync(path)!==path)evidence('Preparation directory or its original parent changed');
    };
    guard();
    return {path,fd:held,file(name){if(!name||name==='.'||name==='..'||/[\/\\\x00]/u.test(name))evidence('Flat preparation control name required');return rooted(held,path,name);},guard,
      sync(){guard();fsyncSync(held);guard();},close(){try{closeSync(held);}finally{closeSync(parentFd);}}};
  }catch(error){if(fd!==undefined)closeSync(fd);closeSync(parentFd);throw error;}
}
export function syncPreparationDirectory(path:string,expectedRoot?:PreparationNode):void {
  const directory=openDirectory(path,true,expectedRoot);try{directory.sync();}finally{directory.close();}
}

function heldFile(fd:number):BigIntStats {const s=fstatSync(fd,{bigint:true});privateNode(s,false);return s;}
function readAt(fd:number,buffer:Buffer,position:number):void {
  let offset=0;while(offset<buffer.length){const n=readSync(fd,buffer,offset,buffer.length-offset,position+offset);if(!n)evidence('Preparation file ended before its declared size');offset+=n;}
}
function writeAt(fd:number,buffer:Buffer,position:number):void {
  let offset=0;while(offset<buffer.length){const count=Math.min(CHUNK,buffer.length-offset),n=writeSync(fd,buffer,offset,count,position+offset);if(!n)evidence('Preparation write made no progress');offset+=n;}
}
function readSnapshot(directory:Directory,name:string,max:number):{bytes:Buffer;stat:BigIntStats} {
  directory.guard();const path=directory.file(name),before=lstatSync(path,{bigint:true});privateNode(before,false);
  if(before.size>BigInt(max))limited('Preparation control file exceeds its byte budget');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const held=heldFile(fd);if(stamp(held)!==stamp(before))evidence('Preparation control file changed before open');
    const bytes=Buffer.alloc(Number(held.size));readAt(fd,bytes,0);
    if(stamp(heldFile(fd))!==stamp(held)||stamp(lstatSync(path,{bigint:true}))!==stamp(held))evidence('Preparation control file changed during read');
    directory.guard();return {bytes,stat:held};
  }finally{closeSync(fd);}
}
function readBytes(directory:Directory,name:string,max:number):Buffer {return readSnapshot(directory,name,max).bytes;}
function jsonShape(value:unknown,max:number):void {
  const active=new Set<object>(),pending:{value:unknown;depth:number;leave?:boolean}[]=[{value,depth:0}];let count=0,textBytes=0;
  while(pending.length){
    const item=pending.pop()!,v=item.value;
    if(item.leave){active.delete(v as object);continue;}
    if(++count>1000000||item.depth>64)limited('Preparation JSON structure exceeds its budget');
    if(v===null||typeof v==='boolean')continue;
    if(typeof v==='number'){if(!Number.isFinite(v))evidence('Preparation JSON numbers must be finite');continue;}
    if(typeof v==='string'){textBytes+=Buffer.byteLength(v);if(textBytes>max)limited('Preparation JSON strings exceed their byte budget');continue;}
    if(typeof v!=='object'||!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v)))evidence('Plain preparation JSON required');
    if(active.has(v))evidence('Preparation JSON cannot be cyclic');active.add(v);pending.push({value:v,depth:item.depth,leave:true});
    for(const [key,child] of Object.entries(v)){
      textBytes+=Buffer.byteLength(key);if(textBytes>max)limited('Preparation JSON keys exceed their byte budget');
      pending.push({value:child,depth:item.depth+1});if(pending.length>1000000)limited('Preparation JSON structure exceeds its budget');
    }
  }
}
function jsonBytes(value:unknown,max:number):Buffer {
  bounded(max);jsonShape(value,max);const serialized=JSON.stringify(value);
  if(typeof serialized!=='string')evidence('Preparation value must be JSON');
  const bytes=Buffer.from(serialized+'\n');if(bytes.length>max)limited('Preparation JSON exceeds its byte budget');return bytes;
}
export function readPreparationJSON(path:string,max=DEFAULT_BYTES):unknown {
  canonical(path);bounded(max);const directory=openDirectory(dirname(path),false);
  try{
    const bytes=readBytes(directory,basename(path),max);let value:unknown;
    try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));}catch{return evidence('Retained preparation JSON is malformed');}
    jsonShape(value,max);return value;
  }finally{directory.close();}
}

/** Caller holds the preparation lease. The fixed temporary name is a resumable
 * exact byte prefix; no unrelated completed or partial document is replaced. */
function writeImmutable(directory:Directory,name:string,bytes:Buffer):void {
  directory.guard();const path=directory.file(name),pending=directory.file(name+'.pending');
  if(preparationFilePresent(path)){
    if(preparationFilePresent(pending))evidence('Complete and pending preparation files are ambiguous');
    if(!readBytes(directory,name,bytes.length).equals(bytes))evidence('Existing preparation document differs from the exact request');return;
  }
  const present=preparationFilePresent(pending),before=present?lstatSync(pending,{bigint:true}):null;if(before)privateNode(before,false);
  const fd=openSync(pending,constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK|(present?0:constants.O_CREAT|constants.O_EXCL),0o600);
  try{
    const held=heldFile(fd);if(before&&stamp(before)!==stamp(held))evidence('Pending preparation file changed before open');
    if(held.size>BigInt(bytes.length))evidence('Oversized pending preparation file was preserved');
    const prefix=Buffer.alloc(Number(held.size));readAt(fd,prefix,0);
    if(!prefix.equals(bytes.subarray(0,prefix.length)))evidence('Foreign pending preparation bytes were preserved');
    if(stamp(heldFile(fd))!==stamp(held)||stamp(lstatSync(pending,{bigint:true}))!==stamp(held))evidence('Pending preparation file changed during prefix verification');
    directory.guard();writeAt(fd,bytes.subarray(prefix.length),prefix.length);fsyncSync(fd);
    const after=heldFile(fd),named=lstatSync(pending,{bigint:true});
    if(after.size!==BigInt(bytes.length)||after.dev!==held.dev||after.ino!==held.ino||stamp(named)!==stamp(after))evidence('Pending preparation file changed before publication');
    const complete=Buffer.alloc(bytes.length);readAt(fd,complete,0);
    if(!complete.equals(bytes)||stamp(heldFile(fd))!==stamp(after)||stamp(lstatSync(pending,{bigint:true}))!==stamp(after))evidence('Pending preparation bytes changed before publication');
    directory.guard();if(preparationFilePresent(path))evidence('Preparation destination appeared before publication');
    renameSync(pending,path);directory.sync();
    if(stamp(lstatSync(path,{bigint:true}))!==stamp(heldFile(fd)))evidence('Published preparation file was replaced');
  }finally{closeSync(fd);}
}
export function writePreparationJSON(path:string,value:unknown,max=DEFAULT_BYTES,expectedParent?:PreparationNode):void {
  linux();canonical(path);const bytes=jsonBytes(value,max),directory=openDirectory(dirname(path),true,expectedParent);
  try{writeImmutable(directory,basename(path),bytes);}finally{directory.close();}
}

function leaseFile(directory:Directory,name:string):BigIntStats {
  directory.guard();const s=lstatSync(directory.file(name),{bigint:true});privateNode(s,false);
  if(s.size>BigInt(SMALL_BYTES))limited('Preparation lease metadata exceeds its fixed budget');return s;
}
function sqliteError(error:unknown):never {
  if(error instanceof ServiceError)throw error;
  const e=error as NodeJS.ErrnoException&{errcode?:number};
  const primary=typeof e.errcode==='number'?e.errcode&255:undefined;
  if(e.code==='ENOSPC'||primary===13)throw error;
  if(primary===5||primary===6||e.code==='SQLITE_BUSY'||e.code==='SQLITE_LOCKED')fail('DISTRIBUTION_PREPARATION_BUSY','Another operation holds this preparation lease',409);
  return evidence('Preparation lease is not a usable private empty SQLite store');
}
/** The caller has already established the root's complete owner. This lease is
 * local control only; the callback must not leave unleased writing children. */
export async function withPreparationLock<T>(root:string,work:()=>Promise<T>,expectedRoot?:PreparationNode):Promise<T> {
  const directory=openDirectory(root,true,expectedRoot),path=directory.file('operator.sqlite');let db:DatabaseSync|undefined,result:T|undefined,failed=false,problem:unknown;
  try{
    directory.guard();
    if(!preparationFilePresent(path)){
      let fd:number|undefined;
      try{fd=openSync(path,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);heldFile(fd);fsyncSync(fd);}
      catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
      finally{if(fd!==undefined)closeSync(fd);}
      directory.sync();
    }
    const before=leaseFile(directory,'operator.sqlite');
    if(['operator.sqlite-wal','operator.sqlite-shm'].some(name=>preparationFilePresent(directory.file(name))))evidence('Unexpected preparation lease sidecar was preserved');
    if(preparationFilePresent(directory.file('operator.sqlite-journal')))leaseFile(directory,'operator.sqlite-journal');
    try{
      db=new DatabaseSync(path,{timeout:0});
      db.exec('PRAGMA locking_mode=EXCLUSIVE;PRAGMA synchronous=FULL;BEGIN IMMEDIATE');
      const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);
      if(![0,1].includes(version)||db.prepare('SELECT name FROM sqlite_master LIMIT 1').get()||db.prepare('PRAGMA journal_mode').get()?.journal_mode!=='delete')evidence('Foreign preparation lease schema was preserved');
      const current=leaseFile(directory,'operator.sqlite');if(identity(current)!==identity(before))evidence('Preparation lease was replaced during acquisition');
      if(version===0)db.exec('PRAGMA user_version=1;COMMIT;BEGIN IMMEDIATE');
    }catch(error){sqliteError(error);}
    directory.guard();result=await work();directory.guard();
    if(identity(leaseFile(directory,'operator.sqlite'))!==identity(before))evidence('Preparation lease was replaced during the operation');
  }catch(error){failed=true;problem=error;}
  finally{
    if(db){
      try{if(db.isTransaction)db.exec('ROLLBACK');}catch(error){if(!failed){failed=true;problem=error;}}
      try{db.close();}catch(error){if(!failed){failed=true;problem=error;}}
    }
    try{directory.close();}catch(error){if(!failed){failed=true;problem=error;}}
  }
  if(failed)throw problem;return result as T;
}

function reserveBytes(identityValue:Json,bytes:number):{line:Buffer;full:Buffer} {
  bounded(bytes,MAX_BYTES-SMALL_BYTES);const line=jsonBytes(identityValue,SMALL_BYTES);
  return {line,full:Buffer.concat([line,Buffer.alloc(bytes,32)])};
}
function assertReserveFile(directory:Directory,name:string,line:Buffer,bytes:number,complete:boolean):BigIntStats {
  const {bytes:content,stat}=readSnapshot(directory,name,line.length+bytes);
  if(content.length<line.length||complete&&content.length!==line.length+bytes||!content.subarray(0,line.length).equals(line)||content.subarray(line.length).some(byte=>byte!==32))evidence('Completion reserve identity or padding differs');
  return stat;
}
/** Allocate physical completion headroom before admission. The padding is not
 * sparse; reserve size excludes the bounded complete identity line. */
export function reservePreparationSpace(root:string,identityValue:Json,bytes=DEFAULT_BYTES,expectedRoot?:PreparationNode):void {
  linux();const {line,full}=reserveBytes(identityValue,bytes),directory=openDirectory(root,true,expectedRoot);
  try{
    if(['prepared.reserve','abort.reserve','prepared.reserve.pending','abort.reserve.pending'].some(name=>preparationFilePresent(directory.file(name))))evidence('A terminal preparation direction or foreign partial direction is already retained');
    writeImmutable(directory,'completion.reserve',full);
    const s=assertReserveFile(directory,'completion.reserve',line,bytes,true);
    if(s.blocks*512n<BigInt(bytes))limited('Filesystem did not retain the required physical completion allocation');directory.guard();
  }finally{directory.close();}
}
/** Rename commits the irreversible direction before any space is released.
 * An interrupted truncate may retain any suffix of the known space padding. */
export function selectPreparationDirection(root:string,identityValue:Json,direction:'prepared'|'abort',bytes=DEFAULT_BYTES,expectedRoot?:PreparationNode):void {
  linux();if(direction!=='prepared'&&direction!=='abort')evidence('Explicit preparation terminal direction required');
  bounded(bytes,MAX_BYTES-SMALL_BYTES);const line=jsonBytes(identityValue,SMALL_BYTES),directory=openDirectory(root,true,expectedRoot);
  const target=direction+'.reserve',other=(direction==='prepared'?'abort':'prepared')+'.reserve';let fd:number|undefined;
  try{
    const source=directory.file('completion.reserve'),destination=directory.file(target);
    if([other,'completion.reserve.pending','prepared.reserve.pending','abort.reserve.pending'].some(name=>preparationFilePresent(directory.file(name))))evidence('Conflicting or incomplete preparation direction was preserved');
    const selected=preparationFilePresent(destination),initial=preparationFilePresent(source);
    if(selected&&initial||!selected&&!initial)evidence('Preparation reserve has no single retained terminal direction');
    const name=selected?target:'completion.reserve',before=assertReserveFile(directory,name,line,bytes,!selected);
    if(!selected&&before.blocks*512n<BigInt(bytes))limited('Completion reserve lacks its required physical allocation');
    fd=openSync(directory.file(name),constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    if(stamp(heldFile(fd))!==stamp(before))evidence('Preparation reserve changed before direction selection');
    directory.guard();
    if(!selected){
      if(preparationFilePresent(destination)||preparationFilePresent(directory.file(other)))evidence('Preparation direction appeared concurrently');
      renameSync(source,destination);directory.sync();
    }
    const held=heldFile(fd),named=lstatSync(destination,{bigint:true});
    if(stamp(named)!==stamp(held)||held.dev!==before.dev||held.ino!==before.ino)evidence('Selected preparation reserve was replaced');
    // Keep the complete binding line, even when killed immediately after this.
    directory.guard();ftruncateSync(fd,line.length);fsyncSync(fd);directory.sync();
    if(heldFile(fd).size!==BigInt(line.length)||stamp(lstatSync(destination,{bigint:true}))!==stamp(heldFile(fd)))evidence('Selected preparation direction changed during space release');
  }finally{try{if(fd!==undefined)closeSync(fd);}finally{directory.close();}}
}
