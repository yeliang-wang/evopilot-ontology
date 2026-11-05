import {existsSync,mkdirSync,realpathSync,mkdtempSync,chmodSync,writeFileSync,openSync,closeSync,readdirSync} from 'node:fs';
import {join,dirname,basename,resolve,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {outsideSource,createPrivateRoot,assertSeparate,writePrivate,readPrivate,operatorLock} from './files.js';
import {inspectRuntime,verifyRuntime} from './runtime.js';
import type {RuntimeBinding} from './runtime.js';
import {initializeWorkspace} from './workspace.js';
import {privatePath,privateRead,openWorkspace,requireMaintenanceAvailable} from '../standalone/workspace.js';
import {createStandaloneService} from '../standalone/service.js';
import {exact,id,digest,hash,hashBytes,validateIdentity} from '../standalone/validation.js';
import {fail,ServiceError} from '../standalone/types.js';
import {requireFreshRecoveryRequest} from '../standalone/recovery.js';
import type {Json} from '../standalone/types.js';
import {operatorRequest,processPresent,validateRun} from './control.js';
import type {RunRecord} from './control.js';
import {readToolchainLedger,verifyManagedToolchains,recordToolchainBinding,toolchainRequestDigest,validateToolchainInput} from './toolchains.js';
import type {BindToolchainsInput,ToolchainRecord} from './toolchains.js';
import {pluginContent,PLUGIN_DIRECTORIES} from './plugin-content.js';
import {validateInstallation,INSTALLATION_BYTES} from './installation-contract.js';
import type {Installation} from './installation-contract.js';
import {installationRuntimeBindings,runtimeBindingDigest,runtimeForDigest} from './runtime-history.js';

export type {Installation} from './installation-contract.js';
export interface PrepareInput{root:string;workspaceRoot:string;workspaceId:string;projectId:string;principalId:string;runtimeRoot:string;runtimeDigest:string;mode:'create'|'attach';serviceId?:string;port?:number;}
export function readInstallation(path:string):Installation{
  privatePath(path,true);const root=outsideSource(path),value=readPrivate(join(root,'installation.json'),INSTALLATION_BYTES);validateInstallation(value,root);
  if(value.schema==='ontology-installation/v2'){
    const raw=privateRead(join(root,'setup.json'),65536),setup:unknown=JSON.parse(raw);exact(setup,['requestDigest','installationId','serviceId','createdAt']);digest(setup.requestDigest);
    if(hashBytes(raw)!==value.runtimeHistory.setupDigest||setup.installationId!==value.installationId||setup.serviceId!==value.serviceId||setup.createdAt!==value.createdAt)fail('RUNTIME_HISTORY','Retained original setup bytes or owner changed',409);
  }
  return value;
}
function plugin(installation:Installation):void{
  const root=join(installation.root,'plugin'),files=pluginContent(installation.runtime,installation.root);
  verifyRuntime(installation.runtime);
  for(const dir of [root,...PLUGIN_DIRECTORIES.map(p=>join(root,p))]){if(!existsSync(dir))mkdirSync(dir,{mode:0o700});privatePath(dir,true);}
  for(const [path,bytes] of files){
    const target=join(root,path);
    if(path.endsWith('.json'))writePrivate(target,JSON.parse(bytes.toString('utf8')),true);else writeText(target,bytes);
  }
}
function writeText(path:string,value:Buffer):void{if(existsSync(path))privatePath(path);writeFileSync(path,value,{mode:0o600});chmodSync(path,0o600);}
export function prepareInstallation(input:PrepareInput):Installation{
  id(input.workspaceId);id(input.projectId);id(input.principalId);digest(input.runtimeDigest);
  if(!['create','attach'].includes(input.mode))fail('INVALID_INPUT','Explicit create or attach mode required');
  const runtime=inspectRuntime(input.runtimeRoot);if(runtime.digest!==input.runtimeDigest)fail('RUNTIME_CHANGED','Runtime digest differs from selected package',409);
  const port=input.port??0;if(!Number.isInteger(port)||port<0||port>65535)fail('INVALID_INPUT','Invalid port');
  if(!isAbsolute(input.root)||!isAbsolute(input.workspaceRoot))fail('UNSAFE_PATH','Absolute roots required');
  // Resolve parent aliases before checking separation (for example /tmp versus /private/tmp).
  const canonicalRoot=(path:string)=>join(outsideSource(dirname(resolve(path))),basename(resolve(path)));
  const root=canonicalRoot(input.root),workspaceRoot=canonicalRoot(input.workspaceRoot);
  assertSeparate(root,workspaceRoot);assertSeparate(root,runtime.root);assertSeparate(workspaceRoot,runtime.root);
  const requestDigest=hash({root,workspaceRoot,workspaceId:input.workspaceId,projectId:input.projectId,principalId:input.principalId,runtimeRoot:runtime.root,runtimeDigest:input.runtimeDigest,mode:input.mode,serviceId:input.serviceId??null,port});
  if(!existsSync(root))createPrivateRoot(root);
  else{privatePath(root,true);if(readdirSync(root).length&&!existsSync(join(root,'setup.json')))fail('INSTALLATION_EXISTS','Occupied directory has no retained Ontology setup',409);}
  privatePath(root,true);outsideSource(root);
  const unlock=operatorLock(root);
  try{
    const setupFile=join(root,'setup.json');let setup:{requestDigest:string;installationId:string;serviceId:string;createdAt:string};
    if(existsSync(setupFile)){const value=readPrivate(setupFile);exact(value,['requestDigest','installationId','serviceId','createdAt']);if(value.requestDigest!==requestDigest)fail('SETUP_CONFLICT','Retained setup binds a different request',409);id(value.installationId);id(value.serviceId);setup=value as typeof setup;}
    else{
      if(input.mode==='create'&&existsSync(workspaceRoot))fail('WORKSPACE_EXISTS','Create refuses occupied workspace; select explicit attach',409);
      if(input.mode==='attach'&&!input.serviceId)fail('INVALID_INPUT','Attach requires exact service identity');
      setup={requestDigest,installationId:randomUUID(),serviceId:input.serviceId??randomUUID(),createdAt:new Date().toISOString()};writePrivate(setupFile,setup);
    }
    if(!existsSync(workspaceRoot)){
      if(input.mode==='attach')fail('NOT_FOUND','Selected workspace does not exist',404);
      initializeWorkspace({root:workspaceRoot,workspaceId:input.workspaceId,projectId:input.projectId,principalId:input.principalId,serviceId:setup.serviceId});
    }
    const value=readPrivate(join(workspaceRoot,'identity.json'));validateIdentity(value);
    if(value.workspaceId!==input.workspaceId||value.serviceId!==setup.serviceId)fail('IDENTITY_MISMATCH','Workspace differs from retained setup',403);
    if(existsSync(join(root,'installation.json'))){const existing=readInstallation(root);if(existing.installationId!==setup.installationId)fail('IDENTITY_MISMATCH','Installation differs from retained setup');return existing;}
    const credentialFile=join(workspaceRoot,'operator-token'),service=createStandaloneService({root:workspaceRoot,workspaceId:value.workspaceId,serviceId:value.serviceId});
    try{const context=service.context(privateRead(credentialFile,256));if(!context||typeof context!=='object'||Array.isArray(context)||context.principalId!==input.principalId||!Array.isArray(context.projectIds)||!context.projectIds.includes(input.projectId))fail('FORBIDDEN','Credential does not match selected principal/project',403);}finally{service.close();}
    const installation:Installation={schema:'ontology-installation/v1',installationId:setup.installationId,root:realpathSync(root),workspaceRoot:realpathSync(workspaceRoot),workspaceId:value.workspaceId,serviceId:value.serviceId,projectId:input.projectId,principalId:input.principalId,credentialFile,runtime,port,createdAt:setup.createdAt};
    const runs=join(root,'runs');if(!existsSync(runs))mkdirSync(runs,{mode:0o700});privatePath(runs,true);
    plugin(installation);writePrivate(join(root,'installation.json'),installation);return installation;
  }finally{unlock();}
}
function readMutableRun(path:string):unknown{
  // The daemon replaces its run record atomically while the operator observes
  // startup/shutdown. A stat/open race can see a replaced inode or an unlinked
  // old descriptor. Re-observe only this mutable record, with a fixed bound;
  // every attempt still applies the complete privateRead ownership/link/mode
  // and size checks. Immutable workspace/credential readers remain unchanged.
  for(let attempt=0;;attempt++){
    try{return readPrivate(path);}
    catch(error){if(!(error instanceof ServiceError)||error.code!=='UNSAFE_PATH'||attempt>=2)throw error;}
  }
}
export function currentRun(installation:Installation):RunRecord|null{
  const pointer=join(installation.root,'current-run.json');if(!existsSync(pointer))return null;
  const selected=readPrivate(pointer);exact(selected,['runId']);id(selected.runId);
  const value=readMutableRun(join(installation.root,'runs',selected.runId+'.json'));validateRun(value);
  if(value.installationId!==installation.installationId||value.runId!==selected.runId)fail('IDENTITY_MISMATCH','Managed run identity changed',403);
  if(value.schema==='ontology-managed-run/v3'&&!installationRuntimeBindings(installation).some(r=>runtimeBindingDigest(r)===value.runtimeBindingDigest))fail('RUNTIME_HISTORY_MISSING','Managed run requires its original runtime identity',409);return value;
}
export function writeRun(installation:Installation,run:RunRecord):void{
  validateRun(run);
  if(run.installationId!==installation.installationId)fail('IDENTITY_MISMATCH','Managed run owner differs');
  writePrivate(join(installation.root,'runs',run.runId+'.json'),run,true);
}
export async function inspectInstallation(path:string):Promise<Json>{
  const installation=readInstallation(path),run=currentRun(installation);
  if(!run)return {installation:installation as unknown as Json,observed:'STOPPED',run:null};
  try{const actual=await operatorRequest(run,'status');return {installationId:installation.installationId,observed:actual.state,run:{...actual}};}
  catch{const alive=processPresent(run.pid);return {installationId:installation.installationId,observed:run.state==='STOPPED'||run.state==='FAILED'?run.state:alive===false?'DEAD':'UNKNOWN',run:{...run}};}
}
export function bindInstallationToolchains(path:string,input:BindToolchainsInput):Json {
  const installation=readInstallation(path),unlock=operatorLock(installation.root);
  try{
    validateToolchainInput(input);verifyRuntime(installation.runtime);
    const ledger=readToolchainLedger(installation),old=ledger.records.find(r=>r.binding.requestId===input.requestId),run=currentRun(installation);
    requireRunToolchainHistory(run,ledger.records);
    if(old){const prior={...installation,runtime:runtimeForDigest(installation,old.binding.runtimeDigest)};if(old.binding.requestDigest!==toolchainRequestDigest(prior,input))fail('REQUEST_CONFLICT','Toolchain request ID binds different parameters',409);return {receipt:old as unknown as Json,replayed:true,currentBindingDigest:ledger.records.at(-1)!.digest,authority:false};}
    requireMaintenanceAvailable(installation.root);
    if(run&&!['STOPPED','FAILED'].includes(run.state)&&processPresent(run.pid)!==false)fail('INSTALLATION_RUNNING','Stop or reconcile the exact managed service before changing toolchain binding',409);
    const workspace=openWorkspace(installation.workspaceRoot,installation);
    try{
      requireFreshRecoveryRequest(workspace.identity,input.requestId);
      if(workspace.db.prepare("SELECT id FROM native_reasoning_tasks WHERE state!='FINISHED' LIMIT 1").get())fail('TASK_RECOVERY_REQUIRED','Unresolved formal work must be reconciled before replacing tools',409);
      const receipt=recordToolchainBinding(installation,input,ledger);
      return {receipt:receipt as unknown as Json,replayed:false,currentBindingDigest:receipt.digest,authority:false};
    }finally{workspace.close();}
  }finally{unlock();}
}
export function inspectInstallationToolchains(path:string):Json {
  const installation=readInstallation(path);verifyRuntime(installation.runtime);const ledger=readToolchainLedger(installation),record=ledger.records.at(-1)??null;
  requireRunToolchainHistory(currentRun(installation),ledger.records);
  verifyManagedToolchains(installation,record);
  return {installationId:installation.installationId,status:record?'VERIFIED':'UNCONFIGURED',bindingDigest:record?.digest??null,binding:(record?.binding??null) as unknown as Json,executorsReplayed:false,productAcceptance:'NOT_EVALUATED',authority:false};
}
function requireRunToolchainHistory(run:RunRecord|null,records:ToolchainRecord[]):void {
  if(run?.toolchainBindingDigest&&!records.some(r=>r.digest===run.toolchainBindingDigest))fail('TOOLCHAIN_BINDING_MISSING','Earlier managed run requires its missing binding history; no reset or unconfigured fallback',409);
}
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
export async function startInstallation(path:string):Promise<Json>{
  const installation=readInstallation(path),unlock=operatorLock(installation.root);
  try{
    requireMaintenanceAvailable(installation.root);requireMaintenanceAvailable(installation.workspaceRoot);
    verifyRuntime(installation.runtime);
    const ledger=readToolchainLedger(installation),binding=ledger.records.at(-1)??null,old=currentRun(installation);
    requireRunToolchainHistory(old,ledger.records);verifyManagedToolchains(installation,binding,true);
    if(old){let actual:RunRecord|null=null;try{actual=await operatorRequest(old,'status');}catch{}
      if(actual?.state==='RUNNING'){
        if(actual.schema==='ontology-managed-run/v3'?actual.runtimeBindingDigest!==runtimeBindingDigest(installation.runtime):installation.schema!=='ontology-installation/v1')fail('RUNTIME_BINDING_CONFLICT','Live service runtime differs or is unproven; stop the exact old run',409);
        if(actual.toolchainBindingDigest!==(binding?.digest??null))fail('TOOLCHAIN_BINDING_CONFLICT','Live service uses another toolchain binding; stop it explicitly',409);
        return {installationId:installation.installationId,observed:'RUNNING',run:{...actual},reused:true};
      }
      if(!['STOPPED','FAILED'].includes(old.state)&&processPresent(old.pid)!==false)fail('LAUNCH_UNKNOWN','Original launch outcome is unresolved; inspect it before starting another',409);}
    const controlRoot=realpathSync(mkdtempSync(join(tmpdir(),'ont-op-')));chmodSync(controlRoot,0o700);
    const run:RunRecord={schema:'ontology-managed-run/v3',runtimeBindingDigest:runtimeBindingDigest(installation.runtime),installationId:installation.installationId,runId:randomUUID(),toolchainBindingDigest:binding?.digest??null,createdAt:new Date().toISOString(),pid:null,controlSocket:join(controlRoot,'control.sock'),state:'STARTING',origin:null,error:null};
    writeRun(installation,run);writePrivate(join(installation.root,'current-run.json'),{runId:run.runId},true);
    const log=join(installation.root,'runs',run.runId+'.log'),fd=openSync(log,'wx',0o600);
    try{
      const child=spawn(installation.runtime.nodePath,[join(installation.runtime.packageRoot,'dist/installation/daemon.js'),'--installation',installation.root,'--run',run.runId],{detached:true,cwd:installation.root,stdio:['ignore',fd,fd],env:{PATH:dirname(installation.runtime.nodePath),LANG:'C.UTF-8',NODE_OPTIONS:'',NODE_PATH:''}});
      child.on('error',()=>{const current=currentRun(installation);if(current?.runId===run.runId&&current.state==='STARTING'&&current.pid===null){current.state='FAILED';current.error='SPAWN_FAILED';writeRun(installation,current);}});child.unref();
      // The daemon owns later state transitions; parent never overwrites its STARTING/RUNNING receipt.
    }finally{closeSync(fd);}
    for(let i=0;i<100;i++){
      const current=currentRun(installation)!;
      if(current.state==='FAILED')fail(current.error??'START_FAILED','Managed service failed to start; inspect retained run',409);
      if(current.state==='RUNNING'){try{const actual=await operatorRequest(current,'status');return {installationId:installation.installationId,observed:'RUNNING',run:{...actual},reused:false};}catch{}}
      await pause(100);
    }
    fail('LAUNCH_UNKNOWN','Managed start timed out; inspect its original retained run',503);
  }finally{unlock();}
}
export async function stopInstallation(path:string):Promise<Json>{
  const installation=readInstallation(path),unlock=operatorLock(installation.root);
  try{
    const run=currentRun(installation);if(!run)return {observed:'STOPPED',run:null};
    if(['STOPPED','FAILED'].includes(run.state))return {observed:run.state,run:{...run}};
    try{await operatorRequest(run,'stop');}catch{if(processPresent(run.pid)===false)return {observed:'DEAD',run:{...run}};fail('STOP_UNKNOWN','Cannot authenticate the original service; no PID signal was sent',503);}
    for(let i=0;i<100;i++){const current=currentRun(installation)!;if(current.state==='STOPPED')return {observed:'STOPPED',run:{...current}};await pause(100);}
    fail('STOP_UNKNOWN','Stop requested; inspect its original retained run',503);
  }finally{unlock();}
}
