import type {DatabaseSync} from 'node:sqlite';
import {admitSourceSet} from './sources.js';
import type {SourceAdmission} from './sources.js';
import {SOURCE_SCHEMA_DIGEST} from './schema.js';
import {canonical,exact,digest,id} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json,ModelingIntent} from '../standalone/types.js';

export const SOURCE_TABLES=`
  CREATE TABLE native_source_sets(project_id TEXT NOT NULL,digest TEXT NOT NULL,schema_digest TEXT NOT NULL,document TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,digest),FOREIGN KEY(project_id) REFERENCES projects(id));
  CREATE TABLE native_source_admissions(project_id TEXT NOT NULL,intent_digest TEXT NOT NULL,source_set_digest TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,intent_digest,source_set_digest),FOREIGN KEY(project_id,intent_digest) REFERENCES intents(project_id,digest),FOREIGN KEY(project_id,source_set_digest) REFERENCES native_source_sets(project_id,digest));
  CREATE TABLE native_source_heads(project_id TEXT PRIMARY KEY,intent_digest TEXT NOT NULL,source_set_digest TEXT NOT NULL,FOREIGN KEY(project_id,intent_digest,source_set_digest) REFERENCES native_source_admissions(project_id,intent_digest,source_set_digest));
`;

/** Called only inside the authenticated owner's transaction. No connection,
 * credential, project initialization or independent writer is created here. */
