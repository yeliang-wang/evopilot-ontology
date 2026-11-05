import {SOURCE_SCHEMA,SOURCE_SCHEMA_DIGEST} from '../native-v2/schema.js';
import {MODEL_SCHEMA,MODEL_SCHEMA_DIGEST} from '../native-v2/model-schema.js';
import {SHACL_SCHEMA,SHACL_SCHEMA_DIGEST} from '../native-v2/shacl-schema.js';
import {EXPECTATIONS_SCHEMA,EXPECTATIONS_SCHEMA_DIGEST} from '../native-v2/expectations-schema.js';
import {hash} from '../standalone/validation.js';
import {fail,LIMITS} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {authoringExampleInputs} from './authoring-example.js';

type Schema=Record<string,Json>;
const identifier:Schema={type:'string',pattern:'^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$'};
const digest:Schema={type:'string',pattern:'^sha256:[a-f0-9]{64}$'};
const text=(maxLength=4000):Schema=>({type:'string',minLength:1,maxLength,pattern:'\\S'});
const integer=(minimum=0,maximum=Number.MAX_SAFE_INTEGER):Schema=>({type:'integer',minimum,maximum});
const nullable=(schema:Schema):Schema=>({oneOf:[schema,{type:'null'}]});
const array=(items:Schema,minItems=0,maxItems=1000):Schema=>({type:'array',items,minItems,maxItems});
const object=(properties:Record<string,Schema>,optional:string[]=[]):Schema=>({type:'object',additionalProperties:false,required:Object.keys(properties).filter(k=>!optional.includes(k)),properties});
const enumeration=(...values:string[]):Schema=>({type:'string',enum:values});
const ref=(value:string):Schema=>({$ref:value});
const page={offset:integer(),maxBytes:integer(4,65536)},asset={assetId:identifier},model={...asset,modelDigest:digest};
const input:Record<string,Schema>={};
const put=(names:string[],schema:Schema)=>{for(const name of names)input[name]=schema;};
put(['service.inspect','project.list','project.inspect'],object({}));
put(['guide.read'],object({topic:text(96)}));
put(['receipt.read'],object({requestId:identifier}));
put(['project.create'],object({label:text(200)}));
const intent=object({purpose:text(),mode:enumeration('forward','reverse','composition'),scope:text(),exclusions:array(text(),0,100),
  sources:array(object({id:identifier,locator:text(),revision:text(200),digest,origin:enumeration('source','requirement','design','reference')}),1,LIMITS.sourceBindings),
  requirements:array(object({id:identifier,statement:text()}),1,LIMITS.requirements)});
put(['intent.record'],object({definition:intent,previousDigest:nullable(digest)}));
put(['intent.read'],object({digest}));
put(['source.admit'],object({intentDigest:digest,sourceSet:ref(SOURCE_SCHEMA.$id)}));
put(['source.inspect'],object({sourceSetDigest:nullable(digest)}));
put(['source.metadata.read'],object({sourceSetDigest:digest,projectionDigest:digest,...page}));
put(['source.read'],object({sourceSetDigest:digest,sourceId:identifier,...page}));
put(['source.fragment.read'],object({sourceSetDigest:digest,fragmentId:identifier,...page}));
put(['model.record'],object({draft:ref(MODEL_SCHEMA.$id)}));
put(['model.list','expectations.list'],object({afterAssetId:nullable(identifier),limit:integer(1,100)}));
put(['model.inspect'],object({...asset,modelDigest:nullable(digest)}));
put(['model.metadata.read'],object({...model,projectionDigest:digest,...page}));
put(['model.document.read'],object({...model,documentId:identifier,...page}));
put(['expectations.record'],object({definition:ref(EXPECTATIONS_SCHEMA.$id)}));
put(['expectations.inspect'],object({...asset,expectationsDigest:nullable(digest)}));
put(['expectations.metadata.read'],object({...asset,expectationsDigest:digest,projectionDigest:digest,...page}));
put(['expectations.read'],object({...asset,expectationsDigest:digest,...page}));
const query=object({format:enumeration('turtle','rdfxml','functional'),content:{type:'string',maxLength:8388608},digest});
const entities={...array(text(4096),1,1000),uniqueItems:true};
const task:Schema={oneOf:[object({kind:enumeration('legality','consistency')}),
  object({kind:enumeration('rdfGraph'),documentId:identifier}),
  object({kind:enumeration('entailment','satisfiability'),query}),
  object({kind:enumeration('classHierarchy','objectPropertyHierarchy','dataPropertyHierarchy','realization'),entities,direct:{type:'boolean'}}),
  object({kind:enumeration('identity'),entities}),object({kind:enumeration('explanation'),target:enumeration('inconsistency')}),
  object({kind:enumeration('explanation'),target:enumeration('entailment'),query})]};
