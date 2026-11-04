import {mkdirSync,readdirSync,lstatSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,join,isAbsolute,resolve} from 'node:path';
import {outsideSource,assertSeparate,operatorLock} from './files.js';
import {requireRuntimeDestinationSeparate} from './runtime-history.js';
import {readInstallation} from './manager.js';
import type {Installation} from './manager.js';
import {inspectStoppedOwnerBackupPlan} from './backup.js';
import {backupControlRecords} from './backup-control.js';
import {backupInventory,backupNode,writeBackupJSON} from './backup-files.js';
import {backupHash,validateBackupPlan,validateNode,BACKUP_LIMITS} from './backup-contract.js';
import type {BackupPlan,NodeIdentity} from './backup-contract.js';
import {readVerifiedRestoreStage} from './restore-stage.js';
import {newRestoreGeneration,inspectRestoreState,prepareRestoreState,readPreparedRestoreLocation,withPreparedRestoreState} from './restore-state.js';
import {syncRestoreDirectory} from './restore-files.js';
import {workerFilePresent} from './worker-archives.js';
import {verifyRuntime} from './runtime.js';
import {currentToolchainBinding,verifyManagedToolchains} from './toolchains.js';
import {completedTaskWorkerEvidence} from '../native-v2/task-recovery.js';
import {privatePath,privateRead,privateLease,openWorkspace,requireMaintenanceAvailable,FILES,RESTORE_STAGE_BARRIER,RESTORE_ACTIVATION_BARRIER} from '../standalone/workspace.js';
import type {WorkspaceStore,RestoreActivationBarrier} from '../standalone/workspace.js';
import {exact,id,digest} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

