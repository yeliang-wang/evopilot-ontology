import { canonicalJson, digest } from "../../v3/utils.mjs";
import { validateDocument } from "../../v3/schema.mjs";

export const SEMANTIC_POINTER_SCHEMA = "evopilot-harness-semantic-catalog-pointer/v1";
export const SEMANTIC_CATALOG_SCHEMA = "evopilot-harness-semantic-catalog/v1";
export const SEMANTIC_RECEIPT_SCHEMA = "evopilot-harness-semantic-catalog-receipt/v1";
export const SEMANTIC_SUPPLY_LIMITS = Object.freeze({
  enabledRoots: 16, pointerBytes: 65536, generationBytes: 4194304,
  entries: 4096, materialBytes: 16777216, totalMaterialBytes: 268435456,
  dependencyEdges: 16384, dependencyDepth: 64, readerConcurrency: 4,
  snapshotRetryCount: 2, lockWaitMilliseconds: 5000, readTimeoutMilliseconds: 30000
});
const HASH = /^sha256:[a-f0-9]{64}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

// Deliberately finite, redacted diagnostics. Untrusted paths/content never become errors.
export function supplyError(code) {
  const error = new Error(`Semantic Catalog ${code}.`);
  error.name = "OntologyCatalogError";
  error.code = code;
  error.nextAction = ({UNAVAILABLE: "configure-published-semantic-catalog", CONFLICT: "review-catalog-head",
    UNKNOWN: "inspect-publication-receipt", LOCKED: "inspect-publication-receipt",
    PERMISSION_DENIED: "review-catalog-permission", CANCELLED: "inspect-publication-receipt"})[code] ?? "review-semantic-catalog";
  return error;
}

export function requireSupply(condition, code = "INVALID") {
  if (!condition) throw supplyError(code);
}

export function supplyLimits(overrides = {}) {
  requireSupply(overrides && typeof overrides === "object" && !Array.isArray(overrides), "BUDGET_INVALID");
  const limits = {...SEMANTIC_SUPPLY_LIMITS};
  for (const [key, value] of Object.entries(overrides)) {
    requireSupply(Object.hasOwn(limits, key) && Number.isSafeInteger(value) &&
      value >= (key === "snapshotRetryCount" ? 0 : 1) && value <= limits[key], "BUDGET_INVALID");
    limits[key] = value;
  }
  return Object.freeze(limits);
}

