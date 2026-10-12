import { DatabaseSync } from 'node:sqlite';
import { constants, lstatSync, mkdirSync, readdirSync, readFileSync, openSync, closeSync, writeFileSync, fsyncSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute, parse, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assertJSON, stableSerialize } from '../vendor/compatibility/v1/reference.mjs';

export function fail(code, message) { throw Object.assign(new Error(message), { code }); }
export const LIMITS = Object.freeze({ requestBytes: 524288, nodes: 20000, depth: 48, assets: 1000, sources: 1000, receipts: 10000, stateBytes: 8388608, receiptBytes: 33554432 });
export function validateState(value) {
  if (!value || !Array.isArray(value.assets) || (Object.hasOwn(value, 'sources') && !Array.isArray(value.sources))) fail('CORRUPT_STATE', 'Invalid state collections');
  if (value.assets.length > LIMITS.assets || (value.sources?.length ?? 0) > LIMITS.sources) fail('CORRUPT_STATE', 'State collection limit');
  for (const source of value.sources ?? []) {
    if (!source || !/^sha256:[a-f0-9]{64}$/.test(source.sourceId) || !/^sha256:[a-f0-9]{64}$/.test(source.rawDigest) || !source.scope || !['public', 'private'].includes(source.scope.visibility) || !['public', 'private'].includes(source.sourceVisibility) || !['json', 'yaml'].includes(source.format) || typeof source.sourceLocator !== 'string' || typeof source.sourceRevision !== 'string' || !source.inspection || typeof source.inspection.valid !== 'boolean' || !Object.hasOwn(source, 'document')) fail('CORRUPT_STATE', 'Invalid source record');
    slug(source.scope.projectId);
    if (source.sourceVisibility === 'private' && source.scope.visibility === 'public') fail('CORRUPT_STATE', 'Private source in public scope');
  }
  return value;
}
export function bounded(value) {
  let nodes = 0, bytes = 0;
  const ancestors = new Set();
  function visit(v, depth) {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) fail('LIMIT', 'JSON structure limit');
    if (typeof v === 'string') bytes += Buffer.byteLength(v);
    if (bytes > LIMITS.requestBytes) fail('LIMIT', 'JSON byte limit');
    if (!v || typeof v !== 'object') return;
    if (ancestors.has(v)) fail('INVALID_REQUEST', 'Cyclic JSON');
    ancestors.add(v);
    const ds = Object.getOwnPropertyDescriptors(v);
    for (const k of Reflect.ownKeys(ds)) {
      const d = ds[k];
      if (!Object.hasOwn(d, 'value')) fail('INVALID_REQUEST', 'Accessors forbidden');
      bytes += typeof k === 'string' ? Buffer.byteLength(k) : 0;
      visit(d.value, depth + 1);
    }
    ancestors.delete(v);
  }
  visit(value, 0); assertJSON(value);
  if (Buffer.byteLength(stableSerialize(value)) > LIMITS.requestBytes) fail('LIMIT', 'Request too large');
}
export function slug(v) { if (typeof v !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(v)) fail('INVALID_REQUEST', 'Expected slug'); }
const sourceRoot = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
function stat(path) { try { return lstatSync(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
function ancestors(path) {
  const paths = []; for (let p = path; ; p = dirname(p)) { paths.unshift(p); if (p === dirname(p)) break; }
  for (const p of paths) {
    const s = stat(p);
    if (s && (!s.isDirectory() || s.isSymbolicLink())) fail('UNSAFE_WORKSPACE', 'Non-directory or linked ancestor');
    if (stat(join(p, '.git'))) fail('UNSAFE_WORKSPACE', 'Git workspace forbidden');
  }
}
function checked(path, uid, directory, optional = false) {
  const s = stat(path);
  if (!s && optional) return false;
  if (!s || s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile()) || s.uid !== uid || (s.mode & 0o077) || (!directory && s.nlink !== 1)) fail('UNSAFE_WORKSPACE', 'Owned private regular path required');
  return true;
}
function syncDir(path) { const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY); try { fsyncSync(fd); } finally { closeSync(fd); } }
function createFile(path, bytes) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  syncDir(dirname(path));
}
export function openState(root, id) {
  if (typeof process.getuid !== 'function') fail('UNSUPPORTED_PLATFORM', 'OS uid required');
  const uid = process.getuid();
  if (typeof root !== 'string' || !isAbsolute(root) || resolve(root) !== root || root === parse(root).root) fail('UNSAFE_WORKSPACE', 'Explicit canonical absolute root required');
  slug(id);
  if (root === sourceRoot || root.startsWith(sourceRoot + sep) || sourceRoot.startsWith(root + sep)) fail('UNSAFE_WORKSPACE', 'Source workspace forbidden');
  ancestors(root);
  const marker = join(root, 'workspace.json');
  const identity = { schema: 'evopilot-workspace/v1', id, canonicalRoot: root, ownerUid: uid };
  const existing = stat(root);
  if (existing) {
    checked(root, uid, true);
    if (!stat(marker) && readdirSync(root).length) fail('UNKNOWN_WORKSPACE', 'Nonempty root lacks identity');
  } else if (!stat(dirname(root))) fail('UNSAFE_WORKSPACE', 'Parent must already exist');
  if (stat(marker)) {
    checked(marker, uid, false);
    let actual; try { actual = JSON.parse(readFileSync(marker, 'utf8')); } catch { fail('IDENTITY_MISMATCH', 'Malformed workspace identity'); }
    if (stableSerialize(actual) !== stableSerialize(identity)) fail('IDENTITY_MISMATCH', 'Workspace identity mismatch');
  }
  const dirs = [join(root, 'state'), join(root, 'state/ontology')];
  const dbPath = join(root, 'state/ontology/ontology.db');
  for (const d of dirs) checked(d, uid, true, true);
  for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm', dbPath + '-journal']) checked(p, uid, false, true);
  const existed = !!stat(dbPath);
  if (!existed && stat(dirs[1]) && readdirSync(dirs[1]).length) fail('CORRUPT_STATE', 'Missing database in nonempty product state');
  if (!existing) { mkdirSync(root, { mode: 0o700 }); syncDir(dirname(root)); }
  if (!stat(marker)) createFile(marker, stableSerialize(identity));
  for (const d of dirs) if (!stat(d)) { mkdirSync(d, { mode: 0o700 }); syncDir(dirname(d)); }
  if (!existed) createFile(dbPath, '');
  let db;
  function guard() {
    ancestors(root); checked(root, uid, true); checked(marker, uid, false);
    let value; try { value = JSON.parse(readFileSync(marker, 'utf8')); } catch { fail('IDENTITY_MISMATCH', 'Malformed identity'); }
    if (stableSerialize(value) !== stableSerialize(identity)) fail('IDENTITY_MISMATCH', 'Workspace identity changed');
    for (const d of dirs) checked(d, uid, true);
    for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm', dbPath + '-journal']) checked(p, uid, false, true);
    checked(dbPath, uid, false);
  }
  try {
    db = new DatabaseSync(dbPath, { timeout: 1000, allowExtension: false });
    db.enableDefensive(true);
    if (existed) {
      if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') fail('CORRUPT_STATE', 'SQLite integrity check failed');
      if (db.prepare('PRAGMA user_version').get().user_version !== 1) fail('CORRUPT_STATE', 'Unknown state schema');
      const row = db.prepare('SELECT revision, data FROM state WHERE singleton = 1').get();
      if (!row || !Number.isSafeInteger(row.revision) || row.revision < 0 || !validateState(JSON.parse(row.data))) fail('CORRUPT_STATE', 'Invalid state');
      db.prepare('SELECT scope, request_id, digest, receipt FROM receipts LIMIT 1').all();
      db.prepare('SELECT revision, uid, operation, request_digest, result_digest FROM audit LIMIT 1').all();
    }
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    if (!existed) db.exec("BEGIN IMMEDIATE; CREATE TABLE state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL, data TEXT NOT NULL); INSERT INTO state VALUES(1,0,'{\"assets\":[]}'); CREATE TABLE receipts (scope TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY(scope,request_id)); CREATE TABLE audit (revision INTEGER PRIMARY KEY, uid INTEGER NOT NULL, operation TEXT NOT NULL, request_digest TEXT NOT NULL, result_digest TEXT NOT NULL); PRAGMA user_version=1; COMMIT;");
    guard();
  } catch (e) { if (db) db.close(); fail('CORRUPT_STATE', 'Cannot open verified Ontology state: ' + (e.code || 'invalid database')); }
  function blob(scope, value) {
    guard();
    const bytes = stableSerialize(value);
    const hash = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
    const parts = scope.visibility === 'public' ? ['public', 'ontology'] : ['private', 'projects', scope.projectId, 'ontology'];
    let p = root;
    for (const part of parts) {
      p = join(p, part); if (!stat(p)) { mkdirSync(p, { mode: 0o700 }); syncDir(dirname(p)); } checked(p, uid, true);
    }
    const target = join(p, hash.slice(7) + '.json');
    if (!stat(target)) { try { createFile(target, bytes); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    checked(target, uid, false);
    if (readFileSync(target, 'utf8') !== bytes) fail('CORRUPT_BLOB', 'Existing content differs');
    return hash;
  }
  function verifyBlob(scope, value) {
    const hash = createHash('sha256').update(stableSerialize(value)).digest('hex');
    const parts = scope.visibility === 'public' ? ['public', 'ontology'] : ['private', 'projects', scope.projectId, 'ontology'];
    let p = root; for (const part of parts) { p = join(p, part); checked(p, uid, true); }
    p = join(p, hash + '.json'); checked(p, uid, false);
    if (readFileSync(p, 'utf8') !== stableSerialize(value)) fail('CORRUPT_BLOB', 'Referenced bytes differ');
  }
  function rawPath(scope, digest, create = false) {
    guard(); slug(scope.projectId);
    if (!['public', 'private'].includes(scope.visibility) || !/^sha256:[a-f0-9]{64}$/.test(digest)) fail('CORRUPT_BLOB', 'Invalid raw blob reference');
    const parts = scope.visibility === 'public' ? ['public', 'ontology', 'sources'] : ['private', 'projects', scope.projectId, 'ontology', 'sources'];
    let p = root;
    for (const part of parts) {
      p = join(p, part);
      if (create && !stat(p)) { mkdirSync(p, { mode: 0o700 }); syncDir(dirname(p)); }
      checked(p, uid, true);
    }
    return join(p, digest.slice(7) + '.raw');
  }
  function verifyRawBlob(scope, digest) {
    const target = rawPath(scope, digest); checked(target, uid, false);
    if (lstatSync(target).size > LIMITS.requestBytes) fail('CORRUPT_BLOB', 'Raw source exceeds byte limit');
    const bytes = readFileSync(target);
    if (bytes.length > LIMITS.requestBytes || 'sha256:' + createHash('sha256').update(bytes).digest('hex') !== digest) fail('CORRUPT_BLOB', 'Raw source bytes differ');
    const raw = bytes.toString('utf8');
    if (!Buffer.from(raw, 'utf8').equals(bytes)) fail('CORRUPT_BLOB', 'Invalid UTF-8 source bytes');
    return raw;
  }
  function rawBlob(scope, raw) {
    const bytes = Buffer.from(raw, 'utf8');
    const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
    const target = rawPath(scope, digest, true);
    if (!stat(target)) { try { createFile(target, bytes); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    if (verifyRawBlob(scope, digest) !== raw) fail('CORRUPT_BLOB', 'Raw source bytes differ');
    return digest;
  }
  return { db, uid, identity, guard, blob, verifyBlob, rawBlob, verifyRawBlob };
}
