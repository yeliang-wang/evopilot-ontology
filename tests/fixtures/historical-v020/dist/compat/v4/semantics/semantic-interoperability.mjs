import { digest, persistedJson } from "../../v3/utils.mjs";

export const ONTOLOGY_REASONING_PROFILE_SCHEMA = "evopilot-harness-ontology-reasoning-profile/v1";
export const SEMANTIC_INDEX_SCHEMA = "evopilot-harness-semantic-index/v1";
export const AFFECTED_SUBGRAPH_SCHEMA = "evopilot-harness-affected-subgraph/v1";
export const SEMANTIC_COMPUTATION_SCHEMA = "evopilot-harness-semantic-computation/v1";
export const FEDERATED_PACK_DISCOVERY_SCHEMA = "evopilot-harness-federated-pack-discovery/v1";
export const INTEROPERABILITY_PROJECTION_SET_SCHEMA = "evopilot-harness-semantic-interoperability-projection-set/v1";
export const SEMANTIC_ROUND_TRIP_REPORT_SCHEMA = "evopilot-harness-semantic-round-trip-report/v1";
export const TERMINAL_SEMANTIC_CLOSURE_SCHEMA = "evopilot-harness-terminal-semantic-closure/v1";
export const TERMINAL_SEMANTIC_SLICE_SCHEMA = "evopilot-harness-terminal-semantic-slice/v1";
export const REASONING_MODES = Object.freeze(["NONE", "RDFS", "OWL_RL", "SWRL_SAFE", "EXTERNAL_REASONER"]);

const DEFAULT_LIMITS = Object.freeze({
  maxNodes: 10_000,
  maxEdges: 50_000,
  maxIterations: 32,
  maxWallTimeMs: 30_000,
  maxConcurrentTasks: 4,
  maxCacheEntries: 20_000
});

export function createOntologyReasoningProfile(input = {}) {
  const mode = requiredEnum(input.mode ?? "NONE", REASONING_MODES, "mode", "REASONING_MODE_INVALID");
  const metadata = {
    id: requiredId(input.metadata?.id ?? input.id, "metadata.id"),
    version: requiredSemver(input.metadata?.version ?? input.version, "metadata.version")
  };
  const limits = normalizeLimits(input.limits);
  const externalReasoner = mode === "EXTERNAL_REASONER" ? normalizeExternalReasoner(input.externalReasoner) : null;
  if (mode !== "EXTERNAL_REASONER" && input.externalReasoner != null) {
    throw semanticError("EXTERNAL_REASONER_NOT_ALLOWED", "externalReasoner is allowed only for EXTERNAL_REASONER mode.");
  }
  const core = {
    schema: ONTOLOGY_REASONING_PROFILE_SCHEMA,
    apiVersion: "semantics.evopilot.io/v1",
    kind: "OntologyReasoningProfile",
    metadata,
    spec: {
      mode,
      supportedRules: unique(input.supportedRules ?? defaultRules(mode)),
      limits,
      externalReasoner,
      failurePolicy: "FAIL_CLOSED_WITH_PROOF_PATH",
      fullRecomputeEquivalenceRequired: true,
      cacheDigestRequired: true
    },
    authority: {
      engineOwnedDecision: true,
      externalReasonerEvidenceOnly: mode === "EXTERNAL_REASONER",
      externalReasonerMayApprove: false,
      externalReasonerMayPublish: false,
      externalReasonerMayMutate: false,
      unboundedReasoningAllowed: false
    }
  };
  core.profileDigest = digest(core);
  return core;
}

export function validateOntologyReasoningProfile(value) {
  const result = validateImmutable(value, ONTOLOGY_REASONING_PROFILE_SCHEMA, "profileDigest", "ONTOLOGY_REASONING_PROFILE_INVALID");
  requiredEnum(result.spec?.mode, REASONING_MODES, "spec.mode", "REASONING_MODE_INVALID");
  normalizeLimits(result.spec?.limits);
  if (result.spec.mode === "EXTERNAL_REASONER") normalizeExternalReasoner(result.spec.externalReasoner);
  if (result.spec.mode !== "EXTERNAL_REASONER" && result.spec.externalReasoner != null) {
    throw semanticError("EXTERNAL_REASONER_NOT_ALLOWED", "Only EXTERNAL_REASONER mode may bind an external reasoner.");
  }
  if (result.authority?.unboundedReasoningAllowed !== false || result.authority?.externalReasonerMayMutate !== false) {
    throw semanticError("REASONING_AUTHORITY_INVALID", "Reasoning profiles must remain bounded and non-mutating.");
  }
  return value;
}

export function buildSemanticIndex({snapshot, assets = [], algorithm = null, policy = null, toolchain = null, cache = null} = {}) {
  validateSnapshot(snapshot);
  const algorithmBinding = normalizeBinding(algorithm ?? {id: "semantic-index", version: "1.0.0", digest: digest("semantic-index/v1")}, "algorithm");
  const policyBinding = normalizeBinding(policy ?? {id: "semantic-index-policy", version: "1.0.0", digest: digest("semantic-index-policy/v1")}, "policy");
  const toolchainBinding = normalizeBinding(toolchain ?? {id: "evopilot-harness", version: "4.8.0", digest: digest("evopilot-harness-semantic-index-toolchain/v4.8.0")}, "toolchain");
  const cacheBinding = cache == null ? null : normalizeCacheBinding(cache);
  const nodes = snapshot.concepts.map((concept) => ({
    conceptId: requiredText(concept.conceptId, "concept.conceptId"),
    label: requiredText(concept.label, "concept.label"),
    metaType: requiredText(concept.metaType, "concept.metaType"),
    definitionDigest: digest(String(concept.definition ?? "")),
    evidenceRefs: unique(concept.evidenceRefs ?? [])
  })).sort((a, b) => stableCompare(a.conceptId, b.conceptId));
  const nodeIds = new Set(nodes.map((node) => node.conceptId));
  const edges = snapshot.concepts.flatMap((concept) => (concept.relationships ?? []).map((relationship, index) => normalizeEdge(concept.conceptId, relationship, index, nodeIds))).sort(compareEdge);
  const assetBindings = assets.map((asset, index) => normalizeSemanticAssetBinding(asset, `assets[${index}]`)).sort(compareBinding);
  const core = {
    schema: SEMANTIC_INDEX_SCHEMA,
    apiVersion: "semantics.evopilot.io/v1",
    kind: "SemanticIndex",
    snapshotDigest: snapshot.snapshotDigest,
    algorithm: algorithmBinding,
    policy: policyBinding,
    toolchain: toolchainBinding,
    cache: cacheBinding,
    nodes,
    edges,
    assets: assetBindings,
    statistics: {nodeCount: nodes.length, edgeCount: edges.length, assetCount: assetBindings.length},
    authority: {contentAddressed: true, readOnly: true, staleResultsAllowed: false, mixedContextAllowed: false, mayMutateSource: false}
  };
  core.indexDigest = digest(core);
  return core;
}

