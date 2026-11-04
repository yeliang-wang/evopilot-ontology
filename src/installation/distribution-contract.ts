import {isAbsolute,resolve} from 'node:path';
import {exact,id,digest,text} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';

/** Inspection budgets, not an installation, resource or conformance guarantee. */
export const DISTRIBUTION_LIMITS=Object.freeze({
  manifestBytes:256*1024,
  artifacts:64,
  artifactBytes:256*1024*1024,
  totalArtifactBytes:768*1024*1024,
  componentEntries:10000,
  totalExpandedBytes:2*1024*1024*1024,
});

export interface DistributionArtifact {
  id:string;
  filename:string;
  bytes:number;
  digest:string;
  format:'tar.gz'|'tar.zst'|'tar'|'json'|'text'|'file';
  origin:{kind:'UPSTREAM'|'PRODUCT';reference:string;revision:string;};
}

export interface DistributionComponent {
  role:'dl'|'java'|'python'|'shacl';
  version:string;
  artifactIds:string[];
  provenanceArtifactIds:string[];
  noticeArtifactIds:string[];
  declaredExpandedBytes:number;
  declaredEntries:number;
  preparation:'EXTRACT'|'FINAL_PATH_VENV'|'COPY';
}

export interface DistributionManifest {
  schema:'ontology-tool-distribution/v1';
  id:string;
  platform:{os:'linux';arch:'arm64'|'x64';libc:'glibc';minimumLibc:string;};
  compatibility:{nodeVersion:'24.14.0';workerSourceDigest:string;dependencyLockDigest:string;shaclAdapterDigest:string;};
  artifacts:DistributionArtifact[];
  components:DistributionComponent[];
  limitations:string[];
}

export interface DistributionInput {
  schema:'ontology-distribution-inspect-input/v1';
  bundleId:string;
  bundleRoot:string;
  runtimeRoot:string;
  runtimeDigest:string;
  toolRoot:string;
  installationRoot:string;
  workspaceRoot:string;
}

function plain(value:unknown,keys:string[]):asserts value is Record<string,unknown> {
  exact(value,keys);
  if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('INVALID_INPUT','Plain distribution data required');
}

function positive(value:unknown,max:number):asserts value is number {
  if(!Number.isSafeInteger(value)||(value as number)<1)fail('INVALID_INPUT','Positive safe integer required');
  if((value as number)>max)fail('DISTRIBUTION_LIMIT','Distribution count or byte budget exceeded',413);
}

function addWithin(total:number,value:number,max:number):number {
  if(value>max-total)fail('DISTRIBUTION_LIMIT','Aggregate distribution byte budget exceeded',413);
  return total+value;
}

