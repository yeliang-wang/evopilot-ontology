import {lstatSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {exact,id,digest,hash} from '../standalone/validation.js';
import type {Json} from '../standalone/types.js';
import {fail} from '../standalone/types.js';
import {requireFreshRecoveryRequest} from '../standalone/recovery.js';
import type {WorkspaceStore} from '../standalone/workspace.js';
import type {Installation} from './manager.js';
import {withStoppedWorkerInstallation} from './worker-operator.js';
import {workerMaintenanceRecords} from './worker-maintenance.js';
import {currentWorkerAttempts,prepareNextWorkerJournal,requireWorkerMaintenanceComplete} from './worker-journal.js';
import {ARCHIVE_LIMIT,readArchiveCatalog,writeArchiveCatalog,workerFilePresent,journalImage,verifyJournalImage,journalFilename,rotationRequestDigest} from './worker-archives.js';
import type {RotationPlan,RotationRecord,RotationReceipt,ArchiveCatalog} from './worker-archives.js';

interface Request {requestId:string;expectedReportDigest:string;}
const sha=(v:unknown)=>hash(v as Json);
function owner(i:Installation,r:RotationRecord):void {
  if(r.plan.installationId!==i.installationId||r.plan.workspaceId!==i.workspaceId||r.plan.serviceId!==i.serviceId)fail('WORKER_ARCHIVE_EVIDENCE','Rotation belongs to another installation',409);
}
function absent(path:string):boolean {try{lstatSync(path);return false;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return true;throw e;}}
function makePlan(i:Installation,store:WorkspaceStore,root:string):RotationPlan {
  requireWorkerMaintenanceComplete(root);const catalog=readArchiveCatalog(root);
  if((catalog?.archives.length??0)>=ARCHIVE_LIMIT)fail('WORKER_ARCHIVE_LIMIT','The bounded archive inventory is full; no historical evidence was deleted',409);
  const snapshot=currentWorkerAttempts(root),head={journalId:snapshot.journalId,file:catalog?.current.file??'worker-journal.sqlite'};
  if(!snapshot.attempts.length)fail('WORKER_ROTATION_EMPTY','The current journal contains no worker attempts',409);
  const records=workerMaintenanceRecords(i,root,undefined,snapshot.journalId);
  if(records.some(r=>!r.receipt))fail('WORKER_MAINTENANCE_PENDING','Complete worker maintenance before rotation',409);
  const cleaned=new Set(records.flatMap(r=>r.plan.entries.map(e=>sha(e.reference))));
  for(const a of snapshot.attempts){
    const ref=a.reference;
    if(!a.outcome)fail('WORKER_EXIT_UNPROVEN','Worker closure is required before archival',409);
    if(a.intent.systemd&&(!a.fence||a.unit&&!a.terminal||!a.unit&&a.outcome.state!=='NOT_STARTED'||!cleaned.has(sha(ref))||!absent(join(root,'unit-jobs',ref.attemptId))))fail('WORKER_ARCHIVE_RESOURCES','Complete selected-systemd cache/unit maintenance before archival',409);
  }
  store.guard();const source=journalImage(root,head);
  return {schema:'ontology-worker-rotation-plan/v1',installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,workRoot:root,source,attempts:snapshot.attempts.length,maintenanceRequests:records.length,archives:catalog?.archives.length??0};
}
export async function inspectInstallationWorkerRotation(path:string,requestId?:string):Promise<Json> {
  if(requestId!==undefined)id(requestId);
  return withStoppedWorkerInstallation(path,async(i,store,root):Promise<Json>=>{
    const c=readArchiveCatalog(root),saved=requestId===undefined?c?.pending:[...(c?.archives??[]),...(c?.pending?[c.pending]:[])].find(r=>r.requestId===requestId);
    if(saved){owner(i,saved);verifyJournalImage(root,saved.plan.source);return {status:saved.receipt?'COMPLETED':'PENDING',requestId:saved.requestId,report:saved.plan as unknown as Json,reportDigest:saved.planDigest,receipt:saved.receipt as unknown as Json,authority:false};}
    if(requestId!==undefined){requireFreshRecoveryRequest(store.identity,requestId);fail('WORKER_ROTATION_MISSING','Exact rotation request is not retained',404);}
    if(!c&&!workerFilePresent(join(root,'worker-journal.sqlite')))return {status:'NOT_NEEDED',requestId:null,report:null,reportDigest:null,receipt:null,authority:false};
    const plan=makePlan(i,store,root);return {status:'READY',requestId:null,report:plan as unknown as Json,reportDigest:sha(plan),receipt:null,authority:false};
  });
}
export async function rotateInstallationWorkerJournal(path:string,input:Request):Promise<Json> {
  exact(input,['requestId','expectedReportDigest']);id(input.requestId);digest(input.expectedReportDigest);
  return withStoppedWorkerInstallation(path,async(i,store,root):Promise<Json>=>{
    let c=readArchiveCatalog(root),saved=[...(c?.archives??[]),...(c?.pending?[c.pending]:[])].find(r=>r.requestId===input.requestId);
    if(saved){
      owner(i,saved);if(saved.planDigest!==input.expectedReportDigest)fail('REQUEST_CONFLICT','Rotation request ID binds different parameters',409);
      verifyJournalImage(root,saved.plan.source);
      if(saved.receipt)return {receipt:saved.receipt as unknown as Json,replayed:true,authority:false};
    }else{
      requireFreshRecoveryRequest(store.identity,input.requestId);
      const plan=makePlan(i,store,root),planDigest=sha(plan);
      if(planDigest!==input.expectedReportDigest)fail('WORKER_ROTATION_CONFLICT','Inspected journal evidence changed',409);
      const journalId=randomUUID(),next={journalId,file:journalFilename(journalId)};
      if(!absent(join(root,next.file)))fail('WORKER_ARCHIVE_EVIDENCE','Next journal path is already occupied',409);
      saved={requestId:input.requestId,requestDigest:rotationRequestDigest(plan),plan,planDigest,next,receipt:null};
      const pending:ArchiveCatalog={schema:'ontology-worker-archives/v1',root,current:{journalId:plan.source.journalId,file:plan.source.file},archives:c?.archives??[],pending:saved};
      store.guard();verifyJournalImage(root,plan.source);
      writeArchiveCatalog(root,pending,c!==null);c=readArchiveCatalog(root);
    }
    if(!c?.pending||sha(c.pending)!==sha(saved))fail('WORKER_ARCHIVE_EVIDENCE','Exact pending rotation disappeared',409);
    // The durable catalog intent blocks every new admission before this shard
    // exists. Its original identity is reused after a crash during creation.
    store.guard();verifyJournalImage(root,saved.plan.source);prepareNextWorkerJournal(root,saved.next);
    const receipt:RotationReceipt={schema:'ontology-worker-rotation-receipt/v1',requestId:input.requestId,requestDigest:saved.requestDigest,planDigest:saved.planDigest,archivedJournalId:saved.plan.source.journalId,activeJournalId:saved.next.journalId,archiveDigest:saved.plan.source.digest,archiveBytes:saved.plan.source.bytes,recordedAt:new Date().toISOString(),authority:false};
    store.guard();verifyJournalImage(root,saved.plan.source);
    const latest=readArchiveCatalog(root);if(sha(latest)!==sha(c))fail('WORKER_ARCHIVE_EVIDENCE','Archive catalog changed during rotation',409);
    const completed:ArchiveCatalog={...c,current:saved.next,archives:[...c.archives,{...saved,receipt}],pending:null};
    writeArchiveCatalog(root,completed,true);readArchiveCatalog(root);
    return {receipt:receipt as unknown as Json,replayed:false,authority:false};
  });
}
