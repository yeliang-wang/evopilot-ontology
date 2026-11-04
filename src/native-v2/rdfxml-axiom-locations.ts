import type {DLDocument} from '../reasoning/types.js';
import {DL_LIMITS} from '../reasoning/types.js';
import {boundedJSON} from '../reasoning/request.js';
import {exact,digest,hashBytes} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import {rdfLocationBudget} from './rdf-axiom-locations.js';
import type {RDFLocationBudget,RDFAxiomSourceLocation,RDFTripleObject} from './rdf-axiom-locations.js';
import type {AxiomSourceFragment} from './axiom-locations.js';

type SourceKind='ELEMENT_NAME'|'ATTRIBUTE'|'TEXT'|'CDATA'|'ELEMENT'|'ENTITY_REFERENCE'|'ENTITY_DECLARATION'|'DTD_ATTRIBUTE_DECLARATION'|'NAMESPACE'|'XML_BASE'|'XML_LANG';
type ContextKind='DOCUMENT'|'BUILTIN'|'NAMESPACE'|'XML_BASE'|'XML_LANG'|'ENTITY_DECLARATION'|'ENTITY_REFERENCE'|'DTD_ATTRIBUTE_DEFAULT'|'DTD_ATTRIBUTE_DECLARATION'|'RDF_LI_ORDER'|'REIFICATION_ORDER';
type GeneratedKind=null|'TYPED_NODE'|'PROPERTY_ATTRIBUTE'|'PARSE_TYPE_RESOURCE'|'COLLECTION_FIRST'|'COLLECTION_REST'|'COLLECTION_TYPE'|'RDF_LI'|'REIFICATION'|'ENTITY_EXPANSION'|'PARSE_TYPE_LITERAL'|'REIFICATION_BAG';
export interface RDFXMLSource extends AxiomSourceFragment {id:number;kind:SourceKind;}
export interface RDFXMLSourceSet {id:number;sourceIds:number[];}
export interface RDFXMLTermSource {sourceSetId:number;inherited:boolean;generated:boolean;contextIds:number[];}
export interface RDFXMLContext {id:number;kind:ContextKind;name:string|null;resolved:string|null;sourceSetId:number;dependencyContextIds:number[];}
export interface RDFXMLOccurrence {id:number;triple:{subject:string;predicate:string;object:RDFTripleObject};subject:RDFXMLTermSource;predicate:RDFXMLTermSource;object:RDFXMLTermSource;generatedKind:GeneratedKind;}
export interface RDFXMLSourceDocument {schema:'ontology-rdfxml-source-document/v1';documentId:string;documentDigest:string;format:'rdfxml';parserId:'owlapi-rdfxml-occurrences:1';sources:RDFXMLSource[];sourceSets:RDFXMLSourceSet[];contexts:RDFXMLContext[];occurrences:RDFXMLOccurrence[];}
interface Bytes {raw:Buffer;ranges:Map<string,string>;lineChecks:Map<number,number>;}
interface Table {value:RDFXMLSourceDocument;sourceSets:Map<number,RDFXMLSourceSet>;contexts:Map<number,RDFXMLContext>;occurrences:Map<number,RDFXMLOccurrence>;usedSources:Set<number>;usedSets:Set<number>;usedContexts:Set<number>;usedOccurrences:Set<number>;}
const sourceKinds=new Set(['ELEMENT_NAME','ATTRIBUTE','TEXT','CDATA','ELEMENT','ENTITY_REFERENCE','ENTITY_DECLARATION','DTD_ATTRIBUTE_DECLARATION','NAMESPACE','XML_BASE','XML_LANG']);
const contextKinds=new Set(['DOCUMENT','BUILTIN','NAMESPACE','XML_BASE','XML_LANG','ENTITY_DECLARATION','ENTITY_REFERENCE','DTD_ATTRIBUTE_DEFAULT','DTD_ATTRIBUTE_DECLARATION','RDF_LI_ORDER','REIFICATION_ORDER']);
const generatedKinds=new Set(['TYPED_NODE','PROPERTY_ATTRIBUTE','PARSE_TYPE_RESOURCE','COLLECTION_FIRST','COLLECTION_REST','COLLECTION_TYPE','RDF_LI','REIFICATION','ENTITY_EXPANSION','PARSE_TYPE_LITERAL','REIFICATION_BAG']);
function invalid(message:string):never {fail('EXPLANATION_PROTOCOL',message,409);}
function integer(value:unknown,minimum=0):value is number {return typeof value==='number'&&Number.isSafeInteger(value)&&value>=minimum;}
function scalar(value:unknown,empty=false):asserts value is string {
  if(typeof value!=='string'||!empty&&!value.length||Buffer.from(value,'utf8').toString('utf8')!==value)invalid('XML source metadata requires Unicode scalar strings');
}

