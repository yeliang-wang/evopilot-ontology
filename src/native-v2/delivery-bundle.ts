import type {ReviewCandidate} from './candidate-contracts.js';
import type {ReviewDecision} from './review-contracts.js';
import type {DeliveryBundle} from './delivery-contracts.js';
import type {SourceSet} from './contracts.js';
import type {ModelDraft} from './model-contracts.js';
import type {ExpectationSet} from './expectations-contracts.js';
import type {DerivedView} from './projection-contracts.js';
import type {ModelingIntent,Json} from '../standalone/types.js';
import {fail} from '../standalone/types.js';
import {hash,hashBytes,canonical,digest,exact,validateIntent} from '../standalone/validation.js';
import {boundedJSON} from '../reasoning/request.js';
import {admitSourceSet} from './sources.js';
import {admitModel} from './models.js';
import {admitExpectations} from './expectations.js';
import {checkCandidate,checkDecision,checkBundle,LIFECYCLE_LIMITS} from './lifecycle-contract.js';
import {verifyTask,verifyMatchedValidation,taskBinding,dlEvidence} from './task-evidence.js';
import type {TaskEvidence} from './task-evidence.js';
import {explainEvidence} from './explanations.js';
import {projectResults,projectionTurtle,checkProjection} from './projection.js';
import type {ValidationPlan,ValidationResponse} from './validation-runner.js';

