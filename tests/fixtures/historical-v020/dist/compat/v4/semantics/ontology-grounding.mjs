import { digest, persistedJson } from "../../v3/utils.mjs";
import { canonicalCompare, normalizeTerm } from "../classification/taxonomy.mjs";

export const ONTOLOGY_FOUNDATION_SCHEMA = "evopilot-harness-ontology-foundation/v1";
export const SEMANTIC_CANDIDATE_SET_SCHEMA = "evopilot-harness-semantic-candidate-set/v1";
export const ONTOLOGY_GROUNDING_RESULT_SCHEMA = "evopilot-harness-ontology-grounding-result/v1";

export const SEMANTIC_META_TYPES = Object.freeze([
  "ENTITY", "ATTRIBUTE", "RELATIONSHIP", "RULE", "EVENT", "ACTION", "ACTOR",
  "ROLE", "PERMISSION", "STATE", "WORKFLOW", "CAPABILITY", "SYSTEM", "DATA_ASSET"
]);

export const SEMANTIC_RELATION_TYPES = Object.freeze([
  "IS_A", "PART_OF", "REQUIRES", "PERFORMS", "CONSTRAINS", "TRIGGERS",
  "RECOVERS_WITH", "VALIDATED_BY", "ALTERNATIVE_TO", "MITIGATES", "PRODUCES"
]);

export const GROUNDING_OUTCOMES = Object.freeze([
  "RESOLVED", "UNRESOLVED_CONCEPT", "AMBIGUOUS_CONCEPT", "CONFLICTING_CONCEPT",
  "EXTENSION_REQUIRED", "EVIDENCE_INSUFFICIENT"
]);

const MAX_CANDIDATES = 512;
const MAX_CONCEPTS = 4096;
const MAX_EVIDENCE_REFS = 64;

export function resolveOntologyFoundation(input = {}) {
  const metaTypes = uniqueSorted(input.metaTypes ?? SEMANTIC_META_TYPES);
  const relationTypes = uniqueSorted(input.relationTypes ?? SEMANTIC_RELATION_TYPES);
  assertExactSet(metaTypes, SEMANTIC_META_TYPES, "metaTypes");
  assertExactSet(relationTypes, SEMANTIC_RELATION_TYPES, "relationTypes");
  const core = {
    schema: ONTOLOGY_FOUNDATION_SCHEMA,
    version: 1,
    metaTypes,
    relationTypes,
    limits: {
      maxCandidates: boundedInteger(input.limits?.maxCandidates, MAX_CANDIDATES, 1, MAX_CANDIDATES),
      maxConcepts: boundedInteger(input.limits?.maxConcepts, MAX_CONCEPTS, 1, MAX_CONCEPTS),
      maxEvidenceRefsPerCandidate: boundedInteger(input.limits?.maxEvidenceRefsPerCandidate, MAX_EVIDENCE_REFS, 1, MAX_EVIDENCE_REFS)
    },
    authority: {
      engineOwnedMetaModel: true,
      containsBusinessValues: false,
      executable: false,
      mayDecideEligibility: false,
      mayApprove: false,
      mayPublish: false
    }
  };
  core.foundationDigest = digest(core);
  return core;
}

export function createSemanticCandidateSet({ sourceConceptHypothesis, candidates, extraction = {} }) {
  if (!sourceConceptHypothesis?.sourceSnapshotDigest || !sourceConceptHypothesis?.evidenceGraphDigest) {
    throw semanticError("SEMANTIC_SOURCE_BINDING_REQUIRED", "Semantic candidates require an immutable Source snapshot and Evidence Graph binding.");
  }
  const derived = candidates ?? deriveCandidates(sourceConceptHypothesis);
  if (!Array.isArray(derived) || derived.length > MAX_CANDIDATES) throw semanticError("SEMANTIC_CANDIDATE_LIMIT", `Semantic candidates must contain at most ${MAX_CANDIDATES} entries.`);
  const normalized = derived.map((candidate, index) => normalizeCandidate(candidate, index)).sort((left, right) => canonicalCompare(left.candidateId, right.candidateId));
  const core = {
    schema: SEMANTIC_CANDIDATE_SET_SCHEMA,
    sourceSnapshotDigest: sourceConceptHypothesis.sourceSnapshotDigest,
    evidenceGraphDigest: sourceConceptHypothesis.evidenceGraphDigest,
    candidates: normalized,
    extraction: {
      algorithm: extraction.algorithm ?? "evidence-bound-professional-semantic-extraction/v1",
      deterministicSignals: true,
      llmAdviceSeparated: true,
      sourceExecution: false,
      bounded: true
    },
    authority: { engineOwnsCandidateSet: true, llmMayAdvise: true, llmMayAssignAuthoritativeConceptId: false, sourceMayMutate: false }
  };
  core.candidateSetDigest = digest(core);
  return core;
}

