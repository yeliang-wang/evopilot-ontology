import { usabilityDigest, usabilityStable, usabilityFail as fail, validateUsabilityDigest, validateUsabilityScope } from './contract.mjs';
function exact(v, keys) { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k)))
    fail('EVALUATION_SCHEMA'); return v; }
function text(v, max = 256) { if (typeof v !== 'string' || !v.trim() || v.length > max || /[\x00-\x1f\x7f]/.test(v))
    fail('EVALUATION_SCHEMA'); }
function id(v) { text(v, 128); if (!/^[a-z0-9][a-z0-9._-]*$/.test(v))
    fail('EVALUATION_SCHEMA'); }
function count(v, max = Number.MAX_SAFE_INTEGER, min = 0) { if (!Number.isSafeInteger(v) || v < min || v > max)
    fail('EVALUATION_BUDGET'); }
function array(v, max, min = 0) { if (!Array.isArray(v) || v.length > max || v.length < min)
    fail('EVALUATION_SCHEMA'); return v; }
function unique(values) { if (new Set(values).size !== values.length)
    fail('EVALUATION_DUPLICATE'); }
function digestFields(v, keys) { for (const key of keys)
    validateUsabilityDigest(v[key]); }
const equal = (a, b) => usabilityStable(a) === usabilityStable(b);
export function supervisorLabel(workspaceId, nonce) { return 'org.evopilot.eval.' + usabilityDigest(workspaceId).slice(7, 23) + '.' + nonce; }
export function validateEvaluationPolicy(raw, workspaceId) {
    usabilityStable(raw);
    id(workspaceId);
    const p = exact(raw, ['schema', 'phase', 'brokerDigest', 'directNetwork', 'originalSource', 'hiddenOracle', 'priorOutputs', 'hostCredentials', 'dependencies']);
    if (p.schema !== 'evopilot-evaluation-policy/v1' || p.phase !== 'EVALUATION' || ['directNetwork', 'originalSource', 'hiddenOracle', 'priorOutputs', 'hostCredentials'].some(k => p[k] !== 'DENY'))
        fail('EVALUATION_POLICY');
    validateUsabilityDigest(p.brokerDigest);
    const deps = array(p.dependencies, 2, 1);
    const ids = [];
    const kinds = [];
    for (const value of deps) {
        if (!value || typeof value !== 'object' || !('kind' in value))
            fail('EVALUATION_SCHEMA');
        if (value.kind === 'OWNED_SUPERVISOR') {
            const d = exact(value, ['id', 'kind', 'ownerUid', 'domain', 'label', 'nonce', 'root', 'executableDigest', 'workerDigest', 'plistDigest', 'sandboxDigest', 'qualificationDigest', 'operations']);
            id(d.id);
            count(d.ownerUid, 2147483647);
            text(d.nonce, 32);
            if (!/^[a-f0-9]{32}$/.test(d.nonce))
                fail('EVALUATION_POLICY');
            if (!['gui/' + d.ownerUid, 'user/' + d.ownerUid].includes(String(d.domain)) || d.label !== supervisorLabel(workspaceId, d.nonce))
                fail('EVALUATION_OWNERSHIP');
            text(d.root, 1024);
            if (!/^\/(?:[A-Za-z0-9_. -]+\/)*[A-Za-z0-9_. -]+$/.test(d.root) || d.root.split('/').some(s => s === '.' || s === '..'))
                fail('EVALUATION_OWNERSHIP');
            digestFields(d, ['executableDigest', 'workerDigest', 'plistDigest', 'sandboxDigest', 'qualificationDigest']);
            if (!equal(d.operations, ['INSPECT', 'BOOTSTRAP', 'BOOTOUT', 'RECONCILE']))
                fail('EVALUATION_POLICY');
            ids.push(d.id);
            kinds.push('OWNED_SUPERVISOR');
        }
        else if (value.kind === 'BOUND_DATABASE') {
            const d = exact(value, ['id', 'kind', 'driverDigest', 'endpointDigest', 'route', 'namespace', 'credentialRef', 'transportDigest', 'qualificationDigest', 'objects', 'statements']);
            id(d.id);
            id(d.route);
            id(d.namespace);
            text(d.credentialRef, 256);
            if (!/^credential-ref:[a-z0-9][a-z0-9._-]{0,127}$/.test(d.credentialRef))
                fail('EVALUATION_CREDENTIAL_REFERENCE');
            digestFields(d, ['driverDigest', 'endpointDigest', 'transportDigest', 'qualificationDigest']);
            const objects = array(d.objects, 256, 1);
            const objectIds = [];
            const names = [];
            for (const rawObject of objects) {
                const o = exact(rawObject, ['id', 'name', 'ownershipNonce']);
                id(o.id);
                text(o.name, 128);
                text(o.ownershipNonce, 32);
                if (!/^[a-f0-9]{32}$/.test(o.ownershipNonce) || !new RegExp('^ep_eval_' + o.ownershipNonce + '_[a-z0-9_]+$').test(o.name))
                    fail('EVALUATION_OWNERSHIP');
                objectIds.push(o.id);
                names.push(o.name);
            }
            unique(objectIds);
            unique(names);
            const statements = array(d.statements, 512, 1);
            const statementIds = [];
            for (const rawStatement of statements) {
                const s = exact(rawStatement, ['id', 'operation', 'objectIds', 'templateDigest', 'parameters']);
                id(s.id);
                statementIds.push(s.id);
                if (!['READ', 'INSERT', 'UPDATE', 'DELETE', 'CREATE_TABLE', 'DROP_TABLE', 'BEGIN', 'COMMIT', 'ROLLBACK'].includes(String(s.operation)))
                    fail('EVALUATION_STATEMENT');
                validateUsabilityDigest(s.templateDigest);
                const targets = array(s.objectIds, 16, 1);
                unique(targets);
                if (targets.some(k => !objectIds.includes(String(k))))
                    fail('EVALUATION_OWNERSHIP');
                if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(String(s.operation)) && array(s.parameters, 256).length !== 0)
                    fail('EVALUATION_PARAMETER');
                for (const param of array(s.parameters, 256)) {
                    if (!param || typeof param !== 'object' || !('kind' in param))
                        fail('EVALUATION_PARAMETER');
                    if (param.kind === 'INTEGER') {
                        const r = exact(param, ['kind', 'minimum', 'maximum']);
                        if (!Number.isSafeInteger(r.minimum) || !Number.isSafeInteger(r.maximum) || r.minimum > r.maximum)
                            fail('EVALUATION_PARAMETER');
                    }
                    else if (param.kind === 'TEXT') {
                        const r = exact(param, ['kind', 'maxBytes']);
                        count(r.maxBytes, 65536, 1);
                    }
                    else if (param.kind === 'ENUM') {
                        const r = exact(param, ['kind', 'values']);
                        const values = array(r.values, 128, 1);
                        for (const v of values)
                            text(v);
                        unique(values);
                    }
                    else
                        fail('EVALUATION_PARAMETER');
                }
            }
            unique(statementIds);
            ids.push(d.id);
            kinds.push('BOUND_DATABASE');
        }
        else
            fail('EVALUATION_POLICY');
    }
    unique(ids);
    unique(kinds);
    return JSON.parse(usabilityStable(raw));
}
export function validateEvaluationPlan(raw) {
    usabilityStable(raw);
    const p = exact(raw, ['schema', 'workspaceId', 'scope', 'reconstruction', 'oracleDigest', 'environmentDigest', 'dependenciesDigest', 'provider', 'origin', 'policy', 'budget']);
    if (p.schema !== 'evopilot-evaluation-plan/v1' || !['ACTUAL', 'SYNTHETIC'].includes(String(p.origin)))
        fail('EVALUATION_SCHEMA');
    id(p.workspaceId);
    validateUsabilityScope(p.scope);
    validateEvaluationPolicy(p.policy, p.workspaceId);
    const r = exact(p.reconstruction, ['attemptId', 'planDigest', 'claimId', 'receiptDigest', 'outputDigest']);
    id(r.attemptId);
    digestFields(r, ['planDigest', 'claimId', 'receiptDigest', 'outputDigest']);
    digestFields(p, ['oracleDigest', 'environmentDigest', 'dependenciesDigest']);
    const provider = exact(p.provider, ['id', 'version', 'executableDigest', 'configurationDigest']);
    id(provider.id);
    text(provider.version);
    digestFields(provider, ['executableDigest', 'configurationDigest']);
    const b = exact(p.budget, ['wallMs', 'maxSessions', 'maxConnections', 'maxRows', 'maxOutputBytes', 'maxOperations']);
    count(b.wallMs, 3600000, 1);
    count(b.maxSessions, 4, 1);
    count(b.maxConnections, 256);
    count(b.maxRows, 10000000);
    count(b.maxOutputBytes, 67108864, 1);
    count(b.maxOperations, 100000, 1);
    const policy = p.policy;
    if (!policy.dependencies.some(d => d.kind === 'BOUND_DATABASE') && (b.maxConnections !== 0 || b.maxRows !== 0))
        fail('EVALUATION_BUDGET');
    return JSON.parse(usabilityStable(raw));
}
/** A request contains a statement ID and bound values; it never contains SQL or route credentials. */
export function validateDatabaseCall(dependency, raw) {
    usabilityStable(raw);
    const v = exact(raw, ['statementId', 'parameters']);
    const s = dependency.statements.find(s => s.id === v.statementId);
    if (!s)
        fail('EVALUATION_STATEMENT');
    const values = array(v.parameters, 256);
    if (values.length !== s.parameters.length)
        fail('EVALUATION_PARAMETER');
    for (let i = 0; i < values.length; i++) {
        const value = values[i], rule = s.parameters[i];
        if (rule.kind === 'INTEGER') {
            if (!Number.isSafeInteger(value) || value < rule.minimum || value > rule.maximum)
                fail('EVALUATION_PARAMETER');
        }
        else if (rule.kind === 'ENUM') {
            if (typeof value !== 'string' || !rule.values.includes(value))
                fail('EVALUATION_PARAMETER');
        }
        else if (typeof value !== 'string' || value.includes('\0') || new TextEncoder().encode(value).length > rule.maxBytes)
            fail('EVALUATION_PARAMETER');
    }
    return JSON.parse(usabilityStable(raw));
}
export function validateSupervisorCall(dependency, raw) {
    usabilityStable(raw);
    const v = exact(raw, ['operation', 'label']);
    if (!dependency.operations.includes(v.operation) || v.label !== dependency.label)
        fail('EVALUATION_OWNERSHIP');
    return JSON.parse(usabilityStable(raw));
}
export function validateEvaluationClaim(raw) {
    usabilityStable(raw);
    const c = exact(raw, ['workspaceId', 'scope', 'sessionId', 'claimId', 'planDigest', 'plan', 'ordinal', 'admittedAt', 'remaining']);
    const p = validateEvaluationPlan(c.plan);
    id(c.sessionId);
    count(c.ordinal, p.budget.maxSessions, 1);
    text(c.admittedAt);
    if (!Number.isFinite(Date.parse(c.admittedAt)))
        fail('EVALUATION_SCHEMA');
    if (c.workspaceId !== p.workspaceId || !equal(c.scope, p.scope) || c.planDigest !== usabilityDigest(p))
        fail('EVALUATION_BINDING');
    const remaining = exact(c.remaining, ['wallMs', 'maxConnections', 'maxRows', 'maxOutputBytes', 'maxOperations']);
    for (const key of Object.keys(remaining))
        count(remaining[key], p.budget[key], key === 'wallMs' ? 1 : 0);
    const { claimId, ...body } = c;
    if (claimId !== usabilityDigest(body))
        fail('EVALUATION_BINDING');
    return JSON.parse(usabilityStable(raw));
}
export function validateEvaluationReceipt(raw, claim) {
    validateEvaluationClaim(claim);
    usabilityStable(raw);
    const r = exact(raw, ['schema', 'claimId', 'planDigest', 'sessionId', 'origin', 'outputDigest', 'oracleDigest', 'environmentDigest', 'dependenciesDigest', 'policyDigest', 'providerDigest', 'status', 'usage', 'violations', 'effects', 'cleanup', 'containment', 'enforcementDigest', 'diagnostic', 'digest']);
    const p = claim.plan;
    if (r.schema !== 'evopilot-evaluation-receipt/v1' || r.claimId !== claim.claimId || r.planDigest !== claim.planDigest || r.sessionId !== claim.sessionId || r.origin !== p.origin || r.outputDigest !== p.reconstruction.outputDigest || r.policyDigest !== usabilityDigest(p.policy) || r.providerDigest !== usabilityDigest(p.provider))
        fail('EVALUATION_BINDING');
    for (const k of ['oracleDigest', 'environmentDigest', 'dependenciesDigest'])
        if (r[k] !== p[k])
            fail('EVALUATION_BINDING');
    if (!['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(String(r.status)))
        fail('EVALUATION_SCHEMA');
    validateUsabilityDigest(r.enforcementDigest);
    if (r.diagnostic !== null)
        text(r.diagnostic, 1024);
    const usage = exact(r.usage, ['wallMs', 'connections', 'rows', 'outputBytes', 'operations']);
    for (const value of Object.values(usage))
        if (value !== null)
            count(value);
    const violations = exact(r.violations, ['directConnections', 'unrelatedPeers', 'sourceReads', 'oracleReads', 'credentialReads', 'foreignEffects']);
    for (const value of Object.values(violations))
        count(value);
    const effects = array(r.effects, 100000);
    const effectIds = [];
    for (const effect of effects) {
        const e = exact(effect, ['id', 'dependencyId', 'targetId', 'operation', 'outcome', 'traceDigest']);
        id(e.id);
        effectIds.push(e.id);
        const d = p.policy.dependencies.find(d => d.id === e.dependencyId);
        if (!d || !['CONFIRMED', 'UNKNOWN'].includes(String(e.outcome)))
            fail('EVALUATION_EFFECT');
        validateUsabilityDigest(e.traceDigest);
        if (d.kind === 'OWNED_SUPERVISOR') {
            if (e.targetId !== d.label || !d.operations.includes(e.operation))
                fail('EVALUATION_EFFECT');
        }
        else {
            const statement = d.statements.find(s => s.id === e.operation);
            if (!statement || !statement.objectIds.includes(String(e.targetId)))
                fail('EVALUATION_EFFECT');
        }
    }
    unique(effectIds);
    const cleanup = array(r.cleanup, 2);
    unique(cleanup.map(c => c.dependencyId));
    for (const rawCleanup of cleanup) {
        const c = exact(rawCleanup, ['dependencyId', 'ownedTargets', 'confirmedAbsent', 'traceDigest']);
        const d = p.policy.dependencies.find(d => d.id === c.dependencyId);
        if (!d || typeof c.confirmedAbsent !== 'boolean')
            fail('EVALUATION_CLEANUP');
        validateUsabilityDigest(c.traceDigest);
        const expected = d.kind === 'OWNED_SUPERVISOR' ? [d.label] : d.objects.map(o => o.id);
        if (!equal(c.ownedTargets, expected))
            fail('EVALUATION_CLEANUP');
    }
    const containment = array(r.containment, 1);
    for (const rawContainment of containment) {
        const c = exact(rawContainment, ['dependencyId', 'sandboxDigest', 'allProcessesClosed', 'traceDigest']);
        const d = p.policy.dependencies.find(d => d.id === c.dependencyId);
        if (!d || d.kind !== 'OWNED_SUPERVISOR' || c.sandboxDigest !== d.sandboxDigest || typeof c.allProcessesClosed !== 'boolean')
            fail('EVALUATION_CONTAINMENT');
        validateUsabilityDigest(c.traceDigest);
    }
    if (r.status === 'SUCCEEDED') {
        const limits = { wallMs: 'wallMs', connections: 'maxConnections', rows: 'maxRows', outputBytes: 'maxOutputBytes', operations: 'maxOperations' };
        for (const key of Object.keys(limits))
            if (usage[key] === null || usage[key] > claim.remaining[limits[key]])
                fail('EVALUATION_BUDGET');
        if (Object.values(violations).some(n => n !== 0) || effects.some(e => e.outcome !== 'CONFIRMED'))
            fail('EVALUATION_INCOMPLETE');
        if (cleanup.length !== p.policy.dependencies.length || cleanup.some(c => !c.confirmedAbsent) || containment.length !== p.policy.dependencies.filter(d => d.kind === 'OWNED_SUPERVISOR').length || containment.some(c => !c.allProcessesClosed))
            fail('EVALUATION_INCOMPLETE');
        if (usage.operations < effects.length)
            fail('EVALUATION_USAGE');
    }
    const { digest, ...body } = r;
    if (digest !== usabilityDigest(body))
        fail('EVALUATION_RECEIPT_DIGEST');
    return JSON.parse(usabilityStable(raw));
}
export function validateEvaluationEvidence(raw) {
    const e = exact(raw, ['plan', 'claim', 'receipt']);
    const plan = validateEvaluationPlan(e.plan), claim = validateEvaluationClaim(e.claim);
    if (!equal(plan, claim.plan))
        fail('EVALUATION_BINDING');
    const receipt = validateEvaluationReceipt(e.receipt, claim);
    return { plan, claim, receipt };
}
