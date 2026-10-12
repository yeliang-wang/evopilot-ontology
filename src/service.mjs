import { exactFields, frozenClone, sha256, stableSerialize } from '../vendor/compatibility/v1/reference.mjs';
import { openState, bounded, fail, LIMITS, validateState } from './state.mjs';
import { operations, validateRequest, operate } from './native-operations.mjs';
import { catalogMutations, verifyCatalogReceipt } from './catalog-operations.mjs';
import { classificationDispatch, classificationOperations, findClassification } from './classification-operations.mjs';
import { classificationProviders, createClassificationRunner } from './classification-runner.mjs';

// Construction and discovery are pure. Persistence begins only at initialize().
export function createOntologyService(options, trustedProviders = {}) {
  bounded(options); exactFields(options, ['workspaceRoot', 'workspaceId']);
  const providers = classificationProviders(trustedProviders);
  const { workspaceRoot, workspaceId } = options;
  let store = null, closed = false;
  const capabilities = () => frozenClone({ product: 'ontology', stage: 'M2_OWNED_SERVICE', operations, limits: LIMITS, authority: false, softwareRelease: false, pending: ['MCP', 'Expert integration', 'trusted Harness provider wiring'] });
  function initialize() {
    if (closed) fail('CLOSED', 'Service is closed');
    if (!store) { store = openState(workspaceRoot, workspaceId); store.trustedProviders = providers; }
    return frozenClone({ workspaceId, initialized: true, authority: false });
  }
  const runClassification = createClassificationRunner(() => store);
  function executeCore(request, onDispatch) {
    let transaction = false, validatedOperation;
    try {
      bounded(request);
      const r = frozenClone(request), write = validateRequest(r);
      validatedOperation = r.operation;
      if (classificationDispatch.includes(r.operation) && !onDispatch) fail('ASYNC_REQUIRED', 'Use service.classify for classification dispatch');
      if (closed) fail('CLOSED', 'Service is closed');
      if (!store) fail('NOT_INITIALIZED', 'Explicit initialize required');
      store.guard();
      const { db } = store;
      db.exec((write || r.operation === 'semantic.catalog.recovery-readback') ? 'BEGIN IMMEDIATE' : 'BEGIN'); transaction = true;
      const scope = stableSerialize(r.scope);
      // expectedRevision is a CAS precondition, not part of the idempotent intent.
      const digest = write ? sha256({ operation: r.operation, scope: r.scope, input: r.input }) : null;
      if (write) {
        const old = db.prepare('SELECT digest, receipt FROM receipts WHERE scope = ? AND request_id = ?').get(scope, r.requestId);
        if (old) {
          if (old.digest !== digest) fail('REQUEST_CONFLICT', 'Request id already binds different content');
          const result = JSON.parse(old.receipt);
          if (catalogMutations.includes(r.operation)) {
            const current = db.prepare('SELECT data FROM state WHERE singleton = 1').get();
            verifyCatalogReceipt(store, validateState(JSON.parse(current.data)), r.scope, result);
          }
          if (classificationOperations.includes(r.operation)) findClassification(store, validateState(JSON.parse(db.prepare('SELECT data FROM state WHERE singleton = 1').get().data)), r.scope, r.input.id);
          db.exec('COMMIT'); transaction = false; return frozenClone(result);
        }
      }
      const row = db.prepare('SELECT revision, data FROM state WHERE singleton = 1').get();
      if (!row || !Number.isSafeInteger(row.revision)) fail('CORRUPT_STATE', 'Missing state');
      if (write && row.revision !== r.expectedRevision) fail('REVISION_CONFLICT', 'Global product revision changed');
      const state = validateState(JSON.parse(row.data));
      let result;
      if (r.operation === 'workspace.inspect') result = { workspaceId, revision: row.revision, scope: r.scope, assetCount: state.assets.filter(a => stableSerialize(a.scope) === scope).length, authority: false };
      else if (r.operation === 'receipt.inspect') {
        const receipt = db.prepare('SELECT receipt FROM receipts WHERE scope = ? AND request_id = ?').get(scope, r.input.requestId);
        if (!receipt) fail('NOT_FOUND', 'Receipt not found in scope');
        result = JSON.parse(receipt.receipt);
        if (catalogMutations.includes(result.operation)) verifyCatalogReceipt(store, state, r.scope, result);
        if (classificationOperations.includes(result.operation)) findClassification(store, state, r.scope, result.result.id ?? result.result.classificationSessionId);
      } else result = operate(store, state, r);
      if (write) {
        if (db.prepare('SELECT count(*) AS n FROM receipts').get().n >= LIMITS.receipts || row.revision >= Number.MAX_SAFE_INTEGER) fail('LIMIT', 'Receipt/revision limit');
        const data = stableSerialize(state);
        if (Buffer.byteLength(data) > LIMITS.stateBytes) fail('LIMIT', 'State byte limit');
        validateState(state);
        const revision = row.revision + 1;
        const receipt = { requestId: r.requestId, scope: r.scope, operation: r.operation, requestDigest: digest, revision, uid: store.uid, result };
        const receiptJSON = stableSerialize(receipt);
        if (db.prepare('SELECT coalesce(sum(length(CAST(receipt AS BLOB))),0) AS bytes FROM receipts').get().bytes + Buffer.byteLength(receiptJSON) > LIMITS.receiptBytes) fail('LIMIT', 'Receipt byte limit');
        db.prepare('UPDATE state SET revision = ?, data = ? WHERE singleton = 1 AND revision = ?').run(revision, data, row.revision);
        db.prepare('INSERT INTO receipts(scope, request_id, digest, receipt) VALUES(?,?,?,?)').run(scope, r.requestId, digest, receiptJSON);
        db.prepare('INSERT INTO audit(revision, uid, operation, request_digest, result_digest) VALUES(?,?,?,?,?)').run(revision, store.uid, r.operation, digest, sha256(result));
        result = receipt;
      }
      db.exec('COMMIT'); transaction = false;
      if (classificationDispatch.includes(r.operation)) onDispatch();
      return frozenClone(result);
    } catch (e) {
      if (transaction) { try { store.db.exec('ROLLBACK'); } catch { /* Preserve original failure. */ } }
      if (['semantic.catalog.recover', 'semantic.catalog.recovery-readback', 'semantic.catalog.recovery-inspect'].includes(validatedOperation)) {
        throw Object.assign(new Error('Catalog recovery result unresolved'), { code: 'UNKNOWN', causeCode: e.code ?? 'INVALID_REQUEST', status: 'UNKNOWN' });
      }
      if (classificationOperations.includes(validatedOperation)) fail(typeof e.code === 'string' && /^[A-Z_]+$/.test(e.code) ? e.code : 'CLASSIFICATION_FAILED', 'Classification request failed');
      if (typeof e.code === 'string' && !e.code.startsWith('ERR_') && !e.code.startsWith('SQLITE_')) throw e;
      fail(e.code === 'ERR_SQLITE_ERROR' ? 'STATE_ERROR' : 'INVALID_REQUEST', 'Service request failed: ' + (e.code || 'invalid data'));
    }
  }
  function execute(request) { return executeCore(request); }
  async function classify(request) {
    bounded(request);
    const r = frozenClone(request);
    if (!classificationDispatch.includes(r.operation)) fail('INVALID_REQUEST', 'classify accepts start or reanalyze only');
    let created = false;
    const receipt = executeCore(r, () => { created = true; });
    return created ? runClassification(r, receipt) : receipt;
  }
  function close() { if (store) { store.db.close(); store = null; } closed = true; }
  return Object.freeze({ capabilities, initialize, execute, classify, close });
}
