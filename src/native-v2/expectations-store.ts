import type {DatabaseSync} from 'node:sqlite';
import {sourceStore} from './store.js';
import {boundIntent} from './intent-binding.js';
import {admitExpectations,EXPECTATIONS_CONTRACT_DIGEST} from './expectations.js';
import type {ExpectationAdmission} from './expectations.js';
import {metadataProjection,metadataPointer,metadataPage,METADATA_INLINE_BYTES} from './metadata.js';
import {canonical,exact,id,digest} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

export const EXPECTATION_TABLES=`
 CREATE TABLE native_expectations(project_id TEXT NOT NULL,asset_id TEXT NOT NULL,digest TEXT NOT NULL,schema_digest TEXT NOT NULL,document TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,asset_id,digest),FOREIGN KEY(project_id) REFERENCES projects(id));
 CREATE TABLE native_expectation_heads(project_id TEXT NOT NULL,asset_id TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(project_id,asset_id),FOREIGN KEY(project_id,asset_id,digest) REFERENCES native_expectations(project_id,asset_id,digest));
`;
export function expectationStore(db:DatabaseSync){
  const sources=sourceStore(db),transaction=()=>{if(!db.isTransaction)fail('TRANSACTION_REQUIRED','Expectations require the owner transaction',409);};
  function head(projectId:string,assetId:string):string|null {
    transaction();id(assetId);const row=db.prepare('SELECT digest FROM native_expectation_heads WHERE project_id=? AND asset_id=?').get(projectId,assetId);return row?String(row.digest):null;
  }
  function load(projectId:string,assetId:string,expectationsDigest:string):ExpectationAdmission {
    transaction();id(assetId);digest(expectationsDigest);
    const row=db.prepare('SELECT document,schema_digest FROM native_expectations WHERE project_id=? AND asset_id=? AND digest=?').get(projectId,assetId,expectationsDigest);
    if(!row)fail('NOT_FOUND','Expectations are absent in the selected project/asset',404);
    if(row.schema_digest!==EXPECTATIONS_CONTRACT_DIGEST)fail('UNSUPPORTED_EXPECTATIONS_SCHEMA','Original expectation contract reader is required',409);
    const definition=JSON.parse(String(row.document)),admitted=admitExpectations(definition,sources.load(projectId,definition.sourceSetDigest),boundIntent(db,projectId,definition.intentDigest));
    if(admitted.digest!==expectationsDigest||admitted.definition.assetId!==assetId)fail('CORRUPT_STATE','Expectations differ from immutable identity',409);
    return admitted;
  }
  function current(projectId:string,value:ExpectationAdmission):boolean {
    const selected=sources.head(projectId),d=value.definition;
    return head(projectId,d.assetId)===value.digest&&selected.status==='CURRENT'&&selected.intentDigest===d.intentDigest&&selected.sourceSetDigest===d.sourceSetDigest;
  }
  function record(projectId:string,input:unknown,revision:number,createdAt:string):Json {
    transaction();exact(input,['definition']);exact(input.definition,['schema','assetId','intentDigest','sourceSetDigest','previousDigest','requirements','requiredShapes','cases']);
    id(input.definition.assetId);digest(input.definition.intentDigest);digest(input.definition.sourceSetDigest);
    const selected=sources.head(projectId);
    if(selected.status!=='CURRENT'||selected.intentDigest!==input.definition.intentDigest||selected.sourceSetDigest!==input.definition.sourceSetDigest)fail('SOURCE_BINDING_CONFLICT','Expectations require current intent and original source admission',409);
    if(head(projectId,input.definition.assetId)!==input.definition.previousDigest)fail('EXPECTATIONS_CONFLICT','Expectation parent differs from current head',409);
    const v=admitExpectations(input.definition,sources.load(projectId,input.definition.sourceSetDigest),boundIntent(db,projectId,input.definition.intentDigest));
    db.prepare('INSERT INTO native_expectations VALUES(?,?,?,?,?,?,?)').run(projectId,v.definition.assetId,v.digest,v.schemaDigest,canonical(v.definition as unknown as Json),revision,createdAt);
    db.prepare('INSERT INTO native_expectation_heads VALUES(?,?,?) ON CONFLICT(project_id,asset_id) DO UPDATE SET digest=excluded.digest').run(projectId,v.definition.assetId,v.digest);
    const encoded=metadataProjection(projection(v)),inline=encoded.bytes.length<=METADATA_INLINE_BYTES;
    return {assetId:v.definition.assetId,expectationsDigest:v.digest,previousDigest:v.definition.previousDigest,status:'RECORDED',
      coverage:coverageSummary(v,inline),...(inline?{}:{metadata:metadataPointer(encoded,'expectations.metadata.read',false)}),businessConfirmed:false,authority:false};
  }
  function inspect(projectId:string,input:unknown):Json {
    exact(input,['assetId','expectationsDigest']);id(input.assetId);if(input.expectationsDigest!==null)digest(input.expectationsDigest);
    const wanted=input.expectationsDigest??head(projectId,input.assetId);if(wanted===null)fail('NOT_FOUND','Asset has no retained expectations',404);
    const v=load(projectId,input.assetId,wanted),metadata=projection(v),encoded=metadataProjection(metadata),inline=encoded.bytes.length<=METADATA_INLINE_BYTES;
    if(inline)return {...metadata,current:current(projectId,v),metadata:metadataPointer(encoded,'expectations.metadata.read',true)};
    const {coverage:_,cases:__,...identities}=metadata;
    return {...identities,current:current(projectId,v),coverage:coverageSummary(v,false),caseCount:v.definition.cases.length,
      metadata:metadataPointer(encoded,'expectations.metadata.read',false)};
  }
  function coverageSummary(v:ExpectationAdmission,inline:boolean):Json {
    return inline?{...v.coverage}:{complete:v.coverage.complete,requirements:v.coverage.requirements,cases:v.coverage.cases,missingCount:v.coverage.missing.length};
  }
  function projection(v:ExpectationAdmission):Record<string,Json> {
    const d=v.definition;
    return {assetId:d.assetId,expectationsDigest:v.digest,schemaDigest:v.schemaDigest,intentDigest:d.intentDigest,sourceSetDigest:d.sourceSetDigest,
      previousDigest:d.previousDigest,coverage:{...v.coverage},requiredShapes:d.requiredShapes.length,
      cases:d.cases.map(c=>({id:c.id,kind:c.kind,requirementIds:[...c.requirementIds],expected:c.kind==='shacl'?(c.expectedConforms?'CONFORMS':'NONCONFORMING'):c.expectedStatus})),
      businessConfirmed:false,authority:false};
  }
  function metadataRead(projectId:string,input:unknown):Json {
    exact(input,['assetId','expectationsDigest','projectionDigest','offset','maxBytes']);id(input.assetId);digest(input.expectationsDigest);digest(input.projectionDigest);
    const v=load(projectId,input.assetId,input.expectationsDigest);
    const page=metadataPage(metadataProjection(projection(v)),input.projectionDigest,input.offset,input.maxBytes);
    return {...page as Record<string,Json>,assetId:v.definition.assetId,expectationsDigest:v.digest,current:current(projectId,v),authority:false};
  }
  function read(projectId:string,input:unknown):Json {
    exact(input,['assetId','expectationsDigest','offset','maxBytes']);id(input.assetId);digest(input.expectationsDigest);
    if(!Number.isSafeInteger(input.offset)||(input.offset as number)<0||!Number.isSafeInteger(input.maxBytes)||(input.maxBytes as number)<4||(input.maxBytes as number)>65536)fail('INVALID_INPUT','Bounded UTF-8 page required');
    const v=load(projectId,input.assetId,input.expectationsDigest),bytes=Buffer.from(canonical(v.definition as unknown as Json)),start=input.offset as number;
    if(start>bytes.length||start<bytes.length&&(bytes[start]&0xC0)===0x80)fail('INVALID_INPUT','Offset splits UTF-8 or exceeds expectations');
    let end=Math.min(bytes.length,start+(input.maxBytes as number));while(end<bytes.length&&(bytes[end]&0xC0)===0x80)end--;
    return {assetId:v.definition.assetId,expectationsDigest:v.digest,content:bytes.subarray(start,end).toString('utf8'),offset:start,nextOffset:end===bytes.length?null:end,complete:end===bytes.length,current:current(projectId,v),authority:false};
  }
  function list(projectId:string,input:unknown):Json {
    transaction();exact(input,['afterAssetId','limit']);if(input.afterAssetId!==null)id(input.afterAssetId);
    if(!Number.isSafeInteger(input.limit)||(input.limit as number)<1||(input.limit as number)>100)fail('INVALID_INPUT','List page size must be 1–100');
    const rows=db.prepare('SELECT asset_id,digest FROM native_expectation_heads WHERE project_id=? AND asset_id>? ORDER BY asset_id LIMIT ?').all(projectId,input.afterAssetId??'',(input.limit as number)+1),page=rows.slice(0,input.limit as number);
    return {expectations:page.map(r=>{const v=load(projectId,String(r.asset_id),String(r.digest));return {assetId:v.definition.assetId,expectationsDigest:v.digest,current:current(projectId,v),coverageComplete:v.coverage.complete};}),nextCursor:rows.length>page.length?String(page.at(-1)!.asset_id):null,projectRevision:Number(db.prepare('SELECT revision FROM projects WHERE id=?').get(projectId)!.revision),authority:false};
  }
  return {head,load,current,record,inspect,read,list,metadataRead};
}
