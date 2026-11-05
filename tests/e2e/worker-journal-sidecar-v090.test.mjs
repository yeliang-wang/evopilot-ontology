import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorkerAttempt,readWorkerAttempt,sealWorkerNotStarted} from '../../dist/installation/worker-journal.js';
import {hash} from '../../dist/standalone/validation.js';

function fixture(t){
  const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'ontology-journal-sidecar-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const reference=createWorkerAttempt(root,{schema:'ontology-owned-worker/v1',requestId:'sidecar-contract',requestDigest:hash('request'),configurationDigest:hash('config'),toolchainDigest:hash('tool'),executable:process.execPath,args:[],env:{},stdinDigest:hash('x'),stdinBytes:1,timeoutMs:1000,outputBytes:1024,diagnosticBytes:1024});
  sealWorkerNotStarted(reference);return {root,reference,sidecar:join(root,'worker-journal.sqlite-journal')};
}
test('a committing writer may remove its optional rollback journal between filesystem observations',t=>{
  const f=fixture(t),before=readWorkerAttempt(f.reference);fs.writeFileSync(f.sidecar,'',{mode:0o600,flag:'wx'});
  // Deterministically model a real DELETE-journal commit between two stat
  // observations. No stat result, SQLite result or retained attempt is forged.
  const original=fs.lstatSync;let observations=0;
  fs.lstatSync=function(path,...options){if(path===f.sidecar&&++observations===2){try{fs.unlinkSync(f.sidecar);}catch(e){if(e.code!=='ENOENT')throw e;}}return original.call(this,path,...options);};
  syncBuiltinESMExports();
  try{assert.deepEqual(readWorkerAttempt(f.reference),before);assert(observations>=2);}
  finally{fs.lstatSync=original;syncBuiltinESMExports();}
});
test('optional rollback journal validation still rejects symlinks and foreign permissions',t=>{
  const f=fixture(t),target=join(f.root,'foreign');fs.symlinkSync(target,f.sidecar);
  assert.throws(()=>readWorkerAttempt(f.reference),{code:'UNSAFE_PATH'});assert.equal(fs.existsSync(target),false);fs.unlinkSync(f.sidecar);
  fs.writeFileSync(f.sidecar,'',{mode:0o600});fs.chmodSync(f.sidecar,0o644);
  assert.throws(()=>readWorkerAttempt(f.reference),{code:'UNSAFE_PATH'});fs.unlinkSync(f.sidecar);
  assert.equal(readWorkerAttempt(f.reference).outcome.state,'NOT_STARTED');
});
