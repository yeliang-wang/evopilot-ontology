import { digest } from "../../v3/utils.mjs";
import { canonicalCompare, normalizeTerm } from "./taxonomy.mjs";

export const RETRIEVAL_CONFIG = Object.freeze({
  schema: "evopilot-harness-taxonomy-retrieval-config/v1",
  algorithm: "open-world-taxonomy-classifier/v1",
  sourceProjection: { algorithm: "bounded-static-source-projection/v1", chunking: "file-and-800-character-citation/v1" },
  tokenizer: { algorithm: "unicode-nfkc-identifier-cjk-tokenizer/v1", locale: "und", stopwords: "structural-only/v1", stemming: "simple-plural/v1" },
  lexical: { algorithm: "boundary-aware-bm25/v1", fields: ["id", "label", "aliases", "definition", "evidenceHints"], weights: [2, 3, 2, 1, 2], k1: 1.2, b: 0.75 },
  embedding: { provider: "engine-local", model: "deterministic-hash-embedding", revision: "sha256:57cd8eea38a879e88e71a40f0b0ad7e9bb9f73f2b332d16e181d42f946319d29", algorithm: "deterministic-hash-embedding/v1", dimensions: 128, pooling: "sum", normalization: "cosine-l2", numericPrecision: 6 },
  structured: { algorithm: "dependency-and-source-structure/v2" },
  positiveEvidence: { algorithm: "coherent-positive-evidence/v1", multiTermHintRequiresSingleCitation: true, neutralLexicalRequiresCoherentSupport: true },
  candidateLimitPerAxis: 12,
  tieBreak: "score-desc-node-id-asc",
  scorePrecision: 3,
  decisionPolicy: {
    version: "taxonomy-decision-aggregate/v1",
    matchedThreshold: 0.55,
    corroboratedLexicalMatchedThreshold: 0.09,
    corroboratedLexicalMinimumBm25: 0.45,
    advisorSupportedMatchedThreshold: 0.25,
    advisorSupportedMinimumBm25: 0.45,
    advisorSupportedMinimumConfidence: 0.7,
    ambiguityThreshold: 0.45,
    margin: 0.12,
    advisorSignalWeight: 0.2,
    advisorConfidenceMargin: 0.1,
    minimumNonLlmFamilies: 2,
    exclusionProof: {
      algorithm: "semantic-exclusion-proof/v2",
      minimumOriginGroups: 2,
      primaryFamilies: ["content-purpose", "content-workflow"],
      corroboratingFamilies: ["content-inventory"]
    },
    extensionEligibility: {
      algorithm: "taxonomy-novel-extension/v2",
      minimumOriginGroups: 2,
      requireNormalTrustSemanticEvidence: true,
      rejectGenericArtifactTerms: true,
      rejectDeclaredTaxonomyCoverage: true
    },
    mixedPurposeEvidence: {
      algorithm: "primary-purpose-evidence/v4",
      primarySemanticFamily: "content-purpose",
      minimumAssertions: 2,
      requireDistinctAssertionOrigins: true,
      explicitCoequalStatementAllowed: true
    }
  },
  advisorAvailabilityPolicy: "REQUIRED_ON_NEW_ANALYSIS"
});

export const TAXONOMY_RESULTS = Object.freeze([
  "TAXONOMY_MATCHED",
  "TAXONOMY_EXTENSION_SUGGESTED",
  "TAXONOMY_EVIDENCE_INSUFFICIENT",
  "TAXONOMY_AMBIGUOUS"
]);

const GOVERNED_EVIDENCE_FAMILIES = new Set([
  "lexical-content", "dependency", "structured",
  "content-purpose", "content-inventory", "content-workflow"
]);

export function retrieveTaxonomyCandidates(hypothesis, taxonomy, config = RETRIEVAL_CONFIG) {
  const conceptByTerm = new Map(hypothesis.concepts.map((concept) => [normalizeTerm(concept.term), concept]));
  const sourceTerms = new Set(conceptByTerm.keys());
  const axes = {};
  for (const axisName of ["domain", "product"]) {
    const assignable = taxonomy.axes[axisName].nodes.filter((node) => node.assignable);
    const bm25 = buildBm25Corpus(assignable, config);
    const candidates = assignable.map((node) => scoreNode(axisName, node, sourceTerms, conceptByTerm, hypothesis, config, bm25)).filter((item) => item.signals.some((signal) => signal.score > 0)).sort((left, right) => right.score - left.score || canonicalCompare(left.nodeId, right.nodeId)).slice(0, config.candidateLimitPerAxis);
    axes[axisName] = candidates;
  }
  const effectiveConfig = { ...config, sourceProjection: { ...config.sourceProjection, hypothesisDigest: hypothesis.hypothesisDigest, sourceSnapshotDigest: hypothesis.sourceSnapshotDigest }, candidateCorpusDigest: digest(taxonomy.axes), indexDigest: digest({ taxonomyDigest: taxonomy.taxonomyDigest, algorithm: config.algorithm, tokenizer: config.tokenizer, embedding: config.embedding }) };
  const core = { schema: "evopilot-harness-taxonomy-candidate-retrieval/v1", config: effectiveConfig, configDigest: digest(effectiveConfig), hypothesisDigest: hypothesis.hypothesisDigest, taxonomyDigest: taxonomy.taxonomyDigest, axes };
  core.retrievalDigest = digest(core);
  return core;
}

export function aggregateTaxonomyDecision({ hypothesis, taxonomy, retrieval, advisor, config = RETRIEVAL_CONFIG }) {
  const axes = {};
  for (const axisName of ["domain", "product"]) axes[axisName] = decideAxis(axisName, hypothesis, taxonomy, retrieval.axes[axisName], advisor, config, taxonomy.axes[axisName].cardinality);
  const precedence = ["TAXONOMY_AMBIGUOUS", "TAXONOMY_EVIDENCE_INSUFFICIENT", "TAXONOMY_EXTENSION_SUGGESTED", "TAXONOMY_MATCHED"];
  const aggregate = precedence.find((status) => Object.values(axes).some((axis) => axis.status === status));
  return { schema: "evopilot-harness-taxonomy-decision/v1", policy: config.decisionPolicy, policyDigest: digest(config.decisionPolicy), axes, aggregate, foldPrecedence: precedence, authority: { engineOwned: true, advisorMaySelect: false, individualSignalMaySelect: false } };
}

