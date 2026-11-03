import type {DatabaseSync} from 'node:sqlite';
import {validateDLRequest,closureDigest} from '../reasoning/request.js';
import type {DLRequest,DLResponse} from '../reasoning/types.js';
import type {ValidationPlan,ValidationResponse} from './validation-runner.js';
import type {ModelAdmission} from './models.js';
import type {ExpectationAdmission} from './expectations.js';
import type {TaskBinding} from './candidate-contracts.js';
import {validateSHACLRequest,shaclIdentities} from './shacl-request.js';
import {exact,hash,digest,id,canonical} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

export interface TaskEvidence {taskId:string;kind:'dl'|'validation';request:Json;result:Json;}
export function verifyTask(value:unknown,model:ModelAdmission,kind:'dl'|'validation'):TaskEvidence {
  exact(value,['taskId','kind','request','result']);id(value.taskId);
  if(value.kind!==kind)fail('TASK_KIND','Wrong formal evidence kind',409);
  const result=value.result;exact(result,['schema','requestId','requestDigest','closureDigest','configurationDigest','toolchainDigest','status','complete','elapsedMs','result','error'],kind==='validation'?['modelDigest','expectationsDigest','viewKind','viewDigest']:[]);
  digest(result.requestDigest);digest(result.configurationDigest);digest(result.toolchainDigest);
  if(result.schema!==(kind==='dl'?'ontology-dl-result/v1':'ontology-validation-result/v2')||result.requestId!==value.taskId||result.requestDigest!==hash(value.request as Json)||result.closureDigest!==model.closureDigest||result.complete!==true||result.error!==null)fail('EVIDENCE_INCOMPLETE','Exact completed formal evidence is required',409);
  if(kind==='dl'){
    validateDLRequest(value.request);
    if(value.request.requestId!==value.taskId||closureDigest(value.request.closure)!==model.closureDigest||hash(value.request.closure as unknown as Json)!==hash(model.draft.closure as unknown as Json))fail('EVIDENCE_SCOPE','Formal task belongs to a different input closure',409);
  }else{
    const p=value.request;exact(p,['schema','requestId','modelDigest','expectationsDigest','closureDigest','model','expectations','mappingComplete','view']);
    if(p.schema!=='ontology-validation-plan/v2'||p.requestId!==value.taskId||p.modelDigest!==model.digest||hash(p.model as Json)!==model.digest||p.expectationsDigest!==model.draft.expectationsDigest||hash(p.expectations as Json)!==p.expectationsDigest||p.closureDigest!==model.closureDigest||result.modelDigest!==model.digest||result.expectationsDigest!==p.expectationsDigest)fail('EVIDENCE_SCOPE','Validation candidate/source/expectation binding differs',409);
    const plan=p as unknown as ValidationPlan,chosen={schema:'ontology-shacl-request/v2',requestId:plan.requestId,modelDigest:model.digest,view:plan.view,shapes:plan.model.shapes,expectations:{digest:hash(plan.expectations.requiredShapes as unknown as Json),requiredShapes:plan.expectations.requiredShapes}};
    validateSHACLRequest(chosen);
    if(hash(chosen.view.closure as unknown as Json)!==hash(model.draft.closure as unknown as Json)||result.viewKind!==chosen.view.kind||result.viewDigest!==shaclIdentities(chosen).viewDigest)fail('EVIDENCE_SCOPE','Validation selected graph differs from its exact result',409);
  }
  return value as unknown as TaskEvidence;
}
export function taskBinding(e:TaskEvidence):TaskBinding {
  const r=e.result as unknown as DLResponse;return {taskId:e.taskId,requestDigest:r.requestDigest,resultDigest:hash(e.result),configurationDigest:r.configurationDigest,toolchainDigest:r.toolchainDigest};
}
export function loadTask(db:DatabaseSync,projectId:string,model:ModelAdmission,taskId:string,kind:'dl'|'validation'):TaskEvidence {
  if(!db.isTransaction)fail('TRANSACTION_REQUIRED','Evidence reads require owner transaction');id(taskId);
  const r=db.prepare('SELECT * FROM native_reasoning_tasks WHERE project_id=? AND asset_id=? AND model_digest=? AND id=? AND task_kind=?').get(projectId,model.draft.assetId,model.digest,taskId,kind);
  if(!r)fail('NOT_FOUND','Formal evidence absent in selected project/model',404);
  if(r.state!=='FINISHED'||r.result===null)fail('EVIDENCE_INCOMPLETE','Formal task must finish before review',409);
  const request:Json=JSON.parse(String(r.request)),result:Json=JSON.parse(String(r.result)),e=verifyTask({taskId,kind,request,result},model,kind),binding=taskBinding(e);
  if(binding.requestDigest!==r.request_digest||binding.resultDigest!==r.result_digest||binding.configurationDigest!==r.configuration_digest||binding.toolchainDigest!==r.toolchain_digest||model.closureDigest!==r.closure_digest)fail('CORRUPT_STATE','Stored formal task changed',409);
  return e;
}
export interface VerifiedCheck {id:string;kind:'owl'|'shacl';expected:string;actual:string;matched:boolean;resultDigest:string;result:Json;}
export interface VerifiedValidation {binding:TaskBinding;status:'MATCHED'|'MISMATCH';checks:VerifiedCheck[];view:{kind:'asserted'|'derived';digest:string;projectionDigest:string|null};}
/** Completed mismatches are useful comparison evidence, but never review readiness. */
export function verifyCompletedValidation(e:TaskEvidence,model:ModelAdmission,expected:ExpectationAdmission):VerifiedValidation {
  verifyTask(e,model,'validation');const result=e.result as unknown as ValidationResponse,plan=e.request as unknown as ValidationPlan;
  if(!['MATCHED','MISMATCH'].includes(result.status)||!expected.coverage.complete||plan.mappingComplete!==model.mapping.complete||hash(plan.expectations as unknown as Json)!==expected.digest)fail('EVIDENCE_INCOMPLETE','Comparison requires a completed suite for its exact independent expectations',409);
  const summary=result.result;exact(summary,['checks','requiredCheckIds','missingCheckIds','mappingComplete','openIssues','semanticCoverage','businessConfirmed','authority']);
  const ids=['model-consistency','model-shacl',...expected.definition.cases.map(c=>c.id)];
  if(!Array.isArray(summary.checks)||summary.checks.length!==ids.length||canonical(summary.requiredCheckIds as Json)!==canonical(ids)||!Array.isArray(summary.missingCheckIds)||summary.missingCheckIds.length||summary.mappingComplete!==model.mapping.complete||summary.openIssues!==model.draft.openIssues.length||summary.semanticCoverage!=='CHECKED_EXPECTATIONS_ONLY'||summary.businessConfirmed!==false||summary.authority!==false)fail('EVIDENCE_INCOMPLETE','Fixed validation checks are incomplete',409);
  const seen=new Set<string>();
  const nativeTools=new Map<string,string>(),checks:VerifiedCheck[]=[];
  for(const item of summary.checks){
    exact(item,['id','kind','expected','actual','matched','formalComplete','resultDigest','result']);id(item.id);
    if(!ids.includes(item.id)||seen.has(item.id)||typeof item.matched!=='boolean'||item.formalComplete!==true||hash(item.result as Json)!==item.resultDigest)fail('EVIDENCE_INCOMPLETE','Validation check identity or outcome differs',409);seen.add(item.id);
    const r=item.result as unknown as DLResponse;
    if(r.complete!==true||r.error!==null||r.status!==item.actual)fail('EVIDENCE_INCOMPLETE','Native check did not complete',409);
    const fixed=expected.definition.cases.find(c=>c.id===item.id),status=item.id==='model-consistency'?'COMPLETED':item.id==='model-shacl'?'CONFORMS':fixed?.kind==='owl-entailment'?fixed.expectedStatus:fixed?.kind==='shacl'?(fixed.expectedConforms?'CONFORMS':'NONCONFORMING'):null;
    if(item.expected!==status)fail('EVIDENCE_INCOMPLETE','Expected outcome differs from independently fixed oracle',409);
    const isOWL=item.id==='model-consistency'||fixed?.kind==='owl-entailment',kind=isOWL?'owl':'shacl',suffix=item.id==='model-consistency'?'base-dl':item.id==='model-shacl'?'base-shacl':'case-'+expected.definition.cases.findIndex(c=>c.id===item.id),requestId=plan.requestId+'-'+suffix;
    if(item.kind!==kind||r.requestId!==requestId)fail('EVIDENCE_SCOPE','Native check kind or task identity differs',409);
    digest(r.toolchainDigest);digest(r.configurationDigest);
    if(nativeTools.has(kind)&&nativeTools.get(kind)!==r.toolchainDigest)fail('EVIDENCE_SCOPE','Suite contains mixed native toolchains',409);nativeTools.set(kind,r.toolchainDigest);
    let additional=true;
    if(isOWL){
      const task=item.id==='model-consistency'?{kind:'consistency' as const}:{kind:'entailment' as const,query:fixed!.kind==='owl-entailment'?fixed!.query:undefined};
      const request={schema:'ontology-dl-request/v1',requestId,closure:plan.model.closure,task};
      if(r.schema!=='ontology-dl-result/v1'||r.requestDigest!==hash(request as unknown as Json)||r.closureDigest!==model.closureDigest)fail('EVIDENCE_SCOPE','OWL check is not for the retained candidate/query',409);
      if(item.id==='model-consistency')additional=!!r.result&&typeof r.result==='object'&&!Array.isArray(r.result)&&r.result.legal===true&&r.result.consistent===true;
    }else{
      const view=item.id==='model-shacl'?plan.view:{kind:'asserted' as const,closure:fixed!.kind==='shacl'?fixed!.closure:plan.model.closure},request={schema:'ontology-shacl-request/v2',requestId,modelDigest:model.digest,view,shapes:plan.model.shapes,expectations:{digest:hash(plan.expectations.requiredShapes as unknown as Json),requiredShapes:plan.expectations.requiredShapes}};
      validateSHACLRequest(request);const identities=shaclIdentities(request),actual=item.result as Record<string,Json>;
      if(actual.schema!=='ontology-shacl-result/v2'||Object.entries(identities).some(([k,v])=>actual[k]!==v))fail('EVIDENCE_SCOPE','SHACL check is not for its retained candidate/fixture graph',409);
      if(fixed?.kind==='shacl'&&!fixed.expectedConforms){
        const native=actual.result as {results?:{properties:{predicate:string;object:string}[]}[]},observed=new Set(native.results?.flatMap(row=>row.properties.filter(p=>p.predicate==='http://www.w3.org/ns/shacl#sourceShape').map(p=>p.object))??[]);
        additional=fixed.expectedViolationShapeIris.every(iri=>observed.has('<'+iri+'>'));
      }
    }
    if(fixed?.kind==='owl-entailment')additional=!!r.result&&typeof r.result==='object'&&!Array.isArray(r.result)&&r.result.vacuous===false;
    if(item.matched!==(item.actual===item.expected&&additional))fail('EVIDENCE_INCOMPLETE','Recorded match differs from the actual fixed oracle',409);
    checks.push({id:item.id,kind,expected:item.expected as string,actual:item.actual as string,matched:item.matched,resultDigest:item.resultDigest as string,result:item.result as Json});
  }
  if(result.toolchainDigest!==hash({dl:nativeTools.get('owl')!,shacl:nativeTools.get('shacl')!}))fail('EVIDENCE_SCOPE','Combined suite toolchain differs from its native checks',409);
  const status=checks.every(c=>c.matched)&&model.mapping.complete?'MATCHED':'MISMATCH';
  if(status!==result.status)fail('EVIDENCE_INCOMPLETE','Validation summary disagrees with its fixed checks',409);
  return {binding:taskBinding(e),status,checks,view:{kind:plan.view.kind,digest:result.viewDigest,projectionDigest:plan.view.kind==='derived'?plan.view.projectionDigest:null}};
}
export function verifyMatchedValidation(e:TaskEvidence,model:ModelAdmission,expected:ExpectationAdmission):void {
  const result=e.result as unknown as ValidationResponse;
  if(result.status!=='MATCHED'||!expected.coverage.complete||!model.mapping.complete||model.draft.openIssues.length)fail('CANDIDATE_NOT_READY','Review requires matched checks, complete mappings and resolved model issues',409);
  verifyCompletedValidation(e,model,expected);
}
export function dlEvidence(e:TaskEvidence):{request:DLRequest;result:DLResponse}{return {request:e.request as unknown as DLRequest,result:e.result as unknown as DLResponse};}