export function resolveOntologyGrounding({ foundation: foundationInput, candidateSet, concepts = [], expected = {}, priorResults = [], locale = "zh-CN" }) {
  const foundation = resolveOntologyFoundation(foundationInput);
  validateCandidateSet(candidateSet, foundation);
  if (expected.foundationDigest && expected.foundationDigest !== foundation.foundationDigest) throw semanticError("ONTOLOGY_FOUNDATION_DRIFT", "Ontology Foundation changed; create an explicit new grounding analysis.");
  if (expected.candidateSetDigest && expected.candidateSetDigest !== candidateSet.candidateSetDigest) throw semanticError("SEMANTIC_CANDIDATE_SET_DRIFT", "Semantic Candidate Set changed; create an explicit new grounding analysis.");
  if (!Array.isArray(concepts) || concepts.length > foundation.limits.maxConcepts) throw semanticError("ONTOLOGY_CONCEPT_LIMIT", `Ontology context must contain at most ${foundation.limits.maxConcepts} concepts.`);
  const canonicalConcepts = concepts.map(normalizeConcept).sort((left, right) => canonicalCompare(left.conceptId, right.conceptId));
  const conceptSetDigest = digest(canonicalConcepts);
  if (expected.conceptSetDigest && expected.conceptSetDigest !== conceptSetDigest) throw semanticError("ONTOLOGY_CONTEXT_DRIFT", "Ontology context changed; create an explicit new grounding analysis.");
  validatePriorResults(priorResults);
  const results = candidateSet.candidates.map((candidate) => groundCandidate(candidate, canonicalConcepts));
  const core = {
    schema: ONTOLOGY_GROUNDING_RESULT_SCHEMA,
    foundationDigest: foundation.foundationDigest,
    candidateSetDigest: candidateSet.candidateSetDigest,
    sourceSnapshotDigest: candidateSet.sourceSnapshotDigest,
    evidenceGraphDigest: candidateSet.evidenceGraphDigest,
    conceptSetDigest,
    results,
    outcomeCounts: Object.fromEntries(GROUNDING_OUTCOMES.map((outcome) => [outcome, results.filter((item) => item.outcome === outcome).length])),
    precedence: ["EVIDENCE_INSUFFICIENT", "CONFLICTING_CONCEPT", "AMBIGUOUS_CONCEPT", "RESOLVED", "EXTENSION_REQUIRED", "UNRESOLVED_CONCEPT"],
    priorResultDigests: priorResults.map((item) => item.groundingResultDigest),
    presentation: createGroundingPresentation(results, locale),
    authority: {
      deterministicResolverDecides: true,
      llmAdviceIsEvidenceOnly: true,
      llmMayAssignAuthoritativeConceptId: false,
      provesHarnessEligibility: false,
      mayCreateProposal: false,
      mayApprove: false,
      mayPublish: false,
      appendOnlyReanalysis: true
    }
  };
  core.groundingResultDigest = digest(core);
  return core;
}

