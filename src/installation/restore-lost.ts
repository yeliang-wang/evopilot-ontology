import {mkdirSync,readdirSync,lstatSync,chmodSync,renameSync,unlinkSync} from 'node:fs';
import {join,dirname,isAbsolute,resolve} from 'node:path';
import {outsideSource,assertSeparate,operatorLock} from './files.js';
import {readInstallation,currentRun} from './manager.js';
import {processPresent} from './control.js';
import {verifyRuntime} from './runtime.js';
import {readToolchainLedger,verifySelections,verifyManagedToolchains} from './toolchains.js';
import {readDLToolchain} from '../reasoning/toolchain.js';
import {readSHACLToolchain} from '../native-v2/shacl-toolchain.js';
import {readVerifiedRestoreStage} from './restore-stage.js';
import {newRestoreGeneration,inspectRestoreState,prepareRestoreState,readPreparedRestoreLocation,withPreparedRestoreState} from './restore-state.js';
import {restoreStagedFile,syncRestoreDirectory} from './restore-files.js';
import {backupHash,validateBackupPlan,validateBackupRecord,validateNode,BACKUP_LIMITS,BACKUP_RECORDS} from './backup-contract.js';
import type {BackupPlan,BackupEntry,BackupRecord,NodeIdentity} from './backup-contract.js';
import {backupNode,backupInventory,writeBackupJSON} from './backup-files.js';
import {backupControlRecords} from './backup-control.js';
import {workerFilePresent} from './worker-archives.js';
import {WORKER_STORAGE,restoreWorkerStorage} from './worker-storage.js';
import {completedTaskWorkerEvidence} from '../native-v2/task-recovery.js';
import {privatePath,privateRead,privateLease,FILES,RESTORE_STAGE_BARRIER,RESTORE_ACTIVATION_BARRIER} from '../standalone/workspace.js';
import type {RestoreActivationBarrier} from '../standalone/workspace.js';
import {exact,id,digest,timestamp} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

