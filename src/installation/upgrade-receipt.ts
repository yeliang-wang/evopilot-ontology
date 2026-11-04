import {isAbsolute,resolve,join} from 'node:path';
import {exact,object,id,digest,hash,text,timestamp} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

export interface UpgradeCompletion {
  schema:'ontology-upgrade-completed/v1';requestId:string;requestDigest:string;reportDigest:string;
  preparedDigest:string;stageOwnerDigest:string;switchDigest:string;installationDigest:string;
  runtimeBindingDigest:string;runtimeDigest:string;toolchainBindingDigest:string|null;
  transitionDigest:string;recordedAt:string;runtimeActivated:true;serviceStarted:false;authority:false;
}
export interface UpgradeReleased {
  schema:'ontology-upgrade-released/v2';requestId:string;requestDigest:string;reportDigest:string;
  admissionDigest:string;stageDigest:string;switchDigest:string;completionDigest:string;authority:false;
}
const valueHash=(v:unknown):string=>hash(v as Json);
function mismatch():never {return fail('UPGRADE_EVIDENCE','Completed upgrade evidence differs from its exact admission, stage or switch',409);}
function path(v:unknown):asserts v is string {
  text(v,4096);if(!isAbsolute(v)||resolve(v)!==v)mismatch();
}
function node(v:unknown):void {
  exact(v,['device','inode','mode']);
  for(const k of ['device','inode'])if(typeof v[k]!=='string'||!/^\d{1,24}$/.test(v[k] as string))mismatch();
  if(!Number.isInteger(v.mode)||(v.mode as number)<0||(v.mode as number)>0o700||((v.mode as number)&0o077)!==0)mismatch();
}
function runtime(v:unknown):asserts v is Record<string,unknown> {
  exact(v,['root','packageRoot','version','digest','files','bytes','nodePath','nodeDigest','nodeVersion']);
  for(const k of ['root','packageRoot','nodePath'])path(v[k]);
  for(const k of ['version','nodeVersion'])text(v[k],40);
  for(const k of ['digest','nodeDigest'])digest(v[k]);
  if(v.packageRoot!==join(v.root as string,'node_modules/@evopilot-next/ontology')||![v.files,v.bytes].every(n=>Number.isSafeInteger(n)&&(n as number)>=0))mismatch();
}
/** Pure historical coherence check. Actual installation construction and live
 * filesystem verification remain the activation owner's responsibility. */
