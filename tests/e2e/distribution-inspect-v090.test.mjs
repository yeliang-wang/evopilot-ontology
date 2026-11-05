import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,readdirSync,lstatSync,readlinkSync,rmSync,symlinkSync,linkSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {hashBytes} from '../../dist/standalone/validation.js';
import {inspectRuntime} from '../../dist/installation/runtime.js';
import {validateDistributionManifest,validateDistributionInput,DISTRIBUTION_LIMITS} from '../../dist/installation/distribution-contract.js';
import {selectedDistribution} from '../../dist/installation/distribution-catalog.js';
import {inspectDistributionFiles} from '../../dist/installation/distribution-inspect.js';

const source=fileURLToPath(new URL('../..',import.meta.url));
function put(path,bytes){mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,bytes,{mode:0o600});}
function snapshot(root){const rows=[];const visit=(p,name)=>{const s=lstatSync(p);rows.push({name,mode:s.mode,ino:s.ino,bytes:s.isFile()?hashBytes(readFileSync(p)):s.isSymbolicLink()?readlinkSync(p):null});if(s.isDirectory())for(const n of readdirSync(p).sort())visit(join(p,n),name+'/'+n);};visit(root,'');return rows;}
function fixture(t){
  const base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-distribution-')));t.after(()=>rmSync(base,{recursive:true,force:true}));
  const runtimeRoot=join(base,'runtime'),packageRoot=join(runtimeRoot,'node_modules/@evopilot-next/ontology'),bundle=join(base,'bundle');mkdirSync(bundle,{mode:0o700});
  put(join(packageRoot,'package.json'),JSON.stringify({name:'@evopilot-next/ontology',version:'0.8.3'}));
  for(const p of ['dist/installation/daemon.js','dist/standalone/bridge.js','dist/standalone/cli.js','plugins/codex/skills/evopilot-ontology-expert/SKILL.md'])put(join(packageRoot,p),'Synthetic non-executable fixture.');
  const contents={'toolchains/owl2-dl/Worker.java':'synthetic worker','toolchains/owl2-dl/dependencies.json':'{}','src/native-v2/shacl-worker.py':'synthetic adapter'};
  for(const [p,bytes] of Object.entries(contents))put(join(packageRoot,p),bytes);
  const roles=['dl','java','python','shacl'];
  const artifacts=roles.map(role=>{const bytes='synthetic '+role;put(join(bundle,role+'.bin'),bytes);return {id:role,filename:role+'.bin',bytes:Buffer.byteLength(bytes),digest:hashBytes(bytes),format:'file',origin:{kind:'PRODUCT',reference:'urn:evopilot:synthetic-test',revision:'fixture'}};});
  const manifest={schema:'ontology-tool-distribution/v1',id:'fixture',platform:{os:'linux',arch:process.arch==='arm64'?'arm64':'x64',libc:'glibc',minimumLibc:'2.28'},compatibility:{nodeVersion:'24.14.0',workerSourceDigest:hashBytes(contents['toolchains/owl2-dl/Worker.java']),dependencyLockDigest:hashBytes('{}'),shaclAdapterDigest:hashBytes(contents['src/native-v2/shacl-worker.py'])},artifacts,components:roles.map(role=>({role,version:'synthetic',artifactIds:[role],provenanceArtifactIds:[role],noticeArtifactIds:[role],declaredExpandedBytes:64,declaredEntries:4,preparation:role==='python'?'FINAL_PATH_VENV':role==='shacl'?'COPY':'EXTRACT'})),limitations:['Synthetic inspection fixture; no executable or legal evidence.']};
  const runtime=inspectRuntime(runtimeRoot),input={schema:'ontology-distribution-inspect-input/v1',bundleId:'fixture',bundleRoot:bundle,runtimeRoot,runtimeDigest:runtime.digest,toolRoot:join(base,'tools'),installationRoot:join(base,'installation'),workspaceRoot:join(base,'workspace')};
  const inspect=(i=input,m=manifest)=>inspectDistributionFiles(i,m,hashBytes(JSON.stringify(m)),runtime);
  return {base,bundle,packageRoot,manifest,runtime,input,inspect};
}

