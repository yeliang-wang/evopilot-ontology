import type { ExecutionEvidence } from './execution.mjs';
import type { BehaviorFacet, UsabilityScope } from './contract.mjs';
export type OracleJSON = null | boolean | number | string | OracleJSON[] | {
    [key: string]: OracleJSON;
};
export interface BehaviorObservation {
    output: OracleJSON;
    state: OracleJSON;
    error: OracleJSON;
    effects: OracleJSON[];
}
export interface OracleTolerance {
    field: 'output' | 'state';
    path: string[];
    absolute: number;
    relative: number;
}
export interface BehaviorOracle {
    schema: 'evopilot-behavior-oracle/v1';
    author: {
        actor: string;
        independent: boolean;
        origin: 'ACTUAL' | 'SYNTHETIC';
    };
    cases: {
        id: string;
        behaviorId: string;
        facets: BehaviorFacet[];
        purpose: string;
        input: OracleJSON;
        expected: BehaviorObservation;
        tolerances: OracleTolerance[];
    }[];
    negativeControls: {
        id: string;
        caseId: string;
        purpose: string;
        actual: BehaviorObservation;
    }[];
}
interface ReconstructionObservationFields {
    workspaceId: string;
    scope: UsabilityScope;
    attemptId: string;
    inventoryDigest: string;
    specificationDigest: string;
    oracleDigest: string;
    inputManifestDigest: string;
    environmentDigest: string;
    dependenciesDigest: string;
    outputDigest: string;
    executorDigest: string;
    origin: 'ACTUAL' | 'SYNTHETIC';
    inputMode: 'ASSETS_ONLY' | 'SOURCE_ASSISTED';
    independent: boolean;
    isolated: boolean;
    status: 'SUCCEEDED' | 'FAILED' | 'INCOMPLETE' | 'UNKNOWN';
    execution?: {
        planDigest: string;
        claimId: string;
        cleanWorkspaceId: string;
        receiptDigest: string;
    };
    cases: {
        caseId: string;
        inputDigest: string;
        status: 'COMPLETE' | 'FAILED' | 'SKIPPED' | 'UNKNOWN';
        actual: BehaviorObservation | null;
    }[];
    digest: string;
}
export type ReconstructionObservation = ReconstructionObservationFields & ({
    schema: 'evopilot-reconstruction-observation/v1';
} | {
    schema: 'evopilot-reconstruction-observation/v2';
    authority: ExecutionEvidence;
});
export interface BehaviorOracleResult {
    schema: 'evopilot-behavior-oracle-result/v1';
    workspaceId: string;
    scope: UsabilityScope;
    bindingDigest: string;
    attemptId: string;
    oracleDigest: string;
    observationDigest: string | null;
    outputDigest: string | null;
    status: 'PASS' | 'FAIL' | 'INCOMPLETE' | 'STALE' | 'UNSUPPORTED';
    denominator: number;
    results: {
        caseId: string;
        status: 'PASS' | 'FAIL' | 'INCOMPLETE';
        differences: string[];
    }[];
    negativeControls: {
        required: number;
        rejected: number;
    };
    gaps: string[];
    assessedAt: string;
    verifiedLevel: null;
    authority: false;
    softwareRelease: false;
    digest: string;
}
export declare const ORACLE_OBSERVABLE_FACETS: readonly ["outputs", "states", "errors", "sideEffects", "idempotency", "concurrency", "recovery"];
export declare const ORACLE_LIMITS: Readonly<{
    cases: 256;
    negativeControls: 128;
    tolerancesPerCase: 32;
}>;
export declare function compareBehavior(expected: BehaviorObservation, actual: BehaviorObservation, tolerances: OracleTolerance[]): string[];
export declare function validateBehaviorOracle(raw: unknown): BehaviorOracle;
export declare const behaviorOracleDigest: (oracle: BehaviorOracle) => string;
export declare function validateReconstructionObservation(raw: unknown): ReconstructionObservation;
export {};
