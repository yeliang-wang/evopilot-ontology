import {join,isAbsolute} from 'node:path';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {fileDigest} from '../installation/runtime.js';
import {outsideSource,assertSeparate} from '../installation/files.js';
import {privateRead,privatePath} from '../standalone/workspace.js';
import {exact,hash,digest} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {inventory} from '../reasoning/toolchain.js';
import {boundedJSON} from '../reasoning/request.js';
import type {RuntimeFile} from '../reasoning/toolchain.js';

export interface SHACLToolchain {
  schema:'ontology-shacl-toolchain/v2';root:string;runtimeRoot:string;python:string;pythonVersion:'3.12.12';pyshacl:'0.40.1';rdflib:'7.6.0';platform:string;arch:string;adapterDigest:string;runtimeFiles:RuntimeFile[];digest:string;
}
export const shaclWorkerSource=()=>fileURLToPath(new URL('../../src/native-v2/shacl-worker.py',import.meta.url));
export function readSHACLToolchain(file:string):SHACLToolchain {
  if(!isAbsolute(file))fail('UNSAFE_PATH','Absolute private SHACL toolchain binding required');
  const v:unknown=JSON.parse(privateRead(file,4*1024*1024));boundedJSON(v,4*1024*1024);
  exact(v,['schema','root','runtimeRoot','python','pythonVersion','pyshacl','rdflib','platform','arch','adapterDigest','runtimeFiles','digest']);
  if(v.schema!=='ontology-shacl-toolchain/v2'||v.platform!==process.platform||v.arch!==process.arch||v.pythonVersion!=='3.12.12'||v.pyshacl!=='0.40.1'||v.rdflib!=='7.6.0')fail('TOOLCHAIN_NOT_READY','Pinned Python/RDFLib/pySHACL required');
  if(typeof v.root!=='string'||typeof v.runtimeRoot!=='string'||typeof v.python!=='string')fail('TOOLCHAIN_NOT_READY','Installed runtime roots required');
  privatePath(v.root,true);privatePath(v.runtimeRoot,true);assertSeparate(v.root,v.runtimeRoot);
  for(const root of [v.root,v.runtimeRoot])if(outsideSource(root)!==root)fail('UNSAFE_PATH','Canonical installed roots required');
  // Keep the venv executable path. Resolving it before spawn drops its site-packages.
  if(v.python!==join(v.runtimeRoot,'venv','bin','python3.12')||realpathSync(v.python)!==realpathSync(join(v.runtimeRoot,'python','bin','python3.12')))fail('TOOLCHAIN_NOT_READY','Pinned private venv entry required');
  digest(v.adapterDigest);digest(v.digest);
  if(!Array.isArray(v.runtimeFiles)||!v.runtimeFiles.length||v.runtimeFiles.length>10000)fail('TOOLCHAIN_NOT_READY','Complete Python runtime inventory required');
  for(const f of v.runtimeFiles){exact(f,['path','kind','digest','mode']);digest(f.digest);if(typeof f.path!=='string'||!f.path.startsWith('python/')&&!f.path.startsWith('venv/')||f.path.split('/').some(p=>['','..','.'].includes(p))||!['file','link'].includes(f.kind as string)||!Number.isInteger(f.mode))fail('TOOLCHAIN_NOT_READY','Invalid Python runtime inventory');}
  const {digest:bound,...identity}=v;if(hash(identity)!==bound)fail('TOOLCHAIN_DRIFT','SHACL toolchain identity differs');
  if(v.adapterDigest!==fileDigest(shaclWorkerSource(),1024*1024))fail('TOOLCHAIN_DRIFT','Installed adapter differs from this package source');
  return v as unknown as SHACLToolchain;
}
export function verifySHACLToolchain(v:SHACLToolchain):void {
  const actual=inventory(v.runtimeRoot,['python','venv']);
  const files=new Set(actual.filter(f=>f.kind==='file').map(f=>join(v.runtimeRoot,f.path)));
  if(actual.some(f=>f.kind==='link'&&!files.has(realpathSync(join(v.runtimeRoot,f.path)))))fail('TOOLCHAIN_DRIFT','Python runtime link target is not an inventoried file',409);
  if(hash(actual as unknown as Json)!==hash(v.runtimeFiles as unknown as Json)||fileDigest(join(v.root,'worker.py'),1024*1024)!==v.adapterDigest)fail('TOOLCHAIN_DRIFT','Python or SHACL worker bytes changed',409);
}
