import fs from "node:fs";
import { digest } from "../../src/compat/v3/utils.mjs";

import { resolveOntologyFoundation } from "../../src/compat/v4/semantics/ontology-grounding.mjs";
import { createProfessionalPack } from "../../src/compat/v4/semantics/professional-packs.mjs";
import { createArtifactLifecycleRecord, createProjectOntologyProposal, publishProjectOntologyArtifactSet,
  resolveProjectOntologySnapshot, transitionProjectOntologyProposal } from "../../src/compat/v4/semantics/project-ontology.mjs";
import { buildSemanticIndex, calculateAffectedSubgraph, computeSemanticState, createInteroperabilityProjectionSet,
  createOntologyReasoningProfile, createTerminalSemanticClosure, publishTerminalSemanticClosure,
  verifySemanticRoundTrip } from "../../src/compat/v4/semantics/semantic-interoperability.mjs";

export function semanticSupplyFixture({projectId = "fixture-project"} = {}) {
  const now = "2026-09-21T00:00:00.000Z";
  const foundation = resolveOntologyFoundation();
  const pack = createProfessionalPack({kind: "DomainOntologyPack", metadata: {id: "fixture-domain", version: "1.0.0",
    name: "Synthetic fixture", namespace: "fixture", root: "DOMAIN_TEAM", visibility: "DOMAIN", owner: "fixture-team",
    provenance: {author: "author", reviewers: ["reviewer"], approvers: ["approver"], publishers: ["publisher"], sourceRefs: ["source://synthetic"]}},
    spec: {concepts: [{conceptId: "fixture:entity", label: "Fixture entity", metaType: "ENTITY", definition: "Synthetic entity for local tests.", evidenceRefs: ["source://synthetic"]}]}});
  let proposal = createProjectOntologyProposal({project: {id: projectId, workspaceId: "fixture-workspace", tenantId: "fixture-tenant",
    sourceSnapshotDigest: digest("synthetic-source")}, packs: [pack], createdBy: "author", targetRoot: "DOMAIN_TEAM", now});
  for (const [action, actor] of [["APPLY", "author"], ["REQUEST_REVIEW", "reviewer"], ["APPROVE", "approver"]]) {
    proposal = transitionProjectOntologyProposal({proposal, action, actor, expectedProposalDigest: proposal.proposalDigest, now});
  }
  const snapshot = resolveProjectOntologySnapshot({proposal, expectedProposalDigest: proposal.proposalDigest, foundationDigest: foundation.foundationDigest, now});
  const artifactSet = publishProjectOntologyArtifactSet({snapshot, publication: {decision: "AUTHORIZED", actor: "publisher",
    authorizationDigest: digest("synthetic-artifact-publication"), version: "1.0.0", at: now}});
  const rollback = createArtifactLifecycleRecord({artifactSet, action: "INSTALL", actor: "installer", now});
  // Read-only bootstrap assets provide real v3 schema/reference material. Never publish them.
  const selected = JSON.parse(fs.readFileSync(new URL("./harness-materials.json", import.meta.url), "utf8")).materials.map(({document: asset}) => ({asset}));
  const harnessAssets = selected.map(({asset}) => ({document: asset, entry: {kind: asset.kind, id: asset.metadata.id, version: asset.metadata.version,
    lifecycle: asset.metadata.lifecycle, assetDigest: digest(asset), assetPath: "./assets/synthetic-only.yaml"}}));
  const bindings = harnessAssets.map(({entry}) => ({kind: entry.kind, id: entry.id, version: entry.version, digest: entry.assetDigest}));
  const profile = createOntologyReasoningProfile({id: "fixture-profile", version: "1.0.0", mode: "RDFS"});
  const index = buildSemanticIndex({snapshot, assets: bindings});
  const full = computeSemanticState({index, profile, mode: "FULL"});
  const affectedSubgraph = calculateAffectedSubgraph({index, profile, changedConceptIds: ["fixture:entity"]});
  const incremental = computeSemanticState({index, profile, mode: "INCREMENTAL", affectedSubgraph});
  const projectionSet = createInteroperabilityProjectionSet({snapshot, profile, index});
  const roundTripReport = verifySemanticRoundTrip({snapshot, projectionSet, index, incremental, full});
  const support = [
    {binding: {id: "lock", version: "1.0.0", digest: proposal.resolvedPackSet.packSetDigest}, document: proposal.resolvedPackSet},
    {binding: {id: "evaluation", version: "1.0.0", digest: roundTripReport.reportDigest}, document: roundTripReport},
    {binding: {id: "rollback", version: "1.0.0", digest: rollback.recordDigest}, document: rollback}
  ];
  const closure = publishTerminalSemanticClosure({closure: createTerminalSemanticClosure({snapshot, profile, index, projectionSet, roundTripReport,
    harnessAssets: bindings, dependencyLocks: [support[0].binding], evaluations: [{...support[1].binding, kind: "Evaluation"}],
    rollbackLinks: [support[2].binding], provenance: {producer: "evopilot-harness", sourceRefs: ["source://synthetic"], generatedByDigest: digest("fixture")}}),
    publication: {decision: "AUTHORIZED", actor: "publisher", authorizationDigest: digest("synthetic-closure-publication"), version: "4.8.0", at: now}});
  return {artifactSet, closure, foundation, proposal, packs: [pack], profile, index, projectionSet, roundTripReport, incremental, full, support, harnessAssets};
}
