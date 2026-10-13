import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { operations } from '../../dist/native-operations.js';
import { LIMITS } from '../../dist/state.js';
import { main } from '../../dist/cli.js';
import { taxonomy } from '../fixtures/classification-service.mjs';

const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const scope = { visibility: 'public', projectId: 'alpha' };
const asset = JSON.parse(readFileSync(new URL('../../examples/synthetic-models.json', import.meta.url))).assets[0];
const read = (operation, input = {}, selected = scope) => ({ operation, scope: selected, input });
const put = { ...read('asset.put', { model: asset }), requestId: 'first', expectedRevision: 0 };
function invoke(args, input = '', status = 0, flags = []) {
  const child = spawnSync(process.execPath, [...flags, cli, ...args], {
    input: typeof input === 'string' || Buffer.isBuffer(input) ? input : JSON.stringify(input),
    encoding: 'utf8', maxBuffer: 4 * LIMITS.requestBytes,
    env: { ...process.env, NODE_OPTIONS: '', OPENSSL_CONF: '/dev/null' },
  });
  assert.ifError(child.error);
  assert.equal(child.status, status, child.stderr + child.stdout);
  const envelope = JSON.parse(child.stdout);
  assert.equal(envelope.ok, status === 0);
  assert.equal(envelope.authority, false);
  assert.deepEqual(Object.keys(envelope).sort(), (status === 0 ? ['ok', 'product', 'version', 'result', 'authority'] : ['ok', 'error', 'authority']).sort());
  if (status === 0) { assert.equal(envelope.product, 'ontology'); assert.equal(envelope.version, '0.2.0'); }
  return status === 0 ? envelope.result : envelope.error;
}
function setup(t) {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'ontology-cli-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const workspace = join(parent, 'workspace');
  const args = ['request', '--workspace', workspace, '--workspace-id', 'cli-test'];
  return { parent, workspace, args, request: (value, status = 0) => invoke(args, value, status) };
}

test('CLI discovery/help/version run without write permission or workspace', () => {
  const flags = ['--permission', '--allow-fs-read=' + root];
  const capabilities = invoke(['capabilities'], '', 0, flags);
  assert.deepEqual(capabilities.operations, operations);
  assert.equal(capabilities.providers.resolveClassificationSource, false);
  assert(capabilities.pending.includes('M3 trusted provider wiring'));
  for (const command of ['help', '--help', 'version', '--version']) invoke([command], '', 0, flags);
  for (const args of [[], ['unknown'], ['help', 'extra'], ['capabilities', '--workspace', '/unused'], ['request'], ['request', '--workspace', 'relative', '--workspace-id', 'test']]) {
    assert.equal(invoke(args, '', 2, flags).code, 'USAGE');
  }
});

test('CLI rejects malformed/bounded input and strict flags before initialization', () => {
  const workspace = join(root, 'invalid-input-must-not-create');
  const args = ['request', '--workspace', workspace, '--workspace-id', 'cli-test'];
  const deep = JSON.parse('['.repeat(LIMITS.depth + 1) + '0' + ']'.repeat(LIMITS.depth + 1));
  for (const value of ['{secret-value', '{}{}', 'null', '{}', deep, Array(LIMITS.nodes + 1).fill(0), ' '.repeat(LIMITS.requestBytes + 1), Buffer.from([0xff]), { ...read('workspace.inspect'), scope: { visibility: 'unknown', projectId: 'alpha' } }, read('shell.execute'), { ...put, providers: {} }, { ...put, input: { model: asset, extra: true } }]) {
    const error = invoke(args, value, 2);
    assert(!JSON.stringify(error).includes('secret-value'));
    assert.equal(existsSync(workspace), false);
  }
  for (const suffix of [['--unknown', 'value'], ['--workspace-id', 'duplicate'], ['--request-file'], ['extra'], ['--request-file', 'relative.json']]) {
    assert.equal(invoke([...args, ...suffix], put, 2).code, 'USAGE');
    assert.equal(existsSync(workspace), false);
  }
});

test('CLI stdin persists one asset/receipt across processes; CAS and idempotency stay exact', t => {
  const { request } = setup(t);
  const receipt = request(put);
  assert.equal(receipt.revision, 1);
  assert.deepEqual(request({ ...put, expectedRevision: 999 }), receipt);
  assert.equal(request({ ...put, requestId: 'stale' }, 1).code, 'REVISION_CONFLICT');
  assert.equal(request({ ...put, input: { model: { ...asset, id: 'changed' } } }, 1).code, 'REQUEST_CONFLICT');
  assert.deepEqual(request(read('receipt.inspect', { requestId: 'first' })), receipt);
  const inspection = request(read('workspace.inspect'));
  assert.equal(inspection.revision, 1); assert.equal(inspection.assetCount, 1);
  const saved = request(read('asset.inspect', { id: asset.id, version: asset.version }));
  assert.equal(saved.review, null); assert.equal(saved.decision, null); assert.equal(saved.delivery, null);
  assert.equal(request(read('asset.list')).length, 1);
  assert.equal(request(read('receipt.inspect', { requestId: 'first' }, { ...scope, projectId: 'other' }), 1).code, 'NOT_FOUND');
  assert.equal(request({ ...read('asset.publish', { id: asset.id, version: asset.version }), requestId: 'publish', expectedRevision: 1 }, 1).code, 'REVIEW_REQUIRED');
  assert.equal(request(read('workspace.inspect')).revision, 1);
});

