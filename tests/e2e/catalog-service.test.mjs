import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createOntologyService } from '../../src/service.mjs';
import { sha256 } from '../../vendor/compatibility/v1/reference.mjs';
import { catalogClient, ownedCatalogMaterials, trustedHarness } from '../fixtures/catalog-service-materials.mjs';

const scope = { visibility: 'public', projectId: 'alpha' };
const pub = sets => ({ action: 'PUBLISH', catalogId: 'main', expectedHead: 'EMPTY', sets });
test('request and provider descriptors reject accessors without invoking them', () => {
  const options = { workspaceRoot: '/discovery-only', workspaceId: 'catalog-test' };
  let calls = 0;
  const getter = { get() { calls++; throw new Error('getter executed'); }, enumerable: true };
  const service = createOntologyService(options, Object.create(null));
  for (const request of [Object.defineProperty({}, 'operation', getter), Object.defineProperty({ operation: 'semantic.catalog.recover' }, 'input', getter), { operation: 'semantic.catalog.recover', scope, input: {} }]) {
    assert.throws(() => service.execute(request), { code: 'INVALID_REQUEST' });
  }
  for (const providers of [Object.defineProperty({}, 'resolveLegacyHarness', getter), Object.defineProperty({}, 'unknown', getter), { [Symbol('provider')]: () => {} }, { resolveLegacyHarness: undefined }, { resolveLegacyHarness: 'callback' }, Object.create({ resolveLegacyHarness() {} }), []]) {
    assert.throws(() => createOntologyService(options, providers), { code: 'INVALID_REQUEST' });
  }
  createOntologyService(options, Object.assign(Object.create(null), { resolveLegacyHarness() {} })).close();
  assert.equal(calls, 0); service.close();
});
test('catalog discovery is pure; JSON options cannot inject a provider', () => {
  const service = createOntologyService({ workspaceRoot: '/discovery-only', workspaceId: 'catalog-test' });
  assert.equal(service.capabilities().operations.filter(v => v.startsWith('semantic.catalog.')).length, 10);
  assert.throws(() => service.execute({ operation: 'semantic.catalog.inspect', scope, input: { catalogId: 'main' } }), { code: 'NOT_INITIALIZED' });
  assert.throws(() => createOntologyService({ workspaceRoot: '/discovery-only', workspaceId: 'catalog-test', resolveLegacyHarness: 'path' }));
  service.close();
});

