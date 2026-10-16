import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateNativeOntology} from '../../dist/index.js';
import {nativeBytesDigest,nativeSha256} from '../../vendor/compatibility/v1/native.mjs';
import {nativePackage} from '../fixtures/native/package.mjs';
// Deliberately faulty construction-time process fixtures, not production pySHACL.
function fixture(body){const root=realpathSync(mkdtempSync(join(tmpdir(),'ontology-process-'))),exe=join(root,'python'),site=join(root,'site-packages');mkdirSync(site);const dep=join(site,'locked.txt');writeFileSync(dep,'locked');writeFileSync(exe,'#!/bin/sh\n'+body+'\n',{mode:0o700});const sha=nativeBytesDigest('#!/bin/sh\n'+body+'\n').slice(7),dependencyFiles=[{path:dep,sha256:nativeBytesDigest('locked').slice(7)}];return {root,tools:{schema:'evopilot-native-toolchain/v1',lockDigest:nativeSha256({fixture:body}),platform:process.platform,arch:process.arch,tools:{python:{executable:exe,version:'3.12.12',sha256:sha},pyshacl:{executable:exe,version:'0.40.1',sha256:sha}},dependencyLockDigest:nativeSha256(dependencyFiles),timeoutMs:60000,maxInputBytes:1048576,maxPackageBytes:1048576,environmentRoot:root,dependencyFiles}};}
test('O11: real process malformed output, wrong exit and killed child are ERROR, never quality PASS',async()=>{
 for(const body of ['printf broken','exit 7','kill -KILL $$','printf \'{"status":"CONFORMS","rawReport":"","modelReport":"","diagnostics":[],"results":[],"caseReports":[]}\'']){
  const f=fixture(body);try{const r=await validateNativeOntology(nativePackage(),f.tools);assert.equal(r.status,'ERROR');assert(r.criteria.every(c=>c.status==='ERROR'));assert.equal(r.diagnostics[0].code,'INVALID_NATIVE_REPORT');}finally{rmSync(f.root,{recursive:true,force:true});}
 }
});
test('S05: an unlisted .pth file and changed lock prevent process launch',async()=>{
 const f=fixture('printf should-not-run');try{writeFileSync(join(f.root,'site-packages','unexpected.pth'),'import danger');await assert.rejects(validateNativeOntology(nativePackage(),f.tools),{code:'TOOLCHAIN_DRIFT'});}finally{rmSync(f.root,{recursive:true,force:true});}
});
