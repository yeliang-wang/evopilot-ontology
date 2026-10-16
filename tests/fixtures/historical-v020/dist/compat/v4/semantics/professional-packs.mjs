import { digest, persistedJson } from "../../v3/utils.mjs";

export const PROFESSIONAL_PACK_API_VERSION = "semantics.evopilot.io/v1";
export const PROFESSIONAL_PACK_KINDS = Object.freeze([
  "DomainOntologyPack",
  "ProductOntologyPack",
  "OrganizationOntologyPack",
  "ProjectOntologyOverlay"
]);
export const PACK_ROOTS = Object.freeze(["COMMUNITY", "DOMAIN_TEAM", "PRIVATE_ORGANIZATION"]);
export const PACK_VISIBILITY = Object.freeze(["PUBLIC", "DOMAIN", "PRIVATE"]);
export const PACK_QUALITY_LEVELS = Object.freeze(["UNASSESSED", "EXPERIMENTAL", "REVIEWED", "CERTIFIED"]);
export const PACK_LIFECYCLE_STAGES = Object.freeze([
  "DRAFT", "APPLIED", "IN_REVIEW", "APPROVED", "PUBLISHED", "INSTALLED", "ACTIVE", "SUPERSEDED", "ROLLED_BACK", "DEPRECATED"
]);
export const EXTERNAL_SEMANTIC_EVIDENCE_ADAPTER_SCHEMA = "evopilot-harness-external-semantic-evidence-adapter/v1";

export function createProfessionalPack(input = {}) {
  const kind = requiredEnum(input.kind, PROFESSIONAL_PACK_KINDS, "kind", "PACK_KIND_INVALID");
  rejectExecutableContent(input);
  const metadata = normalizeMetadata(input.metadata, kind);
  const spec = normalizePackSpec(input.spec, metadata);
  const core = {
    apiVersion: PROFESSIONAL_PACK_API_VERSION,
    kind,
    metadata,
    spec,
    status: {
      phase: "DRAFT",
      conditions: [],
      observedGeneration: metadata.generation,
      engineOwned: true
    }
  };
  delete core.metadata.digest;
  core.metadata.digest = digest(core);
  return core;
}

export function validateProfessionalPack(value) {
  const copy = persistedJson(value ?? {});
  const recorded = copy?.metadata?.digest;
  if (!PROFESSIONAL_PACK_KINDS.includes(copy?.kind) || copy.apiVersion !== PROFESSIONAL_PACK_API_VERSION) {
    throw packError("PACK_SCHEMA_INVALID", "Professional Pack apiVersion or kind is unsupported.");
  }
  delete copy.metadata.digest;
  if (recorded !== digest(copy)) throw packError("PACK_DIGEST_INVALID", `Pack ${copy.metadata?.id ?? "<unknown>"} digest does not bind its canonical content.`);
  rejectExecutableContent(copy);
  normalizeMetadata(copy.metadata, copy.kind);
  normalizePackSpec(copy.spec, copy.metadata);
  if (!PACK_LIFECYCLE_STAGES.includes(copy.status?.phase) || copy.status?.engineOwned !== true) {
    throw packError("PACK_STATUS_INVALID", "Pack status must be Engine-owned and use a declared lifecycle phase.");
  }
  return value;
}

