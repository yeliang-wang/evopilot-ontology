import { inflateRawSync } from 'node:zlib';
import { fail } from '../standalone/types.js';
import { digest, exact, hash, hashBytes } from '../standalone/validation.js';

export interface WheelExpectation {filename:string;digest:string;bytes:number}
export interface WheelEntry {path:string;bytes:number;digest:string;mode:0o600;data:Buffer}
export interface WheelInventory {
  schema:'ontology-wheel-inventory/v1';filename:string;digest:string;bytes:number;
  distribution:string;version:string;expandedBytes:number;entries:WheelEntry[];inventoryDigest:string;
}

const MAX_RAW=8*1024*1024,MAX_EXPANDED=16*1024*1024,MAX_ENTRIES=1000,MAX_TEXT=1024*1024;
function invalid(message:string):never {fail('DISTRIBUTION_WHEEL_INVALID',message,409);}
function limited(message:string):never {fail('DISTRIBUTION_WHEEL_LIMIT',message,413);}
function changed(message:string):never {fail('DISTRIBUTION_WHEEL_CHANGED',message,409);}
function utf8(bytes:Buffer):string {
  // Filenames and RECORD paths are byte identities: an initial U+FEFF is not a document marker.
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
  catch{invalid('Wheel text is not valid UTF-8');}
}
function pathName(value:string):void {
  const parts=value.split('/');
  if(!value||Buffer.byteLength(value)>1024||parts.length>64)invalid('Wheel path exceeds the supported path bounds');
  if(value.startsWith('/')||/^[A-Za-z]:/.test(value)||/[\\\x00-\x1f\x7f-\x9f]/u.test(value)||parts.some(p=>!p||p==='.'||p==='..'))invalid('Wheel path is not a canonical relative file path');
  if(parts.some(p=>p.toLowerCase().endsWith('.data'))||/\.(?:pth|pyc|pyo|pyd|dll|dylib|exe|com|o|obj|a|wasm)$/i.test(value)||/\.so(?:\.[^/]*)?$/i.test(value))invalid('Wheel contains an unsupported installation layout or native payload');
  if(/\.dist-info\/RECORD\.(?:jws|p7s)$/i.test(value))invalid('Wheel signatures outside the complete RECORD inventory are unsupported');
}
function nativeBytes(data:Buffer):boolean {
  if(data.length<4)return false;
  const magic=data.readUInt32BE(0);
  return magic===0x7f454c46||[0xfeedface,0xfeedfacf,0xcefaedfe,0xcffaedfe,0xcafebabe,0xbebafeca,0xcafebabf,0xbfbafeca].includes(magic)
    ||(data[0]===0x4d&&data[1]===0x5a);
}
const CRC_TABLE=Array.from({length:256},(_,value)=>{
  let n=value;for(let bit=0;bit<8;bit++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;
});
function crc32(data:Buffer):number {
  let crc=0xffffffff;for(const byte of data)crc=CRC_TABLE[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;
}
function normalizeName(value:string):string {return value.replace(/[-_.]+/g,'_').toLowerCase();}
interface Identity {distribution:string;version:string;build:string|null;tags:string[]}
function identity(filename:string):Identity {
  if(!filename.endsWith('.whl')||filename.length>255||/[\\/\x00-\x20\x7f]/.test(filename))invalid('Wheel filename must be a bounded wheel basename');
  const parts=filename.slice(0,-4).split('-');
  if(parts.length!==5&&parts.length!==6)invalid('Unsupported wheel filename fields');
  const [name,version]=parts,tail=parts.slice(-3),build=parts.length===6?parts[2]:null;
  if(!/^[A-Za-z0-9](?:[A-Za-z0-9_.]*[A-Za-z0-9])?$/.test(name)||!/^[A-Za-z0-9][A-Za-z0-9._+!]*$/.test(version)||(build!==null&&!/^[0-9][A-Za-z0-9_]*$/.test(build)))invalid('Wheel distribution, version or build identity is invalid');
  if(!['py3','py2.py3'].includes(tail[0])||tail[1]!=='none'||tail[2]!=='any')invalid('Only the selected pure Python wheel tags are supported');
  return {distribution:normalizeName(name),version,build,tags:tail[0].split('.').map(tag=>tag+'-none-any')};
}
interface ZipEntry {path:string;name:Buffer;offset:number;needed:number;flags:number;method:number;time:number;date:number;crc:number;compressed:number;bytes:number}
function zipEntries(raw:Buffer):ZipEntry[] {
  // This deliberately bounded profile has no archive/member comments, extra fields,
  // directories, data descriptors, ZIP64, SFX prefix or unindexed local records.
  if(raw.length<22)invalid('Wheel ZIP is truncated');
  const end=raw.length-22;
  if(raw.readUInt32LE(end)!==0x06054b50||raw.readUInt16LE(end+20)!==0)invalid('Wheel ZIP must end at its uncommented end record');
  const count=raw.readUInt16LE(end+10),size=raw.readUInt32LE(end+12),start=raw.readUInt32LE(end+16);
  if(raw.readUInt16LE(end+4)!==0||raw.readUInt16LE(end+6)!==0||raw.readUInt16LE(end+8)!==count)invalid('Multidisk ZIP is unsupported');
  if(count===0xffff||size===0xffffffff||start===0xffffffff)invalid('ZIP64 is unsupported');
  if(count===0)invalid('Wheel ZIP has no members');
  if(count>MAX_ENTRIES)limited('Wheel entry count exceeds its budget');
  if(start+size!==end||start>end)invalid('Wheel central directory bounds are inconsistent');
  const entries:ZipEntry[]=[],names=new Set<string>();let at=start,total=0;
  for(let i=0;i<count;i++){
    if(at+46>end||raw.readUInt32LE(at)!==0x02014b50)invalid('Wheel central directory is truncated or malformed');
    const made=raw.readUInt16LE(at+4),needed=raw.readUInt16LE(at+6),flags=raw.readUInt16LE(at+8),method=raw.readUInt16LE(at+10);
    const time=raw.readUInt16LE(at+12),date=raw.readUInt16LE(at+14),crc=raw.readUInt32LE(at+16),compressed=raw.readUInt32LE(at+20),bytes=raw.readUInt32LE(at+24);
    const nameBytes=raw.readUInt16LE(at+28),extra=raw.readUInt16LE(at+30),comment=raw.readUInt16LE(at+32),disk=raw.readUInt16LE(at+34),internal=raw.readUInt16LE(at+36),external=raw.readUInt32LE(at+38),offset=raw.readUInt32LE(at+42);
    if(![0,3].includes(made>>>8)||![10,20].includes(needed)||(flags!==0&&flags!==0x800)||![0,8].includes(method)||(method===8&&needed<20))invalid('Wheel uses unsupported ZIP version, flags or compression');
    if(extra!==0||comment!==0||disk!==0||internal!==0||![0,0x20].includes(external&0xffff))invalid('Wheel ZIP attributes or extensions are unsupported');
    if(compressed===0xffffffff||bytes===0xffffffff||offset===0xffffffff)invalid('ZIP64 is unsupported');
    if(!nameBytes||nameBytes>1024||at+46+nameBytes>end)invalid('Wheel central filename is truncated or oversized');
    const name=raw.subarray(at+46,at+46+nameBytes),path=utf8(name);pathName(path);
    const mode=external>>>16,type=mode&0o170000;
    if((type!==0&&type!==0o100000)||(mode&0o7000)!==0)invalid('Wheel members must be ordinary files without special permission bits');
    // Pinned owlrl/rdflib contain executable .py sources; installed content is
    // always 0600. No source permission or installer hook is executed/preserved.
    if((mode&0o111)!==0&&!path.endsWith('.py'))invalid('Executable non-Python wheel payload is unsupported');
    if(names.has(path))invalid('Wheel contains duplicate file paths');names.add(path);
    total+=bytes;if(total>MAX_EXPANDED)limited('Wheel expanded bytes exceed the budget');
    if(offset>=start||compressed>MAX_RAW)invalid('Wheel local member bounds are invalid');
    entries.push({path,name,offset,needed,flags,method,time,date,crc,compressed,bytes});at+=46+nameBytes;
  }
  if(at!==end)invalid('Wheel central directory contains unaccounted bytes');
  for(const entry of entries){
    const parts=entry.path.split('/');for(let i=1;i<parts.length;i++)if(names.has(parts.slice(0,i).join('/')))invalid('Wheel file conflicts with a parent directory');
  }
  let next=0;
  for(const e of [...entries].sort((a,b)=>a.offset-b.offset)){
    if(e.offset!==next||next+30>start||raw.readUInt32LE(next)!==0x04034b50)invalid('Wheel local records must exactly cover the payload region');
    if(raw.readUInt16LE(next+4)!==e.needed||raw.readUInt16LE(next+6)!==e.flags||raw.readUInt16LE(next+8)!==e.method||raw.readUInt16LE(next+10)!==e.time||raw.readUInt16LE(next+12)!==e.date||raw.readUInt32LE(next+14)!==e.crc||raw.readUInt32LE(next+18)!==e.compressed||raw.readUInt32LE(next+22)!==e.bytes)invalid('Wheel local and central metadata disagree');
    const length=raw.readUInt16LE(next+26),extra=raw.readUInt16LE(next+28),dataStart=next+30+length;
    if(extra!==0||length!==e.name.length||dataStart+e.compressed>start||!raw.subarray(next+30,dataStart).equals(e.name))invalid('Wheel local filename or data bounds disagree');
    next=dataStart+e.compressed;
  }
  if(next!==start)invalid('Wheel has hidden or trailing local payload data');
  return entries;
}
function contents(raw:Buffer,e:ZipEntry):Buffer {
  const start=e.offset+30+e.name.length,compressed=raw.subarray(start,start+e.compressed);let data:Buffer;
  if(e.method===0){if(e.compressed!==e.bytes)invalid('Stored wheel member size is inconsistent');data=Buffer.from(compressed);}
  else {
    let inflated:{buffer:Buffer;engine:{bytesWritten:number}};
    try{inflated=inflateRawSync(compressed,{maxOutputLength:Math.max(1,e.bytes),info:true}) as unknown as typeof inflated;}
    catch{invalid('Wheel deflate data is invalid or exceeds its declared expansion');}
    if(!Buffer.isBuffer(inflated.buffer)||inflated.engine.bytesWritten!==compressed.length)invalid('Wheel compressed stream contains unconsumed data');
    data=inflated.buffer;
  }
  if(data.length!==e.bytes||crc32(data)!==e.crc)invalid('Wheel member content size or CRC is inconsistent');
  if(nativeBytes(data))invalid('Wheel contains a native binary payload');
  return data;
}
function headers(data:Buffer):Map<string,string[]> {
  if(data.length>MAX_TEXT)limited('Wheel metadata text exceeds its budget');
  const text=utf8(data);if(/\r(?!\n)|\x00/.test(text))invalid('Wheel metadata contains invalid line endings or NUL');
  const result=new Map<string,string[]>();let previous:string|null=null;
  for(const line of text.split(/\r?\n/)){
    if(line==='')break;
    if(/^[ \t]/.test(line)){
      if(previous===null)invalid('Wheel metadata contains an unattached continuation');
      const values=result.get(previous)!;values[values.length-1]+=' '+line.trim();continue;
    }
    const match=/^([A-Za-z0-9][A-Za-z0-9-]*):[ \t]*(.*)$/.exec(line);
    if(!match||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(line))invalid('Wheel metadata header is malformed');
    previous=match[1].toLowerCase();const values=result.get(previous)??[];values.push(match[2].trim());result.set(previous,values);
  }
  return result;
}
function one(fields:Map<string,string[]>,name:string):string {
  const values=fields.get(name);if(!values||values.length!==1||!values[0])invalid('Wheel metadata requires a unique '+name+' header');return values[0];
}
function metadata(entries:WheelEntry[],id:Identity):string {
  const roots=new Set<string>();
  for(const e of entries){
    const parts=e.path.split('/');for(let i=0;i<parts.length;i++)if(parts[i].toLowerCase().endsWith('.dist-info')){
      if(i!==0||parts.length<2)invalid('Wheel dist-info must be a top-level directory');roots.add(parts[i]);
    }
  }
  if(roots.size!==1)invalid('Wheel must contain exactly one dist-info identity');
  const root=[...roots][0],match=/^(.+)-([^-]+)\.dist-info$/.exec(root);
  if(!match||normalizeName(match[1])!==id.distribution||match[2]!==id.version)invalid('Wheel dist-info does not match its filename');
  const byPath=new Map(entries.map(e=>[e.path,e]));
  const required=(name:string):WheelEntry=>{const e=byPath.get(root+'/'+name);if(!e)invalid('Wheel is missing required '+name);return e;};
  const m=headers(required('METADATA').data),w=headers(required('WHEEL').data);
  if(!/^[12]\.\d+$/.test(one(m,'metadata-version'))||!/[A-Za-z0-9]/.test(one(m,'name'))||normalizeName(one(m,'name'))!==id.distribution||one(m,'version')!==id.version)invalid('Wheel METADATA identity does not match its filename');
  if(one(w,'wheel-version')!=='1.0'||one(w,'root-is-purelib')!=='true')invalid('Only wheel 1.0 with Root-Is-Purelib true is supported');
  const tags=w.get('tag')??[];
  if(tags.length!==id.tags.length||new Set(tags).size!==tags.length||id.tags.some(tag=>!tags.includes(tag)))invalid('Wheel WHEEL tags do not match its purelib filename tags');
  const build=w.get('build');
  if(id.build===null?build!==undefined:!build||build.length!==1||build[0]!==id.build)invalid('Wheel build metadata does not match its filename');
  return required('RECORD').path;
}
function csv(data:Buffer):string[][] {
  if(data.length>MAX_TEXT)limited('Wheel RECORD exceeds its text budget');
  const text=utf8(data),rows:string[][]=[];let at=0;
  while(at<text.length){
    const row:string[]=[];
    for(;;){
      let value='';
      if(text[at]==='"'){
        at++;let closed=false;
        while(at<text.length){const c=text[at++];if(c==='"'){if(text[at]==='"'){value+='"';at++;}else{closed=true;break;}}else value+=c;}
        if(!closed)invalid('Wheel RECORD has an unclosed CSV field');
      }else {while(at<text.length&&text[at]!==','&&text[at]!=='\n'&&text[at]!=='\r'){if(text[at]==='"')invalid('Wheel RECORD has a misplaced CSV quote');value+=text[at++];}}
      row.push(value);if(row.length>3)invalid('Wheel RECORD must have exactly three columns');
      if(text[at]===','){at++;continue;}
      if(text[at]==='\r'){if(text[at+1]!=='\n')invalid('Wheel RECORD has an invalid line ending');at+=2;break;}
      if(text[at]==='\n'){at++;break;}
      if(at===text.length)break;
      invalid('Wheel RECORD has trailing characters after a quoted field');
    }
    if(row.length!==3)invalid('Wheel RECORD must have exactly three columns');
    rows.push(row);if(rows.length>MAX_ENTRIES)limited('Wheel RECORD row count exceeds its budget');
  }
  return rows;
}
function record(entries:WheelEntry[],recordPath:string):void {
  const byPath=new Map(entries.map(e=>[e.path,e])),seen=new Set<string>();
  for(const [path,checksum,size] of csv(byPath.get(recordPath)!.data)){
    pathName(path);const entry=byPath.get(path);
    if(!entry||seen.has(path))invalid('Wheel RECORD has an unknown or duplicate path');seen.add(path);
    if(path===recordPath){if(checksum!==''||size!=='')invalid('Wheel RECORD self row must have empty digest and size');continue;}
    const expected='sha256='+Buffer.from(entry.digest.slice(7),'hex').toString('base64url');
    if(checksum!==expected||!/^(?:0|[1-9]\d*)$/.test(size)||Number(size)!==entry.bytes)invalid('Wheel RECORD digest or size does not match its payload');
  }
  if(seen.size!==entries.length)invalid('Wheel RECORD omits one or more payload files');
}

/** Read only the selected purelib wheel profile; never extract, import or run hooks.
 * Artifact authenticity and the pinned dependency closure remain caller obligations.
 * Source permission bits are inspected but every returned file has mode 0600.
 */
export function inspectWheelArchive(raw:Buffer,expected:WheelExpectation):WheelInventory {
  exact(expected,['filename','digest','bytes']);digest(expected.digest);
  if(!Buffer.isBuffer(raw)||typeof expected.filename!=='string'||!Number.isSafeInteger(expected.bytes)||expected.bytes<1)fail('INVALID_INPUT','Wheel bytes and an exact expected identity are required');
  if(raw.length>MAX_RAW||expected.bytes>MAX_RAW)limited('Wheel archive exceeds its raw byte budget');
  if(raw.length!==expected.bytes||hashBytes(raw)!==expected.digest)changed('Wheel bytes differ from the expected artifact identity');
  const id=identity(expected.filename),entries=zipEntries(raw).map(e=>{
    const data=contents(raw,e);return {path:e.path,bytes:data.length,digest:hashBytes(data),mode:0o600 as const,data};
  }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  record(entries,metadata(entries,id));
  const meta={schema:'ontology-wheel-inventory/v1' as const,filename:expected.filename,digest:expected.digest,bytes:expected.bytes,distribution:id.distribution,version:id.version,expandedBytes:entries.reduce((n,e)=>n+e.bytes,0),entries:entries.map(({data,...entry})=>entry)};
  return {...meta,entries,inventoryDigest:hash(meta)};
}
