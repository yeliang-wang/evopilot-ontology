import { errorCode } from './state.js';
import { isPromise } from 'node:util/types';
import { exactFields, sha256, stableSerialize, frozenClone } from '../vendor/compatibility/v1/reference.mjs';
import { bounded, fail, slug, LIMITS } from './state.js';
import { taxonomy as legacy_taxonomy } from "./compat/index.mjs";
const { resolveTaxonomy } = legacy_taxonomy;
import { classification as legacy_classification } from "./compat/index.mjs";
const { prepareResolvedSourceTaxonomyAnalysis, createClassificationHandoff } = legacy_classification;
export const classificationOperations = Object.freeze(['start', 'inspect', 'resume', 'reanalyze', 'list', 'continue_to_harness', 'close'].map(x => 'classification.' + x));
export const classificationMutations = Object.freeze(['start', 'reanalyze', 'continue_to_harness', 'close'].map(x => 'classification.' + x));
export const classificationDispatch = Object.freeze(['classification.start', 'classification.reanalyze']);
export function validateClassificationRequest(r) {
    const fields = classificationDispatch.includes(r.operation) ? ['id', 'sourceId', 'taxonomy'] : r.operation === 'classification.list' ? [] : r.operation === 'classification.continue_to_harness' ? ['id', 'decisionToken', 'humanEvidence'] : ['id'];
    exactFields(r.input, fields);
    if (r.input.id !== undefined)
        slug(r.input.id);
    if (classificationDispatch.includes(r.operation)) {
        slug(r.input.sourceId);
        if (!r.input.taxonomy || typeof r.input.taxonomy !== 'object' || Array.isArray(r.input.taxonomy))
            fail('INVALID_REQUEST', 'Inline taxonomy document required');
        try {
            resolveTaxonomy(r.input.taxonomy);
        }
        catch {
            fail('INVALID_TAXONOMY', 'Inline taxonomy failed owned resolver validation');
        }
    }
    if (r.operation === 'classification.continue_to_harness') {
        const h = r.input.humanEvidence;
        exactFields(h, ['uid', 'analysisResultDigest', 'evidenceRef']);
        if (!Number.isSafeInteger(h.uid) || h.uid < 0 || typeof h.evidenceRef !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,255}$/.test(h.evidenceRef) || !/^sha256:[a-f0-9]{64}$/.test(h.analysisResultDigest) || typeof r.input.decisionToken !== 'string')
            fail('INVALID_REQUEST', 'Exact human evidence required');
    }
}
export function findClassification(store, state, scope, id) {
    const session = (state.classificationSessions ?? []).find(s => s.id === id && stableSerialize(s.scope) === stableSerialize(scope));
    if (!session)
        fail('NOT_FOUND', 'Classification session not found in scope');
    verifyClassification(store, session);
    return session;
}
export function verifyClassification(store, session) {
    for (const attempt of session.attempts) {
        for (const key of ['prepared', 'result'])
            if (attempt[key]) {
                if (sha256(attempt[key]) !== attempt[key === 'prepared' ? 'preparedDigest' : 'resultDigest'])
                    fail('CORRUPT_STATE', 'Classification evidence digest mismatch');
                store.verifyBlob(session.scope, attempt[key]);
            }
    }
    for (const handoff of session.handoffs)
        store.verifyBlob(session.scope, handoff);
}
export function classificationView(store, session) {
    const view = structuredClone(session);
    if (view.status === 'PENDING' && !store.classificationActive?.has(view.attempts.at(-1).attemptId))
        view.status = 'UNKNOWN';
    view.authority = false;
    return view;
}
export function prepareClassification(store, state, r) {
    const providers = store.trustedProviders;
    if (!providers.classificationAdvisor || !providers.classificationModel)
        fail('CLASSIFICATION_PROVIDER_UNAVAILABLE', 'Classification advisor and model binding are not configured');
    if (!providers.resolveClassificationSource)
        fail('CLASSIFICATION_SOURCE_UNAVAILABLE', 'Registered source resolver is not configured');
    let session = (state.classificationSessions ?? []).find(s => s.id === r.input.id && stableSerialize(s.scope) === stableSerialize(r.scope));
    if (r.operation === 'classification.start') {
        if (session)
            fail('SESSION_EXISTS', 'Session identity already exists');
        if ((state.classificationSessions?.length ?? 0) >= LIMITS.classificationSessions)
            fail('LIMIT', 'Classification session limit');
    }
    else {
        session = findClassification(store, state, r.scope, r.input.id);
        if (!['COMPLETED', 'ANALYSIS_BLOCKED_ADVISOR'].includes(session.status))
            fail('CLASSIFICATION_UNRESOLVED', 'Only known completed attempts permit explicit reanalysis');
        if (session.sourceId !== r.input.sourceId)
            fail('SOURCE_MISMATCH', 'Session source identity is pinned');
        if (session.attempts.length >= LIMITS.classificationAttempts)
            fail('LIMIT', 'Classification attempt limit');
    }
    let resolved;
    try {
        resolved = providers.resolveClassificationSource(frozenClone({ sourceId: r.input.sourceId, scope: r.scope, workspace: store.identity }));
    }
    catch {
        fail('CLASSIFICATION_SOURCE_UNAVAILABLE', 'Registered source resolution failed');
    }
    // Consume real Promise rejection without reading a returned then property.
    if (isPromise(resolved)) {
        Promise.prototype.then.call(resolved, undefined, () => { });
        fail('CLASSIFICATION_SOURCE_ASYNC', 'Synchronous source resolver required');
    }
    bounded(resolved);
    exactFields(resolved, ['sourceId', 'scope', 'workspace', 'resolvedSource']);
    if (resolved.sourceId !== r.input.sourceId || stableSerialize(resolved.scope) !== stableSerialize(r.scope) || stableSerialize(resolved.workspace) !== stableSerialize(store.identity))
        fail('SOURCE_BINDING_MISMATCH', 'Resolver must return the exact source, scope and workspace binding');
    const source = resolved.resolvedSource;
    if (!source || typeof source !== 'object' || Array.isArray(source) || source.sourceId !== r.input.sourceId || source.sourceExecution !== false || source.schema !== 'evopilot-harness-source-resolution/v1' || !source.sourceDescriptor || !/^sha256:[a-f0-9]{64}$/.test(source.sourceDescriptorDigest) || !/^sha256:[a-f0-9]{64}$/.test(source.sourceResolutionDigest))
        fail('SOURCE_BINDING_MISMATCH', 'Verified resolved source descriptor required');
    exactFields(source, ['schema', 'sourceId', 'type', 'sourceDescriptor', 'sourceDescriptorDigest', 'sourceResolutionDigest', 'acquisitionPolicy', 'sourceExecution', 'path', 'files'], ['resolvedCommit', 'acquiredAt', 'networkAcquisition', 'canonicalRepository', 'requestedRef', 'cacheKey', 'provenance', 'licenseDiscovery']);
    const { sourceResolutionDigest, acquiredAt, networkAcquisition, path, files, ...resolutionCore } = source;
    if (source.sourceDescriptor.sourceId !== source.sourceId || source.sourceDescriptor.type !== source.type || source.sourceDescriptor.sourceExecutionAllowed !== false || source.sourceDescriptorDigest !== sha256(source.sourceDescriptor) || sourceResolutionDigest !== sha256(resolutionCore))
        fail('SOURCE_BINDING_MISMATCH', 'Resolved source digests or descriptor binding differ');
    // All resolver JSON descriptors and exact bindings are checked before source I/O.
    let prepared;
    try {
        prepared = prepareResolvedSourceTaxonomyAnalysis({ resolvedSource: frozenClone(source), resolvedTaxonomy: resolveTaxonomy(r.input.taxonomy) });
    }
    catch {
        fail('CLASSIFICATION_SOURCE_INVALID', 'Source or taxonomy preparation failed');
    }
    bounded(prepared);
    const attemptId = sha256({ workspace: store.identity, scope: r.scope, id: r.input.id, requestId: r.requestId });
    const attempt = { attemptId, requestId: r.requestId, sourceId: r.input.sourceId, taxonomy: r.input.taxonomy, prepared, preparedDigest: sha256(prepared), model: providers.classificationModel, status: 'PREPARED', claim: null, result: null, resultDigest: null };
    const reserved = (state.classificationSessions ?? []).flatMap(s => s.attempts).reduce((n, a) => n + (['PREPARED', 'INVOKING'].includes(a.status) ? LIMITS.requestBytes : 0), 0);
    if (Buffer.byteLength(stableSerialize(state)) + Buffer.byteLength(stableSerialize(attempt)) + reserved + LIMITS.requestBytes > LIMITS.stateBytes - 65536)
        fail('LIMIT', 'Classification completion capacity exhausted');
    store.blob(r.scope, prepared);
    if (!session) {
        session = { id: r.input.id, scope: r.scope, sourceId: r.input.sourceId, ownerUid: store.uid, status: 'PENDING', attempts: [], handoffs: [] };
        (state.classificationSessions ??= []).push(session);
    }
    session.attempts.push(attempt);
    session.status = 'PENDING';
    return { id: session.id, attemptId, status: 'PENDING', authority: false };
}
export function operateClassification(store, state, request) {
    const r = request;
    if (classificationDispatch.includes(r.operation))
        return prepareClassification(store, state, r);
    if (r.operation === 'classification.list')
        return (state.classificationSessions ?? []).filter(s => stableSerialize(s.scope) === stableSerialize(r.scope)).map(s => { verifyClassification(store, s); return { id: s.id, sourceId: s.sourceId, status: classificationView(store, s).status, authority: false }; });
    const session = findClassification(store, state, r.scope, r.input.id);
    if (['classification.inspect', 'classification.resume'].includes(r.operation))
        return classificationView(store, session);
    if (r.operation === 'classification.close') {
        session.status = 'CLOSED';
        return { id: session.id, status: 'CLOSED', authority: false };
    }
    if (session.status !== 'COMPLETED')
        fail('CLASSIFICATION_MATCH_REQUIRED', 'Completed matched classification required');
    if (session.handoffs.length >= LIMITS.classificationHandoffs)
        fail('LIMIT', 'Classification handoff limit');
    const result = session.attempts.at(-1).result;
    const human = r.input.humanEvidence;
    if (human.uid !== store.uid || human.uid !== session.ownerUid || human.analysisResultDigest !== result?.analysisResultDigest)
        fail('HUMAN_EVIDENCE_MISMATCH', 'Owning human evidence must bind the exact result');
    let handoff;
    try {
        handoff = createClassificationHandoff({ classificationSessionId: session.id, result, decidedBy: { ...human }, decisionToken: r.input.decisionToken });
    }
    catch (e) {
        fail(['CLASSIFICATION_SOURCE_DRIFT', 'CLASSIFICATION_MATCH_REQUIRED', 'CLASSIFICATION_REPLAY_INTEGRITY_FAILED', 'EXPLICIT_HANDOFF_DECISION_REQUIRED'].includes((errorCode(e) ?? '')) ? (errorCode(e) ?? '') : 'CLASSIFICATION_HANDOFF_BLOCKED', 'Classification handoff checks failed');
    }
    store.blob(r.scope, handoff);
    session.handoffs.push(handoff);
    return handoff;
}
