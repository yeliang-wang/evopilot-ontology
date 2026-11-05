import {lstatSync} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import type {Installation} from './manager.js';
import type {WorkspaceStore,MaintenancePermit} from '../standalone/workspace.js';
import {verifyRuntime} from './runtime.js';
import {readInstallation,currentRun} from './manager.js';
import {processPresent} from './control.js';
import {operatorLock,outsideSource,assertSeparate} from './files.js';
import {preparePluginUpgradeLocked} from './plugin-upgrade.js';
import type {PluginUpgradeInput} from './plugin-upgrade.js';
import {prepareToolchainBinding,readToolchainLedger} from './toolchains.js';
import type {BindToolchainsInput,ToolchainBindingDraft} from './toolchains.js';
import {inspectStoppedOwnerBackupPlan} from './backup.js';
import {backupControlRecords} from './backup-control.js';
import {backupHash,BACKUP_LIMITS} from './backup-contract.js';
import {backupNode} from './backup-files.js';
import type {NodeIdentity,BackupPlan} from './backup-contract.js';
import {requireRuntimeDestinationSeparate,requireRuntimeTransitionCandidate} from './runtime-history.js';
import {readDLToolchain} from '../reasoning/toolchain.js';
import {readSHACLToolchain} from '../native-v2/shacl-toolchain.js';
import {openWorkspace,privatePath,requireMaintenanceAvailable,upgradeControlKey,upgradeControlNames} from '../standalone/workspace.js';
import {requireFreshRecoveryRequest} from '../standalone/recovery.js';
import {exact,id,digest} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

export interface InstallationUpgradeInput extends PluginUpgradeInput {
  requestId:string;upgradeRoot:string;toolchains:Pick<BindToolchainsInput,'dl'|'shacl'|'systemd'>|null;
}
export interface InstallationUpgradePlan {
  schema:'ontology-installation-upgrade-plan/v1';status:'READY'|'PLUGIN_CONFLICT';requestId:string;upgradeRoot:string;
  ownerSnapshot:BackupPlan;pluginPlan:Json;pluginPlanDigest:string;toolchainDraft:ToolchainBindingDraft|null;
  toolchainsVerified:boolean;runtimeActivated:false;serviceStarted:false;productAcceptance:'NOT_EVALUATED';authority:false;
}
export interface InstallationUpgradePreparation {report:InstallationUpgradePlan;reportDigest:string;files:Map<string,Buffer>;}

/** The future transaction retains old plugin bytes by rename. Requiring an
 * absent sibling keeps staging on the installation filesystem and out of any
 * existing package/tool/owner subtree. Inspection never creates this path. */
