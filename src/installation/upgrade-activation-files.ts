import {readdirSync,mkdirSync,chmodSync,renameSync} from 'node:fs';
import {join,dirname,isAbsolute} from 'node:path';
import type {UpgradeAdmission} from './upgrade-control.js';
import {upgradeControlFile,upgradeMarker} from './upgrade-control.js';
import {upgradeOwnerSnapshot} from './upgrade-plan.js';
import {backupHash,validateNode,BACKUP_LIMITS} from './backup-contract.js';
import type {NodeIdentity} from './backup-contract.js';
import {backupNode,backupInventory} from './backup-files.js';
import {backupControlRecords} from './backup-control.js';
import {readUpgradeStageOwner,upgradeStageLayout,inspectUpgradeImage,readUpgradeBytes,syncUpgradeDirectory,UPGRADE_IMAGE_LIMITS} from './upgrade-stage-files.js';
import type {UpgradeImageEntry,UpgradeStageOwner} from './upgrade-stage-files.js';
import {workerFilePresent} from './worker-archives.js';
import {readToolchainLedger} from './toolchains.js';
import type {ToolchainRecord} from './toolchains.js';
import {appendRuntimeHistory} from './runtime-history.js';
import {validateInstallation} from './installation-contract.js';
import type {Installation} from './installation-contract.js';
import {validateRuntimeBinding} from './runtime.js';
import {privateRead,UPGRADE_RECORDS,UPGRADE_BARRIER} from '../standalone/workspace.js';
import {exact,digest,timestamp,hashBytes} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

