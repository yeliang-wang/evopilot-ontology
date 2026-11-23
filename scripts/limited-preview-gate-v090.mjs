import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join,isAbsolute,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inspectGovernance} from './roadmap.mjs';
import {evidenceReader,hashBytes,checkLimitedStandardsGate} from './standards-gate.mjs';
import {validateSourceCandidate,validateSourceArtifact} from './prepare-release-v090.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
export const limitedCollectorDependencies=Object.freeze(['tests/acceptance/v090/native-public.mjs','tests/acceptance/v090/limited-history.mjs','scripts/limited-preview-release-v090.mjs','scripts/limited-preview-gate-v090.mjs','scripts/standards-gate.mjs','scripts/roadmap.mjs','scripts/prepare-release-v090.mjs']);
const exact=(v,keys)=>{assert(v&&typeof v==='object'&&!Array.isArray(v));assert.deepEqual(Object.keys(v).sort(),[...keys].sort(),'Unknown or missing request fields');};
const at=value=>{assert(typeof value==='string'&&Number.isFinite(Date.parse(value)),'Timestamp required');return Date.parse(value);};

export async function preflightLimitedProductE2E(root,requestPath,repositoryRoot=ROOT){
  const reader=evidenceReader(root,repositoryRoot),request=reader.json(requestPath);
  exact(request,['schema','candidate','corpus','toolchain','report']);
  assert.equal(request.schema,'ontology-limited-product-e2e-request/v1');
  const bindings={};for(const key of ['candidate','corpus','toolchain','report']){reader.ref(request[key]);bindings[key+'Digest']=request[key].digest;}
  const result=await checkLimitedStandardsGate(root,bindings,repositoryRoot);reader.recheck();return result;
}

// A pure negative-check helper for the native release probe. Passing this
// structural check alone grants no admission: the release gate must also verify
// standards approval, exact source, binding chains and original observations.
export function assertLimitedResultStatus(result,caseIds,candidateDigest){
  assert(result&&typeof result==='object'&&!Array.isArray(result),'Limited result required');
  assert(Array.isArray(caseIds)&&caseIds.length>0&&new Set(caseIds).size===caseIds.length,'Fixed nonempty case IDs required');
  assert.match(candidateDigest,/^sha256:[a-f0-9]{64}$/);
  assert.equal(result.schema,'ontology-limited-product-result/v1');assert.equal(result.status,'PASS');
  assert.equal(result.problem,null);assert.equal(result.cleanup,null);assert.equal(result.releaseAuthorized,false);
  assert.equal(result.candidateDigest,candidateDigest,'Limited result belongs to a stale or different candidate');
  assert(Array.isArray(result.cases));assert.equal(result.cases.length,caseIds.length,'Required limited cases missing');
  assert.equal(new Set(result.cases.map(c=>c.id)).size,caseIds.length,'Duplicate limited cases');
  for(const id of caseIds){const item=result.cases.find(c=>c.id===id);assert(item,'Required limited case missing');assert.equal(item.status,'PASS','Missing, failed or unknown limited case');}
}

