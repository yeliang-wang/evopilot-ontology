import type { DispatchRequest, Scope, Receipt } from './types.js';
import type { Store, State, CatalogParameters, CatalogPlan, CatalogPointer } from './persistence-types.js';
import { exactFields, sha256, stableSerialize, textField } from '../vendor/compatibility/v1/reference.mjs';
import { catalogGeneration as legacy_catalogGeneration } from "./compat/index.mjs";
const { assembleSemanticGeneration } = legacy_catalogGeneration;
import { buildCatalog, equal, verifyCatalogRevision } from './catalog-materials.js';
import { fail, LIMITS, slug } from './state.js';

const prefix = 'semantic.catalog.';
export const catalogOperations = Object.freeze(['preview', 'inspect', 'readback', 'publish', 'transition-preview', 'rollback', 'revoke', 'recovery-inspect', 'recovery-readback', 'recover'].map(n => prefix + n).concat(['catalog.prepare', 'catalog.decide', 'catalog.plan-inspect']));
export const catalogMutations = Object.freeze(['publish', 'rollback', 'revoke', 'recover'].map(n => prefix + n).concat(['catalog.prepare', 'catalog.decide']));
const hash = (v: unknown) => { if (typeof v !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(v)) fail('INVALID_REQUEST', 'Exact digest required'); };
function parameters(input: unknown) {
  const p = input as CatalogParameters;
  if (!['PUBLISH', 'ROLLBACK', 'REVOKE'].includes(p.action)) fail('INVALID_REQUEST', 'Catalog action required');
  exactFields(p, ['catalogId', 'action', 'expectedHead', ...(p.action === 'PUBLISH' ? ['sets'] : p.action === 'ROLLBACK' ? ['targetPointerDigest'] : ['revokedDigests'])]);
  slug(p.catalogId); if (p.expectedHead !== 'EMPTY') hash(p.expectedHead);
  if (p.action === 'ROLLBACK') hash(p.targetPointerDigest);
  if (p.action === 'REVOKE') {
    if (!Array.isArray(p.revokedDigests) || !p.revokedDigests.length || p.revokedDigests.length > LIMITS.catalogRevocations || new Set(p.revokedDigests).size !== p.revokedDigests.length) fail('INVALID_REQUEST', 'Nonempty unique revocations required');
    p.revokedDigests.forEach(hash);
  }
}
export function validateCatalogRequest(r: DispatchRequest) {
  const op = r.operation, i = r.input as unknown as CatalogParameters & { planId: string; requestId: string; intentDigest: string; reviewDigest: string; decision: "APPROVE" | "REJECT"; evidenceRef: string };
  if (['catalog.prepare', prefix + 'preview', prefix + 'transition-preview'].includes(op)) {
    parameters(i);
    if ((op === prefix + 'preview' && i.action !== 'PUBLISH') || (op === prefix + 'transition-preview' && i.action === 'PUBLISH')) fail('INVALID_REQUEST', 'Wrong preview action');
    return;
  }
  const fields = {
    'catalog.decide': ['planId', 'reviewDigest', 'decision', 'evidenceRef'], 'catalog.plan-inspect': ['planId'],
    [prefix + 'inspect']: ['catalogId'], [prefix + 'recovery-inspect']: ['catalogId'],
    [prefix + 'readback']: ['requestId'], [prefix + 'recovery-readback']: ['requestId', 'intentDigest'],
    [prefix + 'recover']: ['requestId', 'intentDigest'],
  };
  exactFields(i, fields[op] ?? ['planId']);
  if (i.planId) hash(i.planId);
  if (i.catalogId) slug(i.catalogId);
  if (i.requestId) slug(i.requestId);
  if (i.intentDigest) hash(i.intentDigest);
  if (op === 'catalog.decide') { hash(i.reviewDigest); textField(i.evidenceRef); if (!['APPROVE', 'REJECT'].includes(i.decision as string)) fail('INVALID_REQUEST', 'Explicit decision required'); }
}
export const catalogSubject = (p: Omit<CatalogPlan, "reviewDigest" | "planId">) => ({ workspace: p.workspace, scope: p.scope, parameters: p.parameters, dependencies: p.dependencies, inputDigest: p.inputDigest, expectedGenerationDigest: p.expectedGenerationDigest, transitionDigest: p.transitionDigest });
function verifyPlan(store: Store, plan: CatalogPlan) {
  store.verifyBlob(plan.scope, plan);
  if ((!equal(plan.workspace, store.identity) && !store.acceptsWorkspace(plan.workspace, plan.reviewDigest)) || sha256(catalogSubject(plan)) !== plan.reviewDigest) fail('CORRUPT_STATE', 'Catalog review differs');
}
export function verifyCatalogReceipt(store: Store, state: State, scope: Scope, receipt: Receipt<Record<string, unknown>>) {
  if (!equal(receipt.scope, scope) || !catalogMutations.includes(receipt.operation)) fail('NOT_FOUND', 'Scoped catalog mutation receipt required');
  const audit = store.db.prepare('SELECT * FROM audit WHERE revision = ?').get(receipt.revision);
  if (!audit || audit.request_digest !== receipt.requestDigest || audit.result_digest !== sha256(receipt.result) || audit.operation !== receipt.operation || audit.uid !== receipt.uid || receipt.uid !== store.uid) fail('CORRUPT_STATE', 'Receipt audit differs');
  if ([prefix + 'publish', prefix + 'rollback', prefix + 'revoke'].includes(receipt.operation)) {
    const revision = (state.catalogRevisions ?? []).find(v => equal(v.scope, scope) && v.pointer.pointerDigest === receipt.result.pointerDigest);
    if (!revision || revision.pointer.requestId !== receipt.requestId || revision.pointer.intentDigest !== receipt.requestDigest) fail('CORRUPT_STATE', 'Receipt revision differs');
    verifyCatalogRevision(store, state, revision);
    const plan = state.catalogPlans!.find(p => p.planId === revision.pointer.planId); verifyPlan(store, plan!);
  } else if (receipt.operation === prefix + 'recover' && receipt.result.status === 'COMMITTED') {
    const original = store.db.prepare('SELECT receipt FROM receipts WHERE scope = ? AND request_id = ?').get(stableSerialize(scope), receipt.result.requestId as string);
    if (!original) fail('CORRUPT_STATE', 'Missing reconciled receipt');
    const value = JSON.parse(original.receipt as string);
    if (![prefix + 'publish', prefix + 'rollback', prefix + 'revoke'].includes(value.operation) || value.requestDigest !== receipt.result.intentDigest) fail('CORRUPT_STATE', 'Reconciliation differs');
    verifyCatalogReceipt(store, state, scope, value);
  } else if (receipt.operation === 'catalog.prepare' || receipt.operation === 'catalog.decide') {
    // Repeated subjects share reviewDigest; bind the exact original request.
    // The audited receipt preserves decisions even after later decisions replace them.
    const plan = (state.catalogPlans ?? []).find(p => {
      if (!equal(p.scope, scope) || p.reviewDigest !== receipt.result.reviewDigest) return false;
      if (receipt.operation === 'catalog.prepare') return p.planId === receipt.result.planId && p.planId === sha256({ reviewDigest: p.reviewDigest, requestId: receipt.requestId }) && receipt.requestDigest === sha256({ operation: receipt.operation, scope, input: p.parameters });
      const input = { planId: p.planId, reviewDigest: p.reviewDigest, decision: receipt.result.decision, evidenceRef: receipt.result.evidenceRef };
      return receipt.requestDigest === sha256({ operation: receipt.operation, scope, input });
    });
    if (!plan) fail('CORRUPT_STATE', 'Missing catalog plan');
    verifyPlan(store, plan);
  }
  return receipt;
}
export function operateCatalog(store: Store, state: State, r: DispatchRequest) {
  const own = (v: { scope: Scope }) => equal(v.scope, r.scope), plans = state.catalogPlans ?? [], revisions = state.catalogRevisions ?? [], heads = state.catalogHeads ?? [];
  function revision(digest: unknown, catalogId: unknown) {
    const v = revisions.find(v => own(v) && v.pointer.pointerDigest === digest && v.generation.catalogId === catalogId);
    if (!v) fail('NOT_FOUND', 'Own catalog revision required');
    return verifyCatalogRevision(store, state, v);
  }
  function current(catalogId: unknown) {
    const h = heads.find(v => own(v) && v.catalogId === catalogId);
    return h ? revision(h.pointerDigest, catalogId) : null;
  }
  function calculate(p: CatalogParameters) {
    const head = current(p.catalogId), headDigest = head?.pointer.pointerDigest ?? 'EMPTY';
    if (p.expectedHead !== headDigest) fail('HEAD_CONFLICT', 'Catalog head changed');
    let sets, revoked = head?.generation.revokedDigests ?? [];
    if (p.action === 'PUBLISH') { sets = p.sets; if (!Array.isArray(sets) || !sets.length) fail('EMPTY_PUBLICATION', 'Publication requires complete assets'); }
    else {
      if (!head) fail('NOT_FOUND', 'Published catalog required');
      if (p.action === 'ROLLBACK') {
        if (p.targetPointerDigest === headDigest) fail('INVALID_REQUEST', 'Rollback requires prior revision');
        sets = revision(p.targetPointerDigest, p.catalogId).sets;
      } else {
        if (!p.revokedDigests!.every(d => head.generation.entries.some(e => e.objectDigest === d))) fail('UNKNOWN_REVOCATION', 'Known current digest required');
        revoked = [...new Set([...revoked, ...p.revokedDigests!])].sort();
        sets = head.sets.filter(set => !assembleSemanticGeneration({ catalogId: p.catalogId, sets: [set] }).generation.entries.some(e => revoked.includes(e.objectDigest)));
      }
    }
    if (revoked.length > LIMITS.catalogRevocations) fail('LIMIT', 'Cumulative revocation limit');
    const built = buildCatalog(store, state, r.scope, p.catalogId, sets, revoked, p.action !== 'PUBLISH');
    const inputDigest = sha256({ workspace: store.identity, scope: r.scope, parameters: p, material: built.material, dependencies: built.dependencies });
    const expectedGenerationDigest = built.generation.generationDigest;
    const transitionDigest = sha256({ action: p.action, expectedHead: headDigest, inputDigest, expectedGenerationDigest, revokedDigests: revoked });
    return { ...built, inputDigest, expectedGenerationDigest, transitionDigest, head: headDigest, authority: false };
  }
  const op = r.operation, i = r.input as unknown as CatalogParameters & { planId: string; requestId: string; intentDigest: string; reviewDigest: string; decision: "APPROVE" | "REJECT"; evidenceRef: string };
  if (op === prefix + 'preview' || op === prefix + 'transition-preview') {
    const v = calculate(i); return { generationDigest: v.expectedGenerationDigest, expectedGenerationDigest: v.expectedGenerationDigest, inputDigest: v.inputDigest, transitionDigest: v.transitionDigest, head: v.head, authority: false };
  }
  if (op === prefix + 'inspect') return current(i.catalogId) ?? { head: 'EMPTY', authority: false };
  if (op === prefix + 'recovery-inspect') {
    const head = current(i.catalogId);
    for (const v of revisions.filter(v => own(v) && v.generation.catalogId === i.catalogId)) {
      verifyCatalogRevision(store, state, v);
      const row = store.db.prepare('SELECT receipt FROM receipts WHERE scope = ? AND request_id = ?').get(stableSerialize(r.scope), v.pointer.requestId);
      if (!row) fail('CORRUPT_STATE', 'Missing publication receipt');
      verifyCatalogReceipt(store, state, r.scope, JSON.parse(row.receipt as string));
    }
    return { status: 'CLEAN', reconcilable: true, head: head?.pointer.pointerDigest ?? 'EMPTY', externalWork: false, authority: false };
  }
  if ([prefix + 'readback', prefix + 'recovery-readback', prefix + 'recover'].includes(op)) {
    if (op === prefix + 'recover' && r.requestId === i.requestId) fail('REQUEST_CONFLICT', 'Reconciliation requires its own request id');
    const row = store.db.prepare('SELECT digest, receipt FROM receipts WHERE scope = ? AND request_id = ?').get(stableSerialize(r.scope), i.requestId);
    if (!row) {
      if (store.db.prepare('SELECT request_id FROM receipts WHERE request_id = ?').get(i.requestId)) fail('SCOPE_MISMATCH', 'Request belongs to another scope');
      if (op === prefix + 'readback') fail('NOT_FOUND', 'Scoped receipt required');
      for (const v of revisions.filter(own)) {
        verifyCatalogRevision(store, state, v);
        if (v.pointer.requestId === i.requestId) fail('CORRUPT_STATE', 'Revision exists without receipt');
      }
      return { status: 'NOT_COMMITTED', requestId: i.requestId, intentDigest: i.intentDigest, authority: false };
    }
    const receipt = verifyCatalogReceipt(store, state, r.scope, JSON.parse(row.receipt as string));
    if (row.digest !== receipt.requestDigest) fail('CORRUPT_STATE', 'Receipt intent differs');
    if (op === prefix + 'readback') return receipt;
    if (![prefix + 'publish', prefix + 'rollback', prefix + 'revoke'].includes(receipt.operation) || receipt.requestDigest !== i.intentDigest) fail('REQUEST_CONFLICT', 'Exact original publication intent required');
    return { status: 'COMMITTED', requestId: i.requestId, intentDigest: i.intentDigest, pointerDigest: receipt.result.pointerDigest, originalRevision: receipt.revision, authority: false };
  }
  if (op === 'catalog.prepare') {
    if (plans.length >= LIMITS.catalogPlans) fail('LIMIT', 'Catalog plan count');
    const v = calculate(i);
    const plan = { workspace: store.identity, scope: r.scope, parameters: i, dependencies: v.dependencies, inputDigest: v.inputDigest, expectedGenerationDigest: v.expectedGenerationDigest, transitionDigest: v.transitionDigest, status: 'PREPARED', decision: null, output: null } as Omit<CatalogPlan, "reviewDigest" | "planId"> as CatalogPlan;
    plan.reviewDigest = sha256(catalogSubject(plan)); plan.planId = sha256({ reviewDigest: plan.reviewDigest, requestId: r.requestId });
    store.blob(r.scope, plan); (state.catalogPlans ??= []).push(plan); return plan;
  }
  const plan = plans.find(p => own(p) && p.planId === i.planId);
  if (!plan) fail('NOT_FOUND', 'Scoped catalog plan required'); verifyPlan(store, plan);
  if (op === 'catalog.plan-inspect') { if (plan.output) revision(plan.output, plan.parameters.catalogId); return plan; }
  if (!equal(plan.workspace, store.identity)) fail('RELOCATION_REVIEW_REQUIRED', 'Historical Catalog plan requires new preparation and review');
  if (plan.status !== 'PREPARED') fail('PLAN_CONSUMED', 'Catalog plan consumed');
  const calculated = calculate(plan.parameters);
  if (calculated.inputDigest !== plan.inputDigest || calculated.transitionDigest !== plan.transitionDigest || !equal(calculated.dependencies, plan.dependencies)) fail('DEPENDENCY_CHANGED', 'Catalog dependencies changed');
  if (op === 'catalog.decide') {
    if (i.reviewDigest !== plan.reviewDigest) fail('REVIEW_MISMATCH', 'Exact catalog review required');
    plan.decision = { reviewDigest: i.reviewDigest, decision: i.decision, evidenceRef: i.evidenceRef, uid: store.uid, at: new Date().toISOString() };
    store.blob(r.scope, plan); return plan.decision;
  }
  if (op !== prefix + plan.parameters.action.toLowerCase()) fail('PLAN_OPERATION_MISMATCH', 'Wrong catalog action');
  if (plan.decision?.decision !== 'APPROVE' || plan.decision.reviewDigest !== plan.reviewDigest || plan.decision.uid !== store.uid) fail('APPROVAL_REQUIRED', 'Exact local catalog decision required');
  if (revisions.length >= LIMITS.catalogRevisions) fail('LIMIT', 'Catalog revision count');
  const pointer = { workspace: store.identity, scope: r.scope, catalogId: plan.parameters.catalogId, generationDigest: calculated.expectedGenerationDigest, materialDigest: sha256(calculated.material), previous: calculated.head, action: plan.parameters.action, planId: plan.planId, decision: plan.decision, actor: `uid:${store.uid}`, at: new Date().toISOString(), requestId: r.requestId, intentDigest: sha256({ operation: r.operation, scope: r.scope, input: r.input }) } as CatalogPointer;
  pointer.pointerDigest = sha256(pointer);
  const v = { workspace: store.identity, scope: r.scope, pointer, generation: calculated.generation, material: calculated.material };
  for (const [, doc] of v.material) store.blob(r.scope, doc);
  store.blob(r.scope, v.generation); store.blob(r.scope, v);
  (state.catalogRevisions ??= []).push(v);
  const head = { scope: r.scope, catalogId: pointer.catalogId, pointerDigest: pointer.pointerDigest };
  const old = heads.findIndex(h => own(h) && h.catalogId === pointer.catalogId);
  state.catalogHeads ??= []; if (old < 0) state.catalogHeads.push(head); else state.catalogHeads[old] = head;
  plan.status = 'CONSUMED'; plan.output = pointer.pointerDigest; store.blob(r.scope, plan);
  return { pointerDigest: pointer.pointerDigest, generationDigest: pointer.generationDigest, authority: false };
}
