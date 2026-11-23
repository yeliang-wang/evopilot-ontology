import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openNativeCollector,successful,expectFormal} from './native-public.mjs';
import {runLimitedHistory} from './limited-history.mjs';
import {limitedCollectorDependencies,assertLimitedResultStatus} from '../../../scripts/limited-preview-gate-v090.mjs';
import {validatePublicationDecision,releaseIdentity} from '../../../scripts/limited-preview-release-v090.mjs';
import {hashBytes} from '../../../scripts/standards-gate.mjs';

// These pure probes exercise refusal rules only, never create user decisions.
export function publicationRefusalProbes(admission,sourceCommit,caseIds){
  const review={...releaseIdentity,sourceCommit,candidateDigest:admission.bindings.candidateDigest,assetsDigest:hashBytes('Synthetic gate refusal probe; not a release manifest'),targetDigest:admission.bindings.targetDigest,policyDigest:admission.bindings.limitedPolicyDigest,acceptanceDigest:hashBytes('No complete acceptance yet'),standardsDecisionDigest:admission.decisionDigest,publisherLogin:'synthetic-refusal-probe',acceptanceCompletedAt:new Date().toISOString(),releaseAuthorized:false};
  const reviewDigest=hashBytes(JSON.stringify(review,null,2)+'\n');
  assert.throws(()=>validatePublicationDecision(null,null,review,reviewDigest));
  const keys=['repository','tag','sourceCommit','candidateDigest','assetsDigest','targetDigest','policyDigest','acceptanceDigest','standardsDecisionDigest','publisherLogin'];
  const notBefore=new Date().toISOString(),bindings={...Object.fromEntries(keys.map(k=>[k,review[k]])),prerelease:true,reviewDigest,notBefore,expiresAt:null};
  const decision={schema:'ontology-limited-release-decision/v1',actor:'USER',action:'AUTHORIZE_RELEASE',bindings:{...bindings,candidateDigest:hashBytes('foreign candidate')},source:{path:'synthetic-not-a-user-record.json',digest:hashBytes('No actual approval')},notBefore,expiresAt:null};
  assert.throws(()=>validatePublicationDecision(decision,null,review,reviewDigest),/different exact candidate/);
  decision.actor='AGENT';assert.throws(()=>validatePublicationDecision(decision,null,review,reviewDigest));
  const base={schema:'ontology-limited-product-result/v1',status:'PASS',problem:null,cleanup:null,releaseAuthorized:false,candidateDigest:admission.bindings.candidateDigest,cases:caseIds.map(id=>({id,status:'PASS'}))};
  for(const mutate of [r=>r.cases.pop(),r=>r.cases[0].status='FAIL',r=>r.cases[0].status='UNKNOWN',r=>r.candidateDigest=hashBytes('stale candidate')]){const bad=structuredClone(base);mutate(bad);assert.throws(()=>assertLimitedResultStatus(bad,caseIds,admission.bindings.candidateDigest));}
  return {kind:'EXACT_SOURCE_RELEASE_GATE_NEGATIVES',syntheticProbe:true,sourceCommit,candidateDigest:admission.bindings.candidateDigest,missingDecision:'REFUSED',foreignCandidate:'REFUSED',agentApproval:'REFUSED',missingRequiredEvidence:'REFUSED',failedRequiredEvidence:'REFUSED',unknownRequiredEvidence:'REFUSED',staleCandidateEvidence:'REFUSED',remoteOperations:0,releaseAuthorized:false};
}

