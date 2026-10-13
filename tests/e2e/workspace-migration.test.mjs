import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, cpSync, readFileSync, writeFileSync, chmodSync, renameSync, mkdirSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { inspectWorkspaceSnapshot, relocateWorkspaceSnapshot } from '@evopilot-next/ontology/workspace-migration';
import { keyDirectory } from '../../dist/location-lineage.js';
import { createOntologyService } from '../../dist/service.js';
import { sha256 } from '../../vendor/compatibility/v1/reference.mjs';
const product = 'ontology', createService = createOntologyService;
const scope = { visibility: 'public', projectId: 'synthetic' };
const read = (service, operation, input = {}) => service.execute({ operation, scope, input });
let serial = 0;
const write = (service, operation, input) => service.execute({ operation, scope, input, requestId: 'migration-' + (++serial), expectedRevision: read(service, 'workspace.inspect').revision });
function setup(t) {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'evopilot-migration-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const sourceRoot = join(parent, 'source'), destinationRoot = join(parent, 'destination'), workspaceId = 'synthetic-relocation';
  const options = { workspaceRoot: sourceRoot, workspaceId };
  return { parent, sourceRoot, destinationRoot, workspaceId, options };
}
function privateCopy(source, destination) { cpSync(source, destination, { recursive: true, preserveTimestamps: true }); const visit = path => { const stat = lstatSync(path); chmodSync(path, stat.isDirectory() ? 0o700 : 0o600); if (stat.isDirectory()) for (const name of readdirSync(path)) visit(join(path, name)); }; visit(destination); }
function cleanKeys(t, report) { t.after(() => { for (const id of report.requiredKeyIds) rmSync(join(keyDirectory(), id + '.key'), { force: true }); }); }
function businessTables(root) {
  const db = new DatabaseSync(join(root, 'state', product, product + '.db'));
  try { return ['state','receipts','audit'].map(table => db.prepare('SELECT * FROM ' + table + ' ORDER BY 1,2').all()); } finally { db.close(); }
}
async function populate(options) {
  const digest = 'sha256:' + 'a'.repeat(64);
  let executions = 0;
  const provider = ({ reference, workspace }) => ({ reference, workspace, scope, published: true, materialDigest: digest, descriptor: { kind: reference.product + '-composition/v1', digest } });
  const result = claim => ({ claimId: claim.claimId, inputDigest: claim.inputDigest, pins: claim.pins, providerReceiptId: 'synthetic-original', status: 'SUCCEEDED', result: { evaluation: 'PASS', evidenceDigest: digest } });
  const providers = product === 'runtime' ? { resolveOntology: provider, resolveHarness: provider, execute: claim => { executions++; return claim.id === 'unknown' ? undefined : result(claim); }, inspectReceipt: result } : {};
  const service = createService(options, providers); service.initialize();
  if (product === 'runtime') {
    write(service, 'project.create', { name: 'Synthetic migration' }); write(service, 'goal.create', { id: 'goal', description: 'Owner migration E2E' });
    for (const id of ['completed', 'unknown', 'prepared']) {
      const reference = product => ({ product, id: product, version: '1.0.0', specVersion: 'v1', visibility: 'public', digest });
      const prepared = write(service, 'run.prepare', { id, goalId: 'goal', ontology: reference('ontology'), harness: reference('harness'), input: { schema: 'runtime-composition/v1', ontologyInstance: { entities: [], relations: [] }, harness: { mode: 'composed', evidence: {}, configuration: {} } } }).result;
      write(service, 'run.decide', { id, reviewDigest: prepared.reviewDigest, decision: 'APPROVE', humanEvidenceRef: 'synthetic:user-approved' });
      if (id !== 'prepared') await service.dispatch({ scope, id, requestId: 'dispatch-' + id, expectedRevision: read(service, 'workspace.inspect').revision });
    }
  } else {
    const data = JSON.parse(readFileSync(new URL(product === 'ontology' ? '../../examples/synthetic-models.json' : '../../examples/synthetic-harnesses.json', import.meta.url)));
    const asset = product === 'ontology' ? data.assets[0] : data[0].asset;
    write(service, 'asset.put', product === 'ontology' ? { model: asset } : { asset });
    const input = { id: asset.id, version: asset.version };
    const review = write(service, 'asset.review', input).result;
    write(service, 'asset.decide', { ...input, reviewDigest: review.reviewDigest, decision: 'APPROVE', humanEvidenceRef: 'synthetic:user-approved' });
    write(service, 'asset.publish', input);
  }
  service.close(); return { providers, executions };
}
test('same-host relocation preserves owner records, blobs, pins, receipts and supports exact retry', async t => {
  const fixture = setup(t), { options, sourceRoot, destinationRoot, workspaceId } = fixture;
  const { providers, executions } = await populate(options);
  const before = businessTables(sourceRoot), snapshot = inspectWorkspaceSnapshot(options);
  privateCopy(sourceRoot, destinationRoot);
  const request = { sourceRoot, destinationRoot, workspaceId, expectedSnapshotDigest: snapshot.snapshotDigest };
  const result = relocateWorkspaceSnapshot(request); cleanKeys(t, result);
  assert.equal(result.authority, false); assert.equal(result.snapshot.recordsDigest, snapshot.recordsDigest); assert.equal(result.snapshot.blobsDigest, snapshot.blobsDigest);
  assert.deepEqual(businessTables(sourceRoot), before); assert.deepEqual(businessTables(destinationRoot), before);
  assert.equal(relocateWorkspaceSnapshot(request).relocationDigest, result.relocationDigest);
  assert.equal(inspectWorkspaceSnapshot({ workspaceRoot: destinationRoot, workspaceId }).snapshotDigest, result.snapshot.snapshotDigest);
  const service = createService({ workspaceRoot: destinationRoot, workspaceId }, providers); service.initialize(); t.after(() => service.close());
  if (product === 'runtime') {
    assert.equal(executions, 2);
    const completed = read(service, 'run.inspect', { id: 'completed' }); assert.equal(completed.stage, 'SUCCEEDED'); assert.equal(completed.plan.workspace.canonicalRoot, sourceRoot); assert.equal(completed.attemptCount, 1);
    const unknown = read(service, 'run.inspect', { id: 'unknown' }); assert.equal(unknown.stage, 'UNKNOWN');
    const original = read(service, 'receipt.inspect', { requestId: 'dispatch-unknown' });
    const reconciled = await service.reconcile({ scope, id: 'unknown', requestId: 'reconcile-original', expectedRevision: read(service, 'workspace.inspect').revision });
    assert.equal(reconciled.result.stage, 'SUCCEEDED'); assert.equal(reconciled.result.claim.claimId, unknown.claim.claimId); assert.equal(reconciled.result.attemptCount, 1);
    assert.deepEqual(read(service, 'receipt.inspect', { requestId: 'dispatch-unknown' }), original);
    await assert.rejects(service.dispatch({ scope, id: 'prepared', requestId: 'unsafe-replay', expectedRevision: read(service, 'workspace.inspect').revision }), { code: 'RELOCATION_REVIEW_REQUIRED' });
    const fresh = write(service, 'run.prepare', { id: 'fresh', goalId: 'goal', ...completed.plan.pins, input: completed.plan.input }).result;
    assert.equal(fresh.plan.workspace.canonicalRoot, destinationRoot);
  } else {
    const asset = read(service, 'asset.list')[0], retained = read(service, 'asset.inspect', { id: asset.id, version: asset.version });
    assert(retained.delivery); assert.equal(retained.review.workspace.canonicalRoot, sourceRoot);
    const changed = structuredClone(retained.model); changed.version = '2.0.0';
    write(service, 'asset.put', product === 'ontology' ? { model: changed } : { asset: changed });
    const review = write(service, 'asset.review', { id: changed.id, version: changed.version }).result;
    assert.equal(review.workspace.canonicalRoot, destinationRoot);
  }
});
test('forged lineage, missing local key, wrong owner/root and modified copy fail closed', async t => {
  const { parent, options, sourceRoot, destinationRoot, workspaceId } = setup(t); await populate(options);
  const snapshot = inspectWorkspaceSnapshot(options); privateCopy(sourceRoot, destinationRoot);
  const request = { sourceRoot, destinationRoot, workspaceId, expectedSnapshotDigest: snapshot.snapshotDigest };
  const marker = join(destinationRoot, 'workspace.json'), identity = JSON.parse(readFileSync(marker));
  writeFileSync(marker, JSON.stringify({ ...identity, ownerUid: identity.ownerUid + 1 })); assert.throws(() => relocateWorkspaceSnapshot(request), { code: 'IDENTITY_MISMATCH' });
  writeFileSync(marker, JSON.stringify({ ...identity, canonicalRoot: join(parent, 'foreign') })); assert.throws(() => relocateWorkspaceSnapshot(request), { code: 'IDENTITY_MISMATCH' });
  writeFileSync(marker, JSON.stringify(identity));
  const report = relocateWorkspaceSnapshot(request); cleanKeys(t, report);
  const key = join(keyDirectory(), report.requiredKeyIds[0] + '.key'); renameSync(key, key + '.held');
  try { assert.throws(() => inspectWorkspaceSnapshot({ workspaceRoot: destinationRoot, workspaceId }), { code: 'MISSING_RELOCATION_KEY' }); } finally { renameSync(key + '.held', key); }
  const db = new DatabaseSync(join(destinationRoot, 'state', product, product + '.db'));
  const row = db.prepare('SELECT record FROM workspace_relocations WHERE sequence=1').get(), record = JSON.parse(row.record);
  record.from.canonicalRoot = join(parent, 'forged'); const { recordDigest, signature, ...subject } = record; record.recordDigest = sha256(subject);
  db.prepare('UPDATE workspace_relocations SET record=? WHERE sequence=1').run(JSON.stringify(record)); db.close();
  assert.throws(() => inspectWorkspaceSnapshot({ workspaceRoot: destinationRoot, workspaceId }), { code: 'INVALID_LINEAGE' });
  const altered = join(parent, 'altered'); privateCopy(sourceRoot, altered);
  const changed = new DatabaseSync(join(altered, 'state', product, product + '.db')); changed.prepare('UPDATE audit SET result_digest=? WHERE revision=1').run('sha256:' + '0'.repeat(64)); changed.close();
  assert.throws(() => relocateWorkspaceSnapshot({ ...request, destinationRoot: altered }), { code: 'CORRUPT_STATE' });
});
test('no source initialization, Git roots and linked/private data safety', t => {
  const { parent, sourceRoot, workspaceId } = setup(t);
  assert.throws(() => inspectWorkspaceSnapshot({ workspaceRoot: sourceRoot, workspaceId }));
  mkdirSync(sourceRoot, { mode: 0o700 }); mkdirSync(join(sourceRoot, '.git'));
  assert.throws(() => inspectWorkspaceSnapshot({ workspaceRoot: sourceRoot, workspaceId }), { code: 'UNSAFE_WORKSPACE' });
});

