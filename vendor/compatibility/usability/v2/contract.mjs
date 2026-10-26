import { nativeAssertJSON, nativeExact as assertNativeExact, nativeText, nativeDigest, nativeSha256, nativeBytesDigest, nativeFrozenClone, nativeStableSerialize, validateNativeReference } from '../../v1/native.mjs';
export { nativeSha256 as readinessDigest, nativeBytesDigest as readinessBytesDigest };
export const READINESS_FACETS = ['inputs', 'outputs', 'interfaces', 'states', 'preconditions', 'postconditions', 'errors', 'sideEffects', 'idempotency', 'concurrency', 'recovery', 'dependencies', 'environment'];
export const READINESS_CLOSURE = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09'];
export const READINESS_STANDARD = Object.freeze({ schema: 'evopilot-usability-standard/v2', version: 'v2', levels: { L1: 'Domain understanding', L2: 'Implementation specification', L3: 'Reconstruction specification complete' }, facets: READINESS_FACETS, closure: READINESS_CLOSURE, requiresExecution: false, industryCertification: false, guaranteesGeneratedEquivalence: false });
export const READINESS_STANDARD_DIGEST = nativeSha256(READINESS_STANDARD);
export const READINESS_SPEC_PATH = 'readiness/specification-v2.json';
export function readinessFail(code) { throw Object.assign(new Error(code), { code }); }
// A strict v2 input-shape rejection precedes owner mutation. Preserve v1 and
// keep uncertain transport/provider outcomes distinct from rejected input.
export function readinessExact(value, fields, optional = []) {
    try {
        assertNativeExact(value, fields, optional);
    }
    catch (error) {
        if (error instanceof TypeError)
            readinessFail('READINESS_SCHEMA');
        throw error;
    }
}
const nativeExact = readinessExact;
export function boundedReadiness(value) { nativeAssertJSON(value); if (Buffer.byteLength(nativeStableSerialize(value)) > 16 * 1024 * 1024)
    readinessFail('READINESS_LIMIT'); }
export function readinessText(v, max = 16384) { nativeText(v); if (v.length > max)
    readinessFail('READINESS_LIMIT'); }
export function readinessId(v) { readinessText(v, 128); if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/.test(v))
    readinessFail('READINESS_ID'); }
export function readinessPath(v) { readinessText(v, 512); if (v.startsWith('/') || v.includes('\\') || v.includes(':') || v.split('/').some(p => !p || p === '.' || p === '..'))
    readinessFail('READINESS_PATH'); }
function array(v, max = 4096) { if (!Array.isArray(v) || v.length > max)
    readinessFail('READINESS_LIMIT'); }
function unique(v) { if (new Set(v).size !== v.length)
    readinessFail('READINESS_DUPLICATE'); }
export function assertReadinessVersion(v) { if (v !== 'v2')
    readinessFail('READINESS_STANDARD_REQUIRED'); }