export const limitedCaseOrigins=Object.freeze({OL02:'INSTALLED_PUBLIC_PRODUCT',OL03:'INSTALLED_PUBLIC_PRODUCT',OL05:'INSTALLED_PUBLIC_PRODUCT',OL06:'INSTALLED_PUBLIC_PRODUCT',OL07:'INSTALLED_PACKAGE_DECLARATIONS',OL08:'EXACT_SOURCE_RELEASE_GATE'});
const declarationFiles=Object.freeze(['README.md','README_CN.md','CHANGELOG.md','docs/ontology-v090-limited-preview.md','docs/ontology-v090-limited-preview-install.md','plugins/codex/.codex-plugin/plugin.json','plugins/codex/skills/evopilot-ontology-expert/SKILL.md']);
const historyChecks=Object.freeze(['exact-asset-read','exact-receipt-read','delivery-verification','cross-project-denied','cross-visibility-denied','foreign-receipt-denied','tampered-delivery-rejected','unknown-schema-rejected','retired-mutation-denied','business-and-original-evidence-preserved']);
const kinds=new Set(['CLI','HTTP','HTTP_NO_AUTHORIZATION','ISOLATED_PERMISSION_FAULT','SUPPORTING_EVIDENCE','HISTORICAL_INSTALLED_PUBLIC_READ','INSTALLED_PACKAGE_DECLARATIONS','EXACT_SOURCE_RELEASE_GATE_NEGATIVES']);
function inspectLimitedTrace(id,trace,{reader,config,gov,admission,sourceCommit,repositoryRoot}){
  assert(Array.isArray(trace)&&trace.length>0,'Retained original observations required');
  const clis=[];
  for(const event of trace){
    assert(event&&kinds.has(event.kind),'Unknown limited observation kind');
    if(event.kind==='CLI'){
      assert.equal(event.cli,join(config.runtimeRoot,'node_modules/@evopilot-next/ontology/dist/standalone/cli.js'),'Observed operator differs from frozen runtime');
      assert(Array.isArray(event.args)&&event.args.every(a=>typeof a==='string'));
      const body=reader.refJson(event.stdout);reader.ref(event.stderr);
      assert.equal(event.status,0,'Observed operator failed');assert.equal(event.signal,null);assert.equal(event.error,null);assert.equal(body.ok,true);
      clis.push({...event,body});
    }
    if(event.kind==='HTTP'||event.kind==='HTTP_NO_AUTHORIZATION'){
      assert(event.request&&typeof event.request.operation==='string'&&event.body&&Number.isSafeInteger(event.status),'Incomplete HTTP observation');
      for(const key of ['workspaceId','serviceId','projectId'])assert(typeof event.request[key]==='string'&&event.request[key],'Missing observed scope');
      assert(event.body.ok===true||event.body.ok===false,'Unknown HTTP result');
    }
  }
  const one=(kind,predicate=()=>true)=>{const found=trace.filter(e=>e.kind===kind&&predicate(e));assert.equal(found.length,1,'Expected one '+kind+' observation');return found[0];};
  const cli=(command,count=1)=>{const found=clis.filter(e=>e.args[0]===command);assert(found.length>=count,'Missing installed '+command+' observation');return found;};
  const ok=(operation)=>{const found=trace.filter(e=>e.kind==='HTTP'&&e.request.operation===operation&&e.status===200&&e.body.ok===true&&e.body.result&&typeof e.body.result==='object');assert(found.length,'Missing successful '+operation+' observation');return found;};
  const negative=(operation,code,predicate=()=>true,kind='HTTP')=>{const found=trace.filter(e=>e.kind===kind&&e.request.operation===operation&&e.status>=400&&e.status<500&&e.body.ok===false&&e.body.error?.code===code&&predicate(e));assert(found.length,'Missing installed '+operation+' '+code+' rejection');return found;};
  if(['OL02','OL03','OL05'].includes(id)){
    const installs=cli('install');for(const e of installs){const value=flag=>e.args[e.args.indexOf(flag)+1];assert(e.args.includes('--mode')&&value('--mode')==='create');assert(e.args.includes('--runtime-root')&&value('--runtime-root')===config.runtimeRoot);assert(e.args.includes('--runtime-digest')&&value('--runtime-digest')===config.runtimeDigest);}
    cli('start');cli('stop');cli('toolchains-bind');
  }
  if(id==='OL02'){
    cli('start',2);cli('stop',2);cli('installation-inspect');
    const created=ok('project.create')[0],receipt=ok('receipt.read').find(e=>e.request.input?.requestId===created.request.requestId);assert(receipt,'Original creation receipt read required');
    assert.deepEqual(receipt.body.result,created.body.result,'Restart changed original receipt');
    assert(ok('project.inspect').some(e=>e.body.result.revision===created.body.result.revision),'Created revision was not read');
  }else if(id==='OL03'){
    for(const operation of ['project.create','intent.record','source.admit','model.record','model.inspect','model.document.read','reasoning.start','reasoning.inspect','receipt.read','intent.read'])ok(operation);
    const recorded=ok('model.record')[0],draft=recorded.request.input?.draft,modelDigest=recorded.body.result.result?.modelDigest;assert.match(modelDigest,/^sha256:[a-f0-9]{64}$/);assert(Array.isArray(draft?.closure?.documents)&&draft.closure.documents.length>0);
    assert(ok('model.inspect').some(e=>e.request.input?.modelDigest===modelDigest&&e.body.result.current===true),'Current exact model read required');
    for(const document of draft.closure.documents){assert.equal(hashBytes(document.content),document.digest);assert(ok('model.document.read').some(e=>e.request.input?.modelDigest===modelDigest&&e.request.input.documentId===document.id&&e.request.input.offset===0&&e.body.result.content===document.content),'Exact original model document read required');}
    const terminal=ok('reasoning.inspect').find(e=>e.body.result.state==='FINISHED');assert(terminal,'Completed formal task observation required');
    let formal=terminal.body.result.result;
    if(!formal){const pages=ok('reasoning.result.read').filter(e=>e.request.input?.taskId===terminal.request.input?.taskId).sort((a,b)=>a.request.input.offset-b.request.input.offset);assert(pages.length);let content='',offset=0;for(const page of pages){assert.equal(page.request.input.offset,offset);assert(typeof page.body.result.content==='string');content+=page.body.result.content;offset=page.body.result.nextOffset;if(page.body.result.complete)break;}assert.equal(pages.at(-1).body.result.complete,true);formal=JSON.parse(content);}
    assert.equal(formal.status,'COMPLETED');assert.equal(formal.complete,true);assert.equal(formal.error,null);assert.equal(formal.result?.legal,true);
    assert(ok('intent.read').some(e=>e.body.result.definition?.exclusions?.includes('Business delivery')),'Synthetic modeling must not imply business delivery');
  }else if(id==='OL05'){
    const created=ok('project.create')[0];
    negative('project.inspect','UNAUTHENTICATED');negative('project.inspect','UNAUTHENTICATED',()=>true,'HTTP_NO_AUTHORIZATION');
    negative('project.inspect','FORBIDDEN',e=>e.request.projectId!==created.request.projectId);
    negative('model.record','DIGEST_MISMATCH');negative('model.record','FORBIDDEN');
    const fault=one('ISOLATED_PERMISSION_FAULT');assert.equal(fault.permission,'read');assert.equal(fault.restored,true);assert.equal(fault.credentialContentRetained,false);
    assert(ok('model.inspect').some(e=>e.body.result.current===true),'Negative probes must preserve current model');
  }else if(id==='OL06'){
    const history=one('HISTORICAL_INSTALLED_PUBLIC_READ');assert.equal(history.schema,'ontology-limited-history-observation/v1');assert.equal(history.caseId,'OL06');assert.equal(history.status,'OBSERVED');assert.equal(history.technicalStatus,'PASS');assert.equal(history.authority,false);assert.equal(history.releaseAuthorized,false);
    assert.equal(history.bindings?.candidateDigest,admission.bindings.candidateDigest);assert.equal(history.bindings?.runtimeDigest,config.runtimeDigest);assert.equal(history.bindings?.sourceCommit,sourceCommit);
    assert(Array.isArray(history.observations));assert.equal(new Set(history.observations.map(o=>o.id)).size,history.observations.length);assert(history.observations.every(o=>o.status==='PASS'),'Unknown or failed historical observation');
    for(const name of historyChecks)assert(history.observations.some(o=>o.id===name),'Missing historical observation '+name);
    for(const key of ['businessDigest','inputDigest','collectorDigest'])assert.match(history.bindings[key],/^sha256:[a-f0-9]{64}$/);
    // Original absolute paths can belong to the isolated evaluator host. The
    // retained observation binds those bytes; do not reopen a moved VM path.
  }else if(id==='OL07'){
    const declarations=one('INSTALLED_PACKAGE_DECLARATIONS');assert(Array.isArray(declarations.files));assert.deepEqual(declarations.files.map(f=>f.path).sort(),[...declarationFiles].sort(),'Complete installed declaration files required');
    for(const file of declarations.files)assert.equal(file.digest,hashBytes(readFileSync(join(repositoryRoot,file.path))),'Packaged declaration differs from exact source');
    assert.equal(hashBytes(declarations.scope),gov.target.limitedPreviewDocumentDigest,'Packaged limited scope differs from approved document');
    assert.deepEqual(declarations.plugin,JSON.parse(readFileSync(join(repositoryRoot,'plugins/codex/.codex-plugin/plugin.json'))),'Packaged plugin declaration differs');
  }else if(id==='OL08'){
    const refusal=one('EXACT_SOURCE_RELEASE_GATE_NEGATIVES');assert.equal(refusal.syntheticProbe,true);assert.equal(refusal.sourceCommit,sourceCommit);assert.equal(refusal.candidateDigest,admission.bindings.candidateDigest);
    for(const key of ['missingDecision','foreignCandidate','agentApproval','missingRequiredEvidence','failedRequiredEvidence','unknownRequiredEvidence','staleCandidateEvidence'])assert.equal(refusal[key],'REFUSED','Missing native release refusal '+key);
    assert.equal(refusal.remoteOperations,0);assert.equal(refusal.releaseAuthorized,false);
  }else assert.fail('Unknown limited case');
}