function origin(value:unknown):void {
  plain(value,['kind','reference','revision']);text(value.reference,4096);text(value.revision,200);
  if(value.reference.trim()!==value.reference||/[\x00-\x20\x7f\\]/.test(value.reference))fail('INVALID_INPUT','Canonical provenance reference required');
  if(value.kind==='UPSTREAM'){
    let url:URL;
    try{url=new URL(value.reference);}catch{fail('INVALID_INPUT','HTTPS upstream provenance reference required');}
    if(url.protocol!=='https:'||!url.hostname||url.username||url.password||value.reference.includes('#')||!/^https:\/\//i.test(value.reference))fail('INVALID_INPUT','HTTPS upstream provenance must omit credentials and fragments');
    const authority=value.reference.slice(value.reference.indexOf('//')+2).split(/[/?#]/,1)[0];
    if(authority.includes('@'))fail('INVALID_INPUT','Upstream provenance must omit user information');
  }else if(value.kind==='PRODUCT'){
    const urn=/^urn:evopilot:[A-Za-z0-9][A-Za-z0-9._:+-]*$/.test(value.reference);
    const source=!isAbsolute(value.reference)&&value.reference.split('/').every(part=>part!=='.'&&part!=='..'&&/^[A-Za-z0-9@_+.-]+$/.test(part));
    if(!urn&&!source)fail('INVALID_INPUT','Safe product source path or EvoPilot URN required');
  }else fail('INVALID_INPUT','Unknown distribution provenance kind');
}

function references(value:unknown,artifacts:Set<string>,used:Set<string>):void {
  if(!Array.isArray(value)||!value.length||value.length>DISTRIBUTION_LIMITS.artifacts)fail('INVALID_INPUT','Bounded nonempty artifact references required');
  const seen=new Set<string>();
  for(const entry of value){
    id(entry);
    if(seen.has(entry)||!artifacts.has(entry))fail('INVALID_INPUT','Duplicate or unknown artifact reference');
    seen.add(entry);used.add(entry);
  }
}

/** Valid metadata describes selected artifacts; it does not authenticate their
 * origins, inspect archive contents, execute tools or establish legal approval. */
export function validateDistributionManifest(value:unknown):asserts value is DistributionManifest {
  plain(value,['schema','id','platform','compatibility','artifacts','components','limitations']);
  if(value.schema!=='ontology-tool-distribution/v1')fail('INVALID_INPUT','Unknown distribution manifest schema');
  id(value.id);
  const platform=value.platform;plain(platform,['os','arch','libc','minimumLibc']);text(platform.minimumLibc,40);
  if(platform.os!=='linux'||!['arm64','x64'].includes(platform.arch as string)||platform.libc!=='glibc'||!/^\d+\.\d+$/.test(platform.minimumLibc))fail('INVALID_INPUT','Explicit Linux platform and glibc minimum required');
  const compatibility=value.compatibility;plain(compatibility,['nodeVersion','workerSourceDigest','dependencyLockDigest','shaclAdapterDigest']);
  if(compatibility.nodeVersion!=='24.14.0')fail('INVALID_INPUT','Pinned distribution Node version required');
  digest(compatibility.workerSourceDigest);digest(compatibility.dependencyLockDigest);digest(compatibility.shaclAdapterDigest);
  if(!Array.isArray(value.artifacts)||!value.artifacts.length||value.artifacts.length>DISTRIBUTION_LIMITS.artifacts)fail('DISTRIBUTION_LIMIT','Bounded nonempty distribution artifacts required',413);
  const artifactIds=new Set<string>(),filenames=new Set<string>();let artifactBytes=0;
  for(const artifact of value.artifacts){
    plain(artifact,['id','filename','bytes','digest','format','origin']);id(artifact.id);text(artifact.filename,180);digest(artifact.digest);
    const filename=artifact.filename.toLowerCase();
    if(!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,179}$/.test(artifact.filename)||filenames.has(filename)||artifactIds.has(artifact.id))fail('INVALID_INPUT','Unique artifact identity and flat filename required');
    if(!['tar.gz','tar.zst','tar','json','text','file'].includes(artifact.format as string))fail('INVALID_INPUT','Unknown distribution artifact format');
    positive(artifact.bytes,DISTRIBUTION_LIMITS.artifactBytes);artifactBytes=addWithin(artifactBytes,artifact.bytes,DISTRIBUTION_LIMITS.totalArtifactBytes);
    origin(artifact.origin);artifactIds.add(artifact.id);filenames.add(filename);
  }
  if(!Array.isArray(value.components)||value.components.length!==4)fail('INVALID_INPUT','Exactly four formal tool components required');
  const roles=new Set<string>(),used=new Set<string>();let expandedBytes=0;
  for(const component of value.components){
    plain(component,['role','version','artifactIds','provenanceArtifactIds','noticeArtifactIds','declaredExpandedBytes','declaredEntries','preparation']);text(component.version,512);
    if(!['dl','java','python','shacl'].includes(component.role as string)||roles.has(component.role as string))fail('INVALID_INPUT','Each formal component role must occur exactly once');
    const preparation=component.role==='python'?'FINAL_PATH_VENV':component.role==='shacl'?'COPY':'EXTRACT';
    if(component.preparation!==preparation)fail('INVALID_INPUT','Preparation requirement differs from the component role');
    positive(component.declaredEntries,DISTRIBUTION_LIMITS.componentEntries);positive(component.declaredExpandedBytes,DISTRIBUTION_LIMITS.totalExpandedBytes);
    expandedBytes=addWithin(expandedBytes,component.declaredExpandedBytes,DISTRIBUTION_LIMITS.totalExpandedBytes);
    for(const field of ['artifactIds','provenanceArtifactIds','noticeArtifactIds'])references(component[field],artifactIds,used);
    roles.add(component.role as string);
  }
  if(used.size!==artifactIds.size)fail('INVALID_INPUT','Every distribution artifact must belong to a component');
  if(!Array.isArray(value.limitations)||value.limitations.length>64)fail('DISTRIBUTION_LIMIT','Bounded distribution limitations required',413);
  for(const limitation of value.limitations)text(limitation,4096);
  // Every member has been checked above; no unbounded nesting or executable
  // values can reach serialization. Raw file byte limits are also enforced by
  // the reader before parsing, since whitespace is part of artifact identity.
  if(Buffer.byteLength(JSON.stringify(value))>DISTRIBUTION_LIMITS.manifestBytes)fail('DISTRIBUTION_LIMIT','Distribution manifest exceeds byte budget',413);
}

/** Filesystem existence, physical identity and path separation belong to the
 * read-only inspector. No local platform compatibility is inferred here. */
export function validateDistributionInput(value:unknown):asserts value is DistributionInput {
  plain(value,['schema','bundleId','bundleRoot','runtimeRoot','runtimeDigest','toolRoot','installationRoot','workspaceRoot']);
  if(value.schema!=='ontology-distribution-inspect-input/v1')fail('INVALID_INPUT','Unknown distribution inspection schema');
  id(value.bundleId);digest(value.runtimeDigest);
  for(const field of ['bundleRoot','runtimeRoot','toolRoot','installationRoot','workspaceRoot']){
    const path=value[field];text(path,4096);
    if(!isAbsolute(path)||resolve(path)!==path||path.includes('\\'))fail('UNSAFE_PATH','Canonical absolute distribution roots required');
  }
}
