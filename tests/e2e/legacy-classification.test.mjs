import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stringify as stringifyYaml } from "yaml";
import { analyzeSourceTaxonomy, analyzePreparedSourceTaxonomy, createClassificationHandoff } from "../../src/compat/v4/classification/engine.mjs";
import { createClassificationEvaluationReport } from "../../src/compat/v4/classification/evaluation.mjs";
import { aggregateTaxonomyDecision, RETRIEVAL_CONFIG } from "../../src/compat/v4/classification/classifier.mjs";
import { ADVISOR_INPUT_LIMITS, ADVISOR_PROMPT_VERSION, requestTaxonomyAdvisor } from "../../src/compat/v4/classification/advisor.mjs";
import { buildSourceConceptHypothesis } from "../../src/compat/v4/classification/source-concept.mjs";
import { canonicalDocumentDigestFor, resolveTaxonomy } from "../../src/compat/v4/classification/taxonomy.mjs";
import { digest } from "../../src/compat/v3/utils.mjs";

function sourceFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-source-"));
  fs.writeFileSync(path.join(root, "README.md"), "This middleware provides a Redis distributed cache, key-value storage, TTL, eviction, replication, and cache client operations.\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "cache-service", dependencies: { redis: "5.0.0", ioredis: "5.4.0" } }));
  return root;
}

// Pure callback boundary fixtures need no filesystem or model configuration.
function callbackFixture() {
  return {
    hypothesis: { hypothesisDigest: "hypothesis", citations: [], dependencySignals: [], structuredSignals: [], concepts: [] },
    taxonomy: { taxonomyDigest: "taxonomy", axes: {} },
    retrieval: { retrievalDigest: "retrieval", axes: {} }
  };
}

test("bounded callback rejects invalid timeouts before claim or invocation", async () => {
  let calls = 0;
  let claims = 0;
  for (const timeoutMs of [0, -1, NaN, Infinity, 180001, 0.5, "10", null]) {
    const result = await requestTaxonomyAdvisor({ ...callbackFixture(), timeoutMs,
      provider: () => { calls++; }, beforeInvocation: () => { claims++; } });
    assert.equal(result.status, "ANALYSIS_BLOCKED_ADVISOR");
    assert.equal(result.code, "INVALID_ADVISOR_TIMEOUT");
    assert.equal(result.invocationCount, 0);
  }
  const missing = await requestTaxonomyAdvisor({ ...callbackFixture(), timeoutMs: 0, beforeInvocation: () => { claims++; } });
  assert.equal(missing.code, "MODEL_NOT_CONFIGURED");
  assert.equal(missing.invocationCount, 0);
  assert.equal(calls, 0);
  assert.equal(claims, 0);
});

test("bounded callback preserves synchronous and async durable claim failures", async () => {
  let calls = 0;
  const failure = new Error("claim failed");
  for (const beforeInvocation of [() => { throw failure; }, async () => { throw failure; }]) {
    await assert.rejects(requestTaxonomyAdvisor({ ...callbackFixture(), beforeInvocation,
      provider: () => { calls++; } }), error => error === failure);
  }
  assert.equal(calls, 0);
});

test("bounded callback deadline aborts once and discards late success and rejection", { timeout: 2000 }, async () => {
  for (const late of ["pending", "success", "rejection"]) {
    let calls = 0;
    let claims = 0;
    let context;
    let resolve;
    let reject;
    let aborts = 0;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    const result = await analyzePreparedSourceTaxonomy({ prepared: callbackFixture(), advisorTimeoutMs: 1,
      beforeInvocation: () => { claims++; }, advisorProvider: (_input, supplied) => {
        calls++;
        context = supplied;
        supplied.signal.addEventListener("abort", () => { aborts++; });
        return pending;
      } });
    assert.equal(result.status, "ANALYSIS_BLOCKED_ADVISOR");
    assert.equal(result.advisor.code, "TRANSPORT_TIMEOUT");
    assert.equal(result.advisor.invocationCount, 1);
    assert.equal(result.advisor.providerCompletion, "UNKNOWN");
    assert.equal(result.advisor.retryPolicy, "INSPECT_BEFORE_NEW_ATTEMPT");
    assert.deepEqual(result.nextOperations, ["INSPECT", "CLOSE"]);
    assert.equal(context.analysisAttemptDigest, result.advisor.analysisAttemptDigest);
    assert.equal(context.signal.aborted, true);
    assert.equal(aborts, 1);
    assert.equal(result.aggregate, undefined);
    const retained = JSON.stringify(result);
    if (late === "success") resolve({ candidates: [], unresolvedConcepts: [] });
    if (late === "rejection") reject(new Error("late failure must be consumed"));
    // A complete event-loop turn also exposes unhandled late rejections to node:test.
    await new Promise(done => setImmediate(done));
    assert.equal(JSON.stringify(result), retained);
    assert.equal(calls, 1);
    assert.equal(claims, 1);
  }
});

test("bounded callback rejects unsafe JSON without getter execution or raw disclosure", async () => {
  let getters = 0;
  const cyclic = { secret: "raw-secret-marker" };
  cyclic.self = cyclic;
  const accessor = { get candidates() { getters++; throw new Error("raw-secret-marker"); } };
  for (const value of [cyclic, { value: 1n }, accessor, { value: NaN }, { value: Infinity }, new Date(),
    { candidates: [], unresolvedConcepts: [], _provenance: { get usage() { getters++; return {}; } } }]) {
    let calls = 0;
    const result = await requestTaxonomyAdvisor({ ...callbackFixture(), provider: async () => { calls++; return value; } });
    assert.equal(result.code, "ADVISOR_CONTRACT_REJECTED");
    assert.equal(result.invocationCount, 1);
    assert.equal(result.rawDigest, null);
    assert.doesNotMatch(JSON.stringify(result), /raw-secret-marker/);
    assert.equal(calls, 1);
  }
  assert.equal(getters, 0);
});

test("bounded callback preserves success receipts and ordinary typed failures", async () => {
  const raw = { candidates: [], unresolvedConcepts: [], _provenance: { usage: { totalTokens: 7 } } };
  let calls = 0;
  let context;
  const result = await requestTaxonomyAdvisor({ ...callbackFixture(), timeoutMs: 180000,
    provider: async (_input, supplied) => { calls++; context = supplied; return raw; } });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.outputDigest, digest(raw));
  assert.equal(result.responseDigest, digest(raw));
  assert.deepEqual(result.usage, { totalTokens: 7 });
  const { advisorReceiptDigest, ...receipt } = result;
  assert.equal(advisorReceiptDigest, digest(receipt));
  assert.equal(context.signal.aborted, false);
  assert.equal(calls, 1);
  for (const provider of [() => { throw new Error("failed"); }, async () => { throw Object.assign(new Error("failed"), { code: "TRANSPORT_TIMEOUT" }); }]) {
    const failed = await analyzePreparedSourceTaxonomy({ prepared: callbackFixture(), advisorProvider: provider });
    assert.equal(failed.status, "ANALYSIS_BLOCKED_ADVISOR");
    assert.ok(["ADVISOR_CALL_FAILED", "TRANSPORT_TIMEOUT"].includes(failed.advisor.code));
    assert.equal(failed.advisor.invocationCount, 1);
    assert.deepEqual(failed.nextOperations, ["RETRY_NEW_ANALYSIS", "CANCEL", "CLOSE"]);
  }
});

test("bounded callback clears deadlines after all early terminal outcomes", async () => {
  const signals = [];
  for (const outcome of ["success", "throw", "unsafe"]) {
    const result = await requestTaxonomyAdvisor({ ...callbackFixture(), timeoutMs: 1,
      provider: (_input, { signal }) => {
        signals.push(signal);
        if (outcome === "throw") throw new Error("failure");
        if (outcome === "unsafe") return 1n;
        return { candidates: [], unresolvedConcepts: [] };
      } });
    assert.equal(result.invocationCount, 1);
    assert.equal(result.status, outcome === "success" ? "SUCCEEDED" : "ANALYSIS_BLOCKED_ADVISOR");
  }
  await new Promise(done => setTimeout(done, 5));
  assert.ok(signals.every(signal => !signal.aborted));
});

