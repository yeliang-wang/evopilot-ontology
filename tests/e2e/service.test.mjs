import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, readFileSync, existsSync, mkdirSync, writeFileSync, symlinkSync, rmSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createOntologyService } from '../../dist/service.js';
import { sha256, stableSerialize } from '../../vendor/compatibility/v1/reference.mjs';

const fixtures = JSON.parse(readFileSync(new URL('../../examples/synthetic-models.json', import.meta.url)));
const scope = { visibility: 'public', projectId: 'alpha' };
const clone = value => JSON.parse(JSON.stringify(value));
function setup(t) {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'ontology-service-'));
  const options = { workspaceRoot: join(parent, 'workspace'), workspaceId: 'test' };
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const service = createOntologyService(options); t.after(() => service.close());
  return { parent, options, service };
}
const read = (s, operation, input = {}, selected = scope) => s.execute({ operation, input, scope: selected });
let serial = 0;
function write(s, operation, input, selected = scope, extra = {}) {
  return s.execute({ operation, input, scope: selected, requestId: 'request-' + ++serial, expectedRevision: read(s, 'workspace.inspect', {}, selected).revision, ...extra });
}
function approve(s, model, selected = scope) {
  const input = { id: model.id, version: model.version };
  const review = write(s, 'asset.review', input, selected);
  write(s, 'asset.decide', { ...input, reviewDigest: review.result.reviewDigest, decision: 'APPROVE', humanEvidenceRef: 'human:test-review' }, selected);
  return input;
}
function worker(options, request, killBeforeCommit = false) {
  const child = fork(new URL('../fixtures/service-worker.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const response = Promise.race([
    once(child, 'message').then(([message]) => message),
    once(child, 'exit').then(([code]) => { throw Error('Worker exited before response: ' + code); }),
  ]);
  child.send({ options, request, killBeforeCommit });
  return { child, response };
}

test('discovery/construction pure; explicit identity, restart and closed API', t => {
  const { service, options } = setup(t);
  assert(service.capabilities().operations.includes('asset.publish'));
  assert.equal(existsSync(options.workspaceRoot), false);
  assert.throws(() => read(service, 'workspace.inspect'), { code: 'NOT_INITIALIZED' });
  service.initialize();
  assert.deepEqual(JSON.parse(readFileSync(join(options.workspaceRoot, 'workspace.json'))), { schema: 'evopilot-workspace/v1', id: 'test', canonicalRoot: options.workspaceRoot, ownerUid: process.getuid() });
  assert.deepEqual(readdirSync(options.workspaceRoot).sort(), ['state', 'workspace.json']);
  service.close(); assert.throws(() => service.initialize(), { code: 'CLOSED' });
  const reopened = createOntologyService(options); reopened.initialize();
  assert.equal(read(reopened, 'workspace.inspect').revision, 0); reopened.close();
});

test('forward/reverse models publish with separate exact review and human decision', t => {
  const { service } = setup(t); service.initialize();
  assert.deepEqual(new Set(fixtures.assets.map(a => a.provenance.direction)), new Set(['forward', 'reverse']));
  for (const model of fixtures.assets) {
    const selected = { ...scope, visibility: model.visibility };
    write(service, 'asset.put', { model }, selected);
    const input = approve(service, model, selected);
    const receipt = write(service, 'asset.publish', input, selected);
    assert.equal(receipt.result.delivery.model.id, model.id);
    assert.equal(receipt.uid, process.getuid());
    assert.throws(() => write(service, 'asset.put', { model }, selected), { code: 'IMMUTABLE_VERSION' });
  }
});

test('PENDING, drift, wrong decisions, invalid model and failed rollback', t => {
  const { service } = setup(t); service.initialize();
  const model = clone(fixtures.assets[0]);
  model.unresolvedIssues.push({ id: 'pending', description: 'Need evidence', targetRef: model.concepts[0].id, required: true });
  write(service, 'asset.put', { model });
  const input = approve(service, model);
  const revision = read(service, 'workspace.inspect').revision;
  assert.throws(() => write(service, 'asset.publish', input, scope, { requestId: 'failed' }), { code: 'PENDING_MODEL' });
  assert.equal(read(service, 'workspace.inspect').revision, revision);
  assert.throws(() => read(service, 'receipt.inspect', { requestId: 'failed' }), { code: 'NOT_FOUND' });
  const review = write(service, 'asset.review', input).result;
  model.unresolvedIssues = []; model.concepts[0].label += ' changed';
  write(service, 'asset.put', { model });
  assert.throws(() => write(service, 'asset.decide', { ...input, reviewDigest: review.reviewDigest, decision: 'APPROVE', humanEvidenceRef: 'human:test' }), { code: 'REVIEW_REQUIRED' });
  assert.throws(() => write(service, 'asset.publish', input), { code: 'REVIEW_REQUIRED' });
  const current = write(service, 'asset.review', input).result;
  write(service, 'asset.decide', { ...input, reviewDigest: current.reviewDigest, decision: 'REJECT', humanEvidenceRef: 'human:test' });
  assert.throws(() => write(service, 'asset.publish', input), { code: 'APPROVAL_REQUIRED' });
  assert.throws(() => write(service, 'asset.put', { model: { ...model, extra: true } }), { code: 'INVALID_MODEL' });
});

