import {constants,lstatSync,fstatSync,openSync,closeSync,readSync,readdirSync,realpathSync} from 'node:fs';
import {isAbsolute,join,resolve,dirname} from 'node:path';
import type {Stats} from 'node:fs';
import {readInstallation,currentRun} from './manager.js';
import {inspectRuntime,verifyRuntime} from './runtime.js';
import {operatorLock,assertSeparate,outsideSource} from './files.js';
import {processPresent} from './control.js';
import {requireSelectedRuntimeLocation} from './runtime-history.js';
import {privatePath,privateRead,requireMaintenanceAvailable} from '../standalone/workspace.js';
import {digest,exact,hash,hashBytes,validateIdentity} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {pluginContent,PLUGIN_LIMITS,PLUGIN_DIRECTORIES} from './plugin-content.js';
import {mergePluginFiles,parsePluginJSON} from './plugin-merge.js';
import type {PluginResolution} from './plugin-merge.js';

interface PluginNode {path:string;kind:'file'|'directory';mode:number;device:number;inode:number;bytes:number;digest:string|null;}
interface PluginSnapshot {entries:PluginNode[];files:Map<string,Buffer>;}
export interface PluginUpgradeInput {runtimeRoot:string;runtimeDigest:string;resolutionsFile?:string;}
export interface PluginUpgradePreparation {report:Json;reportDigest:string;files:Map<string,Buffer>;}
function safeRelative(path:string):void {
  if(!path||path.length>4096||path.split('/').some(p=>!p||p==='.'||p==='..')||/[\x00-\x1f\x7f\\]/.test(path)||isAbsolute(path))fail('PLUGIN_PATH','Invalid relative plugin entry',409);
}
function readBytes(path:string):{bytes:Buffer;stat:Stats} {
  privatePath(path);const before=lstatSync(path),fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const stat=fstatSync(fd);
    if(stat.dev!==before.dev||stat.ino!==before.ino||!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid?.()||(stat.mode&0o077))fail('UNSAFE_PATH','Private plugin file changed during open');
    if(stat.size>PLUGIN_LIMITS.fileBytes)fail('PLUGIN_LIMIT','Private plugin file exceeds its byte budget',413);
    const buffer=Buffer.alloc(PLUGIN_LIMITS.fileBytes+1);let offset=0;
    while(offset<buffer.length){const n=readSync(fd,buffer,offset,buffer.length-offset,null);if(!n)break;offset+=n;}
    const bytes=buffer.subarray(0,offset),after=fstatSync(fd);
    if(offset>PLUGIN_LIMITS.fileBytes)fail('PLUGIN_LIMIT','Private plugin file exceeds its byte budget',413);
    if(bytes.length!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs)fail('PLUGIN_CHANGED','Plugin changed during inspection',409);
    return {bytes:Buffer.from(bytes),stat};
  }finally{closeSync(fd);}
}
/** Full bounded private tree, including binary custom files and empty folders.
 * No symlink, hardlink, executable invocation or remote fetch is permitted. */
function snapshot(root:string):PluginSnapshot {
  privatePath(root,true);if(realpathSync(root)!==root)fail('UNSAFE_PATH','Canonical plugin root required');
  const files=new Map<string,Buffer>(),entries:PluginNode[]=[];let total=0;
  const visit=(path:string,relative:string,depth:number):void=>{
    if(depth>PLUGIN_LIMITS.depth||entries.length>=PLUGIN_LIMITS.entries)fail('PLUGIN_LIMIT','Plugin tree exceeds its entry/depth budget',413);
    if(relative)safeRelative(relative);
    const stat=lstatSync(path);privatePath(path,stat.isDirectory());
    if(stat.isDirectory()){
      entries.push({path:relative,kind:'directory',mode:stat.mode&0o777,device:stat.dev,inode:stat.ino,bytes:0,digest:null});
      for(const name of readdirSync(path).sort())visit(join(path,name),relative?relative+'/'+name:name,depth+1);
    }else{
      const read=readBytes(path);total+=read.bytes.length;if(total>PLUGIN_LIMITS.totalBytes)fail('PLUGIN_LIMIT','Plugin tree exceeds its total byte budget',413);
      files.set(relative,read.bytes);entries.push({path:relative,kind:'file',mode:read.stat.mode&0o777,device:read.stat.dev,inode:read.stat.ino,bytes:read.bytes.length,digest:hashBytes(read.bytes)});
    }
  };
  visit(root,'',0);return {entries,files};
}
function resolutions(file:string|undefined):PluginResolution[] {
  if(file===undefined)return [];
  const selectedFile=(path:unknown):path is string=>typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&outsideSource(dirname(path))===dirname(path)&&realpathSync(path)===path;
  if(!selectedFile(file))fail('UNSAFE_PATH','Canonical private resolution file outside source required');
  let value:unknown;try{value=parsePluginJSON(Buffer.from(privateRead(file,256*1024)));}catch{fail('PLUGIN_RESOLUTION','Cannot read bounded private resolution document');}
  exact(value,['schema','resolutions']);if(value.schema!=='ontology-plugin-resolutions/v1'||!Array.isArray(value.resolutions)||value.resolutions.length>PLUGIN_LIMITS.entries)fail('PLUGIN_RESOLUTION','Unknown or oversized resolution document');
  let total=0;const names=new Set<string>();
  return value.resolutions.map(v=>{
    exact(v,['path','baseDigest','currentDigest','newDigest','file']);if(typeof v.path!=='string')fail('PLUGIN_RESOLUTION','Resolution path required');safeRelative(v.path);
    if(names.has(v.path))fail('PLUGIN_RESOLUTION','Duplicate plugin resolution',409);names.add(v.path);
    for(const k of ['baseDigest','currentDigest','newDigest'])if(v[k]!==null)digest(v[k]);
    if(v.file!==null&&!selectedFile(v.file))fail('UNSAFE_PATH','Canonical private resolved file outside source required');
    const content=v.file===null?null:readBytes(v.file as string).bytes;total+=content?.length??0;if(total>PLUGIN_LIMITS.totalBytes)fail('PLUGIN_LIMIT','Resolved plugin files exceed their total byte budget',413);
    return {path:v.path,baseDigest:v.baseDigest as string|null,currentDigest:v.currentDigest as string|null,newDigest:v.newDigest as string|null,content};
  });
}
/** Preparation only. Runtime activation will have to revalidate this exact
 * report and stage its private buffers under the admitted upgrade transaction. */
