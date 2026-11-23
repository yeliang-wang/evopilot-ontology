// Synthetic operator fixtures only: these never establish candidate acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,mkdirSync,symlinkSync,linkSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {releaseIdentity,releaseEvidence,validateReleaseRequest,validateDistribution,validateAdmission,validateSourceEvidence,buildReview,validatePublicationDecision,validateAbsent,validateReleaseAssets} from '../../scripts/limited-preview-release-v090.mjs';
import {sourcePreparationProfile} from '../../scripts/prepare-release-v090.mjs';

const bytes=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const h=letter=>'sha256:'+letter.repeat(64),commit='a'.repeat(40);
const nativeIds=['dl-payload','shacl-worker','java-runtime','java-source','java-runtime-metadata','java-source-metadata','java-sbom','java-sbom-metadata','python-runtime','python-build-material','python-wheels','dl-sources','dl-notices'];
function fixture(){
  const files=new Map(),source=new Map();
  const put=(path,value)=>{const data=bytes(value);files.set(path,data);return {path,digest:hash(data)};};
  const reader={bytes(ref){assert(files.has(ref.path));const data=files.get(ref.path);assert.equal(hash(data),ref.digest);return data;},json(ref){return JSON.parse(this.bytes(ref));},inspect(ref){const data=this.bytes(ref);return {path:'/not-executed/'+ref.path,bytes:data.length,digest:ref.digest};}};
  const assets=[];const asset=(name,value)=>{const file=put('assets/'+name,value);assets.push({name,file});return file;};
  const catalog={schema:'ontology-tool-distribution/v1',platform:{os:'linux',arch:'arm64',libc:'glibc',minimumLibc:'2.28'},compatibility:{nodeVersion:'24.14.0'},artifacts:[]};
  for(const id of nativeIds){const filename=id+'.tar.gz',file=asset(filename,'Synthetic material '+id);catalog.artifacts.push({id,filename,bytes:files.get(file.path).length,digest:file.digest});}
  const dlLock={files:[{file:'example.jar',sha256:'d'.repeat(64)}]};
  for(const [key,path,value] of [['workerSourceDigest','toolchains/owl2-dl/Worker.java','synthetic Java'],['dependencyLockDigest','toolchains/owl2-dl/dependencies.json',dlLock],['shaclAdapterDigest','src/native-v2/shacl-worker.py','synthetic Python']]){const data=bytes(value);source.set(path,data);catalog.compatibility[key]=hash(data);}
  const catalogPath='governance/distribution-linux-arm64-v090-candidate7.json';source.set(catalogPath,bytes(catalog));const catalogRef=asset('ontology-native-catalog.json',catalog);
  const lock={name:'@evopilot-next/ontology',version:'0.9.0',lockfileVersion:3};source.set('package-lock.json',bytes(lock));asset('ontology-dependency-lock.json',lock);asset('source-revision.txt',commit+'\n');asset('release-notes.md','v0.9.0 Limited Preview / 限定预发行\nLinux ARM64 isolated evaluation.');
  const packageRef=asset('evopilot-next-ontology-0.9.0.tgz','Synthetic npm package; never install or publish');
  const inventory={workerJarSHA256:'e'.repeat(64),coverage:{lockedBinaries:1,topLevelSourceArchives:1,emptyBinaryWithoutSources:0},components:[{binaryFile:'example.jar',binarySHA256:'d'.repeat(64),source:{sha256:'f'.repeat(64)},pomMember:'pom.xml',declaredPomLicenses:['Apache-2.0']}]};
  const closure={schema:'ontology-private-native-license-source-closure/v1',candidateDigest:packageRef.digest,catalogDigest:catalogRef.digest,unresolved:[],sourceInventory:put('inventory.json',inventory),rebuild:put('rebuild.json',{byteIdentical:true,sourcePatchesReplayed:true,workerSHA256:inventory.workerJarSHA256,dependencyCount:1}),sourceEmbeddedLicenses:[]};
  const run={id:123,repository:{id:releaseIdentity.repositoryId,full_name:releaseIdentity.repository},head_sha:commit,path:'.github/workflows/ci.yml',status:'completed',conclusion:'success',event:'push'};
  const input={schema:'ontology-limited-publication-request/v1',repository:releaseIdentity.repository,tag:'v0.9.0',prerelease:true,profile:releaseIdentity.profile,sourceCommit:commit,sourceRunId:'123',candidateDigest:packageRef.digest,publisherLogin:'fixture-user',limitedRequest:'limited-request.json',source:{run:put('run.json',run),metadata:put('metadata.json',{}),zip:put('source.zip','not a zip')},catalogPath,assets,nativeClosure:put('closure.json',closure)};
  const standard={schema:'ontology-limited-product-e2e-admission/v1',status:'ALLOW_LIMITED_PRODUCT_E2E',scope:'ENTER_LIMITED_PRODUCT_E2E_ONLY',releaseAuthorized:false,decisionDigest:h('b'),bindings:{candidateDigest:input.candidateDigest,corpusDigest:h('c'),toolchainDigest:h('d'),reportDigest:h('e'),freezeDigest:h('f'),targetDigest:h('1'),limitedPolicyDigest:h('2')}};
  const admission={schema:'ontology-limited-release-admission/v1',status:'ALLOW_RELEASE_REVIEW',releaseAuthorized:false,sourceCommit:commit,candidateDigest:input.candidateDigest,targetDigest:h('1'),policyDigest:h('2'),acceptanceDigest:h('3'),completedAt:'2026-11-23T10:00:00.000Z',standardsAdmission:standard};
  const distribution=()=>validateDistribution(input,reader,path=>{assert(source.has(path));return source.get(path);});
  const review=()=>buildReview(input,h('4'),distribution(),admission,{runId:123,artifactId:456,artifactDigest:h('5')});
  return {files,source,put,reader,input,catalog,closure,inventory,admission,distribution,review};
}

