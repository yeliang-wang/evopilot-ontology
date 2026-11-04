import {exact,id,digest,hash,timestamp} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {validateRuntimeBinding} from './runtime.js';
import type {RuntimeBinding} from './runtime.js';
import type {Installation} from './installation-contract.js';
import {assertSeparate} from './files.js';

export interface RuntimeTransition {
  schema:'ontology-runtime-transition/v1';installationId:string;workspaceId:string;serviceId:string;
  requestId:string;requestDigest:string;planDigest:string;previousDigest:string|null;
  fromRuntimeBindingDigest:string;runtime:RuntimeBinding;
  previousToolchainBindingDigest:string|null;toolchainBindingDigest:string|null;
  pluginPlanDigest:string;recordedAt:string;
}
export interface RuntimeTransitionRecord {digest:string;transition:RuntimeTransition;}
export interface RuntimeHistory {schema:'ontology-runtime-history/v1';initial:RuntimeBinding;initialInstallationDigest:string;setupDigest:string;records:RuntimeTransitionRecord[];}
export interface RuntimeTransitionInput {requestId:string;planDigest:string;runtime:RuntimeBinding;previousToolchainBindingDigest:string|null;toolchainBindingDigest:string|null;pluginPlanDigest:string;recordedAt:string;}
export const RUNTIME_HISTORY_LIMIT=128;
const valueHash=(v:unknown)=>hash(v as Json);
export const runtimeBindingDigest=(r:RuntimeBinding):string=>valueHash(r);
export const runtimeTransitionRequestDigest=(i:Pick<Installation,'installationId'|'workspaceId'|'serviceId'>,planDigest:string):string=>hash({installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,planDigest});
function original(i:Installation,initial:RuntimeBinding):Installation {
  if(i.schema==='ontology-installation/v2'){const {runtimeHistory:_,...rest}=i;return {...rest,schema:'ontology-installation/v1',runtime:initial};}
  return {...i,runtime:initial};
}
/** Pure structural validation; it never re-executes or requires a historical
 * runtime to be available. Active execution verifies the selected binding. */
export function validateRuntimeHistory(i:Installation&{schema:'ontology-installation/v2'}):void {
  if(Buffer.byteLength(JSON.stringify(i))>2*1024*1024)fail('RUNTIME_HISTORY_LIMIT','Runtime history byte budget reached',413);
  const h:unknown=i.runtimeHistory;exact(h,['schema','initial','initialInstallationDigest','setupDigest','records']);
  if(h.schema!=='ontology-runtime-history/v1'||!Array.isArray(h.records)||!h.records.length||h.records.length>RUNTIME_HISTORY_LIMIT)fail('RUNTIME_HISTORY','Missing or oversized versioned runtime history',409);
  validateRuntimeBinding(h.initial);digest(h.initialInstallationDigest);digest(h.setupDigest);
  if(valueHash(original(i,h.initial))!==h.initialInstallationDigest)fail('RUNTIME_HISTORY','Original installation metadata changed',409);
  for(const root of [i.root,i.workspaceRoot])assertSeparate(h.initial.root,root);
  let previous:string|null=null,current=h.initial;const ids=new Set<string>(),bindings=new Map([[current.digest,current]]);
  for(const r of h.records){
    exact(r,['digest','transition']);digest(r.digest);const t=r.transition;
    exact(t,['schema','installationId','workspaceId','serviceId','requestId','requestDigest','planDigest','previousDigest','fromRuntimeBindingDigest','runtime','previousToolchainBindingDigest','toolchainBindingDigest','pluginPlanDigest','recordedAt']);
    id(t.requestId);digest(t.requestDigest);digest(t.planDigest);digest(t.fromRuntimeBindingDigest);digest(t.pluginPlanDigest);timestamp(t.recordedAt);validateRuntimeBinding(t.runtime);
    for(const k of ['previousToolchainBindingDigest','toolchainBindingDigest'])if(t[k]!==null)digest(t[k]);
    const selected=runtimeBindingDigest(t.runtime);
    if(t.schema!=='ontology-runtime-transition/v1'||t.installationId!==i.installationId||t.workspaceId!==i.workspaceId||t.serviceId!==i.serviceId||t.previousDigest!==previous||t.fromRuntimeBindingDigest!==runtimeBindingDigest(current)||selected===t.fromRuntimeBindingDigest||ids.has(t.requestId))fail('RUNTIME_HISTORY','Runtime transition owner, parent or original selection differs',409);
    if(t.previousToolchainBindingDigest!==null&&t.toolchainBindingDigest===null||t.toolchainBindingDigest!==null&&t.toolchainBindingDigest===t.previousToolchainBindingDigest)fail('RUNTIME_HISTORY','An upgrade cannot remove configured tools or reuse an old runtime binding',409);
    if(bindings.has(t.runtime.digest)&&runtimeBindingDigest(bindings.get(t.runtime.digest)!)!==selected)fail('RUNTIME_HISTORY','One package digest cannot ambiguously name different retained runtime/Node bindings',409);
    for(const root of [i.root,i.workspaceRoot])assertSeparate(t.runtime.root,root);
    for(const prior of bindings.values())if(runtimeBindingDigest(prior)!==selected)assertSeparate(t.runtime.root,prior.root);
    if(t.requestDigest!==runtimeTransitionRequestDigest(i,t.planDigest as string)||valueHash(t)!==r.digest)fail('RUNTIME_HISTORY','Runtime transition receipt changed',409);
    bindings.set(t.runtime.digest,t.runtime);ids.add(t.requestId);previous=r.digest;current=t.runtime;
  }
  if(runtimeBindingDigest(i.runtime)!==runtimeBindingDigest(current))fail('RUNTIME_HISTORY','Current runtime differs from its retained transition head',409);
}
/** Input must come from a validated installation (or a validated backup plan).
 * Returning bindings does not attest current filesystem integrity. */