export function validateSemanticIndex(value) {
  const result = validateImmutable(value, SEMANTIC_INDEX_SCHEMA, "indexDigest", "SEMANTIC_INDEX_INVALID");
  if (result.statistics?.nodeCount !== result.nodes?.length || result.statistics?.edgeCount !== result.edges?.length) {
    throw semanticError("SEMANTIC_INDEX_STATISTICS_INVALID", "Semantic Index statistics do not match indexed content.");
  }
  if (result.authority?.readOnly !== true || result.authority?.staleResultsAllowed !== false || result.authority?.mixedContextAllowed !== false) {
    throw semanticError("SEMANTIC_INDEX_AUTHORITY_INVALID", "Semantic Index must be read-only and reject stale or mixed contexts.");
  }
  return value;
}

export function calculateAffectedSubgraph({index, changedConceptIds = [], profile, cacheDigest = null} = {}) {
  validateSemanticIndex(index);
  validateOntologyReasoningProfile(profile);
  const changed = unique(changedConceptIds);
  const nodeIds = new Set(index.nodes.map((node) => node.conceptId));
  const unknown = changed.filter((id) => !nodeIds.has(id));
  if (unknown.length) throw semanticError("AFFECTED_SUBGRAPH_UNKNOWN_CONCEPT", `Unknown changed concepts: ${unknown.join(", ")}.`);
  validateIndexResourceBudgets(index, profile);
  if (index.cache && cacheDigest !== index.cache.digest) {
    throw semanticError("SEMANTIC_CACHE_DIGEST_MISMATCH", "The supplied cache digest does not bind the Semantic Index cache.");
  }
  const affected = new Set(changed);
  const proofPathByConcept = new Map(changed.map((id) => [id, {conceptId: id, path: [id], reason: "CHANGED_INPUT"}]));
  let frontier = [...changed];
  let iterations = 0;
  while (frontier.length > 0) {
    if (iterations >= profile.spec.limits.maxIterations) throw semanticError("REASONING_ITERATION_BUDGET_EXCEEDED", "Affected-subgraph traversal exceeded the selected reasoning profile budget.");
    const next = [];
    for (const current of frontier.sort(stableCompare)) {
      for (const edge of index.edges) {
        if (edge.from !== current && edge.to !== current) continue;
        const candidate = edge.from === current ? edge.to : edge.from;
        if (affected.has(candidate)) continue;
        affected.add(candidate);
        next.push(candidate);
        const parent = proofPathByConcept.get(current)?.path ?? [current];
        proofPathByConcept.set(candidate, {conceptId: candidate, path: [...parent, candidate], reason: edge.relationType});
      }
    }
    frontier = unique(next);
    iterations += 1;
  }
  const core = {
    schema: AFFECTED_SUBGRAPH_SCHEMA,
    indexDigest: index.indexDigest,
    profileDigest: profile.profileDigest,
    cacheDigest: index.cache?.digest ?? null,
    changedConceptIds: changed,
    affectedConceptIds: [...affected].sort(stableCompare),
    unaffectedConceptCount: index.nodes.length - affected.size,
    proofPaths: [...proofPathByConcept.values()].sort((a, b) => stableCompare(a.conceptId, b.conceptId)),
    iterations,
    authority: {deterministic: true, advisoryOnly: false, mayAdvanceLifecycle: false, fullRecomputeEquivalenceRequired: true}
  };
  core.affectedSubgraphDigest = digest(core);
  return core;
}