test('second relocation retains validated ancestry and preserves historical bytes', async t => {
  const { parent, options, sourceRoot, destinationRoot, workspaceId } = setup(t); await populate(options);
  const first = inspectWorkspaceSnapshot(options), original = businessTables(sourceRoot); privateCopy(sourceRoot, destinationRoot);
  const relocated = relocateWorkspaceSnapshot({ sourceRoot, destinationRoot, workspaceId, expectedSnapshotDigest: first.snapshotDigest }); cleanKeys(t, relocated);
  const third = join(parent, 'third'); privateCopy(destinationRoot, third);
  const next = relocateWorkspaceSnapshot({ sourceRoot: destinationRoot, destinationRoot: third, workspaceId, expectedSnapshotDigest: relocated.snapshot.snapshotDigest });
  assert.deepEqual(next.requiredKeyIds, relocated.requiredKeyIds); assert.deepEqual(businessTables(third), original);
  assert.equal(inspectWorkspaceSnapshot({ workspaceRoot: third, workspaceId }).recordsDigest, first.recordsDigest);
  const service = createService({ workspaceRoot: third, workspaceId }); service.initialize();
  try { assert.equal(read(service, 'workspace.inspect').revision, first.revision); } finally { service.close(); }
});

test('retained producer and Catalog readback survive relocation without inheriting pending approvals', async t => {
  const { catalogClient, ownedCatalogMaterials, trustedHarness } = await import('../fixtures/catalog-service-materials.mjs');
  const { parent, sourceRoot, destinationRoot } = setup(t), workspaceId = 'catalog-test';
  const selected = { visibility: 'public', projectId: 'alpha' }, providers = { resolveLegacyHarness: trustedHarness };
  let service = createService({ workspaceRoot: sourceRoot, workspaceId }, providers); service.initialize();
  const client = catalogClient({ execute: request => service.execute(request) }, selected);
  const set = ownedCatalogMaterials(client);
  const parameters = { action: 'PUBLISH', catalogId: 'main', expectedHead: 'EMPTY', sets: [set] };
  const plan = client.prepare(parameters), pending = client.prepare(parameters); client.decide(plan); client.decide(pending);
  const receipt = client.write('semantic.catalog.publish', { planId: plan.planId });
  const before = client.read('semantic.catalog.inspect', { catalogId: 'main' });
  const plans = client.read('producer.list');
  service.close();
  const snapshot = inspectWorkspaceSnapshot({ workspaceRoot: sourceRoot, workspaceId }); privateCopy(sourceRoot, destinationRoot);
  const result = relocateWorkspaceSnapshot({ sourceRoot, destinationRoot, workspaceId, expectedSnapshotDigest: snapshot.snapshotDigest }); cleanKeys(t, result);
  service = createService({ workspaceRoot: destinationRoot, workspaceId }, providers); service.initialize(); t.after(() => service.close());
  assert.deepEqual(client.read('producer.list'), plans);
  assert.deepEqual(client.read('semantic.catalog.inspect', { catalogId: 'main' }), before);
  assert.deepEqual(client.read('semantic.catalog.readback', { requestId: receipt.requestId }), receipt);
  assert.equal(client.read('semantic.catalog.recovery-readback', { requestId: receipt.requestId, intentDigest: receipt.requestDigest }).status, 'COMMITTED');
  assert.throws(() => client.write('semantic.catalog.publish', { planId: pending.planId }), { code: 'RELOCATION_REVIEW_REQUIRED' });
});