export interface CandidateMaterial {
  intent:{definition:ModelingIntent;previousDigest:string|null};sourceSet:SourceSet;model:ModelDraft;expectations:ExpectationSet;
  validation:TaskEvidence;explanations:TaskEvidence[];projection:{view:DerivedView;tasks:TaskEvidence[]}|null;
}
export function evaluateMaterial(m:CandidateMaterial){
  exact(m.intent,['definition','previousDigest']);validateIntent(m.intent.definition);if(m.intent.previousDigest!==null)digest(m.intent.previousDigest);
  const sources=admitSourceSet(m.sourceSet),intentDigest=hash(m.intent as unknown as Json),model=admitModel(m.model,sources,m.intent.definition),expectations=admitExpectations(m.expectations,sources,m.intent.definition);
  if(model.draft.intentDigest!==intentDigest||expectations.definition.intentDigest!==intentDigest||model.draft.expectationsDigest!==expectations.digest||expectations.definition.assetId!==model.draft.assetId)fail('DELIVERY_BINDING','Intent, model and independent expectations differ',409);
  const declared=m.intent.definition.sources;
  if(declared.length!==m.sourceSet.sources.length||declared.some(d=>!m.sourceSet.sources.some(s=>['id','locator','revision','digest','origin'].every(k=>d[k as keyof typeof d]===s[k as keyof typeof s]))))fail('DELIVERY_BINDING','Original sources differ from the declared intent',409);
  verifyMatchedValidation(m.validation,model,expectations);const plan=m.validation.request as unknown as ValidationPlan;
  if(m.explanations.length>LIFECYCLE_LIMITS.explanations||new Set(m.explanations.map(e=>e.taskId)).size!==m.explanations.length)fail('EXPLANATION_COVERAGE','Distinct bounded explanation tasks required',409);
  const positive=expectations.definition.cases.filter(c=>c.kind==='owl-entailment'&&c.expectedStatus==='ENTAILED'),covered=new Set<string>();
  const explanations=[...m.explanations].sort((a,b)=>a.taskId<b.taskId?-1:1).map(e=>{
    const report=explainEvidence(e,model,sources),{request}=dlEvidence(e);
    if(request.task.kind!=='explanation'||request.task.target!=='entailment'||!request.task.query)fail('EXPLANATION_COVERAGE','Candidate review needs positive entailment explanations',409);
    const queryDigest=hash(request.task.query as unknown as Json),c=positive.find(c=>c.kind==='owl-entailment'&&hash(c.query as unknown as Json)===queryDigest);
    if(!c||covered.has(c.id))fail('EXPLANATION_COVERAGE','Explanation must match one independently fixed positive query',409);covered.add(c.id);
    if(!report||typeof report!=='object'||Array.isArray(report)||report.sourceLinksComplete!==true)fail('EXPLANATION_SOURCE_UNMAPPED','Supporting model documents need retained business-source mappings',409);
    return {caseId:c.id,report};
  });
  if(covered.size!==positive.length)fail('EXPLANATION_COVERAGE','Every positive OWL case needs its actual replayable explanation',409);
  if(plan.view.kind==='asserted'){
    if(m.projection!==null)fail('DELIVERY_BINDING','Asserted validation cannot carry an unrelated derived view',409);
  }else{
    if(!m.projection)fail('DELIVERY_BINDING','Selected derived view and its actual task evidence are required',409);
    const projected=projectResults(model,m.projection.tasks.map(value=>{const e=verifyTask(value,model,'dl'),dl=dlEvidence(e);return {taskId:e.taskId,...dl,resultDigest:hash(e.result)};}));
    if(hash(projected as unknown as Json)!==plan.view.projectionDigest||hash(m.projection.view as unknown as Json)!==plan.view.projectionDigest||projectionTurtle(projected)!==plan.view.document.content)fail('DELIVERY_BINDING','Derived graph differs from its retained reasoning evidence',409);
  }
  return {sources,model,expectations,intentDigest,explanations};
}
export function makeCandidate(identity:ReviewCandidate['identity'],previousDeliveryDigest:string|null,m:CandidateMaterial):ReviewCandidate {
  const evaluated=evaluateMaterial(m),r=m.validation.result as unknown as ValidationResponse;
  const candidate:ReviewCandidate={schema:'ontology-review-candidate/v2',identity,previousDeliveryDigest,intentDigest:evaluated.intentDigest,sourceSetDigest:evaluated.sources.sourceSetDigest,modelDigest:evaluated.model.digest,expectationsDigest:evaluated.expectations.digest,closureDigest:evaluated.model.closureDigest,validation:taskBinding(m.validation),explanations:m.explanations.map(taskBinding).sort((a,b)=>a.taskId<b.taskId?-1:1),viewKind:r.viewKind,viewDigest:r.viewDigest,projectionDigest:m.projection?hash(m.projection.view as unknown as Json):null,requirementIds:m.intent.definition.requirements.map(r=>r.id).sort()};
  if(identity.assetId!==m.model.assetId)fail('DELIVERY_BINDING','Asset identity differs from reviewed model');checkCandidate(candidate);return candidate;
}
export function reviewReport(candidate:ReviewCandidate,m:CandidateMaterial):Json {
  const evaluated=evaluateMaterial(m);
  if(hash(makeCandidate(candidate.identity,candidate.previousDeliveryDigest,m) as unknown as Json)!==hash(candidate as unknown as Json))fail('DELIVERY_BINDING','Candidate differs from its immutable material',409);
  const report={schema:'ontology-review-report/v2',candidate,intent:m.intent.definition,sourceSet:m.sourceSet,model:m.model,expectations:m.expectations,validation:m.validation.result,explanations:evaluated.explanations,derivedView:m.projection?.view??null,
    semanticDecision:'REQUIRED',sourceMappingMeaning:'AUTHOR_DECLARED_INTERPRETATION',formalResultsAreBusinessApproval:false,softwareReleaseAuthority:false} as unknown as Json;
  if(Buffer.byteLength(canonical(report))>LIFECYCLE_LIMITS.bytes)fail('REVIEW_LIMIT','Exact review report exceeds its fixed byte budget',413);return report;
}
export function verifyDecision(decision:ReviewDecision,candidate:ReviewCandidate,m:CandidateMaterial):void {
  checkDecision(decision);
  if(decision.candidateDigest!==hash(candidate as unknown as Json)||decision.reportDigest!==hash(reviewReport(candidate,m))||decision.instructionDigest!==hash(decision.instruction as unknown as Json)||!decision.rationale.trim()||!decision.instruction.content.trim()||!decision.instruction.reference.trim())fail('REVIEW_BINDING','Decision must bind the exact report and submitted instruction',409);
  if(new Set(decision.requirementIds).size!==decision.requirementIds.length||decision.requirementIds.some(id=>!candidate.requirementIds.includes(id))||decision.decision==='APPROVE'&&hash([...decision.requirementIds].sort())!==hash([...candidate.requirementIds]))fail('REVIEW_REQUIREMENTS','Approval must acknowledge every fixed requirement',409);
}
export function makeBundle(candidate:ReviewCandidate,decision:ReviewDecision,m:CandidateMaterial,publisherPrincipalId:string,recordedAt:string):DeliveryBundle {
  verifyDecision(decision,candidate,m);if(decision.decision!=='APPROVE')fail('REVIEW_REJECTED','Delivery requires an exact approved semantic decision',409);
  const parts:DeliveryBundle['parts'][number][]=[];
  const add=(id:string,kind:DeliveryBundle['parts'][number]['kind'],value:unknown)=>{const content=canonical(value as Json);parts.push({id,kind,content,digest:hashBytes(content)});};
  add('candidate','candidate',candidate);add('decision','decision',decision);add('intent','intent',m.intent);add('sources','source-set',m.sourceSet);add('expectations','expectations',m.expectations);add('model','model',m.model);add(m.validation.taskId,'validation',m.validation);
  for(const e of m.explanations)add(e.taskId,'explanation',e);
  if(m.projection){add('projection','derived-view',m.projection.view);for(const e of m.projection.tasks)add(e.taskId,'projection-task',e);}
  parts.sort((a,b)=>a.id<b.id?-1:1);
  const bundle:DeliveryBundle={schema:'ontology-delivery-bundle/v2',identity:candidate.identity,candidateDigest:hash(candidate as unknown as Json),reviewDigest:hash(decision as unknown as Json),previousDeliveryDigest:candidate.previousDeliveryDigest,publisherPrincipalId,recordedAt,visibility:'private',parts};checkBundle(bundle);return bundle;
}
/** Offline integrity and relationship verification against a separately obtained
 * owner digest. This does not rerun engines or authenticate a quoted Host message. */