function taxonomy(overrides = {}) {
  return {
    apiVersion: "harness.evopilot.io/v1",
    kind: "Taxonomy",
    metadata: { namespace: "example", name: "software-products", version: "1.0.0" },
    spec: {
      engineRange: ">=4.5.0 <5.0.0",
      requiredCapabilities: ["taxonomy-c14n/v1", "source-concept-hypothesis/v1", "open-world-taxonomy-classifier/v1", "taxonomy-decision-aggregate/v1"],
      axisPolicies: { domainCardinality: "SINGLE", productCardinality: "SINGLE" },
      domains: [
        { id: "technology", label: "Technology", assignable: false },
        { id: "middleware", label: "Middleware", definition: "Reusable software infrastructure between applications and platforms.", aliases: ["middleware"], parents: ["technology"], assignable: true, positiveEvidenceHints: ["redis", "cache", "middleware"] }
      ],
      products: [
        { id: "infrastructure-product", label: "Infrastructure product", assignable: false },
        { id: "distributed-cache", label: "Distributed cache", definition: "A distributed key-value caching system with expiry and replication.", aliases: ["redis", "cache"], parents: ["infrastructure-product"], assignable: true, positiveEvidenceHints: ["redis", "ttl", "eviction", "replication"] }
      ]
    },
    ...overrides
  };
}

function supportingAdvisor(input) {
  return {
    candidates: Object.entries(input.candidates).flatMap(([axis, candidates]) => candidates.map((candidate) => {
      const evidenceIds = candidate.nonLlmEvidence.slice(0, 2).map((item) => item.evidenceId);
      return { axis, nodeId: candidate.nodeId, support: evidenceIds.length ? "SUPPORT" : "NEUTRAL", confidence: evidenceIds.length ? 0.9 : 0.5, evidenceIds };
    })),
    unresolvedConcepts: []
  };
}

function contradictingAdvisor(input) {
  return {
    candidates: Object.entries(input.candidates).flatMap(([axis, candidates]) => candidates.map((candidate) => {
      const evidenceIds = candidate.nonLlmEvidence.slice(0, 2).map((item) => item.evidenceId);
      return { axis, nodeId: candidate.nodeId, support: evidenceIds.length ? "CONTRADICT" : "NEUTRAL", confidence: evidenceIds.length ? 0.9 : 0.5, evidenceIds };
    })),
    unresolvedConcepts: []
  };
}

function learningResourceTaxonomy() {
  return {
    apiVersion: "harness.evopilot.io/v1",
    kind: "Taxonomy",
    metadata: { namespace: "acceptance", name: "developer-knowledge", version: "1.0.0" },
    spec: {
      engineRange: ">=4.5.0 <5.0.0",
      requiredCapabilities: ["taxonomy-c14n/v1", "source-concept-hypothesis/v1", "open-world-taxonomy-classifier/v1", "taxonomy-decision-aggregate/v1"],
      axisPolicies: { domainCardinality: "SINGLE", productCardinality: "SINGLE" },
      domains: [
        { id: "developer-knowledge-space", label: "Developer knowledge", assignable: false },
        { id: "software-engineering-learning", label: "Software engineering learning", definition: "Structured tutorials and practice for learning software engineering.", parents: ["developer-knowledge-space"], assignable: true, positiveEvidenceHints: ["step by step software engineering learning guides", "system design learning and interview preparation"], exclusionHints: ["software catalog without instructional structure"] },
        { id: "software-resource-discovery", label: "Software resource discovery", definition: "A curated index for discovering software, libraries, services, and technical resources.", parents: ["developer-knowledge-space"], assignable: true, positiveEvidenceHints: ["curated software and library list", "categorized developer resource directory"], exclusionHints: ["one instructional study plan"] }
      ],
      products: [
        { id: "developer-knowledge-asset", label: "Developer knowledge asset", assignable: false },
        { id: "tutorial-reference-collection", label: "Tutorial and reference collection", definition: "A structured learning path containing tutorials, references, and examples.", parents: ["developer-knowledge-asset"], assignable: true, positiveEvidenceHints: ["tutorials and step by step guides", "structured learning reference and examples"], exclusionHints: ["flat software listing without learning narrative"] },
        { id: "curated-software-directory", label: "Curated software directory", definition: "A categorized directory of software, libraries, tools, and services.", parents: ["developer-knowledge-asset"], assignable: true, positiveEvidenceHints: ["curated list of frameworks libraries tools or services", "categorized links with contribution rules"], exclusionHints: ["one instructional study plan"] }
      ]
    }
  };
}

function primaryLearningAdvisor(input) {
  const dispositions = {
    "software-engineering-learning": ["SUPPORT", 0.9],
    "software-resource-discovery": ["SUPPORT", 0.6],
    "tutorial-reference-collection": ["SUPPORT", 0.95],
    "curated-software-directory": ["NEUTRAL", 0.5]
  };
  return {
    candidates: Object.entries(input.candidates).flatMap(([axis, candidates]) => candidates.map((candidate) => {
      const [support, confidence] = dispositions[candidate.nodeId] ?? ["NEUTRAL", 0.5];
      return { axis, nodeId: candidate.nodeId, support, confidence, evidenceIds: support === "NEUTRAL" ? [] : candidate.nonLlmEvidence.slice(0, 2).map((item) => item.evidenceId), contradictions: [] };
    })),
    unresolvedConcepts: []
  };
}

function aiEngineeringTaxonomy() {
  return {
    apiVersion: "harness.evopilot.io/v1",
    kind: "Taxonomy",
    metadata: { namespace: "acceptance", name: "agent-engineering", version: "1.0.0" },
    spec: {
      engineRange: ">=4.5.0 <5.0.0",
      requiredCapabilities: ["taxonomy-c14n/v1", "source-concept-hypothesis/v1", "open-world-taxonomy-classifier/v1", "taxonomy-decision-aggregate/v1"],
      axisPolicies: { domainCardinality: "SINGLE", productCardinality: "SINGLE" },
      domains: [
        { id: "developer-knowledge-space", label: "Developer knowledge", assignable: false },
        { id: "ai-assisted-software-engineering", label: "AI-assisted software engineering", definition: "Reusable AI Agent instructions, skills, and engineering workflows for software development.", parents: ["developer-knowledge-space"], assignable: true, positiveEvidenceHints: ["engineering workflows packaged for AI agents", "reusable coding agent skills"], exclusionHints: ["general software resource list", "personality-only agent roster without an engineering workflow contract"] },
        { id: "software-resource-discovery", label: "Software resource discovery", definition: "A general directory of software and technical resources.", parents: ["developer-knowledge-space"], assignable: true, positiveEvidenceHints: ["curated software and library list"] }
      ],
      products: [
        { id: "developer-knowledge-asset", label: "Developer knowledge asset", assignable: false },
        { id: "agent-instruction-library", label: "Agent instruction library", definition: "A reusable library of production-grade coding-agent instructions and workflows.", parents: ["developer-knowledge-asset"], assignable: true, positiveEvidenceHints: ["production grade engineering skills for coding agents", "composable agent workflows with quality gates"] },
        { id: "curated-software-directory", label: "Curated software directory", definition: "A general categorized directory of software tools.", parents: ["developer-knowledge-asset"], assignable: true, positiveEvidenceHints: ["curated list of frameworks libraries tools or services"] }
      ]
    }
  };
}

function aiEngineeringAdvisor(input) {
  const dispositions = {
    "ai-assisted-software-engineering": ["SUPPORT", 0.95],
    "software-resource-discovery": ["CONTRADICT", 0.9],
    "agent-instruction-library": ["SUPPORT", 0.98],
    "curated-software-directory": ["CONTRADICT", 0.9]
  };
  return {
    candidates: Object.entries(input.candidates).flatMap(([axis, candidates]) => candidates.map((candidate) => {
      const [support, confidence] = dispositions[candidate.nodeId] ?? ["NEUTRAL", 0.5];
      return { axis, nodeId: candidate.nodeId, support, confidence, evidenceIds: support === "NEUTRAL" ? [] : candidate.nonLlmEvidence.slice(0, 4).map((item) => item.evidenceId), contradictions: support === "CONTRADICT" ? ["primary purpose differs"] : [] };
    })),
    unresolvedConcepts: []
  };
}

