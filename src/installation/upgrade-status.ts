import {constants,lstatSync,openSync,closeSync,fstatSync,readSync} from 'node:fs';
import type {BigIntStats} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {outsideSource} from './files.js';
import {validateUpgradeAdmissionAtRoot,upgradeAbortReceipt,upgradeReserveReceipt} from './upgrade-control.js';
import type {UpgradeAdmission} from './upgrade-control.js';
import {backupHash,validateNode,BACKUP_LIMITS} from './backup-contract.js';
import type {NodeIdentity} from './backup-contract.js';
import type {UpgradeStageOwner} from './upgrade-stage-files.js';
import type {UpgradeSwitch} from './upgrade-activation-files.js';
import {upgradeCompletedRelease,validateUpgradeCompletionEnvelope} from './upgrade-receipt.js';
import type {UpgradeCompletion} from './upgrade-receipt.js';
import {validateRuntimeBinding} from './runtime.js';
import {appendRuntimeHistory} from './runtime-history.js';
import {validateToolchainInput,toolchainRequestDigest} from './toolchains.js';
import {privatePath,upgradeControlNames,upgradeControlKey,UPGRADE_RECORDS} from '../standalone/workspace.js';
import {exact,digest,id,text,hashBytes} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

const records={admission:'.json',reservation:'.reserve',stage:'.stage.json',switch:'.switch.json',completion:'.completed.json',abort:'.aborted.json',release:'.released.json'} as const;
type RecordName=keyof typeof records;
type Phase='NOT_FOUND'|'ADMISSION_PENDING'|'ADMITTED'|'STAGE_OWNED'|'SWITCH_PENDING'|'SWITCH_RECORDED'|'ABORT_PENDING'|'ABORTED'|'COMPLETED';
type Direction='NONE'|'RECONCILE_ADMISSION'|'PRE_SWITCH'|'FORWARD_ONLY'|'ABORT_ONLY'|'CLEANUP_ONLY';
const equal=(a:unknown,b:unknown)=>backupHash(a)===backupHash(b);
function evidence():never {return fail('UPGRADE_EVIDENCE','Retained upgrade records are malformed, contradictory or differ from their admitted identities',409);}
function changed():never {return fail('UPGRADE_INSPECTION_CHANGED','Upgrade records changed during read-only inspection; inspect the same request again',409);}
const stamp=(s:BigIntStats):string=>[s.dev,s.ino,s.mode,s.uid,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
function directoryStamp(path:string,optional=false):string|null {
  try{privatePath(path,true);return stamp(lstatSync(path,{bigint:true}));}
  catch(e){if(optional&&(e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
}
function sampleFile(path:string,max:number):{bytes:Buffer;fingerprint:string} {
  privatePath(path);const before=lstatSync(path,{bigint:true});
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const opened=fstatSync(fd,{bigint:true});
    if(stamp(opened)!==stamp(before)||!opened.isFile()||opened.nlink!==1n||opened.uid!==BigInt(process.getuid!())||(opened.mode&0o077n)!==0n)changed();
    if(opened.size>BigInt(max))fail('UPGRADE_LIMIT','Retained upgrade record exceeds its metadata budget',409);
    const bytes=Buffer.alloc(Number(opened.size)+1);let at=0;
    while(at<bytes.length){const n=readSync(fd,bytes,at,bytes.length-at,at);if(!n)break;at+=n;}
    if(at!==Number(opened.size)||stamp(fstatSync(fd,{bigint:true}))!==stamp(opened)||stamp(lstatSync(path,{bigint:true}))!==stamp(opened))changed();
    const content=bytes.subarray(0,at);return {bytes:content,fingerprint:stamp(opened)+':'+hashBytes(content)};
  }finally{closeSync(fd);}
}
interface Sample {names:string[];files:Map<string,Buffer>;fingerprint:string;}
function sample(root:string,key:string):Sample {
  const directory=join(root,UPGRADE_RECORDS),rootBefore=directoryStamp(root),directoryBefore=directoryStamp(directory,true),names=upgradeControlNames(root);
  if(new Set(names.map(n=>n.split('.')[0])).size>128)fail('UPGRADE_LIMIT','Upgrade request history exceeds its budget',409);
  const files=new Map<string,Buffer>(),fingerprints:string[]=[];
  for(const name of names.filter(n=>n.split('.')[0]===key)){
    const suffix=name.slice(key.length),base=suffix.endsWith('.pending')?suffix.slice(0,-8):suffix;
    const max=base==='.json'?BACKUP_LIMITS.manifestBytes:base==='.reserve'?BACKUP_LIMITS.completionReserveBytes+65536:65536;
    const value=sampleFile(join(directory,name),max);files.set(suffix,value.bytes);fingerprints.push(name+':'+value.fingerprint);
  }
  if(rootBefore!==directoryStamp(root)||directoryBefore!==directoryStamp(directory,true)||!equal(names,upgradeControlNames(root)))changed();
  return {names,files,fingerprint:backupHash({root:rootBefore,directory:directoryBefore,names,files:fingerprints})};
}
function parsed(bytes:Buffer):unknown {
  try{
    const v:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    // Bound recursive hashing independently of the admitted file-size envelope.
    const pending:{value:unknown;depth:number}[]=[{value:v,depth:0}];let nodes=0;
    while(pending.length){const {value,depth}=pending.pop()!;if(++nodes>1000000||depth>64)evidence();if(value&&typeof value==='object')for(const child of Object.values(value))pending.push({value:child,depth:depth+1});}
    return v;
  }catch{evidence();}
}
function prefix(bytes:Buffer,value:unknown):void {
  const expected=Buffer.from(JSON.stringify(value)+'\n');if(bytes.length>expected.length||!bytes.equals(expected.subarray(0,bytes.length)))evidence();
}
function canonicalPath(value:unknown):asserts value is string {
  text(value,4096);if(!isAbsolute(value)||resolve(value)!==value)evidence();
}
/** Retained selection coherence only; no package, tool or source health checks. */
function selection(a:UpgradeAdmission):void {
  const report=a.report,i=report.ownerSnapshot.installation,input=a.input,p=report.pluginPlan;
  canonicalPath(input.upgradeRoot);canonicalPath(input.runtimeRoot);if(input.resolutionsFile!==undefined)canonicalPath(input.resolutionsFile);
  if(dirname(input.upgradeRoot)!==dirname(i.root)||input.upgradeRoot===i.root)evidence();
  exact(p,['schema','status','installationId','workspaceId','serviceId','installationDigest','workspaceIdentityDigest','baseRuntime','newRuntime','currentTreeDigest','files','directories','fileModes','treeConflicts','limits','runtimeActivated','serviceStarted','toolchainsVerified','productAcceptance','authority']);
  validateRuntimeBinding(p.baseRuntime);validateRuntimeBinding(p.newRuntime);
  for(const key of ['installationDigest','workspaceIdentityDigest','currentTreeDigest'])digest(p[key]);
  if(p.schema!=='ontology-plugin-upgrade-plan/v1'||p.status!=='MERGED'||['installationId','workspaceId','serviceId'].some(k=>p[k]!==i[k as 'installationId'|'workspaceId'|'serviceId'])||p.installationDigest!==backupHash(i)||!equal(p.baseRuntime,i.runtime)||equal(p.newRuntime,i.runtime)||p.newRuntime.root!==input.runtimeRoot||p.newRuntime.digest!==input.runtimeDigest||p.runtimeActivated!==false||p.serviceStarted!==false||p.toolchainsVerified!==false||p.productAcceptance!=='NOT_EVALUATED'||p.authority!==false||!Array.isArray(p.files)||!Array.isArray(p.directories)||!Array.isArray(p.fileModes)||!Array.isArray(p.treeConflicts)||p.treeConflicts.length)evidence();
  const draft=report.toolchainDraft;
  if(draft===null){if(input.toolchains!==null||report.toolchainsVerified!==false||report.ownerSnapshot.toolchainBindingDigest!==null)evidence();return;}
  exact(draft,['schema','installationId','workspaceId','serviceId','runtimeDigest','requestId','requestDigest','previousDigest','dl','shacl','workRoot'],['systemd']);
  if(input.toolchains===null)evidence();
  const selected={requestId:input.requestId,previousBindingDigest:report.ownerSnapshot.toolchainBindingDigest,...input.toolchains};validateToolchainInput(selected);
  const expected={schema:input.toolchains.systemd===undefined?'ontology-managed-toolchain-binding/v1':'ontology-managed-toolchain-binding/v2',installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,runtimeDigest:p.newRuntime.digest,requestId:input.requestId,requestDigest:toolchainRequestDigest({...i,runtime:p.newRuntime},selected),previousDigest:report.ownerSnapshot.toolchainBindingDigest,dl:input.toolchains.dl,shacl:input.toolchains.shacl,workRoot:join(i.root,'formal-work'),...(input.toolchains.systemd===undefined?{}:{systemd:input.toolchains.systemd})};
  if(report.toolchainsVerified!==true||!equal(draft,expected))evidence();
}
function stageOwner(v:unknown,a:UpgradeAdmission):asserts v is UpgradeStageOwner {
  exact(v,['schema','requestId','requestDigest','reportDigest','installationId','workspaceId','serviceId','root','node']);validateNode(v.node);
  const i=a.report.ownerSnapshot.installation;
  if(v.schema!=='ontology-upgrade-stage-owner/v1'||v.requestId!==a.input.requestId||v.requestDigest!==a.requestDigest||v.reportDigest!==a.reportDigest||v.root!==a.input.upgradeRoot||['installationId','workspaceId','serviceId'].some(k=>v[k]!==i[k as 'installationId'|'workspaceId'|'serviceId']))evidence();
}
function switchRecord(v:unknown,a:UpgradeAdmission,owner:UpgradeStageOwner):asserts v is UpgradeSwitch {
  exact(v,['schema','requestId','requestDigest','reportDigest','admissionDigest','stageOwnerDigest','preparedDigest','previousRoot','components']);validateNode(v.previousRoot);digest(v.preparedDigest);
  const original=a.report.ownerSnapshot,names=['plugin',...(a.report.toolchainDraft&&original.toolchainBindingDigest===null?['formal-work']:[]),...(a.report.toolchainDraft?['toolchain-bindings.json']:[]),'installation.json'];
  if(v.schema!=='ontology-upgrade-switch/v1'||v.requestId!==a.input.requestId||v.requestDigest!==a.requestDigest||v.reportDigest!==a.reportDigest||v.admissionDigest!==backupHash(a)||v.stageOwnerDigest!==backupHash(owner)||v.previousRoot.mode!==0o700||!Array.isArray(v.components)||v.components.length!==names.length)evidence();
  for(const [index,c] of v.components.entries()){
    exact(c,['name','kind','previous','next']);validateNode(c.next);if(c.previous!==null)validateNode(c.previous);
    const name=names[index],kind=name==='plugin'||name==='formal-work'?'directory':'file',old=original.entries.find(e=>e.scope==='installation'&&e.path===name),previous:NodeIdentity|null=old?{device:old.device,inode:old.inode,mode:old.mode}:null;
    if(c.name!==name||c.kind!==kind||old&&old.kind!==kind||['plugin','installation.json'].includes(name)&&!old||!equal(c.previous,previous)||kind==='file'&&c.next.mode!==(old?.mode??0o600)||name==='formal-work'&&c.next.mode!==0o700)evidence();
  }
}
function completionHistory(a:UpgradeAdmission,c:UpgradeCompletion):void {
  const original=a.report.ownerSnapshot,i=original.installation,setup=original.entries.find(e=>e.scope==='installation'&&e.path==='setup.json');
  if(!setup?.digest)evidence();
  const plugin=a.report.pluginPlan;exact(plugin,['schema','status','installationId','workspaceId','serviceId','installationDigest','workspaceIdentityDigest','baseRuntime','newRuntime','currentTreeDigest','files','directories','fileModes','treeConflicts','limits','runtimeActivated','serviceStarted','toolchainsVerified','productAcceptance','authority']);validateRuntimeBinding(plugin.newRuntime);
  const next=appendRuntimeHistory(i,setup.digest,{requestId:a.input.requestId,planDigest:a.reportDigest,runtime:plugin.newRuntime,previousToolchainBindingDigest:original.toolchainBindingDigest,toolchainBindingDigest:c.toolchainBindingDigest,pluginPlanDigest:a.report.pluginPlanDigest,recordedAt:c.recordedAt});
  if(backupHash(next)!==c.installationDigest||next.runtimeHistory.records.at(-1)!.digest!==c.transitionDigest)evidence();
}
function inspectSample(root:string,requestId:string,files:Map<string,Buffer>):Json {
  const has=(name:RecordName,partial=false)=>files.has(records[name]+(partial?'.pending':''));
  const value=(name:RecordName)=>parsed(files.get(records[name])!);
  const pendingRecords=(Object.keys(records) as RecordName[]).filter(n=>has(n,true));
  const digests:{[key:string]:string|null}={admission:null,stageOwner:null,prepared:null,switch:null,completion:null,abort:null,release:null};
  let identity:Json=null,phase:Phase='NOT_FOUND',recoveryDirection:Direction='NONE',releaseState:'ABSENT'|'PENDING'|'VALIDATED'='ABSENT';
  const result=():Json=>({schema:'ontology-upgrade-status/v1',installationRoot:root,requestId,identity,phase,releaseState,digests,pendingRecords,recoveryDirection,validation:'RETAINED_RECORDS_ONLY',runtimeHealth:'NOT_CHECKED',productAcceptance:'NOT_EVALUATED',authority:false});
  for(const name of Object.keys(records) as RecordName[])if(has(name)&&has(name,true))evidence();
  if(!has('admission')){
    if(files.size===0)return result();
    if(files.size!==1||!has('admission',true))evidence();
    phase='ADMISSION_PENDING';recoveryDirection='RECONCILE_ADMISSION';return result();
  }
  const a=value('admission');validateUpgradeAdmissionAtRoot(a,root,requestId);selection(a);
  const i=a.report.ownerSnapshot.installation;
  identity={installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,requestDigest:a.requestDigest,reportDigest:a.reportDigest};
  digests.admission=backupHash(a);phase='ADMITTED';recoveryDirection='PRE_SWITCH';
  if(has('reservation')&&!files.get(records.reservation)!.equals(Buffer.from(JSON.stringify(upgradeReserveReceipt(a))+'\n')))evidence();
  if(has('reservation',true))prefix(files.get(records.reservation+'.pending')!,upgradeReserveReceipt(a));
  let owner:UpgradeStageOwner|null=null,switched:UpgradeSwitch|null=null;
  if(has('stage')){const v=value('stage');stageOwner(v,a);owner=v;digests.stageOwner=backupHash(v);phase='STAGE_OWNED';}
  const switching=has('switch')||has('switch',true),completing=has('completion')||has('completion',true),aborting=has('abort')||has('abort',true);
  if((switching&&!owner)||(completing&&!has('switch'))||(aborting&&(switching||completing))||(has('stage',true)&&(switching||completing||aborting)))evidence();
  if(has('switch',true)){phase='SWITCH_PENDING';recoveryDirection='FORWARD_ONLY';}
  if(has('switch')){
    const v=value('switch');switchRecord(v,a,owner!);switched=v;digests.switch=backupHash(v);digests.prepared=v.preparedDigest;phase='SWITCH_RECORDED';recoveryDirection='FORWARD_ONLY';
  }
  let expectedRelease:unknown;
  if(aborting){
    const expected=upgradeAbortReceipt(a);
    if(has('abort',true)){prefix(files.get(records.abort+'.pending')!,expected);phase='ABORT_PENDING';}
    else{
      const aborted=value('abort');if(!equal(aborted,expected))evidence();digests.abort=backupHash(aborted);phase='ABORTED';
      expectedRelease={...(owner?{stageDigest:backupHash(owner)}:{}),schema:'ontology-upgrade-released/v1',requestId,requestDigest:a.requestDigest,reportDigest:a.reportDigest,admissionDigest:backupHash(a),abortDigest:backupHash(expected),authority:false};
    }
    recoveryDirection='ABORT_ONLY';
  }
  if(has('completion')){
    const completed=value('completion'),release=upgradeCompletedRelease(a,owner,switched,completed as UpgradeCompletion);
    validateUpgradeCompletionEnvelope(a,owner,switched,completed,release);
    completionHistory(a,completed);
    digests.completion=backupHash(completed);expectedRelease=release;phase='COMPLETED';recoveryDirection='CLEANUP_ONLY';
  }
  if(has('release')||has('release',true)){
    if(expectedRelease===undefined)evidence();
    if(has('release',true)){prefix(files.get(records.release+'.pending')!,expectedRelease);releaseState='PENDING';}
    else{
      const released=value('release');if(!equal(released,expectedRelease))evidence();
      const expectedNames=phase==='COMPLETED'?[records.admission,records.stage,records.switch,records.completion,records.release]:[records.admission,records.abort,records.release,...(owner?[records.stage]:[])];
      if(!equal([...files.keys()].sort(),expectedNames.sort()))evidence();
      digests.release=backupHash(released);releaseState='VALIDATED';recoveryDirection='NONE';
    }
  }
  return result();
}
/** Observe only installation-side retained records. No leases, repairs, live
 * installation metadata, workspace state, external stage or tool reads occur. */
export function inspectInstallationUpgradeRequest(path:string,requestId:string):Json {
  id(requestId);canonicalPath(path);privatePath(path,true);const root=outsideSource(path);
  if(root!==path)fail('UNSAFE_PATH','Canonical private installation root required');
  const key=upgradeControlKey(requestId);let before:Sample,result:Json|undefined,problem:unknown;
  try{before=sample(root,key);}catch(e){if(['ENOENT','ENOTDIR'].includes((e as NodeJS.ErrnoException).code??''))changed();throw e;}
  try{result=inspectSample(root,requestId,before.files);}catch(e){problem=e;}
  let after:Sample;
  try{after=sample(root,key);}catch{changed();}
  if(before.fingerprint!==after.fingerprint)changed();
  if(problem!==undefined)evidence();
  return result!;
}
