import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createOntologyService } from '../../dist/service.js';
import { grounding as g, packs as p, projectOntology as o, interoperability as s } from '../../src/compat/index.mjs';
import { digest } from '../../src/compat/v3/utils.mjs';
import { operateLegacyQuery, validateLegacyQuery } from '../../dist/legacy-queries.js';

const scope = { visibility: 'public', projectId: 'alpha' };
const read = (service, operation, input = {}, selected = scope) => service.execute({ operation, scope: selected, input });
const now = '2026-09-17T00:00:00.000Z';
const binding = id => ({ id, version: '1.0.0', digest: digest(id) });
function fixtures() {
  const draft = { kind: 'DomainOntologyPack', metadata: { id: 'finance-domain', version: '1.0.0', namespace: 'finance', root: 'DOMAIN_TEAM', visibility: 'DOMAIN', owner: 'finance-team', provenance: { author: 'author' } }, spec: { concepts: [
    { conceptId: 'finance:account', label: 'Account', metaType: 'ENTITY', definition: 'A governed account.', relationships: [{ targetConceptId: 'finance:audit', relationType: 'REQUIRES', evidenceRefs: ['source://relation'] }] },
    { conceptId: 'finance:audit', label: 'Audit', metaType: 'CAPABILITY', definition: 'A governed audit capability.' },
  ] } };
  const pack = p.createProfessionalPack(draft), foundation = g.resolveOntologyFoundation();
  const project = { id: 'alpha', workspaceId: 'legacy-test', tenantId: 'tenant-alpha', sourceSnapshotDigest: digest('source') };
  const proposalInput = { project, packs: [pack], targetRoot: 'DOMAIN_TEAM', now };
  let proposal = o.createProjectOntologyProposal({ ...proposalInput, createdBy: 'author' });
  for (const [action, actor] of [['APPLY', 'author'], ['REQUEST_REVIEW', 'author'], ['APPROVE', 'reviewer']]) proposal = o.transitionProjectOntologyProposal({ proposal, action, actor, expectedProposalDigest: proposal.proposalDigest, now });
  const resolve = { proposal, expectedProposalDigest: proposal.proposalDigest, foundationDigest: foundation.foundationDigest, now };
  const snapshot = o.resolveProjectOntologySnapshot(resolve);
  const profileInput = { id: 'reasoning', version: '1.0.0', mode: 'OWL_RL' }, profile = s.createOntologyReasoningProfile(profileInput);
  const cache = { id: 'cache', digest: digest('cache'), policyDigest: digest('policy'), entryCount: 2 };
  const index = s.buildSemanticIndex({ snapshot, cache });
  const affectedInput = { index, profile, changedConceptIds: ['finance:account'], cacheDigest: cache.digest };
  const affectedSubgraph = s.calculateAffectedSubgraph(affectedInput);
  const full = s.computeSemanticState({ index, profile });
  const incremental = s.computeSemanticState({ index, profile, mode: 'INCREMENTAL', affectedSubgraph });
  const projectionSet = s.createInteroperabilityProjectionSet({ snapshot, profile, index });
  const roundInput = { snapshot, projectionSet, index, incremental, full }, roundTripReport = s.verifySemanticRoundTrip(roundInput);
  const closureInput = { snapshot, profile, index, projectionSet, roundTripReport, harnessAssets: ['HarnessProfile', 'HarnessComponent', 'HarnessBundle'].map(kind => ({ kind, ...binding(kind.toLowerCase()) })), dependencyLocks: [binding('lock')], evaluations: [{ kind: 'Evaluation', ...binding('evaluation') }], rollbackLinks: [binding('rollback')], provenance: { producer: 'synthetic', generatedByDigest: digest('generator') } };
  const candidateClosure = s.createTerminalSemanticClosure(closureInput);
  const closure = s.publishTerminalSemanticClosure({ closure: candidateClosure, publication: { decision: 'AUTHORIZED', actor: 'historical', authorizationDigest: digest('historical'), version: candidateClosure.version, at: now } });
  const candidatesInput = { sourceConceptHypothesis: { sourceSnapshotDigest: digest('source'), evidenceGraphDigest: digest('graph') }, candidates: [{ label: 'Account', metaType: 'ENTITY', evidenceIds: ['one', 'two'], evidenceFamilies: ['manifest', 'content'] }] };
  const candidateSet = g.createSemanticCandidateSet(candidatesInput);
  const adapterInput = { id: 'adapter', version: '1.0.0', provenance: { author: 'author' } }, adapter = p.createExternalSemanticEvidenceAdapter(adapterInput);
  const rows = [
    ['semantic.foundation.inspect', { limits: { maxCandidates: 32 } }, r => assert.equal(r.limits.maxCandidates, 32)],
    ['semantic.candidates.inspect', candidatesInput, r => assert.equal(r.candidates[0].label, 'Account')],
    ['semantic.grounding.inspect', { candidateSet, concepts: snapshot.concepts }, r => assert.equal(r.results[0].resolvedConceptId, 'finance:account')],
    ['semantic.reasoning-profile.inspect', profileInput, r => assert.equal(r.spec.mode, 'OWL_RL')],
    ['semantic.index.inspect', { snapshot, cache }, r => assert.equal(r.statistics.edgeCount, 1)],
    ['semantic.affected-subgraph.inspect', affectedInput, r => assert.deepEqual(r.affectedConceptIds, ['finance:account', 'finance:audit'])],
    ['semantic.compute.inspect', { index, profile, mode: 'INCREMENTAL', affectedSubgraph }, r => assert.equal(r.status, 'COMPLETED')],
    ['semantic.compute.compare', { incremental, full }, r => assert.equal(r.equivalentAuthoritativeOutcome, true)],
    ['semantic.federation.discover', { roots: [{ id: 'catalog', catalogDigest: digest('catalog'), trustContext: 'reviewed', visibility: 'DOMAIN', permission: 'GRANTED', packs: [{ kind: pack.kind, ...binding('finance-domain'), visibility: 'DOMAIN' }] }], query: { terms: ['finance'] } }, r => assert.equal(r.discoveredPacks[0].id, 'finance-domain')],
    ['semantic.interoperability.inspect', { snapshot, profile, index, unsupportedSemantics: ['OWL:unbounded-cardinality'] }, r => assert.equal(r.projections.find(p => p.format === 'OWL').status, 'NON_APPLICABLE')],
    ['semantic.round-trip.inspect', roundInput, r => assert.equal(r.status, 'PASSED')],
    ['semantic.closure.inspect', closureInput, r => assert.equal(r.status, 'CANDIDATE')],
    ['semantic.closure.slice', { closure, expectedClosureDigest: closure.closureDigest, conceptIds: ['finance:account'] }, r => assert.deepEqual(r.requestedConceptIds, ['finance:account'])],
    ['pack.scaffold.inspect', draft, r => assert.equal(r.spec.concepts.length, 2)],
    ['pack.inspect', { pack }, r => assert.equal(r.lint.status, 'PASSED')],
    ['pack.resolve.inspect', { packs: [pack], targetRoot: 'DOMAIN_TEAM' }, r => assert.equal(r.concepts[0].conceptId, 'finance:account')],
    ['pack.benchmark.inspect', { id: 'benchmark', version: '1.0.0', provenance: { author: 'author' }, cases: [binding('case')], metrics: ['coverage'] }, r => assert.deepEqual(r.metrics, ['coverage'])],
    ['pack.gold-case.inspect', { id: 'gold', version: '1.0.0', source: binding('source'), expectedOutcome: 'RESOLVED', expectedConcepts: ['finance:account'], provenance: { author: 'author' } }, r => assert.deepEqual(r.expectedConcepts, ['finance:account'])],
    ['pack.certification.inspect', { pack, benchmark: binding('benchmark'), algorithm: binding('algorithm'), policy: binding('policy'), toolchain: binding('toolchain'), qualityLevel: 'REVIEWED' }, r => assert.equal(r.qualityLevel, 'REVIEWED')],
    ['semantic.evidence-adapter.inspect', adapterInput, r => assert.equal(r.behavior.networkFetch, false)],
    ['semantic.evidence.import.inspect', { adapter, source: binding('source'), records: [{ contentDigest: digest('content'), observedTerms: ['Account'] }] }, r => assert.deepEqual(r.records[0].observedTerms, ['Account'])],
    ['project-ontology.proposal.inspect', proposalInput, r => { assert.equal(r.stage, 'DRAFT'); assert.equal(r.createdBy, `uid:${process.getuid()}`); }],
    ['project-ontology.snapshot.resolve', resolve, r => assert.equal(r.concepts.length, 2)],
    ['project-ontology.projections.inspect', { snapshot }, r => assert(r.projections.some(p => p.format === 'JSON_LD'))],
    ['project-ontology.skill.inspect', { snapshot, instructions: ['Review account definitions'] }, r => assert.equal(r.spec.conceptIndex[0].conceptId, 'finance:account')],
  ];
  return { rows, pack, snapshot, candidateSet, projectionSet, roundInput };
}

