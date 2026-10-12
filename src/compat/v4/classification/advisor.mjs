import { digest, redact } from "../../v3/utils.mjs";
import { assertJSON } from "../../../../vendor/compatibility/v1/reference.mjs";

export const ADVISOR_PROMPT_VERSION = "advisor-candidate-analysis/v5";
export const ADVISOR_INPUT_LIMITS = Object.freeze({ concepts: 64, evidencePerCandidate: 12, candidatesPerAxis: 12, standaloneEvidence: 24, sourceContextEvidence: 12, excerptCharacters: 800 });

const ADVISOR_EVIDENCE_FAMILIES = new Set([
  "lexical-content", "dependency", "structured",
  "content-purpose", "content-inventory", "content-workflow"
]);

export async function requestTaxonomyAdvisor({ hypothesis, taxonomy, retrieval, modelsFile, model: selectedModel, timeoutMs = 180_000, provider, analysisAttemptId, beforeInvocation }) {
  if (typeof provider === "function" && (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 180_000)) {
    return blocked(null, "INVALID_ADVISOR_TIMEOUT", "timeoutMs must be a finite positive integer no greater than 180000.", { invocationCount: 0 });
  }
  const evidenceById = new Map([...hypothesis.citations, ...hypothesis.dependencySignals, ...hypothesis.structuredSignals].map((item) => [item.evidenceId, item]));
  const projectedCandidates = Object.fromEntries(Object.entries(retrieval.axes).map(([axis, candidates]) => [axis, candidates.slice(0, ADVISOR_INPUT_LIMITS.candidatesPerAxis).map((candidate) => {
    const node = taxonomy.axes[axis].nodes.find((item) => item.id === candidate.nodeId);
    return projectCandidate(candidate, evidenceById, new Set(advisorNodeTerms(node)));
  })]));
  const relevanceTerms = advisorTaxonomyTerms(taxonomy, projectedCandidates);
  const eligibleEvidence = [...evidenceById.values()].filter((item) => item.trust !== "LOW" && ADVISOR_EVIDENCE_FAMILIES.has(item.family));
  const sourceContext = projectSourceContext(eligibleEvidence);
  const contextIds = new Set(sourceContext.map((item) => item.evidenceId));
  const standaloneEvidence = [...sourceContext, ...eligibleEvidence
    .filter((item) => !contextIds.has(item.evidenceId))
    .sort((left, right) => advisorEvidenceRelevance(right, relevanceTerms) - advisorEvidenceRelevance(left, relevanceTerms) || evidencePriority(left) - evidencePriority(right) || String(left.evidenceId).localeCompare(String(right.evidenceId)))]
    .slice(0, ADVISOR_INPUT_LIMITS.standaloneEvidence);
  const allowedEvidenceIds = [...new Set([
    ...Object.values(projectedCandidates).flatMap((candidates) => candidates.flatMap((candidate) => candidate.nonLlmEvidence.map((item) => item.evidenceId))),
    ...standaloneEvidence.map((item) => item.evidenceId)
  ])].sort();
  const allowedEvidence = new Set(allowedEvidenceIds);
  const input = {
    schema: "evopilot-harness-advisor-candidate-analysis-input/v1",
    limits: ADVISOR_INPUT_LIMITS,
    hypothesis: {
      sourceContextEvidenceIds: sourceContext.map((item) => item.evidenceId),
      concepts: hypothesis.concepts.slice(0, ADVISOR_INPUT_LIMITS.concepts).map((concept) => ({ ...concept, evidenceIds: concept.evidenceIds.filter((id) => allowedEvidence.has(id)).slice(0, ADVISOR_INPUT_LIMITS.evidencePerCandidate) })),
      citations: hypothesis.citations.filter((item) => allowedEvidence.has(item.evidenceId)).map(({ evidenceId, family, sourceDigest, sourceRef, excerpt, trust }) => ({ evidenceId, family, sourceDigest, sourceRef, trust, excerpt: String(excerpt ?? "").slice(0, ADVISOR_INPUT_LIMITS.excerptCharacters) })),
      dependencySignals: hypothesis.dependencySignals.filter((item) => allowedEvidence.has(item.evidenceId)),
      structuredSignals: hypothesis.structuredSignals.filter((item) => allowedEvidence.has(item.evidenceId))
    },
    taxonomy: { taxonomyDigest: taxonomy.taxonomyDigest, axes: Object.fromEntries(Object.entries(projectedCandidates).map(([axis, candidates]) => [axis, candidates.map((candidate) => {
      const node = taxonomy.axes[axis].nodes.find((item) => item.id === candidate.nodeId);
      return { id: node.id, label: node.label, definition: node.definition, parents: node.parents, assignable: node.assignable, positiveEvidenceHints: node.positiveEvidenceHints ?? [], exclusionHints: node.exclusionHints ?? [] };
    })])) },
    candidates: projectedCandidates,
    allowedEvidenceIds,
    outputContract: {
      requiredFields: ["candidates", "unresolvedConcepts"],
      candidates: { type: "array", itemFields: ["axis", "nodeId", "support", "confidence", "evidenceIds", "contradictions"], supportValues: ["SUPPORT", "NEUTRAL", "CONTRADICT"] },
      unresolvedConcepts: { type: "array", itemFields: ["proposedLabel", "definition", "parentId", "evidenceIds"] }
    },
    rules: ["Read the bounded redacted Source excerpts before assessing semantic support.", "The sourceContextEvidenceIds are a taxonomy-independent, bounded cross-component sample. Read them alongside candidate-specific evidence; sampling coverage and file paths alone do not establish primary business responsibility.", "Assess the Source primary business responsibility rather than isolated framework, vendor, generated, historical, or secondary-module vocabulary.", "Assess every candidate independently; multiple candidates may be SUPPORT only when the current primary responsibility materially supports them.", "Apply supplied exclusion hints to semantically conflicting candidates.", "Use CONTRADICT only for direct Source evidence or a supplied exclusion hint, never merely because another candidate is stronger.", "Every SUPPORT or CONTRADICT item must cite at least one supplied evidenceId; only NEUTRAL may use an empty evidenceIds array.", "Return evidence-bound candidate support only.", "Use unresolvedConcepts only when the Source shows a coherent concept absent from the supplied taxonomy and bind it to a supplied parentId.", "Do not choose the final classification.", "Do not invent evidence ids.", "Do not mutate, approve, publish, execute, or broaden the candidate set."]
  };
  const modelBinding = advisorModelBinding(modelsFile, selectedModel, provider);
  const analysisAttemptDigest = digest({ hypothesisDigest: hypothesis.hypothesisDigest, taxonomyDigest: taxonomy.taxonomyDigest, retrievalDigest: retrieval.retrievalDigest, inputDigest: digest(input), modelBinding, promptVersion: ADVISOR_PROMPT_VERSION, analysisAttemptId });
  const call = typeof provider === "function" ? provider : null;
  if (!call) return blocked(analysisAttemptDigest, "MODEL_NOT_CONFIGURED", "Ontology classification requires an explicitly injected provider callback (PROVIDER_REQUIRED).");
  // Persistence errors must escape: a failed claim must never become a model call.
  await beforeInvocation?.({ analysisAttemptDigest, modelBinding, inputDigest: digest(input) });
  let raw;
  const startedAt = new Date().toISOString();
  const controller = new AbortController();
  let timer;
  try {
    const deadline = new Promise(resolve => {
      timer = setTimeout(() => {
        // Settle the deadline before abort listeners can settle the callback.
        resolve({ timedOut: true });
        controller.abort();
      }, timeoutMs);
    });
    // Both handlers remain attached after a timeout, consuming late rejection.
    const completion = Promise.resolve().then(() => call(input, { signal: controller.signal, analysisAttemptDigest }))
      .then(value => ({ value }), error => ({ error, failed: true }));
    const outcome = await Promise.race([deadline, completion]);
    if (outcome.timedOut) return blocked(analysisAttemptDigest, "TRANSPORT_TIMEOUT", "Advisor deadline elapsed; inspect provider completion before any new attempt.", {
      startedAt, providerCompletion: "UNKNOWN", retryPolicy: "INSPECT_BEFORE_NEW_ATTEMPT"
    });
    if (outcome.failed) return blocked(analysisAttemptDigest, advisorErrorCode(outcome.error), redact(outcome.error instanceof Error ? outcome.error.message : String(outcome.error)), { startedAt });
    raw = outcome.value;
  } finally {
    clearTimeout(timer);
  }
  let validation;
  let rawDigest = null;
  try {
    // No field access, validation or hashing before descriptor-safe JSON checks.
    assertJSON(raw);
    rawDigest = digest(raw);
    validation = validateAdvisorOutput(raw, projectedCandidates, allowedEvidenceIds);
  }
  catch { validation = { status: "FAILED", checks: [{ id: "json-output", status: "FAIL" }] }; }
  if (validation.status !== "VALIDATED") return blocked(analysisAttemptDigest, "ADVISOR_CONTRACT_REJECTED", "Advisor output did not satisfy the immutable candidate-analysis contract.", { validation, rawDigest, startedAt });
  const core = {
    schema: "evopilot-harness-advisor-candidate-analysis/v1",
    status: "SUCCEEDED",
    analysisAttemptDigest,
    promptVersion: ADVISOR_PROMPT_VERSION,
    inputDigest: digest(input),
    outputDigest: digest(raw),
    modelBinding,
    usage: publicUsage(raw._provenance?.usage),
    responseDigest: /^sha256:[a-f0-9]{64}$/.test(raw._provenance?.responseDigest) ? raw._provenance.responseDigest : digest(raw),
    candidates: validation.normalized.candidates,
    unresolvedConcepts: validation.normalized.unresolvedConcepts,
    invocationCount: 1,
    startedAt,
    completedAt: new Date().toISOString(),
    validation,
    authority: { advisoryOnly: true, maySelectResult: false, mayMutateTaxonomy: false, mayApprove: false, mayPublish: false }
  };
  core.advisorReceiptDigest = digest(core);
  return core;
}