function largeAgentEngineeringSource(totalFiles) {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), `evopilot-v45-agent-engineering-${totalFiles}-`));
  fs.mkdirSync(path.join(source, ".opencode", "tools"), { recursive: true });
  fs.mkdirSync(path.join(source, "catalog"), { recursive: true });
  fs.writeFileSync(path.join(source, "README.md"), [
    "# Agent Engineering Workflows",
    "This production-ready coding-agent plugin packages reusable engineering workflows and coding-agent skills for software development.",
    "## Included workflows",
    "- composable agent workflows with quality gates",
    "- production-grade engineering skills for coding agents"
  ].join("\n"));
  fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({ name: "agent-engineering-workflows", dependencies: { "agent-runtime": "1.0.0" } }));
  fs.writeFileSync(path.join(source, ".opencode", "tools", "index.ts"), "export const tools = ['review', 'test', 'release'];\n");
  for (let index = 0; index < totalFiles - 3; index += 1) {
    fs.writeFileSync(path.join(source, "catalog", `resource-${String(index).padStart(4, "0")}.md`), "general software resource list with frameworks libraries tools and services\n");
  }
  return source;
}

test("Taxonomy/v1 canonical resolution is ordering-independent and business-value neutral", () => {
  const first = taxonomy();
  const second = taxonomy();
  second.spec.domains.reverse();
  second.spec.products.reverse();
  second.spec.products[0]?.aliases?.reverse();
  const a = resolveTaxonomy(first);
  const b = resolveTaxonomy(second);
  assert.equal(a.taxonomyDigest, b.taxonomyDigest);
  assert.deepEqual(a.foundation.businessValues, []);
  assert.equal(a.canonicalization.algorithm, "taxonomy-c14n/v1");
  assert.equal(a.taxonomy.canonicalDocumentDigest, "sha256:625bd74e0d746ee0e0297b1258ab89967a1fd406251430519db2501c6c2605ff");
  assert.equal(a.taxonomyDigest, "sha256:7801c940a4a782f9dc03a2c99511bdb32f7c4e60f2fb9f015db25e01d49413cc");
});

test("Taxonomy/v1 JSON and YAML serializations resolve to one canonical golden snapshot", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-taxonomy-format-"));
  const jsonFile = path.join(root, "taxonomy.json");
  const yamlFile = path.join(root, "taxonomy.yaml");
  fs.writeFileSync(jsonFile, `${JSON.stringify(taxonomy(), null, 2)}\n`);
  fs.writeFileSync(yamlFile, stringifyYaml(taxonomy()));
  const fromJson = resolveTaxonomy(jsonFile);
  const fromYaml = resolveTaxonomy(yamlFile);
  assert.deepEqual(fromJson, fromYaml);
  assert.equal(fromJson.taxonomyDigest, "sha256:7801c940a4a782f9dc03a2c99511bdb32f7c4e60f2fb9f015db25e01d49413cc");
});

test("Taxonomy validation rejects normalization collision, unsupported range/capability, digest drift, and invalid hierarchy before Source access", async () => {
  const collision = taxonomy();
  collision.spec.products.push({ id: "other-cache", label: " Redis ", definition: "Other cache.", assignable: true });
  assert.throws(() => resolveTaxonomy(collision), (error) => error.code === "TAXONOMY_ALIAS_COLLISION");
  const unsupportedRange = taxonomy();
  unsupportedRange.spec.engineRange = ">=5.0.0 <6.0.0";
  assert.throws(() => resolveTaxonomy(unsupportedRange), (error) => error.code === "TAXONOMY_ENGINE_RANGE_UNSUPPORTED");
  const unsupportedCapability = taxonomy();
  unsupportedCapability.spec.requiredCapabilities = ["taxonomy-c14n/v1"];
  assert.throws(() => resolveTaxonomy(unsupportedCapability), (error) => error.code === "TAXONOMY_CAPABILITY_UNSUPPORTED");
  const drift = taxonomy();
  drift.spec.expectedCanonicalDigest = canonicalDocumentDigestFor(drift);
  expectDigestAccepted(drift);
  drift.spec.products[1].definition = "Changed after the declared digest.";
  assert.throws(() => resolveTaxonomy(drift), (error) => error.code === "TAXONOMY_DIGEST_DRIFT");
  const cycle = taxonomy();
  cycle.spec.domains[0].parents = ["middleware"];
  assert.throws(() => resolveTaxonomy(cycle), (error) => error.code === "TAXONOMY_CYCLE");
  const invalid = taxonomy();
  invalid.metadata.name = "Invalid Name";
  await assert.rejects(analyzeSourceTaxonomy({ source: "/path/that/must/not/be-read", taxonomy: invalid, advisorProvider: supportingAdvisor }), (error) => error.code === "TAXONOMY_SCHEMA_INVALID");
});

function expectDigestAccepted(document) {
  assert.equal(resolveTaxonomy(document).taxonomy.canonicalDocumentDigest, document.spec.expectedCanonicalDigest);
}

test("SourceConceptHypothesis is taxonomy-blind, LLM-free, static, and independently corroborated", () => {
  const source = sourceFixture();
  const before = buildSourceConceptHypothesis(source);
  resolveTaxonomy(taxonomy());
  const after = buildSourceConceptHypothesis(source);
  assert.equal(before.hypothesisDigest, after.hypothesisDigest);
  assert.equal(before.provenance.taxonomyExposed, false);
  assert.equal(before.provenance.advisorUsed, false);
  assert.equal(before.provenance.sourceExecution, false);
  assert.ok(before.concepts.find((item) => item.term === "redis")?.evidenceFamilies.length >= 2);
});

test("algorithm plus one Advisor call produces independently corroborated per-axis and aggregate match", async () => {
  const source = sourceFixture();
  let calls = 0;
  const result = await analyzeSourceTaxonomy({ source, taxonomy: taxonomy(), advisorProvider: async (input) => { calls += 1; return supportingAdvisor(input); } });
  assert.equal(calls, 1);
  assert.equal(result.schema, "evopilot-harness-taxonomy-analysis-result/v1");
  assert.equal(result.aggregate, "TAXONOMY_MATCHED");
  assert.equal(result.axes.domain.status, "TAXONOMY_MATCHED");
  assert.equal(result.axes.product.status, "TAXONOMY_MATCHED");
  assert.ok(new Set(result.axes.product.selected.nonLlmEvidence.map((item) => item.family)).size >= 2);
  assert.equal(result.advisor.invocationCount, 1);
  assert.equal(result.authority.advisorMayDecide, false);
  assert.equal(result.authority.classificationProvesEligibility, false);
  assert.deepEqual(result.nextOperations, ["CONTINUE_TO_HARNESS", "CLOSE"]);
});

test("Advisor sees only the bounded candidate projection and an explicit output contract", async () => {
  let observed;
  const result = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: taxonomy(), advisorProvider: async (input) => { observed = input; return supportingAdvisor(input); } });
  assert.equal(result.aggregate, "TAXONOMY_MATCHED");
  assert.deepEqual(observed.outputContract.requiredFields, ["candidates", "unresolvedConcepts"]);
  assert.ok(observed.hypothesis.concepts.length <= ADVISOR_INPUT_LIMITS.concepts);
  assert.ok(observed.candidates.domain.length <= ADVISOR_INPUT_LIMITS.candidatesPerAxis);
  assert.ok(observed.candidates.product.length <= ADVISOR_INPUT_LIMITS.candidatesPerAxis);
  assert.ok(Object.values(observed.candidates).flat().every((candidate) => candidate.nonLlmEvidence.length <= ADVISOR_INPUT_LIMITS.evidencePerCandidate));
  assert.deepEqual(Object.fromEntries(Object.entries(observed.taxonomy.axes).map(([axis, nodes]) => [axis, nodes.map((node) => node.id)])), Object.fromEntries(Object.entries(observed.candidates).map(([axis, candidates]) => [axis, candidates.map((candidate) => candidate.nodeId)])));
  assert.ok(new Set(observed.allowedEvidenceIds).size <= ADVISOR_INPUT_LIMITS.evidencePerCandidate * 2 * ADVISOR_INPUT_LIMITS.candidatesPerAxis);
  assert.ok(observed.hypothesis.citations.some((item) => item.family === "content-purpose" && item.excerpt.includes("distributed cache")));
  assert.ok(Object.values(observed.taxonomy.axes).flat().every((node) => Array.isArray(node.positiveEvidenceHints) && Array.isArray(node.exclusionHints)));
  assert.ok(result.presentation.domain.evidence.length <= 12);
  assert.ok(result.presentation.product.evidence.length <= 12);
  for (const axis of [result.presentation.domain, result.presentation.product]) {
    assert.ok(axis.evidence.every((item) => item.kind !== "Source 依据"));
    assert.ok(axis.evidence.every((item) => !/^(?:and|service|data|information)$/i.test(item.clue)));
    assert.equal(new Set(axis.evidence.map((item) => item.clue.toLowerCase())).size, axis.evidence.length);
  }
});

