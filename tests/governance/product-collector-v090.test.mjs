import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collectorArguments,openCollector} from '../acceptance/v090/public-collector.mjs';
test('formal collector refuses a missing report approval before creating an output or installation',async t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'ontology-collector-gate-')));t.after(()=>rmSync(root,{recursive:true,force:true}));const output=join(root,'must-not-exist');
  await assert.rejects(openCollector('AUTH',new URL('../acceptance/v090/auth.mjs',import.meta.url),['--evidence',root,'--request','product-e2e-request.json','--output',output]));assert.equal(existsSync(output),false);
});
test('formal collector command line cannot select traversal, implicit source or unknown switches',()=>{
  for(const args of [[],['--evidence','relative','--request','r.json','--output','/tmp/new'],['--evidence','/tmp/evidence','--request','../r.json','--output','/tmp/new'],['--evidence','/tmp/evidence','--request','r.json','--force','/tmp/new']])assert.throws(()=>collectorArguments(args));
});