export function isSupplyDigest(value) { return typeof value === "string" && HASH.test(value); }
export function isSupplyId(value) { return typeof value === "string" && ID.test(value); }
export function isSupplyVersion(value) { return typeof value === "string" && VERSION.test(value); }
export function supplyBytes(value) { return Buffer.from(`${canonicalJson(value)}\n`); }
export function parseSupplyJson(bytes, maxDepth = 64) {
  // Bound nesting before JSON.parse/canonical hashing; do not recurse into hostile JSON.
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const byte of bytes) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (byte === 92) escaped = true;
      else if (byte === 34) quoted = false;
    } else if (byte === 34) quoted = true;
    else if (byte === 123 || byte === 91) { depth++; requireSupply(depth <= maxDepth, "DEPTH_LIMIT"); }
    else if (byte === 125 || byte === 93) depth--;
  }
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw supplyError("INVALID_JSON"); }
}
export function withSupplyDigest(value, field) { return {...value, [field]: digest(value)}; }
export function validateSupplyDigest(value, field, schema) {
  requireSupply(value?.schema === schema, "UNSUPPORTED");
  const copy = {...value};
  delete copy[field];
  requireSupply(isSupplyDigest(value[field]) && value[field] === digest(copy), "DIGEST_MISMATCH");
  // Pointer/generation callers preserve their finite path/resource diagnostics first.
  if (![SEMANTIC_POINTER_SCHEMA, SEMANTIC_CATALOG_SCHEMA].includes(schema)) {
    requireSupply(validateDocument(value).valid, "WIRE_SCHEMA_INVALID");
  }
  return value;
}
export function supplyRelativePath(value) {
  requireSupply(typeof value === "string" && value.length <= 1024 &&
    /^(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(value) &&
    value.split("/").every(part => part !== "." && part !== ".."), "PATH_DENIED");
  return value;
}
export function contentPath(category, hash) {
  requireSupply(["materials", "generations", "heads", "receipts"].includes(category) && isSupplyDigest(hash));
  return `semantic-catalog/${category}/${hash.slice(7)}.json`;
}
export function validateSupplyScope(scope) {
  requireSupply(scope && ["tenantId", "workspaceId", "projectId"].every(key => isSupplyId(scope[key])), "SCOPE_INVALID");
  requireSupply(Object.keys(scope).length === 3, "SCOPE_INVALID");
  return scope;
}

export function validateSupplyGraph(entries, limits = SEMANTIC_SUPPLY_LIMITS) {
  requireSupply(Array.isArray(entries) && entries.length <= limits.entries, "ENTRY_LIMIT");
  const identities = new Map();
  const byDigest = new Map();
  let edges = 0;
  let totalBytes = 0;
  const materialPaths = new Map();
  for (const entry of entries) {
    requireSupply(entry && isSupplyId(entry.kind) && isSupplyId(entry.id) &&
      (isSupplyVersion(entry.version) || (entry.category === "DEPENDENCY" && entry.version === null)) &&
      typeof entry.schema === "string" && isSupplyDigest(entry.objectDigest) && isSupplyDigest(entry.fileDigest));
    validateSupplyScope(entry.scope);
    requireSupply(["PUBLIC", "DOMAIN", "PRIVATE"].includes(entry.visibility), "SCOPE_INVALID");
    requireSupply(entry.provenance && typeof entry.provenance === "object" && !Array.isArray(entry.provenance));
    requireSupply(Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= limits.materialBytes, "MATERIAL_LIMIT");
    requireSupply(supplyRelativePath(entry.path) === contentPath("materials", entry.fileDigest), "PATH_DENIED");
    const identity = canonicalJson([entry.scope, entry.kind, entry.id, entry.version, entry.parent?.artifactSetDigest ?? null]);
    requireSupply(!identities.has(identity), "IDENTITY_CONFLICT");
    identities.set(identity, entry.objectDigest);
    const scopedDigest = digest([entry.scope, entry.objectDigest]);
    requireSupply(!byDigest.has(scopedDigest), "IDENTITY_CONFLICT");
    byDigest.set(scopedDigest, entry);
    if (!materialPaths.has(entry.path)) { totalBytes += entry.bytes; materialPaths.set(entry.path, entry.bytes); }
    else requireSupply(materialPaths.get(entry.path) === entry.bytes, "DIGEST_MISMATCH");
    requireSupply(totalBytes <= limits.totalMaterialBytes, "TOTAL_MATERIAL_LIMIT");
    requireSupply(Array.isArray(entry.dependencies) && new Set(entry.dependencies).size === entry.dependencies.length);
    edges += entry.dependencies.length;
    requireSupply(edges <= limits.dependencyEdges, "EDGE_LIMIT");
    if (entry.kind === "ProjectOntologySkill") {
      requireSupply(entry.parent?.jsonPointer === "/spec/projectOntologySkill" && isSupplyDigest(entry.parent.artifactSetDigest), "PARENT_INVALID");
    } else requireSupply(entry.parent === null, "PARENT_INVALID");
  }
  // Iterative traversal bounds depth before recursive object/graph processing.
  const complete = new Map();
  for (const entry of entries) {
    const active = new Set();
    const stack = [{entry, exit: false}];
    while (stack.length) {
      const node = stack.pop();
      const key = digest([node.entry.scope, node.entry.objectDigest]);
      if (node.exit) {
        active.delete(key);
        const height = 1 + Math.max(0, ...node.entry.dependencies.map(dep => complete.get(digest([node.entry.scope, dep]))));
        requireSupply(height <= limits.dependencyDepth, "DEPTH_LIMIT");
        complete.set(key, height);
        continue;
      }
      requireSupply(!active.has(key), "DEPENDENCY_CYCLE");
      if (complete.has(key)) continue;
      active.add(key);
      requireSupply(active.size <= limits.dependencyDepth, "DEPTH_LIMIT");
      stack.push({...node, exit: true});
      for (const dep of node.entry.dependencies) {
        const dependency = byDigest.get(digest([node.entry.scope, dep]));
        requireSupply(isSupplyDigest(dep), "MATERIAL_MISSING");
        if (!dependency && entries.some(item => item.objectDigest === dep)) throw supplyError("SCOPE_INVALID");
        requireSupply(dependency, "MATERIAL_MISSING");
        stack.push({entry: dependency, exit: false});
      }
    }
  }
  for (const entry of entries.filter(item => item.kind === "ProjectOntologySkill")) {
    const parent = byDigest.get(digest([entry.scope, entry.parent.artifactSetDigest]));
    requireSupply(parent?.kind === "ProjectOntologyArtifactSet" && parent.path === entry.path &&
      parent.fileDigest === entry.fileDigest && parent.bytes === entry.bytes &&
      entry.dependencies.includes(parent.objectDigest), "PARENT_INVALID");
  }
  return {entryCount: entries.length, dependencyEdges: edges, totalMaterialBytes: totalBytes};
}

export function validateSemanticGeneration(generation, limits = SEMANTIC_SUPPLY_LIMITS) {
  validateSupplyDigest(generation, "generationDigest", SEMANTIC_CATALOG_SCHEMA);
  requireSupply(isSupplyId(generation.catalogId));
  requireSupply(supplyBytes(generation).length <= limits.generationBytes, "GENERATION_LIMIT");
  requireSupply(Array.isArray(generation.revokedDigests) && generation.revokedDigests.length <= limits.entries &&
    generation.revokedDigests.every(isSupplyDigest) && new Set(generation.revokedDigests).size === generation.revokedDigests.length);
  requireSupply(generation.entries?.length > 0 || generation.revokedDigests.length > 0, "MATERIAL_MISSING");
  validateSupplyGraph(generation.entries, limits);
  requireSupply(!generation.entries.some(entry => generation.revokedDigests.includes(entry.objectDigest) ||
    entry.dependencies.some(dep => generation.revokedDigests.includes(dep))), "REVOKED");
  requireSupply(validateDocument(generation).valid, "WIRE_SCHEMA_INVALID");
  return generation;
}

export function validateSemanticPointer(pointer, limits = SEMANTIC_SUPPLY_LIMITS) {
  validateSupplyDigest(pointer, "pointerDigest", SEMANTIC_POINTER_SCHEMA);
  requireSupply(isSupplyId(pointer.catalogId) && isSupplyDigest(pointer.generationDigest) &&
    (pointer.previousPointerDigest === null || isSupplyDigest(pointer.previousPointerDigest)) &&
    isSupplyDigest(pointer.receiptDigest));
  requireSupply(pointer.generationPath === contentPath("generations", pointer.generationDigest), "PATH_DENIED");
  requireSupply(supplyBytes(pointer).length <= limits.pointerBytes, "POINTER_LIMIT");
  requireSupply(validateDocument(pointer).valid, "WIRE_SCHEMA_INVALID");
  return pointer;
}
