// Independent publication operator. Source/acceptance evidence is never user authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,lstatSync,readSync,readFileSync,writeFileSync,mkdirSync,realpathSync,existsSync} from 'node:fs';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {candidateFiles,validateSourceCandidate,validateSourceArtifact,validateCandidateFiles} from './prepare-release-v090.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
export const releaseIdentity=Object.freeze({repository:'yeliang-wang/evopilot-ontology',repositoryId:1416266852,tag:'v0.9.0',prerelease:true,profile:'ontology-v090-limited-preview'});
const ARCHIVE='evopilot-next-ontology-0.9.0.tgz';
const NATIVE_IDS=['dl-payload','shacl-worker','java-runtime','java-source','java-runtime-metadata','java-source-metadata','java-sbom','java-sbom-metadata','python-runtime','python-build-material','python-wheels','dl-sources','dl-notices'];
const digest=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const hashed=value=>digest(jsonBytes(value));
const validDigest=value=>assert.match(value,/^sha256:[a-f0-9]{64}$/);
const exact=(value,keys)=>{assert(value&&typeof value==='object'&&!Array.isArray(value));assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),'Unknown/missing record fields');};
const timestamp=value=>{assert.equal(typeof value,'string');assert.match(value,/^\d{4}-\d\d-\d\dT/);const n=Date.parse(value);assert(Number.isFinite(n));return n;};
const text=value=>assert(typeof value==='string'&&value.trim()&&value.length<=65536,'Missing bounded text');
const name=value=>assert(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._+-]{0,180}$/.test(value),'Unsafe asset name');
const local=value=>assert(typeof value==='string'&&!isAbsolute(value)&&!value.includes('\\')&&value.split('/').every(x=>x&&x!=='.'&&x!=='..'),'Unsafe relative path');

// Native source/JRE companions exceed the standards reader envelope. Stream their
// hashes with an independent 512 MiB/file limit; keep metadata under 32 MiB.
export function releaseEvidence(root,repositoryRoot=ROOT){
  assert(isAbsolute(root)&&realpathSync(root)===root&&lstatSync(root).isDirectory());
  const rel=relative(realpathSync(repositoryRoot),root);assert(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel),'Private evidence must be outside source');
  const seen=new Map();
  function inspect(ref,bytes=false){
    exact(ref,['path','digest']);local(ref.path);validDigest(ref.digest);const path=resolve(root,ref.path);assert.equal(realpathSync(path),path,'Evidence symlinks refused');
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{
      const before=fstatSync(fd);assert(before.isFile()&&before.nlink===1&&before.size<=(bytes?32:512)*1024*1024,'Unsafe/oversized evidence');
      const hash=createHash('sha256'),chunks=[],buffer=Buffer.alloc(1024*1024);let count=0;
      for(;;){const n=readSync(fd,buffer,0,buffer.length,null);if(!n)break;count+=n;assert(count<=before.size);hash.update(buffer.subarray(0,n));if(bytes)chunks.push(Buffer.from(buffer.subarray(0,n)));}
      const after=fstatSync(fd),current=lstatSync(path);assert.equal(count,before.size);
      for(const s of [after,current])for(const key of ['dev','ino','size','mtimeMs','ctimeMs'])assert.equal(s[key],before[key],'Evidence changed during read');
      assert.equal('sha256:'+hash.digest('hex'),ref.digest,'Evidence digest mismatch');
      if(seen.has(ref.path))assert.deepEqual(seen.get(ref.path),ref);seen.set(ref.path,{...ref});
      return bytes?Buffer.concat(chunks):{path,bytes:count,digest:ref.digest};
    }finally{closeSync(fd);}
  }
  return {root,inspect,bytes:ref=>inspect(ref,true),json:ref=>JSON.parse(inspect(ref,true)),recheck(){for(const ref of seen.values())inspect(ref);}};
}

