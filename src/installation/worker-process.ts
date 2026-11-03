import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createWorkerAttempt,readWorkerAttempt,recordWorkerEvidence,WORKER_PROTOCOL} from './worker-journal.js';
import type {WorkerReference,WorkerPlan,WorkerOutcome} from './worker-journal.js';
import {hashBytes} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';

export interface WorkerObservation {beforeDispatch?:(reference:WorkerReference)=>void;}
export async function runOwnedWorker(options:Omit<WorkerPlan,'schema'|'stdinDigest'|'stdinBytes'>&WorkerObservation&{workRoot:string;input:string;signal?:AbortSignal}):Promise<{outcome:WorkerOutcome;stdout:Buffer;stderr:Buffer}> {
  const {workRoot,input,signal,beforeDispatch,...fields}=options;
  const intent:WorkerPlan={schema:WORKER_PROTOCOL,...fields,stdinDigest:hashBytes(input),stdinBytes:Buffer.byteLength(input)};
  const reference=createWorkerAttempt(workRoot,intent);
  const notStarted=(reason:WorkerOutcome['reason']):WorkerOutcome=>({state:'NOT_STARTED',reason,workerPid:null,exitCode:null,signal:null,stdoutDigest:hashBytes(''),stderrDigest:hashBytes(''),stdoutBytes:0,stderrBytes:0,recordedAt:new Date().toISOString()});
  try{beforeDispatch?.(reference);}catch(e){recordWorkerEvidence(reference,'outcome',notStarted('DISPATCH_REJECTED'));throw e;}
  if(signal?.aborted){const outcome=notStarted('CANCELLED');recordWorkerEvidence(reference,'outcome',outcome);return {outcome,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)};}
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('./worker-supervisor.js',import.meta.url)),JSON.stringify(reference)],{cwd:workRoot,detached:true,stdio:['pipe','pipe','pipe','ipc'],env:{PATH:'',LANG:'C.UTF-8',TZ:'UTC',NODE_OPTIONS:'',NODE_PATH:'',NODE_NO_WARNINGS:'1'}});
    let finished=false,spawned=false,bytes=0,errorBytes=0;const output:Buffer[]=[],errors:Buffer[]=[];
    const cancel=(reason:'CANCELLED'|'TASK_DEADLINE')=>{if(child.connected)child.send({type:'cancel',reason,intentDigest:reference.intentDigest},()=>{});};
    const abort=()=>cancel('CANCELLED');signal?.addEventListener('abort',abort,{once:true});
    const deadline=setTimeout(()=>cancel('TASK_DEADLINE'),intent.timeoutMs);
    const unknown=()=>{
      if(finished)return;finished=true;clearTimeout(deadline);clearTimeout(observation);signal?.removeEventListener('abort',abort);
      if(child.connected)child.disconnect();child.stdin!.destroy();child.stdout!.destroy();child.stderr!.destroy();child.unref();
      try{fail('WORKER_OUTCOME_UNKNOWN','Worker exit/result observation is incomplete; retain the original task and reconcile its attempt',409);}catch(e){reject(e);}
    };
    const observation=setTimeout(unknown,intent.timeoutMs+10000);
    child.once('spawn',()=>{spawned=true;if(signal?.aborted)abort();});
    child.stdin!.on('error',()=>{});child.on('error',()=>{});
    child.stdout!.on('data',(part:Buffer)=>{bytes+=part.length;if(bytes>intent.outputBytes)unknown();else output.push(part);});
    child.stderr!.on('data',(part:Buffer)=>{errorBytes+=part.length;if(errorBytes>intent.diagnosticBytes)unknown();else errors.push(part);});
    child.once('close',code=>{
      if(finished)return;
      try{
        if(!spawned&&!readWorkerAttempt(reference).outcome)recordWorkerEvidence(reference,'outcome',notStarted('SPAWN_FAILED'));
        const attempt=readWorkerAttempt(reference),stdout=Buffer.concat(output),stderr=Buffer.concat(errors);
        if(!attempt.outcome||spawned&&code!==0||hashBytes(stdout)!==attempt.outcome.stdoutDigest||hashBytes(stderr)!==attempt.outcome.stderrDigest){unknown();return;}
        finished=true;clearTimeout(deadline);clearTimeout(observation);signal?.removeEventListener('abort',abort);resolve({outcome:attempt.outcome,stdout,stderr});
      }catch{unknown();}
    });
    child.stdin!.end(input);
  });
}
