import {dirname,join} from 'node:path';
import {operatorLock,outsideSource} from './files.js';
import {readInstallation} from './manager.js';
import {readUpgradeAdmissionAtRoot,upgradeControlFile,upgradePermit,upgradeMarker,assertUpgradeReserve,releaseUpgradeReserve,clearUpgradeMarker} from './upgrade-control.js';
import type {UpgradeAdmission} from './upgrade-control.js';
import {validateInstallationUpgradeInput,prepareInstallationUpgradeLocked} from './upgrade-plan.js';
import type {InstallationUpgradeInput} from './upgrade-plan.js';
import {readUpgradePrepared,readUpgradeSwitch,prepareUpgradePrevious,upgradePositions,verifyUpgradeImages,assertUpgradeOwnerRoots,upgradeEqual,moveUpgradeComponent,restoreUpgradeComponentMode} from './upgrade-activation-files.js';
import type {UpgradeSwitch,UpgradePrepared} from './upgrade-activation-files.js';
import {readUpgradeStageOwner,syncUpgradeDirectory} from './upgrade-stage-files.js';
import type {UpgradeStageOwner} from './upgrade-stage-files.js';
import {backupNode,writeBackupJSON} from './backup-files.js';
import {backupHash} from './backup-contract.js';
import {workerFilePresent} from './worker-archives.js';
import {runtimeBindingDigest} from './runtime-history.js';
import {verifyRuntime} from './runtime.js';
import {verifySelections,verifyManagedToolchains} from './toolchains.js';
import {upgradeCompletedRelease,validateUpgradeCompletionEnvelope} from './upgrade-receipt.js';
import type {UpgradeCompletion,UpgradeReleased} from './upgrade-receipt.js';
import {privatePath,privateRead,privateLease,openWorkspace,requireMaintenanceAvailable,upgradeControlNames,upgradeControlKey,UPGRADE_BARRIER,FILES} from '../standalone/workspace.js';
import {digest,hashBytes} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