put(['reasoning.start'],object({...model,task,timeoutMs:integer(1,120000)},['timeoutMs']));
put(['validation.start'],object({...model,timeoutMs:integer(1,120000),view:{oneOf:[object({kind:enumeration('asserted')}),object({kind:enumeration('derived'),viewDigest:digest})]}},['timeoutMs','view']));
put(['shacl.start'],object({...model,timeoutMs:integer(1,60000),view:{oneOf:[object({kind:enumeration('asserted')}),object({kind:enumeration('derived'),viewDigest:digest})]}},['timeoutMs','view']));
put(['shacl.inspect','shacl.cancel','reasoning.inspect','validation.inspect','reasoning.cancel','validation.cancel'],object({taskId:identifier}));
put(['shacl.result.read','reasoning.result.read','validation.result.read'],object({taskId:identifier,...page}));
put(['shacl.list','reasoning.list','validation.list'],object({assetId:nullable(identifier),afterTaskId:nullable(identifier),limit:integer(1,100)}));
put(['view.record'],object({...model,taskIds:{...array(identifier,1,8),uniqueItems:true}}));
put(['view.inspect'],object({...asset,viewDigest:digest}));
put(['view.read'],object({...asset,viewDigest:digest,format:enumeration('json','turtle'),...page}));
put(['view.query'],object({...asset,viewDigest:digest,subject:nullable(text(4096)),predicate:nullable(text(4096)),object:nullable(text(4096)),offset:integer(),limit:integer(1,100)}));
put(['view.list','review.list','delivery.list'],object({...asset,afterDigest:nullable(digest),limit:integer(1,100)}));
put(['explanation.read'],object({...model,taskId:identifier,...page}));
const comparison=object({modelDigest:digest,validationTaskId:nullable(identifier),viewDigest:nullable(digest)});
put(['model.compare.read'],object({...asset,from:comparison,to:comparison,...page}));
put(['review.prepare'],object({...model,version:identifier,previousDeliveryDigest:nullable(digest),validationTaskId:identifier,explanationTaskIds:{...array(identifier,0,32),uniqueItems:true}}));
put(['review.inspect'],object({...asset,candidateDigest:digest}));
put(['review.report.read'],object({...asset,candidateDigest:digest,...page}));
put(['review.decide'],object({...asset,candidateDigest:digest,reportDigest:digest,previousDecisionDigest:nullable(digest),decision:enumeration('APPROVE','REJECT'),rationale:text(),instruction:object({reference:text(2000),content:text(8000)}),requirementIds:array(identifier,0,1000)}));
put(['delivery.record'],object({...asset,candidateDigest:digest,reviewDigest:digest}));
put(['delivery.inspect'],object({...asset,deliveryDigest:digest}));
put(['delivery.export.read'],object({...asset,deliveryDigest:digest,...page}));
const writes=new Set(['project.create','intent.record','source.admit','expectations.record','model.record','reasoning.start','reasoning.cancel','validation.start','validation.cancel','shacl.start','shacl.cancel','view.record','review.prepare','review.decide','delivery.record']);
const references:Record<string,Json[]>={
  'source.admit':[{digest:SOURCE_SCHEMA_DIGEST,value:SOURCE_SCHEMA as unknown as Json}],
  'model.record':[{digest:MODEL_SCHEMA_DIGEST,value:MODEL_SCHEMA as unknown as Json}],
  'expectations.record':[{digest:EXPECTATIONS_SCHEMA_DIGEST,value:EXPECTATIONS_SCHEMA as unknown as Json},{digest:MODEL_SCHEMA_DIGEST,value:MODEL_SCHEMA as unknown as Json},{digest:SHACL_SCHEMA_DIGEST,value:SHACL_SCHEMA as unknown as Json}],
};
export const OPERATION_CONTRACT_NAMES=Object.freeze(Object.keys(input).sort());
const examples=authoringExampleInputs();
export function operationContract(operation:string):Json {
  if(!Object.hasOwn(input,operation))fail('NOT_FOUND','Unknown operation input contract',404);
  const write=writes.has(operation),inputSchema={$schema:'https://json-schema.org/draft/2020-12/schema',...input[operation]};
  const contract={schema:'ontology-operation-input-contract/v1',operation,tool:write?'ontology_write':'ontology_read',inputSchema,
    referencedSchemas:references[operation]??[],requestEnvelope:{required:['workspaceId','serviceId','projectId','operation','input',...(write?['requestId','expectedRevision']:[])],identitySource:'ontology_context',revisionSource:'project.inspect'},
    rules:['Only fields marked required are mandatory; nullable required fields must be sent explicitly as null. Optional fields may be omitted.',
      'These schemas describe the request input. The owner additionally verifies original UTF-8 byte hashes, identity references, unique IDs, budgets, current parent bindings, authorization and project revision. Text limits also use JavaScript UTF-16 length and reject NUL.',
      'Copy actual returned immutable digests into subsequent operations. Never use a model digest as a source-set or expectations digest, and never guess the hash of an owner-normalized record.',
      'Raw content digests are sha256 of exact UTF-8 bytes, without normalization or added newline. UTF-8 fragment ranges have exclusive end. Structured owner hashes use recursively sorted JSON object keys, unchanged array order and JSON.stringify primitives.',
      'An uncertain write requires receipt.read with its original requestId before retry. Explicit schema rejection is not successful authoring. Keep the original request identity if the exact request will be retried.',
      'Examples are fictional protocol illustrations. They are not current project records, business approval, authority to call an operation, or release evidence.'],
    ...(operation==='shacl.start'?{taskLimits:{maximumMs:60000},validationScope:'GRAPH_ONLY',lifecycleCoverage:false}:{}),
    ...(operation==='reasoning.start'?{taskLimits:{maximumMs:120000,explanationMaximumMs:30000}}:{}),
    ...(operation==='review.decide'?{requires:'Separately authorized reviewer credential and actual user decision bound to this candidate/report. An author or Host model cannot approve itself.'}:{}),
    exampleInput:examples[operation]??null,exampleBindings:'Every all-zero digest is a placeholder for the exact identity returned by the selected owner. Example source/query/document content hashes are real hashes of their fictional bytes.',authority:false};
  return {...structuredClone(contract),contractDigest:hash(contract as unknown as Json)} as unknown as Json;
}
