import { BEHAVIOR_FACETS, usabilityStable, usabilityDigest, usabilityFail as fail, validateUsabilityScope, validateUsabilityDigest } from './contract.mjs';
export const ORACLE_OBSERVABLE_FACETS = Object.freeze(['outputs', 'states', 'errors', 'sideEffects', 'idempotency', 'concurrency', 'recovery']);
export const ORACLE_LIMITS = Object.freeze({ cases: 256, negativeControls: 128, tolerancesPerCase: 32 });
function exact(v, keys, optional = []) { if (!v || typeof v !== 'object' || Array.isArray(v) || keys.some(k => !Object.hasOwn(v, k)) || Object.keys(v).some(k => !keys.includes(k) && !optional.includes(k)))
    fail('ORACLE_SCHEMA'); return v; }
function text(v, max = 512) { if (typeof v !== 'string' || !v.trim() || v.length > max || v.includes('\0'))
    fail('ORACLE_SCHEMA'); }
function id(v) { text(v, 128); if (!/^[a-z0-9][a-z0-9:._-]*$/.test(v))
    fail('ORACLE_SCHEMA'); }
function array(v, max) { if (!Array.isArray(v) || v.length > max)
    fail('ORACLE_LIMIT'); return v; }
function unique(rows, key) { if (new Set(rows.map(key)).size !== rows.length)
    fail('ORACLE_DUPLICATE'); }
