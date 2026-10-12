import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { digest } from "../../src/compat/v3/utils.mjs";
import {
  SEMANTIC_CATALOG_SCHEMA, SEMANTIC_POINTER_SCHEMA, SEMANTIC_RECEIPT_SCHEMA, SEMANTIC_SUPPLY_LIMITS, contentPath, supplyBytes, supplyLimits,
  parseSupplyJson, validateSupplyGraph, withSupplyDigest
} from "../../src/compat/v4/semantics/catalog-contract.mjs";
import { openSemanticCatalogStore } from "../../src/compat/v4/semantics/catalog-store.mjs";

const scope = {tenantId: "tenant", workspaceId: "workspace", projectId: "project"};
const decision = {decision: "AUTHORIZED", actor: "fixture-publisher", authorizationDigest: digest("fixture-approval")};
function fixture(id = "one") {
  const document = {schema: "synthetic-store-fixture/v1", id, content: "not a product semantic closure"};
  const bytes = supplyBytes(document);
  const fileDigest = digest(bytes);
  const entry = {kind: "Fixture", id, version: "1.0.0", schema: document.schema, objectDigest: digest(document),
    fileDigest, path: contentPath("materials", fileDigest), bytes: bytes.length, scope, visibility: "PRIVATE",
    provenance: {source: "synthetic-only"}, dependencies: [], parent: null};
  const generation = withSupplyDigest({schema: SEMANTIC_CATALOG_SCHEMA, catalogId: "organization",
    entries: [entry], revokedDigests: []}, "generationDigest");
  return {generation, material: new Map([[entry.path, document]])};
}
const policy = {
  authorize: async ({receipt}) => receipt.authorization.authorizationDigest === decision.authorizationDigest,
  permitEntry: async ({entry}) => digest(entry.scope) === digest(scope)
};
// This validator is deliberately test-only. Storage tests cannot establish complete
// semantic closure acceptance; production wiring must use the owning Engine validator.
function validateMaterials({generation, material}) {
  return generation.entries.every(entry => {
    const value = material.get(entry.path);
    return value?.schema === "synthetic-store-fixture/v1" && digest(value) === entry.objectDigest;
  });
}
async function context(t, extra = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "semantic-catalog-store-"));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const catalog = {id: "organization", root, enabled: true, permission: "GRANTED", kind: "ORGANIZATION"};
  return {root, catalog, store: await openSemanticCatalogStore({catalog, policy, validateMaterials, ...extra})};
}
async function publish(store, payload = fixture(), extra = {}) {
  return store.publish({...payload, requestId: "first", expectedHead: null, authorization: decision, ...extra});
}
const code = expected => error => error.code === expected;

