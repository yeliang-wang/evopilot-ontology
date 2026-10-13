import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createOntologyService } from '../../dist/service.js';
import { fixture, taxonomy, supportingAdvisor } from '../fixtures/classification-service.mjs';
import { prepareClassification } from '../../dist/classification-operations.js';
const scope = { visibility: 'private', projectId: 'synthetic' };
const read = (service, operation = 'inspect', input = { id: 'session' }, selected = scope) => service.execute({ operation: 'classification.' + operation, scope: selected, input });
const revision = service => service.execute({ operation: 'workspace.inspect', scope, input: {} }).revision;
const start = (service, requestId = 'start', operation = 'start') => ({ operation: 'classification.' + operation, scope, input: { id: 'session', sourceId: 'synthetic-cache', taxonomy: taxonomy() }, requestId, expectedRevision: revision(service) });
const write = (service, operation, input, requestId = operation.replaceAll('_', '-')) => service.execute({ operation: 'classification.' + operation, scope, input, requestId, expectedRevision: revision(service) });
const handoffInput = result => ({ id: 'session', decisionToken: `CONTINUE_TO_HARNESS:session:${result.analysisResultDigest}`, humanEvidence: { uid: process.getuid(), evidenceRef: 'human:review-1', analysisResultDigest: result.analysisResultDigest } });

test('classification discovery and descriptor-safe trusted providers (read-only)', () => {
  let getters = 0;
  const options = { workspaceRoot: '/explicit-discovery-only', workspaceId: 'discovery' };
  for (const providers of [Object.defineProperty({}, 'classificationAdvisor', { get() { getters++; } }), { classificationModel: Object.defineProperty({}, 'providerId', { get() { getters++; } }) }]) assert.throws(() => createOntologyService(options, providers));
  const callback = () => {};
  Object.defineProperty(callback, 'modelBinding', { get() { getters++; throw new Error('never'); } });
  const service = createOntologyService(options, { classificationAdvisor: callback });
  assert.equal(service.capabilities().operations.filter(x => x.startsWith('classification.')).length, 7);
  assert.equal(service.capabilities().authority, false);
  assert.equal(getters, 0); service.close();
});

test('public classification rejects paths, scalar scope violations and completion injection (read-only)', async () => {
  const service = createOntologyService({ workspaceRoot: '/explicit-discovery-only', workspaceId: 'discovery' });
  const request = { operation: 'classification.start', scope, input: { id: 'session', sourceId: 'synthetic-cache', taxonomy: taxonomy() }, requestId: 'start', expectedRevision: 0 };
  await assert.rejects(service.classify({ ...request, input: { ...request.input, taxonomy: '/must-not-read' } }), { code: 'INVALID_REQUEST' });
  await assert.rejects(service.classify({ ...request, scope: { ...scope, projectId: {} } }), { code: 'INVALID_REQUEST' });
  assert.throws(() => service.execute({ operation: 'classification.internal.complete', scope, input: { result: {} } }), { code: 'UNSUPPORTED_OPERATION' });
  await assert.rejects(service.classify(request), { code: 'NOT_INITIALIZED' });
  service.close();
});