export function computeSemanticState({index, profile, mode = "FULL", affectedSubgraph = null, externalReasonerResult = null, execution = {}} = {}) {
  validateSemanticIndex(index);
  validateOntologyReasoningProfile(profile);
  validateIndexResourceBudgets(index, profile);
  const computationMode = requiredEnum(mode, ["FULL", "INCREMENTAL"], "mode", "SEMANTIC_COMPUTATION_MODE_INVALID");
  if (computationMode === "INCREMENTAL") validateAffectedSubgraph(affectedSubgraph, index.indexDigest, profile.profileDigest);
  if (profile.spec.mode === "EXTERNAL_REASONER") validateExternalReasonerResult(externalReasonerResult, profile, index.indexDigest);
  if (profile.spec.mode !== "EXTERNAL_REASONER" && externalReasonerResult != null) {
    throw semanticError("EXTERNAL_REASONER_RESULT_NOT_ALLOWED", "External reasoner evidence is allowed only for EXTERNAL_REASONER mode.");
  }
  const concurrency = positiveInteger(execution.concurrency ?? 1, "execution.concurrency");
  if (concurrency > profile.spec.limits.maxConcurrentTasks) {
    throw semanticError("REASONING_CONCURRENCY_BUDGET_EXCEEDED", "Requested semantic concurrency exceeds the selected reasoning profile budget.");
  }
  const elapsedMs = nonNegativeInteger(execution.elapsedMs ?? 0, "execution.elapsedMs");
  if (elapsedMs > profile.spec.limits.maxWallTimeMs) {
    throw semanticError("REASONING_WALL_TIME_BUDGET_EXCEEDED", "Observed semantic wall time exceeds the selected reasoning profile budget.");
  }
  const evaluatedConceptIds = computationMode === "INCREMENTAL" ? affectedSubgraph.affectedConceptIds : index.nodes.map((node) => node.conceptId);
  const semanticState = {
    snapshotDigest: index.snapshotDigest,
    nodes: index.nodes.map((node) => ({conceptId: node.conceptId, metaType: node.metaType, definitionDigest: node.definitionDigest})),
    edges: index.edges.map((edge) => ({from: edge.from, to: edge.to, relationType: edge.relationType})),
    assets: index.assets,
    reasoningMode: profile.spec.mode,
    supportedRules: profile.spec.supportedRules
  };
  const core = {
    schema: SEMANTIC_COMPUTATION_SCHEMA,
    computationMode,
    indexDigest: index.indexDigest,
    profileDigest: profile.profileDigest,
    affectedSubgraphDigest: computationMode === "INCREMENTAL" ? affectedSubgraph.affectedSubgraphDigest : null,
    externalReasonerEvidence: externalReasonerResult == null ? null : normalizeExternalReasonerResult(externalReasonerResult),
    outcomeDigest: digest(semanticState),
    proofDigest: digest({semanticState, externalReasonerEvidence: externalReasonerResult == null ? null : normalizeExternalReasonerResult(externalReasonerResult)}),
    telemetry: {
      nodeCount: index.nodes.length,
      edgeCount: index.edges.length,
      evaluatedConceptCount: evaluatedConceptIds.length,
      evaluatedConceptIds,
      concurrency,
      elapsedMs,
      cacheEntryCount: index.cache?.entryCount ?? 0,
      cacheDigest: index.cache?.digest ?? null,
      budgets: persistedJson(profile.spec.limits),
      secretsRedacted: true
    },
    status: "COMPLETED",
    authority: {engineValidated: true, fullRecomputeRequiredForAcceptance: computationMode === "INCREMENTAL", mayApprove: false, mayPublish: false, mayMutate: false}
  };
  core.computationDigest = digest(core);
  return core;
}

export function compareSemanticComputations({incremental, full} = {}) {
  validateComputation(incremental);
  validateComputation(full);
  if (incremental.computationMode !== "INCREMENTAL" || full.computationMode !== "FULL") {
    throw semanticError("SEMANTIC_EQUIVALENCE_INPUT_INVALID", "Equivalence comparison requires one INCREMENTAL and one FULL computation.");
  }
  const sameBindings = incremental.indexDigest === full.indexDigest && incremental.profileDigest === full.profileDigest;
  const equivalent = sameBindings && incremental.outcomeDigest === full.outcomeDigest;
  const result = {
    schema: "evopilot-harness-semantic-computation-equivalence/v1",
    status: equivalent ? "PASSED" : "FAILED",
    incrementalComputationDigest: incremental.computationDigest,
    fullComputationDigest: full.computationDigest,
    sameBindings,
    equivalentAuthoritativeOutcome: equivalent,
    authority: {requiredForIncrementalAcceptance: true, failureMayAdvanceLifecycle: false}
  };
  result.equivalenceDigest = digest(result);
  return result;
}

export function discoverFederatedPacks({roots = [], query = {}} = {}) {
  if (!Array.isArray(roots) || roots.length === 0) throw semanticError("FEDERATED_ROOTS_REQUIRED", "At least one immutable Catalog root is required.");
  const normalizedQuery = {kinds: unique(query.kinds ?? []), terms: unique(query.terms ?? []).map((item) => item.toLowerCase())};
  const seenRoots = new Set();
  const rootResults = [];
  const discovered = [];
  for (const root of roots) {
    const normalized = normalizeFederatedRoot(root);
    if (seenRoots.has(normalized.id)) throw semanticError("FEDERATED_ROOT_DUPLICATE", `Duplicate Catalog root ${normalized.id}.`);
    seenRoots.add(normalized.id);
    if (!normalized.available || normalized.permission !== "GRANTED") {
      rootResults.push({...normalized, packs: [], status: normalized.available ? "PERMISSION_DENIED" : "UNAVAILABLE"});
      continue;
    }
    const packs = normalized.packs.filter((pack) => matchesFederatedQuery(pack, normalizedQuery));
    rootResults.push({...normalized, packs, status: "AVAILABLE"});
    for (const pack of packs) discovered.push({...pack, sourceCatalog: normalized.id, sourceCatalogDigest: normalized.catalogDigest, sourceRoot: normalized.id, trustContext: normalized.trustContext, rootVisibility: normalized.visibility, permission: normalized.permission});
  }
  const identityDigests = new Map();
  for (const pack of discovered) {
    const key = `${pack.id}@${pack.version}`;
    const prior = identityDigests.get(key);
    if (prior && prior !== pack.digest) throw semanticError("FEDERATED_PACK_CONFLICT", `Federated Pack identity ${key} resolves to different digests.`);
    identityDigests.set(key, pack.digest);
  }
  const core = {
    schema: FEDERATED_PACK_DISCOVERY_SCHEMA,
    apiVersion: "semantics.evopilot.io/v1",
    kind: "FederatedPackDiscovery",
    query: normalizedQuery,
    roots: rootResults.sort((a, b) => stableCompare(a.id, b.id)),
    discoveredPacks: discovered.sort(compareFederatedPack),
    authority: {readOnly: true, rootsRemainIndependent: true, sharedMutation: false, automaticTrust: false, automaticInstallation: false, automaticPublication: false}
  };
  core.discoveryDigest = digest(core);
  return core;
}

