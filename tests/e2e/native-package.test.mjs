import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectOntologyStandard, validateOntologyPackage } from '../../dist/index.js';
import { nativePackage,rehash } from '../fixtures/native/package.mjs';

test('S02/S04: installed standard identity derives from actual files; corrected v1 never accepts old/missing pins',()=>{
 const s=inspectOntologyStandard();assert.equal(s.specVersion,'v1');assert.match(s.standardDigest,/^sha256:[a-f0-9]{64}$/);assert(s.files.some(f=>f.path==='meta-shapes.ttl'));
 assert.doesNotThrow(()=>validateOntologyPackage(nativePackage()));
 for(const key of ['standardDigest','standardLockDigest']){const p=nativePackage();p.manifest.standardPins[key]='sha256:'+'0'.repeat(64);assert.throws(()=>validateOntologyPackage(p));}
 const p=nativePackage();delete p.manifest.standardPins;assert.throws(()=>validateOntologyPackage(p));
});
test('C01/M05: same public/private syntax; manifests reject path/hash/duplicate/source leaks',()=>{
 for(const visibility of ['public','private'])assert.doesNotThrow(()=>validateOntologyPackage(nativePackage({visibility}),{visibility,projectId:'synthetic'}));
 for(const change of [p=>p.manifest.files[0].path='../model.ttl',p=>p.manifest.files[0].sha256='0'.repeat(64),p=>p.manifest.files.push(p.manifest.files[0]),p=>p.files.extra='unmanifested']){const p=nativePackage();change(p);assert.throws(()=>validateOntologyPackage(p));}
 const p=nativePackage({visibility:'public'});const b=JSON.parse(p.files['sources/bindings.json']);b.sources[0].visibility='private';p.files['sources/bindings.json']=JSON.stringify(b);rehash(p);assert.throws(()=>validateOntologyPackage(p),{code:'SOURCE_SCOPE_MISMATCH'});
});
test('O06/O12: fixed case denominator, mandatory interpretation and source mappings cannot disappear',()=>{
 for(const change of [p=>{const c=JSON.parse(p.files['tests/cases.json']);c.cases.pop();p.files['tests/cases.json']=JSON.stringify(c);},p=>{const b=JSON.parse(p.files['sources/bindings.json']);b.mappings=[];p.files['sources/bindings.json']=JSON.stringify(b);},p=>{const b=JSON.parse(p.files['sources/bindings.json']);b.requirements[0].disposition='unresolved';b.requirements[0].reason='unknown';p.files['sources/bindings.json']=JSON.stringify(b);}]){const p=nativePackage();change(p);rehash(p);assert.throws(()=>validateOntologyPackage(p));}
});
test('O06/S04: source bytes, exact selector, revision and inferred rationale are independently checked',()=>{
 for(const change of [b=>b.mappings[0].fileDigest='sha256:'+'0'.repeat(64),b=>b.mappings[0].fragmentDigest='sha256:'+'1'.repeat(64),b=>b.mappings[0].revision='other',b=>b.mappings[0].selector.end=99999,b=>delete b.sources[0].contentPath,b=>{b.sources[0].status='inferred';for(const m of b.mappings)m.status='inferred';}]){
  const p=nativePackage(),b=JSON.parse(p.files['sources/bindings.json']);change(b);p.files['sources/bindings.json']=JSON.stringify(b);rehash(p);assert.throws(()=>validateOntologyPackage(p));
 }
 const p=nativePackage(),b=JSON.parse(p.files['sources/bindings.json']);p.files['sources/source.txt']+='\nchanged';rehash(p);assert.throws(()=>validateOntologyPackage(p),{code:'SOURCE_DIGEST_MISMATCH'});
});
test('O06: JSON Pointer and exact CR/LF selectors retain independently recomputable fragments',async()=>{
 const {nativeSha256,nativeBytesDigest}=await import('../../vendor/compatibility/v1/native.mjs');
 const p=nativePackage(),b=JSON.parse(p.files['sources/bindings.json']),source={definitions:{'a/b':{value:3}}};
 p.files['sources/source.txt']=JSON.stringify(source);b.sources[0].digest=nativeBytesDigest(p.files['sources/source.txt']);
 for(const m of b.mappings){m.fileDigest=b.sources[0].digest;m.selector={kind:'json-pointer',pointer:'/definitions/a~1b'};m.fragmentDigest=nativeSha256(source.definitions['a/b']);}
 p.files['sources/bindings.json']=JSON.stringify(b);rehash(p);assert.doesNotThrow(()=>validateOntologyPackage(p));
 b.mappings[0].selector.pointer='/missing';p.files['sources/bindings.json']=JSON.stringify(b);rehash(p);assert.throws(()=>validateOntologyPackage(p),{code:'INVALID_SELECTOR'});
});

test('source observation and inferred interpretation remain distinct; inference cannot become an observation', () => {
 const p=nativePackage(),b=JSON.parse(p.files['sources/bindings.json']);
 b.mappings[0].status='inferred';b.mappings[0].rationale='Synthetic interpretation of observed source bytes.';
 p.files['sources/bindings.json']=JSON.stringify(b);rehash(p);assert.doesNotThrow(()=>validateOntologyPackage(p));
 b.sources[0].status='inferred';p.files['sources/bindings.json']=JSON.stringify(b);rehash(p);
 assert.throws(()=>validateOntologyPackage(p),{code:'INVALID_BINDINGS'});
});
