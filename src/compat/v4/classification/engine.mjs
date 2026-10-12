import { assertCurrentSourcePolicy } from "../source/path-policy.mjs";
import { digest } from "../../v3/utils.mjs";
import { buildSourceConceptHypothesis } from "./source-concept.mjs";
import { canonicalCompare, resolveTaxonomy } from "./taxonomy.mjs";
import { aggregateTaxonomyDecision, RETRIEVAL_CONFIG, retrieveTaxonomyCandidates } from "./classifier.mjs";
import { requestTaxonomyAdvisor } from "./advisor.mjs";
import { createSemanticCandidateSet, resolveOntologyFoundation } from "../semantics/ontology-grounding.mjs";

const MAX_PRESENTATION_EVIDENCE = 12;

export function prepareSourceTaxonomyAnalysis({ source, taxonomy: taxonomyInput }) {
  const taxonomy = resolveTaxonomy(taxonomyInput);
  return prepareResolvedSourceTaxonomyAnalysis({ resolvedSource: source, resolvedTaxonomy: taxonomy });
}

export function prepareResolvedSourceTaxonomyAnalysis({ resolvedSource, resolvedTaxonomy }) {
  const taxonomy = resolvedTaxonomy;
  const hypothesis = buildSourceConceptHypothesis(resolvedSource);
  const ontologyFoundation = resolveOntologyFoundation();
  const semanticCandidateSet = createSemanticCandidateSet({ sourceConceptHypothesis: hypothesis });
  const retrieval = retrieveTaxonomyCandidates(hypothesis, taxonomy, RETRIEVAL_CONFIG);
  return { taxonomy, hypothesis, ontologyFoundation, semanticCandidateSet, retrieval, resolvedSource };
}

export async function analyzeSourceTaxonomy({ source, taxonomy: taxonomyInput, modelsFile, model, advisorTimeoutMs, advisorProvider, analysisAttemptId = `attempt-${Date.now()}-${Math.random().toString(16).slice(2)}`, intent = "analyze-source-business-classification", locale = "zh-CN", presentationTemplateVersion = "evopilot-harness-taxonomy-presentation/v1" }) {
  const prepared = prepareSourceTaxonomyAnalysis({ source, taxonomy: taxonomyInput });
  return analyzePreparedSourceTaxonomy({ prepared, modelsFile, model, advisorTimeoutMs, advisorProvider, analysisAttemptId, intent, locale, presentationTemplateVersion });
}

