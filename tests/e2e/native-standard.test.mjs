import test from 'node:test';
import { fileURLToPath } from 'node:url';import assert from 'node:assert/strict';
import {readFileSync,existsSync}from'node:fs';import{spawnSync}from'node:child_process';
import Ajv from 'ajv/dist/2020.js';
import{nativePackage}from'../fixtures/native/package.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
function checkAdoption(matrix,cases){assert.equal(new Set(matrix.entries.map(x=>x.id)).size,matrix.entries.length);assert.deepEqual(cases.entries.map(x=>x.clauseId).sort(),matrix.entries.map(x=>x.id).sort());const upstream=read('tests/fixtures/upstream-shacl/source.json');for(const clause of matrix.entries){assert.match(clause.officialURL,/^https:\/\//);assert(clause.standard&&clause.adoptedMeaning&&clause.testIds.length);const record=cases.entries.find(x=>x.clauseId===clause.id);assert.deepEqual(record.requiredTestIds,clause.testIds);assert(record.productTests.length);const code=record.productTests.map(path=>{assert(path.startsWith('tests/e2e/native-'));return readFileSync(new URL('../../'+path,import.meta.url),'utf8');}).join('\n');for(const id of clause.testIds)assert(code.includes(id),id+' must have a real product test');for(const path of record.upstreamCases)assert(upstream.cases.some(x=>x.path===path));}}
test('S01/S03: adopted clauses retain standard/source/test mapping; removing a required test reference fails',()=>{
 const matrix=read('specifications/v1/support-matrix.json'),cases=read('specifications/v1/conformance-cases.json');checkAdoption(matrix,cases);
 const changed=structuredClone(cases);changed.entries[0].requiredTestIds.pop();assert.throws(()=>checkAdoption(matrix,changed));changed.entries[0].productTests=[];assert.throws(()=>checkAdoption(matrix,changed));
});
test('S04: public JSON schemas validate actual native package and closed bindings/coverage/cases',()=>{
 const ajv=new Ajv({strict:false}),p=nativePackage();
 for(const [schema,value]of [['package',p],['source-bindings',JSON.parse(p.files['sources/bindings.json'])],['coverage',JSON.parse(p.files['scope/coverage.json'])],['cases',JSON.parse(p.files['tests/cases.json'])]]){const validate=ajv.compile(read('specifications/v1/'+schema+'.schema.json'));assert.equal(validate(value),true,schema+':'+JSON.stringify(validate.errors));const extra=structuredClone(value);extra.unrecognized=true;assert.equal(validate(extra),false,schema);}
});
test('S04/M05: package includes actual native sources/standards and excludes synthetic historical test runtime',()=>{
 const run=spawnSync('npm',['pack','--dry-run','--json','--ignore-scripts'],{encoding:'utf8',cwd:fileURLToPath(new URL('../../',import.meta.url))});assert.ifError(run.error);assert.equal(run.status,0,run.stderr);const files=JSON.parse(run.stdout)[0].files.map(x=>x.path);
 assert(files.includes('src/native/validator.py'));assert(files.includes('specifications/v1/meta-shapes.ttl'));assert(files.includes('dist/native/service.d.ts'));assert(!files.some(p=>p.startsWith('tests/')));assert(!files.some(p=>p.startsWith('workspace/')));
});