function scoreNode(axisName, node, sourceTerms, conceptByTerm, hypothesis, config, bm25Context) {
  const exactTerms = [node.id, node.label, ...(node.aliases ?? [])].map(normalizeTerm).filter(Boolean);
  const documentTerms = tokenize([node.id, node.label, node.definition, ...(node.aliases ?? []), ...(node.positiveEvidenceHints ?? [])].join(" "));
  const exactMatches = exactTerms.filter((term) => sourceTerms.has(term));
  const overlap = documentTerms.filter((term) => sourceTerms.has(term));
  const lexical = bm25Score(node, sourceTerms, bm25Context, config);
  const embedding = cosine(hashVector(documentTerms, config.embedding.dimensions), hashVector([...sourceTerms], config.embedding.dimensions));
  const structuredAssessments = [...(node.positiveEvidenceHints ?? [])].map((hint) => assessHintEvidence(hint, hypothesis, {
    minimumFamilies: 1,
    minimumCoverage: 0.6,
    minimumOriginGroups: rawHintTokens(hint).length > 1 ? 2 : 1,
    requireCoherentCitation: true
  }));
  const structuredMatches = structuredAssessments.filter((item) => item.supported).map((item) => item.hint);
  const structuredEvidenceTerms = [...new Set(structuredAssessments.filter((item) => item.supported).flatMap((item) => item.matches))];
  const exclusionAssessments = [...(node.exclusionHints ?? [])].map((hint) => assessExclusionEvidence(hint, hypothesis, config.decisionPolicy.exclusionProof));
  const exclusionMatches = exclusionAssessments.filter((item) => item.supported).map((item) => item.hint);
  const exclusionEvidenceIds = [...new Set(exclusionAssessments.filter((item) => item.supported).flatMap((item) => item.evidenceIds))].sort(canonicalCompare);
  const exclusionProofs = exclusionAssessments.filter((item) => item.supported).map((item) => item.proof);
  const exact = exactMatches.length ? 1 : 0;
  const structured = structuredMatches.length ? 1 : 0;
  const penalty = exclusionMatches.length ? Math.min(0.8, exclusionMatches.length * 0.3) : 0;
  const score = clamp(exact * 0.15 + lexical * 0.2 + embedding * 0.1 + structured * 0.45 - penalty);
  const matchedTerms = [...new Set([...exactMatches, ...overlap, ...structuredEvidenceTerms])];
  const evidenceFamily = new Map([...hypothesis.citations, ...hypothesis.dependencySignals, ...hypothesis.structuredSignals].map((item) => [item.evidenceId, item.family]));
  const evidence = structuredAssessments.filter((item) => item.supported).flatMap((item) => item.evidence.map((entry) => ({ ...entry, term: item.matches.join(" ") || item.hint })));
  evidence.push(...matchedTerms.flatMap((term) => {
    const concept = conceptByTerm.get(term);
    return concept ? concept.evidenceIds.map((evidenceId) => ({ evidenceId, family: evidenceFamily.get(evidenceId) ?? "unknown", term })) : [];
  }));
  for (const citation of hypothesis.citations) if (matchedTerms.some((term) => normalizeTerm(citation.excerpt).split(" ").includes(term))) evidence.push({ evidenceId: citation.evidenceId, family: citation.family, term: matchedTerms.find((term) => normalizeTerm(citation.excerpt).split(" ").includes(term)) });
  for (const signal of hypothesis.dependencySignals) if (structuredEvidenceTerms.some((term) => tokenize(signal.dependency).includes(term))) evidence.push({ evidenceId: signal.evidenceId, family: signal.family, term: signal.dependency });
  for (const signal of hypothesis.structuredSignals) if (matchedTerms.some((term) => tokenize(signal.excerpt ?? signal.path).includes(term))) evidence.push({ evidenceId: signal.evidenceId, family: signal.family, term: signal.excerpt ?? signal.path });
  const semanticCitation = evidence.map((item) => hypothesis.citations.find((citation) => citation.evidenceId === item.evidenceId)).find((citation) => ["content-purpose", "content-inventory"].includes(citation?.family));
  const semanticCounterpartFamily = semanticCitation?.family === "content-purpose" ? "content-inventory" : semanticCitation?.family === "content-inventory" ? "content-purpose" : null;
  const semanticCorroboration = semanticCounterpartFamily ? hypothesis.citations.find((item) => item.family === semanticCounterpartFamily && item.sourceRef === semanticCitation.sourceRef && item.trust !== "LOW") : null;
  if (semanticCorroboration) evidence.push({ evidenceId: semanticCorroboration.evidenceId, family: semanticCorroboration.family, term: "bounded Source overview context" });
  const sourceEvidence = new Map([...hypothesis.citations, ...hypothesis.dependencySignals, ...hypothesis.structuredSignals].map((item) => [item.evidenceId, item]));
  const nonLlmEvidence = uniqueEvidence(evidence.map((item) => {
    const origin = sourceEvidence.get(item.evidenceId);
    return { ...item, ...(origin ? { sourceRef: origin.sourceRef ?? origin.path, trust: origin.trust, ...(origin.excerpt ? { excerpt: origin.excerpt } : {}), ...(origin.kind === "declared-responsibility" ? { kind: origin.kind, jsonPointer: origin.jsonPointer, sourceDigest: origin.sourceDigest } : {}) } : {}) };
  }));
  const evidenceIds = nonLlmEvidence.map((item) => item.evidenceId);
  return {
    axis: axisName,
    nodeId: node.id,
    label: node.label,
    ancestors: node.ancestors,
    score: round(score),
    signals: [
      { type: "exact", score: round(exact), matches: exactMatches, citations: evidenceIds, contradictions: [] },
      { type: "bm25", score: round(lexical), matches: overlap, citations: evidenceIds, contradictions: [] },
      { type: "embedding", score: round(embedding), algorithm: config.embedding.algorithm, citations: evidenceIds, contradictions: [] },
      { type: "structured", score: round(structured), matches: structuredMatches, citations: evidenceIds, contradictions: [] },
      { type: "exclusion", score: round(penalty), matches: exclusionMatches, citations: exclusionEvidenceIds, contradictions: exclusionMatches }
    ],
    nonLlmEvidence,
    contradictions: exclusionMatches,
    exclusionProofs,
    rejectedAlternatives: [],
    rejectedByExclusion: penalty > 0
  };
}

