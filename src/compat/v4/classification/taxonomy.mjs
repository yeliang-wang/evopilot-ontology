import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { isAlias, parseDocument, visit } from "yaml";
import { PACKAGE_ROOT } from "../../v3/constants.mjs";
import { canonicalJson, digest, persistedJson } from "../../v3/utils.mjs";

export const TAXONOMY_SCHEMA = "harness.evopilot.io/v1";
export const RESOLVED_TAXONOMY_SCHEMA = "evopilot-harness-resolved-taxonomy-snapshot/v1";
export const SEMANTIC_FOUNDATION_SCHEMA = "evopilot-harness-semantic-foundation/v1";
export const TAXONOMY_CANONICALIZATION = "taxonomy-c14n/v1";
export const SUPPORTED_TAXONOMY_CAPABILITIES = Object.freeze([
  TAXONOMY_CANONICALIZATION,
  "source-concept-hypothesis/v1",
  "open-world-taxonomy-classifier/v1",
  "taxonomy-decision-aggregate/v1"
]);
export const TAXONOMY_RESOURCE_LIMITS = Object.freeze({
  maxDocumentBytes: 1_048_576,
  maxNodes: 8_192,
  maxNodesPerAxis: 4_096,
  maxDepth: 32,
  maxAliasesPerNode: 32,
  maxParentsPerNode: 8,
  maxPositiveHintsPerNode: 32,
  maxExclusionHintsPerNode: 32,
  maxAliases: 65_536,
  maxHints: 131_072,
  maxClosureEdges: 262_144,
  maxLabelScalars: 256,
  maxAliasScalars: 256,
  maxDefinitionScalars: 4_096,
  maxHintScalars: 512
});

// Historical compatibility engine, independent of the new product version.
export const COMPATIBILITY_ENGINE_VERSION = "4.8.2";
const packageVersion = COMPATIBILITY_ENGINE_VERSION;
const ajv = new Ajv2020({ allErrors: true, strict: true });
let validateSchema;

export function loadTaxonomy(input) {
  if (input && typeof input === "object" && !Buffer.isBuffer(input)) {
    const document = persistedJson(input);
    assertDocumentBytes(Buffer.byteLength(canonicalJson(document)));
    return document;
  }
  const file = path.resolve(String(input));
  const bytes = fs.readFileSync(file);
  assertDocumentBytes(bytes.length);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw taxonomyError("TAXONOMY_SERIALIZATION_UNSAFE", "Taxonomy input must contain valid UTF-8 bytes."); }
  if (!/\.json$/i.test(file)) return parseDeclarativeTaxonomyYaml(text);
  try {
    return JSON.parse(text, (_key, value) => {
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite JSON number");
      return value;
    });
  } catch {
    throw taxonomyError("TAXONOMY_SERIALIZATION_UNSAFE", "Taxonomy JSON must be valid RFC 8259 data with finite numbers.");
  }
}

function parseDeclarativeTaxonomyYaml(text) {
  const reject = () => {
    throw taxonomyError("TAXONOMY_SERIALIZATION_UNSAFE", "Taxonomy YAML must be a single declarative document without anchors, aliases, merge keys, custom tags or duplicate keys.");
  };
  const document = parseDocument(text, { strict: true, uniqueKeys: true });
  if (document.errors.length || document.warnings.length) reject();
  visit(document, (_key, node) => {
    if (isAlias(node) || node?.anchor || node?.key?.value === "<<") reject();
    if (node?.tag && !node.tag.startsWith("tag:yaml.org,2002:")) reject();
  });
  return document.toJS({ maxAliasCount: 0 });
}

