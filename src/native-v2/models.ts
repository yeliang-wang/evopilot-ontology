import {Ajv2020} from 'ajv/dist/2020.js';
import {boundedJSON,validateDLRequest,closureDigest} from '../reasoning/request.js';
import type {DLClosure} from '../reasoning/types.js';
import {hash,hashBytes} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json,ModelingIntent} from '../standalone/types.js';
import {MODEL_SCHEMA,MODEL_SCHEMA_DIGEST} from './model-schema.js';
import type {ModelDraft} from './model-contracts.js';
import type {SourceAdmission} from './sources.js';

const validate=new Ajv2020({strict:true,ownProperties:true}).compile<ModelDraft>(MODEL_SCHEMA);
export interface ModelAdmission {
  draft:ModelDraft;digest:string;schemaDigest:string;closureDigest:string;
  mapping:{required:number;mapped:number;missing:string[];complete:boolean;semanticCoverage:'NOT_EVALUATED'};
}
export function admitModel(input:unknown,sources:SourceAdmission,intent:ModelingIntent):ModelAdmission {
  boundedJSON(input,48*1024*1024);if(!validate(input))fail('MODEL_SCHEMA','Model draft differs from native v2 schema');
  const draft:ModelDraft=structuredClone(input);
  if(!draft.label.trim())fail('MODEL_SCHEMA','A meaningful model label is required');
  if(draft.sourceSetDigest!==sources.sourceSetDigest)fail('SOURCE_BINDING_CONFLICT','Model binds different source snapshot',409);
  // Validate identities/digests/import structure. Actual RDF/OWL parsing remains
  // a separate formal task; malformed logical content remains a repairable draft.
  const closure=structuredClone(draft.closure) as DLClosure;
  validateDLRequest({schema:'ontology-dl-request/v1',requestId:'draft-validation',closure,task:{kind:'legality'}});
  const documents=new Map(draft.closure.documents.map(d=>[d.id,d]));let shapeBytes=0;
  for(const d of draft.shapes){
    if(documents.has(d.id))fail('MODEL_DOCUMENT_CONFLICT','Ontology/shape document IDs must be distinct',409);
    validateDLRequest({schema:'ontology-dl-request/v1',requestId:'shape-envelope',closure:{rootDocumentId:d.id,documents:[d],imports:[]},task:{kind:'legality'}});
    documents.set(d.id,d);shapeBytes+=Buffer.byteLength(d.content);
  }
  if(shapeBytes>16*1024*1024)fail('INPUT_LIMIT','Shape source text budget exceeded');
  const requirements=new Set(intent.requirements.map(r=>r.id)),mapped=new Set<string>(),fragments=new Set(sources.fragments.map(f=>f.id));let anchorBytes=0;
  for(const m of draft.mappings){
    if(!requirements.has(m.requirementId)||mapped.has(m.requirementId))fail('MODEL_MAPPING','Unknown or repeated independent requirement');mapped.add(m.requirementId);
    if(!m.rationale.trim()||new Set(m.sourceFragmentIds).size!==m.sourceFragmentIds.length||m.sourceFragmentIds.some(id=>!fragments.has(id)))fail('MODEL_MAPPING','Mapping requires distinct admitted source fragments and a rationale');
    for(const a of m.anchors){
      const d=documents.get(a.documentId);if(!d||d.digest!==a.documentDigest)fail('MODEL_MAPPING','Mapping document identity is absent or stale');
      const bytes=Buffer.from(d.content);
      if(a.start>=a.end||a.end>bytes.length||a.start<bytes.length&&(bytes[a.start]&0xC0)===0x80||a.end<bytes.length&&(bytes[a.end]&0xC0)===0x80)fail('MODEL_MAPPING','Mapping needs a nonempty UTF-8 source range');
      anchorBytes+=a.end-a.start;if(anchorBytes>32*1024*1024)fail('INPUT_LIMIT','Model mapping byte budget exceeded');
      if(hashBytes(bytes.subarray(a.start,a.end))!==a.fragmentDigest)fail('MODEL_MAPPING','Mapping source range differs from its digest');
    }
  }
  if(draft.openIssues.some(x=>!x.trim()))fail('MODEL_SCHEMA','Open issues must be meaningful text');
  const missing=[...requirements].filter(id=>!mapped.has(id)).sort();
  return {draft,digest:hash(draft as unknown as Json),schemaDigest:MODEL_SCHEMA_DIGEST,closureDigest:closureDigest(closure),
    mapping:{required:requirements.size,mapped:mapped.size,missing,complete:missing.length===0,semanticCoverage:'NOT_EVALUATED'}};
}
