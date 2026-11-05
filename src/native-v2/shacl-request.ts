import {Ajv2020} from 'ajv/dist/2020.js';
import {boundedJSON,validateDLRequest,closureDigest} from '../reasoning/request.js';
import type {DLClosure} from '../reasoning/types.js';
import {hash} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {SHACL_SCHEMA} from './shacl-schema.js';
import {MODEL_SCHEMA} from './model-schema.js';
import type {SHACLGraphRequest} from './shacl-graph-request.js';
import type {SHACLRequest} from './shacl-contracts.js';

export const SHACL_LIMITS=Object.freeze({requestBytes:48*1024*1024,shapeBytes:16*1024*1024,outputBytes:16*1024*1024,diagnosticBytes:65536,taskMs:60000,triples:200000,focusNodes:20000,shapeDepth:32});
const validate=new Ajv2020({strict:true,ownProperties:true}).addSchema(MODEL_SCHEMA).compile<SHACLRequest>(SHACL_SCHEMA);
export function validateSHACLRequest(value:unknown):asserts value is SHACLRequest {
  boundedJSON(value,SHACL_LIMITS.requestBytes);if(!validate(value))fail('SHACL_SCHEMA','Validation request differs from the native v2 schema');
  validateSHACLDocuments(value);
  const required=value.expectations.requiredShapes;
  if(hash(required as unknown as Json)!==value.expectations.digest)fail('DIGEST_MISMATCH','Independent expected shape/target ledger differs from digest',409);
  if(new Set(required.map(r=>r.shapeIri)).size!==required.length||required.some(r=>new Set(r.requiredFocusIris).size!==r.requiredFocusIris.length))fail('SHACL_SCHEMA','Distinct required shapes and focus identities required');
  if(required.reduce((n,r)=>n+r.requiredFocusIris.length,0)>SHACL_LIMITS.focusNodes)fail('INPUT_LIMIT','Required target budget exceeded');
}
export function validateSHACLDocuments(value:SHACLRequest|SHACLGraphRequest,graphOnly=false):void {
  validateDLRequest({schema:'ontology-dl-request/v1',requestId:value.requestId,closure:value.view.closure,task:{kind:'legality'}});
  const identities=new Map(value.view.closure.documents.map(d=>[d.documentIri,d]));
  const ids=new Set(value.view.closure.documents.map(d=>d.id)),iris=new Set(value.view.closure.documents.map(d=>d.documentIri));let bytes=0;
  for(const d of value.shapes){
    const same=identities.get(d.documentIri);
    if(graphOnly&&same&&(same.digest!==d.digest||same.format!==d.format||same.ontologyIri!==d.ontologyIri||same.versionIri!==d.versionIri))fail('SHACL_SCHEMA','One graph document IRI cannot bind conflicting bytes or identities');
    identities.set(d.documentIri,d);
    if(ids.has(d.id)||!graphOnly&&iris.has(d.documentIri))fail('SHACL_SCHEMA','Shape and ontology documents require distinct identities');ids.add(d.id);iris.add(d.documentIri);
    validateDLRequest({schema:'ontology-dl-request/v1',requestId:value.requestId,closure:{rootDocumentId:d.id,documents:[d],imports:[]},task:{kind:'legality'}});bytes+=Buffer.byteLength(d.content);
  }
  if(value.view.kind==='derived'){
    const d=value.view.document;
    if(d.format!=='turtle'||d.ontologyIri!==null||d.versionIri!==null||ids.has(d.id)||iris.has(d.documentIri))fail('SHACL_SCHEMA','Derived component requires its own Turtle document identity');
    validateDLRequest({schema:'ontology-dl-request/v1',requestId:value.requestId,closure:{rootDocumentId:d.id,documents:[d],imports:[]},task:{kind:'legality'}});
  }
  if(bytes>SHACL_LIMITS.shapeBytes)fail('INPUT_LIMIT','Shape document byte budget exceeded');
}
export function shaclIdentities(request:SHACLRequest|SHACLGraphRequest){
  const closure=closureDigest(request.view.closure as DLClosure);
  return {requestDigest:hash(request as unknown as Json),closureDigest:closure,
    viewDigest:hash({kind:request.view.kind,modelDigest:request.modelDigest,closureDigest:closure,...(request.view.kind==='derived'?{projectionDigest:request.view.projectionDigest,documentDigest:request.view.document.digest}:{})}),
    shapesDigest:hash(request.shapes.map(({content:_,...identity})=>identity).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)),expectationsDigest:request.schema==='ontology-shacl-request/v2'?request.expectations.digest:null};
}
export type SHACLStatus='CONFORMS'|'NONCONFORMING'|'VALIDATION_FAILURE'|'INVALID_INPUT'|'MISSING_IMPORT'|'INCOMPLETE_COVERAGE'|'UNSUPPORTED'|'TIMEOUT'|'CANCELLED'|'FAILED';
export interface SHACLResponse {
  schema:'ontology-shacl-result/v2';requestId:string;requestDigest:string;closureDigest:string;viewDigest:string;shapesDigest:string;expectationsDigest:string|null;configurationDigest:string;toolchainDigest:string;
  status:SHACLStatus;complete:boolean;elapsedMs:number;result:Json;error:{code:string;message:string}|null;
}

const {expectations:_,...properties}=SHACL_SCHEMA.properties;
const graphSchema={...SHACL_SCHEMA,$id:'urn:evopilot:ontology:shacl-graph-request:v2',title:'SHACLGraphRequest',required:SHACL_SCHEMA.required.filter(k=>k!=='expectations'),properties:{...properties,schema:{type:'string',const:'ontology-shacl-graph-request/v2'}}};
const validateGraph=new Ajv2020({strict:true,ownProperties:true}).addSchema(MODEL_SCHEMA).compile<SHACLGraphRequest>(graphSchema);
export function validateSHACLGraphRequest(value:unknown):asserts value is SHACLGraphRequest {
  boundedJSON(value,SHACL_LIMITS.requestBytes);if(!validateGraph(value))fail('SHACL_SCHEMA','Graph inspection request differs from the native v2 schema');
  validateSHACLDocuments(value,true);
}
