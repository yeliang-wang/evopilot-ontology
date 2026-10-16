import fs from "node:fs/promises";
import {constants} from "node:fs";
import {createSupplyBudget} from "./catalog-budget.mjs";
import path from "node:path";
import { parseDocument } from "yaml";
import { digest } from "../../v3/utils.mjs";
import { validateDocument } from "../../v3/schema.mjs";
import { assertExternalWorkspace } from "../constants.mjs";
import { assertNoSensitiveMaterial } from "../security/sensitive.mjs";
import { assembleSemanticGeneration, resolveSemanticGeneration } from "./catalog-generation.mjs";
import { openSemanticCatalogStore } from "./catalog-store.mjs";
import { isSupplyDigest, isSupplyId, parseSupplyJson, requireSupply, supplyBytes, supplyError,
  supplyLimits, supplyRelativePath } from "./catalog-contract.mjs";

export const SEMANTIC_POLICY_SCHEMA = "evopilot-harness-semantic-catalog-policy/v1";
const assetKey = entry => `${entry.kind}:${entry.id}@${entry.version}`;
const same = (a, b) => digest(a) === digest(b);

// Caller selects only a configured Catalog id, never an arbitrary scan root.
// Configuration and grants are operator-owned; these operations never create them.
async function readBounded(root, relative, maxBytes, check, yaml = false) {
  check();
  relative = supplyRelativePath(relative.replace(/^\.\//, ""));
  const canonicalRoot = await fs.realpath(root);
  let target = canonicalRoot;
  for (const component of relative.split("/")) {
    target = path.join(target, component);
    const stat = await fs.lstat(target);
    requireSupply(!stat.isSymbolicLink(), "PATH_DENIED");
  }
  const fd = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat();
    requireSupply(before.isFile() && before.nlink === 1, "PATH_DENIED");
    requireSupply(before.size > 0 && before.size <= maxBytes, "FILE_LIMIT");
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      check();
      const {bytesRead: count} = await fd.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
      requireSupply(count > 0, "DRIFT");
      offset += count;
    }
    const after = await fd.stat();
    const named = await fs.lstat(target);
    requireSupply(before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs &&
      after.ino === named.ino && after.dev === named.dev && !named.isSymbolicLink() &&
      await fs.realpath(target) === target, "DRIFT");
    check();
    let value;
    if (yaml === "text") return bytes.toString("utf8");
    if (yaml) {
      const parsed = parseDocument(bytes.toString("utf8"), {uniqueKeys: true});
      requireSupply(parsed.errors.length === 0, "INVALID_JSON");
      value = parsed.toJS({maxAliasCount: 0});
      parseSupplyJson(supplyBytes(value));
    } else value = parseSupplyJson(bytes);
    check();
    return value;
  } finally { await fd.close(); }
}

