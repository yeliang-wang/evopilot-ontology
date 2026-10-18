import type {FeedbackOwnerProviders} from '../vendor/compatibility/feedback/v1/feedback.mjs';
import type { NativeToolchain } from '../vendor/compatibility/v1/native.mjs';
import type { AssetRecord, SourceRecord, ClassificationSession, ClassificationHandoff } from './persistence-types.js';
import type { buildDelivery } from './delivery.js';
import type { deriveLegacyModel } from './migration.js';

/** JSON at persisted and historical boundaries; executable values are excluded. */
export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
export type JSONObject = { [key: string]: JSONValue };
export type Visibility = 'public' | 'private';
export interface Scope { visibility: Visibility; projectId: string }
export interface WorkspaceOptions { workspaceRoot: string; workspaceId: string }
export interface WorkspaceIdentity { schema: 'evopilot-workspace/v1'; id: string; canonicalRoot: string; ownerUid: number }
export interface ArtifactReference { product: 'ontology' | 'harness'; id: string; version: string; specVersion: 'v1'; visibility: Visibility; digest: string }
export type SourceStatus = 'design-proposed' | 'design-confirmed' | 'source-observed' | 'inferred' | 'runtime-observed' | 'human-reviewed' | 'synthetic';
export interface ProvenanceSource { id: string; kind: string; locator: string; revision: string; digest: string; status: SourceStatus }
export interface Concept { id: string; label: string; definition: string }
export interface Property { id: string; conceptRef: string; type: 'string' | 'number' | 'integer' | 'boolean'; required: boolean }
export interface Relation { id: string; from: string; to: string; directed: true }
interface ConstraintBase { id: string; conceptRef: string; propertyRef: string; required: boolean }
export type Constraint = ConstraintBase & (
  { kind: 'numeric-range'; minimum: number; maximum: number } |
  { kind: 'enum'; values: (string | number | boolean)[] } |
  { kind: 'cardinality'; minCount: number; maxCount: number } |
  { kind: 'descriptive-range'; description: string });
export interface SourceMapping { id: string; targetRef: string; sourceRef: string; sourceLocator: string; sourceRevision: string; status: SourceStatus }
export interface UnresolvedIssue { id: string; description: string; targetRef: string; required: boolean }
export interface OntologyModel {
  id: string; version: string; product: 'ontology'; specVersion: 'v1'; visibility: Visibility;
  provenance: { direction: 'forward' | 'reverse'; sources: ProvenanceSource[] };
  dependencies: ArtifactReference[];
  extensions: { namespace: string; version: string; required: boolean; data: JSONObject }[];
  concepts: Concept[]; properties: Property[]; relations: Relation[]; constraints: Constraint[];
  sourceMappings: SourceMapping[]; unresolvedIssues: UnresolvedIssue[];
}
export interface ValidationError { code: string; path: string; message: string }
export interface Rejection { valid: false; status: 'REJECTED'; errors: ValidationError[]; authority: false; businessConfirmed: false; released: false }
export interface ModelValidation { valid: true; status: 'PENDING' | 'VALID'; errors: ValidationError[]; pending: string[]; extensions: { namespace: string; version: string; status: string }[]; constraints: { id: string; status: string }[]; authority: false; businessConfirmed: false; released: false }
export interface Entity { id: string; conceptRef: string; properties: Record<string, (string | number | boolean)[]> }
export interface Instances { entities: Entity[]; relations: { id: string; relationRef: string; from: string; to: string }[] }
export interface Decision { reviewDigest: string; decision: 'APPROVE' | 'REJECT'; humanEvidenceRef: string; uid: number }
export interface NativeInputs {
  'workspace.inspect': Record<string, never>;
  'receipt.inspect': { requestId: string };
  'asset.put': { model: OntologyModel };
  'asset.inspect': { id: string; version: string };
  'asset.list': Record<string, never>;
  'asset.review': { id: string; version: string };
  'asset.decide': { id: string; version: string; reviewDigest: string; decision: 'APPROVE' | 'REJECT'; humanEvidenceRef: string };
  'asset.publish': { id: string; version: string };
  'source.install': { sourcePath: string };
  'source.inspect': { sourceId: string };
  'source.list': Record<string, never>;
  'legacy.import': { raw: string; format: 'json' | 'yaml'; sourceLocator: string; sourceRevision: string; sourceVisibility: Visibility };
  'legacy.derive': { sourceId: string; id: string; version: string; visibility: Visibility };
}
export type NativeMutation = 'asset.put' | 'asset.review' | 'asset.decide' | 'asset.publish' | 'source.install' | 'legacy.import' | 'legacy.derive';
export type ServiceRequest = { [K in keyof NativeInputs]: { operation: K; scope: Scope; input: NativeInputs[K] } & (K extends NativeMutation ? { requestId: string; expectedRevision: number } : {}) }[keyof NativeInputs];
export interface Receipt<T = JSONValue> { requestId: string; scope: Scope; operation: string; requestDigest: string; revision: number; uid: number; result: T }
export type NativeRequest<K extends keyof NativeInputs = keyof NativeInputs> = Extract<ServiceRequest, { operation: K }>;
export interface NativeResults {
  'workspace.inspect': { workspaceId: string; revision: number; scope: Scope; assetCount: number; authority: false };
  'receipt.inspect': Receipt<unknown>;
  'asset.put': { id: string; version: string; digest: string; validation: ModelValidation };
  'asset.inspect': AssetRecord;
  'asset.list': { id: string; version: string; digest: string; published: boolean }[];
  'asset.review': NonNullable<AssetRecord['review']>;
  'asset.decide': Decision;
  'asset.publish': { reference: ArtifactReference; blobDigest: string; delivery: ReturnType<typeof buildDelivery> };
  'source.install': SourceRecord;
  'source.inspect': SourceRecord & { raw: string };
  'source.list': Pick<SourceRecord, 'sourceId' | 'rawDigest' | 'observed' | 'status' | 'sourceLocator' | 'sourceRevision' | 'sourceVisibility'>[];
  'legacy.import': SourceRecord;
  'legacy.derive': NativeResults['asset.put'] & { sourceId: string; coverage: Extract<ReturnType<typeof deriveLegacyModel>, { valid: true }>['coverage']; unresolvedIssues: UnresolvedIssue[]; authority: false };
}
export type NativeOutputs = { [K in keyof NativeInputs]: K extends NativeMutation ? Receipt<NativeResults[K]> & { operation: K } : NativeResults[K] };
export interface ClassificationAdmission { id: string; attemptId: string; status: 'PENDING'; authority: false }
export type ClassificationReceipt = Receipt<ClassificationAdmission> & { operation: ClassificationRequest['operation'] };
export interface ClassificationModel { providerId: string; modelId: string; revision: string; timeoutMs: number }
export type ClassificationRequest = {
  operation: 'classification.start' | 'classification.reanalyze'; scope: Scope;
  requestId: string; expectedRevision: number;
  input: { id: string; sourceId: string; taxonomy: JSONObject };
};
/** Internal routing envelope. Operation validators own each legacy payload. */
export interface DispatchRequest {
  operation: string; scope: Scope; input: Record<string, unknown>;
  requestId: string; expectedRevision: number;
}
export interface TrustedProviders extends FeedbackOwnerProviders {
  nativeToolchain?: NativeToolchain;
  resolveLegacyHarness?: (input: unknown) => unknown;
  resolveClassificationSource?: (input: { sourceId: string; scope: Scope; workspace: WorkspaceIdentity }) => unknown;
  classificationAdvisor?: (input: unknown, context: unknown) => unknown | Promise<unknown>;
  classificationModel?: ClassificationModel;
}
export class OntologyError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

