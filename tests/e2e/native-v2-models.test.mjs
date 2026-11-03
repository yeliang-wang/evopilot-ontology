import test from 'node:test';
import assert from 'node:assert/strict';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {hashBytes} from '../../dist/standalone/validation.js';
import {fixture,prepare,draft,ttl,definition} from '../helpers/v090-native.mjs';

test('native drafts retain original documents and incomplete requirement mappings across restart',t=>{
 const f=fixture(t);let s=createStandaloneService(f.setup);t.after(()=>s.close());const p=prepare(s,f);
 const partial=draft(p.intentDigest,p.sourceSetDigest,ttl,p.modelDigest);partial.mappings=[];partial.openIssues=['Confirm source classification'];
 const receipt=s.request(f.write('model.record',{draft:partial},'partial',4),f.token);assert.deepEqual(receipt.result.mapping.missing,['r1']);assert.equal(receipt.result.mapping.complete,false);
 s.close();s=createStandaloneService(f.setup);
 const model=s.request(f.read('model.inspect',{assetId:'services',modelDigest:null}),f.token);assert.equal(model.modelDigest,receipt.result.modelDigest);assert.equal(model.current,true);assert.equal(model.formalValidation,'NOT_EVALUATED');assert.equal(model.businessConfirmed,false);
 let combined='',offset=0;do{const page=s.request(f.read('model.document.read',{assetId:'services',modelDigest:p.modelDigest,documentId:'model',offset,maxBytes:64}),f.token);assert.equal(page.current,false);combined+=page.content;offset=page.nextOffset;}while(offset!==null);assert.equal(combined,ttl);
});
test('stale parents, source bindings, mismatched original bytes and fabricated mappings cannot advance drafts',t=>{
 const f=fixture(t),s=createStandaloneService(f.setup);t.after(()=>s.close());const p=prepare(s,f);
 assert.throws(()=>s.request(f.write('model.record',{draft:p.model},'old-parent',4),f.token),{code:'MODEL_CONFLICT'});
 const base=draft(p.intentDigest,p.sourceSetDigest,ttl,p.modelDigest);
 for(const [mutate,code] of [
 [x=>{x.sourceSetDigest=hashBytes('other');},'SOURCE_BINDING_CONFLICT'],
 [x=>{x.closure.documents[0].content='changed';},'DIGEST_MISMATCH'],
 [x=>{x.mappings[0].sourceFragmentIds=['invented'];},'MODEL_MAPPING'],
 [x=>{x.mappings[0].requirementId='invented';},'MODEL_MAPPING'],
 [x=>{x.mappings[0].anchors[0].fragmentDigest=hashBytes('invented');},'MODEL_MAPPING'],
 [x=>{x.derived=true;},'INVALID_INPUT'],
 ]){const value=structuredClone(base);mutate(value);assert.throws(()=>s.request(f.write('model.record',{draft:value},'bad',4),f.token),{code});assert.equal(s.request(f.read('project.inspect'),f.token).revision,4);}
 const changed=s.request(f.write('intent.record',{definition:{...definition,scope:'Changed scope'},previousDigest:p.intentDigest},'new-intent',4),f.token);
 assert.notEqual(changed.result.intentDigest,p.intentDigest);assert.equal(s.request(f.read('model.inspect',{assetId:'services',modelDigest:p.modelDigest}),f.token).current,false);
 assert.throws(()=>s.request(f.write('model.record',{draft:base},'stale-source',5),f.token),{code:'SOURCE_BINDING_CONFLICT'});
});
test('shape bytes stay separate from OWL premises and syntax-invalid logical content remains a repairable draft',t=>{
 const f=fixture(t),s=createStandaloneService(f.setup);t.after(()=>s.close());const p=prepare(s,f),value=draft(p.intentDigest,p.sourceSetDigest,'Not valid Turtle',p.modelDigest);
 const shape='@prefix sh: <http://www.w3.org/ns/shacl#> . <urn:shape> a sh:NodeShape .';
 value.shapes=[{id:'shapes',documentIri:'urn:shapes',ontologyIri:null,versionIri:null,format:'turtle',content:shape,digest:hashBytes(shape)}];
 const receipt=s.request(f.write('model.record',{draft:value},'repairable',4),f.token);assert.equal(receipt.result.status,'DRAFT');
 const view=s.request(f.read('model.inspect',{assetId:'services',modelDigest:receipt.result.modelDigest}),f.token);
 assert.equal(view.closure.documents.length,1);assert.equal(view.shapes.length,1);assert.equal(view.formalValidation,'NOT_EVALUATED');
 assert.equal(s.request(f.read('model.document.read',{assetId:'services',modelDigest:receipt.result.modelDigest,documentId:'shapes',offset:0,maxBytes:65536}),f.token).content,shape);
});
test('later sessions discover scoped asset heads with bounded pagination',t=>{
 const f=fixture(t),s=createStandaloneService(f.setup);t.after(()=>s.close());const p=prepare(s,f);
 const second=draft(p.intentDigest,p.sourceSetDigest);second.assetId='another';s.request(f.write('model.record',{draft:second},'second-model',4),f.token);
 const first=s.request(f.read('model.list',{afterAssetId:null,limit:1}),f.token);assert.deepEqual(first.models.map(m=>m.assetId),['another']);assert.equal(first.nextCursor,'another');
 const next=s.request(f.read('model.list',{afterAssetId:first.nextCursor,limit:1}),f.token);assert.deepEqual(next.models.map(m=>m.assetId),['services']);assert.equal(next.nextCursor,null);assert.equal(next.projectRevision,first.projectRevision);
});
