import {syntheticAuthoring} from '../fixtures/native/authoring.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,cpSync,readFileSync,lstatSync,readdirSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createOntologyService} from '../../dist/service.js';
import {inspectWorkspaceSnapshot,relocateWorkspaceSnapshot} from '../../dist/workspace-migration.js';
import {keyDirectory} from '../../dist/location-lineage.js';
import {createOntologyService as historical} from '../fixtures/historical-v020/dist/service.js';
import {nativePackage} from '../fixtures/native/package.mjs';
const scope={visibility:'private',projectId:'synthetic'},tools=()=>JSON.parse(readFileSync(process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN,'utf8'));
const revision=s=>s.execute({operation:'workspace.inspect',scope,input:{}}).revision;
const write=(s,operation,input,requestId)=>s.native({operation,scope,input,requestId,expectedRevision:revision(s)});
function privateCopy(source,dest){cpSync(source,dest,{recursive:true,preserveTimestamps:true});function walk(p){const stat=lstatSync(p);chmodSync(p,stat.isDirectory()?0o700:0o600);if(stat.isDirectory())for(const n of readdirSync(p))walk(join(p,n));}walk(dest);}
test('M02/M03: pinned historical reader writes synthetic state; current reader preserves it; old reader rejects native schema',async()=>{
 const manifest=JSON.parse(readFileSync(new URL('../fixtures/historical-v020/source.json',import.meta.url)));
 assert.equal(manifest.head,'1f493544be931898bf514cfaf52a3cb52838a8e1');
 for(const f of manifest.files)assert.equal(createHash('sha256').update(readFileSync(new URL('../fixtures/historical-v020/'+f.output,import.meta.url))).digest('hex'),f.outputSha256);
 const root=realpathSync(mkdtempSync(join(tmpdir(),'ontology-historical-'))),options={workspaceRoot:join(root,'state'),workspaceId:'history'};
 let old=historical(options),current;try{
  old.initialize();const asset=JSON.parse(readFileSync(new URL('../../examples/synthetic-models.json',import.meta.url))).assets[0],oldScope={visibility:asset.visibility,projectId:'old'};
  old.execute({operation:'asset.put',scope:oldScope,input:{model:asset},requestId:'old-put',expectedRevision:0});old.close();
  let db=new DatabaseSync(join(options.workspaceRoot,'state/ontology/ontology.db'));const saved=db.prepare('SELECT data FROM state').get().data,receipt=db.prepare('SELECT receipt FROM receipts').get().receipt;db.close();
  current=createOntologyService(options,{resolveNativeAuthoring:syntheticAuthoring,nativeToolchain:tools()});current.initialize();assert.deepEqual(current.execute({operation:'asset.inspect',scope:oldScope,input:{id:asset.id,version:asset.version}}).model,asset);
  await write(current,'native.package.put',{package:nativePackage()},'native-put');current.close();
  db=new DatabaseSync(join(options.workspaceRoot,'state/ontology/ontology.db'));assert.equal(db.prepare('SELECT data FROM state').get().data,saved);assert.equal(db.prepare("SELECT receipt FROM receipts WHERE request_id='old-put'").get().receipt,receipt);db.close();
  old=historical(options);assert.throws(()=>old.initialize(),{code:'CORRUPT_STATE'});
 }finally{old.close();current?.close();rmSync(root,{recursive:true,force:true});}
});
test('M06: native snapshot/relocation keeps package, report and immutable audit; later native writes preserve lineage',async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'ontology-native-move-'))),options={workspaceRoot:join(root,'source'),workspaceId:'moving'},dest=join(root,'destination');let s=createOntologyService(options,{resolveNativeAuthoring:syntheticAuthoring,nativeToolchain:tools()});let keyIds=[];
 try{
  s.initialize();const pkg=nativePackage(),identity={id:pkg.manifest.id,version:pkg.manifest.version};await write(s,'native.package.put',{package:pkg},'put');await write(s,'native.package.validate',identity,'validate');s.close();
  const snapshot=inspectWorkspaceSnapshot(options);assert.match(snapshot.nativeRecordsDigest,/^sha256:/);assert.equal(snapshot.unresolved.length,0);privateCopy(options.workspaceRoot,dest);
  const moved=relocateWorkspaceSnapshot({sourceRoot:options.workspaceRoot,destinationRoot:dest,workspaceId:options.workspaceId,expectedSnapshotDigest:snapshot.snapshotDigest});keyIds=moved.requiredKeyIds;assert.equal(moved.snapshot.recordsDigest,snapshot.recordsDigest);
  s=createOntologyService({...options,workspaceRoot:dest},{resolveNativeAuthoring:syntheticAuthoring,nativeToolchain:tools()});s.initialize();const record=await s.native({operation:'native.package.inspect',scope,input:identity});assert.deepEqual(record.package,pkg);
  await write(s,'native.package.review',identity,'review-after-move');s.close();assert(inspectWorkspaceSnapshot({...options,workspaceRoot:dest}).revision>snapshot.revision);
  const db=new DatabaseSync(join(dest,'state/ontology/ontology.db'));db.prepare('DELETE FROM native_audit WHERE revision=2').run();db.close();assert.throws(()=>inspectWorkspaceSnapshot({...options,workspaceRoot:dest}),{code:'INVALID_LINEAGE'});
 }finally{s.close();for(const id of keyIds)rmSync(join(keyDirectory(),id+'.key'),{force:true});rmSync(root,{recursive:true,force:true});}
});
