#!/usr/bin/env node
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { constants, openSync, closeSync, readSync, fstatSync, realpathSync } from 'node:fs';
import { grantReviewer,revokeReviewer } from '../installation/reviewer.js';
import {inspectSystemdBinding} from '../installation/systemd-binding.js';
import {inspectInstallationTaskRecovery,reconcileInstallationTask} from '../installation/task-recovery.js';
import {inspectInstallationWorkerRotation,rotateInstallationWorkerJournal} from '../installation/worker-rotation.js';
import {inspectInstallationWorkerMaintenance,maintainInstallationWorkers} from '../installation/worker-maintenance.js';
import { initializeWorkspace } from '../installation/workspace.js';
import { inspectRuntime } from '../installation/runtime.js';
import { prepareInstallation,inspectInstallation,startInstallation,stopInstallation,bindInstallationToolchains,inspectInstallationToolchains } from '../installation/manager.js';
import { listenStandalone } from './http.js';
import { readConnection, sendRequest } from './client.js';
import { READ_OPERATIONS, WRITE_OPERATIONS } from './service.js';
import { json, object } from './validation.js';
import { LIMITS, ServiceError, fail } from './types.js';
import type { Json, ServiceRequest } from './types.js';

const usage='evopilot-ontology worker-rotation-inspect --installation ABS [--request-id ID] --json | worker-rotation-apply --installation ABS --request-id ID --expected-report SHA256 --json | worker-maintenance-inspect --installation ABS --project ID --task ID --json | worker-maintenance-apply --installation ABS --project ID --task ID --request-id ID --expected-report SHA256 --json | worker-isolation-inspect --json | task-recovery-inspect --installation ABS --project ID --task ID --json | task-reconcile --installation ABS --project ID --task ID --request-id ID --expected-report SHA256 --json | toolchains-bind --installation ABS --request-id ID --previous-binding none|SHA256 --dl-toolchain ABS --dl-digest SHA256 --shacl-toolchain ABS --shacl-digest SHA256 [--systemd-digest SHA256] --json | toolchains-inspect --installation ABS --json | reviewer-grant --root ABS --workspace ID --service ID --project ID --principal ID --grant-id ID --expires-at UTC --json | reviewer-revoke --root ABS --workspace ID --service ID --grant-id ID --json | runtime-inspect --runtime-root ABS --json | install --root ABS --workspace-root ABS --workspace ID --project ID --principal ID --runtime-root ABS --runtime-digest SHA256 --mode create|attach [--service ID --port N] --json | installation-inspect|start|stop --installation ABS --json | init --root ABS --workspace ID --project ID --principal ID --json | serve --root ABS --workspace ID --service ID [--port N] [--dl-toolchain ABS --dl-work-root ABS] [--shacl-toolchain ABS --shacl-work-root ABS] [--systemd-digest SHA256] --json | context --connection ABS --json | read|write --connection ABS --operation NAME [--input ABS_JSON] [--request-id ID --expected-revision N] --json';
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
function readInput(path:string):Buffer{
  if(!isAbsolute(path))fail('UNSAFE_PATH','Absolute input file required');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const stat=fstatSync(fd);if(!stat.isFile())fail('UNSAFE_PATH','Regular input file required');
    if(stat.size>LIMITS.requestBytes)fail('INPUT_LIMIT','Input exceeds byte budget',413);
    const buffer=Buffer.alloc(LIMITS.requestBytes+1);let offset=0;
    while(offset<buffer.length){const n=readSync(fd,buffer,offset,buffer.length-offset,null);if(n===0)break;offset+=n;}
    if(offset>LIMITS.requestBytes)fail('INPUT_LIMIT','Input exceeds byte budget',413);
    return buffer.subarray(0,offset);
  }finally{closeSync(fd);}
}
function selectedSystemd(flags:Map<string,string>){
  const expected=flags.get('--systemd-digest');if(expected===undefined)return undefined;
  const binding=inspectSystemdBinding();if(binding.digest!==expected)fail('WORKER_ISOLATION_DRIFT','Selected systemd identity changed; inspect the operator binding again',409);
  return binding;
}
export async function main(argv: string[],emit:(value:Json)=>void):Promise<void>{
  const [command,...args]=argv;
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
    emit({...result,runtime:{...result.runtime}});return;
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
    const error=e instanceof ServiceError?{code:e.code,message:e.message}:{code:'LOCAL_FAILURE',message:'Inspect selected paths and service state; no implicit repair or redispatch'};
    process.stdout.write(JSON.stringify({ok:false,error})+'\n');process.exitCode=1;
  });
}