test('persisted real engine result, concurrent replay, restart, scope, CAS and human handoff', async t => {
  const f = fixture(); t.after(f.cleanup);
  let calls = 0;
  const service = createOntologyService(f.options, { ...f.providers, classificationAdvisor: input => { calls++; return supportingAdvisor(input); } });
  t.after(() => service.close()); service.initialize();
  const request = start(service);
  assert.throws(() => service.execute(request), { code: 'ASYNC_REQUIRED' });
  const [a, b] = await Promise.all([service.classify(request), service.classify(request)]);
  assert.deepEqual(a, b); assert.equal(calls, 1);
  const session = read(service); assert.equal(session.status, 'COMPLETED');
  const result = session.attempts[0].result;
  assert.equal(result.aggregate, 'TAXONOMY_MATCHED');
  assert.equal(result.authority.mayPublish, false);
  assert.ok(session.attempts[0].claim.inputDigest); assert.ok(session.attempts[0].claim.modelBinding);
  assert.throws(() => read(service, 'inspect', { id: 'session' }, { visibility: 'private', projectId: 'other' }), { code: 'NOT_FOUND' });
  assert.throws(() => read(service, 'resume', { id: 'session' }, { visibility: 'public', projectId: 'synthetic' }), { code: 'NOT_FOUND' });
  await assert.rejects(service.classify({ ...start(service, 'stale', 'reanalyze'), expectedRevision: 0 }), { code: 'REVISION_CONFLICT' });
  service.close();
  const restarted = createOntologyService(f.options); t.after(() => restarted.close()); restarted.initialize();
  assert.deepEqual(read(restarted).attempts[0].result, result);
  assert.equal(read(restarted, 'resume').status, 'COMPLETED');
  assert.equal(read(restarted, 'list', {}).length, 1);
  const handoff = write(restarted, 'continue_to_harness', handoffInput(result)).result;
  assert.equal(handoff.authority.approves, false); assert.equal(handoff.authority.publishes, false); assert.equal(handoff.authority.provesEligibility, false);
  fs.appendFileSync(path.join(f.source, 'README.md'), '\nChanged source evidence');
  assert.throws(() => write(restarted, 'continue_to_harness', handoffInput(result), 'drift'), { code: 'CLASSIFICATION_SOURCE_DRIFT' });
  write(restarted, 'close', { id: 'session' });
  assert.equal(read(restarted).status, 'CLOSED');
});

test('timeout, throw, invalid data and late completion remain UNKNOWN and cannot retry', async t => {
  for (const mode of ['timeout', 'throw', 'invalid', 'accessor']) {
    const f = fixture(); let finish, calls = 0, getters = 0;
    const pending = new Promise(resolve => { finish = resolve; });
    const service = createOntologyService(f.options, { ...f.providers, classificationModel: { ...f.providers.classificationModel, timeoutMs: 5 }, classificationAdvisor: input => {
      calls++;
      if (mode === 'throw') throw new Error('credential=never-persist');
      if (mode === 'invalid') return null;
      if (mode === 'accessor') return Object.defineProperty({}, 'candidates', { get() { getters++; } });
      return pending.then(() => supportingAdvisor(input));
    } });
    try {
      service.initialize(); await service.classify(start(service));
      assert.equal(read(service).status, 'UNKNOWN');
      assert.doesNotMatch(JSON.stringify(read(service)), /never-persist/);
      await assert.rejects(service.classify(start(service, 'retry', 'reanalyze')), { code: 'CLASSIFICATION_UNRESOLVED' });
      finish(); await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(read(service, 'resume').status, 'UNKNOWN'); assert.equal(calls, 1); assert.equal(getters, 0);
      write(service, 'close', { id: 'session' });
      await assert.rejects(service.classify(start(service, 'reopen', 'reanalyze')), { code: 'CLASSIFICATION_UNRESOLVED' });
    } finally { service.close(); f.cleanup(); }
  }
});

test('missing provider and mismatched resolver reject without source preparation or dispatch', async t => {
  for (const mode of ['missing', 'scope', 'workspace', 'sourceId']) {
    const f = fixture(); t.after(f.cleanup); let calls = 0;
    const providers = mode === 'missing' ? {} : { ...f.providers, classificationAdvisor: () => { calls++; }, resolveClassificationSource: binding => ({ ...binding, [mode]: mode === 'scope' ? { ...scope, projectId: 'other' } : 'wrong', resolvedSource: { path: '/must-not-read' } }) };
    const service = createOntologyService(f.options, providers); t.after(() => service.close()); service.initialize();
    await assert.rejects(service.classify(start(service)), { code: mode === 'missing' ? 'CLASSIFICATION_PROVIDER_UNAVAILABLE' : 'SOURCE_BINDING_MISMATCH' });
    assert.equal(calls, 0); assert.equal(revision(service), 0); assert.deepEqual(read(service, 'list', {}), []);
  }
});