/** Verify the retained worker's original byte fragments and closed reference
 * graph. This does not reconstruct XML parsing, entity expansion or OWL mapping. */
export function rdfxmlAxiomLocationValidator(documents:readonly DLDocument[],input:unknown,budget:RDFLocationBudget=rdfLocationBudget()){
  boundedJSON(input,DL_LIMITS.outputBytes);
  if(!Array.isArray(input)||input.length>DL_LIMITS.documents)invalid('Bounded XML source document tables required');
  const originals=new Map<string,DLDocument>();
  for(const d of documents){if(originals.has(d.id))invalid('Duplicate XML source document identity');originals.set(d.id,d);}
  const bytes=new Map<string,Bytes>(),tables=new Map<string,Table>();let finished=false;
  function active(){if(finished)invalid('XML source location validation is already finished');}
  function original(document:DLDocument):Bytes {
    const d=originals.get(document.id);
    if(!d||d.digest!==document.digest||d.format!==document.format||d.documentIri!==document.documentIri||d.content!==document.content)invalid('XML source document differs from its exact closure');
    let state=bytes.get(d.id);if(state)return state;
    const raw=Buffer.from(d.content,'utf8');if(raw.toString('utf8')!==d.content)invalid('XML source document has invalid Unicode');
    budget.original(d,raw.length);
    if(hashBytes(raw)!==d.digest)invalid('XML source document digest differs');
    state={raw,ranges:new Map(),lineChecks:new Map()};bytes.set(d.id,state);return state;
  }
  function span(value:Record<string,unknown>,document:DLDocument,state:Bytes):AxiomSourceFragment {
    const {start,end,startLine,endLine}=value;
    if(!integer(start)||!integer(end)||start>=end||end>state.raw.length||!integer(startLine,1)||!integer(endLine,startLine)||endLine>state.raw.length+1)invalid('Invalid XML source coordinates');
    if((state.raw[start]&0xc0)===0x80||end<state.raw.length&&(state.raw[end]&0xc0)===0x80)invalid('XML source coordinates split UTF-8');
    digest(value.fragmentDigest);budget.range(document.id,start,end);
    const key=start+':'+end;let actual=state.ranges.get(key);
    if(actual===undefined){actual=hashBytes(state.raw.subarray(start,end));state.ranges.set(key,actual);}
    if(actual!==value.fragmentDigest)invalid('XML source fragment digest differs from original bytes');
    for(const [offset,line] of [[start,startLine],[end-1,endLine]]){
      const previous=state.lineChecks.get(offset);if(previous!==undefined&&previous!==line)invalid('Contradictory XML source line coordinates');state.lineChecks.set(offset,line);
    }
    return {start,end,fragmentDigest:value.fragmentDigest,startLine,endLine};
  }
  function ids(value:unknown,nonempty=false):number[] {
    if(!Array.isArray(value)||nonempty&&!value.length)invalid('Ordered XML source reference list required');
    budget.reference(value.length);let previous=0;
    return value.map(id=>{if(!integer(id,1)||id<=previous)invalid('XML references must be unique ascending positive integers');previous=id;return id;});
  }
  function entries<T extends {id:number}>(value:unknown,parse:(value:unknown)=>T):T[]{
    if(!Array.isArray(value))invalid('XML source table must be an array');budget.record(value.length);let previous=0;
    return value.map(entry=>{const parsed=parse(entry);if(!integer(parsed.id,1)||parsed.id<=previous)invalid('XML table IDs must be unique ascending positive integers');previous=parsed.id;return parsed;});
  }
  let previousDocument:string|null=null;
  for(const value of input){
    exact(value,['schema','documentId','documentDigest','format','parserId','sources','sourceSets','contexts','occurrences']);
    if(value.schema!=='ontology-rdfxml-source-document/v1'||value.format!=='rdfxml'||value.parserId!=='owlapi-rdfxml-occurrences:1'||typeof value.documentId!=='string'||previousDocument!==null&&value.documentId<=previousDocument)invalid('XML source document identity or order differs');
    previousDocument=value.documentId;const d=originals.get(value.documentId);
    if(!d||d.format!=='rdfxml'||d.digest!==value.documentDigest)invalid('XML source table is outside its exact document');
    const state=original(d);
    const sources=entries(value.sources,v=>{exact(v,['id','kind','start','end','fragmentDigest','startLine','endLine']);if(typeof v.kind!=='string'||!sourceKinds.has(v.kind))invalid('Unknown XML source kind');return {id:v.id as number,kind:v.kind as SourceKind,...span(v,d,state)};});
    const sourceMap=new Map(sources.map(s=>[s.id,s])),memberships=new Set<string>();
    const sourceSets=entries(value.sourceSets,v=>{
      exact(v,['id','sourceIds']);const sourceIds=ids(v.sourceIds,true),key=sourceIds.join(',');
      if(memberships.has(key))invalid('XML source sets must intern identical membership');memberships.add(key);
      for(const id of sourceIds)if(!sourceMap.has(id))invalid('XML source set references an absent source');
      return {id:v.id as number,sourceIds};
    }),setMap=new Map(sourceSets.map(s=>[s.id,s]));
    const contexts=entries(value.contexts,v=>{
      exact(v,['id','kind','name','resolved','sourceSetId','dependencyContextIds']);
      if(typeof v.kind!=='string'||!contextKinds.has(v.kind)||!integer(v.sourceSetId))invalid('Invalid XML parser context');
      const kind=v.kind as ContextKind,dependencies=ids(v.dependencyContextIds);
      if(kind==='DOCUMENT'||kind==='BUILTIN'){
        if(v.sourceSetId!==0||dependencies.length)invalid('Implicit XML context cannot claim an original source or dependencies');
        if(kind==='DOCUMENT'&&(v.name!==null||v.resolved!==d.documentIri)||kind==='BUILTIN'&&(v.name!=='xml'||v.resolved!=='http://www.w3.org/XML/1998/namespace'))invalid('Implicit XML context differs');
      }else{
        budget.reference();if(!setMap.has(v.sourceSetId))invalid('Explicit XML context has no original source set');
        if(kind==='NAMESPACE'){scalar(v.name,true);scalar(v.resolved,true);}
        else if(kind==='XML_BASE'||kind==='XML_LANG'){
          if(v.name!==null)invalid('XML base/language context cannot name an entity');scalar(v.resolved,kind==='XML_LANG');
        }else if(kind==='ENTITY_DECLARATION'||kind==='ENTITY_REFERENCE'){
          scalar(v.name);if(v.resolved!==null)invalid('XML entity context cannot claim a resolved string');
        }else if(kind==='DTD_ATTRIBUTE_DEFAULT'||kind==='DTD_ATTRIBUTE_DECLARATION'){
          scalar(v.name);scalar(v.resolved,kind==='DTD_ATTRIBUTE_DEFAULT');
          if(!/^[^@]+@[^@]+$/.test(v.name))invalid('DTD attribute context requires element and attribute names');
        }else{
          if(v.name!==null)invalid('XML order context cannot name an entity');scalar(v.resolved);
          if(!/^[1-9][0-9]*$/.test(v.resolved))invalid('XML order context requires a positive decimal position');
        }
      }
      return {id:v.id as number,kind,name:v.name as string|null,resolved:v.resolved as string|null,sourceSetId:v.sourceSetId,dependencyContextIds:dependencies};
    }),contextMap=new Map(contexts.map(c=>[c.id,c])),implicit=new Set<string>();
    for(const c of contexts){
      if(c.kind==='DOCUMENT'||c.kind==='BUILTIN'){if(implicit.has(c.kind))invalid('Duplicate implicit XML parser context');implicit.add(c.kind);}
      for(const id of c.dependencyContextIds)if(id>=c.id||!contextMap.has(id))invalid('XML parser contexts require an earlier-ID dependency DAG');
    }
    function term(value:unknown):RDFXMLTermSource {
      exact(value,['sourceSetId','inherited','generated','contextIds']);
      if(!integer(value.sourceSetId,1)||typeof value.inherited!=='boolean'||typeof value.generated!=='boolean')invalid('Invalid XML term source');
      budget.reference();if(!setMap.has(value.sourceSetId))invalid('XML term has no original source set');
      const contextIds=ids(value.contextIds);for(const id of contextIds)if(!contextMap.has(id))invalid('XML term references an absent parser context');
      return {sourceSetId:value.sourceSetId,inherited:value.inherited,generated:value.generated,contextIds};
    }
    function triple(value:unknown):RDFXMLOccurrence['triple'] {
      exact(value,['subject','predicate','object']);scalar(value.subject);scalar(value.predicate);
      const o=value.object;exact(o,['kind'],['value','lexical','language','datatype']);let object:RDFTripleObject;
      if(o.kind==='RESOURCE'){exact(o,['kind','value']);scalar(o.value);object={kind:'RESOURCE',value:o.value};}
      else if(o.kind==='LITERAL'){
        exact(o,['kind','lexical','language','datatype']);scalar(o.lexical,true);
        if(o.language!==null)scalar(o.language,true);if(o.datatype!==null)scalar(o.datatype);
        // RDF/XML's actual callback can retain inherited xml:lang alongside a
        // datatype. Its mapper applies datatype precedence; do not alter events.
        object={kind:'LITERAL',lexical:o.lexical,language:o.language as string|null,datatype:o.datatype as string|null};
      }else invalid('Unknown XML triple object kind');
      return {subject:value.subject,predicate:value.predicate,object};
    }
    const occurrences=entries(value.occurrences,v=>{
      exact(v,['id','triple','subject','predicate','object','generatedKind']);
      if(v.generatedKind!==null&&(typeof v.generatedKind!=='string'||!generatedKinds.has(v.generatedKind)))invalid('Unknown generated XML triple kind');
      const subject=term(v.subject),predicate=term(v.predicate),object=term(v.object);
      if(v.generatedKind!==null&&![subject,predicate,object].some(t=>t.generated))invalid('Generated XML triple lacks an original generating source set');
      return {id:v.id as number,triple:triple(v.triple),subject,predicate,object,generatedKind:v.generatedKind as GeneratedKind};
    });
    const parsed:RDFXMLSourceDocument={schema:'ontology-rdfxml-source-document/v1',documentId:d.id,documentDigest:d.digest,format:'rdfxml',parserId:'owlapi-rdfxml-occurrences:1',sources,sourceSets,contexts,occurrences};
    tables.set(d.id,{value:parsed,sourceSets:setMap,contexts:contextMap,occurrences:new Map(occurrences.map(o=>[o.id,o])),usedSources:new Set(),usedSets:new Set(),usedContexts:new Set(),usedOccurrences:new Set()});
  }
  function useSet(table:Table,id:number){
    if(table.usedSets.has(id))return;table.usedSets.add(id);
    for(const source of table.sourceSets.get(id)!.sourceIds)table.usedSources.add(source);
  }
  function use(table:Table,id:number){
    const occurrence=table.occurrences.get(id);if(!occurrence)invalid('Axiom references an absent same-document XML occurrence');
    if(table.usedOccurrences.has(id))return;table.usedOccurrences.add(id);const pending:number[]=[];
    for(const term of [occurrence.subject,occurrence.predicate,occurrence.object]){useSet(table,term.sourceSetId);for(const context of term.contextIds)pending.push(context);}
    while(pending.length){
      const id=pending.pop()!;if(table.usedContexts.has(id))continue;table.usedContexts.add(id);const c=table.contexts.get(id)!;
      if(c.sourceSetId)useSet(table,c.sourceSetId);for(const dependency of c.dependencyContextIds)pending.push(dependency);
    }
  }
  function validate(document:DLDocument,value:unknown):RDFAxiomSourceLocation {
    active();original(document);exact(value,['schema','kind','constructionOccurrenceIds','parserContextOccurrenceIds']);
    if(document.format!=='rdfxml'||value.schema!=='ontology-axiom-source-location/v2'||value.kind!=='RDF_CONSTRUCTION')invalid('Unsupported XML axiom source group');
    const table=tables.get(document.id);if(!table)invalid('Supporting XML document has no source table');
    const constructionOccurrenceIds=ids(value.constructionOccurrenceIds,true),parserContextOccurrenceIds=ids(value.parserContextOccurrenceIds);
    for(const id of constructionOccurrenceIds)use(table,id);for(const id of parserContextOccurrenceIds)use(table,id);
    return {schema:'ontology-axiom-source-location/v2',kind:'RDF_CONSTRUCTION',constructionOccurrenceIds,parserContextOccurrenceIds};
  }
  function finish(){
    active();
    for(const t of tables.values())if(!t.usedOccurrences.size||t.usedOccurrences.size!==t.occurrences.size||t.usedContexts.size!==t.contexts.size||t.usedSets.size!==t.sourceSets.size||t.usedSources.size!==t.value.sources.length)invalid('XML source tables must contain exactly the referenced dependency closure');
    for(const state of bytes.values()){
      let offset=0,line=1;
      for(const [target,expected] of [...state.lineChecks].sort((a,b)=>a[0]-b[0])){
        while(offset<target){const b=state.raw[offset];if(b===10||b===13&&state.raw[offset+1]!==10)line++;offset++;}
        if(line!==expected)invalid('XML source line number differs from original bytes');
      }
    }
    finished=true;
  }
  return {validate,finish,tables:[...tables.values()].map(t=>t.value)};
}
