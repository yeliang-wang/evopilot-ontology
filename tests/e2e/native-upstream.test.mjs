import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyOntologyToolchain } from '../../dist/index.js';
const root=fileURLToPath(new URL('../fixtures/upstream-shacl/',import.meta.url));
test('O10: 103 pinned upstream Core/SELECT fixtures match independent expected report graphs',()=>{
 assert(process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN,'Real installed native toolchain required');
 const tools=verifyOntologyToolchain(JSON.parse(readFileSync(process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN,'utf8')));
 // This wrapper runs 103 isolated processes, each still bounded by the runner's
 // 60-second per-fixture timeout. Its aggregate CI budget is not a relaxation of
 // the product validator's single-validation deadline.
 const result=spawnSync(tools.tools.python.executable,['-I','-B',fileURLToPath(new URL('../fixtures/native/upstream_runner.py',import.meta.url)),root],{encoding:'utf8',timeout:300000,maxBuffer:16*1024*1024,env:{PATH:'',PYTHONDONTWRITEBYTECODE:'1'}});
 assert.ifError(result.error);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr+result.stdout);
 const report=JSON.parse(result.stdout);assert.equal(report.count,103);assert.equal(report.passed,103);assert(report.cases.every(c=>c.rawReport&&c.matchesExpected));
 verifyOntologyToolchain(tools);
});