export function advisorModelBinding(_modelsFile, selectedModel, provider) {
  const binding = { provider: typeof provider === "function" ? "injected" : "unconfigured", selectedModel: typeof selectedModel === "string" ? redact(selectedModel) : null, configurationDigest: null };
  // Trusted application callbacks may bind an exact reference, never credentials.
  if (typeof provider === "function" && provider.modelBinding) {
    binding.providerBinding = Object.fromEntries(["providerId", "modelId", "revision", "bindingDigest"].filter(key => typeof provider.modelBinding[key] === "string").map(key => [key, redact(provider.modelBinding[key])]));
  }
  return binding;
}

function publicUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  return Object.fromEntries(["promptTokens", "completionTokens", "totalTokens", "inputTokens", "outputTokens", "prompt_tokens", "completion_tokens", "total_tokens"].filter(key => Number.isFinite(usage[key]) && usage[key] >= 0).map(key => [key, usage[key]]));
}

function validateAdvisorOutput(value, candidatesByAxis, allowedEvidenceIds) {
  const knownCandidates = new Set(Object.entries(candidatesByAxis).flatMap(([axis, items]) => items.map((item) => `${axis}:${item.nodeId}`)));
  const knownEvidence = new Set(allowedEvidenceIds);
  const candidates = Array.isArray(value?.candidates) ? value.candidates : [];
  const unresolved = Array.isArray(value?.unresolvedConcepts) ? value.unresolvedConcepts : [];
  const checks = [
    { id: "unresolved-array", status: Array.isArray(value?.unresolvedConcepts) ? "PASS" : "FAIL" },
    { id: "candidate-array", status: Array.isArray(value?.candidates) ? "PASS" : "FAIL" },
    { id: "known-candidates", status: candidates.every((item) => knownCandidates.has(`${item.axis}:${item.nodeId}`)) ? "PASS" : "FAIL" },
    { id: "finite-support", status: candidates.every((item) => ["SUPPORT", "NEUTRAL", "CONTRADICT"].includes(item.support) && Number(item.confidence) >= 0 && Number(item.confidence) <= 1) ? "PASS" : "FAIL" },
    { id: "known-evidence", status: candidates.every((item) => Array.isArray(item.evidenceIds) && (item.support === "NEUTRAL" || item.evidenceIds.length > 0) && item.evidenceIds.every((id) => knownEvidence.has(id))) ? "PASS" : "FAIL" },
    { id: "bounded-candidates", status: candidates.length <= 24 && candidates.every((item) => Object.keys(item).every((key) => ["axis", "nodeId", "support", "confidence", "evidenceIds", "contradictions"].includes(key))) ? "PASS" : "FAIL" },
    { id: "bounded-unresolved", status: unresolved.length <= 8 && unresolved.every((item) => item && typeof item === "object" && typeof item.proposedLabel === "string" && item.proposedLabel.length <= 256 && typeof item.definition === "string" && item.definition.length <= 4096 && Array.isArray(item.evidenceIds) && item.evidenceIds.length >= 2 && item.evidenceIds.every((id) => knownEvidence.has(id)) && !containsSecret(JSON.stringify(item))) ? "PASS" : "FAIL" },
    { id: "secret-free", status: !containsSecret(JSON.stringify({ candidates, unresolved })) ? "PASS" : "FAIL" }
  ];
  // Failed payloads are untrusted, including fields that triggered secret checks.
  // Persist only check results and the caller's raw digest, never rejected values.
  if (checks.some((item) => item.status === "FAIL")) return { status: "FAILED", checks };
  const normalized = {
    candidates: candidates.map((item) => ({ axis: item.axis, nodeId: item.nodeId, support: item.support, confidence: Number(item.confidence), evidenceIds: [...new Set(item.evidenceIds)].sort(), contradictions: [...new Set(item.contradictions ?? [])].map(String).slice(0, 8) })),
    unresolvedConcepts: unresolved.map((item) => ({ proposedLabel: item.proposedLabel, definition: item.definition, parentId: item.parentId ?? null, evidenceIds: [...new Set(item.evidenceIds)].sort() }))
  };
  return { status: "VALIDATED", checks, normalized };
}