test("actual aggregate read accepts 256 MiB and rejects one-over before material reads", {timeout: 60000}, async t => {
  const {root, store} = await context(t);
  const entries = [];
  let actualBytes = 0;
  // Populate disposable storage directly, one buffer at a time. This exercises
  // the real reader with a test-only material validator, not product publication.
  for (let i = 0; i < 16; i++) {
    const id = `aggregate-${i}`;
    const document = {schema: "synthetic-store-fixture/v1", id, content: ""};
    document.content = "x".repeat(16777216 - supplyBytes(document).length);
    const bytes = supplyBytes(document);
    const hash = digest(bytes);
    const entry = {...fixture(id).generation.entries[0], objectDigest: digest(document), fileDigest: hash,
      bytes: bytes.length, path: contentPath("materials", hash)};
    await fs.mkdir(path.dirname(path.join(root, entry.path)), {recursive: true});
    await fs.writeFile(path.join(root, entry.path), bytes);
    actualBytes += (await fs.stat(path.join(root, entry.path))).size;
    entries.push(entry);
  }
  assert.equal(actualBytes, 268435456);
  async function installSnapshot(items) {
    const generation = withSupplyDigest({schema: SEMANTIC_CATALOG_SCHEMA, catalogId: "organization", entries: items, revokedDigests: []}, "generationDigest");
    const receipt = withSupplyDigest({schema: SEMANTIC_RECEIPT_SCHEMA, catalogId: "organization", generationDigest: generation.generationDigest,
      expectedHead: null, action: "PUBLISH", requestDigest: digest("aggregate-fixture"), authorization: decision}, "receiptDigest");
    const pointer = withSupplyDigest({schema: SEMANTIC_POINTER_SCHEMA, catalogId: "organization", generationDigest: generation.generationDigest,
      generationPath: contentPath("generations", generation.generationDigest), previousPointerDigest: null, receiptDigest: receipt.receiptDigest}, "pointerDigest");
    for (const [relative, value] of [[pointer.generationPath, generation], [contentPath("receipts", receipt.receiptDigest), receipt], ["SEMANTIC-CATALOG.json", pointer]]) {
      await fs.mkdir(path.dirname(path.join(root, relative)), {recursive: true});
      await fs.writeFile(path.join(root, relative), supplyBytes(value));
    }
  }
  await installSnapshot(entries);
  const result = await store.inspect();
  assert.equal(result.material.size, 16);
  assert.equal(result.generation.entries.reduce((n, entry) => n + entry.bytes, 0), 268435456);
  for (const entry of entries) assert.equal(digest(result.material.get(entry.path)), entry.objectDigest);
  result.material.clear();
  await installSnapshot([...entries, {...fixture("one-extra-byte").generation.entries[0], bytes: 1}]);
  const open = fs.open;
  let materialReads = 0;
  t.mock.method(fs, "open", async (...args) => {
    if (String(args[0]).includes("/semantic-catalog/materials/")) materialReads++;
    return open(...args);
  });
  await assert.rejects(store.inspect(), code("TOTAL_MATERIAL_LIMIT"));
  assert.equal(materialReads, 0);
});

test("supply limits exactly bind the approved maxima and reject coercion or expansion", () => {
  assert.deepEqual(supplyLimits(), SEMANTIC_SUPPLY_LIMITS);
  for (const [key, maximum] of Object.entries(SEMANTIC_SUPPLY_LIMITS)) {
    assert.equal(supplyLimits({[key]: maximum})[key], maximum);
    for (const invalid of [maximum + 1, "1", NaN, Infinity, -1, 0.5]) {
      assert.throws(() => supplyLimits({[key]: invalid}), code("BUDGET_INVALID"));
    }
  }
  assert.throws(() => supplyLimits({unknown: 1}), code("BUDGET_INVALID"));
});

test("graph rejects duplicate identity, missing dependency, cycle, and wrong scope", () => {
  const one = fixture().generation.entries[0];
  assert.equal(validateSupplyGraph([one]).entryCount, 1);
  assert.throws(() => validateSupplyGraph([one, {...one}]), code("IDENTITY_CONFLICT"));
  assert.throws(() => validateSupplyGraph([{...one, dependencies: [digest("missing")]}]), code("MATERIAL_MISSING"));
  assert.throws(() => validateSupplyGraph([{...one, dependencies: [one.objectDigest]}]), code("DEPENDENCY_CYCLE"));
  const two = fixture("two").generation.entries[0];
  assert.throws(() => validateSupplyGraph([{...one, dependencies: [two.objectDigest]}, {...two, scope: {...scope, projectId: "elsewhere"}}]), code("SCOPE_INVALID"));
});

test("graph exact and one-over budgets count unique material files", () => {
  const one = fixture().generation.entries[0];
  const two = fixture("two").generation.entries[0];
  const entries = [{...one, dependencies: [two.objectDigest]}, two];
  const exact = supplyLimits({entries: 2, dependencyEdges: 1, dependencyDepth: 2,
    materialBytes: Math.max(one.bytes, two.bytes), totalMaterialBytes: one.bytes + two.bytes});
  assert.equal(validateSupplyGraph(entries, exact).dependencyEdges, 1);
  for (const [key, value, error] of [["entries", 1, "ENTRY_LIMIT"], ["dependencyDepth", 1, "DEPTH_LIMIT"],
    ["materialBytes", one.bytes - 1, "MATERIAL_LIMIT"], ["totalMaterialBytes", one.bytes + two.bytes - 1, "TOTAL_MATERIAL_LIMIT"]]) {
    assert.throws(() => validateSupplyGraph(entries, {...exact, [key]: value}), code(error));
  }
  assert.throws(() => validateSupplyGraph(entries, {...exact, dependencyEdges: 0}), code("EDGE_LIMIT"));
});

