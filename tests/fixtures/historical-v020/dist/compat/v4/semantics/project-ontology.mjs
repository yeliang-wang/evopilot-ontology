import { digest, persistedJson } from "../../v3/utils.mjs";
import { resolveProfessionalPackSet } from "./professional-packs.mjs";

export const PROJECT_ONTOLOGY_PROPOSAL_SCHEMA = "evopilot-harness-project-ontology-proposal/v1";
export const RESOLVED_PROJECT_ONTOLOGY_SCHEMA = "evopilot-harness-resolved-project-ontology-snapshot/v1";
export const PROJECT_ONTOLOGY_ARTIFACT_SET_SCHEMA = "evopilot-harness-project-ontology-artifact-set/v1";
export const PROJECT_ONTOLOGY_SKILL_SCHEMA = "evopilot-harness-project-ontology-skill/v1";

export function createProjectOntologyProposal({ project, packs, precedence = [], targetRoot = "PRIVATE_ORGANIZATION", baseSnapshot = null, expectedBaseDigest = null, overlay = null, createdBy, now = new Date().toISOString() }) {
  const projectBinding = normalizeProjectBinding(project);
  const resolvedPackSet = resolveProfessionalPackSet({packs, precedence, targetRoot, baseSnapshot, expectedBaseDigest});
  const overlayBinding = overlay ? exactAssetBinding(overlay, "overlay") : null;
  if (overlay && overlay.kind !== "ProjectOntologyOverlay") throw ontologyError("PROJECT_ONTOLOGY_OVERLAY_KIND_INVALID", "overlay must be a ProjectOntologyOverlay.");
  if (overlayBinding && !resolvedPackSet.packs.some((pack) => pack.id === overlayBinding.id && pack.version === overlayBinding.version && pack.digest === overlayBinding.digest)) throw ontologyError("PROJECT_ONTOLOGY_OVERLAY_NOT_RESOLVED", "The exact Project Ontology Overlay must be part of the resolved Pack set.");
  const core = {
    schema: PROJECT_ONTOLOGY_PROPOSAL_SCHEMA,
    proposalId: `project-ontology-${projectBinding.id}-${resolvedPackSet.packSetDigest.slice(-12)}`,
    revision: 1,
    stage: "DRAFT",
    project: projectBinding,
    baseDigest: resolvedPackSet.baseDigest,
    resolvedPackSet,
    overlay: overlayBinding,
    conflictSet: [],
    createdBy: requiredText(createdBy, "createdBy"),
    createdAt: String(now),
    decisions: [],
    authority: {
      draftOnly: true,
      approvalIndependent: true,
      publicationIndependent: true,
      installationIndependent: true,
      activationIndependent: true,
      mayPublish: false,
      mayActivate: false
    }
  };
  core.proposalDigest = digest(core);
  return core;
}

export function transitionProjectOntologyProposal({ proposal, action, actor, expectedProposalDigest, reason = "", now = new Date().toISOString() }) {
  validateProposal(proposal);
  if (proposal.proposalDigest !== expectedProposalDigest) throw ontologyError("PROJECT_ONTOLOGY_PROPOSAL_STALE", "Project Ontology Proposal digest changed.");
  const transitions = {
    APPLY: ["DRAFT", "APPLIED"],
    REQUEST_REVIEW: ["APPLIED", "IN_REVIEW"],
    APPROVE: ["IN_REVIEW", "APPROVED"],
    REJECT: ["IN_REVIEW", "REJECTED"]
  };
  const transition = transitions[action];
  if (!transition || proposal.stage !== transition[0]) throw ontologyError("PROJECT_ONTOLOGY_PROPOSAL_TRANSITION_INVALID", `${action} cannot run from ${proposal.stage}.`);
  const decision = {action, from: transition[0], to: transition[1], actor: requiredText(actor, "actor"), reason: String(reason).trim(), at: String(now)};
  const next = {...persistedJson(proposal), stage: transition[1], decisions: [...proposal.decisions, decision]};
  next.revision += 1;
  next.authority = {...next.authority, draftOnly: next.stage !== "APPROVED"};
  delete next.proposalDigest;
  next.proposalDigest = digest(next);
  return next;
}