function destination(i:ReturnType<typeof readInstallation>,input:InstallationUpgradeInput,admittedStage?:NodeIdentity):void {
  const p=input.upgradeRoot;
  if(typeof p!=='string'||!isAbsolute(p)||resolve(p)!==p||dirname(p)!==dirname(i.root))fail('UPGRADE_LOCATION','Upgrade staging must be an absent canonical sibling of the installation',409);
  privatePath(dirname(p),true);if(outsideSource(dirname(p))!==dirname(p))fail('UNSAFE_PATH','Canonical private upgrade parent required');
  for(const root of [i.root,i.workspaceRoot,input.runtimeRoot])assertSeparate(p,root);requireRuntimeDestinationSeparate(i,p);
  try{lstatSync(p);if(!admittedStage||backupHash(backupNode(p))!==backupHash(admittedStage))fail('UPGRADE_EXISTS','Upgrade destination is occupied; inspect the retained transaction instead',409);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(lstatSync(dirname(p)).dev!==lstatSync(i.root).dev)fail('UPGRADE_LOCATION','Upgrade staging and installation require the same filesystem',409);
}

/** Prepares one deterministic report under both owner leases. It proves the
 * stopped owner snapshot and candidate selections, not an activated upgrade.
 * The eventual transaction must compare this report before admitting writes. */
export function validateInstallationUpgradeInput(input:unknown):asserts input is InstallationUpgradeInput {
  exact(input,['requestId','upgradeRoot','runtimeRoot','runtimeDigest','toolchains'],['resolutionsFile']);id(input.requestId);digest(input.runtimeDigest);
  if(typeof input.runtimeRoot!=='string'||input.resolutionsFile!==undefined&&typeof input.resolutionsFile!=='string')fail('INVALID_INPUT','Explicit runtime and optional resolution file required');
  if(input.toolchains!==null)exact(input.toolchains,['dl','shacl'],['systemd']);
}

/** Internal composition entry. Caller owns both original owner leases. */
export function prepareInstallationUpgradeLocked(i:Installation,store:WorkspaceStore,input:InstallationUpgradeInput,expectedReportDigest?:string,permit?:MaintenancePermit,admittedStage?:NodeIdentity):InstallationUpgradePreparation {
  validateInstallationUpgradeInput(input);if(expectedReportDigest!==undefined)digest(expectedReportDigest);
  requireMaintenanceAvailable(i.root,permit);destination(i,input,admittedStage);
  if(permit?.operation!=='UPGRADE'&&upgradeControlNames(i.root).some(n=>n.split('.')[0]===upgradeControlKey(input.requestId)))fail('REQUEST_CONFLICT','Upgrade request already has retained control history; reconcile its exact receipt',409);
  const run=currentRun(i);
  if(run&&!['STOPPED','FAILED'].includes(run.state)&&processPresent(run.pid)!==false)fail('INSTALLATION_RUNNING','Stop the exact owner before inspecting an upgrade',409);

  requireFreshRecoveryRequest(store.identity,input.requestId);
  if(i.schema==='ontology-installation/v2'&&i.runtimeHistory.records.some(r=>r.transition.requestId===input.requestId))fail('REQUEST_CONFLICT','Upgrade request already has a runtime receipt; reconcile the original transaction',409);
  const ledger=readToolchainLedger(i),previous=ledger.records.at(-1)?.digest??null;
  if(input.toolchains===null&&previous!==null)fail('TOOLCHAIN_BINDING_MISSING','An upgrade cannot remove configured tools',409);
  const ownerSnapshot=upgradeOwnerSnapshot(inspectStoppedOwnerBackupPlan(i,store,input.upgradeRoot,backupControlRecords(i)),input.requestId);
  const pluginInput={runtimeRoot:input.runtimeRoot,runtimeDigest:input.runtimeDigest,...(input.resolutionsFile!==undefined?{resolutionsFile:input.resolutionsFile}:{})};
  const plugin=preparePluginUpgradeLocked(i,pluginInput,permit);
  requireRuntimeTransitionCandidate(i,plugin.runtime);
  let toolchainDraft:ToolchainBindingDraft|null=null;
  if(input.toolchains){
    const prospective={...i,runtime:plugin.runtime},bindingInput={...input.toolchains,requestId:input.requestId,previousBindingDigest:previous};
    toolchainDraft=prepareToolchainBinding(prospective,bindingInput,ledger);
    const dl=readDLToolchain(input.toolchains.dl.toolchainFile),shacl=readSHACLToolchain(input.toolchains.shacl.toolchainFile,plugin.runtime.packageRoot);
    for(const root of [dl.root,dl.javaRoot,shacl.root,shacl.runtimeRoot])assertSeparate(input.upgradeRoot,root);
    if(backupHash(prepareToolchainBinding(prospective,bindingInput,ledger))!==backupHash(toolchainDraft))fail('UPGRADE_CHANGED','Toolchain preparation changed during inspection',409);
  }
  store.guard();destination(i,input,admittedStage);
  const finalSnapshot=upgradeOwnerSnapshot(inspectStoppedOwnerBackupPlan(i,store,input.upgradeRoot,backupControlRecords(i)),input.requestId);
  if(backupHash(finalSnapshot)!==backupHash(ownerSnapshot))fail('UPGRADE_CHANGED','Owner state changed during upgrade inspection',409);
  verifyRuntime(plugin.runtime);
  const p=plugin.report as Record<string,Json>;
  const report:InstallationUpgradePlan={schema:'ontology-installation-upgrade-plan/v1',status:p.status==='MERGED'?'READY':'PLUGIN_CONFLICT',requestId:input.requestId,upgradeRoot:input.upgradeRoot,ownerSnapshot,pluginPlan:plugin.report,pluginPlanDigest:plugin.reportDigest,toolchainDraft,toolchainsVerified:toolchainDraft!==null,runtimeActivated:false,serviceStarted:false,productAcceptance:'NOT_EVALUATED',authority:false};
  if(Buffer.byteLength(JSON.stringify(report))>BACKUP_LIMITS.manifestBytes)fail('UPGRADE_LIMIT','Upgrade plan exceeds its metadata budget',413);
  const reportDigest=backupHash(report);
  if(expectedReportDigest!==undefined){
    if(expectedReportDigest!==reportDigest)fail('UPGRADE_CHANGED','Upgrade report is stale; inspect current owner and selections',409);
    if(report.status!=='READY')fail('PLUGIN_CONFLICT','Resolve plugin conflicts before admitting upgrade',409);
  }
  return {report,reportDigest,files:plugin.files};
}

/** Current request control files are covered by their own exact protocol.
 * Historical request files remain part of the stopped-owner snapshot. */
export function upgradeOwnerSnapshot(plan:BackupPlan,requestId:string):BackupPlan {
  const own=new Set(['.json','.json.pending','.reserve','.reserve.pending','.aborted.json','.aborted.json.pending','.released.json','.released.json.pending','.stage.json','.stage.json.pending','.switch.json','.switch.json.pending','.completed.json','.completed.json.pending'].map(s=>'upgrade-requests/'+upgradeControlKey(requestId)+s));
  return {...plan,entries:plan.entries.filter(e=>e.scope!=='installation'||e.path!=='upgrade-requests'&&!own.has(e.path))};
}
export function prepareInstallationUpgrade(path:string,input:InstallationUpgradeInput,expectedReportDigest?:string):InstallationUpgradePreparation {
  validateInstallationUpgradeInput(input);const i=readInstallation(path),unlock=operatorLock(i.root);
  try{
    requireMaintenanceAvailable(i.root);const run=currentRun(i);
    if(run&&!['STOPPED','FAILED'].includes(run.state)&&processPresent(run.pid)!==false)fail('INSTALLATION_RUNNING','Stop the exact owner before inspecting an upgrade',409);
    const store=openWorkspace(i.workspaceRoot,i);
    try{return prepareInstallationUpgradeLocked(i,store,input,expectedReportDigest);}finally{store.close();}
  }finally{unlock();}
}
export function inspectInstallationUpgrade(path:string,input:InstallationUpgradeInput):Json {
  const {report,reportDigest}=prepareInstallationUpgrade(path,input);return {report:report as unknown as Json,reportDigest,authority:false};
}