type Selection={root:string;manifestDigest:string};
export interface RestoreActivationInput {installationRoot:string;snapshot:Selection;retained:Selection;recoveryRoot:string;requestId:string;}
interface Plan extends RestoreActivationInput {schema:'ontology-restore-activation-plan/v1';mode:'RETAINED_CURRENT';source:BackupPlan;workspaceParent:NodeIdentity;stateRows:number;}
interface Admission {schema:'ontology-restore-activation-admission/v1';plan:Plan;reportDigest:string;generation:string;}
interface Prepared {schema:'ontology-restore-activation-prepared/v1';requestDigest:string;manifestDigest:string;node:NodeIdentity;stageBarrier:Json;}
const eq=(a:unknown,b:unknown)=>backupHash(a)===backupHash(b);
const canonicalPath=(p:unknown):void=>{if(typeof p!=='string'||p.length>4096||!isAbsolute(p)||resolve(p)!==p)fail('UNSAFE_PATH','Canonical absolute restore path required');};
const inputOf=(p:Plan):RestoreActivationInput=>({installationRoot:p.installationRoot,snapshot:p.snapshot,retained:p.retained,recoveryRoot:p.recoveryRoot,requestId:p.requestId});
function input(v:unknown):asserts v is RestoreActivationInput {
  exact(v,['installationRoot','snapshot','retained','recoveryRoot','requestId']);id(v.requestId);canonicalPath(v.installationRoot);canonicalPath(v.recoveryRoot);
  for(const s of [v.snapshot,v.retained]){exact(s,['root','manifestDigest']);canonicalPath(s.root);digest(s.manifestDigest);}
}
const stateInput=(a:Admission)=>({snapshot:a.plan.snapshot,retained:a.plan.retained,root:join(a.plan.recoveryRoot,'state'),requestId:a.plan.requestId,generation:a.generation,rekeyExpiresAt:null});
const previousRoot=(a:Admission)=>join(a.plan.recoveryRoot,'previous-workspace');
const stateRoot=(a:Admission)=>join(a.plan.recoveryRoot,'state');
const candidateRoot=(a:Admission)=>join(stateRoot(a),'workspace');
const permit=(a:Admission)=>({requestId:a.plan.requestId,requestDigest:a.reportDigest});
function marker(a:Admission,root:string):RestoreActivationBarrier {const i=a.plan.source.installation;return {schema:'ontology-restore-activation-barrier/v1',root,recoveryRoot:a.plan.recoveryRoot,installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,...permit(a)};}
function roots(a:Admission):string[]{const i=a.plan.source.installation,work=join(i.root,'formal-work');return [i.workspaceRoot,i.root,...(workerFilePresent(work)?[work]:[])];}
function admissionFile(root:string):Admission {
  canonicalPath(root);privatePath(root,true);if(outsideSource(root)!==root)fail('UNSAFE_PATH','Canonical recovery root required');
  const v:unknown=JSON.parse(privateRead(join(root,'plan.json'),BACKUP_LIMITS.manifestBytes));exact(v,['schema','plan','reportDigest','generation']);digest(v.reportDigest);
  const p=v.plan;exact(p,['schema','mode','installationRoot','snapshot','retained','recoveryRoot','requestId','source','workspaceParent','stateRows']);input(inputOf(p as unknown as Plan));validateBackupPlan(p.source);validateNode(p.workspaceParent);
  if(v.schema!=='ontology-restore-activation-admission/v1'||p.schema!=='ontology-restore-activation-plan/v1'||p.mode!=='RETAINED_CURRENT'||p.recoveryRoot!==root||p.source.installation.root!==p.installationRoot||p.source.backupRoot!==root||!Number.isSafeInteger(p.stateRows)||(p.stateRows as number)<0||(p.stateRows as number)>500000||typeof v.generation!=='string'||!/^[a-f0-9]{32}$/.test(v.generation)||backupHash(p)!==v.reportDigest)fail('RESTORE_ACTIVATION_EVIDENCE','Invalid retained activation admission',409);
  return v as unknown as Admission;
}
function layout(a:Admission):void {
  const allowed=new Set(['plan.json','operator.sqlite','operator.sqlite-journal','completion.reserve','completion.reserve.pending','state','previous-workspace',...['prepared','switch','old-moved','new-installed','activated','aborted','released'].flatMap(n=>[n+'.json',n+'.json.pending'])]);
  for(const n of readdirSync(a.plan.recoveryRoot)){if(!allowed.has(n))fail('RESTORE_ACTIVATION_EVIDENCE','Unknown recovery material was preserved',409);const file=join(a.plan.recoveryRoot,n);privatePath(file,n==='state'||n==='previous-workspace');if(n.startsWith('operator.sqlite')&&lstatSync(file).size>65536)fail('RESTORE_ACTIVATION_EVIDENCE','Recovery lease control exceeds its budget',409);}
  if(!eq(backupNode(dirname(a.plan.recoveryRoot)),a.plan.source.targetParent)||!eq(backupNode(dirname(a.plan.source.installation.workspaceRoot)),a.plan.workspaceParent))fail('RESTORE_ACTIVATION_EVIDENCE','Recovery or workspace parent was replaced',409);
}
function prepared(a:Admission):Prepared {
  const v:unknown=JSON.parse(privateRead(join(a.plan.recoveryRoot,'prepared.json'),65536));exact(v,['schema','requestDigest','manifestDigest','node','stageBarrier']);digest(v.manifestDigest);validateNode(v.node);
  if(v.schema!=='ontology-restore-activation-prepared/v1'||v.requestDigest!==a.reportDigest)fail('RESTORE_ACTIVATION_EVIDENCE','Prepared state belongs to another activation',409);
  exact(v.stageBarrier,['schema','requestId','reportDigest','root','activation']);digest(v.stageBarrier.reportDigest);
  if(v.stageBarrier.schema!=='ontology-restore-state-barrier/v1'||v.stageBarrier.requestId!==a.plan.requestId||v.stageBarrier.root!==stateRoot(a)||v.stageBarrier.activation!=='BLOCKED')fail('RESTORE_ACTIVATION_EVIDENCE','Prepared barrier differs',409);
  return v as unknown as Prepared;
}
const reserveValue=(a:Admission)=>({schema:'ontology-restore-activation-reserve/v1',requestDigest:a.reportDigest,padding:' '.repeat(BACKUP_LIMITS.completionReserveBytes)});
function releaseReserve(a:Admission):void {
  const expected=JSON.stringify(reserveValue(a))+'\n';
  for(const suffix of ['','.pending']){const file=join(a.plan.recoveryRoot,'completion.reserve'+suffix);if(!workerFilePresent(file))continue;const raw=privateRead(file,BACKUP_LIMITS.completionReserveBytes+16384);
    if(suffix?!expected.startsWith(raw):raw!==expected)fail('RESTORE_ACTIVATION_EVIDENCE','Unknown completion reservation was preserved',409);unlinkSync(file);syncRestoreDirectory(a.plan.recoveryRoot);}
}
function assertMarker(a:Admission,physical:string,logical=physical):void {
  const file=join(physical,RESTORE_ACTIVATION_BARRIER),expected=JSON.stringify(marker(a,logical))+'\n';
  if(workerFilePresent(file)&&workerFilePresent(file+'.pending'))fail('RESTORE_ACTIVATION_EVIDENCE','Ambiguous complete and pending activation markers were preserved',409);
  if(workerFilePresent(file)&&privateRead(file,65536)!==expected)fail('RESTORE_ACTIVATION_PENDING','Another activation barrier was preserved',409);
  if(workerFilePresent(file+'.pending')&&!expected.startsWith(privateRead(file+'.pending',65536)))fail('RESTORE_ACTIVATION_EVIDENCE','Foreign partial activation marker was preserved',409);
}
function block(a:Admission):void {for(const root of roots(a))assertMarker(a,root);for(const root of roots(a))writeBackupJSON(join(root,RESTORE_ACTIVATION_BARRIER),marker(a,root));}
function assertInstallation(a:Admission):void {
  const p=a.plan,i=p.source.installation;
  if(!eq(readInstallation(i.root),i)||!eq(backupNode(i.root),p.source.roots.installation)||!eq(backupInventory(i,['installation']),p.source.entries.filter(e=>e.scope==='installation'))||!eq(backupControlRecords(i),p.source.priorBackups))fail('RESTORE_SOURCE_CHANGED','Current installation or worker history changed; no old snapshot may replace it',409);
}
function verifyCurrent(a:Admission,store:WorkspaceStore):void {
  const p=a.plan,actual=inspectStoppedOwnerBackupPlan(p.source.installation,store,p.recoveryRoot,backupControlRecords(p.source.installation));
  if(!eq(actual,p.source))fail('RESTORE_SOURCE_CHANGED','Current history, credentials, or physical owner differs from admission',409);
}
function newPlan(v:RestoreActivationInput,i:Installation,store:WorkspaceStore):Plan {
  const parent=dirname(v.recoveryRoot);if(outsideSource(parent)!==parent)fail('UNSAFE_PATH','Canonical private recovery parent required');privatePath(parent,true);
  for(const p of [i.root,i.workspaceRoot,i.runtime.root,v.snapshot.root,v.retained.root])assertSeparate(v.recoveryRoot,p);
  requireRuntimeDestinationSeparate(i,v.recoveryRoot);
  if(backupNode(parent).device!==backupNode(i.workspaceRoot).device||backupNode(dirname(i.workspaceRoot)).device!==backupNode(i.workspaceRoot).device)fail('RESTORE_FILESYSTEM','Select a recovery directory on the workspace filesystem, without moving a mount root',409);
  const current=readVerifiedRestoreStage(v.retained.root,v.retained.manifestDigest),prior=backupControlRecords(i);
  if(prior.some(r=>r.state==='PENDING'))fail('BACKUP_PENDING','Finish the original backup before restore',409);
  const source=inspectStoppedOwnerBackupPlan(i,store,v.recoveryRoot,prior),selected=current.plan.backup.manifest.plan;
  if(!eq(i,selected.installation)||!eq(source.roots,selected.roots)||!eq(source.entries,selected.entries)||source.toolchainBindingDigest!==selected.toolchainBindingDigest)fail('RESTORE_SOURCE_CHANGED','Retained stage is not the exact current stopped owner; capture it again',409);
  verifyManagedToolchains(i,currentToolchainBinding(i));
  // Inspection derives stable counts without admitting a generation or root.
  const state=inspectRestoreState({snapshot:v.snapshot,retained:v.retained,root:v.recoveryRoot,requestId:v.requestId,generation:newRestoreGeneration(),rekeyExpiresAt:null}) as unknown as {report:{rows:number}};
  return {schema:'ontology-restore-activation-plan/v1',mode:'RETAINED_CURRENT',...v,source,workspaceParent:backupNode(dirname(i.workspaceRoot)),stateRows:state.report.rows};
}
const switchValue=(a:Admission,p:Prepared)=>({schema:'ontology-restore-activation-switch/v1',requestDigest:a.reportDigest,manifestDigest:p.manifestDigest,previous:a.plan.source.roots.workspace,next:p.node});
const phaseValue=(a:Admission,p:Prepared,phase:'old-moved'|'new-installed')=>({schema:'ontology-restore-activation-phase/v1',requestDigest:a.reportDigest,phase,original:a.plan.source.installation.workspaceRoot,previous:previousRoot(a),next:p.node});
function checkDocument(a:Admission,name:string,value:unknown):void {if(privateRead(join(a.plan.recoveryRoot,name+'.json'),65536)!==JSON.stringify(value)+'\n')fail('RESTORE_ACTIVATION_EVIDENCE','Activation phase differs from original request',409);}
function positions(a:Admission,p:Prepared):{old:string;next:string} {
  const original=a.plan.source.installation.workspaceRoot,previous=previousRoot(a),candidate=candidateRoot(a),oldNode=a.plan.source.roots.workspace;
  const at=(path:string,node:NodeIdentity)=>workerFilePresent(path)&&eq(backupNode(path),node);
  if(at(original,oldNode)&&at(candidate,p.node)&&!workerFilePresent(previous))return {old:original,next:candidate};
  if(at(previous,oldNode)&&at(candidate,p.node)&&!workerFilePresent(original))return {old:previous,next:candidate};
  if(at(previous,oldNode)&&at(original,p.node)&&!workerFilePresent(candidate))return {old:previous,next:original};
  fail('RESTORE_LOCATION_CONFLICT','Original, preserved and prepared directories have an unproven arrangement; all material was preserved',409);
}
function verifyPrevious(a:Admission,location:string):void {
  const i=a.plan.source.installation;assertMarker(a,location,i.workspaceRoot);
  if(!eq(backupNode(location),a.plan.source.roots.workspace)||!eq(backupInventory({...i,workspaceRoot:location},['workspace']),a.plan.source.entries.filter(e=>e.scope==='workspace')))fail('RESTORE_SOURCE_CHANGED','Original workspace evidence changed; cutover cannot infer a safe replacement',409);
}
const receipt=(a:Admission,p:Prepared)=>({schema:'ontology-restore-activation-receipt/v1',requestId:a.plan.requestId,reportDigest:a.reportDigest,manifestDigest:p.manifestDigest,installationId:a.plan.source.installation.installationId,workspaceId:a.plan.source.installation.workspaceId,serviceId:a.plan.source.installation.serviceId,workspaceRoot:a.plan.source.installation.workspaceRoot,previousWorkspaceRoot:previousRoot(a),requestIdPrefix:'r'+a.generation+'.',credentialPolicy:'PRESERVED_CURRENT',workerStorage:'ORIGINAL_INODES',cutover:'COMMITTED',authority:false});
const abortReceipt=(a:Admission)=>({schema:'ontology-restore-activation-abort/v1',requestId:a.plan.requestId,reportDigest:a.reportDigest,partialStateRetained:true,cutover:'NOT_STARTED',authority:false});
const releaseValue=(a:Admission,state:'ACTIVATED'|'ABORTED')=>({schema:'ontology-restore-activation-release/v1',requestDigest:a.reportDigest,state,authority:false});
function release(a:Admission,state:'ACTIVATED'|'ABORTED',p?:Prepared):void {
  const i=a.plan.source.installation,expected=state==='ACTIVATED'?p!.node:a.plan.source.roots.workspace;
  if(!eq(backupNode(i.root),a.plan.source.roots.installation)||!eq(backupNode(i.workspaceRoot),expected))fail('RESTORE_LOCATION_CONFLICT','Terminal cutover is retained but barrier cleanup requires its exact owner locations',409);
  for(const root of roots(a))assertMarker(a,root);
  const stage=join(i.workspaceRoot,RESTORE_STAGE_BARRIER);
  if(state==='ACTIVATED'&&workerFilePresent(stage+'.pending'))fail('RESTORE_ACTIVATION_EVIDENCE','Unproven partial candidate barrier was preserved',409);
  if(state==='ACTIVATED'&&workerFilePresent(stage)&&privateRead(stage,65536)!==JSON.stringify(p!.stageBarrier)+'\n')fail('RESTORE_ACTIVATION_EVIDENCE','Foreign candidate barrier was preserved',409);
  // Workspace's non-bypassable stage marker is the final release boundary.
  for(const root of roots(a).reverse()){
    const file=join(root,RESTORE_ACTIVATION_BARRIER);
    if(workerFilePresent(file+'.pending'))writeBackupJSON(file,marker(a,root));
    if(workerFilePresent(file)){unlinkSync(file);syncRestoreDirectory(root);}
  }
  if(state==='ACTIVATED'&&workerFilePresent(stage)){unlinkSync(stage);syncRestoreDirectory(i.workspaceRoot);}
  writeBackupJSON(join(a.plan.recoveryRoot,'released.json'),releaseValue(a,state));
}
function replay(a:Admission):Json|null {
  const root=a.plan.recoveryRoot;
  if(workerFilePresent(join(root,'aborted.json'))){checkDocument(a,'aborted',abortReceipt(a));fail('RESTORE_ABORTED','The original activation was aborted; inspect its retained receipt',409);}
  if(!workerFilePresent(join(root,'activated.json')))return null;
  const p=prepared(a),r=receipt(a,p);checkDocument(a,'activated',r);
  if(workerFilePresent(join(root,'released.json')))checkDocument(a,'released',releaseValue(a,'ACTIVATED'));else release(a,'ACTIVATED',p);
  return {status:'ACTIVATED',receipt:r,replayed:true,verification:'NOT_RUN',serviceStarted:false,authority:false};
}
export function inspectRestoreActivation(v:RestoreActivationInput):Json {
  input(v);
  if(workerFilePresent(v.recoveryRoot)){
    const a=admissionFile(v.recoveryRoot);if(!eq(inputOf(a.plan),v))fail('REQUEST_CONFLICT','Recovery directory belongs to another request',409);
    let status='ADMITTED',r:Json=null;
    if(workerFilePresent(join(v.recoveryRoot,'aborted.json'))){r=abortReceipt(a);checkDocument(a,'aborted',r);status='ABORTED';}
    else if(workerFilePresent(join(v.recoveryRoot,'activated.json'))){r=receipt(a,prepared(a));checkDocument(a,'activated',r);status='CUTOVER_COMMITTED';}
    else for(const [name,s] of [['prepared','PREPARED'],['switch','SWITCH_ADMITTED'],['old-moved','ORIGINAL_PRESERVED'],['new-installed','REPLACEMENT_INSTALLED']])if(workerFilePresent(join(v.recoveryRoot,name+'.json'))){const p=prepared(a);if(name!=='prepared')checkDocument(a,name,name==='switch'?switchValue(a,p):phaseValue(a,p,name as 'old-moved'|'new-installed'));status=s;}
    if(workerFilePresent(join(v.recoveryRoot,'released.json'))){if(r===null)fail('RESTORE_ACTIVATION_EVIDENCE','Release lacks its terminal receipt',409);const state=status==='ABORTED'?'ABORTED':'ACTIVATED';checkDocument(a,'released',releaseValue(a,state));status=state;}
    return {status,reportDigest:a.reportDigest,receipt:r,verification:'NOT_RUN',authority:false};
  }
  const i=readInstallation(v.installationRoot),unlock=operatorLock(i.root);
  try{requireMaintenanceAvailable(i.root);const store=openWorkspace(i.workspaceRoot,i);try{const report=newPlan(v,i,store);return {status:'READY_TO_ACTIVATE',report:report as unknown as Json,reportDigest:backupHash(report),authority:false};}finally{store.close();}}finally{unlock();}
}
/** Activate reconciled drafts at the original workspace path while retaining
 * the current installation, worker inodes, grants and immutable history. */