export function inspectProfessionalPack(pack, {availablePacks = []} = {}) {
  validateProfessionalPack(pack);
  const available = new Map(availablePacks.map((item) => {
    validateProfessionalPack(item);
    return [packKey(item), item];
  }));
  const dependencies = pack.spec.imports.map((item) => {
    const candidate = available.get(importKey(item));
    const status = !candidate ? (item.optional ? "OPTIONAL_MISSING" : "MISSING") : candidate.metadata.digest === item.digest ? "SATISFIED" : "DIGEST_MISMATCH";
    return {...item, status};
  });
  const issues = [];
  for (const dependency of dependencies) {
    if (dependency.status === "MISSING") issues.push({code: "PACK_DEPENDENCY_MISSING", severity: "ERROR", dependency: `${dependency.id}@${dependency.version}`});
    if (dependency.status === "DIGEST_MISMATCH") issues.push({code: "PACK_DEPENDENCY_DIGEST_MISMATCH", severity: "ERROR", dependency: `${dependency.id}@${dependency.version}`});
  }
  for (const rule of pack.spec.rules) if (!rule.bounded) issues.push({code: "PACK_RULE_UNBOUNDED", severity: "ERROR", ruleId: rule.ruleId});
  const core = {
    schema: "evopilot-harness-professional-pack-inspection/v1",
    pack: {id: pack.metadata.id, version: pack.metadata.version, digest: pack.metadata.digest, kind: pack.kind},
    lint: {status: issues.some((item) => item.severity === "ERROR") ? "FAILED" : "PASSED", issues},
    dependencies,
    compatibility: {
      apiVersion: pack.apiVersion,
      exactSemver: true,
      declarativeOnly: true,
      executable: false,
      supportedRoots: [...PACK_ROOTS],
      supportedKinds: [...PROFESSIONAL_PACK_KINDS]
    },
    authority: {readOnly: true, mayInstall: false, mayApprove: false, mayPublish: false, mayActivate: false}
  };
  core.inspectionDigest = digest(core);
  return core;
}

export function resolveProfessionalPackSet({ packs = [], precedence = [], targetRoot = "PRIVATE_ORGANIZATION", expectedBaseDigest = null, baseSnapshot = null } = {}) {
  const root = requiredEnum(targetRoot, PACK_ROOTS, "targetRoot", "PACK_ROOT_INVALID");
  if (!Array.isArray(packs) || packs.length === 0) throw packError("PACK_SET_REQUIRED", "At least one exact Professional Pack is required.");
  const canonical = packs.map((pack) => validateProfessionalPack(pack)).sort(comparePack);
  const keys = canonical.map(packKey);
  if (new Set(keys).size !== keys.length) throw packError("PACK_DUPLICATE", "A resolved Pack set cannot contain duplicate id/version pairs.");
  const byKey = new Map(canonical.map((pack) => [packKey(pack), pack]));
  const byId = new Map();
  for (const pack of canonical) {
    const entries = byId.get(pack.metadata.id) ?? [];
    entries.push(pack);
    byId.set(pack.metadata.id, entries);
    enforceVisibility(pack, root);
  }
  for (const pack of canonical) validateImports(pack, byKey, byId);
  detectImportCycles(canonical, byKey, byId);
  const ordered = orderByPrecedence(canonical, precedence);
  const concepts = mergeConcepts(ordered);
  const baseDigest = baseSnapshot ? validateBaseSnapshot(baseSnapshot) : digest({schema: "evopilot-harness-empty-pack-base/v1"});
  if (expectedBaseDigest && expectedBaseDigest !== baseDigest) throw packError("PACK_BASE_DIGEST_STALE", "The Pack-set base digest changed; resolve conflicts against the current immutable base.");
  const core = {
    schema: "evopilot-harness-resolved-professional-pack-set/v1",
    targetRoot: root,
    baseDigest,
    packs: ordered.map((pack) => ({
      id: pack.metadata.id,
      version: pack.metadata.version,
      kind: pack.kind,
      namespace: pack.metadata.namespace,
      root: pack.metadata.root,
      visibility: pack.metadata.visibility,
      digest: pack.metadata.digest,
      provenance: pack.metadata.provenance
    })),
    concepts,
    dependencyGraph: ordered.map((pack) => ({pack: packKey(pack), imports: pack.spec.imports.map(importKey).sort()})),
    conflicts: [],
    authority: {
      engineResolved: true,
      declarativeOnly: true,
      executable: false,
      importedEvidenceActive: false,
      automaticallyTrusted: false,
      automaticallyApproved: false,
      automaticallyPublished: false,
      automaticallyActivated: false
    }
  };
  core.packSetDigest = digest(core);
  return core;
}