test('distribution inspection binds actual bytes and leaves all selected trees untouched',t=>{
  const f=fixture(t),before=snapshot(f.base),{report}=f.inspect();
  assert.equal(report.artifactBytesVerified,true);assert.equal(report.artifacts.length,4);assert.deepEqual(snapshot(f.base),before);
  assert.equal(report.platform.matches,process.platform==='linux'&&process.arch===f.manifest.platform.arch);
  assert.equal(report.status,report.platform.matches?'PLAN_VERIFIED':'BLOCKED');
  for(const field of ['expandedInventoryObserved','relocationVerified','loadabilityVerified','resourceBackendVerified','filesWritten','toolsBound','executorsExecuted','serviceStarted','hostConnected','authority'])assert.equal(report[field],false);
  assert.equal(report.legalReview,'NOT_EVALUATED');assert.equal(report.productAcceptance,'NOT_EVALUATED');
  assert.ok(BigInt(report.storage.estimatedAdditionalBytes)>BigInt(report.storage.declaredExpandedBytes));
  assert.deepEqual(report.proposedRoots.map(r=>r.role),['dl','java','python','shacl']);
});

test('distribution schema refuses incomplete closure, unsafe source references and excess budgets',t=>{
  const f=fixture(t);validateDistributionManifest(f.manifest);validateDistributionInput(f.input);
  const changes=[
    m=>m.components.pop(),m=>m.components[0].artifactIds.push('missing'),m=>m.components[1].role='dl',
    m=>m.artifacts[1].filename=m.artifacts[0].filename.toUpperCase(),m=>m.artifacts[0].filename='../outside',
    m=>m.artifacts[0].bytes=DISTRIBUTION_LIMITS.artifactBytes+1,m=>m.components[0].declaredExpandedBytes=Number.MAX_SAFE_INTEGER,
    m=>m.artifacts[0].origin={kind:'UPSTREAM',reference:'https://user:secret@example.test/a',revision:'x'},
    m=>m.artifacts[0].origin.reference='../../source',m=>m.components[2].preparation='COPY',
    m=>m.components[0].provenanceArtifactIds=[],m=>m.hooks=['arbitrary execution'],
  ];
  for(const change of changes){const m=structuredClone(f.manifest);change(m);assert.throws(()=>validateDistributionManifest(m));}
  assert.throws(()=>validateDistributionInput({...f.input,toolRoot:f.base+'/x/../tools'}),{code:'UNSAFE_PATH'});
  assert.throws(()=>validateDistributionInput({...f.input,catalogDigest:hashBytes('override')}),{code:'INVALID_INPUT'});
});

test('bundle inspection rejects changed, missing, extra and aliased artifacts without following them',t=>{
  const f=fixture(t),file=join(f.bundle,'dl.bin'),original=readFileSync(file),outside=join(f.base,'outside');put(outside,original);
  writeFileSync(file,'X'.repeat(original.length));assert.throws(()=>f.inspect(),{code:'DISTRIBUTION_ARTIFACT_CHANGED'});writeFileSync(file,original);
  put(join(f.bundle,'extra'),'?');assert.throws(()=>f.inspect(),{code:'DISTRIBUTION_CONTENT_MISMATCH'});rmSync(join(f.bundle,'extra'));
  rmSync(file);assert.throws(()=>f.inspect(),{code:'DISTRIBUTION_CONTENT_MISMATCH'});
  symlinkSync(outside,file);assert.throws(()=>f.inspect(),{code:'DISTRIBUTION_UNSAFE_ARTIFACT'});rmSync(file);
  linkSync(outside,file);assert.throws(()=>f.inspect(),{code:'DISTRIBUTION_UNSAFE_ARTIFACT'});rmSync(file);
  execFileSync('mkfifo',[file]);assert.throws(()=>f.inspect(),{code:'DISTRIBUTION_UNSAFE_ARTIFACT'});rmSync(file);
  put(file,original);chmodSync(file,0o666);assert.throws(()=>f.inspect(),{code:'DISTRIBUTION_UNSAFE_ARTIFACT'});chmodSync(file,0o600);
  assert.deepEqual(readFileSync(outside),original);assert.equal(f.inspect().report.artifactBytesVerified,true);
});

test('occupied, overlapping and incompatible destinations cannot produce a ready preparation plan',t=>{
  const f=fixture(t);mkdirSync(f.input.toolRoot,{mode:0o700});
  const occupied=f.inspect().report;assert.equal(occupied.status,'BLOCKED');assert.ok(occupied.blockers.includes('TOOL_DESTINATION_EXISTS'));
  assert.throws(()=>f.inspect({...f.input,toolRoot:join(f.bundle,'nested')}),{code:'UNSAFE_PATH'});
  for(const parent of [f.bundle,f.input.runtimeRoot,f.input.workspaceRoot,f.input.installationRoot])assert.throws(()=>f.inspect({...f.input,toolRoot:join(parent,'..tools')}),{code:'UNSAFE_PATH'});
  const m=structuredClone(f.manifest);m.compatibility.workerSourceDigest=hashBytes('other');
  assert.ok(f.inspect(f.input,m).report.blockers.includes('PACKAGE_TOOLCHAIN_MISMATCH'));
  const alias=join(f.base,'alias');symlinkSync(f.base,alias);assert.throws(()=>f.inspect({...f.input,toolRoot:join(alias,'tools-new')}),{code:'UNSAFE_PATH'});
});

