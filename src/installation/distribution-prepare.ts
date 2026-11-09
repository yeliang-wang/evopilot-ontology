import {constants,openSync,closeSync,fstatSync,lstatSync,mkdirSync,readdirSync,readFileSync,readSync,realpathSync,statfsSync,renameSync,fsyncSync} from 'node:fs';
import {createHash} from 'node:crypto';
import type {BigIntStats} from 'node:fs';
import {dirname,basename,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {exact,object,hashBytes} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {outsideSource} from './files.js';
import {privatePath} from '../standalone/workspace.js';
import {inspectRuntime} from './runtime.js';
import {selectedDistribution} from './distribution-catalog.js';
import type {DistributionManifest} from './distribution-contract.js';
import {inspectDistributionInventory} from './distribution-inventory.js';
import type {PayloadArchiveInventory} from './distribution-inventory.js';
import {readTarArchive} from './distribution-archive.js';
import type {ArchiveSpec,ArchiveEntry} from './distribution-archive.js';
import {inspectWheelArchive} from './distribution-zip.js';
import type {WheelInventory} from './distribution-zip.js';
import {materializeTarArchive,materializeMemoryTree,verifyMaterializedTree} from './distribution-materialize.js';
import type {MaterializeRoot} from './distribution-materialize.js';
import {buildPreparedToolchains} from './distribution-toolchains.js';
import {preparationFilePresent,preparationNode,assertPreparationNode,readPreparationJSON,writePreparationJSON,withPreparationLock,reservePreparationSpace,selectPreparationDirection,syncPreparationDirectory} from './distribution-prepare-files.js';
import type {PreparationNode} from './distribution-prepare-files.js';
import {PREPARATION_LIMITS,preparationHash,validateDistributionPrepareInput,validatePreparationOwner,validatePreparationPlan,validatePreparationNode} from './distribution-prepare-contract.js';
import type {DistributionPrepareInput,DistributionPreparationOwner,DistributionPreparationPlan,WheelMetadata} from './distribution-prepare-contract.js';

const PACKAGE_ROOT=fileURLToPath(new URL('../../',import.meta.url));
const MARKER='.ontology-preparation-owner.json';
const RECORDS=['owner.json','inspection.json','plan.json','abort-ready.json','admission.json','tool-owner.json','component-owners.json','materialized.json','dl-toolchain.json','shacl-toolchain.json','verified.json','prepared.json','aborted.json'];
const NAMES=new Set([...RECORDS,...RECORDS.map(n=>n+'.pending'),'operator.sqlite','operator.sqlite-journal','completion.reserve','completion.reserve.pending','prepared.reserve','abort.reserve']);
function evidence(message:string):never {fail('DISTRIBUTION_PREPARATION_EVIDENCE',message,409);}
const fileStamp=(s:BigIntStats)=>[s.dev,s.ino,s.uid,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
function boundedFile(path:string,maximum:number,privateOnly=false):Buffer {
  const before=lstatSync(path,{bigint:true});
  if(!before.isFile()||before.nlink!==1n||before.uid!==BigInt(process.getuid!())||(before.mode&BigInt(privateOnly?0o077:0o022))!==0n||before.size>BigInt(maximum))evidence('Bounded owned regular preparation input required');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const held=fstatSync(fd,{bigint:true});if(fileStamp(held)!==fileStamp(before))evidence('Preparation input changed before open');
    const bytes=Buffer.alloc(Number(held.size));let offset=0;
    while(offset<bytes.length){const n=readSync(fd,bytes,offset,bytes.length-offset,offset);if(!n)evidence('Preparation input ended early');offset+=n;}
    if(fileStamp(fstatSync(fd,{bigint:true}))!==fileStamp(held)||fileStamp(lstatSync(path,{bigint:true}))!==fileStamp(held))evidence('Preparation input changed during read');return bytes;
  }finally{closeSync(fd);}
}
function platform():void {
  const header=(process.report.getReport() as unknown as {header:{glibcVersionRuntime?:string}}).header;
  const version=header.glibcVersionRuntime?.split('.').map(Number);
  if(process.platform!=='linux'||process.arch!=='arm64'||!version||version.length<2||!version.every(Number.isSafeInteger)||version[0]<2||version[0]===2&&version[1]<28)fail('DISTRIBUTION_PREPARATION_UNSUPPORTED','This preparation recipe requires Linux ARM64 with glibc 2.28 or newer',409);
}
function privateDirectory(path:string):PreparationNode {
  privatePath(path,true);
  if(outsideSource(path)!==path||realpathSync(path)!==path)evidence('Canonical private preparation directory required');
  const node=preparationNode(path);if(node.mode!==0o700)evidence('Preparation directories require mode 0700');return node;
}
function rootIdentity(path:string):MaterializeRoot {const n=privateDirectory(path);return {path,device:n.device,inode:n.inode};}
function names(root:string):string[] {
  const result=readdirSync(root).sort();let bytes=0;
  if(result.length>NAMES.size)evidence('Preparation control has excessive entries');
  for(const name of result){
    if(!NAMES.has(name))evidence('Unselected preparation control material was preserved');
    privatePath(join(root,name));bytes+=lstatSync(join(root,name)).size;
  }
  if(RECORDS.some(n=>result.includes(n)&&result.includes(n+'.pending'))||result.includes('completion.reserve')&&result.includes('completion.reserve.pending'))evidence('Complete and pending preparation records coexist');
  if(bytes>PREPARATION_LIMITS.controlBytes)fail('DISTRIBUTION_PREPARATION_LIMIT','Preparation control exceeds its aggregate budget',413);
  return result;
}
function write(owner:DistributionPreparationOwner,name:string,value:unknown):void {
  if(!RECORDS.includes(name))evidence('Unknown preparation record');
  writePreparationJSON(join(owner.input.controlRoot,name),value,PREPARATION_LIMITS.recordBytes,owner.node);
}
function readOwner(input:DistributionPrepareInput):DistributionPreparationOwner {
  const root=input.controlRoot;privateDirectory(root);names(root);
  if(!preparationFilePresent(join(root,'owner.json')))fail('DISTRIBUTION_PREPARATION_UNOWNED','No complete preparation owner exists; preserve this directory and select a new control root',409);
  const owner=readPreparationJSON(join(root,'owner.json'));validatePreparationOwner(owner,input);
  assertPreparationNode(root,owner.node);assertPreparationNode(dirname(root),owner.parent);return owner;
}
function ownedPlan(owner:DistributionPreparationOwner):DistributionPreparationPlan {
  const plan=readPreparationJSON(join(owner.input.controlRoot,'plan.json'));validatePreparationPlan(plan,owner.input);
  if(preparationHash(plan)!==owner.planDigest)evidence('Retained preparation plan differs from its owner');return plan;
}
function reserveIdentity(owner:DistributionPreparationOwner):Json {
  return {schema:'ontology-distribution-preparation-reserve/v1',inputDigest:owner.inputDigest,planDigest:owner.planDigest,controlNode:owner.node as unknown as Json};
}
function admission(owner:DistributionPreparationOwner):Json {
  return {schema:'ontology-distribution-preparation-admission/v1',inputDigest:owner.inputDigest,planDigest:owner.planDigest,inspectionDigest:owner.input.inspectionDigest,ownerDigest:preparationHash(owner),reserveBytes:PREPARATION_LIMITS.reserveBytes,authority:false};
}
function abortedReceipt(owner:DistributionPreparationOwner):Json {
  return {schema:'ontology-distribution-preparation-aborted/v1',requestId:owner.input.requestId,inputDigest:owner.inputDigest,planDigest:owner.planDigest,inspectionDigest:owner.input.inspectionDigest,toolRoot:owner.input.distribution.toolRoot,partialMaterialsRetained:true,toolsBound:false,serviceStarted:false,authority:false};
}
function envelope(value:unknown,expectedDigest:string):{report:Record<string,unknown>;reportDigest:string;authority:false} {
  object(value);
  if('ok' in value){exact(value,['ok','result']);if(value.ok!==true)evidence('A successful retained inspection is required');value=value.result;}
  exact(value,['report','reportDigest','authority']);object(value.report);
  if(value.authority!==false||value.reportDigest!==expectedDigest||preparationHash(value.report)!==expectedDigest||!['ontology-distribution-preparation-report/v1','ontology-distribution-inventory-report/v1'].includes(value.report.schema as string))evidence('Original inspection identity differs');
  return value as {report:Record<string,unknown>;reportDigest:string;authority:false};
}
function stableObservation(report:Record<string,unknown>):unknown {
  if(!Array.isArray(report.destinations))evidence('Inspection destinations are missing');
  return {bundleId:report.bundleId,manifestDigest:report.manifestDigest,runtimeDigest:report.runtimeDigest,nodeDigest:report.nodeDigest,artifacts:report.artifacts,proposedRoots:report.proposedRoots,destinations:report.destinations.map(v=>{object(v);return {path:v.path,parent:v.parent,anchor:v.anchor};})};
}
function archiveSpec(manifest:DistributionManifest,row:PayloadArchiveInventory):ArchiveSpec {
  const a=manifest.artifacts.find(a=>a.id===row.artifactId),c=manifest.components.find(c=>c.role===row.role);
  if(!a||!c||!['tar','tar.gz'].includes(a.format))evidence('Fixed archive recipe differs');
  const entries=Math.min(c.declaredEntries,row.artifactId==='dl-payload'?256:row.artifactId==='java-runtime'?512:row.artifactId==='python-wheels'?64:10000);
  const expanded=row.artifactId==='python-wheels'?Math.min(c.declaredExpandedBytes,16*1024*1024):c.declaredExpandedBytes;
  return {format:a.format as 'tar'|'tar.gz',bytes:a.bytes,digest:a.digest,stripPrefix:row.stripPrefix,maxEntries:entries,maxFileBytes:Math.min(expanded,256*1024*1024),maxExpandedBytes:expanded,maxTarBytes:expanded+(entries+16)*1024+1024*1024,timeoutMs:60000};
}
function wheelMetadata(wheel:WheelInventory):WheelMetadata {return {...wheel,entries:wheel.entries.map(({data:_data,...entry})=>entry)};}
async function wheelsFromBundle(input:DistributionPrepareInput,manifest:DistributionManifest,row:PayloadArchiveInventory):Promise<WheelInventory[]> {
  const artifact=manifest.artifacts.find(a=>a.id==='python-wheels')!,raw=new Map<string,Buffer>();
  const observed=await readTarArchive(join(input.distribution.bundleRoot,artifact.filename),archiveSpec(manifest,row),{
    onEntry(entry){if(entry.kind!=='file'||entry.path.includes('/')||entry.bytes>8*1024*1024||raw.size>=8)evidence('Wheel payload tar differs from the fixed eight-file closure');raw.set(entry.path,Buffer.alloc(entry.bytes));},
    onFileChunk(entry,chunk,offset){chunk.copy(raw.get(entry.path)!,offset);},
  });
  if(preparationHash(observed)!==preparationHash(row.inventory)||raw.size!==8)evidence('Wheel payload inventory changed');
  const lock:unknown=JSON.parse(boundedFile(join(PACKAGE_ROOT,'vendor/compatibility/v1/toolchain/toolchain.lock.json'),2*1024*1024).toString('utf8'));object(lock);
  if(!Array.isArray(lock.pythonDependencies)||lock.pythonDependencies.length!==8)evidence('Packaged Python dependency closure differs');
  return lock.pythonDependencies.map(value=>{
    object(value);
    if(typeof value.filename!=='string'||typeof value.sha256!=='string'||typeof value.size!=='number'||typeof value.name!=='string'||typeof value.version!=='string')evidence('Invalid packaged Python dependency');
    const bytes=raw.get(value.filename);if(!bytes)evidence('A pinned wheel is missing');
    const wheel=inspectWheelArchive(bytes,{filename:value.filename,digest:'sha256:'+value.sha256,bytes:value.size});
    if(wheel.distribution!==value.name||wheel.version!==value.version)evidence('Wheel metadata differs from the packaged dependency closure');return wheel;
  });
}
interface PreparedInputs {plan:DistributionPreparationPlan;manifest:DistributionManifest;wheels:WheelInventory[];inspection:{report:Record<string,unknown>;reportDigest:string;authority:false};}
async function prepareInputs(input:DistributionPrepareInput,retained:unknown):Promise<PreparedInputs> {
  platform();const original=envelope(retained,input.inspectionDigest),observed=await inspectDistributionInventory(input.distribution);object(observed);object(observed.report);
  if(preparationHash(stableObservation(original.report))!==preparationHash(stableObservation(observed.report)))evidence('Current distribution or destination identity differs from the original inspection');
  const blockers=observed.report.blockers;
  if(!Array.isArray(blockers)||blockers.some(v=>!['TOOL_DESTINATION_EXISTS','INSUFFICIENT_OR_UNKNOWN_CAPACITY','INSUFFICIENT_INODES'].includes(v as string)))fail('DISTRIBUTION_PREPARATION_BLOCKED','Distribution platform or package compatibility remains blocked',409);
  // The old report uses a conservative two-copy estimate. Preparation refreshes
  // actual remaining payload and control-filesystem capacity before writes.
  const runtime=inspectRuntime(input.distribution.runtimeRoot),selected=selectedDistribution(realpathSync(PACKAGE_ROOT),input.distribution.bundleId);
  const archives=observed.report.payloadTarInventories as unknown as PayloadArchiveInventory[];
  const wheels=await wheelsFromBundle(input,selected.manifest,archives[3]);
  const python=join(input.distribution.toolRoot,'python','python'),venvConfiguration='home = '+join(python,'bin')+'\ninclude-system-site-packages = false\nversion = 3.12.12\nexecutable = '+join(python,'bin/python3.12')+'\n';
  const adapter=selected.manifest.artifacts.find(a=>a.id==='shacl-worker')!;
  const plan:DistributionPreparationPlan={schema:'ontology-distribution-preparation-plan/v1',recipe:'LINUX_ARM64_OFFLINE_V1',inputDigest:preparationHash(input),manifestDigest:selected.manifestDigest,payloadRecipeDigest:observed.report.payloadRecipeDigest as string,runtime,toolParent:privateDirectory(dirname(input.distribution.toolRoot)),compatibility:selected.manifest.compatibility,archives,wheels:wheels.map(wheelMetadata),venvConfiguration,adapter:{digest:adapter.digest,bytes:adapter.bytes},capacity:{toolBytes:archives.slice(0,3).reduce((n,a)=>n+a.inventory.fileBytes,0)+wheels.reduce((n,w)=>n+w.expandedBytes,0)+adapter.bytes+Buffer.byteLength(venvConfiguration)+4*1024*1024,toolInodes:archives.slice(0,3).reduce((n,a)=>n+a.inventory.entryCount,0)+wheels.reduce((n,w)=>n+w.entries.length,0)*2+128,controlBytes:PREPARATION_LIMITS.controlBytes}};
  validatePreparationPlan(plan,input);return {plan,manifest:selected.manifest,wheels,inspection:original};
}

function createDirectory(path:string,parent:PreparationNode,reuse=false):PreparationNode {
  platform();assertPreparationNode(dirname(path),parent);
  const fd=openSync(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{
    const held=fstatSync(fd,{bigint:true});if(String(held.dev)!==parent.device||String(held.ino)!==parent.inode)evidence('Creation parent was replaced');
    const target='/proc/self/fd/'+fd+'/'+basename(path);
    if(preparationFilePresent(target)){if(!reuse)evidence('Selected preparation directory already exists');}
    else {mkdirSync(target,{mode:0o700});fsyncSync(fd);}
    const node=privateDirectory(path);assertPreparationNode(dirname(path),parent);return node;
  }finally{closeSync(fd);}
}
function bootstrap(input:DistributionPrepareInput,plan:DistributionPreparationPlan):DistributionPreparationOwner {
  const parent=privateDirectory(dirname(input.controlRoot)),node=createDirectory(input.controlRoot,parent);
  const owner:DistributionPreparationOwner={schema:'ontology-distribution-preparation-owner/v1',input,inputDigest:preparationHash(input),planDigest:preparationHash(plan),node,parent};
  // Before this complete immutable owner is durable, an interrupted empty or
  // prefix-only root is deliberately not eligible for automatic adoption.
  writePreparationJSON(join(input.controlRoot,'owner.json'),owner,PREPARATION_LIMITS.recordBytes,node);return owner;
}
function toolOwnerValue(owner:DistributionPreparationOwner,plan:DistributionPreparationPlan,node:PreparationNode):Json {
  return {schema:'ontology-distribution-tool-root/v1',inputDigest:owner.inputDigest,planDigest:owner.planDigest,controlRoot:owner.input.controlRoot,controlNode:owner.node as unknown as Json,toolRoot:owner.input.distribution.toolRoot,node:node as unknown as Json,parent:plan.toolParent as unknown as Json};
}
function readToolOwner(owner:DistributionPreparationOwner,plan:DistributionPreparationPlan):{node:PreparationNode;value:Json} {
  const path=owner.input.distribution.toolRoot;
  if(!preparationFilePresent(path))evidence('Previously selected tool root is missing; no implicit replacement');
  const node=privateDirectory(path);
  if(!preparationFilePresent(join(path,MARKER)))fail('DISTRIBUTION_PREPARATION_UNOWNED','Tool directory has no complete request-bound owner; preserve it for explicit recovery',409);
  const value=readPreparationJSON(join(path,MARKER),65536),expected=toolOwnerValue(owner,plan,node);
  if(preparationHash(value)!==preparationHash(expected))evidence('Tool root belongs to a different preparation or physical directory');
  assertPreparationNode(dirname(path),plan.toolParent);
  const allowed=new Set([MARKER,'dl','java','python','shacl']);
  if(readdirSync(path).some(n=>!allowed.has(n)))evidence('Unselected tool-root material was preserved');
  return {node,value:expected};
}
function ensureToolRoot(owner:DistributionPreparationOwner,plan:DistributionPreparationPlan):PreparationNode {
  const path=owner.input.distribution.toolRoot;
  if(!preparationFilePresent(path)){
    if(names(owner.input.controlRoot).some(n=>/^(?:tool-owner|component-owners|materialized|verified|dl-toolchain|shacl-toolchain)\.json(?:\.pending)?$/.test(n)))evidence('Recorded or partially recorded tool root is missing; no replacement directory was created');
    const node=createDirectory(path,plan.toolParent);
    writePreparationJSON(join(path,MARKER),toolOwnerValue(owner,plan,node),65536,node);
  }
  const bound=readToolOwner(owner,plan);write(owner,'tool-owner.json',bound.value);return bound.node;
}
function observedTreeUsage(root:string):{bytes:number;entries:number} {
  let bytes=0,entries=0;
  const visit=(path:string,depth:number):void=>{
    if(depth>64||++entries>20000)fail('DISTRIBUTION_PREPARATION_LIMIT','Existing tool tree exceeds its inspection budget',413);
    const s=lstatSync(path);
    if(s.isSymbolicLink())return;
    if(s.isDirectory()){privatePath(path,true);for(const name of readdirSync(path))visit(join(path,name),depth+1);}
    else {privatePath(path);bytes+=s.size;if(bytes>2*1024*1024*1024)fail('DISTRIBUTION_PREPARATION_LIMIT','Existing tool bytes exceed preparation budget',413);}
  };
  visit(root,0);return {bytes,entries};
}
function capacity(owner:DistributionPreparationOwner,plan:DistributionPreparationPlan):void {
  const toolParent=dirname(owner.input.distribution.toolRoot);assertPreparationNode(toolParent,plan.toolParent);assertPreparationNode(owner.input.controlRoot,owner.node);
  const tool=statfsSync(toolParent,{bigint:true}),control=statfsSync(owner.input.controlRoot,{bigint:true});
  let retained={bytes:0,entries:0};
  if(preparationFilePresent(owner.input.distribution.toolRoot)){readToolOwner(owner,plan);retained=observedTreeUsage(owner.input.distribution.toolRoot);}
  const toolNeed=BigInt(Math.max(0,plan.capacity.toolBytes-retained.bytes))+BigInt(Math.max(0,plan.capacity.toolInodes-retained.entries))*tool.bsize;
  const existing=names(owner.input.controlRoot).reduce((n,name)=>n+lstatSync(join(owner.input.controlRoot,name)).size,0);
  const controlNeed=BigInt(Math.max(0,plan.capacity.controlBytes-existing));
  const same=plan.toolParent.device===owner.node.device;
  if(tool.bsize<=0n||control.bsize<=0n||tool.bavail<0n||control.bavail<0n||tool.bavail*tool.bsize<toolNeed+(same?controlNeed:0n)||!same&&control.bavail*control.bsize<controlNeed)fail('DISTRIBUTION_PREPARATION_CAPACITY','Insufficient currently observed capacity for remaining tools and control records',409);
  if(tool.files>0n&&tool.ffree>=0n&&tool.ffree<BigInt(Math.max(0,plan.capacity.toolInodes-retained.entries)+(same?64:0))||!same&&control.files>0n&&control.ffree>=0n&&control.ffree<64n)fail('DISTRIBUTION_PREPARATION_CAPACITY','Insufficient currently observed inode capacity',409);
}
function assertAdmission(owner:DistributionPreparationOwner):void {
  if(preparationHash(readPreparationJSON(join(owner.input.controlRoot,'admission.json')))!==preparationHash(admission(owner)))evidence('Preparation admission differs from its owner');
}
function topology(owner:DistributionPreparationOwner):void {
  const root=owner.input.controlRoot,selected=names(root),admitted=selected.includes('admission.json');
  const downstream=selected.some(n=>/^(?:tool-owner|component-owners|materialized|verified|dl-toolchain|shacl-toolchain)\.json(?:\.pending)?$/.test(n));
  if(downstream&&!admitted)evidence('Retained tool preparation has lost its full admission');
  const directions=['completion.reserve','prepared.reserve','abort.reserve'].filter(n=>selected.includes(n));
  if(admitted){
    assertAdmission(owner);ownedPlan(owner);envelope(readPreparationJSON(join(root,'inspection.json')),owner.input.inspectionDigest);
    if(directions.length!==1||selected.includes('completion.reserve.pending'))evidence('Admitted preparation has lost or contradicted its original reserve direction');
  }else if(selected.includes('prepared.reserve'))evidence('Completion direction has no complete admission');
  const line=Buffer.from(JSON.stringify(reserveIdentity(owner))+'\n');
  for(const name of directions){
    const bytes=boundedFile(join(root,name),PREPARATION_LIMITS.reserveBytes+65536,true);
    if(bytes.length<line.length||bytes.length>line.length+PREPARATION_LIMITS.reserveBytes||!bytes.subarray(0,line.length).equals(line)||bytes.subarray(line.length).some(b=>b!==32)||name==='completion.reserve'&&bytes.length!==line.length+PREPARATION_LIMITS.reserveBytes)evidence('Original reserve content differs from its exact request');
  }
  if(selected.includes('aborted.json.pending'))evidence('Abort is published by exact rename, not a pending JSON rewrite');
}
function retainedToolOwner(owner:DistributionPreparationOwner,plan:DistributionPreparationPlan):{value:Json;node:PreparationNode} {
  const value=readPreparationJSON(join(owner.input.controlRoot,'tool-owner.json'));object(value);validatePreparationNode(value.node);
  if(value.node.mode!==0o700||preparationHash(value)!==preparationHash(toolOwnerValue(owner,plan,value.node)))evidence('Retained tool ownership differs');return {value:value as Json,node:value.node};
}
function pendingPrefix(owner:DistributionPreparationOwner,name:string,expected:unknown):void {
  const path=join(owner.input.controlRoot,name+'.pending');if(!preparationFilePresent(path))return;
  const content=boundedFile(path,PREPARATION_LIMITS.recordBytes,true),bytes=Buffer.from(JSON.stringify(expected)+'\n');
  if(content.length>bytes.length||!content.equals(bytes.subarray(0,content.length)))evidence('Retained partial record is not the exact request prefix');
}
type ComponentNodes={dl:PreparationNode;java:PreparationNode;python:PreparationNode;shacl:PreparationNode;pythonRuntime:PreparationNode};
function componentPath(root:string,key:keyof ComponentNodes):string {return key==='pythonRuntime'?join(root,'python','python'):join(root,key);}
function componentNodes(owner:DistributionPreparationOwner,toolNode:PreparationNode):ComponentNodes {
  const root=owner.input.distribution.toolRoot,path=join(owner.input.controlRoot,'component-owners.json');
  if(preparationFilePresent(path)){
    const v=readPreparationJSON(path);exact(v,['schema','inputDigest','planDigest','toolNode','components']);exact(v.components,['dl','java','python','shacl','pythonRuntime']);
    if(v.schema!=='ontology-distribution-component-roots/v1'||v.inputDigest!==owner.inputDigest||v.planDigest!==owner.planDigest||preparationHash(v.toolNode)!==preparationHash(toolNode))evidence('Component ownership differs');
    for(const key of ['dl','java','python','shacl','pythonRuntime'] as const){validatePreparationNode(v.components[key]);assertPreparationNode(componentPath(root,key),v.components[key]);}
    return v.components as unknown as ComponentNodes;
  }
  if(names(owner.input.controlRoot).some(n=>/^(?:materialized|verified|dl-toolchain|shacl-toolchain)\.json(?:\.pending)?$/.test(n)))evidence('Component ownership was lost after materialization');
  const result={} as ComponentNodes;
  for(const key of ['dl','java','python','shacl'] as const)result[key]=createDirectory(join(root,key),toolNode,true);
  result.pythonRuntime=createDirectory(join(root,'python','python'),result.python,true);
  // No payload may be written before this complete immutable binding. Empty
  // selected child directories are inside the already owned tool namespace.
  for(const key of ['dl','java','shacl','pythonRuntime'] as const)if(readdirSync(componentPath(root,key)).length)evidence('Unbound component already contains material');
  if(readdirSync(join(root,'python')).some(n=>n!=='python'))evidence('Unbound Python component contains material');
  write(owner,'component-owners.json',{schema:'ontology-distribution-component-roots/v1',inputDigest:owner.inputDigest,planDigest:owner.planDigest,toolNode,components:result});return result;
}
function assertComponents(owner:DistributionPreparationOwner,toolNode:PreparationNode,components:ComponentNodes):void {
  assertPreparationNode(owner.input.controlRoot,owner.node);assertPreparationNode(owner.input.distribution.toolRoot,toolNode);
  for(const key of ['dl','java','python','shacl','pythonRuntime'] as const)assertPreparationNode(componentPath(owner.input.distribution.toolRoot,key),components[key]);
}
function memoryTree(files:{path:string;data:Buffer;mode:0o600|0o700}[],links:{path:string;target:string}[],retained:ArchiveEntry[]=[]):ArchiveEntry[] {
  return [...retained,...files.map(f=>({path:f.path,kind:'file' as const,mode:f.mode,bytes:f.data.length,digest:hashBytes(f.data),target:null,resolvedTarget:null,derived:false})),...links.map(l=>({path:l.path,kind:'symlink' as const,mode:0o700,bytes:0,digest:null,target:l.target,resolvedTarget:null,derived:false}))];
}
function materializedValue(owner:DistributionPreparationOwner,plan:DistributionPreparationPlan,toolNode:PreparationNode):Json {
  const components=readPreparationJSON(join(owner.input.controlRoot,'component-owners.json'));
  exact(components,['schema','inputDigest','planDigest','toolNode','components']);exact(components.components,['dl','java','python','shacl','pythonRuntime']);
  if(components.schema!=='ontology-distribution-component-roots/v1'||components.inputDigest!==owner.inputDigest||components.planDigest!==owner.planDigest||preparationHash(components.toolNode)!==preparationHash(toolNode))evidence('Retained component ownership differs');
  for(const n of Object.values(components.components)){validatePreparationNode(n);if(n.mode!==0o700)evidence('Retained component mode differs');}
  return {schema:'ontology-distribution-materialized/v1',inputDigest:owner.inputDigest,planDigest:owner.planDigest,toolNode:toolNode as unknown as Json,componentOwnersDigest:preparationHash(components),archives:plan.archives.slice(0,3).map(a=>a.inventory.inventoryDigest),wheels:plan.wheels.map(w=>w.inventoryDigest),venvConfigurationDigest:hashBytes(plan.venvConfiguration),adapterDigest:plan.adapter.digest,executorsExecuted:false,authority:false};
}
async function materialize(owner:DistributionPreparationOwner,prepared:PreparedInputs):Promise<{record:Json;verify:()=>void;verifyChains:(chains:ReturnType<typeof buildPreparedToolchains>)=>void}> {
  const {plan,manifest,wheels}=prepared,root=owner.input.distribution.toolRoot,toolNode=ensureToolRoot(owner,plan);
  const components=componentNodes(owner,toolNode),anchor=(key:keyof ComponentNodes):MaterializeRoot=>({path:componentPath(root,key),device:components[key].device,inode:components[key].inode});
  for(const row of plan.archives.slice(0,3)){
    const path=row.role==='python'?join(root,'python','python'):join(root,row.role),artifact=manifest.artifacts.find(a=>a.id===row.artifactId)!;
    await materializeTarArchive(join(owner.input.distribution.bundleRoot,artifact.filename),{...archiveSpec(manifest,row),timeoutMs:120000},row.inventory,anchor(row.role==='python'?'pythonRuntime':row.role as 'dl'|'java'));
    assertComponents(owner,toolNode,components);
  }
  const pythonInventory=plan.archives[2].inventory.entries;
  const retained:ArchiveEntry[]=[{path:'python',kind:'directory',mode:0o700,bytes:0,digest:null,target:null,resolvedTarget:null,derived:false},...pythonInventory.map(e=>({...e,path:'python/'+e.path,resolvedTarget:e.resolvedTarget===null?null:'python/'+e.resolvedTarget}))];
  const files=wheels.flatMap(w=>w.entries.map(e=>({path:'venv/lib/python3.12/site-packages/'+e.path,data:e.data,mode:0o600 as const})));
  files.push({path:'venv/pyvenv.cfg',data:Buffer.from(plan.venvConfiguration),mode:0o600});
  const links=[{path:'venv/bin/python3.12',target:'../../python/bin/python3.12'},{path:'venv/bin/python3',target:'python3.12'},{path:'venv/bin/python',target:'python3.12'}];
  await materializeMemoryTree(anchor('python'),files,links,retained);assertComponents(owner,toolNode,components);
  const adapter=manifest.artifacts.find(a=>a.id==='shacl-worker')!,data=boundedFile(join(owner.input.distribution.bundleRoot,adapter.filename),plan.adapter.bytes);
  if(data.length!==plan.adapter.bytes||hashBytes(data)!==plan.adapter.digest)evidence('SHACL adapter changed before materialization');
  const adapterFiles=[{path:'worker.py',data,mode:0o600 as const}];
  await materializeMemoryTree(anchor('shacl'),adapterFiles);assertComponents(owner,toolNode,components);
  const verify=():void=>{
    assertComponents(owner,toolNode,components);readToolOwner(owner,plan);
    verifyMaterializedTree(anchor('dl'),plan.archives[0].inventory.entries);verifyMaterializedTree(anchor('java'),plan.archives[1].inventory.entries);
    verifyMaterializedTree(anchor('python'),memoryTree(files,links,retained));verifyMaterializedTree(anchor('shacl'),memoryTree(adapterFiles,[]));assertComponents(owner,toolNode,components);
  };
  const verifyChains=(chains:ReturnType<typeof buildPreparedToolchains>):void=>{
    for(const role of ['dl','shacl'] as const)if(preparationHash(chains[role])!==preparationHash(plannedChain(owner,plan,role)))evidence('Final toolchain differs from the sealed distribution plan');
  };
  verify();const record=materializedValue(owner,plan,toolNode);write(owner,'materialized.json',record);return {record,verify,verifyChains};
}
function plannedChain(owner:DistributionPreparationOwner,plan:DistributionPreparationPlan,role:'dl'|'shacl'):Record<string,unknown> {
  const root=owner.input.distribution.toolRoot;
  const files=(entries:ArchiveEntry[],selected:(path:string)=>boolean=()=>true)=>entries.filter(e=>e.kind!=='directory'&&selected(e.path)).map(e=>({path:e.path,kind:e.kind==='file'?'file':'link',digest:e.kind==='file'?e.digest!:preparationHash(e.target),mode:e.kind==='file'?e.mode:0o777}));
  const sorted=<T extends {path:string}>(entries:T[]):T[]=>entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  let identity:Record<string,unknown>;
  if(role==='dl'){
    const java=(path:string)=>['bin/java','lib','conf','release'].some(prefix=>path===prefix||path.startsWith(prefix+'/'));
    identity={schema:'ontology-dl-toolchain/v1',root:join(root,'dl'),javaRoot:join(root,'java'),javaVersion:'21.0.13',platform:'linux',arch:'arm64',engine:'hermit:1.4.5.519+evopilot.2;jfact:5.0.3;structural-alc:2',owlapi:'owlapi-distribution:5.5.1',workerSourceDigest:plan.compatibility.workerSourceDigest,dependencyLockDigest:plan.compatibility.dependencyLockDigest,runtimeFiles:sorted(files(plan.archives[0].inventory.entries)),javaFiles:sorted(files(plan.archives[1].inventory.entries,java))};
  }else{
    const runtimeFiles=sorted([...files(plan.archives[2].inventory.entries).map(e=>({...e,path:'python/'+e.path})),...plan.wheels.flatMap(w=>w.entries.map(e=>({path:'venv/lib/python3.12/site-packages/'+e.path,kind:'file',digest:e.digest,mode:e.mode}))),{path:'venv/pyvenv.cfg',kind:'file',digest:hashBytes(plan.venvConfiguration),mode:0o600},...['python','python3','python3.12'].map(name=>({path:'venv/bin/'+name,kind:'link',digest:preparationHash(name==='python3.12'?'../../python/bin/python3.12':'python3.12'),mode:0o777}))]);
    identity={schema:'ontology-shacl-toolchain/v2',root:join(root,'shacl'),runtimeRoot:join(root,'python'),python:join(root,'python/venv/bin/python3.12'),pythonVersion:'3.12.12',pyshacl:'0.40.1',rdflib:'7.6.0',platform:'linux',arch:'arm64',adapterDigest:plan.adapter.digest,runtimeFiles};
  }
  return {...identity,digest:preparationHash(identity)};
}
function retainedChain(owner:DistributionPreparationOwner,plan:DistributionPreparationPlan,role:'dl'|'shacl'):{path:string;digest:string} {
  const path=join(owner.input.controlRoot,role+'-toolchain.json'),chain=readPreparationJSON(path),expected=plannedChain(owner,plan,role);
  if(preparationHash(chain)!==preparationHash(expected))evidence('Retained toolchain differs from the original sealed plan');
  return {path,digest:expected.digest as string};
}
function expectedVerification(owner:DistributionPreparationOwner):Record<string,unknown> {
  const root=owner.input.controlRoot;
  assertAdmission(owner);envelope(readPreparationJSON(join(root,'inspection.json')),owner.input.inspectionDigest);
  const plan=ownedPlan(owner),tool=retainedToolOwner(owner,plan),materialized=readPreparationJSON(join(root,'materialized.json'));
  if(preparationHash(materialized)!==preparationHash(materializedValue(owner,plan,tool.node)))evidence('Retained materialization closure differs');
  return {schema:'ontology-distribution-prepared-verification/v1',inputDigest:owner.inputDigest,planDigest:owner.planDigest,materializedDigest:preparationHash(materialized),toolOwnerDigest:preparationHash(tool.value),runtimeDigest:plan.runtime.digest,dl:retainedChain(owner,plan,'dl'),shacl:retainedChain(owner,plan,'shacl'),filesVerified:true,executorsExecuted:false,authority:false};
}
function verifiedRecord(owner:DistributionPreparationOwner):Record<string,unknown> {
  const value=readPreparationJSON(join(owner.input.controlRoot,'verified.json'));object(value);
  if(preparationHash(value)!==preparationHash(expectedVerification(owner)))evidence('Retained tool verification differs');
  return value;
}
function preparedReceipt(owner:DistributionPreparationOwner,verified:Record<string,unknown>):Json {
  return {schema:'ontology-distribution-prepared-receipt/v1',requestId:owner.input.requestId,inputDigest:owner.inputDigest,planDigest:owner.planDigest,inspectionDigest:owner.input.inspectionDigest,verificationDigest:preparationHash(verified),toolRoot:owner.input.distribution.toolRoot,runtimeDigest:owner.input.distribution.runtimeDigest,dl:verified.dl as Json,shacl:verified.shacl as Json,filesMaterialized:true,loadabilityVerified:false,resourceBackendVerified:false,toolsBound:false,serviceStarted:false,hostConnected:false,productAcceptance:'NOT_EVALUATED',authority:false};
}
function terminal(owner:DistributionPreparationOwner):{state:'PREPARED'|'ABORTED';receipt:Json}|null {
  topology(owner);
  const root=owner.input.controlRoot,p=preparationFilePresent(join(root,'prepared.json')),a=preparationFilePresent(join(root,'aborted.json'));
  if(p&&a||preparationFilePresent(join(root,'prepared.reserve'))&&preparationFilePresent(join(root,'abort.reserve')))evidence('Conflicting preparation terminal records');
  for(const name of ['prepared.reserve','abort.reserve'])if(preparationFilePresent(join(root,name))){
    if(preparationFilePresent(join(root,'completion.reserve'))||preparationHash(readPreparationJSON(join(root,name),PREPARATION_LIMITS.reserveBytes+65536))!==preparationHash(reserveIdentity(owner)))evidence('Retained preparation direction identity differs');
  }
  if(a){
    if(preparationFilePresent(join(root,'prepared.reserve')))evidence('Abort conflicts with committed forward completion');
    const receipt=readPreparationJSON(join(root,'aborted.json'));if(preparationHash(receipt)!==preparationHash(abortedReceipt(owner)))evidence('Abort receipt differs');return {state:'ABORTED',receipt:receipt as Json};
  }
  if(p){
    if(!preparationFilePresent(join(root,'prepared.reserve'))||preparationFilePresent(join(root,'abort.reserve')))evidence('Prepared receipt has no exclusive completion direction');
    const receipt=readPreparationJSON(join(root,'prepared.json')),expected=preparedReceipt(owner,verifiedRecord(owner));
    if(preparationHash(receipt)!==preparationHash(expected))evidence('Prepared receipt differs');return {state:'PREPARED',receipt:expected};
  }
  return null;
}
function replay(value:{state:'PREPARED'|'ABORTED';receipt:Json},replayed:boolean):Json {return {status:value.state,receipt:value.receipt,replayed,currentToolVerification:'NOT_RUN',authority:false};}
function complete(owner:DistributionPreparationOwner):Json {
  const verified=verifiedRecord(owner);
  selectPreparationDirection(owner.input.controlRoot,reserveIdentity(owner),'prepared',PREPARATION_LIMITS.reserveBytes,owner.node);
  const receipt=preparedReceipt(owner,verified);write(owner,'prepared.json',receipt);return replay({state:'PREPARED',receipt},false);
}
export async function prepareDistribution(value:unknown,retainedInspection?:unknown):Promise<Json> {
  validateDistributionPrepareInput(value);const input=value;
  let owner:DistributionPreparationOwner,preflight:PreparedInputs|undefined;
  if(preparationFilePresent(input.controlRoot))owner=readOwner(input);
  else {
    platform();privateDirectory(dirname(input.controlRoot));
    if(preparationFilePresent(input.distribution.toolRoot))fail('DISTRIBUTION_PREPARATION_UNOWNED','A new request requires an unused tool destination',409);
    if(retainedInspection===undefined)fail('DISTRIBUTION_INSPECTION_REQUIRED','Retain the original successful inspection before new preparation',409);
    preflight=await prepareInputs(input,retainedInspection);owner=bootstrap(input,preflight.plan);
  }
  const finished=terminal(owner);if(finished)return replay(finished,true);
  platform();
  return withPreparationLock(input.controlRoot,async()=>{
    owner=readOwner(input);const completed=terminal(owner);if(completed)return replay(completed,true);
    if(preparationFilePresent(join(input.controlRoot,'abort.reserve')))fail('DISTRIBUTION_PREPARATION_ABORT_PENDING','Resume the original abort; preparation cannot continue',409);
    if(preparationFilePresent(join(input.controlRoot,'prepared.reserve')))return complete(owner);
    const selectedInspection=preparationFilePresent(join(input.controlRoot,'inspection.json'))?readPreparationJSON(join(input.controlRoot,'inspection.json')):retainedInspection;
    if(selectedInspection===undefined)fail('DISTRIBUTION_INSPECTION_REQUIRED','Original inspection is required to resume this bootstrap',409);
    if(preparationFilePresent(input.distribution.toolRoot)||names(input.controlRoot).some(n=>/^(?:tool-owner|component-owners|materialized|verified|dl-toolchain|shacl-toolchain)\.json(?:\.pending)?$/.test(n))){
      assertAdmission(owner);const plan=ownedPlan(owner);readToolOwner(owner,plan);
    }
    const prepared=preflight??await prepareInputs(input,selectedInspection);preflight=undefined;
    if(preparationHash(prepared.plan)!==owner.planDigest)evidence('Recomputed preparation plan changed; original partial materials were preserved');
    write(owner,'abort-ready.json',abortedReceipt(owner));write(owner,'inspection.json',prepared.inspection);write(owner,'plan.json',prepared.plan);
    capacity(owner,prepared.plan);reservePreparationSpace(input.controlRoot,reserveIdentity(owner),PREPARATION_LIMITS.reserveBytes,owner.node);write(owner,'admission.json',admission(owner));
    const materialized=await materialize(owner,prepared),toolOwner=readToolOwner(owner,prepared.plan);
    const chains=buildPreparedToolchains({controlRoot:input.controlRoot,toolRoot:input.distribution.toolRoot,runtime:prepared.plan.runtime,manifest:prepared.manifest});
    materialized.verifyChains(chains);
    materialized.verify();
    write(owner,'dl-toolchain.json',chains.dl);write(owner,'shacl-toolchain.json',chains.shacl);
    const verification={schema:'ontology-distribution-prepared-verification/v1',inputDigest:owner.inputDigest,planDigest:owner.planDigest,materializedDigest:preparationHash(materialized.record),toolOwnerDigest:preparationHash(toolOwner.value),runtimeDigest:prepared.plan.runtime.digest,dl:{path:join(input.controlRoot,'dl-toolchain.json'),digest:chains.dl.digest},shacl:{path:join(input.controlRoot,'shacl-toolchain.json'),digest:chains.shacl.digest},filesVerified:true,executorsExecuted:false,authority:false};
    write(owner,'verified.json',verification);return complete(owner);
  },owner.node);
}
export async function abortDistributionPreparation(value:unknown):Promise<Json> {
  validateDistributionPrepareInput(value);let owner=readOwner(value);const prior=terminal(owner);
  if(prior){if(prior.state==='PREPARED')fail('DISTRIBUTION_PREPARATION_COMPLETED','Completed tool preparation cannot be aborted',409);return replay(prior,true);}
  platform();return withPreparationLock(value.controlRoot,async()=>{
    owner=readOwner(value);const existing=terminal(owner);if(existing){if(existing.state==='PREPARED')fail('DISTRIBUTION_PREPARATION_COMPLETED','Completed tool preparation cannot be aborted',409);return replay(existing,true);}
    if(preparationFilePresent(join(value.controlRoot,'prepared.reserve')))fail('DISTRIBUTION_PREPARATION_FORWARD_ONLY','Retained completion direction requires forward recovery',409);
    write(owner,'abort-ready.json',abortedReceipt(owner));
    if(preparationFilePresent(join(value.controlRoot,'admission.json'))){assertAdmission(owner);selectPreparationDirection(value.controlRoot,reserveIdentity(owner),'abort',PREPARATION_LIMITS.reserveBytes,owner.node);}
    const fd=openSync(value.controlRoot,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{
      const s=fstatSync(fd,{bigint:true});if(String(s.dev)!==owner.node.device||String(s.ino)!==owner.node.inode)evidence('Abort control root was replaced');
      const base='/proc/self/fd/'+fd,ready=readPreparationJSON(join(value.controlRoot,'abort-ready.json'));
      if(preparationHash(ready)!==preparationHash(abortedReceipt(owner))||preparationFilePresent(join(base,'aborted.json')))evidence('Abort record changed');
      assertPreparationNode(value.controlRoot,owner.node);renameSync(join(base,'abort-ready.json'),join(base,'aborted.json'));fsyncSync(fd);assertPreparationNode(value.controlRoot,owner.node);
    }finally{closeSync(fd);}
    return replay({state:'ABORTED',receipt:abortedReceipt(owner)},false);
  },owner.node);
}

function controlSnapshot(root:string):unknown {
  const node=privateDirectory(root),items=names(root).map(name=>{
    const path=join(root,name),before=lstatSync(path,{bigint:true});
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const stamp=(s:BigIntStats)=>[s.dev,s.ino,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
    try{
      const held=fstatSync(fd,{bigint:true});if(stamp(held)!==stamp(before))evidence('Control file changed before status read');
      const h=createHash('sha256'),buffer=Buffer.alloc(65536);let position=0;
      while(position<Number(held.size)){
        const n=readSync(fd,buffer,0,Math.min(buffer.length,Number(held.size)-position),position);if(!n)evidence('Control file ended during status read');h.update(buffer.subarray(0,n));position+=n;
      }
      if(stamp(fstatSync(fd,{bigint:true}))!==stamp(held)||stamp(lstatSync(path,{bigint:true}))!==stamp(held))evidence('Control file changed during status read');
      return {name,stamp:stamp(held),digest:'sha256:'+h.digest('hex')};
    }finally{closeSync(fd);}
  });
  assertPreparationNode(root,node);return {node,items};
}
/** Read-only phase projection. No lease or SQLite connection is opened, and a
 * phase does not imply that its original process is alive. */
export function inspectDistributionPreparation(value:unknown):Json {
  validateDistributionPrepareInput(value);const root=value.controlRoot;
  if(!preparationFilePresent(root))return {status:'NOT_FOUND',requestId:value.requestId,authority:false};
  const before=controlSnapshot(root);
  if(!preparationFilePresent(join(root,'owner.json'))){
    if(preparationHash(controlSnapshot(root))!==preparationHash(before))evidence('Preparation bootstrap changed during inspection');
    return {status:'UNOWNED_BOOTSTRAP',requestId:value.requestId,automaticAdoption:false,materialsPreserved:true,authority:false};
  }
  const owner=readOwner(value),done=terminal(owner);
  let status:string=done?.state??'BOOTSTRAP_PENDING',direction='NONE';
  if(!done){
    const present=(name:string)=>preparationFilePresent(join(root,name));
    const plan=present('plan.json')?ownedPlan(owner):null;
    if(present('inspection.json'))envelope(readPreparationJSON(join(root,'inspection.json')),owner.input.inspectionDigest);
    if(present('abort-ready.json')&&preparationHash(readPreparationJSON(join(root,'abort-ready.json')))!==preparationHash(abortedReceipt(owner)))evidence('Abort-ready record differs');
    pendingPrefix(owner,'abort-ready.json',abortedReceipt(owner));pendingPrefix(owner,'admission.json',admission(owner));
    if(preparationFilePresent(join(root,'admission.json'))){assertAdmission(owner);status='ADMITTED';}
    else if(preparationFilePresent(join(root,'admission.json.pending')))status='ADMISSION_PENDING';
    const tool=present('tool-owner.json')&&plan?retainedToolOwner(owner,plan):null;
    if(tool)status='TOOL_ROOT_OWNED';
    else if(present('tool-owner.json.pending'))status='TOOL_ROOT_BINDING_PENDING';
    if(present('component-owners.json')){
      if(!tool||!plan)evidence('Component ownership has lost its tool-root binding');
      materializedValue(owner,plan,tool.node);status='MATERIALIZING';
    }else if(present('component-owners.json.pending')){
      if(!tool)evidence('Partial component ownership has lost its tool-root binding');status='COMPONENT_ROOT_BINDING_PENDING';
    }
    if(present('materialized.json')||present('materialized.json.pending')){
      if(!tool||!plan||!present('component-owners.json'))evidence('Materialization has lost preceding ownership records');
      const expected=materializedValue(owner,plan,tool.node);pendingPrefix(owner,'materialized.json',expected);
      if(present('materialized.json')){if(preparationHash(readPreparationJSON(join(root,'materialized.json')))!==preparationHash(expected))evidence('Retained materialization record differs');status='FINALIZING';}
      else status='MATERIALIZATION_COMMIT_PENDING';
    }
    if(['dl-toolchain.json','dl-toolchain.json.pending','shacl-toolchain.json','shacl-toolchain.json.pending','verified.json','verified.json.pending'].some(present)&&!present('materialized.json'))evidence('Toolchain finalization has lost its materialization record');
    for(const role of ['dl','shacl'] as const)if(present(role+'-toolchain.json')||present(role+'-toolchain.json.pending')){
      if(!plan)evidence('Toolchain has lost its original plan');
      if(present(role+'-toolchain.json'))retainedChain(owner,plan,role);
      else pendingPrefix(owner,role+'-toolchain.json',plannedChain(owner,plan,role));
    }
    if(present('verified.json.pending'))pendingPrefix(owner,'verified.json',expectedVerification(owner));
    if(preparationFilePresent(join(root,'verified.json'))){verifiedRecord(owner);status='VERIFIED';}
    if(present('prepared.json.pending'))pendingPrefix(owner,'prepared.json',preparedReceipt(owner,verifiedRecord(owner)));
    if(preparationFilePresent(join(root,'prepared.reserve'))){verifiedRecord(owner);status='COMPLETION_PENDING';direction='FORWARD_ONLY';}
    if(preparationFilePresent(join(root,'abort.reserve'))){status='ABORT_PENDING';direction='ABORT_ONLY';}
  }
  if(preparationHash(controlSnapshot(root))!==preparationHash(before))fail('DISTRIBUTION_PREPARATION_STATUS_CHANGED','Preparation control changed during read-only inspection; inspect it again',409);
  return {status,requestId:value.requestId,inputDigest:owner.inputDigest,planDigest:owner.planDigest,receipt:done?.receipt??null,recoveryDirection:direction,partialRecordsRequireOriginalInputs:names(root).some(n=>['plan.json.pending','inspection.json.pending','tool-owner.json.pending','component-owners.json.pending'].includes(n)),processLiveness:'NOT_INFERRED',currentToolVerification:'NOT_RUN',filesWritten:false,executorsExecuted:false,authority:false};
}
