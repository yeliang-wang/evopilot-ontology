import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createOntologyService } from '../../src/service.mjs';
import { listPublicSources, readPublicSource } from '../../src/asset-sources.mjs';

const scope = { visibility: 'public', projectId: 'alpha' };
const privateScope = { visibility: 'private', projectId: 'alpha' };
const otherScope = { visibility: 'public', projectId: 'beta' };
const read = (s, operation, input = {}, selected = scope) => s.execute({ operation, input, scope: selected });
let serial = 0;
const write = (s, operation, input, selected = scope, extra = {}) => s.execute({ operation, input, scope: selected, requestId: 'import-' + ++serial, expectedRevision: read(s, 'workspace.inspect', {}, selected).revision, ...extra });
const inline = (raw, extra = {}) => ({ raw, format: 'json', sourceLocator: 'inline:retained', sourceRevision: 'r1', sourceVisibility: 'public', ...extra });
function setup(t) {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'ontology-import-'));
  const options = { workspaceRoot: join(parent, 'workspace'), workspaceId: 'import-test' };
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const service = createOntologyService(options); service.initialize(); t.after(() => service.close());
  return { service, options };
}

test('all four packaged originals persist exact bytes, origin and scoped receipts across restart', t => {
  const { service, options } = setup(t);
  const listed = listPublicSources().sources;
  assert.equal(listed.length, 4);
  const installed = listed.map((entry, i) => {
    const original = readPublicSource(entry.sourcePath);
    const request = { operation: 'source.install', scope, input: { sourcePath: entry.sourcePath }, requestId: 'bundled-' + i, expectedRevision: i };
    const receipt = service.execute(request), record = receipt.result;
    assert.deepEqual(service.execute({ ...request, expectedRevision: 999 }), receipt);
    assert.equal(record.rawDigest, 'sha256:' + original.sha256);
    assert.equal(record.sourceLocator, entry.sourcePath);
    assert.equal(record.sourceRevision, original.sourceCommit);
    assert.equal(record.observed.version, original.observed.version);
    assert.deepEqual(readFileSync(join(options.workspaceRoot, 'public/ontology/sources', original.sha256 + '.raw')), Buffer.from(original.raw));
    assert.equal(read(service, 'source.inspect', { sourceId: record.sourceId }).raw, original.raw);
    return { request, receipt, original };
  });
  assert.throws(() => service.execute({ ...installed[0].request, requestId: 'stale' }), { code: 'REVISION_CONFLICT' });
  assert.throws(() => service.execute({ ...installed[0].request, input: installed[1].request.input }), { code: 'REQUEST_CONFLICT' });
  service.close();
  const reopened = createOntologyService(options); reopened.initialize(); t.after(() => reopened.close());
  for (const { request, receipt, original } of installed) {
    assert.deepEqual(reopened.execute(request), receipt);
    assert.deepEqual(read(reopened, 'receipt.inspect', { requestId: request.requestId }), receipt);
    assert.equal(read(reopened, 'source.inspect', { sourceId: receipt.result.sourceId }).raw, original.raw);
  }
});

