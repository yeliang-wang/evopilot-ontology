import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveTaxonomy, TAXONOMY_RESOURCE_LIMITS } from "../../src/compat/v4/classification/taxonomy.mjs";

const capabilities = [
  "taxonomy-c14n/v1",
  "source-concept-hypothesis/v1",
  "open-world-taxonomy-classifier/v1",
  "taxonomy-decision-aggregate/v1"
];

function node(id, overrides = {}) {
  return { id, label: `label ${id}`, assignable: false, ...overrides };
}

function taxonomy({ namespace = "user.example", name = "classification", domains = [node("domain")], products = [node("product")], engineRange = ">=4.5.0 <5.0.0", requiredCapabilities = capabilities } = {}) {
  return {
    apiVersion: "harness.evopilot.io/v1",
    kind: "Taxonomy",
    metadata: { namespace, name, version: "1.0.0" },
    spec: {
      engineRange,
      requiredCapabilities,
      axisPolicies: { domainCardinality: "SINGLE", productCardinality: "SINGLE" },
      domains,
      products
    }
  };
}

function expectAccepted(value, assertion) {
  const resolved = resolveTaxonomy(value);
  assertion?.(resolved);
}

function expectRejected(value, code) {
  assert.throws(() => resolveTaxonomy(value), (error) => error.code === code, `expected ${code}`);
}

test("taxonomy-c14n/v1 enforces identifier and Unicode scalar boundaries at boundary and boundary+1", () => {
  const segment63 = "a".repeat(63);
  const namespace253 = `${segment63}.${segment63}.${segment63}.${"a".repeat(61)}`;
  expectAccepted(taxonomy({ namespace: namespace253, name: segment63, domains: [node(segment63)] }));
  expectRejected(taxonomy({ namespace: `${namespace253}a` }), "TAXONOMY_SCHEMA_INVALID");
  expectRejected(taxonomy({ namespace: `a.${"b".repeat(64)}` }), "TAXONOMY_SCHEMA_INVALID");
  expectRejected(taxonomy({ name: "a".repeat(64) }), "TAXONOMY_SCHEMA_INVALID");
  expectRejected(taxonomy({ domains: [node("a".repeat(64))] }), "TAXONOMY_SCHEMA_INVALID");

  expectAccepted(taxonomy({ domains: [node("label-boundary", { label: "😀".repeat(256) })] }));
  expectRejected(taxonomy({ domains: [node("label-over", { label: "😀".repeat(257) })] }), "TAXONOMY_LABEL_LIMIT");
  expectAccepted(taxonomy({ domains: [node("alias-boundary", { aliases: ["😀".repeat(256)] })] }));
  expectRejected(taxonomy({ domains: [node("alias-over", { aliases: ["😀".repeat(257)] })] }), "TAXONOMY_ALIAS_STRING_LIMIT");
  expectAccepted(taxonomy({ domains: [node("definition-boundary", { assignable: true, definition: "😀".repeat(4096) })] }));
  expectRejected(taxonomy({ domains: [node("definition-over", { assignable: true, definition: "😀".repeat(4097) })] }), "TAXONOMY_DEFINITION_LIMIT");
  expectAccepted(taxonomy({ domains: [node("hint-boundary", { positiveEvidenceHints: ["😀".repeat(512)] })] }));
  expectRejected(taxonomy({ domains: [node("hint-over", { positiveEvidenceHints: ["😀".repeat(513)] })] }), "TAXONOMY_HINT_STRING_LIMIT");
});

