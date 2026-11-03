import type {WorkerObservation} from '../installation/worker-process.js';
import {workerIsolationConfiguration} from '../installation/systemd-binding.js';
import type {createDLRunner} from '../reasoning/runner.js';
import {DL_JVM_ARGUMENTS} from '../reasoning/runner.js';
import {closureDigest} from '../reasoning/request.js';
import {DL_LIMITS} from '../reasoning/types.js';
import type {DLRequest,DLResponse} from '../reasoning/types.js';
import type {createSHACLRunner} from './shacl-runner.js';
import {SHACL_PYTHON_ARGUMENTS} from './shacl-runner.js';
import {shaclIdentities,SHACL_LIMITS} from './shacl-request.js';
import type {SHACLResponse} from './shacl-request.js';
import type {SHACLRequest} from './shacl-contracts.js';
import type {ExpectationSet} from './expectations-contracts.js';
import type {ModelDraft} from './model-contracts.js';
import type {ModelAdmission} from './models.js';
import type {ExpectationAdmission} from './expectations.js';
import {hash} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

export const VALIDATION_LIMITS=Object.freeze({taskMs:120000,outputBytes:16*1024*1024,cases:32});
export interface ValidationPlan {schema:'ontology-validation-plan/v2';requestId:string;modelDigest:string;expectationsDigest:string;closureDigest:string;model:ModelDraft;expectations:ExpectationSet;mappingComplete:boolean;view:SHACLRequest['view'];}
export interface ValidationResponse {
  schema:'ontology-validation-result/v2';requestId:string;viewKind:'asserted'|'derived';viewDigest:string;requestDigest:string;modelDigest:string;expectationsDigest:string;closureDigest:string;configurationDigest:string;toolchainDigest:string;
  status:'MATCHED'|'MISMATCH'|'INCOMPLETE'|'TIMEOUT'|'CANCELLED'|'FAILED';complete:boolean;elapsedMs:number;result:Json;error:{code:string;message:string}|null;
}
interface Check {id:string;kind:string;expected:string;actual:string;matched:boolean;formalComplete:boolean;resultDigest:string;result:DLResponse|SHACLResponse;}
export function validationPlan(requestId:string,model:ModelAdmission,expected:ExpectationAdmission,view:SHACLRequest['view']={kind:'asserted',closure:model.draft.closure}):ValidationPlan {
  if(!expected.coverage.complete)fail('EXPECTATIONS_INCOMPLETE','Independent required positive/negative coverage is missing',409);
  if(model.draft.expectationsDigest!==expected.digest||model.draft.assetId!==expected.definition.assetId||model.draft.sourceSetDigest!==expected.definition.sourceSetDigest||model.draft.intentDigest!==expected.definition.intentDigest)fail('EXPECTATIONS_BINDING_CONFLICT','Model must bind these exact independent expectations',409);
  return structuredClone({schema:'ontology-validation-plan/v2',requestId,modelDigest:model.digest,expectationsDigest:expected.digest,closureDigest:model.closureDigest,model:model.draft,expectations:expected.definition,mappingComplete:model.mapping.complete,view});
}
export function validationConfiguration(timeoutMs:number,isolationDigest:string|null=null):string {
  return hash({schema:'ontology-validation-configuration/v2',timeoutMs,limits:{...VALIDATION_LIMITS},dl:{limits:{...DL_LIMITS},jvm:[...DL_JVM_ARGUMENTS]},shacl:{limits:{...SHACL_LIMITS},python:[...SHACL_PYTHON_ARGUMENTS],inference:'none',metaSHACL:true,advanced:false,js:false,imports:false},...workerIsolationConfiguration(isolationDigest)});
}
export function createValidationRunner(dl:ReturnType<typeof createDLRunner>,shacl:ReturnType<typeof createSHACLRunner>){
  if(dl.workerIsolationDigest!==shacl.workerIsolationDigest)fail('WORKER_ISOLATION_BINDING','DL and SHACL must use the same selected isolation boundary',409);
  const toolchainDigest=hash({dl:dl.toolchainDigest,shacl:shacl.toolchainDigest});
  return {toolchainDigest,configurationDigest:(timeoutMs:number)=>validationConfiguration(timeoutMs,dl.workerIsolationDigest),async run(value:ValidationPlan,options:{timeoutMs:number;signal:AbortSignal;progress:(detail:Json)=>void}&WorkerObservation):Promise<ValidationResponse>{
    const plan=structuredClone(value),requestDigest=hash(plan as unknown as Json),configurationDigest=validationConfiguration(options.timeoutMs,dl.workerIsolationDigest),started=performance.now(),deadline=started+options.timeoutMs;
    if(plan.modelDigest!==hash(plan.model as unknown as Json)||plan.expectationsDigest!==hash(plan.expectations as unknown as Json)||plan.closureDigest!==closureDigest(plan.view.closure as DLRequest['closure'])||hash(plan.view.closure as unknown as Json)!==hash(plan.model.closure as unknown as Json))fail('CORRUPT_STATE','Validation snapshots differ from immutable identities',409);
    const chosen:SHACLRequest={schema:'ontology-shacl-request/v2',requestId:plan.requestId,modelDigest:plan.modelDigest,view:plan.view,shapes:plan.model.shapes,expectations:{digest:hash(plan.expectations.requiredShapes as unknown as Json),requiredShapes:plan.expectations.requiredShapes}};
    const envelope={schema:'ontology-validation-result/v2' as const,viewKind:plan.view.kind,viewDigest:shaclIdentities(chosen).viewDigest,requestId:plan.requestId,requestDigest,modelDigest:plan.modelDigest,expectationsDigest:plan.expectationsDigest,closureDigest:plan.closureDigest,configurationDigest,toolchainDigest};
    const requiredIds=['model-consistency','model-shacl',...plan.expectations.cases.map(c=>c.id)],checks:Check[]=[];let bytes=0;
    const summary=():Json=>({checks:checks as unknown as Json,requiredCheckIds:requiredIds,missingCheckIds:requiredIds.filter(id=>!checks.some(c=>c.id===id)),mappingComplete:plan.mappingComplete,openIssues:plan.model.openIssues.length,semanticCoverage:'CHECKED_EXPECTATIONS_ONLY',businessConfirmed:false,authority:false});
    const response=(status:ValidationResponse['status'],complete:boolean,error:ValidationResponse['error']=null):ValidationResponse=>({...envelope,status,complete,elapsedMs:Math.ceil(performance.now()-started),result:summary(),error});
    const remaining=(maximum:number)=>Math.max(1,Math.min(maximum,Math.floor(deadline-performance.now())));
    function boundary():ValidationResponse|null {
      if(options.signal.aborted)return response('CANCELLED',false,{code:'CANCELLED',message:'Validation cancelled; missing checks were not retried'});
      if(performance.now()>=deadline)return response('TIMEOUT',false,{code:'TASK_DEADLINE',message:'Validation suite deadline exhausted; missing checks were not retried'});
      return null;
    }
    const owlRequest=(id:string,task:DLRequest['task']):DLRequest=>({schema:'ontology-dl-request/v1',requestId:plan.requestId+'-'+id,closure:structuredClone(plan.model.closure) as DLRequest['closure'],task});
    const shaclRequest=(id:string,closure:SHACLRequest['view']['closure']):SHACLRequest=>({schema:'ontology-shacl-request/v2',requestId:plan.requestId+'-'+id,modelDigest:plan.modelDigest,view:{kind:'asserted',closure},shapes:plan.model.shapes,expectations:{digest:hash(plan.expectations.requiredShapes as unknown as Json),requiredShapes:plan.expectations.requiredShapes}});
    async function check(id:string,kind:string,expected:string,call:()=>Promise<DLResponse|SHACLResponse>,additional:(value:DLResponse|SHACLResponse)=>boolean=()=>true):Promise<ValidationResponse|null>{
      const stopped=boundary();if(stopped)return stopped;
      const result=await call(),item:Check={id,kind,expected,actual:result.status,matched:result.complete&&result.status===expected&&additional(result),formalComplete:result.complete,resultDigest:hash(result as unknown as Json),result};
      bytes+=Buffer.byteLength(JSON.stringify(item));if(bytes>VALIDATION_LIMITS.outputBytes-65536)return response('FAILED',false,{code:'OUTPUT_LIMIT',message:'Suite evidence exceeds the fixed budget; remaining check evidence is incomplete'});
      checks.push(item);options.progress({checkId:id,kind,expected,actual:item.actual,matched:item.matched,formalComplete:item.formalComplete,resultDigest:item.resultDigest,completedChecks:checks.length,requiredChecks:requiredIds.length});
      if(!result.complete)return response(result.status==='CANCELLED'?'CANCELLED':result.status==='TIMEOUT'?'TIMEOUT':'INCOMPLETE',false,{code:'FORMAL_CHECK_INCOMPLETE',message:'A required formal check did not complete: '+id});
      return boundary();
    }
    let stopped=await check('model-consistency','owl','COMPLETED',()=>dl.run(owlRequest('base-dl',{kind:'consistency'}),{timeoutMs:remaining(DL_LIMITS.taskMs),signal:options.signal,beforeDispatch:options.beforeDispatch}),r=>!!r.result&&typeof r.result==='object'&&!Array.isArray(r.result)&&r.result.consistent===true&&r.result.legal===true);if(stopped)return stopped;
    stopped=await check('model-shacl','shacl','CONFORMS',()=>shacl.run({...chosen,requestId:plan.requestId+'-base-shacl'},{timeoutMs:remaining(SHACL_LIMITS.taskMs),signal:options.signal,beforeDispatch:options.beforeDispatch}));if(stopped)return stopped;
    for(const [index,c] of plan.expectations.cases.entries()){
      const sub='case-'+index;
      if(c.kind==='owl-entailment')stopped=await check(c.id,'owl',c.expectedStatus,()=>dl.run(owlRequest(sub,{kind:'entailment',query:{...c.query}}),{timeoutMs:remaining(DL_LIMITS.taskMs),signal:options.signal,beforeDispatch:options.beforeDispatch}),r=>!!r.result&&typeof r.result==='object'&&!Array.isArray(r.result)&&r.result.vacuous===false);
      else stopped=await check(c.id,'shacl',c.expectedConforms?'CONFORMS':'NONCONFORMING',()=>shacl.run(shaclRequest(sub,c.closure),{timeoutMs:remaining(SHACL_LIMITS.taskMs),signal:options.signal,beforeDispatch:options.beforeDispatch}),r=>{
        if(c.expectedConforms)return true;
        const result=r.result as {results?:{properties:{predicate:string;object:string}[]}[]},observed=new Set(result.results?.flatMap(row=>row.properties.filter(p=>p.predicate==='http://www.w3.org/ns/shacl#sourceShape').map(p=>p.object))??[]);
        return c.expectedViolationShapeIris.every(iri=>observed.has('<'+iri+'>'));
      });
      if(stopped)return stopped;
    }
    return response(checks.every(c=>c.matched)&&plan.mappingComplete?'MATCHED':'MISMATCH',true);
  }};
}
