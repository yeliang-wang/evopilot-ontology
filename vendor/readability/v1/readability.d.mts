import type { RowPresentation } from './presentation.mjs';
export type JSONValue = null | boolean | number | string | JSONValue[] | {
    [key: string]: JSONValue;
};
export interface ReadScope {
    visibility: 'private' | 'public';
    projectId: string;
}
export interface ReadRow {
    id: string;
    kind: string;
    label: string;
    verdict: string;
    expected: JSONValue;
    actual: JSONValue;
    origin: string;
    presentation?: RowPresentation;
    references: {
        kind: string;
        id: string;
        digest: string | null;
    }[];
    details: JSONValue;
}
export interface ReadSnapshot {
    schema: 'evopilot-readable-snapshot/v1';
    owner: 'runtime' | 'harness' | 'ontology';
    workspaceId: string;
    scope: ReadScope;
    subject: {
        kind: string;
        id: string;
        version: string | null;
    };
    pins: Record<string, string | null>;
    rows: ReadRow[];
    denominator: {
        requirements: number;
        variants: number;
    };
    stages: {
        id: string;
        status: string;
        reason: string;
    }[];
    limitations: string[];
    authority: false;
    digest: string;
}
export type SnapshotBody = Omit<ReadSnapshot, 'schema' | 'digest' | 'authority'>;
export declare function readFail(code: string): never;
export declare function readStable(value: unknown): string;
export declare const readDigest: (value: unknown) => string;
export declare function readSnapshot(body: SnapshotBody): ReadSnapshot;
export declare function verifyReadSnapshot(snapshot: ReadSnapshot): void;
export interface ReadQuery {
    limit?: number;
    cursor?: string;
    search?: string;
    kind?: string;
    verdict?: string;
    expectedDigest?: string;
}
export declare function queryReadSnapshot(snapshot: ReadSnapshot, query?: ReadQuery): {
    markdown: string;
    snapshotDigest: string;
    subject: {
        kind: string;
        id: string;
        version: string | null;
    };
    pins: Record<string, string | null>;
    denominator: {
        requirements: number;
        variants: number;
    };
    total: number;
    matching: number;
    offset: number;
    rows: ReadRow[];
    nextCursor: string | null;
    authority: false;
};
export interface ComparisonQuery {
    limit?: number;
    cursor?: string;
}
export declare function compareReadSnapshots(before: ReadSnapshot, after: ReadSnapshot, query?: ComparisonQuery): {
    schema: string;
    markdown: string;
    table: {
        id: string;
        title: string;
        columns: string[];
        rows: string[][];
    };
    owner: "runtime" | "harness" | "ontology";
    scope: ReadScope;
    before: {
        subject: {
            kind: string;
            id: string;
            version: string | null;
        };
        pins: Record<string, string | null>;
        digest: string;
    };
    after: {
        subject: {
            kind: string;
            id: string;
            version: string | null;
        };
        pins: Record<string, string | null>;
        digest: string;
    };
    changes: {
        id: string;
        change: string;
        before: ReadRow | null;
        after: ReadRow | null;
    }[];
    totalChanges: number;
    returnedChanges: number;
    offset: number;
    nextCursor: string | null;
    comparisonDigest: string;
    beforeDenominator: {
        requirements: number;
        variants: number;
    };
    afterDenominator: {
        requirements: number;
        variants: number;
    };
    comparisonProfile: string;
    semanticEquivalence: string;
    impact: string;
    authority: boolean;
};
export declare function renderReadSnapshot(snapshot: ReadSnapshot, format: 'json' | 'markdown' | 'html'): string;
export interface ReadIdentity {
    id: string;
    version?: string;
    runId?: string;
}
export interface ReadRequest {
    operation: string;
    scope: ReadScope;
    input: Record<string, unknown>;
}
export declare const READABLE_OPERATIONS: readonly ["readable.list", "readable.snapshot", "readable.query", "readable.export", "readable.compare"];
export declare function createReadableAPI(access: {
    kind: 'asset' | 'project';
    list(scope: ReadScope): Promise<unknown>;
    get(scope: ReadScope, identity: ReadIdentity): Promise<ReadSnapshot>;
}): (request: ReadRequest) => Promise<unknown>;