export interface RestoreLostInput {snapshot:{root:string;manifestDigest:string};recoveryRoot:string;requestId:string;rekeyExpiresAt:string;}
interface Plan extends RestoreLostInput {schema:'ontology-restore-lost-plan/v1';source:BackupPlan;parents:{recovery:NodeIdentity;installation:NodeIdentity;workspace:NodeIdentity};stateRows:number;}
interface Admission {schema:'ontology-restore-lost-admission/v1';plan:Plan;reportDigest:string;generation:string;}
interface Prepared {schema:'ontology-restore-lost-prepared/v1';requestDigest:string;workspaceManifestDigest:string;workspace:NodeIdentity;stageBarrier:Json;installation:NodeIdentity;entries:BackupEntry[];backups:BackupRecord[];workerStorageDigest:string|null;}
const equal=(a:unknown,b:unknown)=>backupHash(a)===backupHash(b);
const path=(p:unknown):void=>{if(typeof p!=='string'||p.length>4096||!isAbsolute(p)||resolve(p)!==p)fail('UNSAFE_PATH','Canonical absolute recovery path required');};
const inputOf=(p:Plan):RestoreLostInput=>({snapshot:p.snapshot,recoveryRoot:p.recoveryRoot,requestId:p.requestId,rekeyExpiresAt:p.rekeyExpiresAt});
function input(v:unknown):asserts v is RestoreLostInput {exact(v,['snapshot','recoveryRoot','requestId','rekeyExpiresAt']);exact(v.snapshot,['root','manifestDigest']);path(v.snapshot.root);digest(v.snapshot.manifestDigest);path(v.recoveryRoot);id(v.requestId);timestamp(v.rekeyExpiresAt);}
const stateRoot=(a:Admission)=>join(a.plan.recoveryRoot,'state');
const installationRoot=(a:Admission)=>join(a.plan.recoveryRoot,'installation');
const workspaceRoot=(a:Admission)=>join(stateRoot(a),'workspace');
const stateInput=(a:Admission)=>({snapshot:a.plan.snapshot,retained:null,root:stateRoot(a),requestId:a.plan.requestId,generation:a.generation,rekeyExpiresAt:a.plan.rekeyExpiresAt});
function originalAbsent(p:Plan):void {for(const root of [p.source.installation.root,p.source.installation.workspaceRoot])if(workerFilePresent(root))fail('RESTORE_LOCATION_CONFLICT','Lost-owner restoration requires both original directories absent; occupied material was preserved',409);}
function sourceTools(p:Plan,storage:string):void {
  const i=p.source.installation;verifyRuntime(i.runtime);const ledger=readToolchainLedger(i,storage),binding=ledger.records.at(-1)??null,run=currentRun({...i,root:storage});
  if(binding?.digest!==(p.source.toolchainBindingDigest??undefined)&&!(binding===null&&p.source.toolchainBindingDigest===null))fail('RESTORE_EVIDENCE','Snapshot toolchain binding differs',409);
  if(run?.toolchainBindingDigest&&!ledger.records.some(r=>r.digest===run.toolchainBindingDigest))fail('TOOLCHAIN_BINDING_MISSING','Original run requires its retained binding',409);
  if(run&&!['STOPPED','FAILED'].includes(run.state)&&processPresent(run.pid)!==false)fail('LAUNCH_UNKNOWN','Snapshot launch is unresolved on this host; no PID was signalled',409);
  if(binding){
    verifySelections(i,binding.binding);const dl=readDLToolchain(binding.binding.dl.toolchainFile),shacl=readSHACLToolchain(binding.binding.shacl.toolchainFile);
    for(const external of [dl.root,dl.javaRoot,shacl.root,shacl.runtimeRoot])assertSeparate(p.recoveryRoot,external);
  }
}
function newPlan(v:RestoreLostInput):Plan {
  const stage=readVerifiedRestoreStage(v.snapshot.root,v.snapshot.manifestDigest),source=stage.plan.backup.manifest.plan,i=source.installation;
  const parentPaths={recovery:dirname(v.recoveryRoot),installation:dirname(i.root),workspace:dirname(i.workspaceRoot)};
  for(const parent of Object.values(parentPaths)){privatePath(parent,true);if(outsideSource(parent)!==parent)fail('UNSAFE_PATH','Canonical private recovery parents required');}
  for(const p of [i.root,i.workspaceRoot,i.runtime.root,v.snapshot.root,source.backupRoot])assertSeparate(v.recoveryRoot,p);
  assertSeparate(i.root,i.workspaceRoot);
  const parents={recovery:backupNode(parentPaths.recovery),installation:backupNode(parentPaths.installation),workspace:backupNode(parentPaths.workspace)};
  if(new Set(Object.values(parents).map(n=>n.device)).size!==1)fail('RESTORE_FILESYSTEM','Recovery and original owner parents must share a filesystem for atomic moves',409);
  const p:Plan={schema:'ontology-restore-lost-plan/v1',...v,source,parents,stateRows:0};originalAbsent(p);sourceTools(p,join(v.snapshot.root,'installation'));
  if(Date.parse(v.rekeyExpiresAt)<=Date.now()||Date.parse(v.rekeyExpiresAt)>Date.now()+30*86400000)fail('INVALID_INPUT','Recovery credential expiry must be within the next 30 days');
  const state=inspectRestoreState({snapshot:v.snapshot,retained:null,root:v.recoveryRoot,requestId:v.requestId,generation:newRestoreGeneration(),rekeyExpiresAt:v.rekeyExpiresAt}) as unknown as {report:{rows:number}};p.stateRows=state.report.rows;return p;
}
function admission(root:string):Admission {
  path(root);privatePath(root,true);if(outsideSource(root)!==root)fail('UNSAFE_PATH','Canonical recovery directory required');
  const v:unknown=JSON.parse(privateRead(join(root,'plan.json'),BACKUP_LIMITS.manifestBytes));exact(v,['schema','plan','reportDigest','generation']);digest(v.reportDigest);const p=v.plan;
  exact(p,['schema','snapshot','recoveryRoot','requestId','rekeyExpiresAt','source','parents','stateRows']);input(inputOf(p as unknown as Plan));validateBackupPlan(p.source);exact(p.parents,['recovery','installation','workspace']);for(const n of Object.values(p.parents))validateNode(n);
  if(v.schema!=='ontology-restore-lost-admission/v1'||p.schema!=='ontology-restore-lost-plan/v1'||p.recoveryRoot!==root||backupHash(p)!==v.reportDigest||typeof v.generation!=='string'||!/^[a-f0-9]{32}$/.test(v.generation)||!Number.isSafeInteger(p.stateRows)||(p.stateRows as number)<0||(p.stateRows as number)>500000)fail('RESTORE_EVIDENCE','Invalid lost-owner admission',409);
  return v as unknown as Admission;
}
function layout(a:Admission):void {
  const p=a.plan,i=p.source.installation,parents={recovery:dirname(p.recoveryRoot),installation:dirname(i.root),workspace:dirname(i.workspaceRoot)};
  for(const key of ['recovery','installation','workspace'] as const)if(!equal(backupNode(parents[key]),p.parents[key]))fail('RESTORE_EVIDENCE','Recovery destination parent was replaced',409);
  const allowed=new Set(['plan.json','operator.sqlite','operator.sqlite-journal','installation','state','completion.reserve','completion.reserve.pending',...['prepared','switch','installation-moved','workspace-moved','activated','aborted','released'].flatMap(n=>[n+'.json',n+'.json.pending'])]);
  for(const n of readdirSync(p.recoveryRoot)){if(!allowed.has(n))fail('RESTORE_EVIDENCE','Unknown recovery material was preserved',409);privatePath(join(p.recoveryRoot,n),n==='installation'||n==='state');if(n.startsWith('operator.sqlite')&&lstatSync(join(p.recoveryRoot,n)).size>65536)fail('RESTORE_LIMIT','Recovery lease is oversized',409);}
}
function marker(a:Admission,root:string):RestoreActivationBarrier {const i=a.plan.source.installation;return {schema:'ontology-restore-activation-barrier/v1',root,recoveryRoot:a.plan.recoveryRoot,installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,requestId:a.plan.requestId,requestDigest:a.reportDigest};}
function checkMarker(a:Admission,physical:string,logical:string,required=false):void {
  const file=join(physical,RESTORE_ACTIVATION_BARRIER),expected=JSON.stringify(marker(a,logical))+'\n',full=workerFilePresent(file),pending=workerFilePresent(file+'.pending');
  if(full&&pending||required&&!full||full&&privateRead(file,65536)!==expected||pending&&!expected.startsWith(privateRead(file+'.pending',65536)))fail('RESTORE_EVIDENCE','Missing, foreign or ambiguous activation barrier was preserved',409);
}
function block(a:Admission,physical:string,logical:string):void {checkMarker(a,physical,logical);writeBackupJSON(join(physical,RESTORE_ACTIVATION_BARRIER),marker(a,logical));}
function prepareInstallation(a:Admission):{entries:BackupEntry[];backups:BackupRecord[];workerStorageDigest:string|null} {
  const p=a.plan,i=p.source.installation,root=installationRoot(a),source=join(p.snapshot.root,'installation'),stage=readVerifiedRestoreStage(p.snapshot.root,p.snapshot.manifestDigest);
  if(!equal(stage.plan.backup.manifest.plan,p.source))fail('RESTORE_EVIDENCE','Original snapshot changed',409);
  if(!workerFilePresent(root)){mkdirSync(root,{mode:0o700});syncRestoreDirectory(p.recoveryRoot);}privatePath(root,true);block(a,root,i.root);
  const entries=p.source.entries.filter(e=>e.scope==='installation'),dirs=entries.filter(e=>e.kind==='directory').sort((a,b)=>a.path.split('/').length-b.path.split('/').length);
  const expected=new Map(entries.map(e=>[e.path,e]));
  const scan=(dir:string,prefix=''):void=>{
    for(const name of readdirSync(dir)){
      const relative=prefix?prefix+'/'+name:name,file=join(dir,name);
      if([RESTORE_ACTIVATION_BARRIER,RESTORE_ACTIVATION_BARRIER+'.pending','formal-work/'+RESTORE_ACTIVATION_BARRIER,'formal-work/'+RESTORE_ACTIVATION_BARRIER+'.pending','formal-work/'+WORKER_STORAGE,'formal-work/'+WORKER_STORAGE+'.pending'].includes(relative)){privatePath(file);continue;}
      if(relative===BACKUP_RECORDS){privatePath(file,true);continue;}
      const e=expected.get(relative);if(!e)fail('RESTORE_EVIDENCE','Unknown copied installation material was preserved',409);privatePath(file,e.kind==='directory');if(e.kind==='directory')scan(file,relative);
    }
  };scan(root);
  for(const e of dirs){const file=join(root,e.path);if(!workerFilePresent(file)){mkdirSync(file,{mode:0o700});syncRestoreDirectory(dirname(file));}privatePath(file,true);if(e.path==='formal-work')block(a,file,join(i.root,'formal-work'));}
  for(const e of entries)if(e.kind==='file'&&e.path!=='formal-work/'+WORKER_STORAGE)restoreStagedFile(join(source,e.path),e,join(root,e.path));
  const work=join(root,'formal-work'),workerStorageDigest=workerFilePresent(work)?restoreWorkerStorage(p.snapshot.root,p.snapshot.manifestDigest,work,p.requestId,a.reportDigest):null;
  const b=stage.plan.backup,selected:BackupRecord={schema:'ontology-backup-request/v1',installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,requestId:b.receipt.requestId,requestDigest:b.receipt.requestDigest,reportDigest:b.receipt.reportDigest,backupRoot:b.receipt.backupRoot,state:'COMPLETED',receipt:b.receipt};
  const backups=[...p.source.priorBackups,selected].sort((a,b)=>a.requestId.localeCompare(b.requestId));
  if(new Set(backups.map(r=>r.requestId)).size!==backups.length)fail('RESTORE_EVIDENCE','Ambiguous backup control projection',409);
  const controls=join(root,BACKUP_RECORDS);if(!workerFilePresent(controls)){mkdirSync(controls,{mode:0o700});syncRestoreDirectory(root);}
  const allowed=new Set(backups.flatMap(r=>[r.requestId+'.json',r.requestId+'.json.pending']));for(const name of readdirSync(controls))if(!allowed.has(name))fail('RESTORE_EVIDENCE','Unselected backup control material was preserved',409);
  for(const r of backups){validateBackupRecord(r,i);writeBackupJSON(join(controls,r.requestId+'.json'),r);}
  for(const e of [...dirs].reverse()){chmodSync(join(root,e.path),e.mode);syncRestoreDirectory(join(root,e.path));}
  chmodSync(root,p.source.roots.installation.mode);scan(root);sourceTools(p,root);
  if(!equal(backupControlRecords({...i,root}).sort((a,b)=>a.requestId.localeCompare(b.requestId)),backups))fail('RESTORE_EVIDENCE','Restored backup control history differs',409);
  const copied=backupInventory({...i,root},['installation']),strip=(e:BackupEntry)=>({path:e.path,kind:e.kind,mode:e.mode,bytes:e.bytes,digest:e.digest});
  if(!equal(copied.filter(e=>e.path!=='formal-work/'+WORKER_STORAGE).map(strip),entries.filter(e=>e.path!=='formal-work/'+WORKER_STORAGE).map(strip)))fail('RESTORE_EVIDENCE','Restored installation differs from original payloads',409);
  readVerifiedRestoreStage(p.snapshot.root,p.snapshot.manifestDigest);return {entries:copied,backups,workerStorageDigest};
}
function readPrepared(a:Admission):Prepared {
  const v:unknown=JSON.parse(privateRead(join(a.plan.recoveryRoot,'prepared.json'),BACKUP_LIMITS.manifestBytes));exact(v,['schema','requestDigest','workspaceManifestDigest','workspace','stageBarrier','installation','entries','backups','workerStorageDigest']);digest(v.workspaceManifestDigest);validateNode(v.workspace);validateNode(v.installation);
  if(v.workerStorageDigest!==null)digest(v.workerStorageDigest);
  if(v.schema!=='ontology-restore-lost-prepared/v1'||v.requestDigest!==a.reportDigest||!Array.isArray(v.entries)||v.entries.length>BACKUP_LIMITS.entries||!Array.isArray(v.backups)||v.backups.length>BACKUP_LIMITS.requests)fail('RESTORE_EVIDENCE','Invalid prepared owner',409);
  // Reuse the complete inventory validator, retaining required workspace rows.
  validateBackupPlan({...a.plan.source,entries:[...v.entries,...a.plan.source.entries.filter(e=>e.scope==='workspace')]});
  if(v.entries.some(e=>(e as BackupEntry).scope!=='installation'))fail('RESTORE_EVIDENCE','Foreign prepared inventory scope',409);
  for(const r of v.backups)validateBackupRecord(r,a.plan.source.installation);
  exact(v.stageBarrier,['schema','requestId','reportDigest','root','activation']);digest(v.stageBarrier.reportDigest);
  if(v.stageBarrier.schema!=='ontology-restore-state-barrier/v1'||v.stageBarrier.requestId!==a.plan.requestId||v.stageBarrier.root!==stateRoot(a)||v.stageBarrier.activation!=='BLOCKED')fail('RESTORE_EVIDENCE','Prepared workspace barrier differs',409);
  return v as unknown as Prepared;
}
const reserve=(a:Admission)=>({schema:'ontology-restore-lost-reserve/v1',reportDigest:a.reportDigest,padding:' '.repeat(BACKUP_LIMITS.completionReserveBytes)});
function freeReserve(a:Admission):void {const expected=JSON.stringify(reserve(a))+'\n';for(const suffix of ['','.pending']){const file=join(a.plan.recoveryRoot,'completion.reserve'+suffix);if(!workerFilePresent(file))continue;const raw=privateRead(file,BACKUP_LIMITS.completionReserveBytes+16384);if(suffix?!expected.startsWith(raw):raw!==expected)fail('RESTORE_EVIDENCE','Foreign completion reservation was preserved',409);unlinkSync(file);syncRestoreDirectory(a.plan.recoveryRoot);}}
const switchValue=(a:Admission,p:Prepared)=>({schema:'ontology-restore-lost-switch/v1',reportDigest:a.reportDigest,preparedDigest:backupHash(p)});
const phase=(a:Admission,p:Prepared,name:string)=>({schema:'ontology-restore-lost-phase/v1',reportDigest:a.reportDigest,preparedDigest:backupHash(p),phase:name});
const receipt=(a:Admission,p:Prepared)=>({schema:'ontology-restore-lost-receipt/v1',requestId:a.plan.requestId,reportDigest:a.reportDigest,workspaceManifestDigest:p.workspaceManifestDigest,installationId:a.plan.source.installation.installationId,workspaceId:a.plan.source.installation.workspaceId,serviceId:a.plan.source.installation.serviceId,requestIdPrefix:'r'+a.generation+'.',credentialPolicy:'REKEY_LOST_OWNER',workerStorageDigest:p.workerStorageDigest,cutover:'COMMITTED',authority:false});
const aborted=(a:Admission)=>({schema:'ontology-restore-lost-abort/v1',requestId:a.plan.requestId,reportDigest:a.reportDigest,partialStateRetained:true,cutover:'NOT_STARTED',authority:false});
const released=(a:Admission)=>({schema:'ontology-restore-lost-release/v1',reportDigest:a.reportDigest,authority:false});
function check(a:Admission,name:string,v:unknown):void {if(privateRead(join(a.plan.recoveryRoot,name+'.json'),BACKUP_LIMITS.manifestBytes)!==JSON.stringify(v)+'\n')fail('RESTORE_EVIDENCE','Original recovery phase differs',409);}
function locations(a:Admission,p:Prepared):{installation:string;workspace:string} {
  const i=a.plan.source.installation;
  const locate=(from:string,to:string,node:NodeIdentity):string=>{const f=workerFilePresent(from),t=workerFilePresent(to);if(f===t)fail('RESTORE_LOCATION_CONFLICT','Both or neither owner locations exist; material was preserved',409);const root=f?from:to;if(!equal(backupNode(root),node))fail('RESTORE_LOCATION_CONFLICT','Unproven restored directory was preserved',409);return root;};
  return {installation:locate(installationRoot(a),i.root,p.installation),workspace:locate(workspaceRoot(a),i.workspaceRoot,p.workspace)};
}
function verifyInstallation(a:Admission,p:Prepared,root:string):void {
  const i=a.plan.source.installation;checkMarker(a,root,i.root,true);
  if(workerFilePresent(join(root,'formal-work')))checkMarker(a,join(root,'formal-work'),join(i.root,'formal-work'),true);
  if(!equal(backupInventory({...i,root},['installation']),p.entries)||!equal(backupControlRecords({...i,root}).sort((a,b)=>a.requestId.localeCompare(b.requestId)),p.backups))fail('RESTORE_EVIDENCE','Prepared installation bytes or storage changed',409);
}
function release(a:Admission,p:Prepared):void {
  const i=a.plan.source.installation;if(!equal(backupNode(i.root),p.installation)||!equal(backupNode(i.workspaceRoot),p.workspace))fail('RESTORE_LOCATION_CONFLICT','Committed owner locations differ',409);
  const roots=[i.root,...(workerFilePresent(join(i.root,'formal-work'))?[join(i.root,'formal-work')]:[]),i.workspaceRoot];
  for(const root of roots)checkMarker(a,root,root);
  const stage=join(i.workspaceRoot,RESTORE_STAGE_BARRIER);
  if(workerFilePresent(stage+'.pending')||workerFilePresent(stage)&&privateRead(stage,65536)!==JSON.stringify(p.stageBarrier)+'\n')fail('RESTORE_EVIDENCE','Unproven workspace barrier was preserved',409);
  for(const root of roots){const file=join(root,RESTORE_ACTIVATION_BARRIER);if(workerFilePresent(file+'.pending'))writeBackupJSON(file,marker(a,root));if(workerFilePresent(file)){unlinkSync(file);syncRestoreDirectory(root);}}
  if(workerFilePresent(stage)){unlinkSync(stage);syncRestoreDirectory(i.workspaceRoot);}writeBackupJSON(join(a.plan.recoveryRoot,'released.json'),released(a));
}
function replay(a:Admission):Json|null {
  if(workerFilePresent(join(a.plan.recoveryRoot,'aborted.json'))){check(a,'aborted',aborted(a));fail('RESTORE_ABORTED','Original restoration was aborted; its candidate remains retained',409);}
  if(!workerFilePresent(join(a.plan.recoveryRoot,'activated.json')))return null;
  const p=readPrepared(a),r=receipt(a,p);check(a,'activated',r);if(workerFilePresent(join(a.plan.recoveryRoot,'released.json')))check(a,'released',released(a));else release(a,p);
  return {status:'ACTIVATED',receipt:r,replayed:true,verification:'NOT_RUN',serviceStarted:false,authority:false};
}
export function inspectLostRestore(v:RestoreLostInput):Json {
  input(v);if(workerFilePresent(v.recoveryRoot)){
    const a=admission(v.recoveryRoot);if(!equal(inputOf(a.plan),v))fail('REQUEST_CONFLICT','Recovery belongs to another request',409);
    let status='ADMITTED',r:Json=null;
    if(workerFilePresent(join(v.recoveryRoot,'aborted.json'))){status='ABORTED';r=aborted(a);check(a,'aborted',r);}
    else if(workerFilePresent(join(v.recoveryRoot,'activated.json'))){status='CUTOVER_COMMITTED';r=receipt(a,readPrepared(a));check(a,'activated',r);if(workerFilePresent(join(v.recoveryRoot,'released.json'))){check(a,'released',released(a));status='ACTIVATED';}}
    else if(workerFilePresent(join(v.recoveryRoot,'switch.json'))){check(a,'switch',switchValue(a,readPrepared(a)));status='SWITCH_ADMITTED';}
    else if(workerFilePresent(join(v.recoveryRoot,'prepared.json'))){readPrepared(a);status='PREPARED';}
    return {status,reportDigest:a.reportDigest,receipt:r,verification:'NOT_RUN',authority:false};
  }
  const report=newPlan(v);return {status:'READY_TO_RESTORE_LOST_OWNER',report:report as unknown as Json,reportDigest:backupHash(report),authority:false};
}
export function activateLostRestore(v:RestoreLostInput,expectedReportDigest:string):Json {
  input(v);digest(expectedReportDigest);let a=workerFilePresent(v.recoveryRoot)?admission(v.recoveryRoot):null;
  if(a&&(!equal(inputOf(a.plan),v)||a.reportDigest!==expectedReportDigest))fail('REQUEST_CONFLICT','Restoration differs from admitted request',409);
  if(a&&workerFilePresent(join(v.recoveryRoot,'released.json'))){const r=replay(a);if(r)return r;fail('RESTORE_EVIDENCE','Release lacks a terminal cutover',409);}
  if(!a){const plan=newPlan(v);if(backupHash(plan)!==expectedReportDigest)fail('RESTORE_SOURCE_CHANGED','Inspected source changed before admission',409);originalAbsent(plan);mkdirSync(v.recoveryRoot,{mode:0o700});syncRestoreDirectory(dirname(v.recoveryRoot));a={schema:'ontology-restore-lost-admission/v1',plan,reportDigest:expectedReportDigest,generation:newRestoreGeneration()};writeBackupJSON(join(v.recoveryRoot,'plan.json'),a);}
  const unlock=operatorLock(v.recoveryRoot);
  try{
    layout(a);const prior=replay(a);if(prior)return prior;const i=a.plan.source.installation,switchFile=join(v.recoveryRoot,'switch.json');
    if(!workerFilePresent(switchFile)){
      originalAbsent(a.plan);const file=join(v.recoveryRoot,'completion.reserve');writeBackupJSON(file,reserve(a));if(lstatSync(file).blocks*512<BACKUP_LIMITS.completionReserveBytes)fail('RESTORE_RESERVATION','Filesystem did not allocate completion headroom',409);
      let p:Prepared;
      if(workerFilePresent(join(v.recoveryRoot,'prepared.json'))){p=readPrepared(a);verifyInstallation(a,p,installationRoot(a));readPreparedRestoreLocation(stateRoot(a),p.workspaceManifestDigest,workspaceRoot(a));}
      else{
        if(workerFilePresent(workspaceRoot(a))){checkMarker(a,workspaceRoot(a),i.workspaceRoot);if(workerFilePresent(join(workspaceRoot(a),RESTORE_ACTIVATION_BARRIER+'.pending')))block(a,workspaceRoot(a),i.workspaceRoot);}
        const params=stateInput(a),r=inspectRestoreState(params) as unknown as {reportDigest:string},state=prepareRestoreState(params,r.reportDigest) as unknown as {receipt:{manifestDigest:string}},ready=readPreparedRestoreLocation(stateRoot(a),state.receipt.manifestDigest,workspaceRoot(a));
        if(ready.plan.rows!==a.plan.stateRows)fail('RESTORE_SOURCE_CHANGED','Prepared row closure differs',409);
        const installation=prepareInstallation(a);block(a,workspaceRoot(a),i.workspaceRoot);
        p={schema:'ontology-restore-lost-prepared/v1',requestDigest:a.reportDigest,workspaceManifestDigest:ready.manifestDigest,workspace:backupNode(workspaceRoot(a)),stageBarrier:ready.barrier,installation:backupNode(installationRoot(a)),...installation};writeBackupJSON(join(v.recoveryRoot,'prepared.json'),p);
      }
      originalAbsent(a.plan);freeReserve(a);writeBackupJSON(switchFile,switchValue(a,p));
    }
    const p=readPrepared(a);check(a,'switch',switchValue(a,p));let at=locations(a,p);verifyInstallation(a,p,at.installation);checkMarker(a,at.workspace,i.workspaceRoot,true);readPreparedRestoreLocation(stateRoot(a),p.workspaceManifestDigest,at.workspace);
    const lease=privateLease(join(at.workspace,FILES.lease),'WORKSPACE_BUSY','Restored workspace has a writer');
    try{
      at=locations(a,p);
      if(at.installation===installationRoot(a)){renameSync(at.installation,i.root);syncRestoreDirectory(v.recoveryRoot);syncRestoreDirectory(dirname(i.root));}
      writeBackupJSON(join(v.recoveryRoot,'installation-moved.json'),phase(a,p,'INSTALLATION_MOVED'));
      at=locations(a,p);verifyInstallation(a,p,i.root);if(!equal(readInstallation(i.root),i))fail('RESTORE_EVIDENCE','Restored installation identity differs',409);const binding=readToolchainLedger(i).records.at(-1)??null;verifyManagedToolchains(i,binding);
      withPreparedRestoreState(stateRoot(a),p.workspaceManifestDigest,s=>{const tasks=s.db.prepare('SELECT id,project_id FROM native_reasoning_tasks ORDER BY id LIMIT 4097').all();if(tasks.length!==a!.plan.source.formalTasks)fail('RESTORE_EVIDENCE','Formal task closure differs from backup',409);for(const t of tasks)completedTaskWorkerEvidence(s,String(t.project_id),String(t.id),binding?[binding.binding.workRoot]:[]);},at.workspace);
      if(at.workspace===workspaceRoot(a)){renameSync(at.workspace,i.workspaceRoot);syncRestoreDirectory(stateRoot(a));syncRestoreDirectory(dirname(i.workspaceRoot));}
      writeBackupJSON(join(v.recoveryRoot,'workspace-moved.json'),phase(a,p,'WORKSPACE_MOVED'));verifyInstallation(a,p,i.root);readPreparedRestoreLocation(stateRoot(a),p.workspaceManifestDigest,i.workspaceRoot);verifyRuntime(i.runtime);writeBackupJSON(join(v.recoveryRoot,'activated.json'),receipt(a,p));
    }finally{lease.close();}
    release(a,p);return {status:'ACTIVATED',receipt:receipt(a,p),replayed:false,verification:'VERIFIED',serviceStarted:false,authority:false};
  }finally{unlock();}
}
export function abortLostRestore(root:string,requestId:string,expectedReportDigest:string):Json {
  id(requestId);digest(expectedReportDigest);const a=admission(root);if(a.plan.requestId!==requestId||a.reportDigest!==expectedReportDigest)fail('REQUEST_CONFLICT','Abort differs from original request',409);const r=aborted(a);
  if(workerFilePresent(join(root,'aborted.json'))){check(a,'aborted',r);return {receipt:r,replayed:true,verification:'NOT_RUN',authority:false};}
  const unlock=operatorLock(root);try{layout(a);if(workerFilePresent(join(root,'switch.json'))||workerFilePresent(join(root,'activated.json')))fail('RESTORE_SWITCH_ADMITTED','Cutover is admitted; resume the exact restoration',409);originalAbsent(a.plan);freeReserve(a);writeBackupJSON(join(root,'aborted.json'),r);return {receipt:r,replayed:false,verification:'NOT_RUN',authority:false};}finally{unlock();}
}