export function createPackLifecycleRecord({pack, targetRoot, project = null, dependencyClosure, conflictPreview, migrationPlan = null}) {
  validateProfessionalPack(pack);
  const root = requiredEnum(targetRoot, PACK_ROOTS, "targetRoot", "PACK_ROOT_INVALID");
  enforceVisibility(pack, root);
  const value = {
    schema: "evopilot-harness-pack-lifecycle-record/v1",
    pack: {id: pack.metadata.id, version: pack.metadata.version, digest: pack.metadata.digest},
    targetRoot: root,
    project: project ? {id: requiredText(project.id, "project.id"), workspaceId: requiredText(project.workspaceId, "project.workspaceId"), tenantId: requiredText(project.tenantId, "project.tenantId")} : null,
    dependencyClosureDigest: requiredDigest(dependencyClosure?.digest, "dependencyClosure.digest"),
    conflictPreviewDigest: requiredDigest(conflictPreview?.digest, "conflictPreview.digest"),
    migrationPlan: migrationPlan ? exactBinding(migrationPlan, "migrationPlan") : null,
    stage: "DRAFT",
    history: [],
    authority: {actionsIndependent: true, humanDecisionsExplicit: true, exactRootBound: true, exactProjectBound: true, dependencyClosureBound: true}
  };
  value.recordDigest = digest(value);
  return value;
}

export function transitionPackLifecycle({ record, action, actor, actorRole = null, expectedRecordDigest, reason = "", successor = null, rollbackTarget = null, migrationPlan = null, now = new Date().toISOString() }) {
  const current = record ? validateLifecycleRecord(record) : createUnboundDraftLifecycleRecord();
  if (expectedRecordDigest && current.recordDigest !== expectedRecordDigest) throw packError("PACK_LIFECYCLE_STALE", "Pack lifecycle record digest changed.");
  const transitions = {
    APPLY: ["DRAFT", "APPLIED"],
    REQUEST_REVIEW: ["APPLIED", "IN_REVIEW"],
    APPROVE: ["IN_REVIEW", "APPROVED"],
    PUBLISH: ["APPROVED", "PUBLISHED"],
    INSTALL: ["PUBLISHED", "INSTALLED"],
    ACTIVATE: ["INSTALLED", "ACTIVE"],
    SUPERSEDE: ["ACTIVE", "SUPERSEDED"],
    ROLLBACK: ["ACTIVE", "ROLLED_BACK"],
    DEPRECATE: ["PUBLISHED", "DEPRECATED"]
  };
  const transition = transitions[action];
  if (!transition || current.stage !== transition[0]) throw packError("PACK_LIFECYCLE_TRANSITION_INVALID", `${action} cannot run from ${current.stage}.`);
  const normalizedActor = String(actor ?? "").trim();
  if (!normalizedActor) throw packError("PACK_LIFECYCLE_ACTOR_REQUIRED", `${action} requires an explicit actor.`);
  const requiredRole = ({APPLY: "AUTHOR", REQUEST_REVIEW: "AUTHOR", APPROVE: "APPROVER", PUBLISH: "PUBLISHER", INSTALL: "INSTALLER", ACTIVATE: "ACTIVATOR", SUPERSEDE: "APPROVER", ROLLBACK: "ROLLBACK_OPERATOR", DEPRECATE: "PUBLISHER"})[action];
  const normalizedRole = String(actorRole ?? requiredRole);
  if (normalizedRole !== requiredRole) throw packError("PACK_LIFECYCLE_ROLE_INVALID", `${action} requires role ${requiredRole}.`);
  if (["PUBLISH", "INSTALL", "ACTIVATE", "SUPERSEDE", "ROLLBACK", "DEPRECATE"].includes(action) && !current.pack) throw packError("PACK_LIFECYCLE_BINDING_REQUIRED", `${action} requires a Pack-bound lifecycle record.`);
  const successorBinding = successor ? exactPackOrAssetBinding(successor, "successor") : null;
  const rollbackBinding = rollbackTarget ? exactPackOrAssetBinding(rollbackTarget, "rollbackTarget") : null;
  const migrationBinding = migrationPlan ? exactBinding(migrationPlan, "migrationPlan") : current.migrationPlan ?? null;
  if (action === "SUPERSEDE" && (!successorBinding || !migrationBinding)) throw packError("PACK_SUCCESSOR_BINDING_REQUIRED", "SUPERSEDE requires exact successor and migration-plan bindings.");
  if (action === "ROLLBACK" && !rollbackBinding) throw packError("PACK_ROLLBACK_TARGET_REQUIRED", "ROLLBACK requires an exact prior Pack target.");
  const decision = {action, from: transition[0], to: transition[1], actor: normalizedActor, actorRole: normalizedRole, reason: String(reason).trim(), successor: successorBinding, rollbackTarget: rollbackBinding, migrationPlan: migrationBinding, at: String(now)};
  const next = {...current, stage: transition[1], history: [...current.history, decision]};
  if (successorBinding) next.successor = successorBinding;
  if (rollbackBinding) next.rollbackTarget = rollbackBinding;
  if (migrationBinding) next.migrationPlan = migrationBinding;
  delete next.recordDigest;
  next.recordDigest = digest(next);
  return next;
}

