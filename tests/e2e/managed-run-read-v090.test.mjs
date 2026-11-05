import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {currentRun} from '../../dist/installation/manager.js';
import {writePrivate} from '../../dist/installation/files.js';

function fixture(t){
  const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'ontology-managed-read-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(join(root,'runs'),{mode:0o700});
  const installation={root,installationId:'original-owner'},path=join(root,'runs/original-run.json');
  const run={schema:'ontology-managed-run/v2',installationId:installation.installationId,runId:'original-run',toolchainBindingDigest:null,createdAt:new Date().toISOString(),pid:null,controlSocket:join(root,'control.sock'),state:'STARTING',origin:null,error:null};
  writePrivate(path,run);writePrivate(join(root,'current-run.json'),{runId:run.runId});
  return {root,installation,path,run};
}

test('managed run reads re-observe an actual atomic replacement between stat/open or open/fstat',t=>{
  for(const boundary of ['stat/open','open/fstat']){
    const f=fixture(t),next={...f.run,state:'RUNNING',pid:process.pid,origin:'http://127.0.0.1:1'};
    const originalOpen=fs.openSync,originalStat=fs.lstatSync;let replaced=false,stats=0;
    // Perform the real product writer's atomic rename at a deterministic read
    // boundary. Every returned descriptor/stat and every byte remains real.
    if(boundary==='stat/open')fs.lstatSync=function(path,...options){
      const result=originalStat.call(this,path,...options);
      if(path===f.path&&++stats===2&&!replaced){replaced=true;writePrivate(f.path,next,true);}
      return result;
    };
    else fs.openSync=function(path,...options){
      const fd=originalOpen.call(this,path,...options);
      if(path===f.path&&!replaced){replaced=true;writePrivate(f.path,next,true);}
      return fd;
    };
    syncBuiltinESMExports();
    try{assert.deepEqual(currentRun(f.installation),next);assert.equal(replaced,true);}
    finally{fs.openSync=originalOpen;fs.lstatSync=originalStat;syncBuiltinESMExports();}
  }
});

test('managed run re-observation never admits symlinks, hard links or public permissions',t=>{
  const f=fixture(t),other=join(f.root,'retained-original');fs.renameSync(f.path,other);
  const before=fs.readFileSync(other);
  fs.symlinkSync(other,f.path);assert.throws(()=>currentRun(f.installation),{code:'UNSAFE_PATH'});fs.unlinkSync(f.path);
  fs.linkSync(other,f.path);assert.throws(()=>currentRun(f.installation),{code:'UNSAFE_PATH'});fs.unlinkSync(f.path);
  fs.copyFileSync(other,f.path);fs.chmodSync(f.path,0o644);assert.throws(()=>currentRun(f.installation),{code:'UNSAFE_PATH'});
  assert.deepEqual(fs.readFileSync(other),before);fs.chmodSync(f.path,0o600);assert.deepEqual(currentRun(f.installation),f.run);
});

test('managed run changes retain the exact owner check and never fall back after invalid or missing evidence',t=>{
  const f=fixture(t);
  writePrivate(f.path,{...f.run,installationId:'another-owner'},true);assert.throws(()=>currentRun(f.installation),{code:'IDENTITY_MISMATCH'});
  fs.writeFileSync(f.path,'{');assert.throws(()=>currentRun(f.installation),SyntaxError);
  fs.writeFileSync(f.path,' '.repeat(65537));assert.throws(()=>currentRun(f.installation),{code:'INPUT_LIMIT'});
  fs.unlinkSync(f.path);assert.throws(()=>currentRun(f.installation),{code:'ENOENT'});
});

test('a continuously replaced managed record terminates with the original refusal after bounded observations',t=>{
  const f=fixture(t),original=fs.openSync;let opens=0;
  fs.openSync=function(path,...options){
    const fd=original.call(this,path,...options);
    if(path===f.path){opens++;writePrivate(f.path,f.run,true);}
    return fd;
  };
  syncBuiltinESMExports();
  try{assert.throws(()=>currentRun(f.installation),{code:'UNSAFE_PATH'});assert.equal(opens,3);}
  finally{fs.openSync=original;syncBuiltinESMExports();}
});