test("publish/readback preserves existing Catalog and Registry bytes", async t => {
  const {root, store} = await context(t);
  const legacy = {"CATALOG.md": "legacy catalog\n", "catalog.lock.json": "legacy lock\n", "registry.yaml": "enabled roots only\n"};
  for (const [file, value] of Object.entries(legacy)) await fs.writeFile(path.join(root, file), value);
  const result = await publish(store);
  assert.equal(result.status, "PUBLISHED");
  const read = await store.inspect();
  assert.equal(read.pointer.pointerDigest, result.pointer.pointerDigest);
  assert.equal(read.material.size, 1);
  assert.equal((await store.readback("first")).status, "COMMITTED");
  await assert.rejects(publish(store), code("CONFLICT"));
  for (const [file, value] of Object.entries(legacy)) assert.equal(await fs.readFile(path.join(root, file), "utf8"), value);
});

test("same-head contenders have exactly one winner", async t => {
  const {catalog, store} = await context(t);
  const second = await openSemanticCatalogStore({catalog, policy, validateMaterials});
  const results = await Promise.allSettled([publish(store), publish(second, fixture("two"), {requestId: "second"})]);
  assert.equal(results.filter(value => value.status === "fulfilled").length, 1);
  assert.equal(results.find(value => value.status === "rejected").reason.code, "CONFLICT");
});

test("cross-process publication uses the same single-winner lock and CAS", async t => {
  const {root, store} = await context(t);
  const script = new URL("../fixtures/semantic-catalog-contender.mjs", import.meta.url);
  function contender(id) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script.pathname, root, id], {stdio: ["ignore", "pipe", "pipe"]});
      let output = "";
      child.stdout.on("data", chunk => output += chunk);
      child.on("error", reject);
      child.on("close", status => status === 0 ? resolve(JSON.parse(output)) : reject(new Error("fixture contender failed")));
    });
  }
  const results = await Promise.all([contender("one"), contender("two")]);
  assert.deepEqual(results.map(result => result.status).sort(), ["CONFLICT", "PUBLISHED"]);
  // The child uses the exact same approval and fixture validation contract.
  assert.equal((await store.inspect()).generation.entries.length, 1);
});

test("permission loss and forged authorization fail closed without a pointer", async t => {
  const {root, store} = await context(t);
  await assert.rejects(publish(store, fixture(), {authorization: {...decision, authorizationDigest: digest("forged")}}), code("PERMISSION_DENIED"));
  await assert.rejects(fs.stat(path.join(root, "SEMANTIC-CATALOG.json")), {code: "ENOENT"});
  const result = await publish(store);
  assert.equal(result.status, "PUBLISHED");
  const denied = await openSemanticCatalogStore({catalog: {id: "organization", root, enabled: true, permission: "GRANTED"},
    policy: {...policy, permitEntry: async () => false}, validateMaterials});
  await assert.rejects(denied.inspect(), code("PERMISSION_DENIED"));
});

test("disabled roots, missing trust and Builtin writes are rejected", async t => {
  const {catalog} = await context(t);
  await assert.rejects(openSemanticCatalogStore({catalog: {...catalog, enabled: false}, policy, validateMaterials}), code("PERMISSION_DENIED"));
  await assert.rejects(openSemanticCatalogStore({catalog, validateMaterials}), code("TRUST_REQUIRED"));
  const builtin = await openSemanticCatalogStore({catalog: {...catalog, kind: "BUILTIN"}, policy, validateMaterials});
  await assert.rejects(publish(builtin), code("PUBLICATION_ROOT_DENIED"));
});

test("missing and tampered material never returns a partial generation", async t => {
  const {root, store} = await context(t);
  const payload = fixture();
  await publish(store, payload);
  const file = path.join(root, payload.generation.entries[0].path);
  await fs.rename(file, `${file}.saved`);
  await assert.rejects(store.inspect(), code("UNAVAILABLE"));
  await fs.writeFile(file, "{}\n");
  await assert.rejects(store.inspect(), code("DIGEST_MISMATCH"));
});

