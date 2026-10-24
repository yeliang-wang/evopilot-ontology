import { BEHAVIOR_FACETS, usabilityDigest, usabilityStable, usabilityFail, validateUsabilityDigest, validateUsabilityScope } from './contract.mjs';
export const semanticCriteria = (inventory) => [
    ...inventory.questions.map(q => ({ id: 'question:' + q.id, level: 'L1' })),
    ...(inventory.targetLevel === 'L1' ? [] : inventory.behaviors).flatMap(b => BEHAVIOR_FACETS.filter(f => !b.excludedFacets.some(e => e.facet === f)).map(f => ({ id: 'behavior:' + b.id + ':' + f, level: 'L2' }))),
];
function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(','))
        usabilityFail('USABILITY_SCHEMA');
    return value;
}
export function validateSemanticReport(value) {
    usabilityStable(value);
    const r = exact(value, ['schema', 'workspaceId', 'scope', 'inventoryDigest', 'specificationDigest', 'actor', 'inputMode', 'independent', 'origin', 'results']);
    if (r.schema !== 'evopilot-usability-semantic-report/v1' || r.inputMode !== 'ASSETS_ONLY' || !['ACTUAL', 'SYNTHETIC'].includes(String(r.origin)) || typeof r.independent !== 'boolean' || typeof r.actor !== 'string' || !r.actor.trim() || r.actor.length > 256 || typeof r.workspaceId !== 'string' || !r.workspaceId.trim())
        usabilityFail('USABILITY_SCHEMA');
    validateUsabilityScope(r.scope);
    validateUsabilityDigest(r.inventoryDigest);
    validateUsabilityDigest(r.specificationDigest);
    if (!Array.isArray(r.results) || r.results.length > 1024)
        usabilityFail('USABILITY_LIMIT');
    const ids = new Set();
    for (const item of r.results) {
        const row = exact(item, ['criterionId', 'status', 'reason', 'evidenceDigests']);
        if (typeof row.criterionId !== 'string' || !row.criterionId || ids.has(row.criterionId) || !['PASS', 'FAIL', 'UNKNOWN', 'UNSUPPORTED'].includes(String(row.status)) || typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 8192 || !Array.isArray(row.evidenceDigests) || row.evidenceDigests.length > 128)
            usabilityFail('USABILITY_SCHEMA');
        ids.add(row.criterionId);
        row.evidenceDigests.forEach(validateUsabilityDigest);
        if (new Set(row.evidenceDigests).size !== row.evidenceDigests.length)
            usabilityFail('USABILITY_DUPLICATE');
    }
    return JSON.parse(usabilityStable(value));
}
/** A report is still evidence, not an authorization or a request-supplied grade. */
export function semanticReportDigest(report) { return usabilityDigest(validateSemanticReport(report)); }
