import {constants,openSync,closeSync,lstatSync,fstatSync,createReadStream,read as readArchive} from 'node:fs';
import type {BigIntStats} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import type {Hash} from 'node:crypto';
import {Transform,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGunzip} from 'node:zlib';
import {digest,exact,hash} from '../standalone/validation.js';
import {fail,ServiceError} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

export interface ArchiveSpec {
  format:'tar'|'tar.gz';bytes:number;digest:string;stripPrefix:string|null;
  maxEntries:number;maxFileBytes:number;maxExpandedBytes:number;maxTarBytes:number;timeoutMs:number;
}
export interface ArchiveEntry {
  path:string;kind:'file'|'directory'|'symlink';mode:number;bytes:number;
  digest:string|null;target:string|null;resolvedTarget:string|null;derived:boolean;
}
export interface ArchiveInventory {
  schema:'ontology-tar-inventory/v1';artifactDigest:string;artifactBytes:number;tarBytes:number;
  entryCount:number;fileCount:number;directoryCount:number;symlinkCount:number;fileBytes:number;
  entries:ArchiveEntry[];inventoryDigest:string;
}

const CHUNK=65536,PAX_BYTES=65536,BLOCK=512;
const stamp=(s:BigIntStats)=>[s.dev,s.ino,s.uid,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
function invalid(message:string):never {fail('DISTRIBUTION_ARCHIVE_INVALID',message,409);}
function limited(message:string):never {fail('DISTRIBUTION_ARCHIVE_LIMIT',message,413);}
function changed(message:string):never {fail('DISTRIBUTION_ARCHIVE_CHANGED',message,409);}
function checkTime(deadline:number):void {
  if(performance.now()>deadline)fail('DISTRIBUTION_ARCHIVE_TIMEOUT','Archive inspection exceeded its read budget',503);
}
function zero(bytes:Buffer):boolean {for(const byte of bytes)if(byte!==0)return false;return true;}
function utf8(bytes:Buffer):string {
  // A tar field is a path byte string, not a text document with a BOM marker.
  // Preserve an initial U+FEFF in names and raw link targets.
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{invalid('Archive text is not valid UTF-8');}
}
function field(header:Buffer,start:number,length:number):string {
  const bytes=header.subarray(start,start+length),end=bytes.indexOf(0);
  // Tar strings end at the first NUL. Some pinned upstream headers retain old
  // bytes after it; those bytes remain covered by the full header checksum.
  return utf8(end<0?bytes:bytes.subarray(0,end));
}
function octal(header:Buffer,start:number,length:number,empty=false):number {
  const bytes=header.subarray(start,start+length);
  if(empty&&bytes.every(byte=>byte===0||byte===32))return 0;
  const text=bytes.toString('latin1');
  if(!/^ *[0-7]+[\x00 ]*$/.test(text))invalid('Tar numeric fields must contain bounded unsigned octal numbers');
  const value=Number.parseInt(text.trimStart(),8);
  if(!Number.isSafeInteger(value)||value<0)invalid('Tar numeric field exceeds the safe integer range');
  return value;
}
function pathText(value:string):void {
  if(!value||value.startsWith('/')||/[\\\x00-\x1f\x7f-\x9f]/u.test(value))invalid('Archive path must be a relative path without controls or backslashes');
}
function canonicalPath(value:string,directory=false):string {
  pathText(value);
  const path=directory&&value.endsWith('/')?value.slice(0,-1):value;
  if(!path||path.split('/').some(part=>!part||part==='.'||part==='..'))invalid('Archive entity path is not canonical');
  return path;
}
function validateSpec(spec:ArchiveSpec):void {
  exact(spec,['format','bytes','digest','stripPrefix','maxEntries','maxFileBytes','maxExpandedBytes','maxTarBytes','timeoutMs']);
  if(!['tar','tar.gz'].includes(spec.format))fail('INVALID_INPUT','Only explicit tar and tar.gz archives are supported');
  digest(spec.digest);
  const bounds:{field:keyof ArchiveSpec;maximum:number}[]=[
    {field:'bytes',maximum:256*1024*1024},{field:'maxEntries',maximum:100000},
    {field:'maxFileBytes',maximum:2*1024*1024*1024},{field:'maxExpandedBytes',maximum:2*1024*1024*1024},
    {field:'maxTarBytes',maximum:4*1024*1024*1024},{field:'timeoutMs',maximum:120000},
  ];
  for(const {field,maximum} of bounds){const n=spec[field];if(typeof n!=='number'||!Number.isSafeInteger(n)||n<1||n>maximum)fail('INVALID_INPUT','Archive budgets must be positive bounded safe integers');}
  if(spec.stripPrefix!==null){
    if(typeof spec.stripPrefix!=='string'||Buffer.byteLength(spec.stripPrefix)>256)fail('INVALID_INPUT','Bounded archive prefix required');
    try{canonicalPath(spec.stripPrefix);}catch{fail('INVALID_INPUT','Archive prefix must be a canonical relative entity path');}
  }
}
function validatePax(bytes:Buffer):void {
  let position=0;const keys=new Set<string>();
  while(position<bytes.length){
    const space=bytes.indexOf(32,position);
    if(space<0||space-position>6)invalid('PAX record length is missing or oversized');
    const digits=bytes.subarray(position,space).toString('latin1');
    if(!/^[1-9][0-9]*$/.test(digits))invalid('PAX record length is not canonical decimal');
    const length=Number(digits),end=position+length;
    if(end>bytes.length||end<=space+1||bytes[end-1]!==10)invalid('PAX record does not match its declared byte length');
    const record=utf8(bytes.subarray(space+1,end-1)),equal=record.indexOf('=');
    if(equal<1)invalid('Malformed PAX record');
    const key=record.slice(0,equal),value=record.slice(equal+1);
    if(keys.has(key)||key!=='mtime'||! /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value))invalid('Only a single numeric mtime PAX record is supported');
    keys.add(key);position=end;
  }
  if(keys.size!==1)invalid('PAX extended header must contain exactly one mtime record');
}

