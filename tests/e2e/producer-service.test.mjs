import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createOntologyService } from '../../dist/service.js';
import { operateProducer, validateProducerRequest, producerRoutes } from '../../dist/producer-operations.js';
import { validateState } from '../../dist/state.js';
import { operateImport } from '../../dist/import-operations.js';
import { sha256, stableSerialize } from '../../vendor/compatibility/v1/reference.mjs';
import { packs as p, grounding as g, interoperability as s } from '../../src/compat/index.mjs';
import { digest } from '../../src/compat/v3/utils.mjs';

const scope = { visibility: 'public', projectId: 'alpha' };
const binding = id => ({ id, version: '1.0.0', digest: digest(id) });
function fixture() {
  const pack = p.createProfessionalPack({ kind: 'DomainOntologyPack', metadata: { id: 'finance-domain', version: '1.0.0', namespace: 'finance', root: 'DOMAIN_TEAM', visibility: 'DOMAIN', owner: 'finance-team', provenance: { author: 'synthetic' } }, spec: { concepts: [
    { conceptId: 'finance:account', label: 'Account', metaType: 'ENTITY', definition: 'A governed account.', relationships: [{ targetConceptId: 'finance:audit', relationType: 'REQUIRES', evidenceRefs: ['source://relation'] }] },
    { conceptId: 'finance:audit', label: 'Audit', metaType: 'CAPABILITY', definition: 'A governed audit capability.' },
  ] } });
  const project = { id: 'alpha', workspaceId: 'producer-test', tenantId: 'tenant-alpha', sourceSnapshotDigest: digest('source') };
  return { pack, project };
}
function closureFor(snapshot) {
  const profile = s.createOntologyReasoningProfile({ id: 'reasoning', version: '1.0.0', mode: 'OWL_RL' });
  const index = s.buildSemanticIndex({ snapshot });
  const full = s.computeSemanticState({ index, profile });
  const affectedSubgraph = s.calculateAffectedSubgraph({ index, profile, changedConceptIds: ['finance:account'] });
  const incremental = s.computeSemanticState({ index, profile, mode: 'INCREMENTAL', affectedSubgraph });
  const projectionSet = s.createInteroperabilityProjectionSet({ snapshot, profile, index });
  const roundTripReport = s.verifySemanticRoundTrip({ snapshot, projectionSet, index, incremental, full });
  return s.createTerminalSemanticClosure({ snapshot, profile, index, projectionSet, roundTripReport,
    harnessAssets: ['HarnessProfile', 'HarnessComponent', 'HarnessBundle'].map(kind => ({ kind, ...binding(kind.toLowerCase()) })),
    dependencyLocks: [binding('lock')], evaluations: [{ kind: 'Evaluation', ...binding('evaluation') }], rollbackLinks: [binding('rollback')], provenance: { producer: 'synthetic', generatedByDigest: digest('generator') } });
}
function client(execute) {
  let serial = 0;
  const read = (operation, input = {}, selected = scope) => execute({ operation, input, scope: selected });
  const write = (operation, input, selected = scope) => execute({ operation, input, scope: selected, requestId: `producer-${++serial}`, expectedRevision: read('workspace.inspect').revision });
  const prepare = (operation, parameters) => write('producer.prepare', { operation, parameters }).result;
  const decide = (plan, decision = 'APPROVE') => write('producer.decide', { planId: plan.planId, reviewDigest: plan.reviewDigest, decision, humanEvidenceRef: 'local:operator-review' });
  const produce = (operation, parameters) => { const plan = prepare(operation, parameters); decide(plan); return write(operation, { planId: plan.planId }).result; };
  return { read, write, prepare, decide, produce };
}
function sequence(c) {
  const { pack, project } = fixture();
  let lifecycle = c.produce('pack.lifecycle.create', { pack, project, targetRoot: 'DOMAIN_TEAM' }).record;
  assert.equal(lifecycle.document.stage, 'DRAFT');
  for (const action of ['APPLY', 'REQUEST_REVIEW', 'APPROVE', 'PUBLISH']) lifecycle = c.produce('pack.lifecycle.transition', { recordId: lifecycle.recordId, expectedRecordDigest: lifecycle.document.recordDigest, action }).record;
  assert.equal(lifecycle.document.stage, 'PUBLISHED');
  let proposal = c.produce('project-ontology.proposal.create', { project, packs: [pack], targetRoot: 'DOMAIN_TEAM' }).record;
  assert.equal(proposal.document.stage, 'DRAFT');
  const stale = c.prepare('project-ontology.proposal.transition', { recordId: proposal.recordId, expectedProposalDigest: proposal.document.proposalDigest, action: 'APPLY' }); c.decide(stale);
  for (const action of ['APPLY', 'REQUEST_REVIEW', 'APPROVE']) proposal = c.produce('project-ontology.proposal.transition', { recordId: proposal.recordId, expectedProposalDigest: proposal.document.proposalDigest, action }).record;
  assert.throws(() => c.write('project-ontology.proposal.transition', { planId: stale.planId }), { code: 'DEPENDENCY_CHANGED' });
  const params = { recordId: proposal.recordId, expectedProposalDigest: proposal.document.proposalDigest, foundationDigest: g.resolveOntologyFoundation().foundationDigest, version: '1.0.0' };
  const publication = c.produce('project-ontology.artifact.publish', params);
  assert.equal(publication.record.document.spec.snapshot.concepts.length, 2);
  assert.throws(() => c.prepare('project-ontology.artifact.publish', params), { code: 'IMMUTABLE_VERSION' });
  const artifact = publication.record;
  const transitioned = c.produce('project-ontology.artifact.transition', { artifactRecordId: artifact.recordId, expectedArtifactDigest: artifact.document.artifactSetDigest, recordId: publication.lifecycle.recordId, expectedRecordDigest: publication.lifecycle.document.recordDigest, action: 'INSTALL' });
  assert.equal(transitioned.record.document.stage, 'INSTALLED');
  const closure = closureFor(artifact.document.spec.snapshot);
  const result = c.produce('semantic.closure.publish', { closure, artifactRecordId: artifact.recordId, expectedArtifactDigest: artifact.document.artifactSetDigest, version: closure.version });
  assert.equal(result.record.document.status, 'PUBLISHED');
  assert.equal(result.record.document.publication.actor, `uid:${process.getuid()}`);
  assert.equal(closure.status, 'CANDIDATE');
  return { artifact, proposal };
}

