import {nativeSha256,nativeBytesDigest,nativeFrozenClone,nativeStableSerialize,referenceForPackage,validateNativePackage} from '../vendor/compatibility/v1/native.mjs';
import type {NativePackage,NativeScope,NativeReference} from '../vendor/compatibility/v1/native.mjs';
import type {FeedbackEnvelope} from '../vendor/compatibility/feedback/v1/feedback.mjs';
import {readinessExact as nativeExact,READINESS_SPEC_PATH,READINESS_STANDARD,READINESS_STANDARD_DIGEST,assertReadinessVersion,validateReadinessSpecification,verifyReadinessProjection,readinessFail as fail} from '../vendor/compatibility/usability/v2/contract.mjs';
import type {ReadinessProjection} from '../vendor/compatibility/usability/v2/contract.mjs';
export const READINESS_ONTOLOGY_OPERATIONS=['readiness.standard.inspect','readiness.package.inspect','readiness.package.export','readiness.package.verify'] as const;
/** This is an additive projection of a native package; publication still belongs to the native lifecycle. */
export function projectReadinessPackage(pkg:NativePackage,workspaceId:string,scope:NativeScope,published:boolean):ReadinessProjection{
  validateNativePackage(pkg,{owner:'ontology'});
  if(pkg.manifest.visibility!==scope.visibility)fail('READINESS_SCOPE');
  const content=pkg.files[READINESS_SPEC_PATH];if(typeof content!=='string')fail('READINESS_SPECIFICATION_MISSING');
  let raw:unknown;try{raw=JSON.parse(content);}catch{fail('READINESS_SPECIFICATION_INVALID');}
  const specification=validateReadinessSpecification(raw),files:Record<string,string>={};
  for(const f of specification.normativeFiles){if(!Object.hasOwn(pkg.files,f.path)||nativeBytesDigest(pkg.files[f.path])!==f.digest)fail('READINESS_DEPENDENCY');files[f.path]=pkg.files[f.path];}
  const paths=new Set(specification.normativeFiles.map(f=>f.path));
  for(const s of specification.statements)for(const c of s.citations)if(!paths.has(c.path)||nativeBytesDigest(files[c.path])!==c.contentDigest)fail('READINESS_CITATION');
  const body={schema:'evopilot-readiness-projection/v2' as const,workspaceId,scope,reference:referenceForPackage(pkg),published,specification,specificationDigest:nativeSha256(specification),files,authority:false as const};
  const p={...body,digest:nativeSha256(body)};verifyReadinessProjection(p);return nativeFrozenClone(p);
}
export function createOntologyReadiness(workspaceId:string,read:(scope:NativeScope,id:string,version:string)=>Promise<{package:NativePackage;published:boolean;reference:NativeReference|null}>) {
  async function readiness(request:FeedbackEnvelope):Promise<unknown>{
    nativeExact(request,['operation','scope','input']);const {operation,input,scope}=request;assertReadinessVersion(input.standardVersion);
    if(operation==='readiness.standard.inspect'){nativeExact(input,['standardVersion']);return {...READINESS_STANDARD,standardDigest:READINESS_STANDARD_DIGEST,authority:false};}
    if(operation==='readiness.package.verify'){nativeExact(input,['standardVersion','projection']);const p=input.projection as ReadinessProjection;verifyReadinessProjection(p);if(p.workspaceId!==workspaceId||nativeStableSerialize(p.scope)!==nativeStableSerialize(scope))fail('READINESS_SCOPE');return {valid:true,digest:p.digest,authority:false,assetLevel:null};}
    if(!['readiness.package.inspect','readiness.package.export'].includes(operation))fail('READINESS_OPERATION');nativeExact(input,['standardVersion','id','version']);
    if(typeof input.id!=='string'||typeof input.version!=='string')fail('READINESS_ID');const record=await read(scope,input.id,input.version);
    const p=projectReadinessPackage(record.package,workspaceId,scope,record.published);
    if(record.reference&&nativeStableSerialize(record.reference)!==nativeStableSerialize(p.reference))fail('READINESS_INTEGRITY');
    return p;
  }
  return {readiness};
}