export function createInteroperabilityProjectionSet({snapshot, profile, index, externalMappings = [], multilingualTerms = [], unsupportedSemantics = []} = {}) {
  validateSnapshot(snapshot);
  validateOntologyReasoningProfile(profile);
  validateSemanticIndex(index);
  if (index.snapshotDigest !== snapshot.snapshotDigest) throw semanticError("SEMANTIC_INDEX_STALE", "Semantic Index binds a different Project Ontology snapshot.");
  const conceptIds = new Set(snapshot.concepts.map((concept) => concept.conceptId));
  const mappings = externalMappings.map((mapping, indexValue) => normalizeExternalMapping(mapping, indexValue, conceptIds)).sort((a, b) => stableCompare(a.externalId, b.externalId));
  const terms = multilingualTerms.map((term, indexValue) => normalizeMultilingualTerm(term, indexValue, conceptIds)).sort(compareTerm);
  const canonicalSemanticDigest = digest(semanticKernel(snapshot, mappings, terms));
  const unsupported = unique(unsupportedSemantics);
  const contents = {
    JSON_LD: jsonLdInteroperability(snapshot, mappings, terms),
    PROV_O: provProjection(snapshot, mappings),
    RDF_TURTLE: rdfProjection(snapshot, mappings, terms),
    OWL: owlInteroperability(snapshot, mappings),
    SHACL: shaclInteroperability(snapshot)
  };
  const projections = Object.entries(contents).map(([format, content]) => {
    const blocked = unsupported.filter((item) => item.startsWith(`${format}:`));
    if (blocked.length) return {format, status: "NON_APPLICABLE", mediaType: mediaType(format), snapshotDigest: snapshot.snapshotDigest, canonicalSemanticDigest, reason: blocked.join("; "), content: null, contentDigest: null};
    return {format, status: "APPLICABLE", mediaType: mediaType(format), snapshotDigest: snapshot.snapshotDigest, canonicalSemanticDigest, reason: null, content, contentDigest: digest(content)};
  });
  const core = {
    schema: INTEROPERABILITY_PROJECTION_SET_SCHEMA,
    snapshotDigest: snapshot.snapshotDigest,
    profileDigest: profile.profileDigest,
    indexDigest: index.indexDigest,
    canonicalSemanticDigest,
    externalMappings: mappings,
    multilingualTerms: terms,
    projections,
    authority: {externalVocabularyInactive: true, mappingsCannotOverrideUserPacks: true, deterministic: true, unsupportedSemanticsFailClosed: true}
  };
  core.projectionSetDigest = digest(core);
  return core;
}

export function verifySemanticRoundTrip({snapshot, projectionSet, index, incremental, full} = {}) {
  validateSnapshot(snapshot);
  validateSemanticIndex(index);
  validateInteroperabilityProjectionSet(projectionSet);
  const computationEquivalence = compareSemanticComputations({incremental, full});
  const bindingChecks = {
    projectionSnapshot: projectionSet.snapshotDigest === snapshot.snapshotDigest,
    indexSnapshot: index.snapshotDigest === snapshot.snapshotDigest,
    projectionIndex: projectionSet.indexDigest === index.indexDigest,
    profileConsistent: projectionSet.profileDigest === incremental.profileDigest && incremental.profileDigest === full.profileDigest
  };
  const allApplicableDigestsPresent = projectionSet.projections.every((item) => item.status === "NON_APPLICABLE" || (item.contentDigest === digest(item.content) && /^sha256:[a-f0-9]{64}$/.test(item.contentDigest)));
  const unsupportedFormats = projectionSet.projections.filter((item) => item.status === "NON_APPLICABLE").map((item) => ({format: item.format, reason: item.reason}));
  const allFormatsApplicable = unsupportedFormats.length === 0;
  const canonicalSemanticDigest = digest(semanticKernel(snapshot, projectionSet.externalMappings, projectionSet.multilingualTerms));
  const canonicalSemanticsPreserved = projectionSet.canonicalSemanticDigest === canonicalSemanticDigest && projectionSet.projections.every((item) => item.canonicalSemanticDigest === canonicalSemanticDigest);
  const status = Object.values(bindingChecks).every(Boolean) && allApplicableDigestsPresent && allFormatsApplicable && canonicalSemanticsPreserved && computationEquivalence.status === "PASSED" ? "PASSED" : "FAILED";
  const core = {
    schema: SEMANTIC_ROUND_TRIP_REPORT_SCHEMA,
    status,
    snapshotDigest: snapshot.snapshotDigest,
    indexDigest: index.indexDigest,
    projectionSetDigest: projectionSet.projectionSetDigest,
    incrementalComputationDigest: incremental.computationDigest,
    fullComputationDigest: full.computationDigest,
    bindingChecks,
    allApplicableDigestsPresent,
    allFormatsApplicable,
    canonicalSemanticsPreserved,
    unsupportedFormats,
    computationEquivalence,
    authority: {requiredForTerminalClosure: true, failureMayAdvanceLifecycle: false}
  };
  core.reportDigest = digest(core);
  return core;
}