export function validateAdmission(admission,input){
  assert.equal(admission.schema,'ontology-limited-release-admission/v1');
  assert.equal(admission.status,'ALLOW_RELEASE_REVIEW');assert.equal(admission.releaseAuthorized,false);
  assert.equal(admission.sourceCommit,input.sourceCommit);assert.equal(admission.candidateDigest,input.candidateDigest);
  for(const k of ['targetDigest','policyDigest','acceptanceDigest'])validDigest(admission[k]);timestamp(admission.completedAt);
  const standard=admission.standardsAdmission;assert.equal(standard.schema,'ontology-limited-product-e2e-admission/v1');assert.equal(standard.status,'ALLOW_LIMITED_PRODUCT_E2E');assert.equal(standard.scope,'ENTER_LIMITED_PRODUCT_E2E_ONLY');assert.equal(standard.releaseAuthorized,false);
  assert.equal(standard.bindings.candidateDigest,input.candidateDigest);assert.equal(standard.bindings.targetDigest,admission.targetDigest);validDigest(standard.decisionDigest);
  for(const k of ['candidateDigest','corpusDigest','toolchainDigest','reportDigest','freezeDigest','targetDigest','limitedPolicyDigest'])validDigest(standard.bindings[k]);
  assert.equal(standard.bindings.limitedPolicyDigest,admission.policyDigest);
}

export function validateReleaseRequest(input){
  exact(input,['schema','repository','tag','prerelease','profile','sourceCommit','sourceRunId','candidateDigest','publisherLogin','limitedRequest','source','catalogPath','assets','nativeClosure']);
  assert.equal(input.schema,'ontology-limited-publication-request/v1');for(const k of ['repository','tag','prerelease','profile'])assert.equal(input[k],releaseIdentity[k]);
  assert.match(input.sourceCommit,/^[a-f0-9]{40}$/);assert.match(input.sourceRunId,/^[1-9][0-9]*$/);validDigest(input.candidateDigest);
  assert.match(input.publisherLogin,/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/);local(input.limitedRequest);
  assert.match(input.catalogPath,/^governance\/distribution-linux-arm64-v090(?:-candidate[1-9][0-9]*)?\.json$/);
  exact(input.source,['run','metadata','zip']);assert(Array.isArray(input.assets)&&input.assets.length<=32);assert.equal(new Set(input.assets.map(a=>a.name)).size,input.assets.length);
  for(const a of input.assets){exact(a,['name','file']);name(a.name);exact(a.file,['path','digest']);local(a.file.path);validDigest(a.file.digest);assert.equal(a.file.path.split('/').at(-1),a.name,'Evidence asset basename must equal frozen release name');assert(!a.file.path.includes('#'),'gh upload label separator is not an evidence path');}
}

