import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectOperationsProfile, instantiateOperationsProfile,
  verifyOperationsProfileMaterial, verifyOperationsProfilePackage,
  createOntologyService,
} from '../../dist/service.js';
import { inspectOntologyStandard, validateNativeOntology, validateOntologyPackage } from '../../dist/index.js';
import { nativeBytesDigest, nativeStableSerialize } from '../../vendor/compatibility/v1/native.mjs';

const asset = name => readFileSync(new URL('../../assets/profiles/operations-v1/' + name, import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const shapeNames = ['ProjectShape', 'ServiceDeploymentShape', 'ImpactShape', 'CauseShape',
  'OwnerReferenceShape', 'RunbookShape', 'ActorShape', 'ScopeShape'];
const entities = [['project', 'Project'], ['capability', 'BusinessCapability'], ['service', 'Service'],
  ['deployment', 'Deployment'], ['problem', 'ProblemAssessment'], ['cause', 'CauseAssertion'],
  ['actor', 'ActorReference'], ['observation', 'OwnerEvidenceReference'], ['guidance', 'RunbookReference']];

test('ONT-F05/E09: pure profile public service discovery/generation does not initialize private state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ontology-profile-passive-'));
  const workspaceRoot = join(root, 'not-created');
  const service = createOntologyService({ workspaceRoot, workspaceId: 'synthetic-operations' });
  const scope = { visibility: 'private', projectId: 'synthetic-checkout' };
  try {
    assert.deepEqual(service.capabilities().responseOperations, ['response.profile.inspect', 'response.profile.instantiate']);
    const result = await service.response({ operation: 'response.profile.inspect', scope, input: {} });
    assert.equal(result.authority, false);
    const material = await service.response({ operation: 'response.profile.instantiate', scope, input: {
      namespace: 'urn:synthetic:checkout:', direction: 'forward',
    } });
    assert.equal(material.businessConfirmed, false);
    assert.equal(existsSync(workspaceRoot), false);
    await assert.rejects(service.response({ operation: 'response.profile.inspect', scope, input: { extra: true } }));
    await assert.rejects(service.response({ operation: 'response.profile.inspect', scope: { visibility: 'unknown', projectId: 'x' }, input: {} }));
    await assert.rejects(service.response({ operation: 'response.profile.publish', scope, input: {} }), { code: 'RESPONSE_OPERATION' });
    service.close();
    await assert.rejects(service.response({ operation: 'response.profile.inspect', scope, input: {} }), { code: 'CLOSED' });
    assert.equal(existsSync(workspaceRoot), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
function rehash(pkg) {
  pkg.manifest.files = Object.entries(pkg.files).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([path, content]) => ({
    path, mediaType: path.endsWith('.ttl') ? 'text/turtle' : path.endsWith('.txt') ? 'text/plain' : 'application/json',
    sha256: nativeBytesDigest(content).slice(7),
  }));
  return pkg;
}
function replacements(data, kind) {
  const digest = 'sha256:' + 'a'.repeat(64);
  return [
    ['project', 'ProjectShape', data.replace('ex:project a ex:Project', 'ex:project a ex:Service')],
    ['deployment', 'ServiceDeploymentShape', data.replace('ex:deployedService ex:service', 'ex:deployedService ex:capability')],
    ['impact', 'ImpactShape', data.replace('ex:affectsCapability ex:capability', 'ex:affectsCapability ex:service')],
    ['cause', 'CauseShape', data.replace(`ex:classification "${kind}"`, 'ex:classification "ASSUMED_CONFIRMED"')],
    ['owner', 'OwnerReferenceShape', data.replace(`; ex:digest "${digest}"`, '')],
    ['runbook', 'RunbookShape', data.replace('; ex:runbookVersion "1.0.0"', '')],
    ['actor', 'ActorShape', data.replace('; ex:actorId "synthetic-operator"', '')],
    ['scope', 'ScopeShape', data.replace('ex:workspaceId "synthetic-workspace"', 'ex:workspaceId "other-workspace"')],
    ['unconfirmed', 'CauseShape', data.replace(`ex:classification "${kind}"`, 'ex:classification "CONFIRMED"')],
  ];
}
function examplePackage(id, direction, visibility = 'private') {
  const example = JSON.parse(asset('examples/' + id + '.json'));
  const material = instantiateOperationsProfile({ namespace: example.namespace, direction });
  const files = { ...material.files };
  const data = asset('examples/' + id + '.ttl.template').replaceAll('{{NS}}', example.namespace);
  const domain = example.domain;
  const domainShape = example.namespace + domain.shape;
  const requiredShapeIds = [...material.requiredShapeIds, domainShape];
  const projectEntities = [...entities, ...domain.entities];
  const domainTerms = [...domain.classes, domain.relation, domain.expectedProperty, domain.actualProperty, domain.shape];
  const negatives = [...replacements(data, example.classification),
    ['domain-value', domain.shape, data.replace('ex:' + domain.actualProperty + ' ' + domain.expectedValue, 'ex:' + domain.actualProperty + ' ' + (domain.expectedValue - 1))],
    ['domain-relation', domain.shape, data.replace('ex:' + domain.relation + ' ex:' + domain.entities[0][0], 'ex:' + domain.relation + ' ex:capability')],
  ];
  const cases = [{ id: 'positive', data: 'tests/positive.ttl', expectedConforms: true,
    requirementIds: ['operations-profile', 'synthetic-project'], shapeIds: requiredShapeIds },
    ...negatives.map(([id, shape]) => ({ id, data: 'tests/' + id + '.ttl', expectedConforms: false,
      requirementIds: ['operations-profile', 'synthetic-project'], shapeIds: [example.namespace + shape] }))];
  const bindings = copy(material.sourceBindings);
  const source = asset('examples/' + id + '.json');
  bindings.sources.push({ id: 'synthetic-project', locator: 'synthetic://' + id,
    revision: example.revision, digest: nativeBytesDigest(source), status: 'observed', visibility,
    contentPath: 'sources/synthetic-project.json' });
  bindings.requirements.push({ id: 'synthetic-project', required: true, disposition: 'covered' });
  for (const name of [...projectEntities.map(([id]) => id), ...domainTerms]) bindings.mappings.push({
    requirementId: 'synthetic-project', targetId: example.namespace + name, sourceId: 'synthetic-project',
    status: 'inferred', revision: example.revision, fileDigest: nativeBytesDigest(source),
    selector: { kind: 'lines', start: 1, end: source.split('\n').length }, fragmentDigest: nativeBytesDigest(source),
    rationale: 'Deliberately synthetic project mapping; placeholders are not live owner evidence.',
  });
  files['model.ttl'] += '\n' + asset('examples/' + id + '.model.ttl.template').replaceAll('{{NS}}', example.namespace);
  Object.assign(files, {
    'shapes/project.ttl': asset('examples/' + id + '.shapes.ttl.template').replaceAll('{{NS}}', example.namespace),
    'instances/current.ttl': data, 'sources/synthetic-project.json': source,
    'sources/bindings.json': JSON.stringify(bindings),
    'scope/coverage.json': JSON.stringify({ schema: 'evopilot-ontology-coverage/v1',
      namespace: example.namespace, projectRoot: material.rootId,
      expectedEntities: projectEntities.map(([id, type]) => ({ id: example.namespace + id, type: example.namespace + type })),
      requiredShapeIds, requiredCaseIds: cases.map(c => c.id) }),
    'tests/cases.json': JSON.stringify({ schema: 'evopilot-ontology-cases/v1', cases }),
    'tests/positive.ttl': data,
    ...Object.fromEntries(negatives.map(([name, , text]) => ['tests/' + name + '.ttl', text])),
  });
  const standard = inspectOntologyStandard();
  return rehash({ manifest: {
    schema: 'evopilot-native-package/v1', specVersion: 'v1', owner: 'ontology', id: 'synthetic-operations-' + id,
    version: '1.0.0', visibility, standardPins: { standardDigest: standard.standardDigest, standardLockDigest: standard.standardLockDigest },
    // The frozen native v1 producer identity remains 0.3.0 across software upgrades.
    contractDigest: standard.contractDigest, producer: { product: 'ontology', version: '0.3.0' },
    entrypoints: { model: 'model.ttl', shapes: ['shapes/operations.ttl', 'shapes/project.ttl'], instances: ['instances/current.ttl'],
      coverage: 'scope/coverage.json', cases: 'tests/cases.json' },
    files: [], dependencies: [], sourceBindingRef: 'sources/bindings.json',
  }, files });
}

test('ONT-F05/E06: optional profile is pinned, deterministic and namespace-owned; no authority or v1 rewrite', () => {
  const before = inspectOntologyStandard();
  const profile = inspectOperationsProfile();
  assert.equal(profile.id, 'operations-v1');
  assert.equal(profile.version, '1.0.0');
  assert.equal(profile.digest, nativeBytesDigest(asset('manifest.json')));
  assert.equal(profile.nativeSpecification, 'v1');
  assert.equal(profile.ownerReferencesVerified, false);
  assert.equal(profile.globalVocabularyImport, false);
  assert.deepEqual(profile.shapeNames, shapeNames);
  const a = instantiateOperationsProfile({ namespace: 'urn:project:checkout:', direction: 'forward' });
  assert.deepEqual(verifyOperationsProfileMaterial(a).profile, a.profile);
  assert.equal(a.digest, instantiateOperationsProfile({ namespace: a.namespace, direction: a.direction }).digest);
  const b = instantiateOperationsProfile({ namespace: 'https://example.invalid/export/', direction: 'reverse' });
  assert.equal(a.profile.profileDigest, b.profile.profileDigest);
  assert.notEqual(a.digest, b.digest);
  assert(a.declaredEntityIds.every(id => id.startsWith(a.namespace)));
  assert(b.requiredShapeIds.every(id => id.startsWith(b.namespace)));
  assert(a.sourceBindings.mappings.every(m => m.status === 'inferred' && m.rationale));
  assert.equal(a.authority, false); assert.equal(a.businessConfirmed, false);
  assert.deepEqual(inspectOntologyStandard(), before);
  for (const namespace of ['relative/', 'https://www.w3.org/profile/', 'https://evopilot.dev/profile/', 'urn:x:> injected', 'urn:x:%0a:']) {
    assert.throws(() => instantiateOperationsProfile({ namespace, direction: 'forward' }), { code: 'OPERATIONS_NAMESPACE' });
  }
  for (const change of [m => m.files['shapes/operations.ttl'] += '\n', m => m.profile.profileDigest = 'sha256:' + '0'.repeat(64),
    m => m.requiredShapeIds.pop(), m => { m.authority = true; }]) {
    const altered = copy(a); change(altered);
    assert.throws(() => verifyOperationsProfileMaterial(altered), { code: 'OPERATIONS_PROFILE_MISMATCH' });
  }
});

test('ONT-F05/E03/E08: full package adoption rejects changed constraints, lost source mappings and dangling coverage', () => {
  for (const id of ['checkout', 'archive-export']) for (const direction of ['forward', 'reverse']) {
    const pkg = examplePackage(id, direction);
    assert.doesNotThrow(() => validateOntologyPackage(pkg));
    assert.equal(verifyOperationsProfilePackage(pkg).ownerReferencesVerified, false);
    assert.equal(verifyOperationsProfilePackage(pkg).nativeValidationRequired, true);
  }
  const checkout = examplePackage('checkout', 'forward'), archive = examplePackage('archive-export', 'reverse');
  assert(checkout.files['model.ttl'].includes('PaymentAuthorization a rdfs:Class'));
  assert(!checkout.files['model.ttl'].includes('ExportManifest a rdfs:Class'));
  assert(archive.files['model.ttl'].includes('ExportManifest a rdfs:Class'));
  assert(!archive.files['model.ttl'].includes('PaymentAuthorization a rdfs:Class'));
  assert(checkout.files['shapes/project.ttl'].includes('authorizedAmount'));
  assert(archive.files['shapes/project.ttl'].includes('exportedRowCount'));
  for (const mutate of [
    p => { p.files['shapes/operations.ttl'] += '\n'; },
    p => { p.files['model.ttl'] = p.files['model.ttl'].replace('ProblemAssessment a rdfs:Class', 'ProblemAssessment a rdf:Property'); },
    p => { const b = JSON.parse(p.files['sources/bindings.json']); b.mappings[0].rationale = 'unreviewed alternative'; p.files['sources/bindings.json'] = JSON.stringify(b); },
    p => { const c = JSON.parse(p.files['scope/coverage.json']); c.requiredShapeIds.pop(); p.files['scope/coverage.json'] = JSON.stringify(c); },
    p => { delete p.files['profiles/operations.json']; },
  ]) {
    const pkg = examplePackage('checkout', 'forward'); mutate(pkg); rehash(pkg);
    assert.throws(() => verifyOperationsProfilePackage(pkg));
  }
  const publicPackage = examplePackage('archive-export', 'reverse', 'public');
  assert.doesNotThrow(() => verifyOperationsProfilePackage(publicPackage));
  const bindings = JSON.parse(publicPackage.files['sources/bindings.json']); bindings.sources.at(-1).visibility = 'private';
  publicPackage.files['sources/bindings.json'] = JSON.stringify(bindings); rehash(publicPackage);
  assert.throws(() => verifyOperationsProfilePackage(publicPackage), { code: 'SOURCE_SCOPE_MISMATCH' });
});

test('ONT-F05/E01/E02/E06/E08: real pinned pySHACL proves two different domains and every required negative shape', async () => {
  assert(process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN, 'Real installed native toolchain required; a skipped test cannot accept this profile');
  const tools = JSON.parse(readFileSync(process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN, 'utf8'));
  for (const [id, direction] of [['checkout', 'forward'], ['archive-export', 'reverse']]) {
    const pkg = examplePackage(id, direction);
    verifyOperationsProfilePackage(pkg);
    const result = await validateNativeOntology(pkg, tools);
    assert.equal(result.status, 'CONFORMS', JSON.stringify(result.diagnostics) + result.process.stderr);
    assert.equal(result.caseReports.length, 12);
    const domainCases = result.caseReports.filter(c => c.id.startsWith('domain-'));
    assert.equal(domainCases.length, 2); assert(domainCases.every(c => !c.actualConforms && c.matchesExpected));
    assert(result.caseReports.every(c => c.matchesExpected && c.rawReport));
    assert(result.caseReports.filter(c => !c.expectedConforms).every(c => !c.actualConforms));
    assert(result.criteria.every(c => c.status === 'PASS'));
    assert.equal(result.businessConfirmed, false); assert.equal(result.authority, false);
    assert.equal(result.process.exitCode, 0);
    const reverse = examplePackage(id, direction === 'forward' ? 'reverse' : 'forward');
    assert.equal(pkg.files['model.ttl'], reverse.files['model.ttl']);
    assert.equal(pkg.files['shapes/operations.ttl'], reverse.files['shapes/operations.ttl']);
    assert.equal(pkg.files['instances/current.ttl'], reverse.files['instances/current.ttl']);
    assert.notEqual(nativeStableSerialize(pkg), nativeStableSerialize(reverse));
  }
});

test('ONT-F05/E02/E08: real native validation rejects confirmed-without-decision and foreign owner scope', async () => {
  assert(process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN, 'Real installed native toolchain required');
  const tools = JSON.parse(readFileSync(process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN, 'utf8'));
  for (const [fixture, shape] of [['unconfirmed', 'CauseShape'], ['scope', 'ScopeShape'], ['owner', 'OwnerReferenceShape']]) {
    const pkg = examplePackage('checkout', 'forward');
    pkg.files['instances/current.ttl'] = pkg.files['tests/' + fixture + '.ttl']; rehash(pkg);
    verifyOperationsProfilePackage(pkg);
    const result = await validateNativeOntology(pkg, tools);
    assert.equal(result.status, 'NONCONFORMING', JSON.stringify(result.diagnostics));
    assert(result.results.some(r => r['sh:sourceShape'] === 'https://example.invalid/checkout/' + shape));
    assert(result.criteria.every(c => c.status === 'FAIL'));
  }
});