export function verifyDeliveryBundle(value:unknown,expectedDigest:string){
  digest(expectedDigest);boundedJSON(value,LIFECYCLE_LIMITS.bytes);checkBundle(value);
  if(hash(value as unknown as Json)!==expectedDigest)fail('DELIVERY_DIGEST','Delivery differs from the independently selected owner digest',409);
  const ids=new Set<string>(),parts=new Map<string,{kind:string;value:unknown}>();
  for(const p of value.parts){
    if(ids.has(p.id)||hashBytes(p.content)!==p.digest)fail('DELIVERY_PART','Duplicate part or byte digest mismatch',409);ids.add(p.id);
    const decoded:unknown=JSON.parse(p.content);if(canonical(decoded as Json)!==p.content)fail('DELIVERY_PART','Part must retain its canonical JSON bytes',409);parts.set(p.id,{kind:p.kind,value:decoded});
  }
  const take=(id:string,kind:string):unknown=>{const p=parts.get(id);if(!p||p.kind!==kind)fail('DELIVERY_PART','Required typed part missing: '+id,409);parts.delete(id);return p.value;};
  const candidate=take('candidate','candidate'),decision=take('decision','decision');checkCandidate(candidate);checkDecision(decision);
  if(hash(candidate as unknown as Json)!==value.candidateDigest||hash(decision as unknown as Json)!==value.reviewDigest||hash(candidate.identity as unknown as Json)!==hash(value.identity as unknown as Json)||candidate.previousDeliveryDigest!==value.previousDeliveryDigest)fail('DELIVERY_BINDING','Delivery identity or review differs',409);
  const m:CandidateMaterial={intent:take('intent','intent') as CandidateMaterial['intent'],sourceSet:take('sources','source-set') as SourceSet,model:take('model','model') as ModelDraft,expectations:take('expectations','expectations') as ExpectationSet,
    validation:take(candidate.validation.taskId,'validation') as TaskEvidence,explanations:candidate.explanations.map(e=>take(e.taskId,'explanation') as TaskEvidence),projection:null};
  if(candidate.projectionDigest){const view=take('projection','derived-view');checkProjection(view);m.projection={view,tasks:view.tasks.map(e=>take(e.taskId,'projection-task') as TaskEvidence)};}
  if(parts.size)fail('DELIVERY_PART','Delivery includes undeclared parts',409);
  const rebuilt=makeBundle(candidate,decision,m,value.publisherPrincipalId,value.recordedAt);
  if(hash(rebuilt as unknown as Json)!==expectedDigest)fail('DELIVERY_BINDING','Materialized delivery does not match retained identity',409);
  return {deliveryDigest:expectedDigest,identity:{...value.identity},candidateDigest:value.candidateDigest,reviewDigest:value.reviewDigest,modelDigest:candidate.modelDigest,sourceSetDigest:candidate.sourceSetDigest,semanticDecision:decision.decision,reviewerPrincipalId:decision.principalId,integrityVerified:true,externalInstructionVerified:false,formalExecutionReplayed:false,softwareReleaseAuthority:false};
}