// sourceFile must read the exact own-repository commit, never sibling source.
export function validateDistribution(input,reader,sourceFile){
  validateReleaseRequest(input);const byName=new Map(input.assets.map(a=>[a.name,a.file]));
  const catRef=byName.get('ontology-native-catalog.json');assert(catRef,'Native catalog required');
  const catalogBytes=reader.bytes(catRef);assert.deepEqual(catalogBytes,sourceFile(input.catalogPath),'Catalog differs from exact source');const catalog=JSON.parse(catalogBytes);
  assert.equal(catalog.schema,'ontology-tool-distribution/v1');assert.deepEqual(catalog.platform,{os:'linux',arch:'arm64',libc:'glibc',minimumLibc:'2.28'});
  assert.deepEqual(catalog.artifacts.map(a=>a.id).sort(),[...NATIVE_IDS].sort(),'All thirteen native source/notice materials required');
  assert.equal(new Set(catalog.artifacts.map(a=>a.filename)).size,13);
  const expected=[ARCHIVE,'ontology-dependency-lock.json','source-revision.txt','ontology-native-catalog.json','release-notes.md',...catalog.artifacts.map(a=>a.filename)];
  assert.deepEqual([...byName.keys()].sort(),expected.sort(),'Frozen distribution asset set differs');
  const assetRecords=[];for(const a of input.assets){const actual=reader.inspect(a.file);assetRecords.push({name:a.name,bytes:actual.bytes,digest:actual.digest});}
  assert.equal(byName.get(ARCHIVE).digest,input.candidateDigest);
  assert.deepEqual(reader.bytes(byName.get('ontology-dependency-lock.json')),sourceFile('package-lock.json'),'Dependency lock differs from exact source');
  const lock=JSON.parse(reader.bytes(byName.get('ontology-dependency-lock.json')));assert.equal(lock.name,'@evopilot-next/ontology');assert.equal(lock.version,'0.9.0');assert.equal(lock.lockfileVersion,3);
  assert.equal(reader.bytes(byName.get('source-revision.txt')).toString(),input.sourceCommit+'\n');
  const notes=reader.bytes(byName.get('release-notes.md')).toString('utf8');text(notes);
  // Freeze the complete bilingual release text through the request and decision.
  assert(notes.includes('v0.9.0')&&notes.includes('Preview')&&notes.includes('Linux')&&notes.includes('ARM64'),'Version/platform missing in release notes');
  for(const a of catalog.artifacts){name(a.filename);validDigest(a.digest);const actual=assetRecords.find(x=>x.name===a.filename);assert.equal(actual.digest,a.digest);assert.equal(actual.bytes,a.bytes);}
  assert.equal(catalog.compatibility.nodeVersion,'24.14.0');
  for(const [key,path] of [['workerSourceDigest','toolchains/owl2-dl/Worker.java'],['dependencyLockDigest','toolchains/owl2-dl/dependencies.json'],['shaclAdapterDigest','src/native-v2/shacl-worker.py']])assert.equal(catalog.compatibility[key],digest(sourceFile(path)));
  const closure=reader.json(input.nativeClosure);exact(closure,['schema','candidateDigest','catalogDigest','unresolved','sourceInventory','rebuild','sourceEmbeddedLicenses']);
  assert.equal(closure.schema,'ontology-private-native-license-source-closure/v1');assert.equal(closure.candidateDigest,input.candidateDigest);assert.equal(closure.catalogDigest,catRef.digest);assert.deepEqual(closure.unresolved,[]);
  const inventory=reader.json(closure.sourceInventory),rebuild=reader.json(closure.rebuild),dlLock=JSON.parse(sourceFile('toolchains/owl2-dl/dependencies.json'));
  assert.equal(rebuild.byteIdentical,true);assert.equal(rebuild.sourcePatchesReplayed,true);assert.equal(rebuild.workerSHA256,inventory.workerJarSHA256);assert.equal(rebuild.dependencyCount,inventory.coverage.lockedBinaries);
  assert.equal(inventory.coverage.topLevelSourceArchives+inventory.coverage.emptyBinaryWithoutSources,inventory.coverage.lockedBinaries);assert.equal(inventory.components.length,dlLock.files.length);assert(dlLock.files.length>0);
  for(const f of dlLock.files){const matches=inventory.components.filter(x=>x.binaryFile===f.file);assert.equal(matches.length,1);const x=matches[0];assert.equal(x.binarySHA256,f.sha256);assert(x.source||x.exception);text(x.pomMember);assert(Array.isArray(x.declaredPomLicenses));if(!x.declaredPomLicenses.length){const fallback=closure.sourceEmbeddedLicenses.filter(v=>v.binaryFile===f.file);assert.equal(fallback.length,1);assert(x.source);assert.equal(fallback[0].archive.digest,'sha256:'+x.source.sha256);reader.inspect(fallback[0].archive);for(const item of [fallback[0].license,fallback[0].header]){local(item.member);assert(reader.bytes(item.file).length>0);}}}
  return {catalog,notes,assets:assetRecords.sort((a,b)=>a.name.localeCompare(b.name)),closureDigest:input.nativeClosure.digest};
}