function materialRegressions(c, unchanged) {
  const { pack: dependency, project } = fixture();
  const makePack = imports => p.createProfessionalPack({ kind: 'DomainOntologyPack', metadata: { id: 'dependent', version: '1.0.0', namespace: 'dependent', root: 'DOMAIN_TEAM', visibility: 'DOMAIN', owner: 'team', provenance: { author: 'synthetic' } }, spec: { imports, concepts: [{ conceptId: 'dependent:item', label: 'Item', metaType: 'ENTITY', definition: 'An imported account consumer.' }] } });
  const reference = { id: dependency.metadata.id, version: dependency.metadata.version, digest: dependency.metadata.digest };
  const pack = makePack([reference]);
  const parameters = { pack, project, targetRoot: 'DOMAIN_TEAM' };
  unchanged(() => c.prepare('pack.lifecycle.create', parameters));
  unchanged(() => c.prepare('pack.lifecycle.create', { ...parameters, dependencyClosure: { digest: digest('invented') }, conflictPreview: { digest: digest('invented') } }));
  const complete = { ...parameters, availablePacks: [dependency] };
  unchanged(() => c.prepare('pack.lifecycle.create', { ...parameters, availablePacks: null }));
  for (const key of ['dependencyClosure', 'conflictPreview']) unchanged(() => c.prepare('pack.lifecycle.create', { ...complete, [key]: { digest: digest('invented') } }));
  const conflicting = p.createProfessionalPack({ kind: 'DomainOntologyPack', metadata: { id: 'conflicting', version: '1.0.0', namespace: 'dependent', root: 'DOMAIN_TEAM', visibility: 'DOMAIN', owner: 'team', provenance: { author: 'synthetic' } }, spec: { concepts: [{ conceptId: 'dependent:item', label: 'Conflicting item', metaType: 'ENTITY', definition: 'A different concept definition.' }] } });
  unchanged(() => c.prepare('pack.lifecycle.create', { ...complete, availablePacks: [dependency, conflicting] }));
  unchanged(() => c.prepare('pack.lifecycle.create', { ...complete, pack: makePack([{ ...reference, digest: digest('wrong-import') }]) }));
  unchanged(() => c.prepare('pack.lifecycle.create', { ...complete, availablePacks: [dependency, { ...pack, status: { ...pack.status, phase: 'PUBLISHED' } }] }));
  const optional = makePack([{ ...reference, optional: true }]);
  assert.equal(c.prepare('pack.lifecycle.create', { ...parameters, pack: optional }).status, 'PREPARED');
  const resolved = p.resolveProfessionalPackSet({ packs: [pack, dependency], targetRoot: 'DOMAIN_TEAM' });
  const plan = c.prepare('pack.lifecycle.create', { ...complete, availablePacks: [pack, dependency], dependencyClosure: { digest: resolved.packSetDigest }, conflictPreview: { digest: digest(resolved.conflicts) } });
  assert.equal(plan.dependencies[0].material.resolved.packSetDigest, resolved.packSetDigest);
  c.decide(plan);
  let record = c.write('pack.lifecycle.create', { planId: plan.planId }).result.record;
  for (const action of ['APPLY', 'REQUEST_REVIEW', 'APPROVE', 'PUBLISH']) record = c.produce('pack.lifecycle.transition', { recordId: record.recordId, expectedRecordDigest: record.document.recordDigest, action }).record;
  assert.equal(record.document.stage, 'PUBLISHED');
  assert.equal(record.document.dependencyClosureDigest, resolved.packSetDigest);
  assert.deepEqual(record.material.availablePacks, [dependency]);
  assert.ok(record.history.every(h => h.materialDigest === sha256(record.material)));

  let proposal = c.produce('project-ontology.proposal.create', { project, packs: [pack, dependency], targetRoot: 'DOMAIN_TEAM' }).record;
  for (const action of ['APPLY', 'REQUEST_REVIEW', 'APPROVE']) proposal = c.produce('project-ontology.proposal.transition', { recordId: proposal.recordId, expectedProposalDigest: proposal.document.proposalDigest, action }).record;
  const foundation = g.resolveOntologyFoundation();
  const publication = { recordId: proposal.recordId, expectedProposalDigest: proposal.document.proposalDigest, version: '2.0.0', foundationDigest: foundation.foundationDigest };
  unchanged(() => c.prepare('project-ontology.artifact.publish', { ...publication, foundationDigest: digest('unknown-foundation') }));
  for (const bad of [ { ...foundation, foundationDigest: digest('drift') }, { ...foundation, extra: true }, { ...foundation, limits: { ...foundation.limits, extra: true } }, { ...foundation, metaTypes: ['UNKNOWN'] } ]) unchanged(() => c.prepare('project-ontology.artifact.publish', { ...publication, foundation: bad }));
  const explicit = c.produce('project-ontology.artifact.publish', { ...publication, foundation }).record;
  assert.deepEqual(explicit.foundation, foundation);
  assert.deepEqual(explicit.history[0].foundation, foundation);
  assert.equal(explicit.document.spec.snapshot.foundationDigest, foundation.foundationDigest);
  const custom = g.resolveOntologyFoundation({ limits: { maxCandidates: 10 } });
  const customPlan = c.prepare('project-ontology.artifact.publish', { ...publication, version: '3.0.0', foundation: custom, foundationDigest: custom.foundationDigest });
  assert.deepEqual(customPlan.dependencies.at(-1), { foundation: custom, foundationDigest: custom.foundationDigest });
  c.decide(customPlan);
  const customOutput = c.write('project-ontology.artifact.publish', { planId: customPlan.planId }).result.record;
  assert.deepEqual(customOutput.history[0].foundation, custom);
  assert.equal(customOutput.document.spec.snapshot.foundationDigest, custom.foundationDigest);
  return record;
}