test("a README larger than the ordinary file limit still yields bounded semantic purpose and inventory evidence", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-large-overview-"));
  const overview = [
    "# Distributed Cache",
    "A Redis distributed cache provides key-value storage, TTL eviction, replication, and client failover.",
    "## Capabilities",
    "- Redis key-value cache",
    "- TTL eviction and replication",
    "- cache client operations",
    "",
    "background filler ".repeat(10_000)
  ].join("\n");
  fs.writeFileSync(path.join(source, "README.md"), overview);
  const hypothesis = buildSourceConceptHypothesis(source);
  assert.ok(fs.statSync(path.join(source, "README.md")).size > 128_000);
  assert.equal(hypothesis.sourceSnapshot.files[0].readable, false);
  assert.equal(hypothesis.sourceSnapshot.characterCount, 0);
  assert.ok(hypothesis.citations.some((item) => item.family === "content-purpose"));
  assert.ok(hypothesis.citations.some((item) => item.family === "content-inventory"));
  const result = await analyzeSourceTaxonomy({ source, taxonomy: taxonomy(), advisorProvider: supportingAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_MATCHED");
});

test("single-file allocation uses the total bounded character budget instead of the 512-file share", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-single-file-budget-"));
  const source = path.join(root, "design.md");
  fs.writeFileSync(source, "financial product research comparison and investment information service\n".repeat(1_500));
  const hypothesis = buildSourceConceptHypothesis(source);
  assert.ok(hypothesis.sourceSnapshot.characterCount > 50_000);
  assert.equal(hypothesis.sourceSnapshot.files[0].readable, true);
});

test("bounded file citations preserve head, middle, and tail business evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-representative-excerpt-"));
  const source = path.join(root, "service.java");
  const filler = "framework boilerplate ".repeat(200);
  fs.writeFileSync(source, `headerMarker ${filler} middleBusinessMarker ${filler} tailProductMarker`);
  const hypothesis = buildSourceConceptHypothesis(source);
  const excerpt = hypothesis.citations.find((item) => item.sourceRef === "service.java").excerpt;
  assert.match(excerpt, /headerMarker/);
  assert.match(excerpt, /middleBusinessMarker/);
  assert.match(excerpt, /tailProductMarker/);
  assert.ok(excerpt.length <= 800);
});

test("large DOCX containers are statically extracted within the bounded text budget", (t) => {
  try { execFileSync("zip", ["-v"]); execFileSync("unzip", ["-v"]); } catch { t.skip("Optional static extractor unavailable; no analyzed document evidence claimed."); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-large-docx-"));
  const word = path.join(root, "word");
  fs.mkdirSync(word);
  fs.writeFileSync(path.join(word, "document.xml"), `<w:document><w:body>${"<w:p>fund research comparison and investment information service</w:p>".repeat(4_000)}</w:body></w:document>`);
  const source = path.join(root, "large-design.docx");
  execFileSync("zip", ["-0", "-q", source, "word/document.xml"], { cwd: root });
  assert.ok(fs.statSync(source).size > 128_000);
  const hypothesis = buildSourceConceptHypothesis(source);
  assert.equal(hypothesis.sourceSnapshot.files[0].readable, true);
  assert.ok(hypothesis.sourceSnapshot.characterCount > 100_000);
  assert.ok(hypothesis.concepts.some((item) => item.term === "research"));
});

test("Advisor projection prioritizes normal-trust business evidence and excludes low-trust candidate noise", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-advisor-relevance-"));
  fs.mkdirSync(path.join(source, "tests"));
  for (let index = 0; index < 32; index += 1) fs.writeFileSync(path.join(source, `${String(index).padStart(2, "0")}-utility.md`), "generic framework utility and transport helper\n");
  fs.writeFileSync(path.join(source, "wealth-fund-research-service.java"), "financial product fund research comparison investment information service\n".repeat(20));
  fs.writeFileSync(path.join(source, "tests", "fund-research-fixture.java"), "financial product fund research comparison fixture\n".repeat(20));
  const document = taxonomy();
  document.spec.domains[1] = { id: "wealth-service", label: "Wealth service", definition: "Financial product research and comparison services.", parents: ["technology"], assignable: true, positiveEvidenceHints: ["fund research comparison", "investment information"] };
  document.spec.products[1] = { id: "wealth-research-system", label: "Wealth research system", definition: "A fund research and product comparison information system.", parents: ["infrastructure-product"], assignable: true, positiveEvidenceHints: ["fund research comparison", "investment information"] };
  let observed;
  await analyzeSourceTaxonomy({ source, taxonomy: document, advisorProvider: async (input) => { observed = input; return supportingAdvisor(input); } });
  assert.ok(observed.hypothesis.citations.some((item) => item.sourceRef === "wealth-fund-research-service.java"));
  assert.ok(observed.hypothesis.structuredSignals.some((item) => item.path === "wealth-fund-research-service.java"));
  assert.ok(Object.values(observed.candidates).flat().every((candidate) => candidate.nonLlmEvidence.every((item) => !item.family.startsWith("low-trust-"))));
  assert.ok(!observed.hypothesis.citations.some((item) => item.sourceRef.includes("fund-research-fixture")));
});

test("governed hybrid match requires corroborated lexical evidence and still honors Advisor contradiction", () => {
  const evidence = [
    { evidenceId: "purpose", family: "content-purpose", sourceRef: "README.md" },
    { evidenceId: "structured", family: "structured", path: "wealth-research-service" }
  ];
  const hypothesis = { concepts: [{ term: "wealth", evidenceIds: evidence.map((item) => item.evidenceId), evidenceFamilies: evidence.map((item) => item.family) }, { term: "research", evidenceIds: evidence.map((item) => item.evidenceId), evidenceFamilies: evidence.map((item) => item.family) }, { term: "service", evidenceIds: evidence.map((item) => item.evidenceId), evidenceFamilies: evidence.map((item) => item.family) }], citations: evidence.slice(0, 1), structuredSignals: evidence.slice(1), dependencySignals: [], sourceSnapshot: { fileCount: 2 }, missingEvidence: [] };
  const resolved = { axes: { domain: { cardinality: "SINGLE", nodes: [{ id: "wealth-service", assignable: true, ancestors: [] }] }, product: { cardinality: "SINGLE", nodes: [{ id: "wealth-system", assignable: true, ancestors: [] }] } } };
  const candidate = (axis, nodeId, bm25) => ({ axis, nodeId, label: nodeId, ancestors: [], score: 0.1, signals: [{ type: "bm25", score: bm25, matches: ["wealth"], citations: evidence.map((item) => item.evidenceId), contradictions: [] }], nonLlmEvidence: evidence.map((item) => ({ evidenceId: item.evidenceId, family: item.family, term: "wealth research" })), contradictions: [], rejectedAlternatives: [], rejectedByExclusion: false });
  const retrieval = { axes: { domain: [candidate("domain", "wealth-service", 0.5)], product: [candidate("product", "wealth-system", 0.5)] } };
  const support = { candidates: [{ axis: "domain", nodeId: "wealth-service", support: "SUPPORT", confidence: 0.8, evidenceIds: ["purpose"] }, { axis: "product", nodeId: "wealth-system", support: "SUPPORT", confidence: 0.8, evidenceIds: ["purpose"] }], unresolvedConcepts: [] };
  assert.equal(aggregateTaxonomyDecision({ hypothesis, taxonomy: resolved, retrieval, advisor: support }).aggregate, "TAXONOMY_MATCHED");
  const neutral = { candidates: [{ axis: "domain", nodeId: "wealth-service", support: "NEUTRAL", confidence: 0.1, evidenceIds: [] }, { axis: "product", nodeId: "wealth-system", support: "NEUTRAL", confidence: 0.1, evidenceIds: [] }], unresolvedConcepts: [] };
  assert.equal(aggregateTaxonomyDecision({ hypothesis, taxonomy: resolved, retrieval, advisor: neutral }).aggregate, "TAXONOMY_MATCHED");
  const contradict = { candidates: [{ axis: "domain", nodeId: "wealth-service", support: "CONTRADICT", confidence: 0.9, evidenceIds: ["purpose"] }, { axis: "product", nodeId: "wealth-system", support: "CONTRADICT", confidence: 0.9, evidenceIds: ["purpose"] }], unresolvedConcepts: [] };
  assert.notEqual(aggregateTaxonomyDecision({ hypothesis, taxonomy: resolved, retrieval, advisor: contradict }).aggregate, "TAXONOMY_MATCHED");
  const weakLexical = { axes: { domain: [candidate("domain", "wealth-service", 0.2)], product: [candidate("product", "wealth-system", 0.2)] } };
  assert.notEqual(aggregateTaxonomyDecision({ hypothesis, taxonomy: resolved, retrieval: weakLexical, advisor: support }).aggregate, "TAXONOMY_MATCHED");
});