test('full native distribution and source evidence freeze twenty exact public assets without authorization',()=>{
  const f=fixture(),result=f.review();assert.equal(result.review.assets.length,20);assert.equal(result.review.releaseAuthorized,false);assert.equal(result.review.dailyInstallationSwitch,false);assert.equal(result.review.assetReset,false);
  const sums=result.checksumBytes.toString().trimEnd().split('\n');assert.equal(sums.length,19);for(const line of sums){const [d,n]=line.split('  ');assert.equal(result.review.assets.find(a=>a.name===n).digest,'sha256:'+d);}
  assert.equal(hash(result.manifestBytes),result.review.assets.find(a=>a.name==='release-manifest.json').digest);assert.equal(hash(result.checksumBytes),result.review.assets.find(a=>a.name==='SHA256SUMS').digest);
  assert.deepEqual(result.review,f.review().review,'Review is deterministic for a frozen candidate');
});

test('publication identity cannot select historical tags, other owners, arbitrary files or colliding names',()=>{
  const input=fixture().input;for(const patch of [{repository:'yeliang-wang/evopilot-runtime'},{tag:'v0.8.3'},{prerelease:false},{profile:'full'},{sourceCommit:'main'},{publisherLogin:'bad login'},{catalogPath:'../private.json'},{limitedRequest:'/outside'}])assert.throws(()=>validateReleaseRequest({...input,...patch}));
  assert.throws(()=>validateReleaseRequest({...input,assets:[...input.assets,input.assets[0]]}));
  const extra=structuredClone(input);extra.assets[0].file.path='../escape';assert.throws(()=>validateReleaseRequest(extra));
  const rename=structuredClone(input);rename.assets[0].file.path='assets/another-file';assert.throws(()=>validateReleaseRequest(rename));
});

test('missing lock/native source, stale catalog, byte drift and unclosed licenses fail before review',()=>{
  for(const change of [
    f=>f.input.assets.pop(),
    f=>f.input.assets.push({name:'private.json',file:f.put('assets/private.json','secret')}),
    f=>f.files.set(f.input.assets[0].file.path,bytes('altered')),
    f=>f.source.set('package-lock.json',bytes('changed lock')),
    f=>f.source.set(f.input.catalogPath,bytes('changed catalog')),
    f=>{f.closure.unresolved=['license not inspected'];f.input.nativeClosure=f.put('closure.json',f.closure);},
    f=>{f.closure.rebuild=f.put('rebuild.json',{byteIdentical:false,sourcePatchesReplayed:true,workerSHA256:'e'.repeat(64),dependencyCount:1});f.input.nativeClosure=f.put('closure.json',f.closure);},
    f=>{f.inventory.components[0].declaredPomLicenses=[];f.closure.sourceInventory=f.put('inventory.json',f.inventory);f.input.nativeClosure=f.put('closure.json',f.closure);},
  ]){const f=fixture();change(f);assert.throws(()=>f.review());}
});