export function createTerminalSemanticClosure({snapshot, profile, index, projectionSet, roundTripReport, harnessAssets = [], dependencyLocks = [], evaluations = [], rollbackLinks = [], provenance = {}} = {}) {
  validateSnapshot(snapshot);
  validateOntologyReasoningProfile(profile);
  validateSemanticIndex(index);
  validateInteroperabilityProjectionSet(projectionSet);
  validateRoundTripReport(roundTripReport);
  if (roundTripReport.status !== "PASSED") throw semanticError("SEMANTIC_ROUND_TRIP_REQUIRED", "Terminal semantic closure requires a passing round-trip report.");
  if (index.snapshotDigest !== snapshot.snapshotDigest || projectionSet.snapshotDigest !== snapshot.snapshotDigest || projectionSet.indexDigest !== index.indexDigest || projectionSet.profileDigest !== profile.profileDigest || roundTripReport.snapshotDigest !== snapshot.snapshotDigest || roundTripReport.indexDigest !== index.indexDigest || roundTripReport.projectionSetDigest !== projectionSet.projectionSetDigest) {
    throw semanticError("TERMINAL_CLOSURE_BINDING_MISMATCH", "Terminal semantic closure inputs do not share exact immutable bindings.");
  }
  const assets = harnessAssets.map((asset, indexValue) => normalizeSemanticAssetBinding(asset, `harnessAssets[${indexValue}]`)).sort(compareBinding);
  for (const kind of ["HarnessProfile", "HarnessComponent", "HarnessBundle"]) {
    if (!assets.some((asset) => asset.kind === kind)) throw semanticError("TERMINAL_CLOSURE_ASSET_REQUIRED", `Terminal semantic closure requires at least one ${kind}.`);
  }
  const locks = dependencyLocks.map((item, indexValue) => normalizeBinding(item, `dependencyLocks[${indexValue}]`)).sort(compareBinding);
  const evaluationBindings = evaluations.map((item, indexValue) => normalizeSemanticAssetBinding({...item, kind: item.kind ?? "Evaluation"}, `evaluations[${indexValue}]`)).sort(compareBinding);
  const rollbackBindings = rollbackLinks.map((item, indexValue) => normalizeBinding(item, `rollbackLinks[${indexValue}]`)).sort(compareBinding);
  if (locks.length === 0 || evaluationBindings.length === 0 || rollbackBindings.length === 0) {
    throw semanticError("TERMINAL_CLOSURE_MANIFEST_INCOMPLETE", "Terminal semantic closure requires dependency locks, evaluations, and rollback links.");
  }
  const core = {
    schema: TERMINAL_SEMANTIC_CLOSURE_SCHEMA,
    apiVersion: "semantics.evopilot.io/v1",
    kind: "TerminalSemanticClosure",
    version: "4.8.0",
    status: "CANDIDATE",
    snapshot: {digest: snapshot.snapshotDigest, project: snapshot.project},
    reasoningProfile: {id: profile.metadata.id, version: profile.metadata.version, digest: profile.profileDigest, mode: profile.spec.mode},
    semanticIndex: {digest: index.indexDigest, statistics: index.statistics},
    graphIndex: {digest: index.indexDigest, statistics: index.statistics},
    projectionSet: {digest: projectionSet.projectionSetDigest, formats: projectionSet.projections.map((item) => ({format: item.format, status: item.status, contentDigest: item.contentDigest}))},
    roundTripReport: {digest: roundTripReport.reportDigest, status: roundTripReport.status},
    harnessAssets: assets,
    dependencyLocks: locks,
    evaluations: evaluationBindings,
    rollbackLinks: rollbackBindings,
    provenance: normalizeProvenance(provenance),
    publication: null,
    authority: {immutable: true, consumerReadOnly: true, liveMutableHarnessDependency: false, grantsConsumerMutation: false, grantsConsumerApproval: false, grantsConsumerPublication: false, grantsReleaseAuthority: false}
  };
  core.closureDigest = digest(core);
  return core;
}

export function publishTerminalSemanticClosure({closure, publication} = {}) {
  validateTerminalSemanticClosure(closure);
  if (closure.status !== "CANDIDATE" || closure.publication !== null) throw semanticError("TERMINAL_CLOSURE_ALREADY_PUBLISHED", "Only an unpublished terminal semantic closure Candidate can be published.");
  if (publication?.decision !== "AUTHORIZED") throw semanticError("TERMINAL_CLOSURE_PUBLICATION_AUTHORIZATION_REQUIRED", "Terminal semantic closure publication requires a separate explicit AUTHORIZED decision.");
  if (publication.version !== closure.version) throw semanticError("TERMINAL_CLOSURE_PUBLICATION_VERSION_MISMATCH", "Publication version must exactly match the terminal semantic closure version.");
  const next = persistedJson(closure);
  next.status = "PUBLISHED";
  next.publication = {
    decision: "AUTHORIZED",
    actor: requiredText(publication.actor, "publication.actor"),
    authorizationDigest: requiredDigest(publication.authorizationDigest, "publication.authorizationDigest"),
    version: requiredSemver(publication.version, "publication.version"),
    at: requiredText(publication.at, "publication.at")
  };
  delete next.closureDigest;
  next.closureDigest = digest(next);
  return next;
}

export function sliceTerminalSemanticClosure({closure, conceptIds = [], expectedClosureDigest} = {}) {
  validateTerminalSemanticClosure(closure);
  if (closure.status !== "PUBLISHED") throw semanticError("TERMINAL_CLOSURE_PUBLICATION_REQUIRED", "Read-only consumer slicing requires a published terminal semantic closure.");
  if (expectedClosureDigest !== closure.closureDigest) throw semanticError("TERMINAL_CLOSURE_STALE", "Consumer slice request does not bind the exact published closure digest.");
  const requested = unique(conceptIds);
  const core = {
    schema: TERMINAL_SEMANTIC_SLICE_SCHEMA,
    closureDigest: closure.closureDigest,
    requestedConceptIds: requested,
    bindings: {
      snapshotDigest: closure.snapshot.digest,
      semanticIndexDigest: closure.semanticIndex.digest,
      graphIndexDigest: closure.graphIndex.digest,
      reasoningProfileDigest: closure.reasoningProfile.digest,
      projectionSetDigest: closure.projectionSet.digest,
      harnessAssets: persistedJson(closure.harnessAssets)
    },
    authority: {readOnly: true, offline: true, liveHarnessDependency: false, mayMutate: false, mayApprove: false, mayPublish: false, mayRelease: false}
  };
  core.sliceDigest = digest(core);
  return core;
}

export function validateSemanticInteroperabilityDocument(value) {
  if (value?.schema === ONTOLOGY_REASONING_PROFILE_SCHEMA || value?.kind === "OntologyReasoningProfile") return validateOntologyReasoningProfile(value);
  if (value?.schema === SEMANTIC_INDEX_SCHEMA || value?.kind === "SemanticIndex") return validateSemanticIndex(value);
  if (value?.schema === AFFECTED_SUBGRAPH_SCHEMA) return validateAffectedSubgraph(value);
  if (value?.schema === SEMANTIC_COMPUTATION_SCHEMA) return validateComputation(value);
  if (value?.schema === FEDERATED_PACK_DISCOVERY_SCHEMA || value?.kind === "FederatedPackDiscovery") return validateFederatedDiscovery(value);
  if (value?.schema === INTEROPERABILITY_PROJECTION_SET_SCHEMA) return validateInteroperabilityProjectionSet(value);
  if (value?.schema === SEMANTIC_ROUND_TRIP_REPORT_SCHEMA) return validateRoundTripReport(value);
  if (value?.schema === TERMINAL_SEMANTIC_CLOSURE_SCHEMA || value?.kind === "TerminalSemanticClosure") return validateTerminalSemanticClosure(value);
  if (value?.schema === TERMINAL_SEMANTIC_SLICE_SCHEMA) return validateTerminalSemanticSlice(value);
  throw semanticError("SEMANTIC_INTEROPERABILITY_DOCUMENT_UNSUPPORTED", "Unsupported semantic interoperability document.");
}

