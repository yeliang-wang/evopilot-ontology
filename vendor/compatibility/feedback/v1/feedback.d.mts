import type { DatabaseSync } from 'node:sqlite';
import type { NativeScope, NativeReference, NativeJSON, NativePackage } from '../../v1/native.mjs';
export type FeedbackOwner = 'ontology' | 'harness';
export interface FeedbackSource {
    direction: 'forward' | 'reverse';
    locator: string;
    revision: string;
    treeDigest: string;
    inventoryDigest: string;
    requirementsDigest: string;
}
export interface FeedbackEvent {
    schema: 'evopilot-feedback-event/v1';
    id: string;
    workspaceId: string;
    scope: NativeScope;
    projectId: string;
    projectCandidateDigest: string;
    source: FeedbackSource;
    runId: string;
    runReviewDigest: string;
    claimId: string;
    inputDigest: string;
    receiptDigest: string;
    causeId: string;
    origin: 'registered-runtime-run';
    stage: 'SUCCEEDED' | 'FAILED';
    pins: {
        ontology: NativeReference;
        harness: NativeReference;
    };
    results: {
        ontology: NativeJSON;
        harness: NativeJSON;
    };
    collectionRefs: {
        id: string;
        digest: string;
    }[];
    observation: NativeJSON;
    digest: string;
}
export interface FeedbackReceipt {
    eventId: string;
    eventDigest: string;
    owner: FeedbackOwner;
    workspaceId: string;
    scope: NativeScope;
    candidateId: string;
    digest: string;
}
export interface FeedbackChange {
    kind: 'relation' | 'cardinality' | 'deprecation' | 'rule' | 'source' | 'other';
    identifiers: string[];
    sourcePaths: string[];
    explanation: string;
}
export interface FeedbackProposal {
    mode: 'REUSE' | 'DELIVER';
    reference: NativeReference;
    rationale: string;
    changes: FeedbackChange[];
}
export interface FeedbackReview extends FeedbackProposal {
    eventId: string;
    eventDigest: string;
    owner: FeedbackOwner;
    workspaceId: string;
    scope: NativeScope;
    sourceDigest: string;
    baseline: NativeReference;
    changedFiles: string[];
    dependentHarness: NativeReference[];
    reviewDigest: string;
}
export interface FeedbackDisposition {
    review: FeedbackReview;
    decision: 'APPROVE' | 'REJECT';
    humanEvidenceRef: string;
    digest: string;
}
export interface FeedbackInbox {
    event: FeedbackEvent;
    receipt: FeedbackReceipt;
    candidate: {
        id: string;
        kind: 'regression' | 'semantic-impact';
        evidenceDigest: string;
        status: 'REVIEW_REQUIRED';
    };
    review: FeedbackReview | null;
    disposition: FeedbackDisposition | null;
}
export interface FeedbackOutbox {
    event: FeedbackEvent;
    destinations: {
        ontology: FeedbackReceipt | null;
        harness: FeedbackReceipt | null;
    };
    dispositions: {
        ontology: FeedbackDisposition | null;
        harness: FeedbackDisposition | null;
    };
    errors: {
        ontology: string | null;
        harness: string | null;
    };
}
export interface FeedbackEnvelope {
    operation: string;
    scope: NativeScope;
    input: Record<string, unknown>;
    requestId?: string;
    expectedRevision?: number;
}
export interface FeedbackStore {
    db: DatabaseSync;
    identity: {
        id: string;
    };
    guard(): void;
}
export interface FeedbackMaterial {
    reference: NativeReference;
    scope: NativeScope;
    workspaceId: string;
    package: NativePackage;
    published: true;
}
export interface FeedbackSnapshot {
    schema: 'evopilot-feedback-snapshot/v1';
    owner: string;
    revision: number;
    recordsDigest: string;
    recordCount: number;
    receiptCount: number;
}
export declare function inspectFeedbackSnapshot(db: DatabaseSync): FeedbackSnapshot | null;
export interface FeedbackOwnerProviders {
    readFeedback?: (input: {
        id: string;
        scope: NativeScope;
    }) => Promise<FeedbackEvent> | FeedbackEvent;
    resolveFeedbackMaterial?: (input: {
        reference: NativeReference;
        scope: NativeScope;
    }) => Promise<FeedbackMaterial> | FeedbackMaterial;
}
/** A timeout leaves delivery uncertain; callers reconcile retained owner receipts. */
export declare const FEEDBACK_PROVIDER_TIMEOUT_MS = 5000;
export declare function feedbackBounded<T>(call: () => Promise<T> | T, timeoutMs?: number): Promise<T>;
export declare const feedbackEqual: (a: unknown, b: unknown) => boolean;
export declare function feedbackFail(code: string, message?: string): never;
export declare function feedbackScope(scope: unknown): asserts scope is NativeScope;
export declare function validateFeedbackEvent(value: unknown): asserts value is FeedbackEvent;
export declare function validateFeedbackReceipt(r: unknown, event: FeedbackEvent, owner: FeedbackOwner): asserts r is FeedbackReceipt;
/** Owner-local tables share the owner's SQLite transaction, never a second file. */
export declare function createFeedbackStore(store: FeedbackStore, owner: 'runtime' | FeedbackOwner, minimumSchema?: 3 | 4): {
    get: <T>(scope: NativeScope, kind: string, id: string) => T | null;
    list: <T>(scope: NativeScope, kind: string) => T[];
    put: (scope: NativeScope, kind: string, id: string, value: unknown) => void;
    mutate: <T>(request: FeedbackEnvelope, fn: () => T) => {
        revision: number;
        result: T;
        requestId: string;
        digest: string;
    };
    inspect: (scope: NativeScope) => {
        owner: "runtime" | FeedbackOwner;
        workspaceId: string;
        scope: NativeScope;
        revision: number;
        authority: boolean;
    };
    receipt: (scope: NativeScope, id: string) => unknown | null;
    recordTransition: (intent: unknown, result: unknown) => void;
};
