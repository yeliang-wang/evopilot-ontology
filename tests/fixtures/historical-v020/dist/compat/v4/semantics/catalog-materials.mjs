import { digest } from "../../v3/utils.mjs";
import { validateDocument } from "../../v3/schema.mjs";
import { resolveOntologyFoundation } from "./ontology-grounding.mjs";
import { resolveProfessionalPackSet, validateProfessionalPack } from "./professional-packs.mjs";
import { compileProjectOntologySkill, createProjectionSet, publishProjectOntologyArtifactSet, resolveProjectOntologySnapshot, validateProjectOntologyDocument } from "./project-ontology.mjs";
import {
  buildSemanticIndex, createInteroperabilityProjectionSet, createTerminalSemanticClosure,
  publishTerminalSemanticClosure, validateSemanticInteroperabilityDocument, verifySemanticRoundTrip
} from "./semantic-interoperability.mjs";
import { requireSupply, supplyError, supplyLimits, supplyBytes, parseSupplyJson } from "./catalog-contract.mjs";

const SUPPORT_DIGEST_FIELDS = Object.freeze({
  "evopilot-harness-resolved-professional-pack-set/v1": "packSetDigest",
  "evopilot-harness-semantic-round-trip-report/v1": "reportDigest",
  "evopilot-harness-semantic-computation/v1": "computationDigest",
  "evopilot-harness-project-ontology-artifact-lifecycle/v1": "recordDigest",
  "evopilot-harness-pack-lifecycle-record/v1": "recordDigest",
  "evopilot-harness-resolved-project-ontology-snapshot/v1": "snapshotDigest"
});
const key = value => `${value.kind}:${value.id ?? value.metadata?.id}@${value.version ?? value.metadata?.version}`;
function exact(left, right, code = "BINDING_MISMATCH") { requireSupply(digest(left) === digest(right), code); }
function schema(value) { requireSupply(validateDocument(value).valid === true, "UNSUPPORTED"); }
function immutable(value, field) {
  const core = {...value};
  delete core[field];
  requireSupply(value[field] === digest(core), "DIGEST_MISMATCH");
}

/** Validate actual supplied materials, not status labels or digest-only promises.
 * The caller must separately establish configured Catalog membership, current
 * permission and independent publication decisions. This pure validator grants none.
 */
export function validateSemanticSupplyMaterials(input, {limits: overrides} = {}) {
  try { return validate(input, supplyLimits(overrides)); }
  catch (error) { throw error?.name === "OntologyCatalogError" ? error : supplyError("MATERIAL_INVALID"); }
}

