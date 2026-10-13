import type { DispatchRequest, Scope, WorkspaceIdentity } from './types.js';
import type { Store, State } from './persistence-types.js';
interface QueryRoute { required: readonly string[]; optional: readonly string[]; calculate: ((input: Record<string, unknown>, store: Store) => unknown) | null }
interface StructuralChange { type: 'ADD' | 'REMOVE' | 'REPLACE'; path: string; before?: unknown; after?: unknown }
import { grounding as grounding } from "./compat/index.mjs";
import { interoperability as interoperability } from "./compat/index.mjs";
import { packs as packs } from "./compat/index.mjs";
import { projectOntology as projectOntology } from "./compat/index.mjs";
import { validation as legacy_validation } from "./compat/index.mjs";
const { validateDocument } = legacy_validation;
import { exactFields, stableSerialize } from '../vendor/compatibility/v1/reference.mjs';
import { fail } from './state.js';
import { operateImport } from './import-operations.js';

const route = (required: string, optional: string, calculate: QueryRoute["calculate"]) => Object.freeze({ required: Object.freeze(required.split(' ').filter(Boolean)), optional: Object.freeze(optional.split(' ').filter(Boolean)), calculate });
// Finite dispatch: no caller-selected module, export, callback or path.
export const legacyQueries: Readonly<Record<string, QueryRoute>> = Object.freeze({
  'semantic.foundation.inspect': route('', 'metaTypes relationTypes limits', grounding.resolveOntologyFoundation),
  'semantic.candidates.inspect': route('sourceConceptHypothesis', 'candidates extraction', grounding.createSemanticCandidateSet),
  'semantic.grounding.inspect': route('candidateSet', 'foundation concepts expected priorResults locale', grounding.resolveOntologyGrounding),
  'semantic.reasoning-profile.inspect': route('', 'id version metadata mode limits externalReasoner supportedRules', interoperability.createOntologyReasoningProfile),
  'semantic.index.inspect': route('snapshot', 'assets algorithm policy toolchain cache', interoperability.buildSemanticIndex),
  'semantic.affected-subgraph.inspect': route('index profile', 'changedConceptIds cacheDigest', interoperability.calculateAffectedSubgraph),
  'semantic.compute.inspect': route('index profile', 'mode affectedSubgraph externalReasonerResult execution', interoperability.computeSemanticState),
  'semantic.compute.compare': route('incremental full', '', interoperability.compareSemanticComputations),
  'semantic.federation.discover': route('', 'roots query', interoperability.discoverFederatedPacks),
  'semantic.interoperability.inspect': route('snapshot profile index', 'externalMappings multilingualTerms unsupportedSemantics', interoperability.createInteroperabilityProjectionSet),
  'semantic.round-trip.inspect': route('snapshot projectionSet index incremental full', '', interoperability.verifySemanticRoundTrip),
  'semantic.closure.inspect': route('snapshot profile index projectionSet roundTripReport', 'harnessAssets dependencyLocks evaluations rollbackLinks provenance', interoperability.createTerminalSemanticClosure),
  'semantic.closure.slice': route('closure expectedClosureDigest', 'conceptIds', interoperability.sliceTerminalSemanticClosure),
  'pack.scaffold.inspect': route('kind metadata', 'spec', packs.createProfessionalPack),
  'pack.inspect': route('pack', 'availablePacks', i => packs.inspectProfessionalPack(i.pack, { availablePacks: i.availablePacks })),
  'pack.resolve.inspect': route('', 'packs precedence targetRoot expectedBaseDigest baseSnapshot', packs.resolveProfessionalPackSet),
  'pack.benchmark.inspect': route('id version provenance', 'cases metrics evidenceRefs', packs.createPackBenchmarkPackage),
  'pack.gold-case.inspect': route('id version source expectedOutcome provenance', 'expectedConcepts evidenceRefs', packs.createPackGoldCasePackage),
  'pack.certification.inspect': route('pack benchmark algorithm policy toolchain', 'goldCases qualityLevel signer evidenceRefs', packs.createPackCertificationRecord),
  'semantic.evidence-adapter.inspect': route('id version provenance', 'sourceTypes', packs.createExternalSemanticEvidenceAdapter),
  'semantic.evidence.import.inspect': route('source', 'adapter records fetchedAt', packs.importExternalSemanticEvidence),
  'project-ontology.proposal.inspect': route('project packs', 'precedence targetRoot baseSnapshot expectedBaseDigest overlay now', (i, store) => projectOntology.createProjectOntologyProposal({ ...i, createdBy: `uid:${store.uid}` })),
  'project-ontology.snapshot.resolve': route('proposal expectedProposalDigest foundationDigest', 'priorSnapshot now', projectOntology.resolveProjectOntologySnapshot),
  'project-ontology.projections.inspect': route('snapshot', '', i => projectOntology.createProjectionSet(i.snapshot)),
  'project-ontology.skill.inspect': route('snapshot', 'projectionSet artifactSetManifestDigest instructions', projectOntology.compileProjectOntologySkill),
  'ontology.inspect': route('', '', null),
  'ontology.validate': route('sourceId', '', null),
  'ontology.diff': route('leftSourceId rightSourceId', '', null),
});
export const legacyQueryOperations = Object.freeze(Object.keys(legacyQueries));
export function validateLegacyQuery(r: DispatchRequest) {
  const entry = legacyQueries[r.operation];
  exactFields(r.input, entry.required, entry.optional);
  for (const key of ['sourceId', 'leftSourceId', 'rightSourceId']) {
    if (Object.hasOwn(r.input, key) && (typeof r.input[key] !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(r.input[key] as string))) fail('INVALID_REQUEST', 'Existing sourceId required');
  }
}