test('CLI private assets and receipts cannot be read in another scope', t => {
  const { request } = setup(t);
  const selected = { ...scope, visibility: 'private' };
  const model = { ...asset, visibility: 'private' };
  request({ ...put, scope: selected, input: { model } });
  assert.equal(request(read('asset.inspect', { id: model.id, version: model.version }, selected)).model.visibility, 'private');
  for (const other of [scope, { ...selected, projectId: 'other' }]) {
    assert.equal(request(read('asset.inspect', { id: model.id, version: model.version }, other), 1).code, 'NOT_FOUND');
    assert.equal(request(read('receipt.inspect', { requestId: 'first' }, other), 1).code, 'NOT_FOUND');
    assert.deepEqual(request(read('asset.list', {}, other)), []);
  }
});

test('CLI explicit file accepts regular JSON and rejects missing/directory/symlink/oversize files', t => {
  const { parent, workspace, args } = setup(t);
  const file = join(parent, 'request.json'), link = join(parent, 'linked.json');
  writeFileSync(file, '{bad-secret'); symlinkSync(file, link);
  for (const candidate of [join(parent, 'missing'), parent, link]) {
    assert.equal(invoke([...args, '--request-file', candidate], '', 2).code, 'INPUT_FILE');
    assert.equal(existsSync(workspace), false);
  }
  assert.equal(invoke([...args, '--request-file', file], '', 2).code, 'INVALID_REQUEST');
  assert.equal(existsSync(workspace), false);
  writeFileSync(file, ' '.repeat(LIMITS.requestBytes + 1));
  assert.equal(invoke([...args, '--request-file', file], '', 2).code, 'LIMIT');
  assert.equal(existsSync(workspace), false);
  writeFileSync(file, JSON.stringify(put));
  assert.equal(invoke([...args, '--request-file', file], 'ignored malformed stdin').revision, 1);
  const bin = join(parent, 'evopilot-next-ontology'); symlinkSync(cli, bin);
  const child = spawnSync(process.execPath, [bin, 'version'], { encoding: 'utf8', env: { ...process.env, OPENSSL_CONF: '/dev/null', NODE_OPTIONS: '' } });
  assert.equal(child.status, 0, child.stderr); assert.equal(JSON.parse(child.stdout).ok, true);
  for (const entry of [cli, bin]) {
    const direct = spawnSync(entry, ['version'], { encoding: 'utf8', env: { ...process.env, OPENSSL_CONF: '/dev/null', NODE_OPTIONS: '' } });
    assert.ifError(direct.error); assert.equal(direct.status, 0, direct.stderr);
    assert.equal(JSON.parse(direct.stdout).result.product, 'ontology');
  }
});

test('CLI preserves query/source contracts and reports missing trusted classification/Catalog providers', t => {
  const { request } = setup(t);
  for (const operation of ['classification.start', 'classification.reanalyze']) {
    assert.equal(request({ ...read(operation, { id: 'session', sourceId: 'synthetic-cache', taxonomy: taxonomy() }), requestId: operation.split('.')[1], expectedRevision: 0 }, 1).code, 'CLASSIFICATION_PROVIDER_UNAVAILABLE');
  }
  assert.deepEqual(request(read('classification.list')), []);
  assert.equal(request(read('workspace.inspect')).revision, 0);
  const set = Object.fromEntries(['artifactSet', 'closure', 'foundation', 'proposal', 'packs', 'profile', 'index', 'projectionSet', 'roundTripReport', 'incremental', 'full', 'support'].map(key => [key, {}]));
  set.harnessAssets = [{ entry: { kind: 'HarnessBundle', id: 'synthetic', version: '1.0.0', assetDigest: 'sha256:' + 'a'.repeat(64) }, document: {} }];
  assert.equal(request(read('semantic.catalog.preview', { catalogId: 'synthetic', action: 'PUBLISH', expectedHead: 'EMPTY', sets: [set] }), 1).code, 'PROVIDER_REQUIRED');
  const imported = request({ ...read('legacy.import', { raw: '{"note":"inert"}', format: 'json', sourceLocator: 'synthetic:test', sourceRevision: '1', sourceVisibility: 'public' }), requestId: 'source', expectedRevision: 0 });
  assert.equal(imported.revision, 1);
  assert.equal(request(read('source.list')).length, 1);
  const source = request(read('source.inspect', { sourceId: imported.result.sourceId }));
  assert.equal(source.raw, '{"note":"inert"}');
  assert.deepEqual(source.document, { note: 'inert' });
  assert.equal(request(read('source.inspect', { sourceId: imported.result.sourceId }, { ...scope, projectId: 'other' }), 1).code, 'NOT_FOUND');
  const foundation = request(read('semantic.foundation.inspect'));
  assert.equal(foundation.previewOnly, true); assert.equal(foundation.authority, false);
  assert.ok(foundation.result.foundationDigest);
  assert.equal(request(read('workspace.inspect')).assetCount, 0);
  assert.equal(request(read('workspace.inspect')).revision, 1);
});

test('CLI unknown input failures expose only safe codes and static messages (read-only)', async () => {
  let output = '';
  const status = await main(['request', '--workspace', '/explicit-never-created', '--workspace-id', 'test'], {
    stdin: { async *[Symbol.asyncIterator]() { throw Object.assign(new Error('secret /private/input'), { code: 'PRIVATE_SECRET' }); } },
    stdout: { write(text) { output += text; } },
  });
  assert.equal(status, 2);
  assert.deepEqual(JSON.parse(output), { ok: false, error: { code: 'INVALID_REQUEST', message: 'Invalid or oversized request input.' }, authority: false });
});