test('filesystem-free producer state machine verifies fresh decisions and all compat transitions', () => {
  const blobs = new Map(), state = { assets: [] }, identity = { id: 'producer-test' };
  const store = { uid: process.getuid(), identity, blob(scope, value) { const key = sha256(value); blobs.set(key, stableSerialize(value)); return key; }, verifyBlob(scope, value) { assert.equal(blobs.get(sha256(value)), stableSerialize(value)); } };
  const rawBlobs = new Map();
  store.rawBlob = (scope, raw) => { const key = digest(raw); rawBlobs.set(key, raw); return key; };
  store.verifyRawBlob = (scope, key) => { const raw = rawBlobs.get(key); assert.equal(digest(raw), key); return raw; };
  let revision = 0;
  const c = client(r => {
    if (r.operation === 'workspace.inspect') return { revision };
    const imported = r.operation === 'legacy.import' || r.operation === 'source.inspect';
    if (!imported) validateProducerRequest(r);
    const next = structuredClone(state), result = imported ? operateImport(store, next, r) : operateProducer(store, next, r);
    validateState(next);
    if (r.requestId) { Object.assign(state, next); return structuredClone({ result, revision: ++revision }); }
    return structuredClone(result);
  });
  sequence(c);
  const raw = JSON.stringify({ apiVersion: 'harness.evopilot.io/v1', kind: 'OntologyPack', metadata: { id: 'finance', version: '1.0.0', lifecycle: 'published' }, spec: { concepts: [{ id: 'account', terms: ['Account'] }], roles: [], evidenceKinds: ['document'] } });
  const source = c.write('legacy.import', { raw, format: 'json', sourceLocator: 'inline:synthetic', sourceRevision: 'r1', sourceVisibility: 'public' }).result;
  const plan = c.prepare('ontology.publish', { sourceId: source.sourceId });
  assert.throws(() => c.write('ontology.publish', { planId: plan.planId }), { code: 'APPROVAL_REQUIRED' });
  c.decide(plan, 'REJECT');
  assert.throws(() => c.write('ontology.publish', { planId: plan.planId }), { code: 'APPROVAL_REQUIRED' });
  c.decide(plan);
  const publication = c.write('ontology.publish', { planId: plan.planId }).result.record;
  assert.deepEqual(publication.document, JSON.parse(raw));
  assert.equal(c.read('source.inspect', { sourceId: source.sourceId }).raw, raw);
  assert.equal(publication.history[0].publication.actor, `uid:${process.getuid()}`);
  assert.throws(() => c.prepare('ontology.publish', { sourceId: source.sourceId }), { code: 'IMMUTABLE_VERSION' });
  const before = revision; c.read('producer.list'); assert.equal(revision, before);
  assert.equal(producerRoutes.length, 8);
  const unchanged = fn => { const before = stableSerialize(state), count = blobs.size, prior = revision; assert.throws(fn); assert.equal(stableSerialize(state), before); assert.equal(blobs.size, count); assert.equal(revision, prior); };
  const retained = materialRegressions(c, unchanged);
  const stored = state.producerRecords.find(v => v.recordId === retained.recordId);
  const transition = () => c.prepare('pack.lifecycle.transition', { recordId: retained.recordId, expectedRecordDigest: retained.document.recordDigest, action: 'INSTALL' });
  stored.material = { ...stored.material, availablePacks: [] };
  assert.throws(transition);
  const originalHistory = stored.history;
  stored.materialDigest = store.blob(scope, stored.material);
  stored.history = stored.history.map(h => ({ ...h, material: stored.material, materialDigest: stored.materialDigest }));
  for (const h of stored.history) store.blob(scope, h);
  // Even internally consistent blobs cannot replace the actual required import.
  assert.throws(transition, { code: 'INVALID_MODEL' });
  stored.history = originalHistory;
  delete stored.material; delete stored.materialDigest;
  assert.doesNotThrow(() => c.read('producer.list'));
  assert.throws(transition, { code: 'MATERIAL_REQUIRED' });
});

