import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "../../src/compat/v3/utils.mjs";
import { validateDocument } from "../../src/compat/v3/schema.mjs";
import { resolveOntologyFoundation } from "../../src/compat/v4/semantics/ontology-grounding.mjs";
import {
  createExternalSemanticEvidenceAdapter,
  createPackBenchmarkPackage,
  createPackCertificationRecord,
  createPackGoldCasePackage,
  createPackLifecycleRecord,
  createProfessionalPack,
  importExternalSemanticEvidence,
  inspectProfessionalPack,
  resolveProfessionalPackSet,
  transitionPackLifecycle
} from "../../src/compat/v4/semantics/professional-packs.mjs";
import {
  compileProjectOntologySkill,
  createArtifactLifecycleRecord,
  createProjectOntologyProposal,
  createProjectionSet,
  publishProjectOntologyArtifactSet,
  resolveProjectOntologySnapshot,
  transitionProjectOntologyProposal
} from "../../src/compat/v4/semantics/project-ontology.mjs";

function pack(kind, id, namespace, extra = {}) {
  return createProfessionalPack({
    kind,
    metadata: {
      id,
      version: extra.version ?? "1.0.0",
      name: id,
      namespace,
      root: extra.root ?? "DOMAIN_TEAM",
      visibility: extra.visibility ?? "DOMAIN",
      owner: extra.owner ?? "domain-team",
      provenance: {author: "author", reviewers: ["reviewer"], approvers: ["approver"], publishers: ["publisher"], sourceRefs: ["source://fixture"]}
    },
    spec: {
      imports: extra.imports ?? [],
      concepts: extra.concepts ?? [{conceptId: `${namespace}:root`, label: `${id} root`, metaType: "CAPABILITY", definition: `Root concept for ${id}.`, evidenceRefs: ["source://fixture"]}],
      equivalences: extra.equivalences ?? [],
      replacements: extra.replacements ?? [],
      deprecations: extra.deprecations ?? [],
      rules: extra.rules ?? [],
      shapes: extra.shapes ?? [],
      harnessGuidance: extra.harnessGuidance ?? []
    }
  });
}

function projectBinding() {
  return {id: "project-alpha", workspaceId: "workspace-alpha", tenantId: "tenant-alpha", sourceSnapshotDigest: digest("source-alpha")};
}

function approve(proposal) {
  const applied = transitionProjectOntologyProposal({proposal, action: "APPLY", actor: "author", expectedProposalDigest: proposal.proposalDigest});
  const inReview = transitionProjectOntologyProposal({proposal: applied, action: "REQUEST_REVIEW", actor: "author", expectedProposalDigest: applied.proposalDigest});
  return transitionProjectOntologyProposal({proposal: inReview, action: "APPROVE", actor: "approver", expectedProposalDigest: inReview.proposalDigest});
}

test("v4.7 Professional Packs are versioned, declarative, deterministic, and schema-valid", () => {
  const first = pack("DomainOntologyPack", "finance-domain", "finance");
  const second = pack("DomainOntologyPack", "finance-domain", "finance");
  assert.deepEqual(first, second);
  assert.equal(first.spec.authority.executable, false);
  assert.equal(first.status.engineOwned, true);
  assert.equal(validateDocument(first).status, "VALIDATED");
  assert.throws(() => createProfessionalPack({
    kind: "DomainOntologyPack",
    metadata: {id: "bad", version: "1.0.0", namespace: "bad", root: "COMMUNITY", visibility: "PUBLIC", owner: "owner", provenance: {author: "author"}},
    spec: {scripts: ["curl example.invalid"]}
  }), (error) => error.code === "EXECUTABLE_PACK_REJECTED");
});

