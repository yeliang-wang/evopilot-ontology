import { createHash } from 'node:crypto';
function freeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}
export const USABILITY_LEVELS = freeze({
    L1: { name: 'Understanding', includes: [], scenarios: ['Discovery', 'Onboarding', 'Domain questions', 'Handover', 'Prototyping'] },
    L2: { name: 'Implementation specification', includes: ['L1'], scenarios: ['Module implementation', 'Scoped rewrite', 'Adapters', 'Version evolution'] },
    L3: { name: 'Reconstruction verified', includes: ['L1', 'L2'], scenarios: ['Verified module replacement', 'Bounded reconstruction', 'Platform migration'] },
});
export const ASSESSMENT_STATES = Object.freeze(['NOT_EVALUATED', 'IN_PROGRESS', 'VERIFIED', 'FAILED', 'INCOMPLETE', 'STALE', 'UNSUPPORTED']);
export const BEHAVIOR_FACETS = Object.freeze(['inputs', 'outputs', 'interfaces', 'states', 'preconditions', 'postconditions', 'errors', 'sideEffects', 'idempotency', 'concurrency', 'recovery', 'dependencies', 'environment']);
export const USABILITY_LIMITS = Object.freeze({ inputBytes: 1048576, evidenceBytes: 1048576, totalEvidenceBytes: 4194304, questions: 128, behaviors: 64, citations: 128, evidenceTimeoutMs: 2000, totalTimeoutMs: 10000 });
export function usabilityFail(code) { throw Object.assign(new Error(code), { code }); }
export function usabilityStable(value) {
    let nodes = 0;
    const ancestors = new Set();
    function encode(v, depth) {
        if (++nodes > 50000 || depth > 32)
            usabilityFail('USABILITY_LIMIT');
        if (typeof v === 'string' && Buffer.byteLength(v) > USABILITY_LIMITS.inputBytes)
            usabilityFail('USABILITY_LIMIT');
        if (v === null || typeof v === 'boolean' || typeof v === 'string')
            return JSON.stringify(v);
        if (typeof v === 'number' && Number.isFinite(v))
            return JSON.stringify(v);
        if (!v || typeof v !== 'object' || ancestors.has(v))
            usabilityFail('USABILITY_INVALID_JSON');
        ancestors.add(v);
        try {
            if (Array.isArray(v)) {
                if (v.length > 50000)
                    usabilityFail('USABILITY_LIMIT');
                const values = [];
                for (let i = 0; i < v.length; i++) {
                    const d = Object.getOwnPropertyDescriptor(v, String(i));
                    if (!d || !Object.hasOwn(d, 'value'))
                        usabilityFail('USABILITY_INVALID_JSON');
                    values.push(encode(d.value, depth + 1));
                }
                return '[' + values.join(',') + ']';
            }
            if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)
                usabilityFail('USABILITY_INVALID_JSON');
            const r = v;
            return '{' + Object.keys(r).sort().map(k => {
                if (['__proto__', 'prototype', 'constructor'].includes(k) || !Object.hasOwn(Object.getOwnPropertyDescriptor(r, k) ?? {}, 'value'))
                    usabilityFail('USABILITY_INVALID_JSON');
                return JSON.stringify(k) + ':' + encode(r[k], depth + 1);
            }).join(',') + '}';
        }
        finally {
            ancestors.delete(v);
        }
    }
    const raw = encode(value, 0);
    if (Buffer.byteLength(raw) > USABILITY_LIMITS.inputBytes)
        usabilityFail('USABILITY_LIMIT');
    return raw;
}
export const usabilityDigest = (value) => 'sha256:' + createHash('sha256').update(usabilityStable(value)).digest('hex');
export const usabilityBytesDigest = (value) => 'sha256:' + createHash('sha256').update(value).digest('hex');
export const USABILITY_STANDARD_DIGEST = usabilityDigest({ schema: 'evopilot-usability-standard/v1', levels: USABILITY_LEVELS, assessmentStates: ASSESSMENT_STATES, behaviorFacets: BEHAVIOR_FACETS, preflightAwardsLevel: false, industryCertification: false });
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value))
    usabilityFail('USABILITY_SCHEMA'); return value; }
function exact(value, keys) { const r = object(value); if (Object.keys(r).sort().join('\0') !== [...keys].sort().join('\0'))
    usabilityFail('USABILITY_SCHEMA'); return r; }
function text(value, max = 8192) { if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0'))
    usabilityFail('USABILITY_SCHEMA'); }
function slug(value) { text(value, 128); if (!/^[a-z0-9][a-z0-9:._-]*$/.test(value))
    usabilityFail('USABILITY_SCHEMA'); }
export function validateUsabilityDigest(v) { if (typeof v !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(v))
    usabilityFail('USABILITY_DIGEST'); }
function array(v, max) { if (!Array.isArray(v) || v.length > max)
    usabilityFail('USABILITY_LIMIT'); return v; }
function unique(values, key) { if (new Set(values.map(key)).size !== values.length)
    usabilityFail('USABILITY_DUPLICATE'); }