test('same observed identity preserves distinct raw variants and explicit origin/scope keys', t => {
  const { service } = setup(t);
  const original = readPublicSource(listPublicSources().sources[0].sourcePath);
  const input = inline(original.raw, { format: 'yaml' });
  const a = write(service, 'legacy.import', input).result;
  const b = write(service, 'legacy.import', { ...input, raw: original.raw + '\n# retained variant\n' }).result;
  assert.equal(a.observed.id, b.observed.id); assert.equal(a.observed.version, b.observed.version);
  assert.notEqual(a.sourceId, b.sourceId); assert.notEqual(a.rawDigest, b.rawDigest);
  const c = write(service, 'legacy.import', { ...input, sourceRevision: 'r2' }).result;
  assert.notEqual(a.sourceId, c.sourceId); assert.equal(a.rawDigest, c.rawDigest);
  assert.deepEqual(read(service, 'source.list', {}, otherScope), []);
  assert.throws(() => read(service, 'source.inspect', { sourceId: a.sourceId }, otherScope), { code: 'NOT_FOUND' });
  assert.throws(() => read(service, 'source.inspect', { sourceId: a.sourceId }, privateScope), { code: 'NOT_FOUND' });
  const privateSource = write(service, 'source.install', { sourcePath: original.sourcePath }, privateScope).result;
  assert.notEqual(privateSource.sourceId, a.sourceId);
  assert.equal(privateSource.sourceVisibility, 'public');
  const secret = write(service, 'legacy.import', { ...input, sourceVisibility: 'private' }, privateScope).result;
  assert.throws(() => write(service, 'legacy.import', { ...input, sourceVisibility: 'private' }), { code: 'SCOPE_MISMATCH' });
  assert.throws(() => write(service, 'legacy.derive', { sourceId: secret.sourceId, id: 'new', version: '1.0.0', visibility: 'public' }, privateScope), { code: 'SCOPE_MISMATCH' });
  assert.throws(() => write(service, 'legacy.derive', { sourceId: secret.sourceId, id: 'new', version: '1.0.0', visibility: 'public' }), { code: 'NOT_FOUND' });
});

test('unknown and structurally invalid documents quarantine without invented versions or activation', t => {
  const { service, options } = setup(t);
  for (const raw of [' {"schema":"unknown/v9","id":"unknown"}\n', '{"kind":"OntologyPack","metadata":{"id":"broken"},"spec":{}}', 'null']) {
    const saved = write(service, 'legacy.import', inline(raw)).result;
    assert.equal(saved.status, 'QUARANTINED'); assert.equal(saved.observed.version, null);
    assert.equal(saved.inspection.valid, false);
    assert.equal(read(service, 'source.inspect', { sourceId: saved.sourceId }).raw, raw);
    assert.throws(() => write(service, 'legacy.derive', { sourceId: saved.sourceId, id: 'draft', version: '1.0.0', visibility: 'public' }), { code: 'SOURCE_QUARANTINED' });
  }
  assert.deepEqual(read(service, 'asset.list'), []);
  service.close();
  const reopened = createOntologyService(options); reopened.initialize(); t.after(() => reopened.close());
  assert.equal(read(reopened, 'source.list').length, 3);
});

test('derivation retains coverage, required gaps and origin, and never adopts old approval or overwrites', t => {
  const { service } = setup(t);
  const source = write(service, 'source.install', { sourcePath: listPublicSources().sources[0].sourcePath }).result;
  assert.equal(source.observed.lifecycle, 'published');
  const input = { sourceId: source.sourceId, id: 'derived', version: '1.0.0', visibility: 'public' };
  const receipt = write(service, 'legacy.derive', input), result = receipt.result;
  assert.equal(result.validation.valid, true); assert.equal(result.validation.status, 'PENDING');
  assert(result.coverage.gaps.length > 0); assert(result.unresolvedIssues.some(i => i.required));
  const key = { id: input.id, version: input.version }, draft = read(service, 'asset.inspect', key);
  assert.equal(draft.review, null); assert.equal(draft.decision, null); assert.equal(draft.delivery, null);
  assert(draft.model.provenance.sources.every(s => s.revision === source.sourceRevision && s.locator.startsWith(source.sourceLocator + '#') && s.digest === source.documentDigest));
  assert.throws(() => write(service, 'legacy.derive', input), { code: 'ASSET_EXISTS' });
  assert.throws(() => write(service, 'asset.publish', key), { code: 'REVIEW_REQUIRED' });
  const review = write(service, 'asset.review', key).result;
  write(service, 'asset.decide', { ...key, reviewDigest: review.reviewDigest, decision: 'APPROVE', humanEvidenceRef: 'operator:new-review' });
  assert.throws(() => write(service, 'asset.publish', key), { code: 'PENDING_MODEL' });
});