test('limited release review refuses missing/stale/full-scope standards and invented acceptance authority',()=>{
  for(const change of [a=>{a.status='PASS';},a=>{a.releaseAuthorized=true;},a=>{a.sourceCommit='b'.repeat(40);},a=>{a.candidateDigest=h('7');},a=>{a.acceptanceDigest='missing';},a=>{a.standardsAdmission.scope='ENTER_ORIGINAL_PRODUCT_E2E_ONLY';},a=>{a.standardsAdmission.bindings.candidateDigest=h('8');},a=>{a.standardsAdmission.decisionDigest='unreviewed';}]){const f=fixture();change(f.admission);assert.throws(()=>validateAdmission(f.admission,f.input));}
});

test('forged, failed or foreign source CI is rejected before archive commands',()=>{
  for(const patch of [{conclusion:'failure'},{head_sha:'b'.repeat(40)},{path:'.github/workflows/release.yml'},{repository:{id:1,full_name:releaseIdentity.repository}},{event:'pull_request',head_repository:{id:1}}]){const f=fixture(),run=f.reader.json(f.input.source.run);f.input.source.run=f.put('run.json',{...run,...patch});assert.throws(()=>validateSourceEvidence(f.input,f.reader));}
});

function decisionFixture(){
  const f=fixture(),{review,reviewDigest}=f.review();
  const bindings={repository:review.repository,tag:review.tag,prerelease:true,sourceCommit:review.sourceCommit,candidateDigest:review.candidateDigest,reviewDigest,assetsDigest:review.assetsDigest,targetDigest:review.targetDigest,policyDigest:review.policyDigest,acceptanceDigest:review.acceptanceDigest,standardsDecisionDigest:review.standardsDecisionDigest,publisherLogin:review.publisherLogin,notBefore:'2026-11-23T11:00:00.000Z',expiresAt:'2026-11-23T12:00:00.000Z'};
  const source={schema:'ontology-user-release-source/v1',role:'user',threadId:'synthetic-thread',turnId:'synthetic-turn',messageId:'synthetic-message',text:'Synthetic authorization fixture only',action:'AUTHORIZE_RELEASE',bindings,occurredAt:'2026-11-23T11:00:00.000Z'};
  const decision={schema:'ontology-limited-release-decision/v1',actor:'USER',action:'AUTHORIZE_RELEASE',bindings,source:{path:'user.json',digest:hash(bytes(source))},notBefore:'2026-11-23T11:00:00.000Z',expiresAt:'2026-11-23T12:00:00.000Z'};
  return {decision,source,review,reviewDigest,now:Date.parse('2026-11-23T11:30:00Z')};
}

test('separate exact user decision binds review, assets, standards, account and optional actual expiry',()=>{
  const d=decisionFixture();assert.equal(validatePublicationDecision(d.decision,d.source,d.review,d.reviewDigest,d.now).bindings.reviewDigest,d.reviewDigest);
  for(const change of [d=>{d.decision.actor='ASSISTANT';},d=>{d.source.role='assistant';},d=>{d.source.action='APPROVE_PRODUCT_E2E';},d=>{d.source.messageId='';},d=>{d.decision.bindings={...d.decision.bindings,assetsDigest:h('9')};},d=>{d.decision.bindings={...d.decision.bindings,publisherLogin:'another-user'};},d=>{d.reviewDigest=h('0');},d=>{d.source.occurredAt='2026-11-23T09:00:00.000Z';},d=>{d.decision.expiresAt=d.decision.notBefore;},d=>{d.now=Date.parse(d.decision.expiresAt);},d=>{d.now=Date.parse(d.decision.notBefore)-1;}]){const d=decisionFixture();change(d);assert.throws(()=>validatePublicationDecision(d.decision,d.source,d.review,d.reviewDigest,d.now));}
  const unlimited=decisionFixture();unlimited.decision.expiresAt=null;unlimited.decision.bindings.expiresAt=null;assert.equal(validatePublicationDecision(unlimited.decision,unlimited.source,unlimited.review,unlimited.reviewDigest,unlimited.now+365*86400000).expiresAt,null);
  const explicit=decisionFixture();explicit.decision.expiresAt='2026-12-31T12:00:00.000Z';explicit.decision.bindings.expiresAt=explicit.decision.expiresAt;assert.equal(validatePublicationDecision(explicit.decision,explicit.source,explicit.review,explicit.reviewDigest,explicit.now).expiresAt,Date.parse(explicit.decision.expiresAt));
});