function decideAxis(axisName, hypothesis, taxonomy, candidates, advisor, config, cardinality) {
  const policy = config.decisionPolicy;
  const withAdvisor = candidates.map((candidate) => {
    const advice = advisor.candidates.find((item) => item.axis === axisName && item.nodeId === candidate.nodeId);
    const advisorScore = advice?.support === "SUPPORT" ? Math.min(policy.advisorSignalWeight, Number(advice.confidence ?? 0) * policy.advisorSignalWeight) : advice?.support === "CONTRADICT" ? -policy.advisorSignalWeight : 0;
    return { ...candidate, advisorSignal: advice ?? null, finalScore: round(clamp(candidate.score + advisorScore)) };
  }).sort((left, right) => right.finalScore - left.finalScore || canonicalCompare(left.nodeId, right.nodeId));
  const sourceEvidence = [...hypothesis.citations, ...hypothesis.dependencySignals, ...hypothesis.structuredSignals];
  const evidenceById = new Map(sourceEvidence.map((item) => [item.evidenceId, item]));
  const enoughSourceUnderstanding = hypothesis.concepts.length >= 3 && governedFamilyCount(sourceEvidence) >= policy.minimumNonLlmFamilies;
  const coherentConcept = hypothesis.concepts.find((item) => {
    const conceptEvidence = item.evidenceIds.map((id) => evidenceById.get(id)).filter(Boolean);
    return isExtensionConcept(item, { hypothesis, taxonomy, axisName, evidence: conceptEvidence, policy: policy.extensionEligibility })
      && item.evidenceFamilies.some((family) => family.startsWith("content-"))
      && governedFamilyCount(conceptEvidence) >= policy.minimumNonLlmFamilies
      && governedOriginGroupCount(conceptEvidence) >= policy.extensionEligibility.minimumOriginGroups;
  });
  const evidenceEligible = withAdvisor
    .filter((candidate) => candidate.advisorSignal?.support !== "CONTRADICT")
    .filter((candidate) => materiallySupportedForAmbiguity(candidate, policy))
    .sort((left, right) => right.finalScore - left.finalScore || canonicalCompare(left.nodeId, right.nodeId));
  const ambiguityTop = evidenceEligible[0];
  const ambiguitySecond = evidenceEligible[1];
  const declaredPurposeEvidence = explicitCoequalCandidatePurposeEvidence(hypothesis, taxonomy.axes[axisName], candidates, policy.mixedPurposeEvidence);
  const mixedPurposeEvidence = declaredPurposeEvidence.status === "PROVEN"
    ? declaredPurposeEvidence
    : explicitLearningResourcePurposeEvidence(hypothesis, policy.mixedPurposeEvidence);
  const primaryPurposeKinds = new Set((mixedPurposeEvidence.assertions ?? [])
    .map((item) => item.purpose)
    .filter((purpose) => purpose !== "COEQUAL_DECLARATION"));
  const deterministicScoreTie = Boolean(ambiguityTop && ambiguitySecond
    && ambiguityTop.finalScore - ambiguitySecond.finalScore < policy.margin
    && primaryPurposeKinds.size !== 1);
  const mixedPurposeCandidates = candidates.filter((candidate) => candidate.score > 0
    && governedFamilyCount(candidate.nonLlmEvidence) >= policy.minimumNonLlmFamilies
    && !candidate.rejectedByExclusion);
  const deterministicMixedPurposeTie = Boolean(mixedPurposeEvidence.status === "PROVEN"
    && (declaredPurposeEvidence.status === "PROVEN" || mixedPurposeCandidates.length >= 1));
  const ambiguous = cardinality === "SINGLE" && (deterministicMixedPurposeTie || deterministicScoreTie);
  if (ambiguous) return axisResult("TAXONOMY_AMBIGUOUS", axisName, {
    candidates: withAdvisor.slice(0, 3),
    ambiguityBasis: deterministicMixedPurposeTie
      ? mixedPurposeEvidence.basis === "EXPLICIT_COOEQUAL_STATEMENT" ? "EXPLICIT_COOEQUAL_PRIMARY_PURPOSES" : "DISTINCT_PRIMARY_PURPOSES"
      : "UNRESOLVED_DETERMINISTIC_SCORE_MARGIN",
    ...(deterministicMixedPurposeTie ? { mixedPurposeEvidence } : {}),
    reason: "Multiple candidates or primary Source purposes have material non-LLM support without the required deterministic safe margin.",
    userAction: `Clarify the ${axisName} boundary or add discriminating Source evidence.`
  });
  if (!enoughSourceUnderstanding) return axisResult("TAXONOMY_EVIDENCE_INSUFFICIENT", axisName, { candidates: withAdvisor.slice(0, 3), reason: "The static Source does not provide two independent evidence families and enough supported concepts.", missingEvidence: hypothesis.missingEvidence, userAction: `Provide more static ${axisName} evidence; do not add a category yet.` });
  const positive = removeBroadAncestors(withAdvisor.filter((candidate) => {
    const bm25 = candidate.signals.find((signal) => signal.type === "bm25")?.score ?? 0;
    const advisorSupported = candidate.advisorSignal?.support === "SUPPORT"
      && Number(candidate.advisorSignal.confidence ?? 0) >= policy.advisorSupportedMinimumConfidence
      && bm25 >= policy.advisorSupportedMinimumBm25
      && candidate.finalScore >= policy.advisorSupportedMatchedThreshold;
    const corroboratedLexical = candidate.score >= policy.corroboratedLexicalMatchedThreshold
      && bm25 >= policy.corroboratedLexicalMinimumBm25
      && (candidate.signals.some((signal) => ["exact", "structured"].includes(signal.type) && signal.score > 0)
        || hasCoherentLexicalEvidence(candidate));
    return (candidate.finalScore >= policy.matchedThreshold || advisorSupported || corroboratedLexical)
      && governedFamilyCount(candidate.nonLlmEvidence) >= policy.minimumNonLlmFamilies
      && !candidate.rejectedByExclusion
      && candidate.advisorSignal?.support !== "CONTRADICT";
  }));
  if (positive.length > 0) {
    const selectedNodes = cardinality === "MULTIPLE" ? positive : positive.slice(0, 1);
    return axisResult("TAXONOMY_MATCHED", axisName, { selected: selectedNodes[0], selectedNodes, cardinality, candidates: withAdvisor.slice(0, 3), reason: "The selected classification passed threshold, hierarchy specificity, exclusion, and independent Source corroboration policy.", userAction: "Review the classification explanation." });
  }
  const advisorGap = advisorExtensionGap(axisName, advisor, taxonomy, hypothesis, policy);
  const advisorDisposition = advisorContradictionDisposition(withAdvisor);
  const extensionBasis = advisorGap ? "ADVISOR_UNRESOLVED_CONCEPT_WITH_INDEPENDENT_NON_LLM_EVIDENCE" : coherentConcept ? "TAXONOMY_BLIND_CONCEPT_WITH_INDEPENDENT_NON_LLM_EVIDENCE" : null;
  if (!extensionBasis) return axisResult("TAXONOMY_EVIDENCE_INSUFFICIENT", axisName, { candidates: withAdvisor.slice(0, 3), advisorDisposition, reason: "No coherent unmatched concept has two semantically independent non-LLM Source citations; Advisor contradiction cannot create a taxonomy gap.", missingEvidence: ["Provide corroborating static evidence for the unresolved concept."], userAction: `Provide more static ${axisName} evidence; do not add a category yet.` });
  const proposed = extensionSuggestion(axisName, hypothesis, taxonomy, withAdvisor, coherentConcept, advisorGap);
  return axisResult("TAXONOMY_EXTENSION_SUGGESTED", axisName, { candidates: withAdvisor.slice(0, 3), extension: proposed, extensionBasis, advisorDisposition, reason: "The Source concept has semantically independent non-LLM corroboration but no assignable declared category satisfies the governed match policy.", userAction: `Add the suggested ${axisName} category to your business classification scheme and explicitly re-analyze.` });
}

