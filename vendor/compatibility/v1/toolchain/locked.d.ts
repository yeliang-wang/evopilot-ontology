import { type NativeToolchain } from '../native.mjs';
export interface ToolchainOptions {
    /** Trusted installer/SDK input, never a request-supplied executable or lock. */
    cacheRoot: string;
    downloadCache?: string;
    offline?: boolean;
}
export declare function inspectBundledToolchainLock(): {
    schema: "evopilot-toolchain-lock/v1";
    productVersion: "0.3.0";
    platform: string;
    lockDigest: string;
    versions: {
        [x: string]: string;
    };
    limits: {
        timeoutMs: number;
        maxInputBytes: number;
        maxPackageBytes: number;
    };
    supportedPlatforms: string[];
};
/** Reconstruct expected bytes from pinned archives; an editable inventory is never trust evidence. */
export declare function inspectNativeToolchain(options: ToolchainOptions): NativeToolchain;
/** Explicit installer step. Validation/doctor never performs a network download. */
export declare function prepareNativeToolchain(options: ToolchainOptions): Promise<NativeToolchain>;
