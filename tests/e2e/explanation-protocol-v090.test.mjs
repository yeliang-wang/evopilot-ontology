import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {hash,hashBytes} from '../../dist/standalone/validation.js';
import {readDLToolchain} from '../../dist/reasoning/toolchain.js';
import {explainEvidence} from '../../dist/native-v2/explanations.js';
import {modelStore} from '../../dist/native-v2/model-store.js';
import {sourceStore} from '../../dist/native-v2/store.js';
import {loadTask,taskBinding} from '../../dist/native-v2/task-evidence.js';
import {fixture,prepare,configuration,terminal} from '../helpers/v090-validation.mjs';

const fields=['searchStrategy','replayVerified','candidateChecks','ineligibleCandidates','retainedDatatypeDefinitions'];
const legacyKeys=['schema','modelDigest','sourceSetDigest','closureDigest','task','target','query','method','support','replay','sourceLinksComplete','sourceLinkPrecision','allMinimalJustifications','businessMeaningProven','authority'];
const revision=(s,f)=>s.request(f.read('project.inspect'),f.token).revision;
const write=(s,f,operation,input,id)=>s.request(f.write(operation,input,id,revision(s,f)),f.token);

function paged(s,f,operation,input){
  let content='',offset=0,first,last,pages=0;
  do{
    last=s.request(f.read(operation,{...input,offset,maxBytes:512}),f.token);first??=last;pages++;
    assert.equal(last.offset,offset);assert.equal(last.documentDigest,first.documentDigest);
    if(operation==='explanation.read')assert.equal(last.projectionDigest,first.projectionDigest);
    content+=last.content;offset=last.nextOffset;
  }while(offset!==null);
  assert.equal(last.complete,true);assert.equal(hashBytes(content),first.documentDigest);
  return {value:JSON.parse(content),first,content,pages};
}

