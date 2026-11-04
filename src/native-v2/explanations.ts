import type {DatabaseSync} from 'node:sqlite';
import {modelStore} from './model-store.js';
import {sourceStore} from './store.js';
import type {ModelAdmission} from './models.js';
import type {SourceAdmission} from './sources.js';
import {loadTask,verifyTask,dlEvidence,taskBinding} from './task-evidence.js';
import type {TaskEvidence} from './task-evidence.js';
import {exact,id,digest,hashBytes,hash} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

const replayFields=['searchStrategy','replayVerified','candidateChecks','ineligibleCandidates','retainedDatatypeDefinitions'] as const;
const count=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;

/** Structural axiom provenance is produced by OWLAPI. Business-source links
 * are the author's document mappings, visibly separate from the formal proof. */
export function explainEvidence(e:TaskEvidence,model:ModelAdmission,sources:SourceAdmission):Json {
  verifyTask(e,model,'dl');const {request,result}=dlEvidence(e);
  if(request.task.kind!=='explanation'||result.status!=='COMPLETED')fail('EXPLANATION_REQUIRED','A completed explanation task is required',409);
  const data=result.result;exact(data,['target','method','allMinimalJustifications','support','replay'],['reasoningEngine','engineSelectionPolicy','unknownUnicodeBlocks',...replayFields]);
  if(data.target!==request.task.target||data.method!=='DELETION_REPLAY'||data.allMinimalJustifications!==false||!Array.isArray(data.support))fail('EXPLANATION_PROTOCOL','Native explanation scope differs',409);
  let replayEvidence:Record<string,Json>={};
  if(replayFields.some(field=>Object.hasOwn(data,field))){
    const {searchStrategy,replayVerified,candidateChecks,ineligibleCandidates,retainedDatatypeDefinitions}=data;
    if(!replayFields.every(field=>Object.hasOwn(data,field))||searchStrategy!=='BREADTH_FIRST_BLOCKS'||replayVerified!==true||
      !count(candidateChecks)||candidateChecks>199999||!count(ineligibleCandidates)||ineligibleCandidates>candidateChecks||
      !count(retainedDatatypeDefinitions)||retainedDatatypeDefinitions>data.support.length)fail('EXPLANATION_PROTOCOL','Replay verification metadata is incomplete or invalid',409);
    replayEvidence={searchStrategy,replayVerified,candidateChecks,ineligibleCandidates,retainedDatatypeDefinitions};
  }
  exact(data.replay,['format','content','digest']);
  if(data.replay.format!=='functional'||typeof data.replay.content!=='string'||hashBytes(data.replay.content)!==data.replay.digest)fail('EXPLANATION_PROTOCOL','Replay document identity differs',409);
  let sourceLinksComplete=true;const seen=new Set<string>();
  const support=data.support.map(entry=>{
    exact(entry,['axiom','axiomDigest','sources']);
    if(typeof entry.axiom!=='string'||hashBytes(entry.axiom)!==entry.axiomDigest||seen.has(String(entry.axiomDigest))||!Array.isArray(entry.sources)||!entry.sources.length)fail('EXPLANATION_PROTOCOL','Supporting axiom identity is absent or repeated',409);seen.add(String(entry.axiomDigest));
    const origins=new Set<string>();
    const documents=entry.sources.map(origin=>{
      exact(origin,['documentId','documentDigest','selectorKind','axiomDigest']);
      const document=model.draft.closure.documents.find(d=>d.id===origin.documentId&&d.digest===origin.documentDigest);
      if(!document||origin.selectorKind!=='OWL_STRUCTURAL_AXIOM'||origin.axiomDigest!==entry.axiomDigest||origins.has(document.id))fail('EXPLANATION_PROTOCOL','Axiom source is outside its exact model closure',409);origins.add(document.id);
      const mappings=model.draft.mappings.filter(m=>m.anchors.some(a=>a.documentId===document.id)).map(m=>({requirementId:m.requirementId,rationale:m.rationale,
        modelAnchors:m.anchors.filter(a=>a.documentId===document.id),
        sourceFragments:m.sourceFragmentIds.map(fragmentId=>{const f=sources.fragments.find(f=>f.id===fragmentId)!,d=sources.sourceSet.sources.find(d=>d.id===f.sourceId)!;return {...f,locator:d.locator,revision:d.revision,origin:d.origin};}),
        linkKind:'AUTHOR_DECLARED_DOCUMENT_MAPPING',axiomByteSpanEstablished:false,businessMeaningProven:false}));
      if(!mappings.length)sourceLinksComplete=false;
      return {documentId:document.id,documentDigest:document.digest,documentIri:document.documentIri,format:document.format,selectorKind:'OWL_STRUCTURAL_AXIOM',mappings};
    });
    return {axiom:entry.axiom,axiomDigest:entry.axiomDigest,documents};
  });
  return {schema:'ontology-explanation-projection/v2',modelDigest:model.digest,sourceSetDigest:model.draft.sourceSetDigest,closureDigest:model.closureDigest,task:{...taskBinding(e)},target:request.task.target,query:request.task.query?{format:request.task.query.format,digest:request.task.query.digest}:null,method:'DELETION_REPLAY',...replayEvidence,support:support as unknown as Json,replay:data.replay as Json,sourceLinksComplete,sourceLinkPrecision:'DOCUMENT_MAPPING_NOT_AXIOM_BYTE_LOCATION',allMinimalJustifications:false,businessMeaningProven:false,authority:false};
}
export function explanationRead(db:DatabaseSync,projectId:string,input:unknown,toolchainDigest:string|null):Json {
  exact(input,['assetId','modelDigest','taskId','offset','maxBytes']);id(input.assetId);digest(input.modelDigest);id(input.taskId);
  if(!Number.isSafeInteger(input.offset)||(input.offset as number)<0||!Number.isSafeInteger(input.maxBytes)||(input.maxBytes as number)<4||(input.maxBytes as number)>65536)fail('INVALID_INPUT','Bounded explanation page required');
  const models=modelStore(db),model=models.load(projectId,input.assetId,input.modelDigest),e=loadTask(db,projectId,model,input.taskId,'dl'),projection=explainEvidence(e,model,sourceStore(db).load(projectId,model.draft.sourceSetDigest));
  const bytes=Buffer.from(JSON.stringify(projection)),start=input.offset as number;if(start>bytes.length||start<bytes.length&&(bytes[start]&0xC0)===0x80)fail('INVALID_INPUT','Offset splits UTF-8 or exceeds explanation');
  let end=Math.min(bytes.length,start+(input.maxBytes as number));while(end<bytes.length&&(bytes[end]&0xC0)===0x80)end--;
  return {taskId:input.taskId,modelDigest:model.digest,projectionDigest:hash(projection),documentDigest:hashBytes(bytes),content:bytes.subarray(start,end).toString('utf8'),offset:start,nextOffset:end===bytes.length?null:end,complete:end===bytes.length,current:models.current(projectId,model),configuredToolchainMatches:taskBinding(e).toolchainDigest===toolchainDigest,authority:false};
}
