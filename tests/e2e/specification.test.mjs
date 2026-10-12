import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateOntology, validateInstances, buildDelivery, verifyDelivery, capabilities } from '../../src/index.mjs';
import { assertJSON, stableSerialize, sha256, frozenClone } from '../../vendor/compatibility/v1/reference.mjs';

const fixtures = JSON.parse(await readFile(new URL('../../examples/synthetic-models.json', import.meta.url)));
const clone = v => JSON.parse(JSON.stringify(v));
const asset = () => clone(fixtures.assets[0]);
const mutate = (value, fn) => { const copy = clone(value); fn(copy); return copy; };
const bad = fn => assert.equal(validateOntology(mutate(asset(), fn)).valid, false);

test('synthetic matrix and immutable pure API facts', () => {
  assert.equal(fixtures.assets.length, 8);
  assert.equal(new Set(fixtures.assets.map(a => a.id)).size, 8);
  assert.equal(capabilities().persistentBusinessOperationsReady, true);
  for (const a of fixtures.assets) {
    const before = JSON.stringify(a);
    assert.equal(validateOntology(a).valid, true);
    const data = fixtures.instances[a.id]; const dataBefore = JSON.stringify(data);
    const result = validateInstances(a, data);
    assert.equal(result.status, 'PASS');
    assert.equal(result.coverage.length, 4);
    assert(result.coverage.every(c => c.tested === 1));
    assert.equal(result.businessConfirmed, false);
    buildDelivery(a);
    assert.equal(JSON.stringify(a), before); assert.equal(JSON.stringify(data), dataBefore);
  }
});

test('descriptor-safe canonical finite JSON', () => {
  let accessed = false;
  const accessor = Object.defineProperty({}, 'x', { enumerable: true, get() { accessed = true; throw Error('executed'); } });
  const cycle = {}; cycle.x = cycle;
  for (const v of [accessor, cycle, [ , 1], { x: NaN }, { x: Infinity }, { x: undefined }, { [Symbol('x')]: 1 }]) {
    assert.throws(() => assertJSON(v)); assert.equal(validateOntology(v).valid, false);
    assert.equal(validateInstances(asset(), v).valid, false);
  }
  assert.equal(accessed, false);
  assert.equal(stableSerialize({ b: 2, a: [false, 0] }), '{"a":[false,0],"b":2}');
  assert.equal(sha256({ b: 2, a: 1 }), sha256({ a: 1, b: 2 }));
  assert.notEqual(sha256([1, 2]), sha256([2, 1]));
  assert(Object.isFrozen(frozenClone({ a: [] }).a));
});

test('closed syntax, ownership and complete source mappings', () => {
  bad(a => { a.provenance.sources[0].digest = [a.provenance.sources[0].digest]; });
  for (const fn of [a => { delete a.concepts[0].definition; }, a => { a.extra = true; }, a => { a.specVersion = 'v2'; }, a => { a.version = '01.0.0'; }, a => { a.version = '1.0.0-beta'; }, a => { a.properties[0].conceptRef = 'missing'; }, a => { a.constraints[0].conceptRef = a.concepts[1].id; }, a => { a.relations[0].to = 'missing'; }, a => { a.sourceMappings.pop(); }, a => { a.sourceMappings[0].sourceRevision = 'other'; }, a => { a.sourceMappings[0].sourceLocator += '/other'; }, a => { a.sourceMappings[0].sourceRef = 'missing'; }, a => { a.sourceMappings[0].targetRef = 'missing'; }, a => { a.sourceMappings[0].status = 'human-reviewed'; }, a => { a.properties[0].id = a.concepts[0].id; }, a => { a.constraints[0].kind = 'unknown'; }, a => { a.constraints[1].values = [0, 0]; }, a => { a.constraints[1].values = [false]; }]) bad(fn);
  for (const v of [null, {}, [], { concepts: [null] }]) assert.equal(validateOntology(v).valid, false);
});

