import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,realpathSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createOntologyService} from '../../dist/service.js';
import {syntheticAuthoring} from '../fixtures/native/authoring.mjs';
import {syntheticDecisionEvidence} from '../fixtures/native/decision-evidence.mjs';
import {nativePackage as packageFixture} from '../fixtures/native/package.mjs';
const scope={visibility:'private',projectId:'synthetic'};
test('ontology CLI blocks unbound new authoring and preserves published read/actual validation and retired-write rejection',async()=>{
 assert(process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN,'Verified native toolchain required');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'ontology-native-cli-'))),options={workspaceRoot:join(root,'workspace'),workspaceId:'cli'};
 let service;
 try{
  const args=[fileURLToPath(new URL('../../dist/cli.js',import.meta.url)),'request','--workspace',options.workspaceRoot,'--workspace-id',options.workspaceId,'--toolchain',process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN];
  const call=request=>{const p=spawnSync(process.execPath,args,{input:JSON.stringify(request),encoding:'utf8'});assert.ifError(p.error);return{exit:p.status,output:JSON.parse(p.stdout)};};
  const pkg=packageFixture(),identity={id:pkg.manifest.id,version:pkg.manifest.version};
  const blocked=call({operation:'native.package.put',scope,input:{package:pkg},requestId:'unbound',expectedRevision:0});
  assert.equal(blocked.exit,1);assert.equal(blocked.output.error.code,'AUTHORING_CONTEXT_REQUIRED');
  service=createOntologyService(options,{nativeToolchain:JSON.parse(readFileSync(process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN)),resolveNativeAuthoring:syntheticAuthoring});service.initialize();
  const write=(operation,input,requestId)=>service.native({operation,scope,input,requestId,expectedRevision:service.execute({operation:'workspace.inspect',scope,input:{}}).revision});
  assert.equal(service.execute({operation:'workspace.inspect',scope,input:{}}).revision,0,'Blocked CLI creates no owner mutation');
  // Synthetic trusted host prepares a published fixture; this is not CLI authoring acceptance.
  await write('native.package.put',{package:pkg},'put');await write('native.package.validate',identity,'validate');
  const review=(await write('native.package.review',identity,'review')).result;
  const humanEvidenceRef=syntheticDecisionEvidence(root,{owner:'ontology',operation:'native.package.decide',workspaceId:options.workspaceId,scope,reviewDigest:review.reviewDigest,decision:'APPROVE'});
  await write('native.package.decide',{...identity,reviewDigest:review.reviewDigest,decision:'APPROVE',humanEvidenceRef},'decide');await write('native.package.publish',identity,'publish');
  const revision=service.execute({operation:'workspace.inspect',scope,input:{}}).revision;service.close();service=null;
  assert.equal(call({operation:'native.package.readback',scope,input:identity}).exit,0);
  const validated=call({operation:'native.package.validate',scope,input:identity,requestId:'consume-published',expectedRevision:revision});assert.equal(validated.exit,0,JSON.stringify(validated.output));
  assert.equal(validated.output.result.result.status,'CONFORMS');
  const old=call({operation:'asset.put',scope,input:{model:{}},requestId:'retired',expectedRevision:validated.output.result.revision});assert.equal(old.exit,1);assert.equal(old.output.error.code,'HISTORICAL_READ_ONLY');
  assert.notEqual(call({operation:'native.package.inspect',scope,input:{...identity,executable:'/forbidden'}}).exit,0);
 }finally{service?.close();rmSync(root,{recursive:true,force:true});}
});
