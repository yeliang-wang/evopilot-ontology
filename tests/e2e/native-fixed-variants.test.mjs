import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateNativeOntology,validateOntologyPackage} from '../../dist/index.js';
import {nativePackage,rehash} from '../fixtures/native/package.mjs';
const tools=()=>JSON.parse(readFileSync(process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN,'utf8'));

// Fixed independently of validator output, matching the adopted example's
// required identities. Deleting one member never shrinks the expected set.
const shapes=['ProjectShape','CapabilitiesShape','CapabilityShape','KindShape','OperationShape','LimitShape'];
const entities=['project','engine','query'];
const cases=['positive','root-type','relation','combination','kind','operation','limit'];
function removeSubject(text,id){
 const pattern=new RegExp('^ex:'+id+'(?=\\s)[\\s\\S]*?(?=^ex:|$(?![\\s\\S]))','gm');
 const out=text.replace(pattern,'');assert.notEqual(out,text,'Stimulus must remove '+id);return out;
}
for(const id of shapes)test('O12.01: remove required shape '+id,async()=>{
 const p=nativePackage();p.files['shapes/domain.ttl']=removeSubject(p.files['shapes/domain.ttl'],id);rehash(p);
 const r=await validateNativeOntology(p,tools());assert.notEqual(r.status,'CONFORMS');assert(r.diagnostics.length||r.results.length);
});
for(const id of entities)test('O12.02: remove required entity '+id,async()=>{
 const p=nativePackage();p.files['instances/current.ttl']=removeSubject(p.files['instances/current.ttl'],id);rehash(p);
 const r=await validateNativeOntology(p,tools());assert.notEqual(r.status,'CONFORMS');
});
for(const id of cases)test('O12.03: remove required case '+id,()=>{
 const p=nativePackage(),c=JSON.parse(p.files['tests/cases.json']);c.cases=c.cases.filter(x=>x.id!==id);p.files['tests/cases.json']=JSON.stringify(c);rehash(p);
 assert.throws(()=>validateOntologyPackage(p));
});
for(const [id,change,component] of [
 ['missing-property',x=>x.replace('; ex:kind "ENGINE"',''),'MinCountConstraintComponent'],
 ['wrong-type',x=>x.replace('ex:limit 3','ex:limit "three"'),'DatatypeConstraintComponent'],
 ['below-minimum',x=>x.replace('ex:limit 3','ex:limit 0'),'MinInclusiveConstraintComponent'],
 ['above-maximum',x=>x.replace('ex:limit 3','ex:limit 11'),'MaxInclusiveConstraintComponent'],
 ['closed-property',x=>x+'\nex:engine ex:undeclared 1 .','ClosedConstraintComponent'],
 ['wrong-relation-type',x=>x.replace('ex:hasCapability ex:engine, ex:query','ex:hasCapability ex:engine, ex:wrong')+'\nex:wrong a ex:Project .','ClassConstraintComponent'],
 ['relation-overflow',x=>x+'\nex:project ex:hasCapability ex:third .\nex:third a ex:Capability; ex:kind "QUERY"; ex:operation "search"; ex:limit 5 .','MaxCountConstraintComponent']
])test('O02/O04: native result preserves constraint and focus for '+id,async()=>{
 const p=nativePackage();p.files['instances/current.ttl']=change(p.files['instances/current.ttl']);rehash(p);
 const r=await validateNativeOntology(p,tools());assert.equal(r.status,'NONCONFORMING');assert(r.rawReport.includes(component),r.rawReport);assert(r.rawReport.includes('focusNode'));assert(r.rawReport.includes('resultPath'));
});
test('O04.04: duplicate identical triples do not invent cardinality',async()=>{
 const p=nativePackage();p.files['instances/current.ttl']+='\nex:project ex:hasCapability ex:engine .\n';rehash(p);
 const r=await validateNativeOntology(p,tools());assert.equal(r.status,'CONFORMS');
});
for(const severity of ['Warning','Info'])test('O11: required '+severity+' remains nonconforming with original severity',async()=>{
 const p=nativePackage();p.files['shapes/domain.ttl']+='\nex:KindShape sh:severity sh:'+severity+' .\n';p.files['instances/current.ttl']=p.files['tests/kind.ttl'];rehash(p);
 const r=await validateNativeOntology(p,tools());assert.equal(r.status,'NONCONFORMING');assert(r.rawReport.includes('sh:'+severity));
});
