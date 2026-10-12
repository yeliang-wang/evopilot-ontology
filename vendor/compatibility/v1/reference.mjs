export const CONTRACT_REVISION = '1.0.0';
import { createHash } from 'node:crypto';

// Descriptor inspection precedes all traversal of untrusted JSON values.
export function assertJSON(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object') throw new TypeError('Expected finite JSON');
  if (ancestors.has(value)) throw new TypeError('Cyclic JSON');
  const array = Array.isArray(value);
  if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('Expected plain object');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(k => typeof k !== 'string')) throw new TypeError('Symbol field');
  if (array && (keys.length !== descriptors.length.value + 1 || keys.some(k => k !== 'length' && !/^(0|[1-9][0-9]*)$/.test(k)))) throw new TypeError('Sparse or decorated array');
  ancestors.add(value);
  for (const k of keys) {
    if (array && k === 'length') continue;
    const d = descriptors[k];
    if (!Object.hasOwn(d, 'value') || !d.enumerable) throw new TypeError('Non-data descriptor');
    assertJSON(d.value, ancestors);
  }
  ancestors.delete(value);
}
export function stableSerialize(value) {
  assertJSON(value);
  const encode = v => v === null || typeof v !== 'object' ? JSON.stringify(v)
    : Array.isArray(v) ? `[${v.map(encode).join(',')}]`
      : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${encode(v[k])}`).join(',')}}`;
  return encode(value);
}
export function sha256(value) { return `sha256:${createHash('sha256').update(stableSerialize(value)).digest('hex')}`; }
export function frozenClone(value) {
  const clone = JSON.parse(stableSerialize(value));
  const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
  return freeze(clone);
}
export function exactFields(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected object');
  if (required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => ![...required, ...optional].includes(k))) throw new TypeError('Missing or unknown field');
}
export function textField(value) { if (typeof value !== 'string' || !value.trim() || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError('Expected nonempty text'); }
export const SOURCE_STATUSES = Object.freeze(['design-proposed', 'design-confirmed', 'source-observed', 'inferred', 'runtime-observed', 'human-reviewed', 'synthetic']);
export const ENVELOPE_FIELDS = Object.freeze(['id', 'version', 'product', 'specVersion', 'visibility', 'provenance', 'extensions', 'dependencies']);
export function validateEnvelope(asset) {
  assertJSON(asset);
  validateReference({ product: asset.product, id: asset.id, version: asset.version, specVersion: asset.specVersion, visibility: asset.visibility, digest: `sha256:${'0'.repeat(64)}` });
  exactFields(asset.provenance, ['direction', 'sources']);
  if (!['forward', 'reverse'].includes(asset.provenance.direction) || !Array.isArray(asset.provenance.sources) || !asset.provenance.sources.length) throw new TypeError('Invalid provenance');
  const ids = new Set();
  for (const s of asset.provenance.sources) {
    exactFields(s, ['id', 'kind', 'locator', 'revision', 'digest', 'status']);
    for (const k of ['id', 'kind', 'locator', 'revision']) textField(s[k]);
    if (ids.has(s.id) || !SOURCE_STATUSES.includes(s.status) || typeof s.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(s.digest)) throw new TypeError('Invalid source');
    ids.add(s.id);
  }
  if (!Array.isArray(asset.dependencies) || !Array.isArray(asset.extensions)) throw new TypeError('Expected dependency/extension arrays');
  const dependencies = new Set();
  for (const ref of asset.dependencies) {
    validateReference(ref, { visibility: asset.visibility });
    const key = `${ref.product}:${ref.id}`;
    if (dependencies.has(key)) throw new TypeError('Duplicate dependency identity');
    dependencies.add(key);
  }
  const extensions = []; const namespaces = new Set();
  for (const e of asset.extensions) {
    exactFields(e, ['namespace', 'version', 'required', 'data']);
    if (typeof e.namespace !== 'string' || !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(e.namespace) || typeof e.version !== 'string' || !coreVersion.test(e.version) || typeof e.required !== 'boolean') throw new TypeError('Invalid extension');
    if (namespaces.has(e.namespace)) throw new TypeError('Conflicting extension namespace');
    namespaces.add(e.namespace);
    if (!e.data || typeof e.data !== 'object' || Array.isArray(e.data)) throw new TypeError('Invalid extension data');
    if (['basePatch', 'override', ...ENVELOPE_FIELDS, 'concepts', 'properties', 'relations', 'constraints', 'sourceMappings', 'unresolvedIssues', 'kind', 'applicability', 'objectives', 'preconditions', 'inputs', 'parameters', 'deliverables', 'rules'].some(k => Object.hasOwn(e.data, k))) throw new TypeError('Extension base conflict');
    const known = e.namespace === 'local.notes' && e.version === '1.0.0';
    if (known) { exactFields(e.data, ['annotation']); exactFields(e.data.annotation, ['text'], ['language']); textField(e.data.annotation.text); if (Object.hasOwn(e.data.annotation, 'language')) textField(e.data.annotation.language); }
    else if (e.required) throw new TypeError('Unknown required extension');
    extensions.push({ namespace: e.namespace, version: e.version, status: known ? 'VALID' : 'NOT_EVALUATED' });
  }
  return frozenClone({ extensions, authority: false });
}

const fields = Object.freeze(['product', 'id', 'version', 'specVersion', 'digest', 'visibility']);
const products = Object.freeze(['harness', 'ontology']);
const coreVersion = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

// Inspect descriptors before values: accessors and non-data objects are rejected.
export function validateReference(value, { product, visibility } = {}) {
  if (value === null || typeof value !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('Reference must be a plain data object');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) throw new TypeError('Reference must contain exactly six fields');
  const ref = {};
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable || typeof descriptor.value !== 'string') throw new TypeError(`Invalid data field: ${field}`);
    ref[field] = descriptor.value;
  }
  if (!products.includes(ref.product) || (product !== undefined && product !== ref.product)) throw new TypeError('Reference product mismatch');
  if (!ref.id || ref.id.trim() !== ref.id || /[\u0000-\u001f\u007f]/.test(ref.id)) throw new TypeError('Invalid reference id');
  if (!coreVersion.test(ref.version)) throw new TypeError('Version must be strict SemVer core');
  if (ref.specVersion !== 'v1') throw new TypeError('Unsupported reference specVersion');
  if (!/^sha256:[a-f0-9]{64}$/.test(ref.digest)) throw new TypeError('Invalid SHA256 reference digest');
  if (!['private', 'public'].includes(ref.visibility)) throw new TypeError('Invalid reference visibility');
  if (visibility !== undefined && !['private', 'public'].includes(visibility)) throw new TypeError('Invalid boundary visibility');
  if (visibility === 'public' && ref.visibility === 'private') throw new TypeError('Private reference cannot cross a public boundary');
  return Object.freeze(ref);
}

export function inspectReference(ref, observed, options = {}) {
  const expected = validateReference(ref, options);
  const actual = validateReference(observed, options);
  for (const field of fields) {
    if (expected[field] !== actual[field]) throw new TypeError(`Immutable reference binding mismatch: ${field}`);
  }
  return Object.freeze({ reference: expected, exactMatch: true, authority: false });
}
