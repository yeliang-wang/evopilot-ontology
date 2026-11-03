import type {DatabaseSync} from 'node:sqlite';
import {createDLRunner,DL_JVM_ARGUMENTS} from '../reasoning/runner.js';
import {validateDLRequest} from '../reasoning/request.js';
import {DL_LIMITS} from '../reasoning/types.js';
import type {DLRequest,DLResponse} from '../reasoning/types.js';
import {modelStore} from './model-store.js';
import {exact,id,digest,hash,canonical} from '../standalone/validation.js';
import {fail,ServiceError} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

export interface ReasoningConfiguration {toolchainFile:string;workRoot:string;}
export const TASK_TABLES=`
 CREATE TABLE native_reasoning_tasks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,asset_id TEXT NOT NULL,model_digest TEXT NOT NULL,principal_id TEXT NOT NULL,request_id TEXT NOT NULL,state TEXT NOT NULL,request TEXT NOT NULL,request_digest TEXT NOT NULL,closure_digest TEXT NOT NULL,configuration_digest TEXT NOT NULL,toolchain_digest TEXT NOT NULL,timeout_ms INTEGER NOT NULL,result TEXT,result_digest TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(project_id,asset_id,model_digest) REFERENCES native_models(project_id,asset_id,digest));
 CREATE TABLE native_reasoning_events(sequence INTEGER PRIMARY KEY,task_id TEXT NOT NULL,event TEXT NOT NULL,document TEXT NOT NULL,digest TEXT NOT NULL,recorded_at TEXT NOT NULL,FOREIGN KEY(task_id) REFERENCES native_reasoning_tasks(id));
`;
type Row=Record<string,unknown>;
export function reasoningTasks(db:DatabaseSync,guard:()=>void,configuration?:ReasoningConfiguration){
  const models=modelStore(db),runner=configuration?createDLRunner(configuration):null;
  let active:{id:string;controller:AbortController;done:Promise<void>}|null=null,closing=false,fault:string|null=null;
  const now=()=>new Date().toISOString();
  const tx=<T>(fn:()=>T):T=>{guard();db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}};
  const requireTransaction=()=>{if(!db.isTransaction)fail('TRANSACTION_REQUIRED','Task mutation requires owner transaction');};
  function event(taskId:string,kind:string,detail:Json):void{
    const last=db.prepare('SELECT digest FROM native_reasoning_events WHERE task_id=? ORDER BY sequence DESC LIMIT 1').get(taskId);
    const document={taskId,kind,detail,previousDigest:last?String(last.digest):null,recordedAt:now()};
    db.prepare('INSERT INTO native_reasoning_events(task_id,event,document,digest,recorded_at) VALUES(?,?,?,?,?)').run(taskId,kind,canonical(document),hash(document),document.recordedAt);
  }
  function row(projectId:string,taskId:string):Row {
    id(taskId);const r=db.prepare('SELECT * FROM native_reasoning_tasks WHERE id=? AND project_id=?').get(taskId,projectId);
    if(!r)fail('NOT_FOUND','Task is absent in selected project',404);return r;
  }
  function failure(r:Row,status:'FAILED'|'CANCELLED',code:string,message:string):DLResponse {
    return {schema:'ontology-dl-result/v1',requestId:String(r.id),requestDigest:String(r.request_digest),closureDigest:String(r.closure_digest),configurationDigest:String(r.configuration_digest),toolchainDigest:String(r.toolchain_digest),status,complete:false,elapsedMs:0,result:{},error:{code,message}};
  }
  function finish(r:Row,result:DLResponse):void {
    requireTransaction();
    if(result.requestId!==r.id||result.requestDigest!==r.request_digest||result.closureDigest!==r.closure_digest||result.configurationDigest!==r.configuration_digest||result.toolchainDigest!==r.toolchain_digest)fail('TASK_RESULT_MISMATCH','Formal result differs from its authorized task');
    const encoded=canonical(result as unknown as Json),resultDigest=hash(result as unknown as Json);
    db.prepare("UPDATE native_reasoning_tasks SET state='FINISHED',result=?,result_digest=?,updated_at=? WHERE id=?").run(encoded,resultDigest,now(),String(r.id));
    event(String(r.id),'FINISHED',{status:result.status,complete:result.complete,resultDigest});
  }
  // An interrupted process cannot establish whether its child exited. Retain an
  // explicit recovery barrier; startup never redispatches or guesses a PID to kill.
  tx(()=>{
    const interrupted=db.prepare("SELECT id,state FROM native_reasoning_tasks WHERE state IN ('QUEUED','RUNNING','CANCEL_REQUESTED')").all();
    for(const r of interrupted){db.prepare("UPDATE native_reasoning_tasks SET state='INTERRUPTED',updated_at=? WHERE id=?").run(now(),String(r.id));event(String(r.id),'INTERRUPTED',{previousState:String(r.state),automaticRedispatch:false});}
  });
  function start(projectId:string,principalId:string,requestId:string,input:unknown):Json {
    requireTransaction();if(closing||fault)fail('TASK_SERVICE_UNAVAILABLE','Inspect task persistence or service shutdown',503);
    if(!runner)fail('TOOLCHAIN_NOT_READY','Operator must configure an installed DL executor',409);
    exact(input,['assetId','modelDigest','task'],['timeoutMs']);id(input.assetId);digest(input.modelDigest);
    const model=models.load(projectId,input.assetId,input.modelDigest);if(!models.current(projectId,model))fail('STALE_MODEL','Reasoning start requires the current model/source/intent binding',409);
    if(db.prepare("SELECT id FROM native_reasoning_tasks WHERE state IN ('QUEUED','RUNNING','CANCEL_REQUESTED','INTERRUPTED') LIMIT 1").get())fail('REASONER_BUSY','An active or interrupted task must be reconciled first',409);
    const taskId='dl-'+hash({projectId,principalId,requestId}).slice(7),request={schema:'ontology-dl-request/v1',requestId:taskId,closure:structuredClone(model.draft.closure),task:input.task};validateDLRequest(request);
    const maximum=request.task.kind==='explanation'?DL_LIMITS.explanationMs:DL_LIMITS.taskMs,timeoutMs=input.timeoutMs??maximum;
    if(!Number.isSafeInteger(timeoutMs)||(timeoutMs as number)<1||(timeoutMs as number)>maximum)fail('INVALID_INPUT','Task deadline exceeds its fixed envelope');
    const configurationDigest=hash({timeoutMs:timeoutMs as number,jvm:[...DL_JVM_ARGUMENTS],limits:{...DL_LIMITS}}),created=now(),requestDigest=hash(request as unknown as Json);
    db.prepare('INSERT INTO native_reasoning_tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)').run(taskId,projectId,input.assetId,input.modelDigest,principalId,requestId,'QUEUED',canonical(request as unknown as Json),requestDigest,model.closureDigest,configurationDigest,runner.toolchainDigest,timeoutMs as number,created,created);
    event(taskId,'QUEUED',{projectId,assetId:input.assetId,modelDigest:input.modelDigest,requestDigest,closureDigest:model.closureDigest,configurationDigest,toolchainDigest:runner.toolchainDigest});
    return {taskId,state:'QUEUED',modelDigest:input.modelDigest,closureDigest:model.closureDigest,configurationDigest,toolchainDigest:runner.toolchainDigest,authority:false};
  }
  async function execute(r:Row,controller:AbortController):Promise<void>{
    let result:DLResponse;
    try{
      const request=JSON.parse(String(r.request));if(hash(request)!==r.request_digest)fail('CORRUPT_STATE','Task request changed before execution');
      result=await runner!.run(request,{timeoutMs:Number(r.timeout_ms),signal:controller.signal});
    }
    catch(e){result=failure(r,'FAILED',e instanceof ServiceError?e.code:'EXECUTOR_FAILURE','Configured executor failed before establishing a formal result');}
    tx(()=>finish(r,result));
  }
  function kick(taskId:string):void {
    queueMicrotask(()=>{
      if(closing||active||fault)return;
      try{
        const r=tx(()=>{
          const r=db.prepare('SELECT * FROM native_reasoning_tasks WHERE id=?').get(taskId);
          if(!r||r.state!=='QUEUED')return null;
          db.prepare("UPDATE native_reasoning_tasks SET state='RUNNING',updated_at=? WHERE id=?").run(now(),taskId);event(taskId,'RUNNING',{automaticRetry:false});return r;
        });
        if(!r)return;
        const controller=new AbortController();
        const done=execute(r,controller).catch(()=>{fault='TASK_PERSISTENCE_FAILURE';}).finally(()=>{active=null;});
        active={id:taskId,controller,done};
      }catch{fault='TASK_PERSISTENCE_FAILURE';}
    });
  }
  function cancel(projectId:string,input:unknown):Json {
    requireTransaction();exact(input,['taskId']);id(input.taskId);const r=row(projectId,input.taskId);
    if(r.state==='INTERRUPTED')fail('TASK_RECOVERY_REQUIRED','Process exit is unverified; operator recovery is required',409);
    if(r.state==='QUEUED')finish(r,failure(r,'CANCELLED','CANCELLED_BEFORE_START','Cancelled before dispatch'));
    else if(r.state==='RUNNING'||r.state==='CANCEL_REQUESTED'){
      if(active?.id!==r.id)fail('TASK_RECOVERY_REQUIRED','No matching live owner task',409);
      db.prepare("UPDATE native_reasoning_tasks SET state='CANCEL_REQUESTED',updated_at=? WHERE id=?").run(now(),String(r.id));event(String(r.id),'CANCEL_REQUESTED',{confirmedExit:false});
    }
    return {taskId:input.taskId,state:r.state==='QUEUED'?'FINISHED':r.state==='FINISHED'?'FINISHED':'CANCEL_REQUESTED',authority:false};
  }
  function abort(taskId:string):void {if(active?.id===taskId)active.controller.abort();}
  function read(projectId:string,input:unknown):Json {
    exact(input,['taskId']);id(input.taskId);const r=row(projectId,input.taskId),model=models.load(projectId,String(r.asset_id),String(r.model_digest));
    const result=r.result===null?null:JSON.parse(String(r.result));
    if(result&&hash(result)!==r.result_digest)fail('CORRUPT_STATE','Task result differs from its digest',409);
    const events=db.prepare('SELECT sequence,event,digest,recorded_at FROM native_reasoning_events WHERE task_id=? ORDER BY sequence DESC LIMIT 100').all(String(r.id)).reverse();
    const eventCount=Number(db.prepare('SELECT count(*) AS n FROM native_reasoning_events WHERE task_id=?').get(String(r.id))!.n);
    return {taskId:String(r.id),assetId:String(r.asset_id),modelDigest:String(r.model_digest),state:String(r.state),requestDigest:String(r.request_digest),closureDigest:String(r.closure_digest),configurationDigest:String(r.configuration_digest),toolchainDigest:String(r.toolchain_digest),
      current:models.current(projectId,model),configuredToolchainMatches:runner?.toolchainDigest===r.toolchain_digest,resultDigest:r.result_digest===null?null:String(r.result_digest),
      formalStatus:result?.status??null,complete:r.state==='FINISHED'&&(result?.complete??false),result:result&&Buffer.byteLength(String(r.result))<=256*1024?result:null,resultBytes:r.result===null?0:Buffer.byteLength(String(r.result)),events:events.map(e=>({sequence:Number(e.sequence),event:String(e.event),digest:String(e.digest),recordedAt:String(e.recorded_at)})),eventsComplete:eventCount===events.length,eventCount,serviceFault:fault,authority:false};
  }
  function resultRead(projectId:string,input:unknown):Json {
    exact(input,['taskId','offset','maxBytes']);id(input.taskId);
    if(!Number.isSafeInteger(input.offset)||(input.offset as number)<0||!Number.isSafeInteger(input.maxBytes)||(input.maxBytes as number)<4||(input.maxBytes as number)>65536)fail('INVALID_INPUT','Bounded UTF-8 result page required');
    const r=row(projectId,input.taskId);if(r.result===null)fail('RESULT_NOT_READY','Formal result has not been retained',409);
    const parsed=JSON.parse(String(r.result));if(hash(parsed)!==r.result_digest)fail('CORRUPT_STATE','Task result changed',409);
    const bytes=Buffer.from(String(r.result)),start=input.offset as number;
    if(start>bytes.length||start<bytes.length&&(bytes[start]&0xC0)===0x80)fail('INVALID_INPUT','Result offset must be a UTF-8 boundary');
    let end=Math.min(bytes.length,start+(input.maxBytes as number));while(end<bytes.length&&(bytes[end]&0xC0)===0x80)end--;
    return {taskId:String(r.id),resultDigest:String(r.result_digest),content:bytes.subarray(start,end).toString('utf8'),offset:start,nextOffset:end===bytes.length?null:end,complete:end===bytes.length,authority:false};
  }
  function shutdown():Promise<void>|undefined {
    closing=true;
    if(active){active.controller.abort();return active.done;}
    // Closing idle handles does not need to write state. In particular, still
    // release the database/lease if its directory was removed or substituted.
    if(!db.prepare("SELECT id FROM native_reasoning_tasks WHERE state='QUEUED' LIMIT 1").get())return undefined;
    tx(()=>{for(const r of db.prepare("SELECT * FROM native_reasoning_tasks WHERE state='QUEUED'").all())finish(r,failure(r,'CANCELLED','SERVICE_STOPPED','Service stopped before dispatch'));});
    return undefined;
  }
  return {start,kick,cancel,abort,read,resultRead,shutdown,configured:runner!==null,toolchainDigest:runner?.toolchainDigest??null};
}
