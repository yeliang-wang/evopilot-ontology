import type { CatalogGeneration, CatalogSet, PreparedClassification, ClassificationResult, ClassificationHandoff } from "../persistence-types.js";

/** Historical exports return unknown until checked by their schema-specific consumers. */
export namespace taxonomy {
  function loadTaxonomy(...args: unknown[]): unknown;
  function resolveTaxonomy(...args: unknown[]): unknown;
  function canonicalDocumentDigestFor(...args: unknown[]): unknown;
  function normalizeTerm(...args: unknown[]): unknown;
  function canonicalCompare(...args: unknown[]): unknown;
  const TAXONOMY_SCHEMA: "harness.evopilot.io/v1";
  const RESOLVED_TAXONOMY_SCHEMA: "evopilot-harness-resolved-taxonomy-snapshot/v1";
  const SEMANTIC_FOUNDATION_SCHEMA: "evopilot-harness-semantic-foundation/v1";
  const TAXONOMY_CANONICALIZATION: "taxonomy-c14n/v1";
  const SUPPORTED_TAXONOMY_CAPABILITIES: readonly string[];
  const TAXONOMY_RESOURCE_LIMITS: unknown;
  const COMPATIBILITY_ENGINE_VERSION: "4.8.2";
}
export namespace grounding {
  function resolveOntologyFoundation(...args: unknown[]): { foundationDigest: string; [key: string]: unknown };
  function createSemanticCandidateSet(...args: unknown[]): unknown;
  function resolveOntologyGrounding(...args: unknown[]): unknown;
  function createGroundingPresentation(...args: unknown[]): unknown;
  const ONTOLOGY_FOUNDATION_SCHEMA: "evopilot-harness-ontology-foundation/v1";
  const SEMANTIC_CANDIDATE_SET_SCHEMA: "evopilot-harness-semantic-candidate-set/v1";
  const ONTOLOGY_GROUNDING_RESULT_SCHEMA: "evopilot-harness-ontology-grounding-result/v1";
  const SEMANTIC_META_TYPES: readonly string[];
  const SEMANTIC_RELATION_TYPES: readonly string[];
  const GROUNDING_OUTCOMES: readonly string[];
}
export namespace packs {
  function createProfessionalPack(...args: unknown[]): unknown;
  function validateProfessionalPack(...args: unknown[]): unknown;
  function inspectProfessionalPack(...args: unknown[]): { lint: { status: "PASSED" | "FAILED"; issues: unknown[] }; [key: string]: unknown };
  function resolveProfessionalPackSet(...args: unknown[]): { packSetDigest: string; conflicts: unknown[]; [key: string]: unknown };
  function createPackLifecycleRecord(...args: unknown[]): Record<string, unknown>;
  function transitionPackLifecycle(...args: unknown[]): Record<string, unknown>;
  function createPackBenchmarkPackage(...args: unknown[]): unknown;
  function createPackGoldCasePackage(...args: unknown[]): unknown;
  function createPackCertificationRecord(...args: unknown[]): unknown;
  function createExternalSemanticEvidenceAdapter(...args: unknown[]): unknown;
  function importExternalSemanticEvidence(...args: unknown[]): unknown;
  const PROFESSIONAL_PACK_API_VERSION: "semantics.evopilot.io/v1";
  const PROFESSIONAL_PACK_KINDS: readonly string[];
  const PACK_ROOTS: readonly string[];
  const PACK_VISIBILITY: readonly string[];
  const PACK_QUALITY_LEVELS: readonly string[];
  const PACK_LIFECYCLE_STAGES: readonly string[];
  const EXTERNAL_SEMANTIC_EVIDENCE_ADAPTER_SCHEMA: "evopilot-harness-external-semantic-evidence-adapter/v1";
}
export namespace projectOntology {
  function createProjectOntologyProposal(...args: unknown[]): Record<string, unknown>;
  function transitionProjectOntologyProposal(...args: unknown[]): Record<string, unknown>;
  function resolveProjectOntologySnapshot(...args: unknown[]): unknown;
  function createProjectionSet(...args: unknown[]): unknown;
  function compileProjectOntologySkill(...args: unknown[]): unknown;
  function publishProjectOntologyArtifactSet(...args: unknown[]): Record<string, unknown>;
  function createArtifactLifecycleRecord(...args: unknown[]): Record<string, unknown>;
  function validateProjectOntologyDocument(...args: unknown[]): unknown;
  const PROJECT_ONTOLOGY_PROPOSAL_SCHEMA: "evopilot-harness-project-ontology-proposal/v1";
  const RESOLVED_PROJECT_ONTOLOGY_SCHEMA: "evopilot-harness-resolved-project-ontology-snapshot/v1";
  const PROJECT_ONTOLOGY_ARTIFACT_SET_SCHEMA: "evopilot-harness-project-ontology-artifact-set/v1";
  const PROJECT_ONTOLOGY_SKILL_SCHEMA: "evopilot-harness-project-ontology-skill/v1";
}
export namespace interoperability {
  function createOntologyReasoningProfile(...args: unknown[]): unknown;
  function validateOntologyReasoningProfile(...args: unknown[]): unknown;
  function buildSemanticIndex(...args: unknown[]): unknown;
  function validateSemanticIndex(...args: unknown[]): unknown;
  function calculateAffectedSubgraph(...args: unknown[]): unknown;
  function computeSemanticState(...args: unknown[]): unknown;
  function compareSemanticComputations(...args: unknown[]): unknown;
  function discoverFederatedPacks(...args: unknown[]): unknown;
  function createInteroperabilityProjectionSet(...args: unknown[]): unknown;
  function verifySemanticRoundTrip(...args: unknown[]): unknown;
  function createTerminalSemanticClosure(...args: unknown[]): unknown;
  function publishTerminalSemanticClosure(...args: unknown[]): Record<string, unknown>;
  function sliceTerminalSemanticClosure(...args: unknown[]): unknown;
  function validateSemanticInteroperabilityDocument(...args: unknown[]): unknown;
  const ONTOLOGY_REASONING_PROFILE_SCHEMA: "evopilot-harness-ontology-reasoning-profile/v1";
  const SEMANTIC_INDEX_SCHEMA: "evopilot-harness-semantic-index/v1";
  const AFFECTED_SUBGRAPH_SCHEMA: "evopilot-harness-affected-subgraph/v1";
  const SEMANTIC_COMPUTATION_SCHEMA: "evopilot-harness-semantic-computation/v1";
  const FEDERATED_PACK_DISCOVERY_SCHEMA: "evopilot-harness-federated-pack-discovery/v1";
  const INTEROPERABILITY_PROJECTION_SET_SCHEMA: "evopilot-harness-semantic-interoperability-projection-set/v1";
  const SEMANTIC_ROUND_TRIP_REPORT_SCHEMA: "evopilot-harness-semantic-round-trip-report/v1";
  const TERMINAL_SEMANTIC_CLOSURE_SCHEMA: "evopilot-harness-terminal-semantic-closure/v1";
  const TERMINAL_SEMANTIC_SLICE_SCHEMA: "evopilot-harness-terminal-semantic-slice/v1";
  const REASONING_MODES: readonly string[];
}
export namespace validation {
  function validateDocument(document: unknown, file?: string): { valid: boolean; errors: unknown[] };
}
export namespace catalogBudget {
  function createSupplyBudget(...args: unknown[]): unknown;
}
export namespace catalogContract {
  function supplyError(...args: unknown[]): unknown;
  function requireSupply(...args: unknown[]): unknown;
  function supplyLimits(...args: unknown[]): unknown;
  function isSupplyDigest(...args: unknown[]): unknown;
  function isSupplyId(...args: unknown[]): unknown;
  function isSupplyVersion(...args: unknown[]): unknown;
  function supplyBytes(...args: unknown[]): unknown;
  function parseSupplyJson(...args: unknown[]): unknown;
  function withSupplyDigest(...args: unknown[]): unknown;
  function validateSupplyDigest(...args: unknown[]): unknown;
  function supplyRelativePath(...args: unknown[]): unknown;
  function contentPath(...args: unknown[]): unknown;
  function validateSupplyScope(...args: unknown[]): unknown;
  function validateSupplyGraph(...args: unknown[]): unknown;
  function validateSemanticGeneration(...args: unknown[]): unknown;
  function validateSemanticPointer(...args: unknown[]): unknown;
  const SEMANTIC_POINTER_SCHEMA: "evopilot-harness-semantic-catalog-pointer/v1";
  const SEMANTIC_CATALOG_SCHEMA: "evopilot-harness-semantic-catalog/v1";
  const SEMANTIC_RECEIPT_SCHEMA: "evopilot-harness-semantic-catalog-receipt/v1";
  const SEMANTIC_SUPPLY_LIMITS: unknown;
}
export namespace catalogGeneration {
  function assembleSemanticGeneration(input: { catalogId: string; sets: unknown[]; revokedDigests?: string[]; limits?: unknown }): { generation: CatalogGeneration; material: Map<string, unknown> };
  function resolveSemanticGeneration(input: { generation: CatalogGeneration; material: Map<string, unknown>; limits?: unknown }): CatalogSet[];
}
export namespace catalogMaterials {
  function validateSemanticSupplyMaterials(...args: unknown[]): unknown;
}
export namespace catalogStore {
  function openSemanticCatalogStore(...args: unknown[]): Promise<unknown>;
}
export namespace catalogSupply {
  function semanticPublicationSubject(...args: unknown[]): unknown;
  function semanticRecoverySubject(...args: unknown[]): unknown;
  function semanticCatalogOperation(...args: unknown[]): Promise<unknown>;
  const SEMANTIC_POLICY_SCHEMA: "evopilot-harness-semantic-catalog-policy/v1";
}
export namespace classification {
  function prepareSourceTaxonomyAnalysis(...args: unknown[]): unknown;
  function prepareResolvedSourceTaxonomyAnalysis(input: { resolvedSource: unknown; resolvedTaxonomy: unknown }): PreparedClassification;
  function analyzeSourceTaxonomy(...args: unknown[]): Promise<unknown>;
  function analyzePreparedSourceTaxonomy(...args: unknown[]): Promise<ClassificationResult>;
  function createClassificationHandoff(input: { classificationSessionId: string; result: ClassificationResult | null; decidedBy: unknown; decisionToken: string }): ClassificationHandoff;
}
export namespace classifier {
  function retrieveTaxonomyCandidates(...args: unknown[]): unknown;
  function aggregateTaxonomyDecision(...args: unknown[]): unknown;
  const RETRIEVAL_CONFIG: unknown;
  const TAXONOMY_RESULTS: readonly string[];
}
export namespace classificationAdvisor {
  function requestTaxonomyAdvisor(...args: unknown[]): Promise<unknown>;
  function advisorModelBinding(...args: unknown[]): unknown;
  const ADVISOR_PROMPT_VERSION: "advisor-candidate-analysis/v5";
  const ADVISOR_INPUT_LIMITS: unknown;
}
export namespace classificationEvaluation {
  function createClassificationEvaluationReport(...args: unknown[]): unknown;
  function validateGoldManifest(...args: unknown[]): unknown;
  const CLASSIFICATION_EVALUATION_SCHEMA: "evopilot-harness-classification-evaluation-report/v1";
  const CLASSIFICATION_EVALUATION_THRESHOLDS: unknown;
}
export namespace sourceDescriptor {
  function normalizeSourceDescriptor(...args: unknown[]): unknown;
  function sourceDescriptorDigest(...args: unknown[]): unknown;
  function resolveSourceDescriptor(...args: unknown[]): unknown;
  const SOURCE_DESCRIPTOR_SCHEMA: "evopilot-harness-source-descriptor/v1";
  const SOURCE_RESOLUTION_SCHEMA: "evopilot-harness-source-resolution/v1";
  const SOURCE_RESOLVER_POLICY: "evopilot-harness-source-resolver/v1";
  const SOURCE_REDACTION_POLICY: "evopilot-harness-source-redaction/v1";
}
export namespace sourceConcept {
  function buildSourceConceptHypothesis(...args: unknown[]): unknown;
  const SOURCE_CONCEPT_HYPOTHESIS_SCHEMA: "evopilot-harness-source-concept-hypothesis/v1";
}