function validateAffectedSubgraph(value, indexDigest = null, profileDigest = null) {
  const result = validateImmutable(value, AFFECTED_SUBGRAPH_SCHEMA, "affectedSubgraphDigest", "AFFECTED_SUBGRAPH_INVALID");
  if (indexDigest && result.indexDigest !== indexDigest) throw semanticError("AFFECTED_SUBGRAPH_STALE", "Affected subgraph binds a different Semantic Index.");
  if (profileDigest && result.profileDigest !== profileDigest) throw semanticError("AFFECTED_SUBGRAPH_PROFILE_STALE", "Affected subgraph binds a different reasoning profile.");
  return value;
}
function validateComputation(value) { const result = validateImmutable(value, SEMANTIC_COMPUTATION_SCHEMA, "computationDigest", "SEMANTIC_COMPUTATION_INVALID"); if (result.telemetry?.secretsRedacted !== true || result.authority?.mayMutate !== false) throw semanticError("SEMANTIC_COMPUTATION_AUTHORITY_INVALID", "Semantic computation telemetry must be redacted and non-mutating."); return value; }
function validateFederatedDiscovery(value) { const result = validateImmutable(value, FEDERATED_PACK_DISCOVERY_SCHEMA, "discoveryDigest", "FEDERATED_PACK_DISCOVERY_INVALID"); if (result.authority?.readOnly !== true || result.authority?.sharedMutation !== false) throw semanticError("FEDERATED_PACK_AUTHORITY_INVALID", "Federated discovery must remain read-only."); return value; }
function validateInteroperabilityProjectionSet(value) { return validateImmutable(value, INTEROPERABILITY_PROJECTION_SET_SCHEMA, "projectionSetDigest", "SEMANTIC_INTEROPERABILITY_PROJECTION_INVALID"); }
function validateRoundTripReport(value) { return validateImmutable(value, SEMANTIC_ROUND_TRIP_REPORT_SCHEMA, "reportDigest", "SEMANTIC_ROUND_TRIP_REPORT_INVALID"); }
function validateTerminalSemanticClosure(value) { const result = validateImmutable(value, TERMINAL_SEMANTIC_CLOSURE_SCHEMA, "closureDigest", "TERMINAL_SEMANTIC_CLOSURE_INVALID"); if (result.authority?.consumerReadOnly !== true || result.authority?.grantsReleaseAuthority !== false) throw semanticError("TERMINAL_CLOSURE_AUTHORITY_INVALID", "Terminal semantic closure must remain read-only and cannot grant Release authority."); return value; }
function validateTerminalSemanticSlice(value) { const result = validateImmutable(value, TERMINAL_SEMANTIC_SLICE_SCHEMA, "sliceDigest", "TERMINAL_SEMANTIC_SLICE_INVALID"); if (result.authority?.readOnly !== true || result.authority?.liveHarnessDependency !== false || result.authority?.mayMutate !== false) throw semanticError("TERMINAL_SLICE_AUTHORITY_INVALID", "Terminal semantic slice must remain offline and read-only."); return value; }
function validateSnapshot(value) { return validateImmutable(value, "evopilot-harness-resolved-project-ontology-snapshot/v1", "snapshotDigest", "PROJECT_ONTOLOGY_SNAPSHOT_INVALID"); }

function validateIndexResourceBudgets(index, profile) {
  if (index.nodes.length > profile.spec.limits.maxNodes || index.edges.length > profile.spec.limits.maxEdges) {
    throw semanticError("REASONING_BUDGET_EXCEEDED", "Semantic Index exceeds the selected reasoning profile budget.");
  }
  if (index.cache && index.cache.entryCount > profile.spec.limits.maxCacheEntries) {
    throw semanticError("REASONING_CACHE_BUDGET_EXCEEDED", "Semantic cache entry count exceeds the selected reasoning profile budget.");
  }
}