function command(name,args,options={}){const result=spawnSync(name,args,{cwd:ROOT,encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024,...options});assert.ifError(result.error);assert.equal(result.status,0,'Command failed; preserve and reconcile original outcome: '+result.stderr);return result.stdout;}
function commandJSON(args){assert.equal(args[0],'api');return JSON.parse(command('gh',['api','--hostname','github.com',...args.slice(1)]));}
function sourceFile(commit,path){local(path);return command('git',['show',commit+':'+path],{encoding:null});}
function sourceInput(input){return {repository:input.repository,commit:input.sourceCommit,runId:input.sourceRunId,digest:input.candidateDigest.slice(7)};}
export function validateSourceEvidence(input,reader){
  const source=sourceInput(input),run=reader.json(input.source.run),metadata=reader.json(input.source.metadata);
  validateSourceCandidate(run,source,input.sourceCommit);const artifact=validateSourceArtifact(metadata,source),zip=reader.inspect(input.source.zip);
  assert.equal(zip.digest,artifact.digest);assert.equal(zip.bytes,artifact.size_in_bytes);
  const names=command('unzip',['-Z1',zip.path]).trimEnd().split('\n');assert.equal(names.length,new Set(names).size);assert.deepEqual(names.sort(),[...candidateFiles].sort());
  const files=new Map(candidateFiles.map(n=>[n,command('unzip',['-p',zip.path,n],{encoding:null})]));validateCandidateFiles(files,source);
  const pack=JSON.parse(files.get('pack.json'))[0];
  const archive=reader.inspect(input.assets.find(a=>a.name===ARCHIVE).file);assert.equal(digest(files.get(ARCHIVE)),archive.digest);
  // The package's actual members, not just npm's manifest, carry this source catalog.
  const members=command('tar',['-tzf',archive.path]).trimEnd().split('\n');assert.equal(members.length,new Set(members).size);
  assert.deepEqual(members.filter(x=>!x.endsWith('/')).sort(),pack.files.map(x=>'package/'+x.path).sort());
  for(const path of ['package.json',input.catalogPath,'toolchains/owl2-dl/Worker.java','toolchains/owl2-dl/dependencies.json','src/native-v2/shacl-worker.py'])assert.deepEqual(command('tar',['-xOzf',archive.path,'package/'+path],{encoding:null}),sourceFile(input.sourceCommit,path),'Package member differs from exact source: '+path);
  // Compare retained embedded-license excerpts with their original source ZIP
  // members. A nonempty caller-supplied text file is not source-license evidence.
  const closure=reader.json(input.nativeClosure);
  for(const fallback of closure.sourceEmbeddedLicenses){const sourceArchive=reader.inspect(fallback.archive);for(const item of [fallback.license,fallback.header]){local(item.member);const original=command('unzip',['-p',sourceArchive.path,item.member],{encoding:null,maxBuffer:1024*1024});assert(original.length>0);assert.deepEqual(original,reader.bytes(item.file),'License/header excerpt differs from original source member');}}
  return {runId:run.id,artifactId:artifact.id,artifactDigest:artifact.digest};
}

export function buildReview(input,requestDigest,distribution,admission,source){
  validateAdmission(admission,input);validDigest(requestDigest);
  const manifest={schema:'ontology-limited-release-manifest/v1',...releaseIdentity,sourceCommit:input.sourceCommit,sourceRunId:source.runId,candidateDigest:input.candidateDigest,catalogPath:input.catalogPath,platform:distribution.catalog.platform,assets:distribution.assets};
  const manifestBytes=jsonBytes(manifest),assets=[...distribution.assets,{name:'release-manifest.json',bytes:manifestBytes.length,digest:digest(manifestBytes)}].sort((a,b)=>a.name.localeCompare(b.name));
  const sums=Buffer.from(assets.map(a=>a.digest.slice(7)+'  '+a.name+'\n').join(''));
  assets.push({name:'SHA256SUMS',bytes:sums.length,digest:digest(sums)});assets.sort((a,b)=>a.name.localeCompare(b.name));
  const review={schema:'ontology-limited-release-review/v1',...releaseIdentity,sourceCommit:input.sourceCommit,candidateDigest:input.candidateDigest,source,publisherLogin:input.publisherLogin,requestDigest,targetDigest:admission.targetDigest,policyDigest:admission.policyDigest,standardsDecisionDigest:admission.standardsAdmission.decisionDigest,standardsBindings:admission.standardsAdmission.bindings,acceptanceDigest:admission.acceptanceDigest,acceptanceCompletedAt:admission.completedAt,nativeClosureDigest:distribution.closureDigest,assets,assetsDigest:hashed(assets),releaseAuthorized:false,postReleaseRequired:['PUBLISHED_DOWNLOAD_HASH','FRESH_ISOLATED_INSTALL_READBACK'],dailyInstallationSwitch:false,assetReset:false};
  return {review,reviewDigest:hashed(review),manifestBytes,checksumBytes:sums};
}

