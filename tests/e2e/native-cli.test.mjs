import test from 'node:test';import assert from 'node:assert/strict';import{spawnSync}from'node:child_process';import{mkdtempSync,realpathSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import { fileURLToPath } from 'node:url';
import{nativePackage}from'../fixtures/native/package.mjs';
const scope={visibility:'private',projectId:'synthetic'};
test('C01/O01: current public CLI routes native package and real validation; retired write and executable override fail',()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'ontology-native-cli-')));try{
 const args=[fileURLToPath(new URL('../../dist/cli.js',import.meta.url)),'request','--workspace',join(root,'workspace'),'--workspace-id','cli','--toolchain',process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN];
 const call=req=>{const p=spawnSync(process.execPath,args,{input:JSON.stringify(req),encoding:'utf8'});assert.ifError(p.error);return {exit:p.status,output:JSON.parse(p.stdout)};};
 const pkg=nativePackage();const put=call({operation:'native.package.put',scope,input:{package:pkg},requestId:'put',expectedRevision:0});assert.equal(put.exit,0,JSON.stringify(put.output));
 const valid=call({operation:'native.package.validate',scope,input:{id:pkg.manifest.id,version:pkg.manifest.version},requestId:'validate',expectedRevision:put.output.result.revision});assert.equal(valid.exit,0,JSON.stringify(valid.output));assert.equal(valid.output.result.result.status,'CONFORMS');
 const old=call({operation:'asset.put',scope,input:{model:{}},requestId:'old',expectedRevision:valid.output.result.revision});assert.equal(old.exit,1);assert.equal(old.output.error.code,'HISTORICAL_READ_ONLY');
 const override=call({operation:'native.package.inspect',scope,input:{id:pkg.manifest.id,version:pkg.manifest.version,executable:'/forbidden'}});assert.notEqual(override.exit,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