export function resolveTaxonomy(input) {
  const loaded = loadTaxonomy(input);
  const document = normalizeDocument(loaded);
  validateSchema ??= ajv.compile(JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "schemas/legacy/v1.json"), "utf8"))["taxonomy-v1.schema.json"]);
  if (!validateSchema(document)) throw taxonomyError("TAXONOMY_SCHEMA_INVALID", ajv.errorsText(validateSchema.errors, { separator: "; " }), validateSchema.errors);
  assertEngineRange(document.spec.engineRange);
  assertCapabilities(document.spec.requiredCapabilities);
  assertExpectedDigest(document);

  const axes = {};
  let nodeCount = 0;
  let aliasCount = 0;
  let hintCount = 0;
  let closureEdges = 0;
  for (const [axisName, sourceNodes, cardinality] of [
    ["domain", document.spec.domains, document.spec.axisPolicies.domainCardinality],
    ["product", document.spec.products, document.spec.axisPolicies.productCardinality]
  ]) {
    if (sourceNodes.length > TAXONOMY_RESOURCE_LIMITS.maxNodesPerAxis) throw taxonomyError("TAXONOMY_AXIS_NODE_LIMIT", `${axisName} has ${sourceNodes.length} nodes; maximum is ${TAXONOMY_RESOURCE_LIMITS.maxNodesPerAxis}.`);
    nodeCount += sourceNodes.length;
    const ids = new Set(sourceNodes.map((node) => node.id));
    if (ids.size !== sourceNodes.length) throw taxonomyError("TAXONOMY_ID_COLLISION", `${axisName} contains duplicate node ids.`);
    const names = new Map();
    for (const node of sourceNodes) {
      validateTextLimits(node);
      aliasCount += node.aliases.length;
      hintCount += node.positiveEvidenceHints.length + node.exclusionHints.length;
      for (const value of [node.id, node.label, ...node.aliases]) {
        const key = normalizeLabelAlias(value);
        if (names.has(key) && names.get(key) !== node.id) throw taxonomyError("TAXONOMY_ALIAS_COLLISION", `${axisName} value ${value} belongs to both ${names.get(key)} and ${node.id}.`);
        names.set(key, node.id);
      }
      for (const parentId of node.parents) if (!ids.has(parentId)) throw taxonomyError("TAXONOMY_PARENT_MISSING", `${axisName}/${node.id} references missing parent ${parentId}.`);
    }
    const byId = new Map(sourceNodes.map((node) => [node.id, node]));
    const resolvedNodes = sourceNodes.map((node) => {
      const ancestors = resolveAncestors(axisName, node, byId);
      closureEdges += ancestors.length;
      return { ...node, ancestors };
    });
    axes[axisName] = { cardinality, nodes: resolvedNodes };
  }
  if (nodeCount > TAXONOMY_RESOURCE_LIMITS.maxNodes) throw taxonomyError("TAXONOMY_NODE_LIMIT", `Taxonomy has ${nodeCount} nodes; maximum is ${TAXONOMY_RESOURCE_LIMITS.maxNodes}.`);
  if (aliasCount > TAXONOMY_RESOURCE_LIMITS.maxAliases) throw taxonomyError("TAXONOMY_ALIAS_LIMIT", `Taxonomy has ${aliasCount} aliases; maximum is ${TAXONOMY_RESOURCE_LIMITS.maxAliases}.`);
  if (hintCount > TAXONOMY_RESOURCE_LIMITS.maxHints) throw taxonomyError("TAXONOMY_HINT_LIMIT", `Taxonomy has ${hintCount} hints; maximum is ${TAXONOMY_RESOURCE_LIMITS.maxHints}.`);
  if (closureEdges > TAXONOMY_RESOURCE_LIMITS.maxClosureEdges) throw taxonomyError("TAXONOMY_CLOSURE_LIMIT", `Taxonomy hierarchy closure has ${closureEdges} edges; maximum is ${TAXONOMY_RESOURCE_LIMITS.maxClosureEdges}.`);

  const canonicalDocumentDigest = canonicalDocumentDigestFor(document);
  const core = {
    schema: RESOLVED_TAXONOMY_SCHEMA,
    canonicalization: { algorithm: TAXONOMY_CANONICALIZATION, json: "RFC-8785", unicode: "NFKC", hash: "SHA-256" },
    foundation: { schema: SEMANTIC_FOUNDATION_SCHEMA, axes: ["domain", "product"], relations: ["parent-of", "assignable-as"], businessValues: [] },
    taxonomy: { apiVersion: document.apiVersion, kind: document.kind, metadata: document.metadata, engineRange: document.spec.engineRange, requiredCapabilities: document.spec.requiredCapabilities, canonicalDocumentDigest },
    axes,
    resourceUsage: { canonicalDocumentBytes: Buffer.byteLength(canonicalJson(document)), nodeCount, aliasCount, hintCount, closureEdges, limits: TAXONOMY_RESOURCE_LIMITS }
  };
  core.taxonomyDigest = digest(core);
  return core;
}

