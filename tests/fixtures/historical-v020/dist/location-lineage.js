import { constants, lstatSync, mkdirSync, rmdirSync, readdirSync, readFileSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { homedir, hostname } from 'node:os';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { stableSerialize } from '../vendor/compatibility/v1/reference.mjs';
export const hash = (value) => 'sha256:' + createHash('sha256').update(stableSerialize(value)).digest('hex');
export function migrationFail(code, message) { throw Object.assign(new Error(message), { code }); }
export function pathStat(path) { try {
    return lstatSync(path);
}
catch (error) {
    if (error.code === 'ENOENT')
        return null;
    throw error;
} }
export function safeAncestors(path) {
    if (!isAbsolute(path) || resolve(path) !== path || path === parse(path).root)
        migrationFail('UNSAFE_WORKSPACE', 'Canonical absolute path required');
    for (let cursor = path;; cursor = dirname(cursor)) {
        const stat = pathStat(cursor);
        if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
            migrationFail('UNSAFE_WORKSPACE', 'Regular directory ancestry required');
        if (pathStat(join(cursor, '.git')))
            migrationFail('UNSAFE_WORKSPACE', 'Git data root forbidden');
        if (cursor === dirname(cursor))
            break;
    }
}
export function privatePath(path, directory) {
    const stat = pathStat(path), uid = process.getuid?.();
    if (uid === undefined || !stat || stat.isSymbolicLink() || stat.uid !== uid || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) || (stat.mode & 0o777) !== (directory ? 0o700 : 0o600))
        migrationFail('UNSAFE_WORKSPACE', 'Owned private regular path required');
}
function syncDirectory(path) { const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY); try {
    fsyncSync(fd);
}
finally {
    closeSync(fd);
} }
function createPrivateFile(path, bytes) {
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
        writeFileSync(fd, bytes);
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
    syncDirectory(dirname(path));
}
export function readIdentity(root, id) {
    safeAncestors(root);
    privatePath(root, true);
    const marker = join(root, 'workspace.json');
    privatePath(marker, false);
    if (lstatSync(marker).size > 4096)
        migrationFail('IDENTITY_MISMATCH', 'Oversized identity');
    const value = JSON.parse(readFileSync(marker, 'utf8'));
    if (stableSerialize(Object.keys(value).sort()) !== stableSerialize(['canonicalRoot', 'id', 'ownerUid', 'schema']) || value.schema !== 'evopilot-workspace/v1' || value.id !== id || value.ownerUid !== process.getuid?.() || !isAbsolute(value.canonicalRoot) || resolve(value.canonicalRoot) !== value.canonicalRoot)
        migrationFail('IDENTITY_MISMATCH', 'Exact same-owner workspace identity required');
    return value;
}
export function writeRelocatedIdentity(root, identity) {
    if (identity.canonicalRoot !== root || identity.ownerUid !== process.getuid?.())
        migrationFail('IDENTITY_MISMATCH', 'Relocation marker identity differs');
    const marker = join(root, 'workspace.json'), staging = root + '.evopilot-relocation';
    const bytes = Buffer.from(stableSerialize(identity));
    const name = hash(identity).slice(7) + '.pending', temporary = join(staging, name);
    // This protected sibling is outside the copied business inventory. Its only
    // permitted file is bound to the exact target identity, including path and uid.
    safeAncestors(staging);
    if (!pathStat(staging)) {
        mkdirSync(staging, { mode: 0o700 });
        syncDirectory(dirname(staging));
    }
    privatePath(staging, true);
    if (readdirSync(staging).some(entry => entry !== name))
        migrationFail('RELOCATION_STAGING_CONFLICT', 'Foreign relocation staging content');
    if (pathStat(temporary)) {
        privatePath(temporary, false);
        if (lstatSync(temporary).size > bytes.length)
            migrationFail('RELOCATION_STAGING_CONFLICT', 'Relocation staging differs');
        const partial = readFileSync(temporary);
        if (!bytes.subarray(0, partial.length).equals(partial))
            migrationFail('RELOCATION_STAGING_CONFLICT', 'Relocation staging differs');
        // A killed writer can leave an exact prefix, including zero bytes. Only this
        // proven operation-owned temporary is replaced; no user file is removed.
        if (partial.length !== bytes.length) {
            unlinkSync(temporary);
            syncDirectory(staging);
        }
    }
    if (!pathStat(temporary))
        createPrivateFile(temporary, bytes);
    renameSync(temporary, marker);
    syncDirectory(root);
    syncDirectory(staging);
    rmdirSync(staging);
    syncDirectory(dirname(staging));
}
export function keyDirectory() { return join(homedir(), '.local', 'share', 'evopilot', 'relocation-keys'); }
function readKey(id) {
    if (!/^[a-f0-9]{64}$/.test(id))
        migrationFail('INVALID_LINEAGE', 'Invalid relocation key identity');
    const directory = keyDirectory();
    safeAncestors(directory);
    if (!pathStat(directory) || !pathStat(join(directory, id + '.key')))
        migrationFail('MISSING_RELOCATION_KEY', 'Retained same-host relocation key required');
    privatePath(directory, true);
    const file = join(directory, id + '.key');
    privatePath(file, false);
    const bytes = readFileSync(file);
    if (bytes.length !== 32)
        migrationFail('INVALID_LINEAGE', 'Invalid relocation key');
    return bytes;
}
function newKey() {
    const directory = keyDirectory();
    safeAncestors(directory);
    const missing = [];
    for (let path = directory; !pathStat(path); path = dirname(path))
        missing.unshift(path);
    for (const path of missing) {
        mkdirSync(path, { mode: 0o700 });
        syncDirectory(dirname(path));
    }
    privatePath(directory, true);
    const id = randomBytes(32).toString('hex');
    createPrivateFile(join(directory, id + '.key'), randomBytes(32));
    return id;
}
const hostDigest = () => hash({ hostname: hostname(), home: homedir(), uid: process.getuid?.() });
function hasLineage(db) { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_relocations'").get(); }
function prefix(db, revision) {
    const receipts = db.prepare('SELECT scope,request_id,digest,receipt FROM receipts WHERE CAST(json_extract(receipt,\'$.revision\') AS INTEGER)<=? ORDER BY scope,request_id').all(revision);
    const audit = db.prepare('SELECT revision,uid,operation,request_digest,result_digest FROM audit WHERE revision<=? ORDER BY revision').all(revision);
    return { receiptsDigest: hash(receipts), auditDigest: hash(audit) };
}
export function readRelocations(db, identity, product) {
    if (!hasLineage(db))
        return [];
    const rows = db.prepare('SELECT sequence,record FROM workspace_relocations ORDER BY sequence').all();
    if (rows.length > 64 || !rows.length)
        migrationFail('INVALID_LINEAGE', 'Bounded nonempty relocation history required');
    const records = [];
    for (const [index, row] of rows.entries()) {
        if (row.sequence !== index + 1 || typeof row.record !== 'string' || Buffer.byteLength(row.record) > 8388608)
            migrationFail('INVALID_LINEAGE', 'Invalid relocation row');
        const record = JSON.parse(row.record);
        const { recordDigest, signature, ...subject } = record;
        if (record.schema !== 'evopilot-workspace-relocation/v1' || record.product !== product || recordDigest !== hash(subject) || record.hostDigest !== hostDigest() || !Number.isSafeInteger(record.historyRevision) || record.historyRevision < 0 || !Array.isArray(record.bindings) || record.bindings.length > 20000 || !/^[a-f0-9]{64}$/.test(signature))
            migrationFail('INVALID_LINEAGE', 'Relocation metadata differs');
        const expected = createHmac('sha256', readKey(record.keyId)).update(stableSerialize(subject)).digest();
        if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
            migrationFail('INVALID_LINEAGE', 'Relocation attestation differs');
        for (const location of [record.from, record.to])
            if (location.schema !== identity.schema || location.id !== identity.id || location.ownerUid !== identity.ownerUid || !isAbsolute(location.canonicalRoot) || resolve(location.canonicalRoot) !== location.canonicalRoot)
                migrationFail('INVALID_LINEAGE', 'Relocation scope differs');
        const previous = records.at(-1);
        if (record.previousDigest !== (previous?.recordDigest ?? null) || (previous && stableSerialize(record.from) !== stableSerialize(previous.to)) || stableSerialize(record.from) === stableSerialize(record.to))
            migrationFail('INVALID_LINEAGE', 'Relocation chain differs');
        const saved = prefix(db, record.historyRevision);
        if (saved.receiptsDigest !== record.receiptsDigest || saved.auditDigest !== record.auditDigest)
            migrationFail('INVALID_LINEAGE', 'Historical receipts or audit changed');
        for (const binding of record.bindings)
            if (binding.workspace.id !== identity.id || binding.workspace.ownerUid !== identity.ownerUid || !/^sha256:[a-f0-9]{64}$/.test(binding.digest))
                migrationFail('INVALID_LINEAGE', 'Historical binding differs');
        records.push(record);
    }
    if (stableSerialize(records.at(-1).to) !== stableSerialize(identity))
        migrationFail('INVALID_LINEAGE', 'Relocation destination differs');
    return records;
}
export function acceptsWorkspace(db, identity, product, historical, digest) {
    if (stableSerialize(identity) === stableSerialize(historical))
        return true;
    return readRelocations(db, identity, product).some(record => record.bindings.some(binding => stableSerialize(binding.workspace) === stableSerialize(historical) && binding.digest === digest));
}
export function inspectRecords(db, validateState) {
    if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' || db.prepare('PRAGMA user_version').get()?.user_version !== 1)
        migrationFail('CORRUPT_STATE', 'Invalid owner database');
    const row = db.prepare('SELECT revision,data FROM state WHERE singleton=1').get();
    if (!row || typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 0 || typeof row.data !== 'string' || Buffer.byteLength(row.data) > 8388608)
        migrationFail('CORRUPT_STATE', 'Invalid owner state');
    const state = validateState(JSON.parse(row.data));
    const receipts = db.prepare('SELECT scope,request_id,digest,receipt FROM receipts ORDER BY scope,request_id').all();
    const audit = db.prepare('SELECT revision,uid,operation,request_digest,result_digest FROM audit ORDER BY revision').all();
    if (receipts.length > 10000 || receipts.length !== row.revision || audit.length !== row.revision)
        migrationFail('CORRUPT_STATE', 'Incomplete owner history');
    const revisions = new Set();
    for (const saved of receipts) {
        if (typeof saved.receipt !== 'string' || Buffer.byteLength(saved.receipt) > 1048576)
            migrationFail('CORRUPT_STATE', 'Invalid retained receipt');
        const receipt = JSON.parse(saved.receipt);
        if (typeof receipt.revision !== 'number' || revisions.has(receipt.revision) || receipt.scope === undefined || receipt.result === undefined)
            migrationFail('CORRUPT_STATE', 'Invalid receipt identity');
        revisions.add(receipt.revision);
        const entry = audit[receipt.revision - 1];
        if (!entry || entry.revision !== receipt.revision || saved.scope !== stableSerialize(receipt.scope) || saved.request_id !== receipt.requestId || saved.digest !== receipt.requestDigest || entry.uid !== receipt.uid || entry.operation !== receipt.operation || entry.request_digest !== receipt.requestDigest || entry.result_digest !== hash(receipt.result))
            migrationFail('CORRUPT_STATE', 'Receipt audit binding differs');
    }
    const stateDigest = hash({ revision: row.revision, data: row.data }), receiptsDigest = hash(receipts), auditDigest = hash(audit);
    return { revision: row.revision, state, stateDigest, receiptsDigest, auditDigest, recordsDigest: hash({ stateDigest, receiptsDigest, auditDigest }), receiptCount: receipts.length };
}
export function collectBindings(state) {
    const value = state, bindings = new Map();
    const add = (workspace, digest) => {
        if (!workspace || typeof workspace !== 'object' || typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(digest))
            migrationFail('CORRUPT_STATE', 'Invalid historical owner binding');
        const binding = { workspace: workspace, digest };
        bindings.set(stableSerialize(binding), binding);
    };
    for (const run of (value.runs ?? []))
        add(run.plan.workspace, run.reviewDigest);
    for (const asset of (value.assets ?? []))
        if (asset.review)
            add(asset.review.workspace, asset.review.reviewDigest);
    for (const key of ['producerPlans', 'catalogPlans'])
        for (const plan of (value[key] ?? []))
            add(plan.workspace, plan.reviewDigest);
    for (const revision of (value.catalogRevisions ?? [])) {
        add(revision.workspace, revision.pointer.pointerDigest);
        add(revision.pointer.workspace, revision.pointer.pointerDigest);
    }
    return [...bindings.values()].sort((a, b) => stableSerialize(a).localeCompare(stableSerialize(b)));
}
export function appendRelocation(db, product, from, to, snapshotDigest, records) {
    const previous = readRelocations(db, from, product).at(-1);
    const keyId = previous?.keyId ?? newKey();
    const subject = { schema: 'evopilot-workspace-relocation/v1', product, from, to, sourceSnapshotDigest: snapshotDigest, historyRevision: records.revision, receiptsDigest: records.receiptsDigest, auditDigest: records.auditDigest, bindings: collectBindings(records.state), previousDigest: previous?.recordDigest ?? null, hostDigest: hostDigest(), keyId, at: new Date().toISOString() };
    const record = { ...subject, recordDigest: hash(subject), signature: createHmac('sha256', readKey(keyId)).update(stableSerialize(subject)).digest('hex') };
    db.exec('CREATE TABLE IF NOT EXISTS workspace_relocations (sequence INTEGER PRIMARY KEY, record TEXT NOT NULL)');
    db.prepare('INSERT INTO workspace_relocations(record) VALUES(?)').run(stableSerialize(record));
    return record;
}
export function inspectBlobs(root, product) {
    const files = [];
    const visit = (path) => {
        privatePath(path, true);
        for (const name of readdirSync(path).sort()) {
            const file = join(path, name), stat = lstatSync(file);
            if (stat.isDirectory()) {
                visit(file);
                continue;
            }
            privatePath(file, false);
            if (stat.size > 8388608 || !/^[a-f0-9]{64}\.(?:json|raw)$/.test(name))
                migrationFail('CORRUPT_BLOB', 'Invalid owner content-addressed blob');
            const bytes = readFileSync(file), digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
            if (name.slice(0, 64) !== digest.slice(7))
                migrationFail('CORRUPT_BLOB', 'Owner blob digest differs');
            files.push({ path: file.slice(root.length + 1), bytes: bytes.length, digest });
        }
    };
    const publicRoot = join(root, 'public', product);
    if (pathStat(publicRoot)) {
        privatePath(join(root, 'public'), true);
        visit(publicRoot);
    }
    const projects = join(root, 'private', 'projects');
    if (pathStat(projects)) {
        privatePath(join(root, 'private'), true);
        privatePath(projects, true);
        for (const id of readdirSync(projects).sort()) {
            const project = join(projects, id);
            privatePath(project, true);
            const owner = join(project, product);
            if (pathStat(owner))
                visit(owner);
        }
    }
    return files;
}