export function resolveProjectOntologySnapshot({ proposal, expectedProposalDigest, foundationDigest, priorSnapshot = null, now = null }) {
  validateProposal(proposal);
  if (proposal.stage !== "APPROVED") throw ontologyError("PROJECT_ONTOLOGY_APPROVAL_REQUIRED", "Only an explicitly approved Project Ontology Proposal can be resolved.");
  if (proposal.proposalDigest !== expectedProposalDigest) throw ontologyError("PROJECT_ONTOLOGY_PROPOSAL_STALE", "Project Ontology Proposal digest changed.");
  const priorBinding = priorSnapshot ? validateSnapshot(priorSnapshot) : null;
  if (priorBinding && priorBinding.project.id !== proposal.project.id) throw ontologyError("PROJECT_ONTOLOGY_PROJECT_MISMATCH", "Successor snapshot must remain bound to the same project.");
  const core = {
    schema: RESOLVED_PROJECT_ONTOLOGY_SCHEMA,
    project: proposal.project,
    foundationDigest: requiredDigest(foundationDigest, "foundationDigest"),
    proposalDigest: proposal.proposalDigest,
    baseDigest: proposal.baseDigest,
    packSetDigest: proposal.resolvedPackSet.packSetDigest,
    packs: proposal.resolvedPackSet.packs,
    dependencyGraph: proposal.resolvedPackSet.dependencyGraph,
    concepts: proposal.resolvedPackSet.concepts,
    overlay: proposal.overlay,
    predecessorSnapshotDigest: priorBinding?.snapshotDigest ?? null,
    resolvedAt: now == null ? null : String(now),
    authority: {
      immutable: true,
      fullyResolved: true,
      engineOwnedResolution: true,
      editable: false,
      published: false,
      active: false,
      mayApprove: false,
      mayPublish: false,
      mayActivate: false
    }
  };
  core.snapshotDigest = digest(core);
  return core;
}

export function createProjectionSet(snapshot) {
  validateSnapshot(snapshot);
  const applicable = {
    YAML: yamlProjection(snapshot),
    OWL: owlProjection(snapshot),
    RDF_TURTLE: turtleProjection(snapshot),
    JSON_LD: jsonLdProjection(snapshot),
    SHACL: shaclProjection(snapshot)
  };
  const projections = Object.entries(applicable).map(([format, content]) => projection(format, content, snapshot.snapshotDigest));
  const boundedRules = snapshot.concepts.flatMap((concept) => concept.relationships ?? []).filter((item) => item?.rule === true || item?.relationType === "RULE");
  projections.push(boundedRules.length > 0
    ? projection("SWRL", swrlProjection(snapshot, boundedRules), snapshot.snapshotDigest)
    : nonApplicableProjection("SWRL", "The resolved snapshot contains no bounded rule relationship; content was not fabricated.", snapshot.snapshotDigest));
  const core = {schema: "evopilot-harness-project-ontology-projection-set/v1", snapshotDigest: snapshot.snapshotDigest, projections: projections.sort((a, b) => a.format.localeCompare(b.format))};
  core.projectionSetDigest = digest(core);
  return core;
}

