import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {openHostCollector} from './host-public.mjs';
import {candidateFiles,validateSourceCandidate,validateSourceArtifact,validateCandidateFiles} from '../../../scripts/prepare-release-v090.mjs';
import {checkBilingualDocumentation} from '../../../scripts/check-bilingual-documentation.mjs';
import {hashBytes} from '../../../scripts/standards-gate.mjs';

const c=await openHostCollector('RELEASE',import.meta.url,[new URL('../../../scripts/prepare-release-v090.mjs',import.meta.url),new URL('../../../scripts/check-bilingual-documentation.mjs',import.meta.url)]);let problem=null;
const packageRoot=join(c.config.runtimeRoot,'node_modules/@evopilot-next/ontology');
const checked=new Set();
async function run(id,body){await c.case(id,body);checked.add(id);}
try{
 await run('RELEASE-01',async()=>{
  const s=c.support('source-ci-artifact');assert.equal(s.schema,'ontology-private-source-ci-artifact/v1');assert.equal(s.input.commit,c.config.sourceCommit);assert.equal('sha256:'+s.input.digest,c.admission.bindings.candidateDigest);
  const run=c.evidenceJSON(s.run),metadata=c.evidenceJSON(s.metadata);validateSourceCandidate(run,s.input,c.config.sourceCommit);const artifact=validateSourceArtifact(metadata,s.input),zip=c.evidenceReference(s.zip);assert.equal(hashBytes(zip),artifact.digest);assert.equal(zip.length,artifact.size_in_bytes);
  const zipPath=join(c.root,'source-artifact.zip');const {writeFileSync}=await import('node:fs');writeFileSync(zipPath,zip,{mode:0o600,flag:'wx'});
  const unzip=args=>{const p=spawnSync('unzip',args,{maxBuffer:32*1024*1024,timeout:30000});assert.ifError(p.error);assert.equal(p.status,0);return p.stdout;};
  const names=unzip(['-Z1',zipPath]).toString().trimEnd().split('\n');assert.equal(names.length,new Set(names).size);assert.deepEqual(names.sort(),[...candidateFiles].sort());
  const files=new Map(candidateFiles.map(name=>[name,unzip(['-p',zipPath,name])]));validateCandidateFiles(files,s.input);
  const jobs=c.evidenceJSON(s.jobs);assert.equal(jobs.total_count,jobs.jobs.length);const build=jobs.jobs.filter(j=>j.name==='source');assert.equal(build.length,1);assert.equal(build[0].conclusion,'success');assert.equal(build[0].head_sha,c.config.sourceCommit);
  return {expected:'The exact approved candidate is byte-identical to the original successful own-repository source CI archive, with complete run, job and artifact identities',sourceRunId:run.id,artifactId:artifact.id};
 });
 await run('RELEASE-02',async()=>{
  const structural=await checkBilingualDocumentation(packageRoot),review=c.support('bilingual-behavior-review');assert.equal(review.schema,'ontology-private-bilingual-behavior-review/v1');assert.equal(review.candidateDigest,c.admission.bindings.candidateDigest);assert.deepEqual(review.unresolved,[]);assert(review.pairs.length>=2);
  for(const pair of review.pairs){for(const language of ['en','zh']){const p=pair[language];assert.equal(hashBytes(readFileSync(join(packageRoot,p.path))),p.digest);}assert(pair.meaning.length>0);assert(pair.hostSessionIds.length>0);for(const id of pair.hostSessionIds){const s=c.session(id);assert(s.calls.length);}}
  return {expected:'Both installed language routes retain aligned commands and technical tokens, with explicit meaning review tied to observed actual Host behavior',structural,pairs:review.pairs.length};
 });
 await run('RELEASE-03',async()=>{
  const evidence=c.support('native-license-source-closure');assert.equal(evidence.schema,'ontology-private-native-license-source-closure/v1');assert.equal(evidence.candidateDigest,c.admission.bindings.candidateDigest);assert.deepEqual(evidence.unresolved,[]);
  const manifest=c.evidenceJSON(evidence.catalog);assert.equal(hashBytes(readFileSync(join(packageRoot,evidence.catalogPath))),evidence.catalog.digest);assert.equal(manifest.compatibility.workerSourceDigest,hashBytes(readFileSync(join(packageRoot,'toolchains/owl2-dl/Worker.java'))));
  assert.equal(manifest.compatibility.dependencyLockDigest,hashBytes(readFileSync(join(packageRoot,'toolchains/owl2-dl/dependencies.json'))));assert.equal(evidence.artifacts.length,manifest.artifacts.length);
  for(const a of manifest.artifacts){const found=evidence.artifacts.filter(x=>x.id===a.id);assert.equal(found.length,1);const actual=c.artifact(found[0].file);assert.equal(actual.digest,a.digest);assert.equal(actual.bytes,a.bytes);}
  const source=c.evidenceJSON(evidence.sourceInventory),rebuild=c.evidenceJSON(evidence.rebuild);assert.equal(rebuild.byteIdentical,true);assert.equal(rebuild.sourcePatchesReplayed,true);assert.equal(rebuild.dependencyCount,source.coverage.lockedBinaries);assert.equal(source.coverage.topLevelSourceArchives+source.coverage.emptyBinaryWithoutSources,source.coverage.lockedBinaries);assert.equal(rebuild.workerSHA256,source.workerJarSHA256);
  const lock=JSON.parse(readFileSync(join(packageRoot,'toolchains/owl2-dl/dependencies.json')));assert.equal(source.components.length,lock.files.length);for(const f of lock.files){const x=source.components.find(x=>x.binaryFile===f.file);assert(x);assert.equal(x.binarySHA256,f.sha256);assert(x.source||x.exception);assert(x.pomMember);assert(x.declaredPomLicenses.length);}
  return {expected:'Every distributed native artifact is hash-bound, locked binary/source/notice coverage is explicit, and an offline replay of the supplied source companion reproduces the worker bytes',artifacts:manifest.artifacts.length,sourceCoverage:source.coverage};
 });
 await run('RELEASE-04',async()=>{const s=c.session('RELEASE-04'),context=s.one('ontology_context').value;assert.equal(context.toolchainDigest,c.config.dl.digest);assert.equal(context.shaclToolchainDigest,c.config.shacl.digest);s.task('reasoning','ENTAILED');s.task('validation','MATCHED');const binding=c.operator('RELEASE-04').one('toolchains-inspect',b=>b.ok).body.result;assert.equal(binding.status,'VERIFIED');assert.equal(binding.binding.runtimeDigest,c.config.runtimeDigest);return {expected:'The final installed Java/Python binding is verified and exercised by actual Host reasoning and SHACL validation'};});
 await run('RELEASE-06',async()=>{const s=c.session('RELEASE-06');assert(s.record.selected);s.one('intent.record');s.one('source.admit');s.one('model.record');const task=s.task('reasoning','ENTAILED');assert.deepEqual(await c.readback(s,'reasoning.inspect',{taskId:task.value.taskId}),task.value);return {expected:'Actual Codex runs the independent final packaged Expert and owner service, with a separately read back reasoning receipt on the exact accepted candidate'};});
 await run('RELEASE-05',async()=>{
  assert.deepEqual([...checked].sort(),['RELEASE-01','RELEASE-02','RELEASE-03','RELEASE-04','RELEASE-06']);
  const evidence=c.support('pre-release-group-results');assert.equal(evidence.schema,'ontology-private-group-results/v1');const matrix=JSON.parse(readFileSync(join(c.repository,'governance/acceptance-v090.json'))),required=matrix.cases.filter(x=>!['RELEASE','FINAL'].includes(x.group)),seen=new Set();
  for(const ref of evidence.groups){const result=c.evidenceJSON(ref);assert.equal(result.schema,'ontology-product-group-result/v1');assert.equal(result.status,'PASS');assert.equal(result.problem,null);assert.equal(result.cleanup,null);assert.equal(result.candidateDigest,c.admission.bindings.candidateDigest);const local=ref2=>c.evidenceJSON({path:join(dirname(ref.path),ref2.path),digest:ref2.digest});const binding=local(result.binding);assert.equal(binding.admission.decisionDigest,c.admission.decisionDigest);for(const item of result.cases){assert(required.some(x=>x.id===item.id&&x.group===result.group));assert(!seen.has(item.id));seen.add(item.id);assert.equal(item.status,'PASS');const observation=local(item.observation),comparison=local(item.comparison);assert.equal(observation.id,item.id);assert.equal(observation.candidateDigest,c.admission.bindings.candidateDigest);assert.equal(observation.admissionDecisionDigest,c.admission.decisionDigest);assert.equal(comparison.id,item.id);assert.equal(comparison.status,'PASS');}}
  assert.equal(required.length,130);assert.deepEqual([...seen].sort(),required.map(x=>x.id).sort());return {expected:'All 130 other original pre-release cases and the five independent release checks have complete passing evidence for this candidate and actual standards decision; this closure check is the 136th pre-release case',preReleaseCaseCount:136,releaseAuthorized:false};
 });
}catch(e){problem=e.message;}finally{await c.finish(problem);}