function normalizeLimits(value = {}) {
  const limits = {};
  for (const [key, fallback] of Object.entries(DEFAULT_LIMITS)) {
    const number = Number(value?.[key] ?? fallback);
    if (!Number.isInteger(number) || number < 1) throw semanticError("REASONING_LIMIT_INVALID", `${key} must be a positive integer.`);
    limits[key] = number;
  }
  return limits;
}
function normalizeExternalReasoner(value = {}) { return {id: requiredId(value.id, "externalReasoner.id"), version: requiredSemver(value.version, "externalReasoner.version"), digest: requiredDigest(value.digest, "externalReasoner.digest"), qualificationDigest: requiredDigest(value.qualificationDigest, "externalReasoner.qualificationDigest"), supportedRules: unique(value.supportedRules ?? [])}; }
function normalizeExternalReasonerResult(value = {}) { return {reasoner: normalizeExternalReasoner(value.reasoner), inputDigest: requiredDigest(value.inputDigest, "externalReasonerResult.inputDigest"), outputDigest: requiredDigest(value.outputDigest, "externalReasonerResult.outputDigest"), proofDigest: requiredDigest(value.proofDigest, "externalReasonerResult.proofDigest"), status: requiredEnum(value.status, ["COMPLETED", "ABSTAINED"], "externalReasonerResult.status", "EXTERNAL_REASONER_RESULT_INVALID")}; }
function validateExternalReasonerResult(value, profile, indexDigest = null) { const result = normalizeExternalReasonerResult(value); if (result.reasoner.id !== profile.spec.externalReasoner.id || result.reasoner.version !== profile.spec.externalReasoner.version || result.reasoner.digest !== profile.spec.externalReasoner.digest || result.reasoner.qualificationDigest !== profile.spec.externalReasoner.qualificationDigest) throw semanticError("EXTERNAL_REASONER_BINDING_MISMATCH", "External reasoner result does not bind the qualified reasoner selected by the profile."); if (indexDigest && result.inputDigest !== indexDigest) throw semanticError("EXTERNAL_REASONER_INPUT_MISMATCH", "External reasoner result does not bind the current Semantic Index."); return value; }
function normalizeCacheBinding(value = {}) { return {id: requiredId(value.id, "cache.id"), digest: requiredDigest(value.digest, "cache.digest"), policyDigest: requiredDigest(value.policyDigest, "cache.policyDigest"), entryCount: nonNegativeInteger(value.entryCount ?? 0, "cache.entryCount")}; }
function normalizeBinding(value = {}, field) { return {id: requiredId(value.id, `${field}.id`), version: requiredSemver(value.version, `${field}.version`), digest: requiredDigest(value.digest, `${field}.digest`)}; }
function normalizeSemanticAssetBinding(value = {}, field) { const metadata = value.metadata ?? {}; const binding = {kind: requiredText(value.kind, `${field}.kind`), id: requiredId(metadata.id ?? value.id, `${field}.id`), version: requiredSemver(metadata.version ?? value.version, `${field}.version`), digest: requiredDigest(value.assetDigest ?? value.bundleDigest ?? value.profileDigest ?? value.componentDigest ?? metadata.digest ?? value.digest, `${field}.digest`)}; if (!new Set(["Ontology", "Source", "SemanticAsset", "HarnessProfile", "HarnessComponent", "HarnessBundle", "Evaluation"]).has(binding.kind)) throw semanticError("SEMANTIC_ASSET_KIND_INVALID", `${field}.kind is not indexable.`); return binding; }
function normalizeEdge(from, value = {}, index, nodeIds) { const to = requiredText(value.targetConceptId ?? value.target ?? value.object ?? value.to, `relationship[${index}].target`); if (!nodeIds.has(to)) throw semanticError("SEMANTIC_EDGE_TARGET_UNKNOWN", `Relationship target ${to} is not present in the snapshot.`); return {from, to, relationType: requiredText(value.relationType ?? value.type ?? value.predicate ?? "RELATED_TO", `relationship[${index}].relationType`), rule: value.rule === true, evidenceRefs: unique(value.evidenceRefs ?? [])}; }
function normalizeFederatedRoot(value = {}) { const packs = (value.packs ?? []).map((pack, index) => ({id: requiredId(pack.id ?? pack.metadata?.id, `packs[${index}].id`), version: requiredSemver(pack.version ?? pack.metadata?.version, `packs[${index}].version`), digest: requiredDigest(pack.digest ?? pack.metadata?.digest, `packs[${index}].digest`), kind: requiredText(pack.kind, `packs[${index}].kind`), provenance: persistedJson(pack.provenance ?? pack.metadata?.provenance ?? {}), visibility: requiredEnum(pack.visibility ?? pack.metadata?.visibility ?? "PUBLIC", ["PUBLIC", "DOMAIN", "PRIVATE"], `packs[${index}].visibility`, "FEDERATED_PACK_VISIBILITY_INVALID") })).sort(compareBinding); return {id: requiredId(value.id, "root.id"), catalogDigest: requiredDigest(value.catalogDigest, "root.catalogDigest"), trustContext: requiredText(value.trustContext, "root.trustContext"), visibility: requiredEnum(value.visibility ?? "PUBLIC", ["PUBLIC", "DOMAIN", "PRIVATE"], "root.visibility", "FEDERATED_ROOT_VISIBILITY_INVALID"), permission: requiredEnum(value.permission ?? "GRANTED", ["GRANTED", "DENIED"], "root.permission", "FEDERATED_ROOT_PERMISSION_INVALID"), available: value.available !== false, packs}; }
function matchesFederatedQuery(pack, query) { const kindMatch = query.kinds.length === 0 || query.kinds.includes(pack.kind); const text = `${pack.id} ${pack.kind}`.toLowerCase(); const termMatch = query.terms.length === 0 || query.terms.every((term) => text.includes(term)); return kindMatch && termMatch; }
function normalizeExternalMapping(value = {}, index, conceptIds) { const canonicalConceptId = requiredText(value.canonicalConceptId, `externalMappings[${index}].canonicalConceptId`); if (!conceptIds.has(canonicalConceptId)) throw semanticError("EXTERNAL_MAPPING_CONCEPT_UNKNOWN", `External mapping target ${canonicalConceptId} is not present in the snapshot.`); return {externalId: requiredText(value.externalId, `externalMappings[${index}].externalId`), canonicalConceptId, relation: requiredEnum(value.relation ?? "EXACT_MATCH", ["EXACT_MATCH", "CLOSE_MATCH", "NARROW_MATCH", "BROAD_MATCH"], `externalMappings[${index}].relation`, "EXTERNAL_MAPPING_RELATION_INVALID"), provenance: persistedJson(value.provenance ?? {}), evidenceDigest: requiredDigest(value.evidenceDigest, `externalMappings[${index}].evidenceDigest`), active: false}; }
function normalizeMultilingualTerm(value = {}, index, conceptIds) { const conceptId = requiredText(value.conceptId, `multilingualTerms[${index}].conceptId`); if (!conceptIds.has(conceptId)) throw semanticError("MULTILINGUAL_TERM_CONCEPT_UNKNOWN", `Multilingual term target ${conceptId} is not present in the snapshot.`); return {conceptId, language: requiredText(value.language, `multilingualTerms[${index}].language`).toLowerCase(), term: requiredText(value.term, `multilingualTerms[${index}].term`), provenance: persistedJson(value.provenance ?? {})}; }
function normalizeProvenance(value = {}) { return {producer: requiredText(value.producer, "provenance.producer"), sourceRefs: unique(value.sourceRefs ?? []), generatedByDigest: requiredDigest(value.generatedByDigest, "provenance.generatedByDigest")}; }
function mappingsOrEmpty(values) { return Array.isArray(values) ? values : []; }
function termsOrEmpty(values) { return Array.isArray(values) ? values : []; }
function semanticKernel(snapshot, mappings = [], terms = []) { return {snapshotDigest: snapshot.snapshotDigest, concepts: snapshot.concepts.map((concept) => ({conceptId: concept.conceptId, metaType: concept.metaType, definition: concept.definition, relationships: persistedJson(concept.relationships ?? []), evidenceRefs: unique(concept.evidenceRefs ?? [])})), externalMappings: persistedJson(mappings), multilingualTerms: persistedJson(terms)}; }