test('scope isolation, exact idempotency, stale revision, closed bounded JSON', t => {
  const { service } = setup(t); service.initialize();
  const model = fixtures.assets[0];
  const request = { operation: 'asset.put', input: { model }, scope, requestId: 'same', expectedRevision: 0 };
  const receipt = service.execute(request);
  assert.deepEqual(service.execute({ ...request, expectedRevision: 999 }), receipt);
  assert.throws(() => service.execute({ ...request, input: { model: { ...model, id: 'changed' } } }), { code: 'REQUEST_CONFLICT' });
  assert.throws(() => service.execute({ ...request, requestId: 'new' }), { code: 'REVISION_CONFLICT' });
  for (const selected of [{ ...scope, projectId: 'beta' }, { ...scope, visibility: 'private' }]) {
    assert.deepEqual(read(service, 'asset.list', {}, selected), []);
    assert.throws(() => read(service, 'receipt.inspect', { requestId: 'same' }, selected), { code: 'NOT_FOUND' });
    assert.throws(() => read(service, 'asset.inspect', { id: model.id, version: model.version }, selected), { code: 'NOT_FOUND' });
  }
  let accessed = false;
  const bad = Object.defineProperty({}, 'operation', { enumerable: true, get() { accessed = true; } });
  assert.throws(() => service.execute(bad)); assert.equal(accessed, false);
  assert.throws(() => service.execute({ ...request, actor: 0 }));
  assert.throws(() => service.execute({ ...request, input: { model: 'a'.repeat(600000) } }), { code: 'LIMIT' });
  assert.throws(() => service.execute({ ...request, expectedRevision: Infinity }));
});

test('review subject binds both workspace identity fields and project scope', t => {
  const first = setup(t), second = setup(t);
  first.service.initialize(); second.service.initialize();
  const model = fixtures.assets[0], input = { id: model.id, version: model.version };
  const beta = { ...scope, projectId: 'beta' };
  const reviews = [];
  for (const [service, selected] of [[first.service, scope], [first.service, beta], [second.service, scope]]) {
    write(service, 'asset.put', { model }, selected);
    reviews.push(write(service, 'asset.review', input, selected).result);
  }
  assert.equal(new Set(reviews.map(r => r.reviewDigest)).size, 3);
  assert.equal(reviews[0].workspace.id, first.options.workspaceId);
  assert.equal(reviews[0].workspace.canonicalRoot, first.options.workspaceRoot);
  for (const [service, selected] of [[first.service, beta], [second.service, scope]]) {
    assert.throws(() => write(service, 'asset.decide', { ...input, reviewDigest: reviews[0].reviewDigest, decision: 'APPROVE', humanEvidenceRef: 'human:test' }, selected), { code: 'REVIEW_MISMATCH' });
  }
});

test('dependency pins require published own exact Ontology delivery', t => {
  const { service } = setup(t); service.initialize();
  const base = clone(fixtures.assets[0]); write(service, 'asset.put', { model: base });
  const published = write(service, 'asset.publish', approve(service, base)).result.reference;
  const dependent = { ...clone(base), id: 'dependent', dependencies: [published] };
  write(service, 'asset.put', { model: dependent });
  write(service, 'asset.publish', approve(service, dependent));
  for (const ref of [{ ...published, digest: 'sha256:' + '0'.repeat(64) }, { ...published, product: 'harness' }, { ...published, version: '99.0.0' }]) {
    const model = { ...clone(base), id: 'bad-dependency', dependencies: [ref] };
    write(service, 'asset.put', { model });
    assert.throws(() => write(service, 'asset.publish', approve(service, model)), { code: 'UNSUPPORTED_DEPENDENCY' });
  }
  const foreign = { ...scope, projectId: 'beta' };
  write(service, 'asset.put', { model: dependent }, foreign);
  assert.throws(() => write(service, 'asset.publish', approve(service, dependent, foreign), foreign), { code: 'UNSUPPORTED_DEPENDENCY' });
});

