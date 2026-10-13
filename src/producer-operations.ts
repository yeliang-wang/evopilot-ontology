import type { DispatchRequest, Scope } from './types.js';
import type { Store, State, ProducerPlan, ProducerRecord } from './persistence-types.js';
import { exactFields, textField, sha256, stableSerialize } from '../vendor/compatibility/v1/reference.mjs';
import { digest } from './compat/v3/utils.mjs';
import { packs as packs } from "./compat/index.mjs";
import { projectOntology as project } from "./compat/index.mjs";
import { interoperability as legacy_interoperability } from "./compat/index.mjs";
const { publishTerminalSemanticClosure } = legacy_interoperability;
import { validation as legacy_validation } from "./compat/index.mjs";
const { validateDocument } = legacy_validation;
import { operateImport } from './import-operations.js';
import { checkScope } from './legacy-queries.js';
import { grounding } from './compat/index.mjs';
import { bounded, fail, LIMITS } from './state.js';

const fields: Record<string, [string[], string[]]> = {
  'ontology.publish': [['sourceId'], []],
  'pack.lifecycle.create': [['pack', 'targetRoot'], ['availablePacks', 'dependencyClosure', 'conflictPreview', 'project', 'migrationPlan']],
  'pack.lifecycle.transition': [['recordId', 'expectedRecordDigest', 'action'], ['reason', 'successor', 'rollbackTarget', 'migrationPlan']],
  'project-ontology.proposal.create': [['project', 'packs'], ['precedence', 'targetRoot', 'baseSnapshot', 'expectedBaseDigest', 'overlay']],
  'project-ontology.proposal.transition': [['recordId', 'expectedProposalDigest', 'action'], ['reason']],
  'project-ontology.artifact.publish': [['recordId', 'expectedProposalDigest', 'foundationDigest', 'version'], ['foundation']],
  'project-ontology.artifact.transition': [['artifactRecordId', 'expectedArtifactDigest', 'recordId', 'expectedRecordDigest', 'action'], ['reason', 'successor', 'rollbackTarget', 'migrationPlan']],
  'semantic.closure.publish': [['closure', 'artifactRecordId', 'expectedArtifactDigest', 'version'], []],
};
export const producerRoutes = Object.freeze(Object.keys(fields));
export const producerOperations = Object.freeze([...producerRoutes, 'producer.prepare', 'producer.decide', 'producer.inspect', 'producer.list']);
export const producerMutations = Object.freeze([...producerRoutes, 'producer.prepare', 'producer.decide']);
const hash = (value: unknown) => { if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) fail('INVALID_REQUEST', 'Exact digest required'); };
function parameters(operation: string, p: Record<string, unknown>) {
  if (!Object.hasOwn(fields, operation)) fail('UNSUPPORTED_OPERATION', 'Unknown producer');
  exactFields(p, ...fields[operation]);
  for (const [key, value] of Object.entries(p)) {
    if ((key.endsWith('Digest') && value !== null) || key.endsWith('Id')) hash(value);
    if (key === 'reason') textField(value);
  }
  if ('version' in p && (typeof p.version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(p.version))) fail('INVALID_REQUEST', 'Strict numeric version required');
  if ('action' in p) {
    const actions = operation === 'project-ontology.proposal.transition' ? ['APPLY', 'REQUEST_REVIEW', 'APPROVE', 'REJECT'] : operation === 'pack.lifecycle.transition' ? ['APPLY', 'REQUEST_REVIEW', 'APPROVE', 'PUBLISH', 'INSTALL', 'ACTIVATE', 'SUPERSEDE', 'ROLLBACK', 'DEPRECATE'] : ['INSTALL', 'ACTIVATE', 'SUPERSEDE', 'ROLLBACK', 'DEPRECATE'];
    if (!actions.includes(p.action as string)) fail('INVALID_REQUEST', 'Unsupported action');
    for (const key of ['successor', 'rollbackTarget', 'migrationPlan']) if (key in p) {
      if ((key === 'rollbackTarget' && p.action !== 'ROLLBACK') || (key !== 'rollbackTarget' && p.action !== 'SUPERSEDE')) fail('INVALID_REQUEST', 'Unsupported action field');
      exactFields(p[key], ['id', 'version', 'digest']); textField(p[key].id); textField(p[key].version); hash(p[key].digest);
    }
  }
}
function foundationMaterial(p: Record<string, unknown>) {
  if (Object.hasOwn(p, 'foundation')) bounded(p.foundation);
  const supplied = p.foundation as { metaTypes?: unknown; relationTypes?: unknown; limits?: unknown } | undefined;
  const foundation = supplied === undefined ? grounding.resolveOntologyFoundation() : grounding.resolveOntologyFoundation({
    metaTypes: supplied?.metaTypes, relationTypes: supplied?.relationTypes, limits: supplied?.limits,
  });
  if ((supplied !== undefined && stableSerialize(supplied) !== stableSerialize(foundation)) || p.foundationDigest !== foundation.foundationDigest) fail('INVALID_MODEL', 'Canonical foundation material and exact digest required');
  return foundation;
}
function packMaterial(p: Record<string, unknown>) {
  bounded(p);
  const available = Object.hasOwn(p, 'availablePacks') ? p.availablePacks : [];
  if (!Array.isArray(available)) fail('INVALID_MODEL', 'availablePacks must be an array');
  const all = [p.pack] as ({ metadata?: { id?: unknown; version?: unknown } } | null)[];
  for (const candidate of available as typeof all) {
    const same = all.find(v => v?.metadata?.id === candidate?.metadata?.id && v?.metadata?.version === candidate?.metadata?.version);
    if (same) {
      if (same !== p.pack || stableSerialize(same) !== stableSerialize(candidate)) fail('INVALID_MODEL', 'Conflicting or duplicate Pack identity');
    } else all.push(candidate);
  }
  for (const pack of all) {
    const inspection = packs.inspectProfessionalPack(pack, { availablePacks: all });
    if (inspection.lint.status !== 'PASSED') fail('INVALID_MODEL', 'Complete lint-valid Pack material required');
  }
  const resolved = packs.resolveProfessionalPackSet({ packs: all, targetRoot: p.targetRoot });
  if (resolved.conflicts.length) fail('INVALID_MODEL', 'Conflicting Pack concepts');
  const dependencyClosure = { digest: resolved.packSetDigest };
  const conflictPreview = { digest: digest(resolved.conflicts) };
  for (const [key, actual] of Object.entries({ dependencyClosure, conflictPreview })) {
    if (Object.hasOwn(p, key) && stableSerialize(p[key]) !== stableSerialize(actual)) fail('DEPENDENCY_CHANGED', 'Pack material pin differs');
  }
  return { pack: p.pack, availablePacks: all.slice(1), targetRoot: p.targetRoot, resolved, dependencyClosure, conflictPreview };
}
export function validateProducerRequest(r: DispatchRequest) {
  const f: Record<string, string[]> = { 'producer.prepare': ['operation', 'parameters'], 'producer.decide': ['planId', 'reviewDigest', 'decision', 'humanEvidenceRef'], 'producer.inspect': ['planId'], 'producer.list': [] };
  exactFields(r.input, f[r.operation] ?? ['planId']);
  if (r.operation === 'producer.prepare') parameters(r.input.operation as string, r.input.parameters as Record<string, unknown>);
  if ('planId' in r.input) hash(r.input.planId);
  if (r.operation === 'producer.decide') {
    hash(r.input.reviewDigest); textField(r.input.humanEvidenceRef);
    if (!['APPROVE', 'REJECT'].includes(r.input.decision as string)) fail('INVALID_REQUEST', 'Explicit decision required');
  }
}
const subject = (p: Omit<ProducerPlan, "reviewDigest" | "planId">) => ({ workspace: p.workspace, scope: p.scope, operation: p.operation, parameters: p.parameters, dependencies: p.dependencies });
export function operateProducer(store: Store, state: State, r: DispatchRequest) {
  const own = (v: { scope: Scope }) => stableSerialize(v.scope) === stableSerialize(r.scope);
  const records = state.producerRecords ?? [], plans = state.producerPlans ?? [];
  function verify(v: ProducerRecord) {
    store.verifyBlob(v.scope, v.document);
    if (v.digest !== sha256(v.document)) fail('CORRUPT_STATE', 'Producer document digest differs');
    for (const h of v.history) store.verifyBlob(v.scope, h);
    if (v.material !== undefined) {
      store.verifyBlob(v.scope, v.material);
      if (v.materialDigest !== sha256(v.material) || v.history.some(h => h.materialDigest !== v.materialDigest || stableSerialize(h.material) !== stableSerialize(v.material))) fail('CORRUPT_STATE', 'Retained material binding differs');
    }
    if (v.foundation !== undefined) {
      store.verifyBlob(v.scope, v.foundation);
      if (v.foundationDigest !== v.foundation.foundationDigest || v.history.some(h => stableSerialize(h.foundation) !== stableSerialize(v.foundation))) fail('CORRUPT_STATE', 'Retained foundation differs');
    }
    return v;
  }
  function record(id: unknown, kind: ProducerRecord["kind"], expected: unknown) {
    const v = records.find(v => own(v) && v.recordId === id && v.kind === kind);
    if (!v) fail('NOT_FOUND', 'Owned producer record not found');
    verify(v);
    const current = v.document.proposalDigest ?? v.document.recordDigest ?? v.document.artifactSetDigest ?? v.digest;
    if (expected !== current) fail('DEPENDENCY_CHANGED', 'Exact current record digest required');
    return v;
  }
  function calculate(operation: string, p: Record<string, unknown>, publication: Record<string, unknown>, now: string) {
    parameters(operation, p); checkScope(p, r.scope, store.identity);
    const dependencies: unknown[] = [], actor = `uid:${store.uid}`;
    const load = (id: unknown, kind: ProducerRecord["kind"], expected: unknown) => { const v = record(id, kind, expected); dependencies.push({ recordId: id, digest: v.digest }); return v; };
    let document: Record<string, unknown>, kind: ProducerRecord["kind"], identity: unknown, previous: ProducerRecord | null = null, extra: { material?: Record<string, unknown>; materialDigest?: string; foundation?: { foundationDigest: string }; foundationDigest?: string; publication?: unknown; sourceId?: string } | null = null;
    if (operation === 'ontology.publish') {
      const source = operateImport(store, state, { ...r, operation: 'source.inspect', input: { sourceId: p.sourceId } });
      checkScope(source.document, r.scope, store.identity);
      if ((source.document as { kind?: unknown } | null)?.kind !== 'OntologyPack' || !source.inspection.valid || !validateDocument(source.document).valid) fail('INVALID_MODEL', 'Verified valid OntologyPack required');
      dependencies.push({ sourceId: source.sourceId, digest: sha256(source) });
      document = structuredClone(source.document) as Record<string, unknown>; kind = 'OntologyPack'; identity = document.metadata;
      extra = { publication: { ...publication, version: (document.metadata as { version: string }).version }, sourceId: source.sourceId };
    } else if (operation === 'pack.lifecycle.create') {
      const material = packMaterial(p);
      extra = { material, materialDigest: sha256(material) };
      dependencies.push(extra);
      document = packs.createPackLifecycleRecord({ ...p, dependencyClosure: material.dependencyClosure, conflictPreview: material.conflictPreview }); kind = 'PackLifecycle'; identity = { pack: document.pack, targetRoot: document.targetRoot, project: document.project };
    } else if (operation === 'project-ontology.proposal.create') {
      document = project.createProjectOntologyProposal({ ...p, createdBy: actor, now }); kind = 'Proposal'; identity = { proposalId: document.proposalId };
    } else if (operation === 'pack.lifecycle.transition' || operation === 'project-ontology.proposal.transition') {
      kind = operation.startsWith('pack.') ? 'PackLifecycle' : 'Proposal';
      previous = load(p.recordId, kind, p.expectedRecordDigest ?? p.expectedProposalDigest);
      if (kind === 'PackLifecycle') {
        if (!previous.material) fail('MATERIAL_REQUIRED', 'Historical Pack record lacks complete retained material');
        const material = packMaterial(previous.material);
        if (stableSerialize(material) !== stableSerialize(previous.material)) fail('DEPENDENCY_CHANGED', 'Retained Pack material differs');
        const initial = packs.createPackLifecycleRecord({ pack: material.pack, targetRoot: material.targetRoot, project: previous.document.project, dependencyClosure: material.dependencyClosure, conflictPreview: material.conflictPreview });
        for (const key of ['pack', 'targetRoot', 'dependencyClosureDigest', 'conflictPreviewDigest']) if (stableSerialize(initial[key]) !== stableSerialize(previous.document[key])) fail('DEPENDENCY_CHANGED', 'Record material binding differs');
        checkScope(material, r.scope, store.identity);
        extra = { material, materialDigest: sha256(material) };
        dependencies.push(extra);
      }
      document = kind === 'Proposal' ? project.transitionProjectOntologyProposal({ ...p, proposal: previous.document, actor, now }) : packs.transitionPackLifecycle({ ...p, record: previous.document, actor, now });
    } else if (operation === 'project-ontology.artifact.publish') {
      const proposal = load(p.recordId, 'Proposal', p.expectedProposalDigest).document;
      const foundation = foundationMaterial(p);
      extra = { foundation, foundationDigest: foundation.foundationDigest };
      dependencies.push(extra);
      const snapshot = project.resolveProjectOntologySnapshot({ proposal, expectedProposalDigest: p.expectedProposalDigest, foundationDigest: p.foundationDigest, now });
      document = project.publishProjectOntologyArtifactSet({ snapshot, projectionSet: project.createProjectionSet(snapshot), publication });
      kind = 'Artifact'; identity = document.metadata;
    } else if (operation === 'project-ontology.artifact.transition') {
      const artifactSet = load(p.artifactRecordId, 'Artifact', p.expectedArtifactDigest).document;
      previous = load(p.recordId, 'ArtifactLifecycle', p.expectedRecordDigest); kind = 'ArtifactLifecycle';
      document = project.createArtifactLifecycleRecord({ ...p, artifactSet, record: previous.document, actor, now });
    } else {
      const artifact = load(p.artifactRecordId, 'Artifact', p.expectedArtifactDigest).document;
      if ((p.closure as { snapshot?: { digest?: unknown } } | null)?.snapshot?.digest !== (artifact.spec as { snapshotDigest: unknown; project: unknown }).snapshotDigest || stableSerialize((p.closure as { snapshot: { project: { id: string }; digest: string } }).snapshot.project) !== stableSerialize((artifact.spec as { snapshotDigest: unknown; project: unknown }).project)) fail('DEPENDENCY_CHANGED', 'Closure must bind owned published snapshot/project');
      document = publishTerminalSemanticClosure({ closure: p.closure, publication }); kind = 'Closure'; identity = { project: (p.closure as { snapshot: { project: { id: string }; digest: string } }).snapshot.project.id, version: p.version, snapshotDigest: (p.closure as { snapshot: { project: { id: string }; digest: string } }).snapshot.digest };
    }
    // Optional pack project:null is an unbound field, not a foreign project.
    const scopedDocument = { ...document };
    if (kind === 'PackLifecycle' && scopedDocument.project === null) delete scopedDocument.project;
    checkScope(scopedDocument, r.scope, store.identity);
    const recordId = previous?.recordId ?? sha256({ scope: r.scope, kind, identity: kind === 'OntologyPack' || kind === 'Artifact' ? { id: (identity as { id: string; version: string }).id, version: (identity as { id: string; version: string }).version } : identity });
    if (!previous && records.some(v => own(v) && v.recordId === recordId)) fail('IMMUTABLE_VERSION', 'Producer identity already exists');
    return { document, kind, recordId, dependencies, previous, extra };
  }
  const publication = (p: Record<string, unknown>, decision: { at: string }) => ({ decision: 'AUTHORIZED', actor: `uid:${store.uid}`, authorizationDigest: sha256(decision), version: p.version ?? '1.0.0', at: decision.at });
  if (r.operation === 'producer.prepare') {
    if (plans.length >= LIMITS.producerPlans) fail('LIMIT', 'Producer plan count');
    const { operation, parameters: p } = r.input as { operation: string; parameters: Record<string, unknown> }, now = new Date().toISOString();
    const result = calculate(operation, p, publication(p, { at: now }), now);
    const plan = { workspace: store.identity, scope: r.scope, operation, parameters: p, dependencies: result.dependencies, createdAt: now, status: 'PREPARED', decision: null, output: null } as ProducerPlan;
    plan.reviewDigest = sha256(subject(plan)); plan.planId = sha256({ reviewDigest: plan.reviewDigest, requestId: r.requestId });
    if (plans.some(v => v.planId === plan.planId)) fail('REQUEST_CONFLICT', 'Plan already exists');
    store.blob(r.scope, plan); state.producerPlans ??= []; state.producerPlans.push(plan); return plan;
  }
  function inspect(plan: ProducerPlan) {
    store.verifyBlob(plan.scope, plan);
    if (sha256(subject(plan)) !== plan.reviewDigest || stableSerialize(plan.workspace) !== stableSerialize(store.identity)) fail('CORRUPT_STATE', 'Producer plan binding differs');
    if (plan.output) for (const id of plan.output.recordIds) { const v = records.find(v => own(v) && v.recordId === id); if (!v) fail('CORRUPT_STATE', 'Missing producer output'); verify(v); }
    return plan;
  }
  if (r.operation === 'producer.list') return plans.filter(own).map(inspect);
  const plan = plans.find(v => own(v) && v.planId === r.input.planId);
  if (!plan) fail('NOT_FOUND', 'Plan not found in scope'); inspect(plan);
  if (r.operation === 'producer.inspect') return plan;
  if (plan.status !== 'PREPARED') fail('PLAN_CONSUMED', 'Plan already consumed');
  if (r.operation !== 'producer.decide' && r.operation !== plan.operation) fail('PLAN_OPERATION_MISMATCH', 'Wrong operation plan');
  if (r.operation === 'producer.decide' && r.input.reviewDigest !== plan.reviewDigest) fail('REVIEW_MISMATCH', 'Exact review required');
  if (r.operation !== 'producer.decide' && (plan.decision?.decision !== 'APPROVE' || plan.decision.reviewDigest !== plan.reviewDigest || plan.decision.uid !== store.uid)) fail('APPROVAL_REQUIRED', 'Fresh local exact approval required');
  const now = new Date().toISOString();
  const result = calculate(plan.operation, plan.parameters, publication(plan.parameters, plan.decision ?? { at: now }), now);
  if (sha256(result.dependencies) !== sha256(plan.dependencies)) fail('DEPENDENCY_CHANGED', 'Prepared dependencies changed');
  if (r.operation === 'producer.decide') {
    plan.decision = { reviewDigest: plan.reviewDigest, decision: r.input.decision as "APPROVE" | "REJECT", humanEvidenceRef: r.input.humanEvidenceRef as string, uid: store.uid, at: now };
    store.blob(r.scope, plan); return plan.decision;
  }
  const additions = result.previous ? 0 : result.kind === 'Artifact' ? 2 : 1;
  if (records.length + additions > LIMITS.producerRecords) fail('LIMIT', 'Producer record count');
  function persist(kind: ProducerRecord["kind"], recordId: string, document: Record<string, unknown>, previous: ProducerRecord | null = null, extra: ReturnType<typeof calculate>["extra"] = null) {
    if (extra?.material) store.blob(r.scope, extra.material);
    if (extra?.foundation) store.blob(r.scope, extra.foundation);
    const history = [...(previous?.history ?? []), { document, decision: plan!.decision, planId: plan!.planId, ...(extra ?? {}) }];
    for (const h of history) store.blob(r.scope, h);
    const retained = extra?.material ? { material: extra.material, materialDigest: extra.materialDigest } : extra?.foundation ? { foundation: extra.foundation, foundationDigest: extra.foundationDigest } : {};
    const v = { scope: r.scope, kind, recordId, document, digest: store.blob(r.scope, document), history, ...retained };
    state.producerRecords ??= [];
    if (previous) state.producerRecords[state.producerRecords.indexOf(previous)] = v; else state.producerRecords.push(v);
    return v;
  }
  const output = persist(result.kind, result.recordId, result.document, result.previous, result.extra);
  const recordIds = [output.recordId]; let lifecycle = null;
  if (result.kind === 'Artifact') {
    const initial: Record<string, unknown> = { schema: 'evopilot-harness-project-ontology-artifact-lifecycle/v1', artifactSetDigest: output.document.artifactSetDigest, stage: 'PUBLISHED', history: [], authority: { installationIndependent: true, activationIndependent: true, rollbackIndependent: true } };
    initial.recordDigest = digest(initial);
    lifecycle = persist('ArtifactLifecycle', sha256({ scope: r.scope, kind: 'ArtifactLifecycle', artifactRecordId: output.recordId }), initial);
    recordIds.push(lifecycle.recordId);
  }
  plan.status = 'CONSUMED'; plan.output = { recordIds, requestId: r.requestId }; store.blob(r.scope, plan);
  return { record: output, ...(lifecycle ? { lifecycle } : {}), authority: false, softwareRelease: false };
}
