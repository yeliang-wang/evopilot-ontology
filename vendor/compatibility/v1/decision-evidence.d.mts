import type { NativeScope } from './native.mjs';
/** Evidence integrity inside the trusted local operator boundary; not human authentication. */
export interface DecisionSubject {
    owner: 'runtime' | 'harness' | 'ontology' | 'project';
    operation: string;
    workspaceId: string;
    scope: NativeScope;
    reviewDigest: string;
    decision: 'APPROVE' | 'REJECT' | 'ACCEPT';
}
export interface DecisionEvidence {
    schema: 'evopilot-decision-evidence/v1';
    subject: DecisionSubject;
    source: {
        reference: string;
        description: string;
    };
}
export declare function verifyDecisionEvidence(reference: string, expected: DecisionSubject): void;
