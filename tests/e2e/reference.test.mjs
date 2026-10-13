import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../../dist/index.js';
import { CONTRACT_REVISION, inspectReference } from '../../vendor/compatibility/v1/reference.mjs';

const ref = (product = 'ontology') => ({ product, id: 'asset-a', version: '0.1.0', specVersion: 'v1', digest: 'sha256:' + 'a'.repeat(64), visibility: 'private' });
const inspect = (expected, observed) => api.inspectArtifactReference(expected, observed);

test('package boundary: exact references are immutable and carry no authority', () => {
  const input = ref();
  const result = inspect(input, { ...input });
  assert.equal(result.authority, false);
  const inspection = result;
  assert.equal(inspection.exactMatch, true);
  assert.deepEqual(inspection.reference, input);
  input.id = 'changed';
  assert.equal(inspection.reference.id, 'asset-a');
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(inspection));
  assert(Object.isFrozen(inspection.reference));
  assert.throws(() => { inspection.reference.id = 'changed'; }, TypeError);
});

test('package boundary: changed bindings and unsupported input fail closed', () => {
  for (const patch of [
    { version: '0.2.0' }, { digest: 'sha256:' + 'b'.repeat(64) },
    { product: 'runtime' }, { id: 'other' }, { visibility: 'public' },
    { specVersion: '1.0.0' }, { specVersion: 'v2' }, { version: '01.0.0' }, { version: '1.00.0' },
    { version: '1.0.00' }, { version: '1.0' }, { version: '1.0.0-beta' },
    { extra: true },
  ]) assert.throws(() => inspect(ref(), { ...ref(), ...patch }));
  assert.throws(() => inspect({ ...ref(), product: 'runtime' }, { ...ref(), product: 'runtime' }));
  assert.throws(() => inspect(ref(), undefined));
  let accessed = false;
  const accessor = { ...ref(), get id() { accessed = true; return 'asset-a'; } };
  assert.throws(() => inspect(accessor, ref()));
  assert.equal(accessed, false);
});

test('package boundary: default capabilities are truthful immutable data', () => {
  assert.equal(api.VERSION, '0.2.0');
  assert.equal(api.PRODUCT, 'ontology');
  const capabilities = api.capabilities();
  assert.equal(capabilities.businessOperationsReady, true);
  assert.equal(capabilities.implementationStage, 'M2_OWNED_SERVICE');
  assert.equal(capabilities.persistentBusinessOperationsReady, true);
  assert.equal(capabilities.hostReady, false);
  assert.equal(capabilities.productionReady, false);
  assert.deepEqual(capabilities.serviceApi.methods, ['capabilities', 'initialize', 'execute', 'classify', 'close']);
  assert(Object.isFrozen(capabilities.serviceApi.methods));
  assert.equal(capabilities.authority, false);
  assert(Object.isFrozen(capabilities));
  assert(Object.isFrozen(capabilities.referenceApi));
  assert.deepEqual(Object.keys(api).sort(), ['PRODUCT', 'VERSION', 'capabilities', 'inspectArtifactReference', 'validateOntology', 'validateInstances', 'buildDelivery', 'verifyDelivery'].sort());
});

test('vendored v1 wire and public boundary are independent of implementation revision', () => {

  assert.equal(CONTRACT_REVISION, '1.0.0');
  for (const product of ['ontology', 'harness']) {
    for (const visibility of ['public', 'private']) {
      const input = { product, id: 'm0-asset', version: '0.1.0', specVersion: 'v1', digest: 'sha256:' + 'a'.repeat(64), visibility };
      const result = inspectReference(input, { ...input });
      assert.deepEqual(result.reference, input);
      assert.notEqual(result.reference, input);
      assert(Object.isFrozen(result.reference));
      assert(Object.isFrozen(result));
      assert.equal(result.exactMatch, true);
      assert.equal(result.authority, false);
      if (visibility === 'public') {
        assert.equal(inspectReference(input, { ...input }, { visibility: 'public' }).exactMatch, true);
      } else {
        assert.throws(() => inspectReference(input, { ...input }, { visibility: 'public' }), TypeError);
      }
      for (const patch of [{ specVersion: '1.0.0' }, { specVersion: 'v2' }, { product: 'runtime' }]) {
        const unsupported = { ...input, ...patch };
        assert.throws(() => inspectReference(unsupported, { ...unsupported }), TypeError);
      }
      for (const patch of [
        { product: product === 'ontology' ? 'harness' : 'ontology' },
        { version: '0.2.0' }, { digest: 'sha256:' + 'b'.repeat(64) },
      ]) assert.throws(() => inspectReference(input, { ...input, ...patch }), TypeError);
    }
  }
});