function projectCandidate(candidate, evidenceById, candidateTerms) {
  const selected = [];
  const seenIds = new Set();
  const signalTerms = new Set(candidate.signals.flatMap((signal) => signal.matches ?? []).map(String));
  const rankedEvidence = candidate.nonLlmEvidence
    .filter((item) => ADVISOR_EVIDENCE_FAMILIES.has(item.family) && evidenceById.get(item.evidenceId)?.trust !== "LOW")
    .sort((left, right) => evidenceRelevance(right, signalTerms, candidateTerms, evidenceById) - evidenceRelevance(left, signalTerms, candidateTerms, evidenceById) || String(left.evidenceId).localeCompare(String(right.evidenceId)));
  const families = [...new Set(rankedEvidence.map((item) => item.family))].sort();
  for (const family of families) {
    const item = rankedEvidence.find((evidence) => evidence.family === family && !seenIds.has(evidence.evidenceId));
    if (item) { selected.push(item); seenIds.add(item.evidenceId); }
  }
  for (const item of rankedEvidence) {
    if (selected.length >= ADVISOR_INPUT_LIMITS.evidencePerCandidate) break;
    if (!seenIds.has(item.evidenceId)) { selected.push(item); seenIds.add(item.evidenceId); }
  }
  const allowed = new Set(selected.map((item) => item.evidenceId));
  return {
    axis: candidate.axis,
    nodeId: candidate.nodeId,
    label: candidate.label,
    score: candidate.score,
    signals: candidate.signals.map((signal) => ({ ...signal, citations: signal.citations.filter((id) => allowed.has(id)) })),
    nonLlmEvidence: selected,
    contradictions: candidate.contradictions,
    rejectedByExclusion: candidate.rejectedByExclusion
  };
}