const eq=upgradeEqual;
function controls(a:UpgradeAdmission):void {
  const i=a.report.ownerSnapshot.installation,key=upgradeControlKey(a.input.requestId),names=upgradeControlNames(i.root).filter(n=>n.split('.')[0]===key);
  for(const suffix of ['.json','.stage.json','.switch.json','.completed.json','.released.json'])if(names.includes(key+suffix)&&names.includes(key+suffix+'.pending'))fail('UPGRADE_SWITCH_EVIDENCE','Ambiguous complete and partial upgrade records were preserved',409);
  if(names.some(n=>n===key+'.aborted.json'||n===key+'.aborted.json.pending'))fail('UPGRADE_ABORTED','The original upgrade was aborted; use a new inspected request',409);
  if(names.includes(key+'.json.pending')||names.includes(key+'.stage.json.pending'))fail('UPGRADE_STAGE_EVIDENCE','Complete original admission and staging before activation',409);
  if(names.includes(key+'.completed.json.pending')&&!names.includes(key+'.switch.json'))fail('UPGRADE_SWITCH_EVIDENCE','Partial completion lacks a durable switch record',409);
  if(names.includes(key+'.released.json')){
    const terminal=['.json','.stage.json','.switch.json','.completed.json','.released.json'].map(s=>key+s);
    if(names.length!==terminal.length||terminal.some(n=>!names.includes(n)))fail('UPGRADE_SWITCH_EVIDENCE','Released upgrade retains unresolved control material',409);
  }
  assertUpgradeReserve(a);
}
function markerCheck(a:UpgradeAdmission,root:string):void {
  const file=join(root,UPGRADE_BARRIER),expected=JSON.stringify(upgradeMarker(a,root))+'\n';
  if(workerFilePresent(file)&&workerFilePresent(file+'.pending'))fail('UPGRADE_SWITCH_EVIDENCE','Ambiguous owner maintenance markers were preserved',409);
  if(workerFilePresent(file)&&privateRead(file,65536)!==expected||workerFilePresent(file+'.pending')&&!expected.startsWith(privateRead(file+'.pending',65536)))fail('UPGRADE_SWITCH_EVIDENCE','Foreign owner maintenance marker was preserved',409);
}
function existingBarrierRoots(a:UpgradeAdmission):string[] {
  const p=a.report.ownerSnapshot,i=p.installation;return [i.root,i.workspaceRoot,...(p.toolchainBindingDigest!==null?[join(i.root,'formal-work')]:[])];
}
function settleExistingMarkers(a:UpgradeAdmission):void {
  for(const root of existingBarrierRoots(a))markerCheck(a,root);
  for(const root of existingBarrierRoots(a))if(workerFilePresent(join(root,UPGRADE_BARRIER)+'.pending'))writeBackupJSON(join(root,UPGRADE_BARRIER),upgradeMarker(a,root));
}
function blockOriginal(a:UpgradeAdmission):void {
  for(const root of existingBarrierRoots(a)){markerCheck(a,root);writeBackupJSON(join(root,UPGRADE_BARRIER),upgradeMarker(a,root));syncUpgradeDirectory(root);}
}
const result=(completion:UpgradeCompletion,replayed:boolean):Json=>({status:'COMPLETED',receipt:completion as unknown as Json,receiptDigest:backupHash(completion),replayed,runtimeActivated:true,serviceStarted:false,authority:false});
function completionValue(a:UpgradeAdmission,p:UpgradePrepared,owner:UpgradeStageOwner,s:UpgradeSwitch,images:ReturnType<typeof verifyUpgradeImages>):UpgradeCompletion {
  const i=images.installation;if(i.schema!=='ontology-installation/v2')fail('UPGRADE_SWITCH_EVIDENCE','Completed runtime lineage is missing',409);
  return {schema:'ontology-upgrade-completed/v1',requestId:a.input.requestId,requestDigest:a.requestDigest,reportDigest:a.reportDigest,preparedDigest:backupHash(p),stageOwnerDigest:backupHash(owner),switchDigest:backupHash(s),installationDigest:backupHash(i),runtimeBindingDigest:runtimeBindingDigest(i.runtime),runtimeDigest:i.runtime.digest,toolchainBindingDigest:images.binding?.digest??null,transitionDigest:i.runtimeHistory.records.at(-1)!.digest,recordedAt:p.recordedAt,runtimeActivated:true,serviceStarted:false,authority:false};
}
function completed(a:UpgradeAdmission,s:UpgradeSwitch,owner:UpgradeStageOwner):{completion:UpgradeCompletion;release:UpgradeReleased} {
  const value:unknown=JSON.parse(privateRead(upgradeControlFile(a,'.completed.json'),65536));
  const release=upgradeCompletedRelease(a,owner,s,value as UpgradeCompletion);validateUpgradeCompletionEnvelope(a,owner,s,value,release);return {completion:value,release};
}
/** Completion is durable before cleanup. Do not compare business DB/credentials
 * to the old snapshot here: earlier removed barriers may have allowed new work. */
