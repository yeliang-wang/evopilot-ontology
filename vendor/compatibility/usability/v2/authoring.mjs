import { isPromise } from 'node:util/types';
import { nativeSha256, nativeStableSerialize, nativePackageDigest } from '../../v1/native.mjs';
import { verifyDecisionEvidence } from '../../v1/decision-evidence.mjs';
import { READINESS_SPEC_PATH, validateReadinessSpecification, validateReadinessIntent, readinessFail as fail } from './contract.mjs';
/** Exact v2 intent is mandatory for every v2 package, including forward and composition modes. */
export function requireReadinessAuthoring(pkg, workspaceId, scope, resolver) {
    if (!Object.hasOwn(pkg.files, READINESS_SPEC_PATH))
        return;
    let raw;
    try {
        raw = JSON.parse(pkg.files[READINESS_SPEC_PATH]);
    }
    catch {
        fail('READINESS_SPECIFICATION_INVALID');
    }
    const spec = validateReadinessSpecification(raw);
    if (!resolver)
        fail('READINESS_INTENT_REQUIRED');
    const r = resolver(Object.freeze({ workspaceId, scope: Object.freeze({ ...scope }), owner: pkg.manifest.owner, packageDigest: nativePackageDigest(pkg), intentDigest: spec.intentDigest }));
    if (isPromise(r)) {
        void Promise.prototype.then.call(r, () => { }, () => { });
        fail('READINESS_INTENT_REQUIRED');
    }
    const intent = validateReadinessIntent(r.definition);
    if (r.digest !== nativeSha256(intent) || r.digest !== spec.intentDigest || intent.workspaceId !== workspaceId || nativeStableSerialize(intent.scope) !== nativeStableSerialize(scope))
        fail('READINESS_INTENT_STALE');
    verifyDecisionEvidence(r.humanEvidenceRef, { owner: 'runtime', operation: 'readiness.intent.record', workspaceId, scope, reviewDigest: r.digest, decision: 'ACCEPT' });
}