test('typed constraint boundaries preserve false and zero', () => {
  const a = asset(); const data = fixtures.instances[a.id];
  for (const value of [0, 2, 10]) assert.equal(validateInstances(a, mutate(data, d => { d.entities[0].properties.quantity = [value]; })).valid, true);
  for (const values of [[], [-1], [11], [3], [0.5], ['0'], [false], [0, 2], 0]) assert.equal(validateInstances(a, mutate(data, d => { d.entities[0].properties.quantity = values; })).valid, false);
  for (const fn of [d => { delete d.entities[0].properties.active; }, d => { d.entities[0].properties.active = [0]; }, d => { d.entities[0].properties.extra = [1]; }, d => { d.relations[0].from = 'missing'; }, d => { [d.relations[0].from, d.relations[0].to] = [d.relations[0].to, d.relations[0].from]; }, d => { d.entities.push(clone(d.entities[0])); }]) assert.equal(validateInstances(a, mutate(data, fn)).valid, false);
  // Isolate each rule so another failing rule cannot mask its implementation.
  for (const [kind, values, expected] of [['numeric-range', [-1], false], ['numeric-range', [10], true], ['enum', [3], false], ['enum', [0], true], ['cardinality', [], false], ['cardinality', [0, 2], false]]) {
    const isolated = asset(); isolated.properties[0].required = false;
    isolated.constraints = isolated.constraints.filter(c => c.kind === kind);
    const ids = new Set([...isolated.concepts, ...isolated.properties, ...isolated.relations, ...isolated.constraints].map(r => r.id));
    isolated.sourceMappings = isolated.sourceMappings.filter(m => ids.has(m.targetRef));
    assert.equal(validateOntology(isolated).valid, true);
    assert.equal(validateInstances(isolated, mutate(data, d => { d.entities[0].properties.quantity = values; })).valid, expected);
  }
  const numberModel = asset(); numberModel.properties[0].type = 'number';
  numberModel.constraints[1].values = [0, 0.5, 10];
  assert.equal(validateInstances(numberModel, mutate(data, d => { d.entities[0].properties.quantity = [0.5]; })).valid, true);
  for (const value of [NaN, Infinity]) {
    const malformed = clone(data); malformed.entities[0].properties.quantity = [value];
    assert.equal(validateInstances(numberModel, malformed).valid, false);
  }
  const stringModel = asset();
  stringModel.constraints[1].conceptRef = 'plot'; stringModel.constraints[1].propertyRef = 'name'; stringModel.constraints[1].values = ['synthetic'];
  assert.equal(validateInstances(stringModel, data).valid, true);
  assert.equal(validateInstances(stringModel, mutate(data, d => { d.entities[1].properties.name = ['other']; })).valid, false);
});

test('coverage distinguishes unsupported and untested from pass', () => {
  const a = asset();
  const empty = validateInstances(a, { entities: [], relations: [] });
  assert.equal(empty.status, 'NOT_CHECKED'); assert.equal(empty.complete, false); assert.equal(empty.untested.length, 4);
  assert(buildDelivery(a).buildReport.constraints.every(c => c.status === 'NOT_CHECKED'));
  a.constraints[0] = { id: 'quantity-range', kind: 'descriptive-range', required: false, conceptRef: 'tree', propertyRef: 'quantity', description: 'Synthetic advisory only.' };
  assert.equal(validateOntology(a).constraints[0].status, 'UNSUPPORTED');
  assert.equal(validateInstances(a, fixtures.instances[a.id]).coverage[0].status, 'UNSUPPORTED');
  a.constraints[0].required = true; assert.equal(validateOntology(a).valid, false);
});

test('additive extensions and exact dependency boundaries', () => {
  const a = asset();
  assert.equal(validateOntology(a).extensions[0].status, 'VALID');
  bad(a => { a.extensions[0].data.annotation.text = 123; });
  bad(a => { a.extensions[0].data.basePatch = {}; });
  a.extensions.push({ namespace: 'future.notes', version: '1.0.0', required: false, data: { note: 'synthetic' } });
  assert.equal(validateOntology(a).extensions[1].status, 'NOT_EVALUATED');
  assert.deepEqual(buildDelivery(a).model.extensions, a.extensions);
  a.extensions[1].required = true; assert.equal(validateOntology(a).valid, false);
  const ref = { product: 'harness', id: 'synthetic-dependency', version: '1.0.0', specVersion: 'v1', visibility: 'private', digest: 'sha256:' + 'a'.repeat(64) };
  bad(a => { a.dependencies = [ref]; });
  const privateAsset = asset(); privateAsset.visibility = 'private'; privateAsset.dependencies = [ref];
  assert.equal(validateOntology(privateAsset).valid, true);
  assert.deepEqual(buildDelivery(privateAsset).manifest.dependencies, [ref]);
  privateAsset.dependencies.push(ref); assert.equal(validateOntology(privateAsset).valid, false);
});

test('deterministic delivery rejects tampering and required pending issues', () => {
  const a = asset(); const delivery = buildDelivery(a);
  assert.deepEqual(buildDelivery(a), delivery); assert(Object.isFrozen(delivery.model.concepts[0]));
  assert.equal(verifyDelivery(delivery).valid, true);
  for (const fn of [d => { d.extra = true; }, d => { d.model.concepts[0].label = 'tampered'; }, d => { d.manifest.productVersion = '9.0.0'; }, d => { d.manifest.extra = true; }, d => { d.buildReport.released = true; }, d => { d.validationReport.valid = false; }, d => { d.sourceMappings.pop(); }, d => { d.digest = 'sha256:' + '0'.repeat(64); }]) assert.equal(verifyDelivery(mutate(delivery, fn)).valid, false);
  a.unresolvedIssues.push({ id: 'issue', description: 'Synthetic unresolved question', targetRef: 'tree', required: true });
  assert.equal(validateOntology(a).status, 'PENDING'); assert.throws(() => buildDelivery(a));
  a.unresolvedIssues[0].required = false; assert.equal(verifyDelivery(buildDelivery(a)).valid, true);
});