test("v4.7 Pack resolution pins dependencies and fails closed on collisions, cycles, and private leakage", () => {
  const base = pack("DomainOntologyPack", "finance-domain", "finance");
  const product = pack("ProductOntologyPack", "crm-product", "crm", {imports: [{id: base.metadata.id, version: base.metadata.version, digest: base.metadata.digest}]});
  const resolved = resolveProfessionalPackSet({packs: [product, base], targetRoot: "DOMAIN_TEAM"});
  assert.equal(resolved.packs.length, 2);
  assert.equal(resolved.authority.executable, false);
  assert.equal(validateDocument(resolved).status, "VALIDATED");

  const collision = pack("ProductOntologyPack", "finance-product", "finance");
  assert.throws(() => resolveProfessionalPackSet({packs: [base, collision], targetRoot: "DOMAIN_TEAM"}), (error) => error.code === "PACK_NAMESPACE_COLLISION");
  const privatePack = pack("OrganizationOntologyPack", "private-org", "private", {root: "PRIVATE_ORGANIZATION", visibility: "PRIVATE"});
  assert.throws(() => resolveProfessionalPackSet({packs: [privatePack], targetRoot: "COMMUNITY"}), (error) => error.code === "PRIVATE_PACK_ROOT_LEAK");

  const cycleASeed = pack("DomainOntologyPack", "cycle-a", "cycle.a");
  const cycleBSeed = pack("ProductOntologyPack", "cycle-b", "cycle.b");
  const cycleA = pack("DomainOntologyPack", "cycle-a", "cycle.a", {imports: [{id: "cycle-b", version: "1.0.0", digest: cycleBSeed.metadata.digest}]});
  const cycleB = pack("ProductOntologyPack", "cycle-b", "cycle.b", {imports: [{id: "cycle-a", version: "1.0.0", digest: cycleA.metadata.digest}]});
  cycleA.spec.imports[0].digest = cycleB.metadata.digest;
  const cycleACore = structuredClone(cycleA); delete cycleACore.metadata.digest; cycleA.metadata.digest = digest(cycleACore);
  cycleB.spec.imports[0].digest = cycleA.metadata.digest;
  const cycleBCore = structuredClone(cycleB); delete cycleBCore.metadata.digest; cycleB.metadata.digest = digest(cycleBCore);
  cycleA.spec.imports[0].digest = cycleB.metadata.digest;
  const finalACore = structuredClone(cycleA); delete finalACore.metadata.digest; cycleA.metadata.digest = digest(finalACore);
  assert.throws(() => resolveProfessionalPackSet({packs: [cycleA, cycleB], targetRoot: "DOMAIN_TEAM"}), (error) => ["PACK_DEPENDENCY_DIGEST_MISMATCH", "PACK_IMPORT_CYCLE"].includes(error.code));
  assert.ok(cycleASeed.metadata.digest && cycleBSeed.metadata.digest);
});

test("v4.7 lifecycle actions remain separate and stale transitions fail closed", () => {
  let record = transitionPackLifecycle({action: "APPLY", actor: "author"});
  assert.equal(record.stage, "APPLIED");
  assert.throws(() => transitionPackLifecycle({record, action: "APPROVE", actor: "approver", expectedRecordDigest: record.recordDigest}), (error) => error.code === "PACK_LIFECYCLE_TRANSITION_INVALID");
  record = transitionPackLifecycle({record, action: "REQUEST_REVIEW", actor: "author", expectedRecordDigest: record.recordDigest});
  record = transitionPackLifecycle({record, action: "APPROVE", actor: "approver", expectedRecordDigest: record.recordDigest});
  assert.equal(record.stage, "APPROVED");
  assert.throws(() => transitionPackLifecycle({record, action: "PUBLISH", actor: "publisher", expectedRecordDigest: digest("stale")}), (error) => error.code === "PACK_LIFECYCLE_STALE");
});

