import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  nativeAssertJSON, nativeBytesDigest, nativeExact, nativeFrozenClone,
  nativeSha256, nativeStableSerialize,
} from '../vendor/compatibility/v1/native.mjs';
import type { NativePackage } from '../vendor/compatibility/v1/native.mjs';
import { validateOntologyPackage, packageParts } from './native/package.js';
import type { SourceBindings } from './native/package.js';

const manifestDigest = 'sha256:a9ccf34e736247833e53420fbf304b7bc31a9dd0fa8efb871cc3921ac90aee77';
const profileRoot = fileURLToPath(new URL('../assets/profiles/operations-v1/', import.meta.url));
const fileNames = [
  'examples/archive-export.json', 'examples/archive-export.ttl.template',
  'examples/archive-export.model.ttl.template', 'examples/archive-export.shapes.ttl.template',
  'examples/checkout.json', 'examples/checkout.ttl.template',
  'examples/checkout.model.ttl.template', 'examples/checkout.shapes.ttl.template',
  'model.ttl.template', 'profile.json', 'shapes.ttl.template',
] as const;
interface ProfileDescription {
  schema: 'evopilot-operations-profile-description/v1'; id: 'operations-v1'; version: '1.0.0';
  canonical: string;
  terms: { name: string; kind: string; description: string }[];
  shapeNames: string[]; rootLocalName: 'project';
  limits: { inference: 'none'; externalImports: false; maxTemplateFileBytes: number };
  provenanceMappings: { local: string; upstream: string; relationship: string }[];
  unsupported: string[];
}
export interface OperationsProfileBinding {
  schema: 'evopilot-operations-profile-binding/v1'; id: 'operations-v1'; version: '1.0.0';
  profileDigest: string; namespace: string; modelPrefixDigest: string; shapesDigest: string;
}
export interface OperationsProfileMaterial {
  namespace: string; direction: 'forward' | 'reverse'; profile: OperationsProfileBinding;
  files: Record<string, string>; sourceBindings: SourceBindings;
  declaredEntityIds: string[]; requiredShapeIds: string[]; rootId: string;
  digest: string; authority: false; businessConfirmed: false;
}
function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}
function pinnedFile(name: string, expected: string): string {
  const file = join(profileRoot, name);
  if (realpathSync(profileRoot) !== profileRoot.replace(/\/$/, '') ||
      realpathSync(file) !== file || realpathSync(dirname(file)) !== dirname(file) ||
      !lstatSync(file).isFile() || lstatSync(file).size > 262144) {
    fail('OPERATIONS_PROFILE_DRIFT', 'Profile files must be bounded regular, unlinked files');
  }
  const bytes = readFileSync(file);
  if (nativeBytesDigest(bytes) !== expected) fail('OPERATIONS_PROFILE_DRIFT', 'Pinned profile bytes changed');
  return bytes.toString('utf8');
}
function loadProfile(): { description: ProfileDescription; files: Record<string, string>; fileDigests: Record<string, string> } {
  const manifest: unknown = JSON.parse(pinnedFile('manifest.json', manifestDigest));
  nativeAssertJSON(manifest);
  nativeExact(manifest, ['schema', 'id', 'version', 'files']);
  if (manifest.schema !== 'evopilot-operations-profile-manifest/v1' ||
      manifest.id !== 'operations-v1' || manifest.version !== '1.0.0') {
    fail('OPERATIONS_PROFILE_DRIFT', 'Unsupported operations profile identity');
  }
  nativeExact(manifest.files, [...fileNames]);
  const files: Record<string, string> = {}, fileDigests: Record<string, string> = {};
  for (const name of fileNames) {
    const digest = manifest.files[name];
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) {
      fail('OPERATIONS_PROFILE_DRIFT', 'Profile manifest must pin every file');
    }
    fileDigests[name] = 'sha256:' + digest;
    files[name] = pinnedFile(name, fileDigests[name]);
  }
  // This descriptor has already been checked against the compiled immutable digest.
  const description = JSON.parse(files['profile.json']) as ProfileDescription;
  return { description, files, fileDigests };
}
function namespaceValue(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 512 ||
      !/^(?:https?:\/\/[^\s<>"{}|\\^`]+|urn:[^\s<>"{}|\\^`]+)[/#:]$/.test(value) ||
      /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value) ||
      ['http://www.w3.org/', 'https://www.w3.org/', 'https://evopilot.dev/'].some(prefix => value.startsWith(prefix))) {
    fail('OPERATIONS_NAMESPACE', 'A project-owned absolute namespace ending in /, # or : is required');
  }
}

/** Read-only optional profile metadata, not a standard-version or business decision. */
export function inspectOperationsProfile() {
  const { description, fileDigests } = loadProfile();
  return nativeFrozenClone({ ...description, digest: manifestDigest, files: fileDigests,
    nativeSpecification: 'v1', authority: false, businessConfirmed: false,
    ownerReferencesVerified: false, globalVocabularyImport: false });
}

/** Instantiate definitions and constraints only. Project facts and source review remain caller work. */
export function instantiateOperationsProfile(input: { namespace: string; direction: 'forward' | 'reverse' }): Readonly<OperationsProfileMaterial> {
  nativeAssertJSON(input); nativeExact(input, ['namespace', 'direction']);
  namespaceValue(input.namespace);
  if (!['forward', 'reverse'].includes(input.direction)) fail('OPERATIONS_DIRECTION', 'Explicit derivation direction required');
  const { description, files: source } = loadProfile();
  const namespace = input.namespace;
  const model = source['model.ttl.template'].replaceAll('{{NS}}', namespace);
  const shapes = source['shapes.ttl.template'].replaceAll('{{NS}}', namespace);
  const profile: OperationsProfileBinding = {
    schema: 'evopilot-operations-profile-binding/v1', id: 'operations-v1', version: '1.0.0',
    profileDigest: manifestDigest, namespace, modelPrefixDigest: nativeBytesDigest(model), shapesDigest: nativeBytesDigest(shapes),
  };
  const sourceBindings: SourceBindings = {
    schema: 'evopilot-source-bindings/v1', direction: input.direction,
    sources: ['model', 'shapes'].map(part => ({
      id: 'operations-profile-' + part,
      locator: description.canonical + part + '.ttl.template', revision: manifestDigest,
      digest: nativeBytesDigest(source[part + '.ttl.template']), status: 'observed', visibility: 'public',
      contentPath: 'sources/operations-' + part + '.ttl.txt',
    })),
    requirements: [{ id: 'operations-profile', required: true, disposition: 'covered' }],
    mappings: [],
  };
  const declaredEntityIds = description.terms.map(term => namespace + term.name);
  const requiredShapeIds = description.shapeNames.map(name => namespace + name);
  for (const [part, ids] of [['model', declaredEntityIds], ['shapes', requiredShapeIds]] as const) {
    const original = source[part + '.ttl.template'];
    for (const targetId of ids) sourceBindings.mappings.push({
      requirementId: 'operations-profile', targetId, sourceId: 'operations-profile-' + part,
      status: 'inferred', revision: manifestDigest, fileDigest: nativeBytesDigest(original),
      selector: { kind: 'lines', start: 1, end: original.split('\n').length },
      fragmentDigest: nativeBytesDigest(original),
      rationale: 'Deterministic project-namespace instantiation of pinned generic definitions; no business fact is inferred.',
    });
  }
  const files = {
    'model.ttl': model, 'shapes/operations.ttl': shapes,
    'profiles/operations.json': JSON.stringify(profile, null, 2) + '\n',
    'sources/operations-model.ttl.txt': source['model.ttl.template'],
    'sources/operations-shapes.ttl.txt': source['shapes.ttl.template'],
    'sources/bindings.json': JSON.stringify(sourceBindings, null, 2) + '\n',
  };
  const body = { namespace, direction: input.direction, profile, files, sourceBindings,
    declaredEntityIds, requiredShapeIds, rootId: namespace + 'project',
    authority: false as const, businessConfirmed: false as const };
  return nativeFrozenClone({ ...body, digest: nativeSha256(body) });
}

/** Exact template integrity. This does not resolve owner records or approve a cause interpretation. */
export function verifyOperationsProfileMaterial(value: OperationsProfileMaterial) {
  nativeAssertJSON(value);
  nativeExact(value, ['namespace', 'direction', 'profile', 'files', 'sourceBindings',
    'declaredEntityIds', 'requiredShapeIds', 'rootId', 'authority', 'businessConfirmed', 'digest']);
  const expected = instantiateOperationsProfile({ namespace: value.namespace, direction: value.direction });
  if (nativeStableSerialize(value) !== nativeStableSerialize(expected)) {
    fail('OPERATIONS_PROFILE_MISMATCH', 'Instantiated profile differs from the pinned template');
  }
  return nativeFrozenClone({ profile: expected.profile, materialDigest: expected.digest,
    authority: false, businessConfirmed: false, ownerReferencesVerified: false });
}

/** Verify the adopted profile inside an ordinary native v1 package, before native SHACL validation. */
export function verifyOperationsProfilePackage(value: NativePackage) {
  const pkg = validateOntologyPackage(value);
  const { coverage, bindings } = packageParts(pkg);
  const expected = instantiateOperationsProfile({ namespace: coverage.namespace, direction: bindings.direction });
  let profile: unknown;
  try { profile = JSON.parse(pkg.files['profiles/operations.json']); }
  catch { return fail('OPERATIONS_PROFILE_MISMATCH', 'Manifested operations profile binding is required'); }
  if (nativeStableSerialize(profile) !== nativeStableSerialize(expected.profile) ||
      !pkg.files['model.ttl'].startsWith(expected.files['model.ttl']) ||
      pkg.files['shapes/operations.ttl'] !== expected.files['shapes/operations.ttl'] ||
      !(pkg.manifest.entrypoints.shapes as string[]).includes('shapes/operations.ttl') ||
      expected.requiredShapeIds.some(id => !coverage.requiredShapeIds.includes(id)) ||
      coverage.projectRoot !== expected.rootId) {
    fail('OPERATIONS_PROFILE_MISMATCH', 'Required profile definitions or constraints changed');
  }
  for (const source of expected.sourceBindings.sources) {
    if (pkg.files[source.contentPath] !== expected.files[source.contentPath] ||
        !bindings.sources.some(actual => nativeStableSerialize(actual) === nativeStableSerialize(source))) {
      fail('OPERATIONS_PROFILE_MISMATCH', 'Pinned profile source closure changed');
    }
  }
  for (const mapping of expected.sourceBindings.mappings) {
    if (!bindings.mappings.some(actual => nativeStableSerialize(actual) === nativeStableSerialize(mapping))) {
      fail('OPERATIONS_PROFILE_MISMATCH', 'Required profile source mapping changed');
    }
  }
  return nativeFrozenClone({ profile: expected.profile, requiredShapeIds: expected.requiredShapeIds,
    authority: false, businessConfirmed: false, ownerReferencesVerified: false,
    nativeValidationRequired: true });
}
