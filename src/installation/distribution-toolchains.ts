import {constants,openSync,closeSync,fstatSync,lstatSync,readSync,realpathSync,readlinkSync} from 'node:fs';
import type {BigIntStats} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {exact,hash,text} from '../standalone/validation.js';
import {privatePath} from '../standalone/workspace.js';
import {inventory,inspectJavaRuntime,verifyDLToolchain} from '../reasoning/toolchain.js';
import type {DLToolchain} from '../reasoning/toolchain.js';
import {verifySHACLToolchain,shaclWorkerSource} from '../native-v2/shacl-toolchain.js';
import type {SHACLToolchain} from '../native-v2/shacl-toolchain.js';
import {assertSeparate,outsideSource} from './files.js';
import {fileDigest,validateRuntimeBinding,verifyRuntime} from './runtime.js';
import type {RuntimeBinding} from './runtime.js';
import {selectedDistribution} from './distribution-catalog.js';
import {validateDistributionManifest} from './distribution-contract.js';
import type {DistributionManifest} from './distribution-contract.js';

const PACKAGE_ROOT=fileURLToPath(new URL('../../',import.meta.url));
const BUNDLES=['linux-arm64-temurin21-pbs20260211-candidate1','linux-arm64-temurin21-pbs20260211-candidate2','linux-arm64-temurin21-pbs20260211-candidate3','linux-arm64-temurin21-pbs20260211-candidate4','linux-arm64-temurin21-pbs20260211-candidate5'];
const ENGINE='hermit:1.4.5.519+evopilot.2;jfact:5.0.3;structural-alc:1',OWLAPI='owlapi-distribution:5.5.1';
const VERSION={dl:ENGINE+';'+OWLAPI,java:'Temurin 21.0.13+9',python:'CPython 3.12.12;pySHACL 0.40.1;RDFLib 7.6.0',shacl:'pySHACL adapter v2'};
const stamp=(s:BigIntStats):string=>[s.dev,s.ino,s.uid,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
function changed(message:string):never {fail('DISTRIBUTION_TOOLCHAIN_CHANGED',message,409);}
function canonical(path:unknown):asserts path is string {
  text(path,4096);
  if(!isAbsolute(path)||resolve(path)!==path||/[\\\x00-\x1f\x7f-\x9f]/u.test(path))fail('UNSAFE_PATH','Canonical absolute preparation paths required');
}
function root(path:string):BigIntStats {
  privatePath(path,true);
  if(realpathSync(path)!==path||outsideSource(path)!==path)fail('UNSAFE_PATH','Prepared tool roots must be canonical and outside source');
  const s=lstatSync(path,{bigint:true});
  if((s.mode&0o7777n)!==0o700n)fail('UNSAFE_PATH','Prepared tool roots require owner-only 0700 mode');
  return s;
}
/** Bounded descriptor read; no symlink, writable alias or path replacement is
 * allowed while inspecting the final interpreter configuration/release file. */
function readText(path:string,maximum:number):string {
  const before=lstatSync(path,{bigint:true});
  if(!before.isFile()||before.nlink!==1n||before.uid!==BigInt(process.getuid!())||(before.mode&0o6022n)!==0n||before.size<1n||before.size>BigInt(maximum))fail('UNSAFE_PATH','Bounded owned toolchain metadata without writable aliases required');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    if(stamp(fstatSync(fd,{bigint:true}))!==stamp(before))changed('Toolchain metadata changed before opening');
    const raw=Buffer.alloc(Number(before.size));let at=0;
    while(at<raw.length){const n=readSync(fd,raw,at,raw.length-at,at);if(!n)changed('Toolchain metadata ended early');at+=n;}
    if(stamp(fstatSync(fd,{bigint:true}))!==stamp(before)||stamp(lstatSync(path,{bigint:true}))!==stamp(before))changed('Toolchain metadata changed during inspection');
    try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);}
    catch{fail('TOOLCHAIN_NOT_READY','Toolchain metadata must be valid UTF-8',409);}
  }finally{closeSync(fd);}
}
function javaRelease(javaRoot:string):void {
  const fields=new Map<string,string>();
  for(const line of readText(join(javaRoot,'release'),65536).split('\n')){
    if(line==='')continue;
    const match=/^([A-Z][A-Z0-9_]*)="([^"\r\n\x00]*)"$/.exec(line);
    if(!match||fields.has(match[1]))fail('TOOLCHAIN_NOT_READY','Java release metadata is malformed or ambiguous',409);
    fields.set(match[1],match[2]);
  }
  for(const [name,value] of Object.entries({JAVA_VERSION:'21.0.13',JAVA_RUNTIME_VERSION:'21.0.13+9-LTS',IMPLEMENTOR:'Eclipse Adoptium',IMPLEMENTOR_VERSION:'Temurin-21.0.13+9',OS_NAME:'Linux',OS_ARCH:'aarch64',LIBC:'gnu',IMAGE_TYPE:'JRE'})){
    if(fields.get(name)!==value)fail('TOOLCHAIN_NOT_READY','Java release metadata differs from the selected Temurin runtime',409);
  }
}
function pythonLayout(runtimeRoot:string):string {
  const pbs=join(runtimeRoot,'python'),venv=join(runtimeRoot,'venv'),executable=join(pbs,'bin','python3.12'),python=join(venv,'bin','python3.12');
  for(const path of [pbs,join(pbs,'bin'),venv,join(venv,'bin')])root(path);
  privatePath(executable);
  if(realpathSync(executable)!==executable||(lstatSync(executable).mode&0o111)===0)fail('TOOLCHAIN_NOT_READY','Pinned ordinary PBS Python executable required',409);
  const selected=lstatSync(python,{bigint:true});
  if(!selected.isSymbolicLink()||selected.uid!==BigInt(process.getuid!())||isAbsolute(readlinkSync(python))||realpathSync(python)!==executable)fail('TOOLCHAIN_NOT_READY','Private venv entry must link to its selected PBS interpreter',409);
  const expected='home = '+pbs+'/bin\ninclude-system-site-packages = false\nversion = 3.12.12\nexecutable = '+executable+'\n';
  if(readText(join(venv,'pyvenv.cfg'),16384)!==expected)fail('TOOLCHAIN_NOT_READY','Virtual environment configuration differs from its final absolute paths',409);
  // Preserve this venv path in the manifest: realpath before spawn would lose
  // its site-packages. Resolution above is only a read-only link identity check.
  return python;
}
function packageCompatibility(runtime:RuntimeBinding,manifest:DistributionManifest):void {
  const c=manifest.compatibility;
  if(runtime.nodeVersion!==c.nodeVersion||process.versions.node!==c.nodeVersion
    ||fileDigest(join(runtime.packageRoot,'toolchains/owl2-dl/Worker.java'),2*1024*1024)!==c.workerSourceDigest
    ||fileDigest(join(runtime.packageRoot,'toolchains/owl2-dl/dependencies.json'),2*1024*1024)!==c.dependencyLockDigest
    ||fileDigest(join(runtime.packageRoot,'src/native-v2/shacl-worker.py'),1024*1024)!==c.shaclAdapterDigest
    ||fileDigest(shaclWorkerSource(),1024*1024)!==c.shaclAdapterDigest)fail('PACKAGE_TOOLCHAIN_MISMATCH','Prepared tool source and lock compatibility differs from the selected installed package',409);
}

