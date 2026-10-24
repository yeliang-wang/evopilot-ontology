import type { TrustedProviders, ClassificationModel, Scope, ClassificationRequest, Receipt } from './types.js';
import type { Store, ClassificationAttempt, ClassificationSession, ClassificationResult } from './persistence-types.js';
import { exactFields, frozenClone, sha256, stableSerialize } from '../vendor/compatibility/v1/reference.mjs';
import { bounded, fail, slug, LIMITS, validateState } from './state.js';
import { findClassification } from './classification-operations.js';
import { classification as legacy_classification } from "./compat/index.mjs";
import { nativeFrozenClone } from '../vendor/compatibility/v1/native.mjs';
const { analyzePreparedSourceTaxonomy } = legacy_classification;

export function classificationProviders(input: TrustedProviders): Readonly<TrustedProviders> {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail('INVALID_REQUEST', 'Code-injected providers required');
  const ds = Object.getOwnPropertyDescriptors(input), out: TrustedProviders = {};
  for (const key of Reflect.ownKeys(ds)) {
    const d = (ds as Record<PropertyKey, PropertyDescriptor>)[key];
    if (typeof key !== 'string' || !['resolveNativeAuthoring','readFeedback','resolveFeedbackMaterial','nativeToolchain', 'resolveLegacyHarness', 'resolveClassificationSource', 'classificationAdvisor', 'classificationModel'].includes(key) || !Object.hasOwn(d, 'value')) fail('INVALID_REQUEST', 'Invalid trusted provider descriptors');
    if (key === 'nativeToolchain') {
      out.nativeToolchain = nativeFrozenClone(d.value) as TrustedProviders['nativeToolchain'];
    } else if (key === 'classificationModel') {
      bounded(d.value); exactFields(d.value, ['providerId', 'modelId', 'revision', 'timeoutMs']);
      for (const field of ['providerId', 'modelId', 'revision'] as const) slug(d.value[field]);
      if (!Number.isInteger(d.value.timeoutMs) || (d.value.timeoutMs as number) < 1 || (d.value.timeoutMs as number) > 180000) fail('INVALID_REQUEST', 'Invalid advisor deadline');
      out[key] = frozenClone(d.value) as unknown as ClassificationModel;
    } else {
      if (typeof d.value !== 'function') fail('INVALID_REQUEST', 'Trusted callback required');
      // Never read properties (including modelBinding) from supplied callbacks.
      out[key as "resolveNativeAuthoring" | "resolveLegacyHarness" | "resolveClassificationSource" | "classificationAdvisor" | "readFeedback" | "resolveFeedbackMaterial"] = d.value;
    }
  }
  return Object.freeze(out);
}