export function createPackBenchmarkPackage({id, version, cases = [], metrics = [], provenance, evidenceRefs = []}) {
  const core = {
    schema: "evopilot-harness-pack-benchmark/v1",
    id: requiredText(id, "benchmark.id"),
    version: requiredSemver(version, "benchmark.version"),
    cases: cases.map((item) => exactBinding(item, "benchmark.case")).sort(compareJson),
    metrics: unique(metrics),
    provenance: normalizeProvenance(provenance),
    evidenceRefs: unique(evidenceRefs),
    authority: {advisoryEvidenceOnly: true, executable: false, grantsTrust: false}
  };
  core.benchmarkDigest = digest(core);
  return core;
}

export function createPackGoldCasePackage({id, version, source, expectedConcepts = [], expectedOutcome, provenance, evidenceRefs = []}) {
  const core = {
    schema: "evopilot-harness-pack-gold-case/v1",
    id: requiredText(id, "goldCase.id"),
    version: requiredSemver(version, "goldCase.version"),
    source: exactBinding(source, "goldCase.source"),
    expectedConcepts: unique(expectedConcepts),
    expectedOutcome: requiredText(expectedOutcome, "goldCase.expectedOutcome"),
    provenance: normalizeProvenance(provenance),
    evidenceRefs: unique(evidenceRefs),
    authority: {reviewedFixtureOnly: true, executable: false, grantsTrust: false}
  };
  core.goldCaseDigest = digest(core);
  return core;
}

export function createPackCertificationRecord({ pack, benchmark, goldCases = [], algorithm, policy, toolchain, qualityLevel, signer = null, evidenceRefs = [] }) {
  validateProfessionalPack(pack);
  const core = {
    schema: "evopilot-harness-pack-certification/v1",
    pack: {id: pack.metadata.id, version: pack.metadata.version, digest: pack.metadata.digest},
    benchmark: exactBinding(benchmark, "benchmark"),
    goldCases: goldCases.map((item) => exactBinding(item, "goldCase")).sort((a, b) => a.id.localeCompare(b.id)),
    algorithm: exactBinding(algorithm, "algorithm"),
    policy: exactBinding(policy, "policy"),
    toolchain: exactBinding(toolchain, "toolchain"),
    qualityLevel: requiredEnum(qualityLevel ?? "UNASSESSED", PACK_QUALITY_LEVELS, "qualityLevel", "PACK_QUALITY_LEVEL_INVALID"),
    signer: signer ? persistedJson(signer) : null,
    evidenceRefs: unique(evidenceRefs),
    authority: {advisoryEvidenceOnly: true, signingOptional: true, automaticallyTrusted: false, mayApprove: false, mayPublish: false, mayInstall: false, mayActivate: false}
  };
  core.certificationDigest = digest(core);
  return core;
}