export function validateReadinessIntent(raw) {
    boundedReadiness(raw);
    nativeExact(raw, ['schema', 'standardVersion', 'standardDigest', 'workspaceId', 'scope', 'id', 'mode', 'purpose', 'functionalScope', 'exclusions', 'targetLevel', 'sources', 'requirements', 'userIntentOrigin']);
    assertReadinessVersion(raw.standardVersion);
    if (raw.schema !== 'evopilot-modeling-intent/v2' || raw.standardDigest !== READINESS_STANDARD_DIGEST)
        readinessFail('READINESS_STANDARD_REQUIRED');
    readinessId(raw.workspaceId);
    readinessId(raw.id);
    nativeExact(raw.scope, ['visibility', 'projectId']);
    readinessId(raw.scope.projectId);
    if (!['public', 'private'].includes(String(raw.scope.visibility)) || !['L1', 'L2', 'L3'].includes(String(raw.targetLevel)) || !['SOURCE_REVERSE', 'DOCUMENT_FORWARD', 'ASSET_COMPOSITION'].includes(String(raw.mode)) || !['explicit-request', 'retained-context'].includes(String(raw.userIntentOrigin)))
        readinessFail('READINESS_INTENT');
    readinessText(raw.purpose);
    readinessText(raw.functionalScope);
    array(raw.exclusions, 256);
    raw.exclusions.forEach(x => readinessText(x));
    array(raw.sources, 1024);
    array(raw.requirements, 4096);
    if (!raw.sources.length || !raw.requirements.length)
        readinessFail('READINESS_EMPTY_INVENTORY');
    for (const s of raw.sources) {
        nativeExact(s, ['id', 'kind', 'reference', 'revision', 'digest']);
        readinessId(s.id);
        readinessText(s.reference);
        readinessText(s.revision);
        nativeDigest(s.digest);
        if (!['SOURCE', 'DOCUMENT', 'ASSET', 'USER_DECISION'].includes(String(s.kind)))
            readinessFail('READINESS_SOURCE');
    }
    const sourceIds = new Set(raw.sources.map(s => s.id));
    if (sourceIds.size !== raw.sources.length)
        readinessFail('READINESS_DUPLICATE');
    for (const r of raw.requirements) {
        nativeExact(r, ['id', 'kind', 'description', 'acceptance', 'sourceIds', 'excludedFacets'], ['acceptanceVariants']);
        readinessId(r.id);
        readinessText(r.description);
        readinessText(r.acceptance);
        const variants = r.acceptanceVariants;
        if (variants !== undefined) {
            array(variants, 4096);
            variants.forEach(v => readinessId(v));
            unique(variants);
        }
        array(r.sourceIds, 128);
        array(r.excludedFacets, 13);
        if (!['DOMAIN', 'BEHAVIOR', 'COMPOSITION'].includes(String(r.kind)) || !r.sourceIds.length || r.sourceIds.some(x => !sourceIds.has(String(x))))
            readinessFail('READINESS_REQUIREMENT');
        for (const x of r.excludedFacets) {
            nativeExact(x, ['facet', 'reason', 'reviewReference']);
            if (!READINESS_FACETS.includes(x.facet))
                readinessFail('READINESS_FACET');
            readinessText(x.reason);
            readinessText(x.reviewReference);
        }
        unique(r.excludedFacets.map(x => x.facet));
        if (r.kind !== 'BEHAVIOR' && r.excludedFacets.length)
            readinessFail('READINESS_FACET');
    }
    const intent = raw;
    unique(intent.requirements.map(r => r.id));
    if (!intent.requirements.some(r => r.kind === 'DOMAIN') || (intent.targetLevel !== 'L1' && !intent.requirements.some(r => r.kind === 'BEHAVIOR')))
        readinessFail('READINESS_EMPTY_INVENTORY');
    return nativeFrozenClone(intent);
}
export function readinessCriteria(i) {
    return [
        ...i.requirements.filter(r => r.kind === 'DOMAIN').map(r => 'domain:' + r.id),
        ...(i.targetLevel === 'L1' ? [] : i.requirements.filter(r => r.kind === 'BEHAVIOR').flatMap(r => READINESS_FACETS.map(f => 'behavior:' + r.id + ':' + f))),
        ...(i.targetLevel === 'L1' ? [] : i.requirements.filter(r => r.kind === 'COMPOSITION').map(r => 'composition:' + r.id)),
        ...(i.targetLevel === 'L3' ? READINESS_CLOSURE.map(c => 'closure:' + c) : []),
    ];
}
function citation(x) { nativeExact(x, ['path', 'contentDigest', 'locator']); readinessPath(x.path); nativeDigest(x.contentDigest); readinessText(x.locator); }
export function validateReadinessSpecification(raw) {
    boundedReadiness(raw);
    nativeExact(raw, ['schema', 'standardVersion', 'standardDigest', 'intentDigest', 'intent', 'author', 'statements', 'dependencies', 'normativeFiles']);
    assertReadinessVersion(raw.standardVersion);
    if (raw.schema !== 'evopilot-readiness-specification/v2' || raw.standardDigest !== READINESS_STANDARD_DIGEST)
        readinessFail('READINESS_STANDARD_REQUIRED');
    nativeDigest(raw.intentDigest);
    const intent = validateReadinessIntent(raw.intent);
    if (nativeSha256(intent) !== raw.intentDigest)
        readinessFail('READINESS_INTENT_STALE');
    readinessText(raw.author, 256);
    array(raw.statements, 60000);
    array(raw.dependencies, 1024);
    array(raw.normativeFiles, 4096);
    for (const s of raw.statements) {
        nativeExact(s, ['criterionId', 'text', 'status', 'provenance', 'citations']);
        readinessText(s.criterionId, 256);
        readinessText(s.text);
        if (!['RESOLVED', 'MISSING', 'CONFLICT', 'AMBIGUOUS'].includes(String(s.status)))
            readinessFail('READINESS_STATEMENT');
        array(s.provenance, 128);
        array(s.citations, 128);
        s.citations.forEach(citation);
        for (const p of s.provenance) {
            nativeExact(p, ['kind', 'sourceId', 'locator', 'resolutionReference']);
            if (!['SOURCE_FACT', 'DESIGN_DECLARATION', 'INFERENCE', 'USER_DECISION'].includes(String(p.kind)))
                readinessFail('READINESS_PROVENANCE');
            readinessId(p.sourceId);
            readinessText(p.locator);
            if (p.resolutionReference !== null)
                readinessText(p.resolutionReference);
        }
    }
    for (const d of raw.dependencies) {
        nativeExact(d, ['id', 'version', 'digest', 'purpose', 'reuse', 'paths']);
        readinessId(d.id);
        readinessText(d.version, 256);
        nativeDigest(d.digest);
        readinessText(d.purpose);
        if (!['STANDARD', 'LIBRARY', 'SPECIFICATION'].includes(String(d.reuse)))
            readinessFail('READINESS_DEPENDENCY');
        array(d.paths, 4096);
        if (!d.paths.length)
            readinessFail('READINESS_DEPENDENCY');
        d.paths.forEach(readinessPath);
    }
    for (const f of raw.normativeFiles) {
        nativeExact(f, ['path', 'digest']);
        readinessPath(f.path);
        nativeDigest(f.digest);
        if (/(^|\/)(sources|original|observations|\.git|node_modules|secrets)(\/|$)/i.test(f.path) || /\.(?:tsx?|jsx?|py|sh|exe|dll|dylib|so|wasm|class|jar|pem|key)$/i.test(f.path))
            readinessFail('READINESS_HIDDEN_IMPLEMENTATION');
    }
    const s = raw;
    unique(s.statements.map(s => s.criterionId));
    unique(s.dependencies.map(d => d.id));
    unique(s.normativeFiles.map(f => f.path));
    return nativeFrozenClone(s);
}
export function validateReadinessReview(raw) {
    boundedReadiness(raw);
    nativeExact(raw, ['schema', 'standardVersion', 'intentDigest', 'projectionDigest', 'actor', 'origin', 'method', 'results']);
    assertReadinessVersion(raw.standardVersion);
    if (raw.schema !== 'evopilot-content-review/v2' || !['ACTUAL', 'SYNTHETIC'].includes(String(raw.origin)) || !['SOURCE_COMPARISON', 'DESIGN_REVIEW', 'ASSET_COMPARISON'].includes(String(raw.method)))
        readinessFail('READINESS_REVIEW');
    nativeDigest(raw.intentDigest);
    nativeDigest(raw.projectionDigest);
    readinessText(raw.actor, 256);
    array(raw.results, 60000);
    for (const r of raw.results) {
        nativeExact(r, ['criterionId', 'verdict', 'reason', 'citations']);
        readinessText(r.criterionId, 256);
        readinessText(r.reason);
        if (!['SUPPORTED', 'CONFLICT', 'MISSING', 'UNKNOWN'].includes(String(r.verdict)))
            readinessFail('READINESS_REVIEW');
        array(r.citations, 128);
        r.citations.forEach(citation);
    }
    const r = raw;
    unique(r.results.map(x => x.criterionId));
    return nativeFrozenClone(r);
}
export function verifyReadinessProjection(p) {
    boundedReadiness(p);
    nativeExact(p, ['schema', 'workspaceId', 'scope', 'reference', 'published', 'specification', 'specificationDigest', 'files', 'digest', 'authority']);
    if (p.schema !== 'evopilot-readiness-projection/v2' || p.authority !== false || typeof p.published !== 'boolean')
        readinessFail('READINESS_PROJECTION');
    validateNativeReference(p.reference, { product: 'ontology' });
    validateReadinessSpecification(p.specification);
    const { digest, ...body } = p;
    if (digest !== nativeSha256(body) || p.specificationDigest !== nativeSha256(p.specification))
        readinessFail('READINESS_INTEGRITY');
    for (const f of p.specification.normativeFiles) {
        if (typeof p.files[f.path] !== 'string' || nativeBytesDigest(p.files[f.path]) !== f.digest)
            readinessFail('READINESS_DEPENDENCY');
        if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{20,}|\bsk-[A-Za-z0-9_-]{24,}/.test(p.files[f.path]))
            readinessFail('READINESS_SECRET');
    }
    if (Object.keys(p.files).some(path => !p.specification.normativeFiles.some(f => f.path === path)))
        readinessFail('READINESS_EXTRA_MATERIAL');
    for (const d of p.specification.dependencies) {
        const files = d.paths.map(path => { if (typeof p.files[path] !== 'string')
            readinessFail('READINESS_DEPENDENCY'); return { path, digest: nativeBytesDigest(p.files[path]) }; });
        if (nativeSha256(files) !== d.digest)
            readinessFail('READINESS_DEPENDENCY');
    }
}
export const noReconstruction = () => ({ status: 'NOT_REQUESTED', evidenceDigests: [], artifactDigest: null, environmentDigest: null, standardVersion: null, scopeDescription: null });
export function validateReadinessReconstruction(raw) {
    boundedReadiness(raw);
    nativeExact(raw, ['status', 'evidenceDigests', 'artifactDigest', 'environmentDigest', 'standardVersion', 'scopeDescription']);
    if (!['NOT_REQUESTED', 'NOT_EXECUTED', 'IN_PROGRESS', 'VERIFIED', 'FAILED', 'INCOMPLETE', 'STALE', 'UNSUPPORTED'].includes(String(raw.status)))
        readinessFail('READINESS_RECONSTRUCTION');
    array(raw.evidenceDigests, 256);
    raw.evidenceDigests.forEach(nativeDigest);
    if (raw.artifactDigest !== null)
        nativeDigest(raw.artifactDigest);
    if (raw.environmentDigest !== null)
        nativeDigest(raw.environmentDigest);
    if (raw.standardVersion !== null)
        readinessText(raw.standardVersion, 64);
    if (raw.scopeDescription !== null)
        readinessText(raw.scopeDescription);
    if (raw.status === 'VERIFIED' && (!raw.evidenceDigests.length || !raw.artifactDigest || !raw.environmentDigest || !raw.standardVersion || !raw.scopeDescription))
        readinessFail('READINESS_RECONSTRUCTION_EVIDENCE');
    if (raw.status === 'NOT_REQUESTED' && (raw.evidenceDigests.length || raw.artifactDigest !== null || raw.environmentDigest !== null || raw.standardVersion !== null || raw.scopeDescription !== null))
        readinessFail('READINESS_RECONSTRUCTION');
    return nativeFrozenClone(raw);
}