test('snapshot does not attest missing material or an unbound historical review', async t => {
  const { options, sourceRoot } = setup(t); await populate(options);
  const db = new DatabaseSync(join(sourceRoot, 'state', product, product + '.db'));
  const row = db.prepare('SELECT data FROM state WHERE singleton=1').get(), state = JSON.parse(row.data);
  if (product === 'runtime') {
    const run = state.runs.find(run => run.id === 'prepared');
    run.plan.workspace.canonicalRoot += '-unverified';
    for (const material of Object.values(run.plan.materials)) material.workspace.canonicalRoot = run.plan.workspace.canonicalRoot;
    run.reviewDigest = sha256(run.plan); run.decision.reviewDigest = run.reviewDigest;
    db.prepare('UPDATE state SET data=? WHERE singleton=1').run(JSON.stringify(state)); db.close();
    assert.throws(() => inspectWorkspaceSnapshot(options), { code: 'CORRUPT_STATE' });
  } else {
    const asset = state.assets[0]; db.close();
    rmSync(join(sourceRoot, 'public', product, asset.digest.slice(7) + '.json'));
    assert.throws(() => inspectWorkspaceSnapshot(options), { code: 'CORRUPT_BLOB' });
  }
});

function retainSyntheticDestinationKeys(t, destination) {
  const db = new DatabaseSync(join(destination, 'state', product, product + '.db'));
  try {
    const keys = db.prepare('SELECT record FROM workspace_relocations').all().map(row => JSON.parse(row.record).keyId);
    assert(keys.every(id => /^[a-f0-9]{64}$/.test(id)));
    cleanKeys(t, { requiredKeyIds: keys });
  } finally { db.close(); }
}

