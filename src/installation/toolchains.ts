import {existsSync,mkdirSync,readdirSync,realpathSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import type {Installation} from './manager.js';
import {readPrivate,writePrivate,assertSeparate,outsideSource} from './files.js';
import {fileDigest} from './runtime.js';
import {privatePath} from '../standalone/workspace.js';
import {exact,id,digest,hash,text} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {readDLToolchain,verifyDLToolchain} from '../reasoning/toolchain.js';
import {readSHACLToolchain,verifySHACLToolchain} from '../native-v2/shacl-toolchain.js';
import type {ReasoningConfiguration} from '../native-v2/tasks.js';
import {validateSystemdBinding,verifySystemdBinding} from './systemd-binding.js';
import type {SystemdBinding} from './systemd-binding.js';
import {requireWorkerMaintenanceComplete} from './worker-journal.js';

export interface ToolSelection {toolchainFile:string;toolchainDigest:string;}
export interface BindToolchainsInput {requestId:string;previousBindingDigest:string|null;dl:ToolSelection;shacl:ToolSelection;systemd?:SystemdBinding;}
export interface ManagedToolchains {
  schema:'ontology-managed-toolchain-binding/v1'|'ontology-managed-toolchain-binding/v2';systemd?:SystemdBinding;installationId:string;workspaceId:string;serviceId:string;runtimeDigest:string;
  requestId:string;requestDigest:string;previousDigest:string|null;dl:ToolSelection;shacl:ToolSelection;workRoot:string;recordedAt:string;
}
export interface ToolchainRecord {digest:string;binding:ManagedToolchains;}
interface Ledger {schema:'ontology-managed-toolchain-ledger/v1';installationId:string;records:ToolchainRecord[];}
const LIMIT=128;
function selection(value:unknown):asserts value is ToolSelection {
  exact(value,['toolchainFile','toolchainDigest']);digest(value.toolchainDigest);text(value.toolchainFile,4096);
  if(!isAbsolute(value.toolchainFile))fail('UNSAFE_PATH','Absolute private toolchain file required');
}
export function validateToolchainInput(value:unknown):asserts value is BindToolchainsInput {
  exact(value,['requestId','previousBindingDigest','dl','shacl'],['systemd']);id(value.requestId);if(value.previousBindingDigest!==null)digest(value.previousBindingDigest);selection(value.dl);selection(value.shacl);if(value.systemd!==undefined)validateSystemdBinding(value.systemd);
}
export function toolchainRequestDigest(i:Installation,input:BindToolchainsInput):string {
  validateToolchainInput(input);
  return hash({installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,runtimeDigest:i.runtime.digest,previousBindingDigest:input.previousBindingDigest,dl:{...input.dl},shacl:{...input.shacl},...(input.systemd?{systemd:input.systemd as unknown as Json}:{})});
}
export function readToolchainLedger(i:Installation,storageRoot=i.root):Ledger {
  const file=join(storageRoot,'toolchain-bindings.json');
  if(!existsSync(file)){
    const work=join(storageRoot,'formal-work');
    if(existsSync(work)){privatePath(work,true);if(readdirSync(work).length)fail('TOOLCHAIN_BINDING_MISSING','Managed worker state exists but its binding history is missing; explicit recovery required',409);}
    return {schema:'ontology-managed-toolchain-ledger/v1',installationId:i.installationId,records:[]};
  }
  const value=readPrivate(file,2*1024*1024);exact(value,['schema','installationId','records']);
  if(value.schema!=='ontology-managed-toolchain-ledger/v1'||value.installationId!==i.installationId||!Array.isArray(value.records)||!value.records.length||value.records.length>LIMIT)fail('TOOLCHAIN_BINDING_CORRUPT','Unknown or foreign toolchain ledger',409);
  let previous:string|null=null;const ids=new Set<string>();
  for(const entry of value.records){
    exact(entry,['digest','binding']);digest(entry.digest);const b=entry.binding;
    exact(b,['schema','installationId','workspaceId','serviceId','runtimeDigest','requestId','requestDigest','previousDigest','dl','shacl','workRoot','recordedAt'],['systemd']);
    if(b.schema==='ontology-managed-toolchain-binding/v2')validateSystemdBinding(b.systemd);
    else if(b.schema!=='ontology-managed-toolchain-binding/v1'||b.systemd!==undefined)fail('TOOLCHAIN_BINDING_CORRUPT','Unknown toolchain isolation contract',409);
    selection(b.dl);selection(b.shacl);id(b.requestId);digest(b.requestDigest);text(b.recordedAt,40);
    if(b.installationId!==i.installationId||b.workspaceId!==i.workspaceId||b.serviceId!==i.serviceId||b.runtimeDigest!==i.runtime.digest||b.previousDigest!==previous||b.workRoot!==join(i.root,'formal-work')||ids.has(b.requestId))fail('TOOLCHAIN_BINDING_CORRUPT','Toolchain history owner, parent or runtime differs',409);
    const input={requestId:b.requestId,previousBindingDigest:previous,dl:b.dl,shacl:b.shacl,...(b.systemd?{systemd:b.systemd as unknown as SystemdBinding}:{})};
    if(toolchainRequestDigest(i,input)!==b.requestDigest||hash(b as unknown as Json)!==entry.digest)fail('TOOLCHAIN_BINDING_CORRUPT','Toolchain receipt differs from its immutable identity',409);
    ids.add(b.requestId);previous=entry.digest;
  }
  return value as unknown as Ledger;
}
export function currentToolchainBinding(i:Installation):ToolchainRecord|null {return readToolchainLedger(i).records.at(-1)??null;}
const workOwner=(i:Installation)=>({schema:'ontology-managed-work/v1',installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,root:join(i.root,'formal-work')});
function workDirectory(i:Installation,create:boolean):string {
  const expected=workOwner(i),root=expected.root;
  if(create&&!existsSync(root))mkdirSync(root,{mode:0o700});
  privatePath(root,true);if(outsideSource(root)!==root)fail('UNSAFE_PATH','Canonical managed work directory required');
  const marker=join(root,'owner.json');
  if(create&&!existsSync(marker)){
    if(readdirSync(root).length)fail('WORK_ROOT_CONFLICT','Occupied worker directory has no matching owner record',409);
    writePrivate(marker,expected);
  }
  if(hash(readPrivate(marker) as Json)!==hash(expected))fail('WORK_ROOT_CONFLICT','Worker directory belongs to a different installation',409);
  requireWorkerMaintenanceComplete(root);
  return root;
}
/** Verification never downloads, rebuilds, edits or substitutes an executor. */
export function verifySelections(i:Installation,input:Pick<BindToolchainsInput,'dl'|'shacl'|'systemd'>):void {
  if(input.systemd)verifySystemdBinding(input.systemd);
  for(const selected of [input.dl,input.shacl]){
    selection(selected);if(realpathSync(selected.toolchainFile)!==selected.toolchainFile)fail('UNSAFE_PATH','Canonical toolchain file path required');
  }
  const dl=readDLToolchain(input.dl.toolchainFile),shacl=readSHACLToolchain(input.shacl.toolchainFile);
  if(dl.digest!==input.dl.toolchainDigest||shacl.digest!==input.shacl.toolchainDigest)fail('TOOLCHAIN_BINDING_DRIFT','Selected toolchain differs from its pinned digest',409);
  for(const root of [dl.root,dl.javaRoot,shacl.root,shacl.runtimeRoot]){
    if(outsideSource(root)!==root)fail('UNSAFE_PATH','Installed executor roots must be canonical and outside source');
    for(const owner of [i.root,i.workspaceRoot,i.runtime.root])assertSeparate(root,owner);
  }
  if(dl.workerSourceDigest!==fileDigest(join(i.runtime.packageRoot,'toolchains/owl2-dl/Worker.java'),2*1024*1024)||dl.dependencyLockDigest!==fileDigest(join(i.runtime.packageRoot,'toolchains/owl2-dl/dependencies.json'),2*1024*1024)||shacl.adapterDigest!==fileDigest(join(i.runtime.packageRoot,'src/native-v2/shacl-worker.py'),1024*1024))fail('PACKAGE_TOOLCHAIN_MISMATCH','Formal worker source/lock differs from the selected installed product package',409);
  verifyDLToolchain(dl);verifySHACLToolchain(shacl);
}
export function verifyManagedToolchains(i:Installation,record:ToolchainRecord|null,prepareWork=false):{reasoning?:ReasoningConfiguration;validation?:ReasoningConfiguration} {
  if(!record)return {};
  verifySelections(i,record.binding);const workRoot=workDirectory(i,prepareWork);
  const isolated=record.binding.systemd?{systemd:structuredClone(record.binding.systemd)}:{};
  return {reasoning:{toolchainFile:record.binding.dl.toolchainFile,workRoot,...isolated},validation:{toolchainFile:record.binding.shacl.toolchainFile,workRoot,...isolated}};
}
/** Caller holds installation and workspace leases, and has excluded unresolved tasks. */
export function recordToolchainBinding(i:Installation,input:BindToolchainsInput,ledger:Ledger):ToolchainRecord {
  validateToolchainInput(input);const previous=ledger.records.at(-1)?.digest??null;
  if(previous!==input.previousBindingDigest)fail('TOOLCHAIN_BINDING_CONFLICT','Current toolchain binding changed; inspect its original receipt',409);
  if(ledger.records.length>=LIMIT)fail('TOOLCHAIN_BINDING_LIMIT','Retained operator binding history reached its fixed budget',409);
  verifySelections(i,input);const workRoot=join(i.root,'formal-work');
  // Existing directories must be empty or prove their original owner before
  // committing. Creation after the receipt is resumable by an explicit start.
  if(existsSync(workRoot)){privatePath(workRoot,true);if(readdirSync(workRoot).length)workDirectory(i,false);}
  const binding:ManagedToolchains={schema:input.systemd?'ontology-managed-toolchain-binding/v2':'ontology-managed-toolchain-binding/v1',...(input.systemd?{systemd:structuredClone(input.systemd)}:{}),installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,runtimeDigest:i.runtime.digest,
    requestId:input.requestId,requestDigest:toolchainRequestDigest(i,input),previousDigest:previous,dl:{...input.dl},shacl:{...input.shacl},workRoot,recordedAt:new Date().toISOString()};
  const record={digest:hash(binding as unknown as Json),binding},next:Ledger={...ledger,records:[...ledger.records,record]};
  if(Buffer.byteLength(JSON.stringify(next))>2*1024*1024)fail('TOOLCHAIN_BINDING_LIMIT','Toolchain history byte limit reached',409);
  writePrivate(join(i.root,'toolchain-bindings.json'),next,true);workDirectory(i,true);return record;
}
