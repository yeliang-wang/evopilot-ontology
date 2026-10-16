import type { NativePackage, NativeReference, NativeScope, NativeToolchain, NativeValidationContext, NativeCriterionResult, StandardPins } from '../../vendor/compatibility/v1/native.mjs';
import type { WorkspaceIdentity } from '../types.js';
export type { NativePackage, NativeReference, NativeToolchain, NativeValidationContext, NativeCriterionResult, StandardPins };
export interface NativeDiagnostic { code: string; message: string; path?: string; subject?: string }
export interface OntologyStandard extends StandardPins {
  schema: 'evopilot-standard-inspection/v1'; owner: 'ontology'; specVersion: 'v1'; contractDigest: string;
  files: { path: string; sha256: string }[]; lock: unknown; supportMatrix: unknown; authority: false;
}
export interface NativeOntologyValidation {
  schema: 'evopilot-ontology-validation/v1'; status: 'CONFORMS' | 'NONCONFORMING' | 'ERROR' | 'UNSUPPORTED' | 'UNKNOWN';
  packageDigest: string; standardPins: StandardPins; toolchainLockDigest: string;
  adapterDigest: string; reportDigest: string; rawReport: string; modelReport: string;
  criteria: NativeCriterionResult[];
  diagnostics: NativeDiagnostic[]; results: Record<string, string>[];
  caseReports: { id: string; expectedConforms: boolean; actualConforms: boolean; matchesExpected: boolean; sourceShapeIds: string[]; rawReport: string }[];
  process: { exitCode: number | null; signal: string | null; timedOut: boolean; stdout: string; stderr: string; durationMs: number };
  context: NativeValidationContext | null; authority: false; businessConfirmed: false;
}
export interface NativeOntologyRecord {
  scope: NativeScope; workspace: WorkspaceIdentity; id: string; version: string;
  package: NativePackage; packageDigest: string; standardPins: StandardPins;
  validation: NativeOntologyValidation | null;
  claim: { requestId: string; status: 'RUNNING' | 'COMPLETE' | 'UNKNOWN'; attempt: number; packageDigest: string; context: NativeValidationContext | null } | null;
  review: { reviewDigest: string; packageDigest: string; validationDigest: string; standardPins: StandardPins; workspace: WorkspaceIdentity; scope: NativeScope } | null;
  decision: { reviewDigest: string; decision: 'APPROVE' | 'REJECT'; humanEvidenceRef: string; uid: number } | null;
  reference: NativeReference | null;
}
export interface OntologyNativeInputs {
  'standard.inspect': Record<string, never>;
  'native.package.put': { package: NativePackage };
  'native.package.inspect': { id: string; version: string };
  'native.package.list': Record<string, never>;
  'native.package.validate': { id: string; version: string; context?: NativeValidationContext };
  'native.package.review': { id: string; version: string };
  'native.package.decide': { id: string; version: string; reviewDigest: string; decision: 'APPROVE' | 'REJECT'; humanEvidenceRef: string };
  'native.package.publish': { id: string; version: string };
  'native.package.readback': { id: string; version: string };
  'native.package.reconcile': { id: string; version: string };
  'native.receipt.inspect': { requestId: string };
}
export type OntologyNativeMutation = 'native.package.put' | 'native.package.validate' | 'native.package.review' | 'native.package.decide' | 'native.package.publish' | 'native.package.reconcile';
export type OntologyNativeRequest = { [K in keyof OntologyNativeInputs]: { operation: K; scope: NativeScope; input: OntologyNativeInputs[K] } & (K extends OntologyNativeMutation ? { requestId: string; expectedRevision: number } : {}) }[keyof OntologyNativeInputs];
export interface NativeOntologyReceipt<T = unknown> { requestId: string; scope: NativeScope; operation: string; requestDigest: string; revision: number; uid: number; result: T }

export interface OntologyNativeResults {
 'standard.inspect': OntologyStandard;
 'native.package.put': {id:string;version:string;packageDigest:string;standardPins:StandardPins};
 'native.package.inspect': NativeOntologyRecord;
 'native.package.list': Pick<NativeOntologyRecord,'id'|'version'|'packageDigest'|'reference'>[];
 'native.package.validate': NativeOntologyValidation | {status:'RUNNING';packageDigest:string;context:NativeValidationContext|null};
 'native.package.review': NonNullable<NativeOntologyRecord['review']>;
 'native.package.decide': NonNullable<NativeOntologyRecord['decision']>;
 'native.package.publish': {reference:NativeReference;packageDigest:string;validationDigest:string;authority:false};
 'native.package.readback': NativeOntologyRecord;
 'native.package.reconcile': {claim:NativeOntologyRecord['claim'];validation:NativeOntologyRecord['validation'];redispatched:false};
 'native.receipt.inspect': NativeOntologyReceipt;
}
export type OntologyNativeOutput<K extends keyof OntologyNativeInputs> = K extends OntologyNativeMutation ? NativeOntologyReceipt<OntologyNativeResults[K]> : OntologyNativeResults[K];
