import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collectorArguments,openCollector,verifyArtifactChunks} from '../acceptance/v090/public-collector.mjs';
import {hashBytes} from '../../scripts/standards-gate.mjs';
test('formal collector refuses a missing report approval before creating an output or installation',async t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'ontology-collector-gate-')));t.after(()=>rmSync(root,{recursive:true,force:true}));const output=join(root,'must-not-exist');
  await assert.rejects(openCollector('AUTH',new URL('../acceptance/v090/auth.mjs',import.meta.url),['--evidence',root,'--request','product-e2e-request.json','--output',output]));assert.equal(existsSync(output),false);
});
test('formal collector command line cannot select traversal, implicit source or unknown switches',()=>{
  for(const args of [[],['--evidence','relative','--request','r.json','--output','/tmp/new'],['--evidence','/tmp/evidence','--request','../r.json','--output','/tmp/new'],['--evidence','/tmp/evidence','--request','r.json','--force','/tmp/new']])assert.throws(()=>collectorArguments(args));
});
test('large artifact evidence cannot omit, reorder, substitute or duplicate byte chunks',()=>{
  const chunks=new Map([['first',Buffer.from('original archive prefix')],['second',Buffer.from('original archive suffix')]]);
  const refs=[...chunks].map(([path,bytes])=>({path,digest:hashBytes(bytes)})),content=Buffer.concat([...chunks.values()]);
  const manifest={schema:'ontology-private-artifact-chunks/v1',bytes:content.length,digest:hashBytes(content),chunks:refs};
  const read=ref=>{const value=chunks.get(ref.path);assert.equal(hashBytes(value),ref.digest);return value;};
  assert.deepEqual(verifyArtifactChunks(manifest,read),{bytes:content.length,digest:hashBytes(content)});
  for(const changed of [{...manifest,chunks:refs.slice(0,1)},{...manifest,chunks:[...refs].reverse()},{...manifest,chunks:[refs[0],refs[0]]},{...manifest,bytes:content.length+1},{...manifest,digest:hashBytes('other archive')}])assert.throws(()=>verifyArtifactChunks(changed,read));
  assert.throws(()=>verifyArtifactChunks(manifest,()=>Buffer.alloc(16*1024*1024+1)));
  chunks.set('second',Buffer.from('different archive suffix'));assert.throws(()=>verifyArtifactChunks(manifest,read));
});
