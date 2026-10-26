import type { UsabilityScope } from './contract.mjs';
export interface SupervisorDependency {
    id: string;
    kind: 'OWNED_SUPERVISOR';
    ownerUid: number;
    domain: string;
    label: string;
    nonce: string;
    root: string;
    executableDigest: string;
    workerDigest: string;
    plistDigest: string;
    sandboxDigest: string;
    qualificationDigest: string;
    operations: ['INSPECT', 'BOOTSTRAP', 'BOOTOUT', 'RECONCILE'];
}
export type ParameterRule = {
    kind: 'INTEGER';
    minimum: number;
    maximum: number;
} | {
    kind: 'TEXT';
    maxBytes: number;
} | {
    kind: 'ENUM';
    values: string[];
};
export interface DatabaseDependency {
    id: string;
    kind: 'BOUND_DATABASE';
    driverDigest: string;
    endpointDigest: string;
    route: string;
    namespace: string;
    credentialRef: string;
    transportDigest: string;
    qualificationDigest: string;
    objects: {
        id: string;
        name: string;
        ownershipNonce: string;
    }[];
    statements: {
        id: string;
        operation: 'READ' | 'INSERT' | 'UPDATE' | 'DELETE' | 'CREATE_TABLE' | 'DROP_TABLE' | 'BEGIN' | 'COMMIT' | 'ROLLBACK';
        objectIds: string[];
        templateDigest: string;
        parameters: ParameterRule[];
    }[];
}
export interface EvaluationPolicy {
    schema: 'evopilot-evaluation-policy/v1';
    phase: 'EVALUATION';
    brokerDigest: string;
    directNetwork: 'DENY';
    originalSource: 'DENY';
    hiddenOracle: 'DENY';
    priorOutputs: 'DENY';
    hostCredentials: 'DENY';
    dependencies: (SupervisorDependency | DatabaseDependency)[];
}
export interface EvaluationBudget {
    wallMs: number;
    maxSessions: number;
    maxConnections: number;
    maxRows: number;
    maxOutputBytes: number;
    maxOperations: number;
}
export interface EvaluationPlan {
    schema: 'evopilot-evaluation-plan/v1';
    workspaceId: string;
    scope: UsabilityScope;
    reconstruction: {
        attemptId: string;
        planDigest: string;
        claimId: string;
        receiptDigest: string;
        outputDigest: string;
    };
    oracleDigest: string;
    environmentDigest: string;
    dependenciesDigest: string;
    provider: {
        id: string;
        version: string;
        executableDigest: string;
        configurationDigest: string;
    };
    origin: 'ACTUAL' | 'SYNTHETIC';
    policy: EvaluationPolicy;
    budget: EvaluationBudget;
}
export interface EvaluationClaim {
    workspaceId: string;
    scope: UsabilityScope;
    sessionId: string;
    claimId: string;
    planDigest: string;
    plan: EvaluationPlan;
    ordinal: number;
    admittedAt: string;
    remaining: Omit<EvaluationBudget, 'maxSessions'>;
}
export interface EvaluationReceipt {
    schema: 'evopilot-evaluation-receipt/v1';
    claimId: string;
    planDigest: string;
    sessionId: string;
    origin: 'ACTUAL' | 'SYNTHETIC';
    outputDigest: string;
    oracleDigest: string;
    environmentDigest: string;
    dependenciesDigest: string;
    policyDigest: string;
    providerDigest: string;
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
    usage: {
        wallMs: number | null;
        connections: number | null;
        rows: number | null;
        outputBytes: number | null;
        operations: number | null;
    };
    violations: {
        directConnections: number;
        unrelatedPeers: number;
        sourceReads: number;
        oracleReads: number;
        credentialReads: number;
        foreignEffects: number;
    };
    effects: {
        id: string;
        dependencyId: string;
        targetId: string;
        operation: string;
        outcome: 'CONFIRMED' | 'UNKNOWN';
        traceDigest: string;
    }[];
    cleanup: {
        dependencyId: string;
        ownedTargets: string[];
        confirmedAbsent: boolean;
        traceDigest: string;
    }[];
    containment: {
        dependencyId: string;
        sandboxDigest: string;
        allProcessesClosed: boolean;
        traceDigest: string;
    }[];
    enforcementDigest: string;
    diagnostic: string | null;
    digest: string;
}
export interface EvaluationEvidence {
    plan: EvaluationPlan;
    claim: EvaluationClaim;
    receipt: EvaluationReceipt;
}
export declare function supervisorLabel(workspaceId: string, nonce: string): string;
export declare function validateEvaluationPolicy(raw: unknown, workspaceId: string): EvaluationPolicy;
export declare function validateEvaluationPlan(raw: unknown): EvaluationPlan;
/** A request contains a statement ID and bound values; it never contains SQL or route credentials. */
export declare function validateDatabaseCall(dependency: DatabaseDependency, raw: unknown): {
    statementId: string;
    parameters: (string | number)[];
};
export declare function validateSupervisorCall(dependency: SupervisorDependency, raw: unknown): {
    operation: SupervisorDependency['operations'][number];
    label: string;
};
export declare function validateEvaluationClaim(raw: unknown): EvaluationClaim;
export declare function validateEvaluationReceipt(raw: unknown, claim: EvaluationClaim): EvaluationReceipt;
export declare function validateEvaluationEvidence(raw: unknown): EvaluationEvidence;
