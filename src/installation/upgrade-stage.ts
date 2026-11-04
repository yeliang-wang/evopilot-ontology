import {mkdirSync,readdirSync,chmodSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {withInstallationUpgradeAdmission} from './upgrade-control.js';
import type {UpgradeAdmission} from './upgrade-control.js';
import {prepareInstallationUpgradeLocked} from './upgrade-plan.js';
import type {InstallationUpgradeInput,InstallationUpgradePreparation} from './upgrade-plan.js';
import {ensureUpgradeStage,upgradeStageLayout,inspectUpgradeImage,writeUpgradeBytes,readUpgradeBytes,syncUpgradeDirectory} from './upgrade-stage-files.js';
import type {UpgradeImageEntry,UpgradeStageOwner} from './upgrade-stage-files.js';
import {backupHash,BACKUP_LIMITS} from './backup-contract.js';
import {backupNode,writeBackupJSON} from './backup-files.js';
import {workerFilePresent} from './worker-archives.js';
import {writePrivate} from './files.js';
import {appendRuntimeHistory} from './runtime-history.js';
import {validateRuntimeBinding,verifyRuntime} from './runtime.js';
import {validateInstallation} from './installation-contract.js';
import type {Installation} from './installation-contract.js';
import {readToolchainLedger} from './toolchains.js';
import type {ToolchainRecord} from './toolchains.js';
import {privatePath,privateRead,UPGRADE_BARRIER} from '../standalone/workspace.js';
import {exact,hashBytes,timestamp} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

interface Candidate {
  installation:Installation;ledger:ReturnType<typeof readToolchainLedger>;toolchainDigest:string|null;
  files:Map<string,{bytes:Buffer;mode:number}>;directories:Map<string,number>;
}
const eq=(a:unknown,b:unknown)=>backupHash(a)===backupHash(b);
const jsonBytes=(value:unknown)=>Buffer.from(JSON.stringify(value)+'\n');
function stageTimestamp(a:UpgradeAdmission):string {
  const root=a.input.upgradeRoot,file=join(root,'recorded-at.json');
  if(!workerFilePresent(file)){
    if(readdirSync(root).filter(n=>n.startsWith('recorded-at.json.pending-')).length>=16)fail('UPGRADE_STAGE_LIMIT','Retained timestamp attempts reached their budget',409);
    writePrivate(file,{schema:'ontology-upgrade-recorded-at/v1',requestDigest:a.requestDigest,recordedAt:new Date().toISOString()});
  }
  const v:unknown=JSON.parse(privateRead(file,65536));exact(v,['schema','requestDigest','recordedAt']);timestamp(v.recordedAt);
  if(v.schema!=='ontology-upgrade-recorded-at/v1'||v.requestDigest!==a.requestDigest)fail('UPGRADE_STAGE_EVIDENCE','Timestamp belongs to another admission',409);return v.recordedAt as string;
}
function candidate(a:UpgradeAdmission,p:InstallationUpgradePreparation,recordedAt:string):Candidate {
  const original=a.report.ownerSnapshot.installation,plugin=p.report.pluginPlan;
  if(!plugin||typeof plugin!=='object'||Array.isArray(plugin))fail('UPGRADE_STAGE_EVIDENCE','Validated plugin report required',409);
  const runtime=plugin.newRuntime;validateRuntimeBinding(runtime);
  const prior=readToolchainLedger(original),draft=p.report.toolchainDraft;
  const record:ToolchainRecord|null=draft?(()=>{const binding={...draft,recordedAt};return {digest:backupHash(binding),binding};})():null;
  const ledger={...prior,records:[...prior.records,...(record?[record]:[])]},toolchainDigest=record?.digest??null;
  const installation=appendRuntimeHistory(original,hashBytes(privateRead(join(original.root,'setup.json'),65536)),{requestId:a.input.requestId,planDigest:a.reportDigest,runtime,previousToolchainBindingDigest:prior.records.at(-1)?.digest??null,toolchainBindingDigest:toolchainDigest,pluginPlanDigest:a.report.pluginPlanDigest,recordedAt});
  validateInstallation(installation,original.root);
  const directories=new Map<string,number>([['',0o700]]),files=new Map<string,{bytes:Buffer;mode:number}>();
  if(!Array.isArray(plugin.directories)||!Array.isArray(plugin.fileModes))fail('UPGRADE_STAGE_EVIDENCE','Validated plugin layout is missing',409);
  for(const d of plugin.directories){exact(d,['path','mode']);if(typeof d.path!=='string'||!Number.isInteger(d.mode))fail('UPGRADE_STAGE_EVIDENCE','Invalid plugin directory',409);directories.set(d.path?'plugin/'+d.path:'plugin',d.mode as number);}
  for(const [path,bytes] of p.files){const mode=plugin.fileModes.find(m=>m&&typeof m==='object'&&!Array.isArray(m)&&m.path===path);if(!mode||typeof mode!=='object'||Array.isArray(mode)||typeof mode.mode!=='number')fail('UPGRADE_STAGE_EVIDENCE','Plugin file mode is missing',409);files.set('plugin/'+path,{bytes,mode:mode.mode});}
  const oldMode=(name:string)=>a.report.ownerSnapshot.entries.find(e=>e.scope==='installation'&&e.path===name)?.mode??0o600;
  files.set('installation.json',{bytes:jsonBytes(installation),mode:oldMode('installation.json')});
  if(record)files.set('toolchain-bindings.json',{bytes:jsonBytes(ledger),mode:oldMode('toolchain-bindings.json')});
  if(record&&!prior.records.length){
    directories.set('formal-work',0o700);
    files.set('formal-work/owner.json',{bytes:jsonBytes({schema:'ontology-managed-work/v1',installationId:original.installationId,workspaceId:original.workspaceId,serviceId:original.serviceId,root:join(original.root,'formal-work')}),mode:0o600});
    files.set('formal-work/'+UPGRADE_BARRIER,{bytes:jsonBytes({schema:'ontology-upgrade-barrier/v1',root:join(original.root,'formal-work'),upgradeRoot:a.input.upgradeRoot,installationId:original.installationId,workspaceId:original.workspaceId,serviceId:original.serviceId,requestId:a.input.requestId,requestDigest:a.requestDigest,reportDigest:a.reportDigest}),mode:0o600});
  }
  return {installation,ledger,toolchainDigest,files,directories};
}
const pendingName=(relative:string)=>hashBytes(relative).slice(7);
function validatePartialImage(root:string,c:Candidate):void {
  if(!workerFilePresent(root))return;
  for(const e of inspectUpgradeImage(root)){
    if(e.kind==='directory'){const mode=c.directories.get(e.path);if(mode===undefined||e.mode!==mode&&e.mode!==0o700)fail('UPGRADE_STAGE_EVIDENCE','Unknown or changed staged directory was preserved',409);}
    else{const f=c.files.get(e.path);if(!f||e.mode!==f.mode||e.bytes!==f.bytes.length||e.digest!==hashBytes(f.bytes))fail('UPGRADE_STAGE_EVIDENCE','Unknown or changed staged file was preserved',409);}
  }
}
function materialize(a:UpgradeAdmission,c:Candidate):void {
  const root=a.input.upgradeRoot,next=join(root,'next'),pending=join(root,'pending');
  validatePartialImage(next,c);
  if(workerFilePresent(pending)){
    privatePath(pending,true);if(backupNode(pending).mode!==0o700)fail('UPGRADE_STAGE_EVIDENCE','Pending namespace mode changed',409);
    const allowed=new Map([...c.files].map(([path,f])=>[pendingName(path),f]));
    for(const n of readdirSync(pending)){const f=allowed.get(n);if(!f)fail('UPGRADE_STAGE_EVIDENCE','Unknown pending payload was preserved',409);const bytes=readUpgradeBytes(join(pending,n),f.bytes.length);if(!bytes.equals(f.bytes.subarray(0,bytes.length)))fail('UPGRADE_STAGE_EVIDENCE','Changed pending payload was preserved',409);}
  }else{mkdirSync(pending,{mode:0o700});syncUpgradeDirectory(root);}
  for(const [path,mode] of [...c.directories].sort(([a],[b])=>a.split('/').length-b.split('/').length||a.localeCompare(b))){
    const target=join(next,path);if(!workerFilePresent(target)){mkdirSync(target,{mode:0o700});syncUpgradeDirectory(dirname(target));}privatePath(target,true);
    const actual=backupNode(target).mode;if(actual!==0o700&&actual!==mode)fail('UPGRADE_STAGE_EVIDENCE','Staged directory mode changed',409);
  }
  for(const [relative,f] of c.files)writeUpgradeBytes(join(next,relative),join(pending,pendingName(relative)),f.bytes,f.mode);
  for(const [path,mode] of [...c.directories].sort(([a],[b])=>b.split('/').length-a.split('/').length)){
    const target=join(next,path);if(backupNode(target).mode!==mode)chmodSync(target,mode);syncUpgradeDirectory(target);syncUpgradeDirectory(dirname(target));
  }
}
function verifyCandidate(a:UpgradeAdmission,c:Candidate):UpgradeImageEntry[] {
  const next=join(a.input.upgradeRoot,'next'),image=inspectUpgradeImage(next),pending=join(a.input.upgradeRoot,'pending');
  privatePath(pending,true);if(readdirSync(pending).length)fail('UPGRADE_STAGE_EVIDENCE','Unresolved pending payloads prevent sealing',409);
  if(image.length!==c.files.size+c.directories.size)fail('UPGRADE_STAGE_EVIDENCE','Candidate image has missing or extra paths',409);
  for(const e of image){
    if(e.kind==='directory'){if(c.directories.get(e.path)!==e.mode)fail('UPGRADE_STAGE_EVIDENCE','Candidate directory mode differs',409);}
    else{const f=c.files.get(e.path);if(!f||e.mode!==f.mode||e.bytes!==f.bytes.length||e.digest!==hashBytes(f.bytes))fail('UPGRADE_STAGE_EVIDENCE','Candidate bytes differ from the prepared selection',409);}
  }
  const installed:unknown=JSON.parse(privateRead(join(next,'installation.json'),2*1024*1024));validateInstallation(installed,a.report.ownerSnapshot.installation.root);
  if(!eq(installed,c.installation)||!eq(readToolchainLedger(c.installation,next),c.ledger))fail('UPGRADE_STAGE_EVIDENCE','Staged runtime and toolchain histories do not agree',409);
  verifyRuntime(c.installation.runtime);return image;
}
function seal(a:UpgradeAdmission,owner:UpgradeStageOwner,c:Candidate,recordedAt:string,entries:UpgradeImageEntry[]):Json {
  return {schema:'ontology-upgrade-prepared/v1',requestId:a.input.requestId,requestDigest:a.requestDigest,reportDigest:a.reportDigest,admissionDigest:backupHash(a),stageOwnerDigest:backupHash(owner),recordedAt,timestampNode:backupNode(join(owner.root,'recorded-at.json'),false) as unknown as Json,installationDigest:backupHash(c.installation),toolchainBindingDigest:c.toolchainDigest,nextRoot:backupNode(join(owner.root,'next')) as unknown as Json,pendingRoot:backupNode(join(owner.root,'pending')) as unknown as Json,entries:entries as unknown as Json,runtimeActivated:false,serviceStarted:false,authority:false};
}
/** Internal stopped-owner staging. The original plugin, installation, bindings,
 * business state and credentials remain in place under the admission barriers. */
export function stageInstallationUpgrade(path:string,input:InstallationUpgradeInput,expectedReportDigest:string):Json {
  return withInstallationUpgradeAdmission<Json>(path,input,expectedReportDigest,(a,p,store)=>{
    const owner=ensureUpgradeStage(a),recordedAt=stageTimestamp(a),c=candidate(a,p,recordedAt),file=join(owner.root,'prepared.json'),already=workerFilePresent(file);
    if(already&&workerFilePresent(file+'.pending'))fail('UPGRADE_STAGE_EVIDENCE','Ambiguous complete and pending prepared images were preserved',409);
    if(!already)materialize(a,c);
    const entries=verifyCandidate(a,c),prepared=seal(a,owner,c,recordedAt,entries);
    if(already&&!eq(JSON.parse(privateRead(file,BACKUP_LIMITS.manifestBytes)),prepared))fail('UPGRADE_STAGE_EVIDENCE','Sealed candidate physical identity or content changed',409);
    store.guard();upgradeStageLayout(a);
    prepareInstallationUpgradeLocked(a.report.ownerSnapshot.installation,store,input,expectedReportDigest,{operation:'UPGRADE',requestId:input.requestId,requestDigest:a.requestDigest},owner.node);
    writeBackupJSON(file,prepared);upgradeStageLayout(a);
    return {status:'STAGED',requestId:input.requestId,requestDigest:a.requestDigest,reportDigest:a.reportDigest,preparedDigest:backupHash(prepared),runtimeDigest:c.installation.runtime.digest,toolchainBindingDigest:c.toolchainDigest,recordedAt,entries:entries.length,replayed:already,runtimeActivated:false,serviceStarted:false,productAcceptance:'NOT_EVALUATED',authority:false};
  },()=>fail('UPGRADE_ABORTED','The original upgrade was aborted; use a new inspected request',409));
}