// This gate verifies retained receipts; the publisher independently reads the
// source CI/artifact from GitHub and separately verifies the exact user decision.
// Neither a caller-supplied PASS nor this technical result authorizes publication.
export async function checkLimitedPreviewRelease(root,requestPath,repositoryRoot=ROOT){
  const reader=evidenceReader(root,repositoryRoot),request=reader.json(requestPath),gov=await inspectGovernance(repositoryRoot);
  exact(request,['schema','standardsRequest','sourceCommit','sourceRun','artifactMetadata','candidateManifest','productResult']);
  assert.equal(request.schema,'ontology-limited-release-request/v1');assert.match(request.sourceCommit,/^[a-f0-9]{40}$/);
  reader.ref(request.standardsRequest);
  const admission=await preflightLimitedProductE2E(root,request.standardsRequest.path,repositoryRoot);
  const sourceRun=reader.refJson(request.sourceRun),manifest=reader.refJson(request.candidateManifest),metadata=reader.refJson(request.artifactMetadata);
  const sourceInput={repository:'yeliang-wang/evopilot-ontology',commit:request.sourceCommit,runId:String(sourceRun.id),digest:admission.bindings.candidateDigest.slice(7)};
  validateSourceCandidate(sourceRun,sourceInput,request.sourceCommit);validateSourceArtifact(metadata,sourceInput);
  assert.equal(manifest.schema,'ontology-source-candidate/v1');assert.equal(manifest.sourceCommit,request.sourceCommit);
  assert.equal(manifest.package.digest,admission.bindings.candidateDigest);assert.equal(manifest.package.filename,'evopilot-next-ontology-0.9.0.tgz');
  const frozen=reader.json('freeze.json');assert.equal(reader.ref(frozen.candidate).length,manifest.package.bytes);
  const result=reader.refJson(request.productResult),productReader=evidenceReader(resolve(root,dirname(request.productResult.path)),repositoryRoot),binding=productReader.refJson(result.binding);
  const ids=gov.limitedPreview.evidence.productCasesRequiringReportApproval;
  assertLimitedResultStatus(result,ids,admission.bindings.candidateDigest);
  assert.equal(binding.schema,'ontology-limited-collector-binding/v1');assert.deepEqual(binding.admission,admission);
  assert.equal(binding.collector.path,'tests/acceptance/v090/limited-preview.mjs');
  assert.deepEqual(binding.dependencyFiles.map(f=>f.path).sort(),[...limitedCollectorDependencies].sort(),'Complete fixed collector dependencies required');
  const files=[binding.collector,{path:'tests/acceptance/v090/public-collector.mjs',digest:binding.driverDigest},...binding.dependencyFiles];
  for(const ref of files){assert(typeof ref.path==='string'&&!isAbsolute(ref.path)&&ref.path.split('/').every(p=>p&&p!=='.'&&p!=='..')&&!ref.path.includes('\\'));assert.equal(hashBytes(readFileSync(join(repositoryRoot,ref.path))),ref.digest,'Collector source changed');}
  const evaluator=reader.refJson(frozen.evaluator),configuration=evaluator.files.find(x=>x.path==='configuration.json');assert(configuration);const config=reader.refJson(configuration),tools=reader.refJson(frozen.toolchain);assert.equal(binding.configurationDigest,configuration.digest);
  assert.equal(config.sourceCommit,request.sourceCommit,'Installed configuration source differs from release source');
  assert(typeof config.runtimeRoot==='string'&&isAbsolute(config.runtimeRoot),'Frozen installed runtime root required');
  for(const key of ['runtime','dl','shacl']){const observed=key==='runtime'?config.runtimeDigest:config[key]?.digest;assert.match(observed,/^sha256:[a-f0-9]{64}$/);assert.equal(observed,tools[key]?.digest,'Installed '+key+' differs from frozen toolchain');}
  assert.deepEqual(binding.caseIds,ids);
  assert(at(binding.startedAt)>=at(admission.reviewedAt),'Formal collection predates user admission');assert(at(result.completedAt)>=at(binding.startedAt));
  for(const id of ids){
    const item=result.cases.find(c=>c.id===id);assert(item);assert.equal(item.status,'PASS','Missing, failed or unrun limited case');
    const observation=productReader.refJson(item.observation),comparison=productReader.refJson(item.comparison);
    assert.equal(observation.schema,'ontology-product-case-observation/v1');assert.equal(observation.id,id);assert.equal(observation.origin,limitedCaseOrigins[id],'Incorrect limited evidence origin');
    assert.equal(observation.candidateDigest,admission.bindings.candidateDigest);assert.equal(observation.admissionDecisionDigest,admission.decisionDigest);assert.deepEqual(observation.collectorBinding,result.binding);
    assert(at(observation.startedAt)>=at(binding.startedAt)&&at(observation.completedAt)>=at(observation.startedAt)&&at(observation.completedAt)<=at(result.completedAt));
    inspectLimitedTrace(id,observation.trace,{reader:productReader,config,gov,admission,sourceCommit:request.sourceCommit,repositoryRoot});
    assert.equal(comparison.schema,'ontology-product-case-comparison/v1');assert.equal(comparison.id,id);assert.equal(comparison.status,'PASS');
    assert.equal(comparison.expected,gov.limitedPreview.cases.find(c=>c.id===id).expected,'Acceptance expectation changed');
  }
  reader.recheck();productReader.recheck();const after=await inspectGovernance(repositoryRoot);assert.equal(after.targetDigest,gov.targetDigest);
  return {schema:'ontology-limited-release-admission/v1',status:'ALLOW_RELEASE_REVIEW',candidateDigest:admission.bindings.candidateDigest,sourceCommit:request.sourceCommit,targetDigest:gov.targetDigest,policyDigest:gov.limitedPreviewDigest,standardsAdmission:admission,acceptanceDigest:request.productResult.digest,completedAt:result.completedAt,releaseAuthorized:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{const [mode,a,root,b,request,...extra]=process.argv.slice(2);assert(['product','release-review'].includes(mode)&&a==='--evidence'&&b==='--request'&&!extra.length,'Usage: product|release-review --evidence ABS_PRIVATE --request REL_JSON');console.log(JSON.stringify(await(mode==='product'?preflightLimitedProductE2E:checkLimitedPreviewRelease)(root,request)));}
  catch(error){console.error(JSON.stringify({status:'BLOCKED',reason:error.message,acceptance:'NOT_EVALUATED',releaseAuthorized:false}));process.exitCode=1;}
}
