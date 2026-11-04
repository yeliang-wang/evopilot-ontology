import {isAbsolute} from 'node:path';
import type {Installation} from './manager.js';
import {exact,id,digest,hash,text} from '../standalone/validation.js';
import type {Json} from '../standalone/types.js';
import {fail} from '../standalone/types.js';

export const BACKUP_LIMITS={entries:10000,depth:16,fileBytes:64*1024*1024,totalBytes:2*1024*1024*1024,manifestBytes:8*1024*1024,requests:128} as const;
export const BACKUP_RECORDS='backup-requests';
export interface NodeIdentity {device:string;inode:string;mode:number;}
export interface BackupEntry extends NodeIdentity {scope:'installation'|'workspace';path:string;kind:'file'|'directory';bytes:number;digest:string|null;}
export interface BackupReceipt {schema:'ontology-backup-receipt/v1';requestId:string;requestDigest:string;reportDigest:string;manifestDigest:string;backupRoot:string;files:number;logicalBytes:number;authority:false;}
export interface AbortReceipt {schema:'ontology-backup-abort-receipt/v1';requestId:string;requestDigest:string;reportDigest:string;backupRoot:string;partialCopyRetained:true;authority:false;}
export interface BackupRecord {schema:'ontology-backup-request/v1';installationId:string;workspaceId:string;serviceId:string;requestId:string;requestDigest:string;reportDigest:string;backupRoot:string;state:'PENDING'|'COMPLETED'|'ABORTED';receipt:BackupReceipt|AbortReceipt|null;}
export interface BackupPlan {schema:'ontology-backup-plan/v1';installation:Installation;backupRoot:string;targetParent:NodeIdentity;roots:{installation:NodeIdentity;workspace:NodeIdentity};entries:BackupEntry[];priorBackups:BackupRecord[];toolchainBindingDigest:string|null;formalTasks:number;workerAttempts:number;workerJournals:number;}
export interface BackupOwner {schema:'ontology-backup-owner/v1';installationId:string;workspaceId:string;serviceId:string;requestId:string;requestDigest:string;reportDigest:string;backupRoot:string;root:NodeIdentity;objects:NodeIdentity;}
export interface BackupManifest {schema:'ontology-backup-manifest/v1';requestId:string;requestDigest:string;plan:BackupPlan;reportDigest:string;}
export interface BackupEnvelope {manifest:BackupManifest;manifestDigest:string;receipt:BackupReceipt;}
export const backupHash=(v:unknown)=>hash(v as Json);
export function validateNode(v:unknown):asserts v is NodeIdentity {
  exact(v,['device','inode','mode']);for(const k of ['device','inode'])if(typeof v[k]!=='string'||!/^\d{1,24}$/.test(v[k] as string))fail('BACKUP_EVIDENCE','Invalid filesystem identity',409);
  if(!Number.isInteger(v.mode)||(v.mode as number)<0||(v.mode as number)>0o700||((v.mode as number)&0o077)!==0)fail('BACKUP_EVIDENCE','Backup requires private modes',409);
}
export function backupRequestDigest(i:Pick<Installation,'installationId'|'workspaceId'|'serviceId'>,backupRoot:string,reportDigest:string):string {
  return backupHash({installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,backupRoot,reportDigest});
}
export function validateBackupRecord(v:unknown,i:Pick<Installation,'installationId'|'workspaceId'|'serviceId'>):asserts v is BackupRecord {
  exact(v,['schema','installationId','workspaceId','serviceId','requestId','requestDigest','reportDigest','backupRoot','state','receipt']);id(v.requestId);digest(v.requestDigest);digest(v.reportDigest);text(v.backupRoot,4096);
  if(v.schema!=='ontology-backup-request/v1'||v.installationId!==i.installationId||v.workspaceId!==i.workspaceId||v.serviceId!==i.serviceId||!isAbsolute(v.backupRoot)||backupRequestDigest(i,v.backupRoot,v.reportDigest)!==v.requestDigest||!['PENDING','COMPLETED','ABORTED'].includes(v.state as string))fail('BACKUP_EVIDENCE','Backup request belongs to different parameters or owner',409);
  if(v.state==='PENDING'){if(v.receipt!==null)fail('BACKUP_EVIDENCE','Pending request has a completion receipt',409);return;}
  const r=v.receipt;exact(r,['schema','requestId','requestDigest','reportDigest','backupRoot','authority',...(v.state==='COMPLETED'?['manifestDigest','files','logicalBytes']:['partialCopyRetained'])]);
  if(r.requestId!==v.requestId||r.requestDigest!==v.requestDigest||r.reportDigest!==v.reportDigest||r.backupRoot!==v.backupRoot||r.authority!==false)fail('BACKUP_EVIDENCE','Backup receipt differs from its request',409);
  if(v.state==='COMPLETED'){
    digest(r.manifestDigest);if(r.schema!=='ontology-backup-receipt/v1'||!Number.isSafeInteger(r.files)||(r.files as number)<1||(r.files as number)>BACKUP_LIMITS.entries||!Number.isSafeInteger(r.logicalBytes)||(r.logicalBytes as number)<0||(r.logicalBytes as number)>BACKUP_LIMITS.totalBytes)fail('BACKUP_EVIDENCE','Invalid backup receipt counters',409);
  }else if(r.schema!=='ontology-backup-abort-receipt/v1'||r.partialCopyRetained!==true)fail('BACKUP_EVIDENCE','Invalid abort receipt',409);
}
export function validateBackupPlan(v:unknown):asserts v is BackupPlan {
  if(Buffer.byteLength(JSON.stringify(v))>BACKUP_LIMITS.manifestBytes-8192)fail('BACKUP_LIMIT','Backup plan exceeds its envelope',409);
  exact(v,['schema','installation','backupRoot','targetParent','roots','entries','priorBackups','toolchainBindingDigest','formalTasks','workerAttempts','workerJournals']);
  const i=v.installation;exact(i,['schema','installationId','root','workspaceRoot','workspaceId','serviceId','projectId','principalId','credentialFile','runtime','port','createdAt']);
  for(const k of ['installationId','workspaceId','serviceId','projectId','principalId'])id(i[k]);
  for(const p of [i.root,i.workspaceRoot,i.credentialFile,v.backupRoot]){text(p,4096);if(!isAbsolute(p))fail('BACKUP_EVIDENCE','Absolute backup references required',409);}
  if(v.schema!=='ontology-backup-plan/v1'||i.schema!=='ontology-installation/v1'||i.credentialFile!==i.workspaceRoot+'/operator-token'||!Number.isInteger(i.port)||(i.port as number)<0||(i.port as number)>65535)fail('BACKUP_EVIDENCE','Invalid installation snapshot',409);text(i.createdAt,40);
  const rt=i.runtime;exact(rt,['root','packageRoot','version','digest','files','bytes','nodePath','nodeDigest','nodeVersion']);digest(rt.digest);digest(rt.nodeDigest);
  for(const p of [rt.root,rt.packageRoot,rt.nodePath]){text(p,4096);if(!isAbsolute(p))fail('BACKUP_EVIDENCE','Absolute runtime references required',409);}
  text(rt.version,40);text(rt.nodeVersion,40);if(rt.packageRoot!==rt.root+'/node_modules/@evopilot-next/ontology'||![rt.files,rt.bytes].every(n=>Number.isSafeInteger(n)&&(n as number)>=0))fail('BACKUP_EVIDENCE','Invalid runtime snapshot',409);
  validateNode(v.targetParent);exact(v.roots,['installation','workspace']);validateNode(v.roots.installation);validateNode(v.roots.workspace);
  if(v.toolchainBindingDigest!==null)digest(v.toolchainBindingDigest);
  for(const [k,max] of [['formalTasks',4096],['workerAttempts',17*4096],['workerJournals',17]] as const)if(!Number.isSafeInteger(v[k])||(v[k] as number)<0||(v[k] as number)>max)fail('BACKUP_EVIDENCE','Invalid formal inventory count',409);
  if(!Array.isArray(v.entries)||v.entries.length>BACKUP_LIMITS.entries||!Array.isArray(v.priorBackups)||v.priorBackups.length>=BACKUP_LIMITS.requests)fail('BACKUP_LIMIT','Backup inventory exceeds its count budget',409);
  const paths=new Set<string>();let bytes=0;
  for(const e of v.entries){
    exact(e,['scope','path','kind','device','inode','mode','bytes','digest']);validateNode({device:e.device,inode:e.inode,mode:e.mode});text(e.path,4096);
    if(!['installation','workspace'].includes(e.scope as string)||!['file','directory'].includes(e.kind as string)||isAbsolute(e.path)||e.path.split('/').some(p=>!p||p==='.'||p==='..')||e.path.split('/').length>BACKUP_LIMITS.depth||paths.has(e.scope+'/'+e.path))fail('BACKUP_EVIDENCE','Invalid or duplicate inventory path',409);paths.add(e.scope+'/'+e.path);
    if(e.kind==='directory'){if(e.bytes!==0||e.digest!==null)fail('BACKUP_EVIDENCE','Invalid directory inventory',409);}
    else{digest(e.digest);if(!Number.isSafeInteger(e.bytes)||(e.bytes as number)<0||(e.bytes as number)>BACKUP_LIMITS.fileBytes)fail('BACKUP_LIMIT','File exceeds the backup byte budget',409);bytes+=e.bytes as number;}
  }
  if(bytes>BACKUP_LIMITS.totalBytes)fail('BACKUP_LIMIT','Backup exceeds its aggregate byte budget',409);
  for(const [scope,path] of [['installation','installation.json'],['installation','setup.json'],['workspace','identity.json'],['workspace','ontology.sqlite'],['workspace','credentials.json'],['workspace','operator-token']])if(!v.entries.some(e=>e.scope===scope&&e.path===path&&e.kind==='file'))fail('BACKUP_EVIDENCE','Required owner state is missing',409);
  const requests=new Set<string>();for(const r of v.priorBackups){validateBackupRecord(r,i as unknown as Installation);if(r.state==='PENDING'||requests.has(r.requestId))fail('BACKUP_EVIDENCE','Prior backup control history is unfinished or ambiguous',409);requests.add(r.requestId);}
}
export function validateBackupOwner(v:unknown,plan:BackupPlan):asserts v is BackupOwner {
  exact(v,['schema','installationId','workspaceId','serviceId','requestId','requestDigest','reportDigest','backupRoot','root','objects']);id(v.requestId);digest(v.requestDigest);digest(v.reportDigest);validateNode(v.root);validateNode(v.objects);
  if(v.schema!=='ontology-backup-owner/v1'||v.installationId!==plan.installation.installationId||v.workspaceId!==plan.installation.workspaceId||v.serviceId!==plan.installation.serviceId||v.backupRoot!==plan.backupRoot||v.reportDigest!==backupHash(plan)||v.requestDigest!==backupRequestDigest(plan.installation,plan.backupRoot,v.reportDigest))fail('BACKUP_EVIDENCE','Backup destination belongs to different parameters',409);
}
export function backupReceipt(manifest:BackupManifest):BackupReceipt {
  const plan=manifest.plan,reportDigest=backupHash(plan);return {schema:'ontology-backup-receipt/v1',requestId:manifest.requestId,requestDigest:backupRequestDigest(plan.installation,plan.backupRoot,reportDigest),reportDigest,manifestDigest:backupHash(manifest),backupRoot:plan.backupRoot,files:plan.entries.filter(e=>e.kind==='file').length,logicalBytes:plan.entries.reduce((n,e)=>n+e.bytes,0),authority:false};
}