function observation(v) { const r = exact(v, ['output', 'state', 'error', 'effects']); array(r.effects, 4096); }
function at(value, path) { let v = value; for (const k of path) {
    if (!v || typeof v !== 'object' || !Object.hasOwn(v, k))
        return undefined;
    v = v[k];
} return v; }
export function compareBehavior(expected, actual, tolerances) {
    const differences = [];
    function compare(a, b, field, path) {
        const tolerance = tolerances.find(t => t.field === field && usabilityStable(t.path) === usabilityStable(path));
        if (tolerance && typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tolerance.absolute + tolerance.relative * Math.abs(a))
            return;
        if (usabilityStable(a) === usabilityStable(b))
            return;
        if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b) && usabilityStable(Object.keys(a).sort()) === usabilityStable(Object.keys(b).sort())) {
            for (const key of Object.keys(a))
                compare(a[key], b[key], field, [...path, key]);
        }
        else
            differences.push(field + ':' + usabilityStable(path));
    }
    for (const field of ['output', 'state', 'error', 'effects'])
        compare(expected[field], actual[field], field, []);
    return differences;
}
export function validateBehaviorOracle(raw) {
    usabilityStable(raw);
    const r = exact(raw, ['schema', 'author', 'cases', 'negativeControls']);
    if (r.schema !== 'evopilot-behavior-oracle/v1')
        fail('ORACLE_SCHEMA');
    const author = exact(r.author, ['actor', 'independent', 'origin']);
    text(author.actor, 256);
    if (typeof author.independent !== 'boolean' || !['ACTUAL', 'SYNTHETIC'].includes(String(author.origin)))
        fail('ORACLE_SCHEMA');
    const cases = array(r.cases, ORACLE_LIMITS.cases);
    if (!cases.length)
        fail('ORACLE_EMPTY');
    for (const value of cases) {
        const c = exact(value, ['id', 'behaviorId', 'facets', 'purpose', 'input', 'expected', 'tolerances']);
        id(c.id);
        id(c.behaviorId);
        text(c.purpose, 8192);
        observation(c.expected);
        const facets = array(c.facets, BEHAVIOR_FACETS.length);
        if (!facets.length || facets.some(f => !BEHAVIOR_FACETS.includes(f)))
            fail('ORACLE_SCHEMA');
        unique(facets, x => x);
        const tolerances = array(c.tolerances, ORACLE_LIMITS.tolerancesPerCase);
        for (const rawTolerance of tolerances) {
            const t = exact(rawTolerance, ['field', 'path', 'absolute', 'relative']);
            if (!['output', 'state'].includes(String(t.field)))
                fail('ORACLE_SCHEMA');
            const path = array(t.path, 24);
            for (const k of path) {
                text(k);
                if (['__proto__', 'prototype', 'constructor'].includes(k))
                    fail('ORACLE_SCHEMA');
            }
            for (const key of ['absolute', 'relative'])
                if (typeof t[key] !== 'number' || !Number.isFinite(t[key]) || t[key] < 0)
                    fail('ORACLE_SCHEMA');
            if (typeof at(c.expected[t.field], path) !== 'number')
                fail('ORACLE_TOLERANCE');
        }
        unique(tolerances, x => { const t = x; return usabilityStable([t.field, t.path]); });
    }
    unique(cases, x => x.id);
    const controls = array(r.negativeControls, ORACLE_LIMITS.negativeControls);
    if (!controls.length)
        fail('ORACLE_CONTROLS_REQUIRED');
    for (const value of controls) {
        const c = exact(value, ['id', 'caseId', 'purpose', 'actual']);
        id(c.id);
        id(c.caseId);
        text(c.purpose, 8192);
        observation(c.actual);
        const target = cases.find(x => x.id === c.caseId);
        if (!target)
            fail('ORACLE_UNKNOWN_CASE');
        if (!compareBehavior(target.expected, c.actual, target.tolerances).length)
            fail('ORACLE_INEFFECTIVE_CONTROL');
    }
    unique(controls, x => x.id);
    return JSON.parse(usabilityStable(raw));
}
export const behaviorOracleDigest = (oracle) => usabilityDigest(validateBehaviorOracle(oracle));
export function validateReconstructionObservation(raw) {
    usabilityStable(raw);
    const r = exact(raw, ['schema', 'workspaceId', 'scope', 'attemptId', 'inventoryDigest', 'specificationDigest', 'oracleDigest', 'inputManifestDigest', 'environmentDigest', 'dependenciesDigest', 'outputDigest', 'executorDigest', 'origin', 'inputMode', 'independent', 'isolated', 'status', 'cases', 'digest'], ['execution']);
    if (r.schema !== 'evopilot-reconstruction-observation/v1')
        fail('ORACLE_SCHEMA');
    id(r.workspaceId);
    id(r.attemptId);
    validateUsabilityScope(r.scope);
    for (const k of ['inventoryDigest', 'specificationDigest', 'oracleDigest', 'inputManifestDigest', 'environmentDigest', 'dependenciesDigest', 'outputDigest', 'executorDigest', 'digest'])
        validateUsabilityDigest(r[k]);
    if (!['ACTUAL', 'SYNTHETIC'].includes(String(r.origin)) || !['ASSETS_ONLY', 'SOURCE_ASSISTED'].includes(String(r.inputMode)) || typeof r.independent !== 'boolean' || typeof r.isolated !== 'boolean' || !['SUCCEEDED', 'FAILED', 'INCOMPLETE', 'UNKNOWN'].includes(String(r.status)))
        fail('ORACLE_SCHEMA');
    if (r.execution !== undefined) {
        const execution = exact(r.execution, ['planDigest', 'claimId', 'cleanWorkspaceId', 'receiptDigest']);
        for (const k of ['planDigest', 'claimId', 'receiptDigest'])
            validateUsabilityDigest(execution[k]);
        text(execution.cleanWorkspaceId, 256);
    }
    const cases = array(r.cases, ORACLE_LIMITS.cases);
    for (const value of cases) {
        const c = exact(value, ['caseId', 'inputDigest', 'status', 'actual']);
        id(c.caseId);
        validateUsabilityDigest(c.inputDigest);
        if (!['COMPLETE', 'FAILED', 'SKIPPED', 'UNKNOWN'].includes(String(c.status)))
            fail('ORACLE_SCHEMA');
        if (c.actual !== null)
            observation(c.actual);
        if (c.status === 'COMPLETE' && c.actual === null)
            fail('ORACLE_SCHEMA');
    }
    unique(cases, x => x.caseId);
    const { digest, ...body } = r;
    if (digest !== usabilityDigest(body))
        fail('ORACLE_RECEIPT_DIGEST');
    return JSON.parse(usabilityStable(raw));
}