function setup(t) {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'ontology-producers-'));
  const workspaceRoot = join(parent, 'workspace');
  let service = createOntologyService({ workspaceRoot, workspaceId: 'producer-test' }); service.initialize();
  t.after(() => { service.close(); rmSync(parent, { recursive: true, force: true }); });
  return { workspaceRoot, execute: r => service.execute(r), restart() { service.close(); service = createOntologyService({ workspaceRoot, workspaceId: 'producer-test' }); service.initialize(); } };
}
test('public service producer sequence, immutable source, restart and receipt replay', t => {
  const host = setup(t), c = client(host.execute);
  const raw = JSON.stringify({ apiVersion: 'harness.evopilot.io/v1', kind: 'OntologyPack', metadata: { id: 'finance', version: '1.0.0', lifecycle: 'published' }, spec: { concepts: [{ id: 'account', terms: ['Account'] }], roles: [], evidenceKinds: ['document'] } });
  const source = c.write('legacy.import', { raw, format: 'json', sourceLocator: 'inline:synthetic', sourceRevision: 'r1', sourceVisibility: 'public' }).result;
  const plan = c.prepare('ontology.publish', { sourceId: source.sourceId });
  assert.throws(() => c.write('ontology.publish', { planId: plan.planId }), { code: 'APPROVAL_REQUIRED' });
  c.decide(plan, 'REJECT'); assert.throws(() => c.write('ontology.publish', { planId: plan.planId }), { code: 'APPROVAL_REQUIRED' });
  c.decide(plan);
  const request = { operation: 'ontology.publish', scope, input: { planId: plan.planId }, requestId: 'publication', expectedRevision: c.read('workspace.inspect').revision };
  const receipt = host.execute(request);
  assert.deepEqual(receipt.result.record.document, JSON.parse(raw));
  assert.equal(c.read('source.inspect', { sourceId: source.sourceId }).raw, raw);
  assert.equal(receipt.result.record.history[0].publication.actor, `uid:${process.getuid()}`);
  assert.throws(() => c.prepare('ontology.publish', { sourceId: source.sourceId }), { code: 'IMMUTABLE_VERSION' });
  sequence(c); host.restart();
  assert.deepEqual(host.execute(request), receipt);
  assert.deepEqual(c.read('receipt.inspect', { requestId: request.requestId }), receipt);
  assert.throws(() => c.write('ontology.publish', { planId: plan.planId }), { code: 'PLAN_CONSUMED' });
});

