import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "../../src/compat/v3/utils.mjs";
import { validateDocument } from "../../src/compat/v3/schema.mjs";
import { resolveOntologyFoundation } from "../../src/compat/v4/semantics/ontology-grounding.mjs";
import { createProfessionalPack } from "../../src/compat/v4/semantics/professional-packs.mjs";
import { createProjectOntologyProposal, resolveProjectOntologySnapshot, transitionProjectOntologyProposal } from "../../src/compat/v4/semantics/project-ontology.mjs";
import {
  buildSemanticIndex,
  calculateAffectedSubgraph,
  compareSemanticComputations,
  computeSemanticState,
  createInteroperabilityProjectionSet,
  createOntologyReasoningProfile,
  createTerminalSemanticClosure,
  discoverFederatedPacks,
  publishTerminalSemanticClosure,
  sliceTerminalSemanticClosure,
  validateSemanticInteroperabilityDocument,
  verifySemanticRoundTrip
} from "../../src/compat/v4/semantics/semantic-interoperability.mjs";

function semanticSnapshot(concepts = null) {
  const pack = createProfessionalPack({
    kind: "DomainOntologyPack",
    metadata: {
      id: "finance-domain",
      version: "1.0.0",
      name: "Finance domain",
      namespace: "finance",
      root: "DOMAIN_TEAM",
      visibility: "DOMAIN",
      owner: "finance-team",
      provenance: {author: "author", reviewers: ["reviewer"], approvers: ["approver"], publishers: ["publisher"], sourceRefs: ["source://finance"]}
    },
    spec: {
      concepts: concepts ?? [
        {conceptId: "finance:account", label: "Account", metaType: "ENTITY", definition: "A governed account.", evidenceRefs: ["source://account"], relationships: [{targetConceptId: "finance:audit", relationType: "REQUIRES", evidenceRefs: ["source://relation"]}]},
        {conceptId: "finance:audit", label: "Audit", metaType: "CAPABILITY", definition: "A governed audit capability.", evidenceRefs: ["source://audit"]}
      ]
    }
  });
  let proposal = createProjectOntologyProposal({
    project: {id: "project-alpha", workspaceId: "workspace-alpha", tenantId: "tenant-alpha", sourceSnapshotDigest: digest("source-alpha")},
    packs: [pack],
    targetRoot: "DOMAIN_TEAM",
    createdBy: "author",
    now: "2026-09-17T00:00:00.000Z"
  });
  for (const [action, actor] of [["APPLY", "author"], ["REQUEST_REVIEW", "author"], ["APPROVE", "approver"]]) {
    proposal = transitionProjectOntologyProposal({proposal, action, actor, expectedProposalDigest: proposal.proposalDigest, now: "2026-09-17T00:00:00.000Z"});
  }
  return resolveProjectOntologySnapshot({proposal, expectedProposalDigest: proposal.proposalDigest, foundationDigest: resolveOntologyFoundation().foundationDigest, now: "2026-09-17T00:00:00.000Z"});
}

function profile(mode = "OWL_RL", extra = {}) {
  return createOntologyReasoningProfile({
    id: `${mode.toLowerCase().replaceAll("_", "-")}-profile`,
    version: "1.0.0",
    mode,
    limits: {maxNodes: 100, maxEdges: 100, maxIterations: 10, maxWallTimeMs: 1000, maxConcurrentTasks: 2, maxCacheEntries: 100},
    ...extra
  });
}

function indexed(snapshot = semanticSnapshot(), selectedProfile = profile()) {
  const cache = {id: "semantic-cache", digest: digest("cache-v1"), policyDigest: digest("cache-policy-v1"), entryCount: 2};
  const index = buildSemanticIndex({snapshot, cache, assets: [{kind: "HarnessProfile", id: "finance-profile", version: "1.0.0", digest: digest("finance-profile")}]});
  const affected = calculateAffectedSubgraph({index, profile: selectedProfile, changedConceptIds: ["finance:account"], cacheDigest: cache.digest});
  const full = computeSemanticState({index, profile: selectedProfile, mode: "FULL"});
  const incremental = computeSemanticState({index, profile: selectedProfile, mode: "INCREMENTAL", affectedSubgraph: affected});
  return {snapshot, profile: selectedProfile, cache, index, affected, full, incremental};
}

