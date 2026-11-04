import {mkdirSync,chmodSync,readdirSync,lstatSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {privatePath,privateRead,RESTORE_STAGE_BARRIER} from '../standalone/workspace.js';
import {exact,id,digest,text} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {outsideSource,assertSeparate,operatorLock} from './files.js';
import {requireRuntimeDestinationSeparate} from './runtime-history.js';
import {workerFilePresent} from './worker-archives.js';
import {BACKUP_LIMITS,backupHash,backupReceipt,validateBackupPlan,validateNode} from './backup-contract.js';
import type {BackupEnvelope,BackupManifest,NodeIdentity,BackupEntry} from './backup-contract.js';
import {backupNode,verifyBackup,writeBackupJSON} from './backup-files.js';
import {restoreBackupFile,restoredFileImage,syncRestoreDirectory} from './restore-files.js';

export interface RestoreStageInput {backupRoot:string;expectedManifestDigest:string;stageRoot:string;requestId:string;}
export interface RestoreStagePlan extends RestoreStageInput {schema:'ontology-restore-stage-plan/v1';targetParent:NodeIdentity;backup:BackupEnvelope;}
interface RestoredEntry {scope:BackupEntry['scope'];path:string;node:NodeIdentity;}
interface StageManifest {schema:'ontology-restore-stage-manifest/v1';requestId:string;reportDigest:string;roots:{stage:NodeIdentity;installation:NodeIdentity;workspace:NodeIdentity};entries:RestoredEntry[];}
interface StageReceipt {schema:'ontology-restore-stage-receipt/v1';requestId:string;reportDigest:string;stageRoot:string;backupManifestDigest:string;manifestDigest:string;files:number;logicalBytes:number;activation:'BLOCKED';authority:false;}
interface StageEnvelope {manifest:StageManifest;manifestDigest:string;receipt:StageReceipt;}
const boundedPath=(value:unknown):void=>{text(value,4096);if(!isAbsolute(value)||resolve(value)!==value)fail('UNSAFE_PATH','Canonical absolute restore paths required');};
function validateInput(v:unknown):asserts v is RestoreStageInput {
  exact(v,['backupRoot','expectedManifestDigest','stageRoot','requestId']);boundedPath(v.backupRoot);boundedPath(v.stageRoot);digest(v.expectedManifestDigest);id(v.requestId);
}
function inputOf(p:RestoreStagePlan):RestoreStageInput {return {backupRoot:p.backupRoot,expectedManifestDigest:p.expectedManifestDigest,stageRoot:p.stageRoot,requestId:p.requestId};}
function barrier(p:RestoreStagePlan):Json {return {schema:'ontology-restore-stage-barrier/v1',stageRoot:p.stageRoot,requestId:p.requestId,reportDigest:backupHash(p),activation:'BLOCKED'};}
function validatePlan(v:unknown):asserts v is RestoreStagePlan {
  exact(v,['schema','backupRoot','expectedManifestDigest','stageRoot','requestId','targetParent','backup']);
  validateInput({backupRoot:v.backupRoot,expectedManifestDigest:v.expectedManifestDigest,stageRoot:v.stageRoot,requestId:v.requestId});validateNode(v.targetParent);
  const b=v.backup;exact(b,['manifest','manifestDigest','receipt']);const m=b.manifest;exact(m,['schema','requestId','requestDigest','plan','reportDigest']);id(m.requestId);digest(m.requestDigest);digest(m.reportDigest);validateBackupPlan(m.plan);
  if(v.schema!=='ontology-restore-stage-plan/v1'||m.schema!=='ontology-backup-manifest/v1'||backupHash(m.plan)!==m.reportDigest||backupHash(m)!==b.manifestDigest||b.manifestDigest!==v.expectedManifestDigest||backupHash(backupReceipt(m as unknown as BackupManifest))!==backupHash(b.receipt)||(b.receipt as {requestDigest:string}).requestDigest!==m.requestDigest)fail('RESTORE_EVIDENCE','Restore source manifest differs',409);
  if(Buffer.byteLength(JSON.stringify(v)+'\n')>BACKUP_LIMITS.manifestBytes)fail('RESTORE_LIMIT','Restore plan exceeds its envelope',409);
  const entries=m.plan.entries,paths=new Map(entries.map(e=>[e.scope+'/'+e.path,e]));
  for(const e of entries){
    // Every parent is explicit; no implicit path creation can enter a link or
    // reinterpret a backed-up file as a directory. Control names are reserved.
    const parent=dirname(e.path);if(parent!=='.'&&paths.get(e.scope+'/'+parent)?.kind!=='directory'||e.path.split('/').some(n=>n===RESTORE_STAGE_BARRIER||n===RESTORE_STAGE_BARRIER+'.pending')||(e.mode&(e.kind==='directory'?0o500:0o400))!==(e.kind==='directory'?0o500:0o400))fail('RESTORE_LAYOUT','Unsupported snapshot directory, mode or reserved restore path',409);
  }
  const work=paths.get('installation/formal-work');if(work&&work.kind!=='directory')fail('RESTORE_LAYOUT','Worker root must remain a directory',409);
  const p=v as unknown as RestoreStagePlan,i=m.plan.installation;
  for(const original of [p.backupRoot,i.root,i.workspaceRoot,i.runtime.root])assertSeparate(p.stageRoot,original);
  requireRuntimeDestinationSeparate(i,p.stageRoot);
}
function newPlan(input:RestoreStageInput):RestoreStagePlan {
  validateInput(input);const verified=verifyBackup(input.backupRoot,input.expectedManifestDigest),parent=outsideSource(dirname(input.stageRoot));
  if(parent!==dirname(input.stageRoot))fail('UNSAFE_PATH','Restore parent must be canonical');
  const {manifest,manifestDigest,receipt}=verified,p:RestoreStagePlan={schema:'ontology-restore-stage-plan/v1',...input,targetParent:backupNode(parent),backup:{manifest,manifestDigest,receipt}};
  validatePlan(p);return p;
}
function readPlan(root:string):RestoreStagePlan {
  boundedPath(root);privatePath(root,true);if(outsideSource(root)!==root)fail('UNSAFE_PATH','Canonical restore stage required');
  const p:unknown=JSON.parse(privateRead(join(root,'plan.json'),BACKUP_LIMITS.manifestBytes));validatePlan(p);if(p.stageRoot!==root)fail('RESTORE_EVIDENCE','Stage location differs from its original request',409);
  if(privateRead(join(root,RESTORE_STAGE_BARRIER),65536)!==JSON.stringify(barrier(p))+'\n')fail('RESTORE_EVIDENCE','Restore control barrier differs',409);return p;
}
function receipt(p:RestoreStagePlan,m:StageManifest):StageReceipt {return {schema:'ontology-restore-stage-receipt/v1',requestId:p.requestId,reportDigest:backupHash(p),stageRoot:p.stageRoot,backupManifestDigest:p.expectedManifestDigest,manifestDigest:backupHash(m),files:p.backup.receipt.files,logicalBytes:p.backup.receipt.logicalBytes,activation:'BLOCKED',authority:false};}
function readCompletion(p:RestoreStagePlan,expected?:string):StageEnvelope {
  if(expected!==undefined)digest(expected);const v:unknown=JSON.parse(privateRead(join(p.stageRoot,'manifest.json'),BACKUP_LIMITS.manifestBytes));exact(v,['manifest','manifestDigest','receipt']);digest(v.manifestDigest);
  const m=v.manifest;exact(m,['schema','requestId','reportDigest','roots','entries']);exact(m.roots,['stage','installation','workspace']);for(const node of Object.values(m.roots))validateNode(node);
  const entries=p.backup.manifest.plan.entries;
  if(m.schema!=='ontology-restore-stage-manifest/v1'||m.requestId!==p.requestId||m.reportDigest!==backupHash(p)||!Array.isArray(m.entries)||m.entries.length!==entries.length)fail('RESTORE_EVIDENCE','Stage completion owner or inventory differs',409);
  for(const [n,e] of m.entries.entries()){exact(e,['scope','path','node']);validateNode(e.node);if(e.scope!==entries[n].scope||e.path!==entries[n].path||e.node.mode!==entries[n].mode)fail('RESTORE_EVIDENCE','Stage lineage does not match original inventory',409);}
  if(backupHash(m)!==v.manifestDigest||expected!==undefined&&v.manifestDigest!==expected||backupHash(receipt(p,m as unknown as StageManifest))!==backupHash(v.receipt))fail('RESTORE_EVIDENCE','Stage completion identity differs',409);return v as unknown as StageEnvelope;
}
function response(p:RestoreStagePlan,completed:StageEnvelope|null):Json {return {status:completed?'STAGED':'PENDING',reportDigest:backupHash(p),report:p as unknown as Json,receipt:completed?.receipt as unknown as Json??null,activation:'BLOCKED',authority:false};}
export function inspectRestoreStage(input:RestoreStageInput):Json {
  validateInput(input);
  if(workerFilePresent(input.stageRoot)&&workerFilePresent(join(input.stageRoot,'plan.json'))){
    const p=readPlan(input.stageRoot);if(backupHash(inputOf(p))!==backupHash(input))fail('REQUEST_CONFLICT','Stage belongs to a different restore request',409);
    return response(p,workerFilePresent(join(input.stageRoot,'manifest.json'))?readCompletion(p):null);
  }
  const p=newPlan(input);if(workerFilePresent(input.stageRoot)){requireBootstrap(p);return response(p,null);}
  return {status:'READY_TO_STAGE',reportDigest:backupHash(p),report:p as unknown as Json,activation:'BLOCKED',authority:false};
}
function requireBootstrap(p:RestoreStagePlan):void {
  privatePath(p.stageRoot,true);if(outsideSource(p.stageRoot)!==p.stageRoot)fail('UNSAFE_PATH','Canonical restore stage required');
  const names=readdirSync(p.stageRoot),full=join(p.stageRoot,RESTORE_STAGE_BARRIER),pending=full+'.pending',expected=JSON.stringify(barrier(p))+'\n';
  if(names.some(n=>![RESTORE_STAGE_BARRIER,RESTORE_STAGE_BARRIER+'.pending','operator.sqlite','operator.sqlite-journal','plan.json.pending'].includes(n)))fail('RESTORE_EVIDENCE','Unselected occupied restore destination was preserved',409);
  if(workerFilePresent(full)){if(privateRead(full,65536)!==expected)fail('RESTORE_EVIDENCE','Restore barrier belongs to another request',409);}
  else if(workerFilePresent(pending)){
    const old=privateRead(pending,65536);if(!expected.startsWith(old))fail('RESTORE_EVIDENCE','Foreign staged restore barrier was preserved',409);
    // A generic JSON prefix cannot identify its intended request. Without the
    // complete digest there is no independent control record to adopt safely.
    if(!old.includes('"reportDigest":'+JSON.stringify(backupHash(p))))fail('RESTORE_UNOWNED','Partial bootstrap has no complete request binding; preserve it and select a new destination',409);
  }
  else fail('RESTORE_UNOWNED','Occupied destination has no retained restore request; preserve it and select a new destination',409);
}
function blockRoot(p:RestoreStagePlan,path:string):void {
  if(!workerFilePresent(path)){mkdirSync(path,{mode:0o700});syncRestoreDirectory(dirname(path));}privatePath(path,true);writeBackupJSON(join(path,RESTORE_STAGE_BARRIER),barrier(p));
}
function scan(p:RestoreStagePlan,complete:boolean):void {
  const allowed=new Map<string,BackupEntry>(p.backup.manifest.plan.entries.map(e=>[e.scope+'/'+e.path,e])),root=p.stageRoot;
  // SQLite may retain an inactive private lease journal after SIGKILL. It is
  // bounded operator control, never copied business state or activation proof.
  const rootNames=new Set([RESTORE_STAGE_BARRIER,'plan.json','operator.sqlite','operator.sqlite-journal','installation','workspace',...(complete?['manifest.json']:['manifest.json.pending'])]);
  for(const name of readdirSync(root)){
    const path=join(root,name);if(!rootNames.has(name))fail('RESTORE_EVIDENCE','Unselected restore control material was preserved',409);privatePath(path,name==='installation'||name==='workspace');
    if(name.startsWith('operator.sqlite')&&lstatSync(path).size>65536)fail('RESTORE_EVIDENCE','Restore lease control exceeds its metadata budget',409);
  }
  for(const scope of ['installation','workspace'] as const){
    const visit=(path:string,prefix:string,depth:number):void=>{
      if(depth>BACKUP_LIMITS.depth)fail('RESTORE_LIMIT','Restore tree exceeds its depth budget',409);privatePath(path,true);
      for(const name of readdirSync(path)){
        const relative=prefix?prefix+'/'+name:name,file=join(path,name);
        const marker=relative===RESTORE_STAGE_BARRIER||scope==='installation'&&relative==='formal-work/'+RESTORE_STAGE_BARRIER;
        const pending=!complete&&(relative===RESTORE_STAGE_BARRIER+'.pending'||scope==='installation'&&relative==='formal-work/'+RESTORE_STAGE_BARRIER+'.pending');
        if(marker||pending){
          const raw=privateRead(file,65536),expected=JSON.stringify(barrier(p))+'\n';if(marker?raw!==expected:!expected.startsWith(raw))fail('RESTORE_EVIDENCE','Candidate activation barrier differs',409);continue;
        }
        const e=allowed.get(scope+'/'+relative);if(!e)fail('RESTORE_EVIDENCE','Unselected candidate bytes were preserved',409);privatePath(file,e.kind==='directory');
        if(e.kind==='directory')visit(file,relative,depth+1);
      }
    };
    const path=join(root,scope);if(workerFilePresent(path))visit(path,'',1);else if(complete)fail('RESTORE_EVIDENCE','Candidate root missing',409);
  }
}
function images(p:RestoreStagePlan):StageManifest {
  const root=p.stageRoot,entries:RestoredEntry[]=[];
  for(const scope of ['installation','workspace'] as const)if(privateRead(join(root,scope,RESTORE_STAGE_BARRIER),65536)!==JSON.stringify(barrier(p))+'\n')fail('RESTORE_EVIDENCE','Candidate barrier missing',409);
  for(const e of p.backup.manifest.plan.entries){
    const path=join(root,e.scope,e.path),node=e.kind==='directory'?backupNode(path):restoredFileImage(path,e);
    if(node.mode!==e.mode)fail('RESTORE_EVIDENCE','Restored directory mode differs',409);entries.push({scope:e.scope,path:e.path,node});
    if(e.scope==='installation'&&e.path==='formal-work'&&privateRead(join(path,RESTORE_STAGE_BARRIER),65536)!==JSON.stringify(barrier(p))+'\n')fail('RESTORE_EVIDENCE','Worker candidate barrier missing',409);
  }
  return {schema:'ontology-restore-stage-manifest/v1',requestId:p.requestId,reportDigest:backupHash(p),roots:{stage:backupNode(root),installation:backupNode(join(root,'installation')),workspace:backupNode(join(root,'workspace'))},entries};
}
export function stageInstallationRestore(input:RestoreStageInput,expectedReportDigest:string):Json {
  validateInput(input);digest(expectedReportDigest);
  const exists=workerFilePresent(input.stageRoot),retained=exists&&workerFilePresent(join(input.stageRoot,'plan.json'));
  const p=retained?readPlan(input.stageRoot):newPlan(input);
  if(backupHash(inputOf(p))!==backupHash(input)||backupHash(p)!==expectedReportDigest)fail('REQUEST_CONFLICT','Restore parameters differ from inspected request',409);
  if(retained&&workerFilePresent(join(p.stageRoot,'manifest.json')))return {receipt:readCompletion(p).receipt as unknown as Json,replayed:true,verification:'NOT_RUN',activation:'BLOCKED',authority:false};
  if(backupHash(backupNode(dirname(p.stageRoot)))!==backupHash(p.targetParent))fail('RESTORE_EVIDENCE','Inspected restore parent was replaced',409);
  // Every resumed copy re-verifies all source objects, even ones already copied.
  verifyBackup(p.backupRoot,p.expectedManifestDigest);
  if(exists){if(!retained)requireBootstrap(p);}else{mkdirSync(p.stageRoot,{mode:0o700});syncRestoreDirectory(dirname(p.stageRoot));}
  const unlock=operatorLock(p.stageRoot);
  try{
    writeBackupJSON(join(p.stageRoot,RESTORE_STAGE_BARRIER),barrier(p));writeBackupJSON(join(p.stageRoot,'plan.json'),p);
    // Another same-request process may have completed while this caller waited.
    if(workerFilePresent(join(p.stageRoot,'manifest.json')))return {receipt:readCompletion(p).receipt as unknown as Json,replayed:true,verification:'NOT_RUN',activation:'BLOCKED',authority:false};
    scan(p,false);for(const scope of ['installation','workspace'] as const)blockRoot(p,join(p.stageRoot,scope));
    const entries=p.backup.manifest.plan.entries,dirs=entries.filter(e=>e.kind==='directory').sort((a,b)=>a.path.split('/').length-b.path.split('/').length);
    for(const e of dirs){const path=join(p.stageRoot,e.scope,e.path);if(!workerFilePresent(path)){mkdirSync(path,{mode:0o700});syncRestoreDirectory(dirname(path));}privatePath(path,true);if(e.scope==='installation'&&e.path==='formal-work')blockRoot(p,path);}
    scan(p,false);
    for(const e of entries)if(e.kind==='file')restoreBackupFile(p.backupRoot,p.backup,e,join(p.stageRoot,e.scope,e.path));
    for(const e of [...dirs].reverse()){const path=join(p.stageRoot,e.scope,e.path);if(backupNode(path).mode!==e.mode)chmodSync(path,e.mode);syncRestoreDirectory(path);}
    verifyBackup(p.backupRoot,p.expectedManifestDigest);scan(p,false);
    const manifest=images(p),saved:StageEnvelope={manifest,manifestDigest:backupHash(manifest),receipt:receipt(p,manifest)};
    writeBackupJSON(join(p.stageRoot,'manifest.json'),saved);
    return {receipt:saved.receipt as unknown as Json,replayed:false,verification:'VERIFIED',activation:'BLOCKED',authority:false};
  }finally{unlock();}
}
export function verifyRestoreStage(root:string,expectedManifestDigest:string):Json {
  digest(expectedManifestDigest);const p=readPlan(root),saved=readCompletion(p,expectedManifestDigest);scan(p,true);
  if(backupHash(images(p))!==saved.manifestDigest)fail('RESTORE_EVIDENCE','Restored physical storage or content differs from its completion record',409);
  return {status:'VERIFIED',receipt:saved.receipt as unknown as Json,sourceBackupManifestDigest:p.expectedManifestDigest,activation:'BLOCKED',credentials:'SNAPSHOT_ONLY',runtimeDependencies:'NOT_VERIFIED',authority:false};
}
/** Operator recovery only. Domain service and untrusted API input cannot opt
 * out of candidate barriers by requesting this verified immutable readback. */
export function readVerifiedRestoreStage(root:string,expectedManifestDigest:string):{plan:RestoreStagePlan;completion:StageEnvelope} {
  verifyRestoreStage(root,expectedManifestDigest);const plan=readPlan(root),completion=readCompletion(plan,expectedManifestDigest);return {plan,completion};
}