test('public producer negatives preserve SQLite state, receipts and audit', t => {
  const host = setup(t), c = client(host.execute), { pack, project } = fixture();
  const plan = c.prepare('project-ontology.proposal.create', { project, packs: [pack], targetRoot: 'DOMAIN_TEAM' });
  const db = new DatabaseSync(join(host.workspaceRoot, 'state/ontology/ontology.db')); t.after(() => db.close());
  const durable = () => ['state', 'receipts', 'audit'].map(table => db.prepare(`SELECT * FROM ${table}`).all());
  const unchanged = fn => { const before = durable(); assert.throws(fn); assert.deepEqual(durable(), before); };
  unchanged(() => c.write('project-ontology.proposal.create', { planId: plan.planId }));
  unchanged(() => c.write('producer.decide', { planId: plan.planId, reviewDigest: digest('stale'), decision: 'APPROVE', humanEvidenceRef: 'local:review' }));
  unchanged(() => c.write('producer.decide', { planId: plan.planId, reviewDigest: plan.reviewDigest, decision: 'APPROVE', humanEvidenceRef: 'local:review', actor: 'admin' }));
  unchanged(() => c.prepare('project-ontology.proposal.transition', { proposal: { stage: 'APPROVED' }, action: 'APPROVE' }));
  unchanged(() => c.prepare('project-ontology.proposal.create', { project: { ...project, id: 'foreign' }, packs: [pack] }));
  const privatePack = structuredClone(pack); privatePack.metadata.visibility = 'PRIVATE';
  unchanged(() => c.prepare('project-ontology.proposal.create', { project, packs: [privatePack] }));
  unchanged(() => c.prepare('pack.lifecycle.create', { pack: { kind: 'DomainHarnessPack' }, targetRoot: 'DOMAIN_TEAM', dependencyClosure: {}, conflictPreview: {} }));
  for (const selected of [{ ...scope, projectId: 'beta' }, { ...scope, visibility: 'private' }]) {
    unchanged(() => c.write('producer.decide', { planId: plan.planId, reviewDigest: plan.reviewDigest, decision: 'APPROVE', humanEvidenceRef: 'local:review' }, selected));
    assert.deepEqual(c.read('producer.list', {}, selected), []);
  }
  c.decide(plan); unchanged(() => c.write('ontology.publish', { planId: plan.planId }));
  const before = durable(); c.read('producer.inspect', { planId: plan.planId }); c.read('producer.list'); assert.deepEqual(durable(), before);
});

