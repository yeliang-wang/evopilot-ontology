import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectGovernance} from '../../scripts/roadmap.mjs';
import {hashBytes,hashValue,checkStandardsGate,checkLimitedStandardsGate,summarize} from '../../scripts/standards-gate.mjs';
import {preflightLimitedProductE2E,checkLimitedPreviewRelease,limitedCollectorDependencies,limitedCaseOrigins,assertLimitedResultStatus} from '../../scripts/limited-preview-gate-v090.mjs';
// Synthetic verifier inputs only: no actual standards run, user approval or release.
const root=fileURLToPath(new URL('../../',import.meta.url));
const policy=JSON.parse(readFileSync(join(root,'governance/standards-gate-v090.json')));
const at=n=>`2026-11-04T00:00:${String(n).padStart(2,'0')}.000Z`;
async function fixture(t,options={}){
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'ontology-standards-gate-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const put=(name,value)=>{const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value));writeFileSync(join(dir,name),bytes,{mode:0o600});return {path:name,digest:hashBytes(bytes)};};
  const get=name=>JSON.parse(readFileSync(join(dir,name))),gov=await inspectGovernance();
  const config={sourceCommit:'a'.repeat(40),runtimeRoot:'/synthetic-verifier-only/runtime',runtimeDigest:hashBytes('synthetic runtime'),dl:{digest:hashBytes('synthetic dl')},shacl:{digest:hashBytes('synthetic shacl')},...options.config};
  const tools={runtime:{digest:hashBytes('synthetic runtime')},dl:{digest:hashBytes('synthetic dl')},shacl:{digest:hashBytes('synthetic shacl')},...options.tools};
  const upstream=put('synthetic-upstream.txt','Synthetic verifier fixture; not an actual official case.'),candidate=put('candidate.tgz','Synthetic candidate archive'),toolchain=put('tools.json',tools),evaluator=put('evaluator.json',{files:[put('configuration.json',config)]});
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
  const f={dir,put,get,gov,freeze,corpus,report,config,tools,requested:null,bindings:null,records:[]};
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

function limitedReview(f){
  const bindings={...f.bindings,limitedPolicyDigest:f.gov.limitedPreviewDigest},action='APPROVE_LIMITED_PRODUCT_E2E';
  const source=f.put('limited-user.json',{schema:'ontology-limited-user-review-source/v1',role:'user',threadId:'synthetic',turnId:'synthetic',messageId:'synthetic',text:'Verifier fixture only, not actual authorization',action,bindings,occurredAt:at(5)});
  const decision={schema:'ontology-limited-standards-review/v1',actor:'USER',action,bindings,reviewedAt:at(5),source},record={previousDigest:null,decision,digest:hashValue({previousDigest:null,decision})};
  f.put('limited-review-ledger.json',{schema:'ontology-limited-standards-review-ledger/v1',records:[record]});
  const request=f.get('product-request.json');request.schema='ontology-limited-product-e2e-request/v1';f.put('limited-request.json',request);
}
async function releaseFixture(t,options={}){
  const f=await fixture(t,options);limitedReview(f);const admission=await preflightLimitedProductE2E(f.dir,'limited-request.json',root);
  const sourceCommit='a'.repeat(40),sourceRun=f.put('source-run.json',{id:42,repository:{id:1416266852,full_name:'yeliang-wang/evopilot-ontology'},head_sha:sourceCommit,path:'.github/workflows/ci.yml',status:'completed',conclusion:'success',event:'workflow_dispatch'});
  const artifactMetadata=f.put('artifacts.json',{total_count:1,artifacts:[{id:7,name:'evopilot-ontology-'+sourceCommit+'-package',expired:false,digest:hashBytes('synthetic zip'),size_in_bytes:100,workflow_run:{id:42,head_sha:sourceCommit,repository_id:1416266852,head_repository_id:1416266852}}]});
  const candidateManifest=f.put('candidate.json',{schema:'ontology-source-candidate/v1',sourceCommit,package:{filename:'evopilot-next-ontology-0.9.0.tgz',digest:f.bindings.candidateDigest,bytes:readFileSync(join(f.dir,'candidate.tgz')).length}});
  const sourceRef=path=>({path,digest:hashBytes(readFileSync(join(root,path)))});
  const binding=f.put('binding.json',{schema:'ontology-limited-collector-binding/v1',admission,collector:sourceRef('tests/acceptance/v090/limited-preview.mjs'),driverDigest:sourceRef('tests/acceptance/v090/public-collector.mjs').digest,dependencyFiles:limitedCollectorDependencies.map(sourceRef),configurationDigest:hashBytes(readFileSync(join(f.dir,'configuration.json'))),startedAt:at(6),caseIds:f.gov.limitedPreview.evidence.productCasesRequiringReportApproval});
  // Synthetic verifier envelopes reproduce recorded transport shapes only;
  // no subprocess, installed product, historical business data or user was used.
  let serial=0;
  const cli=(command,args=[])=>({kind:'CLI',cli:join(f.config.runtimeRoot,'node_modules/@evopilot-next/ontology/dist/standalone/cli.js'),args:[command,...args],status:0,signal:null,error:null,stdout:f.put('synthetic-cli-'+(++serial)+'.stdout',{ok:true,result:{syntheticVerifierOnly:true}}),stderr:f.put('synthetic-cli-'+serial+'.stderr','')});
  const installed=()=>[cli('install',['--mode','create','--runtime-root',f.config.runtimeRoot,'--runtime-digest',f.config.runtimeDigest]),cli('toolchains-bind'),cli('start'),cli('stop')];
  const http=(operation,result,input={},extras={})=>({kind:'HTTP',request:{workspaceId:'synthetic-workspace',serviceId:'synthetic-service',projectId:'demo',operation,input,...extras},status:200,body:{ok:true,result}});
  const denied=(operation,code,extras={})=>({...http(operation,{}, {},extras),status:403,body:{ok:false,error:{code}}});
  const receipt={requestId:'synthetic-create',revision:1,result:{syntheticVerifierOnly:true}};
  const document={id:'synthetic-document',content:'Ontology()'};document.digest=hashBytes(document.content);const modelDigest=hashBytes('synthetic-model');
  const traceFor=id=>{
    if(id==='OL02')return [...installed(),cli('start'),cli('stop'),cli('installation-inspect'),http('project.create',receipt,{}, {requestId:receipt.requestId}),http('project.inspect',{revision:1}),http('receipt.read',receipt,{requestId:receipt.requestId})];
    if(id==='OL03')return [...installed(),http('project.create',receipt),http('intent.record',{result:{intentDigest:hashBytes('intent')}}),http('source.admit',{result:{sourceSetDigest:hashBytes('source')}}),http('model.record',{result:{modelDigest}},{draft:{closure:{documents:[document]}}}),http('model.inspect',{current:true},{modelDigest}),http('model.document.read',{content:document.content},{modelDigest,documentId:document.id,offset:0}),http('reasoning.start',{result:{taskId:'task'}}),http('reasoning.inspect',{state:'FINISHED',result:{status:'COMPLETED',complete:true,error:null,result:{legal:true}}},{taskId:'task'}),http('receipt.read',receipt),http('intent.read',{definition:{exclusions:['Business delivery']}})];
    if(id==='OL05')return [...installed(),http('project.create',receipt),denied('project.inspect','UNAUTHENTICATED'),{...denied('project.inspect','UNAUTHENTICATED'),kind:'HTTP_NO_AUTHORIZATION'},denied('project.inspect','FORBIDDEN',{projectId:'foreign'}),denied('model.record','DIGEST_MISMATCH'),denied('model.record','FORBIDDEN'),{kind:'ISOLATED_PERMISSION_FAULT',permission:'read',restored:true,credentialContentRetained:false},http('model.inspect',{current:true})];
    if(id==='OL06')return [{kind:'HISTORICAL_INSTALLED_PUBLIC_READ',schema:'ontology-limited-history-observation/v1',caseId:id,status:'OBSERVED',technicalStatus:'PASS',authority:false,releaseAuthorized:false,bindings:{candidateDigest:f.bindings.candidateDigest,runtimeDigest:f.config.runtimeDigest,sourceCommit,businessDigest:hashBytes('synthetic-business'),inputDigest:hashBytes('synthetic-history-input'),collectorDigest:sourceRef('tests/acceptance/v090/limited-history.mjs').digest},observations:['exact-asset-read','exact-receipt-read','delivery-verification','cross-project-denied','cross-visibility-denied','foreign-receipt-denied','tampered-delivery-rejected','unknown-schema-rejected','retired-mutation-denied','business-and-original-evidence-preserved'].map(id=>({id,status:'PASS'}))}];
    if(id==='OL07')return [{kind:'INSTALLED_PACKAGE_DECLARATIONS',files:['README.md','README_CN.md','CHANGELOG.md','docs/ontology-v090-limited-preview.md','docs/ontology-v090-limited-preview-install.md','plugins/codex/.codex-plugin/plugin.json','plugins/codex/skills/evopilot-ontology-expert/SKILL.md'].map(sourceRef),scope:readFileSync(join(root,'docs/ontology-v090-limited-preview.md'),'utf8'),plugin:JSON.parse(readFileSync(join(root,'plugins/codex/.codex-plugin/plugin.json')))}];
    return [{kind:'EXACT_SOURCE_RELEASE_GATE_NEGATIVES',syntheticProbe:true,sourceCommit,candidateDigest:f.bindings.candidateDigest,missingDecision:'REFUSED',foreignCandidate:'REFUSED',agentApproval:'REFUSED',missingRequiredEvidence:'REFUSED',failedRequiredEvidence:'REFUSED',unknownRequiredEvidence:'REFUSED',staleCandidateEvidence:'REFUSED',remoteOperations:0,releaseAuthorized:false}];
  };
  const cases=f.gov.limitedPreview.cases.filter(c=>c.phase==='product').map(c=>({id:c.id,status:'PASS',observation:f.put(c.id+'-observation.json',{schema:'ontology-product-case-observation/v1',id:c.id,origin:limitedCaseOrigins[c.id],candidateDigest:f.bindings.candidateDigest,admissionDecisionDigest:admission.decisionDigest,collectorBinding:binding,startedAt:at(7),completedAt:at(8),trace:traceFor(c.id)}),comparison:f.put(c.id+'-comparison.json',{schema:'ontology-product-case-comparison/v1',id:c.id,status:'PASS',expected:c.expected})}));
  const result={schema:'ontology-limited-product-result/v1',status:'PASS',problem:null,cleanup:null,releaseAuthorized:false,candidateDigest:f.bindings.candidateDigest,binding,cases,completedAt:at(9)};
  const request={schema:'ontology-limited-release-request/v1',standardsRequest:{path:'limited-request.json',digest:hashBytes(readFileSync(join(f.dir,'limited-request.json')))},sourceCommit,sourceRun,artifactMetadata,candidateManifest,productResult:f.put('result.json',result)};
  f.put('release-request.json',request);return {...f,result,request,refreshRelease(){request.productResult=f.put('result.json',result);f.put('release-request.json',request);}};
}
test('limited review never opens original full admission and full review never opens limited admission',async t=>{
  const f=await fixture(t);limitedReview(f);assert.equal((await checkLimitedStandardsGate(f.dir,f.requested,root)).status,'ALLOW_LIMITED_PRODUCT_E2E');await assert.rejects(checkStandardsGate(f.dir,f.requested,root),/USER_REVIEW_REQUIRED/);
  const g=await fixture(t);g.syntheticReview();assert.equal((await checkStandardsGate(g.dir,g.requested,root)).status,'ALLOW_PRODUCT_E2E');await assert.rejects(checkLimitedStandardsGate(g.dir,g.requested,root),/USER_REVIEW_REQUIRED/);
});
test('limited report still requires complete technical evidence and exact seven digest bindings',async t=>{
  const f=await fixture(t,{status:'FAIL'});limitedReview(f);await assert.rejects(checkLimitedStandardsGate(f.dir,f.requested,root),/TECHNICAL_BLOCKED/);
  const g=await fixture(t);limitedReview(g);const ledger=g.get('limited-review-ledger.json'),d=ledger.records[0].decision;d.bindings.limitedPolicyDigest=hashBytes('foreign policy');const s=g.get('limited-user.json');s.bindings=d.bindings;d.source=g.put('limited-user.json',s);ledger.records[0].digest=hashValue({previousDigest:null,decision:d});g.put('limited-review-ledger.json',ledger);await assert.rejects(checkLimitedStandardsGate(g.dir,g.requested,root),/BINDING_MISMATCH/);
});
test('synthetic complete limited receipts permit review only, never release authority',async t=>{
  const f=await releaseFixture(t),r=await checkLimitedPreviewRelease(f.dir,'release-request.json',root);assert.equal(r.status,'ALLOW_RELEASE_REVIEW');assert.equal(r.releaseAuthorized,false);assert.equal(r.candidateDigest,f.bindings.candidateDigest);
});
test('failed, unknown, missing, duplicate cases and cleanup failure cannot qualify limited release',async t=>{
  for(const mutate of [r=>r.cases[0].status='FAIL',r=>r.cases[0].status='UNKNOWN',r=>r.cases.pop(),r=>r.cases[1]=r.cases[0],r=>r.cleanup=['unreconciled worker']]){const f=await releaseFixture(t);mutate(f.result);f.refreshRelease();await assert.rejects(checkLimitedPreviewRelease(f.dir,'release-request.json',root));}
});
test('different CI candidate and missing collector dependencies are refused',async t=>{
  const f=await releaseFixture(t);f.request.sourceCommit='b'.repeat(40);f.put('release-request.json',f.request);await assert.rejects(checkLimitedPreviewRelease(f.dir,'release-request.json',root));
  const g=await releaseFixture(t),binding=g.get('binding.json');binding.dependencyFiles.pop();g.result.binding=g.put('binding.json',binding);g.refreshRelease();await assert.rejects(checkLimitedPreviewRelease(g.dir,'release-request.json',root),/dependencies/);
});
test('pre-admission collection and edited expectations cannot qualify limited release',async t=>{
  const f=await releaseFixture(t),binding=f.get('binding.json');binding.startedAt=at(4);f.result.binding=f.put('binding.json',binding);f.refreshRelease();await assert.rejects(checkLimitedPreviewRelease(f.dir,'release-request.json',root),/predates/);
  const g=await releaseFixture(t),item=g.result.cases[0],comparison=g.get(item.comparison.path);comparison.expected='Weaker condition';item.comparison=g.put(item.comparison.path,comparison);g.refreshRelease();await assert.rejects(checkLimitedPreviewRelease(g.dir,'release-request.json',root),/expectation/);
});


test('status helper rejects incomplete, stale or authoritative results and does not grant admission',()=>{
  const ids=['OL02','OL03'],candidateDigest=hashBytes('synthetic'),good={schema:'ontology-limited-product-result/v1',status:'PASS',problem:null,cleanup:null,releaseAuthorized:false,candidateDigest,cases:ids.map(id=>({id,status:'PASS'}))};
  assert.equal(assertLimitedResultStatus(good,ids,candidateDigest),undefined);
  for(const mutate of [r=>r.status='UNKNOWN',r=>r.cases.pop(),r=>r.cases[0].status='FAIL',r=>r.cases[0].status='UNKNOWN',r=>r.cases[1]=r.cases[0],r=>r.candidateDigest=hashBytes('stale'),r=>r.releaseAuthorized=true,r=>r.problem='failure',r=>r.cleanup=['failed']]){const value=structuredClone(good);mutate(value);assert.throws(()=>assertLimitedResultStatus(value,ids,candidateDigest));}
  assert.throws(()=>assertLimitedResultStatus(null,ids,candidateDigest));
});

test('installed configuration must agree with release source and every frozen executor digest',async t=>{
  for(const config of [{sourceCommit:'b'.repeat(40)},{runtimeDigest:hashBytes('stale-runtime')},{dl:{digest:hashBytes('stale-dl')}},{shacl:{digest:hashBytes('stale-shacl')}}]){
    const f=await releaseFixture(t,{config});await assert.rejects(checkLimitedPreviewRelease(f.dir,'release-request.json',root),/Installed .*differs/);
  }
});

async function rejectObservation(t,id,mutate,pattern){
  const f=await releaseFixture(t),item=f.result.cases.find(c=>c.id===id),observation=f.get(item.observation.path);mutate(observation);item.observation=f.put(item.observation.path,observation);f.refreshRelease();await assert.rejects(checkLimitedPreviewRelease(f.dir,'release-request.json',root),pattern);
}

test('unknown traces and missing observations cannot be replaced by declared PASS',async t=>{
  for(const id of ['OL02','OL03','OL05','OL06','OL07','OL08']){
    await rejectObservation(t,id,o=>{o.trace=[{kind:'SYNTHETIC_VERIFIER_FIXTURE_ONLY'}];},/Unknown limited observation kind/);
    await rejectObservation(t,id,o=>{o.trace=[];},/Retained original observations required/);
  }
});

test('limited origins describe installed bytes and exact source gates separately',async t=>{
  for(const id of ['OL07','OL08'])await rejectObservation(t,id,o=>{o.origin='INSTALLED_PUBLIC_PRODUCT';},/Incorrect limited evidence origin/);
});

test('each case enforces its actual minimal transport or observation outcomes',async t=>{
  await rejectObservation(t,'OL02',o=>{o.trace=o.trace.filter(e=>e.request?.operation!=='receipt.read');},/receipt.read/);
  await rejectObservation(t,'OL03',o=>{o.trace.find(e=>e.request?.operation==='reasoning.inspect').body.result.result.complete=false;});
  await rejectObservation(t,'OL05',o=>{o.trace=o.trace.filter(e=>e.body?.error?.code!=='FORBIDDEN');},/FORBIDDEN/);
  await rejectObservation(t,'OL05',o=>{o.trace.find(e=>e.kind==='ISOLATED_PERMISSION_FAULT').restored=false;});
  await rejectObservation(t,'OL06',o=>{o.trace[0].observations=o.trace[0].observations.filter(x=>x.id!=='retired-mutation-denied');},/Missing historical observation/);
  await rejectObservation(t,'OL06',o=>{o.trace[0].bindings.runtimeDigest=hashBytes('foreign runtime');});
  await rejectObservation(t,'OL07',o=>{o.trace[0].files.pop();},/Complete installed declaration/);
  await rejectObservation(t,'OL07',o=>{o.trace[0].scope+='changed';},/approved document/);
  await rejectObservation(t,'OL08',o=>{delete o.trace[0].unknownRequiredEvidence;},/Missing native release refusal/);
});
