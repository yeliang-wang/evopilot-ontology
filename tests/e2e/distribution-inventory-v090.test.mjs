import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,lstatSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {inspectPayloadArchiveInventories} from '../../dist/installation/distribution-inventory.js';
import {main} from '../../dist/standalone/cli.js';

const digest=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
function tar(name,data){
  const header=Buffer.alloc(512);header.write(name);header.write('0000600\0',100);header.write('0000000\0',108);header.write('0000000\0',116);
  header.write(Buffer.byteLength(data).toString(8).padStart(11,'0')+'\0',124);header.write('00000000000\0',136);header.fill(32,148,156);header.write('0',156);header.write('ustar\0',257);header.write('00',263);
  header.write([...header].reduce((n,b)=>n+b,0).toString(8).padStart(6,'0')+'\0 ',148);
  return Buffer.concat([header,Buffer.from(data),Buffer.alloc((512-Buffer.byteLength(data)%512)%512),Buffer.alloc(1024)]);
}
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'ontology-distribution-inventory-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const items=[['dl-payload','dl', 'dl/worker.class','tar.gz'],['java-runtime','java','jdk-21.0.13+9-jre/bin/java','tar.gz'],['python-runtime','python','python/bin/python3.12','tar.gz'],['python-wheels','python','fixture.whl','tar']];
  const artifacts=items.map(([id,role,path,format])=>{
    const archive=tar(path,'bounded synthetic payload for '+role),raw=format==='tar.gz'?gzipSync(archive):archive,filename=id+'.'+format;
    writeFileSync(join(root,filename),raw,{mode:0o600});
    return {id,filename,bytes:raw.length,digest:digest(raw),format,origin:{kind:'PRODUCT',reference:'urn:evopilot:synthetic-fixture',revision:'test'}};
  });
  const raw=Buffer.from('synthetic adapter');writeFileSync(join(root,'shacl.py'),raw,{mode:0o600});
  artifacts.push({id:'shacl-worker',filename:'shacl.py',bytes:raw.length,digest:digest(raw),format:'file',origin:{kind:'PRODUCT',reference:'urn:evopilot:synthetic-fixture',revision:'test'}});
  const roles=['dl','java','python','shacl'];
  const manifest={schema:'ontology-tool-distribution/v1',id:'linux-arm64-temurin21-pbs20260211-candidate1',platform:{os:'linux',arch:'arm64',libc:'glibc',minimumLibc:'2.28'},compatibility:{nodeVersion:'24.14.0',workerSourceDigest:digest('worker'),dependencyLockDigest:digest('lock'),shaclAdapterDigest:digest('adapter')},artifacts,components:roles.map(role=>{
    const ids=role==='shacl'?['shacl-worker']:items.filter(x=>x[1]===role).map(x=>x[0]);
    return {role,version:'synthetic',artifactIds:ids,provenanceArtifactIds:ids,noticeArtifactIds:ids,declaredExpandedBytes:1024,declaredEntries:64,preparation:role==='python'?'FINAL_PATH_VENV':role==='shacl'?'COPY':'EXTRACT'};
  }),limitations:['Synthetic bytes establish composition only; no executables.']};
  return {root,manifest};
}
const snapshot=root=>readdirSync(root).sort().map(name=>{const s=lstatSync(join(root,name));return {name,digest:digest(readFileSync(join(root,name))),mode:s.mode,inode:s.ino,size:s.size};});

test('fixed payload recipes inventory all four real tar streams without creating destinations or executing payloads',async t=>{
  const {root,manifest}=fixture(t),before=snapshot(root);
  const inventories=await inspectPayloadArchiveInventories(root,manifest);
  assert.deepEqual(inventories.map(x=>x.artifactId),['dl-payload','java-runtime','python-runtime','python-wheels']);
  assert.deepEqual(inventories.map(x=>x.inventory.entries.filter(e=>e.kind==='file').map(e=>e.path)),[['worker.class'],['bin/java'],['bin/python3.12'],['fixture.whl']]);
  for(const row of inventories){
    assert.equal(row.inventory.artifactDigest,manifest.artifacts.find(x=>x.id===row.artifactId).digest);
    assert.equal(row.inventory.fileCount,1);
  }
  assert.deepEqual(await inspectPayloadArchiveInventories(root,manifest),inventories);
  assert.deepEqual(snapshot(root),before);
});

test('unselected recipes and altered role or format mappings fail without mutating input materials',async t=>{
  const {root,manifest}=fixture(t),before=snapshot(root);
  const variants=[m=>m.id='unknown-candidate',m=>m.artifacts[0].format='tar',m=>m.components[0].artifactIds=['java-runtime']];
  for(const mutate of variants){const m=structuredClone(manifest);mutate(m);await assert.rejects(inspectPayloadArchiveInventories(root,m),e=>['NO_DISTRIBUTION_RECIPE','DISTRIBUTION_RECIPE_MISMATCH'].includes(e.code));}
  assert.deepEqual(snapshot(root),before);
});

test('an exact raw payload mismatch is refused even when its tar structure is valid',async t=>{
  const {root,manifest}=fixture(t);manifest.artifacts[0].digest=digest('different raw bytes');const before=snapshot(root);
  await assert.rejects(inspectPayloadArchiveInventories(root,manifest));assert.deepEqual(snapshot(root),before);
});

test('Python runtime and wheel payloads share the declared component expansion budget',async t=>{
  const {root,manifest}=fixture(t);manifest.components.find(c=>c.role==='python').declaredExpandedBytes=50;
  const before=snapshot(root);
  await assert.rejects(inspectPayloadArchiveInventories(root,manifest),e=>e.code==='DISTRIBUTION_ARCHIVE_LIMIT');
  assert.deepEqual(snapshot(root),before);
});

test('both public distribution commands reject recipe, manifest and budget overrides at the CLI boundary',async()=>{
  for(const command of ['distribution-inspect','distribution-inventory'])for(const flag of ['--manifest','--strip-prefix','--max-bytes']){
    await assert.rejects(main([command,'--input','/not-read.json',flag,'value','--json'],()=>assert.fail('No report expected')),e=>e.code==='INVALID_ARGUMENTS');
  }
});