export function createExternalSemanticEvidenceAdapter({id, version, sourceTypes = ["CATALOG", "VOCABULARY", "RDF", "OWL", "KNOWLEDGE_GRAPH"], provenance}) {
  const core = {
    schema: EXTERNAL_SEMANTIC_EVIDENCE_ADAPTER_SCHEMA,
    kind: "ExternalSemanticEvidenceAdapter",
    id: requiredText(id, "adapter.id"),
    version: requiredSemver(version, "adapter.version"),
    sourceTypes: unique(sourceTypes),
    provenance: normalizeProvenance(provenance),
    behavior: {readOnly: true, networkFetch: false, executable: false, preserveProvenance: true, importedContentInactive: true},
    authority: {mayApprove: false, mayPublish: false, mayInstall: false, mayActivate: false}
  };
  core.adapterDigest = digest(core);
  return core;
}

export function importExternalSemanticEvidence({ adapter = null, source, records = [], fetchedAt = null }) {
  const sourceBinding = exactBinding(source, "source");
  const adapterBinding = adapter ? validateExternalSemanticEvidenceAdapter(adapter) : null;
  const normalized = records.map((record, index) => ({
    recordId: String(record.recordId ?? `record-${String(index + 1).padStart(4, "0")}`),
    locator: String(record.locator ?? ""),
    contentDigest: requiredDigest(record.contentDigest, "contentDigest"),
    provenance: persistedJson(record.provenance ?? {}),
    observedTerms: unique(record.observedTerms ?? [])
  })).sort((a, b) => a.recordId.localeCompare(b.recordId));
  const core = {
    schema: "evopilot-harness-external-semantic-evidence/v1",
    adapter: adapterBinding ? {id: adapterBinding.id, version: adapterBinding.version, digest: adapterBinding.adapterDigest} : null,
    source: sourceBinding,
    fetchedAt: fetchedAt == null ? null : String(fetchedAt),
    records: normalized,
    authority: {readOnlyImport: true, inactiveEvidence: true, mayOverridePack: false, mayActivate: false, mayApprove: false, mayPublish: false}
  };
  core.evidencePackageDigest = digest(core);
  return core;
}

function validateExternalSemanticEvidenceAdapter(value) {
  const copy = persistedJson(value ?? {});
  const recorded = copy.adapterDigest;
  delete copy.adapterDigest;
  if (copy.schema !== EXTERNAL_SEMANTIC_EVIDENCE_ADAPTER_SCHEMA || copy.kind !== "ExternalSemanticEvidenceAdapter" || recorded !== digest(copy)) throw packError("EXTERNAL_SEMANTIC_EVIDENCE_ADAPTER_INVALID", "External semantic evidence adapter is not immutable or digest-valid.");
  rejectExecutableContent(copy);
  return value;
}

function normalizeMetadata(value = {}, kind) {
  const id = requiredText(value.id, "metadata.id");
  const version = requiredSemver(value.version, "metadata.version");
  const namespace = requiredNamespace(value.namespace, "metadata.namespace");
  const root = requiredEnum(value.root, PACK_ROOTS, "metadata.root", "PACK_ROOT_INVALID");
  const visibility = requiredEnum(value.visibility, PACK_VISIBILITY, "metadata.visibility", "PACK_VISIBILITY_INVALID");
  if (root === "PRIVATE_ORGANIZATION" && visibility !== "PRIVATE") throw packError("PRIVATE_PACK_VISIBILITY_INVALID", "Private Organization Packs must remain PRIVATE.");
  return {
    id,
    version,
    name: requiredText(value.name ?? id, "metadata.name"),
    namespace,
    root,
    visibility,
    generation: boundedInteger(value.generation ?? 1, 1, Number.MAX_SAFE_INTEGER, "metadata.generation"),
    owner: requiredText(value.owner, "metadata.owner"),
    provenance: normalizeProvenance(value.provenance),
    labels: normalizeStringMap(value.labels),
    kind,
    digest: value.digest
  };
}