test('query discovery and descriptor-safe rejection require no workspace writes', () => {
  const service = createOntologyService({ workspaceRoot: '/explicit-discovery-only', workspaceId: 'legacy-test' });
  const { rows } = fixtures();
  assert.equal(rows.length, 25);
  for (const [operation, input] of rows) {
    assert(service.capabilities().operations.includes(operation));
    assert.throws(() => read(service, operation, { ...input, arbitraryModule: '../escape' }), { code: 'INVALID_REQUEST' });
  }
  let invoked = false;
  const input = { get limits() { invoked = true; return {}; } };
  assert.throws(() => read(service, 'semantic.foundation.inspect', input)); assert.equal(invoked, false);
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => read(service, 'semantic.foundation.inspect', cycle));
  for (const operation of ['pack.publish', 'transitionPackLifecycle', '../escape']) assert.throws(() => read(service, operation), { code: 'UNSUPPORTED_OPERATION' });
  assert(service.capabilities().operations.includes('semantic.closure.publish'));
  assert.throws(() => read(service, 'semantic.closure.publish'), { code: 'INVALID_REQUEST' });
  service.close();
});

test('pure query routing preserves meaningful calculation results without filesystem state', () => {
  for (const [operation, input, check] of fixtures().rows) {
    const r = { operation, input, scope }, before = structuredClone(input);
    validateLegacyQuery(r);
    check(operateLegacyQuery({ uid: process.getuid(), identity: { id: 'legacy-test' } }, {}, r).result);
    assert.deepEqual(input, before);
  }
});