test('durable public catalog: owned material, decisions, revocation, readback and restart reconciliation', () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'ontology-catalog-'))), root = join(parent, 'workspace');
  const options = { workspaceRoot: root, workspaceId: 'catalog-test' };
  let mode = 'valid';
  let getterCalls = 0;
  const providers = { resolveLegacyHarness: args => {
    if (mode === 'promise' || mode === 'promise-getter') {
      const promise = Promise.reject(new Error('synthetic late failure'));
      if (mode === 'promise-getter') Object.defineProperty(promise, 'then', { get() { getterCalls++; throw new Error('unsafe then'); } });
      return promise;
    }
    if (mode === 'wrong') return { ...trustedHarness(args), workspace: { id: 'foreign' } };
    if (mode === 'unknown') return null;
    if (['then', 'verified'].includes(mode)) return Object.defineProperty({ ...trustedHarness(args) }, mode, { get() { getterCalls++; throw new Error('unsafe provider getter'); }, enumerable: true });
    return trustedHarness(args);
  } };
  let service = createOntologyService(options, providers); service.initialize();
  const c = catalogClient({ execute: r => service.execute(r) }, scope);
  try {
    const set = ownedCatalogMaterials(c), parameters = pub([set]);
    const unchanged = fn => { const before = c.read('workspace.inspect').revision; assert.throws(fn); assert.equal(c.read('workspace.inspect').revision, before); };
    const before = c.read('workspace.inspect').revision;
    const preview = c.read('semantic.catalog.preview', parameters);
    assert.equal(c.read('workspace.inspect').revision, before); assert.equal(preview.authority, false);
    unchanged(() => c.prepare(pub([])));
    for (const key of ['foundation', 'support', 'proposal']) { const bad = structuredClone(set); delete bad[key]; unchanged(() => c.prepare(pub([bad]))); }
    const bad = structuredClone(set); bad.full.status = 'PASSED'; unchanged(() => c.prepare(pub([bad])));
    const privateSet = structuredClone(set); privateSet.packs[0].metadata.visibility = 'PRIVATE'; unchanged(() => c.prepare(pub([privateSet])));
    const foreign = structuredClone(set); foreign.proposal.project.workspaceId = 'foreign'; unchanged(() => c.prepare(pub([foreign])));
    unchanged(() => c.read('semantic.catalog.preview', parameters, { visibility: 'private', projectId: 'other' }));
    mode = 'wrong'; unchanged(() => c.prepare(parameters)); mode = 'promise'; unchanged(() => c.prepare(parameters)); mode = 'valid';
    for (const invalid of ['then', 'verified', 'unknown', 'promise-getter']) { mode = invalid; unchanged(() => c.prepare(parameters)); }
    assert.equal(getterCalls, 0); mode = 'valid';
    const plan = c.prepare(parameters), stale = c.prepare(parameters);
    unchanged(() => c.write('semantic.catalog.publish', { planId: plan.planId }));
    unchanged(() => c.write('catalog.decide', { planId: plan.planId, reviewDigest: sha256('wrong'), decision: 'APPROVE', evidenceRef: 'local:test' }));
    c.decide(plan); c.decide(stale);
    const receipt = c.write('semantic.catalog.publish', { planId: plan.planId });
    assert.equal(receipt.result.generationDigest, preview.generationDigest);
    unchanged(() => c.write('semantic.catalog.publish', { planId: stale.planId }));
    const first = c.read('semantic.catalog.inspect', { catalogId: 'main' }); assert.equal(first.sets.length, 1);
    assert.deepEqual(c.read('semantic.catalog.readback', { requestId: receipt.requestId }), receipt);
    unchanged(() => c.read('semantic.catalog.readback', { requestId: receipt.requestId }, { visibility: 'private', projectId: 'alpha' }));
    // Simulate a dropped response by retaining only the original request identity,
    // closing the database and opening a new service instance.
    service.close(); service = createOntologyService(options, providers); service.initialize();
    const recovery = { requestId: receipt.requestId, intentDigest: receipt.requestDigest };
    const headBefore = c.read('semantic.catalog.inspect', { catalogId: 'main' }).pointer.pointerDigest;
    const reconciled = c.write('semantic.catalog.recover', recovery);
    assert.equal(reconciled.result.status, 'COMMITTED');
    assert.equal(c.read('semantic.catalog.inspect', { catalogId: 'main' }).pointer.pointerDigest, headBefore);
    assert.equal(c.read('semantic.catalog.recovery-readback', recovery).status, 'COMMITTED');
    unchanged(() => c.write('semantic.catalog.recover', { ...recovery, intentDigest: sha256('wrong') }));
    const revoke = { action: 'REVOKE', catalogId: 'main', expectedHead: headBefore, revokedDigests: [set.packs[0].metadata.digest] };
    const revoked = c.publish(revoke);
    assert.equal(c.read('semantic.catalog.inspect', { catalogId: 'main' }).sets.length, 0);
    assert.deepEqual(c.read('semantic.catalog.readback', { requestId: receipt.requestId }), receipt);
    unchanged(() => c.prepare({ action: 'ROLLBACK', catalogId: 'main', expectedHead: revoked.result.pointerDigest, targetPointerDigest: headBefore }));
    unchanged(() => c.prepare({ ...parameters, expectedHead: revoked.result.pointerDigest }));
    unchanged(() => c.prepare({ ...revoke, expectedHead: revoked.result.pointerDigest, revokedDigests: [sha256('unknown')] }));
    assert.equal(c.read('semantic.catalog.recovery-inspect', { catalogId: 'main' }).status, 'CLEAN');
    assert.equal(c.write('semantic.catalog.recover', { requestId: 'never-dispatched', intentDigest: sha256('absent') }).result.status, 'NOT_COMMITTED');
    const db = new DatabaseSync(join(root, 'state/ontology/ontology.db'));
    assert.equal(db.prepare('SELECT count(*) AS n FROM receipts WHERE request_id = ?').get(receipt.requestId).n, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM audit WHERE operation = 'semantic.catalog.publish'").get().n, 1); db.close();
    const blob = join(root, 'public/ontology', sha256(first.material[0][1]).slice(7) + '.json'), original = readFileSync(blob);
    try {
      writeFileSync(blob, '{}');
      assert.throws(() => c.read('semantic.catalog.readback', { requestId: receipt.requestId }), { code: 'CORRUPT_BLOB' });
      const revision = c.read('workspace.inspect').revision;
      assert.throws(() => c.write('semantic.catalog.recover', recovery), { code: 'UNKNOWN', causeCode: 'CORRUPT_BLOB' });
      assert.equal(c.read('workspace.inspect').revision, revision);
    } finally { writeFileSync(blob, original); }
    assert.deepEqual(c.read('semantic.catalog.readback', { requestId: receipt.requestId }), receipt);
  } finally { service.close(); rmSync(parent, { recursive: true, force: true }); }
});