export function activateRestore(v:RestoreActivationInput,expectedReportDigest:string):Json {
  input(v);digest(expectedReportDigest);let a=workerFilePresent(v.recoveryRoot)?admissionFile(v.recoveryRoot):null;
  if(a&&(!eq(inputOf(a.plan),v)||a.reportDigest!==expectedReportDigest))fail('REQUEST_CONFLICT','Activation differs from the admitted request',409);
  if(a&&workerFilePresent(join(v.recoveryRoot,'released.json'))){const result=replay(a);if(result)return result;fail('RESTORE_ACTIVATION_EVIDENCE','Release lacks its original activation',409);}
  const i=a?.plan.source.installation??readInstallation(v.installationRoot),unlockInstallation=operatorLock(i.root);let unlockRecovery:(()=>void)|undefined;
  try{
    if(!a){
      requireMaintenanceAvailable(i.root);const store=openWorkspace(i.workspaceRoot,i);
      try{
        const plan=newPlan(v,i,store);if(backupHash(plan)!==expectedReportDigest)fail('RESTORE_SOURCE_CHANGED','Inspected activation source changed before admission',409);
        if(workerFilePresent(v.recoveryRoot))fail('RESTORE_ACTIVATION_EVIDENCE','Unowned recovery root appeared; preserve it',409);
        mkdirSync(v.recoveryRoot,{mode:0o700});syncRestoreDirectory(dirname(v.recoveryRoot));
        a={schema:'ontology-restore-activation-admission/v1',plan,reportDigest:expectedReportDigest,generation:newRestoreGeneration()};writeBackupJSON(join(v.recoveryRoot,'plan.json'),a);
      }finally{store.close();}
    }
    unlockRecovery=operatorLock(v.recoveryRoot);layout(a);
    const old=replay(a);if(old)return old;
    const switchFile=join(v.recoveryRoot,'switch.json');
    if(!workerFilePresent(switchFile)){
      if(!eq(backupNode(i.root),a.plan.source.roots.installation)||!eq(backupNode(i.workspaceRoot),a.plan.source.roots.workspace))fail('RESTORE_SOURCE_CHANGED','Admitted owner locations changed',409);
      // Finish only already-owned partial markers before taking the writer
      // lease. Fresh barriers are admitted under that lease, after freshness
      // verification, so a concurrently started foreground owner is not fenced.
      for(const root of roots(a)){assertMarker(a,root);if(workerFilePresent(join(root,RESTORE_ACTIVATION_BARRIER+'.pending')))writeBackupJSON(join(root,RESTORE_ACTIVATION_BARRIER),marker(a,root));}
      requireMaintenanceAvailable(i.root,permit(a));const store=openWorkspace(i.workspaceRoot,i,permit(a));
      try{
        verifyCurrent(a,store);
        const reserve=join(v.recoveryRoot,'completion.reserve');writeBackupJSON(reserve,reserveValue(a));if(lstatSync(reserve).blocks*512<BACKUP_LIMITS.completionReserveBytes)fail('RESTORE_RESERVATION','Filesystem did not allocate activation completion headroom',409);
        block(a);
        if(workerFilePresent(join(v.recoveryRoot,'prepared.json'))){prepared(a);assertMarker(a,candidateRoot(a),i.workspaceRoot);if(workerFilePresent(join(candidateRoot(a),RESTORE_ACTIVATION_BARRIER+'.pending')))writeBackupJSON(join(candidateRoot(a),RESTORE_ACTIVATION_BARRIER),marker(a,i.workspaceRoot));}
        const params=stateInput(a),inspected=inspectRestoreState(params) as unknown as {reportDigest:string},done=prepareRestoreState(params,inspected.reportDigest) as unknown as {receipt:{manifestDigest:string}};
        const read=readPreparedRestoreLocation(stateRoot(a),done.receipt.manifestDigest,candidateRoot(a));
        if(read.plan.rows!==a.plan.stateRows)fail('RESTORE_SOURCE_CHANGED','Prepared history differs from inspected row closure',409);
        const binding=currentToolchainBinding(i),workRoots=binding?[binding.binding.workRoot]:[];
        withPreparedRestoreState(stateRoot(a),read.manifestDigest,s=>{const tasks=s.db.prepare('SELECT id,project_id FROM native_reasoning_tasks ORDER BY id LIMIT 4097').all();if(tasks.length>4096)fail('RESTORE_LIMIT','Prepared task history exceeds its budget',409);for(const t of tasks)completedTaskWorkerEvidence(s,String(t.project_id),String(t.id),workRoots);});
        const p:Prepared={schema:'ontology-restore-activation-prepared/v1',requestDigest:a.reportDigest,manifestDigest:read.manifestDigest,node:backupNode(candidateRoot(a)),stageBarrier:read.barrier};
        writeBackupJSON(join(v.recoveryRoot,'prepared.json'),p);assertMarker(a,candidateRoot(a),i.workspaceRoot);writeBackupJSON(join(candidateRoot(a),RESTORE_ACTIVATION_BARRIER),marker(a,i.workspaceRoot));
        verifyCurrent(a,store);verifyManagedToolchains(i,binding);releaseReserve(a);writeBackupJSON(switchFile,switchValue(a,p));
      }finally{store.close();}
    }
    const p=prepared(a);checkDocument(a,'switch',switchValue(a,p));assertInstallation(a);
    let location=positions(a,p);
    const oldLease=privateLease(join(location.old,FILES.lease),'WORKSPACE_BUSY','Original workspace still has a writer');let newLease:ReturnType<typeof privateLease>|undefined;
    try{
      newLease=privateLease(join(location.next,FILES.lease),'WORKSPACE_BUSY','Prepared workspace still has a writer');location=positions(a,p);
      assertMarker(a,location.next,i.workspaceRoot);if(privateRead(join(location.next,RESTORE_ACTIVATION_BARRIER),65536)!==JSON.stringify(marker(a,i.workspaceRoot))+'\n')fail('RESTORE_ACTIVATION_EVIDENCE','Candidate activation marker is missing',409);
      verifyPrevious(a,location.old);readPreparedRestoreLocation(stateRoot(a),p.manifestDigest,location.next);
      if(location.old===i.workspaceRoot){renameSync(i.workspaceRoot,previousRoot(a));syncRestoreDirectory(dirname(i.workspaceRoot));syncRestoreDirectory(v.recoveryRoot);}
      writeBackupJSON(join(v.recoveryRoot,'old-moved.json'),phaseValue(a,p,'old-moved'));verifyPrevious(a,previousRoot(a));
      location=positions(a,p);
      if(location.next===candidateRoot(a)){renameSync(candidateRoot(a),i.workspaceRoot);syncRestoreDirectory(stateRoot(a));syncRestoreDirectory(dirname(i.workspaceRoot));}
      writeBackupJSON(join(v.recoveryRoot,'new-installed.json'),phaseValue(a,p,'new-installed'));
      readPreparedRestoreLocation(stateRoot(a),p.manifestDigest,i.workspaceRoot);verifyPrevious(a,previousRoot(a));assertInstallation(a);
      verifyRuntime(i.runtime);verifyManagedToolchains(i,currentToolchainBinding(i));writeBackupJSON(join(v.recoveryRoot,'activated.json'),receipt(a,p));
    }finally{newLease?.close();oldLease.close();}
    release(a,'ACTIVATED',p);
    return {status:'ACTIVATED',receipt:receipt(a,p),replayed:false,verification:'VERIFIED',serviceStarted:false,authority:false};
  }finally{unlockRecovery?.();unlockInstallation();}
}
export function abortRestoreActivation(recoveryRoot:string,requestId:string,expectedReportDigest:string):Json {
  id(requestId);digest(expectedReportDigest);const a=admissionFile(recoveryRoot);
  if(a.plan.requestId!==requestId||a.reportDigest!==expectedReportDigest)fail('REQUEST_CONFLICT','Abort differs from original activation request',409);
  const r=abortReceipt(a),released=join(recoveryRoot,'released.json');
  if(workerFilePresent(join(recoveryRoot,'aborted.json'))&&workerFilePresent(released)){checkDocument(a,'aborted',r);checkDocument(a,'released',releaseValue(a,'ABORTED'));return {receipt:r,replayed:true,verification:'NOT_RUN',authority:false};}
  const i=a.plan.source.installation,unlockInstallation=operatorLock(i.root);let unlock:(()=>void)|undefined;
  try{
    unlock=operatorLock(recoveryRoot);
    layout(a);if(workerFilePresent(join(recoveryRoot,'switch.json'))||workerFilePresent(join(recoveryRoot,'activated.json')))fail('RESTORE_SWITCH_ADMITTED','The directory switch is admitted; resume the exact activation instead of rolling it back',409);
    if(workerFilePresent(join(recoveryRoot,'aborted.json'))){checkDocument(a,'aborted',r);release(a,'ABORTED');return {receipt:r,replayed:true,verification:'NOT_RUN',authority:false};}
    if(!eq(backupNode(i.root),a.plan.source.roots.installation)||!eq(backupNode(i.workspaceRoot),a.plan.source.roots.workspace))fail('RESTORE_SOURCE_CHANGED','Original owner location is no longer available for abort',409);
    const lease=privateLease(join(i.workspaceRoot,FILES.lease),'WORKSPACE_BUSY','Original workspace still has a writer');
    try{for(const root of roots(a))assertMarker(a,root);releaseReserve(a);writeBackupJSON(join(recoveryRoot,'aborted.json'),r);}finally{lease.close();}
    release(a,'ABORTED');return {receipt:r,replayed:false,verification:'NOT_RUN',authority:false};
  }finally{unlock?.();unlockInstallation();}
}