export async function collectLimitedPreview(){
const extra=limitedCollectorDependencies.filter(p=>p!=='tests/acceptance/v090/native-public.mjs').map(p=>new URL('../../../'+p,import.meta.url));
const c=await openNativeCollector('LIMITED',import.meta.url,extra,'limited-preview-v090');
const expected=id=>({expected:c.cases.find(x=>x.id===id).expected});
const denied=(r,code)=>{assert.notEqual(r.status,200);assert.equal(r.body.ok,false);assert.equal(r.body.error.code,code);};
let problem=null;
try{
  await c.case('OL02',async()=>{
    const f=c.fixture('limited-lifecycle',true);const created=successful(await f.request('project.create',{label:'Isolated limited Preview lifecycle'},{requestId:'create',expectedRevision:0}));
    c.ok(['installation-inspect','--installation',f.installation]);assert.equal(successful(await f.request('project.inspect')).revision,created.revision);
    f.stop();f.start();assert.deepEqual(successful(await f.request('receipt.read',{requestId:'create'})),created);f.stop();
    return expected('OL02');
  });
  await c.case('OL03',async()=>{
    const f=await c.model('limited-model',c.original('WebOnt-equivalentClass-001'));
    const model=await f.read('model.inspect',{assetId:'official',modelDigest:f.modelDigest});assert.equal(model.current,true);
    for(const document of f.draft.closure.documents){const page=await f.read('model.document.read',{assetId:'official',modelDigest:f.modelDigest,documentId:document.id,offset:0,maxBytes:65536});assert.equal(page.content,document.content);}
    expectFormal(await f.reason({kind:'consistency'}),'COMPLETED');
    assert.equal((await f.read('intent.read',{digest:f.draft.intentDigest})).definition.exclusions.includes('Business delivery'),true);
    return expected('OL03');
  });
  await c.case('OL05',async()=>{
    const f=await c.model('limited-negatives',c.original('WebOnt-equivalentClass-001'));
    denied(await f.request('project.inspect',{},null,{},'invalid'),'UNAUTHENTICATED');
    const request={workspaceId:f.connection.workspaceId,serviceId:f.connection.serviceId,projectId:f.connection.projectId,operation:'project.inspect',input:{}};
    const absent=await fetch(f.connection.origin+'/v1/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(10000)}),body=await absent.json();
    c.observe({kind:'HTTP_NO_AUTHORIZATION',request,status:absent.status,body});denied({status:absent.status,body},'UNAUTHENTICATED');
    denied(await f.request('project.inspect',{},null,{projectId:'foreign'}),'FORBIDDEN');
    const draft=structuredClone(f.draft);draft.previousDigest=f.modelDigest;draft.closure.documents[0].content+=' altered bytes';await f.reject('model.record',{draft},'DIGEST_MISMATCH');
    const credentials=join(f.workspace,'credentials.json'),original=readFileSync(credentials),grants=JSON.parse(original);
    grants.grants[0].permissions=['read'];writeFileSync(credentials,JSON.stringify(grants),{mode:0o600});
    try{denied(await f.request('model.record',{draft},{requestId:'no-write',expectedRevision:(await f.read('project.inspect')).revision}),'FORBIDDEN');}
    finally{writeFileSync(credentials,original,{mode:0o600});}
    c.observe({kind:'ISOLATED_PERMISSION_FAULT',permission:'read',restored:true,credentialContentRetained:false});
    assert.equal((await f.read('model.inspect',{assetId:'official',modelDigest:f.modelDigest})).current,true);
    return expected('OL05');
  });
  await c.case('OL06',async()=>{
    const input=c.support('limited-history');assert.equal(input.candidateDigest,c.admission.bindings.candidateDigest);assert.equal(input.runtime.digest,c.config.runtimeDigest);assert.equal(input.sourceCommit,c.config.sourceCommit);
    const observed=await runLimitedHistory(input);assert.equal(observed.technicalStatus,'PASS');assert.equal(observed.authority,false);
    // Provenance is checked against retained original producer/receipt bytes by
    // the history adapter. No synthetic unit fixture is an acceptance receipt.
    c.observe({kind:'HISTORICAL_INSTALLED_PUBLIC_READ',...observed});return expected('OL06');
  });
  await c.case('OL07',async()=>{
    const pkg=join(c.config.runtimeRoot,'node_modules/@evopilot-next/ontology'),files=['README.md','README_CN.md','CHANGELOG.md','docs/ontology-v090-limited-preview.md','docs/ontology-v090-limited-preview-install.md','plugins/codex/.codex-plugin/plugin.json','plugins/codex/skills/evopilot-ontology-expert/SKILL.md'];
    const contents=new Map(files.map(path=>[path,readFileSync(join(pkg,path),'utf8')]));
    for(const path of ['README.md','README_CN.md']){const text=contents.get(path);assert.match(text,/Linux arm64/i);assert.match(text,/limited|限定/i);assert.match(text,/ontology-v090-limited-preview/);}
    const plugin=JSON.parse(contents.get('plugins/codex/.codex-plugin/plugin.json'));assert.equal(plugin.version,'0.9.0');assert.match(plugin.description,/limited|限定/i);
    const scope=contents.get('docs/ontology-v090-limited-preview.md');for(const word of ['OWL','143','OL10','Linux'])assert(scope.includes(word));
    c.observe({kind:'INSTALLED_PACKAGE_DECLARATIONS',files:[...contents].map(([path,text])=>({path,digest:hashBytes(text)})),plugin,scope});
    return expected('OL07');
  });
  await c.case('OL08',async()=>{
    c.observe(publicationRefusalProbes(c.admission,c.config.sourceCommit,c.cases.map(item=>item.id)));
    return expected('OL08');
  });
}catch(error){problem=error.message;}finally{await c.finish(problem);}

}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await collectLimitedPreview();
