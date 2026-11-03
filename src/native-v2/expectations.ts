import {Ajv2020} from 'ajv/dist/2020.js';
import {boundedJSON,validateDLRequest} from '../reasoning/request.js';
import {hash,hashBytes} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json,ModelingIntent} from '../standalone/types.js';
import type {SourceAdmission} from './sources.js';
import {MODEL_SCHEMA,MODEL_SCHEMA_DIGEST} from './model-schema.js';
import {SHACL_SCHEMA,SHACL_SCHEMA_DIGEST} from './shacl-schema.js';
import {EXPECTATIONS_SCHEMA,EXPECTATIONS_SCHEMA_DIGEST} from './expectations-schema.js';
import type {ExpectationSet} from './expectations-contracts.js';

const validate=new Ajv2020({strict:true,ownProperties:true}).addSchema(MODEL_SCHEMA).addSchema(SHACL_SCHEMA).compile<ExpectationSet>(EXPECTATIONS_SCHEMA);
export const EXPECTATIONS_CONTRACT_DIGEST=hash({expectations:EXPECTATIONS_SCHEMA_DIGEST,model:MODEL_SCHEMA_DIGEST,shacl:SHACL_SCHEMA_DIGEST});
export interface ExpectationAdmission {definition:ExpectationSet;digest:string;schemaDigest:string;coverage:{complete:boolean;missing:string[];requirements:number;cases:number};}
export function admitExpectations(value:unknown,sources:SourceAdmission,intent:ModelingIntent):ExpectationAdmission {
  boundedJSON(value,16*1024*1024);if(!validate(value))fail('EXPECTATIONS_SCHEMA','Expectation set differs from the native v2 schema');
  const definition=structuredClone(value);
  if(definition.sourceSetDigest!==sources.sourceSetDigest)fail('SOURCE_BINDING_CONFLICT','Expectations bind a different source snapshot',409);
  const required=new Set(intent.requirements.map(r=>r.id)),fragments=new Set(sources.fragments.map(f=>f.id)),declarations=new Map<string,ExpectationSet['requirements'][number]>(),caseIds=new Set<string>(),seenCases=new Set<string>();
  const distinct=(values:readonly string[])=>new Set(values).size===values.length;
  const provenance=(v:{sourceFragmentIds:readonly string[];rationale:string})=>{if(!v.rationale.trim()||!distinct(v.sourceFragmentIds)||v.sourceFragmentIds.some(id=>!fragments.has(id)))fail('EXPECTATIONS_SOURCE','Expected outcomes require distinct actual source fragments and a rationale');};
  for(const r of definition.requirements){
    if(!required.has(r.requirementId)||declarations.has(r.requirementId)||!distinct(r.methods))fail('EXPECTATIONS_REQUIREMENT','Unknown or duplicate independent requirement/method');
    provenance(r);
    const shacl=r.methods.includes('shacl');
    if(!distinct(r.targetShapeIris)||!distinct(r.constraintShapeIris)||(shacl?(!r.targetShapeIris.length||!r.constraintShapeIris.length):(r.targetShapeIris.length>0||r.constraintShapeIris.length>0)))fail('EXPECTATIONS_REQUIREMENT','SHACL requirements must declare their named target and constraint shapes');
    declarations.set(r.requirementId,r);
  }
  if(!distinct(definition.requiredShapes.map(s=>s.shapeIri))||definition.requiredShapes.some(s=>!distinct(s.requiredFocusIris))||definition.requiredShapes.reduce((n,s)=>n+s.requiredFocusIris.length,0)>20000)fail('EXPECTATIONS_COVERAGE','Invalid required shape/target ledger');
  const targetShapes=new Set(definition.requiredShapes.map(s=>s.shapeIri));
  if(definition.requirements.some(r=>r.targetShapeIris.some(iri=>!targetShapes.has(iri))))fail('EXPECTATIONS_COVERAGE','Requirement target shapes must occur in the fixed required ledger');
  for(const c of definition.cases){
    if(caseIds.has(c.id)||['model-consistency','model-shacl'].includes(c.id)||!distinct(c.requirementIds))fail('EXPECTATIONS_CASE','Duplicate/reserved case identity or repeated requirement');caseIds.add(c.id);provenance(c);
    const method=c.kind==='shacl'?'shacl':'owl';
    if(c.requirementIds.some(id=>!declarations.get(id)?.methods.includes(method)))fail('EXPECTATIONS_CASE','Case must bind an independently declared requirement/method');
    if(c.kind==='shacl'){
      validateDLRequest({schema:'ontology-dl-request/v1',requestId:c.id,closure:c.closure,task:{kind:'legality'}});
      if(!distinct(c.expectedViolationShapeIris)||c.expectedConforms&&c.expectedViolationShapeIris.length||!c.expectedConforms&&!c.expectedViolationShapeIris.length)fail('EXPECTATIONS_CASE','A negative SHACL oracle requires named violating constraints; a positive oracle has none');
      const declared=new Set(c.requirementIds.flatMap(id=>[...declarations.get(id)!.constraintShapeIris]));
      if(c.expectedViolationShapeIris.some(iri=>!declared.has(iri)))fail('EXPECTATIONS_CASE','Negative oracle references a constraint outside its independent requirements');
    }else{
      // The synthetic empty envelope checks only query bytes/format. It is never
      // executed and cannot provide a generated expected logical outcome.
      validateDLRequest({schema:'ontology-dl-request/v1',requestId:c.id,closure:{rootDocumentId:'query-envelope',documents:[{id:'query-envelope',documentIri:'urn:expectation:envelope',ontologyIri:null,versionIri:null,format:'functional',content:'Ontology()',digest:hashBytes('Ontology()')}],imports:[]},task:{kind:'entailment',query:c.query}});
    }
    const key=hash(c.kind==='shacl'?{kind:c.kind,closure:c.closure as unknown as Json}:{kind:c.kind,query:c.query as unknown as Json});
    if(seenCases.has(key))fail('EXPECTATIONS_CASE','Duplicate case input cannot inflate independent coverage');seenCases.add(key);
  }
  const missing:string[]=[];
  for(const iri of targetShapes)if(!definition.requirements.some(r=>r.targetShapeIris.includes(iri)))missing.push('shape:'+iri+':requirement');
  for(const id of required){
    const r=declarations.get(id);if(!r){missing.push(id+':declaration');continue;}
    for(const method of r.methods)for(const outcome of ['positive','negative']){
      const exists=definition.cases.some(c=>c.requirementIds.includes(id)&&(method==='owl'?c.kind==='owl-entailment'&&(c.expectedStatus==='ENTAILED')===(outcome==='positive'):c.kind==='shacl'&&c.expectedConforms===(outcome==='positive')));
      if(!exists)missing.push(id+':'+method+':'+outcome);
    }
    for(const iri of r.constraintShapeIris)if(!definition.cases.some(c=>c.kind==='shacl'&&!c.expectedConforms&&c.requirementIds.includes(id)&&c.expectedViolationShapeIris.includes(iri)))missing.push(id+':constraint:'+iri+':negative');
  }
  return {definition,digest:hash(definition as unknown as Json),schemaDigest:EXPECTATIONS_CONTRACT_DIGEST,coverage:{complete:missing.length===0,missing,requirements:required.size,cases:caseIds.size}};
}
