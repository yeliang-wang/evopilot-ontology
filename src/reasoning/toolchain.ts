import {readFileSync,readdirSync,lstatSync,realpathSync,readlinkSync} from 'node:fs';
import {isAbsolute,join,relative,sep} from 'node:path';
import {fileDigest} from '../installation/runtime.js';
import {privatePath,privateRead} from '../standalone/workspace.js';
import {outsideSource} from '../installation/files.js';
import {exact,digest,hash} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {boundedJSON} from './request.js';

export interface RuntimeFile {path:string;kind:'file'|'link';digest:string;mode:number;}
export interface DLToolchain {schema:'ontology-dl-toolchain/v1';root:string;javaRoot:string;javaVersion:string;platform:string;arch:string;engine:string;owlapi:string;workerSourceDigest:string;dependencyLockDigest:string;runtimeFiles:RuntimeFile[];javaFiles:RuntimeFile[];digest:string;}
/** Only runtime-relevant JDK paths are admitted; compiler/documentation are not executed by the worker. */
export function inspectJavaRuntime(root:string):RuntimeFile[]{
  if(!isAbsolute(root)||realpathSync(root)!==root)fail('UNSAFE_PATH','Canonical Java runtime root required');
  return inventory(root,['bin/java','lib','conf','release']);
}
export function inventory(root:string,paths:string[]=['worker.jar','dependencies','engine-source']):RuntimeFile[]{
  const result:RuntimeFile[]=[];let bytes=0,count=0;
  const visit=(relativePath:string):void=>{
    if(++count>10000)fail('TOOLCHAIN_LIMIT','Toolchain file-count budget exceeded');
    const path=join(root,relativePath),s=lstatSync(path);
    if(s.isDirectory()){for(const name of readdirSync(path).sort())visit(relativePath+'/'+name);return;}
    if(s.isSymbolicLink()){
      const target=realpathSync(path),r=relative(root,target);if(r.startsWith('..')||isAbsolute(r))fail('UNSAFE_PATH','Java runtime symlink escapes its identity');
      result.push({path:relativePath,kind:'link',digest:hash(readlinkSync(path)),mode:s.mode&0o777});return;
    }
    if(!s.isFile()||s.nlink!==1)fail('UNSAFE_PATH','Regular unlinked toolchain files required');
    bytes+=s.size;if(bytes>768*1024*1024)fail('TOOLCHAIN_LIMIT','Toolchain byte budget exceeded');
    result.push({path:relativePath,kind:'file',digest:fileDigest(path,512*1024*1024),mode:s.mode&0o777});
  };for(const path of paths)visit(path);return result.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
export function readDLToolchain(file:string):DLToolchain {
  if(!isAbsolute(file))fail('UNSAFE_PATH','Absolute private toolchain binding required');
  const value:unknown=JSON.parse(privateRead(file,2*1024*1024));boundedJSON(value,2*1024*1024);
  exact(value,['schema','root','javaRoot','javaVersion','platform','arch','engine','owlapi','workerSourceDigest','dependencyLockDigest','runtimeFiles','javaFiles','digest']);
  if(value.schema!=='ontology-dl-toolchain/v1'||value.platform!==process.platform||value.arch!==process.arch||typeof value.root!=='string'||typeof value.javaRoot!=='string'||typeof value.javaVersion!=='string'||!value.javaVersion.startsWith('21.'))fail('TOOLCHAIN_NOT_READY','Bound Java 21 platform runtime required');
  privatePath(value.root,true);if(outsideSource(value.root)!==value.root||realpathSync(value.javaRoot)!==value.javaRoot)fail('UNSAFE_PATH','Canonical installed toolchain roots required');
  if(value.engine!=='hermit:1.4.5.519+evopilot.1;jfact:5.0.3;structural-alc:1'||value.owlapi!=='owlapi-distribution:5.5.1')fail('TOOLCHAIN_NOT_READY','Unknown formal engine binding');
  for(const field of ['workerSourceDigest','dependencyLockDigest','digest'])digest(value[field]);
  if(!Array.isArray(value.runtimeFiles)||!Array.isArray(value.javaFiles)||!value.runtimeFiles.length||!value.javaFiles.length)fail('TOOLCHAIN_NOT_READY','Complete executable closure required');
  for(const f of [...value.runtimeFiles,...value.javaFiles]){exact(f,['path','kind','digest','mode']);digest(f.digest);if(typeof f.path!=='string'||isAbsolute(f.path)||f.path.split(/[\\/]/).some(p=>['','..','.'].includes(p))||!['file','link'].includes(f.kind as string)||!Number.isInteger(f.mode))fail('TOOLCHAIN_NOT_READY','Invalid toolchain file binding');}
  const {digest:bound,...identity}=value;
  if(hash(identity)!==bound)fail('TOOLCHAIN_DRIFT','Toolchain binding digest differs');
  return value as unknown as DLToolchain;
}
export function verifyDLToolchain(binding:DLToolchain):void {
  const actual={...binding,runtimeFiles:inventory(binding.root),javaFiles:inspectJavaRuntime(binding.javaRoot)};
  if(hash(actual as unknown as Json)!==hash(binding as unknown as Json))fail('TOOLCHAIN_DRIFT','Installed reasoner/JDK bytes changed; no execution',409);
}
export function javaClasspath(binding:DLToolchain):string {
  return [join(binding.root,'worker.jar'),...binding.runtimeFiles.filter(f=>f.kind==='file'&&f.path.startsWith('dependencies/')&&f.path.endsWith('.jar')).map(f=>join(binding.root,f.path))].join(sep==='\\'?';':':');
}