export function createGroundingPresentation(results, locale = "zh-CN") {
  const chinese = locale === "zh-CN";
  const labels = chinese ? {
    RESOLVED: "已找到对应业务概念",
    UNRESOLVED_CONCEPT: "尚未找到对应业务概念",
    AMBIGUOUS_CONCEPT: "存在多个可能的业务概念",
    CONFLICTING_CONCEPT: "素材概念与现有定义冲突",
    EXTENSION_REQUIRED: "需要补充业务概念",
    EVIDENCE_INSUFFICIENT: "素材依据不足"
  } : Object.fromEntries(GROUNDING_OUTCOMES.map((outcome) => [outcome, outcome.toLowerCase().replaceAll("_", " ")]));
  return {
    schema: "evopilot-harness-ontology-grounding-presentation/v1",
    locale: chinese ? "zh-CN" : "en",
    title: chinese ? "素材中的业务概念分析" : "Business concepts found in the Source",
    items: results.map((item) => ({ candidateId: item.candidateId, conclusion: labels[item.outcome], reason: item.explanation, nextChoices: item.userActions })),
    auditTermsHiddenFromPrimaryView: ["OntologyFoundation", "SemanticCandidateSet", "OntologyGroundingResolver", "digest", "precedence"],
    hostAuthored: false
  };
}

function deriveCandidates(hypothesis) {
  const evidenceByConcept = hypothesis.concepts ?? [];
  return evidenceByConcept.slice(0, MAX_CANDIDATES).map((concept, index) => ({
    candidateId: `candidate-${String(index + 1).padStart(4, "0")}`,
    label: concept.term,
    metaType: inferMetaType(concept.term),
    evidenceIds: concept.evidenceIds,
    evidenceFamilies: concept.evidenceFamilies,
    deterministicSignals: [{ type: "SOURCE_TERM_WEIGHT", value: Number(concept.weight ?? 0) }],
    llmAdvice: null,
    proposedExtension: null,
    uncertainty: Number(concept.weight ?? 0) >= 4 ? "BOUNDED" : "HIGH"
  }));
}

function normalizeCandidate(candidate, index) {
  const metaType = String(candidate?.metaType ?? "CAPABILITY").toUpperCase();
  if (!SEMANTIC_META_TYPES.includes(metaType)) throw semanticError("SEMANTIC_META_TYPE_INVALID", `Unsupported semantic meta-type: ${metaType}`);
  const label = String(candidate?.label ?? "").trim();
  if (!label) throw semanticError("SEMANTIC_CANDIDATE_LABEL_REQUIRED", "Every semantic candidate requires a label.");
  const evidenceIds = uniqueSorted(candidate.evidenceIds ?? []).slice(0, MAX_EVIDENCE_REFS);
  const evidenceFamilies = uniqueSorted(candidate.evidenceFamilies ?? []).slice(0, MAX_EVIDENCE_REFS);
  const authoritativeConceptIds = uniqueSorted(candidate.authoritativeConceptIds ?? []);
  const llmAdvice = candidate.llmAdvice ? persistedJson(candidate.llmAdvice) : null;
  if (llmAdvice?.authoritativeConceptId || llmAdvice?.selectedConceptId) throw semanticError("LLM_AUTHORITY_REJECTED", "LLM advice cannot assign an authoritative ontology concept identifier.");
  return {
    candidateId: String(candidate.candidateId ?? `candidate-${String(index + 1).padStart(4, "0")}`),
    label,
    normalizedLabel: normalizeTerm(label),
    metaType,
    evidenceIds,
    evidenceFamilies,
    deterministicSignals: persistedJson(candidate.deterministicSignals ?? []),
    authoritativeConceptIds,
    conflictConceptIds: uniqueSorted(candidate.conflictConceptIds ?? []),
    proposedExtension: candidate.proposedExtension ? persistedJson(candidate.proposedExtension) : null,
    llmAdvice,
    uncertainty: ["LOW", "BOUNDED", "HIGH"].includes(candidate.uncertainty) ? candidate.uncertainty : "HIGH"
  };
}

function normalizeConcept(concept) {
  const conceptId = String(concept?.conceptId ?? "").trim();
  const label = String(concept?.label ?? "").trim();
  const metaType = String(concept?.metaType ?? "").toUpperCase();
  if (!conceptId || !label || !SEMANTIC_META_TYPES.includes(metaType)) throw semanticError("ONTOLOGY_CONCEPT_INVALID", "Every ontology concept requires conceptId, label, and a Foundation metaType.");
  return { conceptId, label, normalizedLabel: normalizeTerm(label), aliases: uniqueSorted(concept.aliases ?? []).map(normalizeTerm), metaType, definition: String(concept.definition ?? ""), relations: persistedJson(concept.relations ?? []) };
}

