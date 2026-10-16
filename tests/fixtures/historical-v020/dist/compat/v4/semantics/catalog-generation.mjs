import { digest } from "../../v3/utils.mjs";
import { assertNoSensitiveMaterial } from "../security/sensitive.mjs";
import { validateSemanticSupplyMaterials } from "./catalog-materials.mjs";
import { SEMANTIC_CATALOG_SCHEMA, contentPath, requireSupply, supplyBytes, supplyError, supplyLimits,
  validateSemanticGeneration, withSupplyDigest } from "./catalog-contract.mjs";

const ROLES = Object.freeze({artifactSet: ["ProjectOntologyArtifactSet", "artifactSetDigest"],
  closure: ["TerminalSemanticClosure", "closureDigest"], foundation: ["OntologyFoundation", "foundationDigest"],
  proposal: ["ProjectOntologyProposal", "proposalDigest"], profile: ["OntologyReasoningProfile", "profileDigest"],
  index: ["SemanticIndex", "indexDigest"], projectionSet: ["SemanticProjectionSet", "projectionSetDigest"],
  roundTripReport: ["SemanticRoundTripReport", "reportDigest"], incremental: ["SemanticComputation", "computationDigest"],
  full: ["SemanticComputation", "computationDigest"], priorSnapshot: ["ResolvedProjectOntologySnapshot", "snapshotDigest"],
  basePackSet: ["ResolvedProfessionalPackSet", "packSetDigest"]});

// Pure assembly: no filesystem writes, publication, installation or activation.
export function assembleSemanticGeneration({catalogId, sets, revokedDigests = [], limits: overrides}) {
  const limits = supplyLimits(overrides);
  try {
    requireSupply(Array.isArray(sets) && sets.length <= limits.entries, "ENTRY_LIMIT");
    const entries = new Map();
    const material = new Map();
    const descriptions = [];
    const setIdentities = new Set();
    for (const input of [...sets].sort((a, b) => digest(a) < digest(b) ? -1 : digest(a) > digest(b) ? 1 : 0)) {
      const verified = validateSemanticSupplyMaterials(input, {limits});
      const scope = verified.scope;
      const setIdentity = digest([scope, verified.closureDigest]);
      requireSupply(!setIdentities.has(setIdentity), "IDENTITY_CONFLICT");
      setIdentities.add(setIdentity);
      // Visibility is conservative for the entire closure, not only the displayed entry.
      const visibility = input.packs.some(pack => pack.metadata.visibility === "PRIVATE") ? "PRIVATE" :
        input.packs.some(pack => pack.metadata.visibility === "DOMAIN") ? "DOMAIN" : "PUBLIC";
      function add(document, kind, objectDigest, options = {}) {
        assertNoSensitiveMaterial(document);
        const bytes = supplyBytes(document);
        const fileDigest = digest(bytes);
        const relative = contentPath("materials", fileDigest);
        const category = options.category ?? "DEPENDENCY";
        const entry = {kind, id: options.id ?? document.metadata?.id ?? `${kind}-${objectDigest.slice(7, 31)}`,
          version: options.version ?? (category === "DEPENDENCY" ? null : document.metadata?.version ?? document.version),
          schema: document.schema ?? document.apiVersion, category, objectDigest, fileDigest,
          bytes: bytes.length, path: relative, scope, visibility, provenance: {source: "HarnessSemanticSupply", documentDigest: objectDigest},
          publication: options.publication ?? null, parent: null, dependencies: options.dependencies ?? []};
        const entryKey = digest([scope, objectDigest]);
        const existing = entries.get(entryKey);
        if (existing) {
          requireSupply(existing.fileDigest === fileDigest, "IDENTITY_CONFLICT");
          // Shared dependencies inherit the most restrictive visibility of all users.
          const rank = {PUBLIC: 0, DOMAIN: 1, PRIVATE: 2};
          if (rank[visibility] > rank[existing.visibility]) existing.visibility = visibility;
        }
        else entries.set(entryKey, entry);
        material.set(relative, document);
        return objectDigest;
      }
      const refs = {};
      for (const [role, [kind, field]] of Object.entries(ROLES)) {
        if (input[role] == null) continue;
        refs[role] = add(input[role], kind, input[role][field], {
          category: ["artifactSet", "closure"].includes(role) ? "ASSET" : "DEPENDENCY",
          publication: role === "artifactSet" ? input.artifactSet.spec.publication : role === "closure" ? input.closure.publication : null
        });
      }
      refs.packs = input.packs.map(pack => add(pack, pack.kind, pack.metadata.digest));
      refs.support = input.support.map(item => ({binding: item.binding,
        ref: add(item.document, "SemanticSupportingMaterial", item.binding.digest)}));
      refs.harnessAssets = input.harnessAssets.map(item => ({entry: item.entry,
        ref: add(item.document, item.document.kind, item.entry.assetDigest)}));
      const artifactEntry = entries.get(digest([scope, refs.artifactSet]));
      const skill = input.artifactSet.spec.projectOntologySkill;
      const skillEntry = {...artifactEntry, kind: "ProjectOntologySkill", id: skill.metadata.id,
        version: skill.metadata.version, schema: skill.schema, objectDigest: skill.skillDigest,
        parent: {artifactSetDigest: refs.artifactSet, jsonPointer: "/spec/projectOntologySkill"},
        publication: null, dependencies: [refs.artifactSet]};
      entries.set(digest([scope, skill.skillDigest]), skillEntry);
      refs.skill = skill.skillDigest;
      const dependencyRefs = [];
      for (const role of Object.keys(ROLES)) if (refs[role] && role !== "closure") dependencyRefs.push(refs[role]);
      dependencyRefs.push(...refs.packs, ...refs.support.map(item => item.ref), ...refs.harnessAssets.map(item => item.ref));
      entries.get(digest([scope, refs.closure])).dependencies = [...new Set(dependencyRefs)].sort();
      artifactEntry.dependencies = [...new Set([refs.foundation, refs.proposal, ...refs.packs])].sort();
      descriptions.push({scope, refs});
    }
    for (const entry of entries.values()) if (entry.parent) {
      entry.visibility = entries.get(digest([entry.scope, entry.parent.artifactSetDigest])).visibility;
    }
    const generation = withSupplyDigest({schema: SEMANTIC_CATALOG_SCHEMA, catalogId,
      sets: descriptions.sort((a, b) => digest(a).localeCompare(digest(b))),
      entries: [...entries.values()].sort((a, b) => digest([a.scope, a.kind, a.id, a.version, a.objectDigest]).localeCompare(digest([b.scope, b.kind, b.id, b.version, b.objectDigest]))),
      revokedDigests: [...new Set(revokedDigests)].sort()}, "generationDigest");
    validateSemanticGeneration(generation, limits);
    return {generation, material};
  } catch (error) { throw error?.name === "OntologyCatalogError" ? error : supplyError("MATERIAL_INVALID"); }
}