export function canonicalDocumentDigestFor(value) {
  const document = normalizeDocument(value);
  if (document.spec) delete document.spec.expectedCanonicalDigest;
  return digest(canonicalJson(document));
}

function normalizeDocument(value) {
  const document = persistedJson(value);
  if (!document?.metadata || !document?.spec) return document;
  document.metadata = orderedObject(document.metadata);
  document.spec.requiredCapabilities = sortedUniqueCasePreserving(document.spec.requiredCapabilities);
  if (document.spec.axisPolicies) document.spec.axisPolicies = orderedObject(document.spec.axisPolicies);
  for (const listName of ["domains", "products"]) {
    if (!Array.isArray(document.spec[listName])) continue;
    document.spec[listName] = document.spec[listName].map((node) => ({
      ...node,
      label: normalizeLabelAlias(node.label),
      definition: node.definition == null ? undefined : normalizeCasePreserving(node.definition),
      aliases: sortedUniqueLabels(node.aliases),
      parents: sortedUniqueIds(node.parents),
      positiveEvidenceHints: sortedUniqueCasePreserving(node.positiveEvidenceHints),
      exclusionHints: sortedUniqueCasePreserving(node.exclusionHints)
    })).sort((left, right) => canonicalCompare(left.id, right.id));
  }
  return persistedJson(document);
}

export function normalizeTerm(value) {
  return normalizeLabelAlias(value).replace(/[\p{P}\p{S}_]+/gu, " ").replace(/\s+/gu, " ").trim();
}