export async function analyzePreparedSourceTaxonomy({ prepared, modelsFile, model, advisorTimeoutMs, advisorProvider, analysisAttemptId, beforeInvocation, intent = "analyze-source-business-classification", locale = "zh-CN", presentationTemplateVersion = "evopilot-harness-taxonomy-presentation/v1" }) {
  const { taxonomy, hypothesis, ontologyFoundation, semanticCandidateSet, retrieval, resolvedSource } = prepared;
  const advisor = await requestTaxonomyAdvisor({ hypothesis, taxonomy, retrieval, modelsFile, model, timeoutMs: advisorTimeoutMs, provider: advisorProvider, analysisAttemptId, beforeInvocation });
  if (advisor.status === "ANALYSIS_BLOCKED_ADVISOR") return { status: advisor.status, hypothesis, taxonomy, retrieval, advisor, nextOperations: advisor.providerCompletion === "UNKNOWN" ? ["INSPECT", "CLOSE"] : ["RETRY_NEW_ANALYSIS", "CANCEL", "CLOSE"] };
  const decision = aggregateTaxonomyDecision({ hypothesis, taxonomy, retrieval, advisor, config: RETRIEVAL_CONFIG });
  const evolutionContext = classificationEvolutionContext({ hypothesis, taxonomy, ontologyFoundation, semanticCandidateSet, retrieval, advisor, decision, intent, locale, presentationTemplateVersion });
  const core = {
    schema: "evopilot-harness-taxonomy-analysis-result/v1",
    validation: { status: "VALID", schema: taxonomy.taxonomy.apiVersion, canonicalization: taxonomy.canonicalization, taxonomyDigest: taxonomy.taxonomyDigest },
    analysisAttemptDigest: advisor.analysisAttemptDigest,
    sourceDescriptor: resolvedSource?.sourceDescriptor ?? null,
    sourceDescriptorDigest: hypothesis.sourceDescriptorDigest,
    sourceResolutionDigest: hypothesis.sourceResolutionDigest,
    sourceResolution: typeof resolvedSource === "string" ? { path: resolvedSource, type: hypothesis.sourceSnapshot.sourceBinding.type, sourceDescriptorDigest: hypothesis.sourceDescriptorDigest, sourceResolutionDigest: hypothesis.sourceResolutionDigest } : resolvedSource ? stableSourceResolution(resolvedSource) : null,
    sourceSnapshotDigest: hypothesis.sourceSnapshotDigest,
    evidenceGraphDigest: hypothesis.evidenceGraphDigest,
    taxonomyDigest: taxonomy.taxonomyDigest,
    hypothesisDigest: hypothesis.hypothesisDigest,
    foundation: taxonomy.foundation,
    resolvedTaxonomySnapshot: taxonomy,
    sourceSnapshot: hypothesis.sourceSnapshot,
    evidenceGraph: hypothesis.evidenceGraph,
    sourceConceptHypothesis: hypothesis,
    ontologyFoundation,
    semanticCandidateSet,
    retrieval,
    advisor,
    axes: decision.axes,
    aggregate: decision.aggregate,
    evolutionContext,
    presentation: createTaxonomyPresentation(decision, taxonomy, hypothesis, locale),
    authority: { engineDecides: true, advisorMayDecide: false, classificationProvesEligibility: false, mayCreateProposal: false, mayApprove: false, mayPublish: false, mayMutateTaxonomy: false },
    nextOperations: decision.aggregate === "TAXONOMY_MATCHED" ? ["CONTINUE_TO_HARNESS", "CLOSE"] : decision.aggregate === "TAXONOMY_EXTENSION_SUGGESTED" ? ["SUPPLY_REVISED_TAXONOMY", "REANALYZE", "CLOSE"] : decision.aggregate === "TAXONOMY_EVIDENCE_INSUFFICIENT" ? ["SUPPLY_MORE_SOURCE_EVIDENCE", "REANALYZE", "CLOSE"] : ["CLARIFY_CLASSIFICATION", "REANALYZE", "CLOSE"]
  };
  core.analysisResultDigest = digest(core);
  return core;
}

export function createClassificationHandoff({ classificationSessionId, result, decidedBy, decisionToken }) {
  if (result?.schema !== "evopilot-harness-taxonomy-analysis-result/v1" || result.aggregate !== "TAXONOMY_MATCHED") throw handoffError("CLASSIFICATION_MATCH_REQUIRED", "Only a complete Ontology TAXONOMY_MATCHED result can produce handoff evidence.");
  assertCurrentSourcePolicy(result);
  const { analysisResultDigest, ...resultCore } = result;
  if (analysisResultDigest !== digest(resultCore)) throw handoffError("CLASSIFICATION_REPLAY_INTEGRITY_FAILED", "Ontology classification result failed its exact digest check.");
  const source = result.sourceResolution;
  if (source) {
    const current = buildSourceConceptHypothesis(source);
    if (current.sourceSnapshotDigest !== result.sourceSnapshotDigest || current.hypothesisDigest !== result.hypothesisDigest) throw handoffError("CLASSIFICATION_SOURCE_DRIFT", "Source evidence changed; repeat analysis before handoff.");
  }
  const expected = `CONTINUE_TO_HARNESS:${classificationSessionId}:${result.analysisResultDigest}`;
  if (decisionToken !== expected) throw handoffError("EXPLICIT_HANDOFF_DECISION_REQUIRED", `The exact classification handoff requires ${expected}.`);
  const core = {
    schema: "evopilot-harness-classification-handoff/v1",
    classificationSessionId,
    sourceDescriptor: result.sourceDescriptor,
    sourceDescriptorDigest: result.sourceDescriptorDigest,
    sourceResolutionDigest: result.sourceResolutionDigest,
    sourceResolution: result.sourceResolution,
    sourceSnapshotDigest: result.sourceSnapshotDigest,
    taxonomyDigest: result.taxonomyDigest,
    hypothesisDigest: result.hypothesisDigest,
    ontologyFoundationDigest: result.ontologyFoundation.foundationDigest,
    semanticCandidateSetDigest: result.semanticCandidateSet.candidateSetDigest,
    perAxisResultDigests: result.evolutionContext.perAxisResultDigests,
    analysisResultDigest: result.analysisResultDigest,
    classificationContextDigest: result.evolutionContext.classificationContextDigest,
    decision: "CONTINUE_TO_HARNESS",
    decidedBy,
    authority: { explicitHumanDecision: true, provesEligibility: false, createsProposal: false, approves: false, publishes: false }
  };
  core.handoffDigest = digest(core);
  return freezeEvidence(structuredClone(core));
}