test("material size larger than its bound entry is rejected before reading the body", async t => {
  const {root, store} = await context(t);
  const payload = fixture();
  await publish(store, payload);
  const file = path.join(root, payload.generation.entries[0].path);
  await fs.appendFile(file, " ".repeat(1024));
  const open = fs.open;
  let bodyReads = 0;
  t.mock.method(fs, "open", async (...args) => {
    const handle = await open(...args);
    if (String(args[0]).includes("/semantic-catalog/materials/")) {
      const read = handle.read.bind(handle);
      handle.read = async (...values) => {bodyReads++; return read(...values);};
    }
    return handle;
  });
  await assert.rejects(store.inspect(), code("FILE_LIMIT"));
  assert.equal(bodyReads, 0);
});

test("all entry permissions are checked before any material body is opened", async t => {
  const {catalog, store} = await context(t);
  const one = fixture("allowed"), two = fixture("denied");
  const generation = withSupplyDigest({schema: SEMANTIC_CATALOG_SCHEMA, catalogId: "organization",
    entries: [...one.generation.entries, ...two.generation.entries], revokedDigests: []}, "generationDigest");
  await publish(store, {generation, material: new Map([...one.material, ...two.material])});
  const reader = await openSemanticCatalogStore({catalog, validateMaterials, policy: {...policy, permitEntry: ({entry}) => entry.id !== "denied"}});
  const open = fs.open;
  let materialsOpened = 0;
  t.mock.method(fs, "open", async (...args) => {
    if (String(args[0]).includes("/semantic-catalog/materials/")) materialsOpened++;
    return open(...args);
  });
  await assert.rejects(reader.inspect(), code("PERMISSION_DENIED"));
  assert.equal(materialsOpened, 0);
});

test("absolute, URL, traversal and symlink paths are rejected", async t => {
  const {root, store} = await context(t);
  const payload = fixture();
  for (const unsafe of ["/tmp/outside.json", "https://example.invalid/x", "../escape.json", "semantic-catalog/../escape.json", "a\\b"]) {
    const generation = structuredClone(payload.generation);
    generation.entries[0].path = unsafe;
    delete generation.generationDigest;
    await assert.rejects(publish(store, {...payload, generation: withSupplyDigest(generation, "generationDigest")}), code("PATH_DENIED"));
  }
  await fs.mkdir(path.join(root, "semantic-catalog"));
  await fs.symlink(os.tmpdir(), path.join(root, "semantic-catalog/materials"));
  await assert.rejects(publish(store, payload), code("PATH_DENIED"));
  await assert.rejects(store.inspect(), code("UNAVAILABLE"));
});

test("cancelled and timed-out lock waits do not steal locks or publish partial data", async t => {
  const controller = new AbortController();
  const {root, store} = await context(t, {signal: controller.signal, limits: {lockWaitMilliseconds: 20}});
  await fs.mkdir(path.join(root, "semantic-catalog/publication.lock"), {recursive: true});
  await assert.rejects(publish(store), code("LOCKED"));
  controller.abort();
  await assert.rejects(publish(store), code("CANCELLED"));
  assert.ok((await fs.stat(path.join(root, "semantic-catalog/publication.lock"))).isDirectory());
  await assert.rejects(fs.stat(path.join(root, "SEMANTIC-CATALOG.json")), {code: "ENOENT"});
});

test("append-only heads retain committed receipts across unrelated growth", async t => {
  const {root, store} = await context(t);
  const first = await publish(store);
  const next = fixture("two");
  await publish(store, next, {requestId: "second", expectedHead: first.pointer.pointerDigest});
  assert.equal((await store.readback("first")).status, "COMMITTED");
  assert.equal((await store.readback("second")).status, "COMMITTED");
  assert.equal(JSON.parse(await fs.readFile(path.join(root, contentPath("heads", first.pointer.pointerDigest)), "utf8")).pointerDigest, first.pointer.pointerDigest);
});