async function context(home, catalogId, overrides, check) {
  check();
  const limits = supplyLimits(overrides);
  const config = await readBounded(home, "config.yaml", limits.pointerBytes, check, true);
  const registry = await readBounded(home, "harness-registry.yaml", limits.generationBytes, check, true);
  requireSupply(registry.schema === "evopilot-harness-registry/v2" && Array.isArray(registry.catalogs) &&
    registry.assets == null && registry.entries == null, "UNSUPPORTED");
  requireSupply(registry.catalogs.length <= limits.entries, "ENTRY_LIMIT");
  requireSupply(registry.catalogs.filter(item => item.enabled === true).length <= limits.enabledRoots, "ROOT_LIMIT");
  requireSupply(new Set(registry.catalogs.map(item => item.id)).size === registry.catalogs.length, "IDENTITY_CONFLICT");
  const reference = registry.catalogs.find(item => item.id === catalogId);
  requireSupply(reference?.enabled === true, reference ? "PERMISSION_DENIED" : "UNAVAILABLE");
  requireSupply(isSupplyId(catalogId), "IDENTITY_CONFLICT");
  const relative = supplyRelativePath(String(reference.root).replace(/^\.\//, ""));
  // Explicit workspace-local roots only. External/network mounts require another reviewed context.
  const root = path.join(home, relative);
  let cursor = home;
  for (const part of relative.split("/")) {
    cursor = path.join(cursor, part);
    const stat = await fs.lstat(cursor);
    requireSupply(stat.isDirectory() && !stat.isSymbolicLink(), "PATH_DENIED");
    check();
  }
  requireSupply(typeof config.semanticCatalogPolicy === "string", "TRUST_REQUIRED");
  const policy = await readBounded(home, config.semanticCatalogPolicy, limits.generationBytes, check);
  requireSupply(validateDocument(policy).valid, "TRUST_REQUIRED");
  requireSupply(policy.schema === SEMANTIC_POLICY_SCHEMA && Array.isArray(policy.catalogs) && policy.catalogs.length <= limits.enabledRoots, "UNSUPPORTED");
  requireSupply(new Set(policy.catalogs.map(item => item.id)).size === policy.catalogs.length, "IDENTITY_CONFLICT");
  const rule = policy.catalogs.find(item => item.id === catalogId);
  requireSupply(rule?.permission === "GRANTED" && isSupplyId(rule.trustContext) &&
    rule.rootBindingDigest === digest({id: reference.id, root: reference.root}), "PERMISSION_DENIED");
  requireSupply(Array.isArray(rule.scopes) && rule.scopes.length <= limits.entries && Array.isArray(rule.grants) && rule.grants.length <= limits.entries, "TRUST_REQUIRED");
  check();
  const organization = config.catalogs?.organization?.replace(/^\.\//, "");
  return {limits, rule, reference, configDigest: digest(rule), catalog: {id: catalogId, root, enabled: true, permission: "GRANTED",
    kind: catalogId === "organization" && relative === organization ? "ORGANIZATION" : "READ_ONLY"}};
}

function grant(rule, {authorizationDigest, actor, subjectDigest, purpose}, now = Date.now()) {
  if (!isSupplyDigest(authorizationDigest) || typeof actor !== "string" || !actor.length) return false;
  return rule.grants.some(item => item.decision === "AUTHORIZED" && item.revoked === false &&
    item.authorizationDigest === authorizationDigest && item.actor === actor && item.subjectDigest === subjectDigest && item.purpose === purpose &&
    (item.expiresAt === null || (typeof item.expiresAt === "string" && Number.isFinite(Date.parse(item.expiresAt)) && Date.parse(item.expiresAt) > now)));
}

export function semanticPublicationSubject({catalogId, generationDigest, expectedHead, action = "PUBLISH", requestId, requestDigest, transitionDigest}) {
  return digest({catalogId, generationDigest, expectedHead, action, requestDigest: requestDigest ?? digest(requestId), ...(transitionDigest ? {transitionDigest} : {})});
}

export function semanticRecoverySubject({catalogId, lockDigest, expectedHead, recoveryId, recoveryRequestDigest}) {
  return digest({catalogId, lockDigest, expectedHead, recoveryRequestDigest: recoveryRequestDigest ?? digest(recoveryId)});
}

function permit(rule, entry) {
  const scope = rule.scopes.find(item => same(item.scope, entry.scope));
  if (!scope || !Array.isArray(scope.visibilities) || !scope.visibilities.includes(entry.visibility)) return false;
  if (entry.category === "ASSET" && !entry.parent) {
    return entry.publication?.decision === "AUTHORIZED" && grant(rule, {...entry.publication, subjectDigest: entry.objectDigest, purpose: "ASSET_PUBLICATION"});
  }
  return true;
}

async function checkLegacyMembership(root, catalogId, sets, limits, check) {
  const lock = await readBounded(root, "catalog.lock.json", limits.generationBytes, check);
  const markdown = await readBounded(root, "CATALOG.md", limits.generationBytes, check, "text");
  requireSupply(digest(markdown) === lock.markdownDigest, "DIGEST_MISMATCH");
  const block = markdown.match(/```yaml\s+evopilot-harness-catalog-v3\n([\s\S]*?)\n```/);
  requireSupply(block, "UNSUPPORTED");
  const parsedIndex = parseDocument(block[1], {uniqueKeys: true});
  requireSupply(parsedIndex.errors.length === 0, "UNSUPPORTED");
  const {markdownDigest, ...lockedIndex} = lock;
  requireSupply(same(parsedIndex.toJS({maxAliasCount: 0}), lockedIndex), "DIGEST_MISMATCH");
  requireSupply(lock.schema === "evopilot-harness-catalog/v3" && lock.assetApiVersion === "harness.evopilot.io/v3" && lock.catalogId === catalogId &&
    lock.entryCount === lock.entries?.length && lock.entries.length <= limits.entries, "UNSUPPORTED");
  const {schema, generatedBy, assetApiVersion, entryCount, entries} = lock;
  requireSupply(lock.catalogDigest === digest({schema, catalogId, generatedBy, assetApiVersion, entryCount, entries}), "DIGEST_MISMATCH");
  // Exact membership is sufficient; unrelated Catalog additions do not invalidate a bound set.
  const byKey = new Map();
  for (const entry of entries) {
    requireSupply(!byKey.has(assetKey(entry)), "IDENTITY_CONFLICT");
    byKey.set(assetKey(entry), entry);
  }
  const checked = new Map();
  for (const set of sets) for (const {entry, document} of set.harnessAssets) {
    const published = byKey.get(assetKey(entry));
    requireSupply(published && same(published, entry) && published.lifecycle === "published", "HARNESS_BINDING_MISMATCH");
    if (!checked.has(entry.assetPath)) checked.set(entry.assetPath, await readBounded(root, entry.assetPath, limits.materialBytes, check, true));
    requireSupply(same(checked.get(entry.assetPath), document) && digest(document) === entry.assetDigest, "HARNESS_BINDING_MISMATCH");
  }
}

async function connectedStore(home, catalogId, overrides, signal, check) {
  const initial = await context(home, catalogId, overrides, check);
  async function current() {
    const value = await context(home, catalogId, overrides, check);
    requireSupply(value.catalog.root === initial.catalog.root, "DRIFT");
    return value;
  }
  const store = await openSemanticCatalogStore({catalog: initial.catalog, limits: initial.limits, signal, budget: check,
    policy: {
      authorize: async ({receipt}) => grant((await current()).rule, {...receipt.authorization,
        subjectDigest: semanticPublicationSubject(receipt), purpose: "CATALOG_PUBLICATION"}),
      authorizeRecovery: async ({record}) => grant((await current()).rule, {...record.authorization,
        subjectDigest: semanticRecoverySubject(record), purpose: "CATALOG_RECOVERY"}),
      permitEntry: async ({entry}) => permit((await current()).rule, entry)
    },
    validateMaterials: async ({generation, material}) => {
      const active = await current();
      const sets = resolveSemanticGeneration({generation, material, limits: active.limits});
      check();
      await checkLegacyMembership(active.catalog.root, catalogId, sets, active.limits, check);
      check();
      return true;
    }});
  return {store, current, initial};
}

async function inputSets(home, file, inputDigest, limits, check) {
  requireSupply(typeof file === "string" && isSupplyDigest(inputDigest), "INPUT_BINDING_REQUIRED");
  const relative = path.relative(home, path.resolve(home, file)).split(path.sep).join("/");
  const input = await readBounded(home, relative, limits.totalMaterialBytes, check);
  requireSupply(input.schema === "evopilot-harness-semantic-supply-input/v1" && Array.isArray(input.sets), "UNSUPPORTED");
  requireSupply(digest(input) === inputDigest, "INPUT_DRIFT");
  return input;
}

/** Explicit Engine service. Policy/configuration are read-only and never copied from input. */
async function runSemanticCatalogOperation({home, action, catalogId = "organization", file, inputDigest,
  expectedGenerationDigest, expectedHead, requestId, publication, limits, signal,
  transition, targetPointerDigest, revokedDigests, expectedLockDigest, recoveryId}, check) {
  try {
    const workspace = assertExternalWorkspace(home);
    const connected = await connectedStore(workspace, catalogId, limits, signal, check);
    if (action === "recovery-inspect") return {schema: "evopilot-harness-semantic-recovery-inspection/v1", ...await connected.store.inspectRecovery()};
    if (action === "recovery-readback") return {schema: "evopilot-harness-semantic-recovery-readback/v1", ...await connected.store.recoveryReadback(recoveryId)};
    if (action === "recover") {
      requireSupply(expectedHead === "EMPTY" || isSupplyDigest(expectedHead), "EXPECTED_HEAD_REQUIRED");
      return {schema: "evopilot-harness-semantic-recovery-result/v1", ...await connected.store.recover({expectedLockDigest,
        expectedHead: expectedHead === "EMPTY" ? null : expectedHead, recoveryId, authorization: publication})};
    }
    if (["transition-preview", "rollback", "revoke"].includes(action)) {
      const kind = action === "transition-preview" ? transition : action.toUpperCase();
      requireSupply(["ROLLBACK", "REVOKE"].includes(kind), "UNSUPPORTED");
      requireSupply(isSupplyDigest(expectedHead), "EXPECTED_HEAD_REQUIRED");
      const current = await connected.store.inspect();
      requireSupply(current.pointer.pointerDigest === expectedHead, "CONFLICT");
      let sets;
      let revoked = [...current.generation.revokedDigests];
      let transitionDigest;
      if (kind === "ROLLBACK") {
        const target = await connected.store.inspectRevision(targetPointerDigest);
        sets = resolveSemanticGeneration(target);
        transitionDigest = digest({action: kind, targetPointerDigest});
      } else {
        requireSupply(Array.isArray(revokedDigests) && revokedDigests.length > 0 && revokedDigests.length <= current.limits.entries &&
          revokedDigests.every(isSupplyDigest) && new Set(revokedDigests).size === revokedDigests.length, "REVOCATION_TARGET_INVALID");
        requireSupply(revokedDigests.every(hash => current.generation.entries.some(entry => entry.objectDigest === hash)), "REVOCATION_TARGET_INVALID");
        revoked = [...new Set([...revoked, ...revokedDigests])].sort();
        sets = resolveSemanticGeneration(current).filter(set => !assembleSemanticGeneration({catalogId, sets: [set]}).generation.entries.some(entry => revoked.includes(entry.objectDigest)));
        transitionDigest = digest({action: kind, revokedDigests: [...revokedDigests].sort()});
      }
      check();
      const built = assembleSemanticGeneration({catalogId, sets, revokedDigests: revoked, limits: current.limits});
      await check.yield();
      if (action === "transition-preview") return {schema: "evopilot-harness-semantic-transition-preview/v1", status: "READY", action: kind,
        expectedHead, generationDigest: built.generation.generationDigest, transitionDigest, entryCount: built.generation.entries.length,
        grantsPublicationAuthority: false};
      requireSupply(expectedGenerationDigest === built.generation.generationDigest, "GENERATION_MISMATCH");
      return {schema: "evopilot-harness-semantic-supply-publication/v1", ...await connected.store.publish({...built, expectedHead, requestId,
        action: kind, transitionDigest, authorization: publication})};
    }
    if (action === "preview" || action === "publish") {
      const active = await connected.current();
      const input = await inputSets(workspace, file, inputDigest, active.limits, check);
      const built = assembleSemanticGeneration({catalogId, sets: input.sets, revokedDigests: input.revokedDigests ?? [], limits: active.limits});
      await check.yield();
      await checkLegacyMembership(active.catalog.root, catalogId, input.sets, active.limits, check);
      requireSupply(built.generation.entries.every(entry => permit(active.rule, entry)), "PERMISSION_DENIED");
      if (action === "preview") return {schema: "evopilot-harness-semantic-supply-preview/v1", status: "READY", catalogId, inputDigest,
        generationDigest: built.generation.generationDigest, entryCount: built.generation.entries.length,
        policyDigest: active.configDigest, limits: active.limits, grantsPublicationAuthority: false};
      requireSupply(expectedGenerationDigest === built.generation.generationDigest, "GENERATION_MISMATCH");
      requireSupply(expectedHead === "EMPTY" || isSupplyDigest(expectedHead), "EXPECTED_HEAD_REQUIRED");
      const result = await connected.store.publish({...built, requestId, expectedHead: expectedHead === "EMPTY" ? null : expectedHead, authorization: publication});
      return {schema: "evopilot-harness-semantic-supply-publication/v1", ...result};
    }
    if (action === "readback") return {schema: "evopilot-harness-semantic-supply-readback/v1", ...await connected.store.readback(requestId)};
    requireSupply(action === "inspect", "UNSUPPORTED");
    const result = await connected.store.inspect();
    const active = await connected.current();
    requireSupply(result.generation.entries.every(entry => permit(active.rule, entry)), "PERMISSION_DENIED");
    assertNoSensitiveMaterial(result.generation);
    return {schema: "evopilot-harness-semantic-supply-discovery/v1", status: "AVAILABLE", catalogId,
      pointerDigest: result.pointer.pointerDigest, generationDigest: result.generation.generationDigest,
      entries: result.generation.entries, sets: result.generation.sets, revokedDigests: result.generation.revokedDigests,
      policyDigest: active.configDigest, limits: result.limits, readOnly: true, grantsPublicationAuthority: false};
  } catch (error) {
    const code = error?.name === "OntologyCatalogError" ? error.code : error?.code === "ENOENT" ? "UNAVAILABLE" : "IO_OR_VALIDATION_FAILED";
    throw supplyError(code);
  }
}

export async function semanticCatalogOperation(options) {
  try {
    const check = createSupplyBudget(options.limits, options.signal);
    // Pin mutable operation inputs before the first await; never accept a caller budget.
    const bound = {...options, limits: check.limits, publication: structuredClone(options.publication),
      revokedDigests: structuredClone(options.revokedDigests)};
    const result = await runSemanticCatalogOperation(bound, check);
    try { check(); }
    catch (error) {
      if (["PUBLISHED", "RECOVERED"].includes(result.status)) throw supplyError("UNKNOWN");
      throw error;
    }
    return result;
  } catch (error) {
    throw supplyError(error?.name === "OntologyCatalogError" ? error.code : "IO_OR_VALIDATION_FAILED");
  }
}