test('public service validates complete producer material before durable writes and retains it across restart', t => {
  const host = setup(t), c = client(host.execute);
  const db = new DatabaseSync(join(host.workspaceRoot, 'state/ontology/ontology.db')); t.after(() => db.close());
  const durable = () => ['state', 'receipts', 'audit'].map(table => db.prepare(`SELECT * FROM ${table}`).all());
  const unchanged = fn => { const before = durable(); assert.throws(fn); assert.deepEqual(durable(), before); };
  const record = materialRegressions(c, unchanged);
  let getterCalls = 0;
  const unsafeFoundation = Object.defineProperty({}, 'limits', { enumerable: true, get() { getterCalls++; return {}; } });
  unchanged(() => c.prepare('project-ontology.artifact.publish', { recordId: digest('proposal'), expectedProposalDigest: digest('proposal'), foundationDigest: digest('foundation'), version: '1.0.0', foundation: unsafeFoundation }));
  assert.equal(getterCalls, 0);
  host.restart();
  const plan = c.prepare('pack.lifecycle.transition', { recordId: record.recordId, expectedRecordDigest: record.document.recordDigest, action: 'INSTALL' });
  c.decide(plan);
  const row = db.prepare('SELECT data FROM state WHERE singleton = 1').get();
  const state = JSON.parse(row.data), retained = state.producerRecords.find(v => v.recordId === record.recordId);
  retained.material.availablePacks = [];
  db.prepare('UPDATE state SET data = ? WHERE singleton = 1').run(stableSerialize(state));
  unchanged(() => c.write('pack.lifecycle.transition', { planId: plan.planId }));
  delete retained.material; delete retained.materialDigest;
  db.prepare('UPDATE state SET data = ? WHERE singleton = 1').run(stableSerialize(state));
  assert.doesNotThrow(() => c.read('producer.list'));
  assert.throws(() => c.write('pack.lifecycle.transition', { planId: plan.planId }), { code: 'MATERIAL_REQUIRED' });
  unchanged(() => c.prepare('pack.lifecycle.transition', { recordId: record.recordId, expectedRecordDigest: record.document.recordDigest, action: 'INSTALL' }));
});