test('real competing writers, committed restart, killed transaction rolls back state/receipt/audit', { timeout: 20000 }, async t => {
  const { service, options } = setup(t); service.initialize(); service.close();
  const request = { operation: 'asset.put', input: { model: fixtures.assets[0] }, scope, requestId: 'writer-a', expectedRevision: 0 };
  const a = worker(options, request), b = worker(options, { ...request, requestId: 'writer-b' });
  t.after(() => { a.child.kill(); b.child.kill(); });
  const replies = await Promise.all([a.response, b.response]);
  assert.equal(replies.filter(r => r.result).length, 1);
  assert.equal(replies.find(r => r.error).error, 'REVISION_CONFLICT');
  const killed = worker(options, { ...request, requestId: 'killed', expectedRevision: 1, input: { model: { ...fixtures.assets[0], id: 'uncommitted' } } }, true);
  t.after(() => killed.child.kill());
  assert.equal((await killed.response).precommit, true);
  const exit = once(killed.child, 'exit'); killed.child.kill('SIGKILL'); await exit;
  const reopened = createOntologyService(options); t.after(() => reopened.close()); reopened.initialize();
  assert.equal(read(reopened, 'workspace.inspect').revision, 1);
  assert.equal(read(reopened, 'asset.list').length, 1);
  assert.throws(() => read(reopened, 'receipt.inspect', { requestId: 'killed' }), { code: 'NOT_FOUND' });
  assert.deepEqual(read(reopened, 'receipt.inspect', { requestId: replies.find(r => r.result).result.requestId }), replies.find(r => r.result).result);
  const db = new DatabaseSync(join(options.workspaceRoot, 'state/ontology/ontology.db'), { readOnly: true });
  assert.equal(db.prepare('SELECT count(*) AS n FROM audit').get().n, 1);
  assert.throws(() => db.exec('DELETE FROM audit')); db.close();
});

test('unknown/identity/symlink workspaces and corrupt database reject without recreation', t => {
  const { parent, options, service } = setup(t);
  mkdirSync(options.workspaceRoot, { mode: 0o700 });
  writeFileSync(join(options.workspaceRoot, 'unknown'), 'retained');
  assert.throws(() => service.initialize(), { code: 'UNKNOWN_WORKSPACE' });
  assert.deepEqual(readdirSync(options.workspaceRoot), ['unknown']);
  const safe = { ...options, workspaceRoot: join(parent, 'safe') };
  const initialized = createOntologyService(safe); initialized.initialize(); initialized.close();
  assert.throws(() => createOntologyService({ ...safe, workspaceId: 'wrong' }).initialize(), { code: 'IDENTITY_MISMATCH' });
  symlinkSync(safe.workspaceRoot, join(parent, 'link'));
  assert.throws(() => createOntologyService({ ...safe, workspaceRoot: join(parent, 'link') }).initialize(), { code: 'UNSAFE_WORKSPACE' });
  const db = join(safe.workspaceRoot, 'state/ontology/ontology.db');
  writeFileSync(db, 'corrupt');
  assert.throws(() => createOntologyService(safe).initialize(), { code: 'CORRUPT_STATE' });
  assert.equal(readFileSync(db, 'utf8'), 'corrupt');
  const identity = join(safe.workspaceRoot, 'workspace.json');
  writeFileSync(identity, JSON.stringify({ schema: 'evopilot-workspace/v1', id: 'test', canonicalRoot: safe.workspaceRoot, ownerUid: process.getuid() + 1 }));
  assert.throws(() => createOntologyService(safe).initialize(), { code: 'IDENTITY_MISMATCH' });
  writeFileSync(identity, '{');
  assert.throws(() => createOntologyService(safe).initialize(), { code: 'IDENTITY_MISMATCH' });
});

test('linked sidecars and mismatched immutable blob bytes cannot be adopted', t => {
  const { service, options, parent } = setup(t); service.initialize();
  const model = fixtures.assets[0]; write(service, 'asset.put', { model });
  const blob = join(options.workspaceRoot, 'public/ontology', sha256(model).slice(7) + '.json');
  writeFileSync(blob, stableSerialize({ tampered: true }));
  assert.throws(() => write(service, 'asset.review', { id: model.id, version: model.version }), { code: 'CORRUPT_BLOB' });
  assert.throws(() => write(service, 'asset.put', { model }), { code: 'CORRUPT_BLOB' });
  service.close();
  const target = join(parent, 'sidecar'); writeFileSync(target, 'retained', { mode: 0o600 });
  const sidecar = join(options.workspaceRoot, 'state/ontology/ontology.db-wal');
  rmSync(sidecar, { force: true }); symlinkSync(target, sidecar);
  assert.throws(() => createOntologyService(options).initialize(), { code: 'UNSAFE_WORKSPACE' });
  assert.equal(readFileSync(target, 'utf8'), 'retained');
});