test('only an unambiguous authenticated 404 establishes absence',()=>{
  validateAbsent('HTTP/2.0 404 Not Found\n{}',1,undefined);
  for(const [body,status,error] of [['HTTP/2.0 200 OK',0],['HTTP/2.0 403 Forbidden',1],['HTTP/2.0 404 Not Found',0],['HTTP/2.0 404 Not Found',null],['HTTP/2.0 404 Not Found',1,Error('timeout')],['HTTP/2.0 404 Not Found\nHTTP/2.0 200 OK',1],['network unreachable',1]])assert.throws(()=>validateAbsent(body,status,error));
});

test('same complete draft is verified before public release; missing or changed uploads fail closed',()=>{
  const {review}=fixture().review(),draft={id:123,tag_name:review.tag,target_commitish:review.sourceCommit,prerelease:true,draft:true,assets:review.assets.map(a=>({name:a.name,state:'uploaded',size:a.bytes,digest:a.digest}))};
  assert.equal(validateReleaseAssets({...draft,assets:[]},review,{draft:true,releaseId:123,complete:false}).assets,0);
  assert.equal(validateReleaseAssets(draft,review,{draft:true,releaseId:123}).assets,20);
  assert.equal(validateReleaseAssets({...draft,draft:false},review,{draft:false,releaseId:123}).draft,false);
  for(const mutate of [r=>{r.id=124;},r=>{r.draft=false;},r=>{r.prerelease=false;},r=>{r.target_commitish='b'.repeat(40);},r=>{r.assets.pop();},r=>{r.assets.push(r.assets[0]);},r=>{r.assets[0].digest=h('9');},r=>{r.assets[0].size++;},r=>{r.assets[0].state='new';}]){const changed=structuredClone(draft);mutate(changed);assert.throws(()=>validateReleaseAssets(changed,review,{draft:true,releaseId:123}));}
  assert.throws(()=>validateReleaseAssets(draft,review,{draft:false,releaseId:123}));assert.throws(()=>validateReleaseAssets({...draft,draft:false},review,{draft:true,releaseId:123}));
});

test('private evidence reader refuses source paths, symlinks, hardlinks and changed bytes',t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'ontology-release-reader-')));t.after(()=>rmSync(root,{recursive:true,force:true}));const repo=join(root,'source'),evidence=join(root,'evidence');mkdirSync(repo);mkdirSync(evidence);const file=join(evidence,'asset');writeFileSync(file,'frozen');const ref={path:'asset',digest:hash(Buffer.from('frozen'))};
  const reader=releaseEvidence(evidence,repo);assert.equal(reader.inspect(ref).bytes,6);writeFileSync(file,'changed');assert.throws(()=>reader.recheck());writeFileSync(file,'frozen');
  symlinkSync(file,join(evidence,'link'));assert.throws(()=>reader.bytes({...ref,path:'link'}));linkSync(file,join(evidence,'hard'));assert.throws(()=>reader.bytes(ref));assert.throws(()=>releaseEvidence(repo,repo));assert.throws(()=>reader.bytes({...ref,path:'../source/file'}));
});

test('source preparation profile is additive and never authorizes publication',()=>{
  assert.equal(sourcePreparationProfile().profile,'original-v090');assert(sourcePreparationProfile().requiredNextSteps.includes('Original complete pre-release product acceptance'));
  assert.equal(sourcePreparationProfile('limited-preview-v090').profile,'limited-preview-v090');assert(sourcePreparationProfile('limited-preview-v090').requiredNextSteps.some(x=>x.includes('original 143 cases remain separate')));assert.throws(()=>sourcePreparationProfile('publish-now'));
});
