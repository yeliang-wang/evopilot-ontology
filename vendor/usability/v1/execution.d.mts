export interface ExecutionPolicy {
    schema: 'evopilot-execution-policy/v1';
    externalNetwork: 'DENY';
    internalTransport: 'NONE' | 'OWNED_LOOPBACK';
    childProcesses: 'DENY' | 'BROKERED_OWNED';
    originalSource: 'DENY';
    hiddenOracle: 'DENY';
    priorOutputs: 'DENY';
    hostCredentials: 'DENY';
    brokerDigest: string;
    dependencyManifestDigest: string;
}
export interface ExecutionEvidence {
    policy: ExecutionPolicy;
    policyDigest: string;
    enforcementDigest: string;
    externalConnections: number;
    unrelatedPeerConnections: number;
    allOwnedProcessesClosed: boolean;
}
export interface ReconstructionDependencies {
    schema: 'evopilot-reconstruction-dependencies/v1';
    dependencies: {
        id: string;
        kind: 'NORMATIVE_COMPATIBILITY' | 'THIRD_PARTY';
        version: string;
        purpose: string;
        license: string;
        files: {
            path: string;
            bytes: number;
            digest: string;
        }[];
    }[];
}
export declare function validateExecutionPolicy(raw: unknown): ExecutionPolicy;
export declare function validateExecutionEvidence(raw: unknown): ExecutionEvidence;
export declare function executionIsolated(e: ExecutionEvidence): boolean;
export declare function validateReconstructionDependencies(raw: unknown): ReconstructionDependencies;