function classificationEvolutionContext({ hypothesis, taxonomy, ontologyFoundation, semanticCandidateSet, retrieval, advisor, decision, intent, locale, presentationTemplateVersion }) {
  const core = {
    schema: "evopilot-harness-classification-evolution-context/v1",
    foundationSchema: taxonomy.foundation.schema,
    ontologyFoundationDigest: ontologyFoundation.foundationDigest,
    semanticCandidateSetDigest: semanticCandidateSet.candidateSetDigest,
    taxonomyDigest: taxonomy.taxonomyDigest,
    sourceDescriptorDigest: hypothesis.sourceDescriptorDigest,
    sourceResolutionDigest: hypothesis.sourceResolutionDigest,
    sourceSnapshotDigest: hypothesis.sourceSnapshotDigest,
    evidenceGraphDigest: hypothesis.evidenceGraphDigest,
    hypothesisDigest: hypothesis.hypothesisDigest,
    retrievalConfigDigest: retrieval.configDigest,
    retrievalDigest: retrieval.retrievalDigest,
    advisorReceiptDigest: advisor.advisorReceiptDigest,
    analysisAttemptDigest: advisor.analysisAttemptDigest,
    decisionPolicyDigest: decision.policyDigest,
    perAxisResultDigests: Object.fromEntries(Object.entries(decision.axes).map(([axis, result]) => [axis, digest(result)])),
    intentDigest: digest(intent),
    locale,
    presentationTemplateVersion,
    authority: { immutable: true, hostMayMutate: false, advisorMayMutate: false, sourceMayMutate: false }
  };
  core.classificationContextDigest = digest(core);
  return core;
}