function finishCleanup(a:UpgradeAdmission,s:UpgradeSwitch,c:UpgradeCompletion,release:UpgradeReleased):void {
  assertUpgradeOwnerRoots(a);const original=a.report.ownerSnapshot,i=original.installation,current=readInstallation(i.root),metadata=s.components.find(v=>v.name==='installation.json');
  if(!metadata||backupHash(current)!==c.installationDigest||!eq(backupNode(join(i.root,'installation.json'),false),metadata.next))fail('UPGRADE_CHANGED','Completed installation identity changed before barrier cleanup',409);
  const head=current.schema==='ontology-installation/v2'?current.runtimeHistory.records.at(-1):null;
  if(!head||head.digest!==c.transitionDigest||head.transition.recordedAt!==c.recordedAt||head.transition.toolchainBindingDigest!==c.toolchainBindingDigest||runtimeBindingDigest(current.runtime)!==c.runtimeBindingDigest||current.runtime.digest!==c.runtimeDigest)fail('UPGRADE_SWITCH_EVIDENCE','Completion does not describe the installed runtime transition',409);
  const identity=original.entries.find(e=>e.scope==='workspace'&&e.path===FILES.identity);
  if(!identity||!eq(backupNode(join(i.workspaceRoot,FILES.identity),false),{device:identity.device,inode:identity.inode,mode:identity.mode})||hashBytes(privateRead(join(i.workspaceRoot,FILES.identity),4096))!==identity.digest)fail('UPGRADE_CHANGED','Original workspace identity changed before cleanup',409);
  const roots=[i.root,i.workspaceRoot];
  if(c.toolchainBindingDigest!==null){
    const work=join(i.root,'formal-work'),fresh=s.components.find(v=>v.name==='formal-work'),old=original.entries.find(e=>e.scope==='installation'&&e.path==='formal-work'),node=fresh?.next??old;
    if(!node||!eq(backupNode(work),{device:node.device,inode:node.inode,mode:node.mode}))fail('UPGRADE_CHANGED','Completed worker root changed before cleanup',409);roots.push(work);
  }
  for(const root of roots){markerCheck(a,root);if(workerFilePresent(join(root,UPGRADE_BARRIER)+'.pending'))writeBackupJSON(join(root,UPGRADE_BARRIER),upgradeMarker(a,root));requireMaintenanceAvailable(root,upgradePermit(a));}
  const lease=privateLease(join(i.workspaceRoot,FILES.lease),'WORKSPACE_BUSY','Another writer owns this workspace');
  try{
    assertUpgradeOwnerRoots(a);for(const root of roots)markerCheck(a,root);
    syncUpgradeDirectory(dirname(upgradeControlFile(a,'.completed.json')));
    releaseUpgradeReserve(a);
    for(const root of roots)clearUpgradeMarker(a,root);
    writeBackupJSON(upgradeControlFile(a,'.released.json'),release);syncUpgradeDirectory(dirname(upgradeControlFile(a,'.released.json')));
  }finally{lease.close();}
}
/** Activate only the selected physically sealed candidate. Every old component
 * is preserved; after switch admission only exact forward recovery is allowed. */
