import type {WorkspaceStore} from '../standalone/workspace.js';
import type {Json} from '../standalone/types.js';
import {ServiceError,fail} from '../standalone/types.js';
import {hash,id,digest,canonical,exact} from '../standalone/validation.js';
import {readWorkerAttempt,taskWorkerReferences,sealWorkerNotStarted,WORKER_PROTOCOL,ISOLATED_WORKER_PROTOCOL} from '../installation/worker-journal.js';
import type {WorkerReference} from '../installation/worker-journal.js';
import {inspectSystemdTermination,reconcileSystemdWorker} from '../installation/systemd-worker.js';
import {shaclIdentities} from './shacl-request.js';
import type {ValidationPlan} from './validation-runner.js';

type Row=Record<string,unknown>;
type EvidenceStore=Pick<WorkspaceStore,'db'|'identity'|'guard'>;
const sha=(value:unknown)=>hash(value as Json);
function row(store:EvidenceStore,projectId:string,taskId:string):Row {
  id(projectId);id(taskId);store.guard();const r=store.db.prepare('SELECT * FROM native_reasoning_tasks WHERE project_id=? AND id=?').get(projectId,taskId);
  if(!r)fail('NOT_FOUND','Formal task is absent in selected project',404);return r;
}
function events(store:EvidenceStore,taskId:string):{kind:string;detail:unknown;digest:string}[]{
  const rows=store.db.prepare('SELECT * FROM native_reasoning_events WHERE task_id=? ORDER BY sequence LIMIT 1025').all(taskId);
  if(!rows.length||rows.length>1024)fail('RECOVERY_EVIDENCE_INVALID','Task event history is missing or exceeds its budget',409);
  let previous:string|null=null;
  return rows.map(r=>{
    const document:unknown=JSON.parse(String(r.document));exact(document,['taskId','kind','detail','previousDigest','recordedAt']);
    if(document.taskId!==taskId||document.kind!==r.event||document.previousDigest!==previous||sha(document)!==r.digest)fail('RECOVERY_EVIDENCE_INVALID','Task event identity or chain differs',409);
    previous=String(r.digest);return {kind:String(r.event),detail:document.detail,digest:previous};
  });
}
function reportFor(store:EvidenceStore,r:Row,roots:string[]){
  const history=events(store,String(r.id)),queued=history[0],blockers:string[]=[],attempts:Json[]=[];
  if(queued.kind!=='QUEUED'||!queued.detail||typeof queued.detail!=='object'||Array.isArray(queued.detail))fail('RECOVERY_EVIDENCE_INVALID','Initial queue identity is missing',409);
  const q=queued.detail as Row;
  for(const [key,column] of [['kind','task_kind'],['projectId','project_id'],['assetId','asset_id'],['modelDigest','model_digest'],['expectationsDigest','expectations_digest'],['requestDigest','request_digest'],['configurationDigest','configuration_digest'],['closureDigest','closure_digest'],['toolchainDigest','toolchain_digest']])if(q[key]!==r[column])fail('RECOVERY_EVIDENCE_INVALID','Task differs from original queued identity',409);
  if(sha(JSON.parse(String(r.request)))!==r.request_digest)fail('RECOVERY_EVIDENCE_INVALID','Original task request changed',409);
  if(r.state!=='FINISHED'&&(r.result!==null||r.result_digest!==null||history.some(e=>e.kind==='FINISHED'||e.kind==='OPERATOR_RECOVERED')))fail('RECOVERY_EVIDENCE_INVALID','An unfinished state cannot overwrite retained terminal evidence',409);
  if(r.state==='FINISHED'&&(r.result===null||sha(JSON.parse(String(r.result)))!==r.result_digest))fail('RECOVERY_EVIDENCE_INVALID','Retained terminal result is missing or changed',409);
  const isolated=q.workerProtocol===ISOLATED_WORKER_PROTOCOL;
  if(q.workerProtocol!==WORKER_PROTOCOL&&!isolated)blockers.push('LEGACY_WORKER_EXIT_UNPROVEN');
  if(isolated)digest(q.workerIsolationDigest);
  if(!['QUEUED','RUNNING','CANCEL_REQUESTED','INTERRUPTED'].includes(String(r.state)))blockers.push('TASK_ALREADY_FINISHED');
  const seen=new Set<string>(),references:WorkerReference[]=[],tracked=new Set<string>();
  for(const e of history.filter(e=>e.kind==='WORKER_ATTEMPT')){
    exact(e.detail,['root','journalId','attemptId','intentDigest']);const reference=e.detail as unknown as WorkerReference;
    if(!roots.includes(reference.root)||seen.has(reference.attemptId))fail('RECOVERY_EVIDENCE_INVALID','Foreign or repeated worker attempt',409);seen.add(reference.attemptId);
    references.push(reference);tracked.add(reference.attemptId);
  }
  for(const root of roots){
    for(const reference of taskWorkerReferences(root,String(r.id)))if(!seen.has(reference.attemptId)){references.push(reference);seen.add(reference.attemptId);}
  }
  for(const reference of references.sort((a,b)=>a.attemptId.localeCompare(b.attemptId))){
    try{
      const a=readWorkerAttempt(reference);
      if(a.intent.schema!==q.workerProtocol||isolated&&a.intent.systemd?.binding.digest!==q.workerIsolationDigest)fail('RECOVERY_EVIDENCE_INVALID','Worker isolation differs from its original queued identity',409);
      if(r.task_kind==='dl'?(a.intent.requestId!==r.id||a.intent.requestDigest!==r.request_digest||a.intent.configurationDigest!==r.configuration_digest||a.intent.toolchainDigest!==r.toolchain_digest):!a.intent.requestId.startsWith(String(r.id)+'-'))fail('RECOVERY_EVIDENCE_INVALID','Worker attempt belongs to another task',409);
      if(!a.supervisor&&!a.worker){
        // Stable before/after the no-launch fence, so a crash after fencing but
        // before the owner transaction commits can replay the same request.
        attempts.push({reference:{...reference},resolution:'VERIFY_NO_LAUNCH_FENCE'});
      }else{
        if(!tracked.has(reference.attemptId))blockers.push('UNTRACKED_WORKER');
        if(isolated){
          const terminal=inspectSystemdTermination(reference);
          if(!terminal)blockers.push('UNIT_TERMINATION_UNPROVEN');
          // Observation timestamps, nullable peak metrics and the subsequently
          // recorded group outcome are not the recovery plan identity. This
          // projection is stable if worker reconciliation commits before the
          // owner transaction and the operator then resumes the same request.
          const termination=terminal?{activeState:terminal.activeState,subState:terminal.subState,result:terminal.result,execMainPid:terminal.execMainPid,execMainCode:terminal.execMainCode,execMainStatus:terminal.execMainStatus,mainPid:terminal.mainPid,empty:terminal.empty}:null;
          attempts.push({reference:{...reference},resolution:'VERIFY_UNIT_TERMINATION',unitDigest:sha(a.unit as unknown as Json),termination,supervisorPid:a.supervisor?.pid??null,workerPid:a.worker?.pid??null});
        }else{
          if(!a.outcome)blockers.push('WORKER_EXIT_UNPROVEN');
          attempts.push({reference:{...reference},resolution:'VERIFY_EXIT',outcomeDigest:a.outcomeDigest,exitConfirmed:a.outcome!==null,supervisorPid:a.supervisor?.pid??null,workerPid:a.worker?.pid??null,outcome:a.outcome as unknown as Json});
        }
      }
    }catch(e){blockers.push(e instanceof ServiceError?e.code:'WORKER_EVIDENCE_UNAVAILABLE');attempts.push({reference:{...reference},exitConfirmed:false,outcomeDigest:null});}
  }
  return {schema:isolated?'ontology-task-recovery-report/v2':'ontology-task-recovery-report/v1',workspaceId:store.identity.workspaceId,serviceId:store.identity.serviceId,projectId:String(r.project_id),taskId:String(r.id),kind:String(r.task_kind),state:String(r.state),requestDigest:String(r.request_digest),configurationDigest:String(r.configuration_digest),toolchainDigest:String(r.toolchain_digest),lastEventDigest:history.at(-1)!.digest,workerProtocol:isolated?ISOLATED_WORKER_PROTOCOL:q.workerProtocol===WORKER_PROTOCOL?WORKER_PROTOCOL:null,attempts,blockers:[...new Set(blockers)].sort(),ready:blockers.length===0,formalResultRecovered:false,authority:false};
}
export function inspectTaskRecovery(store:WorkspaceStore,projectId:string,taskId:string,roots:string[]):Json {
  const report=reportFor(store,row(store,projectId,taskId),roots);store.guard();return {report,reportDigest:sha(report)};
}
/** Completed business evidence is read-only; cleanup never changes the result. */
export function completedTaskWorkerEvidence(store:EvidenceStore,projectId:string,taskId:string,roots:string[]) {
  const r=row(store,projectId,taskId),report=reportFor(store,r,roots),history=events(store,taskId),last=history.at(-1)!;
  if(r.state!=='FINISHED')fail('TASK_RECOVERY_REQUIRED','Resolve the original task before worker maintenance',409);
  if(last.kind!=='FINISHED'||(last.detail as Row)?.resultDigest!==r.result_digest||report.blockers.some(b=>b!=='TASK_ALREADY_FINISHED'))fail('RECOVERY_EVIDENCE_INVALID','Completed task and worker evidence do not establish cleanup eligibility',409);
  const references=report.attempts.map(item=>(item as unknown as {reference:WorkerReference}).reference);
  if(references.length>128)fail('WORKER_MAINTENANCE_LIMIT','Task attempt count exceeds maintenance budget',409);
  store.guard();return {workspaceId:store.identity.workspaceId,serviceId:store.identity.serviceId,projectId,taskId,resultDigest:String(r.result_digest),lastEventDigest:last.digest,references};
}
function append(store:WorkspaceStore,taskId:string,kind:string,detail:Json){
  const previous=store.db.prepare('SELECT digest FROM native_reasoning_events WHERE task_id=? ORDER BY sequence DESC LIMIT 1').get(taskId);
  const document={taskId,kind,detail,previousDigest:previous?String(previous.digest):null,recordedAt:new Date().toISOString()};
  store.db.prepare('INSERT INTO native_reasoning_events(task_id,event,document,digest,recorded_at) VALUES(?,?,?,?,?)').run(taskId,kind,canonical(document),sha(document),document.recordedAt);
}
export function reconcileTask(store:WorkspaceStore,input:{installationId:string;projectId:string;taskId:string;requestId:string;expectedReportDigest:string},roots:string[]):Json {
  id(input.installationId);id(input.requestId);digest(input.expectedReportDigest);row(store,input.projectId,input.taskId);
  const requestDigest=sha({installationId:input.installationId,workspaceId:store.identity.workspaceId,serviceId:store.identity.serviceId,projectId:input.projectId,taskId:input.taskId,expectedReportDigest:input.expectedReportDigest});
  store.db.exec('BEGIN IMMEDIATE');
  try{
    store.guard();
    const old=store.db.prepare("SELECT task_id,document FROM native_reasoning_events WHERE event='OPERATOR_RECOVERED' AND json_extract(document,'$.detail.receipt.requestId')=?").all(input.requestId);
    if(old.length){
      if(old.length!==1)fail('RECOVERY_EVIDENCE_INVALID','Recovery request has ambiguous receipts',409);
      const history=events(store,String(old[0].task_id)),saved=history.find(e=>e.kind==='OPERATOR_RECOVERED'&&(e.detail as {receipt?:{requestId:string}}).receipt?.requestId===input.requestId);
      const receipt=(saved?.detail as {receipt:Record<string,Json>})?.receipt;
      if(!receipt||receipt.requestDigest!==requestDigest)fail('REQUEST_CONFLICT','Recovery request ID belongs to different parameters',409);
      const current=row(store,input.projectId,input.taskId);
      if(current.state!=='FINISHED'||current.result===null||sha(JSON.parse(String(current.result)))!==current.result_digest||current.result_digest!==receipt.resultDigest)fail('RECOVERY_EVIDENCE_INVALID','Recovered task differs from its retained receipt',409);
      store.db.exec('COMMIT');return {receipt,replayed:true,authority:false};
    }
    const r=row(store,input.projectId,input.taskId),report=reportFor(store,r,roots),reportDigest=sha(report);
    if(reportDigest!==input.expectedReportDigest)fail('RECOVERY_CONFLICT','Recovery evidence changed; inspect the exact original task again',409);
    if(!report.ready)fail('TASK_RECOVERY_REQUIRED','Worker exit evidence is incomplete; the task remains blocked',409);
    const workerEvidence=report.attempts.map(item=>{
      const a=item as unknown as {reference:WorkerReference;resolution:string};
      if(a.resolution==='VERIFY_NO_LAUNCH_FENCE')sealWorkerNotStarted(a.reference);
      if(a.resolution==='VERIFY_UNIT_TERMINATION'&&!reconcileSystemdWorker(a.reference))fail('WORKER_EXIT_UNPROVEN','Unit termination remains unproven',409);
      const observed=readWorkerAttempt(a.reference);if(!observed.outcome)fail('WORKER_EXIT_UNPROVEN','Worker exit remains unproven',409);
      if(observed.unit&&!observed.terminal)fail('WORKER_EXIT_UNPROVEN','Original unit closure is missing',409);
      return {reference:{...a.reference},outcomeDigest:observed.outcomeDigest,...(observed.unit?{terminalDigest:observed.terminalDigest}:{})};
    });
    const base={requestId:String(r.id),requestDigest:String(r.request_digest),closureDigest:String(r.closure_digest),configurationDigest:String(r.configuration_digest),toolchainDigest:String(r.toolchain_digest),status:'FAILED',complete:false,elapsedMs:0,result:{recoveryReportDigest:reportDigest,workerEvidence},error:{code:'OWNER_INTERRUPTED',message:'Original owner execution was interrupted; worker exits or no-launch fences are confirmed, formal result is unavailable and no work was redispatched'}};
    const plan=r.task_kind==='validation'?JSON.parse(String(r.request)) as ValidationPlan:null;
    const result=plan?{schema:'ontology-validation-result/v2',...base,viewKind:plan.view.kind,viewDigest:shaclIdentities({schema:'ontology-shacl-request/v2',requestId:plan.requestId,modelDigest:plan.modelDigest,view:plan.view,shapes:plan.model.shapes,expectations:{digest:sha(plan.expectations.requiredShapes),requiredShapes:plan.expectations.requiredShapes}}).viewDigest,modelDigest:String(r.model_digest),expectationsDigest:String(r.expectations_digest)}:{schema:'ontology-dl-result/v1',...base};
    const resultDigest=sha(result),recordedAt=new Date().toISOString(),receipt={schema:'ontology-task-recovery-receipt/v1',installationId:input.installationId,workspaceId:store.identity.workspaceId,serviceId:store.identity.serviceId,projectId:input.projectId,taskId:input.taskId,requestId:input.requestId,requestDigest,reportDigest,resultDigest,recordedAt,authority:false};
    store.db.prepare("UPDATE native_reasoning_tasks SET state='FINISHED',result=?,result_digest=?,updated_at=? WHERE id=?").run(canonical(result as unknown as Json),resultDigest,recordedAt,input.taskId);
    append(store,input.taskId,'OPERATOR_RECOVERED',{receipt,report});append(store,input.taskId,'FINISHED',{status:'FAILED',complete:false,resultDigest});
    store.guard();store.db.exec('COMMIT');return {receipt,replayed:false,authority:false};
  }catch(e){if(store.db.isTransaction)store.db.exec('ROLLBACK');throw e;}
}