function advisorContradictionDisposition(candidates) {
  const contradictedCandidateIds = candidates.filter((candidate) => candidate.advisorSignal?.support === "CONTRADICT").map((candidate) => candidate.nodeId);
  return {
    contradictedCandidateIds,
    contradictionMayRejectCandidate: true,
    contradictionMayCreateExtension: false,
    contradictionMaySatisfyNonLlmEvidenceMinimum: false
  };
}

function hasCoherentLexicalEvidence(candidate) {
  return candidate.nonLlmEvidence.some((item) => item.trust !== "LOW"
    && (item.family.startsWith("content-") || item.kind === "declared-responsibility")
    && [candidate.nodeId, candidate.label].some((name) => assessHint(name,
      new Set(tokenize(item.excerpt ?? item.term ?? "")), { minimumCoverage: 0.6 }).supported));
}

function extensionSuggestion(axisName, hypothesis, taxonomy, candidates, concept, advisorGap) {
  const parent = advisorGap?.parent ?? candidates.find((item) => item.finalScore > 0.2) ?? taxonomy.axes[axisName].nodes.find((node) => !node.assignable);
  return { proposedLabel: advisorGap?.proposedLabel ?? concept?.term ?? `new-${axisName}-category`, proposedDefinition: advisorGap?.definition ?? `A user-owned ${axisName} category supported by the cited Source concept evidence.`, proposedParentId: parent?.nodeId ?? parent?.id ?? null, sourceEvidenceIds: (advisorGap?.evidenceIds ?? concept?.evidenceIds ?? []).slice(0, 12), rejectedAlternatives: candidates.slice(0, 3).map((item) => ({ nodeId: item.nodeId, reason: `Final score ${item.finalScore} did not satisfy positive match policy.` })), automaticMutationAllowed: false };
}

function advisorExtensionGap(axisName, advisor, taxonomy, hypothesis, policy) {
  const nodes = new Map(taxonomy.axes[axisName].nodes.map((node) => [node.id, node]));
  const evidenceById = new Map([...hypothesis.citations, ...hypothesis.dependencySignals, ...hypothesis.structuredSignals].map((item) => [item.evidenceId, item]));
  for (const gap of advisor.unresolvedConcepts ?? []) {
    const parent = nodes.get(gap.parentId);
    if (!parent) continue;
    const evidence = (gap.evidenceIds ?? []).map((id) => evidenceById.get(id)).filter(Boolean);
    if (governedFamilyCount(evidence) < policy.minimumNonLlmFamilies) continue;
    return { ...gap, parent };
  }
  return null;
}

function removeBroadAncestors(candidates) {
  return candidates.filter((candidate) => !candidates.some((other) => other.nodeId !== candidate.nodeId && other.ancestors.includes(candidate.nodeId)));
}

function materiallySupportedForAmbiguity(candidate, policy) {
  const bm25 = candidate.signals.find((signal) => signal.type === "bm25")?.score ?? 0;
  return !candidate.rejectedByExclusion
    && governedFamilyCount(candidate.nonLlmEvidence) >= policy.minimumNonLlmFamilies
    && (candidate.score >= policy.ambiguityThreshold
      || (candidate.score >= policy.corroboratedLexicalMatchedThreshold
        && bm25 >= policy.corroboratedLexicalMinimumBm25));
}