export function preparePluginUpgrade(path:string,input:PluginUpgradeInput):PluginUpgradePreparation {
  exact(input,['runtimeRoot','runtimeDigest'],['resolutionsFile']);digest(input.runtimeDigest);
  if(typeof input.runtimeRoot!=='string'||input.resolutionsFile!==undefined&&typeof input.resolutionsFile!=='string')fail('INVALID_INPUT','Explicit runtime and optional private resolution file required');
  const i=readInstallation(path),unlock=operatorLock(i.root);
  try{
    requireMaintenanceAvailable(i.root);requireMaintenanceAvailable(i.workspaceRoot);
    const run=currentRun(i);if(run&&!['STOPPED','FAILED'].includes(run.state)&&processPresent(run.pid)!==false)fail('INSTALLATION_RUNNING','Stop the exact owner before preparing a plugin upgrade',409);
    const identity:unknown=JSON.parse(privateRead(join(i.workspaceRoot,'identity.json'),4096));validateIdentity(identity);
    if(identity.workspaceId!==i.workspaceId||identity.serviceId!==i.serviceId)fail('IDENTITY_MISMATCH','Plugin installation and workspace differ',403);
    verifyRuntime(i.runtime);const next=inspectRuntime(input.runtimeRoot);
    if(next.digest!==input.runtimeDigest)fail('RUNTIME_CHANGED','Selected upgrade package digest changed',409);
    for(const root of [i.root,i.workspaceRoot,i.runtime.root])assertSeparate(next.root,root);
    requireSelectedRuntimeLocation(i,next);
    const base=pluginContent(i.runtime,i.root),upstream=pluginContent(next,i.root),root=join(i.root,'plugin'),current=snapshot(root);
    const merge=mergePluginFiles(base,current.files,upstream,resolutions(input.resolutionsFile));
    const directories=[...new Set([...PLUGIN_DIRECTORIES,...current.entries.filter(e=>e.kind==='directory').map(e=>e.path)])].sort();
    if(directories.length+merge.files.size>PLUGIN_LIMITS.entries)fail('PLUGIN_LIMIT','Merged plugin tree exceeds its entry budget',413);
    const treeConflicts:string[]=[];
    for(const p of merge.files.keys()){
      if(directories.includes(p)||[...merge.files.keys(),...directories].some(other=>other.startsWith(p+'/')))treeConflicts.push(p);
    }
    const currentDigest=hash(current.entries as unknown as Json);
    if(hash(snapshot(root).entries as unknown as Json)!==currentDigest||hash(readInstallation(i.root) as unknown as Json)!==hash(i as unknown as Json))fail('PLUGIN_CHANGED','Inspected plugin or installation changed',409);
    const finalIdentity:unknown=JSON.parse(privateRead(join(i.workspaceRoot,'identity.json'),4096));validateIdentity(finalIdentity);
    if(hash(finalIdentity as unknown as Json)!==hash(identity as unknown as Json))fail('PLUGIN_CHANGED','Inspected workspace identity changed',409);
    verifyRuntime(i.runtime);verifyRuntime(next);
    const report:Json={schema:'ontology-plugin-upgrade-plan/v1',status:merge.report.some(r=>r.conflicts.length)||treeConflicts.length?'CONFLICT':'MERGED',installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,
      installationDigest:hash(i as unknown as Json),workspaceIdentityDigest:hash(identity as unknown as Json),baseRuntime:{...i.runtime},newRuntime:{...next},currentTreeDigest:currentDigest,
      files:merge.report as unknown as Json,directories:directories.map(p=>({path:p,mode:current.entries.find(e=>e.path===p&&e.kind==='directory')?.mode??0o700})),
      fileModes:[...merge.files.keys()].sort().map(p=>({path:p,mode:current.entries.find(e=>e.path===p&&e.kind==='file')?.mode??0o600})),treeConflicts,
      limits:{...PLUGIN_LIMITS},runtimeActivated:false,serviceStarted:false,toolchainsVerified:false,productAcceptance:'NOT_EVALUATED',authority:false};
    return {report,reportDigest:hash(report),files:merge.files};
  }finally{unlock();}
}
export function inspectPluginUpgrade(path:string,input:PluginUpgradeInput):Json {
  const {report,reportDigest}=preparePluginUpgrade(path,input);return {report,reportDigest,authority:false};
}