function setup(t) {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'ontology-queries-'));
  const workspaceRoot = join(parent, 'workspace');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const service = createOntologyService({ workspaceRoot, workspaceId: 'legacy-test' }); service.initialize(); t.after(() => service.close());
  return { service, workspaceRoot };
}
const oldPack = () => ({ apiVersion: 'harness.evopilot.io/v1', kind: 'OntologyPack', metadata: { id: 'finance', version: '1.0.0', lifecycle: 'published' }, spec: { concepts: [{ id: 'account', terms: ['Account'] }], roles: [], evidenceKinds: ['document'] } });
let serial = 0;
function save(service, document, selected = scope) {
  return service.execute({ operation: 'legacy.import', scope: selected, requestId: 'source-' + ++serial, expectedRevision: read(service, 'workspace.inspect').revision, input: { raw: JSON.stringify(document), format: 'json', sourceLocator: 'inline:synthetic', sourceRevision: 'r1', sourceVisibility: selected.visibility } });
}
test('public service executes all 28 queries without changing durable state or inputs', t => {
  const { service, workspaceRoot } = setup(t), { rows } = fixtures();
  const first = save(service, oldPack());
  const changed = oldPack(); changed.spec.concepts[0].terms.push('Ledger account');
  const second = save(service, changed);
  const draftReceipt = service.execute({ operation: 'legacy.derive', scope, requestId: 'derive-existing', expectedRevision: read(service, 'workspace.inspect').revision, input: { sourceId: first.result.sourceId, id: 'derived', version: '1.0.0', visibility: 'public' } });
  const assetBefore = read(service, 'asset.inspect', { id: 'derived', version: '1.0.0' });
  assert.equal(assetBefore.review, null); assert.equal(assetBefore.decision, null); assert.equal(assetBefore.delivery, null);
  const db = new DatabaseSync(join(workspaceRoot, 'state/ontology/ontology.db'));
  t.after(() => db.close());
  const durable = () => ({ state: db.prepare('SELECT * FROM state').all(), receipts: db.prepare('SELECT * FROM receipts ORDER BY request_id').all(), audit: db.prepare('SELECT * FROM audit ORDER BY revision').all() });
  const before = durable();
  rows.push(
    ['ontology.inspect', {}, r => { assert.equal(r.length, 2); assert.equal(r[0].document.kind, 'OntologyPack'); }],
    ['ontology.validate', { sourceId: first.result.sourceId }, r => assert.equal(r.validation.valid, true)],
    ['ontology.diff', { leftSourceId: first.result.sourceId, rightSourceId: second.result.sourceId }, r => assert.deepEqual(r.changes, [{ type: 'ADD', path: '/spec/concepts/0/terms/1', after: 'Ledger account' }])],
  );
  for (const [operation, input, check] of rows) {
    const original = structuredClone(input), answer = read(service, operation, input);
    assert.equal(answer.operation, operation); assert.equal(answer.compatibility, 'evopilot-harness@4.8.2'); assert.equal(answer.previewOnly, true); assert.equal(answer.authority, false);
    check(answer.result); assert.deepEqual(input, original);
    assert.throws(() => service.execute({ operation, scope, input, requestId: 'forbidden', expectedRevision: 2 }));
    assert.throws(() => read(service, operation, { ...input, path: '/etc/passwd' }));
  }
  assert.deepEqual(durable(), before);
  assert.equal(read(service, 'asset.list').length, 1);
  assert.deepEqual(read(service, 'asset.inspect', { id: 'derived', version: '1.0.0' }), assetBefore);
  assert.deepEqual(read(service, 'receipt.inspect', { requestId: draftReceipt.requestId }), draftReceipt);
  assert.deepEqual(read(service, 'receipt.inspect', { requestId: first.requestId }), first);
});