test("revocations cannot be lost and revoked material cannot reappear on rollback", async t => {
  const {store} = await context(t);
  const firstPayload = fixture();
  const first = await publish(store, firstPayload);
  const next = fixture("two");
  delete next.generation.generationDigest;
  next.generation.revokedDigests = [firstPayload.generation.entries[0].objectDigest];
  next.generation = withSupplyDigest(next.generation, "generationDigest");
  const revoked = await publish(store, next, {requestId: "revoke", action: "REVOKE", expectedHead: first.pointer.pointerDigest});
  await assert.rejects(publish(store, firstPayload, {requestId: "rollback", action: "ROLLBACK", expectedHead: revoked.pointer.pointerDigest}), code("REVOCATION_LOST"));
});

test("deeply nested JSON is rejected before parsing and diagnostics remain redacted", async t => {
  assert.deepEqual(parseSupplyJson(Buffer.from('[["{[escaped]}"]]'), 2), [["{[escaped]}"]]);
  assert.throws(() => parseSupplyJson(Buffer.from("[".repeat(65) + "0" + "]".repeat(65))), code("DEPTH_LIMIT"));
  const {store} = await context(t, {policy: {...policy, authorize: () => { throw new Error("synthetic-secret-marker"); }}});
  await assert.rejects(publish(store), error => error.code === "IO_OR_VALIDATION_FAILED" && !error.message.includes("synthetic-secret-marker"));
});

test("policy callbacks cannot bypass the read deadline or cancellation", async t => {
  const {store} = await context(t, {limits: {readTimeoutMilliseconds: 10}, policy: {...policy, authorize: () => new Promise(() => {})}});
  await assert.rejects(publish(store), code("TIMEOUT"));
  const controller = new AbortController();
  const second = await context(t, {signal: controller.signal, policy: {...policy, authorize: () => new Promise(() => {})}});
  const pending = publish(second.store);
  controller.abort();
  await assert.rejects(pending, code("CANCELLED"));
});

test("cancellation after durable intent requires readback and prevents blind retry", async t => {
  const controller = new AbortController();
  const {catalog, store} = await context(t, {signal: controller.signal,
    policy: {...policy, permitEntry: async () => { controller.abort(); return true; }}});
  await assert.rejects(publish(store), code("CANCELLED"));
  const restarted = await openSemanticCatalogStore({catalog, policy, validateMaterials});
  assert.equal((await restarted.readback("first")).status, "UNKNOWN");
  await assert.rejects(publish(restarted), code("UNKNOWN"));
  await assert.rejects(restarted.inspect(), code("UNAVAILABLE"));
});

test("caller input mutation during await cannot change pinned publication bytes", async t => {
  const payload = fixture();
  const {store} = await context(t, {policy: {...policy, authorize: async () => {
    payload.generation.catalogId = "injected";
    payload.material.clear();
    return true;
  }}});
  await publish(store, payload);
  assert.equal((await store.inspect()).generation.catalogId, "organization");
});

test("stale pointer snapshots retry finitely and never return mixed results", async t => {
  const {catalog, store} = await context(t);
  const first = await publish(store);
  const second = await publish(store, fixture("two"), {requestId: "second", expectedHead: first.pointer.pointerDigest});
  let validations = 0;
  const pointers = [first.pointer, second.pointer];
  const unstable = await openSemanticCatalogStore({catalog, policy, limits: {snapshotRetryCount: 2},
    validateMaterials: async input => {
      await fs.writeFile(path.join(catalog.root, "SEMANTIC-CATALOG.json"), supplyBytes(pointers[validations++ % 2]));
      return validateMaterials(input);
    }});
  await assert.rejects(unstable.inspect(), code("DRIFT"));
  assert.equal(validations, 3);
});

test("pointer and generation byte limits fail before loading oversized JSON", async t => {
  const {root, store} = await context(t);
  const first = await publish(store);
  await fs.writeFile(path.join(root, first.pointer.generationPath), " ".repeat(SEMANTIC_SUPPLY_LIMITS.generationBytes + 1));
  await assert.rejects(store.inspect(), code("FILE_LIMIT"));
  await fs.writeFile(path.join(root, "SEMANTIC-CATALOG.json"), " ".repeat(SEMANTIC_SUPPLY_LIMITS.pointerBytes + 1));
  await assert.rejects(store.inspect(), code("FILE_LIMIT"));
});

