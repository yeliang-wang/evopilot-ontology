import { type UsabilityScope, type UsabilityLevel } from './contract.mjs';
/** A trusted host resolves this from reviewed project/source state, never request flags. */
export interface NativeAuthoringRequest {
    workspaceId: string;
    scope: UsabilityScope;
    owner: 'ontology' | 'harness';
    packageDigest: string;
    sourceBindingsDigest: string;
    sourceDirection: 'forward' | 'reverse';
}
export interface NativeAuthoringAdmission extends NativeAuthoringRequest {
    schema: 'evopilot-native-authoring-admission/v1';
    candidateDigest: string;
    sourceInventoryDigest: string;
    requirementsDigest: string;
    modelingIntentDigest: string | null;
    targetLevel: UsabilityLevel | null;
    authority: false;
}
export type NativeAuthoringResolver = (request: Readonly<NativeAuthoringRequest>) => NativeAuthoringAdmission;
/** Synchronous trusted host callback; implementations must use bounded local reads. A technical admission never grants a level or publication. */
export declare function requireNativeAuthoring(resolve: NativeAuthoringResolver | undefined, request: NativeAuthoringRequest, retained?: NativeAuthoringAdmission): NativeAuthoringAdmission;
