import {isAbsolute,resolve} from 'node:path';
import {exact,id,digest,hash,text} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {assertSeparate} from './files.js';
import {validateDistributionInput} from './distribution-contract.js';
import type {DistributionInput} from './distribution-contract.js';
import type {DistributionManifest} from './distribution-contract.js';
import {validateRuntimeBinding} from './runtime.js';
import type {RuntimeBinding} from './runtime.js';
import {validateArchiveInventory} from './distribution-archive.js';
import type {PayloadArchiveInventory} from './distribution-inventory.js';
import type {PreparationNode} from './distribution-prepare-files.js';

export const PREPARATION_LIMITS=Object.freeze({recordBytes:8*1024*1024,controlBytes:40*1024*1024,reserveBytes:8*1024*1024,wheelBytes:32*1024*1024,wheelEntries:2000});
export interface DistributionPrepareInput {
  schema:'ontology-distribution-prepare-input/v1';requestId:string;controlRoot:string;
  inspectionDigest:string;distribution:DistributionInput;
}
export interface WheelMetadata {
  schema:'ontology-wheel-inventory/v1';filename:string;digest:string;bytes:number;
  distribution:string;version:string;expandedBytes:number;
  entries:{path:string;bytes:number;digest:string;mode:384}[];inventoryDigest:string;
}
export interface DistributionPreparationPlan {
  schema:'ontology-distribution-preparation-plan/v1';recipe:'LINUX_ARM64_OFFLINE_V1';inputDigest:string;
  manifestDigest:string;payloadRecipeDigest:string;runtime:RuntimeBinding;toolParent:PreparationNode;
  compatibility:DistributionManifest['compatibility'];
  archives:PayloadArchiveInventory[];wheels:WheelMetadata[];venvConfiguration:string;
  adapter:{digest:string;bytes:number};capacity:{toolBytes:number;toolInodes:number;controlBytes:number};
}
export interface DistributionPreparationOwner {
  schema:'ontology-distribution-preparation-owner/v1';input:DistributionPrepareInput;inputDigest:string;
  planDigest:string;node:PreparationNode;parent:PreparationNode;
}
export const preparationHash=(value:unknown):string=>hash(value as Json);
export function validatePreparationNode(value:unknown):asserts value is PreparationNode {
  exact(value,['device','inode','mode']);
  for(const key of ['device','inode'])if(typeof value[key]!=='string'||!/^\d{1,24}$/.test(value[key]))fail('DISTRIBUTION_PREPARATION_EVIDENCE','Invalid preparation filesystem identity',409);
  if(value.mode!==0o700&&value.mode!==0o600&&value.mode!==0o400)fail('DISTRIBUTION_PREPARATION_EVIDENCE','Private preparation mode required',409);
}
export function validateDistributionPrepareInput(value:unknown):asserts value is DistributionPrepareInput {
  exact(value,['schema','requestId','controlRoot','inspectionDigest','distribution']);
  if(value.schema!=='ontology-distribution-prepare-input/v1')fail('INVALID_INPUT','Unknown tool preparation input');
  id(value.requestId);digest(value.inspectionDigest);text(value.controlRoot,4096);validateDistributionInput(value.distribution);
  if(!isAbsolute(value.controlRoot)||resolve(value.controlRoot)!==value.controlRoot||value.controlRoot.includes('\\'))fail('UNSAFE_PATH','Canonical absolute preparation control root required');
  for(const key of ['bundleRoot','runtimeRoot','toolRoot','installationRoot','workspaceRoot'] as const)assertSeparate(value.controlRoot,value.distribution[key]);
}
function safePath(path:unknown):asserts path is string {
  text(path,512);
  if(path.startsWith('/')||/[\\\x00-\x1f\x7f-\x9f]/u.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..'))fail('DISTRIBUTION_PREPARATION_EVIDENCE','Invalid retained wheel path',409);
}
function count(value:unknown,maximum:number,minimum=0):asserts value is number {
  if(!Number.isSafeInteger(value)||(value as number)<minimum||(value as number)>maximum)fail('DISTRIBUTION_PREPARATION_EVIDENCE','Invalid preparation count or byte budget',409);
}
export function validatePreparationPlan(value:unknown,input:DistributionPrepareInput):asserts value is DistributionPreparationPlan {
  if(Buffer.byteLength(JSON.stringify(value))>PREPARATION_LIMITS.recordBytes)fail('DISTRIBUTION_PREPARATION_LIMIT','Preparation plan exceeds its record budget',413);
  exact(value,['schema','recipe','inputDigest','manifestDigest','payloadRecipeDigest','runtime','toolParent','compatibility','archives','wheels','venvConfiguration','adapter','capacity']);
  if(value.schema!=='ontology-distribution-preparation-plan/v1'||value.recipe!=='LINUX_ARM64_OFFLINE_V1'||value.inputDigest!==preparationHash(input))fail('DISTRIBUTION_PREPARATION_EVIDENCE','Preparation plan differs from the exact selected input',409);
  digest(value.manifestDigest);digest(value.payloadRecipeDigest);validateRuntimeBinding(value.runtime);validatePreparationNode(value.toolParent);
  if(value.toolParent.mode!==0o700)fail('DISTRIBUTION_PREPARATION_EVIDENCE','Preparation tool parent must be a private directory',409);
  exact(value.compatibility,['nodeVersion','workerSourceDigest','dependencyLockDigest','shaclAdapterDigest']);
  for(const key of ['workerSourceDigest','dependencyLockDigest','shaclAdapterDigest'])digest(value.compatibility[key]);
  if(value.compatibility.nodeVersion!=='24.14.0'||value.compatibility.nodeVersion!==value.runtime.nodeVersion)fail('DISTRIBUTION_PREPARATION_EVIDENCE','Retained Node compatibility differs',409);
  if(value.runtime.root!==input.distribution.runtimeRoot||value.runtime.digest!==input.distribution.runtimeDigest)fail('DISTRIBUTION_PREPARATION_EVIDENCE','Preparation runtime differs',409);
  if(!Array.isArray(value.archives)||value.archives.length!==4)fail('DISTRIBUTION_PREPARATION_EVIDENCE','Four runtime tar inventories required',409);
  const expected=[['dl-payload','dl','dl'],['java-runtime','java','jdk-21.0.13+9-jre'],['python-runtime','python','python'],['python-wheels','python',null]];
  for(let n=0;n<expected.length;n++){
    const row=value.archives[n];exact(row,['artifactId','role','stripPrefix','inventory']);
    if(row.artifactId!==expected[n][0]||row.role!==expected[n][1]||row.stripPrefix!==expected[n][2])fail('DISTRIBUTION_PREPARATION_EVIDENCE','Retained tar recipe differs',409);
    validateArchiveInventory(row.inventory);
  }
  if(!Array.isArray(value.wheels)||value.wheels.length!==8)fail('DISTRIBUTION_PREPARATION_EVIDENCE','Eight exact wheel inventories required',409);
  const files=new Set<string>(),names=new Set<string>();let wheelBytes=0,wheelEntries=0;
  for(const wheel of value.wheels){
    exact(wheel,['schema','filename','digest','bytes','distribution','version','expandedBytes','entries','inventoryDigest']);
    text(wheel.filename,180);text(wheel.distribution,180);text(wheel.version,80);digest(wheel.digest);digest(wheel.inventoryDigest);
    if(wheel.schema!=='ontology-wheel-inventory/v1'||names.has(wheel.filename)||!/^[A-Za-z0-9_.+-]+\.whl$/.test(wheel.filename))fail('DISTRIBUTION_PREPARATION_EVIDENCE','Invalid retained wheel identity',409);
    names.add(wheel.filename);count(wheel.bytes,8*1024*1024,1);count(wheel.expandedBytes,16*1024*1024);
    if(!Array.isArray(wheel.entries)||!wheel.entries.length||wheel.entries.length>1000)fail('DISTRIBUTION_PREPARATION_EVIDENCE','Invalid retained wheel entry count',409);
    let bytes=0;
    for(const entry of wheel.entries){
      exact(entry,['path','bytes','digest','mode']);safePath(entry.path);digest(entry.digest);count(entry.bytes,16*1024*1024);
      if(entry.mode!==0o600||files.has(entry.path))fail('DISTRIBUTION_PREPARATION_EVIDENCE','Wheel files overlap or have unsafe modes',409);
      files.add(entry.path);bytes+=entry.bytes;
    }
    const {inventoryDigest,...identity}=wheel;
    if(bytes!==wheel.expandedBytes||preparationHash(identity)!==inventoryDigest)fail('DISTRIBUTION_PREPARATION_EVIDENCE','Wheel inventory content identity differs',409);
    wheelBytes+=bytes;wheelEntries+=wheel.entries.length;
  }
  if(wheelBytes>PREPARATION_LIMITS.wheelBytes||wheelEntries>PREPARATION_LIMITS.wheelEntries)fail('DISTRIBUTION_PREPARATION_LIMIT','Combined wheel payload exceeds preparation budget',413);
  text(value.venvConfiguration,16384);
  exact(value.adapter,['digest','bytes']);digest(value.adapter.digest);count(value.adapter.bytes,1024*1024,1);
  if(value.compatibility.shaclAdapterDigest!==value.adapter.digest)fail('DISTRIBUTION_PREPARATION_EVIDENCE','Retained adapter compatibility differs',409);
  exact(value.capacity,['toolBytes','toolInodes','controlBytes']);count(value.capacity.toolBytes,2*1024*1024*1024,1);count(value.capacity.toolInodes,50000,1);count(value.capacity.controlBytes,PREPARATION_LIMITS.controlBytes,1);
}
export function validatePreparationOwner(value:unknown,input:DistributionPrepareInput):asserts value is DistributionPreparationOwner {
  exact(value,['schema','input','inputDigest','planDigest','node','parent']);validateDistributionPrepareInput(value.input);digest(value.planDigest);validatePreparationNode(value.node);validatePreparationNode(value.parent);
  if(value.schema!=='ontology-distribution-preparation-owner/v1'||value.inputDigest!==preparationHash(input)||preparationHash(value.input)!==value.inputDigest||value.node.mode!==0o700||value.parent.mode!==0o700)fail('DISTRIBUTION_PREPARATION_EVIDENCE','Preparation owner belongs to another exact request',409);
}