/** Caller holds the preparation lease and has verified the sealed tar/wheel
 * inventories against the final materialized tree. This function constructs
 * executable-byte identities, not build provenance: worker.jar origin remains
 * bound by that retained plan and the product-owned dl-payload archive digest.
 * Release-file version labels are inspected without running Java or Python.
 * Loadability, ABI/resource isolation, legal review and acceptance are unproven.
 * No files, bindings, services or installation hooks are created here. */
export function buildPreparedToolchains(value:{controlRoot:string;toolRoot:string;runtime:RuntimeBinding;manifest:DistributionManifest}):{dl:DLToolchain;shacl:SHACLToolchain} {
  exact(value,['controlRoot','toolRoot','runtime','manifest']);
  if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('INVALID_INPUT','Plain preparation toolchain input required');
  canonical(value.controlRoot);canonical(value.toolRoot);validateRuntimeBinding(value.runtime);validateDistributionManifest(value.manifest);
  const {controlRoot,toolRoot,runtime,manifest}=value;
  assertSeparate(toolRoot,controlRoot);assertSeparate(toolRoot,runtime.root);assertSeparate(controlRoot,runtime.root);
  if(!BUNDLES.includes(manifest.id)||manifest.platform.os!=='linux'||manifest.platform.arch!=='arm64'||process.platform!=='linux'||process.arch!=='arm64')fail('DISTRIBUTION_PLATFORM_MISMATCH','This prepared tool recipe requires the selected Linux arm64 platform',409);
  if(realpathSync(runtime.packageRoot)!==runtime.packageRoot||runtime.packageRoot!==realpathSync(PACKAGE_ROOT))fail('DISTRIBUTION_PACKAGE_MISMATCH','Run tool preparation through the selected installed package',409);
  verifyRuntime(runtime);
  const selected=selectedDistribution(runtime.packageRoot,manifest.id);
  if(hash(selected.manifest as unknown as Json)!==hash(manifest as unknown as Json))fail('DISTRIBUTION_CATALOG_CHANGED','Selected preparation manifest differs from the product-owned catalog',409);
  for(const c of manifest.components)if(c.version!==VERSION[c.role])fail('DISTRIBUTION_RECIPE_MISMATCH','Formal component version differs from the selected preparation recipe',409);
  packageCompatibility(runtime,manifest);
  const dlRoot=join(toolRoot,'dl'),javaRoot=join(toolRoot,'java'),pythonRoot=join(toolRoot,'python'),shaclRoot=join(toolRoot,'shacl');
  const roots=[controlRoot,toolRoot,dlRoot,javaRoot,pythonRoot,shaclRoot],before=roots.map(path=>({path,stamp:stamp(root(path))}));
  javaRelease(javaRoot);const python=pythonLayout(pythonRoot);
  const dlIdentity={schema:'ontology-dl-toolchain/v1' as const,root:dlRoot,javaRoot,javaVersion:'21.0.13',platform:process.platform,arch:process.arch,engine:ENGINE,owlapi:OWLAPI,workerSourceDigest:manifest.compatibility.workerSourceDigest,dependencyLockDigest:manifest.compatibility.dependencyLockDigest,runtimeFiles:inventory(dlRoot),javaFiles:inspectJavaRuntime(javaRoot)};
  const dl:DLToolchain={...dlIdentity,digest:hash(dlIdentity as unknown as Json)};
  const shaclIdentity={schema:'ontology-shacl-toolchain/v2' as const,root:shaclRoot,runtimeRoot:pythonRoot,python,pythonVersion:'3.12.12' as const,pyshacl:'0.40.1' as const,rdflib:'7.6.0' as const,platform:process.platform,arch:process.arch,adapterDigest:manifest.compatibility.shaclAdapterDigest,runtimeFiles:inventory(pythonRoot,['python','venv'])};
  const shacl:SHACLToolchain={...shaclIdentity,digest:hash(shaclIdentity as unknown as Json)};
  verifyDLToolchain(dl);verifySHACLToolchain(shacl);
  // Recheck fixed metadata and retained package after the potentially long full
  // runtime scans, before publishing either immutable manifest to the caller.
  javaRelease(javaRoot);if(pythonLayout(pythonRoot)!==python)changed('Prepared Python entry changed');
  for(const observed of before)if(stamp(root(observed.path))!==observed.stamp)changed('Prepared root changed during toolchain inspection');
  verifyRuntime(runtime);packageCompatibility(runtime,manifest);
  if(selectedDistribution(runtime.packageRoot,manifest.id).manifestDigest!==selected.manifestDigest)fail('DISTRIBUTION_CATALOG_CHANGED','Product distribution catalog changed during toolchain inspection',409);
  return {dl,shacl};
}