test("v4.8 reasoning profiles are bounded, immutable, and keep external reasoners non-authoritative", () => {
  for (const mode of ["NONE", "RDFS", "OWL_RL", "SWRL_SAFE"]) {
    const value = profile(mode);
    assert.equal(validateDocument(value).status, "VALIDATED");
    assert.equal(validateSemanticInteroperabilityDocument(value), value);
    assert.equal(value.authority.unboundedReasoningAllowed, false);
  }
  const external = profile("EXTERNAL_REASONER", {externalReasoner: {id: "qualified-reasoner", version: "1.2.3", digest: digest("reasoner"), qualificationDigest: digest("qualification"), supportedRules: ["owl:equivalentClass"]}});
  assert.equal(external.authority.externalReasonerEvidenceOnly, true);
  assert.equal(external.authority.externalReasonerMayMutate, false);
  assert.throws(() => profile("OWL_RL", {externalReasoner: {id: "unexpected"}}), (error) => error.code === "EXTERNAL_REASONER_NOT_ALLOWED");
});

test("v4.8 content-addressed indexes and affected-subgraph computation are deterministic and cache-bound", () => {
  const first = indexed();
  const second = indexed(first.snapshot, first.profile);
  assert.equal(first.index.indexDigest, second.index.indexDigest);
  assert.match(first.index.policy.digest, /^sha256:/);
  assert.match(first.index.toolchain.digest, /^sha256:/);
  assert.deepEqual(first.affected.affectedConceptIds, ["finance:account", "finance:audit"]);
  assert.equal(validateDocument(first.index).status, "VALIDATED");
  assert.equal(validateDocument(first.affected).status, "VALIDATED");
  assert.throws(() => calculateAffectedSubgraph({index: first.index, profile: first.profile, changedConceptIds: ["finance:account"], cacheDigest: digest("stale")}), (error) => error.code === "SEMANTIC_CACHE_DIGEST_MISMATCH");
  assert.throws(() => calculateAffectedSubgraph({index: first.index, profile: first.profile, changedConceptIds: ["finance:missing"], cacheDigest: first.cache.digest}), (error) => error.code === "AFFECTED_SUBGRAPH_UNKNOWN_CONCEPT");
});

test("v4.8 incremental and full semantic computation require identical authoritative outcomes", () => {
  const state = indexed();
  const equivalence = compareSemanticComputations({incremental: state.incremental, full: state.full});
  assert.equal(equivalence.status, "PASSED");
  assert.equal(equivalence.equivalentAuthoritativeOutcome, true);
  assert.equal(state.incremental.telemetry.evaluatedConceptCount, state.affected.affectedConceptIds.length);
  assert.equal(state.incremental.telemetry.secretsRedacted, true);
  assert.throws(() => computeSemanticState({index: state.index, profile: state.profile, mode: "FULL", execution: {concurrency: 3}}), (error) => error.code === "REASONING_CONCURRENCY_BUDGET_EXCEEDED");
  assert.throws(() => computeSemanticState({index: state.index, profile: state.profile, mode: "FULL", execution: {elapsedMs: 1001}}), (error) => error.code === "REASONING_WALL_TIME_BUDGET_EXCEEDED");
  const altered = structuredClone(state.full);
  altered.outcomeDigest = digest("different");
  delete altered.computationDigest;
  altered.computationDigest = digest(altered);
  const failed = compareSemanticComputations({incremental: state.incremental, full: altered});
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.authority.failureMayAdvanceLifecycle, false);
});