class TarReader {
  readonly entries=new Map<string,ArchiveEntry>();
  tarBytes=0;fileBytes=0;
  private readonly explicit=new Set<string>();
  private readonly header=Buffer.alloc(BLOCK);
  private readonly pax=Buffer.alloc(PAX_BYTES);
  private headerUsed=0;
  private headerCount=0;
  private remaining=0;
  private padding=0;
  private tailBytes=0;
  private ended=false;
  private pendingPax=false;
  private body:'file'|'pax'|null=null;
  private paxUsed=0;
  private fileHash:Hash|null=null;
  private fileEntry:ArchiveEntry|null=null;
  constructor(private readonly spec:ArchiveSpec,private readonly deadline:number){}

  consume(chunk:Buffer):void {
    checkTime(this.deadline);
    if(chunk.length>this.spec.maxTarBytes-this.tarBytes)limited('Expanded tar stream exceeds its byte budget');
    this.tarBytes+=chunk.length;let position=0;
    while(position<chunk.length){
      checkTime(this.deadline);
      if(this.ended){
        const rest=chunk.subarray(position);if(!zero(rest))invalid('Nonzero bytes follow the tar terminator');
        this.tailBytes+=rest.length;return;
      }
      if(this.remaining){
        const count=Math.min(this.remaining,chunk.length-position),part=chunk.subarray(position,position+count);
        if(this.body==='file')this.fileHash!.update(part);
        else if(this.body==='pax'){part.copy(this.pax,this.paxUsed);this.paxUsed+=count;}
        else invalid('Tar body has no supported owner');
        this.remaining-=count;position+=count;
        if(!this.remaining)this.finishBody();
        continue;
      }
      if(this.padding){
        const count=Math.min(this.padding,chunk.length-position);
        if(!zero(chunk.subarray(position,position+count)))invalid('Tar member padding must contain only zero bytes');
        this.padding-=count;position+=count;continue;
      }
      const count=Math.min(BLOCK-this.headerUsed,chunk.length-position);
      chunk.copy(this.header,this.headerUsed,position,position+count);this.headerUsed+=count;position+=count;
      if(this.headerUsed===BLOCK){this.headerUsed=0;this.readHeader();}
    }
  }

