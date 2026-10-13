import type { DatabaseSync } from 'node:sqlite';
import type { OntologyModel, Scope, WorkspaceIdentity, Decision, TrustedProviders, ClassificationModel, JSONValue } from './types.js';
import type { buildDelivery } from './delivery.js';
import type { validateOntology } from './specification.js';
import type { inspectLegacySource } from './migration.js';

export interface AssetRecord {
  scope: Scope; model: OntologyModel; digest: string;
  validation: ReturnType<typeof validateOntology>;
  review: { workspace: WorkspaceIdentity; scope: Scope; assetDigest: string; validation: ReturnType<typeof validateOntology>; reviewDigest: string } | null;
  decision: Decision | null; delivery: ReturnType<typeof buildDelivery> | null;
}
export interface SourceRecord {
  scope: Scope; sourceId: string; rawDigest: string; documentDigest: string;
  sourceLocator: string; sourceRevision: string; sourceVisibility: Scope['visibility'];
  format: 'json' | 'yaml'; document: JSONValue;
  inspection: ReturnType<typeof inspectLegacySource>; observed: Record<string, unknown>;
  status: 'INSPECTED' | 'QUARANTINED'; authority: boolean;
}
export interface PreparedClassification {
  taxonomy: unknown; hypothesis: unknown; ontologyFoundation: unknown;
  semanticCandidateSet: unknown; retrieval: unknown; resolvedSource: unknown;
}
export interface ClassificationResult {
  [key: string]: unknown;
  status?: string; analysisResultDigest?: string;
}
export interface ClassificationHandoff {
  [key: string]: unknown;
  schema: 'evopilot-harness-classification-handoff/v1';
  classificationSessionId: string; analysisResultDigest: string;
  decision: 'CONTINUE_TO_HARNESS'; handoffDigest: string;
}
export interface ClassificationAttempt {
  attemptId: string; requestId: string; sourceId: string; taxonomy: unknown;
  prepared: PreparedClassification; preparedDigest: string; model: ClassificationModel;
  status: 'PREPARED' | 'INVOKING' | 'UNKNOWN' | 'COMPLETED' | 'ANALYSIS_BLOCKED_ADVISOR';
  claim: ({ attemptId: string } & Record<string, unknown>) | null;
  result: ClassificationResult | null; resultDigest: string | null;
}
export interface ClassificationSession {
  id: string; scope: Scope; sourceId: string; ownerUid: number;
  status: 'PENDING' | 'UNKNOWN' | 'COMPLETED' | 'ANALYSIS_BLOCKED_ADVISOR' | 'CLOSED';
  attempts: ClassificationAttempt[]; handoffs: ClassificationHandoff[]; authority?: boolean;
}
export interface ProducerHistory {
  document: Record<string, unknown>; decision: (Decision & { at: string }) | null; planId: string;
  material?: Record<string, unknown>; materialDigest?: string;
  foundation?: { foundationDigest: string; [key: string]: unknown };
}
export interface ProducerRecord {
  scope: Scope; recordId: string;
  kind: 'OntologyPack' | 'PackLifecycle' | 'Proposal' | 'Artifact' | 'ArtifactLifecycle' | 'Closure';
  document: Record<string, unknown>; digest: string; history: ProducerHistory[];
  material?: Record<string, unknown>; materialDigest?: string;
  foundation?: { foundationDigest: string; [key: string]: unknown }; foundationDigest?: string;
}
export interface ProducerPlan {
  workspace: WorkspaceIdentity; scope: Scope; operation: string;
  parameters: Record<string, unknown>; dependencies: unknown[]; createdAt: string;
  status: 'PREPARED' | 'CONSUMED'; reviewDigest: string; planId: string;
  decision: (Decision & { at: string }) | null;
  output: { recordIds: string[]; requestId: string } | null;
}
export interface CatalogParameters {
  catalogId: string; expectedHead: string; action: 'PUBLISH' | 'ROLLBACK' | 'REVOKE';
  sets?: CatalogSet[]; targetPointerDigest?: string; revokedDigests?: string[];
}
export interface CatalogPlan {
  workspace: WorkspaceIdentity; scope: Scope; parameters: CatalogParameters;
  dependencies: { recordId: string; digest: string }[]; inputDigest: string;
  expectedGenerationDigest: string; transitionDigest: string;
  status: 'PREPARED' | 'CONSUMED'; reviewDigest: string; planId: string;
  decision: { reviewDigest: string; decision: 'APPROVE' | 'REJECT'; evidenceRef: string; uid: number; at: string } | null;
  output: string | null;
}
export interface CatalogPointer {
  workspace: WorkspaceIdentity; scope: Scope; catalogId: string;
  generationDigest: string; materialDigest: string; previous: string;
  action: CatalogParameters['action']; planId: string; decision: CatalogPlan['decision'];
  actor: string; at: string; requestId: string; intentDigest: string; pointerDigest: string;
}
export interface CatalogGeneration {
  schema: string; catalogId: string; generationDigest: string; revokedDigests: string[];
  entries: { objectDigest: string; [key: string]: unknown }[];
  sets: unknown[];
}
export interface CatalogRevision {
  workspace: WorkspaceIdentity; scope: Scope; pointer: CatalogPointer;
  generation: CatalogGeneration; material: [string, unknown][];
}
export interface State {
  assets: AssetRecord[]; sources?: SourceRecord[];
  producerPlans?: ProducerPlan[]; producerRecords?: ProducerRecord[];
  catalogPlans?: CatalogPlan[]; catalogRevisions?: CatalogRevision[];
  catalogHeads?: { scope: Scope; catalogId: string; pointerDigest: string }[];
  classificationSessions?: ClassificationSession[];
}
export interface Store {
  db: DatabaseSync; uid: number; identity: WorkspaceIdentity;
  guard(): void; blob(scope: Scope, value: unknown): string;
  verifyBlob(scope: Scope, value: unknown): void;
  rawBlob(scope: Scope, raw: string): string;
  verifyRawBlob(scope: Scope, digest: string): string;
  trustedProviders: TrustedProviders; classificationActive?: Set<string>;
}

export interface CatalogSet {
  artifactSet: Record<string, unknown>; closure: { rollbackLinks: unknown[] };
  foundation: unknown; proposal: { stage: string }; packs: unknown[];
  profile: unknown; index: unknown; projectionSet: unknown; roundTripReport: unknown;
  incremental: unknown; full: unknown;
  support: { binding: unknown; document: { schema?: string } }[];
  harnessAssets: { entry: { kind: string; id: string; version: string; assetDigest: string }; document: unknown }[];
  priorSnapshot?: unknown; basePackSet?: unknown;
}
