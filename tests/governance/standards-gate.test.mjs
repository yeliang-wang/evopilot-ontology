import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,writeFileSync,readFileSync,rmSync,symlinkSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectGovernance} from '../../scripts/roadmap.mjs';
import {hashBytes,hashValue,checkStandardsGate,summarize} from '../../scripts/standards-gate.mjs';
import {preflightProductE2E} from '../../scripts/formal-e2e.mjs';

// Entirely synthetic fixtures for the verifier. No upstream evaluation, real
// user decision, candidate acceptance or release authority is represented.
const root=fileURLToPath(new URL('../../',import.meta.url));
const policy=JSON.parse(readFileSync(join(root,'governance/standards-gate-v090.json')));
const code=expected=>error=>error.code===expected;
const at=n=>`2026-11-04T00:00:${String(n).padStart(2,'0')}.000Z`;
async function fixture(t,options={}){
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'ontology-standards-gate-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const put=(name,value)=>{const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value));writeFileSync(join(dir,name),bytes,{mode:0o600});return {path:name,digest:hashBytes(bytes)};};
  const get=name=>JSON.parse(readFileSync(join(dir,name))),gov=await inspectGovernance();
  const upstream=put('synthetic-upstream.txt','Synthetic verifier fixture; not an actual official case.'),candidate=put('candidate.tgz','Synthetic candidate archive'),toolchain=put('tools.json',{synthetic:true}),evaluator=put('evaluator.json',{synthetic:true});
  const cases=policy.families.map((family,n)=>({key:'synthetic#urn:synthetic:case-'+n,sourceId:'synthetic',upstreamId:'urn:synthetic:case-'+n,family,upstreamStatus:'APPROVED',applicability:options.excludeFamily===family?'EXCLUDED':'REQUIRED',reason:'Frozen synthetic applicability for verifier only',inputDigests:[upstream.digest],expectedDigests:[upstream.digest],complex:n===4}));
  const corpus={schema:'ontology-standards-corpus/v1',sources:[{id:'synthetic',url:'https://example.invalid/synthetic',specification:'Synthetic verifier fixture only',revision:'synthetic-1',license:'Synthetic fixture',manifest:upstream,files:[upstream]}],cases};
  const corpusRef=put('corpus.json',corpus),freeze={schema:'ontology-standards-freeze/v1',createdAt:at(0),targetDigest:gov.targetDigest,policyDigest:gov.target.standardsGateDigest,candidate,toolchain,corpus:corpusRef,evaluator},freezeRef=put('freeze.json',freeze);
  const results=cases.map((c,n)=>{
    if(c.applicability==='EXCLUDED')return {key:c.key,status:'EXCLUDED',reason:c.reason};
    const status=n===0?(options.status??'PASS'):'PASS';
    if(status==='ERROR'||status==='NOT_RUN')return {key:c.key,status,reason:'Synthetic failure'};
    const response=put('response-'+n+'.json',{synthetic:true}),request=put('request-'+n+'.json',{synthetic:true});
    const observation=put('observation-'+n+'.json',{schema:'ontology-standards-observation/v1',origin:'INSTALLED_PUBLIC_PRODUCT',candidateDigest:candidate.digest,freezeDigest:freezeRef.digest,transport:'HTTP',operation:'synthetic.verifier.fixture',request,response,startedAt:at(2),completedAt:at(3)});
    const shacl=c.family.startsWith('shacl-')?{booleanStatus:'PASS',reportStatus:'PASS'}:{};
    const comparison=put('comparison-'+n+'.json',{schema:'ontology-standards-comparison/v1',caseKey:c.key,evaluatorDigest:evaluator.digest,expectedDigests:c.expectedDigests,actualDigest:response.digest,status,...shacl});
    return {key:c.key,status,reason:'Synthetic comparison result',observation,comparison,...shacl};
  });
  const report={schema:'ontology-standards-report/v1',freezeDigest:freezeRef.digest,candidateDigest:candidate.digest,corpusDigest:corpusRef.digest,toolchainDigest:toolchain.digest,evaluatorDigest:evaluator.digest,startedAt:at(1),completedAt:at(4),cases:results,families:summarize(corpus,results,policy.families),complexView:cases.filter(c=>c.complex).map(c=>c.key).sort(),fullReport:put('full-report.md','Synthetic complete report fixture; NOT an actual standards evaluation.'),limitations:['Verifier test only']};
  const f={dir,put,get,gov,freeze,corpus,report,requested:null,bindings:null,records:[]};
  f.refresh=()=>{
    const reportRef=put('report.json',f.report);f.requested={candidateDigest:candidate.digest,corpusDigest:corpusRef.digest,toolchainDigest:toolchain.digest,reportDigest:reportRef.digest};
    f.bindings={...f.requested,freezeDigest:freezeRef.digest,targetDigest:gov.targetDigest};
    put('product-request.json',{schema:'ontology-product-e2e-request/v1',candidate,corpus:corpusRef,toolchain,report:reportRef});
  };
  f.refreezeCorpus=()=>{
    Object.assign(corpusRef,put('corpus.json',f.corpus));Object.assign(freezeRef,put('freeze.json',freeze));
    f.report.corpusDigest=corpusRef.digest;f.report.freezeDigest=freezeRef.digest;
    for(const result of f.report.cases){
      if(!result.observation)continue;
      const o=get(result.observation.path);o.freezeDigest=freezeRef.digest;result.observation=put(result.observation.path,o);
    }
    f.refresh();
  };
  f.syntheticReview=(action='APPROVE_PRODUCT_E2E',amend={})=>{
    const n=f.records.length,reviewedAt=at(5+n),bindings=structuredClone(f.bindings),source=put('user-'+n+'.json',{schema:'ontology-user-review-source/v1',role:'user',threadId:'synthetic-thread',turnId:'synthetic-turn',messageId:'synthetic-message-'+n,text:'Synthetic verifier fixture; no actual approval.',action,bindings,occurredAt:reviewedAt});
    const decision={schema:'ontology-standards-review/v1',actor:'USER',action,bindings,reviewedAt,source,...amend},previousDigest=f.records.at(-1)?.digest??null;
    const record={previousDigest,decision,digest:hashValue({previousDigest,decision})};f.records.push(record);put('review-ledger.json',{schema:'ontology-standards-review-ledger/v1',records:f.records});
  };
  f.refresh();return f;
}
const check=f=>checkStandardsGate(f.dir,f.requested);