test("v4.8 computation enforces node, edge, and cache budgets in every reasoning mode", async (t) => {
  const snapshot = semanticSnapshot(Array.from({length: 4}, (_, i) => ({
    conceptId: `finance:item-${i}`, label: `Item ${i}`, metaType: "ENTITY", definition: `Governed item ${i}.`,
    evidenceRefs: [`source://item-${i}`],
    relationships: i < 2 ? [{targetConceptId: `finance:item-${i + 1}`, relationType: "REQUIRES", evidenceRefs: ["source://relation"]}] : []
  })));
  const cache = {id: "bounded-cache", digest: digest("bounded-cache"), policyDigest: digest("cache-policy"), entryCount: 4};
  const index = buildSemanticIndex({snapshot, cache});
  const limits = {maxNodes: 4, maxEdges: 2, maxCacheEntries: 4, maxIterations: 4, maxConcurrentTasks: 2, maxWallTimeMs: 1000};
  const externalReasoner = {id: "qualified-reasoner", version: "1.2.3", digest: digest("reasoner"), qualificationDigest: digest("qualification"), supportedRules: ["owl:equivalentClass"]};
  for (const mode of ["NONE", "RDFS", "OWL_RL", "SWRL_SAFE", "EXTERNAL_REASONER"]) {
    await t.test(mode, () => {
      const selected = profile(mode, {limits, ...(mode === "EXTERNAL_REASONER" ? {externalReasoner} : {})});
      const reasonerInput = mode === "EXTERNAL_REASONER" ? {externalReasonerResult: {reasoner: externalReasoner, inputDigest: index.indexDigest, outputDigest: digest("output"), proofDigest: digest("proof"), status: "COMPLETED"}} : {};
      const affected = calculateAffectedSubgraph({index, profile: selected, changedConceptIds: ["finance:item-0"], cacheDigest: cache.digest});
      const args = {index, profile: selected, ...reasonerInput, execution: {concurrency: 2, elapsedMs: 1000}};
      const before = JSON.stringify({index, profile: selected, affected});
      const full = computeSemanticState({...args, mode: "FULL"});
      const incremental = computeSemanticState({...args, mode: "INCREMENTAL", affectedSubgraph: affected});
      assert.equal(compareSemanticComputations({incremental, full}).status, "PASSED");
      assert.equal(full.status, "COMPLETED");
      assert.equal(JSON.stringify({index, profile: selected, affected}), before);
      for (const [field, code] of [["maxNodes", "REASONING_BUDGET_EXCEEDED"], ["maxEdges", "REASONING_BUDGET_EXCEEDED"], ["maxCacheEntries", "REASONING_CACHE_BUDGET_EXCEEDED"]]) {
        const bounded = profile(mode, {limits: {...limits, [field]: limits[field] - 1}, ...(mode === "EXTERNAL_REASONER" ? {externalReasoner} : {})});
        assert.throws(() => calculateAffectedSubgraph({index, profile: bounded, changedConceptIds: ["finance:item-0"], cacheDigest: cache.digest}), (error) => error.code === code);
        assert.throws(() => computeSemanticState({...args, profile: bounded, mode: "FULL"}), (error) => error.code === code);
        // A self-consistent digest on supplied subgraph metadata cannot waive resource limits.
        const supplied = {...affected, profileDigest: bounded.profileDigest};
        delete supplied.affectedSubgraphDigest;
        supplied.affectedSubgraphDigest = digest(supplied);
        assert.throws(() => computeSemanticState({...args, profile: bounded, mode: "INCREMENTAL", affectedSubgraph: supplied}), (error) => error.code === code);
        assert.equal(JSON.stringify({index, profile: selected, affected}), before);
      }
    });
  }
});

test("v4.8 qualified external reasoner results bind exact identity, version, qualification, and proof", () => {
  const selectedProfile = profile("EXTERNAL_REASONER", {externalReasoner: {id: "qualified-reasoner", version: "1.2.3", digest: digest("reasoner"), qualificationDigest: digest("qualification"), supportedRules: ["owl:equivalentClass"]}});
  const snapshot = semanticSnapshot();
  const index = buildSemanticIndex({snapshot});
  const result = {reasoner: selectedProfile.spec.externalReasoner, inputDigest: index.indexDigest, outputDigest: digest("reasoner-output"), proofDigest: digest("proof"), status: "COMPLETED"};
  const computation = computeSemanticState({index, profile: selectedProfile, mode: "FULL", externalReasonerResult: result});
  assert.equal(computation.externalReasonerEvidence.reasoner.id, "qualified-reasoner");
  const drifted = structuredClone(result);
  drifted.reasoner.version = "1.2.4";
  assert.throws(() => computeSemanticState({index, profile: selectedProfile, mode: "FULL", externalReasonerResult: drifted}), (error) => error.code === "EXTERNAL_REASONER_BINDING_MISMATCH");
  assert.throws(() => computeSemanticState({index, profile: selectedProfile, mode: "FULL", externalReasonerResult: {...result, inputDigest: digest("stale-index")}}), (error) => error.code === "EXTERNAL_REASONER_INPUT_MISMATCH");
});

test("v4.8 federated Pack discovery remains read-only and preserves Catalog trust context", () => {
  const pack = {id: "finance-domain", version: "1.0.0", digest: digest("finance-pack"), kind: "DomainOntologyPack", visibility: "DOMAIN", provenance: {owner: "finance-team"}};
  const discovery = discoverFederatedPacks({roots: [
    {id: "domain-catalog", catalogDigest: digest("domain-catalog"), trustContext: "domain-reviewed", visibility: "DOMAIN", permission: "GRANTED", packs: [pack]},
    {id: "private-catalog", catalogDigest: digest("private-catalog"), trustContext: "private", visibility: "PRIVATE", permission: "DENIED", packs: [pack]}
  ], query: {kinds: ["DomainOntologyPack"], terms: ["finance"]}});
  assert.equal(validateDocument(discovery).status, "VALIDATED");
  assert.equal(discovery.discoveredPacks.length, 1);
  assert.equal(discovery.discoveredPacks[0].sourceCatalog, "domain-catalog");
  assert.equal(discovery.roots.find((root) => root.id === "private-catalog").status, "PERMISSION_DENIED");
  assert.equal(discovery.authority.sharedMutation, false);
  assert.throws(() => discoverFederatedPacks({roots: [
    {id: "one", catalogDigest: digest("one"), trustContext: "one", packs: [pack]},
    {id: "two", catalogDigest: digest("two"), trustContext: "two", packs: [{...pack, digest: digest("different")}]}
  ]}), (error) => error.code === "FEDERATED_PACK_CONFLICT");
});

