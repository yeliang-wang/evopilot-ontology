import {constants,openSync,closeSync,lstatSync,fstatSync,opendirSync,mkdirSync,readSync,writeSync,fchmodSync,fsyncSync,symlinkSync,readlinkSync} from 'node:fs';
import type {BigIntStats} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {exact,hash} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {inspectTarArchive,readTarArchive,validateArchiveEntryTree,validateArchiveInventory} from './distribution-archive.js';
import type {ArchiveSpec,ArchiveInventory,ArchiveEntry,ArchiveReadHooks} from './distribution-archive.js';

export interface MaterializeRoot {path:string;device:string;inode:string;}
export interface MemoryFile {path:string;data:Buffer;mode:0o600|0o700;}
export interface MemoryLink {path:string;target:string;}
const CHUNK=65536;
const anchor=(fd:number,name?:string)=>'/proc/self/fd/'+fd+(name===undefined?'':'/'+name);
const identity=(s:BigIntStats)=>String(s.dev)+':'+String(s.ino);
const stamp=(s:BigIntStats)=>[s.dev,s.ino,s.uid,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
function evidence(message:string):never {fail('DISTRIBUTION_MATERIALIZE_EVIDENCE',message,409);}
function changed(message:string):never {fail('DISTRIBUTION_MATERIALIZE_CHANGED',message,409);}
function limited(message:string):never {fail('DISTRIBUTION_MATERIALIZE_LIMIT',message,413);}
function time(deadline:number):void {if(performance.now()>deadline)fail('DISTRIBUTION_MATERIALIZE_TIMEOUT','Materialization exceeded its bounded work budget',503);}
function absent(error:unknown):boolean {return (error as NodeJS.ErrnoException).code==='ENOENT';}
function maybeStat(path:string):BigIntStats|null {try{return lstatSync(path,{bigint:true});}catch(error){if(absent(error))return null;throw error;}}
function directoryFd(path:string):number {
  try{return openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
  catch(error){if(['ELOOP','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))evidence('A selected directory is a link or non-directory');throw error;}
}
function validateRoot(root:MaterializeRoot):MaterializeRoot {
  if(process.platform!=='linux')fail('DISTRIBUTION_MATERIALIZE_UNSUPPORTED','Anchored materialization requires Linux /proc/self/fd',409);
  exact(root,['path','device','inode']);
  if(typeof root.path!=='string'||!isAbsolute(root.path)||resolve(root.path)!==root.path||root.path==='/'||/[\\\x00-\x1f\x7f]/u.test(root.path)||root.path.length>4096||typeof root.device!=='string'||typeof root.inode!=='string'||!/^\d+$/.test(root.device)||!/^\d+$/.test(root.inode))fail('INVALID_INPUT','Explicit canonical materialization root identity required');
  return {...root};
}
function privateDirectory(s:BigIntStats,root:MaterializeRoot):void {
  if(!s.isDirectory()||s.uid!==BigInt(process.getuid!())||(s.mode&0o7777n)!==0o700n||String(s.dev)!==root.device)evidence('Owned private 0700 directory on the selected device required');
}
function openRoot(root:MaterializeRoot):number {
  // Every absolute-path segment is traversed through a held directory. Public
  // ancestors such as /tmp need not be private; none may be a symlink.
  let fd=directoryFd('/');
  try{
    for(const part of root.path.slice(1).split('/')){const next=directoryFd(anchor(fd,part));closeSync(fd);fd=next;}
    const s=fstatSync(fd,{bigint:true});privateDirectory(s,root);
    if(String(s.ino)!==root.inode)changed('Selected root identity differs');
    return fd;
  }catch(error){closeSync(fd);throw error;}
}
function sameInventory(a:ArchiveInventory,b:ArchiveInventory):void {
  if(hash(a as unknown as Json)!==hash(b as unknown as Json))evidence('Archive inventory differs from the exact selected inventory');
}
function inventoryInput(expected:ArchiveInventory,spec:ArchiveSpec):void {
  validateArchiveInventory(expected);
  if(expected.artifactDigest!==spec.digest||expected.artifactBytes!==spec.bytes)evidence('Selected inventory differs from the archive identity');
}

interface CurrentFile {fd:number;parent:number;name:string;entry:ArchiveEntry;oldBytes:number;offset:number;}
class Target {
  readonly fd:number;
  private readonly byPath:Map<string,ArchiveEntry>;
  private readonly identities=new Map<string,string>();
  private readonly aliases=new Map<string,string>();
  private current:CurrentFile|null=null;
  constructor(private readonly root:MaterializeRoot,private readonly entries:ArchiveEntry[],private readonly deadline:number,private readonly retained=new Set<string>()){
    this.byPath=new Map(entries.map(e=>[e.path,e]));this.fd=openRoot(root);this.remember('',fstatSync(this.fd,{bigint:true}));
  }
  close():void {try{this.closeCurrent();}finally{closeSync(this.fd);}}
  private closeCurrent():void {
    if(!this.current)return;const file=this.current;this.current=null;
    try{closeSync(file.fd);}finally{if(file.parent!==this.fd)closeSync(file.parent);}
  }
  private remember(path:string,s:BigIntStats):void {
    const id=identity(s),old=this.identities.get(path),alias=this.aliases.get(id);
    if(old!==undefined&&old!==id)changed('A retained target node was replaced');
    if(alias!==undefined&&alias!==path)evidence('Target paths alias the same physical node');
    this.identities.set(path,id);this.aliases.set(id,path);
  }
  private rootCurrent():void {
    time(this.deadline);privateDirectory(fstatSync(this.fd,{bigint:true}),this.root);
    const named=openRoot(this.root);try{if(identity(fstatSync(named,{bigint:true}))!==identity(fstatSync(this.fd,{bigint:true})))changed('Named target root changed');}finally{closeSync(named);}
  }
  private directory(path:string):number {
    let fd=this.fd,prefix='';
    try{
      for(const part of path?path.split('/'):[]){
        prefix=prefix?prefix+'/'+part:part;
        if(this.byPath.get(prefix)?.kind!=='directory')evidence('Target parent is not an inventoried directory');
        const next=directoryFd(anchor(fd,part));
        try{const s=fstatSync(next,{bigint:true});privateDirectory(s,this.root);this.remember(prefix,s);}catch(error){closeSync(next);throw error;}
        if(fd!==this.fd)closeSync(fd);fd=next;
      }
      return fd;
    }catch(error){if(fd!==this.fd)closeSync(fd);throw error;}
  }
  private parent(path:string):{fd:number;name:string} {
    const parts=path.split('/'),name=parts.pop()!;return {fd:this.directory(parts.join('/')),name};
  }
  private fileStat(s:BigIntStats,entry:ArchiveEntry,complete:boolean):void {
    const mode=Number(s.mode&0o7777n);
    if(!s.isFile()||s.nlink!==1n||s.uid!==BigInt(process.getuid!())||String(s.dev)!==this.root.device||![0o600,entry.mode].includes(mode)||s.size>BigInt(entry.bytes))evidence('Target file type, aliases, permissions or size differs from the plan');
    if(complete&&(s.size!==BigInt(entry.bytes)||mode!==entry.mode))evidence('A required completed file is partial or has the wrong mode');
  }
  private fileHash(fd:number,entry:ArchiveEntry):string {
    const h=createHash('sha256'),buffer=Buffer.alloc(CHUNK);let offset=0;
    while(offset<entry.bytes){
      time(this.deadline);const n=readSync(fd,buffer,0,Math.min(CHUNK,entry.bytes-offset),offset);
      if(!n)changed('Target file ended before its selected size');h.update(buffer.subarray(0,n));offset+=n;
    }
    return 'sha256:'+h.digest('hex');
  }
  private checkLink(parent:number,name:string,entry:ArchiveEntry,s:BigIntStats):void {
    if(!s.isSymbolicLink()||s.uid!==BigInt(process.getuid!())||s.nlink!==1n||String(s.dev)!==this.root.device)evidence('Target link identity differs');
    // Linux reports 0777 on symlinks; the inventory's 0700 is preparation intent.
    if(!readlinkSync(anchor(parent,name),{encoding:'buffer'}).equals(Buffer.from(entry.target!)))evidence('Retained target link text differs');
    if(stamp(lstatSync(anchor(parent,name),{bigint:true}))!==stamp(s))changed('Target link changed during observation');
    this.remember(entry.path,s);
  }
  verify(complete:boolean,completeFiles=false):ArchiveEntry[] {
    this.rootCurrent();const visited=new Set<string>(),observed:ArchiveEntry[]=[];
    const visit=(fd:number,parent:string):void=>{
      time(this.deadline);const before=fstatSync(fd,{bigint:true});privateDirectory(before,this.root);
      const dir=opendirSync(anchor(fd),{bufferSize:32});
      try{for(let child=dir.readSync();child;child=dir.readSync()){
        time(this.deadline);if(visited.size>=this.entries.length) evidence('Target contains unexpected extra nodes');
        const path=parent?parent+'/'+child.name:child.name,entry=this.byPath.get(path);
        if(!entry||visited.has(path))evidence('Target contains an unknown or repeated node');visited.add(path);
        const named=anchor(fd,child.name),s=lstatSync(named,{bigint:true});this.remember(path,s);
        if(entry.kind==='directory'){
          privateDirectory(s,this.root);const next=directoryFd(named);
          try{if(stamp(fstatSync(next,{bigint:true}))!==stamp(s))changed('Target directory changed while opening');visit(next,path);}finally{closeSync(next);}
        }else if(entry.kind==='symlink')this.checkLink(fd,child.name,entry,s);
        else{
          this.fileStat(s,entry,complete||completeFiles||this.retained.has(path));
          const input=openSync(named,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
          try{
            if(stamp(fstatSync(input,{bigint:true}))!==stamp(s))changed('Target file changed while opening');
            if(s.size===BigInt(entry.bytes)&&this.fileHash(input,entry)!==entry.digest)evidence('Completed target file bytes differ from the plan');
            if(stamp(fstatSync(input,{bigint:true}))!==stamp(s)||stamp(lstatSync(named,{bigint:true}))!==stamp(s))changed('Target file changed during verification');
          }finally{closeSync(input);}
        }
        observed.push({...entry});
      }}finally{dir.closeSync();}
      if(stamp(fstatSync(fd,{bigint:true}))!==stamp(before))changed('Target directory changed during verification');
    };
    visit(this.fd,'');
    for(const entry of this.entries)if((complete||this.retained.has(entry.path)||(completeFiles&&entry.kind!=='symlink'))&&!visited.has(entry.path))evidence('A required target entity is absent');
    this.rootCurrent();return observed.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  }
  directories():void {
    for(const entry of this.entries.filter(e=>e.kind==='directory').sort((a,b)=>a.path.split('/').length-b.path.split('/').length||(a.path<b.path?-1:1))){
      this.rootCurrent();const {fd,name}=this.parent(entry.path);
      try{
        let s=maybeStat(anchor(fd,name));
        if(!s){
          if(this.retained.has(entry.path)||this.identities.has(entry.path))changed('Previously selected directory disappeared');
          mkdirSync(anchor(fd,name),{mode:0o700});s=lstatSync(anchor(fd,name),{bigint:true});
        }
        privateDirectory(s,this.root);this.remember(entry.path,s);
        if(this.retained.has(entry.path))continue;
        const directory=directoryFd(anchor(fd,name));
        try{if(stamp(fstatSync(directory,{bigint:true}))!==stamp(s))changed('Directory changed before synchronization');fsyncSync(directory);}finally{closeSync(directory);}
        fsyncSync(fd);
      }finally{if(fd!==this.fd)closeSync(fd);}
    }
  }
  onEntry=(observed:Readonly<ArchiveEntry>):void=>{
    this.rootCurrent();const entry=this.byPath.get(observed.path);
    if(!entry||entry.kind!==observed.kind||entry.mode!==observed.mode||entry.bytes!==observed.bytes||entry.target!==observed.target||entry.derived!==observed.derived)evidence('Physical member header differs from the selected tree');
    if(entry.kind!=='file')return;
    if(this.current||this.retained.has(entry.path))evidence('Unexpected overlapping or retained file write');
    const {fd:parent,name}=this.parent(entry.path);let output:number|undefined;
    try{
      const before=maybeStat(anchor(parent,name));
      if(before){this.fileStat(before,entry,false);this.remember(entry.path,before);output=openSync(anchor(parent,name),constants.O_RDWR|constants.O_APPEND|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
      else{
        if(this.identities.has(entry.path))changed('Previously selected file disappeared');
        output=openSync(anchor(parent,name),constants.O_RDWR|constants.O_APPEND|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
        const created=fstatSync(output,{bigint:true});
        if(!created.isFile()||created.nlink!==1n||created.uid!==BigInt(process.getuid!()))evidence('New file identity changed');
        fchmodSync(output,0o600);fsyncSync(output);fsyncSync(parent);
      }
      const opened=fstatSync(output,{bigint:true});this.fileStat(opened,entry,false);
      if(before&&stamp(opened)!==stamp(before))changed('Retained file changed before append');
      if(stamp(lstatSync(anchor(parent,name),{bigint:true}))!==stamp(opened))changed('Named file differs from the held append descriptor');
      this.remember(entry.path,opened);this.current={fd:output,parent,name,entry,oldBytes:Number(opened.size),offset:0};output=undefined;
    }finally{if(output!==undefined)closeSync(output);if(!this.current&&parent!==this.fd)closeSync(parent);}
  };
  private currentFile(entry:Readonly<ArchiveEntry>):CurrentFile {
    this.rootCurrent();const current=this.current;if(!current||current.entry.path!==entry.path)evidence('File data has no selected target');
    const s=fstatSync(current.fd,{bigint:true});this.fileStat(s,current.entry,false);this.remember(entry.path,s);
    if(s.size!==BigInt(Math.max(current.oldBytes,current.offset))||stamp(lstatSync(anchor(current.parent,current.name),{bigint:true}))!==stamp(s))changed('Target append position or named identity changed');
    const again=this.parent(entry.path);
    try{if(identity(fstatSync(again.fd,{bigint:true}))!==identity(fstatSync(current.parent,{bigint:true})))changed('Target parent directory moved');}finally{if(again.fd!==this.fd)closeSync(again.fd);}
    return current;
  }
  onFileChunk=(entry:Readonly<ArchiveEntry>,chunk:Buffer,offset:number):void=>{
    if(chunk.length>CHUNK)evidence('Archive consumer chunk exceeds its fixed buffer budget');
    const current=this.currentFile(entry);
    if(offset!==current.offset||chunk.length>current.entry.bytes-offset)evidence('File stream offset differs from the selected body');
    const retained=Math.max(0,Math.min(chunk.length,current.oldBytes-offset));
    if(retained){
      const existing=Buffer.alloc(retained);let read=0;
      while(read<retained){const n=readSync(current.fd,existing,read,retained-read,offset+read);if(!n)changed('Retained file prefix ended early');read+=n;}
      if(!existing.equals(chunk.subarray(0,retained)))evidence('Retained file prefix differs; bytes were preserved');
    }
    let written=retained;
    while(written<chunk.length){
      time(this.deadline);const n=writeSync(current.fd,chunk,written,chunk.length-written,null);
      if(!n)evidence('Target append made no progress');written+=n;
    }
    current.offset+=chunk.length;
  };
  onFileEnd=(observed:Readonly<ArchiveEntry>):void=>{
    const current=this.currentFile(observed),entry=current.entry;
    if(current.offset!==entry.bytes||observed.digest!==entry.digest)evidence('Completed file body differs from the selected payload');
    const before=fstatSync(current.fd,{bigint:true});
    if(before.size!==BigInt(entry.bytes)||this.fileHash(current.fd,entry)!==entry.digest)evidence('Actual completed file bytes differ from the selected payload');
    if(stamp(fstatSync(current.fd,{bigint:true}))!==stamp(before)||stamp(lstatSync(anchor(current.parent,current.name),{bigint:true}))!==stamp(before))changed('Completed file changed before final mode');
    if(Number(before.mode&0o7777n)!==entry.mode)fchmodSync(current.fd,entry.mode);
    fsyncSync(current.fd);fsyncSync(current.parent);this.closeCurrent();
  };
  links():void {
    for(const entry of this.entries.filter(e=>e.kind==='symlink')){
      this.rootCurrent();const {fd,name}=this.parent(entry.path);
      try{
        let s=maybeStat(anchor(fd,name));
        if(!s){
          if(this.retained.has(entry.path)||this.identities.has(entry.path))changed('Previously selected link disappeared');
          symlinkSync(entry.target!,anchor(fd,name));s=lstatSync(anchor(fd,name),{bigint:true});
        }
        this.checkLink(fd,name,entry,s);if(!this.retained.has(entry.path))fsyncSync(fd);
      }finally{if(fd!==this.fd)closeSync(fd);}
    }
  }
  hooks():ArchiveReadHooks {return {onEntry:this.onEntry,onFileChunk:this.onFileChunk,onFileEnd:this.onFileEnd};}
}

/** Read-only exact target verification against a separately selected tree.
 * Missing nodes are errors: this entry does not create, append, chmod or fsync. */
export function verifyMaterializedTree(root:MaterializeRoot,entries:readonly ArchiveEntry[]):void {
  const selectedRoot=validateRoot(root),deadline=performance.now()+120000;
  if(!Array.isArray(entries)||entries.length>20000)limited('Target verification exceeds its entry budget');
  const selected=validateArchiveEntryTree(entries,20000);
  if(selected.reduce((n,e)=>n+e.bytes,0)>2*1024*1024*1024)limited('Target verification exceeds its file-byte budget');
  time(deadline);const target=new Target(selectedRoot,selected,deadline);
  try{target.verify(true);}finally{target.close();}
}

/** Resume only exact selected payload prefixes. Unknown or contradictory data
 * is retained on failure; this function does not own lifecycle/control markers. */
export async function materializeTarArchive(archivePath:string,spec:ArchiveSpec,expected:ArchiveInventory,root:MaterializeRoot):Promise<ArchiveInventory> {
  const selectedRoot=validateRoot(root),selectedSpec={...spec};inventoryInput(expected,selectedSpec);
  const expectedIdentity=hash(expected as unknown as Json),deadline=performance.now()+selectedSpec.timeoutMs;
  const selected=await inspectTarArchive(archivePath,selectedSpec);
  if(hash(selected as unknown as Json)!==expectedIdentity)evidence('Complete archive scan differs from the selected inventory');
  time(deadline);const target=new Target(selectedRoot,selected.entries,deadline);
  try{
    target.verify(false);target.directories();
    const actual=await readTarArchive(archivePath,{...selectedSpec,timeoutMs:Math.max(1,Math.floor(deadline-performance.now()))},target.hooks());
    sameInventory(actual,selected);
    // A complete readback of every file precedes the creation of any new link.
    const files=target.verify(false,true);const found=new Set(files.map(e=>e.path));
    if(selected.entries.some(e=>e.kind!=='symlink'&&!found.has(e.path)))evidence('Regular materialization is incomplete');
    target.links();const entries=target.verify(true);
    const {inventoryDigest:_old,...body}=actual,verified={...body,entries};
    const result={...verified,inventoryDigest:hash(verified as unknown as Json)};sameInventory(result,selected);return result;
  }finally{target.close();}
}

/** Materialize one exact combined tree. Retained entities must already be
 * complete and are never written; links may resolve to them inside this root. */
export async function materializeMemoryTree(root:MaterializeRoot,files:MemoryFile[],links:MemoryLink[]=[],retained:ArchiveEntry[]=[]):Promise<void> {
  const selectedRoot=validateRoot(root),deadline=performance.now()+120000;
  if(!Array.isArray(files)||!Array.isArray(links)||!Array.isArray(retained)||files.length+links.length>2000||retained.length>10000)limited('Memory tree entry budget exceeded');
  let bytes=0,retainedBytes=0;
  for(const file of files){exact(file,['path','data','mode']);if(!Buffer.isBuffer(file.data)||![0o600,0o700].includes(file.mode))fail('INVALID_INPUT','Explicit bounded memory files required');bytes+=file.data.length;if(bytes>32*1024*1024)limited('Memory payload exceeds 32 MiB');}
  for(const link of links)exact(link,['path','target']);
  const retainedTree=validateArchiveEntryTree(retained,10000),retainedPaths=new Set(retainedTree.map(e=>e.path));
  for(const entry of retainedTree){retainedBytes+=entry.bytes;if(retainedBytes>768*1024*1024)limited('Retained tree exceeds its read budget');}
  const payloads=files.map(f=>({...f,data:Buffer.from(f.data)}));
  const fresh:ArchiveEntry[]=[...payloads.map(file=>({path:file.path,kind:'file' as const,mode:file.mode,bytes:file.data.length,digest:'sha256:'+createHash('sha256').update(file.data).digest('hex'),target:null,resolvedTarget:null,derived:false})),
    ...links.map(link=>({path:link.path,kind:'symlink' as const,mode:0o700,bytes:0,digest:null,target:link.target,resolvedTarget:null,derived:false}))];
  if(fresh.some(e=>typeof e.path!=='string'||e.path.split('/').some((_p,n,parts)=>retainedPaths.has(parts.slice(0,n+1).join('/')))))evidence('New entities overlap a retained subtree');
  const entries=validateArchiveEntryTree([...retainedTree,...fresh],retainedTree.length+2000);
  if(entries.filter(e=>!retainedPaths.has(e.path)).length>2000)limited('New tree including inferred directories exceeds 2000 entries');
  time(deadline);const target=new Target(selectedRoot,entries,deadline,retainedPaths),byPath=new Map(entries.map(e=>[e.path,e]));
  try{
    target.verify(false);target.directories();
    for(const file of payloads){
      const entry=byPath.get(file.path)!;target.onEntry(entry);
      for(let offset=0;offset<file.data.length;offset+=CHUNK)target.onFileChunk(entry,file.data.subarray(offset,Math.min(file.data.length,offset+CHUNK)),offset);
      target.onFileEnd(entry);
    }
    const found=new Set(target.verify(false,true).map(e=>e.path));
    if(entries.some(e=>e.kind!=='symlink'&&!found.has(e.path)))evidence('Combined file materialization is incomplete');
    target.links();target.verify(true);
  }finally{target.close();}
}