test('killed marker writer resumes exact relocation without copied-state orphans or rewritten history', async t => {
  for (const boundary of ['partial-write', 'after-rename']) {
    const { options, sourceRoot, destinationRoot, workspaceId } = setup(t); await populate(options);
    const snapshot = inspectWorkspaceSnapshot(options), original = businessTables(sourceRoot);
    privateCopy(sourceRoot, destinationRoot);
    const names = readdirSync(destinationRoot).sort();
    const request = { sourceRoot, destinationRoot, workspaceId, expectedSnapshotDigest: snapshot.snapshotDigest };
    const module = new URL('../../dist/workspace-migration.js', import.meta.url).href;
    const childCode = `
      import fs from 'node:fs';
      import {syncBuiltinESMExports} from 'node:module';
      const request=${JSON.stringify(request)}, boundary=${JSON.stringify(boundary)};
      const identity={schema:'evopilot-workspace/v1',id:request.workspaceId,canonicalRoot:request.destinationRoot,ownerUid:process.getuid()};
      const expected=JSON.stringify(Object.fromEntries(Object.entries(identity).sort(([a],[b])=>a.localeCompare(b))));
      const originalWrite=fs.writeFileSync, originalRename=fs.renameSync;
      fs.writeFileSync=function(file,data,...args) {
        if(boundary==='partial-write' && Buffer.isBuffer(data) && data.toString()===expected) {
          originalWrite(file,data.subarray(0,Math.floor(data.length/2)),...args); fs.fsyncSync(file);
          process.kill(process.pid,'SIGKILL');
        }
        return originalWrite(file,data,...args);
      };
      fs.renameSync=function(from,to) {
        const result=originalRename(from,to);
        if(boundary==='after-rename' && to===request.destinationRoot+'/workspace.json') process.kill(process.pid,'SIGKILL');
        return result;
      };
      syncBuiltinESMExports();
      const {relocateWorkspaceSnapshot}=await import(${JSON.stringify(module)});
      relocateWorkspaceSnapshot(request);
    `;
    // Kill an actual subprocess at the filesystem boundary; providers and data are synthetic.
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', childCode], { encoding: 'utf8', timeout: 10000 });
    retainSyntheticDestinationKeys(t, destinationRoot);
    assert.equal(child.signal, 'SIGKILL', child.stderr); assert.equal(child.status, null);
    assert.deepEqual(readdirSync(destinationRoot).sort(), names);
    assert(existsSync(destinationRoot + '.evopilot-relocation'));
    const resumed = relocateWorkspaceSnapshot(request); cleanKeys(t, resumed);
    assert.equal(resumed.snapshot.recordsDigest, snapshot.recordsDigest);
    assert.deepEqual(businessTables(sourceRoot), original); assert.deepEqual(businessTables(destinationRoot), original);
    assert.deepEqual(readdirSync(destinationRoot).sort(), names);
    assert(!existsSync(destinationRoot + '.evopilot-relocation'));
    const db = new DatabaseSync(join(destinationRoot, 'state', product, product + '.db'));
    try { assert.equal(db.prepare('SELECT COUNT(*) AS count FROM workspace_relocations').get().count, 1); } finally { db.close(); }
    assert.equal(relocateWorkspaceSnapshot(request).relocationDigest, resumed.relocationDigest);
  }
});