// Bind nested proposals, snapshots and closures without relabeling caller data.
export function checkScope(input: unknown, scope: Scope, identity: WorkspaceIdentity) {
  if (!input || typeof input !== 'object') return;
  const value = input as Record<string, unknown>;
  if (value.kind === 'DomainHarnessPack') fail('UNSUPPORTED_KIND', 'Harness Packs are not Ontology inputs');
  if (['HarnessProfile', 'HarnessComponent', 'HarnessBundle'].includes(value.kind as string)) {
    // Foreign exact references are calculation evidence; full producers are denied.
    exactFields(value, ['kind', 'id', 'version', 'digest']);
    if (!/^sha256:[a-f0-9]{64}$/.test(value.digest as string)) fail('INVALID_REQUEST', 'Exact foreign reference required');
  }
  if (scope.visibility === 'public' && (String(value.visibility).toLowerCase() === 'private' || value.sourceVisibility === 'private' || value.root === 'PRIVATE_ORGANIZATION' || value.targetRoot === 'PRIVATE_ORGANIZATION')) fail('SCOPE_MISMATCH', 'Private material cannot enter public scope');
  if (Object.hasOwn(value, 'project')) {
    const p = value.project as Record<string, unknown> | null;
    if (!p || typeof p !== 'object' || Array.isArray(p) || p.id !== scope.projectId || p.workspaceId !== identity.id) fail('SCOPE_MISMATCH', 'Project binding differs from service scope/workspace');
  }
  if (Object.hasOwn(value, 'projectId') && value.projectId !== scope.projectId) fail('SCOPE_MISMATCH', 'Project namespace differs');
  if (Object.hasOwn(value, 'workspaceId') && value.workspaceId !== identity.id) fail('SCOPE_MISMATCH', 'Workspace differs');
  for (const child of Object.values(value)) checkScope(child, scope, identity);
}

const pointer = (key: string) => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
function structuralDiff(left: unknown, right: unknown, path = '', changes: StructuralChange[] = []) {
  if (stableSerialize(left) === stableSerialize(right)) return changes;
  const objects = left !== null && right !== null && typeof left === 'object' && typeof right === 'object' && Array.isArray(left) === Array.isArray(right);
  if (objects) {
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
      const next = `${path}/${pointer(key)}`;
      if (!Object.hasOwn(left, key)) changes.push({ type: 'ADD', path: next, after: (right as Record<string, unknown>)[key] });
      else if (!Object.hasOwn(right, key)) changes.push({ type: 'REMOVE', path: next, before: (left as Record<string, unknown>)[key] });
      else structuralDiff((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], next, changes);
    }
  } else changes.push({ type: 'REPLACE', path, before: left, after: right });
  return changes;
}

export function operateLegacyQuery(store: Store, state: State, r: DispatchRequest) {
  checkScope(r.input, r.scope, store.identity);
  const entry = legacyQueries[r.operation];
  let result;
  if (entry.calculate) result = entry.calculate(r.input, store);
  else {
    const ontology = (sourceId: unknown, diagnostic = false) => {
      const source = operateImport(store, state, { ...r, operation: 'source.inspect', input: { sourceId } });
      if ((source.document as { kind?: unknown } | null)?.kind !== 'OntologyPack') fail('UNSUPPORTED_KIND', 'Stored query requires an OntologyPack');
      checkScope(source.document, r.scope, store.identity);
      if (!diagnostic && (source.status !== 'INSPECTED' || !source.inspection.valid)) fail('SOURCE_QUARANTINED', 'Source inspection blocks query');
      return source;
    };
    if (r.operation === 'ontology.inspect') {
      result = (state.sources ?? []).filter(s => stableSerialize(s.scope) === stableSerialize(r.scope) && (s.document as { kind?: unknown } | null)?.kind === 'OntologyPack' && s.status === 'INSPECTED').map(s => ontology(s.sourceId));
    } else if (r.operation === 'ontology.validate') {
      const source = ontology(r.input.sourceId);
      result = { sourceId: source.sourceId, documentDigest: source.documentDigest, validation: validateDocument(source.document) };
    } else {
      const left = ontology(r.input.leftSourceId, true), right = ontology(r.input.rightSourceId, true);
      result = { leftSourceId: left.sourceId, rightSourceId: right.sourceId, status: left.inspection.valid && right.inspection.valid ? 'COMPARED' : 'BLOCKED', changes: structuralDiff(left.document, right.document), interpretation: 'STRUCTURAL_ONLY', semanticEquivalence: 'NOT_ASSERTED' };
    }
  }
  return { operation: r.operation, compatibility: 'evopilot-harness@4.8.2', previewOnly: true, authority: false, result };
}
