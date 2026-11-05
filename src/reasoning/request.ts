import {exact,id,digest,hashBytes,hash} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {DL_LIMITS} from './types.js';
import type {DLRequest,DLQuery,DLClosure} from './types.js';

export function boundedJSON(value:unknown,byteLimit:number):asserts value is Json {
  let nodes=0;const active=new Set<object>();
  const visit=(v:unknown,depth:number):void=>{
    if(++nodes>30000||depth>24)fail('INPUT_LIMIT','Reasoning JSON structure budget exceeded');
    if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return;
    if(!v||typeof v!=='object'||active.has(v)||!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('INVALID_INPUT','Plain finite acyclic JSON required');
    if(Object.getOwnPropertySymbols(v).length||Array.isArray(v)&&(v.length>30000||Reflect.ownKeys(v).length!==v.length+1))fail('INVALID_INPUT','Dense plain JSON arrays and string keys required');
    active.add(v);
    for(const [key,d] of Object.entries(Object.getOwnPropertyDescriptors(v))){
      if(Array.isArray(v)&&key==='length')continue;
      if(!('value' in d)||['__proto__','constructor','prototype'].includes(key))fail('INVALID_INPUT','Unsafe JSON member');visit(d.value,depth+1);
    }active.delete(v);
  };visit(value,0);
  if(Buffer.byteLength(JSON.stringify(value))>byteLimit)fail('INPUT_LIMIT','Reasoning JSON byte budget exceeded');
}

function iri(value:unknown):asserts value is string {
  if(typeof value!=='string'||Buffer.byteLength(value)>4096||!(/^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]*$/u.test(value)))fail('INVALID_INPUT','Absolute bounded IRI required');
}
function query(value:unknown):asserts value is DLQuery {
  if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_INPUT','Query document required');
  const v=value as Record<string,unknown>;
  if(!['turtle','rdfxml','functional'].includes(v.format as string)||typeof v.content!=='string'||Buffer.byteLength(v.content)>DL_LIMITS.documentBytes)fail('INVALID_INPUT','Bounded supported ontology document required');
  // Reject lone UTF-16 surrogates rather than silently hashing replacement characters.
  if(v.content!==Buffer.from(v.content).toString('utf8'))fail('INVALID_INPUT','Ontology document must contain Unicode scalar values');
  digest(v.digest);if(hashBytes(v.content)!==v.digest)fail('DIGEST_MISMATCH','Ontology document bytes differ from their binding',409);
}
export function validateDLRequest(value:unknown):asserts value is DLRequest {
  // A single JSON envelope can contain a bounded text document, not a deeply nested graph.
  boundedJSON(value,DL_LIMITS.requestBytes);exact(value,['schema','requestId','closure','task']);
  if(value.schema!=='ontology-dl-request/v1')fail('INVALID_INPUT','Unknown reasoning request schema');id(value.requestId);
  exact(value.closure,['rootDocumentId','documents','imports']);id(value.closure.rootDocumentId);
  const c=value.closure;id(c.rootDocumentId);
  if(!Array.isArray(c.documents)||!c.documents.length||c.documents.length>DL_LIMITS.documents||!Array.isArray(c.imports)||c.imports.length>DL_LIMITS.imports)fail('INPUT_LIMIT','Import closure count budget exceeded');
  const documents=new Map<string,Record<string,unknown>>(),aliases=new Map<string,string>();let bytes=0;
  for(const d of c.documents){
    exact(d,['id','documentIri','ontologyIri','versionIri','format','content','digest']);id(d.id);iri(d.documentIri);query(d);bytes+=Buffer.byteLength(d.content);
    if(documents.has(d.id))fail('INVALID_INPUT','Duplicate document identity');documents.set(d.id,d);
    if(d.ontologyIri!==null)iri(d.ontologyIri);if(d.versionIri!==null){iri(d.versionIri);if(d.ontologyIri===null)fail('INVALID_INPUT','Version IRI requires ontology IRI');}
    for(const alias of [d.documentIri,d.ontologyIri,d.versionIri])if(alias!==null){const owner=aliases.get(alias as string);if(owner&&owner!==d.id)fail('IMPORT_CONFLICT','Import identity resolves to multiple documents',409);aliases.set(alias as string,d.id);}
  }
  if(bytes>DL_LIMITS.closureBytes)fail('INPUT_LIMIT','Import closure byte budget exceeded');
  if(!documents.has(c.rootDocumentId))fail('MISSING_IMPORT','Root document is missing');
  const edges=new Map<string,string[]>(),keys=new Set<string>();
  for(const e of c.imports){exact(e,['from','iri','to']);id(e.from);id(e.to);iri(e.iri);
    if(!documents.has(e.from)||!documents.has(e.to))fail('MISSING_IMPORT','Pinned dependency is absent');
    if(aliases.get(e.iri)!==e.to)fail('IMPORT_CONFLICT','Import IRI differs from target document identity',409);
    const key=e.from+'\0'+e.iri;if(keys.has(key))fail('INVALID_INPUT','Duplicate import binding');keys.add(key);
    edges.set(e.from,[...(edges.get(e.from)??[]),e.to]);
  }
  const reached=new Set<string>();let traversals=0;
  const visit=(at:string,path:Set<string>):void=>{if(++traversals>8192)fail('INPUT_LIMIT','Import traversal budget exceeded');if(path.has(at))return;if(path.size>=DL_LIMITS.importDepth)fail('INPUT_LIMIT','Import depth budget exceeded');reached.add(at);const next=new Set(path).add(at);for(const to of edges.get(at)??[])visit(to,next);};
  visit(c.rootDocumentId,new Set());if(reached.size!==documents.size)fail('INVALID_INPUT','Closure includes unreachable documents');
  const task=value.task;exact(task,['kind'],['query','entities','direct','target','documentId']);
  switch(task.kind){
    case 'legality':case 'consistency':exact(task,['kind']);break;
    case 'rdfGraph':{
      exact(task,['kind','documentId']);id(task.documentId);const selected=documents.get(task.documentId);
      if(!selected||!['turtle','rdfxml'].includes(selected.format as string))fail('INVALID_INPUT','RDF graph parsing requires an admitted Turtle or RDF/XML document');break;
    }
    case 'entailment':case 'satisfiability':exact(task,['kind','query']);exact(task.query,['format','content','digest']);query(task.query);break;
    case 'classHierarchy':case 'objectPropertyHierarchy':case 'dataPropertyHierarchy':case 'realization':case 'identity':
      exact(task,task.kind==='identity'?['kind','entities']:['kind','entities','direct']);
      if(task.kind!=='identity'&&typeof task.direct!=='boolean')fail('INVALID_INPUT','Direct hierarchy selection required');
      if(!Array.isArray(task.entities)||!task.entities.length||task.entities.length>DL_LIMITS.entities||new Set(task.entities).size!==task.entities.length)fail('INPUT_LIMIT','Finite distinct entity scope required');
      task.entities.forEach(iri);break;
    case 'explanation':
      if(task.target==='inconsistency')exact(task,['kind','target']);
      else if(task.target==='entailment'){exact(task,['kind','target','query']);exact(task.query,['format','content','digest']);query(task.query);}
      else fail('INVALID_INPUT','Explanation target required');break;
    default:fail('INVALID_INPUT','Unknown reasoning task');
  }
  if(Buffer.byteLength(JSON.stringify(value))>DL_LIMITS.requestBytes)fail('INPUT_LIMIT','Reasoning request byte budget exceeded');
}
export function closureDigest(closure:DLClosure):string {
  const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
  return hash({rootDocumentId:closure.rootDocumentId,documents:closure.documents.map(({content:_,...identity})=>identity).sort((a,b)=>compare(a.id,b.id)),imports:[...closure.imports].sort((a,b)=>compare(a.from+'\0'+a.iri,b.from+'\0'+b.iri))});
}