function validate(input, limits) {
  requireSupply(input && typeof input === "object", "MATERIAL_MISSING");
  const {artifactSet, closure, foundation, proposal, packs, profile, index, projectionSet,
    roundTripReport, incremental, full, support, harnessAssets, priorSnapshot = null, basePackSet = null} = input;
  const required = {artifactSet, closure, foundation, proposal, profile, index, projectionSet, roundTripReport, incremental, full};
  let totalBytes = 0;
  requireSupply(Array.isArray(packs) && packs.length > 0 && Array.isArray(support) && Array.isArray(harnessAssets), "MATERIAL_MISSING");
  requireSupply(Object.keys(required).length + packs.length + support.length + harnessAssets.length <= limits.entries, "ENTRY_LIMIT");
  for (const value of [...Object.values(required), ...packs, ...support.map(item => item.document), ...harnessAssets.map(item => item.document),
    ...(priorSnapshot ? [priorSnapshot] : []), ...(basePackSet ? [basePackSet] : [])]) {
    requireSupply(value && typeof value === "object", "MATERIAL_MISSING");
    const bytes = supplyBytes(value);
    requireSupply(bytes.length <= limits.materialBytes, "MATERIAL_LIMIT");
    totalBytes += bytes.length;
    requireSupply(totalBytes <= limits.totalMaterialBytes, "TOTAL_MATERIAL_LIMIT");
    parseSupplyJson(bytes);
    schema(value);
  }
  for (const value of [artifactSet, artifactSet.spec.snapshot, artifactSet.spec.projectOntologySkill, proposal]) validateProjectOntologyDocument(value);
  for (const value of [closure, profile, index, projectionSet, roundTripReport, incremental, full]) validateSemanticInteroperabilityDocument(value);
  exact(foundation, resolveOntologyFoundation(foundation), "FOUNDATION_MISMATCH");
  const snapshot = artifactSet.spec.snapshot;
  exact(snapshot, resolveProjectOntologySnapshot({proposal, expectedProposalDigest: proposal.proposalDigest,
    foundationDigest: foundation.foundationDigest, priorSnapshot, now: snapshot.resolvedAt}), "SNAPSHOT_MISMATCH");
  requireSupply((snapshot.predecessorSnapshotDigest ?? null) === (priorSnapshot?.snapshotDigest ?? null), "MATERIAL_MISSING");
  immutable(proposal.resolvedPackSet, "packSetDigest");
  exact(proposal.resolvedPackSet, resolveProfessionalPackSet({packs, targetRoot: proposal.resolvedPackSet.targetRoot,
    precedence: snapshot.packs.map(pack => `${pack.id}@${pack.version}`), baseSnapshot: basePackSet,
    expectedBaseDigest: snapshot.baseDigest}), "PACK_SET_MISMATCH");
  exact(snapshot.packSetDigest, proposal.resolvedPackSet.packSetDigest);
  requireSupply(packs.length === snapshot.packs.length, "PACK_MISMATCH");
  const packKeys = new Set();
  for (const pack of packs) {
    validateProfessionalPack(pack);
    requireSupply(!packKeys.has(key(pack)), "IDENTITY_CONFLICT");
    packKeys.add(key(pack));
    const bound = snapshot.packs.find(item => item.id === pack.metadata.id && item.version === pack.metadata.version);
    requireSupply(bound?.digest === pack.metadata.digest && bound.kind === pack.kind &&
      bound.namespace === pack.metadata.namespace && bound.root === pack.metadata.root && bound.visibility === pack.metadata.visibility, "PACK_MISMATCH");
    exact(bound.provenance, pack.metadata.provenance, "PROVENANCE_MISMATCH");
  }
  requireSupply(snapshot.dependencyGraph.length <= limits.entries &&
    snapshot.dependencyGraph.reduce((sum, node) => sum + node.imports.length, 0) <= limits.dependencyEdges, "EDGE_LIMIT");
  exact(artifactSet.spec.projectionSet, createProjectionSet(snapshot), "PROJECTION_MISMATCH");
  exact(artifactSet.spec.projectOntologySkill, compileProjectOntologySkill({snapshot,
    projectionSet: artifactSet.spec.projectionSet, artifactSetManifestDigest: artifactSet.spec.manifest.manifestDigest,
    instructions: artifactSet.spec.projectOntologySkill.spec.instructions}), "SKILL_MISMATCH");
  exact(artifactSet, publishProjectOntologyArtifactSet({snapshot, projectionSet: artifactSet.spec.projectionSet,
    skill: artifactSet.spec.projectOntologySkill, publication: artifactSet.spec.publication,
    dependencyLock: artifactSet.spec.dependencyLock}), "ARTIFACT_SET_MISMATCH");
  exact(artifactSet.spec.dependencyLock, {packSetDigest: snapshot.packSetDigest,
    packs: snapshot.packs.map(pack => ({id: pack.id, version: pack.version, digest: pack.digest})),
    dependencyGraph: snapshot.dependencyGraph}, "DEPENDENCY_LOCK_MISMATCH");
  exact(index, buildSemanticIndex({snapshot, assets: index.assets, algorithm: index.algorithm,
    policy: index.policy, toolchain: index.toolchain, cache: index.cache}), "INDEX_MISMATCH");
  requireSupply(index.nodes.length <= limits.entries && index.edges.length <= limits.dependencyEdges, "EDGE_LIMIT");
  exact(projectionSet, createInteroperabilityProjectionSet({snapshot, profile, index,
    externalMappings: projectionSet.externalMappings, multilingualTerms: projectionSet.multilingualTerms}), "PROJECTION_MISMATCH");
  exact(roundTripReport, verifySemanticRoundTrip({snapshot, projectionSet, index, incremental, full}), "ROUND_TRIP_MISMATCH");
  requireSupply(roundTripReport.status === "PASSED", "ROUND_TRIP_FAILED");
  requireSupply(closure.status === "PUBLISHED" && closure.publication?.decision === "AUTHORIZED", "PUBLICATION_REQUIRED");
  exact(closure, publishTerminalSemanticClosure({closure: createTerminalSemanticClosure({snapshot, profile, index, projectionSet,
    roundTripReport, harnessAssets: closure.harnessAssets, dependencyLocks: closure.dependencyLocks,
    evaluations: closure.evaluations, rollbackLinks: closure.rollbackLinks, provenance: closure.provenance}),
    publication: closure.publication}), "CLOSURE_MISMATCH");

  const supportKeys = new Set();
  for (const item of support) {
    requireSupply(item.binding && item.document, "MATERIAL_MISSING");
    const field = SUPPORT_DIGEST_FIELDS[item.document.schema];
    requireSupply(field, "UNSUPPORTED");
    immutable(item.document, field);
    requireSupply(item.binding.digest === item.document[field], "DIGEST_MISMATCH");
    const id = `${item.binding.id}@${item.binding.version}`;
    requireSupply(!supportKeys.has(id), "IDENTITY_CONFLICT");
    supportKeys.add(id);
  }
  for (const binding of [...closure.dependencyLocks, ...closure.evaluations, ...closure.rollbackLinks]) {
    requireSupply(support.some(item => item.binding.id === binding.id && item.binding.version === binding.version && item.binding.digest === binding.digest), "MATERIAL_MISSING");
  }
  const supportFor = binding => support.find(item => item.binding.id === binding.id && item.binding.version === binding.version).document;
  for (const binding of closure.dependencyLocks) exact(supportFor(binding), proposal.resolvedPackSet, "DEPENDENCY_LOCK_MISMATCH");
  for (const binding of closure.evaluations) {
    const evidence = supportFor(binding);
    requireSupply([roundTripReport.reportDigest, incremental.computationDigest, full.computationDigest].includes(binding.digest) &&
      (evidence.reportDigest === roundTripReport.reportDigest || evidence.computationDigest === incremental.computationDigest || evidence.computationDigest === full.computationDigest), "EVALUATION_MISMATCH");
  }
  for (const binding of closure.rollbackLinks) {
    const evidence = supportFor(binding);
    requireSupply((evidence.schema === "evopilot-harness-project-ontology-artifact-lifecycle/v1" &&
      evidence.artifactSetDigest === artifactSet.artifactSetDigest) || (priorSnapshot && evidence.snapshotDigest === priorSnapshot.snapshotDigest), "ROLLBACK_MISMATCH");
  }
  // Original v3 Catalog entries stay the source of Harness identity and publication.
  const assets = new Map();
  for (const {entry, document} of harnessAssets) {
    requireSupply(entry && document?.apiVersion === "harness.evopilot.io/v3" &&
      ["HarnessBundle", "HarnessProfile", "HarnessComponent"].includes(document.kind), "UNSUPPORTED");
    requireSupply(entry.kind === document.kind && entry.id === document.metadata.id && entry.version === document.metadata.version &&
      entry.lifecycle === "published" && document.metadata.lifecycle === "published" && entry.assetDigest === digest(document), "HARNESS_BINDING_MISMATCH");
    requireSupply(!assets.has(key(entry)), "IDENTITY_CONFLICT");
    assets.set(key(entry), {entry, document});
  }
  for (const binding of [...closure.harnessAssets, ...index.assets.filter(item => item.kind.startsWith("Harness"))]) {
    requireSupply(assets.get(key(binding))?.entry.assetDigest === binding.digest, "HARNESS_BINDING_MISMATCH");
  }
  for (const {document} of assets.values()) {
    if (document.kind === "HarnessProfile") {
      for (const ref of document.spec.components) requireSupply(assets.has(key({...ref, kind: "HarnessComponent"})), "HARNESS_BINDING_MISMATCH");
    }
    if (document.kind === "HarnessBundle") {
      for (const ref of [{...document.spec.profile, kind: "HarnessProfile"},
        ...document.spec.resolvedComponents.map(item => ({...item, kind: "HarnessComponent"}))]) {
        requireSupply(assets.get(key(ref))?.entry.assetDigest === ref.digest, "HARNESS_BINDING_MISMATCH");
      }
    }
  }
  return {status: "VALIDATED", scope: {tenantId: snapshot.project.tenantId, workspaceId: snapshot.project.workspaceId, projectId: snapshot.project.id},
    artifactSetDigest: artifactSet.artifactSetDigest, skillDigest: artifactSet.spec.projectOntologySkill.skillDigest,
    closureDigest: closure.closureDigest, closureVersion: closure.version, snapshotDigest: snapshot.snapshotDigest,
    totalMaterialBytes: totalBytes, grantsPublicationAuthority: false, grantsConsumerMutation: false};
}