test('technical success alone cannot enter formal product E2E or write approval',async t=>{
  const f=await fixture(t),before=readdirSync(f.dir).sort();
  await assert.rejects(check(f),code('USER_REVIEW_REQUIRED'));
  assert.deepEqual(readdirSync(f.dir).sort(),before);
  const r=spawnSync(process.execPath,[join(root,'scripts/formal-e2e.mjs'),'--evidence',f.dir,'--request','product-request.json'],{encoding:'utf8'});
  assert.equal(r.status,1);assert.equal(JSON.parse(r.stderr).status,'BLOCKED');assert.match(r.stderr,/USER_REVIEW_REQUIRED/);
});
test('exact explicit review allows only the same original product E2E basis',async t=>{
  const f=await fixture(t);f.syntheticReview();const admission=await check(f);
  assert.equal(admission.status,'ALLOW_PRODUCT_E2E');assert.equal(admission.releaseAuthorized,false);assert.equal(admission.acceptance,'NOT_EVALUATED');assert.equal(admission.scope,'ENTER_ORIGINAL_PRODUCT_E2E_ONLY');assert.deepEqual(admission.bindings,f.bindings);
  assert.deepEqual(await preflightProductE2E(f.dir,'product-request.json'),admission);
  const r=JSON.parse(execFileSync(process.execPath,[join(root,'scripts/formal-e2e.mjs'),'--evidence',f.dir,'--request','product-request.json'],{encoding:'utf8'}));assert.deepEqual(r,admission);
});
test('rejection and requested changes override an earlier approval',async t=>{
  for(const action of ['REJECT','REQUEST_CHANGES']){
    const f=await fixture(t);f.syntheticReview();f.syntheticReview(action);await assert.rejects(check(f),code('USER_REVIEW_BLOCKED'));
    f.syntheticReview();assert.equal((await check(f)).status,'ALLOW_PRODUCT_E2E');
  }
});
test('wrong candidate, report, corpus or tool configuration cannot reuse approval',async t=>{
  const f=await fixture(t);f.syntheticReview();
  for(const k of Object.keys(f.requested)){const old=f.requested[k];f.requested[k]=hashBytes('wrong '+k);await assert.rejects(check(f),code('BINDING_MISMATCH'));f.requested[k]=old;}
  for(const name of ['candidate.tgz','tools.json','corpus.json','evaluator.json','full-report.md','synthetic-upstream.txt','response-0.json']){
    const p=join(f.dir,name),bytes=readFileSync(p);writeFileSync(p,Buffer.concat([bytes,Buffer.from(' ')]));await assert.rejects(check(f),code('BINDING_MISMATCH'));writeFileSync(p,bytes);
  }
  f.report.limitations.push('Changed report after approval');f.refresh();await assert.rejects(check(f),code('BINDING_MISMATCH'));
});
test('FAIL, ERROR, NOT_RUN and zero required family coverage block even with approval',async t=>{
  for(const status of ['FAIL','ERROR','NOT_RUN']){const f=await fixture(t,{status});f.syntheticReview();await assert.rejects(check(f),code('TECHNICAL_BLOCKED'));}
  const f=await fixture(t,{excludeFamily:'owl2-dl'});assert.equal(f.report.families.find(x=>x.family==='owl2-dl').passRatio,null);f.syntheticReview();await assert.rejects(check(f),code('TECHNICAL_BLOCKED'));
});
test('missing/duplicate results, edited denominator, repeated complex view and post-run exclusion are refused',async t=>{
  for(const mutate of [r=>r.cases.pop(),r=>r.cases[1]=r.cases[0],r=>r.families[0].required=0,r=>r.complexView.push(r.complexView[0]),r=>r.cases[0].status='EXCLUDED']){
    const f=await fixture(t);mutate(f.report);f.refresh();await assert.rejects(check(f),/INVALID_EVIDENCE|BINDING_MISMATCH/);
  }
});
test('SHACL boolean-only success and component-only observations cannot pass',async t=>{
  const f=await fixture(t),r=f.report.cases[4],comparison=f.get(r.comparison.path);r.reportStatus='FAIL';comparison.reportStatus='FAIL';r.comparison=f.put(r.comparison.path,comparison);f.refresh();await assert.rejects(check(f),/Boolean-only SHACL/);
  const g=await fixture(t),o=g.get('observation-0.json');o.origin='DIRECT_HERMIT';g.report.cases[0].observation=g.put('observation-0.json',o);g.refresh();await assert.rejects(check(g),/Component diagnosis/);
});
test('wrong product result, expected oracle and comparator identity cannot pass',async t=>{
  for(const field of ['actualDigest','evaluatorDigest','expectedDigests']){
    const f=await fixture(t),c=f.get('comparison-0.json');c[field]=field==='expectedDigests'?[hashBytes('foreign')]:hashBytes('foreign');f.report.cases[0].comparison=f.put('comparison-0.json',c);f.refresh();await assert.rejects(check(f),code('BINDING_MISMATCH'));
  }
});
test('agent decisions, changed source records and reordered review chains are refused',async t=>{
  const f=await fixture(t);f.syntheticReview('APPROVE_PRODUCT_E2E',{actor:'AGENT'});await assert.rejects(check(f),code('USER_REVIEW_REQUIRED'));
  const g=await fixture(t);g.syntheticReview();const source=g.get('user-0.json');source.role='assistant';g.put('user-0.json',source);await assert.rejects(check(g),code('BINDING_MISMATCH'));
  const h=await fixture(t);h.syntheticReview();h.syntheticReview('REJECT');h.records.reverse();h.put('review-ledger.json',{schema:'ontology-standards-review-ledger/v1',records:h.records});await assert.rejects(check(h),code('BINDING_MISMATCH'));
});
test('approval before full report, evidence symlinks and request traversal fail closed',async t=>{
  const f=await fixture(t);f.syntheticReview('APPROVE_PRODUCT_E2E',{reviewedAt:at(0)});const source=f.get('user-0.json');source.occurredAt=at(0);const d=f.records[0].decision;d.source=f.put('user-0.json',source);f.records[0].digest=hashValue({previousDigest:null,decision:d});f.put('review-ledger.json',{schema:'ontology-standards-review-ledger/v1',records:f.records});await assert.rejects(check(f),code('USER_REVIEW_REQUIRED'));
  const g=await fixture(t);g.syntheticReview();rmSync(join(g.dir,'candidate.tgz'));symlinkSync(join(g.dir,'full-report.md'),join(g.dir,'candidate.tgz'));await assert.rejects(check(g),code('UNSAFE_EVIDENCE'));
  await assert.rejects(preflightProductE2E(g.dir,'../foreign.json'),code('UNSAFE_EVIDENCE'));
});
test('proposed cases, missing oracle provenance and duplicate upstream IDs through source aliases are refused',async t=>{
  const f=await fixture(t);f.corpus.cases[0].upstreamStatus='PROPOSED';f.refreezeCorpus();await assert.rejects(check(f),/Only approved official cases/);
  const g=await fixture(t);g.corpus.cases[0].expectedDigests=[hashBytes('missing oracle')];g.refreezeCorpus();await assert.rejects(check(g),/Input\/oracle outside frozen source/);
  const h=await fixture(t);h.corpus.sources.push({...h.corpus.sources[0],id:'alias'});h.corpus.cases[1].sourceId='alias';h.corpus.cases[1].upstreamId=h.corpus.cases[0].upstreamId;h.corpus.cases[1].key='alias#'+h.corpus.cases[1].upstreamId;h.refreezeCorpus();await assert.rejects(check(h),/Same upstream case/);
});
test('coherently refrozen corpus and reevaluated report still require a new user review',async t=>{
  const f=await fixture(t);f.syntheticReview();f.corpus.sources[0].revision='synthetic-2';f.refreezeCorpus();await assert.rejects(check(f),/Latest review is for changed basis/);
  f.syntheticReview();assert.equal((await check(f)).status,'ALLOW_PRODUCT_E2E');
});