export function validatePublicationDecision(decision,source,review,reviewDigest,now=Date.now()){
  assert.equal(hashed(review),reviewDigest,'Review bytes differ from the reviewed digest');
  for(const k of ['repository','tag','prerelease','profile'])assert.equal(review[k],releaseIdentity[k]);assert.equal(review.releaseAuthorized,false);
  exact(decision,['schema','actor','action','bindings','source','notBefore','expiresAt']);assert.equal(decision.schema,'ontology-limited-release-decision/v1');assert.equal(decision.actor,'USER');assert.equal(decision.action,'AUTHORIZE_RELEASE');
  const bindings={repository:review.repository,tag:review.tag,prerelease:true,sourceCommit:review.sourceCommit,candidateDigest:review.candidateDigest,reviewDigest,assetsDigest:review.assetsDigest,targetDigest:review.targetDigest,policyDigest:review.policyDigest,acceptanceDigest:review.acceptanceDigest,standardsDecisionDigest:review.standardsDecisionDigest,publisherLogin:review.publisherLogin,notBefore:decision.notBefore,expiresAt:decision.expiresAt};
  assert.deepEqual(decision.bindings,bindings,'Publication decision is for a different exact candidate');
  exact(source,['schema','role','threadId','turnId','messageId','text','action','bindings','occurredAt']);assert.equal(source.schema,'ontology-user-release-source/v1');assert.equal(source.role,'user');assert.equal(source.action,'AUTHORIZE_RELEASE');assert.deepEqual(source.bindings,bindings);
  for(const k of ['threadId','turnId','messageId','text'])text(source[k]);
  const start=timestamp(decision.notBefore),end=decision.expiresAt===null?null:timestamp(decision.expiresAt),occurred=timestamp(source.occurredAt);assert(occurred>=timestamp(review.acceptanceCompletedAt),'Decision predates acceptance');assert.equal(start,occurred,'Effective time must match the actual user decision');if(end!==null)assert(end>start,'Invalid explicitly supplied expiry');assert(now>=start&&(end===null||now<end),'Release decision is not currently effective');
  return {bindings,expiresAt:end};
}

function writeNew(path,bytes){writeFileSync(path,bytes,{flag:'wx',mode:0o600});}
export async function inspectRelease(evidenceRoot,requestPath,repositoryRoot=ROOT){
  local(requestPath);const requestFile=resolve(evidenceRoot,requestPath);assert.equal(realpathSync(requestFile),requestFile);
  const requestBytes=readFileSync(requestFile);assert(requestBytes.length<=1024*1024);const requestDigest=digest(requestBytes),reader=releaseEvidence(evidenceRoot,repositoryRoot),input=reader.json({path:requestPath,digest:requestDigest});validateReleaseRequest(input);
  assert.equal(command('git',['rev-parse','HEAD'],{cwd:repositoryRoot}).trim(),input.sourceCommit,'Exact source checkout required');assert.equal(command('git',['status','--porcelain'],{cwd:repositoryRoot}),'','Freeze and commit reviewed source before preparation');
  const source=validateSourceEvidence(input,reader),distribution=validateDistribution(input,reader,path=>sourceFile(input.sourceCommit,path));
  const {checkLimitedPreviewRelease}=await import('./limited-preview-gate-v090.mjs');
  const admission=await checkLimitedPreviewRelease(evidenceRoot,input.limitedRequest,repositoryRoot);validateAdmission(admission,input);
  const built=buildReview(input,requestDigest,distribution,admission,source);reader.recheck();return {input,reader,distribution,admission,...built};
}

export async function prepareReview(evidenceRoot,requestPath,output){
  assert(isAbsolute(output)&&!existsSync(output));const checked=await inspectRelease(evidenceRoot,requestPath);
  mkdirSync(output,{mode:0o700});writeNew(join(output,'release-review.json'),jsonBytes(checked.review));writeNew(join(output,'release-review.sha256'),checked.reviewDigest+'\n');writeNew(join(output,'release-manifest.json'),checked.manifestBytes);writeNew(join(output,'SHA256SUMS'),checked.checksumBytes);
  return {status:'READY_FOR_USER_RELEASE_REVIEW',reviewDigest:checked.reviewDigest,sourceCommit:checked.input.sourceCommit,candidateDigest:checked.input.candidateDigest,releaseAuthorized:false,publicationAttempted:false};
}

