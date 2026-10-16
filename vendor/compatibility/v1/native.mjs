import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
/** Current corrected v1 contract. Legacy reference.mjs remains historical only. */
export const NATIVE_CONTRACT_REVISION = '1.1.0';
/** Bytes of this compiled contract, independently pinned by the installation. */
export const NATIVE_CONTRACT_DIGEST = 'sha256:' + createHash('sha256').update(readFileSync(new URL('./native.mjs', import.meta.url))).digest('hex');
export const NATIVE_LIMITS = Object.freeze({ files: 4096, fileBytes: 32 * 1024 * 1024, packageBytes: 128 * 1024 * 1024, nodes: 200000, depth: 64 });
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const hexPattern = /^[a-f0-9]{64}$/;
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
export function nativeAssertJSON(value) {
    const ancestors = new Set();
    let nodes = 0;
    const visit = (v, depth) => {
        if (++nodes > NATIVE_LIMITS.nodes || depth > NATIVE_LIMITS.depth)
            throw new TypeError('Native JSON limit');
        if (v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v))
            return;
        if (!v || typeof v !== 'object' || ancestors.has(v))
            throw new TypeError('Expected finite acyclic native JSON');
        const array = Array.isArray(v);
        if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
            throw new TypeError('Expected plain native data');
        const descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(descriptors);
        if (keys.some(k => typeof k !== 'string'))
            throw new TypeError('Native symbol field');
        if (array && (keys.length !== descriptors.length.value + 1 || keys.some(k => k !== 'length' && !/^(0|[1-9][0-9]*)$/.test(k))))
            throw new TypeError('Sparse/decorated native array');
        ancestors.add(v);
        for (const key of keys) {
            if (array && key === 'length')
                continue;
            const descriptor = descriptors[key];
            if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
                throw new TypeError('Native data descriptors required');
            visit(descriptor.value, depth + 1);
        }
        ancestors.delete(v);
    };
    visit(value, 0);
}
export function nativeStableSerialize(value) {
    nativeAssertJSON(value);
    const encode = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v)
        : Array.isArray(v) ? '[' + v.map(encode).join(',') + ']' : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + encode(v[k])).join(',') + '}';
    return encode(value);
}
export function nativeSha256(value) { return nativeBytesDigest(Buffer.from(nativeStableSerialize(value))); }
export function nativeBytesDigest(bytes) { return 'sha256:' + createHash('sha256').update(bytes).digest('hex'); }
export function nativeFrozenClone(value) {
    const clone = JSON.parse(nativeStableSerialize(value));
    const freeze = (v) => { if (v && typeof v === 'object') {
        Object.values(v).forEach(freeze);
        Object.freeze(v);
    } };
    freeze(clone);
    return clone;
}
export function nativeExact(value, fields, optional = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || fields.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => !fields.includes(k) && !optional.includes(k)))
        throw new TypeError('Missing or unknown native field');
}
export function nativeText(value) {
    if (typeof value !== 'string' || !value || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value))
        throw new TypeError('Expected nonempty native text');
}
export function nativeDigest(value) { if (typeof value !== 'string' || !digestPattern.test(value))
    throw new TypeError('Expected SHA256 native digest'); }