export function compileProjectOntologySkill({ snapshot, projectionSet = createProjectionSet(snapshot), artifactSetManifestDigest = null, instructions = [] }) {
  validateSnapshot(snapshot);
  validateProjectionSet(projectionSet, snapshot.snapshotDigest);
  const core = {
    schema: PROJECT_ONTOLOGY_SKILL_SCHEMA,
    kind: "ProjectOntologySkill",
    apiVersion: "semantics.evopilot.io/v1",
    metadata: {id: `${snapshot.project.id}-project-ontology`, version: "1.0.0", projectId: snapshot.project.id},
    spec: {
      snapshotDigest: snapshot.snapshotDigest,
      projectionSetDigest: projectionSet.projectionSetDigest,
      artifactSetManifestDigest: artifactSetManifestDigest == null ? null : requiredDigest(artifactSetManifestDigest, "artifactSetManifestDigest"),
      conceptIndex: snapshot.concepts.map((concept) => ({conceptId: concept.conceptId, label: concept.label, metaType: concept.metaType, definition: concept.definition})),
      instructions: unique(instructions),
      readOnly: true,
      truthSource: "ResolvedProjectOntologySnapshot",
      executable: false
    },
    authority: {guidanceProjectionOnly: true, soleTruthStore: false, mayMutateOntology: false, mayApprove: false, mayPublish: false, mayActivate: false}
  };
  core.skillDigest = digest(core);
  return core;
}

export function publishProjectOntologyArtifactSet({ snapshot, projectionSet = createProjectionSet(snapshot), skill = null, publication, dependencyLock = null }) {
  validateSnapshot(snapshot);
  validateProjectionSet(projectionSet, snapshot.snapshotDigest);
  const publicationBinding = normalizePublication(publication);
  const lock = dependencyLock ?? {
    packSetDigest: snapshot.packSetDigest,
    packs: snapshot.packs.map((pack) => ({id: pack.id, version: pack.version, digest: pack.digest})),
    dependencyGraph: snapshot.dependencyGraph
  };
  const manifest = {
    schema: "evopilot-harness-project-ontology-artifact-manifest/v1",
    project: snapshot.project,
    version: publicationBinding.version,
    snapshotDigest: snapshot.snapshotDigest,
    foundationDigest: snapshot.foundationDigest,
    packSetDigest: snapshot.packSetDigest,
    dependencyLockDigest: digest(lock),
    projectionSetDigest: projectionSet.projectionSetDigest,
    projectionInventory: projectionSet.projections.map((item) => ({format: item.format, status: item.status, contentDigest: item.contentDigest})),
    publicationAuthorizationDigest: publicationBinding.authorizationDigest
  };
  manifest.manifestDigest = digest(manifest);
  const canonicalSkill = skill ?? compileProjectOntologySkill({snapshot, projectionSet, artifactSetManifestDigest: manifest.manifestDigest});
  validateSkill(canonicalSkill, snapshot.snapshotDigest, projectionSet.projectionSetDigest, manifest.manifestDigest);
  const core = {
    schema: PROJECT_ONTOLOGY_ARTIFACT_SET_SCHEMA,
    kind: "ProjectOntologyArtifactSet",
    apiVersion: "semantics.evopilot.io/v1",
    metadata: {id: `${snapshot.project.id}-project-ontology-artifacts`, version: publicationBinding.version, projectId: snapshot.project.id},
    spec: {
      project: snapshot.project,
      manifest,
      snapshot,
      snapshotDigest: snapshot.snapshotDigest,
      foundationDigest: snapshot.foundationDigest,
      provenance: snapshot.packs.map((pack) => ({packId: pack.id, packVersion: pack.version, packDigest: pack.digest, provenance: pack.provenance})),
      dependencyLock: persistedJson(lock),
      projectionSet,
      projectOntologySkill: canonicalSkill,
      publication: publicationBinding
    },
    authority: {immutable: true, separatelyPublished: true, automaticallyInstalled: false, automaticallyActive: false, consumerReadOnly: true, mayGrantConsumerMutation: false}
  };
  core.artifactSetDigest = digest(core);
  return core;
}