function groundCandidate(candidate, concepts) {
  const supported = candidate.evidenceIds.length >= 2 && new Set(candidate.evidenceFamilies.map(independentEvidenceFamily)).size >= 2;
  const exact = concepts.filter((concept) => concept.metaType === candidate.metaType && [concept.normalizedLabel, ...concept.aliases].includes(candidate.normalizedLabel));
  const explicit = concepts.filter((concept) => candidate.authoritativeConceptIds.includes(concept.conceptId));
  const matches = uniqueById([...explicit, ...exact]);
  const conflicts = uniqueSorted(candidate.conflictConceptIds).filter((id) => concepts.some((concept) => concept.conceptId === id));
  let outcome;
  if (!supported) outcome = "EVIDENCE_INSUFFICIENT";
  else if (conflicts.length) outcome = "CONFLICTING_CONCEPT";
  else if (matches.length > 1) outcome = "AMBIGUOUS_CONCEPT";
  else if (matches.length === 1) outcome = "RESOLVED";
  else if (candidate.proposedExtension?.parentConceptId && candidate.proposedExtension?.definition) outcome = "EXTENSION_REQUIRED";
  else outcome = "UNRESOLVED_CONCEPT";
  return {
    candidateId: candidate.candidateId,
    outcome,
    resolvedConceptId: outcome === "RESOLVED" ? matches[0].conceptId : null,
    candidateConceptIds: matches.map((item) => item.conceptId),
    conflictConceptIds: conflicts,
    evidenceIds: candidate.evidenceIds,
    evidenceFamilies: candidate.evidenceFamilies,
    uncertainty: outcome === "RESOLVED" ? candidate.uncertainty : "HIGH",
    explanation: outcomeExplanation(outcome),
    userActions: outcomeActions(outcome),
    proposedExtension: outcome === "EXTENSION_REQUIRED" ? candidate.proposedExtension : null,
    decisionSignals: { exactOrAliasMatches: exact.map((item) => item.conceptId), explicitAuthoritativeMatches: explicit.map((item) => item.conceptId), independentEvidenceFamilyCount: new Set(candidate.evidenceFamilies.map(independentEvidenceFamily)).size, llmAdviceObserved: Boolean(candidate.llmAdvice), llmAdviceAuthoritative: false }
  };
}

function validateCandidateSet(value, foundation) {
  const copy = persistedJson(value ?? {}); delete copy.candidateSetDigest;
  if (value?.schema !== SEMANTIC_CANDIDATE_SET_SCHEMA || value?.candidateSetDigest !== digest(copy)) throw semanticError("SEMANTIC_CANDIDATE_SET_INVALID", "Semantic Candidate Set schema or digest is invalid.");
  if (value.candidates.length > foundation.limits.maxCandidates) throw semanticError("SEMANTIC_CANDIDATE_LIMIT", "Semantic Candidate Set exceeds the Foundation resource bound.");
}

function validatePriorResults(priorResults) {
  for (const prior of priorResults) {
    const copy = persistedJson(prior); delete copy.groundingResultDigest;
    if (prior?.schema !== ONTOLOGY_GROUNDING_RESULT_SCHEMA || prior.groundingResultDigest !== digest(copy)) throw semanticError("GROUNDING_HISTORY_INVALID", "Prior grounding history is not immutable or digest-valid.");
  }
}

