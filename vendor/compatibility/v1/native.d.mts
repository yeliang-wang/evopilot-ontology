/** Current corrected v1 contract. Legacy reference.mjs remains historical only. */
export declare const NATIVE_CONTRACT_REVISION: "1.1.0";
/** Bytes of this compiled contract, independently pinned by the installation. */
export declare const NATIVE_CONTRACT_DIGEST: string;
export type NativeOwner = 'ontology' | 'harness';
export type NativeVisibility = 'public' | 'private';
export type NativeJSON = null | boolean | number | string | NativeJSON[] | {
    [key: string]: NativeJSON;
};
export interface NativeScope {
    visibility: NativeVisibility;
    projectId: string;
}
export interface NativeProducer {
    product: NativeOwner | 'runtime';
    version: '0.3.0';
}
export interface StandardPins {
    standardDigest: string;
    standardLockDigest: string;
}
export interface NativeReference extends StandardPins {
    product: NativeOwner;
    id: string;
    version: string;
    specVersion: 'v1';
    visibility: NativeVisibility;
    digest: string;
    producer: NativeProducer;
    contractDigest: string;
}
export interface NativeFile {
    path: string;
    mediaType: string;
    sha256: string;
}
export interface NativePackageManifest {
    schema: 'evopilot-native-package/v1';
    specVersion: 'v1';
    owner: NativeOwner;
    id: string;
    version: string;
    visibility: NativeVisibility;
    standardPins: StandardPins;
    contractDigest: string;
    producer: NativeProducer;
    entrypoints: Record<string, string | string[]>;
    files: NativeFile[];
    dependencies: NativeReference[];
    sourceBindingRef: string;
}
export interface NativePackage {
    manifest: NativePackageManifest;
    files: Record<string, string>;
}
export interface NativeTool {
    executable: string;
    version: string;
    sha256: string;
}
export interface NativeToolchain {
    schema: 'evopilot-native-toolchain/v1';
    lockDigest: string;
    platform: string;
    arch: string;
    tools: Record<string, NativeTool>;
    dependencyLockDigest: string;
    environmentRoot?: string;
    dependencyFiles?: {
        path: string;
        sha256: string;
    }[];
    timeoutMs: number;
    maxInputBytes: number;
    maxPackageBytes: number;
}
export interface NativeValidationContext {
    workspaceId: string;
    scope: NativeScope;
    projectCandidateDigest: string;
    claimId: string;
    inputDigest: string;
    effectiveConfigDigest: string;
    sourceScopeDigest: string;
    requirementSetDigest: string;
}
export interface NativeRawReport {
    path: string;
    sha256: string;
    mediaType: string;
}
export interface NativeCriterionResult {
    criterionId: string;
    variantId: string;
    status: 'PASS' | 'FAIL' | 'ERROR' | 'UNKNOWN' | 'SKIPPED';
    evidenceDigest: string;
}
export interface NativeValidationReport {
    schema: 'evopilot-native-validation/v1';
    owner: NativeOwner;
    reference: NativeReference;
    context: NativeValidationContext;
    toolchainLockDigest: string;
    executionStatus: 'SUCCEEDED' | 'FAILED' | 'ERROR' | 'UNKNOWN';
    qualityStatus: 'PASS' | 'FAIL' | 'ERROR' | 'UNSUPPORTED' | 'INDETERMINATE';
    rawReports: NativeRawReport[];
    criteria: NativeCriterionResult[];
    reportDigest: string;
}
export declare const NATIVE_LIMITS: Readonly<{
    files: 4096;
    fileBytes: number;
    packageBytes: number;
    nodes: 200000;
    depth: 64;
}>;
export declare function nativeAssertJSON(value: unknown): asserts value is NativeJSON;
export declare function nativeStableSerialize(value: unknown): string;
export declare function nativeSha256(value: unknown): string;
export declare function nativeBytesDigest(bytes: string | Uint8Array): string;
export declare function nativeFrozenClone<T>(value: T): Readonly<T>;
export declare function nativeExact<K extends string>(value: unknown, fields: readonly K[], optional?: readonly string[]): asserts value is Record<K, unknown>;
export declare function nativeText(value: unknown): asserts value is string;
export declare function nativeDigest(value: unknown): asserts value is string;
export declare function nativeRelativePath(value: unknown): asserts value is string;
export declare function validateStandardPins(value: unknown): Readonly<StandardPins>;
export declare function validateNativeReference(value: unknown, options?: {
    product?: NativeOwner;
    visibility?: NativeVisibility;
    standardPins?: StandardPins;
    contractDigest?: string;
}): Readonly<NativeReference>;
export declare function validateNativePackage(value: unknown, options?: {
    owner?: NativeOwner;
    standardPins?: StandardPins;
    contractDigest?: string;
}): Readonly<NativePackage>;
export declare function nativePackageDigest(value: NativePackage): string;
export declare function referenceForPackage(value: NativePackage): Readonly<NativeReference>;