test("taxonomy-c14n/v1 enforces document, node, axis, hierarchy and per-node collection boundaries", () => {
  const compact = JSON.stringify(taxonomy());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-taxonomy-size-"));
  const acceptedFile = path.join(root, "accepted.json");
  const rejectedFile = path.join(root, "rejected.json");
  fs.writeFileSync(acceptedFile, `${compact}${" ".repeat(TAXONOMY_RESOURCE_LIMITS.maxDocumentBytes - Buffer.byteLength(compact))}`);
  fs.writeFileSync(rejectedFile, `${compact}${" ".repeat(TAXONOMY_RESOURCE_LIMITS.maxDocumentBytes + 1 - Buffer.byteLength(compact))}`);
  expectAccepted(acceptedFile);
  expectRejected(rejectedFile, "TAXONOMY_RESOURCE_LIMIT");

  const domains4096 = Array.from({ length: 4096 }, (_, index) => node(`d${index.toString(36)}`));
  const products4096 = Array.from({ length: 4096 }, (_, index) => node(`p${index.toString(36)}`));
  expectAccepted(taxonomy({ domains: domains4096 }));
  expectRejected(taxonomy({ domains: [...domains4096, node("d-over")] }), "TAXONOMY_SCHEMA_INVALID");
  expectAccepted(taxonomy({ domains: domains4096, products: products4096 }), (resolved) => assert.equal(resolved.resourceUsage.nodeCount, 8192));

  const chain = Array.from({ length: 33 }, (_, index) => node(`depth-${index}`, { parents: index === 0 ? [] : [`depth-${index - 1}`] }));
  expectAccepted(taxonomy({ domains: chain.slice(0, 33) }));
  expectRejected(taxonomy({ domains: [...chain, node("depth-33", { parents: ["depth-32"] })] }), "TAXONOMY_DEPTH_LIMIT");

  const roots = Array.from({ length: 9 }, (_, index) => node(`root-${index}`));
  expectAccepted(taxonomy({ domains: [...roots.slice(0, 8), node("eight-parents", { parents: roots.slice(0, 8).map((item) => item.id) })] }));
  expectRejected(taxonomy({ domains: [...roots, node("nine-parents", { parents: roots.map((item) => item.id) })] }), "TAXONOMY_SCHEMA_INVALID");

  const aliases32 = Array.from({ length: 32 }, (_, index) => `alias-${index}`);
  expectAccepted(taxonomy({ domains: [node("aliases-32", { aliases: aliases32 })] }));
  expectRejected(taxonomy({ domains: [node("aliases-33", { aliases: [...aliases32, "alias-over"] })] }), "TAXONOMY_SCHEMA_INVALID");
  const hints32 = Array.from({ length: 32 }, (_, index) => `hint-${index}`);
  expectAccepted(taxonomy({ domains: [node("positive-32", { positiveEvidenceHints: hints32 }), node("exclusion-32", { exclusionHints: hints32 })] }));
  expectRejected(taxonomy({ domains: [node("positive-33", { positiveEvidenceHints: [...hints32, "hint-over"] })] }), "TAXONOMY_SCHEMA_INVALID");
  expectRejected(taxonomy({ domains: [node("exclusion-33", { exclusionHints: [...hints32, "hint-over"] })] }), "TAXONOMY_SCHEMA_INVALID");
});

test("taxonomy-c14n/v1 enforces aggregate alias, hint and closure boundaries at boundary and boundary+1", () => {
  const aliasNodes = Array.from({ length: 2048 }, (_, nodeIndex) => node(`alias-node-${nodeIndex.toString(36)}`, {
    aliases: Array.from({ length: 32 }, (_, aliasIndex) => `a-${nodeIndex.toString(36)}-${aliasIndex.toString(36)}`)
  }));
  expectAccepted(taxonomy({ domains: aliasNodes }), (resolved) => assert.equal(resolved.resourceUsage.aliasCount, 65536));
  expectRejected(taxonomy({ domains: [...aliasNodes, node("alias-total-over", { aliases: ["one-extra-alias"] })] }), "TAXONOMY_ALIAS_LIMIT");

  const oneCharacterHints = Array.from({ length: 32 }, (_, index) => String.fromCodePoint(0x21 + index));
  const hintNodes = Array.from({ length: 2048 }, (_, index) => node(`hint-node-${index.toString(36)}`, {
    positiveEvidenceHints: oneCharacterHints,
    exclusionHints: oneCharacterHints
  }));
  expectAccepted(taxonomy({ domains: hintNodes }), (resolved) => assert.equal(resolved.resourceUsage.hintCount, 131072));
  expectRejected(taxonomy({ domains: [...hintNodes, node("hint-total-over", { positiveEvidenceHints: ["x"] })] }), "TAXONOMY_HINT_LIMIT");

  function closureAxis(prefix) {
    const compactNode = (id, parents = []) => ({ id, label: id, assignable: false, parents });
    const chain = Array.from({ length: 32 }, (_, index) => compactNode(`${prefix}c${index.toString(36)}`, index === 0 ? [] : [`${prefix}c${(index - 1).toString(36)}`]));
    const secondRoot = compactNode(`${prefix}r`);
    const descendants = Array.from({ length: 4063 }, (_, index) => compactNode(`${prefix}n${index.toString(36)}`,
      index < 560 ? [`${prefix}cv`, `${prefix}r`] : [`${prefix}cv`]
    ));
    return [...chain, secondRoot, ...descendants];
  }
  const closureDomains = closureAxis("d");
  const closureProducts = closureAxis("p");
  expectAccepted(taxonomy({ domains: closureDomains, products: closureProducts }), (resolved) => assert.equal(resolved.resourceUsage.closureEdges, 262144));
  const closureOver = structuredClone(closureProducts);
  closureOver[33 + 560].parents.push("pr");
  expectRejected(taxonomy({ domains: closureDomains, products: closureOver }), "TAXONOMY_CLOSURE_LIMIT");
});