export function createArtifactLifecycleRecord({ artifactSet, action, actor, actorRole = null, expectedRecordDigest = null, record = null, reason = "", successor = null, rollbackTarget = null, migrationPlan = null, now = new Date().toISOString() }) {
  validateArtifactSet(artifactSet);
  const current = record ? validateArtifactRecord(record, artifactSet.artifactSetDigest) : initialArtifactRecord(artifactSet.artifactSetDigest);
  if (expectedRecordDigest && expectedRecordDigest !== current.recordDigest) throw ontologyError("PROJECT_ONTOLOGY_ARTIFACT_LIFECYCLE_STALE", "Artifact lifecycle record digest changed.");
  const transitions = {INSTALL: ["PUBLISHED", "INSTALLED"], ACTIVATE: ["INSTALLED", "ACTIVE"], SUPERSEDE: ["ACTIVE", "SUPERSEDED"], ROLLBACK: ["ACTIVE", "ROLLED_BACK"], DEPRECATE: ["PUBLISHED", "DEPRECATED"]};
  const transition = transitions[action];
  if (!transition || current.stage !== transition[0]) throw ontologyError("PROJECT_ONTOLOGY_ARTIFACT_TRANSITION_INVALID", `${action} cannot run from ${current.stage}.`);
  const requiredRole = ({INSTALL: "INSTALLER", ACTIVATE: "ACTIVATOR", SUPERSEDE: "APPROVER", ROLLBACK: "ROLLBACK_OPERATOR", DEPRECATE: "PUBLISHER"})[action];
  const normalizedRole = String(actorRole ?? requiredRole);
  if (normalizedRole !== requiredRole) throw ontologyError("PROJECT_ONTOLOGY_ARTIFACT_ROLE_INVALID", `${action} requires role ${requiredRole}.`);
  const successorBinding = successor ? artifactBinding(successor, "successor") : null;
  const rollbackBinding = rollbackTarget ? artifactBinding(rollbackTarget, "rollbackTarget") : null;
  const migrationBinding = migrationPlan ? exactAssetBinding(migrationPlan, "migrationPlan") : null;
  if (action === "SUPERSEDE" && (!successorBinding || !migrationBinding)) throw ontologyError("PROJECT_ONTOLOGY_SUCCESSOR_BINDING_REQUIRED", "SUPERSEDE requires exact successor and migration-plan bindings.");
  if (action === "ROLLBACK" && !rollbackBinding) throw ontologyError("PROJECT_ONTOLOGY_ROLLBACK_TARGET_REQUIRED", "ROLLBACK requires an exact prior Artifact Set target.");
  const decision = {action, from: transition[0], to: transition[1], actor: requiredText(actor, "actor"), actorRole: normalizedRole, reason: String(reason).trim(), successor: successorBinding, rollbackTarget: rollbackBinding, migrationPlan: migrationBinding, at: String(now)};
  const next = {...current, stage: transition[1], history: [...current.history, decision]};
  if (successorBinding) next.successor = successorBinding;
  if (rollbackBinding) next.rollbackTarget = rollbackBinding;
  if (migrationBinding) next.migrationPlan = migrationBinding;
  delete next.recordDigest;
  next.recordDigest = digest(next);
  return next;
}

export function validateProjectOntologyDocument(value) {
  if (value?.schema === PROJECT_ONTOLOGY_PROPOSAL_SCHEMA) return validateProposal(value);
  if (value?.schema === RESOLVED_PROJECT_ONTOLOGY_SCHEMA) return validateSnapshot(value);
  if (value?.schema === PROJECT_ONTOLOGY_ARTIFACT_SET_SCHEMA || value?.kind === "ProjectOntologyArtifactSet") return validateArtifactSet(value);
  if (value?.schema === PROJECT_ONTOLOGY_SKILL_SCHEMA || value?.kind === "ProjectOntologySkill") return validateSkill(value);
  throw ontologyError("PROJECT_ONTOLOGY_DOCUMENT_UNSUPPORTED", "Unsupported Project Ontology document.");
}

