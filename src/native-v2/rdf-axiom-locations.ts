import type {DLDocument} from '../reasoning/types.js';
import {DL_LIMITS} from '../reasoning/types.js';
import {boundedJSON} from '../reasoning/request.js';
import {exact,digest,hashBytes} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import {axiomLocationValidator,AXIOM_LOCATION_LIMIT} from './axiom-locations.js';
import type {AxiomSourceFragment,AxiomSourceLocation} from './axiom-locations.js';

export const RDF_LOCATION_LIMITS=Object.freeze({records:200000,references:1000000,hashBytes:64*1024*1024});
type SourceKind='TOKEN'|'PROPERTY_LIST'|'COLLECTION'|'ITEM'|'PREFIX'|'BASE';
type GeneratedKind=null|'BLANK_PROPERTY_LIST'|'COLLECTION_FIRST'|'COLLECTION_REST'|'COLLECTION_TYPE';
export interface RDFSource extends AxiomSourceFragment {id:number;kind:SourceKind;}
export interface RDFTermSource {sourceId:number;inherited:boolean;generated:boolean;contextIds:number[];}
export interface RDFSourceContext {id:number;kind:'DOCUMENT'|'BUILTIN'|'PREFIX'|'BASE';prefixName:string|null;resolved:string;sourceId:number;dependencyContextIds:number[];}
export type RDFTripleObject={kind:'RESOURCE';value:string}|{kind:'LITERAL';lexical:string;language:string|null;datatype:string|null};
export interface RDFSourceOccurrence {id:number;triple:{subject:string;predicate:string;object:RDFTripleObject};subject:RDFTermSource;predicate:RDFTermSource;object:RDFTermSource;generatedKind:GeneratedKind;}
export interface RDFSourceDocument {schema:'ontology-rdf-source-document/v1';documentId:string;documentDigest:string;format:'turtle';parserId:'owlapi-turtle-occurrences:1';sources:RDFSource[];contexts:RDFSourceContext[];occurrences:RDFSourceOccurrence[];}
export interface RDFAxiomSourceLocation {schema:'ontology-axiom-source-location/v2';kind:'RDF_CONSTRUCTION';constructionOccurrenceIds:number[];parserContextOccurrenceIds:number[];}
interface Bytes {document:DLDocument;raw:Buffer;ranges:Map<string,string>;chargedRanges:Set<string>;functionalOccurrences:Set<string>;lineChecks:Map<number,number>;}
interface Table {value:RDFSourceDocument;sources:Map<number,RDFSource>;contexts:Map<number,RDFSourceContext>;occurrences:Map<number,RDFSourceOccurrence>;usedSources:Set<number>;usedContexts:Set<number>;usedOccurrences:Set<number>;}
const sourceKinds=new Set(['TOKEN','PROPERTY_LIST','COLLECTION','ITEM','PREFIX','BASE']);
const generatedKinds=new Set(['BLANK_PROPERTY_LIST','COLLECTION_FIRST','COLLECTION_REST','COLLECTION_TYPE']);
const builtins:Record<string,string>={
  'owl:':'http://www.w3.org/2002/07/owl#','rdfs:':'http://www.w3.org/2000/01/rdf-schema#',
  'rdf:':'http://www.w3.org/1999/02/22-rdf-syntax-ns#','xsd:':'http://www.w3.org/2001/XMLSchema#',
  'xml:':'http://www.w3.org/XML/1998/namespace',':':'http://www.semanticweb.org/owl/owlapi/turtle#',
};
function invalid(message:string):never {fail('EXPLANATION_PROTOCOL',message,409);}
function integer(v:unknown,minimum=0):v is number {return typeof v==='number'&&Number.isSafeInteger(v)&&v>=minimum;}
function scalar(v:unknown,empty=false):asserts v is string {
  if(typeof v!=='string'||!empty&&!v.length||Buffer.from(v,'utf8').toString('utf8')!==v)invalid('RDF source metadata requires Unicode scalar strings');
}

/** Verifies byte integrity and the closed reference graph of the retained worker
 * result. It does not independently reconstruct RDF parsing or OWL attribution. */
