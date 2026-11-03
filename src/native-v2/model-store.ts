import type {DatabaseSync} from 'node:sqlite';
import {sourceStore} from './store.js';
import {admitModel} from './models.js';
import type {ModelAdmission} from './models.js';
import {MODEL_SCHEMA_DIGEST} from './model-schema.js';
import {canonical,hash,exact,id,digest,validateIntent} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json,ModelingIntent} from '../standalone/types.js';

export const MODEL_TABLES=`
 CREATE TABLE native_models(project_id TEXT NOT NULL,asset_id TEXT NOT NULL,digest TEXT NOT NULL,schema_digest TEXT NOT NULL,document TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,asset_id,digest),FOREIGN KEY(project_id) REFERENCES projects(id));
 CREATE TABLE native_model_heads(project_id TEXT NOT NULL,asset_id TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(project_id,asset_id),FOREIGN KEY(project_id,asset_id,digest) REFERENCES native_models(project_id,asset_id,digest));
`;
export function modelStore(db:DatabaseSync){
  const sources=sourceStore(db);
  const transaction=()=>{if(!db.isTransaction)fail('TRANSACTION_REQUIRED','Models require the owner transaction',409);};
  function intent(projectId:string,intentDigest:string):ModelingIntent {
    const row=db.prepare('SELECT document FROM intents WHERE project_id=? AND digest=?').get(projectId,intentDigest);
    if(!row)fail('NOT_FOUND','Model intent is absent in project',404);
    const value=JSON.parse(String(row.document));validateIntent(value.definition);
    if(hash(value)!==intentDigest)fail('CORRUPT_STATE','Bound intent content differs from identity',409);
    return value.definition;
  }
  function head(projectId:string,assetId:string):string|null {
    transaction();id(assetId);const row=db.prepare('SELECT digest FROM native_model_heads WHERE project_id=? AND asset_id=?').get(projectId,assetId);return row?String(row.digest):null;
  }
  function load(projectId:string,assetId:string,modelDigest:string):ModelAdmission {
    transaction();id(assetId);digest(modelDigest);
    const row=db.prepare('SELECT document,schema_digest FROM native_models WHERE project_id=? AND asset_id=? AND digest=?').get(projectId,assetId,modelDigest);
    if(!row)fail('NOT_FOUND','Model draft is absent in selected project/asset',404);
    if(row.schema_digest!==MODEL_SCHEMA_DIGEST)fail('UNSUPPORTED_MODEL_SCHEMA','Original model schema reader is required',409);
    const draft=JSON.parse(String(row.document));
    const admitted=admitModel(draft,sources.load(projectId,draft.sourceSetDigest),intent(projectId,draft.intentDigest));
    if(admitted.digest!==modelDigest||admitted.draft.assetId!==assetId)fail('CORRUPT_STATE','Stored model differs from immutable identity',409);
    return admitted;
  }
  function current(projectId:string,model:ModelAdmission):boolean {
    const source=sources.head(projectId);
    return head(projectId,model.draft.assetId)===model.digest&&source.status==='CURRENT'&&source.intentDigest===model.draft.intentDigest&&source.sourceSetDigest===model.draft.sourceSetDigest;
  }
  function record(projectId:string,input:unknown,revision:number,createdAt:string):Json {
    transaction();exact(input,['draft']);exact(input.draft,['schema','assetId','label','intentDigest','sourceSetDigest','previousDigest','closure','shapes','mappings','openIssues']);
    digest(input.draft.intentDigest);digest(input.draft.sourceSetDigest);id(input.draft.assetId);
    const selected=sources.head(projectId);
    if(selected.status!=='CURRENT'||selected.intentDigest!==input.draft.intentDigest||selected.sourceSetDigest!==input.draft.sourceSetDigest)fail('SOURCE_BINDING_CONFLICT','Model requires current intent and source admission',409);
    if(head(projectId,input.draft.assetId)!==input.draft.previousDigest)fail('MODEL_CONFLICT','Model parent differs from current draft',409);
    const admitted=admitModel(input.draft,sources.load(projectId,input.draft.sourceSetDigest),intent(projectId,input.draft.intentDigest));
    db.prepare('INSERT INTO native_models VALUES(?,?,?,?,?,?,?)').run(projectId,admitted.draft.assetId,admitted.digest,admitted.schemaDigest,canonical(admitted.draft as unknown as Json),revision,createdAt);
    db.prepare('INSERT INTO native_model_heads VALUES(?,?,?) ON CONFLICT(project_id,asset_id) DO UPDATE SET digest=excluded.digest').run(projectId,admitted.draft.assetId,admitted.digest);
    return {assetId:admitted.draft.assetId,modelDigest:admitted.digest,previousDigest:admitted.draft.previousDigest,closureDigest:admitted.closureDigest,status:'DRAFT',mapping:{...admitted.mapping},openIssues:admitted.draft.openIssues.length,formalValidation:'NOT_EVALUATED',businessConfirmed:false,authority:false};
  }
  function inspect(projectId:string,input:unknown):Json {
    transaction();exact(input,['assetId','modelDigest']);id(input.assetId);if(input.modelDigest!==null)digest(input.modelDigest);
    const wanted=input.modelDigest??head(projectId,input.assetId);if(wanted===null)fail('NOT_FOUND','Asset has no draft',404);
    const model=load(projectId,input.assetId,wanted),{closure,shapes,...metadata}=model.draft;
    return {...metadata,modelDigest:model.digest,schemaDigest:model.schemaDigest,closureDigest:model.closureDigest,current:current(projectId,model),status:'DRAFT',
      closure:{...closure,documents:closure.documents.map(({content,...d})=>({...d,bytes:Buffer.byteLength(content)}))},shapes:shapes.map(({content,...d})=>({...d,bytes:Buffer.byteLength(content)})),
      mapping:{...model.mapping},formalValidation:'NOT_EVALUATED',businessConfirmed:false,authority:false} as unknown as Json;
  }
  function read(projectId:string,input:unknown):Json {
    exact(input,['assetId','modelDigest','documentId','offset','maxBytes']);id(input.assetId);digest(input.modelDigest);id(input.documentId);
    if(!Number.isSafeInteger(input.offset)||(input.offset as number)<0||!Number.isSafeInteger(input.maxBytes)||(input.maxBytes as number)<4||(input.maxBytes as number)>65536)fail('INVALID_INPUT','Bounded UTF-8 page required');
    const model=load(projectId,input.assetId,input.modelDigest),doc=[...model.draft.closure.documents,...model.draft.shapes].find(d=>d.id===input.documentId);
    if(!doc)fail('NOT_FOUND','Model document is absent',404);
    const bytes=Buffer.from(doc.content),start=input.offset as number;
    if(start>bytes.length||start<bytes.length&&(bytes[start]&0xC0)===0x80)fail('INVALID_INPUT','Offset splits UTF-8 or exceeds document');
    let end=Math.min(bytes.length,start+(input.maxBytes as number));while(end<bytes.length&&(bytes[end]&0xC0)===0x80)end--;
    return {assetId:model.draft.assetId,modelDigest:model.digest,documentId:doc.id,documentDigest:doc.digest,format:doc.format,content:bytes.subarray(start,end).toString('utf8'),startByte:start,endByte:end,nextOffset:end===bytes.length?null:end,complete:end===bytes.length,current:current(projectId,model),authority:false};
  }
  function list(projectId:string,input:unknown):Json {
    transaction();exact(input,['afterAssetId','limit']);if(input.afterAssetId!==null)id(input.afterAssetId);
    if(!Number.isSafeInteger(input.limit)||(input.limit as number)<1||(input.limit as number)>100)fail('INVALID_INPUT','List page size must be 1–100');
    const rows=db.prepare('SELECT h.asset_id,h.digest,m.document,m.revision FROM native_model_heads h JOIN native_models m ON m.project_id=h.project_id AND m.asset_id=h.asset_id AND m.digest=h.digest WHERE h.project_id=? AND h.asset_id>? ORDER BY h.asset_id LIMIT ?').all(projectId,input.afterAssetId??'',(input.limit as number)+1);
    const page=rows.slice(0,input.limit as number),selected=sources.head(projectId);
    return {models:page.map(r=>{const d=JSON.parse(String(r.document));return {assetId:String(r.asset_id),modelDigest:String(r.digest),label:String(d.label),revision:Number(r.revision),current:selected.status==='CURRENT'&&d.intentDigest===selected.intentDigest&&d.sourceSetDigest===selected.sourceSetDigest};}),nextCursor:rows.length>page.length?String(page.at(-1)!.asset_id):null,projectRevision:Number(db.prepare('SELECT revision FROM projects WHERE id=?').get(projectId)!.revision),authority:false};
  }
  return {head,load,current,record,inspect,read,list};
}