test('scope, private materials, foreign producers, digest drift and semantic blockers fail closed', t => {
  const { service } = setup(t), f = fixtures();
  for (const project of [{ ...f.snapshot.project, id: 'beta' }, { ...f.snapshot.project, workspaceId: 'foreign' }]) {
    assert.throws(() => read(service, 'project-ontology.proposal.inspect', { project, packs: [f.pack] }), { code: 'SCOPE_MISMATCH' });
    assert.throws(() => read(service, 'semantic.index.inspect', { snapshot: { ...f.snapshot, project } }), { code: 'SCOPE_MISMATCH' });
  }
  const privatePack = structuredClone(f.pack); privatePack.metadata.visibility = 'PRIVATE';
  assert.throws(() => read(service, 'pack.inspect', { pack: privatePack }), { code: 'SCOPE_MISMATCH' });
  assert.throws(() => read(service, 'pack.scaffold.inspect', { kind: 'DomainHarnessPack', metadata: {} }), { code: 'UNSUPPORTED_KIND' });
  assert.throws(() => read(service, 'semantic.index.inspect', { snapshot: f.snapshot, assets: [{ kind: 'HarnessProfile', ...binding('foreign'), spec: {} }] }));
  const drifted = structuredClone(f.pack); drifted.spec.concepts[0].label = 'changed';
  assert.throws(() => read(service, 'pack.inspect', { pack: drifted }), { code: 'PACK_DIGEST_INVALID' });
  const ambiguous = read(service, 'semantic.grounding.inspect', { candidateSet: f.candidateSet, concepts: [...f.snapshot.concepts, { ...f.snapshot.concepts[0], conceptId: 'finance:other' }] }).result;
  assert.equal(ambiguous.results[0].outcome, 'AMBIGUOUS_CONCEPT');
  const unsupported = s.createInteroperabilityProjectionSet({ snapshot: f.snapshot, index: f.roundInput.index, profile: s.createOntologyReasoningProfile({ id: 'reasoning', version: '1.0.0', mode: 'OWL_RL' }), unsupportedSemantics: ['OWL:unbounded-cardinality'] });
  assert.equal(read(service, 'semantic.round-trip.inspect', { ...f.roundInput, projectionSet: unsupported }).result.status, 'FAILED');
});

test('stored queries verify scope and bytes; diagnostic diff preserves arrays, null, absence and escaped paths', t => {
  const { service, workspaceRoot } = setup(t);
  const first = save(service, oldPack()).result;
  for (const selected of [{ ...scope, projectId: 'beta' }, { ...scope, visibility: 'private' }]) {
    assert.deepEqual(read(service, 'ontology.inspect', {}, selected).result, []);
    assert.throws(() => read(service, 'ontology.validate', { sourceId: first.sourceId }, selected), { code: 'NOT_FOUND' });
    assert.throws(() => read(service, 'ontology.diff', { leftSourceId: first.sourceId, rightSourceId: first.sourceId }, selected), { code: 'NOT_FOUND' });
  }
  const changed = oldPack(); changed.spec.concepts[0].terms = ['Ledger']; changed.spec['a/b~c'] = null;
  const second = save(service, changed).result;
  assert.throws(() => read(service, 'ontology.validate', { sourceId: second.sourceId }), { code: 'SOURCE_QUARANTINED' });
  const input = { leftSourceId: first.sourceId, rightSourceId: second.sourceId };
  const difference = read(service, 'ontology.diff', input).result;
  assert.equal(difference.status, 'BLOCKED');
  assert(difference.changes.some(c => c.path === '/spec/a~1b~0c' && c.type === 'ADD' && c.after === null && !Object.hasOwn(c, 'before')));
  assert(difference.changes.some(c => c.path === '/spec/concepts/0/terms/0' && c.before === 'Account' && c.after === 'Ledger'));
  assert.deepEqual(read(service, 'ontology.diff', input).result, difference);
  const unknown = save(service, { kind: 'Unsupported' }).result;
  assert.throws(() => read(service, 'ontology.validate', { sourceId: unknown.sourceId }), { code: 'UNSUPPORTED_KIND' });
  writeFileSync(join(workspaceRoot, 'public/ontology/sources', first.rawDigest.slice(7) + '.raw'), 'changed bytes');
  for (const [operation, input] of [['ontology.inspect', {}], ['ontology.validate', { sourceId: first.sourceId }], ['ontology.diff', { leftSourceId: first.sourceId, rightSourceId: second.sourceId }]]) assert.throws(() => read(service, operation, input), { code: 'CORRUPT_BLOB' });
});