test("v4.7 Pack tooling inspects dependencies and binds installation, successor, and rollback", () => {
  const domain = pack("DomainOntologyPack", "finance-domain", "finance");
  const product = pack("ProductOntologyPack", "crm-product", "crm", {imports: [{id: domain.metadata.id, version: domain.metadata.version, digest: domain.metadata.digest}]});
  const inspection = inspectProfessionalPack(product, {availablePacks: [domain]});
  assert.equal(inspection.lint.status, "PASSED");
  assert.equal(inspection.dependencies[0].status, "SATISFIED");
  assert.equal(validateDocument(inspection).status, "VALIDATED");

  let lifecycle = createPackLifecycleRecord({pack: product, targetRoot: "DOMAIN_TEAM", project: projectBinding(), dependencyClosure: {digest: digest("closure")}, conflictPreview: {digest: digest("conflicts")}});
  for (const [action, actor] of [["APPLY", "author"], ["REQUEST_REVIEW", "author"], ["APPROVE", "approver"], ["PUBLISH", "publisher"], ["INSTALL", "installer"], ["ACTIVATE", "operator"]]) {
    lifecycle = transitionPackLifecycle({record: lifecycle, action, actor, expectedRecordDigest: lifecycle.recordDigest});
  }
  assert.equal(lifecycle.stage, "ACTIVE");
  assert.throws(() => transitionPackLifecycle({record: lifecycle, action: "SUPERSEDE", actor: "approver", expectedRecordDigest: lifecycle.recordDigest}), (error) => error.code === "PACK_SUCCESSOR_BINDING_REQUIRED");
  const rolledBack = transitionPackLifecycle({record: lifecycle, action: "ROLLBACK", actor: "operator", expectedRecordDigest: lifecycle.recordDigest, rollbackTarget: domain});
  assert.equal(rolledBack.stage, "ROLLED_BACK");
  assert.equal(rolledBack.rollbackTarget.digest, domain.metadata.digest);
});

test("v4.7 Project Ontology resolves approved proposals into immutable snapshots and six deterministic projections", () => {
  const domain = pack("DomainOntologyPack", "finance-domain", "finance", {rules: [{ruleId: "finance:bounded-rule", expression: "finance:account -> finance:audited", bounded: true, evidenceRefs: ["source://rule"]}]});
  const proposal = createProjectOntologyProposal({project: projectBinding(), packs: [domain], targetRoot: "DOMAIN_TEAM", createdBy: "author", now: "2026-09-17T00:00:00.000Z"});
  assert.equal(validateDocument(proposal).status, "VALIDATED");
  assert.throws(() => resolveProjectOntologySnapshot({proposal, expectedProposalDigest: proposal.proposalDigest, foundationDigest: resolveOntologyFoundation().foundationDigest}), (error) => error.code === "PROJECT_ONTOLOGY_APPROVAL_REQUIRED");
  const approved = approve(proposal);
  const snapshot = resolveProjectOntologySnapshot({proposal: approved, expectedProposalDigest: approved.proposalDigest, foundationDigest: resolveOntologyFoundation().foundationDigest});
  const projections = createProjectionSet(snapshot);
  const skill = compileProjectOntologySkill({snapshot, projectionSet: projections, instructions: ["Use the canonical project terms."]});
  assert.equal(validateDocument(snapshot).status, "VALIDATED");
  assert.equal(validateDocument(projections).status, "VALIDATED");
  assert.equal(validateDocument(skill).status, "VALIDATED");
  assert.deepEqual(projections.projections.map((item) => item.format), ["JSON_LD", "OWL", "RDF_TURTLE", "SHACL", "SWRL", "YAML"]);
  assert.equal(skill.spec.truthSource, "ResolvedProjectOntologySnapshot");
  assert.equal(skill.authority.soleTruthStore, false);
});