export function canonicalCompare(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeLabelAlias(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function normalizeCasePreserving(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function sortedUniqueLabels(values = []) { return [...new Set(values.map(normalizeLabelAlias).filter(Boolean))].sort(canonicalCompare); }
function sortedUniqueIds(values = []) { return [...new Set(values.map(String).filter(Boolean))].sort(canonicalCompare); }
function sortedUniqueCasePreserving(values = []) { return [...new Set((values ?? []).map(normalizeCasePreserving).filter(Boolean))].sort(canonicalCompare); }
function orderedObject(value) { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => canonicalCompare(left, right))); }

function resolveAncestors(axisName, node, byId) {
  const ancestors = new Set();
  const visit = (nodeId, pathIds, depth) => {
    if (depth > TAXONOMY_RESOURCE_LIMITS.maxDepth) throw taxonomyError("TAXONOMY_DEPTH_LIMIT", `${axisName}/${node.id} exceeds hierarchy depth ${TAXONOMY_RESOURCE_LIMITS.maxDepth}.`);
    if (pathIds.has(nodeId)) throw taxonomyError("TAXONOMY_CYCLE", `${axisName}/${node.id} participates in a hierarchy cycle.`);
    const nextPath = new Set(pathIds).add(nodeId);
    for (const parentId of byId.get(nodeId).parents) {
      ancestors.add(parentId);
      visit(parentId, nextPath, depth + 1);
    }
  };
  visit(node.id, new Set(), 0);
  return [...ancestors].sort(canonicalCompare);
}

function validateTextLimits(node) {
  if (scalarLength(node.label) > TAXONOMY_RESOURCE_LIMITS.maxLabelScalars) throw taxonomyError("TAXONOMY_LABEL_LIMIT", `${node.id} label exceeds ${TAXONOMY_RESOURCE_LIMITS.maxLabelScalars} Unicode scalar values.`);
  for (const alias of node.aliases) if (scalarLength(alias) > TAXONOMY_RESOURCE_LIMITS.maxAliasScalars) throw taxonomyError("TAXONOMY_ALIAS_STRING_LIMIT", `${node.id} alias exceeds ${TAXONOMY_RESOURCE_LIMITS.maxAliasScalars} Unicode scalar values.`);
  if (node.definition && scalarLength(node.definition) > TAXONOMY_RESOURCE_LIMITS.maxDefinitionScalars) throw taxonomyError("TAXONOMY_DEFINITION_LIMIT", `${node.id} definition exceeds ${TAXONOMY_RESOURCE_LIMITS.maxDefinitionScalars} Unicode scalar values.`);
  for (const hint of [...node.positiveEvidenceHints, ...node.exclusionHints]) if (scalarLength(hint) > TAXONOMY_RESOURCE_LIMITS.maxHintScalars) throw taxonomyError("TAXONOMY_HINT_STRING_LIMIT", `${node.id} hint exceeds ${TAXONOMY_RESOURCE_LIMITS.maxHintScalars} Unicode scalar values.`);
}

function assertDocumentBytes(bytes) { if (bytes > TAXONOMY_RESOURCE_LIMITS.maxDocumentBytes) throw taxonomyError("TAXONOMY_RESOURCE_LIMIT", `Taxonomy exceeds ${TAXONOMY_RESOURCE_LIMITS.maxDocumentBytes} bytes.`); }
function scalarLength(value) { return [...String(value)].length; }

function assertEngineRange(range) {
  if (!engineRangeIncludes(String(range), packageVersion)) throw taxonomyError("TAXONOMY_ENGINE_RANGE_UNSUPPORTED", `Taxonomy Engine range ${range} does not include ${packageVersion}.`);
}

function engineRangeIncludes(range, version) {
  const current = version.split(".").map(Number);
  const clauses = range.trim().split(/\s+/).filter(Boolean);
  if (!clauses.length) return false;
  return clauses.every((clause) => {
    const match = clause.match(/^(>=|<=|>|<|=|\^|~)?(\d+)\.(\d+)\.(\d+)$/);
    if (!match) return false;
    const expected = match.slice(2).map(Number);
    const comparison = compareVersions(current, expected);
    switch (match[1] ?? "=") {
      case ">=": return comparison >= 0;
      case "<=": return comparison <= 0;
      case ">": return comparison > 0;
      case "<": return comparison < 0;
      case "^": return comparison >= 0 && current[0] === expected[0];
      case "~": return comparison >= 0 && current[0] === expected[0] && current[1] === expected[1];
      default: return comparison === 0;
    }
  });
}

function compareVersions(left, right) { for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index] - right[index]; return 0; }

function assertCapabilities(required) {
  const supported = new Set(SUPPORTED_TAXONOMY_CAPABILITIES);
  const missingRequired = SUPPORTED_TAXONOMY_CAPABILITIES.filter((capability) => !required.includes(capability));
  const unsupported = required.filter((capability) => !supported.has(capability));
  if (missingRequired.length || unsupported.length) throw taxonomyError("TAXONOMY_CAPABILITY_UNSUPPORTED", `Taxonomy capabilities must exactly bind the v4.5 classifier contract. Missing: ${missingRequired.join(", ") || "none"}; unsupported: ${unsupported.join(", ") || "none"}.`);
}

function assertExpectedDigest(document) {
  if (document.spec.expectedCanonicalDigest && document.spec.expectedCanonicalDigest !== canonicalDocumentDigestFor(document)) throw taxonomyError("TAXONOMY_DIGEST_DRIFT", "Taxonomy expectedCanonicalDigest does not match canonical content.");
}

function taxonomyError(code, message, details = []) {
  const error = new Error(message);
  error.name = "TaxonomyValidationError";
  error.code = code;
  error.details = details;
  error.nextAction = "revise-business-classification-scheme";
  return error;
}