export function validateAbsent(response,status,error){const statuses=[...response.matchAll(/^HTTP\/\S+ (\d{3})\b/gm)].map(m=>m[1]);assert(!error&&Number.isInteger(status)&&status!==0&&statuses.length===1&&statuses[0]==='404','Existing or uncertain remote state: inspect before retry');}
export function validateReleaseAssets(release,review,{draft,releaseId,complete=true}){
  assert.equal(typeof draft,'boolean');assert(Number.isSafeInteger(releaseId)&&releaseId>0);assert.equal(release.id,releaseId,'Release identity changed');
  assert.equal(release.tag_name,review.tag);assert.equal(release.prerelease,true);assert.equal(release.draft,draft,'Unexpected draft/public state');assert.equal(release.target_commitish,review.sourceCommit);
  assert(Array.isArray(release.assets));const expected=complete?review.assets:[];assert.equal(release.assets.length,expected.length,'Incomplete or unexpected release assets');
  assert.equal(new Set(release.assets.map(a=>a.name)).size,release.assets.length);
  for(const asset of expected){const rows=release.assets.filter(a=>a.name===asset.name);assert.equal(rows.length,1);assert.equal(rows[0].state,'uploaded');assert.equal(rows[0].size,asset.bytes);assert.equal(rows[0].digest,asset.digest);}
  return {releaseId,draft,assets:release.assets.length};
}
export async function publishRelease(evidenceRoot,requestPath,decisionPath,output){
  assert(isAbsolute(output)&&!existsSync(output)&&!output.includes('#')&&!evidenceRoot.includes('#'));local(decisionPath);const checked=await inspectRelease(evidenceRoot,requestPath),{input,reader,review,reviewDigest}=checked;
  const decisionBytes=readFileSync(resolve(evidenceRoot,decisionPath));assert(decisionBytes.length<=1024*1024);const decisionRef={path:decisionPath,digest:digest(decisionBytes)},decision=reader.json(decisionRef),userSource=reader.json(decision.source);
  validatePublicationDecision(decision,userSource,review,reviewDigest);
  // An actual Host user message must be independently verified before recording it.
  // JSON integrity and the authenticated GitHub account do not authenticate a chat.
  const account=commandJSON(['api','user']);assert.equal(account.login,input.publisherLogin,'Authenticated publisher differs from the reviewed account');assert(Number.isSafeInteger(account.id)&&account.id>0);
  const repository=commandJSON(['api','repos/'+input.repository]);assert.equal(repository.id,releaseIdentity.repositoryId);assert.equal(repository.full_name,input.repository);
  const source=sourceInput(input),run=commandJSON(['api','repos/'+input.repository+'/actions/runs/'+input.sourceRunId]);validateSourceCandidate(run,source,input.sourceCommit);
  const artifact=validateSourceArtifact(commandJSON(['api','repos/'+input.repository+'/actions/runs/'+input.sourceRunId+'/artifacts?per_page=100']),source);assert.equal(artifact.id,review.source.artifactId);assert.equal(artifact.digest,review.source.artifactDigest);
  for(const endpoint of ['releases/tags/'+input.tag,'git/ref/tags/'+input.tag]){const r=spawnSync('gh',['api','--hostname','github.com','--include','repos/'+input.repository+'/'+endpoint],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});validateAbsent(r.stdout,r.status,r.error);}
  reader.recheck();mkdirSync(output,{mode:0o700});writeNew(join(output,'review.json'),jsonBytes(review));writeNew(join(output,'decision.json'),decisionBytes);writeNew(join(output,'publisher.json'),jsonBytes({login:account.login,id:account.id,repositoryId:repository.id}));
  const generated=join(output,'generated');mkdirSync(generated,{mode:0o700});writeNew(join(generated,'release-manifest.json'),checked.manifestBytes);writeNew(join(generated,'SHA256SUMS'),checked.checksumBytes);
  let serial=0;
  const mutate=(operation,args)=>{
    validatePublicationDecision(decision,userSource,review,reviewDigest);reader.recheck();const id=String(++serial).padStart(2,'0');
    writeNew(join(output,id+'-request.json'),jsonBytes({operation,args,attempt:1,startedAt:new Date().toISOString(),decisionDigest:decisionRef.digest,reviewDigest}));
    const r=spawnSync('gh',args,{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
    writeNew(join(output,id+'-result.json'),jsonBytes({status:r.status,signal:r.signal,error:r.error?.message??null,stdout:r.stdout??'',stderr:r.stderr??'',completedAt:new Date().toISOString()}));
    assert(!r.error&&r.status===0,'Publication outcome requires manual reconciliation; do not retry or delete tag/assets');return r.stdout;
  };
  mutate('CREATE_EXACT_TAG',['api','--hostname','github.com','--method','POST','repos/'+input.repository+'/git/refs','-f','ref=refs/tags/'+input.tag,'-f','sha='+input.sourceCommit]);
  const notes=reader.inspect(input.assets.find(a=>a.name==='release-notes.md').file).path;
  // Create unpublished first. The raw response supplies the exact draft id used
  // for both verification and final publication; tags are not an update selector.
  const draftRequest=join(output,'create-draft.json');writeNew(draftRequest,jsonBytes({tag_name:input.tag,target_commitish:input.sourceCommit,name:'EvoPilot-ontology v0.9.0 Limited Preview',body:readFileSync(notes,'utf8'),draft:true,prerelease:true,make_latest:'false'}));
  const created=JSON.parse(mutate('CREATE_DRAFT',['api','--hostname','github.com','--method','POST','repos/'+input.repository+'/releases','--input',draftRequest]));
  validateReleaseAssets(created,review,{draft:true,releaseId:created.id,complete:false});writeNew(join(output,'draft-created.json'),jsonBytes(created));
  // gh owns binary transfer framing. Do not write Content-Length or pass binary data
  // via --field/--raw-field; upload one frozen file per retained attempt, no clobber.
  for(const asset of review.assets){const supplied=input.assets.find(a=>a.name===asset.name),path=supplied?reader.inspect(supplied.file).path:join(generated,asset.name);assert.equal(digest(readFileSync(path)),asset.digest);assert.equal(path.split(sep).at(-1),asset.name,'Evidence asset basename must equal the frozen release asset name');mutate('UPLOAD_ASSET:'+asset.name,['release','upload',input.tag,path,'--repo','https://github.com/'+input.repository]);}
  const draft=commandJSON(['api','repos/'+input.repository+'/releases/'+created.id]);writeNew(join(output,'draft-complete-readback.json'),jsonBytes(draft));validateReleaseAssets(draft,review,{draft:true,releaseId:created.id});
  assert.equal(draft.body,readFileSync(notes,'utf8'),'Draft release notes changed');
  const beforeTag=commandJSON(['api','repos/'+input.repository+'/git/ref/tags/'+input.tag]);writeNew(join(output,'pre-publication-tag-readback.json'),jsonBytes(beforeTag));assert.equal(beforeTag.object.type,'commit');assert.equal(beforeTag.object.sha,input.sourceCommit);
  // Only this fully verified draft becomes public. Failure leaves its original
  // id/journal intact; no second release is created and uploads are never retried.
  const publishRequest=join(output,'publish-draft.json');writeNew(publishRequest,jsonBytes({draft:false,prerelease:true,make_latest:'false'}));
  const published=JSON.parse(mutate('PUBLISH_VERIFIED_DRAFT',['api','--hostname','github.com','--method','PATCH','repos/'+input.repository+'/releases/'+created.id,'--input',publishRequest]));validateReleaseAssets(published,review,{draft:false,releaseId:created.id});
  const release=commandJSON(['api','repos/'+input.repository+'/releases/'+created.id]);writeNew(join(output,'release-readback.json'),jsonBytes(release));validateReleaseAssets(release,review,{draft:false,releaseId:created.id});assert.equal(release.body,readFileSync(notes,'utf8'),'Published release notes changed');
  const tag=commandJSON(['api','repos/'+input.repository+'/git/ref/tags/'+input.tag]);writeNew(join(output,'tag-readback.json'),jsonBytes(tag));assert.equal(tag.object.type,'commit');assert.equal(tag.object.sha,input.sourceCommit);
  return {status:'PUBLISHED_AWAITING_ISOLATED_DOWNLOAD_READBACK',releaseId:release.id,reviewDigest,downloadReadback:'NOT_EVALUATED',installation:'NOT_EVALUATED',dailyInstallationSwitch:false,assetReset:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    assert.equal(process.versions.node,'24.14.0');const [operation,...args]=process.argv.slice(2);assert(['prepare-review','publish'].includes(operation));
    const expected=operation==='publish'?['--evidence','--request','--decision','--output']:['--evidence','--request','--output'];assert.equal(args.length,expected.length*2);expected.forEach((key,i)=>assert.equal(args[i*2],key));
    const values=Object.fromEntries(expected.map((key,i)=>[key,args[i*2+1]]));
    console.log(JSON.stringify(operation==='publish'?await publishRelease(values['--evidence'],values['--request'],values['--decision'],values['--output']):await prepareReview(values['--evidence'],values['--request'],values['--output'])));
  }catch(error){console.error(JSON.stringify({status:'BLOCKED',reason:error.message,releaseAuthorized:false,recovery:'Preserve all evidence; inspect any original remote mutation before a separately reviewed continuation. No automatic retries or deletion.'}));process.exitCode=1;}
}