test("v4.7 Artifact Set publication, installation, and activation each require independent transitions", () => {
  const proposal = approve(createProjectOntologyProposal({project: projectBinding(), packs: [pack("DomainOntologyPack", "finance-domain", "finance")], targetRoot: "DOMAIN_TEAM", createdBy: "author"}));
  const snapshot = resolveProjectOntologySnapshot({proposal, expectedProposalDigest: proposal.proposalDigest, foundationDigest: resolveOntologyFoundation().foundationDigest});
  assert.throws(() => publishProjectOntologyArtifactSet({snapshot, publication: {decision: "PENDING"}}), (error) => error.code === "PROJECT_ONTOLOGY_PUBLICATION_AUTHORIZATION_REQUIRED");
  const artifact = publishProjectOntologyArtifactSet({snapshot, publication: {decision: "AUTHORIZED", actor: "publisher", authorizationDigest: digest("publication"), version: "1.0.0", at: "2026-09-17T00:00:00.000Z"}});
  assert.equal(validateDocument(artifact).status, "VALIDATED");
  assert.equal(artifact.authority.automaticallyInstalled, false);
  assert.equal(artifact.spec.projectOntologySkill.spec.artifactSetManifestDigest, artifact.spec.manifest.manifestDigest);
  let lifecycle = createArtifactLifecycleRecord({artifactSet: artifact, action: "INSTALL", actor: "installer"});
  assert.equal(lifecycle.stage, "INSTALLED");
  lifecycle = createArtifactLifecycleRecord({artifactSet: artifact, record: lifecycle, action: "ACTIVATE", actor: "operator", expectedRecordDigest: lifecycle.recordDigest});
  assert.equal(lifecycle.stage, "ACTIVE");
});

test("v4.7 external semantic input and certification remain inactive advisory evidence", () => {
  const domain = pack("DomainOntologyPack", "finance-domain", "finance");
  const adapter = createExternalSemanticEvidenceAdapter({id: "rdf-import", version: "1.0.0", provenance: {author: "author", reviewers: ["reviewer"], approvers: [], publishers: [], sourceRefs: ["source://adapter"]}});
  const imported = importExternalSemanticEvidence({adapter, source: {id: "external-vocabulary", version: "1.0.0", digest: digest("vocabulary")}, records: [{recordId: "term-1", locator: "urn:external:term", contentDigest: digest("term"), observedTerms: ["account"]}]});
  const goldCase = createPackGoldCasePackage({id: "gold", version: "1.0.0", source: {id: "fixture", version: "1.0.0", digest: digest("fixture")}, expectedConcepts: ["finance:root"], expectedOutcome: "RESOLVED", provenance: {author: "author", reviewers: ["reviewer"], approvers: [], publishers: [], sourceRefs: ["source://fixture"]}});
  const benchmark = createPackBenchmarkPackage({id: "benchmark", version: "1.0.0", cases: [{id: goldCase.id, version: goldCase.version, digest: goldCase.goldCaseDigest}], metrics: ["precision", "recall"], provenance: {author: "author", reviewers: ["reviewer"], approvers: [], publishers: [], sourceRefs: ["source://benchmark"]}});
  const certification = createPackCertificationRecord({pack: domain, benchmark: {id: benchmark.id, version: benchmark.version, digest: benchmark.benchmarkDigest}, goldCases: [{id: goldCase.id, version: goldCase.version, digest: goldCase.goldCaseDigest}], algorithm: {id: "resolver", version: "1.0.0", digest: digest("resolver")}, policy: {id: "policy", version: "1.0.0", digest: digest("policy")}, toolchain: {id: "node", version: "22.14.0", digest: digest("node")}, qualityLevel: "REVIEWED", signer: {id: "optional-signer", signatureDigest: digest("signature")}, evidenceRefs: ["local://certification"]});
  assert.equal(validateDocument(adapter).status, "VALIDATED");
  assert.equal(validateDocument(goldCase).status, "VALIDATED");
  assert.equal(validateDocument(benchmark).status, "VALIDATED");
  assert.equal(validateDocument(imported).status, "VALIDATED");
  assert.equal(validateDocument(certification).status, "VALIDATED");
  assert.equal(imported.authority.inactiveEvidence, true);
  assert.equal(imported.adapter.digest, adapter.adapterDigest);
  assert.equal(certification.authority.automaticallyTrusted, false);
});


test("incomplete historical reasoning profile remains invalid", () => {
  assert.equal(validateDocument({kind: "OntologyReasoningProfile"}).status, "FAILED");
});
