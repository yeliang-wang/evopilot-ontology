import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSourceCandidate,validateSourceArtifact,validateCandidateFiles,candidateFiles} from '../../scripts/prepare-release-v090.mjs';
import {createHash} from 'node:crypto';
const commit='a'.repeat(40),input={repository:'yeliang-wang/evopilot-ontology',commit,runId:'123',digest:'b'.repeat(64)};
const run={id:123,repository:{id:1416266852,full_name:input.repository},head_sha:commit,path:'.github/workflows/ci.yml',status:'completed',conclusion:'success',event:'push'};
test('source acquisition refuses foreign, failed, stale and release-workflow evidence',()=>{
  assert.equal(validateSourceCandidate(run,input,commit).releaseAuthorized,false);
  for(const change of [{head_sha:'c'.repeat(40)},{conclusion:'failure'},{path:'.github/workflows/release.yml'},{repository:{id:1,full_name:input.repository}},{event:'pull_request',head_repository:{id:1}}])assert.throws(()=>validateSourceCandidate({...run,...change},input,commit));
  assert.throws(()=>validateSourceCandidate(run,input,'c'.repeat(40)));
});
test('artifact identity is exact, unexpired and unambiguous',()=>{
  const a={id:4,name:'evopilot-ontology-'+commit+'-package',expired:false,digest:'sha256:'+'c'.repeat(64),size_in_bytes:1234,workflow_run:{id:123,head_sha:commit,repository_id:1416266852,head_repository_id:1416266852}};
  assert.equal(validateSourceArtifact({total_count:1,artifacts:[a]},input).id,4);
  for(const change of [{expired:true},{digest:'unknown'},{size_in_bytes:2**40},{workflow_run:{...a.workflow_run,head_sha:'d'.repeat(40)}}])assert.throws(()=>validateSourceArtifact({total_count:1,artifacts:[{...a,...change}]},input));
  assert.throws(()=>validateSourceArtifact({total_count:2,artifacts:[a,a]},input));
});
test('downloaded contents bind original package bytes, source revision and no invented acceptance',()=>{
  const bytes=Buffer.from('Synthetic package fixture, never a distribution'),digest=createHash('sha256').update(bytes).digest('hex'),i={...input,digest};
  const filename=candidateFiles[0],paths=['package.json','dist/standalone/cli.js','dist/standalone/mcp.js','plugins/codex/.codex-plugin/plugin.json','src/expert/SKILL.md','toolchains/owl2-dl/dependencies.json','src/native-v2/shacl-worker.py','LICENSE','NOTICE'];
  const records=[{name:'@evopilot-next/ontology',version:'0.9.0',filename,files:paths.map(path=>({path}))}],candidate={schema:'ontology-source-candidate/v1',sourceCommit:commit,package:{filename,bytes:bytes.length,digest:'sha256:'+digest},acceptance:'NOT_EVALUATED',releaseAuthorized:false};
  const files=new Map([[filename,bytes],['pack.json',Buffer.from(JSON.stringify(records))],['candidate.json',Buffer.from(JSON.stringify(candidate))],['source-revision.txt',Buffer.from(commit+'\n')],['SHA256SUMS',Buffer.from(digest+'  '+filename+'\n')]]);
  assert.equal(validateCandidateFiles(files,i).releaseAuthorized,false);
  for(const edited of [new Map(files).set(filename,Buffer.from('different')),new Map(files).set('private.json',Buffer.from('extra')),new Map(files).set('candidate.json',Buffer.from(JSON.stringify({...candidate,acceptance:'PASS',releaseAuthorized:true})))])assert.throws(()=>validateCandidateFiles(edited,i));
});