test('restart pending has no retry and close prevents late runner overwrite', async t => {
  const f = fixture(); t.after(f.cleanup); let finish, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { finish = resolve; });
  let calls = 0;
  const service = createOntologyService(f.options, { ...f.providers, classificationAdvisor: async input => { calls++; entered(); await pending; return supportingAdvisor(input); } });
  service.initialize(); const running = service.classify(start(service)); await ready;
  const other = createOntologyService(f.options, f.providers); t.after(() => other.close()); other.initialize();
  assert.equal(read(other, 'resume').status, 'UNKNOWN');
  await assert.rejects(other.classify(start(other, 'retry', 'reanalyze')), { code: 'CLASSIFICATION_UNRESOLVED' });
  write(other, 'close', { id: 'session' }); finish(); await running;
  assert.equal(read(other).status, 'CLOSED'); assert.equal(calls, 1); service.close();
});

test('sync source resolver consumes Promise rejection and rejects getters before state or dispatch (read-only)', async () => {
  let calls = 0, getters = 0, blobs = 0;
  const unhandled = [];
  const listener = reason => unhandled.push(reason);
  process.on('unhandledRejection', listener);
  try {
    for (const mode of ['rejected-promise', 'fulfilled-promise', 'then-getter', 'data-getter']) {
      const state = { assets: [] };
      const store = { identity: { id: 'synthetic' }, blob() { blobs++; }, trustedProviders: {
        classificationAdvisor() { calls++; }, classificationModel: { providerId: 'synthetic' },
        resolveClassificationSource() {
          if (mode === 'rejected-promise') {
            const promise = Promise.reject(new Error('must-be-consumed'));
            Object.defineProperty(promise, 'then', { get() { getters++; throw Error('never'); } });
            return promise;
          }
          if (mode === 'fulfilled-promise') return Promise.resolve({});
          return Object.defineProperty({}, mode === 'then-getter' ? 'then' : 'resolvedSource', { get() { getters++; throw Error('never'); } });
        },
      } };
      assert.throws(() => prepareClassification(store, state, {
        operation: 'classification.start', scope, input: { id: 'session', sourceId: 'synthetic-cache', taxonomy: taxonomy() }, requestId: 'start',
      }), { code: mode.endsWith('promise') ? 'CLASSIFICATION_SOURCE_ASYNC' : 'INVALID_REQUEST' });
      assert.deepEqual(state, { assets: [] });
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
    assert.equal(calls, 0); assert.equal(getters, 0); assert.equal(blobs, 0);
  } finally { process.off('unhandledRejection', listener); }
});

test('explicit successful reanalysis appends history; inspect detects corrupted retained evidence', async t => {
  const f = fixture(); t.after(f.cleanup);
  let calls = 0;
  const service = createOntologyService(f.options, { ...f.providers, classificationAdvisor: input => { calls++; return supportingAdvisor(input); } });
  t.after(() => service.close()); service.initialize();
  const firstReceipt = await service.classify(start(service));
  const first = read(service).attempts[0];
  const request = start(service, 'reanalysis', 'reanalyze');
  const secondReceipt = await service.classify(request);
  const session = read(service);
  assert.equal(session.status, 'COMPLETED'); assert.equal(session.attempts.length, 2);
  assert.deepEqual(session.attempts[0], first);
  assert.notEqual(session.attempts[1].attemptId, first.attemptId);
  assert.equal(session.attempts[1].result.aggregate, 'TAXONOMY_MATCHED');
  assert.deepEqual(await service.classify(request), secondReceipt); assert.equal(calls, 2);
  assert.deepEqual(service.execute({ operation: 'receipt.inspect', scope, input: { requestId: 'start' } }), firstReceipt);
  const blob = path.join(f.options.workspaceRoot, 'private/projects/synthetic/ontology', first.resultDigest.slice(7) + '.json');
  fs.writeFileSync(blob, '{}');
  assert.throws(() => read(service), { code: 'CORRUPT_BLOB' });
  assert.throws(() => read(service, 'list', {}), { code: 'CORRUPT_BLOB' });
});