function normalizePackSpec(value = {}, metadata) {
  const concepts = (value.concepts ?? []).map(normalizeConcept).sort((a, b) => a.conceptId.localeCompare(b.conceptId));
  if (new Set(concepts.map((item) => item.conceptId)).size !== concepts.length) throw packError("PACK_CONCEPT_DUPLICATE", `Pack ${metadata.id} contains duplicate concept identifiers.`);
  return {
    imports: (value.imports ?? []).map(normalizeImport).sort((a, b) => importKey(a).localeCompare(importKey(b))),
    concepts,
    equivalences: (value.equivalences ?? []).map(normalizeEquivalence).sort(compareJson),
    replacements: (value.replacements ?? []).map(normalizeReplacement).sort(compareJson),
    deprecations: unique(value.deprecations ?? []),
    rules: (value.rules ?? []).map(normalizeRule).sort(compareJson),
    shapes: (value.shapes ?? []).map((item) => persistedJson(item)).sort(compareJson),
    harnessGuidance: kindGuidance(metadata.kind, value.harnessGuidance),
    authority: {declarativeOnly: true, executable: false, activationRequiresIndependentDecision: true}
  };
}

function normalizeConcept(value = {}) {
  return {
    conceptId: requiredNamespace(value.conceptId, "conceptId"),
    label: requiredText(value.label, "concept.label"),
    metaType: requiredText(value.metaType, "concept.metaType").toUpperCase(),
    definition: requiredText(value.definition, "concept.definition"),
    aliases: unique(value.aliases ?? []),
    relationships: (value.relationships ?? []).map((item) => persistedJson(item)).sort(compareJson),
    evidenceRefs: unique(value.evidenceRefs ?? []),
    replaces: value.replaces ? requiredNamespace(value.replaces, "concept.replaces") : null,
    deprecated: value.deprecated === true
  };
}

function normalizeImport(value = {}) {
  return {id: requiredText(value.id, "import.id"), version: requiredSemver(value.version, "import.version"), digest: requiredDigest(value.digest, "import.digest"), optional: value.optional === true};
}
function normalizeEquivalence(value = {}) { return {left: requiredNamespace(value.left, "equivalence.left"), right: requiredNamespace(value.right, "equivalence.right"), evidenceRefs: unique(value.evidenceRefs ?? [])}; }
function normalizeReplacement(value = {}) { return {from: requiredNamespace(value.from, "replacement.from"), to: requiredNamespace(value.to, "replacement.to"), migration: requiredText(value.migration, "replacement.migration")}; }
function normalizeRule(value = {}) { return {ruleId: requiredNamespace(value.ruleId, "rule.ruleId"), expression: requiredText(value.expression, "rule.expression"), bounded: value.bounded === true, evidenceRefs: unique(value.evidenceRefs ?? [])}; }
function normalizeProvenance(value = {}) { return {author: requiredText(value.author, "provenance.author"), reviewers: unique(value.reviewers ?? []), approvers: unique(value.approvers ?? []), publishers: unique(value.publishers ?? []), sourceRefs: unique(value.sourceRefs ?? [])}; }
function normalizeStringMap(value = {}) { return Object.fromEntries(Object.entries(value).map(([key, item]) => [String(key), String(item)]).sort(([a], [b]) => a.localeCompare(b))); }
function kindGuidance(_kind, value) { if (value != null && (!Array.isArray(value) || value.length !== 0)) throw packError("HARNESS_GUIDANCE_NOT_ALLOWED", "Harness guidance belongs to the Harness product; Ontology packs require an empty harnessGuidance array."); return []; }

