import type { UsabilityInventory, UsabilityScope, UsabilityLevel, UsabilityPins } from './contract.mjs';
export type UsabilityVerdict = 'PASS' | 'FAIL' | 'UNKNOWN' | 'UNSUPPORTED';
export interface UsabilitySemanticReport {
    schema: 'evopilot-usability-semantic-report/v1';
    workspaceId: string;
    scope: UsabilityScope;
    inventoryDigest: string;
    specificationDigest: string;
    actor: string;
    inputMode: 'ASSETS_ONLY';
    independent: boolean;
    origin: 'ACTUAL' | 'SYNTHETIC';
    results: {
        criterionId: string;
        status: UsabilityVerdict;
        reason: string;
        evidenceDigests: string[];
    }[];
}
export interface UsabilityAssessmentResult {
    schema: 'evopilot-usability-assessment-result/v1';
    workspaceId: string;
    scope: UsabilityScope;
    standardDigest: string;
    assessedAt: string;
    assessor: {
        actor: string;
        independent: boolean;
        origin: 'ACTUAL' | 'SYNTHETIC';
    } | null;
    inventoryDigest: string;
    specificationDigest: string;
    slice: UsabilityInventory['slice'];
    targetLevel: UsabilityLevel;
    verifiedLevel: UsabilityLevel | null;
    assessmentStatus: 'VERIFIED' | 'FAILED' | 'INCOMPLETE' | 'STALE' | 'UNSUPPORTED';
    pins: UsabilityPins;
    denominator: {
        questions: number;
        behaviorFacets: number;
        excludedBehaviorFacets: number;
        required: number;
    };
    gaps: {
        requirementId: string;
        code: string;
    }[];
    semanticReportDigest: string | null;
    reconstructionEvidence: string[];
    authority: false;
    softwareRelease: false;
    digest: string;
}
export declare const semanticCriteria: (inventory: UsabilityInventory) => {
    id: string;
    level: "L1" | "L2";
}[];
export declare function validateSemanticReport(value: unknown): UsabilitySemanticReport;
/** A report is still evidence, not an authorization or a request-supplied grade. */
export declare function semanticReportDigest(report: UsabilitySemanticReport): string;
