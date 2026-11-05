// Acceptance-only equivalence checks for a fresh published installation.
// Installation digests include npm metadata and absolute native paths. Verify
// those new identities independently while keeping executable bytes fixed.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,lstatSync,readlinkSync,realpathSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {hashBytes} from '../../../scripts/standards-gate.mjs';
import {hash} from '../../../dist/standalone/validation.js';
import {fileDigest} from '../../../dist/installation/runtime.js';

const npmMetadata=new Set(['package.json','package-lock.json','node_modules/.package-lock.json']);
function normalizedNpmMetadata(path,bytes){
  const value=JSON.parse(bytes),normalizeDependency=object=>{
    if(!object?.dependencies)return;
    const ref=object.dependencies['@evopilot-next/ontology'];
    if(ref!==undefined){assert.match(ref,/^file:.*\bevopilot-next-ontology-0\.9\.0\.tgz$/);object.dependencies['@evopilot-next/ontology']='file:<accepted-archive>';}
  };
  if(path==='package.json')normalizeDependency(value);
  else{
    assert.equal(value.lockfileVersion,3);assert.equal(typeof value.name,'string');value.name='<installation-name>';
    normalizeDependency(value.packages?.['']);
    const own=value.packages?.['node_modules/@evopilot-next/ontology'];assert(own);assert.equal(own.version,'0.9.0');assert.match(own.resolved,/^file:.*\bevopilot-next-ontology-0\.9\.0\.tgz$/);own.resolved='file:<accepted-archive>';
  }
  return value;
}
function runtimeInventory(root){
  assert(isAbsolute(root));assert.equal(realpathSync(root),root);const result=[];
  const walk=path=>{for(const name of readdirSync(path).sort()){
    const p=join(path,name),s=lstatSync(p),local=relative(root,p);assert(result.length<20000);
    if(s.isDirectory()){walk(p);continue;}
    if(s.isSymbolicLink()){assert(local.startsWith('node_modules/.bin/'));const target=relative(root,realpathSync(p));assert(!target.startsWith('..')&&!isAbsolute(target));result.push({path:local,kind:'link',mode:s.mode&0o777,digest:hash(readlinkSync(p))});}
    else{assert(s.isFile()&&s.nlink===1);result.push({path:local,kind:'file',mode:s.mode&0o777,digest:fileDigest(p)});}
  }};walk(root);return result.sort((a,b)=>a.path.localeCompare(b.path));
}
export function verifyRuntimePayload(referenceRoot,installedRoot){
  assert.notEqual(referenceRoot,installedRoot);const reference=runtimeInventory(referenceRoot),actual=runtimeInventory(installedRoot),differences=[];
  assert.deepEqual(actual.map(({digest,...v})=>v),reference.map(({digest,...v})=>v),'Fresh installation file inventory differs');
  for(let n=0;n<actual.length;n++)if(actual[n].digest!==reference[n].digest){
    const path=actual[n].path;assert(npmMetadata.has(path),'Executable or dependency bytes changed: '+path);
    assert.deepEqual(normalizedNpmMetadata(path,readFileSync(join(installedRoot,path))),normalizedNpmMetadata(path,readFileSync(join(referenceRoot,path))),'npm dependency lock differs');differences.push(path);
  }
  return {files:actual.length,referenceInventoryDigest:hash(reference),installedInventoryDigest:hash(actual),metadataPathDifferences:differences};
}
export function verifyRelocatedPython(reference,actual){
  const omit=v=>Object.fromEntries(Object.entries(v).filter(([k])=>!['root','runtimeRoot','python','runtimeFiles','digest'].includes(k)));
  assert.deepEqual(omit(actual),omit(reference));assert.equal(actual.python,join(actual.runtimeRoot,'venv/bin/python3.12'));
  assert.deepEqual(actual.runtimeFiles.map(({digest,...v})=>v),reference.runtimeFiles.map(({digest,...v})=>v));const relocated=[];
  for(let n=0;n<actual.runtimeFiles.length;n++){
    const a=actual.runtimeFiles[n],r=reference.runtimeFiles[n];if(a.digest===r.digest)continue;
    assert(a.path==='venv/pyvenv.cfg'||a.path.startsWith('venv/bin/'),'Native bytes changed outside generated venv paths: '+a.path);
    const bytes=(root,item)=>{const p=join(root,item.path);if(item.kind==='link'){const value=readlinkSync(p);assert.equal(hash(value),item.digest);return Buffer.from(value);}const stat=lstatSync(p);assert(stat.isFile()&&stat.size<=1024*1024);const value=readFileSync(p);assert.equal(hashBytes(value),item.digest);return value;};
    const before=bytes(reference.runtimeRoot,r),after=bytes(actual.runtimeRoot,a),text=after.toString('utf8');assert.deepEqual(Buffer.from(text),after);assert(!text.includes('\0'));assert(text.includes(actual.runtimeRoot));
    assert.deepEqual(Buffer.from(text.split(actual.runtimeRoot).join(reference.runtimeRoot)),before,'Only the exact Python installation root may differ');relocated.push(a.path);
  }
  return relocated;
}
export function verifyPublishedInstallation(c){
  const daily=c.support('daily-current-installation');assert.equal(daily.schema,'ontology-private-current-installation/v1');assert.equal(daily.candidateDigest,c.admission.bindings.candidateDigest);assert(isAbsolute(daily.runtimeRoot)&&isAbsolute(daily.installation));
  const payload=verifyRuntimePayload(c.config.runtimeRoot,daily.runtimeRoot),runtime=c.ok(['runtime-inspect','--runtime-root',daily.runtimeRoot]);
  assert.equal(runtime.version,'0.9.0');assert.equal(runtime.nodeDigest,c.toolchains.runtime.nodeDigest);assert.equal(runtime.nodeVersion,c.toolchains.runtime.nodeVersion);
  const verified=c.ok(['toolchains-inspect','--installation',daily.installation]);assert.equal(verified.status,'VERIFIED');assert.equal(verified.binding.runtimeDigest,runtime.digest);assert.equal(verified.binding.serviceId,daily.serviceId);assert.equal(verified.binding.systemd.digest,c.config.systemdDigest);
  const dl=JSON.parse(readFileSync(verified.binding.dl.toolchainFile)),shacl=JSON.parse(readFileSync(verified.binding.shacl.toolchainFile));
  for(const [value,selection] of [[dl,verified.binding.dl],[shacl,verified.binding.shacl]]){const {digest,...identity}=value;assert.equal(hash(identity),digest);assert.equal(digest,selection.toolchainDigest);}
  const stripDL=v=>Object.fromEntries(Object.entries(v).filter(([k])=>!['root','javaRoot','digest'].includes(k)));assert.deepEqual(stripDL(dl),stripDL(c.toolchains.dl));
  const relocatedPythonPaths=verifyRelocatedPython(c.toolchains.shacl,shacl);
  c.observe({kind:'FRESH_PUBLISHED_INSTALLATION_VERIFIED',candidateDigest:daily.candidateDigest,runtime,verified,payload,relocatedPythonPaths,onlyPermittedDifferences:'npm archive/name metadata and generated Python venv installation-root references'});
  return {runtimeRoot:runtime.root,runtimeDigest:runtime.digest,node:c.config.node,dl:{path:verified.binding.dl.toolchainFile,digest:dl.digest},shacl:{path:verified.binding.shacl.toolchainFile,digest:shacl.digest},systemdDigest:verified.binding.systemd.digest};
}