function inferMetaType(term) {
  const value = normalizeTerm(term);
  if (/permission|access|授权|权限/.test(value)) return "PERMISSION";
  if (/role|persona|角色/.test(value)) return "ROLE";
  if (/operator|admin|user|actor|操作员|管理员|用户|参与者/.test(value)) return "ACTOR";
  if (/attribute|field|property|属性|字段/.test(value)) return "ATTRIBUTE";
  if (/relationship|relation|dependency|关系|依赖/.test(value)) return "RELATIONSHIP";
  if (/event|trigger|message|事件|触发|消息/.test(value)) return "EVENT";
  if (/fail|error|fault|status|state|失败|错误|故障|状态/.test(value)) return "STATE";
  if (/recover|rollback|retry|validate|verify|test|task|job|恢复|回滚|重试|校验|验证|测试|任务/.test(value)) return "ACTION";
  if (/workflow|pipeline|process|流程|工作流/.test(value)) return "WORKFLOW";
  if (/constraint|policy|rule|limit|risk|约束|策略|规则|限制|风险/.test(value)) return "RULE";
  if (/system|platform|service|系统|平台|服务/.test(value)) return "SYSTEM";
  if (/data|document|table|file|数据|文档|表|文件/.test(value)) return "DATA_ASSET";
  if (/object|entity|record|对象|实体|记录/.test(value)) return "ENTITY";
  return "CAPABILITY";
}

function outcomeExplanation(outcome) {
  return ({
    RESOLVED: "One authoritative concept is supported by independent Source evidence and deterministic identity signals.",
    UNRESOLVED_CONCEPT: "The Source concept is supported, but the current semantic context has no authoritative concept to bind.",
    AMBIGUOUS_CONCEPT: "More than one authoritative concept remains equally viable.",
    CONFLICTING_CONCEPT: "Supported evidence conflicts with one or more declared authoritative concepts.",
    EXTENSION_REQUIRED: "The supported Source concept is absent and includes a bounded user-reviewable extension proposal.",
    EVIDENCE_INSUFFICIENT: "Fewer than two independent non-LLM Source evidence families support the concept."
  })[outcome];
}

function outcomeActions(outcome) {
  return ({
    RESOLVED: ["REVIEW_GROUNDING", "CONTINUE_WITH_SEMANTIC_COMPATIBILITY"],
    UNRESOLVED_CONCEPT: ["SUPPLY_EXISTING_CONCEPT", "PROPOSE_EXTENSION", "CLOSE"],
    AMBIGUOUS_CONCEPT: ["CLARIFY_CONCEPT_BOUNDARY", "SUPPLY_DISCRIMINATING_EVIDENCE", "CLOSE"],
    CONFLICTING_CONCEPT: ["RESOLVE_CONFLICT", "SUPPLY_CORRECTED_EVIDENCE", "CLOSE"],
    EXTENSION_REQUIRED: ["REVIEW_EXTENSION", "SUPPLY_REVISED_SEMANTIC_CONTEXT", "CLOSE"],
    EVIDENCE_INSUFFICIENT: ["SUPPLY_MORE_SOURCE_EVIDENCE", "CLOSE"]
  })[outcome];
}

function independentEvidenceFamily(value) { return String(value).replace(/^low-trust-/, "").replace(/^content-(?:purpose|inventory)$/, "content").replace(/^lexical-content$/, "content"); }
function uniqueSorted(values) { return [...new Set((values ?? []).map((item) => String(item).trim()).filter(Boolean))].sort(canonicalCompare); }
function uniqueById(values) { return [...new Map(values.map((item) => [item.conceptId, item])).values()].sort((left, right) => canonicalCompare(left.conceptId, right.conceptId)); }
function assertExactSet(actual, expected, field) { if (actual.length !== expected.length || expected.some((item) => !actual.includes(item))) throw semanticError("ONTOLOGY_FOUNDATION_INVALID", `${field} must equal the Engine-owned v1 Foundation set.`); }
function boundedInteger(value, fallback, minimum, maximum) { const result = value == null ? fallback : Number(value); if (!Number.isInteger(result) || result < minimum || result > maximum) throw semanticError("ONTOLOGY_RESOURCE_BOUND_INVALID", `Resource bound must be an integer from ${minimum} through ${maximum}.`); return result; }
function semanticError(code, message) { const error = new Error(message); error.name = "OntologyGroundingError"; error.code = code; error.nextAction = "repair-semantic-input-or-create-explicit-reanalysis"; return error; }