export function rdfAxiomLocationValidator(documents:readonly DLDocument[],input:unknown){
  boundedJSON(input,DL_LIMITS.outputBytes);
  if(!Array.isArray(input)||input.length>DL_LIMITS.documents)invalid('Bounded RDF source document tables required');
  const originals=new Map<string,DLDocument>();
  for(const d of documents){if(originals.has(d.id))invalid('Duplicate source document identity');originals.set(d.id,d);}
  const bytes=new Map<string,Bytes>(),tables=new Map<string,Table>(),functional=axiomLocationValidator();
  let records=0,references=0,hashedBytes=0,originalBytes=0,finished=false;
  function active(){if(finished)invalid('Source location validation is already finished');}
  function record(n=1){records+=n;if(records>RDF_LOCATION_LIMITS.records)invalid('Source location record budget exceeded');}
  function reference(n=1){references+=n;if(references>RDF_LOCATION_LIMITS.references)invalid('Source location reference budget exceeded');}
  function original(document:DLDocument):Bytes {
    const d=originals.get(document.id);
    if(!d||d.digest!==document.digest||d.format!==document.format||d.documentIri!==document.documentIri||d.content!==document.content)invalid('Source document differs from the exact closure');
    let state=bytes.get(d.id);if(state)return state;
    const raw=Buffer.from(d.content,'utf8');
    if(raw.toString('utf8')!==d.content||raw.length>DL_LIMITS.documentBytes||(originalBytes+=raw.length)>DL_LIMITS.closureBytes||hashBytes(raw)!==d.digest)invalid('Source document byte identity or budget differs');
    state={document:d,raw,ranges:new Map(),chargedRanges:new Set(),functionalOccurrences:new Set(),lineChecks:new Map()};bytes.set(d.id,state);return state;
  }
  function range(v:Record<string,unknown>,state:Bytes):{start:number;end:number;key:string}{
    const {start,end}=v;
    if(!integer(start)||!integer(end)||start>=end||end>state.raw.length)invalid('Invalid source coordinates');
    if((state.raw[start]&0xc0)===0x80||end<state.raw.length&&(state.raw[end]&0xc0)===0x80)invalid('Source coordinates split UTF-8');
    return {start,end,key:start+':'+end};
  }
  function chargeRange(state:Bytes,r:{start:number;end:number;key:string}){
    if(state.chargedRanges.has(r.key))return;
    hashedBytes+=r.end-r.start;if(hashedBytes>RDF_LOCATION_LIMITS.hashBytes)invalid('Source range hashing budget exceeded');
    state.chargedRanges.add(r.key);
  }
  function span(v:Record<string,unknown>,state:Bytes):AxiomSourceFragment {
    const r=range(v,state),{start,end,key}=r,{startLine,endLine}=v;
    if(!integer(startLine,1)||!integer(endLine,startLine)||endLine>state.raw.length+1)invalid('Invalid RDF source coordinates');
    digest(v.fragmentDigest);chargeRange(state,r);
    let actual=state.ranges.get(key);
    if(actual===undefined){actual=hashBytes(state.raw.subarray(start,end));state.ranges.set(key,actual);}
    if(actual!==v.fragmentDigest)invalid('RDF source fragment digest differs from original bytes');
    for(const [offset,line] of [[start,startLine],[end-1,endLine]]){
      const prior=state.lineChecks.get(offset);if(prior!==undefined&&prior!==line)invalid('Contradictory source line coordinates');state.lineChecks.set(offset,line);
    }
    return {start,end,fragmentDigest:v.fragmentDigest,startLine,endLine};
  }
  function ids(v:unknown,nonempty=false):number[] {
    if(!Array.isArray(v)||nonempty&&!v.length)invalid('Ordered source reference list required');
    reference(v.length);let previous=0;
    return v.map(n=>{if(!integer(n,1)||n<=previous)invalid('Source references must be unique ascending positive integers');previous=n;return n;});
  }
  function entries<T extends {id:number}>(v:unknown,parse:(v:unknown)=>T):T[]{
    if(!Array.isArray(v))invalid('Source table must be an array');record(v.length);let previous=0;
    return v.map(item=>{const result=parse(item);if(!integer(result.id,1)||result.id<=previous)invalid('Source table IDs must be unique ascending positive integers');previous=result.id;return result;});
  }
  let previousDocument:string|null=null;
  for(const value of input){
    exact(value,['schema','documentId','documentDigest','format','parserId','sources','contexts','occurrences']);
    if(value.schema!=='ontology-rdf-source-document/v1'||value.format!=='turtle'||value.parserId!=='owlapi-turtle-occurrences:1'||typeof value.documentId!=='string'||previousDocument!==null&&value.documentId<=previousDocument)invalid('RDF source document table identity/order differs');
    previousDocument=value.documentId;const d=originals.get(value.documentId);
    if(!d||d.format!=='turtle'||d.digest!==value.documentDigest)invalid('RDF source table is outside its exact Turtle document');
    const state=original(d);
    const sources=entries(value.sources,v=>{exact(v,['id','kind','start','end','fragmentDigest','startLine','endLine']);if(typeof v.kind!=='string'||!sourceKinds.has(v.kind))invalid('Unknown Turtle source kind');return {id:v.id as number,kind:v.kind as SourceKind,...span(v,state)};});
    const sourceMap=new Map(sources.map(s=>[s.id,s]));
    const contexts=entries(value.contexts,v=>{
      exact(v,['id','kind','prefixName','resolved','sourceId','dependencyContextIds']);
      if(!['DOCUMENT','BUILTIN','PREFIX','BASE'].includes(String(v.kind))||!integer(v.sourceId))invalid('Invalid Turtle parser context');scalar(v.resolved);
      const dependencies=ids(v.dependencyContextIds),kind=v.kind as RDFSourceContext['kind'];
      if(kind==='DOCUMENT'||kind==='BASE'){
        if(v.prefixName!==null)invalid('Base/document context cannot name a prefix');
      }else{scalar(v.prefixName);if(!v.prefixName.endsWith(':'))invalid('Prefix context requires its exact prefix name');}
      if(kind==='DOCUMENT'){
        if(v.sourceId!==0||v.resolved!==d.documentIri||dependencies.length)invalid('Implicit document context differs');
      }else if(kind==='BUILTIN'){
        if(v.sourceId!==0||!Object.hasOwn(builtins,v.prefixName as string)||builtins[v.prefixName as string]!==v.resolved||dependencies.length)invalid('Implicit builtin context differs');
      }else{
        reference();const source=sourceMap.get(v.sourceId);
        if(!source||source.kind!==kind)invalid('Explicit context has no matching original directive source');
      }
      return {id:v.id as number,kind,prefixName:v.prefixName as string|null,resolved:v.resolved,sourceId:v.sourceId,dependencyContextIds:dependencies};
    });
    const contextMap=new Map(contexts.map(c=>[c.id,c])),implicit=new Set<string>();
    for(const c of contexts){
      if(c.kind==='DOCUMENT'||c.kind==='BUILTIN'){const key=c.kind+':'+c.prefixName;if(implicit.has(key))invalid('Duplicate implicit parser context');implicit.add(key);}
      for(const dependency of c.dependencyContextIds)if(dependency>=c.id||!contextMap.has(dependency))invalid('Parser context dependencies must form an earlier-ID DAG');
    }
    function term(v:unknown):RDFTermSource {
      exact(v,['sourceId','inherited','generated','contextIds']);
      if(!integer(v.sourceId,1)||typeof v.inherited!=='boolean'||typeof v.generated!=='boolean')invalid('Invalid RDF term source');reference();
      const source=sourceMap.get(v.sourceId);if(!source||source.kind==='PREFIX'||source.kind==='BASE')invalid('Term has no original token/construct source');
      if(v.generated&&!['PROPERTY_LIST','COLLECTION','ITEM'].includes(source.kind))invalid('Generated term lacks its original construct');
      const contextIds=ids(v.contextIds);for(const id of contextIds)if(!contextMap.has(id))invalid('Term references an absent parser context');
      return {sourceId:v.sourceId,inherited:v.inherited,generated:v.generated,contextIds};
    }
    function triple(v:unknown):RDFSourceOccurrence['triple'] {
      exact(v,['subject','predicate','object']);scalar(v.subject);scalar(v.predicate);
      const o=v.object;exact(o,['kind'],['value','lexical','language','datatype']);let object:RDFTripleObject;
      if(o.kind==='RESOURCE'){exact(o,['kind','value']);scalar(o.value);object={kind:'RESOURCE',value:o.value};}
      else if(o.kind==='LITERAL'){
        exact(o,['kind','lexical','language','datatype']);scalar(o.lexical,true);
        if(o.language!==null)scalar(o.language);if(o.datatype!==null)scalar(o.datatype);
        if(o.language!==null&&o.datatype!==null)invalid('Literal language and datatype callbacks are exclusive');
        object={kind:'LITERAL',lexical:o.lexical,language:o.language as string|null,datatype:o.datatype as string|null};
      }else invalid('Unknown RDF triple object kind');
      return {subject:v.subject,predicate:v.predicate,object};
    }
    const occurrences=entries(value.occurrences,v=>{
      exact(v,['id','triple','subject','predicate','object','generatedKind']);
      if(v.generatedKind!==null&&(typeof v.generatedKind!=='string'||!generatedKinds.has(v.generatedKind)))invalid('Unknown generated Turtle triple kind');
      const subject=term(v.subject),predicate=term(v.predicate),object=term(v.object);
      if(v.generatedKind!==null&&![subject,predicate,object].some(t=>t.generated))invalid('Generated triple lacks an original generating construct');
      return {id:v.id as number,triple:triple(v.triple),subject,predicate,object,generatedKind:v.generatedKind as GeneratedKind};
    });
    const parsed:RDFSourceDocument={schema:'ontology-rdf-source-document/v1',documentId:d.id,documentDigest:d.digest,format:'turtle',parserId:'owlapi-turtle-occurrences:1',sources,contexts,occurrences};
    tables.set(d.id,{value:parsed,sources:sourceMap,contexts:contextMap,occurrences:new Map(occurrences.map(o=>[o.id,o])),usedSources:new Set(),usedContexts:new Set(),usedOccurrences:new Set()});
  }
  function use(table:Table,id:number){
    const occurrence=table.occurrences.get(id);if(!occurrence)invalid('Axiom references an absent same-document RDF occurrence');
    if(table.usedOccurrences.has(id))return;table.usedOccurrences.add(id);
    const pending:number[]=[];
    for(const term of [occurrence.subject,occurrence.predicate,occurrence.object]){table.usedSources.add(term.sourceId);pending.push(...term.contextIds);}
    while(pending.length){const id=pending.pop()!;if(table.usedContexts.has(id))continue;table.usedContexts.add(id);const c=table.contexts.get(id)!;if(c.sourceId)table.usedSources.add(c.sourceId);pending.push(...c.dependencyContextIds);}
  }
  function validate(document:DLDocument,value:unknown):RDFAxiomSourceLocation {
    active();original(document);exact(value,['schema','kind','constructionOccurrenceIds','parserContextOccurrenceIds']);
    if(document.format!=='turtle'||value.schema!=='ontology-axiom-source-location/v2'||value.kind!=='RDF_CONSTRUCTION')invalid('Unsupported RDF axiom source group');
    const table=tables.get(document.id);if(!table)invalid('Supporting Turtle document has no source table');
    const constructionOccurrenceIds=ids(value.constructionOccurrenceIds,true),parserContextOccurrenceIds=ids(value.parserContextOccurrenceIds);
    for(const id of constructionOccurrenceIds)use(table,id);for(const id of parserContextOccurrenceIds)use(table,id);
    return {schema:'ontology-axiom-source-location/v2',kind:'RDF_CONSTRUCTION',constructionOccurrenceIds,parserContextOccurrenceIds};
  }
  function validateFunctional(document:DLDocument,value:unknown):AxiomSourceLocation {
    active();if(document.format!=='functional')invalid('Functional source group requires its original format');
    const state=original(document);exact(value,['schema','occurrences','context']);
    if(value.schema!=='ontology-axiom-source-location/v1'||!Array.isArray(value.occurrences)||!value.occurrences.length||value.occurrences.length>AXIOM_LOCATION_LIMIT||!Array.isArray(value.context)||value.context.length>AXIOM_LOCATION_LIMIT)invalid('Invalid Functional source group');
    record(value.occurrences.length+value.context.length);
    // Reserve work before invoking the unchanged v1 verifier. Reserved ranges
    // are not verified digests; an untrusted declaration never enters ranges.
    const pendingOccurrences=new Set<string>();
    function preflight(v:unknown,prefix:boolean){
      exact(v,['start','end','fragmentDigest','startLine','endLine',...(prefix?['kind']:[])]);
      if(prefix&&v.kind!=='PREFIX')invalid('Unsupported Functional prefix context');
      const r=range(v,state);digest(v.fragmentDigest);
      if(!prefix){
        if(state.functionalOccurrences.has(r.key)||pendingOccurrences.has(r.key))invalid('Functional source occurrences must not overlap');
        pendingOccurrences.add(r.key);
      }
      chargeRange(state,r);
    }
    for(const occurrence of value.occurrences){exact(occurrence,['fragments']);if(!Array.isArray(occurrence.fragments)||occurrence.fragments.length!==1)invalid('Functional occurrence requires one complete axiom range');preflight(occurrence.fragments[0],false);}
    for(const context of value.context)preflight(context,true);
    const result=functional.validate(document,value);
    // v1 has now checked every axiom range and the immutable shared prefix
    // context. Its finish() retains the original overlap and line verification.
    for(const s of [...result.context,...result.occurrences.flatMap(o=>o.fragments)]){
      const key=s.start+':'+s.end,prior=state.ranges.get(key);
      if(prior!==undefined&&prior!==s.fragmentDigest)invalid('Verified Functional range digest changed');
      state.ranges.set(key,s.fragmentDigest);
    }
    for(const key of pendingOccurrences)state.functionalOccurrences.add(key);
    return result;
  }
  function finish(){
    active();functional.finish();
    for(const table of tables.values())if(!table.usedOccurrences.size||table.usedOccurrences.size!==table.occurrences.size||table.usedContexts.size!==table.contexts.size||table.usedSources.size!==table.sources.size)invalid('RDF source tables must contain exactly the referenced dependency closure');
    for(const state of bytes.values()){
      let offset=0,line=1;
      for(const [target,expected] of [...state.lineChecks].sort((a,b)=>a[0]-b[0])){
        while(offset<target){const b=state.raw[offset];if(b===10||b===13&&state.raw[offset+1]!==10)line++;offset++;}
        if(line!==expected)invalid('Source line number differs from original bytes');
      }
    }
    finished=true;
  }
  return {validate,functional:validateFunctional,finish,tables:[...tables.values()].map(t=>t.value)};
}
