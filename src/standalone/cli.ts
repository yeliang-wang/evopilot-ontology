#!/usr/bin/env node
import { isAbsolute } from 'node:path';
import {inspectDistribution} from '../installation/distribution-inspect.js';
import { pathToFileURL } from 'node:url';
import { constants, openSync, closeSync, readSync, fstatSync, realpathSync } from 'node:fs';
import { grantReviewer,revokeReviewer } from '../installation/reviewer.js';
import {inspectSystemdBinding} from '../installation/systemd-binding.js';
import {inspectInstallationTaskRecovery,reconcileInstallationTask} from '../installation/task-recovery.js';
import {inspectInstallationWorkerRotation,rotateInstallationWorkerJournal} from '../installation/worker-rotation.js';
import {inspectInstallationBackup,backupInstallation,abortInstallationBackup} from '../installation/backup.js';
import {verifyBackup} from '../installation/backup-files.js';
import {inspectRestoreStage,stageInstallationRestore,verifyRestoreStage} from '../installation/restore-stage.js';
import {inspectRestoreActivation,activateRestore,abortRestoreActivation} from '../installation/restore-activate.js';
import {inspectLostRestore,activateLostRestore,abortLostRestore} from '../installation/restore-lost.js';
import {inspectInstallationWorkerMaintenance,maintainInstallationWorkers} from '../installation/worker-maintenance.js';
import {inspectPluginUpgrade} from '../installation/plugin-upgrade.js';
import {inspectInstallationUpgrade} from '../installation/upgrade-plan.js';
import type {InstallationUpgradeInput,InstallationUpgradePlan} from '../installation/upgrade-plan.js';
import {stageInstallationUpgrade} from '../installation/upgrade-stage.js';
import {activateInstallationUpgrade} from '../installation/upgrade-activate.js';
import {abortInstallationUpgrade} from '../installation/upgrade-control.js';
import {inspectInstallationUpgradeRequest} from '../installation/upgrade-status.js';
import {BACKUP_LIMITS} from '../installation/backup-contract.js';
import { initializeWorkspace } from '../installation/workspace.js';
import { inspectRuntime } from '../installation/runtime.js';
import { prepareInstallation,inspectInstallation,startInstallation,stopInstallation,bindInstallationToolchains,inspectInstallationToolchains } from '../installation/manager.js';
import { listenStandalone } from './http.js';
import { readConnection, sendRequest } from './client.js';
import { READ_OPERATIONS, WRITE_OPERATIONS } from './service.js';
import { json, object } from './validation.js';
import { LIMITS, ServiceError, fail } from './types.js';
import type { Json, ServiceRequest } from './types.js';

