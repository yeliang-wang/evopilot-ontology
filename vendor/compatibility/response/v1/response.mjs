import { nativeAssertJSON, nativeExact, nativeText, nativeDigest, nativeSha256, nativeRelativePath, validateNativeReference } from '../../v1/native.mjs';
import { feedbackScope, feedbackEqual, feedbackFail } from '../../feedback/v1/feedback.mjs';
export const responseEqual = feedbackEqual;
export function responseFail(code, message = code) { return feedbackFail(code, message); }
export const RESPONSE_STOP_CONDITIONS = ['SOURCE_DRIFT', 'PREREQUISITE_FAILED', 'GUIDANCE_WITHDRAWN', 'EXPIRED', 'TIMEOUT', 'UNKNOWN'];
export function responseReference(value) {
    nativeExact(value, ['owner', 'id', 'digest']);
    if (!['runtime', 'harness', 'ontology', 'workspace'].includes(value.owner))
        responseFail('RESPONSE_REFERENCE');
    nativeText(value.id);
    nativeDigest(value.digest);
}
export function responseRunbookPin(value) {
    nativeExact(value, ['reference', 'path', 'digest']);
    validateNativeReference(value.reference, { product: 'harness', visibility: value.reference.visibility });
    nativeRelativePath(value.path);
    nativeDigest(value.digest);
}
export function validateResponseRunbook(value) {
    nativeAssertJSON(value);
    nativeExact(value, ['schema', 'id', 'version', 'serviceId', 'environment', 'sourceRevision', 'parameters', 'prerequisites', 'steps', 'stopConditions', 'effectScope', 'maxEvidenceAgeSeconds', 'expiresAt']);
    if (value.schema !== 'evopilot-response-runbook/v1' || value.effectScope !== 'isolated-local')
        responseFail('RESPONSE_RUNBOOK');
    for (const key of ['id', 'serviceId', 'environment', 'sourceRevision'])
        nativeText(value[key]);
    if (typeof value.version !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value.version))
        responseFail('RESPONSE_RUNBOOK');
    if (!value.parameters || typeof value.parameters !== 'object' || Array.isArray(value.parameters) || Object.keys(value.parameters).length > 32)
        responseFail('RESPONSE_PARAMETERS');
    if (!Array.isArray(value.prerequisites) || !value.prerequisites.length || value.prerequisites.length > 32)
        responseFail('RESPONSE_PREREQUISITES');
    for (const ref of value.prerequisites) {
        responseReference(ref);
        if (ref.owner === 'workspace')
            responseFail('RESPONSE_PREREQUISITES', 'Governance file references are not operational prerequisites');
    }
    if (new Set(value.prerequisites.map(ref => ref.owner + ':' + ref.id)).size !== value.prerequisites.length)
        responseFail('RESPONSE_PREREQUISITES');
    if (!Array.isArray(value.steps) || value.steps.length !== 1)
        responseFail('RESPONSE_RUNBOOK', 'The v0.6 profile supports one isolated action per reviewed plan');
    for (const step of value.steps) {
        nativeExact(step, ['id', 'description', 'operation']);
        nativeText(step.id);
        nativeText(step.description);
        if (step.operation !== 'isolated-collection')
            responseFail('RESPONSE_RUNBOOK');
    }
    if (!Array.isArray(value.stopConditions) || !feedbackEqual([...value.stopConditions].sort(), [...RESPONSE_STOP_CONDITIONS].sort()))
        responseFail('RESPONSE_RUNBOOK', 'All fixed machine stop conditions are required');
    if (!Number.isSafeInteger(value.expiresAt) || value.expiresAt < 1 || !Number.isSafeInteger(value.maxEvidenceAgeSeconds) || value.maxEvidenceAgeSeconds < 1 || value.maxEvidenceAgeSeconds > 86400)
        responseFail('RESPONSE_RUNBOOK');
}
export function validateResolvedResponseRunbook(value) {
    nativeAssertJSON(value);
    nativeExact(value, ['workspaceId', 'scope', 'pin', 'runbook', 'published', 'withdrawn']);
    nativeText(value.workspaceId);
    feedbackScope(value.scope);
    responseRunbookPin(value.pin);
    validateResponseRunbook(value.runbook);
    if (value.published !== true || typeof value.withdrawn !== 'boolean' || value.pin.digest !== nativeSha256(value.runbook))
        responseFail('RESPONSE_RUNBOOK_INTEGRITY');
}
export function validateResponseEvidence(value) {
    nativeAssertJSON(value);
    nativeExact(value, ['workspaceId', 'scope', 'reference', 'status', 'observedAt']);
    nativeText(value.workspaceId);
    feedbackScope(value.scope);
    responseReference(value.reference);
    if (!['PASS', 'FAIL', 'UNKNOWN'].includes(value.status) || !Number.isSafeInteger(value.observedAt) || value.observedAt < 1)
        responseFail('RESPONSE_EVIDENCE');
}
export function validateResponseFollowup(value) {
    nativeAssertJSON(value);
    nativeExact(value, ['id', 'description', 'actor', 'status', 'evidence']);
    for (const key of ['id', 'description', 'actor'])
        nativeText(value[key]);
    if (!['PROPOSED', 'TRACKED', 'DONE'].includes(value.status) || !Array.isArray(value.evidence) || value.evidence.length > 32)
        responseFail('RESPONSE_FOLLOWUP');
    for (const ref of value.evidence)
        responseReference(ref);
    if (new Set(value.evidence.map(ref => ref.owner + ':' + ref.id)).size !== value.evidence.length)
        responseFail('RESPONSE_FOLLOWUP_EVIDENCE');
    if (value.status === 'DONE' && (!value.evidence.length || value.evidence.some(ref => ref.owner === 'workspace')))
        responseFail('RESPONSE_FOLLOWUP_EVIDENCE', 'Completion requires owning product evidence, not governance prose');
}
export function validateResponseProblem(value) {
    nativeAssertJSON(value);
    nativeExact(value, ['schema', 'id', 'workspaceId', 'scope', 'incidentId', 'findingIds', 'serviceId', 'environment', 'deploymentRevision', 'impact', 'causes', 'followups', 'evidence', 'disposition', 'history', 'digest']);
    if (value.schema !== 'evopilot-response-problem/v1')
        responseFail('RESPONSE_PROBLEM');
    for (const key of ['id', 'workspaceId', 'serviceId', 'environment', 'deploymentRevision', 'impact'])
        nativeText(value[key]);
    nativeDigest(value.incidentId);
    feedbackScope(value.scope);
    if (!Array.isArray(value.findingIds) || !value.findingIds.length || value.findingIds.length > 128)
        responseFail('RESPONSE_PROBLEM');
    for (const id of value.findingIds)
        nativeDigest(id);
    if (!Array.isArray(value.causes) || value.causes.length > 32 || !Array.isArray(value.evidence) || value.evidence.length > 64 || !Array.isArray(value.history) || value.history.length > 128)
        responseFail('RESPONSE_PROBLEM');
    for (const ref of value.evidence)
        responseReference(ref);
    for (const cause of value.causes) {
        nativeExact(cause, ['kind', 'description', 'evidence']);
        nativeText(cause.description);
        if (!['observed', 'suspected', 'confirmed'].includes(cause.kind) || !Array.isArray(cause.evidence) || !cause.evidence.length || cause.evidence.length > 32)
            responseFail('RESPONSE_CAUSE');
        for (const ref of cause.evidence)
            responseReference(ref);
    }
    if (!Array.isArray(value.followups) || value.followups.length > 32)
        responseFail('RESPONSE_FOLLOWUP');
    for (const followup of value.followups)
        validateResponseFollowup(followup);
    if (new Set(value.followups.map(followup => followup.id)).size !== value.followups.length)
        responseFail('RESPONSE_FOLLOWUP');
    for (const disposition of [...value.history, ...(value.disposition ? [value.disposition] : [])]) {
        nativeExact(disposition, ['kind', 'actor', 'rationale', 'expiresAt', 'humanEvidenceRef', 'reviewDigest', 'at']);
        if (!['OPEN', 'DEFERRED', 'RISK_ACCEPTED', 'VERIFIED_CLOSED'].includes(disposition.kind))
            responseFail('RESPONSE_DISPOSITION');
        for (const key of ['actor', 'rationale', 'humanEvidenceRef'])
            nativeText(disposition[key]);
        nativeDigest(disposition.reviewDigest);
        if (!Number.isSafeInteger(disposition.at) || disposition.at < 1 || (disposition.expiresAt !== null && (!Number.isSafeInteger(disposition.expiresAt) || disposition.expiresAt <= disposition.at)))
            responseFail('RESPONSE_DISPOSITION');
        if (['DEFERRED', 'RISK_ACCEPTED'].includes(disposition.kind) && disposition.expiresAt === null)
            responseFail('RESPONSE_DISPOSITION');
    }
    const digest = value.digest, body = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest'));
    if (digest !== nativeSha256(body))
        responseFail('RESPONSE_PROBLEM_INTEGRITY');
}
export function validateResponseRecovery(value) {
    nativeAssertJSON(value);
    nativeExact(value, ['workspaceId', 'scope', 'reference', 'bindingId', 'incidentId', 'serviceId', 'environment', 'deploymentRevision', 'faultDigest', 'recoveryDigest', 'faultAt', 'recoveryAt', 'outcome']);
    nativeText(value.workspaceId);
    feedbackScope(value.scope);
    responseReference(value.reference);
    for (const key of ['bindingId', 'serviceId', 'environment', 'deploymentRevision'])
        nativeText(value[key]);
    for (const key of ['incidentId', 'faultDigest', 'recoveryDigest'])
        nativeDigest(value[key]);
    if (!['PASS', 'FAIL', 'UNKNOWN'].includes(value.outcome) || !Number.isSafeInteger(value.faultAt) || !Number.isSafeInteger(value.recoveryAt) || value.recoveryAt <= value.faultAt)
        responseFail('RESPONSE_RECOVERY');
}
export function validateResponseExecutionVerification(value) {
    nativeAssertJSON(value);
    nativeExact(value, ['workspaceId', 'scope', 'reference', 'problemId', 'problemDigest', 'serviceId', 'environment', 'deploymentRevision', 'status', 'recovery', 'verifiedAt']);
    for (const key of ['workspaceId', 'problemId', 'serviceId', 'environment', 'deploymentRevision'])
        nativeText(value[key]);
    feedbackScope(value.scope);
    responseReference(value.reference);
    nativeDigest(value.problemDigest);
    if (value.reference.owner !== 'runtime' || !['VERIFIED', 'UNVERIFIED'].includes(value.status))
        responseFail('RESPONSE_EXECUTION');
    if (value.recovery !== null)
        responseReference(value.recovery);
    if (value.verifiedAt !== null && (!Number.isSafeInteger(value.verifiedAt) || value.verifiedAt < 1))
        responseFail('RESPONSE_EXECUTION');
    if (value.status === 'VERIFIED' && (!value.recovery || value.verifiedAt === null))
        responseFail('RESPONSE_EXECUTION');
}
