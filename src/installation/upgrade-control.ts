import {mkdirSync,readdirSync,lstatSync,unlinkSync,openSync,closeSync,fsyncSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {operatorLock,outsideSource} from './files.js';
import {readInstallation} from './manager.js';
import type {Installation} from './manager.js';
import {prepareInstallationUpgradeLocked,validateInstallationUpgradeInput} from './upgrade-plan.js';
import type {InstallationUpgradeInput,InstallationUpgradePlan,InstallationUpgradePreparation} from './upgrade-plan.js';
import {backupNode,writeBackupJSON} from './backup-files.js';
import {backupHash,validateBackupPlan,validateNode,BACKUP_LIMITS} from './backup-contract.js';
import type {NodeIdentity} from './backup-contract.js';
import {admittedUpgradeStageNode,preserveUpgradeStageForAbort,readUpgradeStageOwner} from './upgrade-stage-files.js';
import {workerFilePresent} from './worker-archives.js';
import {privatePath,privateRead,openWorkspace,requireMaintenanceAvailable,upgradeControlNames,upgradeControlKey,UPGRADE_BARRIER,UPGRADE_RECORDS} from '../standalone/workspace.js';
import type {UpgradeBarrier,MaintenancePermit,WorkspaceStore} from '../standalone/workspace.js';
import {exact,digest,id} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

export interface UpgradeAdmission {
  schema:'ontology-upgrade-admission/v1';input:InstallationUpgradeInput;report:InstallationUpgradePlan;
  reportDigest:string;requestDigest:string;controlNode:NodeIdentity;
}
const equal=(a:unknown,b:unknown)=>backupHash(a)===backupHash(b);
const sync=(root:string):void=>{const fd=openSync(root,'r');try{fsyncSync(fd);}finally{closeSync(fd);}};
const directory=(i:Installation)=>join(i.root,UPGRADE_RECORDS);
const file=(i:Installation,requestId:string,suffix='.json')=>join(directory(i),upgradeControlKey(requestId)+suffix);
const requestDigest=(i:Installation,input:InstallationUpgradeInput,reportDigest:string)=>backupHash({installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,input,reportDigest});
const permit=(a:UpgradeAdmission):MaintenancePermit=>({operation:'UPGRADE',requestId:a.input.requestId,requestDigest:a.requestDigest});
const roots=(a:UpgradeAdmission):string[]=>{
  const p=a.report.ownerSnapshot,i=p.installation,work=join(i.root,'formal-work');
  // Earlier internal admission candidates also marked empty, unconfigured
  // worker directories. Preserve their exact explicit-abort recovery path.
  const retained=p.entries.some(e=>e.scope==='installation'&&e.path==='formal-work')&&[UPGRADE_BARRIER,UPGRADE_BARRIER+'.pending'].some(n=>workerFilePresent(join(work,n)));
  return [i.root,i.workspaceRoot,...(p.toolchainBindingDigest!==null||retained?[work]:[])];
};
const marker=(a:UpgradeAdmission,root:string):UpgradeBarrier=>{
  const i=a.report.ownerSnapshot.installation;return {schema:'ontology-upgrade-barrier/v1',root,upgradeRoot:a.input.upgradeRoot,installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,requestId:a.input.requestId,requestDigest:a.requestDigest,reportDigest:a.reportDigest};
};
function validateAdmission(v:unknown,i:Installation):asserts v is UpgradeAdmission {
  exact(v,['schema','input','report','reportDigest','requestDigest','controlNode']);validateInstallationUpgradeInput(v.input);digest(v.reportDigest);digest(v.requestDigest);validateNode(v.controlNode);
  const p=v.report;exact(p,['schema','status','requestId','upgradeRoot','ownerSnapshot','pluginPlan','pluginPlanDigest','toolchainDraft','toolchainsVerified','runtimeActivated','serviceStarted','productAcceptance','authority']);validateBackupPlan(p.ownerSnapshot);digest(p.pluginPlanDigest);
  const original=p.ownerSnapshot.installation;
  if(v.schema!=='ontology-upgrade-admission/v1'||p.schema!=='ontology-installation-upgrade-plan/v1'||p.status!=='READY'||p.requestId!==v.input.requestId||p.upgradeRoot!==v.input.upgradeRoot||p.ownerSnapshot.backupRoot!==v.input.upgradeRoot||original.root!==i.root||original.workspaceRoot!==i.workspaceRoot||original.installationId!==i.installationId||original.workspaceId!==i.workspaceId||original.serviceId!==i.serviceId||backupHash(p)!==v.reportDigest||backupHash(p.pluginPlan)!==p.pluginPlanDigest||requestDigest(i,v.input,v.reportDigest)!==v.requestDigest||p.runtimeActivated!==false||p.serviceStarted!==false||p.authority!==false||p.productAcceptance!=='NOT_EVALUATED')fail('UPGRADE_EVIDENCE','Retained upgrade admission differs from owner, report or request',409);
}
function readAdmission(i:Installation,requestId:string):UpgradeAdmission {
  const a:unknown=JSON.parse(privateRead(file(i,requestId),BACKUP_LIMITS.manifestBytes));validateAdmission(a,i);
  if(a.input.requestId!==requestId)fail('UPGRADE_EVIDENCE','Upgrade record name differs from request',409);return a;
}
function anchors(a:UpgradeAdmission):void {
  const p=a.report.ownerSnapshot,i=p.installation;
  if(!equal(backupNode(i.root),p.roots.installation)||!equal(backupNode(i.workspaceRoot),p.roots.workspace)||!equal(backupNode(dirname(a.input.upgradeRoot)),p.targetParent)||!equal(backupNode(directory(i)),a.controlNode)||!equal(readInstallation(i.root),i))fail('UPGRADE_CHANGED','Original installation or physical owner changed',409);
  const work=p.entries.find(e=>e.scope==='installation'&&e.path==='formal-work');
  if(work&&!equal(backupNode(join(i.root,'formal-work')),{device:work.device,inode:work.inode,mode:work.mode}))fail('UPGRADE_CHANGED','Original worker directory was replaced',409);
}
function assertMarker(a:UpgradeAdmission,root:string):void {
  const path=join(root,UPGRADE_BARRIER),expected=JSON.stringify(marker(a,root))+'\n';
  if(workerFilePresent(path)&&workerFilePresent(path+'.pending'))fail('UPGRADE_EVIDENCE','Ambiguous complete and partial upgrade barriers were preserved',409);
  if(workerFilePresent(path)&&privateRead(path,65536)!==expected)fail('UPGRADE_PENDING','Another upgrade barrier was preserved',409);
  if(workerFilePresent(path+'.pending')&&!expected.startsWith(privateRead(path+'.pending',65536)))fail('UPGRADE_EVIDENCE','Foreign partial upgrade barrier was preserved',409);
}
/** Only complete already-admitted prefixes here. New barriers need both leases. */
function settleMarkers(a:UpgradeAdmission):void {
  anchors(a);for(const root of roots(a))assertMarker(a,root);
  for(const root of roots(a))if(workerFilePresent(join(root,UPGRADE_BARRIER)+'.pending'))writeBackupJSON(join(root,UPGRADE_BARRIER),marker(a,root));
}
function block(a:UpgradeAdmission):void {
  anchors(a);for(const root of roots(a))assertMarker(a,root);
  for(const root of roots(a))writeBackupJSON(join(root,UPGRADE_BARRIER),marker(a,root));
}
const reserveValue=(a:UpgradeAdmission)=>({schema:'ontology-upgrade-reserve/v1',requestId:a.input.requestId,requestDigest:a.requestDigest,padding:' '.repeat(BACKUP_LIMITS.completionReserveBytes)});
function reserve(a:UpgradeAdmission):void {
  const path=file(a.report.ownerSnapshot.installation,a.input.requestId,'.reserve');writeBackupJSON(path,reserveValue(a));
  if(lstatSync(path).blocks*512<BACKUP_LIMITS.completionReserveBytes)fail('UPGRADE_RESERVATION','Filesystem did not retain bounded completion-space allocation',409);
}
function removeExact(path:string,value:unknown,partial=false):void {
  if(!workerFilePresent(path))return;const before=backupNode(path,false),expected=JSON.stringify(value)+'\n',actual=privateRead(path,BACKUP_LIMITS.manifestBytes);
  if(partial?!expected.startsWith(actual):actual!==expected)fail('UPGRADE_EVIDENCE','Foreign control material was preserved',409);
  if(!equal(backupNode(path,false),before))fail('UPGRADE_EVIDENCE','Control file was replaced',409);unlinkSync(path);sync(dirname(path));
}
function assertSelection(a:UpgradeAdmission,input:InstallationUpgradeInput,expectedReportDigest:string):void {
  if(!equal(a.input,input)||a.reportDigest!==expectedReportDigest)fail('REQUEST_CONFLICT','Upgrade request binds another exact input or report',409);
}
const abortValue=(a:UpgradeAdmission)=>({schema:'ontology-upgrade-abort/v1',requestId:a.input.requestId,requestDigest:a.requestDigest,reportDigest:a.reportDigest,upgradeRoot:a.input.upgradeRoot,runtimeActivated:false,serviceStarted:false,partialMaterialRetained:true,authority:false});
const releasedValue=(a:UpgradeAdmission)=>({...(readUpgradeStageOwner(a)?{stageDigest:backupHash(readUpgradeStageOwner(a))}:{}),schema:'ontology-upgrade-released/v1',requestId:a.input.requestId,requestDigest:a.requestDigest,reportDigest:a.reportDigest,admissionDigest:backupHash(a),abortDigest:backupHash(abortValue(a)),authority:false});
function released(a:UpgradeAdmission):boolean {
  const i=a.report.ownerSnapshot.installation,path=file(i,a.input.requestId,'.released.json');if(!workerFilePresent(path))return false;
  if(!equal(JSON.parse(privateRead(path,65536)),releasedValue(a))||!equal(JSON.parse(privateRead(file(i,a.input.requestId,'.aborted.json'),65536)),abortValue(a)))fail('UPGRADE_EVIDENCE','Upgrade terminal receipt changed',409);
  // Replay only validates retained receipts, never current runtime health.
  return true;
}

export function readUpgradeAdmissionAtRoot(path:string,requestId:string):UpgradeAdmission {
  id(requestId);privatePath(path,true);const root=outsideSource(path);
  const v:unknown=JSON.parse(privateRead(join(root,UPGRADE_RECORDS,upgradeControlKey(requestId)+'.json'),BACKUP_LIMITS.manifestBytes));
  exact(v,['schema','input','report','reportDigest','requestDigest','controlNode']);
  const p=v.report;exact(p,['schema','status','requestId','upgradeRoot','ownerSnapshot','pluginPlan','pluginPlanDigest','toolchainDraft','toolchainsVerified','runtimeActivated','serviceStarted','productAcceptance','authority']);validateBackupPlan(p.ownerSnapshot);
  validateAdmission(v,p.ownerSnapshot.installation);
  if(p.ownerSnapshot.installation.root!==root||v.input.requestId!==requestId)fail('UPGRADE_EVIDENCE','Retained admission belongs to another root or request',409);return v;
}
export const upgradeControlFile=(a:UpgradeAdmission,suffix:string):string=>file(a.report.ownerSnapshot.installation,a.input.requestId,suffix);
export const upgradePermit=permit;
export const upgradeMarker=marker;
export function assertUpgradeReserve(a:UpgradeAdmission,required=false):void {
  const path=upgradeControlFile(a,'.reserve'),full=workerFilePresent(path),partial=workerFilePresent(path+'.pending'),expected=JSON.stringify(reserveValue(a))+'\n';
  if(full&&partial||required&&!full||full&&privateRead(path,BACKUP_LIMITS.manifestBytes)!==expected||partial&&!expected.startsWith(privateRead(path+'.pending',BACKUP_LIMITS.manifestBytes)))fail('UPGRADE_EVIDENCE','Completion reservation is missing or contains foreign control material',409);
}
export function releaseUpgradeReserve(a:UpgradeAdmission):void {
  assertUpgradeReserve(a);
  removeExact(upgradeControlFile(a,'.reserve'),reserveValue(a));removeExact(upgradeControlFile(a,'.reserve.pending'),reserveValue(a),true);
}
export function clearUpgradeMarker(a:UpgradeAdmission,root:string):void {assertMarker(a,root);removeExact(join(root,UPGRADE_BARRIER),marker(a,root));removeExact(join(root,UPGRADE_BARRIER)+'.pending',marker(a,root),true);}
function requireNoUpgradeSwitch(path:string,requestId:string):void {
  privatePath(path,true);const root=outsideSource(path),key=upgradeControlKey(requestId);
  if(['.switch.json','.switch.json.pending'].some(s=>workerFilePresent(join(root,UPGRADE_RECORDS,key+s))))fail('UPGRADE_SWITCH_PENDING','An admitted switch requires exact forward recovery; pre-switch operations are unavailable',409);
}

/** Internal transaction admission, deliberately not a public CLI command until
 * staging and activation are implemented. No runtime or tool ledger is changed. */
export function withInstallationUpgradeAdmission<T>(path:string,input:InstallationUpgradeInput,expectedReportDigest:string,work:(a:UpgradeAdmission,prepared:InstallationUpgradePreparation,store:WorkspaceStore,replayed:boolean)=>T,aborted:(a:UpgradeAdmission)=>T):T {
  validateInstallationUpgradeInput(input);digest(expectedReportDigest);requireNoUpgradeSwitch(path,input.requestId);const i=readInstallation(path),unlock=operatorLock(i.root);
  try{
    const names=upgradeControlNames(i.root),key=upgradeControlKey(input.requestId),saved=workerFilePresent(file(i,input.requestId))?readAdmission(i,input.requestId):null;
    for(const suffix of ['.json','.aborted.json','.released.json'])if(workerFilePresent(file(i,input.requestId,suffix))&&workerFilePresent(file(i,input.requestId,suffix)+'.pending'))fail('UPGRADE_EVIDENCE','Ambiguous complete and partial upgrade records were preserved',409);
    if(saved){assertSelection(saved,input,expectedReportDigest);if(released(saved))return aborted(saved);settleMarkers(saved);}
    const p:MaintenancePermit={operation:'UPGRADE',requestId:input.requestId,requestDigest:requestDigest(i,input,expectedReportDigest)};
    requireMaintenanceAvailable(i.root,p);const store=openWorkspace(i.workspaceRoot,i,p);
    try{
      if(names.some(n=>n===key+'.aborted.json'||n===key+'.aborted.json.pending'||n===key+'.released.json.pending'))fail('UPGRADE_ABORT_PENDING','Complete the original abort; admission cannot reverse a terminal decision',409);
      const prepared=prepareInstallationUpgradeLocked(i,store,input,expectedReportDigest,p,saved?admittedUpgradeStageNode(saved):undefined);
      if(!workerFilePresent(directory(i))){mkdirSync(directory(i),{mode:0o700});sync(i.root);}privatePath(directory(i),true);
      if(new Set([...names.map(n=>n.split('.')[0]),key]).size>128||names.length>1014)fail('UPGRADE_LIMIT','Upgrade control history lacks completion headroom',409);
      const a:UpgradeAdmission={schema:'ontology-upgrade-admission/v1',input,report:prepared.report,reportDigest:prepared.reportDigest,requestDigest:p.requestDigest,controlNode:backupNode(directory(i))};
      if(saved&&!equal(a,saved))fail('UPGRADE_CHANGED','Original admitted upgrade changed',409);
      const ownKey=upgradeControlKey(input.requestId),otherBytes=names.filter(n=>n.split('.')[0]!==ownKey).reduce((sum,n)=>sum+lstatSync(join(directory(i),n)).size,0);
      if(otherBytes+2*Buffer.byteLength(JSON.stringify(a))+2*BACKUP_LIMITS.completionReserveBytes+65536>64*1024*1024)fail('UPGRADE_LIMIT','Upgrade history lacks bounded completion space; nothing was pruned',409);
      writeBackupJSON(file(i,input.requestId),a);reserve(a);block(a);store.guard();anchors(a);
      return work(a,prepared,store,saved!==null);
    }finally{store.close();}
  }finally{unlock();}
}
export function admitInstallationUpgrade(path:string,input:InstallationUpgradeInput,expectedReportDigest:string):Json {
  return withInstallationUpgradeAdmission<Json>(path,input,expectedReportDigest,(a,_prepared,_store,replayed)=>({status:'ADMITTED',requestId:input.requestId,requestDigest:a.requestDigest,reportDigest:a.reportDigest,replayed,runtimeActivated:false,serviceStarted:false,authority:false}),(a)=>({status:'ABORTED',receipt:abortValue(a),replayed:true,authority:false}));
}
/** Explicit pre-switch abort. Original request/report may reconstruct an exact
 * interrupted admission prefix; it never grants permission to activate it. */
export function abortInstallationUpgrade(path:string,input:InstallationUpgradeInput,expectedReportDigest:string,retainedReport?:InstallationUpgradePlan):Json {
  validateInstallationUpgradeInput(input);digest(expectedReportDigest);requireNoUpgradeSwitch(path,input.requestId);const i=readInstallation(path),unlock=operatorLock(i.root);
  try{
    upgradeControlNames(i.root);
    for(const suffix of ['.json','.aborted.json','.released.json'])if(workerFilePresent(file(i,input.requestId,suffix))&&workerFilePresent(file(i,input.requestId,suffix)+'.pending'))fail('UPGRADE_EVIDENCE','Ambiguous complete and partial upgrade records were preserved',409);
    let a:UpgradeAdmission;
    if(workerFilePresent(file(i,input.requestId)))a=readAdmission(i,input.requestId);
    else{
      if(!retainedReport||!workerFilePresent(file(i,input.requestId)+'.pending'))fail('UPGRADE_ADMISSION_MISSING','Retain the original inspected report to reconcile an interrupted admission',409);
      a={schema:'ontology-upgrade-admission/v1',input,report:retainedReport,reportDigest:expectedReportDigest,requestDigest:requestDigest(i,input,expectedReportDigest),controlNode:backupNode(directory(i))};validateAdmission(a,i);
    }
    assertSelection(a,input,expectedReportDigest);
    if(released(a))return {status:'ABORTED',receipt:abortValue(a),replayed:true,authority:false};
    anchors(a);
    preserveUpgradeStageForAbort(a);
    settleMarkers(a);requireMaintenanceAvailable(i.root,permit(a));
    const store=openWorkspace(i.workspaceRoot,i,permit(a));
    try{
      anchors(a);for(const root of roots(a))assertMarker(a,root);
      writeBackupJSON(file(i,input.requestId),a);
      removeExact(file(i,input.requestId,'.reserve'),reserveValue(a));removeExact(file(i,input.requestId,'.reserve.pending'),reserveValue(a),true);
      writeBackupJSON(file(i,input.requestId,'.aborted.json'),abortValue(a));
      for(const root of roots(a)){removeExact(join(root,UPGRADE_BARRIER),marker(a,root));removeExact(join(root,UPGRADE_BARRIER)+'.pending',marker(a,root),true);}
      anchors(a);writeBackupJSON(file(i,input.requestId,'.released.json'),releasedValue(a));
      return {status:'ABORTED',receipt:abortValue(a),replayed:false,authority:false};
    }finally{store.close();}
  }finally{unlock();}
}
