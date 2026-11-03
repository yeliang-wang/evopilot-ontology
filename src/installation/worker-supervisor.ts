import {spawn} from 'node:child_process';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {realpathSync} from 'node:fs';
import {hashBytes} from '../standalone/validation.js';
import {readWorkerAttempt,recordWorkerEvidence} from './worker-journal.js';
import type {WorkerReference,WorkerOutcome} from './worker-journal.js';

/** Internal installed entry. It owns the actual child handle and its deadline;
 * parent loss cancels that child without trusting a cached PID from a file. */
export function supervise(reference:WorkerReference):void {
  const attempt=readWorkerAttempt(reference),plan=attempt.intent;
  if(attempt.supervisor||attempt.worker||attempt.outcome)throw Error('Worker attempt already started');
  recordWorkerEvidence(reference,'supervisor',{pid:process.pid,recordedAt:new Date().toISOString()});
  let child:ChildProcessWithoutNullStreams|null=null,reason:WorkerOutcome['reason']=null,finished=false,inputBytes=0,outputBytes=0,errorBytes=0;
  const input:Buffer[]=[],output:Buffer[]=[],errors:Buffer[]=[];
  const finish=(code:number|null,signal:NodeJS.Signals|null)=>{
    if(finished)return;finished=true;clearTimeout(timer);process.stdin.pause();
    const stdout=Buffer.concat(output),stderr=Buffer.concat(errors),worker=readWorkerAttempt(reference).worker;
    try{if(child?.pid&&!worker)throw Error('Missing spawned worker identity');recordWorkerEvidence(reference,'outcome',{state:worker?'EXITED':'NOT_STARTED',reason,workerPid:worker?.pid??null,exitCode:code,signal,stdoutDigest:hashBytes(stdout),stderrDigest:hashBytes(stderr),stdoutBytes:outputBytes,stderrBytes:errorBytes,recordedAt:new Date().toISOString()});}
    catch{process.exitCode=1;}
    process.stdout.write(stdout,()=>process.stderr.write(stderr,()=>{if(process.connected)process.disconnect();}));
  };
  const stop=(why:NonNullable<WorkerOutcome['reason']>)=>{
    if(finished||reason)return;reason=why;
    if(child)child.kill('SIGKILL');else finish(null,null);
  };
  const timer=setTimeout(()=>stop('TASK_DEADLINE'),plan.timeoutMs);
  process.stdout.on('error',()=>{});process.stderr.on('error',()=>{});process.stdin.on('error',()=>stop('INPUT_INVALID'));
  process.on('disconnect',()=>stop('OWNER_LOST'));
  process.on('message',message=>{
    if(message&&typeof message==='object'&&'type' in message&&message.type==='cancel'&&'intentDigest' in message&&message.intentDigest===reference.intentDigest){stop('reason' in message&&message.reason==='TASK_DEADLINE'?'TASK_DEADLINE':'CANCELLED');}
  });
  // A disconnected parent cannot authorize a delayed launch after recovery.
  if(!process.connected){stop('OWNER_LOST');return;}
  process.stdin.on('data',(bytes:Buffer)=>{inputBytes+=bytes.length;if(inputBytes>plan.stdinBytes)stop('INPUT_INVALID');else input.push(bytes);});
  process.stdin.once('end',()=>{
    if(finished||reason)return;const bytes=Buffer.concat(input);
    if(bytes.length!==plan.stdinBytes||hashBytes(bytes)!==plan.stdinDigest){stop('INPUT_INVALID');return;}
    child=spawn(plan.executable,plan.args,{cwd:reference.root,shell:false,stdio:['pipe','pipe','pipe'],env:plan.env});
    child.stdin.on('error',()=>{});
    child.on('error',()=>{if(!reason)reason='SPAWN_FAILED';});
    child.once('spawn',()=>{
      try{
        recordWorkerEvidence(reference,'worker',{pid:child!.pid!,recordedAt:new Date().toISOString()});
        if(reason||!process.connected){if(!reason)reason='OWNER_LOST';child!.kill('SIGKILL');return;}
        child!.stdin.end(bytes);
      }catch{reason='INPUT_INVALID';child!.kill('SIGKILL');}
    });
    child.stdout.on('data',(bytes:Buffer)=>{outputBytes+=bytes.length;if(outputBytes>plan.outputBytes)stop('OUTPUT_LIMIT');else output.push(bytes);});
    child.stderr.on('data',(bytes:Buffer)=>{errorBytes+=bytes.length;if(errorBytes>plan.diagnosticBytes)stop('DIAGNOSTIC_LIMIT');else errors.push(bytes);});
    child.once('close',(code,signal)=>finish(code,signal));
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
  try{if(process.argv.length!==3||!process.connected)throw Error('Private supervised entry required');supervise(JSON.parse(process.argv[2]));}
  catch{process.stderr.write('Owned worker supervision failed; inspect retained attempt\n');process.exitCode=1;if(process.connected)process.disconnect();}
}
