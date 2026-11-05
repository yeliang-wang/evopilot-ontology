import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCandidatePack} from '../../scripts/pack-candidate-v090.mjs';
const paths=['package.json','dist/standalone/cli.js','dist/standalone/mcp.js','plugins/codex/.codex-plugin/plugin.json','src/expert/SKILL.md','toolchains/owl2-dl/dependencies.json','src/native-v2/shacl-worker.py','LICENSE','NOTICE'];
const fixture=()=>[{name:'@evopilot-next/ontology',version:'0.9.0',filename:'evopilot-next-ontology-0.9.0.tgz',files:paths.map(path=>({path}))}];
test('independent candidate refuses stale version, foreign ownership, missing executable and private or unsafe paths',()=>{
  assert.equal(validateCandidatePack(fixture()),'evopilot-next-ontology-0.9.0.tgz');
  for(const edit of [p=>p.version='0.8.3',p=>p.name='@evopilot-next/runtime',p=>p.filename='../candidate.tgz',p=>p.files.shift(),p=>p.files.push(p.files[0]),...['../secret','/private/file','workspace/state.json','scripts/release.mjs','tests/fixture','a\\b','a/./b'].map(path=>p=>p.files.push({path}))]){const [p]=fixture();edit(p);assert.throws(()=>validateCandidatePack([p]));}
});
