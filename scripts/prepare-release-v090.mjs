// Original source CI acquisition only. No release, tag or publication mutation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,openSync,closeSync,statSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {validateCandidatePack} from './pack-candidate-v090.mjs';
const repository='yeliang-wang/evopilot-ontology',repositoryId=1416266852,archive='evopilot-next-ontology-0.9.0.tgz';
export const candidateFiles=Object.freeze([archive,'pack.json','source-revision.txt','SHA256SUMS','candidate.json']);
const sha=b=>createHash('sha256').update(b).digest('hex');
export function validateSourceCandidate(run,input,head){
  assert.equal(input.repository,repository);assert.match(input.commit,/^[a-f0-9]{40}$/);assert.match(input.runId,/^[1-9][0-9]*$/);assert(Number.isSafeInteger(Number(input.runId)));assert.equal(String(Number(input.runId)),input.runId);assert.match(input.digest,/^[a-f0-9]{64}$/);
  assert.equal(head,input.commit);assert.equal(run.id,Number(input.runId));assert.equal(run.repository?.id,repositoryId);assert.equal(run.repository?.full_name,repository);assert.equal(run.head_sha,input.commit);
  assert.equal(run.path,'.github/workflows/ci.yml');assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');assert(['push','workflow_dispatch','pull_request'].includes(run.event));
  if(run.event==='pull_request')assert.equal(run.head_repository?.id,repositoryId,'Foreign PR is not a release source');
  return {technicalValidation:true,releaseAuthorized:false};
}
export function validateSourceArtifact(metadata,input){
  assert.equal(metadata.total_count,metadata.artifacts.length,'Artifact list is incomplete');
  const matches=metadata.artifacts.filter(a=>a.name==='evopilot-ontology-'+input.commit+'-package');assert.equal(matches.length,1);
  const a=matches[0];assert(Number.isSafeInteger(a.id)&&a.id>0);assert.equal(a.expired,false);assert.match(a.digest,/^sha256:[a-f0-9]{64}$/);assert(Number.isSafeInteger(a.size_in_bytes)&&a.size_in_bytes>0&&a.size_in_bytes<=32*1024*1024);
  assert.equal(a.workflow_run?.id,Number(input.runId));assert.equal(a.workflow_run?.head_sha,input.commit);assert.equal(a.workflow_run?.repository_id,repositoryId);assert.equal(a.workflow_run?.head_repository_id,repositoryId);return a;
}
export function validateCandidateFiles(files,input){
  assert.deepEqual([...files.keys()].sort(),[...candidateFiles].sort(),'Unexpected or absent distribution material');
  assert.equal(sha(files.get(archive)),input.digest);assert.equal(files.get('source-revision.txt').toString(),input.commit+'\n');assert.equal(files.get('SHA256SUMS').toString(),input.digest+'  '+archive+'\n');
  assert.equal(validateCandidatePack(JSON.parse(files.get('pack.json'))),archive);
  const c=JSON.parse(files.get('candidate.json'));assert.equal(c.schema,'ontology-source-candidate/v1');assert.equal(c.sourceCommit,input.commit);assert.equal(c.package.filename,archive);assert.equal(c.package.bytes,files.get(archive).length);assert.equal(c.package.digest,'sha256:'+input.digest);assert.equal(c.acceptance,'NOT_EVALUATED');assert.equal(c.releaseAuthorized,false);
  return {sourceCommit:input.commit,candidateDigest:'sha256:'+input.digest,acceptance:'NOT_EVALUATED',releaseAuthorized:false};
}
export function prepareSourceArtifact(input,output){
  assert(isAbsolute(output));assert([undefined,'false'].includes(process.env.PUBLISH),'This preparer cannot publish');
  const root=resolve(output);mkdirSync(root,{mode:0o700});const evidence=join(root,'evidence'),assets=join(root,'assets');mkdirSync(evidence);mkdirSync(assets);
  const save=(name,value)=>writeFileSync(join(evidence,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  const command=(name,args,options={})=>{const p=spawnSync(name,args,{encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024,...options});assert.ifError(p.error);assert.equal(p.status,0,'Inspect retained evidence before retry: '+p.stderr);return p.stdout;};
  const api=endpoint=>JSON.parse(command('gh',['api',endpoint]));
  const run=api('repos/'+repository+'/actions/runs/'+input.runId);save('source-run.json',run);validateSourceCandidate(run,input,command('git',['rev-parse','HEAD']).trim());
  const metadata=api('repos/'+repository+'/actions/runs/'+input.runId+'/artifacts?per_page=100');save('artifact-metadata.json',metadata);const artifact=validateSourceArtifact(metadata,input),zip=join(evidence,'source.zip'),fd=openSync(zip,'wx');
  try{command('gh',['api','repos/'+repository+'/actions/artifacts/'+artifact.id+'/zip'],{stdio:['ignore',fd,'pipe']});}finally{closeSync(fd);}
  assert.equal(statSync(zip).size,artifact.size_in_bytes);assert.equal('sha256:'+sha(readFileSync(zip)),artifact.digest);
  const names=command('unzip',['-Z1',zip]).trimEnd().split('\n');assert.equal(new Set(names).size,names.length);assert.deepEqual(names.sort(),[...candidateFiles].sort());
  // Read exact allowlisted members; archive paths never write to disk.
  const files=new Map(candidateFiles.map(name=>[name,command('unzip',['-p',zip,name],{encoding:null,maxBuffer:8*1024*1024})]));
  const validated=validateCandidateFiles(files,input);for(const [name,bytes] of files)writeFileSync(join(assets,name),bytes,{flag:'wx'});
  const result={schema:'ontology-release-source-preparation/v1',...validated,sourceRunId:run.id,sourceArtifactId:artifact.id,sourceArtifactDigest:artifact.digest,preparedAt:new Date().toISOString(),requiredNextSteps:['Approved exact standards report','Original complete pre-release product acceptance','Complete native distribution and license/source closure','Separate actual user release decision','Published download and installation readback'],publicationAttempted:false};
  writeFileSync(join(assets,'preparation.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  assert.equal(process.argv.length,3,'Usage: node scripts/prepare-release-v090.mjs ABS_NEW_OUTPUT');
  console.log(JSON.stringify(prepareSourceArtifact({repository:process.env.GITHUB_REPOSITORY,commit:process.env.EXPECTED_COMMIT,runId:process.env.SOURCE_RUN_ID,digest:process.env.EXPECTED_DIGEST},process.argv[2])));
}
