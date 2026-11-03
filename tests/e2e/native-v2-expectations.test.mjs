import test from 'node:test';
import assert from 'node:assert/strict';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {hashBytes} from '../../dist/standalone/validation.js';
import {fixture,sources,expected,model,prepare,definition} from '../helpers/v090-validation.mjs';

test('independent expected requirements and oracles survive restart before model generation',t=>{
 const f=fixture(t);let s=createStandaloneService(f.setup);t.after(()=>s.close());const p=sources(s,f),e=expected(p.intentDigest,p.sourceSetDigest);
 const receipt=s.request(f.write('expectations.record',{definition:e},'expected',3),f.token);assert.equal(receipt.result.coverage.complete,true);assert.equal(receipt.result.businessConfirmed,false);s.close();s=createStandaloneService(f.setup);
 const inspected=s.request(f.read('expectations.inspect',{assetId:'services',expectationsDigest:null}),f.token);assert.equal(inspected.current,true);assert.equal(inspected.cases.length,4);
 const list=s.request(f.read('expectations.list',{afterAssetId:null,limit:1}),f.token);assert.equal(list.expectations[0].expectationsDigest,receipt.result.expectationsDigest);assert.equal(list.nextCursor,null);
 let combined='',offset=0;do{const page=s.request(f.read('expectations.read',{assetId:'services',expectationsDigest:receipt.result.expectationsDigest,offset,maxBytes:256}),f.token);combined+=page.content;offset=page.nextOffset;}while(offset!==null);assert.deepEqual(JSON.parse(combined),e);
});
test('unknown source fragments, fabricated requirements and duplicate cases do not mutate expectation state',t=>{
 const f=fixture(t),s=createStandaloneService(f.setup);t.after(()=>s.close());const p=sources(s,f),base=expected(p.intentDigest,p.sourceSetDigest);
 for(const [mutate,code] of [
 [e=>e.requirements[0].sourceFragmentIds=['fabricated'],'EXPECTATIONS_SOURCE'],
 [e=>e.requirements[0].requirementId='invented','EXPECTATIONS_REQUIREMENT'],
 [e=>e.cases[0].requirementIds=['r2'],'EXPECTATIONS_CASE'],
 [e=>e.cases.push({...e.cases[0],id:'duplicate'}),'EXPECTATIONS_CASE'],
 [e=>e.cases[3].expectedViolationShapeIris=[],'EXPECTATIONS_CASE'],
 [e=>e.sourceSetDigest=hashBytes('foreign'),'SOURCE_BINDING_CONFLICT'],
 ]){const value=structuredClone(base);mutate(value);assert.throws(()=>s.request(f.write('expectations.record',{definition:value},'invalid',3),f.token),{code});assert.equal(s.request(f.read('project.inspect'),f.token).revision,3);}
});
test('missing independent positive/negative coverage is retained as incomplete, never self-filled from model content',t=>{
 const f=fixture(t),s=createStandaloneService(f.setup);t.after(()=>s.close());const p=sources(s,f),e=expected(p.intentDigest,p.sourceSetDigest);e.cases=e.cases.filter(c=>c.id!=='sensitive-negative');
 const receipt=s.request(f.write('expectations.record',{definition:e},'incomplete',3),f.token);assert.equal(receipt.result.coverage.complete,false);assert.deepEqual(receipt.result.coverage.missing,['r1:owl:negative']);
 const m=model(p.intentDigest,p.sourceSetDigest,receipt.result.expectationsDigest);s.request(f.write('model.record',{draft:m},'model',4),f.token);
 assert.deepEqual(s.request(f.read('expectations.inspect',{assetId:'services',expectationsDigest:null}),f.token).coverage.missing,['r1:owl:negative']);
});
test('an expectation revision invalidates the old model until explicitly rebound; historical oracles remain readable',t=>{
 const f=fixture(t),s=createStandaloneService(f.setup);t.after(()=>s.close());const p=prepare(s,f),next=structuredClone(p.expectations);next.previousDigest=p.expectationsDigest;next.requirements[0].rationale='Revised interpretation from the same fixed source.';
 const receipt=s.request(f.write('expectations.record',{definition:next},'revise',5),f.token);assert.equal(s.request(f.read('model.inspect',{assetId:'services',modelDigest:p.modelDigest}),f.token).current,false);
 const old=model(p.intentDigest,p.sourceSetDigest,p.expectationsDigest,p.modelDigest);assert.throws(()=>s.request(f.write('model.record',{draft:old},'old',6),f.token),{code:'EXPECTATIONS_BINDING_CONFLICT'});
 assert.equal(s.request(f.read('expectations.inspect',{assetId:'services',expectationsDigest:p.expectationsDigest}),f.token).current,false);
 old.expectationsDigest=receipt.result.expectationsDigest;s.request(f.write('model.record',{draft:old},'rebound',6),f.token);assert.equal(s.request(f.read('model.inspect',{assetId:'services',modelDigest:null}),f.token).current,true);
 const updated={...definition,scope:'Changed scope'};s.request(f.write('intent.record',{definition:updated,previousDigest:p.intentDigest},'change-source-context',7),f.token);assert.equal(s.request(f.read('expectations.inspect',{assetId:'services',expectationsDigest:null}),f.token).current,false);
});
test('every independently required constraint needs its own negative oracle coverage',t=>{
 const f=fixture(t),s=createStandaloneService(f.setup);t.after(()=>s.close());const p=sources(s,f),e=expected(p.intentDigest,p.sourceSetDigest);e.requirements[1].constraintShapeIris.push('urn:demo:OwnerFormatConstraint');
 const receipt=s.request(f.write('expectations.record',{definition:e},'missing-constraint-case',3),f.token);assert.equal(receipt.result.coverage.complete,false);assert(receipt.result.coverage.missing.includes('r2:constraint:urn:demo:OwnerFormatConstraint:negative'));
});