/** Frozen historical payloads remain unknown; routing names and envelopes are closed. */
export interface LegacyQueryInputs {
"semantic.foundation.inspect": { "metaTypes"?: unknown; "relationTypes"?: unknown; "limits"?: unknown };
"semantic.candidates.inspect": { "sourceConceptHypothesis": unknown; "candidates"?: unknown; "extraction"?: unknown };
"semantic.grounding.inspect": { "candidateSet": unknown; "foundation"?: unknown; "concepts"?: unknown; "expected"?: unknown; "priorResults"?: unknown; "locale"?: unknown };
"semantic.reasoning-profile.inspect": { "id"?: unknown; "version"?: unknown; "metadata"?: unknown; "mode"?: unknown; "limits"?: unknown; "externalReasoner"?: unknown; "supportedRules"?: unknown };
"semantic.index.inspect": { "snapshot": unknown; "assets"?: unknown; "algorithm"?: unknown; "policy"?: unknown; "toolchain"?: unknown; "cache"?: unknown };
"semantic.affected-subgraph.inspect": { "index": unknown; "profile": unknown; "changedConceptIds"?: unknown; "cacheDigest"?: unknown };
"semantic.compute.inspect": { "index": unknown; "profile": unknown; "mode"?: unknown; "affectedSubgraph"?: unknown; "externalReasonerResult"?: unknown; "execution"?: unknown };
"semantic.compute.compare": { "incremental": unknown; "full": unknown };
"semantic.federation.discover": { "roots"?: unknown; "query"?: unknown };
"semantic.interoperability.inspect": { "snapshot": unknown; "profile": unknown; "index": unknown; "externalMappings"?: unknown; "multilingualTerms"?: unknown; "unsupportedSemantics"?: unknown };
"semantic.round-trip.inspect": { "snapshot": unknown; "projectionSet": unknown; "index": unknown; "incremental": unknown; "full": unknown };
"semantic.closure.inspect": { "snapshot": unknown; "profile": unknown; "index": unknown; "projectionSet": unknown; "roundTripReport": unknown; "harnessAssets"?: unknown; "dependencyLocks"?: unknown; "evaluations"?: unknown; "rollbackLinks"?: unknown; "provenance"?: unknown };
"semantic.closure.slice": { "closure": unknown; "expectedClosureDigest": unknown; "conceptIds"?: unknown };
"pack.scaffold.inspect": { "kind": unknown; "metadata": unknown; "spec"?: unknown };
"pack.inspect": { "pack": unknown; "availablePacks"?: unknown };
"pack.resolve.inspect": { "packs"?: unknown; "precedence"?: unknown; "targetRoot"?: unknown; "expectedBaseDigest"?: unknown; "baseSnapshot"?: unknown };
"pack.benchmark.inspect": { "id": unknown; "version": unknown; "provenance": unknown; "cases"?: unknown; "metrics"?: unknown; "evidenceRefs"?: unknown };
"pack.gold-case.inspect": { "id": unknown; "version": unknown; "source": unknown; "expectedOutcome": unknown; "provenance": unknown; "expectedConcepts"?: unknown; "evidenceRefs"?: unknown };
"pack.certification.inspect": { "pack": unknown; "benchmark": unknown; "algorithm": unknown; "policy": unknown; "toolchain": unknown; "goldCases"?: unknown; "qualityLevel"?: unknown; "signer"?: unknown; "evidenceRefs"?: unknown };
"semantic.evidence-adapter.inspect": { "id": unknown; "version": unknown; "provenance": unknown; "sourceTypes"?: unknown };
"semantic.evidence.import.inspect": { "source": unknown; "adapter"?: unknown; "records"?: unknown; "fetchedAt"?: unknown };
"project-ontology.proposal.inspect": { "project": unknown; "packs": unknown; "precedence"?: unknown; "targetRoot"?: unknown; "baseSnapshot"?: unknown; "expectedBaseDigest"?: unknown; "overlay"?: unknown; "now"?: unknown };
"project-ontology.snapshot.resolve": { "proposal": unknown; "expectedProposalDigest": unknown; "foundationDigest": unknown; "priorSnapshot"?: unknown; "now"?: unknown };
"project-ontology.projections.inspect": { "snapshot": unknown };
"project-ontology.skill.inspect": { "snapshot": unknown; "projectionSet"?: unknown; "artifactSetManifestDigest"?: unknown; "instructions"?: unknown };
"ontology.inspect": Record<string, never>;
"ontology.validate": { "sourceId": unknown };
"ontology.diff": { "leftSourceId": unknown; "rightSourceId": unknown };
}
export type LegacyQueryRequest = { [K in keyof LegacyQueryInputs]: { operation: K; scope: Scope; input: LegacyQueryInputs[K] } }[keyof LegacyQueryInputs];
export interface LegacyQueryOutput { operation: keyof LegacyQueryInputs; compatibility: "evopilot-harness@4.8.2"; previewOnly: true; authority: false; result: unknown }
export type HistoricalMutation = "ontology.publish" | "pack.lifecycle.create" | "pack.lifecycle.transition" | "project-ontology.proposal.create" | "project-ontology.proposal.transition" | "project-ontology.artifact.publish" | "project-ontology.artifact.transition" | "semantic.closure.publish" | "producer.prepare" | "producer.decide" | "catalog.prepare" | "catalog.decide" | "semantic.catalog.publish" | "semantic.catalog.rollback" | "semantic.catalog.revoke" | "semantic.catalog.recover";
export type HistoricalRead = "producer.inspect" | "producer.list" | "catalog.plan-inspect" | "semantic.catalog.preview" | "semantic.catalog.inspect" | "semantic.catalog.readback" | "semantic.catalog.transition-preview" | "semantic.catalog.recovery-inspect" | "semantic.catalog.recovery-readback";
export type HistoricalRequest = { operation: HistoricalMutation; scope: Scope; input: Record<string, unknown>; requestId: string; expectedRevision: number } | { operation: HistoricalRead; scope: Scope; input: Record<string, unknown> };
export interface ClassificationInputs {
  'classification.inspect': { id: string };
  'classification.resume': { id: string };
  'classification.list': Record<string, never>;
  'classification.close': { id: string };
  'classification.continue_to_harness': { id: string; decisionToken: string; humanEvidence: { uid: number; analysisResultDigest: string; evidenceRef: string } };
}
export interface ClassificationOutputs {
  'classification.inspect': ClassificationSession;
  'classification.resume': ClassificationSession;
  'classification.list': { id: string; sourceId: string; status: ClassificationSession['status']; authority: false }[];
  'classification.close': Receipt<{ id: string; status: 'CLOSED'; authority: false }>;
  'classification.continue_to_harness': Receipt<ClassificationHandoff>;
}
export type ClassificationControlRequest = { [K in keyof ClassificationInputs]: { operation: K; scope: Scope; input: ClassificationInputs[K] } & (K extends 'classification.close' | 'classification.continue_to_harness' ? { requestId: string; expectedRevision: number } : {}) }[keyof ClassificationInputs];
export type ExecuteRequest = ServiceRequest | LegacyQueryRequest | HistoricalRequest | ClassificationControlRequest;