// This factory is reachable only from the service implementation. There is no
// request operation accepting a result or an invocation claim from public JSON.
export function createClassificationRunner(getStore: () => Store | null) {
  function change(scope: Scope, id: string, attemptId: string, phase: string, update: (attempt: ClassificationAttempt, session: ClassificationSession) => boolean) {
    const store = getStore();
    if (!store) return false;
    store.guard(); const db = store.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db.prepare('SELECT revision, data FROM state WHERE singleton = 1').get() as { revision: number; data: string };
      const state = validateState(JSON.parse(row.data));
      const session = findClassification(store, state, scope, id);
      const attempt = session.attempts.at(-1)!;
      if (session.status !== 'PENDING' || attempt.attemptId !== attemptId || !update(attempt, session)) { db.exec('ROLLBACK'); return false; }
      const result = { id, attemptId, phase, status: session.status, claim: attempt.claim, resultDigest: attempt.resultDigest, authority: false };
      const revision = row.revision + 1, requestId = 'classification:' + attemptId + ':' + phase;
      const digest = sha256(result), receipt = { requestId, scope, operation: 'classification.internal.' + phase, requestDigest: digest, revision, uid: store.uid, result };
      const receiptJSON = stableSerialize(receipt);
      if (!Number.isSafeInteger(revision) || db.prepare('SELECT count(*) AS n FROM receipts').get()!.n as number >= LIMITS.receipts || db.prepare('SELECT coalesce(sum(length(CAST(receipt AS BLOB))),0) AS bytes FROM receipts') .get()!.bytes as number + Buffer.byteLength(receiptJSON) > LIMITS.receiptBytes) fail('LIMIT', 'Classification receipt limit');
      validateState(state);
      db.prepare('UPDATE state SET revision = ?, data = ? WHERE singleton = 1 AND revision = ?').run(revision, stableSerialize(state), row.revision);
      db.prepare('INSERT INTO receipts(scope, request_id, digest, receipt) VALUES(?,?,?,?)').run(stableSerialize(scope), requestId, digest, receiptJSON);
      db.prepare('INSERT INTO audit(revision, uid, operation, request_digest, result_digest) VALUES(?,?,?,?,?)').run(revision, store.uid, receipt.operation, digest, sha256(result));
      db.exec('COMMIT'); return true;
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
  }
  return async function run(r: ClassificationRequest, receipt: Receipt<{ attemptId: string }>) {
    const store = getStore()!, attemptId = receipt.result.attemptId;
    store.classificationActive ??= new Set(); store.classificationActive.add(attemptId);
    let invoked = false, result: ClassificationResult;
    try {
      const state = validateState(JSON.parse(store.db.prepare('SELECT data FROM state WHERE singleton = 1').get()!.data as string));
      const attempt = findClassification(store, state, r.scope, r.input.id).attempts.at(-1)!;
      const model = attempt.model;
      const provider = async (input: unknown, context: unknown) => {
        // close may happen between the durable claim and this promise microtask.
        const currentStore = getStore();
        if (!currentStore) throw new Error('Classification runner closed');
        const current = validateState(JSON.parse(currentStore.db.prepare('SELECT data FROM state WHERE singleton = 1').get()!.data as string));
        const session = findClassification(currentStore, current, r.scope, r.input.id);
        if (session.status !== 'PENDING' || session.attempts.at(-1)!.attemptId !== attemptId) throw new Error('Classification attempt no longer active');
        invoked = true;
        let raw;
        try { raw = await store.trustedProviders.classificationAdvisor!(frozenClone(input), context); }
        catch { throw new Error('Classification provider failed'); }
        bounded(raw);
        return frozenClone(raw);
      };
      provider.modelBinding = Object.freeze({ providerId: model.providerId, modelId: model.modelId, revision: model.revision });
      result = await analyzePreparedSourceTaxonomy({ prepared: frozenClone(attempt.prepared), model: model.modelId, advisorProvider: provider, advisorTimeoutMs: model.timeoutMs, analysisAttemptId: attemptId,
        beforeInvocation: (claim: Record<string, unknown>) => {
          bounded(claim);
          const claimed = change(r.scope, r.input.id, attemptId, 'claim', a => {
            if (a.status !== 'PREPARED' || a.claim) return false;
            a.claim = { attemptId, ...claim }; a.status = 'INVOKING'; return true;
          });
          if (!claimed) fail('CLASSIFICATION_UNRESOLVED', 'Invocation claim unavailable');
        }
      });
      bounded(result);
      // Throw, timeout and invalid responses cannot prove provider completion.
      if (result.status === 'ANALYSIS_BLOCKED_ADVISOR' && invoked) result = { status: 'UNKNOWN', advisorStatus: 'ANALYSIS_BLOCKED_ADVISOR', code: 'CLASSIFICATION_PROVIDER_UNRESOLVED', authority: false };
    } catch { result = { status: 'UNKNOWN', code: 'CLASSIFICATION_PROVIDER_UNRESOLVED', authority: false }; }
    try {
      change(r.scope, r.input.id, attemptId, 'complete', (a, session) => {
        if (!['PREPARED', 'INVOKING'].includes(a.status)) return false;
        a.result = result; a.resultDigest = sha256(result);
        a.status = result.status === 'UNKNOWN' ? 'UNKNOWN' : result.status === 'ANALYSIS_BLOCKED_ADVISOR' ? result.status : 'COMPLETED';
        session.status = a.status; store.blob(r.scope, result); return true;
      });
    } finally { store.classificationActive.delete(attemptId); }
    return receipt;
  };
}