function validateProposal(value) { return validateImmutable(value, PROJECT_ONTOLOGY_PROPOSAL_SCHEMA, "proposalDigest", "PROJECT_ONTOLOGY_PROPOSAL_INVALID"); }
function validateSnapshot(value) { return validateImmutable(value, RESOLVED_PROJECT_ONTOLOGY_SCHEMA, "snapshotDigest", "PROJECT_ONTOLOGY_SNAPSHOT_INVALID"); }
function validateArtifactSet(value) { return validateImmutable(value, PROJECT_ONTOLOGY_ARTIFACT_SET_SCHEMA, "artifactSetDigest", "PROJECT_ONTOLOGY_ARTIFACT_SET_INVALID"); }
function validateSkill(value, snapshotDigest = null, projectionSetDigest = null, artifactSetManifestDigest = null) { const result = validateImmutable(value, PROJECT_ONTOLOGY_SKILL_SCHEMA, "skillDigest", "PROJECT_ONTOLOGY_SKILL_INVALID"); if (snapshotDigest && result.spec.snapshotDigest !== snapshotDigest) throw ontologyError("PROJECT_ONTOLOGY_SKILL_STALE", "Project Ontology Skill is bound to a different snapshot."); if (projectionSetDigest && result.spec.projectionSetDigest !== projectionSetDigest) throw ontologyError("PROJECT_ONTOLOGY_SKILL_STALE", "Project Ontology Skill is bound to a different projection set."); if (artifactSetManifestDigest && result.spec.artifactSetManifestDigest !== artifactSetManifestDigest) throw ontologyError("PROJECT_ONTOLOGY_SKILL_STALE", "Project Ontology Skill is bound to a different Artifact Set manifest."); return result; }
function validateProjectionSet(value, snapshotDigest) { const result = validateImmutable(value, "evopilot-harness-project-ontology-projection-set/v1", "projectionSetDigest", "PROJECT_ONTOLOGY_PROJECTION_SET_INVALID"); if (result.snapshotDigest !== snapshotDigest) throw ontologyError("PROJECT_ONTOLOGY_PROJECTION_STALE", "Projection set is bound to a different snapshot."); return result; }
function validateImmutable(value, schema, digestField, code) { const copy = persistedJson(value ?? {}); const recorded = copy[digestField]; delete copy[digestField]; if (copy.schema !== schema || recorded !== digest(copy)) throw ontologyError(code, `${schema} is not immutable or digest-valid.`); return value; }