  finish():ArchiveEntry[] {
    checkTime(this.deadline);
    if(!this.ended||this.tailBytes<2*BLOCK||this.tarBytes%BLOCK||this.remaining||this.padding||this.headerUsed||this.pendingPax)invalid('Tar archive is truncated or missing a complete terminator');
    this.resolveLinks();
    checkTime(this.deadline);
    return [...this.entries.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  }

  private add(entry:ArchiveEntry):void {
    const parts=entry.path.split('/');
    for(let n=1;n<parts.length;n++){
      const path=parts.slice(0,n).join('/'),prior=this.entries.get(path);
      if(prior){if(prior.kind!=='directory')invalid('Archive entry has a file or symlink ancestor');}
      else this.insert({path,kind:'directory',mode:0o700,bytes:0,digest:null,target:null,resolvedTarget:null,derived:true});
    }
    const prior=this.entries.get(entry.path);
    if(prior){
      if(prior.kind!=='directory'||!prior.derived||entry.kind!=='directory')invalid('Archive contains duplicate or conflicting entity paths');
      this.entries.set(entry.path,entry);
    }else this.insert(entry);
  }
  private insert(entry:ArchiveEntry):void {
    if(this.entries.size>=this.spec.maxEntries)limited('Archive inventory including inferred directories exceeds its entry budget');
    this.entries.set(entry.path,entry);
  }
  private finishBody():void {
    if(this.body==='file'){
      this.fileEntry!.digest='sha256:'+this.fileHash!.digest('hex');this.fileHash=null;this.fileEntry=null;
    }else if(this.body==='pax')validatePax(this.pax.subarray(0,this.paxUsed));
    this.body=null;
  }
  private readHeader():void {
    const h=this.header;
    if(zero(h)){this.ended=true;this.tailBytes=BLOCK;return;}
    if(++this.headerCount>this.spec.maxEntries)limited('Physical tar headers exceed the entry budget');
    const checksum=octal(h,148,8);let sum=0;
    for(let n=0;n<BLOCK;n++)sum+=n>=148&&n<156?32:h[n];
    if(checksum!==sum)invalid('Tar header checksum does not match');
    const magic=h.subarray(257,265),posix=magic.equals(Buffer.from([117,115,116,97,114,0,48,48])),gnu=magic.equals(Buffer.from([117,115,116,97,114,32,32,0]));
    if(!posix&&!gnu)invalid('Only POSIX ustar or the supported GNU ustar header is accepted');
    if(gnu&&!zero(h.subarray(345))||posix&&!zero(h.subarray(500)))invalid('Unsupported tar extension header fields');
    const mode=octal(h,100,8),size=octal(h,124,12);
    octal(h,108,8);octal(h,116,8);octal(h,136,12);
    if(mode>0o7777||(mode&0o6000)!==0)invalid('Setuid, setgid or non-permission tar modes are forbidden');
    if(octal(h,329,8,true)!==0||octal(h,337,8,true)!==0)invalid('Device metadata is not supported');
    const name=field(h,0,100),prefix=posix?field(h,345,155):'',link=field(h,157,100),type=h[156];
    // PAX metadata names (including ././@PaxHeader) do not designate an
    // extractable entity. Only its tightly bounded mtime body is admitted.
    if(type===120){
      if(this.pendingPax||size<1||size>PAX_BYTES||link)invalid('Unsupported or oversized PAX extended header');
      this.pendingPax=true;this.body='pax';this.paxUsed=0;this.remaining=size;this.padding=(BLOCK-size%BLOCK)%BLOCK;return;
    }
    this.pendingPax=false;
    const kind=type===0||type===48?'file':type===53?'directory':type===50?'symlink':null;
    if(!kind)invalid('Unsupported tar member type');
    if(kind!=='file'&&size!==0)invalid('Directories and symlinks must have no tar body');
    if(kind==='file'&&size>this.spec.maxFileBytes)limited('Archive file exceeds its byte budget');
    if(size>this.spec.maxExpandedBytes-this.fileBytes)limited('Archive files exceed their total expanded byte budget');
    if(kind==='symlink'){pathText(link);if(link.split('/').some((part,n,all)=>!part&&n!==all.length-1))invalid('Symlink target contains an empty path segment');}
    else if(link)invalid('Only symlinks may carry a link target');
    const original=canonicalPath(prefix?prefix+'/'+name:name,kind==='directory');
    if(this.explicit.has(original))invalid('Duplicate explicit tar entity');this.explicit.add(original);
    let path=original;
    if(this.spec.stripPrefix!==null){
      if(original===this.spec.stripPrefix){if(kind!=='directory')invalid('Selected archive prefix is not a directory');return;}
      if(!original.startsWith(this.spec.stripPrefix+'/'))invalid('Archive entity lies outside the selected prefix');
      path=original.slice(this.spec.stripPrefix.length+1);
    }
    const entry:ArchiveEntry={path,kind,mode:kind==='file'&&(mode&0o111)===0?0o600:0o700,bytes:size,digest:null,target:kind==='symlink'?link:null,resolvedTarget:null,derived:false};
    this.add(entry);
    if(kind==='file'){
      this.fileBytes+=size;this.body='file';this.fileHash=createHash('sha256');this.fileEntry=entry;this.remaining=size;this.padding=(BLOCK-size%BLOCK)%BLOCK;
      if(!size)this.finishBody();
    }
  }

  private resolveLinks():void {
    // Resolve only the inventory's case-sensitive virtual tree. A stack avoids
    // JS recursion limits, and memoized targets bound repeated link chains.
    type Frame={entry:ArchiveEntry;parts:string[];position:number;resolved:string[]};
    const cache=new Map<string,string>(),active=new Set<string>();
    const frame=(entry:ArchiveEntry):Frame=>({entry,parts:entry.target!.split('/'),position:0,resolved:entry.path.split('/').slice(0,-1)});
    for(const entry of this.entries.values()){
      if(entry.kind!=='symlink'||cache.has(entry.path))continue;
      const stack=[frame(entry)];active.add(entry.path);
      while(stack.length){
        checkTime(this.deadline);
        const f=stack[stack.length-1];
        if(f.position===f.parts.length){
          const target=f.resolved.join('/');
          if(!target||!this.entries.has(target))invalid('Symlink does not resolve to an inventoried entity');
          cache.set(f.entry.path,target);f.entry.resolvedTarget=target;active.delete(f.entry.path);stack.pop();continue;
        }
        // A trailing slash, dot or parent operation after a regular file also
        // requires a directory, just as a path lookup would on the filesystem.
        if(f.resolved.length&&this.entries.get(f.resolved.join('/'))?.kind!=='directory')invalid('Symlink traversal uses a non-directory ancestor');
        const part=f.parts[f.position];
        if(part==='.'||part===''){f.position++;continue;}
        if(part==='..'){
          if(!f.resolved.length)invalid('Symlink escapes the selected archive prefix');
          f.resolved.pop();f.position++;continue;
        }
        const name=[...f.resolved,part].join('/'),next=this.entries.get(name);
        if(!next)invalid('Dangling symlink target');
        if(next.kind==='symlink'){
          if(!cache.has(name)){
            if(active.has(name))invalid('Archive symlink cycle');
            active.add(name);stack.push(frame(next));continue;
          }
          f.resolved=cache.get(name)!.split('/');
        }else f.resolved.push(part);
        f.position++;
      }
    }
  }
}

/** Read-only bounded inventory. Digests authenticate bytes against the supplied
 * selection, not upstream provenance, extraction safety on a particular target,
 * executable loadability or legal approval. The timer can destroy asynchronous
 * streams; it is not an operating-system deadline for a stalled filesystem. */
export async function inspectTarArchive(path:string,spec:ArchiveSpec):Promise<ArchiveInventory> {
  validateSpec(spec);
  if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||/[\\\x00]/u.test(path))fail('INVALID_INPUT','Canonical absolute archive path required');
  const before=lstatSync(path,{bigint:true});
  if(!before.isFile()||before.nlink!==1n||before.uid!==BigInt(process.getuid!())||(before.mode&0o022n)!==0n)fail('DISTRIBUTION_UNSAFE_ARTIFACT','Owned regular archive without writable aliases required',409);
  if(before.size!==BigInt(spec.bytes))changed('Archive size differs from its selected identity');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const opened=fstatSync(fd,{bigint:true});if(stamp(opened)!==stamp(before))changed('Archive changed before its descriptor was opened');
    const deadline=performance.now()+spec.timeoutMs,reader=new TarReader(spec,deadline),rawHash=createHash('sha256');let rawBytes=0;
    // ReadStream.destroy() closes even an autoClose:false descriptor. Keep sole
    // ownership here with a no-op stream close, and await the close event below:
    // ReadStream delays that event until its pending asynchronous read settles.
    const source=createReadStream(path,{fd,autoClose:false,start:0,highWaterMark:CHUNK,fs:{read:readArchive,close(_fd:number,callback:(error:NodeJS.ErrnoException|null)=>void){callback(null);}}});
    const sourceClosed=new Promise<void>(resolve=>source.once('close',resolve));
    const raw=new Transform({highWaterMark:CHUNK,transform(chunk:Buffer,_encoding,callback){
      try{checkTime(deadline);if(chunk.length>spec.bytes-rawBytes)changed('Archive grew beyond its selected size');rawBytes+=chunk.length;rawHash.update(chunk);callback(null,chunk);}catch(error){callback(error as Error);}
    }});
    const sink=new Writable({highWaterMark:CHUNK,write(chunk:Buffer,_encoding,callback){try{reader.consume(chunk);callback();}catch(error){callback(error as Error);}}});
    const unzipOptions={chunkSize:CHUNK,highWaterMark:CHUNK,rejectGarbageAfterEnd:true};
    const unzip=spec.format==='tar.gz'?createGunzip(unzipOptions):null;
    const timer=setTimeout(()=>{
      const error=new ServiceError('DISTRIBUTION_ARCHIVE_TIMEOUT','Archive inspection exceeded its read budget',503);
      source.destroy(error);raw.destroy(error);unzip?.destroy(error);sink.destroy(error);
    },spec.timeoutMs);
    try{
      if(unzip)await pipeline(source,raw,unzip,sink);else await pipeline(source,raw,sink);
      checkTime(deadline);
      const artifactDigest='sha256:'+rawHash.digest('hex');
      if(rawBytes!==spec.bytes||artifactDigest!==spec.digest)changed('Archive bytes differ from their selected identity');
      const entries=reader.finish();
      if(stamp(fstatSync(fd,{bigint:true}))!==stamp(opened)||stamp(lstatSync(path,{bigint:true}))!==stamp(opened))changed('Archive identity changed during inspection');
      const inventory={schema:'ontology-tar-inventory/v1' as const,artifactDigest,artifactBytes:rawBytes,tarBytes:reader.tarBytes,entryCount:entries.length,
        fileCount:entries.filter(e=>e.kind==='file').length,directoryCount:entries.filter(e=>e.kind==='directory').length,symlinkCount:entries.filter(e=>e.kind==='symlink').length,fileBytes:reader.fileBytes,entries};
      const inventoryDigest=hash(inventory as unknown as Json);checkTime(deadline);
      return {...inventory,inventoryDigest};
    }catch(error){if(error instanceof ServiceError)throw error;return invalid('Archive stream could not be read or decoded');}
    finally{clearTimeout(timer);source.destroy();raw.destroy();unzip?.destroy();sink.destroy();await sourceClosed;}
  }finally{closeSync(fd);}
}
