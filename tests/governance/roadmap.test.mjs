import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, cp, rm, appendFile, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gate, inspectGovernance} from '../../scripts/roadmap.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
test('approved scope is not acceptance or release authority',async()=>{
  const result=await gate({stage:'P1',intent:'Implement scoped standalone service',paths:['src/standalone/service.ts']});
  assert.equal(result.status,'ALIGNED'); assert.equal(result.releaseAuthorized,false);
  assert.equal(result.acceptance,'NOT_EVALUATED'); assert.ok(result.caseCount>100);
});
test('foreign, unspecified, historical and escaped paths are refused',async()=>{
  for(const path of ['../runtime/src/service.ts','src/service.ts','vendor/compatibility/v1/native.mjs','src/standalone/../../secret','/tmp/foreign']) {
    await assert.rejects(gate({stage:'P1',intent:'implementation',paths:[path]}),/UNPLANNED|BOUNDARY_CHANGE/);
  }
  await assert.rejects(gate({stage:'P1',intent:'',paths:[]}),/UNKNOWN/);
});
test('plan, roadmap and acceptance drift cannot be silently approved',async t=>{
  const copy=await mkdtemp(join(tmpdir(),'ontology-governance-'));
  t.after(()=>rm(copy,{recursive:true,force:true}));
  await cp(join(root,'governance'),join(copy,'governance'),{recursive:true});
  await cp(join(root,'docs'),join(copy,'docs'),{recursive:true});
  await inspectGovernance(copy);
  for(const path of ['docs/ontology-v090-plan.md','governance/roadmap.json','governance/acceptance-v090.json']){
    await appendFile(join(copy,path),'\n');
    await assert.rejects(inspectGovernance(copy),/DEVIATION/);
    await cp(join(root,path),join(copy,path));
  }
  await symlink(tmpdir(),join(copy,'src'));
  await assert.rejects(gate({stage:'P1',intent:'implementation',paths:['src/standalone/new.ts']},copy),/BOUNDARY_CHANGE/);
});
