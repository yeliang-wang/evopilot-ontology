import type {DLDocument} from '../reasoning/types.js';
import {DL_LIMITS} from '../reasoning/types.js';
import {exact,hash,hashBytes,digest} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

export const AXIOM_LOCATION_LIMIT=200000;
/** Shared DL result protocol capability, not an expansion of ModelDocument.
 * Native business assets still admit only Turtle and RDF/XML. */
export function axiomLocationFormatInstrumented(format:DLDocument['format']):boolean {return format==='functional';}
export interface AxiomSourceFragment {start:number;end:number;fragmentDigest:string;startLine:number;endLine:number;}
export interface AxiomSourceLocation {
  schema:'ontology-axiom-source-location/v1';
  occurrences:{fragments:AxiomSourceFragment[]}[];
  context:({kind:'PREFIX'}&AxiomSourceFragment)[];
}
interface DocumentLocations {
  digest:string;bytes:Buffer;count:number;fragmentBytes:number;
  contextDigest:string|null;contextEnd:number;
  spans:{start:number;end:number}[];lineChecks:Map<number,number>;
}
function invalid(message:string):never {fail('EXPLANATION_PROTOCOL',message,409);}
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;

/** Checks original-byte integrity and coordinates, not OWL parsing or entailment.
 * Structural attribution is evidence from the exact retained worker/toolchain.
 * finish() is required: line checks use one bounded scan per original document. */
export function axiomLocationValidator(){
  const documents=new Map<string,DocumentLocations>();let count=0,bytes=0;
  function documentState(document:DLDocument):DocumentLocations {
    if(!axiomLocationFormatInstrumented(document.format))invalid('Only Functional Syntax source locations are instrumented');
    const existing=documents.get(document.id);
    if(existing){if(existing.digest!==document.digest)invalid('Source location document identity changed');return existing;}
    const raw=Buffer.from(document.content,'utf8');
    if(raw.length>DL_LIMITS.documentBytes||(bytes+=raw.length)>DL_LIMITS.closureBytes)invalid('Source location document byte budget exceeded');
    if(hashBytes(raw)!==document.digest)invalid('Source locations require the exact original document bytes');
    const state:DocumentLocations={digest:document.digest,bytes:raw,count:0,fragmentBytes:0,contextDigest:null,contextEnd:0,spans:[],lineChecks:new Map()};
    documents.set(document.id,state);return state;
  }
  function fragment(value:unknown,state:DocumentLocations,prefix=false):AxiomSourceFragment {
    exact(value,['start','end','fragmentDigest','startLine','endLine',...(prefix?['kind']:[])]);
    if(prefix&&value.kind!=='PREFIX')invalid('Unsupported axiom source context');
    const {start,end,startLine,endLine}=value;
    if(!integer(start)||!integer(end)||start>=end||end>state.bytes.length||
      !integer(startLine)||startLine<1||!integer(endLine)||endLine<startLine||endLine>state.bytes.length+1)invalid('Invalid axiom source coordinates');
    if((state.bytes[start]!&0xC0)===0x80||end<state.bytes.length&&(state.bytes[end]!&0xC0)===0x80)invalid('Axiom source range splits UTF-8');
    digest(value.fragmentDigest);
    if(++count>AXIOM_LOCATION_LIMIT||++state.count>AXIOM_LOCATION_LIMIT)invalid('Axiom source location count budget exceeded');
    return {start,end,fragmentDigest:value.fragmentDigest,startLine,endLine};
  }
  function verifyBytes(fragment:AxiomSourceFragment,state:DocumentLocations):void {
    if(hashBytes(state.bytes.subarray(fragment.start,fragment.end))!==fragment.fragmentDigest)invalid('Axiom source fragment digest differs from original bytes');
    for(const [offset,line] of [[fragment.start,fragment.startLine],[fragment.end-1,fragment.endLine]]){
      const prior=state.lineChecks.get(offset!);
      if(prior!==undefined&&prior!==line)invalid('Contradictory source line coordinates');
      state.lineChecks.set(offset!,line!);
    }
  }
  function validate(document:DLDocument,value:unknown):AxiomSourceLocation {
    exact(value,['schema','occurrences','context']);
    if(value.schema!=='ontology-axiom-source-location/v1'||!Array.isArray(value.occurrences)||!value.occurrences.length||value.occurrences.length>AXIOM_LOCATION_LIMIT||!Array.isArray(value.context)||value.context.length>AXIOM_LOCATION_LIMIT)invalid('Invalid axiom source location group');
    const state=documentState(document);let previousEnd=0;
    const occurrences=value.occurrences.map(occurrence=>{
      exact(occurrence,['fragments']);
      if(!Array.isArray(occurrence.fragments)||occurrence.fragments.length!==1)invalid('Functional source occurrence requires one complete axiom range');
      const span=fragment(occurrence.fragments[0],state);
      if(span.start<previousEnd)invalid('Axiom occurrences must be ordered and nonoverlapping');previousEnd=span.end;
      state.fragmentBytes+=span.end-span.start;
      if(state.fragmentBytes>state.bytes.length)invalid('Axiom fragment bytes exceed the original document');
      verifyBytes(span,state);state.spans.push({start:span.start,end:span.end});return {fragments:[span]};
    });
    previousEnd=0;
    const context=value.context.map(item=>{
      const span=fragment(item,state,true);
      if(span.start<previousEnd)invalid('Prefix contexts must be ordered and nonoverlapping');previousEnd=span.end;
      return {kind:'PREFIX' as const,...span};
    });
    if(previousEnd>occurrences[0]!.fragments[0]!.start)invalid('Prefix context must precede the located axiom');
    const contextDigest=hash(context as unknown as Json);
    if(state.contextDigest!==null&&state.contextDigest!==contextDigest)invalid('One original document requires one consistent prefix context');
    if(state.contextDigest===null){for(const span of context)verifyBytes(span,state);state.contextDigest=contextDigest;state.contextEnd=previousEnd;}
    return {schema:'ontology-axiom-source-location/v1',occurrences,context};
  }
  function finish():void {
    for(const state of documents.values()){
      state.spans.sort((a,b)=>a.start-b.start);let end=state.contextEnd;
      for(const span of state.spans){if(span.start<end)invalid('Source axiom ranges overlap each other or prefix context');end=span.end;}
      let offset=0,line=1;
      for(const [target,expected] of [...state.lineChecks].sort((a,b)=>a[0]-b[0])){
        // CRLF is one line break. Both characters belong to the covered line;
        // the next line starts after LF. A bare CR or LF is also one break.
        while(offset<target){const byte=state.bytes[offset]!;if(byte===10||byte===13&&state.bytes[offset+1]!==10)line++;offset++;}
        if(line!==expected)invalid('Source line number differs from the original document');
      }
    }
  }
  return {validate,finish};
}