const usage='evopilot-ontology distribution-inspect --input ABS_JSON --json | upgrade-status --installation ABS --request-id ID --json | upgrade-stage|upgrade-activate|upgrade-abort --installation ABS --input ABS_JSON --expected-report SHA256 [--expected-prepared SHA256 for activate] [--retained-report ABS_RAW_REPORT_JSON for abort] --json | upgrade-inspect --installation ABS --input ABS_JSON --json | upgrade-plugin-inspect --installation ABS --runtime-root ABS --runtime-digest SHA256 [--resolutions ABS_JSON] --json | restore-lost-inspect|restore-lost-apply --snapshot ABS_STAGE --snapshot-manifest SHA256 --recovery-root ABS --request-id ID --rekey-expires-at UTC [--expected-report SHA256 for apply] --json | restore-lost-abort --recovery-root ABS --request-id ID --expected-report SHA256 --json | restore-current-inspect|restore-current-apply --installation ABS --snapshot ABS_STAGE --snapshot-manifest SHA256 --retained ABS_CURRENT_STAGE --retained-manifest SHA256 --recovery-root ABS --request-id ID [--expected-report SHA256 for apply] --json | restore-current-abort --recovery-root ABS --request-id ID --expected-report SHA256 --json | restore-stage-inspect --backup ABS --expected-manifest SHA256 --stage-root ABS --request-id ID --json | restore-stage-apply --backup ABS --expected-manifest SHA256 --stage-root ABS --request-id ID --expected-report SHA256 --json | restore-stage-verify --stage-root ABS --expected-manifest SHA256 --json | backup-inspect --installation ABS --backup ABS --request-id ID --json | backup-apply --installation ABS --backup ABS --request-id ID --expected-report SHA256 --json | backup-abort --installation ABS --request-id ID --expected-report SHA256 --json | backup-verify --backup ABS --expected-manifest SHA256 --json | worker-rotation-inspect --installation ABS [--request-id ID] --json | worker-rotation-apply --installation ABS --request-id ID --expected-report SHA256 --json | worker-maintenance-inspect --installation ABS --project ID --task ID --json | worker-maintenance-apply --installation ABS --project ID --task ID --request-id ID --expected-report SHA256 --json | worker-isolation-inspect --json | task-recovery-inspect --installation ABS --project ID --task ID --json | task-reconcile --installation ABS --project ID --task ID --request-id ID --expected-report SHA256 --json | toolchains-bind --installation ABS --request-id ID --previous-binding none|SHA256 --dl-toolchain ABS --dl-digest SHA256 --shacl-toolchain ABS --shacl-digest SHA256 [--systemd-digest SHA256] --json | toolchains-inspect --installation ABS --json | reviewer-grant --root ABS --workspace ID --service ID --project ID --principal ID --grant-id ID --expires-at UTC --json | reviewer-revoke --root ABS --workspace ID --service ID --grant-id ID --json | runtime-inspect --runtime-root ABS --json | install --root ABS --workspace-root ABS --workspace ID --project ID --principal ID --runtime-root ABS --runtime-digest SHA256 --mode create|attach [--service ID --port N] --json | installation-inspect|start|stop --installation ABS --json | init --root ABS --workspace ID --project ID --principal ID --json | serve --root ABS --workspace ID --service ID [--port N] [--dl-toolchain ABS --dl-work-root ABS] [--shacl-toolchain ABS --shacl-work-root ABS] [--systemd-digest SHA256] --json | context --connection ABS --json | read|write --connection ABS --operation NAME [--input ABS_JSON] [--request-id ID --expected-revision N] --json';
function flags(args: string[],required: string[],optional: string[]=[]): Map<string,string>{
  const found=new Map<string,string>();
  for(let i=0;i<args.length;i++){
    const key=args[i];
    if(!key.startsWith('--')||found.has(key))fail('INVALID_ARGUMENTS',usage);
    if(key==='--json'){found.set(key,'true');continue;}
    if(![...required,...optional].includes(key)||i+1>=args.length||args[i+1].startsWith('--'))fail('INVALID_ARGUMENTS',usage);
    found.set(key,args[++i]);
  }
  if(!found.has('--json')||required.some(k=>!found.has(k)))fail('INVALID_ARGUMENTS',usage);
  return found;
}
const integer=(text: string):number=>{if(!/^(0|[1-9][0-9]*)$/.test(text)||!Number.isSafeInteger(Number(text)))fail('INVALID_ARGUMENTS','Nonnegative integer required');return Number(text);};
function readInput(path:string,maxBytes:number=LIMITS.requestBytes):Buffer{
  if(!isAbsolute(path))fail('UNSAFE_PATH','Absolute input file required');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const stat=fstatSync(fd);if(!stat.isFile())fail('UNSAFE_PATH','Regular input file required');
    if(stat.size>maxBytes)fail('INPUT_LIMIT','Input exceeds byte budget',413);
    const buffer=Buffer.alloc(maxBytes+1);let offset=0;
    while(offset<buffer.length){const n=readSync(fd,buffer,offset,buffer.length-offset,null);if(n===0)break;offset+=n;}
    if(offset>maxBytes)fail('INPUT_LIMIT','Input exceeds byte budget',413);
    return buffer.subarray(0,offset);
  }finally{closeSync(fd);}
}
function readRetainedUpgradeReport(path:string):InstallationUpgradePlan {
  const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readInput(path,BACKUP_LIMITS.manifestBytes)));
  // Maintenance inventories have their own byte/count bounds. Do not apply the
  // ordinary domain-request byte/node ceiling to an original inspected report.
  const visit=(v:unknown,depth:number):void=>{
    if(depth>LIMITS.jsonDepth)fail('INPUT_LIMIT','Retained report nesting exceeds budget',413);
    if(v===null||typeof v==='string'||typeof v==='boolean')return;
    if(typeof v==='number'){if(!Number.isFinite(v))fail('INVALID_INPUT','Finite JSON numbers required');return;}
    if(Array.isArray(v)){for(const item of v)visit(item,depth+1);return;}
    object(v);for(const [key,item] of Object.entries(v)){
      if(['__proto__','prototype','constructor'].includes(key))fail('INVALID_INPUT','Reserved JSON member');visit(item,depth+1);
    }
  };
  visit(value,0);object(value);return value as unknown as InstallationUpgradePlan;
}
function selectedSystemd(flags:Map<string,string>){
  const expected=flags.get('--systemd-digest');if(expected===undefined)return undefined;
  const binding=inspectSystemdBinding();if(binding.digest!==expected)fail('WORKER_ISOLATION_DRIFT','Selected systemd identity changed; inspect the operator binding again',409);
  return binding;
}
export async function main(argv: string[],emit:(value:Json)=>void):Promise<void>{
  const [command,...args]=argv;
  if(command==='distribution-inspect'){
    const f=flags(args,['--input']);
    const input:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readInput(f.get('--input')!)));
    emit(inspectDistribution(input));return;
  }
  if(command==='upgrade-status'){
    const f=flags(args,['--installation','--request-id']);
    emit(inspectInstallationUpgradeRequest(f.get('--installation')!,f.get('--request-id')!));return;
  }
  if(command==='upgrade-stage'||command==='upgrade-activate'||command==='upgrade-abort'){
    const f=flags(args,['--installation','--input','--expected-report',...(command==='upgrade-activate'?['--expected-prepared']:[])],command==='upgrade-abort'?['--retained-report']:[]);
    const input:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readInput(f.get('--input')!)));json(input);object(input);
    const installation=f.get('--installation')!,selection=input as unknown as InstallationUpgradeInput,report=f.get('--expected-report')!;
    if(command==='upgrade-stage'){emit(stageInstallationUpgrade(installation,selection,report));return;}
    if(command==='upgrade-activate'){emit(activateInstallationUpgrade(installation,selection,report,f.get('--expected-prepared')!));return;}
    const retained=f.has('--retained-report')?readRetainedUpgradeReport(f.get('--retained-report')!):undefined;
    emit(abortInstallationUpgrade(installation,selection,report,retained));return;
  }
  if(command==='upgrade-inspect'){
    const f=flags(args,['--installation','--input']);
    const input:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readInput(f.get('--input')!)));json(input);object(input);
    emit(inspectInstallationUpgrade(f.get('--installation')!,input as unknown as InstallationUpgradeInput));return;
  }
  if(command==='upgrade-plugin-inspect'){
    const f=flags(args,['--installation','--runtime-root','--runtime-digest'],['--resolutions']);
    emit(inspectPluginUpgrade(f.get('--installation')!,{runtimeRoot:f.get('--runtime-root')!,runtimeDigest:f.get('--runtime-digest')!,...(f.has('--resolutions')?{resolutionsFile:f.get('--resolutions')!}:{})}));return;
  }
  if(command==='restore-lost-inspect'||command==='restore-lost-apply'){
    const f=flags(args,['--snapshot','--snapshot-manifest','--recovery-root','--request-id','--rekey-expires-at',...(command==='restore-lost-apply'?['--expected-report']:[])]),input={snapshot:{root:f.get('--snapshot')!,manifestDigest:f.get('--snapshot-manifest')!},recoveryRoot:f.get('--recovery-root')!,requestId:f.get('--request-id')!,rekeyExpiresAt:f.get('--rekey-expires-at')!};
    emit(command==='restore-lost-inspect'?inspectLostRestore(input):activateLostRestore(input,f.get('--expected-report')!));return;
  }
  if(command==='restore-lost-abort'){
    const f=flags(args,['--recovery-root','--request-id','--expected-report']);emit(abortLostRestore(f.get('--recovery-root')!,f.get('--request-id')!,f.get('--expected-report')!));return;
  }
  if(command==='restore-current-inspect'||command==='restore-current-apply'){
    const f=flags(args,['--installation','--snapshot','--snapshot-manifest','--retained','--retained-manifest','--recovery-root','--request-id',...(command==='restore-current-apply'?['--expected-report']:[])]),input={installationRoot:f.get('--installation')!,snapshot:{root:f.get('--snapshot')!,manifestDigest:f.get('--snapshot-manifest')!},retained:{root:f.get('--retained')!,manifestDigest:f.get('--retained-manifest')!},recoveryRoot:f.get('--recovery-root')!,requestId:f.get('--request-id')!};
    emit(command==='restore-current-inspect'?inspectRestoreActivation(input):activateRestore(input,f.get('--expected-report')!));return;
  }
  if(command==='restore-current-abort'){
    const f=flags(args,['--recovery-root','--request-id','--expected-report']);emit(abortRestoreActivation(f.get('--recovery-root')!,f.get('--request-id')!,f.get('--expected-report')!));return;
  }
  if(command==='restore-stage-inspect'||command==='restore-stage-apply'){
    const f=flags(args,['--backup','--expected-manifest','--stage-root','--request-id',...(command==='restore-stage-apply'?['--expected-report']:[])]),input={backupRoot:f.get('--backup')!,expectedManifestDigest:f.get('--expected-manifest')!,stageRoot:f.get('--stage-root')!,requestId:f.get('--request-id')!};
    emit(command==='restore-stage-inspect'?inspectRestoreStage(input):stageInstallationRestore(input,f.get('--expected-report')!));return;
  }
  if(command==='restore-stage-verify'){
    const f=flags(args,['--stage-root','--expected-manifest']);emit(verifyRestoreStage(f.get('--stage-root')!,f.get('--expected-manifest')!));return;
  }
  if(command==='backup-inspect'||command==='backup-apply'){
    const f=flags(args,['--installation','--backup','--request-id',...(command==='backup-apply'?['--expected-report']:[])]);
    emit(command==='backup-inspect'?inspectInstallationBackup(f.get('--installation')!,f.get('--backup')!,f.get('--request-id')!):backupInstallation(f.get('--installation')!,{backupRoot:f.get('--backup')!,requestId:f.get('--request-id')!,expectedReportDigest:f.get('--expected-report')!}));return;
  }
  if(command==='backup-abort'){
    const f=flags(args,['--installation','--request-id','--expected-report']);emit(abortInstallationBackup(f.get('--installation')!,f.get('--request-id')!,f.get('--expected-report')!));return;
  }
  if(command==='backup-verify'){
    const f=flags(args,['--backup','--expected-manifest']),v=verifyBackup(f.get('--backup')!,f.get('--expected-manifest')!);
    emit({status:'VERIFIED',receipt:v.receipt as unknown as Json,objects:v.objects,storedBytes:v.storedBytes,authority:false});return;
  }
  if(command==='worker-rotation-inspect'||command==='worker-rotation-apply'){
    const f=flags(args,['--installation',...(command==='worker-rotation-apply'?['--request-id','--expected-report']:[])],command==='worker-rotation-inspect'?['--request-id']:[]);
    emit(await (command==='worker-rotation-inspect'?inspectInstallationWorkerRotation(f.get('--installation')!,f.get('--request-id')):rotateInstallationWorkerJournal(f.get('--installation')!,{requestId:f.get('--request-id')!,expectedReportDigest:f.get('--expected-report')!})));return;
  }
  if(command==='worker-maintenance-inspect'||command==='worker-maintenance-apply'){
    const f=flags(args,['--installation','--project','--task',...(command==='worker-maintenance-apply'?['--request-id','--expected-report']:[])]);
    emit(await (command==='worker-maintenance-inspect'?inspectInstallationWorkerMaintenance(f.get('--installation')!,f.get('--project')!,f.get('--task')!):maintainInstallationWorkers(f.get('--installation')!,{projectId:f.get('--project')!,taskId:f.get('--task')!,requestId:f.get('--request-id')!,expectedReportDigest:f.get('--expected-report')!})));return;
  }
  if(command==='worker-isolation-inspect'){flags(args,[]);emit(inspectSystemdBinding() as unknown as Json);return;}
  if(command==='task-recovery-inspect'||command==='task-reconcile'){
    const f=flags(args,['--installation','--project','--task',...(command==='task-reconcile'?['--request-id','--expected-report']:[])]);
    emit(command==='task-recovery-inspect'?inspectInstallationTaskRecovery(f.get('--installation')!,f.get('--project')!,f.get('--task')!):reconcileInstallationTask(f.get('--installation')!,{projectId:f.get('--project')!,taskId:f.get('--task')!,requestId:f.get('--request-id')!,expectedReportDigest:f.get('--expected-report')!}));return;
  }
  if(command==='toolchains-bind'){
    const f=flags(args,['--installation','--request-id','--previous-binding','--dl-toolchain','--dl-digest','--shacl-toolchain','--shacl-digest'],['--systemd-digest']);
    const systemd=selectedSystemd(f);
    emit(bindInstallationToolchains(f.get('--installation')!,{requestId:f.get('--request-id')!,previousBindingDigest:f.get('--previous-binding')==='none'?null:f.get('--previous-binding')!,dl:{toolchainFile:f.get('--dl-toolchain')!,toolchainDigest:f.get('--dl-digest')!},shacl:{toolchainFile:f.get('--shacl-toolchain')!,toolchainDigest:f.get('--shacl-digest')!},...(systemd?{systemd}:{})}));return;
  }
  if(command==='toolchains-inspect'){
    const f=flags(args,['--installation']);emit(inspectInstallationToolchains(f.get('--installation')!));return;
  }
  if(command==='reviewer-grant'||command==='reviewer-revoke'){
    const f=flags(args,['--root','--workspace','--service','--grant-id',...(command==='reviewer-grant'?['--project','--principal','--expires-at']:[])]);
    const base={root:f.get('--root')!,workspaceId:f.get('--workspace')!,serviceId:f.get('--service')!,grantId:f.get('--grant-id')!};
    emit(command==='reviewer-grant'?grantReviewer({...base,projectId:f.get('--project')!,principalId:f.get('--principal')!,expiresAt:f.get('--expires-at')!}):revokeReviewer(base));return;
  }
  if(command==='runtime-inspect'){
    const f=flags(args,['--runtime-root']);emit({...inspectRuntime(f.get('--runtime-root')!)});return;
  }
  if(command==='install'){
    const f=flags(args,['--root','--workspace-root','--workspace','--project','--principal','--runtime-root','--runtime-digest','--mode'],['--service','--port']);
    const mode=f.get('--mode');if(mode!=='create'&&mode!=='attach')fail('INVALID_ARGUMENTS','Mode must be create or attach');
    const result=prepareInstallation({root:f.get('--root')!,workspaceRoot:f.get('--workspace-root')!,workspaceId:f.get('--workspace')!,projectId:f.get('--project')!,principalId:f.get('--principal')!,runtimeRoot:f.get('--runtime-root')!,runtimeDigest:f.get('--runtime-digest')!,mode,serviceId:f.get('--service'),port:f.has('--port')?integer(f.get('--port')!):0});
    emit(result as unknown as Json);return;
  }
  if(['installation-inspect','start','stop'].includes(command)){
    const f=flags(args,['--installation']);
    emit(await (command==='start'?startInstallation:command==='stop'?stopInstallation:inspectInstallation)(f.get('--installation')!));return;
  }
  if(command==='init'){
    const f=flags(args,['--root','--workspace','--project','--principal']);
    emit(initializeWorkspace({root:f.get('--root')!,workspaceId:f.get('--workspace')!,projectId:f.get('--project')!,principalId:f.get('--principal')!}));return;
  }
  if(command==='serve'){
    const f=flags(args,['--root','--workspace','--service'],['--port','--dl-toolchain','--dl-work-root','--shacl-toolchain','--shacl-work-root','--systemd-digest']);
    if(f.has('--dl-toolchain')!==f.has('--dl-work-root'))fail('INVALID_ARGUMENTS','Select both installed DL toolchain and private worker directory');
    if(f.has('--shacl-toolchain')!==f.has('--shacl-work-root'))fail('INVALID_ARGUMENTS','Select both installed SHACL toolchain and private worker directory');
    if(f.has('--systemd-digest')&&!f.has('--dl-toolchain')&&!f.has('--shacl-toolchain'))fail('INVALID_ARGUMENTS','Isolation selection requires a formal executor');
    const systemd=selectedSystemd(f);
    const validation=f.has('--shacl-toolchain')?{toolchainFile:f.get('--shacl-toolchain')!,workRoot:f.get('--shacl-work-root')!,...(systemd?{systemd}:{})}:undefined;
    const reasoning=f.has('--dl-toolchain')?{toolchainFile:f.get('--dl-toolchain')!,workRoot:f.get('--dl-work-root')!,...(systemd?{systemd}:{})}:undefined;
    const server=await listenStandalone({root:f.get('--root')!,workspaceId:f.get('--workspace')!,serviceId:f.get('--service')!,port:f.has('--port')?integer(f.get('--port')!):0,reasoning,validation});
    emit({status:'LISTENING',origin:server.origin,mcpUrl:server.origin+'/mcp',identity:{...server.identity},implementationStage:'P3_IMPLEMENTATION'});
    await new Promise<void>(resolve=>{const stop=()=>{process.off('SIGTERM',stop);process.off('SIGINT',stop);resolve();};process.once('SIGTERM',stop);process.once('SIGINT',stop);});
    await server.close();return;
  }
  const write=command==='write';
  if(!['context','read','write'].includes(command))fail('INVALID_ARGUMENTS',usage);
  const f=flags(args,['--connection',...(command==='context'?[]:['--operation']),...(write?['--request-id','--expected-revision']:[])],command==='context'?[]:['--input']);
  const connection=readConnection(f.get('--connection')!);
  const operation=command==='context'?'service.inspect':f.get('--operation')!;
  if(!(write?WRITE_OPERATIONS:READ_OPERATIONS).includes(operation))fail('UNSUPPORTED_OPERATION','Operation does not belong to selected read/write mode');
  let input: Json={};
  if(f.has('--input')){
    const bytes=readInput(f.get('--input')!);
    const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));json(value);object(value);input=value;
  }
  const request:ServiceRequest={workspaceId:connection.workspaceId,serviceId:connection.serviceId,projectId:connection.projectId,operation,input};
  if(write){request.requestId=f.get('--request-id');request.expectedRevision=integer(f.get('--expected-revision')!);}
  emit(await sendRequest(connection,request,write));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
  main(process.argv.slice(2),result=>process.stdout.write(JSON.stringify({ok:true,result})+'\n')).catch(e=>{
    const error=e instanceof ServiceError?{code:e.code,message:e.message}:e&&typeof e==='object'&&e.code==='ENOSPC'?{code:'STORAGE_FULL',message:'Local storage is full; inspect retained operation state and available space before selecting recovery.'}:{code:'LOCAL_FAILURE',message:'Inspect selected paths and service state; no implicit repair or redispatch'};
    process.stdout.write(JSON.stringify({ok:false,error})+'\n');process.exitCode=1;
  });
}
