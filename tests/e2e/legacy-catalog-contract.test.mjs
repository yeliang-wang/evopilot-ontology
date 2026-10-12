import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "../../src/compat/v3/utils.mjs";
import { validateDocument } from "../../src/compat/v3/schema.mjs";
import { createSupplyBudget } from "../../src/compat/v4/semantics/catalog-budget.mjs";
import { SEMANTIC_CATALOG_SCHEMA, SEMANTIC_POINTER_SCHEMA, SEMANTIC_RECEIPT_SCHEMA,
  SEMANTIC_SUPPLY_LIMITS, contentPath, parseSupplyJson, supplyBytes, supplyLimits,
  validateSemanticGeneration, validateSemanticPointer, validateSupplyDigest,
  validateSupplyGraph, withSupplyDigest } from "../../src/compat/v4/semantics/catalog-contract.mjs";

const code = expected => error => error.code === expected;
const scope = {tenantId: "tenant", workspaceId: "workspace", projectId: "project"};
const authorization = {decision: "AUTHORIZED", actor: "fixture", authorizationDigest: digest("fixture-only")};
function entry(i, bytes = 1) {
  const hash = digest(`fixture-${i}`);
  return {kind: "Fixture", id: `entry-${i}`, version: "1.0.0", schema: "synthetic/v1", objectDigest: hash,
    fileDigest: hash, path: contentPath("materials", hash), bytes, scope, visibility: "PRIVATE",
    provenance: {source: "synthetic"}, dependencies: [], parent: null};
}
function rehash(value, field, extra = {}) {
  const copy = {...structuredClone(value), ...extra};
  delete copy[field];
  return withSupplyDigest(copy, field);
}
function records() {
  const generation = withSupplyDigest({schema: SEMANTIC_CATALOG_SCHEMA, catalogId: "fixture",
    entries: [entry(0)], revokedDigests: []}, "generationDigest");
  const receipt = withSupplyDigest({schema: SEMANTIC_RECEIPT_SCHEMA, catalogId: "fixture", generationDigest: generation.generationDigest,
    expectedHead: null, action: "PUBLISH", requestDigest: digest("request"), authorization}, "receiptDigest");
  const pointer = withSupplyDigest({schema: SEMANTIC_POINTER_SCHEMA, catalogId: "fixture", generationDigest: generation.generationDigest,
    generationPath: contentPath("generations", generation.generationDigest), previousPointerDigest: null, receiptDigest: receipt.receiptDigest}, "pointerDigest");
  const lock = withSupplyDigest({schema: "evopilot-harness-semantic-catalog-lock/v1", catalogId: "fixture",
    nonce: "01234567-89ab-4cde-8123-0123456789ab", pid: 1, hostDigest: digest("host"), rootDigest: digest("root"),
    expectedHead: null, requestDigest: receipt.requestDigest, receiptDigest: receipt.receiptDigest}, "lockDigest");
  const recovery = withSupplyDigest({schema: "evopilot-harness-semantic-catalog-recovery/v1", catalogId: "fixture",
    lockDigest: lock.lockDigest, expectedHead: null, recoveryRequestDigest: digest("recovery"),
    publicationRequestDigest: receipt.requestDigest, publicationOutcome: "COMMITTED", authorization}, "recoveryDigest");
  return {generation, pointer, receipt, lock, recovery};
}

test("five wire schemas validate typed records and reject unknown or missing fields", () => {
  for (const value of Object.values(records())) {
    assert.equal(validateDocument(value).valid, true);
    assert.equal(validateDocument({...value, approval: true}).valid, false);
    const missing = {...value}; delete missing.catalogId;
    assert.equal(validateDocument(missing).valid, false);
  }
});

test("rehashed unknown wire fields fail closed without masking finite path diagnostics", () => {
  const {generation, pointer, receipt, lock, recovery} = records();
  assert.throws(() => validateSemanticGeneration(rehash(generation, "generationDigest", {extra: true})), code("WIRE_SCHEMA_INVALID"));
  assert.throws(() => validateSemanticPointer(rehash(pointer, "pointerDigest", {extra: true})), code("WIRE_SCHEMA_INVALID"));
  for (const [value, field] of [[receipt, "receiptDigest"], [lock, "lockDigest"], [recovery, "recoveryDigest"]]) {
    assert.throws(() => validateSupplyDigest(rehash(value, field, {extra: true}), field, value.schema), code("WIRE_SCHEMA_INVALID"));
  }
  assert.throws(() => validateSemanticPointer(rehash(pointer, "pointerDigest", {generationPath: "../outside"})), code("PATH_DENIED"));
  const invalid = rehash(generation, "generationDigest", {entries: [{...generation.entries[0], path: "https://example.invalid/material"}]});
  assert.throws(() => validateSemanticGeneration(invalid), code("PATH_DENIED"));
});

test("wire schemas reject wrong field types, decision injection and invalid outcomes", () => {
  const {generation, receipt, lock, recovery} = records();
  for (const value of [{...generation, entries: [{...entry(0), bytes: "1"}]},
    {...receipt, authorization: {...authorization, execute: true}}, {...receipt, action: "EXECUTE"},
    {...lock, pid: 0}, {...lock, nonce: "not-an-owner-id"}, {...recovery, publicationOutcome: "SUCCEEDED"}]) {
    assert.equal(validateDocument(value).valid, false);
  }
});