function normalizeProjectBinding(value = {}) { return {id: requiredText(value.id, "project.id"), workspaceId: requiredText(value.workspaceId, "project.workspaceId"), tenantId: requiredText(value.tenantId, "project.tenantId"), sourceSnapshotDigest: requiredDigest(value.sourceSnapshotDigest, "project.sourceSnapshotDigest")}; }
function exactAssetBinding(value = {}, field) { const digestValue = value.metadata?.digest ?? value.digest; return {id: requiredText(value.metadata?.id ?? value.id, `${field}.id`), version: requiredText(value.metadata?.version ?? value.version, `${field}.version`), digest: requiredDigest(digestValue, `${field}.digest`)}; }
function artifactBinding(value = {}, field) { return {id: requiredText(value.metadata?.id ?? value.id, `${field}.id`), version: requiredSemver(value.metadata?.version ?? value.version, `${field}.version`), digest: requiredDigest(value.artifactSetDigest ?? value.digest, `${field}.digest`)}; }
function normalizePublication(value = {}) { if (value.decision !== "AUTHORIZED") throw ontologyError("PROJECT_ONTOLOGY_PUBLICATION_AUTHORIZATION_REQUIRED", "Artifact Set publication requires a separate explicit AUTHORIZED decision."); return {decision: "AUTHORIZED", actor: requiredText(value.actor, "publication.actor"), authorizationDigest: requiredDigest(value.authorizationDigest, "publication.authorizationDigest"), version: requiredSemver(value.version, "publication.version"), at: requiredText(value.at, "publication.at")}; }
function projection(format, content, snapshotDigest) { const result = {format, status: "APPLICABLE", snapshotDigest, mediaType: mediaType(format), content}; result.contentDigest = digest(content); return result; }
function nonApplicableProjection(format, reason, snapshotDigest) { return {format, status: "NON_APPLICABLE", snapshotDigest, mediaType: mediaType(format), reason, content: null, contentDigest: null}; }
function yamlProjection(snapshot) { return snapshot.concepts.map((concept) => `- conceptId: ${quote(concept.conceptId)}\n  label: ${quote(concept.label)}\n  metaType: ${quote(concept.metaType)}\n  definition: ${quote(concept.definition)}`).join("\n"); }
function jsonLdProjection(snapshot) { return JSON.stringify({"@context": {id: "@id", type: "@type", label: "http://www.w3.org/2000/01/rdf-schema#label"}, "@graph": snapshot.concepts.map((concept) => ({id: concept.conceptId, type: concept.metaType, label: concept.label, definition: concept.definition}))}, null, 2); }
function turtleProjection(snapshot) { return snapshot.concepts.map((concept) => `<${iri(concept.conceptId)}> a <urn:evopilot:${concept.metaType}> ; <http://www.w3.org/2000/01/rdf-schema#label> ${quote(concept.label)} .`).join("\n"); }
function owlProjection(snapshot) { return `Ontology(<urn:evopilot:project:${snapshot.project.id}>\n${snapshot.concepts.map((concept) => ` Declaration(Class(<${iri(concept.conceptId)}>))`).join("\n")}\n)`; }
function shaclProjection(snapshot) { return snapshot.concepts.map((concept) => `<${iri(concept.conceptId)}Shape> a <http://www.w3.org/ns/shacl#NodeShape> ; <http://www.w3.org/ns/shacl#targetClass> <${iri(concept.conceptId)}> .`).join("\n"); }
function swrlProjection(snapshot, rules) { return rules.map((rule, index) => `# bounded-rule-${index + 1} ${JSON.stringify(rule)}`).join("\n"); }
function mediaType(format) { return ({YAML: "application/yaml", OWL: "application/owl+xml", RDF_TURTLE: "text/turtle", JSON_LD: "application/ld+json", SWRL: "text/plain", SHACL: "text/turtle"})[format]; }
function iri(value) { return `urn:evopilot:concept:${encodeURIComponent(value)}`; }
function quote(value) { return JSON.stringify(String(value)); }
function initialArtifactRecord(artifactSetDigest) { const value = {schema: "evopilot-harness-project-ontology-artifact-lifecycle/v1", artifactSetDigest, stage: "PUBLISHED", history: [], authority: {installationIndependent: true, activationIndependent: true, rollbackIndependent: true}}; value.recordDigest = digest(value); return value; }
function validateArtifactRecord(value, artifactSetDigest) { const result = validateImmutable(value, "evopilot-harness-project-ontology-artifact-lifecycle/v1", "recordDigest", "PROJECT_ONTOLOGY_ARTIFACT_LIFECYCLE_INVALID"); if (result.artifactSetDigest !== artifactSetDigest) throw ontologyError("PROJECT_ONTOLOGY_ARTIFACT_LIFECYCLE_STALE", "Artifact lifecycle record binds a different Artifact Set."); return result; }
function requiredText(value, field) { const result = String(value ?? "").trim(); if (!result) throw ontologyError("PROJECT_ONTOLOGY_FIELD_REQUIRED", `${field} is required.`); return result; }
function requiredDigest(value, field) { const result = String(value ?? ""); if (!/^sha256:[a-f0-9]{64}$/.test(result)) throw ontologyError("PROJECT_ONTOLOGY_DIGEST_REQUIRED", `${field} must be a sha256 digest.`); return result; }
function requiredSemver(value, field) { const result = requiredText(value, field); if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(result)) throw ontologyError("PROJECT_ONTOLOGY_VERSION_INVALID", `${field} must be exact SemVer.`); return result; }
function unique(values = []) { return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))].sort(); }
function ontologyError(code, message) { const error = new Error(message); error.name = "ProjectOntologyError"; error.code = code; error.nextAction = "repair-project-ontology-input-or-return-to-explicit-lifecycle-stage"; return error; }
