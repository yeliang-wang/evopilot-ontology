import { assertJSON, exactFields, sha256, frozenClone, stableSerialize } from '../vendor/compatibility/v1/reference.mjs';
import { validateOntology, failure } from './specification.js';
function buildForVersion(input, productVersion) {
    const validationReport = validateOntology(input);
    if (!validationReport.valid || validationReport.pending.length)
        throw new TypeError('Cannot deliver invalid model or required unresolved issues');
    // Successful native validation establishes the complete model shape.
    const asset = input;
    const content = {
        model: asset,
        provenance: asset.provenance,
        sourceMappings: asset.sourceMappings,
        unresolvedIssues: asset.unresolvedIssues,
        validationReport,
        buildReport: { status: 'BUILT', instanceValidation: 'NOT_CHECKED', constraints: validationReport.constraints, authority: false, businessConfirmed: false, released: false },
    };
    const manifest = { specVersion: 'v1', product: 'ontology', productVersion, id: asset.id, version: asset.version, visibility: asset.visibility, modelDigest: sha256(asset), contentDigest: sha256(content), dependencies: asset.dependencies };
    return frozenClone({ ...content, manifest, digest: sha256({ ...content, manifest }) });
}
export function buildDelivery(input) { return buildForVersion(input, '0.2.0'); }
export function verifyDelivery(delivery) {
    try {
        assertJSON(delivery);
        exactFields(delivery, ['model', 'provenance', 'sourceMappings', 'unresolvedIssues', 'validationReport', 'buildReport', 'manifest', 'digest']);
        const producer = delivery.manifest?.productVersion;
        if (typeof producer !== 'string' || !['0.1.0', '0.1.1', '0.2.0'].includes(producer))
            throw new TypeError('Unsupported delivery producer version');
        const expected = buildForVersion(delivery.model, producer);
        if (stableSerialize(expected) !== stableSerialize(delivery))
            throw new TypeError('Delivery content, manifest or report mismatch');
        return frozenClone({ valid: true, status: 'VALID', digest: expected.digest, authority: false, businessConfirmed: false, released: false });
    }
    catch (error) {
        return failure(error);
    }
}
