import type { Scope, WorkspaceIdentity } from './types.js';
import type { Store, State, CatalogSet, CatalogRevision, ProducerHistory, ProducerRecord } from './persistence-types.js';
import { isPromise } from 'node:util/types';
import { exactFields, sha256, stableSerialize, frozenClone } from '../vendor/compatibility/v1/reference.mjs';
import { catalogGeneration as legacy_catalogGeneration } from "./compat/index.mjs";
const { assembleSemanticGeneration, resolveSemanticGeneration } = legacy_catalogGeneration;
import { checkScope } from './legacy-queries.js';
import { bounded, fail, LIMITS } from './state.js';

export const equal = (a: unknown, b: unknown) => a === undefined || b === undefined ? a === b : stableSerialize(a) === stableSerialize(b);
const foreignKinds = ['HarnessBundle', 'HarnessProfile', 'HarnessComponent'];
// Only provider-verified full Harness material bypasses the legacy query rule.
function catalogScope(input: unknown, scope: Scope, workspace: WorkspaceIdentity, known: unknown[]) {
  if (!input || typeof input !== 'object') return;
  const value = input as Record<string, unknown>;
  if (foreignKinds.includes(value.kind as string) && (value.metadata || value.assetDigest)) {
    if (!known.some(v => equal(v, value))) fail('FOREIGN_MATERIAL', 'Unknown full Harness material');
    const copy = { ...value }; delete copy.kind;
    catalogScope(copy, scope, workspace, known); return;
  }
  const shallow = Object.fromEntries(Object.entries(value).filter(([, v]) => !v || typeof v !== 'object'));
  if (Object.hasOwn(value, 'project')) shallow.project = value.project;
  checkScope(shallow, scope, workspace);
  for (const child of Object.values(value)) catalogScope(child, scope, workspace, known);
}
export function buildCatalog(store: Store, state: State, scope: Scope, catalogId: string, sets: CatalogSet[], revokedDigests: string[] = [], historical = false) {
  if (!Array.isArray(sets) || sets.length > LIMITS.catalogSets) fail('LIMIT', 'Catalog set limit');
  const dependencies = new Map<string, { recordId: string; digest: string }>(), records = (state.producerRecords ?? []).filter(v => equal(v.scope, scope));
  function owned(kind: ProducerRecord["kind"], document: unknown, predicate: (h: ProducerHistory, v: ProducerRecord) => boolean = () => true) {
    const record = records.find(v => v.kind === kind && v.history.some(h => equal(h.document, document) && predicate(h, v)));
    if (!record) fail('OWNED_MATERIAL_REQUIRED', 'Exact owned producer history required: ' + kind);
    if (!historical && !equal(record.document, document)) fail('DEPENDENCY_CHANGED', 'Current producer document required');
    if (record.digest !== sha256(record.document) || !record.history.length || !equal(record.history.at(-1)!.document, record.document)) fail('CORRUPT_STATE', 'Producer history differs');
    store.verifyBlob(scope, record.document);
    for (const h of record.history) {
      store.verifyBlob(scope, h); store.verifyBlob(scope, h.document);
      const plan = (state.producerPlans ?? []).find(p => p.planId === h.planId && equal(p.scope, scope));
      if (!plan || (!equal(plan.workspace, store.identity) && !store.acceptsWorkspace(plan.workspace, plan.reviewDigest)) || plan.status !== 'CONSUMED' || !plan.output?.recordIds.includes(record.recordId) || !equal(plan.decision, h.decision) || h.decision?.decision !== 'APPROVE' || h.decision.uid !== store.uid || h.decision.reviewDigest !== plan.reviewDigest) fail('APPROVAL_REQUIRED', 'Owned consumed producer decision required');
      store.verifyBlob(scope, plan);
      const subject = { workspace: plan.workspace, scope: plan.scope, operation: plan.operation, parameters: plan.parameters, dependencies: plan.dependencies };
      if (sha256(subject) !== plan.reviewDigest) fail('CORRUPT_STATE', 'Producer review differs');
      if (h.material) { store.verifyBlob(scope, h.material); if (sha256(h.material) !== h.materialDigest) fail('CORRUPT_STATE', 'Pack material differs'); }
      if (h.foundation) store.verifyBlob(scope, h.foundation);
    }
    dependencies.set(record.recordId, { recordId: record.recordId, digest: sha256(record) });
    return record;
  }
  for (const set of sets) {
    exactFields(set, ['artifactSet', 'closure', 'foundation', 'proposal', 'packs', 'profile', 'index', 'projectionSet', 'roundTripReport', 'incremental', 'full', 'support', 'harnessAssets'], ['priorSnapshot', 'basePackSet']);
    const known: unknown[] = [];
    if (!Array.isArray(set.harnessAssets)) fail('INVALID_MODEL', 'Harness materials required');
    for (const item of set.harnessAssets) {
      exactFields(item, ['entry', 'document']);
      const entry = item.entry;
      const resolver = store.trustedProviders.resolveLegacyHarness;
      if (typeof resolver !== 'function') fail('PROVIDER_REQUIRED', 'Trusted Harness resolver required');
      let resolved: unknown;
      try { resolved = resolver(frozenClone({ reference: { kind: entry.kind, id: entry.id, version: entry.version, digest: entry.assetDigest }, scope, workspace: store.identity })); }
      catch { fail('PROVIDER_FAILED', 'Harness resolver failed'); }
      if (isPromise(resolved)) { Promise.prototype.then.call(resolved, undefined, () => {}); fail('PROVIDER_ASYNC', 'Synchronous verified resolver required'); }
      bounded(resolved);
      const verified = resolved as Record<string, unknown> | null;
      if (!verified || verified.verified !== true || !equal(verified.scope, scope) || !equal(verified.workspace, store.identity) || !equal(verified.entry, entry) || !equal(verified.document, item.document)) fail('PROVIDER_MISMATCH', 'Exact verified Harness identity required');
      known.push(entry, item.document);
    }
    catalogScope(set, scope, store.identity, known);
    owned('Artifact', set.artifactSet, h => equal(h.foundation, set.foundation));
    owned('Proposal', set.proposal);
    if (set.proposal.stage !== 'APPROVED') fail('APPROVAL_REQUIRED', 'Approved owned Proposal required');
    owned('Closure', set.closure);
    for (const pack of set.packs) {
      const record = records.find(v => v.kind === 'PackLifecycle' && v.history.some(h => h.document.stage === 'PUBLISHED' && equal(h.material?.pack ?? null, pack)));
      const history = record?.history.find(h => h.document.stage === 'PUBLISHED' && equal(h.material?.pack ?? null, pack));
      if (!history) fail('OWNED_MATERIAL_REQUIRED', 'Published retained Pack material required');
      owned('PackLifecycle', historical ? history.document : record!.document, h => equal(h.material?.pack ?? null, pack));
      if (!historical && !['PUBLISHED', 'INSTALLED', 'ACTIVE', 'ACTIVATED'].includes(record!.document.stage as string)) fail('DEPENDENCY_CHANGED', 'Pack is no longer published');
    }
    const prior = (snapshot: unknown) => {
      const record = records.find(v => v.kind === 'Artifact' && v.history.some(h => equal((h.document.spec as { snapshot: unknown }).snapshot, snapshot)));
      const h = record?.history.find(h => equal((h.document.spec as { snapshot: unknown }).snapshot, snapshot));
      if (!h) fail('OWNED_MATERIAL_REQUIRED', 'Owned prior snapshot required');
      owned('Artifact', h.document);
    };
    if (set.priorSnapshot) prior(set.priorSnapshot);
    if (set.basePackSet) {
      const record = records.find(v => v.kind === 'Proposal' && v.history.some(h => equal(h.document.resolvedPackSet, set.basePackSet)));
      const h = record?.history.find(h => equal(h.document.resolvedPackSet, set.basePackSet));
      if (!h) fail('OWNED_MATERIAL_REQUIRED', 'Owned base Pack set required');
      owned('Proposal', h.document);
    }
    for (const binding of set.closure.rollbackLinks) {
      const item = set.support.find(v => equal(v.binding, binding));
      if (!item) fail('OWNED_MATERIAL_REQUIRED', 'Owned rollback evidence required');
      if (item.document.schema === 'evopilot-harness-project-ontology-artifact-lifecycle/v1') owned('ArtifactLifecycle', item.document);
      else prior(item.document);
    }
  }
  const built = assembleSemanticGeneration({ catalogId, sets, revokedDigests });
  if (built.generation.entries.some(e => revokedDigests.includes(e.objectDigest))) fail('REVOKED_MATERIAL', 'Revoked dependency cannot be reintroduced');
  const resolved = resolveSemanticGeneration(built);
  const rebuilt = assembleSemanticGeneration({ catalogId, sets: resolved, revokedDigests });
  if (!equal(built.generation, rebuilt.generation) || !equal([...built.material], [...rebuilt.material])) fail('CORRUPT_STATE', 'Catalog rebuild differs');
  return { generation: built.generation, material: [...built.material], dependencies: [...dependencies.values()].sort((a, b) => a.recordId.localeCompare(b.recordId)), sets: resolved };
}
export function verifyCatalogRevision(store: Store, state: State, revision: CatalogRevision) {
  if ((!equal(revision.workspace, store.identity) && !store.acceptsWorkspace(revision.workspace, revision.pointer.pointerDigest))) fail('SCOPE_MISMATCH', 'Catalog workspace differs');
  store.verifyBlob(revision.scope, revision);
  const { pointerDigest, ...pointer } = revision.pointer;
  if (sha256(pointer) !== pointerDigest || !equal(pointer.scope, revision.scope) || !equal(pointer.workspace, revision.workspace) || pointer.generationDigest !== revision.generation.generationDigest || pointer.materialDigest !== sha256(revision.material)) fail('CORRUPT_STATE', 'Catalog pointer differs');
  store.verifyBlob(revision.scope, revision.generation);
  for (const [, document] of revision.material) store.verifyBlob(revision.scope, document);
  const sets = resolveSemanticGeneration({ generation: revision.generation, material: new Map(revision.material) });
  const built = buildCatalog(store, state, revision.scope, revision.generation.catalogId, sets, revision.generation.revokedDigests, true);
  if (!equal(built.generation, revision.generation) || !equal(built.material, revision.material)) fail('CORRUPT_STATE', 'Stored catalog material differs');
  const plan = (state.catalogPlans ?? []).find(p => p.planId === pointer.planId && equal(p.scope, revision.scope));
  if (!plan || plan.status !== 'CONSUMED' || plan.output !== pointerDigest || !equal(plan.decision, pointer.decision) || plan.decision?.decision !== 'APPROVE' || plan.decision.uid !== store.uid || plan.reviewDigest !== plan.decision.reviewDigest) fail('CORRUPT_STATE', 'Catalog decision differs');
  store.verifyBlob(plan.scope, plan);
  const subject = { workspace: plan.workspace, scope: plan.scope, parameters: plan.parameters, dependencies: plan.dependencies, inputDigest: plan.inputDigest, expectedGenerationDigest: plan.expectedGenerationDigest, transitionDigest: plan.transitionDigest };
  if (sha256(subject) !== plan.reviewDigest || (!equal(plan.workspace, store.identity) && !store.acceptsWorkspace(plan.workspace, plan.reviewDigest)) || pointer.catalogId !== plan.parameters.catalogId || pointer.catalogId !== revision.generation.catalogId || pointer.action !== plan.parameters.action || pointer.previous !== plan.parameters.expectedHead || pointer.generationDigest !== plan.expectedGenerationDigest || pointer.actor !== `uid:${store.uid}`) fail('CORRUPT_STATE', 'Catalog publication binding differs');
  if (pointer.previous !== 'EMPTY') {
    const previous = (state.catalogRevisions ?? []).find(v => equal(v.scope, revision.scope) && v.generation.catalogId === pointer.catalogId && v.pointer.pointerDigest === pointer.previous);
    if (!previous || !previous.generation.revokedDigests.every(d => revision.generation.revokedDigests.includes(d))) fail('CORRUPT_STATE', 'Catalog ancestry or cumulative revocation differs');
    store.verifyBlob(previous.scope, previous);
  }
  return { ...revision, sets };
}