test("Advisor contradiction removes a candidate before the governed safe-margin decision", () => {
  const evidence = [
    { evidenceId: "purpose", family: "content-purpose", sourceRef: "README.md" },
    { evidenceId: "inventory", family: "content-inventory", sourceRef: "README.md" }
  ];
  const hypothesis = {
    concepts: ["software", "curated", "directory"].map((term) => ({
      term,
      evidenceIds: evidence.map((item) => item.evidenceId),
      evidenceFamilies: evidence.map((item) => item.family)
    })),
    citations: evidence,
    structuredSignals: [],
    dependencySignals: [],
    sourceSnapshot: { fileCount: 1 },
    missingEvidence: []
  };
  const resolved = {
    axes: {
      domain: {
        cardinality: "SINGLE",
        nodes: [
          { id: "software-resource-discovery", assignable: true, ancestors: [] },
          { id: "software-engineering-learning", assignable: true, ancestors: [] }
        ]
      },
      product: {
        cardinality: "SINGLE",
        nodes: [{ id: "curated-software-directory", assignable: true, ancestors: [] }]
      }
    }
  };
  const candidate = (axis, nodeId, score) => ({
    axis,
    nodeId,
    label: nodeId,
    ancestors: [],
    score,
    signals: [{ type: "bm25", score: 0.75, matches: ["software"], citations: evidence.map((item) => item.evidenceId), contradictions: [] }],
    nonLlmEvidence: evidence.map((item) => ({ evidenceId: item.evidenceId, family: item.family, term: "curated software directory" })),
    contradictions: [],
    rejectedAlternatives: [],
    rejectedByExclusion: false
  });
  const retrieval = {
    axes: {
      domain: [
        candidate("domain", "software-resource-discovery", 0.602),
        candidate("domain", "software-engineering-learning", 0.582)
      ],
      product: [candidate("product", "curated-software-directory", 0.661)]
    }
  };
  const advisor = {
    candidates: [
      { axis: "domain", nodeId: "software-resource-discovery", support: "SUPPORT", confidence: 0.95, evidenceIds: ["purpose", "inventory"] },
      { axis: "domain", nodeId: "software-engineering-learning", support: "CONTRADICT", confidence: 0.9, evidenceIds: ["purpose", "inventory"] },
      { axis: "product", nodeId: "curated-software-directory", support: "SUPPORT", confidence: 0.95, evidenceIds: ["purpose", "inventory"] }
    ],
    unresolvedConcepts: []
  };
  const result = aggregateTaxonomyDecision({ hypothesis, taxonomy: resolved, retrieval, advisor });
  assert.equal(result.aggregate, "TAXONOMY_MATCHED");
  assert.equal(result.axes.domain.selected.nodeId, "software-resource-discovery");
  assert.equal(result.axes.domain.candidates.find((item) => item.nodeId === "software-engineering-learning").advisorSignal.support, "CONTRADICT");

  const neutralAdvisor = {
    ...advisor,
    candidates: advisor.candidates.map((item) => item.axis === "domain" ? { ...item, support: "NEUTRAL", confidence: 0.5, evidenceIds: [] } : item)
  };
  const unresolved = aggregateTaxonomyDecision({ hypothesis, taxonomy: resolved, retrieval, advisor: neutralAdvisor });
  assert.equal(unresolved.axes.domain.status, "TAXONOMY_AMBIGUOUS");
  assert.equal(unresolved.axes.domain.ambiguityBasis, "UNRESOLVED_DETERMINISTIC_SCORE_MARGIN");
});