test('malformed/unsafe inputs and arbitrary filesystem keys fail without receipts or caller mutation', t => {
  const { service } = setup(t);
  const badInputs = [inline('{'), inline('\ud800'), inline('x'.repeat(600000)), inline('a: 1\na: 2', { format: 'yaml' }), inline('a: !custom value', { format: 'yaml' }), inline('a: .inf', { format: 'yaml' }), inline('a: &a [*a]', { format: 'yaml' })];
  for (const [i, input] of badInputs.entries()) {
    const original = structuredClone(input), requestId = 'bad-' + i;
    const revision = read(service, 'workspace.inspect').revision;
    assert.throws(() => write(service, 'legacy.import', input, scope, { requestId }));
    assert.deepEqual(input, original); assert.equal(read(service, 'workspace.inspect').revision, revision);
    assert.throws(() => read(service, 'receipt.inspect', { requestId }), { code: 'NOT_FOUND' });
  }
  for (const sourcePath of ['/etc/passwd', '../ontology/builtin/software-engineering.yaml', 'harness/source.yaml']) assert.throws(() => write(service, 'source.install', { sourcePath }), { code: 'UNKNOWN_SOURCE' });
  assert.throws(() => write(service, 'legacy.import', { ...inline('{}'), path: '/etc/passwd' }));
  assert.deepEqual(read(service, 'source.list'), []);
});

test('materialization failure preserves caller raw and transaction; referenced bytes verified after restart', t => {
  const { service, options } = setup(t);
  const raw = '{"schema":"unknown","retained":true}\n', input = inline(raw);
  const digest = createHash('sha256').update(raw).digest('hex');
  const directory = join(options.workspaceRoot, 'public/ontology/sources'); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, digest + '.raw'); writeFileSync(target, 'wrong bytes', { mode: 0o600 });
  assert.throws(() => write(service, 'legacy.import', input, scope, { requestId: 'failed-raw' }), { code: 'CORRUPT_BLOB' });
  assert.equal(input.raw, raw); assert.equal(read(service, 'workspace.inspect').revision, 0);
  assert.deepEqual(read(service, 'source.list'), []);
  assert.throws(() => read(service, 'receipt.inspect', { requestId: 'failed-raw' }), { code: 'NOT_FOUND' });
  rmSync(target);
  const source = write(service, 'legacy.import', input).result;
  service.close(); writeFileSync(target, 'corrupted', { mode: 0o600 });
  const reopened = createOntologyService(options); reopened.initialize(); t.after(() => reopened.close());
  assert.throws(() => read(reopened, 'source.inspect', { sourceId: source.sourceId }), { code: 'CORRUPT_BLOB' });
});

test('assets-only v1 state adopts sources lazily; invalid source collection rejects', t => {
  const { service, options } = setup(t);
  assert.deepEqual(read(service, 'source.list'), []);
  service.close();
  const path = join(options.workspaceRoot, 'state/ontology/ontology.db');
  const db = new DatabaseSync(path);
  assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM state').get().data), { assets: [] });
  db.prepare('UPDATE state SET data = ?').run('{"assets":[],"sources":{}}'); db.close();
  const invalid = createOntologyService(options); t.after(() => invalid.close());
  assert.throws(() => invalid.initialize(), { code: 'CORRUPT_STATE' });
});

test('failure after raw materialization rolls back source, receipt and revision together', t => {
  const { service, options } = setup(t);
  const path = join(options.workspaceRoot, 'state/ontology/ontology.db');
  const db = new DatabaseSync(path);
  db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END");
  const input = inline('{"unknown":"retained after transaction failure"}');
  assert.throws(() => write(service, 'legacy.import', input, scope, { requestId: 'rolled-back' }));
  assert.equal(input.raw, '{"unknown":"retained after transaction failure"}');
  assert.equal(read(service, 'workspace.inspect').revision, 0);
  assert.deepEqual(read(service, 'source.list'), []);
  assert.throws(() => read(service, 'receipt.inspect', { requestId: 'rolled-back' }), { code: 'NOT_FOUND' });
  assert.equal(db.prepare('SELECT count(*) AS n FROM audit').get().n, 0);
  db.exec('DROP TRIGGER reject_receipt'); db.close();
  const saved = write(service, 'legacy.import', input).result;
  assert.equal(read(service, 'source.inspect', { sourceId: saved.sourceId }).raw, input.raw);
});