export interface UpgradePrepared {
  schema:'ontology-upgrade-prepared/v1';requestId:string;requestDigest:string;reportDigest:string;admissionDigest:string;stageOwnerDigest:string;recordedAt:string;timestampNode:NodeIdentity;
  installationDigest:string;toolchainBindingDigest:string|null;nextRoot:NodeIdentity;pendingRoot:NodeIdentity;entries:UpgradeImageEntry[];runtimeActivated:false;serviceStarted:false;authority:false;
}
export interface UpgradeComponent {name:'plugin'|'toolchain-bindings.json'|'installation.json'|'formal-work';kind:'file'|'directory';previous:NodeIdentity|null;next:NodeIdentity;}
export interface UpgradeSwitch {schema:'ontology-upgrade-switch/v1';requestId:string;requestDigest:string;reportDigest:string;admissionDigest:string;stageOwnerDigest:string;preparedDigest:string;previousRoot:NodeIdentity;components:UpgradeComponent[];}
export interface UpgradePosition {component:UpgradeComponent;old:string|null;next:string;phase:'READY'|'OLD_MOVED'|'INSTALLED';}
export const upgradeEqual=(a:unknown,b:unknown):boolean=>backupHash(a)===backupHash(b);
const eq=upgradeEqual;
const inside=(path:string,name:string)=>path===name||path.startsWith(name+'/');
const nodeOf=(e:NodeIdentity):NodeIdentity=>({device:e.device,inode:e.inode,mode:e.mode});
export function assertUpgradeOwnerRoots(a:UpgradeAdmission):void {
  const p=a.report.ownerSnapshot,i=p.installation;
  if(!eq(backupNode(i.root),p.roots.installation)||!eq(backupNode(i.workspaceRoot),p.roots.workspace)||!eq(backupNode(dirname(a.input.upgradeRoot)),p.targetParent)||!eq(backupNode(join(i.root,UPGRADE_RECORDS)),a.controlNode))fail('UPGRADE_CHANGED','Original physical owner or control root changed',409);
}
export function readUpgradePrepared(a:UpgradeAdmission,expected:string):{prepared:UpgradePrepared;owner:UpgradeStageOwner} {
  digest(expected);assertUpgradeOwnerRoots(a);const root=a.input.upgradeRoot,owner=readUpgradeStageOwner(a);
  if(!owner)fail('UPGRADE_STAGE_EVIDENCE','Original stage owner is missing',409);upgradeStageLayout(a,true);
  const file=join(root,'prepared.json');if(workerFilePresent(file+'.pending'))fail('UPGRADE_STAGE_EVIDENCE','Prepared image has unresolved partial metadata',409);
  const v:unknown=JSON.parse(privateRead(file,BACKUP_LIMITS.manifestBytes));exact(v,['schema','requestId','requestDigest','reportDigest','admissionDigest','stageOwnerDigest','recordedAt','timestampNode','installationDigest','toolchainBindingDigest','nextRoot','pendingRoot','entries','runtimeActivated','serviceStarted','authority']);
  for(const k of ['requestDigest','reportDigest','admissionDigest','stageOwnerDigest','installationDigest'])digest(v[k]);timestamp(v.recordedAt);for(const k of ['timestampNode','nextRoot','pendingRoot'])validateNode(v[k]);if(v.toolchainBindingDigest!==null)digest(v.toolchainBindingDigest);
  if(v.schema!=='ontology-upgrade-prepared/v1'||v.requestId!==a.input.requestId||v.requestDigest!==a.requestDigest||v.reportDigest!==a.reportDigest||v.admissionDigest!==backupHash(a)||v.stageOwnerDigest!==backupHash(owner)||backupHash(v)!==expected||v.runtimeActivated!==false||v.serviceStarted!==false||v.authority!==false||!Array.isArray(v.entries)||!v.entries.length||v.entries.length>UPGRADE_IMAGE_LIMITS.entries)fail('UPGRADE_STAGE_EVIDENCE','Prepared image differs from the selected admission or digest',409);
  let bytes=0;const names=new Set<string>();
  for(const e of v.entries){
    exact(e,['path','kind','device','inode','mode','bytes','digest']);validateNode(nodeOf(e as unknown as NodeIdentity));
    if(typeof e.path!=='string'||e.path.length>4096||isAbsolute(e.path)||e.path!==''&&e.path.split('/').some(p=>!p||p==='.'||p==='..')||/[\\\x00-\x1f\x7f]/.test(e.path)||names.has(e.path)||!['directory','file'].includes(e.kind as string)||!Number.isSafeInteger(e.bytes)||(e.bytes as number)<0||(e.bytes as number)>UPGRADE_IMAGE_LIMITS.fileBytes)fail('UPGRADE_STAGE_EVIDENCE','Invalid prepared image entry',409);
    names.add(e.path);bytes+=e.bytes as number;if(e.kind==='directory'){if(e.bytes!==0||e.digest!==null)fail('UPGRADE_STAGE_EVIDENCE','Directory cannot carry payload bytes',409);}else digest(e.digest);
  }
  const p=v as unknown as UpgradePrepared;
  if(p.nextRoot.mode!==0o700||p.pendingRoot.mode!==0o700)fail('UPGRADE_STAGE_EVIDENCE','Prepared control directories must retain writable private modes',409);
  if(bytes>UPGRADE_IMAGE_LIMITS.totalBytes||p.entries[0]?.path!==''||p.entries[0].kind!=='directory'||!eq(nodeOf(p.entries[0]),p.nextRoot)||!eq(backupNode(join(root,'next')),p.nextRoot)||!eq(backupNode(join(root,'pending')),p.pendingRoot)||readdirSync(join(root,'pending')).length||!eq(backupNode(join(root,'recorded-at.json'),false),p.timestampNode)||!eq(JSON.parse(privateRead(join(root,'recorded-at.json'),65536)),{schema:'ontology-upgrade-recorded-at/v1',requestDigest:a.requestDigest,recordedAt:p.recordedAt}))fail('UPGRADE_STAGE_EVIDENCE','Prepared directory, timestamp or pending material changed',409);
  validatePreparedPlugin(a,p);return {prepared:p,owner};
}
function validatePreparedPlugin(a:UpgradeAdmission,p:UpgradePrepared):void {
  const plugin=a.report.pluginPlan;exact(plugin,['schema','status','installationId','workspaceId','serviceId','installationDigest','workspaceIdentityDigest','baseRuntime','newRuntime','currentTreeDigest','files','directories','fileModes','treeConflicts','limits','runtimeActivated','serviceStarted','toolchainsVerified','productAcceptance','authority']);
  if(!Array.isArray(plugin.files)||!Array.isArray(plugin.directories)||!Array.isArray(plugin.fileModes))fail('UPGRADE_STAGE_EVIDENCE','Admitted plugin layout is missing',409);
  const expected=new Map<string,{kind:string;mode:number;bytes:number;digest:string|null}>();
  for(const d of plugin.directories){exact(d,['path','mode']);expected.set(d.path?'plugin/'+String(d.path):'plugin',{kind:'directory',mode:Number(d.mode),bytes:0,digest:null});}
  for(const f of plugin.files){if(!f||typeof f!=='object'||Array.isArray(f))fail('UPGRADE_STAGE_EVIDENCE','Invalid admitted plugin file',409);if(f.outputDigest===null)continue;
    const mode=plugin.fileModes.find(m=>m&&typeof m==='object'&&!Array.isArray(m)&&m.path===f.path);if(!mode||typeof mode!=='object'||Array.isArray(mode))fail('UPGRADE_STAGE_EVIDENCE','Admitted plugin file mode is missing',409);
    expected.set('plugin/'+String(f.path),{kind:'file',mode:Number(mode.mode),bytes:Number(f.outputBytes),digest:String(f.outputDigest)});
  }
  const actual=p.entries.filter(e=>inside(e.path,'plugin'));
  if(actual.length!==expected.size||actual.some(e=>!eq(expected.get(e.path),{kind:e.kind,mode:e.mode,bytes:e.bytes,digest:e.digest})))fail('UPGRADE_STAGE_EVIDENCE','Sealed plugin does not match the admitted merge',409);
}
export function expectedUpgradeSwitch(a:UpgradeAdmission,p:UpgradePrepared,owner:UpgradeStageOwner,previousRoot:NodeIdentity):UpgradeSwitch {
  const original=a.report.ownerSnapshot,order:UpgradeComponent['name'][]=['plugin',...(a.report.toolchainDraft&&original.toolchainBindingDigest===null?['formal-work' as const]:[]),...(a.report.toolchainDraft?['toolchain-bindings.json' as const]:[]),'installation.json'];
  const components=order.map(name=>{
    const next=p.entries.find(e=>e.path===name),old=original.entries.find(e=>e.scope==='installation'&&e.path===name),kind=name==='plugin'||name==='formal-work'?'directory' as const:'file' as const;
    if(!next||next.kind!==kind||old&&old.kind!==kind||['plugin','installation.json'].includes(name)&&!old)fail('UPGRADE_STAGE_EVIDENCE','Prepared component set differs from admission',409);
    if(kind==='file'&&next.mode!==(old?.mode??0o600))fail('UPGRADE_STAGE_EVIDENCE','Prepared metadata mode differs from its admitted original',409);
    return {name,kind,previous:old?nodeOf(old):null,next:nodeOf(next)};
  });
  if(p.entries.some(e=>e.path!==''&&!order.some(name=>inside(e.path,name))))fail('UPGRADE_STAGE_EVIDENCE','Unselected candidate component was preserved',409);
  return {schema:'ontology-upgrade-switch/v1',requestId:a.input.requestId,requestDigest:a.requestDigest,reportDigest:a.reportDigest,admissionDigest:backupHash(a),stageOwnerDigest:backupHash(owner),preparedDigest:backupHash(p),previousRoot,components};
}
export function readUpgradeSwitch(a:UpgradeAdmission):UpgradeSwitch|null {
  const file=upgradeControlFile(a,'.switch.json');if(!workerFilePresent(file))return null;
  const v:unknown=JSON.parse(privateRead(file,65536));exact(v,['schema','requestId','requestDigest','reportDigest','admissionDigest','stageOwnerDigest','preparedDigest','previousRoot','components']);validateNode(v.previousRoot);
  if(v.schema!=='ontology-upgrade-switch/v1'||v.requestId!==a.input.requestId||v.requestDigest!==a.requestDigest||v.reportDigest!==a.reportDigest||v.admissionDigest!==backupHash(a)||!Array.isArray(v.components)||v.components.length<2||v.components.length>4)fail('UPGRADE_SWITCH_EVIDENCE','Switch record differs from its admission',409);
  for(const k of ['stageOwnerDigest','preparedDigest'])digest(v[k]);const names=new Set<string>();
  for(const c of v.components){exact(c,['name','kind','previous','next']);validateNode(c.next);if(c.previous!==null)validateNode(c.previous);if(typeof c.name!=='string'||!['plugin','formal-work','toolchain-bindings.json','installation.json'].includes(c.name)||names.has(c.name)||c.kind!==(c.name==='plugin'||c.name==='formal-work'?'directory':'file'))fail('UPGRADE_SWITCH_EVIDENCE','Invalid switch component',409);names.add(c.name);}
  return v as unknown as UpgradeSwitch;
}
export function prepareUpgradePrevious(a:UpgradeAdmission,p:UpgradePrepared,owner:UpgradeStageOwner):UpgradeSwitch {
  const path=join(a.input.upgradeRoot,'previous'),saved=readUpgradeSwitch(a);
  if(!workerFilePresent(path)){
    if(saved||workerFilePresent(upgradeControlFile(a,'.switch.json.pending')))fail('UPGRADE_SWITCH_EVIDENCE','Original preservation root is missing',409);
    mkdirSync(path,{mode:0o700});syncUpgradeDirectory(a.input.upgradeRoot);
  }
  const node=backupNode(path);if(node.mode!==0o700||!saved&&readdirSync(path).length)fail('UPGRADE_SWITCH_EVIDENCE','Preservation root must be owned, writable and initially empty',409);
  const expected=expectedUpgradeSwitch(a,p,owner,node);
  if(saved&&(!eq(saved,expected)||workerFilePresent(upgradeControlFile(a,'.switch.json.pending'))))fail('UPGRADE_SWITCH_EVIDENCE','Switch or preservation root changed',409);return saved??expected;
}
function matchesNode(actual:NodeIdentity,expected:NodeIdentity,temporary:boolean):boolean {
  return eq(actual,expected)||temporary&&eq(actual,{...expected,mode:expected.mode|0o200});
}
export function upgradePositions(a:UpgradeAdmission,s:UpgradeSwitch,temporary=false):UpgradePosition[] {
  const i=a.report.ownerSnapshot.installation,stage=a.input.upgradeRoot,previous=join(stage,'previous'),next=join(stage,'next');
  if(!eq(backupNode(previous),s.previousRoot))fail('UPGRADE_SWITCH_EVIDENCE','Preserved root was replaced',409);
  const allowed=new Set(s.components.map(c=>c.name));
  if([...readdirSync(previous),...readdirSync(next)].some(n=>!allowed.has(n as UpgradeComponent['name'])))fail('UPGRADE_SWITCH_EVIDENCE','Unselected candidate or preserved material was left untouched',409);
  return s.components.map(c=>{
    const live=join(i.root,c.name),kept=join(previous,c.name),candidate=join(next,c.name),present=(path:string)=>workerFilePresent(path),at=(path:string,node:NodeIdentity)=>present(path)&&matchesNode(backupNode(path,c.kind==='directory'),node,temporary&&c.kind==='directory');
    if(c.previous){
      if(at(live,c.previous)&&!present(kept)&&at(candidate,c.next))return {component:c,old:live,next:candidate,phase:'READY'};
      if(!present(live)&&at(kept,c.previous)&&at(candidate,c.next))return {component:c,old:kept,next:candidate,phase:'OLD_MOVED'};
      if(at(live,c.next)&&at(kept,c.previous)&&!present(candidate))return {component:c,old:kept,next:live,phase:'INSTALLED'};
    }else{
      if(!present(live)&&!present(kept)&&at(candidate,c.next))return {component:c,old:null,next:candidate,phase:'READY'};
      if(at(live,c.next)&&!present(kept)&&!present(candidate))return {component:c,old:null,next:live,phase:'INSTALLED'};
    }
    fail('UPGRADE_LOCATION_CONFLICT','Live, staged and preserved components have an unproven arrangement; all material was preserved',409);
  });
}
/** Only the exact selected root can temporarily gain owner-write after a durable
 * switch. macOS requires it when rename updates the directory's parent entry. */