export function installationRuntimeBindings(i:Installation):RuntimeBinding[] {
  return i.schema==='ontology-installation/v1'?[i.runtime]:[i.runtimeHistory.initial,...i.runtimeHistory.records.map(r=>r.transition.runtime)];
}
export function runtimeForDigest(i:Installation,d:string):RuntimeBinding {
  const r=installationRuntimeBindings(i).find(r=>r.digest===d);if(!r)fail('RUNTIME_HISTORY_MISSING','Toolchain runtime is absent from this installation history',409);return r;
}
export function requireRuntimeDestinationSeparate(i:Installation,path:string):void {
  for(const r of installationRuntimeBindings(i))assertSeparate(path,r.root);
}
export function requireSelectedRuntimeLocation(i:Installation,runtime:RuntimeBinding):void {
  for(const root of [i.root,i.workspaceRoot])assertSeparate(runtime.root,root);
  for(const prior of installationRuntimeBindings(i))if(runtimeBindingDigest(prior)!==runtimeBindingDigest(runtime))assertSeparate(runtime.root,prior.root);
}
/** A ready upgrade must be representable by the immutable history contract. */
export function requireRuntimeTransitionCandidate(i:Installation,runtime:RuntimeBinding):void {
  validateRuntimeBinding(runtime);
  if(i.schema==='ontology-installation/v2'&&i.runtimeHistory.records.length>=RUNTIME_HISTORY_LIMIT)fail('RUNTIME_HISTORY_LIMIT','Runtime history count budget reached',409);
  const selected=runtimeBindingDigest(runtime);
  if(selected===runtimeBindingDigest(i.runtime))fail('RUNTIME_HISTORY','Candidate runtime is already selected',409);
  for(const prior of installationRuntimeBindings(i))if(prior.digest===runtime.digest&&runtimeBindingDigest(prior)!==selected)fail('RUNTIME_HISTORY','One package digest cannot name different retained runtime or Node bindings',409);
  requireSelectedRuntimeLocation(i,runtime);
}
/** Constructs a prospective immutable history record only. The upgrade owner
 * must durably stage/admit and activate this together with plugin/toolchains. */
export function appendRuntimeHistory(i:Installation,setupDigest:string,input:RuntimeTransitionInput):Installation&{schema:'ontology-installation/v2'} {
  exact(input,['requestId','planDigest','runtime','previousToolchainBindingDigest','toolchainBindingDigest','pluginPlanDigest','recordedAt']);digest(setupDigest);
  requireRuntimeTransitionCandidate(i,input.runtime);
  const history:RuntimeHistory=i.schema==='ontology-installation/v2'?structuredClone(i.runtimeHistory):{schema:'ontology-runtime-history/v1',initial:structuredClone(i.runtime),initialInstallationDigest:valueHash(i),setupDigest,records:[]};
  if(history.setupDigest!==setupDigest)fail('RUNTIME_HISTORY','Original setup bytes differ from retained history',409);
  if(history.records.length>=RUNTIME_HISTORY_LIMIT)fail('RUNTIME_HISTORY_LIMIT','Runtime history count budget reached',409);
  const transition:RuntimeTransition={schema:'ontology-runtime-transition/v1',installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,requestId:input.requestId,requestDigest:runtimeTransitionRequestDigest(i,input.planDigest),planDigest:input.planDigest,previousDigest:history.records.at(-1)?.digest??null,fromRuntimeBindingDigest:runtimeBindingDigest(i.runtime),runtime:structuredClone(input.runtime),previousToolchainBindingDigest:input.previousToolchainBindingDigest,toolchainBindingDigest:input.toolchainBindingDigest,pluginPlanDigest:input.pluginPlanDigest,recordedAt:input.recordedAt};
  history.records.push({digest:valueHash(transition),transition});
  const next={...i,schema:'ontology-installation/v2' as const,runtime:structuredClone(input.runtime),runtimeHistory:history};validateRuntimeHistory(next);return next;
}