function stableSourceResolution(value) {
  const allowed = ["schema", "sourceId", "type", "sourceDescriptorDigest", "sourceResolutionDigest", "canonicalRepository", "requestedRef", "resolvedCommit", "acquisitionPolicy", "cacheKey", "provenance", "licenseDiscovery", "sourceExecution", "path", "files"];
  return Object.fromEntries(allowed.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
}

function createTaxonomyPresentation(decision, taxonomy, hypothesis, locale) {
  const labels = Object.fromEntries(["domain", "product"].map((axis) => [axis, new Map(taxonomy.axes[axis].nodes.map((node) => [node.id, node.label]))]));
  const evidenceById = new Map([...hypothesis.citations, ...hypothesis.dependencySignals, ...hypothesis.structuredSignals].map((item) => [item.evidenceId, item]));
  const axisView = (axis) => {
    const result = decision.axes[axis];
    return {
      term: axis === "domain" ? "业务领域" : "产品或系统类型",
      status: result.status,
      conclusion: result.selectedNodes?.length ? result.selectedNodes.map((item) => labels[axis].get(item.nodeId)).join("；") : result.selected ? labels[axis].get(result.selected.nodeId) : result.extension?.proposedLabel ?? null,
      reason: ordinaryReason(result.status),
      evidence: result.selected ? presentationEvidence(result.selected.nonLlmEvidence).map((item) => ({ kind: ordinaryEvidenceFamily(item.family), clue: item.term })) : (result.extension?.sourceEvidenceIds ?? []).slice(0, MAX_PRESENTATION_EVIDENCE).map((id) => evidenceById.get(id)).filter(Boolean).map((item) => ({ kind: ordinaryEvidenceFamily(item.family), clue: item.dependency ?? item.sourceRef ?? item.path })),
      suggestion: result.extension ? { proposedLabel: result.extension.proposedLabel, proposedDefinition: result.extension.proposedDefinition, proposedParent: labels[axis].get(result.extension.proposedParentId) ?? result.extension.proposedParentId } : null,
      alternatives: result.candidates?.map((item) => ({ label: labels[axis].get(item.nodeId) })).filter((item) => item.label) ?? [],
      userAction: ordinaryUserAction(result.status, axis)
    };
  };
  return { schema: "evopilot-harness-taxonomy-presentation/v1", locale, title: "项目分类分析", classificationSchemeTerm: "业务分类方案", coverageTerm: "分类覆盖情况", aggregate: decision.aggregate, domain: axisView("domain"), product: axisView("product"), auditTermsHiddenFromPrimaryView: ["Taxonomy", "Domain", "Product", "score", "threshold", "digest"], hostAuthored: false };
}

function presentationEvidence(evidence) {
  const eligible = evidence.filter((item) => ["lexical-content", "dependency", "structured"].includes(item.family) && isPresentationClue(item.term));
  const selected = [];
  const seen = new Set();
  const clueSeen = new Set();
  for (const family of ["lexical-content", "dependency", "structured"]) {
    const item = eligible.filter((candidate) => candidate.family === family).sort((left, right) => presentationClueRank(left.term) - presentationClueRank(right.term) || canonicalCompare(left.term, right.term))[0];
    if (item) { selected.push(item); seen.add(`${item.family}:${item.evidenceId}`); clueSeen.add(String(item.term).toLowerCase()); }
  }
  for (const item of eligible) {
    if (selected.length >= MAX_PRESENTATION_EVIDENCE) break;
    const key = `${item.family}:${item.evidenceId}`;
    const clue = String(item.term).toLowerCase();
    if (!seen.has(key) && !clueSeen.has(clue)) { selected.push(item); seen.add(key); clueSeen.add(clue); }
  }
  return selected.slice(0, MAX_PRESENTATION_EVIDENCE);
}

function isPresentationClue(clue) {
  const value = String(clue ?? "").trim();
  if (value.length < 3 || /(?:^|\/)(?:\.svn|\.settings|vendor|vendors|third[-_]?party|opensource|fixture|fixtures|test|tests|example|examples|sample|samples|generated|gen)(?:\/|$)/i.test(value)) return false;
  return !/^(?:and|or|the|this|that|with|from|service|services|system|systems|product|products|data|information|com|org|src|main|java|xml|json|public|class|import|return|string|project|version|name|util|utils)$/i.test(value);
}

function presentationClueRank(clue) {
  const value = String(clue ?? "");
  return value.includes("/") ? value.split("/").length * 10 + value.length : value.length;
}

function ordinaryReason(status) {
  return ({
    TAXONOMY_MATCHED: "现有业务分类方案中有具体分类得到多类 Source 依据的共同支持，且没有相互冲突的候选。",
    TAXONOMY_EXTENSION_SUGGESTED: "Source 中存在得到多类依据支持的明确概念，但现有业务分类方案没有适合的具体分类。",
    TAXONOMY_EVIDENCE_INSUFFICIENT: "当前 Source 缺少足够且相互独立的依据，暂时不能可靠判断，也不应现在新增分类。",
    TAXONOMY_AMBIGUOUS: "多个具体分类都得到实质支持，现有依据还不能可靠地区分它们。"
  })[status] ?? "当前材料无法形成可靠分类结论。";
}

function ordinaryUserAction(status, axis) {
  const target = axis === "domain" ? "业务领域" : "产品或系统类型";
  return ({
    TAXONOMY_MATCHED: "核对结论与依据；两个方向都匹配后，可以选择是否继续 Harness 适用性判断。",
    TAXONOMY_EXTENSION_SUGGESTED: `按建议补充缺少的${target}及其名称、定义和上级分类，然后明确要求重新分析。`,
    TAXONOMY_EVIDENCE_INSUFFICIENT: `补充能够说明${target}的静态 Source 材料，然后明确要求重新分析。`,
    TAXONOMY_AMBIGUOUS: `说明候选${target}之间的边界，或补充能够区分它们的静态 Source 依据。`
  })[status];
}

function ordinaryEvidenceFamily(family) {
  return ({ dependency: "依赖信息", "lexical-content": "内容依据", structured: "文件结构" })[family] ?? "Source 依据";
}

function handoffError(code, message) { const error = new Error(message); error.name = "ClassificationHandoffError"; error.code = code; error.nextAction = "review-current-classification-result"; return error; }

function freezeEvidence(value) { if (value && typeof value === "object") { for (const child of Object.values(value)) freezeEvidence(child); Object.freeze(value); } return value; }