test("every configurable resource maximum is exact and zero is retry-only", () => {
  for (const [key, maximum] of Object.entries(SEMANTIC_SUPPLY_LIMITS)) {
    assert.equal(supplyLimits({[key]: maximum})[key], maximum);
    assert.throws(() => supplyLimits({[key]: maximum + 1}), code("BUDGET_INVALID"));
    if (key === "snapshotRetryCount") assert.equal(supplyLimits({[key]: 0})[key], 0);
    else assert.throws(() => supplyLimits({[key]: 0}), code("BUDGET_INVALID"));
  }
});

test("actual graph entry boundary is 4096, not a raised test-only limit", () => {
  const entries = Array.from({length: 4096}, (_, i) => entry(i));
  assert.equal(validateSupplyGraph(entries).entryCount, 4096);
  assert.throws(() => validateSupplyGraph([...entries, entry(4096)]), code("ENTRY_LIMIT"));
});

test("actual graph edge boundary is 16384 with acyclic distinct dependencies", () => {
  const leaves = Array.from({length: 128}, (_, i) => entry(i));
  const parents = Array.from({length: 128}, (_, i) => ({...entry(i + 128), dependencies: leaves.map(item => item.objectDigest)}));
  assert.equal(validateSupplyGraph([...leaves, ...parents]).dependencyEdges, 16384);
  assert.throws(() => validateSupplyGraph([...leaves, ...parents, {...entry(256), dependencies: [leaves[0].objectDigest]}]), code("EDGE_LIMIT"));
});

test("actual graph depth accepts 64 and rejects 65 in either entry order", () => {
  const chain = length => Array.from({length}, (_, i) => ({...entry(i), dependencies: i ? [entry(i - 1).objectDigest] : []}));
  for (const reverse of [false, true]) {
    const allowed = chain(64), denied = chain(65);
    assert.equal(validateSupplyGraph(reverse ? allowed.reverse() : allowed).entryCount, 64);
    assert.throws(() => validateSupplyGraph(reverse ? denied.reverse() : denied), code("DEPTH_LIMIT"));
  }
});

test("metadata accounting enforces 16 MiB per material and 256 MiB unique aggregate", () => {
  // Accounting assertions only: this is not a claim to have read 256 MiB from disk.
  const entries = Array.from({length: 16}, (_, i) => entry(i, 16777216));
  assert.equal(validateSupplyGraph(entries).totalMaterialBytes, 268435456);
  assert.throws(() => validateSupplyGraph([entry(0, 16777217)]), code("MATERIAL_LIMIT"));
  assert.throws(() => validateSupplyGraph([...entries, entry(16)]), code("TOTAL_MATERIAL_LIMIT"));
});

test("canonical pointer and generation bytes accept exact tightened budgets and reject one-over", () => {
  const {pointer, generation} = records();
  for (const [value, validate, budget, error] of [[pointer, validateSemanticPointer, "pointerBytes", "POINTER_LIMIT"],
    [generation, validateSemanticGeneration, "generationBytes", "GENERATION_LIMIT"]]) {
    const size = supplyBytes(value).length;
    assert.equal(validate(value, supplyLimits({[budget]: size})), value);
    assert.throws(() => validate(value, supplyLimits({[budget]: size - 1})), code(error));
  }
});

test("JSON parser accepts nesting 64, rejects 65, and ignores escaped delimiters", () => {
  assert.ok(parseSupplyJson(Buffer.from("[".repeat(64) + "0" + "]".repeat(64))));
  assert.throws(() => parseSupplyJson(Buffer.from("[".repeat(65) + "0" + "]".repeat(65))), code("DEPTH_LIMIT"));
  const text = '[{"value":"\\\"[{}]\\\\"}]';
  assert.deepEqual(parseSupplyJson(Buffer.from(text), 2), JSON.parse(text));
  assert.throws(() => parseSupplyJson(Buffer.from("[invalid]")), code("INVALID_JSON"));
});

test("one monotonic deadline is exact and remains exhausted across nested checks", async t => {
  let now = 100;
  t.mock.method(performance, "now", () => now);
  const check = createSupplyBudget();
  now += 29999;
  assert.equal(check.remaining(), 1);
  assert.equal(await check.wait(() => "read-only"), "read-only");
  now++;
  assert.throws(check, code("TIMEOUT"));
  now = 0; // A stopped operation cannot resurrect even if a test clock goes backward.
  await assert.rejects(check.wait(() => assert.fail("must not run")), code("TIMEOUT"));
});

test("synchronous policy overruns cannot win a promise race with a delayed timeout timer", async t => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const check = createSupplyBudget({readTimeoutMilliseconds: 10});
  await assert.rejects(check.wait(() => {now = 11; return true;}), code("TIMEOUT"));
});

test("cancellation during a pending read-only callback is sticky and does not invoke later work", async () => {
  const controller = new AbortController();
  const check = createSupplyBudget(undefined, controller.signal);
  const waiting = check.wait(() => new Promise(() => {}));
  controller.abort();
  await assert.rejects(waiting, code("CANCELLED"));
  await assert.rejects(check.wait(() => assert.fail("cancelled callback must not run")), code("CANCELLED"));
});