export function activateInstallationUpgrade(path:string,input:InstallationUpgradeInput,expectedReportDigest:string,expectedPreparedDigest:string):Json {
  validateInstallationUpgradeInput(input);digest(expectedReportDigest);digest(expectedPreparedDigest);privatePath(path,true);const root=outsideSource(path),unlock=operatorLock(root);
  try{
    const a=readUpgradeAdmissionAtRoot(root,input.requestId);
    if(!eq(a.input,input)||a.reportDigest!==expectedReportDigest)fail('REQUEST_CONFLICT','Activation binds another exact upgrade input or report',409);
    controls(a);const owner=readUpgradeStageOwner(a);if(!owner)fail('UPGRADE_STAGE_EVIDENCE','Stage the exact admitted candidate before activation',409);
    let saved=readUpgradeSwitch(a);
    const completeFile=upgradeControlFile(a,'.completed.json'),releasedFile=upgradeControlFile(a,'.released.json');
    if(workerFilePresent(completeFile)){
      if(!saved)fail('UPGRADE_SWITCH_EVIDENCE','Completion lost its original switch record',409);
      const {completion,release}=completed(a,saved,owner);
      if(completion.preparedDigest!==expectedPreparedDigest)fail('REQUEST_CONFLICT','Completion binds another prepared candidate',409);
      if(workerFilePresent(releasedFile)){validateUpgradeCompletionEnvelope(a,owner,saved,completion,JSON.parse(privateRead(releasedFile,65536)));syncUpgradeDirectory(dirname(releasedFile));return result(completion,true);}
      finishCleanup(a,saved,completion,release);return result(completion,true);
    }
    if(workerFilePresent(releasedFile)||workerFilePresent(releasedFile+'.pending'))fail('UPGRADE_SWITCH_EVIDENCE','Release lacks a durable completion record',409);
    if(saved&&saved.preparedDigest!==expectedPreparedDigest)fail('REQUEST_CONFLICT','Switch binds another prepared candidate',409);
    const {prepared}=readUpgradePrepared(a,expectedPreparedDigest);settleExistingMarkers(a);
    for(const ownerRoot of existingBarrierRoots(a))requireMaintenanceAvailable(ownerRoot,upgradePermit(a));
    const store=openWorkspace(a.report.ownerSnapshot.installation.workspaceRoot,a.report.ownerSnapshot.installation,upgradePermit(a));
    let receipt:UpgradeCompletion;
    try{
      if(!saved){
        prepareInstallationUpgradeLocked(a.report.ownerSnapshot.installation,store,input,expectedReportDigest,upgradePermit(a),owner.node);
      }
      const selected=prepareUpgradePrevious(a,prepared,owner),initial=verifyUpgradeImages(a,prepared,selected,saved!==null);
      if(!saved&&initial.positions.some(p=>p.phase!=='READY'))fail('UPGRADE_SWITCH_EVIDENCE','Unadmitted component movement was preserved',409);
      const allInstalled=initial.positions.every(p=>p.phase==='INSTALLED'),pendingCompletion=completeFile+'.pending';
      assertUpgradeReserve(a,!saved||!allInstalled);
      if(workerFilePresent(pendingCompletion)&&(!allInstalled||!(JSON.stringify(completionValue(a,prepared,owner,selected,initial))+'\n').startsWith(privateRead(pendingCompletion,65536))))fail('UPGRADE_SWITCH_EVIDENCE','Partial completion differs from the fully installed candidate',409);
      if(workerFilePresent(pendingCompletion))verifyUpgradeImages(a,prepared,selected);
      verifyRuntime(initial.installation.runtime);if(initial.binding)verifySelections(initial.installation,initial.binding.binding);
      blockOriginal(a);store.guard();
      writeBackupJSON(upgradeControlFile(a,'.switch.json'),selected);syncUpgradeDirectory(dirname(upgradeControlFile(a,'.switch.json')));syncUpgradeDirectory(join(input.upgradeRoot,'previous'));syncUpgradeDirectory(input.upgradeRoot);saved=selected;
      for(const c of selected.components){
        let position=upgradePositions(a,selected,true).find(p=>p.component.name===c.name)!;
        const live=join(root,c.name),kept=join(input.upgradeRoot,'previous',c.name),next=join(input.upgradeRoot,'next',c.name);
        if(position.phase==='READY'&&c.previous)moveUpgradeComponent(live,kept,c,c.previous);
        position=upgradePositions(a,selected,true).find(p=>p.component.name===c.name)!;
        if(c.previous)restoreUpgradeComponentMode(kept,c,c.previous);
        if(position.phase!=='INSTALLED')moveUpgradeComponent(next,live,c,c.next);
        else restoreUpgradeComponentMode(live,c,c.next);
        // Re-sync both directories even when a prior process performed rename.
        syncUpgradeDirectory(root);syncUpgradeDirectory(dirname(kept));syncUpgradeDirectory(dirname(next));store.guard();
      }
      const final=verifyUpgradeImages(a,prepared,selected);
      if(final.positions.some(p=>p.phase!=='INSTALLED'))fail('UPGRADE_SWITCH_EVIDENCE','Not every candidate component reached its original owner location',409);
      verifyRuntime(final.installation.runtime);verifyManagedToolchains(final.installation,final.binding);
      receipt=completionValue(a,prepared,owner,selected,final);
      upgradeCompletedRelease(a,owner,selected,receipt);store.guard();releaseUpgradeReserve(a);writeBackupJSON(completeFile,receipt);syncUpgradeDirectory(dirname(completeFile));
    }finally{store.close();}
    finishCleanup(a,saved!,receipt!,upgradeCompletedRelease(a,owner,saved!,receipt!));return result(receipt!,false);
  }finally{unlock();}
}