function validateImports(pack, byKey, byId) {
  for (const item of pack.spec.imports) {
    const exact = byKey.get(importKey(item));
    if (!exact) {
      if (item.optional) continue;
      if (byId.has(item.id)) throw packError("PACK_DEPENDENCY_VERSION_CONFLICT", `${packKey(pack)} requires exact ${importKey(item)}.`);
      throw packError("PACK_DEPENDENCY_MISSING", `${packKey(pack)} requires missing ${importKey(item)}.`);
    }
    if (exact.metadata.digest !== item.digest) throw packError("PACK_DEPENDENCY_DIGEST_MISMATCH", `${importKey(item)} digest does not match its import binding.`);
  }
}

function detectImportCycles(packs, byKey, byId) {
  const visiting = new Set();
  const visited = new Set();
  function visit(key) {
    if (visiting.has(key)) throw packError("PACK_IMPORT_CYCLE", `Pack import cycle includes ${key}.`);
    if (visited.has(key)) return;
    visiting.add(key);
    for (const item of byKey.get(key)?.spec.imports ?? []) {
      const next = byKey.has(importKey(item)) ? importKey(item) : (byId.get(item.id)?.length === 1 ? packKey(byId.get(item.id)[0]) : null);
      if (next) visit(next);
    }
    visiting.delete(key);
    visited.add(key);
  }
  for (const pack of packs) visit(packKey(pack));
}

function orderByPrecedence(packs, precedence) {
  const requested = unique(precedence ?? []);
  const namespaces = new Map();
  for (const pack of packs) {
    const items = namespaces.get(pack.metadata.namespace) ?? [];
    items.push(pack);
    namespaces.set(pack.metadata.namespace, items);
  }
  for (const [namespace, items] of namespaces) {
    if (items.length > 1 && items.some((pack) => !requested.includes(packKey(pack)))) throw packError("PACK_NAMESPACE_COLLISION", `Namespace ${namespace} requires explicit precedence for every colliding Pack.`);
  }
  const rank = new Map(requested.map((key, index) => [key, index]));
  for (const key of requested) if (!packs.some((pack) => packKey(pack) === key)) throw packError("PACK_PRECEDENCE_UNKNOWN", `Precedence references unknown Pack ${key}.`);
  return [...packs].sort((left, right) => (rank.get(packKey(left)) ?? Number.MAX_SAFE_INTEGER) - (rank.get(packKey(right)) ?? Number.MAX_SAFE_INTEGER) || comparePack(left, right));
}

function mergeConcepts(packs) {
  const merged = new Map();
  for (const pack of packs) {
    for (const concept of pack.spec.concepts) {
      const previous = merged.get(concept.conceptId);
      if (previous && concept.replaces !== previous.conceptDigest) throw packError("PACK_OVERRIDE_INCOMPATIBLE", `${concept.conceptId} overrides an existing concept without its exact digest.`);
      const entry = {...concept, packId: pack.metadata.id, packVersion: pack.metadata.version, packDigest: pack.metadata.digest};
      entry.conceptDigest = digest(entry);
      merged.set(entry.conceptId, entry);
    }
  }
  return [...merged.values()].sort((a, b) => a.conceptId.localeCompare(b.conceptId));
}

