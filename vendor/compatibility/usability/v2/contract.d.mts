import { nativeSha256, nativeBytesDigest } from '../../v1/native.mjs';
import type { NativeScope, NativeReference } from '../../v1/native.mjs';
export { nativeSha256 as readinessDigest, nativeBytesDigest as readinessBytesDigest };
export type ReadinessLevel = 'L1' | 'L2' | 'L3';
export declare const READINESS_FACETS: readonly ["inputs", "outputs", "interfaces", "states", "preconditions", "postconditions", "errors", "sideEffects", "idempotency", "concurrency", "recovery", "dependencies", "environment"];
export declare const READINESS_CLOSURE: readonly ["C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08", "C09"];
export declare const READINESS_STANDARD: Readonly<{
    schema: "evopilot-usability-standard/v2";
    version: "v2";
    levels: {
        L1: string;
        L2: string;
        L3: string;
    };
    facets: readonly ["inputs", "outputs", "interfaces", "states", "preconditions", "postconditions", "errors", "sideEffects", "idempotency", "concurrency", "recovery", "dependencies", "environment"];
    closure: readonly ["C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08", "C09"];
    requiresExecution: false;
    industryCertification: false;
    guaranteesGeneratedEquivalence: false;
}>;
export declare const READINESS_STANDARD_DIGEST: string;
export declare const READINESS_SPEC_PATH = "readiness/specification-v2.json";
export interface ReadinessSource {
    id: string;
    kind: 'SOURCE' | 'DOCUMENT' | 'ASSET' | 'USER_DECISION';
    reference: string;
    revision: string;
    digest: string;
}
export interface ReadinessRequirement {
    id: string;
    kind: 'DOMAIN' | 'BEHAVIOR' | 'COMPOSITION';
    description: string;
    acceptance: string;
    acceptanceVariants?: string[];
    sourceIds: string[];
    excludedFacets: {
        facet: typeof READINESS_FACETS[number];
        reason: string;
        reviewReference: string;
    }[];
}
export interface ReadinessIntent {
    schema: 'evopilot-modeling-intent/v2';
    standardVersion: 'v2';
    standardDigest: string;
    workspaceId: string;
    scope: NativeScope;
    id: string;
    mode: 'SOURCE_REVERSE' | 'DOCUMENT_FORWARD' | 'ASSET_COMPOSITION';
    purpose: string;
    functionalScope: string;
    exclusions: string[];
    targetLevel: ReadinessLevel;
    sources: ReadinessSource[];
    requirements: ReadinessRequirement[];
    userIntentOrigin: 'explicit-request' | 'retained-context';
}
export interface ReadinessIntentRecord {
    definition: ReadinessIntent;
    humanEvidenceRef: string;
    digest: string;
    authority: false;
}
export interface ReadinessCitation {
    path: string;
    contentDigest: string;
    locator: string;
}
export interface ReadinessStatement {
    criterionId: string;
    text: string;
    status: 'RESOLVED' | 'MISSING' | 'CONFLICT' | 'AMBIGUOUS';
    provenance: {
        kind: 'SOURCE_FACT' | 'DESIGN_DECLARATION' | 'INFERENCE' | 'USER_DECISION';
        sourceId: string;
        locator: string;
        resolutionReference: string | null;
    }[];
    citations: ReadinessCitation[];
}
export interface ReadinessSpecification {
    schema: 'evopilot-readiness-specification/v2';
    standardVersion: 'v2';
    standardDigest: string;
    intentDigest: string;
    intent: ReadinessIntent;
    author: string;
    statements: ReadinessStatement[];
    dependencies: {
        id: string;
        version: string;
        digest: string;
        purpose: string;
        reuse: 'STANDARD' | 'LIBRARY' | 'SPECIFICATION';
        paths: string[];
    }[];
    normativeFiles: {
        path: string;
        digest: string;
    }[];
}
export interface ReadinessProjection {
    schema: 'evopilot-readiness-projection/v2';
    workspaceId: string;
    scope: NativeScope;
    reference: NativeReference;
    published: boolean;
    specification: ReadinessSpecification;
    specificationDigest: string;
    files: Record<string, string>;
    digest: string;
    authority: false;
}
export interface ReadinessReview {
    schema: 'evopilot-content-review/v2';
    standardVersion: 'v2';
    intentDigest: string;
    projectionDigest: string;
    actor: string;
    origin: 'ACTUAL' | 'SYNTHETIC';
    method: 'SOURCE_COMPARISON' | 'DESIGN_REVIEW' | 'ASSET_COMPARISON';
    results: {
        criterionId: string;
        verdict: 'SUPPORTED' | 'CONFLICT' | 'MISSING' | 'UNKNOWN';
        reason: string;
        citations: ReadinessCitation[];
    }[];
}
export interface ReadinessReconstruction {
    status: 'NOT_REQUESTED' | 'NOT_EXECUTED' | 'IN_PROGRESS' | 'VERIFIED' | 'FAILED' | 'INCOMPLETE' | 'STALE' | 'UNSUPPORTED';
    evidenceDigests: string[];
    artifactDigest: string | null;
    environmentDigest: string | null;
    standardVersion: string | null;
    scopeDescription: string | null;
}
export interface ReadinessResult {
    schema: 'evopilot-asset-readiness-result/v2';
    standardVersion: 'v2';
    standardDigest: string;
    workspaceId: string;
    scope: NativeScope;
    intentDigest: string;
    projectionDigest: string;
    specificationDigest: string;
    reference: NativeReference;
    targetLevel: ReadinessLevel;
    assetAssessment: {
        level: ReadinessLevel | null;
        status: 'QUALIFIED' | 'INCOMPLETE' | 'FAILED' | 'STALE';
        freshness: 'CURRENT' | 'STALE' | 'UNKNOWN';
        gaps: {
            criterionId: string;
            code: string;
        }[];
        required: number;
        reviewDigest: string | null;
        evidenceOrigin: 'ACTUAL' | 'SYNTHETIC' | null;
    };
    reconstructionVerification: ReadinessReconstruction;
    assessedAt: string;
    digest: string;
    authority: false;
    softwareRelease: false;
}
export declare function readinessFail(code: string): never;
export declare function readinessExact<K extends string>(value: unknown, fields: readonly K[], optional?: readonly string[]): asserts value is Record<K, unknown>;
export declare function boundedReadiness(value: unknown): void;
export declare function readinessText(v: unknown, max?: number): asserts v is string;
export declare function readinessId(v: unknown): asserts v is string;
export declare function readinessPath(v: unknown): asserts v is string;
export declare function assertReadinessVersion(v: unknown): asserts v is 'v2';
export declare function validateReadinessIntent(raw: unknown): ReadinessIntent;
export declare function readinessCriteria(i: ReadinessIntent): string[];
export declare function validateReadinessSpecification(raw: unknown): ReadinessSpecification;
export declare function validateReadinessReview(raw: unknown): ReadinessReview;
export declare function verifyReadinessProjection(p: ReadinessProjection): void;
export declare const noReconstruction: () => ReadinessReconstruction;
export declare function validateReadinessReconstruction(raw: unknown): ReadinessReconstruction;