test("unknown pointer schema, object digest drift and hardlinked files are rejected", async t => {
  const {root, store} = await context(t);
  const payload = fixture();
  const first = await publish(store, payload);
  const pointerFile = path.join(root, "SEMANTIC-CATALOG.json");
  await fs.writeFile(pointerFile, supplyBytes({...first.pointer, schema: "unrecognized/v99"}));
  await assert.rejects(store.inspect(), code("UNSUPPORTED"));
  await fs.writeFile(pointerFile, supplyBytes({...first.pointer, generationDigest: digest("changed")}));
  await assert.rejects(store.inspect(), code("DIGEST_MISMATCH"));
  await fs.writeFile(pointerFile, supplyBytes(first.pointer));
  await fs.link(path.join(root, payload.generation.entries[0].path), path.join(root, "outside-alias.json"));
  await assert.rejects(store.inspect(), code("PATH_DENIED"));
});

test("crash before pointer exposure leaves no discoverable partial set or stealable lock", async t => {
  const {root, catalog} = await context(t);
  const status = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [new URL("../fixtures/semantic-catalog-contender.mjs", import.meta.url).pathname, root, "crash", "before-pointer"], {stdio: "ignore"});
    child.on("error", reject);
    child.on("close", resolve);
  });
  assert.equal(status, 86);
  const restarted = await openSemanticCatalogStore({catalog, policy, validateMaterials, limits: {lockWaitMilliseconds: 10}});
  await assert.rejects(restarted.inspect(), code("UNAVAILABLE"));
  assert.equal((await restarted.readback("crash")).status, "UNKNOWN");
  await assert.rejects(publish(restarted), code("LOCKED"));
});

test("crash after pointer commit is reconciled without replay", async t => {
  const {root, store} = await context(t);
  const status = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [new URL("../fixtures/semantic-catalog-contender.mjs", import.meta.url).pathname, root, "crash", "after-pointer"], {stdio: "ignore"});
    child.on("error", reject);
    child.on("close", resolve);
  });
  assert.equal(status, 87);
  assert.equal((await store.readback("crash")).status, "COMMITTED");
  await assert.rejects(publish(store, fixture(), {requestId: "crash"}), code("CONFLICT"));
});

test("a real 16 MiB material file is published and read, while one extra byte is rejected", async t => {
  const {root, store} = await context(t);
  const document = {schema: "synthetic-store-fixture/v1", id: "large", content: ""};
  document.content = "x".repeat(SEMANTIC_SUPPLY_LIMITS.materialBytes - supplyBytes(document).length);
  const bytes = supplyBytes(document);
  assert.equal(bytes.length, 16777216);
  const hash = digest(bytes);
  const entry = {...fixture("large").generation.entries[0], objectDigest: digest(document), fileDigest: hash,
    bytes: bytes.length, path: contentPath("materials", hash)};
  const generation = withSupplyDigest({schema: SEMANTIC_CATALOG_SCHEMA, catalogId: "organization", entries: [entry], revokedDigests: []}, "generationDigest");
  await publish(store, {generation, material: new Map([[entry.path, document]])});
  assert.equal((await fs.stat(path.join(root, entry.path))).size, 16777216);
  assert.equal((await store.inspect()).material.get(entry.path).content.length, document.content.length);
  await fs.appendFile(path.join(root, entry.path), " ");
  await assert.rejects(store.inspect(), code("FILE_LIMIT"));
});