export function resolveSemanticGeneration({generation, material, limits: overrides}) {
  const limits = supplyLimits(overrides);
  validateSemanticGeneration(generation, limits);
  requireSupply(Array.isArray(generation.sets) && generation.sets.length <= limits.entries, "UNSUPPORTED");
  requireSupply(material instanceof Map, "MATERIAL_MISSING");
  const entries = new Map(generation.entries.map(entry => [digest([entry.scope, entry.objectDigest]), entry]));
  const sets = generation.sets.map(({scope, refs}) => {
    function resolve(hash) {
      const entry = entries.get(digest([scope, hash]));
      requireSupply(entry && entry.parent === null, "MATERIAL_MISSING");
      const document = material.get(entry.path);
      requireSupply(document, "MATERIAL_MISSING");
      requireSupply(digest(supplyBytes(document)) === entry.fileDigest && supplyBytes(document).length === entry.bytes, "DIGEST_MISMATCH");
      return document;
    }
    const set = {};
    for (const role of Object.keys(ROLES)) if (refs[role]) set[role] = resolve(refs[role]);
    set.packs = refs.packs.map(resolve);
    set.support = refs.support.map(item => ({binding: item.binding, document: resolve(item.ref)}));
    set.harnessAssets = refs.harnessAssets.map(item => ({entry: item.entry, document: resolve(item.ref)}));
    requireSupply(set.artifactSet?.spec.projectOntologySkill.skillDigest === refs.skill, "PARENT_INVALID");
    return set;
  });
  // Reassembly also rejects extra entries, forged metadata and alternate graphs.
  const rebuilt = assembleSemanticGeneration({catalogId: generation.catalogId, sets, revokedDigests: generation.revokedDigests, limits});
  requireSupply(rebuilt.generation.generationDigest === generation.generationDigest, "GENERATION_MISMATCH");
  return sets;
}