export function sourceStore(db:DatabaseSync) {
  function transaction():void {if(!db.isTransaction)fail('TRANSACTION_REQUIRED','Source state requires the owner transaction',409);}
  function head(projectId:string){
    transaction();
    const intent=db.prepare('SELECT intent_digest FROM project_heads WHERE project_id=?').get(projectId);
    const selected=db.prepare('SELECT intent_digest,source_set_digest FROM native_source_heads WHERE project_id=?').get(projectId);
    return {intentDigest:intent?.intent_digest===undefined||intent.intent_digest===null?null:String(intent.intent_digest),
      admittedIntentDigest:selected?String(selected.intent_digest):null,sourceSetDigest:selected?String(selected.source_set_digest):null,
      status:!selected?'ABSENT':selected.intent_digest===intent?.intent_digest?'CURRENT':'STALE'};
  }
  function load(projectId:string,sourceSetDigest:string):SourceAdmission {
    transaction();digest(sourceSetDigest);
    const row=db.prepare('SELECT schema_digest,document FROM native_source_sets WHERE project_id=? AND digest=?').get(projectId,sourceSetDigest);
    if(!row)fail('NOT_FOUND','Source set not found in selected project',404);
    if(row.schema_digest!==SOURCE_SCHEMA_DIGEST)fail('UNSUPPORTED_SOURCE_SCHEMA','Stored source set requires its original schema reader',409);
    let admitted:SourceAdmission;
    try{admitted=admitSourceSet(JSON.parse(String(row.document)));}
    catch{fail('CORRUPT_STATE','Stored source snapshot failed byte/fragment verification',409);}
    if(admitted.sourceSetDigest!==sourceSetDigest)fail('CORRUPT_STATE','Stored source identity differs from its immutable address',409);
    return admitted;
  }
  function admit(projectId:string,input:unknown,revision:number,createdAt:string):Json {
    transaction();exact(input,['intentDigest','sourceSet']);digest(input.intentDigest);
    const selected=head(projectId);
    if(selected.intentDigest!==input.intentDigest)fail('INTENT_CONFLICT','Source admission requires the current modeling intent',409);
    const row=db.prepare('SELECT document FROM intents WHERE project_id=? AND digest=?').get(projectId,input.intentDigest);
    if(!row)fail('NOT_FOUND','Bound intent not found',404);
    const definition=(JSON.parse(String(row.document)) as {definition:ModelingIntent}).definition;
    const admitted=admitSourceSet(input.sourceSet);
    const declared=new Map(definition.sources.map(s=>[s.id,s]));
    if(declared.size!==admitted.sourceSet.sources.length)fail('SOURCE_BINDING_CONFLICT','Every declared source must be admitted exactly once',409);
    for(const s of admitted.sourceSet.sources){
      const bound=declared.get(s.id);
      if(!bound||bound.digest!==s.digest||bound.locator!==s.locator||bound.revision!==s.revision||bound.origin!==s.origin)fail('SOURCE_BINDING_CONFLICT','Source content/metadata differs from the current intent',409);
    }
    const existing=db.prepare('SELECT digest FROM native_source_sets WHERE project_id=? AND digest=?').get(projectId,admitted.sourceSetDigest);
    if(existing)load(projectId,admitted.sourceSetDigest);
    else db.prepare('INSERT INTO native_source_sets VALUES(?,?,?,?,?)').run(projectId,admitted.sourceSetDigest,admitted.schemaDigest,canonical(admitted.sourceSet as unknown as Json),createdAt);
    db.prepare('INSERT OR IGNORE INTO native_source_admissions VALUES(?,?,?,?,?)').run(projectId,input.intentDigest,admitted.sourceSetDigest,revision,createdAt);
    db.prepare('INSERT INTO native_source_heads VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET intent_digest=excluded.intent_digest,source_set_digest=excluded.source_set_digest').run(projectId,input.intentDigest,admitted.sourceSetDigest);
    return {sourceSetDigest:admitted.sourceSetDigest,schemaDigest:admitted.schemaDigest,intentDigest:input.intentDigest,
      status:'ADMITTED',sources:admitted.sourceSet.sources.length,fragments:admitted.fragments.length,semanticValidation:'NOT_EVALUATED',businessConfirmed:false,authority:false};
  }
  function inspect(projectId:string,input:unknown):Json {
    exact(input,['sourceSetDigest']);if(input.sourceSetDigest!==null)digest(input.sourceSetDigest);
    const selected=head(projectId),wanted=input.sourceSetDigest??selected.sourceSetDigest;
    if(wanted===null)return {...selected,authority:false};
    const admitted=load(projectId,wanted),current=selected.status==='CURRENT'&&selected.sourceSetDigest===wanted;
    return {...selected,sourceSetDigest:wanted,current,status:current?'CURRENT':'STALE',schemaDigest:admitted.schemaDigest,
      sources:admitted.sourceSet.sources.map(({content,...s})=>({...s,bytes:Buffer.byteLength(content)})),
      fragments:admitted.sourceSet.fragments.map(f=>({...f,...admitted.fragments.find(r=>r.id===f.id)!})),
      semanticValidation:'NOT_EVALUATED',businessConfirmed:false,authority:false};
  }
  function read(projectId:string,input:unknown,fragment:boolean):Json {
    exact(input,['sourceSetDigest',fragment?'fragmentId':'sourceId','offset','maxBytes']);digest(input.sourceSetDigest);
    const target=fragment?input.fragmentId:input.sourceId;id(target);
    if(!Number.isSafeInteger(input.offset)||(input.offset as number)<0||!Number.isSafeInteger(input.maxBytes)||(input.maxBytes as number)<4||(input.maxBytes as number)>65536)fail('INVALID_INPUT','Read offset and 4–65536 byte page size required');
    const admitted=load(projectId,input.sourceSetDigest);
    const f=fragment?admitted.fragments.find(f=>f.id===target):undefined;
    if(fragment&&!f)fail('NOT_FOUND','Fragment not found in source set',404);
    const source=admitted.sourceSet.sources.find(s=>s.id===(f?.sourceId??target));
    if(!source)fail('NOT_FOUND','Source not found in source set',404);
    const bytes=Buffer.from(source.content),start=(f?.startByte??0)+(input.offset as number),limit=f?.endByte??bytes.length;
    if(start>limit||start<bytes.length&&(bytes[start]&0xC0)===0x80)fail('SOURCE_FRAGMENT_INVALID','Read offset must be an existing UTF-8 boundary');
    let end=Math.min(limit,start+(input.maxBytes as number));
    while(end<limit&&(bytes[end]&0xC0)===0x80)end--;
    const selected=head(projectId),current=selected.status==='CURRENT'&&selected.sourceSetDigest===admitted.sourceSetDigest;
    return {sourceSetDigest:admitted.sourceSetDigest,sourceId:source.id,sourceDigest:source.digest,fragmentId:f?.id??null,fragmentDigest:f?.fragmentDigest??null,
      format:source.format,startByte:start,endByte:end,content:bytes.subarray(start,end).toString('utf8'),
      nextOffset:end===limit?null:end-(f?.startByte??0),complete:end===limit,current,authority:false};
  }
  return {head,admit,inspect,read};
}
