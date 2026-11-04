import {constants,openSync,closeSync,readSync,fstatSync,lstatSync,readdirSync,realpathSync,statfsSync} from 'node:fs';
import type {BigIntStats} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {outsideSource,assertSeparate} from './files.js';
import {privatePath} from '../standalone/workspace.js';
import {hash,digest} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {inspectRuntime,fileDigest} from './runtime.js';
import type {RuntimeBinding} from './runtime.js';
import {selectedDistribution} from './distribution-catalog.js';
import {validateDistributionInput,validateDistributionManifest} from './distribution-contract.js';
import type {DistributionInput,DistributionManifest} from './distribution-contract.js';

const PACKAGE_ROOT=fileURLToPath(new URL('../../',import.meta.url));
const stamp=(s:BigIntStats)=>[s.dev,s.ino,s.uid,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
const anchor=(s:BigIntStats)=>({device:String(s.dev),inode:String(s.ino),uid:String(s.uid),mode:Number(s.mode&0o777n)});
function present(path:string):boolean {try{lstatSync(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
function regular(path:string,maximum:number):BigIntStats {
  const s=lstatSync(path,{bigint:true});
  if(!s.isFile()||s.nlink!==1n||s.uid!==BigInt(process.getuid!())||(s.mode&0o022n)!==0n||s.size>BigInt(maximum))fail('DISTRIBUTION_UNSAFE_ARTIFACT','Owned regular artifact without writable aliases required',409);
  return s;
}
function observedDigest(path:string,bytes:number,deadline:number):{digest:string;stamp:string} {
  const before=regular(path,bytes);if(before.size!==BigInt(bytes))fail('DISTRIBUTION_ARTIFACT_CHANGED','Artifact size differs from the selected distribution',409);
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const s=fstatSync(fd,{bigint:true});if(stamp(s)!==stamp(before))fail('DISTRIBUTION_INSPECTION_CHANGED','Artifact changed before its descriptor was opened',409);
    const hash=createHash('sha256'),buffer=Buffer.alloc(65536);let offset=0;
    while(offset<bytes){
      if(performance.now()>deadline)fail('DISTRIBUTION_INSPECTION_TIMEOUT','Distribution inspection exceeded its read budget',503);
      const count=readSync(fd,buffer,0,Math.min(buffer.length,bytes-offset),offset);
      if(!count)fail('DISTRIBUTION_INSPECTION_CHANGED','Artifact ended before its declared size',409);
      hash.update(buffer.subarray(0,count));offset+=count;
    }
    if(stamp(fstatSync(fd,{bigint:true}))!==stamp(s)||stamp(lstatSync(path,{bigint:true}))!==stamp(s))fail('DISTRIBUTION_INSPECTION_CHANGED','Artifact changed during inspection',409);
    return {digest:'sha256:'+hash.digest('hex'),stamp:stamp(s)};
  }finally{closeSync(fd);}
}

/** Internal composition seam for deterministic filesystem tests. The public
 * entry verifies the executing package and selects its compiled catalog first.
 * A report is an observation only; no record here authorizes later writes. */
export function inspectDistributionFiles(input:DistributionInput,manifest:DistributionManifest,manifestDigest:string,runtime:RuntimeBinding):Json {
  validateDistributionInput(input);validateDistributionManifest(manifest);digest(manifestDigest);
  if(input.bundleId!==manifest.id||runtime.root!==input.runtimeRoot||runtime.digest!==input.runtimeDigest)fail('DISTRIBUTION_SELECTION_CHANGED','Distribution or runtime selection differs',409);
  privatePath(input.bundleRoot,true);
  if(outsideSource(input.bundleRoot)!==input.bundleRoot)fail('UNSAFE_PATH','Canonical private distribution directory required');
  const roots=[input.bundleRoot,input.runtimeRoot,input.toolRoot,input.installationRoot,input.workspaceRoot];
  for(let a=0;a<roots.length;a++)for(let b=a+1;b<roots.length;b++)assertSeparate(roots[a],roots[b]);
  const planned=[input.toolRoot,input.installationRoot,input.workspaceRoot].map(path=>{
    const parent=dirname(path);privatePath(parent,true);
    if(outsideSource(parent)!==parent||realpathSync(parent)!==parent)fail('UNSAFE_PATH','Canonical private destination parent required');
    const exists=present(path);
    if(exists&&(lstatSync(path).isSymbolicLink()||!lstatSync(path).isDirectory()||realpathSync(path)!==path))fail('UNSAFE_PATH','Existing selected owner roots must be regular canonical directories');
    const s=lstatSync(parent,{bigint:true});return {path,parent,exists,anchor:anchor(s),stamp:stamp(s)};
  });
  const bundleBefore=lstatSync(input.bundleRoot,{bigint:true}),names=readdirSync(input.bundleRoot).sort(),expected=manifest.artifacts.map(a=>a.filename).sort();
  if(JSON.stringify(names)!==JSON.stringify(expected))fail('DISTRIBUTION_CONTENT_MISMATCH','Bundle has missing or unrecognized artifacts',409);
  const observations:{id:string;bytes:number;digest:string;stamp:string}[]=[],deadline=performance.now()+30000;
  for(const artifact of manifest.artifacts){
    const observed=observedDigest(join(input.bundleRoot,artifact.filename),artifact.bytes,deadline);
    if(observed.digest!==artifact.digest)fail('DISTRIBUTION_ARTIFACT_CHANGED','Artifact bytes differ from the product-owned distribution',409);
    observations.push({id:artifact.id,bytes:artifact.bytes,...observed});
  }
  const compatibility=manifest.compatibility,packageChecks={
    nodeVersion:runtime.nodeVersion===compatibility.nodeVersion,
    workerSource:fileDigest(join(runtime.packageRoot,'toolchains/owl2-dl/Worker.java'),2*1024*1024)===compatibility.workerSourceDigest,
    dependencyLock:fileDigest(join(runtime.packageRoot,'toolchains/owl2-dl/dependencies.json'),2*1024*1024)===compatibility.dependencyLockDigest,
    shaclAdapter:fileDigest(join(runtime.packageRoot,'src/native-v2/shacl-worker.py'),1024*1024)===compatibility.shaclAdapterDigest,
  };
  const platformMatches=process.platform===manifest.platform.os&&process.arch===manifest.platform.arch;
  const fs=statfsSync(dirname(input.toolRoot),{bigint:true}),declaredBytes=manifest.components.reduce((n,c)=>n+c.declaredExpandedBytes,0),entries=manifest.components.reduce((n,c)=>n+c.declaredEntries,0);
  // Conservative payload + staging, filesystem rounding and control allowance.
  // Acquisition, existing generations and separately selected Node are excluded.
  const needed=2n*BigInt(declaredBytes)+BigInt(entries)*fs.bsize+16n*1024n*1024n,available=fs.bavail*fs.bsize;
  const neededInodes=2n*BigInt(entries)+64n,inodesObserved=fs.files>0n&&fs.ffree>=0n;
  const blockers:string[]=[];
  if(!platformMatches)blockers.push('EXECUTION_PLATFORM_MISMATCH');
  if(!Object.values(packageChecks).every(Boolean))blockers.push('PACKAGE_TOOLCHAIN_MISMATCH');
  if(planned[0].exists)blockers.push('TOOL_DESTINATION_EXISTS');
  if(fs.bsize<=0n||fs.bavail<0n||available<needed)blockers.push('INSUFFICIENT_OR_UNKNOWN_CAPACITY');
  if(inodesObserved&&fs.ffree<neededInodes)blockers.push('INSUFFICIENT_INODES');
  for(let n=0;n<manifest.artifacts.length;n++)if(stamp(regular(join(input.bundleRoot,manifest.artifacts[n].filename),manifest.artifacts[n].bytes))!==observations[n].stamp)fail('DISTRIBUTION_INSPECTION_CHANGED','An earlier artifact changed before inspection completed',409);
  if(stamp(lstatSync(input.bundleRoot,{bigint:true}))!==stamp(bundleBefore)||JSON.stringify(readdirSync(input.bundleRoot).sort())!==JSON.stringify(names))fail('DISTRIBUTION_INSPECTION_CHANGED','Distribution directory changed during inspection',409);
  for(const item of planned)if(stamp(lstatSync(item.parent,{bigint:true}))!==item.stamp||present(item.path)!==item.exists)fail('DISTRIBUTION_INSPECTION_CHANGED','Destination observation changed during inspection',409);
  const report={
    schema:'ontology-distribution-preparation-report/v1',status:blockers.length?'BLOCKED':'PLAN_VERIFIED',bundleId:manifest.id,manifestDigest,
    runtimeDigest:runtime.digest,nodeDigest:runtime.nodeDigest,platform:{selected:manifest.platform,observed:{os:process.platform,arch:process.arch},matches:platformMatches,abiVerified:false},packageChecks,
    artifacts:observations.map(({stamp:_stamp,...v})=>v),artifactBytes:observations.reduce((n,a)=>n+a.bytes,0),artifactBytesVerified:true,expandedInventoryObserved:false,
    proposedRoots:manifest.components.map(c=>({role:c.role,root:join(input.toolRoot,c.role),preparation:c.preparation})),destinations:planned.map(({stamp:_stamp,...v})=>v),
    storage:{declaredExpandedBytes:declaredBytes,declaredEntries:entries,blockBytes:String(fs.bsize),availableBytes:String(available),estimatedAdditionalBytes:String(needed),controlAllowanceBytes:16*1024*1024,inodeCapacityObserved:inodesObserved,freeInodes:inodesObserved?String(fs.ffree):null,estimatedAdditionalInodes:String(neededInodes),inodeCapacitySufficient:inodesObserved?fs.ffree>=neededInodes:null,estimateOnly:true,excludes:['Node and product runtime','existing generations','download storage','source and notice archival storage']},
    blockers,finalPathPreparationRequired:true,relocationVerified:false,loadabilityVerified:false,resourceBackendVerified:false,filesWritten:false,toolsBound:false,executorsExecuted:false,serviceStarted:false,hostConnected:false,legalReview:'NOT_EVALUATED',productAcceptance:'NOT_EVALUATED',authority:false,
    limitations:manifest.limitations,observedAt:new Date().toISOString(),
  };
  return {report:report as unknown as Json,reportDigest:hash(report as unknown as Json),authority:false};
}

export function inspectDistribution(value:unknown):Json {
  validateDistributionInput(value);
  const packageRoot=realpathSync(PACKAGE_ROOT),runtime=inspectRuntime(value.runtimeRoot);
  if(runtime.packageRoot!==packageRoot||runtime.digest!==value.runtimeDigest)fail('DISTRIBUTION_PACKAGE_MISMATCH','Run inspection through the exact selected installed product package',409);
  const selected=selectedDistribution(packageRoot,value.bundleId);
  const result=inspectDistributionFiles(value,selected.manifest,selected.manifestDigest,runtime);
  if(hash({...inspectRuntime(value.runtimeRoot)})!==hash({...runtime}))fail('DISTRIBUTION_INSPECTION_CHANGED','Selected product runtime changed during inspection',409);
  if(selectedDistribution(packageRoot,value.bundleId).manifestDigest!==selected.manifestDigest)fail('DISTRIBUTION_CATALOG_CHANGED','Selected product catalog changed during inspection',409);
  return result;
}
