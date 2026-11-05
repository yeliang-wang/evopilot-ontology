import {DatabaseSync} from 'node:sqlite';
import {readResetRecords} from '../standalone/reset-records.js';
import type {SQLInputValue,SQLOutputValue} from 'node:sqlite';
import {mkdirSync,chmodSync,openSync,closeSync,readFileSync,writeSync,fsyncSync,lstatSync,fstatSync,readdirSync,constants} from 'node:fs';
import {join,dirname,isAbsolute,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {WORKSPACE_TABLES} from './workspace.js';
import {readVerifiedRestoreStage} from './restore-stage.js';
import {restoreStagedFile,restoredFileImage,syncRestoreDirectory} from './restore-files.js';
import {backupNode,writeBackupJSON} from './backup-files.js';
import {backupHash,validateNode,BACKUP_LIMITS} from './backup-contract.js';
import type {NodeIdentity} from './backup-contract.js';
import {outsideSource,assertSeparate,operatorLock} from './files.js';
import {requireRuntimeDestinationSeparate} from './runtime-history.js';
import {fileDigest} from './runtime.js';
import {workerFilePresent} from './worker-archives.js';
import {FILES,STATE_VERSION,RESTORE_STAGE_BARRIER,RESTORE_ACTIVATION_BARRIER,privatePath,privateRead,privateLease} from '../standalone/workspace.js';
import {exact,id,digest,timestamp,validateIdentity,validateCredentials,hashBytes} from '../standalone/validation.js';
import {recoveryRequestPrefix} from '../standalone/recovery.js';
import {fail,LIMITS} from '../standalone/types.js';
import type {WorkspaceIdentity,Credentials,Json} from '../standalone/types.js';

type Row=Record<string,SQLOutputValue>;
type Selection={root:string;manifestDigest:string};
export interface RestoreStateInput {snapshot:Selection;retained:Selection|null;root:string;requestId:string;generation:string;rekeyExpiresAt:string|null;}
interface StatePlan extends RestoreStateInput {schema:'ontology-restore-state-plan/v1';parent:NodeIdentity;installationId:string;workspaceId:string;serviceId:string;counts:Record<string,number>;rows:number;credentialPolicy:'CURRENT'|'REKEY_LOST_OWNER';}
interface Source {selection:Selection;stage:ReturnType<typeof readVerifiedRestoreStage>;db:DatabaseSync;identity:WorkspaceIdentity;root:string;}
interface Layout {name:string;columns:string[];keys:string[];}
const TABLES=['projects','intents','receipts','audit','native_source_sets','native_source_admissions','native_expectations','native_models','native_reasoning_tasks','native_reasoning_events','native_views','native_review_candidates','native_reviews','native_deliveries','project_heads','native_source_heads','native_model_heads','native_expectation_heads','native_review_heads','native_delivery_heads'] as const;
const DRAFT_HEADS=new Set<string>(['native_source_heads','native_model_heads','native_expectation_heads']);
const DECISION_HEADS=new Set<string>(['native_review_heads','native_delivery_heads']);
const MAX_ROWS=500000;
const path=(p:unknown):void=>{if(typeof p!=='string'||p.length>4096||!isAbsolute(p)||resolve(p)!==p)fail('UNSAFE_PATH','Canonical absolute recovery path required');};
export function newRestoreGeneration():string {return randomBytes(16).toString('hex');}
function validateInput(v:unknown):asserts v is RestoreStateInput {
  exact(v,['snapshot','retained','root','requestId','generation','rekeyExpiresAt']);path(v.root);id(v.requestId);
  for(const s of [v.snapshot,...(v.retained===null?[]:[v.retained])]){exact(s,['root','manifestDigest']);path(s.root);digest(s.manifestDigest);}
  if(typeof v.generation!=='string'||!/^[a-f0-9]{32}$/.test(v.generation))fail('INVALID_INPUT','Fresh 128-bit recovery generation required');
  if(v.retained===null)timestamp(v.rekeyExpiresAt);else if(v.rekeyExpiresAt!==null)fail('INVALID_INPUT','Current credential state must be retained without a rekey override');
}
const inputOf=(p:StatePlan):RestoreStateInput=>({snapshot:p.snapshot,retained:p.retained,root:p.root,requestId:p.requestId,generation:p.generation,rekeyExpiresAt:p.rekeyExpiresAt});
const schema=(db:DatabaseSync)=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
function layouts(db:DatabaseSync):Layout[]{return TABLES.map(name=>{const info=db.prepare('PRAGMA table_info('+name+')').all();return {name,columns:info.map(c=>String(c.name)),keys:info.filter(c=>Number(c.pk)>0).sort((a,b)=>Number(a.pk)-Number(b.pk)).map(c=>String(c.name))};});}
function values(r:Row,columns:string[]):SQLInputValue[]{return columns.map(c=>{const v=r[c];if(v!==null&&typeof v!=='string'&&(typeof v!=='number'||!Number.isSafeInteger(v)))fail('RESTORE_STATE','Unsupported state value',409);return v;});}
const rows=(db:DatabaseSync,l:Layout)=>db.prepare('SELECT * FROM '+l.name+' ORDER BY '+l.keys.join(',')).iterate();
const lookup=(db:DatabaseSync,l:Layout,r:Row)=>db.prepare('SELECT * FROM '+l.name+' WHERE '+l.keys.map(k=>k+'=?').join(' AND ')).get(...values(r,l.keys));
function same(a:Row,b:Row):boolean{return backupHash(a)===backupHash(b);}
function openSource(selection:Selection):Source {
  const stage=readVerifiedRestoreStage(selection.root,selection.manifestDigest),root=join(selection.root,'workspace'),raw=privateRead(join(root,FILES.identity),4096),identity:unknown=JSON.parse(raw);validateIdentity(identity);
  const i=stage.plan.backup.manifest.plan.installation;if(identity.workspaceId!==i.workspaceId||identity.serviceId!==i.serviceId)fail('RESTORE_STATE','Snapshot identity differs from selected installation',409);
  const file=join(root,FILES.db);privatePath(file);if(lstatSync(file).size>LIMITS.stateBytes)fail('STATE_LIMIT','Snapshot database exceeds its byte budget',409);
  for(const suffix of ['-journal','-wal','-shm'])if(workerFilePresent(file+suffix))fail('RESTORE_STATE','Snapshot has an unresolved database sidecar',409);
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    db.exec('PRAGMA trusted_schema=OFF;BEGIN');
    if(db.prepare('PRAGMA user_version').get()?.user_version!==STATE_VERSION||db.prepare('PRAGMA journal_mode').get()?.journal_mode!=='delete'||db.prepare('SELECT identity FROM workspace WHERE singleton=1').get()?.identity!==raw)fail('RESTORE_STATE','Snapshot state contract differs',409);
    return {selection,stage,root,db,identity};
  }catch(e){db.close();throw e;}
}
function sources<T>(input:RestoreStateInput,use:(snapshot:Source,retained:Source|null,layout:Layout[],reference:DatabaseSync)=>T):T {
  const a=openSource(input.snapshot);let b:Source|null=null,reference:DatabaseSync|undefined;
  try{
    b=input.retained?openSource(input.retained):null;reference=new DatabaseSync(':memory:');reference.exec(WORKSPACE_TABLES);
    const expected=backupHash(schema(reference)),layout=layouts(reference),owner=a.stage.plan.backup.manifest.plan.installation;
    for(const s of [a,...(b?[b]:[])]){
      const i=s.stage.plan.backup.manifest.plan.installation;
      for(const key of ['installationId','workspaceId','serviceId','root','workspaceRoot','projectId','principalId','createdAt'] as const)if(i[key]!==owner[key])fail('RESTORE_OWNER_CONFLICT','Retained state belongs to another owner or original location',409);
      if(s.identity.createdAt!==a.identity.createdAt)fail('RESTORE_OWNER_CONFLICT','Immutable workspace creation identity differs',409);
      if(backupHash(schema(s.db))!==expected||s.db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok'||s.db.prepare('PRAGMA foreign_key_check').get())fail('RESTORE_STATE','Unknown or inconsistent snapshot schema was preserved',409);
      if(s.db.prepare("SELECT id FROM native_reasoning_tasks WHERE state!='FINISHED' LIMIT 1").get())fail('TASK_RECOVERY_REQUIRED','Unfinished formal work cannot be silently restored or redispatched',409);
      const prefix='r'+input.generation+'.';
      if(s.identity.schema==='ontology-workspace/v2'&&s.identity.recovery.generation===input.generation||s.db.prepare('SELECT request_id FROM receipts WHERE substr(request_id,1,?)=? LIMIT 1').get(prefix.length,prefix))fail('RESTORE_GENERATION_CONFLICT','Recovery generation was already used',409);
    }
    if(b&&backupHash(readResetRecords(a.root))!==backupHash(readResetRecords(b.root)))fail('RESTORE_RESET_CONFLICT','Selected snapshots cross an explicit asset deletion; choose a snapshot retaining the same reset tombstones',409);
    return use(a,b,layout,reference);
  }finally{reference?.close();b?.db.close();a.db.close();}
}
/** Draft selectors come from the selected snapshot. Current decisions and
 * deliveries remain selected, so restoring drafts cannot resurrect approval. */
function* expectedRows(l:Layout,a:Source,b:Source|null):Generator<Row> {
  if(DRAFT_HEADS.has(l.name)){yield* rows(a.db,l);return;}
  if(DECISION_HEADS.has(l.name)){yield* rows((b??a).db,l);return;}
  if(l.name==='project_heads'){
    const projects:Layout={name:'projects',columns:['id','label','revision','created_at'],keys:['id']};
    for(const p of expectedRows(projects,a,b)){const head=a.db.prepare('SELECT * FROM project_heads WHERE project_id=?').get(p.id as string);yield head??{project_id:p.id,intent_digest:null};}return;
  }
  for(const old of rows(a.db,l)){
    const current=b?lookup(b.db,l,old):undefined;
    if(l.name==='native_deliveries'&&b&&!current&&b.db.prepare('SELECT digest FROM native_deliveries WHERE project_id=? AND asset_id=? AND version=?').get(old.project_id as string,old.asset_id as string,old.version as string))fail('RESTORE_HISTORY_CONFLICT','A published version has conflicting immutable identities',409);
    if(l.name==='projects'){
      if(current&&(current.label!==old.label||current.created_at!==old.created_at))fail('RESTORE_HISTORY_CONFLICT','Project identity has conflicting immutable history',409);
      const revision=Math.max(Number(old.revision),Number(current?.revision??0))+1;if(!Number.isSafeInteger(revision)||revision<1)fail('STATE_LIMIT','Recovery revision exhausted',409);yield {...old,revision};
    }else{if(current&&!same(old,current))fail('RESTORE_HISTORY_CONFLICT','Conflicting immutable rows in '+l.name+' were preserved',409);yield old;}
  }
  if(b)for(const current of rows(b.db,l))if(!lookup(a.db,l,current)){
    if(l.name==='projects'){const revision=Number(current.revision)+1;if(!Number.isSafeInteger(revision)||revision<1)fail('STATE_LIMIT','Recovery revision exhausted',409);yield {...current,revision};}
    else yield current;
  }
}
function selectedCredentials(s:Source):{raw:string;credentials:Credentials;operatorId:string} {
  const raw=privateRead(join(s.root,FILES.credentials),512*1024),credentials:unknown=JSON.parse(raw);validateCredentials(credentials,s.identity);
  const token=privateRead(join(s.root,'operator-token'),128);if(!/^[A-Za-z0-9_-]{43}$/.test(token))fail('RESTORE_CREDENTIAL_CONFLICT','Invalid retained operator token',409);
  const i=s.stage.plan.backup.manifest.plan.installation,operator=credentials.grants.find(g=>g.tokenHash===hashBytes(token));
  if(!operator||operator.principalId!==i.principalId||!operator.projectIds.includes(i.projectId)||!operator.permissions.includes('read')||!operator.permissions.includes('write')||operator.permissions.includes('review')||workerFilePresent(join(s.root,'reviewer-grant-'+operator.id+'.json')))fail('RESTORE_CREDENTIAL_CONFLICT','Operator rekey/retention requires its original non-review grant binding',409);
  return {raw,credentials,operatorId:operator.id};
}
function planFor(input:RestoreStateInput,a:Source,b:Source|null,layout:Layout[]):StatePlan {
  const parent=outsideSource(dirname(input.root));if(parent!==dirname(input.root))fail('UNSAFE_PATH','Canonical private preparation parent required');
  decisionFloor(a,b);
  const counts:Record<string,number>={};let count=0;
  for(const l of layout){let n=0;for(const row of expectedRows(l,a,b)){values(row,l.columns);n++;if(++count>MAX_ROWS)fail('RESTORE_LIMIT','Merged state exceeds its row budget',409);}counts[l.name]=n;}
  if(counts.projects>LIMITS.projects||counts.receipts>LIMITS.receipts||counts.native_reasoning_tasks>4096)fail('RESTORE_LIMIT','Merged owner exceeds its project, receipt or formal-task budget',409);
  const selected=b??a;selectedCredentials(selected);const i=a.stage.plan.backup.manifest.plan.installation;
  for(const e of selected.stage.plan.backup.manifest.plan.entries)if(e.scope==='workspace'&&[FILES.identity+'.pending',FILES.credentials+'.pending',FILES.db+'-journal',FILES.db+'-wal',FILES.db+'-shm',FILES.lease,FILES.lease+'-journal'].includes(e.path))fail('RESTORE_STATE','Snapshot contains reserved preparation control paths',409);
  for(const s of [a,...(b?[b]:[])])for(const root of [s.selection.root,s.stage.plan.backup.manifest.plan.installation.root,s.stage.plan.backup.manifest.plan.installation.workspaceRoot,s.stage.plan.backup.manifest.plan.installation.runtime.root])assertSeparate(input.root,root);
  for(const s of [a,...(b?[b]:[])])requireRuntimeDestinationSeparate(s.stage.plan.backup.manifest.plan.installation,input.root);
  return {schema:'ontology-restore-state-plan/v1',...input,parent:backupNode(parent),installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,counts,rows:count,credentialPolicy:b?'CURRENT':'REKEY_LOST_OWNER'};
}
function readPlan(root:string):StatePlan {
  path(root);privatePath(root,true);if(outsideSource(root)!==root)fail('UNSAFE_PATH','Canonical preparation root required');
  const p:unknown=JSON.parse(privateRead(join(root,'plan.json'),65536));exact(p,['schema','snapshot','retained','root','requestId','generation','rekeyExpiresAt','parent','installationId','workspaceId','serviceId','counts','rows','credentialPolicy']);
  validateInput(inputOf(p as unknown as StatePlan));validateNode(p.parent);for(const k of ['installationId','workspaceId','serviceId'])id(p[k]);exact(p.counts,[...TABLES]);
  let n=0;for(const v of Object.values(p.counts)){if(!Number.isSafeInteger(v)||(v as number)<0)fail('RESTORE_STATE','Invalid preparation counts',409);n+=v as number;}
  if(p.schema!=='ontology-restore-state-plan/v1'||p.root!==root||n!==p.rows||n>MAX_ROWS||p.credentialPolicy!==(p.retained===null?'REKEY_LOST_OWNER':'CURRENT'))fail('RESTORE_STATE','Invalid preparation plan',409);return p as unknown as StatePlan;
}
const barrier=(p:StatePlan)=>({schema:'ontology-restore-state-barrier/v1',requestId:p.requestId,reportDigest:backupHash(p),root:p.root,activation:'BLOCKED'});
function decisionFloor(a:Source,b:Source|null):number|null {
  const current=b??a,max=Number(current.db.prepare('SELECT coalesce(max(sequence),0) AS n FROM audit').get()!.n);
  if(!Number.isSafeInteger(max)||max<0)fail('RESTORE_STATE','Invalid retained audit sequence',409);
  const prior=current.identity.schema==='ontology-workspace/v2'?current.identity.recovery.decisionAuditFloor:null;
  if(typeof prior==='number'&&prior>max)fail('RESTORE_STATE','Recovery decision floor exceeds retained audit history',409);
  if(!b)return max;
  if(b.identity.schema==='ontology-workspace/v1')return null;
  const floor=b.identity.recovery.decisionAuditFloor;
  // A legacy recovered identity did not bind its original loss boundary.
  // Preserve its history and require a new explicit review, never guess it.
  return floor===undefined?max:floor;
}
function identityFor(p:StatePlan,a:Source,b:Source|null):WorkspaceIdentity {return {schema:'ontology-workspace/v2',workspaceId:p.workspaceId,serviceId:p.serviceId,stateVersion:14,createdAt:a.identity.createdAt,recovery:{schema:'ontology-workspace-recovery/v1',generation:p.generation,requestId:p.requestId,planDigest:backupHash(p),snapshotDigest:p.snapshot.manifestDigest,retainedDigest:p.retained?.manifestDigest??null,credentialPolicy:p.credentialPolicy,decisionAuditFloor:decisionFloor(a,b)}};}
function createEmpty(file:string):void {if(!workerFilePresent(file)){const fd=openSync(file,'wx',0o600);try{fsyncSync(fd);}finally{closeSync(fd);}syncRestoreDirectory(dirname(file));}privatePath(file);}
function compareRows(db:DatabaseSync,a:Source,b:Source|null,layout:Layout[],p:StatePlan):void {
  for(const l of layout){if(Number(db.prepare('SELECT count(*) AS n FROM '+l.name).get()!.n)!==p.counts[l.name])fail('RESTORE_STATE_CONFLICT','Prepared row count differs',409);for(const row of expectedRows(l,a,b)){const saved=lookup(db,l,row);if(!saved||!same(saved,row))fail('RESTORE_STATE_CONFLICT','Prepared history or selector differs',409);}}
}
function prepareDatabase(file:string,a:Source,b:Source|null,layout:Layout[],p:StatePlan,identity:WorkspaceIdentity,reference:DatabaseSync):void {
  createEmpty(file);if(lstatSync(file).size>LIMITS.stateBytes)fail('STATE_LIMIT','Prepared database exceeds byte budget',409);
  for(const suffix of ['-journal','-wal','-shm'])if(workerFilePresent(file+suffix))privatePath(file+suffix);
  const db=new DatabaseSync(file,{timeout:0}),raw=JSON.stringify(identity)+'\n';
  try{
    db.exec('PRAGMA trusted_schema=OFF;PRAGMA foreign_keys=ON;PRAGMA synchronous=FULL;BEGIN IMMEDIATE');
    if(db.prepare('PRAGMA journal_mode').get()?.journal_mode!=='delete')fail('RESTORE_STATE_CONFLICT','Unknown prepared journal mode',409);
    const version=db.prepare('PRAGMA user_version').get()?.user_version;
    if(version===STATE_VERSION){if(backupHash(schema(db))!==backupHash(schema(reference))||db.prepare('SELECT identity FROM workspace WHERE singleton=1').get()?.identity!==raw)fail('RESTORE_STATE_CONFLICT','Prepared database belongs to another recovery',409);compareRows(db,a,b,layout,p);db.exec('ROLLBACK');return;}
    if(version!==0||schema(db).length)fail('RESTORE_STATE_CONFLICT','Unknown partial database was preserved',409);
    const pageSize=Number(db.prepare('PRAGMA page_size').get()?.page_size);db.exec('PRAGMA max_page_count='+Math.floor(LIMITS.stateBytes/pageSize));db.exec(WORKSPACE_TABLES);
    for(const l of layout){const insert=db.prepare('INSERT INTO '+l.name+' ('+l.columns.join(',')+') VALUES('+l.columns.map(()=>'?').join(',')+')');for(const row of expectedRows(l,a,b))insert.run(...values(row,l.columns));}
    db.prepare('INSERT INTO workspace VALUES(1,?)').run(raw);db.exec('PRAGMA user_version='+STATE_VERSION);
    if(db.prepare('PRAGMA foreign_key_check').get())fail('RESTORE_STATE_CONFLICT','Prepared references are incomplete',409);compareRows(db,a,b,layout,p);db.exec('COMMIT');
  }catch(e){if(db.isTransaction)db.exec('ROLLBACK');if(e instanceof Error&&'errcode' in e&&e.errcode===13)fail('STATE_LIMIT','Prepared state byte budget or storage capacity reached',409);throw e;}finally{db.close();}
}
/** A random token can resume a partial private prefix before it is referenced
 * by any credentials. No token material is returned in a report or receipt. */
function rekeyToken(file:string):string {
  createEmpty(file);const fd=openSync(file,constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=fstatSync(fd),named=lstatSync(file);if(before.ino!==named.ino||before.dev!==named.dev||before.size>43)fail('RESTORE_CREDENTIAL_CONFLICT','Rekey token identity differs',409);
    const prefix=readFileSync(fd,'utf8');if(!/^[A-Za-z0-9_-]*$/.test(prefix))fail('RESTORE_CREDENTIAL_CONFLICT','Invalid partial rekey material was preserved',409);
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-',suffix=[...randomBytes(43-prefix.length)].map(n=>alphabet[n%64]).join(''),bytes=Buffer.from(suffix);let offset=0;
    while(offset<bytes.length){const n=writeSync(fd,bytes,offset,bytes.length-offset,prefix.length+offset);if(!n)fail('RESTORE_IO','Rekey write made no progress',409);offset+=n;}fsyncSync(fd);
    const after=lstatSync(file);if(after.ino!==before.ino||after.dev!==before.dev)fail('RESTORE_CREDENTIAL_CONFLICT','Rekey token was replaced',409);return prefix+suffix;
  }finally{closeSync(fd);}
}
function copyWorkspaceFiles(p:StatePlan,a:Source,b:Source|null,identity:WorkspaceIdentity):void {
  const source=b??a,root=join(p.root,'workspace'),entries=source.stage.plan.backup.manifest.plan.entries.filter(e=>e.scope==='workspace'),dirs=entries.filter(e=>e.kind==='directory').sort((a,b)=>a.path.split('/').length-b.path.split('/').length);
  for(const e of dirs){const dir=join(root,e.path);if(!workerFilePresent(dir)){mkdirSync(dir,{mode:0o700});syncRestoreDirectory(dirname(dir));}privatePath(dir,true);}
  for(const e of entries)if(e.kind==='file'&&![FILES.identity,FILES.db,...(b?[]:[FILES.credentials,'operator-token'])].includes(e.path))restoreStagedFile(join(source.root,e.path),e,join(root,e.path));
  if(!b){
    const selected=selectedCredentials(a),i=a.stage.plan.backup.manifest.plan.installation,token=rekeyToken(join(root,'operator-token'));
    const credentials:Credentials={...selected.credentials,grants:[...selected.credentials.grants.filter(g=>g.id!==selected.operatorId).map(g=>({...g,revoked:true})),{id:'recovery-'+p.generation,principalId:i.principalId,tokenHash:hashBytes(token),projectIds:[i.projectId],permissions:['read','write'],expiresAt:p.rekeyExpiresAt!,revoked:false}]};
    validateCredentials(credentials,identity);writeBackupJSON(join(root,FILES.credentials),credentials);
  }
  writeBackupJSON(join(root,FILES.identity),identity);
  for(const e of [...dirs].reverse()){chmodSync(join(root,e.path),e.mode);syncRestoreDirectory(join(root,e.path));}
}
function checkControlRoot(p:StatePlan,complete:boolean):void {
  const allowedRoot=new Set(['plan.json','operator.sqlite','operator.sqlite-journal','workspace',...(complete?['manifest.json']:['manifest.json.pending'])]);
  for(const name of readdirSync(p.root)){if(!allowedRoot.has(name))fail('RESTORE_STATE_CONFLICT','Unselected recovery control material was preserved',409);privatePath(join(p.root,name),name==='workspace');if(name.startsWith('operator.sqlite')&&lstatSync(join(p.root,name)).size>65536)fail('RESTORE_STATE_CONFLICT','Oversized recovery lease control',409);}
}
function checkLayout(p:StatePlan,source:Source,complete:boolean):void {
  checkControlRoot(p,false);
  const expected=new Map(source.stage.plan.backup.manifest.plan.entries.filter(e=>e.scope==='workspace').map(e=>[e.path,e.kind]));
  const controls=new Set([RESTORE_STAGE_BARRIER,FILES.lease,FILES.lease+'-journal',...(!complete?[RESTORE_STAGE_BARRIER+'.pending',FILES.identity+'.pending',FILES.db+'-journal',...(!p.retained?[FILES.credentials+'.pending']:[])]:[])]);
  const visit=(dir:string,prefix:string,depth:number):void=>{
    if(depth>BACKUP_LIMITS.depth)fail('RESTORE_LIMIT','Prepared directory depth limit',409);privatePath(dir,true);
    for(const name of readdirSync(dir)){const relative=prefix?prefix+'/'+name:name,file=join(dir,name);if(controls.has(relative)){privatePath(file);continue;}const kind=expected.get(relative);if(!kind)fail('RESTORE_STATE_CONFLICT','Unselected candidate material was preserved',409);privatePath(file,kind==='directory');if(kind==='directory')visit(file,relative,depth+1);}
  };
  const root=join(p.root,'workspace');if(workerFilePresent(root))visit(root,'',1);
}
interface PreparedFile {path:string;kind:'file'|'directory';node:NodeIdentity;bytes:number;digest:string|null;}
function inventory(p:StatePlan,root=join(p.root,'workspace'),activating=false):PreparedFile[]{
  const result:PreparedFile[]=[];let total=0;
  const visit=(dir:string,prefix:string,depth:number):void=>{
    if(depth>BACKUP_LIMITS.depth)fail('RESTORE_LIMIT','Prepared workspace depth limit',409);
    for(const name of readdirSync(dir).sort()){
      const relative=prefix?prefix+'/'+name:name,file=join(dir,name);
      if(!prefix&&[RESTORE_STAGE_BARRIER,FILES.lease,FILES.lease+'-journal',...(activating?[RESTORE_ACTIVATION_BARRIER]:[])].includes(name)){privatePath(file);if(lstatSync(file).size>65536)fail('RESTORE_STATE','Oversized private preparation control',409);continue;}
      if(result.length>=BACKUP_LIMITS.entries)fail('RESTORE_LIMIT','Prepared file count limit',409);
      const directory=lstatSync(file).isDirectory(),node=backupNode(file,directory),bytes=directory?0:lstatSync(file).size;if(bytes>BACKUP_LIMITS.fileBytes||(total+=bytes)>BACKUP_LIMITS.totalBytes)fail('RESTORE_LIMIT','Prepared byte budget',409);
      const checksum=directory?null:fileDigest(file,BACKUP_LIMITS.fileBytes);
      if(!directory&&backupHash(restoredFileImage(file,{scope:'workspace',path:relative,kind:'file',...node,bytes,digest:checksum}))!==backupHash(node))fail('RESTORE_STATE','Prepared file identity changed during inventory',409);
      result.push({path:relative,kind:directory?'directory':'file',node,bytes,digest:checksum});if(directory)visit(file,relative,depth+1);
    }
  };visit(root,'',1);return result;
}
function completion(p:StatePlan):{receipt:Json;manifest:Json;manifestDigest:string} {
  const v:unknown=JSON.parse(privateRead(join(p.root,'manifest.json'),BACKUP_LIMITS.manifestBytes));exact(v,['manifest','manifestDigest','receipt']);digest(v.manifestDigest);exact(v.manifest,['schema','requestId','reportDigest','root','workspace','identity','files']);validateIdentity(v.manifest.identity);validateNode(v.manifest.root);validateNode(v.manifest.workspace);
  const identity=v.manifest.identity;
  if(!Array.isArray(v.manifest.files)||v.manifest.files.length>BACKUP_LIMITS.entries)fail('RESTORE_STATE','Prepared file inventory exceeds its budget',409);
  const paths=new Set<string>();let bytes=0;
  for(const f of v.manifest.files){
    exact(f,['path','kind','node','bytes','digest']);validateNode(f.node);
    if(typeof f.path!=='string'||!f.path||f.path.length>4096||isAbsolute(f.path)||f.path.split('/').some(n=>!n||n==='.'||n==='..')||f.path.split('/').length>BACKUP_LIMITS.depth||paths.has(f.path)||!['file','directory'].includes(String(f.kind))||!Number.isSafeInteger(f.bytes)||(f.bytes as number)<0||(f.bytes as number)>BACKUP_LIMITS.fileBytes)fail('RESTORE_STATE','Invalid prepared file entry',409);
    paths.add(f.path);bytes+=f.bytes as number;if(f.kind==='file')digest(f.digest);else if(f.bytes!==0||f.digest!==null)fail('RESTORE_STATE','Invalid prepared directory entry',409);
  }
  if(bytes>BACKUP_LIMITS.totalBytes)fail('RESTORE_LIMIT','Prepared inventory exceeds aggregate byte budget',409);
  if(identity.schema!=='ontology-workspace/v2'||identity.workspaceId!==p.workspaceId||identity.serviceId!==p.serviceId||identity.recovery.planDigest!==backupHash(p)||identity.recovery.generation!==p.generation||identity.recovery.requestId!==p.requestId||identity.recovery.snapshotDigest!==p.snapshot.manifestDigest||identity.recovery.retainedDigest!==(p.retained?.manifestDigest??null)||identity.recovery.credentialPolicy!==p.credentialPolicy||v.manifest.schema!=='ontology-restore-state-manifest/v1'||v.manifest.requestId!==p.requestId||v.manifest.reportDigest!==backupHash(p)||backupHash(v.manifest)!==v.manifestDigest||backupHash(v.receipt)!==backupHash(stateReceipt(p,v.manifestDigest,identity)))fail('RESTORE_STATE','Prepared completion differs',409);
  return v as unknown as {receipt:Json;manifest:Json;manifestDigest:string};
}
function stateReceipt(p:StatePlan,manifestDigest:string,identity:WorkspaceIdentity):Json {return {schema:'ontology-restore-state-receipt/v1',requestId:p.requestId,reportDigest:backupHash(p),manifestDigest,workspaceId:p.workspaceId,serviceId:p.serviceId,requestIdPrefix:recoveryRequestPrefix(identity),credentialPolicy:p.credentialPolicy,activation:'BLOCKED',authority:false};}
export function inspectRestoreState(input:RestoreStateInput):Json {
  validateInput(input);
  if(workerFilePresent(input.root)){const p=readPlan(input.root);if(backupHash(inputOf(p))!==backupHash(input))fail('REQUEST_CONFLICT','Prepared state belongs to another request',409);return {status:workerFilePresent(join(p.root,'manifest.json'))?'PREPARED':'PENDING',report:p as unknown as Json,reportDigest:backupHash(p),activation:'BLOCKED',authority:false};}
  return sources(input,(a,b,l)=>{const p=planFor(input,a,b,l);return {status:'READY_TO_PREPARE',report:p as unknown as Json,reportDigest:backupHash(p),activation:'BLOCKED',authority:false};});
}
export function prepareRestoreState(input:RestoreStateInput,expectedReportDigest:string):Json {
  validateInput(input);digest(expectedReportDigest);const exists=workerFilePresent(input.root),retained=exists?readPlan(input.root):null;
  if(retained&&(backupHash(inputOf(retained))!==backupHash(input)||backupHash(retained)!==expectedReportDigest))fail('REQUEST_CONFLICT','Preparation differs from original request',409);
  if(retained&&workerFilePresent(join(input.root,'manifest.json')))return {receipt:completion(retained).receipt,replayed:true,verification:'NOT_RUN',activation:'BLOCKED',authority:false};
  return sources(input,(a,b,layout,reference)=>{
    const p=planFor(input,a,b,layout);if(backupHash(p)!==expectedReportDigest)fail('REQUEST_CONFLICT','Preparation inspection changed',409);
    if(!exists){if(!b&&(Date.parse(p.rekeyExpiresAt!)<=Date.now()||Date.parse(p.rekeyExpiresAt!)>Date.now()+30*86400000))fail('INVALID_INPUT','Recovery credential expiry must be within the next 30 days');mkdirSync(p.root,{mode:0o700});syncRestoreDirectory(dirname(p.root));writeBackupJSON(join(p.root,'plan.json'),p);}
    const unlock=operatorLock(p.root);
    try{
      if(workerFilePresent(join(p.root,'manifest.json')))return {receipt:completion(p).receipt,replayed:true,verification:'NOT_RUN',activation:'BLOCKED',authority:false};
      checkLayout(p,b??a,false);
      const root=join(p.root,'workspace');if(!workerFilePresent(root)){mkdirSync(root,{mode:0o700});syncRestoreDirectory(p.root);}privatePath(root,true);writeBackupJSON(join(root,RESTORE_STAGE_BARRIER),barrier(p));
      const identity=identityFor(p,a,b);validateIdentity(identity);prepareDatabase(join(root,FILES.db),a,b,layout,p,identity,reference);copyWorkspaceFiles(p,a,b,identity);
      createEmpty(join(root,FILES.lease));const lease=privateLease(join(root,FILES.lease),'WORKSPACE_BUSY','Another preparation owns the candidate');lease.close();
      for(const s of [a,...(b?[b]:[])])readVerifiedRestoreStage(s.selection.root,s.selection.manifestDigest);
      checkLayout(p,b??a,true);
      const manifest={schema:'ontology-restore-state-manifest/v1',requestId:p.requestId,reportDigest:backupHash(p),root:backupNode(p.root),workspace:backupNode(root),identity,files:inventory(p)},manifestDigest=backupHash(manifest),receipt=stateReceipt(p,manifestDigest,identity);
      writeBackupJSON(join(p.root,'manifest.json'),{manifest,manifestDigest,receipt});return {receipt,replayed:false,verification:'VERIFIED',activation:'BLOCKED',authority:false};
    }finally{unlock();}
  });
}
export function verifyPreparedRestoreState(root:string,expectedManifestDigest:string):Json {
  digest(expectedManifestDigest);const p=readPlan(root),saved=completion(p),m=saved.manifest as {[key:string]:Json};
  checkControlRoot(p,true);
  if(saved.manifestDigest!==expectedManifestDigest||backupHash(backupNode(root))!==backupHash(m.root)||backupHash(backupNode(join(root,'workspace')))!==backupHash(m.workspace)||backupHash(inventory(p))!==backupHash(m.files)||privateRead(join(root,'workspace',RESTORE_STAGE_BARRIER),65536)!==JSON.stringify(barrier(p))+'\n')fail('RESTORE_STATE','Prepared bytes, storage identity or activation barrier differs',409);
  return {status:'VERIFIED',receipt:saved.receipt,activation:'BLOCKED',authority:false};
}
/** Read-only operator proof for the same prepared inode before/after an atomic
 * directory move. It cannot remove barriers or open a writable domain service. */
export function readPreparedRestoreLocation(root:string,expectedManifestDigest:string,workspaceRoot:string) {
  path(workspaceRoot);digest(expectedManifestDigest);const plan=readPlan(root),saved=completion(plan),m=saved.manifest as {[key:string]:Json};checkControlRoot(plan,true);
  if(saved.manifestDigest!==expectedManifestDigest||backupHash(backupNode(root))!==backupHash(m.root)||backupHash(backupNode(workspaceRoot))!==backupHash(m.workspace)||backupHash(inventory(plan,workspaceRoot,true))!==backupHash(m.files)||privateRead(join(workspaceRoot,RESTORE_STAGE_BARRIER),65536)!==JSON.stringify(barrier(plan))+'\n')fail('RESTORE_STATE','Moved preparation differs from its exact retained state',409);
  return {plan,manifest:saved.manifest,manifestDigest:saved.manifestDigest,receipt:saved.receipt,barrier:barrier(plan)};
}
export function withPreparedRestoreState<T>(root:string,expectedManifestDigest:string,use:(store:{db:DatabaseSync;identity:WorkspaceIdentity;guard:()=>void})=>T,workspace=join(root,'workspace')):T {
  const saved=readPreparedRestoreLocation(root,expectedManifestDigest,workspace),file=join(workspace,FILES.db),raw=privateRead(join(workspace,FILES.identity),4096),identity:unknown=JSON.parse(raw);validateIdentity(identity);
  const stamp=()=>{const s=lstatSync(file,{bigint:true});return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.mode].join(':');},before=stamp(),db=new DatabaseSync(file,{readOnly:true});
  const guard=()=>{privatePath(file);if(stamp()!==before||privateRead(join(workspace,FILES.identity),4096)!==raw)fail('RESTORE_STATE','Prepared read-only state changed',409);};
  try{db.exec('PRAGMA trusted_schema=OFF;BEGIN');guard();const result=use({db,identity,guard});guard();readPreparedRestoreLocation(root,saved.manifestDigest,workspace);return result;}finally{db.close();}
}
