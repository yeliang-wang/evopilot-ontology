import {Ajv2020} from 'ajv/dist/2020.js';
import {parseDocument,isNode} from 'yaml';
import {boundedJSON} from '../reasoning/request.js';
import {hash,hashBytes} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {SOURCE_SCHEMA,SOURCE_SCHEMA_DIGEST} from './schema.js';
import type {SourceSet,SourceDocument,SourceFragment} from './contracts.js';

export const SOURCE_LIMITS=Object.freeze({documentBytes:8*1024*1024,totalBytes:32*1024*1024,
  envelopeBytes:48*1024*1024,selectedBytes:32*1024*1024,jsonDepth:64,jsonNodes:100000});
const validate=new Ajv2020({strict:true,allErrors:false,ownProperties:true}).compile<SourceSet>(SOURCE_SCHEMA);
export interface ResolvedSourceFragment {
  readonly id:string;readonly sourceId:string;readonly sourceDigest:string;readonly fragmentDigest:string;
  readonly startByte:number;readonly endByte:number;
}
export interface SourceAdmission {
  readonly schema:'ontology-source-admission/v2';readonly sourceSetDigest:string;readonly schemaDigest:string;
  readonly sourceSet:SourceSet;readonly fragments:readonly ResolvedSourceFragment[];
  readonly authority:false;readonly businessConfirmed:false;readonly semanticValidation:'NOT_EVALUATED';
}
interface ParsedJSON {value:unknown;document:ReturnType<typeof parseDocument>}