test("manifest and repository machinery without primary business evidence remain insufficient", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-no-overview-"));
  fs.mkdirSync(path.join(source, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({ name: "public-api-list", devDependencies: { prettier: "3.0.0" } }));
  fs.writeFileSync(path.join(source, ".github", "workflows", "lint.yml"), "name: lint\non: pull_request\njobs: {}\n");
  const result = await analyzeSourceTaxonomy({ source, taxonomy: taxonomy(), advisorProvider: supportingAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_EVIDENCE_INSUFFICIENT");
  assert.equal(result.axes.domain.status, "TAXONOMY_EVIDENCE_INSUFFICIENT");
  assert.equal(result.axes.product.status, "TAXONOMY_EVIDENCE_INSUFFICIENT");
});

test("a lexical copy and semantic projection derived from one weak README count as one evidence family", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-single-origin-"));
  fs.writeFileSync(path.join(source, "README.md"), "# Utility project\n\nThis repository contains reusable utilities. More design and product information will be added later.\n");
  const hypothesis = buildSourceConceptHypothesis(source);
  const product = hypothesis.concepts.find((item) => item.term === "product");
  assert.deepEqual(product.evidenceFamilies, ["content-purpose", "lexical-content"]);
  const result = await analyzeSourceTaxonomy({ source, taxonomy: taxonomy(), advisorProvider: contradictingAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_EVIDENCE_INSUFFICIENT");
  assert.equal(result.axes.domain.status, "TAXONOMY_EVIDENCE_INSUFFICIENT");
  assert.equal(result.axes.product.status, "TAXONOMY_EVIDENCE_INSUFFICIENT");
  assert.equal(result.axes.domain.advisorDisposition.contradictionMayCreateExtension, false);
  assert.equal(result.axes.product.advisorDisposition.contradictionMaySatisfyNonLlmEvidenceMinimum, false);
  assert.deepEqual(result.nextOperations, ["SUPPLY_MORE_SOURCE_EVIDENCE", "REANALYZE", "CLOSE"]);
});

test("Advisor contradiction cannot veto a taxonomy-blind gap with genuinely independent non-LLM evidence", async () => {
  const gap = taxonomy();
  gap.spec.domains = [{ id: "finance", label: "Finance", definition: "Financial services and transactions.", assignable: true, positiveEvidenceHints: ["banking"] }];
  gap.spec.products = [{ id: "customer-portal", label: "Customer portal", definition: "A customer interaction portal.", assignable: true, positiveEvidenceHints: ["ticket", "customer"] }];
  const result = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: gap, advisorProvider: contradictingAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_EXTENSION_SUGGESTED");
  assert.equal(result.axes.domain.extensionBasis, "TAXONOMY_BLIND_CONCEPT_WITH_INDEPENDENT_NON_LLM_EVIDENCE");
  assert.equal(result.axes.product.extensionBasis, "TAXONOMY_BLIND_CONCEPT_WITH_INDEPENDENT_NON_LLM_EVIDENCE");
  assert.ok(result.axes.domain.advisorDisposition.contradictedCandidateIds.length > 0);
  assert.equal(result.axes.domain.advisorDisposition.contradictionMayCreateExtension, false);
});

test("a persona-only Agent roster is proposed as a taxonomy gap instead of an engineering workflow match", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-persona-roster-"));
  fs.writeFileSync(path.join(source, "README.md"), [
    "# AI Agent Personas",
    "A personality-only agent roster provides general prompt personas and named roles, without engineering workflows or quality gates.",
    "## Persona roster",
    "- Architect persona and personality",
    "- Developer persona and role"
  ].join("\n"));
  const document = taxonomy();
  document.spec.domains = [
    { id: "developer-space", label: "Developer space", assignable: false },
    { id: "ai-engineering", label: "AI engineering", definition: "Reusable engineering workflows for coding agents.", parents: ["developer-space"], assignable: true, positiveEvidenceHints: ["reusable coding agent skills", "engineering workflows for AI agents"], exclusionHints: ["personality-only agent roster without engineering workflow contract"] }
  ];
  document.spec.products = [
    { id: "knowledge-asset", label: "Knowledge asset", assignable: false },
    { id: "agent-workflow-library", label: "Agent workflow library", definition: "Installable agent workflows with quality gates.", parents: ["knowledge-asset"], assignable: true, positiveEvidenceHints: ["agent workflows with quality gates"], exclusionHints: ["general prompt persona roster"] }
  ];
  const result = await analyzeSourceTaxonomy({ source, taxonomy: document, advisorProvider: supportingAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_EXTENSION_SUGGESTED");
  assert.equal(result.axes.domain.status, "TAXONOMY_EXTENSION_SUGGESTED");
  assert.equal(result.axes.product.status, "TAXONOMY_EXTENSION_SUGGESTED");
  assert.notEqual(result.axes.product.extension.proposedLabel, "workflow");
  const rejectedDomain = result.axes.domain.candidates.find((item) => item.nodeId === "ai-engineering");
  assert.equal(rejectedDomain.rejectedByExclusion, true);
  assert.equal(rejectedDomain.exclusionProofs.length, 1);
  assert.ok(rejectedDomain.exclusionProofs[0].originGroups.length >= 2);
  assert.equal(rejectedDomain.exclusionProofs[0].structuredPathMayEstablishExclusion, false);
});

test("incidental resource-list content and generic structured paths cannot veto a supported Agent-engineering classification", async () => {
  const impact = {"schema":"evopilot-harness-classification-impact-fixture/v1","id":"candidate-13-rc17-journey-08","candidateId":"evopilot-harness-v4.5.0-candidate-13","sourceId":"live-ghq04-automation-codegen-02","sourceSnapshotDigest":"sha256:398dea5edb00703cf4c7c662e25a7e32e50f0df127908300d9260e536ba1956c","taxonomyDigest":"sha256:51cdbf0ac929b58ebbce7897147f0bc8b2ea982fd377b4ea3ca567116dd0702c","expectedAggregate":"TAXONOMY_MATCHED","expectedDomain":"ai-assisted-software-engineering","expectedProduct":"agent-instruction-library","observedCandidate13Aggregate":"TAXONOMY_EXTENSION_SUGGESTED","observedCandidate13ExtensionLabel":"skill","observedCandidate13AnalysisResultDigest":"sha256:de461346dd377985e02cd461660ad6668e2e02f445e2cd3832b68b03dc79e53a","portableRegression":"large Agent-engineering Source with incidental resource-list lexical content, a generic tools/index.ts path, repeated generic artifact terms, and 511/512/513 file-boundary variants","authority":{"candidateOutputMayRewriteOracle":false,"fixtureMayEnterProductionLogic":false,"acceptanceEvidence":false}};
  assert.equal(impact.sourceSnapshotDigest, "sha256:398dea5edb00703cf4c7c662e25a7e32e50f0df127908300d9260e536ba1956c");
  assert.equal(impact.expectedAggregate, "TAXONOMY_MATCHED");
  for (const totalFiles of [511, 512, 513]) {
    const result = await analyzeSourceTaxonomy({ source: largeAgentEngineeringSource(totalFiles), taxonomy: aiEngineeringTaxonomy(), advisorProvider: aiEngineeringAdvisor });
    assert.equal(result.aggregate, "TAXONOMY_MATCHED", totalFiles);
    assert.equal(result.axes.domain.selected.nodeId, "ai-assisted-software-engineering", totalFiles);
    assert.equal(result.axes.product.selected.nodeId, "agent-instruction-library", totalFiles);
    const domain = result.axes.domain.candidates.find((item) => item.nodeId === "ai-assisted-software-engineering");
    assert.equal(domain.rejectedByExclusion, false, totalFiles);
    assert.deepEqual(domain.exclusionProofs, [], totalFiles);
    assert.equal(result.axes.domain.extension, undefined, totalFiles);
  }
});

test("generic artifact-form vocabulary cannot manufacture a synthetic Domain or Product extension", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-generic-artifacts-"));
  fs.writeFileSync(path.join(source, "README.md"), [
    "# Reusable skills and workflows",
    "This repository provides reusable skills, workflows, tools, libraries, services, plugins, hooks, commands, rules, scripts, and software.",
    "## Contents",
    "- skills workflows tools libraries services plugins hooks commands rules scripts"
  ].join("\n"));
  const unrelated = taxonomy();
  unrelated.spec.domains = [{ id: "finance", label: "Finance", definition: "Financial transactions and account services.", assignable: true, positiveEvidenceHints: ["bank ledger"] }];
  unrelated.spec.products = [{ id: "customer-portal", label: "Customer portal", definition: "A customer request and ticket portal.", assignable: true, positiveEvidenceHints: ["ticket customer"] }];
  const result = await analyzeSourceTaxonomy({ source, taxonomy: unrelated, advisorProvider: supportingAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_EVIDENCE_INSUFFICIENT");
  assert.equal(result.axes.domain.status, "TAXONOMY_EVIDENCE_INSUFFICIENT");
  assert.equal(result.axes.product.status, "TAXONOMY_EVIDENCE_INSUFFICIENT");
});

test("a genuinely mixed learning and resource-discovery overview remains ambiguous", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-mixed-purpose-"));
  fs.writeFileSync(path.join(source, "README.md"), [
    "# Developer Learning and Resource Guide",
    "This collection combines step-by-step software engineering tutorials with a curated categorized directory of libraries and tools.",
    "## Learning guides",
    "- system design tutorial and exercises",
    "## Resource directory",
    "- curated frameworks and libraries"
  ].join("\n"));
  const document = taxonomy();
  document.spec.domains = [
    { id: "developer-space", label: "Developer space", assignable: false },
    { id: "learning", label: "Learning", definition: "Developer learning guides.", parents: ["developer-space"], assignable: true, positiveEvidenceHints: ["learning guides"] },
    { id: "discovery", label: "Discovery", definition: "Developer resource directory.", parents: ["developer-space"], assignable: true, positiveEvidenceHints: ["resource directory"] }
  ];
  document.spec.products = [
    { id: "knowledge-asset", label: "Knowledge asset", assignable: false },
    { id: "tutorials", label: "Tutorials", definition: "Tutorial guides.", parents: ["knowledge-asset"], assignable: true, positiveEvidenceHints: ["tutorial guides"] },
    { id: "directory", label: "Directory", definition: "Software directory.", parents: ["knowledge-asset"], assignable: true, positiveEvidenceHints: ["software directory"] }
  ];
  const result = await analyzeSourceTaxonomy({ source, taxonomy: document, advisorProvider: supportingAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_AMBIGUOUS");
  assert.equal(result.axes.product.status, "TAXONOMY_AMBIGUOUS");
  assert.equal(result.axes.product.ambiguityBasis, "DISTINCT_PRIMARY_PURPOSES");
  assert.equal(result.axes.product.mixedPurposeEvidence.status, "PROVEN");
  assert.equal(result.axes.product.mixedPurposeEvidence.basis, "EXPLICIT_COEQUAL_STATEMENT");
  assert.deepEqual(result.axes.product.mixedPurposeEvidence.assertions.map((item) => item.purpose), ["LEARNING", "RESOURCE_DISCOVERY"]);
  assert.equal(new Set(result.axes.product.mixedPurposeEvidence.assertions.map((item) => item.assertionDigest)).size, 2);
  assert.equal(new Set(result.axes.product.mixedPurposeEvidence.assertions.map((item) => item.originGroup)).size, 2);
});

test("one coequal sentence without separate semantic support cannot manufacture two primary purposes", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-unsubstantiated-coequal-"));
  fs.writeFileSync(path.join(source, "README.md"), [
    "# Developer knowledge",
    "This collection combines step-by-step software engineering tutorials with a curated categorized directory of software libraries and tools."
  ].join("\n"));
  const result = await analyzeSourceTaxonomy({ source, taxonomy: learningResourceTaxonomy(), advisorProvider: supportingAdvisor });
  for (const axis of [result.axes.domain, result.axes.product]) {
    assert.notEqual(axis.ambiguityBasis, "EXPLICIT_COOEQUAL_PRIMARY_PURPOSES");
    assert.equal(axis.mixedPurposeEvidence, undefined);
  }
});

test("one primary learning purpose with a subordinate resource appendix remains matched", async () => {
  for (const [name, appendix] of [
    ["list", "- curated list of programming-language references"],
    ["catalog", "- categorized catalog of libraries, tools, and external reference links"]
  ]) {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), `evopilot-v45-primary-learning-${name}-`));
    fs.writeFileSync(path.join(source, "README.md"), [
      "# Coding Interview Study Plan",
      "This repository provides a multi-month study plan for becoming a software engineer.",
      "The curriculum offers step-by-step software engineering tutorials, system-design learning, interview preparation, and practice exercises.",
      "## Supporting programming-language resources",
      appendix
    ].join("\n"));
    const result = await analyzeSourceTaxonomy({ source, taxonomy: learningResourceTaxonomy(), advisorProvider: primaryLearningAdvisor });
    assert.equal(result.aggregate, "TAXONOMY_MATCHED", name);
    assert.equal(result.axes.domain.selected.nodeId, "software-engineering-learning", name);
    assert.equal(result.axes.product.selected.nodeId, "tutorial-reference-collection", name);
    assert.equal(result.axes.domain.ambiguityBasis, undefined, name);
    assert.equal(result.axes.product.ambiguityBasis, undefined, name);
  }
});

test("explicit coequal primary purposes remain ambiguous under every Advisor disposition", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-coequal-purpose-"));
  fs.writeFileSync(path.join(source, "README.md"), [
    "# Developer learning and directory service",
    "This collection combines step-by-step software engineering tutorials with a curated categorized directory of software libraries and tools.",
    "It provides learning exercises and separately maintains the software directory as an equal primary purpose.",
    "## Learning guides",
    "- system design tutorial, interview preparation, and practice exercises",
    "## Resource directory",
    "- curated frameworks, libraries, tools, and services"
  ].join("\n"));
  for (const [name, advisorProvider] of [["balanced", supportingAdvisor], ["discriminating", primaryLearningAdvisor], ["contradicting", contradictingAdvisor]]) {
    const result = await analyzeSourceTaxonomy({ source, taxonomy: learningResourceTaxonomy(), advisorProvider });
    assert.equal(result.aggregate, "TAXONOMY_AMBIGUOUS", name);
    assert.equal(result.axes.domain.ambiguityBasis, "DISTINCT_PRIMARY_PURPOSES", name);
    assert.equal(result.axes.product.ambiguityBasis, "DISTINCT_PRIMARY_PURPOSES", name);
    assert.equal(result.authority.advisorMayDecide, false, name);
  }
});

test("a style guide plus independently installable configuration remains ambiguous even when Advisor favors the guide", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-guide-and-tooling-"));
  fs.mkdirSync(path.join(source, "packages", "eslint-config-base"), { recursive: true });
  fs.writeFileSync(path.join(source, "README.md"), [
    "# JavaScript Style Guide",
    "A practical reference guide with examples for writing maintainable JavaScript.",
    "## References",
    "- language examples and style recommendations"
  ].join("\n"));
  fs.writeFileSync(path.join(source, "packages", "eslint-config-base", "README.md"), [
    "# eslint-config-base package",
    "This package provides an extensible shared config for ESLint.",
    "We export two ESLint configurations for installation and usage with libraries and tools."
  ].join("\n"));
  fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({ name: "style-guide-and-config", dependencies: { eslint: "9.0.0" } }));
  const result = await analyzeSourceTaxonomy({ source, taxonomy: learningResourceTaxonomy(), advisorProvider: primaryLearningAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_AMBIGUOUS");
  assert.equal(result.axes.product.status, "TAXONOMY_AMBIGUOUS");
  assert.equal(result.axes.product.ambiguityBasis, "DISTINCT_PRIMARY_PURPOSES");
  assert.deepEqual(new Set(result.axes.product.mixedPurposeEvidence.assertions.map((item) => item.purpose)), new Set(["LEARNING", "INSTALLABLE_TOOLING"]));
  assert.equal(result.axes.product.candidates.find((item) => item.nodeId === "tutorial-reference-collection").advisorSignal.support, "SUPPORT");
});

test("one broad guide token cannot satisfy a multi-concept structured hint", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-single-guide-token-"));
  fs.writeFileSync(path.join(source, "README.md"), "# JavaScript guide\nThis guide documents one coding convention.\n");
  const result = await analyzeSourceTaxonomy({ source, taxonomy: learningResourceTaxonomy(), advisorProvider: primaryLearningAdvisor });
  const candidate = result.retrieval.axes.product.find((item) => item.nodeId === "tutorial-reference-collection");
  assert.equal(candidate.signals.find((item) => item.type === "structured").score, 0);
  assert.ok(candidate.signals.find((item) => item.type === "bm25").score > 0);
});