test("v4.8 semantic projections preserve mappings, multilingual terms, provenance, and explicit non-applicability", () => {
  const state = indexed();
  const projections = createInteroperabilityProjectionSet({
    snapshot: state.snapshot,
    profile: state.profile,
    index: state.index,
    externalMappings: [{externalId: "https://example.org/Account", canonicalConceptId: "finance:account", relation: "EXACT_MATCH", provenance: {catalog: "external"}, evidenceDigest: digest("mapping-evidence")}],
    multilingualTerms: [{conceptId: "finance:account", language: "zh", term: "账户", provenance: {source: "term-list"}}],
    unsupportedSemantics: ["OWL:unbounded-cardinality"]
  });
  assert.equal(validateDocument(projections).status, "VALIDATED");
  assert.equal(projections.externalMappings[0].active, false);
  assert.equal(projections.projections.find((item) => item.format === "OWL").status, "NON_APPLICABLE");
  const report = verifySemanticRoundTrip({snapshot: state.snapshot, projectionSet: projections, index: state.index, incremental: state.incremental, full: state.full});
  assert.equal(validateDocument(report).status, "VALIDATED");
  assert.equal(report.status, "FAILED");
  assert.deepEqual(report.unsupportedFormats, [{format: "OWL", reason: "OWL:unbounded-cardinality"}]);
});

test("v4.8 terminal closure is immutable, read-only, complete, and separately published", async () => {
  const state = indexed();
  const projections = createInteroperabilityProjectionSet({snapshot: state.snapshot, profile: state.profile, index: state.index});
  const report = verifySemanticRoundTrip({snapshot: state.snapshot, projectionSet: projections, index: state.index, incremental: state.incremental, full: state.full});
  const harnessAssets = [
    {kind: "HarnessProfile", id: "finance-profile", version: "4.8.0", digest: digest("profile")},
    {kind: "HarnessComponent", id: "finance-component", version: "4.8.0", digest: digest("component")},
    {kind: "HarnessBundle", id: "finance-bundle", version: "4.8.0", digest: digest("bundle")}
  ];
  const closure = createTerminalSemanticClosure({
    snapshot: state.snapshot,
    profile: state.profile,
    index: state.index,
    projectionSet: projections,
    roundTripReport: report,
    harnessAssets,
    dependencyLocks: [{id: "semantic-lock", version: "4.8.0", digest: digest("lock")}],
    evaluations: [{kind: "Evaluation", id: "semantic-evaluation", version: "4.8.0", digest: digest("evaluation")}],
    rollbackLinks: [{id: "v4-7-rollback", version: "4.7.0", digest: digest("rollback")}],
    provenance: {producer: "evopilot-harness", sourceRefs: ["source://v4.8-fixture"], generatedByDigest: digest("generator")}
  });
  assert.equal(validateDocument(closure).status, "VALIDATED");
  assert.equal(closure.authority.consumerReadOnly, true);
  assert.equal(closure.authority.grantsReleaseAuthority, false);
  assert.throws(() => publishTerminalSemanticClosure({closure, publication: {decision: "PENDING"}}), (error) => error.code === "TERMINAL_CLOSURE_PUBLICATION_AUTHORIZATION_REQUIRED");
  const published = publishTerminalSemanticClosure({closure, publication: {decision: "AUTHORIZED", actor: "publisher", authorizationDigest: digest("publication"), version: "4.8.0", at: "2026-09-17T00:00:00.000Z"}});
  assert.equal(published.status, "PUBLISHED");
  assert.equal(validateDocument(published).status, "VALIDATED");
  const slice = sliceTerminalSemanticClosure({closure: published, conceptIds: ["finance:account"], expectedClosureDigest: published.closureDigest});
  assert.equal(validateDocument(slice).status, "VALIDATED");
  assert.equal(slice.authority.liveHarnessDependency, false);
  assert.throws(() => sliceTerminalSemanticClosure({closure: published, conceptIds: [], expectedClosureDigest: digest("stale")}), (error) => error.code === "TERMINAL_CLOSURE_STALE");
});
