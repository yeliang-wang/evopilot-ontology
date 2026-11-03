import type {DatabaseSync} from 'node:sqlite';
import {modelStore} from './model-store.js';
import type {ModelAdmission} from './models.js';
import {PROJECTION_SCHEMA_DIGEST} from './projection-schema.js';
import type {DerivedView} from './projection-contracts.js';
import type {SHACLRequest} from './shacl-contracts.js';
import {projectResults,projectionTurtle,projectionIRI,checkProjection,VIEW_LIMITS} from './projection.js';
import type {ProjectionTask} from './projection.js';
import {validateDLRequest,closureDigest} from '../reasoning/request.js';
import type {DLResponse} from '../reasoning/types.js';
import {exact,id,digest,hash,hashBytes,canonical} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

export const VIEW_TABLES=`
 CREATE TABLE native_views(project_id TEXT NOT NULL,asset_id TEXT NOT NULL,digest TEXT NOT NULL,schema_digest TEXT NOT NULL,model_digest TEXT NOT NULL,document TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,asset_id,digest),FOREIGN KEY(project_id,asset_id,model_digest) REFERENCES native_models(project_id,asset_id,digest));
`;
export function viewStore(db:DatabaseSync){
  const models=modelStore(db);
  const transaction=()=>{if(!db.isTransaction)fail('TRANSACTION_REQUIRED','Views require the owner transaction',409);};
  function task(projectId:string,model:ModelAdmission,taskId:string):ProjectionTask {
    id(taskId);const row=db.prepare('SELECT * FROM native_reasoning_tasks WHERE project_id=? AND asset_id=? AND model_digest=? AND id=? AND task_kind=?').get(projectId,model.draft.assetId,model.digest,taskId,'dl');
    if(!row)fail('PROJECTION_TASK_SCOPE','Reasoning task is absent in this exact project/model scope',404);
    if(row.state!=='FINISHED'||row.result===null)fail('PROJECTION_INCOMPLETE','Reasoning must finish before creating a view',409);
    const request:unknown=JSON.parse(String(row.request));validateDLRequest(request);const result=JSON.parse(String(row.result)) as DLResponse;
    if(hash(request as unknown as Json)!==row.request_digest||closureDigest(request.closure)!==model.closureDigest||request.requestId!==taskId||hash(result as unknown as Json)!==row.result_digest||result.schema!=='ontology-dl-result/v1'||result.requestId!==taskId||result.requestDigest!==row.request_digest||result.closureDigest!==row.closure_digest||result.closureDigest!==model.closureDigest||result.configurationDigest!==row.configuration_digest||result.toolchainDigest!==row.toolchain_digest)fail('CORRUPT_STATE','Retained reasoning identity differs from its model or result',409);
    return {taskId,request,result,resultDigest:String(row.result_digest)};
  }
  function load(projectId:string,assetId:string,viewDigest:string):{view:DerivedView;model:ModelAdmission} {
    transaction();id(assetId);digest(viewDigest);
    const row=db.prepare('SELECT * FROM native_views WHERE project_id=? AND asset_id=? AND digest=?').get(projectId,assetId,viewDigest);
    if(!row)fail('NOT_FOUND','Derived view is absent in selected project/asset',404);
    if(row.schema_digest!==PROJECTION_SCHEMA_DIGEST)fail('UNSUPPORTED_VIEW_SCHEMA','Original view reader required',409);
    const view:unknown=JSON.parse(String(row.document));checkProjection(view);
    if(hash(view as unknown as Json)!==viewDigest||view.assetId!==assetId||view.modelDigest!==row.model_digest)fail('CORRUPT_STATE','View differs from its immutable identity',409);
    const model=models.load(projectId,assetId,view.modelDigest),replayed=projectResults(model,view.tasks.map(t=>task(projectId,model,t.taskId)));
    if(hash(replayed as unknown as Json)!==viewDigest)fail('CORRUPT_STATE','View no longer matches its retained formal results',409);
    return {view,model};
  }
  const matches=(view:DerivedView,toolchainDigest:string|null)=>toolchainDigest!==null&&view.tasks.every(t=>t.toolchainDigest===toolchainDigest);
  function record(projectId:string,input:unknown,revision:number,createdAt:string,toolchainDigest:string|null):Json {
    transaction();exact(input,['assetId','modelDigest','taskIds']);id(input.assetId);digest(input.modelDigest);
    if(!Array.isArray(input.taskIds)||!input.taskIds.length||input.taskIds.length>VIEW_LIMITS.tasks||new Set(input.taskIds).size!==input.taskIds.length)fail('PROJECTION_TASKS','Select 1–8 distinct completed tasks');
    input.taskIds.forEach(id);const model=models.load(projectId,input.assetId,input.modelDigest);
    if(!models.current(projectId,model))fail('STALE_MODEL','A new view requires the current model/source/intent/expectations binding',409);
    const view=projectResults(model,(input.taskIds as string[]).map(t=>task(projectId,model,t))),viewDigest=hash(view as unknown as Json);
    if(!matches(view,toolchainDigest))fail('STALE_TOOLCHAIN','View tasks differ from the configured reasoning toolchain',409);
    db.prepare('INSERT OR IGNORE INTO native_views VALUES(?,?,?,?,?,?,?,?)').run(projectId,input.assetId,viewDigest,PROJECTION_SCHEMA_DIGEST,model.digest,canonical(view as unknown as Json),revision,createdAt);
    return {assetId:input.assetId,modelDigest:model.digest,viewDigest,sourceSetDigest:view.sourceSetDigest,closureDigest:view.closureDigest,composition:view.composition,scope:view.scope,tripleCount:view.triples.length,allLogicalConsequences:false,authority:false};
  }
  function inspect(projectId:string,input:unknown,toolchainDigest:string|null):Json {
    exact(input,['assetId','viewDigest']);id(input.assetId);digest(input.viewDigest);const {view,model}=load(projectId,input.assetId,input.viewDigest),{triples,...metadata}=view;
    return {...metadata,viewDigest:input.viewDigest,schemaDigest:PROJECTION_SCHEMA_DIGEST,tripleCount:triples.length,projectionDocumentDigest:hashBytes(projectionTurtle(view)),current:models.current(projectId,model),configuredToolchainMatches:matches(view,toolchainDigest),authority:false} as unknown as Json;
  }
  function read(projectId:string,input:unknown):Json {
    exact(input,['assetId','viewDigest','format','offset','maxBytes']);id(input.assetId);digest(input.viewDigest);
    if(!['json','turtle'].includes(input.format as string)||!Number.isSafeInteger(input.offset)||(input.offset as number)<0||!Number.isSafeInteger(input.maxBytes)||(input.maxBytes as number)<4||(input.maxBytes as number)>VIEW_LIMITS.pageBytes)fail('INVALID_INPUT','Select json/turtle and a bounded UTF-8 page');
    const {view,model}=load(projectId,input.assetId,input.viewDigest),bytes=Buffer.from(input.format==='json'?canonical(view as unknown as Json):projectionTurtle(view)),start=input.offset as number;
    if(start>bytes.length||start<bytes.length&&(bytes[start]&0xC0)===0x80)fail('INVALID_INPUT','Offset splits UTF-8 or exceeds view');
    let end=Math.min(bytes.length,start+(input.maxBytes as number));while(end<bytes.length&&(bytes[end]&0xC0)===0x80)end--;
    return {assetId:input.assetId,modelDigest:view.modelDigest,sourceSetDigest:view.sourceSetDigest,viewDigest:input.viewDigest,format:input.format as string,documentDigest:hashBytes(bytes),content:bytes.subarray(start,end).toString('utf8'),offset:start,nextOffset:end===bytes.length?null:end,complete:end===bytes.length,current:models.current(projectId,model),contentScope:'DERIVED_COMPONENT_ONLY',authority:false};
  }
  function query(projectId:string,input:unknown):Json {
    exact(input,['assetId','viewDigest','subject','predicate','object','offset','limit']);id(input.assetId);digest(input.viewDigest);
    for(const key of ['subject','predicate','object'])if(input[key]!==null)projectionIRI(input[key]);
    if(!Number.isSafeInteger(input.offset)||(input.offset as number)<0||!Number.isSafeInteger(input.limit)||(input.limit as number)<1||(input.limit as number)>100)fail('INVALID_INPUT','Bounded triple page required');
    const {view,model}=load(projectId,input.assetId,input.viewDigest),selected=view.triples.filter(t=>(['subject','predicate','object'] as const).every(k=>input[k]===null||input[k]===t[k])),offset=input.offset as number;
    if(offset>selected.length)fail('INVALID_INPUT','Offset exceeds matching triples');
    const page=selected.slice(offset,offset+(input.limit as number));
    return {assetId:input.assetId,viewDigest:input.viewDigest,modelDigest:view.modelDigest,sourceSetDigest:view.sourceSetDigest,triples:page as unknown as Json,total:selected.length,nextOffset:offset+page.length===selected.length?null:offset+page.length,current:models.current(projectId,model),queryScope:'DERIVED_COMPONENT_ONLY',allLogicalConsequences:false,absenceMeans:'NOT_IN_THIS_PROJECTION',authority:false};
  }
  function list(projectId:string,input:unknown):Json {
    transaction();exact(input,['assetId','afterDigest','limit']);id(input.assetId);if(input.afterDigest!==null)digest(input.afterDigest);
    if(!Number.isSafeInteger(input.limit)||(input.limit as number)<1||(input.limit as number)>100)fail('INVALID_INPUT','View page size must be 1–100');
    const rows=db.prepare('SELECT digest,model_digest,revision,created_at FROM native_views WHERE project_id=? AND asset_id=? AND digest>? ORDER BY digest LIMIT ?').all(projectId,input.assetId,input.afterDigest??'',(input.limit as number)+1),page=rows.slice(0,input.limit as number);
    return {views:page.map(r=>({viewDigest:String(r.digest),modelDigest:String(r.model_digest),revision:Number(r.revision),createdAt:String(r.created_at)})),nextCursor:rows.length>page.length?String(page.at(-1)!.digest):null,authority:false};
  }
  function bind(projectId:string,model:ModelAdmission,input:unknown,toolchainDigest:string|null):SHACLRequest['view'] {
    if(input===undefined)return {kind:'asserted',closure:model.draft.closure};
    exact(input,['kind'],['viewDigest']);
    if(input.kind==='asserted'){exact(input,['kind']);return {kind:'asserted',closure:model.draft.closure};}
    if(input.kind!=='derived')fail('INVALID_INPUT','Select asserted or an exact retained derived view');
    exact(input,['kind','viewDigest']);digest(input.viewDigest);const retained=load(projectId,model.draft.assetId,input.viewDigest);
    if(retained.model.digest!==model.digest||!models.current(projectId,retained.model))fail('STALE_VIEW','Selected view belongs to a different or stale model',409);
    if(!matches(retained.view,toolchainDigest))fail('STALE_TOOLCHAIN','Derived view reasoning toolchain changed',409);
    const content=projectionTurtle(retained.view);
    return {kind:'derived',closure:model.draft.closure,projectionDigest:input.viewDigest,document:{id:'derived-'+input.viewDigest.slice(7),documentIri:'urn:evopilot:derived:'+input.viewDigest.slice(7),ontologyIri:null,versionIri:null,format:'turtle',content,digest:hashBytes(content)}};
  }
  return {record,load,inspect,read,query,list,bind};
}