function evidenceRelevance(evidence, signalTerms, candidateTerms, evidenceById) {
  const term = String(evidence.term ?? "");
  const source = evidenceById.get(evidence.evidenceId);
  const evidenceTerms = new Set(advisorSemanticTerms(`${term} ${source?.sourceRef ?? source?.path ?? ""} ${source?.excerpt ?? source?.dependency ?? ""}`));
  let candidateOverlap = 0;
  for (const candidateTerm of candidateTerms) if (evidenceTerms.has(candidateTerm)) candidateOverlap += 1;
  const semanticLength = term.replace(/[^\p{L}\p{N}]+/gu, "").length;
  const signalMatch = signalTerms.has(term) ? 100 : 0;
  const semanticFamily = /^(?:content-purpose|content-inventory|content-workflow|dependency)$/.test(evidence.family) ? 20 : 0;
  return candidateOverlap * 40 + signalMatch + semanticFamily + Math.min(16, semanticLength);
}

function projectSourceContext(evidence) {
  // Keep a taxonomy-blind context budget: candidate vocabulary must not erase
  // project overviews or every other component. Paths establish sampling scope,
  // never business meaning; this bounded sample does not prove a primary role.
  const sourceRef = (item) => String(item.sourceRef ?? item.path ?? "").replaceAll("\\", "/");
  const ranked = [...evidence].sort((left, right) => sourceRef(left).split("/").length - sourceRef(right).split("/").length || evidencePriority(left) - evidencePriority(right) || String(left.evidenceId).localeCompare(String(right.evidenceId)));
  const buckets = new Map();
  const seenSources = new Set();
  for (const item of ranked) {
    const ref = sourceRef(item);
    if (!ref || seenSources.has(ref)) continue;
    seenSources.add(ref);
    const bucket = ref.includes("/") ? ref.split("/")[0] : "";
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(item);
  }
  const queues = [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, queue]) => queue);
  const selected = [];
  for (let index = 0; selected.length < ADVISOR_INPUT_LIMITS.sourceContextEvidence && queues.some((queue) => index < queue.length); index += 1) {
    for (const queue of queues) {
      if (index < queue.length) selected.push(queue[index]);
      if (selected.length === ADVISOR_INPUT_LIMITS.sourceContextEvidence) break;
    }
  }
  return selected;
}

