import { timingSafeEqual } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { assertSeparate } from '../installation/files.js';
import { openWorkspace } from './workspace.js';
import {requireFreshRecoveryRequest,recoveryContext} from './recovery.js';
import { expertGuide } from '../expert/guide.js';
import { sourceStore } from '../native-v2/store.js';
import { expectationStore } from '../native-v2/expectations-store.js';
import { viewStore } from '../native-v2/view-store.js';
import { lifecycleStore } from '../native-v2/lifecycle-store.js';
import { explanationRead } from '../native-v2/explanations.js';
import { comparisonRead } from '../native-v2/comparison-store.js';
import { readDLToolchain,verifyDLToolchain } from '../reasoning/toolchain.js';
import { readSHACLToolchain,verifySHACLToolchain } from '../native-v2/shacl-toolchain.js';
import { modelStore } from '../native-v2/model-store.js';
import { reasoningTasks } from '../native-v2/tasks.js';
import type { ReasoningConfiguration } from '../native-v2/tasks.js';
import { LIMITS, fail } from './types.js';
import type { Json, Receipt, Project, Grant } from './types.js';
import { canonical, exact, hash, hashBytes, id, json, text, digest, validateIntent, validateRequest } from './validation.js';

export const READ_OPERATIONS = Object.freeze(['service.inspect','guide.read','project.list','project.inspect','intent.read','receipt.read','source.inspect','source.read','source.fragment.read','model.list','model.inspect','model.document.read','model.compare.read','reasoning.list','reasoning.inspect','reasoning.result.read','expectations.list','expectations.inspect','expectations.read','validation.list','validation.inspect','validation.result.read','view.list','view.inspect','view.read','view.query','explanation.read','review.list','review.inspect','review.report.read','delivery.list','delivery.inspect','delivery.export.read']);
export const WRITE_OPERATIONS = Object.freeze(['project.create','intent.record','source.admit','model.record','reasoning.start','reasoning.cancel','expectations.record','validation.start','validation.cancel','view.record','review.prepare','review.decide','delivery.record']);
export function createStandaloneService(options: {root: string; workspaceId: string; serviceId: string;reasoning?:ReasoningConfiguration;validation?:ReasoningConfiguration}) {
  const store=openWorkspace(options.root,options), {db,identity}=store;
  const sources=sourceStore(db);
  const models=modelStore(db),views=viewStore(db),expectations=expectationStore(db);
  let tasks:ReturnType<typeof reasoningTasks>;
  try{
    if(options.reasoning)assertSeparate(store.root,realpathSync(options.reasoning.workRoot));
    if(options.validation)assertSeparate(store.root,realpathSync(options.validation.workRoot));
    tasks=reasoningTasks(db,store.guard,options.reasoning,options.validation);
  }catch(e){store.close();throw e;}
  const lifecycle=lifecycleStore(db,identity,{dl:tasks.toolchainDigest,validation:tasks.validationToolchainDigest,verify:()=>{
    if(!options.reasoning||!options.validation)fail('TOOLCHAIN_NOT_READY','Review and delivery require configured formal toolchains',409);
    const dl=readDLToolchain(options.reasoning.toolchainFile),shacl=readSHACLToolchain(options.validation.toolchainFile);
    if(dl.digest!==tasks.toolchainDigest||hash({dl:dl.digest,shacl:shacl.digest})!==tasks.validationToolchainDigest)fail('STALE_TOOLCHAIN','Configured toolchain binding changed',409);
    verifyDLToolchain(dl);verifySHACLToolchain(shacl);
  }});
  const allowedWrites=(grant:Grant)=>WRITE_OPERATIONS.filter(operation=>grant.permissions.includes(operation==='review.decide'?'review':'write'));
  let closing=false,closed:Promise<void>|undefined;
  const project = (projectId: string): Project | null => {
    const row=db.prepare('SELECT id,label,revision,created_at FROM projects WHERE id=?').get(projectId);
    return row ? {projectId:String(row.id),label:String(row.label),revision:Number(row.revision),createdAt:String(row.created_at)} : null;
  };
  const credential = (token: string): Grant => {
    store.guard();
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail('UNAUTHENTICATED','Valid bearer credential required',401);
    const given=Buffer.from(hashBytes(token));
    const grant=store.credentials().grants.find(g=>timingSafeEqual(Buffer.from(g.tokenHash),given));
    if (!grant || grant.revoked || Date.parse(grant.expiresAt)<=Date.now()) fail('UNAUTHENTICATED','Invalid, expired or revoked credential',401);
    return grant;
  };
  const authenticate = (token: string, projectId: string, permission: Grant['permissions'][number]): Grant => {
    const grant=credential(token);
    if (!grant.projectIds.includes(projectId) || !grant.permissions.includes(permission)) fail('FORBIDDEN','Credential does not permit this project/operation',403);
    return grant;
  };
  const context = (token: string): Json => {
    const grant=credential(token);
    if (!grant.permissions.includes('read')) fail('FORBIDDEN','Read permission required for service discovery',403);
    return {product:'evopilot-ontology',developmentTarget:'0.9.0',implementationStage:'P3_IMPLEMENTATION',
      workspaceId:identity.workspaceId,serviceId:identity.serviceId,stateVersion:identity.stateVersion,
      ...(identity.schema==='ontology-workspace/v2'?{recovery:recoveryContext(identity)}:{}),
      principalId:grant.principalId,projectIds:[...grant.projectIds],permissions:[...grant.permissions],
      readOperations:[...READ_OPERATIONS],writeOperations:allowedWrites(grant),
      reasoningReady:false,nativeV2Ready:false,reasoningExecutionConfigured:tasks.configured,toolchainDigest:tasks.toolchainDigest,validationExecutionConfigured:tasks.validationConfigured,validationToolchainDigest:tasks.validationToolchainDigest,authority:false};
  };
  function request(value: unknown, token: string): Json {
    if(closing)fail('CLOSED','Service is closing',503);
    json(value); exact(value,['workspaceId','serviceId','projectId','operation','input'],['requestId','expectedRevision']);
    text(value.operation,96);
    const write=WRITE_OPERATIONS.includes(value.operation);
    validateRequest(value,write);
    store.guard();
    const grant=authenticate(token,value.projectId,value.operation==='review.decide'?'review':write?'write':'read');
    if (value.workspaceId!==identity.workspaceId || value.serviceId!==identity.serviceId) fail('IDENTITY_MISMATCH','Selected service/workspace differs from request',403);
    if (!write && !READ_OPERATIONS.includes(value.operation)) fail('UNSUPPORTED_OPERATION','Operation is not implemented',404);
    const {projectId,operation,input}=value;
    db.exec(write?'BEGIN IMMEDIATE':'BEGIN');
    try {
      const requestDigest=hash({workspaceId:identity.workspaceId,serviceId:identity.serviceId,projectId,operation,input});
      if (write) {
        const old=db.prepare('SELECT digest,receipt FROM receipts WHERE project_id=? AND principal_id=? AND request_id=?').get(projectId,grant.principalId,value.requestId!);
        if (old) {
          if (old.digest!==requestDigest) fail('REQUEST_CONFLICT','Request ID already binds different content',409);
          const receipt: Json=JSON.parse(String(old.receipt)); db.exec('COMMIT'); return receipt;
        }
        requireFreshRecoveryRequest(identity,value.requestId!);
      }
      const current=project(projectId);
      if (write && (current?.revision??0)!==value.expectedRevision) fail('REVISION_CONFLICT','Project revision changed',409);
      let result: Json;let afterCommit:(()=>void)|undefined;
      if (operation==='service.inspect') {
        exact(input,[]);
        result={product:'evopilot-ontology',developmentTarget:'0.9.0',implementationStage:'P3_IMPLEMENTATION',workspaceId:identity.workspaceId,serviceId:identity.serviceId,stateVersion:identity.stateVersion,...(identity.schema==='ontology-workspace/v2'?{recovery:recoveryContext(identity)}:{}),project:current as unknown as Json,readOperations:[...READ_OPERATIONS],writeOperations:allowedWrites(grant),reasoningReady:false,nativeV2Ready:false,reasoningExecutionConfigured:tasks.configured,toolchainDigest:tasks.toolchainDigest,validationExecutionConfigured:tasks.validationConfigured,validationToolchainDigest:tasks.validationToolchainDigest,authority:false};
      } else if (operation==='guide.read') {
        exact(input,['topic']);text(input.topic,96);result=expertGuide(input.topic);
      } else if (operation==='project.list') {
        exact(input,[]);
        result={projects:grant.projectIds.map(project).filter(p=>p!==null) as unknown as Json,complete:true};
      } else if (operation==='project.inspect') {
        exact(input,[]);
        if (!current) fail('NOT_FOUND','Project not initialized',404);
        const head=db.prepare('SELECT intent_digest FROM project_heads WHERE project_id=?').get(projectId);
        result={...current,intentDigest:head?.intent_digest===null?null:String(head?.intent_digest??''),sourceAdmission:sources.head(projectId),assetState:'DRAFT_AUTHORING',authority:false};
      } else if (operation==='project.create') {
        exact(input,['label']); text(input.label,200);
        if (current) fail('ALREADY_EXISTS','Project already exists; inspect retained state',409);
        if (Number(db.prepare('SELECT count(*) AS n FROM projects').get()!.n)>=LIMITS.projects) fail('STATE_LIMIT','Project budget reached',409);
        const createdAt=new Date().toISOString();
        db.prepare('INSERT INTO projects VALUES(?,?,0,?)').run(projectId,input.label,createdAt);
        db.prepare('INSERT INTO project_heads VALUES(?,NULL)').run(projectId);
        result={projectId,label:input.label,createdAt,visibility:'private',authority:false};
      } else if (operation==='intent.record') {
        if (!current) fail('NOT_FOUND','Project not initialized',404);
        exact(input,['definition','previousDigest']); validateIntent(input.definition);
        if (input.previousDigest!==null) digest(input.previousDigest);
        const head=db.prepare('SELECT intent_digest FROM project_heads WHERE project_id=?').get(projectId);
        if (!head || head.intent_digest!==input.previousDigest) fail('INTENT_CONFLICT','Modeling intent parent changed',409);
        const definition=input.definition as unknown as Json;
        const intentDigest=hash({definition,previousDigest:input.previousDigest});
        const row=db.prepare('SELECT digest FROM intents WHERE project_id=? AND digest=?').get(projectId,intentDigest);
        if (!row) db.prepare('INSERT INTO intents VALUES(?,?,?,?,?)').run(projectId,intentDigest,current.revision+1,canonical({definition,previousDigest:input.previousDigest}),new Date().toISOString());
        db.prepare('UPDATE project_heads SET intent_digest=? WHERE project_id=?').run(intentDigest,projectId);
        result={intentDigest,previousDigest:input.previousDigest,status:'DRAFT',sourceVerification:'NOT_EVALUATED',businessConfirmed:false,authority:false};
      } else if (operation==='intent.read') {
        exact(input,['digest']); digest(input.digest);
        const row=db.prepare('SELECT document,revision,created_at FROM intents WHERE project_id=? AND digest=?').get(projectId,input.digest);
        if (!row) fail('NOT_FOUND','Intent not found in selected project',404);
        result={digest:input.digest,...JSON.parse(String(row.document)),revision:Number(row.revision),createdAt:String(row.created_at),sourceVerification:'NOT_EVALUATED',businessConfirmed:false};
      } else if(operation.startsWith('reasoning.')||operation.startsWith('validation.')) {
        if(!current)fail('NOT_FOUND','Project not initialized',404);
        const kind=operation.startsWith('validation.')?'validation':'dl',action=operation.slice(operation.indexOf('.')+1);
        if(action==='start'){
          result=tasks.start(projectId,grant.principalId,value.requestId!,input,kind);
          const taskId=(result as {taskId:string}).taskId;afterCommit=()=>tasks.kick(taskId);
        }else if(action==='cancel'){
          result=tasks.cancel(projectId,input,kind);const taskId=(result as {taskId:string}).taskId;afterCommit=()=>tasks.abort(taskId);
        }else if(action==='inspect')result=tasks.read(projectId,input,kind);
        else if(action==='list')result=tasks.list(projectId,input,kind);
        else result=tasks.resultRead(projectId,input,kind);
      } else if(operation==='explanation.read') {
        if(!current)fail('NOT_FOUND','Project not initialized',404);result=explanationRead(db,projectId,input,tasks.toolchainDigest);
      } else if(operation.startsWith('review.')) {
        if(!current)fail('NOT_FOUND','Project not initialized',404);
        if(operation==='review.prepare')result=lifecycle.prepare(projectId,input,current.revision+1,new Date().toISOString());
        else if(operation==='review.decide')result=lifecycle.decide(projectId,grant,input,current.revision+1,new Date().toISOString());
        else if(operation==='review.inspect')result=lifecycle.inspect(projectId,input);
        else if(operation==='review.list')result=lifecycle.list(projectId,input,'review');
        else result=lifecycle.reportRead(projectId,input);
      } else if(operation.startsWith('delivery.')) {
        if(!current)fail('NOT_FOUND','Project not initialized',404);
        if(operation==='delivery.record')result=lifecycle.deliver(projectId,grant.principalId,input,current.revision+1,new Date().toISOString());
        else if(operation==='delivery.inspect')result=lifecycle.deliveryInspect(projectId,input);
        else if(operation==='delivery.list')result=lifecycle.list(projectId,input,'delivery');
        else result=lifecycle.exportRead(projectId,input);
      } else if(operation.startsWith('view.')) {
        if(!current)fail('NOT_FOUND','Project not initialized',404);
        if(operation==='view.record')result=views.record(projectId,input,current.revision+1,new Date().toISOString(),tasks.toolchainDigest);
        else if(operation==='view.inspect')result=views.inspect(projectId,input,tasks.toolchainDigest);
        else if(operation==='view.list')result=views.list(projectId,input);
        else if(operation==='view.query')result=views.query(projectId,input);
        else result=views.read(projectId,input);
      } else if(operation.startsWith('expectations.')) {
        if(!current)fail('NOT_FOUND','Project not initialized',404);
        if(operation==='expectations.record')result=expectations.record(projectId,input,current.revision+1,new Date().toISOString());
        else if(operation==='expectations.list')result=expectations.list(projectId,input);
        else if(operation==='expectations.inspect')result=expectations.inspect(projectId,input);
        else result=expectations.read(projectId,input);
      } else if(operation.startsWith('model.')) {
        if(!current)fail('NOT_FOUND','Project not initialized',404);
        if(operation==='model.record')result=models.record(projectId,input,current.revision+1,new Date().toISOString());
        else if(operation==='model.compare.read')result=comparisonRead(db,identity,projectId,input,{dl:tasks.toolchainDigest,validation:tasks.validationToolchainDigest});
        else if(operation==='model.list')result=models.list(projectId,input);
        else if(operation==='model.inspect')result=models.inspect(projectId,input);
        else result=models.read(projectId,input);
      } else if(operation.startsWith('source.')) {
        if(!current)fail('NOT_FOUND','Project not initialized',404);
        if(operation==='source.admit')result=sources.admit(projectId,input,current.revision+1,new Date().toISOString());
        else if(operation==='source.inspect')result=sources.inspect(projectId,input);
        else result=sources.read(projectId,input,operation==='source.fragment.read');
      } else {
        exact(input,['requestId']); id(input.requestId);
        const row=db.prepare('SELECT receipt FROM receipts WHERE project_id=? AND principal_id=? AND request_id=?').get(projectId,grant.principalId,input.requestId);
        if (!row) {requireFreshRecoveryRequest(identity,input.requestId);fail('NOT_FOUND','Original request receipt not found in scope',404);}
        result=JSON.parse(String(row.receipt));
      }
      if (write) {
        if (Number(db.prepare('SELECT count(*) AS n FROM receipts').get()!.n)>=LIMITS.receipts) fail('STATE_LIMIT','Receipt budget reached',409);
        const revision=(current?.revision??0)+1;
        if (!Number.isSafeInteger(revision)) fail('STATE_LIMIT','Revision exhausted',409);
        const receipt: Receipt={schema:'ontology-receipt/v1',workspaceId:identity.workspaceId,serviceId:identity.serviceId,projectId,principalId:grant.principalId,requestId:value.requestId!,requestDigest,operation,revision,status:'COMPLETED',recordedAt:new Date().toISOString(),result};
        const encoded=canonical(receipt as unknown as Json);
        if (Buffer.byteLength(encoded)>LIMITS.responseBytes) fail('OUTPUT_LIMIT','Receipt exceeds output budget',413);
        db.prepare('UPDATE projects SET revision=? WHERE id=?').run(revision,projectId);
        db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?)').run(projectId,grant.principalId,value.requestId!,requestDigest,encoded);
        db.prepare('INSERT INTO audit(project_id,principal_id,request_id,operation,request_digest,receipt_digest,recorded_at) VALUES(?,?,?,?,?,?,?)').run(projectId,grant.principalId,value.requestId!,operation,requestDigest,hashBytes(encoded),receipt.recordedAt);
        result=receipt as unknown as Json;
      }
      if (Buffer.byteLength(JSON.stringify(result))>LIMITS.responseBytes) fail('OUTPUT_LIMIT','Response exceeds output budget',413);
      db.exec('COMMIT');afterCommit?.();return result;
    } catch (e) {
      // SQLITE_FULL and some I/O failures already roll back the transaction.
      if(db.isTransaction)db.exec('ROLLBACK');
      if(e instanceof Error && 'errcode' in e && e.errcode===13)fail('STATE_LIMIT','Protected state byte budget or storage capacity reached',409);
      throw e;
    }
  }
  return {request,context,close(){
    if(closing)return closed;closing=true;
    try{const wait=tasks.shutdown();if(wait){closed=wait.finally(()=>store.close());return closed;}}
    catch(e){store.close();throw e;}store.close();return undefined;
  },identity:()=>structuredClone(identity)};
}
