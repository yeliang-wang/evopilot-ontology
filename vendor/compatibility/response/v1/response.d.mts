import type { NativeScope, NativeReference, NativeJSON } from '../../v1/native.mjs';
export type ResponseOwner = 'runtime' | 'harness' | 'ontology' | 'workspace';
export interface ResponseEvidenceRef {
    owner: ResponseOwner;
    id: string;
    digest: string;
}
export interface ScopedResponseReference extends ResponseEvidenceRef {
    workspaceId: string;
    scope: NativeScope;
}
export interface RunbookPin {
    reference: NativeReference;
    path: string;
    digest: string;
}
/** Guidance contains no executable text. The independently reviewed collection supplies the action. */
export interface ResponseRunbook {
    schema: 'evopilot-response-runbook/v1';
    id: string;
    version: string;
    serviceId: string;
    environment: string;
    sourceRevision: string;
    parameters: Record<string, NativeJSON>;
    prerequisites: ResponseEvidenceRef[];
    steps: {
        id: string;
        description: string;
        operation: 'isolated-collection';
    }[];
    stopConditions: string[];
    effectScope: 'isolated-local';
    maxEvidenceAgeSeconds: number;
    expiresAt: number;
}
export interface ResolvedResponseRunbook {
    workspaceId: string;
    scope: NativeScope;
    pin: RunbookPin;
    runbook: ResponseRunbook;
    published: true;
    withdrawn: boolean;
}
export interface ResponseEvidence {
    workspaceId: string;
    scope: NativeScope;
    reference: ResponseEvidenceRef;
    status: 'PASS' | 'FAIL' | 'UNKNOWN';
    observedAt: number;
}
export interface ResponseCause {
    kind: 'observed' | 'suspected' | 'confirmed';
    description: string;
    evidence: ResponseEvidenceRef[];
}
/** Reviewed preventive work; no executable command or execution permission. */
export interface ResponseFollowup {
    id: string;
    description: string;
    actor: string;
    status: 'PROPOSED' | 'TRACKED' | 'DONE';
    evidence: ResponseEvidenceRef[];
}
export interface ResponseDisposition {
    kind: 'OPEN' | 'DEFERRED' | 'RISK_ACCEPTED' | 'VERIFIED_CLOSED';
    actor: string;
    rationale: string;
    expiresAt: number | null;
    humanEvidenceRef: string;
    reviewDigest: string;
    at: number;
}
export interface ResponseProblem {
    schema: 'evopilot-response-problem/v1';
    id: string;
    workspaceId: string;
    scope: NativeScope;
    incidentId: string;
    findingIds: string[];
    serviceId: string;
    environment: string;
    deploymentRevision: string;
    impact: string;
    causes: ResponseCause[];
    followups: ResponseFollowup[];
    evidence: ResponseEvidenceRef[];
    disposition: ResponseDisposition | null;
    history: ResponseDisposition[];
    digest: string;
}
export interface ResponseRecovery {
    workspaceId: string;
    scope: NativeScope;
    reference: ResponseEvidenceRef;
    bindingId: string;
    incidentId: string;
    serviceId: string;
    environment: string;
    deploymentRevision: string;
    faultDigest: string;
    recoveryDigest: string;
    faultAt: number;
    recoveryAt: number;
    outcome: 'PASS' | 'FAIL' | 'UNKNOWN';
}
export interface ResponseExecutionVerification {
    workspaceId: string;
    scope: NativeScope;
    reference: ResponseEvidenceRef;
    problemId: string;
    problemDigest: string;
    serviceId: string;
    environment: string;
    deploymentRevision: string;
    status: 'VERIFIED' | 'UNVERIFIED';
    recovery: ResponseEvidenceRef | null;
    verifiedAt: number | null;
}
export interface ResponseEnvelope {
    operation: string;
    scope: NativeScope;
    input: Record<string, unknown>;
    requestId?: string;
    expectedRevision?: number;
}
export interface ResponseRuntimeProviders {
    resolveResponseRunbook?: (input: {
        scope: NativeScope;
        pin: RunbookPin;
    }) => Promise<ResolvedResponseRunbook> | ResolvedResponseRunbook;
    readResponseProblem?: (input: {
        scope: NativeScope;
        id: string;
    }) => Promise<ResponseProblem> | ResponseProblem;
    readResponseEvidence?: (input: {
        scope: NativeScope;
        reference: ResponseEvidenceRef;
    }) => Promise<ResponseEvidence> | ResponseEvidence;
    readResponseRecovery?: (input: {
        scope: NativeScope;
        reference: ResponseEvidenceRef;
    }) => Promise<ResponseRecovery> | ResponseRecovery;
    cancelResponseCollection?: (input: {
        scope: NativeScope;
        collectionId: string;
        claimId: string;
    }) => Promise<{
        requested: true;
        claimId: string;
    }> | {
        requested: true;
        claimId: string;
    };
}
export declare const responseEqual: (a: unknown, b: unknown) => boolean;
export declare function responseFail(code: string, message?: string): never;
export declare const RESPONSE_STOP_CONDITIONS: readonly ["SOURCE_DRIFT", "PREREQUISITE_FAILED", "GUIDANCE_WITHDRAWN", "EXPIRED", "TIMEOUT", "UNKNOWN"];
export declare function responseReference(value: unknown): asserts value is ResponseEvidenceRef;
export declare function responseRunbookPin(value: unknown): asserts value is RunbookPin;
export declare function validateResponseRunbook(value: unknown): asserts value is ResponseRunbook;
export declare function validateResolvedResponseRunbook(value: unknown): asserts value is ResolvedResponseRunbook;
export declare function validateResponseEvidence(value: unknown): asserts value is ResponseEvidence;
export declare function validateResponseFollowup(value: unknown): asserts value is ResponseFollowup;
export declare function validateResponseProblem(value: unknown): asserts value is ResponseProblem;
export declare function validateResponseRecovery(value: unknown): asserts value is ResponseRecovery;
export declare function validateResponseExecutionVerification(value: unknown): asserts value is ResponseExecutionVerification;