test("material readers obey actual concurrency four and explicitly tightened concurrency one", async t => {
  const {catalog, store} = await context(t);
  const samples = Array.from({length: 8}, (_, i) => fixture(`parallel-${i}`));
  const generation = withSupplyDigest({schema: SEMANTIC_CATALOG_SCHEMA, catalogId: "organization",
    entries: samples.flatMap(item => item.generation.entries), revokedDigests: []}, "generationDigest");
  await publish(store, {generation, material: new Map(samples.flatMap(item => [...item.material]))});
  for (const limit of [4, 1]) {
    const reader = await openSemanticCatalogStore({catalog, policy, validateMaterials, limits: {readerConcurrency: limit}});
    const open = fs.open;
    let active = 0, maximum = 0;
    let release;
    const rendezvous = new Promise(resolve => {release = resolve;});
    const mocked = t.mock.method(fs, "open", async (...args) => {
      const handle = await open(...args);
      if (String(args[0]).includes("/semantic-catalog/materials/")) {
        active++; maximum = Math.max(maximum, active);
        if (active === limit) release();
        const read = handle.read.bind(handle), close = handle.close.bind(handle);
        handle.read = async (...values) => {await rendezvous; return read(...values);};
        handle.close = async () => {await close(); active--;};
      }
      return handle;
    });
    try {
      assert.equal((await reader.inspect()).material.size, 8);
      assert.equal(maximum, limit);
      assert.equal(active, 0);
    } finally {mocked.mock.restore();}
  }
});

test("material read cancellation closes every reader and never returns a partial generation", async t => {
  const controller = new AbortController();
  const {catalog, store} = await context(t);
  const samples = Array.from({length: 4}, (_, i) => fixture(`cancel-${i}`));
  const generation = withSupplyDigest({schema: SEMANTIC_CATALOG_SCHEMA, catalogId: "organization",
    entries: samples.flatMap(item => item.generation.entries), revokedDigests: []}, "generationDigest");
  await publish(store, {generation, material: new Map(samples.flatMap(item => [...item.material]))});
  const reader = await openSemanticCatalogStore({catalog, policy, validateMaterials, signal: controller.signal});
  const open = fs.open;
  let active = 0, reads = 0;
  t.mock.method(fs, "open", async (...args) => {
    const handle = await open(...args);
    if (String(args[0]).includes("/semantic-catalog/materials/")) {
      active++;
      const read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.read = async (...values) => {const result = await read(...values); reads++; controller.abort(); return result;};
      handle.close = async () => {await close(); active--;};
    }
    return handle;
  });
  await assert.rejects(reader.inspect(), code("CANCELLED"));
  assert.ok(reads > 0 && reads <= 4);
  assert.equal(active, 0);
});

test("real pointer and generation files accept their exact byte maxima and reject one extra byte", async t => {
  const {root, store} = await context(t);
  const first = await publish(store);
  const generation = path.join(root, first.pointer.generationPath);
  const pointer = path.join(root, "SEMANTIC-CATALOG.json");
  for (const [file, maximum] of [[generation, 4194304], [pointer, 65536]]) {
    const original = await fs.readFile(file);
    const padded = Buffer.concat([original, Buffer.alloc(maximum - original.length, " ")]);
    await fs.writeFile(file, padded);
    assert.equal((await store.inspect()).pointer.pointerDigest, first.pointer.pointerDigest);
    await fs.appendFile(file, " ");
    await assert.rejects(store.inspect(), code("FILE_LIMIT"));
    await fs.writeFile(file, original);
  }
});

test("lock waiting retries below 5000 ms and stops exactly at the deadline without stealing", async t => {
  const controller = new AbortController();
  const {root, store} = await context(t, {signal: controller.signal});
  const guard = setTimeout(() => controller.abort(), 3000);
  t.after(() => clearTimeout(guard));
  const lock = path.join(await fs.realpath(root), "semantic-catalog/publication.lock");
  await fs.mkdir(lock, {recursive: true});
  let now = 0, attempts = 0;
  t.mock.method(performance, "now", () => now);
  const mkdir = fs.mkdir;
  t.mock.method(fs, "mkdir", async (...args) => {
    try {return await mkdir(...args);}
    catch (error) {
      if (args[0] === lock && error.code === "EEXIST") now = ++attempts === 1 ? 4999 : 5000;
      throw error;
    }
  });
  await assert.rejects(publish(store), code("LOCKED"));
  assert.equal(attempts, 2);
  assert.equal((await fs.stat(lock)).isDirectory(), true);
  await assert.rejects(fs.stat(path.join(root, "SEMANTIC-CATALOG.json")), {code: "ENOENT"});
});