test("bounded stratified Source sampling prevents one copied framework tree from hiding current business responsibility", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-stratified-"));
  const framework = path.join(source, "AppFramework", "LogUnified", "src", "main", "java", "ch", "qos", "logback");
  const business = path.join(source, "BusinessResearch");
  fs.mkdirSync(framework, { recursive: true });
  fs.mkdirSync(business, { recursive: true });
  fs.mkdirSync(path.join(source, "tests", "fixtures"), { recursive: true });
  for (let index = 0; index < 600; index += 1) fs.writeFileSync(path.join(framework, `Logger${String(index).padStart(3, "0")}.java`), "package ch.qos.logback; public class Logger { String framework = \"logback logging adapter\"; }\n");
  fs.writeFileSync(path.join(business, "README.md"), "Investment information research, product comparison, and research information presentation are the current business responsibilities.\n");
  fs.writeFileSync(path.join(business, "package.json"), JSON.stringify({ name: "research-information-service", description: "investment information and research presentation" }));
  fs.writeFileSync(path.join(source, "tests", "fixtures", "removed-experiment.md"), "distributed cache middleware\n".repeat(40));
  const document = taxonomy();
  document.spec.domains = [
    { id: "business-services", label: "Business services", assignable: false },
    { id: "investment-research", label: "Investment research", definition: "Investment information research and comparison.", parents: ["business-services"], assignable: true, positiveEvidenceHints: ["investment information research", "product comparison"] }
  ];
  document.spec.products = [
    { id: "information-systems", label: "Information systems", assignable: false },
    { id: "research-information-service", label: "Research information service", definition: "Research information presentation product.", parents: ["information-systems"], assignable: true, positiveEvidenceHints: ["research information presentation"], exclusionHints: ["distributed cache middleware"] }
  ];
  const result = await analyzeSourceTaxonomy({ source, taxonomy: document, advisorProvider: supportingAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_MATCHED");
  assert.equal(result.sourceSnapshot.fileCount, 512);
  assert.ok(result.sourceSnapshot.files.some((item) => item.sourceRef.startsWith("BusinessResearch/")));
  assert.equal(result.axes.domain.selected.nodeId, "investment-research");
  assert.equal(result.axes.product.selected.nodeId, "research-information-service");
  assert.deepEqual(result.axes.product.selected.contradictions, []);
  assert.ok(result.presentation.domain.evidence.length <= 12);
  assert.ok(result.presentation.product.evidence.length <= 12);
});

test("Advisor failure blocks without creating a Taxonomy result or deterministic fallback", async () => {
  const result = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: taxonomy(), advisorProvider: async () => { const error = new Error("timeout"); error.code = "TRANSPORT_TIMEOUT"; throw error; } });
  assert.equal(result.status, "ANALYSIS_BLOCKED_ADVISOR");
  assert.equal(result.advisor.classificationResultCreated, false);
  assert.equal(result.advisor.authority.fallbackAllowed, false);
  assert.equal(result.analysisResultDigest, undefined);
});

test("Advisor timeout normalizes DOMException numeric codes into a stable typed blocker", async () => {
  const result = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: taxonomy(), advisorProvider: async () => { const error = new Error("The operation was aborted due to timeout"); error.name = "TimeoutError"; error.code = 23; throw error; } });
  assert.equal(result.status, "ANALYSIS_BLOCKED_ADVISOR");
  assert.equal(result.advisor.code, "TRANSPORT_TIMEOUT");
  assert.equal(result.advisor.invocationCount, 1);
  assert.equal(result.advisor.classificationResultCreated, false);
});

