import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildDelivery,verifyDelivery} from '../../dist/index.js';
import {sha256} from '../../vendor/compatibility/v1/reference.mjs';
const cases=JSON.parse(fs.readFileSync(new URL('../../examples/synthetic-models.json',import.meta.url)));
test('v0.2 verifies immutable synthetic deliveries from each supported producer without redelivery',()=>{
 const current=buildDelivery(cases.assets[0]);
 assert.equal(current.manifest.productVersion,'0.2.0');
 for(const version of ['0.1.0','0.1.1','0.2.0']){
  const legacy=structuredClone(current); legacy.manifest.productVersion=version;
  const content=Object.fromEntries(Object.entries(legacy).filter(([key])=>!['digest'].includes(key)));
  legacy.digest=sha256(content);
  const bytes=JSON.stringify(legacy);
  assert.equal(verifyDelivery(legacy).valid,true,version);
  assert.equal(JSON.stringify(legacy),bytes);
  legacy.manifest.productVersion='9.0.0';
  assert.equal(verifyDelivery(legacy).valid,false);
 }
});