test('foreign marker staging is rejected verbatim and never cleaned as an owned interruption', async t => {
  const { options, sourceRoot, destinationRoot, workspaceId } = setup(t); await populate(options);
  const snapshot = inspectWorkspaceSnapshot(options), original = businessTables(sourceRoot);
  privateCopy(sourceRoot, destinationRoot);
  const request = { sourceRoot, destinationRoot, workspaceId, expectedSnapshotDigest: snapshot.snapshotDigest };
  const staging = destinationRoot + '.evopilot-relocation'; mkdirSync(staging, { mode: 0o700 });
  const filename = join(staging, 'user-notes.txt'); writeFileSync(filename, 'preserve foreign bytes', { mode: 0o600 });
  assert.throws(() => relocateWorkspaceSnapshot(request), { code: 'RELOCATION_STAGING_CONFLICT' });
  retainSyntheticDestinationKeys(t, destinationRoot);
  assert.equal(readFileSync(filename, 'utf8'), 'preserve foreign bytes');
  assert.deepEqual(businessTables(sourceRoot), original); assert.deepEqual(businessTables(destinationRoot), original);
  // The test owns this synthetic foreign fixture; normal product recovery never removes it.
  rmSync(filename);
  const pending = join(staging, sha256({ ...snapshot.identity, canonicalRoot: destinationRoot }).slice(7) + '.pending');
  writeFileSync(pending, 'foreign bytes under the expected name', { mode: 0o600 });
  assert.throws(() => relocateWorkspaceSnapshot(request), { code: 'RELOCATION_STAGING_CONFLICT' });
  assert.equal(readFileSync(pending, 'utf8'), 'foreign bytes under the expected name');
  rmSync(pending);
  const resumed = relocateWorkspaceSnapshot(request); cleanKeys(t, resumed);
  assert.equal(resumed.snapshot.recordsDigest, snapshot.recordsDigest);
});
