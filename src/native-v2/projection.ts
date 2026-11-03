import {Ajv2020} from 'ajv/dist/2020.js';
import {MODEL_SCHEMA} from './model-schema.js';
import {PROJECTION_SCHEMA} from './projection-schema.js';
import type {DerivedView,TaskBinding,Triple} from './projection-contracts.js';
import type {ModelAdmission} from './models.js';
import type {DLRequest,DLResponse} from '../reasoning/types.js';
import {exact,hash} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

export const VIEW_LIMITS=Object.freeze({tasks:8,triples:50000,bytes:16*1024*1024,pageBytes:65536});
const validate=new Ajv2020({strict:true,ownProperties:true}).addSchema(MODEL_SCHEMA).compile<DerivedView>(PROJECTION_SCHEMA);
export interface ProjectionTask {taskId:string;request:DLRequest;result:DLResponse;resultDigest:string;}
export function projectionIRI(value:unknown):asserts value is string {
  if(typeof value!=='string'||Buffer.byteLength(value)>4096||value!==Buffer.from(value).toString('utf8')||!(/^[A-Za-z][A-Za-z0-9+.-]*:[^\u0000-\u0020<>"{}|\\^`]*$/u.test(value)))fail('PROJECTION_IRI','Bounded absolute RDF IRI required');
}
export function checkProjection(value:unknown):asserts value is DerivedView {
  if(Buffer.byteLength(JSON.stringify(value))>VIEW_LIMITS.bytes)fail('VIEW_LIMIT','Named projection exceeds its byte budget',409);
  if(!validate(value))fail('PROJECTION_SCHEMA','Named projection differs from its v2 schema',409);
}
export function projectionTurtle(view:DerivedView):string {
  return view.triples.map(t=>'<'+t.subject+'> <'+t.predicate+'> <'+t.object+'> .\n').join('')||'# Empty named projection.\n';
}
export function projectResults(model:ModelAdmission,values:ProjectionTask[]):DerivedView {
  if(!values.length||values.length>VIEW_LIMITS.tasks||new Set(values.map(v=>v.taskId)).size!==values.length)fail('PROJECTION_TASKS','Select 1–8 distinct completed named projection tasks');
  const triples=new Map<string,{subject:string;predicate:string;object:string;taskIds:Set<string>}>(),bindings:TaskBinding[]=[];
  let bytes=0;
  for(const value of [...values].sort((a,b)=>a.taskId<b.taskId?-1:1)){
    const {taskId,request,result}=value,task=request.task;
    if(!('entities' in task))fail('PROJECTION_TASK_KIND','Only explicit named hierarchy, realization or identity tasks produce a graph view',409);
    if(result.status!=='COMPLETED'||!result.complete||result.error!==null)fail('PROJECTION_INCOMPLETE','Incomplete or inconsistent reasoning cannot produce a named view',409);
    const data=result.result;exact(data,['semantics','axiomCount','legal','consistent','projection','requestedEntities','allLogicalConsequences','entities'],['reasoningEngine','engineSelectionPolicy','unknownUnicodeBlocks']);
    if(data.semantics!=='OWL_2_DL_DIRECT'||data.legal!==true||data.consistent!==true||data.projection!=='NAMED_REQUESTED_ENTITIES'||data.allLogicalConsequences!==false||hash(data.requestedEntities as Json)!==hash(task.entities)||!Array.isArray(data.entities)||data.entities.length!==task.entities.length)fail('PROJECTION_RESULT','Reasoning result does not establish the selected named scope',409);
    let omitted=0;const seen=new Set<string>();
    const add=(subject:string,predicate:string,object:string):void=>{
      [subject,predicate,object].forEach(projectionIRI);const key=JSON.stringify([subject,predicate,object]),old=triples.get(key);
      if(old){old.taskIds.add(taskId);return;}
      bytes+=Buffer.byteLength(key)+taskId.length+128;
      if(triples.size>=VIEW_LIMITS.triples||bytes>VIEW_LIMITS.bytes)fail('VIEW_LIMIT','Named projection exceeds its fixed envelope; use a smaller explicit entity scope',409);
      triples.set(key,{subject,predicate,object,taskIds:new Set([taskId])});
    };
    for(const entry of data.entities){
      const fields=task.kind==='realization'?['iri','types']:task.kind==='identity'?['iri','same','different','physicalMerge']:task.kind==='classHierarchy'?['iri','equivalent','super','sub','satisfiable']:['iri','equivalent','super','sub'];
      exact(entry,fields);projectionIRI(entry.iri);const subject=entry.iri;
      if(seen.has(subject)||!task.entities.includes(subject))fail('PROJECTION_RESULT','Result contains a duplicate or unrequested entity',409);seen.add(subject);
      const names=(key:string):string[]=>{
        const list=entry[key];if(!Array.isArray(list)||list.some(v=>typeof v!=='string')||new Set(list).size!==list.length)fail('PROJECTION_RESULT','Named result values must be distinct strings',409);
        const output:string[]=[];
        for(const name of list){
          if(typeof name!=='string')fail('PROJECTION_RESULT','Named result value must be a string',409);
          if(task.kind==='objectPropertyHierarchy'){
            if(name==='owl:topObjectProperty'||name==='owl:bottomObjectProperty')output.push('http://www.w3.org/2002/07/owl#'+name.slice(4));
            else if(name.startsWith('<')&&name.endsWith('>')){const iri=name.slice(1,-1);projectionIRI(iri);output.push(iri);}
            else if(/^ObjectInverseOf\(<[^<>]+>\)$/.test(name)){projectionIRI(name.slice(17,-2));omitted++;}
            else fail('PROJECTION_RESULT','Unknown object-property expression serialization',409);
          }else{projectionIRI(name);output.push(name);}
        }return output;
      };
      if(task.kind==='realization')for(const type of names('types'))add(subject,'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',type);
      else if(task.kind==='identity'){
        if(entry.physicalMerge!==false)fail('PROJECTION_RESULT','Identity output must not merge source individuals',409);
        for(const same of names('same'))add(subject,'http://www.w3.org/2002/07/owl#sameAs',same);
        for(const different of names('different'))add(subject,'http://www.w3.org/2002/07/owl#differentFrom',different);
      }else{
        if(task.kind==='classHierarchy'&&typeof entry.satisfiable!=='boolean')fail('PROJECTION_RESULT','Class satisfiability missing',409);
        const relation=task.kind==='classHierarchy'?'subClassOf':'subPropertyOf',equivalent=task.kind==='classHierarchy'?'equivalentClass':'equivalentProperty';
        for(const name of names('equivalent'))add(subject,'http://www.w3.org/2002/07/owl#'+equivalent,name);
        for(const name of names('super'))add(subject,'http://www.w3.org/2000/01/rdf-schema#'+relation,name);
        for(const name of names('sub'))add(name,'http://www.w3.org/2000/01/rdf-schema#'+relation,subject);
      }
    }
    bindings.push({taskId,requestDigest:result.requestDigest,resultDigest:value.resultDigest,configurationDigest:result.configurationDigest,toolchainDigest:result.toolchainDigest,kind:task.kind,direct:'direct' in task?task.direct:null,entities:[...task.entities],omittedInverseExpressions:omitted});
  }
  const ordered:Triple[]=[...triples.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,t])=>({...t,taskIds:[...t.taskIds].sort()}));
  const view:DerivedView={schema:'ontology-derived-view/v2',assetId:model.draft.assetId,modelDigest:model.digest,sourceSetDigest:model.draft.sourceSetDigest,closureDigest:model.closureDigest,scope:'NAMED_REQUESTED_ENTITIES',composition:'ASSERTED_PLUS_NAMED_PROJECTION',allLogicalConsequences:false,tasks:bindings,triples:ordered};
  checkProjection(view);return view;
}