test('compiled catalog pins exact raw manifest bytes and cannot be replaced by a local declaration',t=>{
  const f=fixture(t),id='linux-arm64-temurin21-pbs20260211-candidate1',selected=selectedDistribution(source,id);
  assert.equal(selected.manifest.artifacts.length,11);assert.equal(selected.manifestDigest,hashBytes(readFileSync(join(source,selected.catalogEntry))));
  assert.throws(()=>selectedDistribution(source,'caller-supplied'),{code:'NO_DISTRIBUTION_CANDIDATE'});
  const fake=join(f.base,'fake-package'),target=join(fake,selected.catalogEntry);put(target,readFileSync(join(source,selected.catalogEntry)));
  assert.equal(selectedDistribution(fake,id).manifestDigest,selected.manifestDigest);
  writeFileSync(target,readFileSync(target,'utf8')+' ');assert.throws(()=>selectedDistribution(fake,id),{code:'DISTRIBUTION_CATALOG_CHANGED'});
});

test('current catalog binds corrected RDF and SHACL source closure while retaining historical candidate identities',()=>{
  const old=selectedDistribution(source,'linux-arm64-temurin21-pbs20260211-candidate1');
  const previous=selectedDistribution(source,'linux-arm64-temurin21-pbs20260211-candidate2');
  assert.equal(previous.manifestDigest,'sha256:907114f83a3d1db711e4cc66d8ad7387150d01f9d025297a9feceae008e069e6');
  const retained=selectedDistribution(source,'linux-arm64-temurin21-pbs20260211-candidate3');
  assert.equal(retained.manifestDigest,'sha256:a233094a462f4e290349ff79bdee97d1e34fe9f0ac1374dc868a8f90e3e19f19');
  const fourth=selectedDistribution(source,'linux-arm64-temurin21-pbs20260211-candidate4');
  assert.equal(fourth.manifestDigest,'sha256:88ec62e5335c1e384475a3f498c07215572b4c048c45a23189f448683c80a175');
  const fifth=selectedDistribution(source,'linux-arm64-temurin21-pbs20260211-candidate5');
  assert.equal(fifth.manifestDigest,'sha256:b8a0bf1a71d4565409e9dc1139d6478ef0d7ae6d23787336bc2cad36b218f633');
  const current=selectedDistribution(source,'linux-arm64-temurin21-pbs20260211-candidate6');
  assert.equal(current.manifest.components.find(c=>c.role==='dl').declaredExpandedBytes,36858975);
  const m=current.manifest;
  assert.equal(old.manifestDigest,'sha256:3bfb22e341764e0995b9c3cbf3f788aee6377e9b74664c332b9008efa83afe78');
  assert.equal(current.manifestDigest,hashBytes(readFileSync(join(source,current.catalogEntry))));
  assert.equal(m.compatibility.workerSourceDigest,hashBytes(readFileSync(join(source,'toolchains/owl2-dl/Worker.java'))));
  assert.equal(m.compatibility.dependencyLockDigest,hashBytes(readFileSync(join(source,'toolchains/owl2-dl/dependencies.json'))));
  assert.equal(m.compatibility.shaclAdapterDigest,hashBytes(readFileSync(join(source,'src/native-v2/shacl-worker.py'))));
  assert.equal(m.artifacts.length,13);
  const dl=m.components.find(c=>c.role==='dl');
  assert.deepEqual(dl.provenanceArtifactIds,['dl-payload','dl-sources']);assert.deepEqual(dl.noticeArtifactIds,['dl-payload','dl-notices']);
  assert.equal(dl.declaredEntries,256);
  for(const artifact of old.manifest.artifacts.filter(a=>a.id!=='dl-payload'&&a.id!=='shacl-worker'))assert.deepEqual(m.artifacts.find(a=>a.id===artifact.id),artifact);
  for(const id of ['dl-sources','dl-notices'])assert.equal(m.artifacts.find(a=>a.id===id).format,'tar.gz');
});