export function nativeRelativePath(value) {
    nativeText(value);
    if (value.length > 512 || value.normalize('NFC') !== value || value.includes('\\') || value.startsWith('/') || value.includes(':') || value.split('/').some(p => !p || p === '.' || p === '..' || p.endsWith('.') || p.endsWith(' ')))
        throw new TypeError('Expected normalized relative native file path');
}
export function validateStandardPins(value) {
    nativeAssertJSON(value);
    nativeExact(value, ['standardDigest', 'standardLockDigest']);
    nativeDigest(value.standardDigest);
    nativeDigest(value.standardLockDigest);
    return nativeFrozenClone(value);
}
export function validateNativeReference(value, options = {}) {
    nativeAssertJSON(value);
    nativeExact(value, ['product', 'id', 'version', 'specVersion', 'visibility', 'digest', 'standardDigest', 'standardLockDigest', 'producer', 'contractDigest']);
    if (!['ontology', 'harness'].includes(value.product) || options.product !== undefined && options.product !== value.product)
        throw new TypeError('Native owner mismatch');
    nativeText(value.id);
    if (typeof value.version !== 'string' || !versionPattern.test(value.version))
        throw new TypeError('Native asset version must be SemVer core');
    if (value.specVersion !== 'v1' || !['public', 'private'].includes(value.visibility) || options.visibility === 'public' && value.visibility === 'private')
        throw new TypeError('Native spec or visibility mismatch');
    for (const key of ['digest', 'standardDigest', 'standardLockDigest', 'contractDigest'])
        nativeDigest(value[key]);
    nativeExact(value.producer, ['product', 'version']);
    if (value.producer.product !== value.product || value.producer.version !== '0.3.0')
        throw new TypeError('Unknown native producer');
    if (options.standardPins && (options.standardPins.standardDigest !== value.standardDigest || options.standardPins.standardLockDigest !== value.standardLockDigest))
        throw new TypeError('Native standard pin mismatch');
    if (options.contractDigest && options.contractDigest !== value.contractDigest)
        throw new TypeError('Native contract mismatch');
    return nativeFrozenClone(value);
}
export function validateNativePackage(value, options = {}) {
    nativeAssertJSON(value);
    nativeExact(value, ['manifest', 'files']);
    nativeExact(value.manifest, ['schema', 'specVersion', 'owner', 'id', 'version', 'visibility', 'standardPins', 'contractDigest', 'producer', 'entrypoints', 'files', 'dependencies', 'sourceBindingRef']);
    const m = value.manifest;
    if (m.schema !== 'evopilot-native-package/v1')
        throw new TypeError('Unsupported native package');
    const pins = validateStandardPins(m.standardPins);
    validateNativeReference({ product: m.owner, id: m.id, version: m.version, specVersion: m.specVersion, visibility: m.visibility, digest: 'sha256:' + '0'.repeat(64), ...pins, producer: m.producer, contractDigest: m.contractDigest }, { product: options.owner, standardPins: options.standardPins, contractDigest: options.contractDigest });
    if (!Array.isArray(m.files) || !m.files.length || m.files.length > NATIVE_LIMITS.files || !value.files || typeof value.files !== 'object' || Array.isArray(value.files))
        throw new TypeError('Expected nonempty bounded native file manifest');
    const files = value.files, paths = new Set(), folded = new Set();
    let total = 0, previousPath = null;
    for (const file of m.files) {
        nativeExact(file, ['path', 'mediaType', 'sha256']);
        nativeRelativePath(file.path);
        nativeText(file.mediaType);
        if (previousPath !== null && previousPath.localeCompare(file.path, 'en') >= 0)
            throw new TypeError('Native file manifest must be strictly sorted by path');
        previousPath = file.path;
        const fold = file.path.toLowerCase();
        if (paths.has(file.path) || folded.has(fold) || typeof file.sha256 !== 'string' || !hexPattern.test(file.sha256))
            throw new TypeError('Duplicate path or invalid file SHA256');
        paths.add(file.path);
        folded.add(fold);
        const contents = files[file.path];
        if (typeof contents !== 'string' || Buffer.from(contents).toString('utf8') !== contents || Buffer.byteLength(contents) > NATIVE_LIMITS.fileBytes)
            throw new TypeError('Expected bounded UTF-8 native file');
        total += Buffer.byteLength(contents);
        if (total > NATIVE_LIMITS.packageBytes || nativeBytesDigest(contents).slice(7) !== file.sha256)
            throw new TypeError('Native file digest/size mismatch');
    }
    if (Object.keys(files).length !== paths.size || Object.keys(files).some(path => !paths.has(path)))
        throw new TypeError('Unmanifested native file');
    if (!m.entrypoints || typeof m.entrypoints !== 'object' || Array.isArray(m.entrypoints) || !Object.keys(m.entrypoints).length)
        throw new TypeError('Expected native entrypoints');
    for (const [key, entry] of Object.entries(m.entrypoints)) {
        nativeText(key);
        const entries = Array.isArray(entry) ? entry : [entry];
        if (!entries.length || new Set(entries).size !== entries.length)
            throw new TypeError('Empty/duplicate native entrypoint');
        for (const path of entries) {
            nativeRelativePath(path);
            if (!paths.has(path))
                throw new TypeError('Unmanifested native entrypoint');
        }
    }
    nativeRelativePath(m.sourceBindingRef);
    if (!paths.has(m.sourceBindingRef))
        throw new TypeError('Unmanifested native source bindings');
    try {
        nativeAssertJSON(JSON.parse(files[m.sourceBindingRef]));
    }
    catch {
        throw new TypeError('Source binding must be manifested JSON');
    }
    if (!Array.isArray(m.dependencies))
        throw new TypeError('Expected native dependencies');
    const refs = new Set();
    for (const dep of m.dependencies) {
        const ref = validateNativeReference(dep, { visibility: m.visibility, contractDigest: options.contractDigest });
        const id = ref.product + ':' + ref.id;
        if (refs.has(id))
            throw new TypeError('Duplicate native dependency');
        refs.add(id);
    }
    return nativeFrozenClone(value);
}
export function nativePackageDigest(value) { validateNativePackage(value); return nativeSha256(value); }
export function referenceForPackage(value) {
    validateNativePackage(value);
    const m = value.manifest;
    return validateNativeReference({ product: m.owner, id: m.id, version: m.version, specVersion: m.specVersion, visibility: m.visibility, digest: nativePackageDigest(value), ...m.standardPins, producer: m.producer, contractDigest: m.contractDigest });
}