function freeze<T>(value:T):T {
  if(value!==null&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;
}
function parseSourceJSON(content:string):ParsedJSON {
  let value:unknown;try{value=JSON.parse(content);}catch{fail('SOURCE_JSON_INVALID','JSON source has invalid JSON syntax');}
  const pending=[{value,depth:0}];let nodes=0;
  while(pending.length){
    const current=pending.pop()!;
    if(++nodes>SOURCE_LIMITS.jsonNodes||current.depth>SOURCE_LIMITS.jsonDepth)fail('INPUT_LIMIT','Source JSON structure budget exceeded');
    if(current.value!==null&&typeof current.value==='object'){
      const children=Object.values(current.value);
      if(nodes+pending.length+children.length>SOURCE_LIMITS.jsonNodes)fail('INPUT_LIMIT','Source JSON node budget exceeded');
      for(const child of children)pending.push({value:child,depth:current.depth+1});
    }
  }
  // JSON.parse establishes JSON grammar. The already pinned YAML parser supplies
  // exact lexical node spans and rejects duplicate decoded keys, never YAML input.
  // Numeric/string values are not reserialized or used as fragment identities.
  const document=parseDocument(content,{schema:'json',uniqueKeys:true,strict:true});
  if(document.errors.length||document.warnings.length)fail('SOURCE_JSON_AMBIGUOUS','JSON source has duplicate keys or unsupported lexical ambiguity');
  return {value,document};
}
function pointerRange(content:string,parsed:ParsedJSON,pointer:string):[number,number] {
  const tokens=pointer===''?[]:pointer.slice(1).split('/').map(t=>t.replace(/~1/g,'/').replace(/~0/g,'~'));
  let value=parsed.value;const path:(string|number)[]=[];
  for(const token of tokens){
    if(Array.isArray(value)){
      if(!/^(0|[1-9][0-9]*)$/.test(token))fail('SOURCE_FRAGMENT_MISSING','JSON Pointer requires an existing array index');
      const n=Number(token);if(!Number.isSafeInteger(n)||n>=value.length)fail('SOURCE_FRAGMENT_MISSING','JSON Pointer array index is absent');
      path.push(n);value=value[n];
    }else{
      if(value===null||typeof value!=='object'||!Object.hasOwn(value,token))fail('SOURCE_FRAGMENT_MISSING','JSON Pointer member is absent');
      path.push(token);value=(value as Record<string,unknown>)[token];
    }
  }
  const node=path.length?parsed.document.getIn(path,true):parsed.document.contents;
  if(!isNode(node)||!node.range)fail('SOURCE_FRAGMENT_MISSING','JSON Pointer has no exact source span');
  return [Buffer.byteLength(content.slice(0,node.range[0])),Buffer.byteLength(content.slice(0,node.range[1]))];
}
function resolveFragment(source:SourceDocument,fragment:SourceFragment,bytes:Buffer,parsed?:ParsedJSON):ResolvedSourceFragment {
  if(fragment.sourceDigest!==source.digest)fail('SOURCE_CHANGED','Fragment refers to different source bytes',409);
  const selector=fragment.selector;let start=0,end=bytes.length;
  if(selector.kind==='utf8-range'){
    start=selector.start;end=selector.end;
    if(start>end||end>bytes.length||start<bytes.length&&(bytes[start]&0xC0)===0x80||end<bytes.length&&(bytes[end]&0xC0)===0x80)fail('SOURCE_FRAGMENT_INVALID','UTF-8 range must use ordered code-point boundaries');
  }else if(selector.kind==='json-pointer'){
    if(source.format!=='json'||!parsed)fail('SOURCE_FRAGMENT_INVALID','JSON Pointer applies only to an admitted JSON source');
    [start,end]=pointerRange(source.content,parsed,selector.pointer);
  }
  const selected=bytes.subarray(start,end);
  if(hashBytes(selected)!==fragment.fragmentDigest)fail('FRAGMENT_DIGEST_MISMATCH','Selected source bytes differ from fragment binding',409);
  return {id:fragment.id,sourceId:source.id,sourceDigest:source.digest,fragmentDigest:fragment.fragmentDigest,startByte:start,endByte:end};
}

/** Pure source admission. Locators are labels, never filesystem/network reads.
 * Caller retains the result in its authenticated project transaction. Successful
 * admission proves byte/selector identity, not semantic truth or review authority.
 */
export function admitSourceSet(input:unknown):SourceAdmission {
  boundedJSON(input,SOURCE_LIMITS.envelopeBytes);
  if(!validate(input))fail('SOURCE_SCHEMA','Source set differs from the native v2 envelope');
  const copy:SourceSet=JSON.parse(JSON.stringify(input));
  const sources=new Map<string,{source:SourceDocument;bytes:Buffer;parsed?:ParsedJSON}>();let total=0;
  for(const source of copy.sources){
    if(sources.has(source.id))fail('SOURCE_ID_CONFLICT','Source identifiers must be distinct',409);
    for(const value of [source.content,source.locator,source.revision])if(value!==Buffer.from(value).toString('utf8'))fail('SOURCE_ENCODING','Source text must preserve Unicode scalar values');
    if(!source.locator.trim()||!source.revision.trim()||source.locator.includes('\0')||source.revision.includes('\0'))fail('SOURCE_SCHEMA','Source locator/revision must be nonempty display text');
    const bytes=Buffer.from(source.content);total+=bytes.length;
    if(bytes.length>SOURCE_LIMITS.documentBytes||total>SOURCE_LIMITS.totalBytes)fail('INPUT_LIMIT','Source byte budget exceeded');
    if(hashBytes(bytes)!==source.digest)fail('SOURCE_DIGEST_MISMATCH','Source content differs from its original-byte digest',409);
    sources.set(source.id,{source,bytes,...(source.format==='json'?{parsed:parseSourceJSON(source.content)}:{})});
  }
  const ids=new Set<string>(),fragments:ResolvedSourceFragment[]=[];let selectedBytes=0;
  for(const fragment of copy.fragments){
    if(ids.has(fragment.id))fail('SOURCE_ID_CONFLICT','Fragment identifiers must be distinct',409);ids.add(fragment.id);
    const bound=sources.get(fragment.sourceId);if(!bound)fail('SOURCE_FRAGMENT_MISSING','Fragment source is absent');
    const resolved=resolveFragment(bound.source,fragment,bound.bytes,bound.parsed);
    selectedBytes+=resolved.endByte-resolved.startByte;
    if(selectedBytes>SOURCE_LIMITS.selectedBytes)fail('INPUT_LIMIT','Selected source-fragment byte budget exceeded');
    fragments.push(resolved);
  }
  const compare=(a:{id:string},b:{id:string}):number=>a.id<b.id?-1:a.id>b.id?1:0;
  const identity={schema:copy.schema,sources:copy.sources.map(({content:_,...binding})=>binding).sort(compare),fragments:[...copy.fragments].sort(compare)};
  return freeze({schema:'ontology-source-admission/v2',sourceSetDigest:hash(identity as unknown as Json),schemaDigest:SOURCE_SCHEMA_DIGEST,
    sourceSet:copy,fragments,authority:false,businessConfirmed:false,semanticValidation:'NOT_EVALUATED'});
}