test('complete generations rollback, cumulative revocation, exact plan receipts and private scope', () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'ontology-catalog-'))), root = join(parent, 'workspace');
  const service = createOntologyService({ workspaceRoot: root, workspaceId: 'catalog-test' }, { resolveLegacyHarness: trustedHarness });
  service.initialize(); const c = catalogClient(service, scope);
  const denied = (fn, code) => { const before = c.read('workspace.inspect').revision; assert.throws(fn, { code }); assert.equal(c.read('workspace.inspect').revision, before); };
  try {
    const a = ownedCatalogMaterials(c), b = ownedCatalogMaterials(c, { version: '2.0.0' });
    const prepareA = c.write('catalog.prepare', pub([a])), prepareB = c.write('catalog.prepare', pub([a]));
    assert.equal(prepareA.result.reviewDigest, prepareB.result.reviewDigest);
    assert.notEqual(prepareA.result.planId, prepareB.result.planId);
    const planBlob = join(root, 'public/ontology', sha256(prepareB.result).slice(7) + '.json'), planBytes = readFileSync(planBlob);
    try {
      writeFileSync(planBlob, '{}');
      assert.deepEqual(c.read('semantic.catalog.readback', { requestId: prepareA.requestId }), prepareA);
      denied(() => c.read('semantic.catalog.readback', { requestId: prepareB.requestId }), 'CORRUPT_BLOB');
    } finally { writeFileSync(planBlob, planBytes); }
    const decisionA = c.decide(prepareA.result), decisionB = c.decide(prepareB.result);
    const decidedB = c.read('catalog.plan-inspect', { planId: prepareB.result.planId });
    const decisionBlob = join(root, 'public/ontology', sha256(decidedB).slice(7) + '.json'), decisionBytes = readFileSync(decisionBlob);
    try {
      writeFileSync(decisionBlob, '{}');
      assert.deepEqual(c.read('semantic.catalog.readback', { requestId: decisionA.requestId }), decisionA);
      denied(() => c.read('semantic.catalog.readback', { requestId: decisionB.requestId }), 'CORRUPT_BLOB');
    } finally { writeFileSync(decisionBlob, decisionBytes); }
    c.write('catalog.decide', { planId: decidedB.planId, reviewDigest: decidedB.reviewDigest, decision: 'REJECT', evidenceRef: 'local:later-decision' });
    assert.deepEqual(c.read('semantic.catalog.readback', { requestId: decisionB.requestId }), decisionB);
    const first = c.write('semantic.catalog.publish', { planId: prepareA.result.planId });
    assert.deepEqual(c.read('semantic.catalog.readback', { requestId: prepareA.requestId }), prepareA);
    assert.deepEqual(service.execute({ operation: 'catalog.prepare', scope, input: pub([a]), requestId: prepareB.requestId, expectedRevision: 0 }), prepareB);
    assert.deepEqual(service.execute({ operation: 'catalog.decide', scope, input: { planId: decidedB.planId, reviewDigest: decidedB.reviewDigest, decision: 'APPROVE', evidenceRef: 'local:synthetic-catalog-review' }, requestId: decisionB.requestId, expectedRevision: 0 }), decisionB);
    const second = c.publish({ ...pub([b]), expectedHead: first.result.pointerDigest });
    const rollback = { action: 'ROLLBACK', catalogId: 'main', expectedHead: second.result.pointerDigest, targetPointerDigest: first.result.pointerDigest };
    denied(() => c.prepare({ ...rollback, expectedHead: first.result.pointerDigest }), 'HEAD_CONFLICT');
    denied(() => c.prepare({ ...rollback, targetPointerDigest: sha256('unknown-revision') }), 'NOT_FOUND');
    const rolled = c.publish(rollback);
    assert.deepEqual(c.read('semantic.catalog.inspect', { catalogId: 'main' }).sets, [a]);
    assert.equal(rolled.result.generationDigest, first.result.generationDigest);
    const head = c.read('semantic.catalog.inspect', { catalogId: 'main' });
    const materialBlob = join(root, 'public/ontology', sha256(head.material[0][1]).slice(7) + '.json'), materialBytes = readFileSync(materialBlob);
    try {
      writeFileSync(materialBlob, '{}');
      denied(() => c.read('semantic.catalog.inspect', { catalogId: 'main' }), 'CORRUPT_BLOB');
      assert.throws(() => c.read('semantic.catalog.recovery-inspect', { catalogId: 'main' }), { code: 'UNKNOWN', causeCode: 'CORRUPT_BLOB' });
    } finally { writeFileSync(materialBlob, materialBytes); }
    const revokeA = c.publish({ action: 'REVOKE', catalogId: 'main', expectedHead: rolled.result.pointerDigest, revokedDigests: [a.packs[0].metadata.digest] });
    const republished = c.publish({ ...pub([b]), expectedHead: revokeA.result.pointerDigest });
    const revokeB = c.publish({ action: 'REVOKE', catalogId: 'main', expectedHead: republished.result.pointerDigest, revokedDigests: [b.packs[0].metadata.digest] });
    assert.deepEqual(c.read('semantic.catalog.inspect', { catalogId: 'main' }).generation.revokedDigests, [a.packs[0].metadata.digest, b.packs[0].metadata.digest].sort());
    denied(() => c.prepare({ ...rollback, expectedHead: revokeB.result.pointerDigest }), 'REVOKED');
    for (const set of [a, b]) denied(() => c.prepare({ ...pub([set]), expectedHead: revokeB.result.pointerDigest }), 'REVOKED');
    const privateScope = { visibility: 'private', projectId: 'secret' }, pc = catalogClient(service, privateScope);
    const privateSet = ownedCatalogMaterials(pc, { projectId: 'secret', visibility: 'PRIVATE', version: '3.0.0' });
    const privateReceipt = pc.publish(pub([privateSet]));
    assert.deepEqual(pc.read('semantic.catalog.inspect', { catalogId: 'main' }).sets, [privateSet]);
    assert.deepEqual(pc.read('semantic.catalog.readback', { requestId: privateReceipt.requestId }), privateReceipt);
    for (const selected of [{ visibility: 'public', projectId: 'secret' }, { visibility: 'private', projectId: 'other' }]) {
      denied(() => c.read('semantic.catalog.preview', pub([privateSet]), selected), 'SCOPE_MISMATCH');
      assert.equal(c.read('semantic.catalog.inspect', { catalogId: 'main' }, selected).head, 'EMPTY');
      denied(() => c.read('semantic.catalog.readback', { requestId: privateReceipt.requestId }, selected), 'SCOPE_MISMATCH');
    }
  } finally { service.close(); rmSync(parent, { recursive: true, force: true }); }
});