export function validateUsabilityScope(v) { const r = exact(v, ['visibility', 'projectId']); if (!['private', 'public'].includes(String(r.visibility)))
    usabilityFail('USABILITY_SCHEMA'); slug(r.projectId); return structuredClone(r); }
export function validateUsabilityPins(v) {
    const r = exact(v, ['sourceDigest', 'assetDigests', 'environmentDigest', 'dependenciesDigest', 'oracleDigest', 'inputManifestDigest']);
    for (const k of ['sourceDigest', 'environmentDigest', 'dependenciesDigest'])
        validateUsabilityDigest(r[k]);
    for (const k of ['oracleDigest', 'inputManifestDigest'])
        if (r[k] !== null)
            validateUsabilityDigest(r[k]);
    const assets = array(r.assetDigests, 64);
    if (!assets.length)
        usabilityFail('USABILITY_EMPTY_INVENTORY');
    assets.forEach(validateUsabilityDigest);
    unique(assets, x => x);
    return structuredClone(r);
}
export function validateUsabilityInventory(value) {
    usabilityStable(value);
    const r = exact(value, ['schema', 'workspaceId', 'scope', 'slice', 'targetLevel', 'pins', 'reviewReference', 'questions', 'behaviors']);
    if (r.schema !== 'evopilot-usability-inventory/v1' || !Object.hasOwn(USABILITY_LEVELS, String(r.targetLevel)))
        usabilityFail('USABILITY_SCHEMA');
    slug(r.workspaceId);
    validateUsabilityScope(r.scope);
    validateUsabilityPins(r.pins);
    text(r.reviewReference);
    const s = exact(r.slice, ['id', 'version', 'title', 'exclusions']);
    slug(s.id);
    text(s.version, 128);
    text(s.title, 512);
    array(s.exclusions, 128).forEach(x => text(x));
    const qs = array(r.questions, USABILITY_LIMITS.questions), bs = array(r.behaviors, USABILITY_LIMITS.behaviors);
    if (!qs.length)
        usabilityFail('USABILITY_EMPTY_INVENTORY');
    qs.forEach(q => { const o = exact(q, ['id', 'question']); slug(o.id); text(o.question); });
    unique(qs, q => object(q).id);
    bs.forEach(b => { const o = exact(b, ['id', 'description', 'excludedFacets']); slug(o.id); text(o.description); const xs = array(o.excludedFacets, BEHAVIOR_FACETS.length); unique(xs, x => object(x).facet); xs.forEach(x => { const f = exact(x, ['facet', 'reason', 'reviewReference']); if (!BEHAVIOR_FACETS.includes(f.facet))
        usabilityFail('USABILITY_SCHEMA'); text(f.reason); text(f.reviewReference); }); });
    unique(bs, b => object(b).id);
    return structuredClone(r);
}
function statement(v) {
    const r = exact(v, ['text', 'citations']);
    text(r.text);
    const refs = array(r.citations, USABILITY_LIMITS.citations);
    unique(refs, x => usabilityStable(x));
    refs.forEach(c => { const o = exact(c, ['assetDigest', 'path', 'contentDigest']); validateUsabilityDigest(o.assetDigest); validateUsabilityDigest(o.contentDigest); text(o.path, 512); if (o.path.startsWith('/') || o.path.includes('\\') || o.path.split('/').some(x => !x || x === '.' || x === '..') || o.path.includes(':'))
        usabilityFail('USABILITY_PATH'); });
}
export function validateUsabilitySpecification(value) {
    usabilityStable(value);
    const r = exact(value, ['schema', 'inventoryDigest', 'answers', 'behaviors']);
    if (r.schema !== 'evopilot-usability-specification/v1')
        usabilityFail('USABILITY_SCHEMA');
    validateUsabilityDigest(r.inventoryDigest);
    const answers = array(r.answers, USABILITY_LIMITS.questions), behaviors = array(r.behaviors, USABILITY_LIMITS.behaviors);
    unique(answers, a => object(a).questionId);
    unique(behaviors, b => object(b).behaviorId);
    answers.forEach(a => { const o = exact(a, ['questionId', 'status', 'statement']); slug(o.questionId); if (!['RESOLVED', 'AMBIGUOUS', 'MISSING', 'CONFLICT', 'DRAFT_ONLY'].includes(String(o.status)))
        usabilityFail('USABILITY_SCHEMA'); if (o.statement !== null)
        statement(o.statement); });
    behaviors.forEach(b => { const o = exact(b, ['behaviorId', 'facets']); slug(o.behaviorId); for (const [k, v] of Object.entries(object(o.facets))) {
        if (!BEHAVIOR_FACETS.includes(k))
            usabilityFail('USABILITY_SCHEMA');
        statement(v);
    } });
    const refs = answers.flatMap(a => { const s = object(a).statement; return s === null ? [] : array(object(s).citations, 128); }).concat(behaviors.flatMap(b => Object.values(object(object(b).facets)).flatMap(s => array(object(s).citations, 128))));
    if (new Set(refs.map(usabilityStable)).size > USABILITY_LIMITS.citations)
        usabilityFail('USABILITY_LIMIT');
    return structuredClone(r);
}