export function restoreUpgradeComponentMode(path:string,c:UpgradeComponent,node:NodeIdentity):void {
  if(!matchesNode(backupNode(path,c.kind==='directory'),node,c.kind==='directory'))fail('UPGRADE_LOCATION_CONFLICT','Selected component was replaced before mode recovery',409);
  if(c.kind==='directory'){
    if(backupNode(path).mode!==node.mode)chmodSync(path,node.mode);
    syncUpgradeDirectory(path);syncUpgradeDirectory(dirname(path));
  }
}
export function moveUpgradeComponent(from:string,to:string,c:UpgradeComponent,node:NodeIdentity):void {
  if(!matchesNode(backupNode(from,c.kind==='directory'),node,c.kind==='directory')||workerFilePresent(to))fail('UPGRADE_LOCATION_CONFLICT','Selected move source or destination changed',409);
  if(c.kind==='directory'&&(node.mode&0o200)===0){chmodSync(from,node.mode|0o200);syncUpgradeDirectory(from);syncUpgradeDirectory(dirname(from));}
  renameSync(from,to);syncUpgradeDirectory(dirname(from));syncUpgradeDirectory(dirname(to));restoreUpgradeComponentMode(to,c,node);
}
function componentImage(path:string,c:UpgradeComponent,node:NodeIdentity,temporary:boolean):UpgradeImageEntry[] {
  if(c.kind==='directory')return inspectUpgradeImage(path).map(e=>({...e,mode:e.path===''&&temporary&&matchesNode(nodeOf(e),node,true)?node.mode:e.mode,path:e.path?c.name+'/'+e.path:c.name}));
  const before=backupNode(path,false),bytes=readUpgradeBytes(path);if(!eq(backupNode(path,false),before))fail('UPGRADE_SWITCH_EVIDENCE','Component identity changed',409);return [{path:c.name,kind:'file',...before,bytes:bytes.length,digest:hashBytes(bytes)}];
}
export function verifyUpgradeImages(a:UpgradeAdmission,p:UpgradePrepared,s:UpgradeSwitch,temporary=false):{installation:Installation;binding:ToolchainRecord|null;positions:UpgradePosition[]} {
  assertUpgradeOwnerRoots(a);const original=a.report.ownerSnapshot,i=original.installation,positions=upgradePositions(a,s,temporary),selected=(path:string)=>s.components.some(c=>inside(path,c.name));
  const actual=upgradeOwnerSnapshot({...original,entries:backupInventory(i)},a.input.requestId).entries.filter(e=>e.scope!=='installation'||!selected(e.path));
  const expected=original.entries.filter(e=>e.scope!=='installation'||!selected(e.path));
  if(!eq(actual,expected)||!eq(backupControlRecords(i),original.priorBackups))fail('UPGRADE_SOURCE_CHANGED','Unchanged owner data, credentials, run or worker/backup history differs',409);
  for(const position of positions){
    const c=position.component,old=original.entries.filter(e=>e.scope==='installation'&&inside(e.path,c.name)).map(({scope:_,...e})=>e),next=p.entries.filter(e=>inside(e.path,c.name));
    if(position.old&&!eq(componentImage(position.old,c,c.previous!,temporary),old)||!position.old&&old.length||!eq(componentImage(position.next,c,c.next,temporary),next))fail('UPGRADE_SWITCH_EVIDENCE','Original or candidate component bytes, modes or physical identities differ',409);
  }
  const oldLedgerPosition=positions.find(p=>p.component.name==='toolchain-bindings.json')?.old;
  const prior=oldLedgerPosition?readToolchainLedger(i,dirname(oldLedgerPosition)):{schema:'ontology-managed-toolchain-ledger/v1' as const,installationId:i.installationId,records:[]};
  if((prior.records.at(-1)?.digest??null)!==original.toolchainBindingDigest)fail('UPGRADE_SWITCH_EVIDENCE','Original toolchain head differs',409);
  const draft=a.report.toolchainDraft,binding=draft?{...draft,recordedAt:p.recordedAt}:null,record=binding?{digest:backupHash(binding),binding}:null;
  const plugin=a.report.pluginPlan as Record<string,Json>,runtime=plugin.newRuntime;validateRuntimeBinding(runtime);
  const setup=original.entries.find(e=>e.scope==='installation'&&e.path==='setup.json');if(!setup?.digest)fail('UPGRADE_SWITCH_EVIDENCE','Original setup identity missing',409);
  const installation=appendRuntimeHistory(i,setup.digest,{requestId:a.input.requestId,planDigest:a.reportDigest,runtime,previousToolchainBindingDigest:original.toolchainBindingDigest,toolchainBindingDigest:record?.digest??null,pluginPlanDigest:a.report.pluginPlanDigest,recordedAt:p.recordedAt});
  const current=JSON.parse(privateRead(positions.find(p=>p.component.name==='installation.json')!.next,2*1024*1024)) as unknown;validateInstallation(current,i.root);
  if(!eq(current,installation)||backupHash(installation)!==p.installationDigest||(record?.digest??null)!==p.toolchainBindingDigest)fail('UPGRADE_SWITCH_EVIDENCE','Prepared installation lineage differs from original admission',409);
  if(record){
    const path=positions.find(p=>p.component.name==='toolchain-bindings.json')!.next;
    if(!eq(readToolchainLedger(installation,dirname(path)),{...prior,records:[...prior.records,record]}))fail('UPGRADE_SWITCH_EVIDENCE','Prepared toolchain ledger differs from original history',409);
  }
  const fresh=positions.find(p=>p.component.name==='formal-work');
  if(fresh){const owner={schema:'ontology-managed-work/v1',installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,root:join(i.root,'formal-work')};
    const workEntries=p.entries.filter(e=>inside(e.path,'formal-work')),expectedFiles=new Map([['formal-work/owner.json',JSON.stringify(owner)+'\n'],['formal-work/'+UPGRADE_BARRIER,JSON.stringify(upgradeMarker(a,join(i.root,'formal-work')))+'\n']]);
    if(workEntries.length!==3||workEntries.some(e=>e.path==='formal-work'?e.kind!=='directory'||e.mode!==0o700:e.kind!=='file'||e.mode!==0o600||!expectedFiles.has(e.path)||e.digest!==hashBytes(expectedFiles.get(e.path)!))||backupNode(fresh.next).mode!==0o700||privateRead(join(fresh.next,'owner.json'),65536)!==JSON.stringify(owner)+'\n'||privateRead(join(fresh.next,UPGRADE_BARRIER),65536)!==JSON.stringify(upgradeMarker(a,join(i.root,'formal-work')))+'\n')fail('UPGRADE_SWITCH_EVIDENCE','First worker layout, owner or barrier differs',409);
  }
  return {installation,binding:record,positions};
}