function buildBm25Corpus(nodes, config) {
  const fields = config.lexical.fields;
  const documents = new Map();
  const documentFrequency = new Map();
  const totalLengths = Object.fromEntries(fields.map((field) => [field, 0]));
  for (const node of nodes) {
    const fieldTerms = taxonomyFields(node);
    documents.set(node.id, fieldTerms);
    const seen = new Set();
    for (const field of fields) {
      totalLengths[field] += fieldTerms[field].length;
      for (const term of new Set(fieldTerms[field])) seen.add(term);
    }
    for (const term of seen) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  return { documents, documentFrequency, size: Math.max(1, nodes.length), averageLengths: Object.fromEntries(fields.map((field) => [field, totalLengths[field] / Math.max(1, nodes.length)])) };
}

function taxonomyFields(node) {
  return {
    id: tokenize(node.id), label: tokenize(node.label), aliases: tokenize((node.aliases ?? []).join(" ")),
    definition: tokenize(node.definition ?? ""), evidenceHints: tokenize((node.positiveEvidenceHints ?? []).join(" "))
  };
}

function bm25Score(node, queryTerms, context, config) {
  let raw = 0;
  const fields = context.documents.get(node.id);
  for (let index = 0; index < config.lexical.fields.length; index += 1) {
    const field = config.lexical.fields[index];
    const terms = fields[field];
    const counts = new Map();
    for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
    const averageLength = Math.max(1, context.averageLengths[field]);
    for (const query of queryTerms) {
      const frequency = counts.get(query) ?? 0;
      if (!frequency) continue;
      const df = context.documentFrequency.get(query) ?? 0;
      const idf = Math.log(1 + (context.size - df + 0.5) / (df + 0.5));
      const denominator = frequency + config.lexical.k1 * (1 - config.lexical.b + config.lexical.b * terms.length / averageLength);
      raw += config.lexical.weights[index] * idf * frequency * (config.lexical.k1 + 1) / denominator;
    }
  }
  return clamp(1 - Math.exp(-raw / 8));
}

function axisResult(status, axis, extra) { return { status, axis, ...extra }; }
function tokenize(value) {
  const separated = String(value).replace(/([\p{Ll}\d])([\p{Lu}])/gu, "$1 $2");
  return normalizeTerm(separated).split(/\s+/).flatMap(semanticTermVariants).filter((term) => term.length >= 2);
}
function semanticTermVariants(term) {
  const result = [term];
  for (const match of term.matchAll(/\p{Script=Han}+/gu)) {
    const characters = [...match[0]];
    for (let size = 2; size <= Math.min(4, characters.length); size += 1) for (let index = 0; index <= characters.length - size; index += 1) result.push(characters.slice(index, index + size).join(""));
  }
  if (/^[a-z][a-z0-9]*[^s]s$/.test(term) && term.length > 3) result.push(term.slice(0, -1));
  return result;
}
const STRUCTURAL_STOPWORDS = new Set(["and", "or", "the", "a", "an", "of", "for", "to", "in", "on", "with", "by", "from", "this", "that", "system", "service", "services"]);
const EXTENSION_STOPWORDS = new Set([...STRUCTURAL_STOPWORDS, "product", "products", "data", "information", "format", "formats", "link", "links", "request", "requests", "script", "scripts", "template", "templates", "validate", "validation"]);
const GENERIC_EXTENSION_TERMS = new Set([
  "agent", "agents", "artifact", "artifacts", "code", "collection", "collections", "comman", "command", "commands", "content", "contents",
  "framework", "frameworks", "hook", "hooks", "instruction", "instructions", "library", "libraries", "list", "lists", "plugin", "plugins",
  "provide", "provides", "repository", "repositories", "resource", "resources", "reusable", "rule", "rules", "skill", "skills", "software", "tool", "tools", "workflow", "workflows"
]);
function assessHint(hint, sourceTerms, { minimumCoverage = 0.45 } = {}) {
  const tokens = rawHintTokens(hint);
  const normalizedSource = new Set([...sourceTerms].flatMap((term) => rawHintTokens(term)));
  const matches = tokens.filter((term) => normalizedSource.has(term));
  const required = tokens.length <= 1 ? tokens.length : Math.max(2, Math.ceil(tokens.length * minimumCoverage));
  return { hint: normalizeTerm(hint), tokens, matches, coverage: tokens.length ? matches.length / tokens.length : 0, supported: tokens.length > 0 && matches.length >= required };
}
function assessHintEvidence(hint, hypothesis, { minimumFamilies = 2, minimumCoverage = 0.45, minimumOriginGroups = 1, corroboratePurposeWithInventory = false, primarySemanticOnly = false, requireCoherentCitation = false } = {}) {
  let governedEvidence = [...hypothesis.citations, ...hypothesis.dependencySignals, ...hypothesis.structuredSignals].filter((item) => isGovernedFamily(item.family) && isHintBearingEvidence(item));
  if (primarySemanticOnly) {
    const semantic = governedEvidence.filter((item) => item.family.startsWith("content-") && item.trust !== "LOW");
    const minimumDepth = semantic.length ? Math.min(...semantic.map((item) => sourceDepth(item.sourceRef))) : null;
    const primaryRefs = new Set(semantic.filter((item) => sourceDepth(item.sourceRef) === minimumDepth).map((item) => item.sourceRef));
    governedEvidence = governedEvidence.filter((item) => !item.family.startsWith("content-") || primaryRefs.has(item.sourceRef));
    if (semanticTokens(hint).includes("persona-roster")) governedEvidence = governedEvidence.filter((item) => item.family.startsWith("content-"));
  }
  const assessed = governedEvidence.flatMap((item) => {
    const assessment = assessHint(hint, new Set(tokenize(item.excerpt ?? item.dependency ?? item.path ?? "")), { minimumCoverage });
    return assessment.matches.length ? [{ evidenceId: item.evidenceId, family: item.family, sourceRef: item.sourceRef ?? item.path ?? item.dependency ?? item.evidenceId, matches: assessment.matches, coverage: assessment.coverage, coherent: assessment.supported }] : [];
  });
  const aggregateMatches = [...new Set(assessed.flatMap((item) => item.matches))];
  const hintTokens = rawHintTokens(hint);
  const aggregateCoverage = hintTokens.length ? aggregateMatches.length / hintTokens.length : 0;
  const supported = aggregateCoverage >= minimumCoverage ? assessed : [];
  if (corroboratePurposeWithInventory && supported.some((item) => item.family === "content-purpose") && !supported.some((item) => item.family === "content-inventory")) {
    const inventory = governedEvidence.find((item) => item.family === "content-inventory" && item.trust !== "LOW");
    if (inventory) supported.push({ evidenceId: inventory.evidenceId, family: inventory.family, sourceRef: inventory.sourceRef, matches: ["categorized Source inventory"], coverage: 1 });
  }
  const families = [...new Set(supported.map((item) => item.family))];
  const originGroups = [...new Set(supported.map((item) => item.sourceRef))];
  return {
    hint: normalizeTerm(hint),
    supported: aggregateCoverage >= minimumCoverage
      && (!requireCoherentCitation || assessed.some((item) => item.coherent))
      && independentFamilyCount(families) >= minimumFamilies
      && originGroups.length >= minimumOriginGroups,
    evidenceIds: supported.map((item) => item.evidenceId),
    families,
    originGroups,
    matches: aggregateMatches,
    evidence: supported.map(({ evidenceId, family }) => ({ evidenceId, family })),
    coverage: aggregateCoverage
  };
}
function assessExclusionEvidence(hint, hypothesis, policy = RETRIEVAL_CONFIG.decisionPolicy.exclusionProof) {
  const semantic = hypothesis.citations.filter((item) => ["content-purpose", "content-inventory", "content-workflow"].includes(item.family) && item.trust !== "LOW");
  const minimumDepth = semantic.length ? Math.min(...semantic.map((item) => sourceDepth(item.sourceRef))) : null;
  const primarySemantic = minimumDepth === null ? [] : semantic.filter((item) => sourceDepth(item.sourceRef) === minimumDepth);
  const assessed = primarySemantic.flatMap((item) => {
    const assessment = assessHint(hint, new Set(tokenize(item.excerpt ?? "")), { minimumCoverage: 0.6 });
    return assessment.supported ? [{ evidenceId: item.evidenceId, family: item.family, sourceRef: item.sourceRef, matches: assessment.matches, coverage: assessment.coverage }] : [];
  });
  const purpose = assessed.filter((item) => policy.primaryFamilies.includes(item.family));
  if (purpose.length) {
    const hintTerms = new Set(semanticTokens(hint));
    for (const inventory of primarySemantic.filter((item) => policy.corroboratingFamilies.includes(item.family))) {
      if (assessed.some((item) => item.evidenceId === inventory.evidenceId)) continue;
      const matches = semanticTokens(inventory.excerpt ?? "").filter((term) => hintTerms.has(term));
      if (matches.length) assessed.push({ evidenceId: inventory.evidenceId, family: inventory.family, sourceRef: inventory.sourceRef, matches, coverage: matches.length / Math.max(1, hintTerms.size) });
    }
  }
  const unique = [...new Map(assessed.map((item) => [item.evidenceId, item])).values()];
  const originGroups = [...new Set(unique.map((item) => semanticOriginGroup(item)))].sort(canonicalCompare);
  const supported = purpose.length > 0 && originGroups.length >= policy.minimumOriginGroups;
  const normalizedHint = normalizeTerm(hint);
  return {
    hint: normalizedHint,
    supported,
    evidenceIds: unique.map((item) => item.evidenceId).sort(canonicalCompare),
    families: [...new Set(unique.map((item) => item.family))].sort(canonicalCompare),
    matches: [...new Set(unique.flatMap((item) => item.matches))].sort(canonicalCompare),
    proof: supported ? {
      schema: "evopilot-harness-semantic-exclusion-proof/v1",
      algorithm: policy.algorithm,
      hint: normalizedHint,
      evidenceIds: unique.map((item) => item.evidenceId).sort(canonicalCompare),
      originGroups,
      primaryPurposeEvidenceIds: purpose.map((item) => item.evidenceId).sort(canonicalCompare),
      structuredPathMayEstablishExclusion: false,
      lexicalProjectionMayEstablishExclusion: false,
      advisorMayEstablishExclusion: false
    } : null
  };
}
function semanticOriginGroup(item) {
  return digest({ sourceRef: item.sourceRef, semanticFamily: item.family, evidenceId: item.evidenceId });
}
function isExtensionConcept(concept, { taxonomy, axisName, evidence, policy }) {
  const term = normalizeTerm(concept.term);
  const hasNormalSemanticEvidence = evidence.some((item) => item.trust !== "LOW" && (item.family.startsWith("content-") || item.family === "dependency"));
  return hasNormalSemanticEvidence
    && !EXTENSION_STOPWORDS.has(term)
    && !isGenericExtensionTerm(term)
    && !taxonomyRepresentsConcept(taxonomy.axes[axisName].nodes, term)
    && !/^(?:com|org|src|main|java|xml|json|public|private|class|import|return|string|readme|http|https|www|project|projects|version|name|new|util|utils|test|tests|file|files|true|false|null|undefined)$/i.test(term)
    && (!policy.requireNormalTrustSemanticEvidence || hasNormalSemanticEvidence);
}
function isGenericExtensionTerm(term) {
  const normalizedMorphology = term.endsWith("ie") ? `${term.slice(0, -2)}y` : term;
  return GENERIC_EXTENSION_TERMS.has(term)
    || GENERIC_EXTENSION_TERMS.has(normalizedMorphology)
    || ["agent", "resource-directory", "software", "workflow"].includes(semanticToken(normalizedMorphology));
}
function taxonomyRepresentsConcept(nodes, term) {
  const variants = new Set(semanticTokens(term));
  return nodes.some((node) => {
    const declared = semanticTokens([node.id, node.label, ...(node.aliases ?? []), node.definition ?? "", ...(node.positiveEvidenceHints ?? [])].join(" "));
    return declared.some((item) => variants.has(item));
  });
}
function isGovernedFamily(family) { return GOVERNED_EVIDENCE_FAMILIES.has(family); }
function explicitCoequalCandidatePurposeEvidence(hypothesis, axis, candidates, policy = {}) {
  const algorithm = policy.algorithm ?? "primary-purpose-evidence/v4";
  const absent = { schema: "evopilot-harness-primary-purpose-evidence/v1", algorithm, status: "NOT_PROVEN", assertions: [] };
  if (!policy.explicitCoequalStatementAllowed) return absent;
  const purpose = hypothesis.citations.filter((item) => item.family === "content-purpose" && item.trust !== "LOW");
  if (!purpose.length) return absent;
  const minimumDepth = Math.min(...purpose.map((item) => sourceDepth(item.sourceRef)));
  const statements = purpose.filter((item) => sourceDepth(item.sourceRef) === minimumDepth).flatMap((citation) => purposeStatements(citation.excerpt).map((statement) => {
    const normalizedStatement = normalizeTerm(statement);
    return { citation, statement, normalizedStatement, terms: new Set(rawHintTokens(statement)), originGroup: digest({ algorithm, sourceRef: citation.sourceRef, sourceDigest: citation.sourceDigest, statement: normalizedStatement }) };
  }));
  const declaration = statements.find((item) => /\b(?:both|two|multiple)\s+(?:capability\s+families|capabilities|purposes|responsibilities)\b/i.test(item.statement)
    && /\b(?:first[-\s]class|coequal|equal\s+primary|equally\s+primary)\b/i.test(item.statement)
    && !/\b(?:not|never)\s+(?:first[-\s]class|coequal|equal|equally)\b/i.test(item.statement)
    && !/\b(?:previously|formerly|historical|hypothetical|example|could|would|might)\b/i.test(item.statement));
  if (!declaration) return absent;
  const nodes = new Map(axis.nodes.map((node) => [node.id, node]));
  const eligible = candidates.filter((candidate) => candidate.score > 0 && !candidate.rejectedByExclusion).map((candidate) => ({
    candidate,
    // Vocabulary comes only from the selected user's declared evidence hints.
    terms: new Set(rawHintTokens((nodes.get(candidate.nodeId)?.positiveEvidenceHints ?? []).join(" ")))
  }));
  const support = statements.filter((item) => item.originGroup !== declaration.originGroup
    && item.citation.sourceRef === declaration.citation.sourceRef
    && /^(?:this|the|our|it)\b/i.test(item.statement)
    && /\b(?:lets?|provides?|offers?|serves?|maintains?|accepts?|supports?|performs?|manages?|delivers?)\b/i.test(item.statement)
    && !/\b(?:not|never|previously|formerly|historical|hypothetical|example|could|would|might|subordinate|supporting\s+appendix)\b/i.test(item.statement));
  for (let index = 0; index < eligible.length; index++) for (let other = index + 1; other < eligible.length; other++) {
    const left = eligible[index], right = eligible[other];
    const leftTerms = [...left.terms].filter((term) => !right.terms.has(term));
    const rightTerms = [...right.terms].filter((term) => !left.terms.has(term));
    const leftSupport = support.filter((item) => leftTerms.filter((term) => item.terms.has(term)).length >= 2
      && rightTerms.filter((term) => item.terms.has(term)).length < 2);
    const rightSupport = support.filter((item) => rightTerms.filter((term) => item.terms.has(term)).length >= 2
      && leftTerms.filter((term) => item.terms.has(term)).length < 2);
    for (const first of leftSupport) for (const second of rightSupport) {
      if (first.originGroup === second.originGroup || first.normalizedStatement === second.normalizedStatement) continue;
      // Distinct assertions can establish uncertainty in one overview. They do
      // not satisfy the two-family minimum for either positive decision below.
      const assertions = [
        primaryPurposeAssertion(left.candidate.nodeId, first.citation, first.originGroup, first.normalizedStatement, "EXPLICIT_COEQUAL_STATEMENT_WITH_SEPARATE_SUPPORT"),
        primaryPurposeAssertion(right.candidate.nodeId, second.citation, second.originGroup, second.normalizedStatement, "EXPLICIT_COEQUAL_STATEMENT_WITH_SEPARATE_SUPPORT")
      ];
      if (assertions.length < (policy.minimumAssertions ?? 2)) continue;
      return primaryPurposeEvidenceResult({ algorithm, minimumDepth, basis: "EXPLICIT_COOEQUAL_STATEMENT", assertions,
        declarationAssertion: primaryPurposeAssertion("COEQUAL_DECLARATION", declaration.citation, declaration.originGroup, declaration.normalizedStatement, "EXPLICIT_COEQUAL_STATEMENT") });
    }
  }
  return absent;
}
function explicitLearningResourcePurposeEvidence(hypothesis, policy = {}) {
  const algorithm = policy.algorithm ?? "primary-purpose-evidence/v2";
  const semanticEvidence = hypothesis.citations.filter((item) => ["content-purpose", "content-inventory", "content-workflow"].includes(item.family) && item.trust !== "LOW");
  const purpose = semanticEvidence.filter((item) => item.family === "content-purpose");
  if (!purpose.length) return { schema: "evopilot-harness-primary-purpose-evidence/v1", algorithm, status: "NOT_PROVEN", assertions: [] };
  const minimumDepth = Math.min(...purpose.map((item) => sourceDepth(item.sourceRef)));
  const statements = semanticEvidence.filter((item) => sourceDepth(item.sourceRef) === minimumDepth).flatMap((citation) => purposeStatements(citation.excerpt ?? "").map((statement) => {
    const normalizedStatement = normalizeTerm(statement);
    return {
      citation,
      statement,
      normalizedStatement,
      terms: new Set(semanticTokens(statement)),
      originGroup: digest({ algorithm, sourceRef: citation.sourceRef, sourceDigest: citation.sourceDigest, family: citation.family, statement: normalizedStatement })
    };
  }));
  const assertions = [];
  const declaration = statements.find((item) => item.citation.family === "content-purpose"
    && item.terms.has("learning-material") && item.terms.has("resource-directory") && item.terms.has("software")
    && explicitlyCoequalPurposeStatement(item.statement));
  if (declaration) {
    const learningSupport = statements.find((item) => item.originGroup !== declaration.originGroup && item.terms.has("learning-material"));
    const resourceSupport = statements.find((item) => item.originGroup !== declaration.originGroup && item.originGroup !== learningSupport?.originGroup && item.terms.has("resource-directory"));
    if (learningSupport && resourceSupport) {
      const coequal = [
        primaryPurposeAssertion("LEARNING", learningSupport.citation, learningSupport.originGroup, learningSupport.normalizedStatement, "EXPLICIT_COEQUAL_STATEMENT_WITH_SEPARATE_SUPPORT"),
        primaryPurposeAssertion("RESOURCE_DISCOVERY", resourceSupport.citation, resourceSupport.originGroup, resourceSupport.normalizedStatement, "EXPLICIT_COEQUAL_STATEMENT_WITH_SEPARATE_SUPPORT")
      ];
      const declarationAssertion = primaryPurposeAssertion("COEQUAL_DECLARATION", declaration.citation, declaration.originGroup, declaration.normalizedStatement, "EXPLICIT_COEQUAL_STATEMENT");
      return primaryPurposeEvidenceResult({ algorithm, minimumDepth, basis: "EXPLICIT_COEQUAL_STATEMENT", assertions: coequal, declarationAssertion });
    }
  }
  const allPurposeStatements = purpose.flatMap((citation) => purposeStatements(citation.excerpt ?? "").map((statement) => {
    const normalizedStatement = normalizeTerm(statement);
    return {
      citation,
      statement,
      normalizedStatement,
      originGroup: digest({ algorithm, sourceRef: citation.sourceRef, sourceDigest: citation.sourceDigest, family: citation.family, statement: normalizedStatement })
    };
  }));
  for (const item of allPurposeStatements) {
    if (!explicitPrimaryPurposeStatement(item.statement) && !explicitPurposeHeading(item.statement)) continue;
    for (const purpose of primaryPurposeFacets(item.statement)) {
      assertions.push(primaryPurposeAssertion(purpose, item.citation, item.originGroup, item.normalizedStatement, "DISTINCT_EXPLICIT_ASSERTION"));
    }
  }
  const distinctAssertions = [...new Map(assertions.map((item) => [`${item.purpose}:${item.sourceRef}`, item])).values()];
  const conflict = findDistinctPurposeConflict(distinctAssertions);
  if (!conflict) return { schema: "evopilot-harness-primary-purpose-evidence/v1", algorithm, status: "NOT_PROVEN", assertions: distinctAssertions };
  const coequalDeclared = purpose.some((citation) => explicitlyCoequalPurposeStatement(citation.excerpt ?? ""));
  return primaryPurposeEvidenceResult({ algorithm, minimumDepth, basis: coequalDeclared ? "EXPLICIT_COOEQUAL_STATEMENT" : "DISTINCT_PRIMARY_PURPOSES", assertions: conflict });
}

function primaryPurposeFacets(value) {
  const normalized = normalizeTerm(value);
  const terms = new Set(semanticTokens(value));
  const facets = [];
  if (terms.has("learning-material") || /\b(?:style\s+guide|study\s+plan|tutorial|reference\s+guide)\b/i.test(normalized)) facets.push("LEARNING");
  if (terms.has("resource-directory") && terms.has("software")) facets.push("RESOURCE_DISCOVERY");
  if (/\b(?:package\s+provides?|exports?\s+(?:one|two|three|multiple|the)?\s*[^.\n]*config|extensible\s+shared\s+config|installable\s+(?:tool|package|config)|command[-\s]line\s+tool)\b/i.test(normalized)) facets.push("INSTALLABLE_TOOLING");
  if (/\b(?:coding[-\s]agent|agent\s+engineering|engineering\s+workflows?|agent\s+workflows?|coding\s+agent\s+skills?)\b/i.test(normalized)) facets.push("AGENT_ENGINEERING_WORKFLOW");
  return [...new Set(facets)];
}

function findDistinctPurposeConflict(assertions) {
  for (let index = 0; index < assertions.length; index += 1) {
    for (let other = index + 1; other < assertions.length; other += 1) {
      const left = assertions[index];
      const right = assertions[other];
      if (left.purpose !== right.purpose && left.sourceRef !== right.sourceRef && left.originGroup !== right.originGroup) return [left, right];
    }
  }
  return null;
}
function primaryPurposeAssertion(purpose, citation, originGroup, statement, basis) {
  const assertion = { purpose, basis, evidenceId: citation.evidenceId, sourceRef: citation.sourceRef, originGroup, statementDigest: digest(statement) };
  return { ...assertion, assertionDigest: digest(assertion) };
}
function primaryPurposeEvidenceResult({ algorithm, minimumDepth, basis, assertions, declarationAssertion }) {
  const result = { schema: "evopilot-harness-primary-purpose-evidence/v1", algorithm, status: "PROVEN", basis, minimumDepth, assertions, ...(declarationAssertion ? { declarationAssertion } : {}) };
  return { ...result, evidenceDigest: digest(result) };
}
function purposeStatements(value) {
  return String(value ?? "").split(/(?:\r?\n|(?<=[.!?])\s+)/).map((item) => item.trim()).filter(Boolean);
}
function explicitlyCoequalPurposeStatement(value) {
  return /\b(?:combines?|both|dual[-\s]purpose|two\s+(?:equal\s+)?purposes?|alongside|as\s+well\s+as|together\s+with)\b/i.test(value);
}
function explicitPrimaryPurposeStatement(value) {
  return /\b(?:purpose|provides?|offers?|serves?|maintains?|acts?\s+as|designed\s+to|built\s+to|helps?)\b/i.test(value)
    || /^\s*(?:this|the)\s+(?:project|repository|collection|guide|site|service)\s+(?:is|are)\b/i.test(value);
}
function explicitPurposeHeading(value) {
  return /^\s*#{1,3}\s+.*\b(?:guides?|tutorials?|directories|directory|catalogs?|packages?|configurations?|tools?|workflows?|plugins?|skills?)\b/i.test(value);
}
function isHintBearingEvidence(item) {
  if (item.family.startsWith("content-") || item.family === "dependency" || item.family === "structured") return true;
  if (item.family !== "lexical-content") return false;
  return /\.(?:md|mdx|rst|adoc|txt|docx|pdf|pptx)$/i.test(item.sourceRef ?? "") && !/(?:^|\/)(?:CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|SUPPORT|LICENSE)(?:\.[^/]*)?$/i.test(item.sourceRef ?? "");
}
function sourceDepth(sourceRef) { return String(sourceRef ?? "").split("/").filter(Boolean).length; }
function governedFamilyCount(evidence) {
  const eligible = evidence.filter((item) => item.trust !== "LOW" && isGovernedFamily(item.family));
  const declarations = eligible.filter((item) => item.kind === "declared-responsibility");
  const declarationRefs = new Set(declarations.map((item) => item.sourceRef));
  const semantic = eligible.filter((item) => item.family.startsWith("content-"));
  return independentFamilyCount(eligible.filter((item) => {
    if (item.family === "lexical-content" && declarationRefs.has(item.sourceRef)) return false;
    if (item.kind === "declared-responsibility" && semantic.some((other) => normalizeTerm(other.excerpt ?? "") === normalizeTerm(item.excerpt))) return false;
    return true;
  }).map((item) => item.family));
}
function governedOriginGroupCount(evidence) {
  return new Set(evidence.filter((item) => item.trust !== "LOW" && isGovernedFamily(item.family)).map((item) => {
    if (item.family.startsWith("content-")) return `content:${item.sourceRef}:${item.family}`;
    if (item.family === "dependency") return `dependency:${item.sourceRef}:${item.dependency}`;
    return `structured:${item.path}`;
  })).size;
}
function independentFamilyCount(values) { const families = new Set(values); if ([...families].some((family) => family.startsWith("content-"))) families.delete("lexical-content"); return families.size; }
function semanticTokens(value) {
  const terms = tokenize(value).filter((term) => !STRUCTURAL_STOPWORDS.has(term));
  return [...new Set(terms.map((term, index) => term === "learning" && terms[index - 1] === "machine" ? "machine-learning" : semanticToken(term)))];
}
function rawHintTokens(value) {
  return [...new Set(tokenize(value)
    .filter((term) => !STRUCTURAL_STOPWORDS.has(term))
    .map((term) => term.endsWith("ies") && term.length > 4 ? `${term.slice(0, -3)}y` : term.endsWith("s") && !term.endsWith("ss") && term.length > 3 ? term.slice(0, -1) : term))];
}
function semanticToken(term) {
  if (/^(?:catalog|catalogue|categorized|category|collection|contents|curated|directory|index|indices|inventory|link|links|list|lists|resource|resources)$/.test(term)) return "resource-directory";
  if (/^(?:cheatsheet|cheatsheets|example|examples|exercise|exercises|guide|guides|handbook|handbooks|howto|howtos|interview|knowledge|learn|learning|manual|manuals|reference|references|solution|solutions|step|steps|tutorial|tutorials)$/.test(term)) return "learning-material";
  if (/^(?:agent|agents|assistant|assistants|coding-agent)$/.test(term)) return "agent";
  if (/^(?:persona|personas|personality|role|roles|roster)$/.test(term)) return "persona-roster";
  if (/^(?:gate|gates|instruction|instructions|quality|skill|skills|workflow|workflows)$/.test(term)) return "workflow";
  if (/^(?:database|databases|framework|frameworks|languages|language|libraries|library|platform|platforms|programming|service|services|software|technologies|technology|tool|tools)$/.test(term)) return "software";
  return term;
}
function hashVector(terms, dimensions) { const result = Array(dimensions).fill(0); for (const term of terms) { const hex = digest(term).slice(7); const index = Number.parseInt(hex.slice(0, 8), 16) % dimensions; result[index] += (Number.parseInt(hex.slice(8, 10), 16) % 2 ? 1 : -1); } return result; }
function cosine(left, right) { let dot = 0, a = 0, b = 0; for (let i = 0; i < left.length; i += 1) { dot += left[i] * right[i]; a += left[i] ** 2; b += right[i] ** 2; } return a && b ? Math.max(0, dot / Math.sqrt(a * b)) : 0; }
function uniqueEvidence(values) { return [...new Map(values.map((item) => [`${item.family}:${item.evidenceId}`, item])).values()].sort((a, b) => canonicalCompare(`${a.family}:${a.evidenceId}`, `${b.family}:${b.evidenceId}`)); }
function clamp(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
function round(value) { return Math.round(value * 1000) / 1000; }