function evidencePriority(item) {
  return ({ "content-purpose": 0, "content-inventory": 1, "content-workflow": 2, "lexical-content": 3 })[item.family] ?? 9;
}

function advisorTaxonomyTerms(taxonomy, candidatesByAxis) {
  const terms = new Set();
  for (const [axis, candidates] of Object.entries(candidatesByAxis)) {
    for (const candidate of candidates) {
      const node = taxonomy.axes[axis].nodes.find((item) => item.id === candidate.nodeId);
      for (const term of advisorNodeTerms(node)) terms.add(term);
    }
  }
  return terms;
}

function advisorNodeTerms(node) {
  return [node?.id, node?.label, node?.definition, ...(node?.positiveEvidenceHints ?? []), ...(node?.exclusionHints ?? [])].flatMap(advisorSemanticTerms);
}

function advisorEvidenceRelevance(evidence, relevanceTerms) {
  const evidenceTerms = new Set(advisorSemanticTerms(`${evidence.sourceRef ?? evidence.path ?? ""} ${evidence.excerpt ?? evidence.dependency ?? ""}`));
  let overlap = 0;
  for (const term of relevanceTerms) if (evidenceTerms.has(term)) overlap += 1;
  const primary = evidence.family === "content-purpose" ? 8 : evidence.family === "content-inventory" ? 5 : 0;
  return overlap * 20 + primary;
}

function advisorSemanticTerms(value) {
  return String(value ?? "").normalize("NFKC").replace(/([a-z\d])([A-Z])/g, "$1 $2").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length >= 2).map((term) => {
    if (/^(?:compare|compared|compares|comparison|comparisons)$/.test(term)) return "comparison";
    if (/^(?:research|researches|researching)$/.test(term)) return "research";
    if (/^(?:info|information)$/.test(term)) return "information";
    return term;
  });
}

function containsSecret(value) { return /(?:api[_-]?key|authorization|bearer\s+[a-z0-9._-]+|password|token)\s*[:=]/i.test(String(value)); }

function advisorErrorCode(error) {
  if (typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code)) return error.code;
  if (error?.name === "TimeoutError" || /(?:timed?\s*out|timeout)/i.test(String(error?.message ?? ""))) return "TRANSPORT_TIMEOUT";
  if (error?.name === "AbortError") return "TRANSPORT_ABORTED";
  return "ADVISOR_CALL_FAILED";
}

function blocked(analysisAttemptDigest, code, message, extra = {}) {
  const core = { schema: "evopilot-harness-taxonomy-analysis-blocker/v1", status: "ANALYSIS_BLOCKED_ADVISOR", analysisAttemptDigest, code, message, invocationCount: code === "MODEL_NOT_CONFIGURED" ? 0 : 1, retryPolicy: "EXPLICIT_NEW_ATTEMPT_ONLY", classificationResultCreated: false, authority: { fallbackAllowed: false, mayBroadenMatch: false }, ...extra };
  core.blockerDigest = digest(core);
  return core;
}