function completionBinding(admission:unknown,stage:unknown,switchRecord:unknown,completion:unknown):asserts completion is UpgradeCompletion {
  exact(admission,['schema','input','report','reportDigest','requestDigest','controlNode']);node(admission.controlNode);digest(admission.reportDigest);digest(admission.requestDigest);
  const input=admission.input;exact(input,['requestId','upgradeRoot','runtimeRoot','runtimeDigest','toolchains'],['resolutionsFile']);id(input.requestId);path(input.upgradeRoot);path(input.runtimeRoot);digest(input.runtimeDigest);if(input.resolutionsFile!==undefined)path(input.resolutionsFile);
  const report=admission.report;exact(report,['schema','status','requestId','upgradeRoot','ownerSnapshot','pluginPlan','pluginPlanDigest','toolchainDraft','toolchainsVerified','runtimeActivated','serviceStarted','productAcceptance','authority']);digest(report.pluginPlanDigest);
  const snapshot=report.ownerSnapshot;object(snapshot);const original=snapshot.installation;object(original);
  for(const k of ['installationId','workspaceId','serviceId'])id(original[k]);path(original.root);path(original.workspaceRoot);
  const plugin=report.pluginPlan;object(plugin);runtime(plugin.baseRuntime);runtime(plugin.newRuntime);runtime(original.runtime);const selected=plugin.newRuntime;
  if(snapshot.schema!=='ontology-backup-plan/v1'||!['ontology-installation/v1','ontology-installation/v2'].includes(original.schema as string)||plugin.schema!=='ontology-plugin-upgrade-plan/v1'||plugin.status!=='MERGED'||plugin.installationDigest!==valueHash(original)||valueHash(plugin.baseRuntime)!==valueHash(original.runtime)||valueHash(selected)===valueHash(original.runtime)||admission.schema!=='ontology-upgrade-admission/v1'||report.schema!=='ontology-installation-upgrade-plan/v1'||report.status!=='READY'||report.requestId!==input.requestId||report.upgradeRoot!==input.upgradeRoot||snapshot.backupRoot!==input.upgradeRoot||report.runtimeActivated!==false||report.serviceStarted!==false||report.productAcceptance!=='NOT_EVALUATED'||report.authority!==false||valueHash(report)!==admission.reportDigest||valueHash(plugin)!==report.pluginPlanDigest||selected.root!==input.runtimeRoot||selected.digest!==input.runtimeDigest)mismatch();
  if(valueHash({installationId:original.installationId,workspaceId:original.workspaceId,serviceId:original.serviceId,input,reportDigest:admission.reportDigest})!==admission.requestDigest)mismatch();
  exact(stage,['schema','requestId','requestDigest','reportDigest','installationId','workspaceId','serviceId','root','node']);node(stage.node);path(stage.root);
  if(stage.schema!=='ontology-upgrade-stage-owner/v1'||stage.root!==input.upgradeRoot||['installationId','workspaceId','serviceId'].some(k=>stage[k]!==original[k]))mismatch();
  exact(switchRecord,['schema','requestId','requestDigest','reportDigest','admissionDigest','stageOwnerDigest','preparedDigest','previousRoot','components']);node(switchRecord.previousRoot);
  for(const k of ['admissionDigest','stageOwnerDigest','preparedDigest'])digest(switchRecord[k]);
  if(switchRecord.schema!=='ontology-upgrade-switch/v1'||switchRecord.admissionDigest!==valueHash(admission)||switchRecord.stageOwnerDigest!==valueHash(stage)||!Array.isArray(switchRecord.components)||switchRecord.components.length<2||switchRecord.components.length>4)mismatch();
  const componentNames=new Set<string>();
  for(const c of switchRecord.components){
    exact(c,['name','kind','previous','next']);node(c.next);if(c.previous!==null)node(c.previous);
    if(typeof c.name!=='string'||!['plugin','toolchain-bindings.json','installation.json','formal-work'].includes(c.name)||componentNames.has(c.name)||c.kind!==(c.name==='plugin'||c.name==='formal-work'?'directory':'file')||['plugin','installation.json'].includes(c.name)&&c.previous===null)mismatch();
    componentNames.add(c.name);
  }
  if(!componentNames.has('plugin')||!componentNames.has('installation.json'))mismatch();
  exact(completion,['schema','requestId','requestDigest','reportDigest','preparedDigest','stageOwnerDigest','switchDigest','installationDigest','runtimeBindingDigest','runtimeDigest','toolchainBindingDigest','transitionDigest','recordedAt','runtimeActivated','serviceStarted','authority']);
  id(completion.requestId);timestamp(completion.recordedAt);
  for(const k of ['requestDigest','reportDigest','preparedDigest','stageOwnerDigest','switchDigest','installationDigest','runtimeBindingDigest','runtimeDigest','transitionDigest'])digest(completion[k]);
  if(completion.toolchainBindingDigest!==null)digest(completion.toolchainBindingDigest);
  for(const v of [stage,switchRecord,completion])if(v.requestId!==input.requestId||v.requestDigest!==admission.requestDigest||v.reportDigest!==admission.reportDigest)mismatch();
  if(completion.schema!=='ontology-upgrade-completed/v1'||completion.preparedDigest!==switchRecord.preparedDigest||completion.stageOwnerDigest!==valueHash(stage)||completion.switchDigest!==valueHash(switchRecord)||completion.runtimeBindingDigest!==valueHash(selected)||completion.runtimeDigest!==selected.digest||completion.runtimeActivated!==true||completion.serviceStarted!==false||completion.authority!==false)mismatch();
  const draft=report.toolchainDraft;
  if(draft===null){
    if(input.toolchains!==null||report.toolchainsVerified!==false||snapshot.toolchainBindingDigest!==null||completion.toolchainBindingDigest!==null||componentNames.has('toolchain-bindings.json')||componentNames.has('formal-work'))mismatch();
  }else{
    exact(draft,['schema','installationId','workspaceId','serviceId','runtimeDigest','requestId','requestDigest','previousDigest','dl','shacl','workRoot'],['systemd']);
    exact(input.toolchains,['dl','shacl'],['systemd']);path(draft.workRoot);digest(draft.requestDigest);if(draft.previousDigest!==null)digest(draft.previousDigest);
    for(const k of ['dl','shacl']){const bound=draft[k],selectedTool=input.toolchains[k];exact(bound,['toolchainFile','toolchainDigest']);exact(selectedTool,['toolchainFile','toolchainDigest']);path(bound.toolchainFile);digest(bound.toolchainDigest);path(selectedTool.toolchainFile);digest(selectedTool.toolchainDigest);if(valueHash(bound)!==valueHash(selectedTool))mismatch();}
    if(draft.systemd!==undefined)object(draft.systemd);if(input.toolchains.systemd!==undefined)object(input.toolchains.systemd);
    if(draft.schema!==(draft.systemd===undefined?'ontology-managed-toolchain-binding/v1':'ontology-managed-toolchain-binding/v2')||draft.systemd!==undefined&&(input.toolchains.systemd===undefined||valueHash(draft.systemd)!==valueHash(input.toolchains.systemd))||draft.systemd===undefined&&input.toolchains.systemd!==undefined||['installationId','workspaceId','serviceId'].some(k=>draft[k]!==original[k])||draft.workRoot!==join(original.root as string,'formal-work')||draft.requestId!==input.requestId||draft.runtimeDigest!==selected.digest||draft.previousDigest!==snapshot.toolchainBindingDigest||report.toolchainsVerified!==true||!componentNames.has('toolchain-bindings.json')||componentNames.has('formal-work')!==(snapshot.toolchainBindingDigest===null))mismatch();
    const request={installationId:original.installationId,workspaceId:original.workspaceId,serviceId:original.serviceId,runtimeDigest:selected.digest,previousBindingDigest:draft.previousDigest,dl:draft.dl,shacl:draft.shacl,...(draft.systemd!==undefined?{systemd:draft.systemd}:{})};
    if(valueHash(request)!==draft.requestDigest||valueHash({...draft,recordedAt:completion.recordedAt})!==completion.toolchainBindingDigest)mismatch();
  }
}
function releaseValue(admission:unknown,stage:unknown,switchRecord:unknown,completion:UpgradeCompletion):UpgradeReleased {
  return {schema:'ontology-upgrade-released/v2',requestId:completion.requestId,requestDigest:completion.requestDigest,reportDigest:completion.reportDigest,admissionDigest:valueHash(admission),stageDigest:valueHash(stage),switchDigest:valueHash(switchRecord),completionDigest:valueHash(completion),authority:false};
}
export function upgradeCompletedRelease(admission:unknown,stage:unknown,switchRecord:unknown,completion:UpgradeCompletion):UpgradeReleased {
  completionBinding(admission,stage,switchRecord,completion);return releaseValue(admission,stage,switchRecord,completion);
}
/** Receipt replay never reads an external stage or the current runtime/tools. */
export function validateUpgradeCompletionEnvelope(admission:unknown,stage:unknown,switchRecord:unknown,completion:unknown,released:unknown):asserts completion is UpgradeCompletion {
  completionBinding(admission,stage,switchRecord,completion);
  exact(released,['schema','requestId','requestDigest','reportDigest','admissionDigest','stageDigest','switchDigest','completionDigest','authority']);
  id(released.requestId);for(const k of ['requestDigest','reportDigest','admissionDigest','stageDigest','switchDigest','completionDigest'])digest(released[k]);
  if(valueHash(released)!==valueHash(releaseValue(admission,stage,switchRecord,completion)))mismatch();
}