function validateBaseSnapshot(value) {
  return requiredDigest(value?.snapshotDigest ?? value?.packSetDigest, "baseSnapshot digest");
}
function createUnboundDraftLifecycleRecord() { const value = {schema: "evopilot-harness-pack-lifecycle-record/v1", stage: "DRAFT", history: [], authority: {actionsIndependent: true, humanDecisionsExplicit: true}}; value.recordDigest = digest(value); return value; }
function validateLifecycleRecord(value) { const copy = persistedJson(value ?? {}); const recorded = copy.recordDigest; delete copy.recordDigest; if (copy.schema !== "evopilot-harness-pack-lifecycle-record/v1" || recorded !== digest(copy)) throw packError("PACK_LIFECYCLE_RECORD_INVALID", "Pack lifecycle record is not immutable or digest-valid."); return value; }
function enforceVisibility(pack, targetRoot) { if (pack.metadata.root === "PRIVATE_ORGANIZATION" && targetRoot !== "PRIVATE_ORGANIZATION") throw packError("PRIVATE_PACK_ROOT_LEAK", `${packKey(pack)} cannot enter ${targetRoot}.`); if (pack.metadata.visibility === "PRIVATE" && targetRoot !== "PRIVATE_ORGANIZATION") throw packError("PRIVATE_PACK_VISIBILITY_LEAK", `${packKey(pack)} cannot be resolved into a non-private root.`); }
function rejectExecutableContent(value) { const forbidden = ["script", "scripts", "command", "commands", "hook", "hooks", "runtimeCode", "installerCode"]; const stack = [value]; while (stack.length) { const current = stack.pop(); if (!current || typeof current !== "object") continue; for (const [key, item] of Object.entries(current)) { if (forbidden.includes(key) || (key === "executable" && item !== false)) throw packError("EXECUTABLE_PACK_REJECTED", `Professional Packs cannot contain executable field ${key}.`); if (item && typeof item === "object") stack.push(item); } } }
function exactBinding(value = {}, label) { return {id: requiredText(value.id, `${label}.id`), version: requiredText(value.version, `${label}.version`), digest: requiredDigest(value.digest, `${label}.digest`)}; }
function exactPackOrAssetBinding(value = {}, label) { return exactBinding({id: value.metadata?.id ?? value.id, version: value.metadata?.version ?? value.version, digest: value.metadata?.digest ?? value.digest}, label); }
function comparePack(left, right) { return packKey(left).localeCompare(packKey(right)); }
function compareJson(left, right) { return JSON.stringify(left).localeCompare(JSON.stringify(right)); }
function packKey(pack) { return `${pack.metadata.id}@${pack.metadata.version}`; }
function importKey(item) { return `${item.id}@${item.version}`; }
function requiredText(value, field) { const result = String(value ?? "").trim(); if (!result) throw packError("PACK_FIELD_REQUIRED", `${field} is required.`); return result; }
function requiredSemver(value, field) { const result = requiredText(value, field); if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(result)) throw packError("PACK_VERSION_INVALID", `${field} must be exact SemVer.`); return result; }
function requiredNamespace(value, field) { const result = requiredText(value, field); if (!/^[A-Za-z][A-Za-z0-9._:-]{1,255}$/.test(result)) throw packError("PACK_NAMESPACE_INVALID", `${field} is not a valid semantic identifier.`); return result; }
function requiredDigest(value, field) { const result = String(value ?? ""); if (!/^sha256:[a-f0-9]{64}$/.test(result)) throw packError("PACK_DIGEST_REQUIRED", `${field} must be a sha256 digest.`); return result; }
function requiredEnum(value, allowed, field, code) { const result = String(value ?? ""); if (!allowed.includes(result)) throw packError(code, `${field} must be one of ${allowed.join(", ")}.`); return result; }
function boundedInteger(value, minimum, maximum, field) { const result = Number(value); if (!Number.isInteger(result) || result < minimum || result > maximum) throw packError("PACK_INTEGER_INVALID", `${field} must be an integer from ${minimum} through ${maximum}.`); return result; }
function unique(values = []) { return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))].sort(); }
function packError(code, message) { const error = new Error(message); error.name = "ProfessionalPackError"; error.code = code; error.nextAction = "repair-pack-draft-or-explicitly-resolve-conflict"; return error; }
