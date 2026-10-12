import { readFileSync } from 'node:fs';
import { digest } from '../../src/compat/v3/utils.mjs';
import { packs as p, grounding as g, interoperability as s } from '../../src/compat/index.mjs';

// Synthetic foreign data with explicit test provenance; no foreign publication.
export const harnessMaterials = JSON.parse(readFileSync(new URL('./harness-materials.json', import.meta.url), 'utf8')).materials.map(({ document }) => ({ document, entry: { kind: document.kind, id: document.metadata.id, version: document.metadata.version, lifecycle: document.metadata.lifecycle, assetDigest: digest(document), provenance: 'source://synthetic-catalog-service-test' } }));
export function trustedHarness({ reference, scope, workspace }) {
  const item = harnessMaterials.find(v => v.entry.kind === reference.kind && v.entry.id === reference.id && v.entry.version === reference.version && v.entry.assetDigest === reference.digest);
  return item ? { ...item, scope, workspace, verified: true } : null;
}
export function catalogClient(service, scope) {
  let serial = 0;
  const read = (operation, input = {}, selected = scope) => service.execute({ operation, input, scope: selected });
  const write = (operation, input, selected = scope) => service.execute({ operation, input, scope: selected, requestId: `catalog-test-${++serial}`, expectedRevision: read('workspace.inspect').revision });
  const produce = (operation, parameters) => {
    const plan = write('producer.prepare', { operation, parameters }).result;
    write('producer.decide', { planId: plan.planId, reviewDigest: plan.reviewDigest, decision: 'APPROVE', humanEvidenceRef: 'local:synthetic-producer-review' });
    return write(operation, { planId: plan.planId }).result;
  };
  const prepare = parameters => write('catalog.prepare', parameters).result;
  const decide = plan => write('catalog.decide', { planId: plan.planId, reviewDigest: plan.reviewDigest, decision: 'APPROVE', evidenceRef: 'local:synthetic-catalog-review' });
  const publish = parameters => { const plan = prepare(parameters); decide(plan); return write('semantic.catalog.' + parameters.action.toLowerCase(), { planId: plan.planId }); };
  return { read, write, produce, prepare, decide, publish };
}
export function ownedCatalogMaterials(c, { workspaceId = 'catalog-test', projectId = 'alpha', version = '1.0.0', visibility = 'DOMAIN' } = {}) {
  const targetRoot = visibility === 'PRIVATE' ? 'PRIVATE_ORGANIZATION' : 'DOMAIN_TEAM';
  const pack = p.createProfessionalPack({ kind: 'DomainOntologyPack', metadata: { id: 'fixture-domain', version, namespace: 'fixture', root: targetRoot, visibility, owner: 'fixture-team', provenance: { author: 'synthetic', sourceRefs: ['source://synthetic'] } }, spec: { concepts: [{ conceptId: 'fixture:entity', label: 'Entity', metaType: 'ENTITY', definition: 'Synthetic test entity.' }] } });
  const project = { id: projectId, workspaceId, tenantId: 'fixture-tenant', sourceSnapshotDigest: digest('synthetic-source') };
  let packRecord = c.produce('pack.lifecycle.create', { pack, project, targetRoot }).record;
  for (const action of ['APPLY', 'REQUEST_REVIEW', 'APPROVE', 'PUBLISH']) packRecord = c.produce('pack.lifecycle.transition', { recordId: packRecord.recordId, expectedRecordDigest: packRecord.document.recordDigest, action }).record;
  let proposalRecord = c.produce('project-ontology.proposal.create', { project, packs: [pack], targetRoot }).record;
  for (const action of ['APPLY', 'REQUEST_REVIEW', 'APPROVE']) proposalRecord = c.produce('project-ontology.proposal.transition', { recordId: proposalRecord.recordId, expectedProposalDigest: proposalRecord.document.proposalDigest, action }).record;
  const foundation = g.resolveOntologyFoundation(), proposal = proposalRecord.document;
  const publication = c.produce('project-ontology.artifact.publish', { recordId: proposalRecord.recordId, expectedProposalDigest: proposal.proposalDigest, foundationDigest: foundation.foundationDigest, version });
  const artifactSet = publication.record.document, snapshot = artifactSet.spec.snapshot;
  const rollback = c.produce('project-ontology.artifact.transition', { artifactRecordId: publication.record.recordId, expectedArtifactDigest: artifactSet.artifactSetDigest, recordId: publication.lifecycle.recordId, expectedRecordDigest: publication.lifecycle.document.recordDigest, action: 'INSTALL' }).record.document;
  const bindings = harnessMaterials.map(({ entry }) => ({ kind: entry.kind, id: entry.id, version: entry.version, digest: entry.assetDigest }));
  const profile = s.createOntologyReasoningProfile({ id: 'fixture-profile', version: '1.0.0', mode: 'RDFS' });
  const index = s.buildSemanticIndex({ snapshot, assets: bindings });
  const full = s.computeSemanticState({ index, profile, mode: 'FULL' });
  const affectedSubgraph = s.calculateAffectedSubgraph({ index, profile, changedConceptIds: ['fixture:entity'] });
  const incremental = s.computeSemanticState({ index, profile, mode: 'INCREMENTAL', affectedSubgraph });
  const projectionSet = s.createInteroperabilityProjectionSet({ snapshot, profile, index });
  const roundTripReport = s.verifySemanticRoundTrip({ snapshot, projectionSet, index, incremental, full });
  const support = [
    { binding: { id: 'lock', version: '1.0.0', digest: proposal.resolvedPackSet.packSetDigest }, document: proposal.resolvedPackSet },
    { binding: { id: 'evaluation', version: '1.0.0', digest: roundTripReport.reportDigest }, document: roundTripReport },
    { binding: { id: 'rollback', version: '1.0.0', digest: rollback.recordDigest }, document: rollback },
  ];
  const candidate = s.createTerminalSemanticClosure({ snapshot, profile, index, projectionSet, roundTripReport, harnessAssets: bindings, dependencyLocks: [support[0].binding], evaluations: [{ ...support[1].binding, kind: 'Evaluation' }], rollbackLinks: [support[2].binding], provenance: { producer: 'synthetic', sourceRefs: ['source://synthetic'], generatedByDigest: digest('fixture') } });
  const closure = c.produce('semantic.closure.publish', { closure: candidate, artifactRecordId: publication.record.recordId, expectedArtifactDigest: artifactSet.artifactSetDigest, version: candidate.version }).record.document;
  return { artifactSet, closure, foundation, proposal, packs: [pack], profile, index, projectionSet, roundTripReport, incremental, full, support, harnessAssets: harnessMaterials };
}
