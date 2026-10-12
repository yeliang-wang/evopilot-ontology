import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { digest } from "../../v3/utils.mjs";
import { createSupplyBudget } from "./catalog-budget.mjs";
import {
  SEMANTIC_POINTER_SCHEMA, SEMANTIC_RECEIPT_SCHEMA, contentPath, isSupplyDigest,
  parseSupplyJson, requireSupply, supplyBytes, supplyError, supplyLimits, supplyRelativePath,
  validateSemanticGeneration, validateSemanticPointer, validateSupplyDigest, withSupplyDigest
} from "./catalog-contract.mjs";

// Internal storage primitive. The Engine supplies trusted policy and material validators;
// these functions are never deserialized from Catalog, Source or CLI input.
export async function openSemanticCatalogStore({catalog, policy, validateMaterials, limits: overrides, signal, budget}) {
  try { return await createStore({catalog, policy, validateMaterials, limits: overrides, signal, budget}); }
  catch (error) { throw redactedError(error); }
}

function redactedError(error) {
  return error?.name === "OntologyCatalogError" ? error : supplyError("IO_OR_VALIDATION_FAILED");
}

async function createStore({catalog, policy, validateMaterials, limits: overrides, signal, budget}) {
  requireSupply(catalog?.enabled === true && catalog?.permission === "GRANTED", "PERMISSION_DENIED");
  requireSupply(typeof catalog.root === "string" && path.isAbsolute(catalog.root), "PATH_DENIED");
  requireSupply(typeof policy?.authorize === "function" && typeof policy?.permitEntry === "function" &&
    typeof validateMaterials === "function", "TRUST_REQUIRED");
  const limits = supplyLimits(overrides);
  const opening = budget ?? createSupplyBudget(limits, signal);
  opening();
  const root = await fs.realpath(catalog.root);
  const rootStat = await fs.stat(root);
  opening();
  requireSupply(rootStat.isDirectory(), "PATH_DENIED");
  const binding = Object.freeze({...catalog, root});
  const hostDigest = digest(os.hostname());
  const rootDigest = digest({catalogId: binding.id, root, dev: rootStat.dev, ino: rootStat.ino});

  const operation = () => budget ?? createSupplyBudget(limits, signal);

  async function checkedPath(relative, {createParents = false} = {}) {
    supplyRelativePath(relative);
    const currentRoot = await fs.stat(root);
    requireSupply(await fs.realpath(root) === root && currentRoot.dev === rootStat.dev && currentRoot.ino === rootStat.ino, "PATH_DENIED");
    let cursor = root;
    for (const part of relative.split("/").slice(0, -1)) {
      cursor = path.join(cursor, part);
      if (createParents) await fs.mkdir(cursor, {mode: 0o700}).catch(error => { if (error.code !== "EEXIST") throw error; });
      const stat = await fs.lstat(cursor);
      requireSupply(stat.isDirectory() && !stat.isSymbolicLink(), "PATH_DENIED");
    }
    return path.join(root, relative);
  }

  async function read(relative, maxBytes, check) {
    check();
    let handle;
    try {
      const file = await checkedPath(relative);
      handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const before = await handle.stat();
      requireSupply(before.isFile() && before.nlink === 1, "PATH_DENIED");
      requireSupply(before.size > 0 && before.size <= maxBytes, "FILE_LIMIT");
      const bytes = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < bytes.length) {
        check();
        const {bytesRead} = await handle.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
        requireSupply(bytesRead > 0, "DRIFT");
        offset += bytesRead;
      }
      const after = await handle.stat();
      requireSupply(before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, "DRIFT");
      await checkedPath(relative);
      const named = await fs.lstat(file);
      requireSupply(named.dev === after.dev && named.ino === after.ino && !named.isSymbolicLink(), "DRIFT");
      check();
      const value = parseSupplyJson(bytes);
      check();
      return {bytes, value};
    } catch (error) {
      if (error.code === "ENOENT") throw supplyError("UNAVAILABLE");
      if (["ELOOP", "ENOTDIR", "EACCES", "EPERM"].includes(error.code)) throw supplyError("PATH_DENIED");
      throw error;
    } finally { await handle?.close(); }
  }

  async function syncDirectory(directory) {
    const handle = await fs.open(directory, constants.O_RDONLY);
    try { await handle.sync(); } finally { await handle.close(); }
  }

  async function immutable(relative, value, maxBytes, check) {
    const bytes = supplyBytes(value);
    check();
    requireSupply(bytes.length <= maxBytes, "FILE_LIMIT");
    const file = await checkedPath(relative, {createParents: true});
    check();
    let handle;
    let created = false;
    try {
      handle = await fs.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      created = true;
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    } finally { await handle?.close(); }
    if (created) await syncDirectory(path.dirname(file));
    const verified = await read(relative, maxBytes, check);
    requireSupply(verified.bytes.equals(bytes), "IMMUTABLE_CONFLICT");
  }

  async function head(check) {
    try {
      const result = await read("SEMANTIC-CATALOG.json", limits.pointerBytes, check);
      validateSemanticPointer(result.value, limits);
      requireSupply(result.value.catalogId === binding.id, "IDENTITY_CONFLICT");
      return result.value;
    } catch (error) { if (error.code === "UNAVAILABLE") return null; throw error; }
  }

  async function authorization(receipt, check) {
    check();
    validateSupplyDigest(receipt, "receiptDigest", SEMANTIC_RECEIPT_SCHEMA);
    requireSupply(receipt.catalogId === binding.id && ["PUBLISH", "ROLLBACK", "REVOKE"].includes(receipt.action));
    requireSupply(isSupplyDigest(receipt.generationDigest) &&
      (receipt.expectedHead === null || isSupplyDigest(receipt.expectedHead)) &&
      isSupplyDigest(receipt.requestDigest) && receipt.authorization?.decision === "AUTHORIZED" &&
      isSupplyDigest(receipt.authorization.authorizationDigest) && typeof receipt.authorization.actor === "string", "AUTHORIZATION_REQUIRED");
    requireSupply(await check.wait(() => policy.authorize({catalog: binding, receipt})) === true, "PERMISSION_DENIED");
    check();
  }

  async function readGeneration(pointer, check) {
    const generationRead = await read(pointer.generationPath, limits.generationBytes, check);
    const generation = validateSemanticGeneration(generationRead.value, limits);
    requireSupply(generation.generationDigest === pointer.generationDigest && generation.catalogId === binding.id, "DIGEST_MISMATCH");
    const receiptRead = await read(contentPath("receipts", pointer.receiptDigest), limits.pointerBytes, check);
    const receipt = receiptRead.value;
    requireSupply(receipt.receiptDigest === pointer.receiptDigest && receipt.generationDigest === generation.generationDigest &&
      receipt.expectedHead === pointer.previousPointerDigest, "DIGEST_MISMATCH");
    await authorization(receipt, check);
    // Authorize every entry before reading any material (including embedded PRIVATE content).
    for (const entry of generation.entries) {
      check();
      requireSupply(await check.wait(() => policy.permitEntry({catalog: binding, entry})) === true, "PERMISSION_DENIED");
    }
    const unique = [...new Map(generation.entries.map(entry => [entry.path, entry])).values()];
    const material = new Map();
    let index = 0;
    let failed = false;
    const workers = Array.from({length: Math.min(limits.readerConcurrency, unique.length)}, async () => {
      while (!failed && index < unique.length) {
        const entry = unique[index++];
        try {
          // Honor the aggregate-accounted entry size before allocating/reading a
          // body, not only after accepting up to the larger per-file maximum.
          const result = await read(entry.path, Math.min(entry.bytes, limits.materialBytes), check);
          requireSupply(result.bytes.length === entry.bytes && digest(result.bytes) === entry.fileDigest, "DIGEST_MISMATCH");
          material.set(entry.path, result.value);
        } catch (error) { failed = true; throw error; }
      }
    });
    const results = await Promise.allSettled(workers);
    const failure = results.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
    requireSupply(await check.wait(() => validateMaterials({generation, material, catalog: binding, limits, signal})) === true, "MATERIAL_INVALID");
    check();
    return {pointer, generation, receipt, material};
  }

  async function inspect() {
    const check = operation();
    for (let attempt = 0; attempt <= limits.snapshotRetryCount; attempt++) {
      const pointer = await head(check);
      requireSupply(pointer, "UNAVAILABLE");
      const result = await readGeneration(pointer, check);
      const after = await head(check);
      if (after?.pointerDigest === pointer.pointerDigest) return {...result, limits, attempts: attempt + 1};
    }
    throw supplyError("DRIFT");
  }

  async function acquire(check, receipt) {
    const lock = await checkedPath("semantic-catalog/publication.lock", {createParents: true});
    const deadline = performance.now() + limits.lockWaitMilliseconds;
    while (true) {
      check();
      try {
        await fs.mkdir(lock, {mode: 0o700});
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        requireSupply(performance.now() < deadline, "LOCKED");
        // Never steal a timed-out/crashed writer's lock. Inspect receipts first.
        await delay(Math.min(25, Math.max(1, deadline - performance.now())));
        continue;
      }
      const owner = withSupplyDigest({schema: "evopilot-harness-semantic-catalog-lock/v1", catalogId: binding.id,
        nonce: randomUUID(), pid: process.pid, hostDigest, rootDigest, receiptDigest: receipt.receiptDigest,
        requestDigest: receipt.requestDigest, expectedHead: receipt.expectedHead}, "lockDigest");
      const retire = async () => {
        // Atomic directory retirement has no empty-lock crash window and preserves evidence.
        const destination = await checkedPath(`semantic-catalog/retired-locks/${owner.lockDigest.slice(7)}`, {createParents: true});
        await fs.rename(lock, destination);
        await syncDirectory(path.dirname(destination));
        await syncDirectory(path.dirname(lock));
      };
      try { await immutable("semantic-catalog/publication.lock/owner.json", owner, limits.pointerBytes, check); }
      catch (error) { await retire(); throw error; }
      return retire;
    }
  }

  async function publish({generation, material, requestId, expectedHead, action = "PUBLISH", transitionDigest, authorization: decision}) {
    requireSupply(binding.kind === "ORGANIZATION", "PUBLICATION_ROOT_DENIED");
    const check = operation();
    check();
    // Pin caller input before the first await; later caller mutation is not a new decision.
    generation = structuredClone(generation);
    material = structuredClone(material);
    decision = structuredClone(decision);
    validateSemanticGeneration(generation, limits);
    requireSupply(generation.catalogId === binding.id && typeof requestId === "string" && requestId.length > 0 && requestId.length <= 128);
    requireSupply(expectedHead === null || isSupplyDigest(expectedHead), "EXPECTED_HEAD_REQUIRED");
    requireSupply(transitionDigest === undefined || isSupplyDigest(transitionDigest), "INPUT_BINDING_REQUIRED");
    const receipt = withSupplyDigest({schema: SEMANTIC_RECEIPT_SCHEMA, catalogId: binding.id,
      generationDigest: generation.generationDigest, expectedHead, action,
      requestDigest: digest(requestId), authorization: decision, ...(transitionDigest ? {transitionDigest} : {})}, "receiptDigest");
    await authorization(receipt, check);
    requireSupply(material instanceof Map, "MATERIAL_MISSING");
    requireSupply(await check.wait(() => validateMaterials({generation, material, catalog: binding, limits, signal})) === true, "MATERIAL_INVALID");
    const unlock = await acquire(check, receipt);
    let switchAttempted = false;
    try {
      const current = await head(check);
      requireSupply((current?.pointerDigest ?? null) === expectedHead, "CONFLICT");
      if (current) {
        const prior = await readGeneration(current, check);
        requireSupply(prior.generation.revokedDigests.every(hash => generation.revokedDigests.includes(hash)), "REVOCATION_LOST");
      }
      const requestPath = `semantic-catalog/requests/${receipt.requestDigest.slice(7)}.json`;
      try { await read(requestPath, limits.pointerBytes, check); throw supplyError("UNKNOWN"); }
      catch (error) { if (error.code !== "UNAVAILABLE") throw error; }
      // Durable intent precedes any discoverable effect. A retry must use readback.
      await immutable(requestPath, receipt, limits.pointerBytes, check);
      for (const entry of generation.entries) {
        check();
        requireSupply(await check.wait(() => policy.permitEntry({catalog: binding, entry})) === true, "PERMISSION_DENIED");
        const document = material.get(entry.path);
        requireSupply(document !== undefined, "MATERIAL_MISSING");
        const bytes = supplyBytes(document);
        requireSupply(digest(bytes) === entry.fileDigest && bytes.length === entry.bytes, "DIGEST_MISMATCH");
        await immutable(entry.path, document, limits.materialBytes, check);
      }
      await immutable(contentPath("generations", generation.generationDigest), generation, limits.generationBytes, check);
      await immutable(contentPath("receipts", receipt.receiptDigest), receipt, limits.pointerBytes, check);
      const pointer = withSupplyDigest({schema: SEMANTIC_POINTER_SCHEMA, catalogId: binding.id,
        generationPath: contentPath("generations", generation.generationDigest), generationDigest: generation.generationDigest,
        previousPointerDigest: expectedHead, receiptDigest: receipt.receiptDigest}, "pointerDigest");
      validateSemanticPointer(pointer, limits);
      await readGeneration(pointer, check);
      await immutable(contentPath("heads", pointer.pointerDigest), pointer, limits.pointerBytes, check);
      // Same-directory rename is the sole visibility boundary; legacy Catalog is untouched.
      const temporary = `semantic-catalog-pointer-${randomUUID()}.json`;
      await immutable(temporary, pointer, limits.pointerBytes, check);
      await authorization(receipt, check);
      requireSupply(((await head(check))?.pointerDigest ?? null) === expectedHead, "CONFLICT");
      check();
      const from = await checkedPath(temporary);
      const to = await checkedPath("SEMANTIC-CATALOG.json");
      check();
      switchAttempted = true;
      await fs.rename(from, to);
      await syncDirectory(root);
      check();
      return {status: "PUBLISHED", pointer, receipt, limits};
    } catch (error) {
      if (switchAttempted) throw supplyError("UNKNOWN");
      throw error;
    } finally {
      try { await unlock(); }
      catch (error) { if (switchAttempted) throw supplyError("UNKNOWN"); throw error; }
    }
  }

  async function readback(requestId) {
    const check = operation();
    requireSupply(typeof requestId === "string" && requestId.length > 0 && requestId.length <= 128);
    const receipt = (await read(`semantic-catalog/requests/${digest(requestId).slice(7)}.json`, limits.pointerBytes, check)).value;
    await authorization(receipt, check);
    requireSupply(receipt.requestDigest === digest(requestId), "DIGEST_MISMATCH");
    let pointer = await head(check);
    // Bounded ancestry inspection; never guess NOT_COMMITTED after ambiguous history.
    for (let count = 0; pointer && count < limits.dependencyDepth; count++) {
      if (pointer.receiptDigest === receipt.receiptDigest) {
        await readGeneration(pointer, check);
        return {status: "COMMITTED", pointer, receipt};
      }
      if (!pointer.previousPointerDigest) break;
      const expected = pointer.previousPointerDigest;
      pointer = (await read(contentPath("heads", expected), limits.pointerBytes, check)).value;
      validateSemanticPointer(pointer, limits);
      requireSupply(pointer.pointerDigest === expected && pointer.catalogId === binding.id, "DIGEST_MISMATCH");
    }
    return {status: "UNKNOWN", receipt, nextAction: "inspect-publication-receipt"};
  }

  async function inspectRevision(pointerDigest) {
    requireSupply(isSupplyDigest(pointerDigest), "INPUT_BINDING_REQUIRED");
    const check = operation();
    const current = await head(check);
    let pointer = current;
    for (let count = 0; pointer && count < limits.dependencyDepth; count++) {
      if (pointer.pointerDigest === pointerDigest) {
        const result = await readGeneration(pointer, check);
        requireSupply((await head(check))?.pointerDigest === current.pointerDigest, "DRIFT");
        return result;
      }
      if (!pointer.previousPointerDigest) break;
      const expected = pointer.previousPointerDigest;
      pointer = (await read(contentPath("heads", expected), limits.pointerBytes, check)).value;
      validateSemanticPointer(pointer, limits);
      requireSupply(pointer.pointerDigest === expected && pointer.catalogId === binding.id, "DIGEST_MISMATCH");
    }
    throw supplyError("REVISION_UNAVAILABLE");
  }

  async function lockState(check) {
    const owner = (await read("semantic-catalog/publication.lock/owner.json", limits.pointerBytes, check)).value;
    validateSupplyDigest(owner, "lockDigest", "evopilot-harness-semantic-catalog-lock/v1");
    requireSupply(owner.catalogId === binding.id && owner.rootDigest === rootDigest && owner.hostDigest === hostDigest &&
      Number.isSafeInteger(owner.pid) && owner.pid > 0 && isSupplyDigest(owner.receiptDigest) &&
      isSupplyDigest(owner.requestDigest) && (owner.expectedHead === null || isSupplyDigest(owner.expectedHead)), "LOCK_OWNER_UNKNOWN");
    let ownerState = "ALIVE";
    try { process.kill(owner.pid, 0); }
    catch (error) { ownerState = error.code === "ESRCH" ? "DEAD" : "UNKNOWN"; }
    return {owner, ownerState, currentHead: (await head(check))?.pointerDigest ?? null};
  }

  async function inspectRecovery() {
    const value = await lockState(operation());
    return {status: value.ownerState === "DEAD" ? "RECOVERABLE" : "LOCK_ACTIVE_OR_UNKNOWN", ownerState: value.ownerState,
      lockDigest: value.owner.lockDigest, expectedHead: value.currentHead, requestDigest: value.owner.requestDigest,
      grantsRecoveryAuthority: false};
  }

  async function authorizeRecovery(record, check) {
    validateSupplyDigest(record, "recoveryDigest", "evopilot-harness-semantic-catalog-recovery/v1");
    requireSupply(record.catalogId === binding.id && record.authorization?.decision === "AUTHORIZED" &&
      isSupplyDigest(record.authorization.authorizationDigest) && typeof record.authorization.actor === "string" &&
      typeof policy.authorizeRecovery === "function", "AUTHORIZATION_REQUIRED");
    requireSupply(await check.wait(() => policy.authorizeRecovery({catalog: binding, record})) === true, "PERMISSION_DENIED");
  }

  async function recoveryReadback(recoveryId, check = operation()) {
    requireSupply(typeof recoveryId === "string" && recoveryId.length > 0 && recoveryId.length <= 128, "INPUT_BINDING_REQUIRED");
    const record = (await read(`semantic-catalog/recoveries/${digest(recoveryId).slice(7)}.json`, limits.pointerBytes, check)).value;
    requireSupply(record.recoveryRequestDigest === digest(recoveryId), "DIGEST_MISMATCH");
    // PREFLIGHT is in-memory authorization context, never a completed recovery receipt.
    requireSupply(["COMMITTED", "NOT_COMMITTED"].includes(record.publicationOutcome) &&
      isSupplyDigest(record.publicationRequestDigest), "RECOVERY_RECORD_INVALID");
    await authorizeRecovery(record, check);
    const owner = (await read(`semantic-catalog/recovered-locks/${record.lockDigest.slice(7)}/owner.json`, limits.pointerBytes, check)).value;
    requireSupply(owner.lockDigest === record.lockDigest, "DIGEST_MISMATCH");
    validateSupplyDigest(owner, "lockDigest", "evopilot-harness-semantic-catalog-lock/v1");
    requireSupply(owner.catalogId === binding.id && owner.rootDigest === rootDigest && owner.hostDigest === hostDigest &&
      owner.requestDigest === record.publicationRequestDigest, "RECOVERY_RECORD_INVALID");
    check();
    return {status: "RECOVERED", record, mutationReplayed: false};
  }

  async function recover({expectedLockDigest, expectedHead, recoveryId, authorization: decision}) {
    requireSupply(binding.kind === "ORGANIZATION", "PUBLICATION_ROOT_DENIED");
    requireSupply(isSupplyDigest(expectedLockDigest) && (expectedHead === null || isSupplyDigest(expectedHead)) &&
      typeof recoveryId === "string" && recoveryId.length > 0 && recoveryId.length <= 128, "INPUT_BINDING_REQUIRED");
    const check = operation();
    const requestPath = `semantic-catalog/recoveries/${digest(recoveryId).slice(7)}.json`;
    // A recorded recovery is read back, never repeated after an uncertain move.
    let existing;
    try { existing = (await read(requestPath, limits.pointerBytes, check)).value; }
    catch (error) { if (error.code !== "UNAVAILABLE") throw error; }
    if (existing) {
      requireSupply(existing.lockDigest === expectedLockDigest && existing.expectedHead === expectedHead && digest(existing.authorization) === digest(decision), "INPUT_DRIFT");
      try { return await recoveryReadback(recoveryId, check); }
      catch (error) { if (error.code === "UNAVAILABLE") throw supplyError("UNKNOWN"); throw error; }
    }
    // Reject missing recovery authority before creating even a transient recovery guard.
    await authorizeRecovery(withSupplyDigest({schema: "evopilot-harness-semantic-catalog-recovery/v1", catalogId: binding.id,
      lockDigest: expectedLockDigest, expectedHead, recoveryRequestDigest: digest(recoveryId),
      publicationOutcome: "PREFLIGHT", authorization: structuredClone(decision)}, "recoveryDigest"), check);
    const guard = await checkedPath("semantic-catalog/recovery.lock", {createParents: true});
    check();
    try { await fs.mkdir(guard, {mode: 0o700}); }
    catch (error) { if (error.code === "EEXIST") throw supplyError("LOCKED"); throw error; }
    let moveAttempted = false;
    try {
      const observed = await lockState(check);
      requireSupply(observed.owner.lockDigest === expectedLockDigest && observed.currentHead === expectedHead, "DRIFT");
      requireSupply(observed.ownerState === "DEAD", "LOCK_OWNER_ACTIVE_OR_UNKNOWN");
      let publicationOutcome = "UNKNOWN";
      let pointer = await head(check);
      for (let count = 0; pointer && count < limits.dependencyDepth; count++) {
        if (pointer.receiptDigest === observed.owner.receiptDigest) {
          await readGeneration(pointer, check);
          publicationOutcome = "COMMITTED";
          break;
        }
        if (!pointer.previousPointerDigest) break;
        const expected = pointer.previousPointerDigest;
        pointer = (await read(contentPath("heads", expected), limits.pointerBytes, check)).value;
        validateSemanticPointer(pointer, limits);
        requireSupply(pointer.pointerDigest === expected && pointer.catalogId === binding.id, "DIGEST_MISMATCH");
      }
      if (publicationOutcome === "UNKNOWN" && observed.currentHead === observed.owner.expectedHead) publicationOutcome = "NOT_COMMITTED";
      requireSupply(publicationOutcome !== "UNKNOWN", "UNKNOWN");
      const record = withSupplyDigest({schema: "evopilot-harness-semantic-catalog-recovery/v1", catalogId: binding.id,
        lockDigest: expectedLockDigest, expectedHead, recoveryRequestDigest: digest(recoveryId),
        publicationRequestDigest: observed.owner.requestDigest, publicationOutcome, authorization: structuredClone(decision)}, "recoveryDigest");
      await authorizeRecovery(record, check);
      const confirmed = await lockState(check);
      requireSupply(confirmed.owner.lockDigest === expectedLockDigest && confirmed.ownerState === "DEAD" && confirmed.currentHead === expectedHead, "DRIFT");
      await immutable(requestPath, record, limits.pointerBytes, check);
      // Move the entire stale lock into immutable evidence; preserve all staged materials.
      const destination = await checkedPath(`semantic-catalog/recovered-locks/${expectedLockDigest.slice(7)}`, {createParents: true});
      await authorizeRecovery(record, check);
      const final = await lockState(check);
      requireSupply(final.owner.lockDigest === expectedLockDigest && final.ownerState === "DEAD" && final.currentHead === expectedHead, "DRIFT");
      const source = await checkedPath("semantic-catalog/publication.lock");
      check();
      moveAttempted = true;
      await fs.rename(source, destination);
      await syncDirectory(path.dirname(destination));
      await syncDirectory(path.join(root, "semantic-catalog"));
      check();
      return {status: "RECOVERED", record, mutationReplayed: false};
    } catch (error) { if (moveAttempted) throw supplyError("UNKNOWN"); throw error; }
    finally {
      try { await fs.rmdir(guard); }
      catch (error) { if (moveAttempted) throw supplyError("UNKNOWN"); throw error; }
    }
  }

  const guarded = fn => async (...args) => {
    try { return await fn(...args); } catch (error) { throw redactedError(error); }
  };
  return Object.freeze({inspect: guarded(inspect), publish: guarded(publish), readback: guarded(readback),
    inspectRevision: guarded(inspectRevision), inspectRecovery: guarded(inspectRecovery), recover: guarded(recover), recoveryReadback: guarded(recoveryReadback)});
}
