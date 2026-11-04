import {constants,mkdirSync,readdirSync,lstatSync,openSync,closeSync,fstatSync,readSync,writeSync,fsyncSync,fchmodSync,renameSync} from 'node:fs';
import {dirname,join} from 'node:path';
import type {BigIntStats} from 'node:fs';
import type {UpgradeAdmission} from './upgrade-control.js';
import {backupHash,validateNode,BACKUP_LIMITS} from './backup-contract.js';
import type {NodeIdentity} from './backup-contract.js';
import {backupNode,writeBackupJSON} from './backup-files.js';
import {workerFilePresent} from './worker-archives.js';
import {privatePath,privateRead,upgradeControlKey,UPGRADE_RECORDS} from '../standalone/workspace.js';
import {exact,hashBytes} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';

export interface UpgradeStageOwner {schema:'ontology-upgrade-stage-owner/v1';requestId:string;requestDigest:string;reportDigest:string;installationId:string;workspaceId:string;serviceId:string;root:string;node:NodeIdentity;}
export interface UpgradeImageEntry extends NodeIdentity {path:string;kind:'file'|'directory';bytes:number;digest:string|null;}
export const UPGRADE_IMAGE_LIMITS={entries:2048,depth:28,fileBytes:2*1024*1024,totalBytes:24*1024*1024} as const;
const eq=(a:unknown,b:unknown)=>backupHash(a)===backupHash(b);
export const upgradeStageFile=(a:UpgradeAdmission):string=>join(a.report.ownerSnapshot.installation.root,UPGRADE_RECORDS,upgradeControlKey(a.input.requestId)+'.stage.json');
export function syncUpgradeDirectory(root:string):void {privatePath(root,true);const fd=openSync(root,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
const owner=(a:UpgradeAdmission):UpgradeStageOwner=>{const i=a.report.ownerSnapshot.installation;return {schema:'ontology-upgrade-stage-owner/v1',requestId:a.input.requestId,requestDigest:a.requestDigest,reportDigest:a.reportDigest,installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,root:a.input.upgradeRoot,node:backupNode(a.input.upgradeRoot)};};
export function readUpgradeStageOwner(a:UpgradeAdmission):UpgradeStageOwner|null {
  const file=upgradeStageFile(a);if(!workerFilePresent(file))return null;
  const v:unknown=JSON.parse(privateRead(file,65536));exact(v,['schema','requestId','requestDigest','reportDigest','installationId','workspaceId','serviceId','root','node']);validateNode(v.node);
  const i=a.report.ownerSnapshot.installation;
  if(v.schema!=='ontology-upgrade-stage-owner/v1'||v.requestId!==a.input.requestId||v.requestDigest!==a.requestDigest||v.reportDigest!==a.reportDigest||v.installationId!==i.installationId||v.workspaceId!==i.workspaceId||v.serviceId!==i.serviceId||v.root!==a.input.upgradeRoot)fail('UPGRADE_STAGE_EVIDENCE','Stage owner differs from the original admission',409);
  return v as unknown as UpgradeStageOwner;
}
/** A root created just before interruption can be adopted only while empty.
 * Materialization begins only after its exact physical anchor is durable. */
export function admittedUpgradeStageNode(a:UpgradeAdmission):NodeIdentity|undefined {
  const saved=readUpgradeStageOwner(a),file=upgradeStageFile(a);
  if(saved){
    if(workerFilePresent(file+'.pending')||!eq(backupNode(saved.root),saved.node))fail('UPGRADE_STAGE_EVIDENCE','Stage owner is ambiguous or its physical root changed',409);return saved.node;
  }
  if(!workerFilePresent(a.input.upgradeRoot)){
    if(workerFilePresent(file+'.pending'))fail('UPGRADE_STAGE_EVIDENCE','Partial stage owner lost its physical root',409);return undefined;
  }
  const proposed=owner(a);if(readdirSync(proposed.root).length)fail('UPGRADE_PHASE_UNKNOWN','Unowned staging material was preserved',409);
  if(workerFilePresent(file+'.pending')&&!(JSON.stringify(proposed)+'\n').startsWith(privateRead(file+'.pending',65536)))fail('UPGRADE_STAGE_EVIDENCE','Foreign stage ownership prefix was preserved',409);
  return proposed.node;
}
export function upgradeStageLayout(a:UpgradeAdmission):void {
  const saved=readUpgradeStageOwner(a);if(!saved||!eq(backupNode(saved.root),saved.node))fail('UPGRADE_STAGE_EVIDENCE','Original stage root is required',409);
  const names=readdirSync(saved.root);let timestamps=0;
  for(const name of names){
    const directory=['next','pending'].includes(name),temporary=/^recorded-at\.json\.pending-[a-f0-9-]{36}$/.test(name);
    if(!directory&&!temporary&&!['recorded-at.json','prepared.json','prepared.json.pending'].includes(name))fail('UPGRADE_PHASE_UNKNOWN','Unrecognized staging or switch material was preserved',409);
    const path=join(saved.root,name);privatePath(path,directory);
    if(temporary&&++timestamps>16||!directory&&lstatSync(path).size>(name.startsWith('prepared.')?BACKUP_LIMITS.manifestBytes:65536))fail('UPGRADE_STAGE_LIMIT','Stage control material exceeds its fixed budget',409);
  }
}
export function ensureUpgradeStage(a:UpgradeAdmission):UpgradeStageOwner {
  if(!workerFilePresent(a.input.upgradeRoot)){
    if(readUpgradeStageOwner(a)||workerFilePresent(upgradeStageFile(a)+'.pending'))fail('UPGRADE_STAGE_EVIDENCE','Original stage root is missing; no replacement was created',409);
    mkdirSync(a.input.upgradeRoot,{mode:0o700});syncUpgradeDirectory(dirname(a.input.upgradeRoot));
  }
  admittedUpgradeStageNode(a);const saved=readUpgradeStageOwner(a)??owner(a);
  writeBackupJSON(upgradeStageFile(a),saved);syncUpgradeDirectory(dirname(upgradeStageFile(a)));upgradeStageLayout(a);return saved;
}
/** Abort preserves all staged payloads. Root ownership and the absence of any
 * later switch protocol must be proven before releasing original owner barriers. */
export function preserveUpgradeStageForAbort(a:UpgradeAdmission):void {
  if(!workerFilePresent(a.input.upgradeRoot)&&!readUpgradeStageOwner(a)&&!workerFilePresent(upgradeStageFile(a)+'.pending'))return;
  ensureUpgradeStage(a);upgradeStageLayout(a);
}
const stamp=(s:BigIntStats)=>[s.dev,s.ino,s.mode,s.size,s.mtimeNs,s.ctimeNs].join(':');
function held(fd:number):BigIntStats {
  const s=fstatSync(fd,{bigint:true});if(!s.isFile()||s.nlink!==1n||s.uid!==BigInt(process.getuid!())||(s.mode&0o077n)!==0n)fail('UPGRADE_STAGE_EVIDENCE','Private owned regular stage file required',409);return s;
}
export function readUpgradeBytes(path:string,max=UPGRADE_IMAGE_LIMITS.fileBytes):Buffer {
  privatePath(path);const before=lstatSync(path,{bigint:true}),fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const s=held(fd);if(stamp(s)!==stamp(before)||s.size>BigInt(max))fail('UPGRADE_STAGE_EVIDENCE','Staged file changed or exceeds its budget',409);
    const bytes=Buffer.alloc(Number(s.size));let at=0;
    while(at<bytes.length){const n=readSync(fd,bytes,at,bytes.length-at,at);if(!n)fail('UPGRADE_STAGE_EVIDENCE','Stage file ended before its recorded size',409);at+=n;}
    if(stamp(held(fd))!==stamp(s)||stamp(lstatSync(path,{bigint:true}))!==stamp(s))fail('UPGRADE_STAGE_EVIDENCE','Staged bytes changed during read',409);return bytes;
  }finally{closeSync(fd);}
}
/** Binary payloads use a separate path-hashed pending namespace: a private
 * user's legitimate *.pending plugin file is never a protocol staging file. */
export function writeUpgradeBytes(target:string,temp:string,bytes:Buffer,mode:number):void {
  if(bytes.length>UPGRADE_IMAGE_LIMITS.fileBytes||!Number.isInteger(mode)||mode<0||mode>0o700||(mode&0o077))fail('UPGRADE_STAGE_LIMIT','Invalid private staged payload size or mode',409);
  const parent=dirname(target),temporaryParent=dirname(temp),parents=[backupNode(parent),backupNode(temporaryParent)];
  if(workerFilePresent(target)){
    if(workerFilePresent(temp)||backupNode(target,false).mode!==mode||!readUpgradeBytes(target).equals(bytes))fail('UPGRADE_STAGE_EVIDENCE','Existing payload differs or has ambiguous pending bytes',409);
    const fd=openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{held(fd);fsyncSync(fd);}finally{closeSync(fd);}syncUpgradeDirectory(parent);return;
  }
  let prefix:Buffer=Buffer.alloc(0),finished=false;let prefixNode:NodeIdentity|undefined;
  if(workerFilePresent(temp)){
    prefixNode=backupNode(temp,false);prefix=readUpgradeBytes(temp);const node=backupNode(temp,false);if(!eq(prefixNode,node))fail('UPGRADE_STAGE_EVIDENCE','Pending payload changed during prefix inspection',409);finished=prefix.length===bytes.length&&node.mode===mode;
    if(prefix.length>bytes.length||!prefix.equals(bytes.subarray(0,prefix.length))||!finished&&node.mode!==0o600)fail('UPGRADE_STAGE_EVIDENCE','Foreign staged payload prefix was preserved',409);
  }
  const exists=workerFilePresent(temp),fd=openSync(temp,finished?constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK:exists?constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK:constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{
    const s=held(fd);if(s.size!==BigInt(prefix.length)||exists&&(!prefixNode||String(s.dev)!==prefixNode.device||String(s.ino)!==prefixNode.inode||Number(s.mode&0o777n)!==prefixNode.mode))fail('UPGRADE_STAGE_EVIDENCE','Pending payload identity changed',409);
    if(!finished){let at=prefix.length;while(at<bytes.length){const n=writeSync(fd,bytes,at,bytes.length-at,at);if(!n)fail('UPGRADE_STAGE_IO','Staging write made no progress',409);at+=n;}fchmodSync(fd,mode);}
    fsyncSync(fd);
    const named=lstatSync(temp,{bigint:true});if(named.dev!==s.dev||named.ino!==s.ino||!eq(backupNode(parent),parents[0])||!eq(backupNode(temporaryParent),parents[1])||workerFilePresent(target))fail('UPGRADE_STAGE_EVIDENCE','Staging path changed before rename',409);
    renameSync(temp,target);syncUpgradeDirectory(parent);syncUpgradeDirectory(temporaryParent);
  }finally{closeSync(fd);}
}
export function inspectUpgradeImage(root:string):UpgradeImageEntry[] {
  const entries:UpgradeImageEntry[]=[];let total=0;
  const visit=(path:string,relative:string,depth:number):void=>{
    if(depth>UPGRADE_IMAGE_LIMITS.depth||entries.length>=UPGRADE_IMAGE_LIMITS.entries)fail('UPGRADE_STAGE_LIMIT','Staged tree exceeds its entry or depth budget',409);
    const directory=lstatSync(path).isDirectory(),node=backupNode(path,directory);
    if(directory){entries.push({path:relative,kind:'directory',...node,bytes:0,digest:null});for(const name of readdirSync(path).sort())visit(join(path,name),relative?relative+'/'+name:name,depth+1);if(!eq(backupNode(path),node))fail('UPGRADE_STAGE_EVIDENCE','Staged directory changed during inventory',409);}
    else{const bytes=readUpgradeBytes(path);total+=bytes.length;if(total>UPGRADE_IMAGE_LIMITS.totalBytes)fail('UPGRADE_STAGE_LIMIT','Staged tree exceeds its byte budget',409);if(!eq(backupNode(path,false),node))fail('UPGRADE_STAGE_EVIDENCE','Staged file changed during inventory',409);entries.push({path:relative,kind:'file',...node,bytes:bytes.length,digest:hashBytes(bytes)});}
  };visit(root,'',0);return entries;
}
