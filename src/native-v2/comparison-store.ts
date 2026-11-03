import type {DatabaseSync} from 'node:sqlite';
import type {Json,WorkspaceIdentity} from '../standalone/types.js';
import {fail} from '../standalone/types.js';
import {exact,id,digest,canonical,hashBytes} from '../standalone/validation.js';
import {modelStore} from './model-store.js';
import {sourceStore} from './store.js';
import {expectationStore} from './expectations-store.js';
import {viewStore} from './view-store.js';
import {boundIntent} from './intent-binding.js';
import {loadTask,verifyCompletedValidation} from './task-evidence.js';
import {projectionTurtle} from './projection.js';
import type {ValidationPlan} from './validation-runner.js';
import {compareModels,COMPARISON_LIMITS} from './comparison.js';
import type {ComparisonSide} from './comparison.js';

export function comparisonRead(db:DatabaseSync,identity:WorkspaceIdentity,projectId:string,input:unknown,tools:{dl:string|null;validation:string|null}):Json {
  if(!db.isTransaction)fail('TRANSACTION_REQUIRED','Comparison requires the owner transaction');
  exact(input,['assetId','from','to','offset','maxBytes']);id(input.assetId);
  if(!Number.isSafeInteger(input.offset)||(input.offset as number)<0||!Number.isSafeInteger(input.maxBytes)||(input.maxBytes as number)<4||(input.maxBytes as number)>COMPARISON_LIMITS.pageBytes)fail('INVALID_INPUT','Bounded UTF-8 comparison page required');
  const models=modelStore(db),sources=sourceStore(db),expectations=expectationStore(db),views=viewStore(db),assetId=input.assetId;
  function load(value:unknown):ComparisonSide {
    exact(value,['modelDigest','validationTaskId','viewDigest']);digest(value.modelDigest);if(value.validationTaskId!==null)id(value.validationTaskId);if(value.viewDigest!==null)digest(value.viewDigest);
    const model=models.load(projectId,assetId,value.modelDigest),intent=boundIntent(db,projectId,model.draft.intentDigest),source=sources.load(projectId,model.draft.sourceSetDigest),expected=model.draft.expectationsDigest?expectations.load(projectId,assetId,model.draft.expectationsDigest):null;
    let validation:ComparisonSide['validation']=null;
    if(value.validationTaskId!==null){
      if(!expected)fail('EXPECTATIONS_MISSING','Selected formal comparison needs independent expectations',409);
      const evidence=loadTask(db,projectId,model,value.validationTaskId,'validation');validation=verifyCompletedValidation(evidence,model,expected);
      const plan=evidence.request as unknown as ValidationPlan;
      if(plan.view.kind==='derived'){
        const selected=views.load(projectId,assetId,plan.view.projectionDigest);
        if(selected.model.digest!==model.digest||projectionTurtle(selected.view)!==plan.view.document.content)fail('EVIDENCE_SCOPE','Validation derived view differs from its retained formal tasks',409);
      }
    }
    const selected=value.viewDigest===null?null:views.load(projectId,assetId,value.viewDigest);
    if(selected&&selected.model.digest!==model.digest)fail('COMPARISON_SCOPE','Projection belongs to a different model',409);
    return {model,intent,sources:source,expectations:expected,validation,view:selected?.view??null};
  }
  const from=load(input.from),to=load(input.to),report=compareModels(identity,projectId,from,to),bytes=Buffer.from(canonical(report)),start=input.offset as number;
  if(start>bytes.length||start<bytes.length&&(bytes[start]&0xC0)===0x80)fail('INVALID_INPUT','Offset splits UTF-8 or exceeds comparison');
  let end=Math.min(bytes.length,start+(input.maxBytes as number));while(end<bytes.length&&(bytes[end]&0xC0)===0x80)end--;
  const freshness=(s:ComparisonSide)=>({currentModelBinding:models.current(projectId,s.model),configuredValidationMatches:s.validation?tools.validation===s.validation.binding.toolchainDigest:null,configuredProjectionMatches:s.view?s.view.tasks.every(t=>t.toolchainDigest===tools.dl):null});
  const reportDigest=hashBytes(bytes);
  return {reportDigest,documentDigest:reportDigest,content:bytes.subarray(start,end).toString('utf8'),offset:start,nextOffset:end===bytes.length?null:end,complete:end===bytes.length,
    freshness:{from:freshness(from),to:freshness(to)},projectRevision:Number(db.prepare('SELECT revision FROM projects WHERE id=?').get(projectId)!.revision),authority:false};
}
