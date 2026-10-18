import type { NativeScope, NativeReference, NativeJSON } from '../../v1/native.mjs';
export declare const ONLINE_CONTRACT = "evopilot-online/v1";
export declare const ONLINE_LIMITS: Readonly<{
    bindings: 64;
    samples: 2048;
    queryBytes: 2048;
    windowSeconds: 2592000;
    responseBytes: 1048576;
    timeoutMs: 5000;
    alerts: 128;
    backlogPerTick: 8;
}>;
export declare function onlineFail(code: string, message?: string): never;
export declare function onlineSlug(v: unknown): asserts v is string;
export declare function onlineText(v: unknown, max?: number): asserts v is string;
export declare function onlineSeconds(v: unknown): number;
export interface OnlineMetricSpec {
    query: string;
    freshnessQuery: string;
    unit: 'events' | 'events_per_second';
}
export interface OnlineMetric {
    metricSource: {
        type: 'Prometheus';
        spec: OnlineMetricSpec;
    };
}
export interface OnlineSLO {
    apiVersion: 'openslo/v1';
    kind: 'SLO';
    metadata: {
        name: string;
    };
    spec: {
        service: string;
        indicator: {
            metadata: {
                name: string;
            };
            spec: {
                ratioMetric: {
                    good: OnlineMetric;
                    total: OnlineMetric;
                };
            };
        };
        timeWindow: [{
            duration: string;
            isRolling: true;
        }];
        budgetingMethod: 'RatioTimeslices';
        objectives: [{
            target: number;
            timeSliceWindow: string;
        }];
    };
}
export interface ResolvedOnlineSLO {
    name: string;
    service: string;
    windowSeconds: number;
    stepSeconds: number;
    target: number;
    good: OnlineMetricSpec;
    total: OnlineMetricSpec;
    profile: 'openslo-v1-ratio-timeslices';
    digest: string;
}
export declare function inspectOnlineSLO(value: unknown): ResolvedOnlineSLO;
export interface OnlineBindingSpec {
    id: string;
    serviceId: string;
    environment: string;
    deploymentRevision: string;
    providerId: string;
    alertSourceId: string;
    policy: NativeReference;
    slo: OnlineSLO;
    intervalSeconds: number;
}
export declare function validateOnlineBindingSpec(value: unknown): asserts value is OnlineBindingSpec;
export interface OnlineDecision {
    decision: 'APPROVE' | 'REJECT';
    reviewDigest: string;
    humanEvidenceRef: string;
    digest: string;
}
export interface OnlineBinding {
    workspaceId: string;
    scope: NativeScope;
    spec: OnlineBindingSpec;
    slo: ResolvedOnlineSLO;
    onlineStandardDigest: string;
    reviewDigest: string;
    decision: OnlineDecision | null;
    selected: boolean;
    nextWindowEnd: number | null;
    lastWindowEnd: number | null;
}
export interface OnlinePoint {
    time: number;
    good: number;
    total: number;
    goodSourceTime: number;
    totalSourceTime: number;
}
export interface OnlineMeasurement {
    schema: 'evopilot-online-measurement/v1';
    bindingDigest: string;
    providerId: string;
    windowStart: number;
    windowEnd: number;
    stepSeconds: number;
    status: 'COMPLETE' | 'INCOMPLETE';
    reasons: string[];
    points: OnlinePoint[];
    ratio: number | null;
    responseDigests: string[];
    digest: string;
}
export interface OnlineObservation {
    id: string;
    bindingId: string;
    bindingDigest: string;
    workspaceId: string;
    scope: NativeScope;
    windowEnd: number;
    measurement: OnlineMeasurement;
    policy: NativeReference;
    nativeReport: NativeJSON | null;
    outcome: 'PASS' | 'FAIL' | 'INCOMPLETE';
    diagnostic: string | null;
    digest: string;
}
export interface OnlineFinding {
    schema: 'evopilot-online-finding/v1';
    id: string;
    workspaceId: string;
    scope: NativeScope;
    bindingId: string;
    bindingDigest: string;
    serviceId: string;
    environment: string;
    deploymentRevision: string;
    policy: NativeReference;
    incidentId: string;
    source: 'evaluation' | 'alertmanager';
    state: 'FIRING' | 'RESOLVED';
    at: number;
    evidenceDigest: string;
    causeId: string;
    candidate: {
        kind: 'regression';
        status: 'REVIEW_REQUIRED';
    };
    digest: string;
}
export interface OnlineRepairCandidate {
    id: string;
    workspaceId: string;
    scope: NativeScope;
    bindingId: string;
    incidentId: string;
    history: OnlineFinding[];
    state: 'FIRING' | 'RESOLVED';
    status: 'REVIEW_REQUIRED';
    requestedVersion: null;
    softwareRelease: false;
    ontologyMutation: false;
    digest: string;
}
export interface OnlineEnvelope {
    operation: string;
    scope: NativeScope;
    input: Record<string, unknown>;
    requestId?: string;
    expectedRevision?: number;
}
export interface OnlineProviderInput {
    binding: OnlineBinding;
    windowEnd: number;
}
export interface OnlineHarnessProviders {
    collectOnline?: (input: OnlineProviderInput) => Promise<OnlineMeasurement>;
    deliverOnlineFinding?: (finding: OnlineFinding) => Promise<{
        id: string;
        digest: string;
    }>;
    readOnlineRepair?: (input: {
        scope: NativeScope;
        id: string;
    }) => Promise<OnlineRepairCandidate | null>;
    inspectOnlineAlert?: (input: {
        sourceId: string;
        digest: string;
    }) => Promise<OnlineAlertBatch>;
}
export interface OnlineRuntimeProviders {
    readOnlineFinding?: (input: {
        scope: NativeScope;
        id: string;
    }) => Promise<OnlineFinding>;
}
export interface OnlineAlert {
    fingerprint: string;
    state: 'FIRING' | 'RESOLVED';
    startsAt: number;
    endsAt: number | null;
    labels: Record<string, string>;
    digest: string;
}
export interface OnlineAlertBatch {
    schema: 'evopilot-alertmanager-receipt/v1';
    sourceId: string;
    payloadDigest: string;
    alerts: OnlineAlert[];
    digest: string;
}
export declare const onlineEqual: (a: unknown, b: unknown) => boolean;
export declare function measurementBody(binding: OnlineBinding, windowEnd: number, points: OnlinePoint[], reasons: string[], responseDigests: string[]): Omit<OnlineMeasurement, 'digest'>;
export declare function validateOnlineMeasurement(value: unknown, binding: OnlineBinding, windowEnd: number): asserts value is OnlineMeasurement;
export declare function validateOnlineFinding(value: unknown): asserts value is OnlineFinding;
