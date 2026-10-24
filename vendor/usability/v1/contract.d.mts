export declare const USABILITY_LEVELS: {
    readonly L1: {
        readonly name: "Understanding";
        readonly includes: readonly [];
        readonly scenarios: readonly ["Discovery", "Onboarding", "Domain questions", "Handover", "Prototyping"];
    };
    readonly L2: {
        readonly name: "Implementation specification";
        readonly includes: readonly ["L1"];
        readonly scenarios: readonly ["Module implementation", "Scoped rewrite", "Adapters", "Version evolution"];
    };
    readonly L3: {
        readonly name: "Reconstruction verified";
        readonly includes: readonly ["L1", "L2"];
        readonly scenarios: readonly ["Verified module replacement", "Bounded reconstruction", "Platform migration"];
    };
};
export declare const ASSESSMENT_STATES: readonly ["NOT_EVALUATED", "IN_PROGRESS", "VERIFIED", "FAILED", "INCOMPLETE", "STALE", "UNSUPPORTED"];
export declare const BEHAVIOR_FACETS: readonly ["inputs", "outputs", "interfaces", "states", "preconditions", "postconditions", "errors", "sideEffects", "idempotency", "concurrency", "recovery", "dependencies", "environment"];
export declare const USABILITY_LIMITS: Readonly<{
    inputBytes: 1048576;
    evidenceBytes: 1048576;
    totalEvidenceBytes: 4194304;
    questions: 128;
    behaviors: 64;
    citations: 128;
    evidenceTimeoutMs: 2000;
    totalTimeoutMs: 10000;
}>;
export type UsabilityLevel = keyof typeof USABILITY_LEVELS;
export type BehaviorFacet = typeof BEHAVIOR_FACETS[number];
export interface UsabilityScope {
    visibility: 'private' | 'public';
    projectId: string;
}
export interface UsabilityPins {
    sourceDigest: string;
    assetDigests: string[];
    environmentDigest: string;
    dependenciesDigest: string;
    oracleDigest: string | null;
    inputManifestDigest: string | null;
}
export interface UsabilityInventory {
    schema: 'evopilot-usability-inventory/v1';
    workspaceId: string;
    scope: UsabilityScope;
    slice: {
        id: string;
        version: string;
        title: string;
        exclusions: string[];
    };
    targetLevel: UsabilityLevel;
    pins: UsabilityPins;
    reviewReference: string;
    questions: {
        id: string;
        question: string;
    }[];
    behaviors: {
        id: string;
        description: string;
        excludedFacets: {
            facet: BehaviorFacet;
            reason: string;
            reviewReference: string;
        }[];
    }[];
}
export interface UsabilityCitation {
    assetDigest: string;
    path: string;
    contentDigest: string;
}
export interface UsabilityStatement {
    text: string;
    citations: UsabilityCitation[];
}
export interface UsabilitySpecification {
    schema: 'evopilot-usability-specification/v1';
    inventoryDigest: string;
    answers: {
        questionId: string;
        status: 'RESOLVED' | 'AMBIGUOUS' | 'MISSING' | 'CONFLICT' | 'DRAFT_ONLY';
        statement: UsabilityStatement | null;
    }[];
    behaviors: {
        behaviorId: string;
        facets: Partial<Record<BehaviorFacet, UsabilityStatement>>;
    }[];
}
export declare function usabilityFail(code: string): never;
export declare function usabilityStable(value: unknown): string;
export declare const usabilityDigest: (value: unknown) => string;
export declare const usabilityBytesDigest: (value: string) => string;
export declare const USABILITY_STANDARD_DIGEST: string;
export declare function validateUsabilityDigest(v: unknown): asserts v is string;
export declare function validateUsabilityScope(v: unknown): UsabilityScope;
export declare function validateUsabilityPins(v: unknown): UsabilityPins;
export declare function validateUsabilityInventory(value: unknown): UsabilityInventory;
export declare function validateUsabilitySpecification(value: unknown): UsabilitySpecification;