function defaultRules(mode) { return ({NONE: [], RDFS: ["rdfs:subClassOf", "rdfs:subPropertyOf", "rdfs:domain", "rdfs:range"], OWL_RL: ["owl:equivalentClass", "owl:equivalentProperty", "owl:sameAs", "owl:inverseOf"], SWRL_SAFE: ["swrl:safe-bounded-rule"], EXTERNAL_REASONER: []})[mode]; }
function jsonLdInteroperability(snapshot, mappings, terms) { return JSON.stringify({"@context": {id: "@id", type: "@type", label: {"@id": "http://www.w3.org/2000/01/rdf-schema#label"}, provenance: {"@id": "http://www.w3.org/ns/prov#wasDerivedFrom"}}, "@graph": snapshot.concepts.map((concept) => ({id: concept.conceptId, type: concept.metaType, label: [{"@value": concept.label, "@language": "und"}, ...terms.filter((term) => term.conceptId === concept.conceptId).map((term) => ({"@value": term.term, "@language": term.language}))], externalMappings: mappings.filter((mapping) => mapping.canonicalConceptId === concept.conceptId)}))}, null, 2); }
function provProjection(snapshot, mappings) { return JSON.stringify({schema: "prov-o-compatible/v1", entity: snapshot.concepts.map((concept) => ({id: concept.conceptId, wasDerivedFrom: unique(concept.evidenceRefs ?? [])})), mappings}, null, 2); }
function rdfProjection(snapshot, mappings, terms) { return [...snapshot.concepts.map((concept) => `<${iri(concept.conceptId)}> a <urn:evopilot:${concept.metaType}> ; <http://www.w3.org/2000/01/rdf-schema#label> ${quote(concept.label)} .`), ...terms.map((term) => `<${iri(term.conceptId)}> <http://www.w3.org/2000/01/rdf-schema#label> ${quote(term.term)}@${term.language} .`), ...mappings.map((mapping) => `<${iri(mapping.canonicalConceptId)}> <urn:evopilot:mapping:${mapping.relation}> <${iri(mapping.externalId)}> .`)].join("\n"); }
function owlInteroperability(snapshot, mappings) { return `Ontology(<urn:evopilot:project:${snapshot.project.id}>\n${snapshot.concepts.map((concept) => ` Declaration(Class(<${iri(concept.conceptId)}>))`).join("\n")}\n${mappings.map((mapping) => ` AnnotationAssertion(<urn:evopilot:mapping:${mapping.relation}> <${iri(mapping.canonicalConceptId)}> <${iri(mapping.externalId)}>)`).join("\n")}\n)`; }
function shaclInteroperability(snapshot) { return snapshot.concepts.map((concept) => `<${iri(concept.conceptId)}Shape> a <http://www.w3.org/ns/shacl#NodeShape> ; <http://www.w3.org/ns/shacl#targetClass> <${iri(concept.conceptId)}> .`).join("\n"); }
function mediaType(format) { return ({JSON_LD: "application/ld+json", PROV_O: "application/json", RDF_TURTLE: "text/turtle", OWL: "application/owl+xml", SHACL: "text/turtle"})[format]; }
function iri(value) { return `urn:evopilot:semantic:${encodeURIComponent(value)}`; }
function quote(value) { return JSON.stringify(String(value)); }

function validateImmutable(value, schema, digestField, code) { const copy = persistedJson(value ?? {}); const recorded = copy[digestField]; delete copy[digestField]; if (copy.schema !== schema || recorded !== digest(copy)) throw semanticError(code, `${schema} is not immutable or digest-valid.`); return value; }
function requiredEnum(value, values, field, code) { if (!values.includes(value)) throw semanticError(code, `${field} must be one of ${values.join(", ")}.`); return value; }
function requiredId(value, field) { const result = requiredText(value, field); if (!/^[a-z0-9][a-z0-9._-]*$/.test(result)) throw semanticError("SEMANTIC_ID_INVALID", `${field} must be a stable lowercase identifier.`); return result; }
function requiredText(value, field) { const result = String(value ?? "").trim(); if (!result) throw semanticError("SEMANTIC_FIELD_REQUIRED", `${field} is required.`); return result; }
function requiredDigest(value, field) { const result = String(value ?? ""); if (!/^sha256:[a-f0-9]{64}$/.test(result)) throw semanticError("SEMANTIC_DIGEST_REQUIRED", `${field} must be a sha256 digest.`); return result; }
function requiredSemver(value, field) { const result = requiredText(value, field); if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(result)) throw semanticError("SEMANTIC_VERSION_INVALID", `${field} must be exact SemVer.`); return result; }
function nonNegativeInteger(value, field) { const result = Number(value); if (!Number.isInteger(result) || result < 0) throw semanticError("SEMANTIC_INTEGER_INVALID", `${field} must be a non-negative integer.`); return result; }
function positiveInteger(value, field) { const result = Number(value); if (!Number.isInteger(result) || result < 1) throw semanticError("SEMANTIC_INTEGER_INVALID", `${field} must be a positive integer.`); return result; }
function unique(values = []) { return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))].sort(stableCompare); }
function stableCompare(left, right) { return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0; }
function compareBinding(left, right) { return stableCompare(`${left.kind ?? ""}:${left.id}@${left.version}:${left.digest}`, `${right.kind ?? ""}:${right.id}@${right.version}:${right.digest}`); }
function compareEdge(left, right) { return stableCompare(`${left.from}:${left.relationType}:${left.to}`, `${right.from}:${right.relationType}:${right.to}`); }
function compareFederatedPack(left, right) { return stableCompare(`${left.id}@${left.version}:${left.sourceCatalog}`, `${right.id}@${right.version}:${right.sourceCatalog}`); }
function compareTerm(left, right) { return stableCompare(`${left.conceptId}:${left.language}:${left.term}`, `${right.conceptId}:${right.language}:${right.term}`); }
function semanticError(code, message) { const error = new Error(message); error.name = "SemanticInteroperabilityError"; error.code = code; error.nextAction = "repair-semantic-bindings-or-run-full-recomputation"; return error; }
