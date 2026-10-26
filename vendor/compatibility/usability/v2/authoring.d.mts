import type { NativePackage, NativeScope } from '../../v1/native.mjs';
import type { ReadinessIntentRecord } from './contract.mjs';
export interface ReadinessAuthoringRequest {
    workspaceId: string;
    scope: NativeScope;
    owner: 'ontology' | 'harness';
    packageDigest: string;
    intentDigest: string;
}
export type ReadinessAuthoringResolver = (request: Readonly<ReadinessAuthoringRequest>) => ReadinessIntentRecord;
/** Exact v2 intent is mandatory for every v2 package, including forward and composition modes. */
export declare function requireReadinessAuthoring(pkg: NativePackage, workspaceId: string, scope: NativeScope, resolver: ReadinessAuthoringResolver | undefined): void;