test("malformed, secret-bearing, or out-of-candidate Advisor output is rejected without repair", async () => {
  for (const advisorProvider of [
    async () => ({ candidates: [{ axis: "domain", nodeId: "invented", support: "SUPPORT", confidence: 1, evidenceIds: ["invented"] }], unresolvedConcepts: [] }),
    async (input) => ({ ...supportingAdvisor(input), unresolvedConcepts: [{ proposedLabel: "secret", definition: "api_key=must-not-persist", evidenceIds: input.hypothesis.citations.slice(0, 2).map((item) => item.evidenceId) }] })
  ]) {
    const result = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: taxonomy(), advisorProvider });
    assert.equal(result.status, "ANALYSIS_BLOCKED_ADVISOR");
    assert.equal(result.advisor.code, "ADVISOR_CONTRACT_REJECTED");
    assert.equal(result.advisor.invocationCount, 1);
    assert.equal(result.advisor.classificationResultCreated, false);
    assert.equal(result.advisor.validation.normalized, undefined);
    assert.doesNotMatch(JSON.stringify(result), /must-not-persist/);
  }
});

test("materially tied candidates return ambiguity and cannot hand off", async () => {
  const document = taxonomy();
  document.spec.products.push({ id: "ioredis-platform", label: "IORedis", definition: "A Redis caching platform with expiry and replication.", aliases: ["ioredis"], parents: ["infrastructure-product"], assignable: true, positiveEvidenceHints: ["redis", "ttl", "eviction", "replication"] });
  const result = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: document, advisorProvider: supportingAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_AMBIGUOUS");
  assert.throws(() => createClassificationHandoff({ classificationSessionId: "classification-1", result, decidedBy: "user", decisionToken: "anything" }), (error) => error.code === "CLASSIFICATION_MATCH_REQUIRED");
});

test("deterministic classification distinguishes scheme extension, insufficient evidence, ambiguity, and mixed-axis precedence", async () => {
  const gap = taxonomy();
  gap.spec.domains = [{ id: "finance", label: "Finance", definition: "Financial services and transactions.", assignable: true, positiveEvidenceHints: ["banking"] }];
  gap.spec.products = [{ id: "customer-portal", label: "Customer portal", definition: "A customer interaction portal.", assignable: true, positiveEvidenceHints: ["ticket", "customer"] }];
  const extension = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: gap, advisorProvider: supportingAdvisor });
  assert.equal(extension.aggregate, "TAXONOMY_EXTENSION_SUGGESTED");
  assert.equal(extension.axes.domain.status, "TAXONOMY_EXTENSION_SUGGESTED");
  assert.ok(extension.axes.domain.extension.proposedLabel);
  assert.equal(extension.axes.domain.extension.automaticMutationAllowed, false);

  const mixed = taxonomy();
  mixed.spec.products = gap.spec.products;
  const mixedResult = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: mixed, advisorProvider: supportingAdvisor });
  assert.equal(mixedResult.axes.domain.status, "TAXONOMY_MATCHED");
  assert.equal(mixedResult.axes.product.status, "TAXONOMY_EXTENSION_SUGGESTED");
  assert.equal(mixedResult.aggregate, "TAXONOMY_EXTENSION_SUGGESTED");

  const weakSource = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-weak-"));
  fs.writeFileSync(path.join(weakSource, "a.md"), "x\n");
  const insufficient = await analyzeSourceTaxonomy({ source: weakSource, taxonomy: taxonomy(), advisorProvider: supportingAdvisor });
  assert.equal(insufficient.aggregate, "TAXONOMY_EVIDENCE_INSUFFICIENT");
  assert.equal(insufficient.axes.domain.status, "TAXONOMY_EVIDENCE_INSUFFICIENT");
  assert.equal(insufficient.axes.product.status, "TAXONOMY_EVIDENCE_INSUFFICIENT");
});

test("a MULTIPLE axis preserves independent specific matches instead of collapsing Domain and Product", async () => {
  const document = taxonomy();
  document.spec.axisPolicies.productCardinality = "MULTIPLE";
  document.spec.products.push({ id: "replicated-key-value-store", label: "Replicated key value store", aliases: ["ioredis"], definition: "A replicated key value storage product.", parents: ["infrastructure-product"], assignable: true, positiveEvidenceHints: ["ioredis", "key-value", "replication", "ttl"] });
  const result = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: document, advisorProvider: supportingAdvisor });
  assert.equal(result.axes.product.status, "TAXONOMY_MATCHED");
  assert.equal(result.axes.product.cardinality, "MULTIPLE");
  assert.ok(result.axes.product.selectedNodes.length >= 2);
  assert.equal(result.axes.domain.axis, "domain");
  assert.equal(result.axes.product.axis, "product");
});

test("matched classification requires an exact explicit handoff and grants no downstream authority", async () => {
  const result = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: taxonomy(), advisorProvider: supportingAdvisor });
  assert.throws(() => createClassificationHandoff({ classificationSessionId: "classification-1", result, decidedBy: "user", decisionToken: "continue" }), (error) => error.code === "EXPLICIT_HANDOFF_DECISION_REQUIRED");
  const handoff = createClassificationHandoff({ classificationSessionId: "classification-1", result, decidedBy: "user", decisionToken: `CONTINUE_TO_HARNESS:classification-1:${result.analysisResultDigest}` });
  assert.equal(handoff.authority.explicitHumanDecision, true);
  assert.equal(handoff.authority.provesEligibility, false);
  assert.equal(handoff.authority.createsProposal, false);
  assert.equal(handoff.authority.approves, false);
  assert.equal(handoff.authority.publishes, false);
});


test("modelsFile is inert; explicit callback binding and usage contain no credentials", async () => {
  const source = sourceFixture();
  const blocked = await analyzeSourceTaxonomy({source, taxonomy: taxonomy(), modelsFile: path.join(source, "unreadable-models.json")});
  assert.equal(blocked.advisor.code, "MODEL_NOT_CONFIGURED");
  assert.equal(blocked.aggregate, undefined);
  let calls = 0;
  const provider = input => { calls++; return {...supportingAdvisor(input), _provenance: {model: {apiKey: "must-not-persist"}, usage: {totalTokens: 7, apiKey: "must-not-persist"}}}; };
  provider.modelBinding = {providerId: "test-provider", modelId: "test-model", apiKey: "must-not-persist"};
  const result = await analyzeSourceTaxonomy({source, taxonomy: taxonomy(), model: "selected", advisorProvider: provider});
  assert.equal(calls, 1);
  assert.equal(result.advisor.modelBinding.selectedModel, "selected");
  assert.equal(result.advisor.modelBinding.providerBinding.modelId, "test-model");
  assert.equal(result.advisor.usage.totalTokens, 7);
  assert.doesNotMatch(JSON.stringify(result), /must-not-persist/);
  const args = {classificationSessionId: "classification-bound", result, decidedBy: "user", decisionToken: `CONTINUE_TO_HARNESS:classification-bound:${result.analysisResultDigest}`};
  const handoff = createClassificationHandoff(args);
  assert.ok(Object.isFrozen(handoff));
  assert.ok(Object.isFrozen(handoff.authority));
  assert.throws(() => { handoff.authority.approves = true; }, TypeError);
  result.presentation.locale = "changed";
  assert.throws(() => createClassificationHandoff(args), {code: "CLASSIFICATION_REPLAY_INTEGRITY_FAILED"});
});
test("malformed and failed injected providers are never retried", async () => {
  for (const value of [null, undefined, {candidates: [null], unresolvedConcepts: []}]) {
    let calls = 0;
    const result = await analyzeSourceTaxonomy({source: sourceFixture(), taxonomy: taxonomy(), advisorProvider: () => {calls++; return value;}});
    assert.equal(calls, 1);
    assert.equal(result.advisor.code, "ADVISOR_CONTRACT_REJECTED");
    assert.equal(result.aggregate, undefined);
  }
});

test("changed source evidence cannot produce a handoff", async () => {
  const source = sourceFixture();
  const result = await analyzeSourceTaxonomy({source, taxonomy: taxonomy(), advisorProvider: supportingAdvisor});
  fs.appendFileSync(path.join(source, "README.md"), "changed source");
  assert.throws(() => createClassificationHandoff({classificationSessionId: "drift", result, decidedBy: "user", decisionToken: `CONTINUE_TO_HARNESS:drift:${result.analysisResultDigest}`}), {code: "CLASSIFICATION_SOURCE_DRIFT"});
});