async function explained(s,f,p){
  const query=p.expectations.cases.find(c=>c.kind==='owl-entailment'&&c.expectedStatus==='ENTAILED').query;
  const receipt=write(s,f,'reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task:{kind:'explanation',target:'entailment',query},timeoutMs:30000},'actual-explanation');
  const taskId=receipt.result.taskId,until=Date.now()+45000;
  while(Date.now()<until){
    const inspection=s.request(f.read('reasoning.inspect',{taskId}),f.token);
    if(inspection.state==='FINISHED'){
      assert.equal(inspection.formalStatus,'COMPLETED',JSON.stringify(inspection));assert.equal(inspection.complete,true);return taskId;
    }
    assert.notEqual(inspection.state,'INTERRUPTED');await delay(25);
  }
  throw Error('Actual explanation did not become terminal within its observation budget');
}

function retained(f,p,taskId){
  const db=new DatabaseSync(join(f.root,'ontology.sqlite'),{readOnly:true});
  try{
    db.exec('BEGIN');const model=modelStore(db).load('demo','services',p.modelDigest),sources=sourceStore(db).load('demo',p.sourceSetDigest);
    return {model,sources,evidence:loadTask(db,'demo',model,taskId,'dl')};
  }finally{db.close();}
}

test('actual replay metadata reaches public explanation and review preparation without inventing a decision',async t=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Actual DL and SHACL engines are required; no mock or skip fallback');
  const selected=readDLToolchain(process.env.EVOPILOT_TEST_DL_TOOLCHAIN);
  assert.equal(selected.workerSourceDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/Worker.java',import.meta.url))),'Selected worker must match the current source');
  assert.equal(selected.dependencyLockDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/dependencies.json',import.meta.url))));
  const f=fixture(t),s=createStandaloneService(configuration(f));t.after(()=>s.close());const p=prepare(s,f);
  const validation=write(s,f,'validation.start',{assetId:'services',modelDigest:p.modelDigest},'actual-validation');
  assert.equal((await terminal(s,f,validation.result.taskId)).formalStatus,'MATCHED');
  const taskId=await explained(s,f,p),actual=retained(f,p,taskId),native=actual.evidence.result.result;
  for(const field of fields)assert.ok(Object.hasOwn(native,field),field+' must come from the actual worker');
  assert.equal(native.searchStrategy,'BREADTH_FIRST_BLOCKS');assert.equal(native.replayVerified,true);
  const projected=explainEvidence(actual.evidence,actual.model,actual.sources);
  assert.equal(native.sourceLocationVersion,3);assert.equal(projected.sourceLocationVersion,3);assert.equal(projected.axiomSourceLocationCoverage,'COMPLETE');
  assert.equal(native.sourceLocationDocuments.length,1);assert.deepEqual(projected.sourceLocationDocuments,native.sourceLocationDocuments);
  const table=native.sourceLocationDocuments[0],document=actual.model.draft.closure.documents.find(d=>d.id===table.documentId);
  assert.ok(document);assert.equal(table.documentDigest,document.digest);assert.equal(table.format,'turtle');assert.equal(table.parserId,'owlapi-turtle-occurrences:1');
  const occurrenceIds=new Set(table.occurrences.map(o=>o.id));assert.equal(occurrenceIds.size,table.occurrences.length);
  let contextReferences=0;
  for(const ax of native.support)for(const origin of ax.sources){
    assert.equal(origin.documentId,table.documentId);assert.equal(origin.documentDigest,table.documentDigest);
    const source=origin.sourceLocation;assert.equal(source.schema,'ontology-axiom-source-location/v2');assert.equal(source.kind,'RDF_CONSTRUCTION');assert.ok(source.constructionOccurrenceIds.length);
    for(const ids of [source.constructionOccurrenceIds,source.parserContextOccurrenceIds]){assert.deepEqual(ids,[...new Set(ids)].sort((a,b)=>a-b));for(const id of ids)assert.ok(occurrenceIds.has(id));}
    contextReferences+=source.parserContextOccurrenceIds.length;
  }
  assert.ok(contextReferences>0,'The actual restriction/list mapping records parser-selection context separately from construction');

  await t.test('public paginated read and review report preserve the verified optional group',()=>{
    const before=revision(s,f),read=paged(s,f,'explanation.read',{assetId:'services',modelDigest:p.modelDigest,taskId});
    assert.ok(read.pages>1);assert.equal(revision(s,f),before);assert.deepEqual(read.value,projected);assert.equal(read.first.projectionDigest,hash(projected));
    for(const field of fields)assert.equal(read.value[field],native[field],field);
    assert.equal(read.value.method,'DELETION_REPLAY');assert.equal(read.value.allMinimalJustifications,false);assert.equal(read.value.authority,false);assert.equal(read.value.businessMeaningProven,false);
    assert.equal(read.value.axiomSourceLocationCoverage,'COMPLETE');assert.equal(read.value.sourceLocationDocuments.length,1);
    assert.equal(read.value.support[0].documents[0].mappings[0].axiomByteSpanEstablished,false,'Original business-document mapping is not upgraded to a semantic decision');
    const input={assetId:'services',modelDigest:p.modelDigest,version:'protocol-development-01',previousDeliveryDigest:null,validationTaskId:validation.result.taskId,explanationTaskIds:[taskId]};
    const request=f.write('review.prepare',input,'prepare-review',before),receipt=s.request(request,f.token),candidate=receipt.result;
    assert.equal(candidate.status,'AWAITING_DECISION');assert.deepEqual(s.request(request,f.token),receipt,'Original review preparation receipt replays without another mutation');
    assert.equal(revision(s,f),before+1);
    const review=paged(s,f,'review.report.read',{assetId:'services',candidateDigest:candidate.candidateDigest});
    assert.equal(hash(review.value),candidate.reportDigest);assert.equal(review.value.explanations.length,1);assert.deepEqual(review.value.explanations[0].report,projected);
    assert.equal(s.context(f.token).writeOperations.includes('review.decide'),false);
    assert.deepEqual(s.request(f.read('delivery.list',{assetId:'services',afterDigest:null,limit:10}),f.token).records,[]);
  });

  // These are cloned protocol inputs, never replacement worker records. Their
  // task-binding result hashes are recomputed so failures concern field types
  // and relationships, not a stale outer checksum or a fabricated execution.
  function changed(mutate){
    const evidence=structuredClone(actual.evidence);mutate(evidence.result.result);
    assert.equal(taskBinding(evidence).resultDigest,hash(evidence.result));return evidence;
  }
  const project=evidence=>explainEvidence(evidence,actual.model,actual.sources);

  await t.test('legacy evidence retains exactly the previous projection shape and digest without backfilling verification',()=>{
    const evidence=changed(data=>{for(const field of fields)delete data[field];delete data.sourceLocationVersion;delete data.sourceLocationDocuments;for(const ax of data.support)for(const origin of ax.sources)delete origin.sourceLocation;});
    const historical=project(evidence),expected=structuredClone(projected);
    for(const field of fields)delete expected[field];
    delete expected.sourceLocationVersion;delete expected.axiomSourceLocationCoverage;delete expected.sourceLocationDocuments;
    for(const ax of expected.support)for(const document of ax.documents)delete document.axiomSourceLocation;
    // The legacy result has its own byte identity; all old projection fields
    // keep their original semantics, including that exact task result binding.
    expected.task=taskBinding(evidence);
    assert.deepEqual(Object.keys(historical).sort(),[...legacyKeys].sort());
    for(const field of fields)assert.equal(Object.hasOwn(historical,field),false,field);
    assert.deepEqual(historical,expected);assert.equal(JSON.stringify(historical),JSON.stringify(expected));assert.equal(hash(historical),hash(expected));
    assert.notEqual(historical.task.resultDigest,projected.task.resultDigest);assert.deepEqual(project(evidence),historical);
  });

  await t.test('v1 Turtle evidence preserves its former unavailable projection bytes and digest',()=>{
    const evidence=changed(data=>{data.sourceLocationVersion=1;delete data.sourceLocationDocuments;for(const ax of data.support)for(const origin of ax.sources)delete origin.sourceLocation;});
    const historical=project(evidence),expected=structuredClone(projected);
    expected.sourceLocationVersion=1;expected.axiomSourceLocationCoverage='UNAVAILABLE';delete expected.sourceLocationDocuments;expected.task=taskBinding(evidence);
    for(const ax of expected.support)for(const document of ax.documents)document.axiomSourceLocation={status:'UNAVAILABLE',reason:'FORMAT_NOT_INSTRUMENTED'};
    assert.equal(JSON.stringify(historical),JSON.stringify(expected));assert.equal(hash(historical),hash(expected));
    assert.equal(Object.hasOwn(historical,'sourceLocationDocuments'),false);assert.deepEqual(project(evidence),historical);
  });

  await t.test('every partial metadata group and unknown member is rejected after coherent rehashing',()=>{
    for(let mask=1;mask<(1<<fields.length)-1;mask++){
      const evidence=changed(data=>fields.forEach((field,index)=>{if(!(mask&(1<<index)))delete data[field];}));
      assert.throws(()=>project(evidence),{code:'EXPLANATION_PROTOCOL'},'partial group '+mask);
    }
    const unknown=changed(data=>{data.replayTrustedByCaller=true;});assert.throws(()=>project(unknown),{code:'INVALID_INPUT'});
  });

  await t.test('false verification, unsupported strategy, unsafe counts and contradictory bounds are rejected',()=>{
    const cases=[
      ['strategy',data=>{data.searchStrategy='DELETION_REPLAY';}],
      ['strategy-type',data=>{data.searchStrategy=null;}],
      ['unverified',data=>{data.replayVerified=false;}],
      ['verification-type',data=>{data.replayVerified='true';}],
      ['negative-checks',data=>{data.candidateChecks=-1;}],
      ['fractional-checks',data=>{data.candidateChecks=0.5;}],
      ['checks-type',data=>{data.candidateChecks='1';}],
      ['checks-null',data=>{data.candidateChecks=null;}],
      ['checks-upper-bound',data=>{data.candidateChecks=200000;}],
      ['unsafe-checks',data=>{data.candidateChecks=Number.MAX_SAFE_INTEGER+1;}],
      ['negative-ineligible',data=>{data.ineligibleCandidates=-1;}],
      ['fractional-ineligible',data=>{data.ineligibleCandidates=0.5;}],
      ['ineligible-type',data=>{data.ineligibleCandidates=false;}],
      ['ineligible-exceeds-checks',data=>{data.ineligibleCandidates=data.candidateChecks+1;}],
      ['negative-definitions',data=>{data.retainedDatatypeDefinitions=-1;}],
      ['fractional-definitions',data=>{data.retainedDatatypeDefinitions=0.5;}],
      ['definitions-type',data=>{data.retainedDatatypeDefinitions='0';}],
      ['definitions-exceed-support',data=>{data.retainedDatatypeDefinitions=data.support.length+1;}],
    ];
    for(const [name,mutate] of cases)assert.throws(()=>project(changed(mutate)),{code:'EXPLANATION_PROTOCOL'},name);
  });

  await t.test('counter boundary validation does not infer datatype counts from rendered axiom strings',()=>{
    for(const values of [
      {candidateChecks:0,ineligibleCandidates:0,retainedDatatypeDefinitions:0},
      {candidateChecks:199999,ineligibleCandidates:199999,retainedDatatypeDefinitions:native.support.length},
    ]){
      const projection=project(changed(data=>Object.assign(data,values)));
      for(const [key,value] of Object.entries(values))assert.equal(projection[key],value);
    }
  });
  assert.deepEqual(retained(f,p,taskId).evidence,actual.evidence,'Protocol mutation tests must leave the actual worker evidence unchanged');
});
