/** Owner-controlled, same-host location lineage. Business records are never rewritten. */
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { constants, lstatSync, mkdirSync, rmdirSync, readdirSync, readFileSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { homedir, hostname, platform } from 'node:os';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { stableSerialize } from '../vendor/compatibility/v1/reference.mjs';

export interface WorkspaceIdentity { schema: 'evopilot-workspace/v1'; id: string; canonicalRoot: string; ownerUid: number }
export interface HistoricalBinding { workspace: WorkspaceIdentity; digest: string }
export interface RelocationRecord {
  schema: 'evopilot-workspace-relocation/v1'; product: string; from: WorkspaceIdentity; to: WorkspaceIdentity;
  nativeAuditDigest?: string; sourceSnapshotDigest: string; historyRevision: number; receiptsDigest: string; auditDigest: string;
  bindings: HistoricalBinding[]; previousDigest: string | null; hostDigest: string; keyId: string; at: string;
  recordDigest: string; signature: string;
}
export interface NativeSnapshotRecords { packages: Record<string,unknown>[]; receipts: Record<string,unknown>[]; audit: Record<string,unknown>[]; digest:string; auditDigest:string }
export interface SnapshotRecords { nativeRecords?: NativeSnapshotRecords; revision: number; state: unknown; stateDigest: string; receiptsDigest: string; auditDigest: string; recordsDigest: string; receiptCount: number }
export const hash = (value: unknown): string => 'sha256:' + createHash('sha256').update(stableSerialize(value)).digest('hex');
export function migrationFail(code: string, message: string): never { throw Object.assign(new Error(message), { code }); }
export function pathStat(path: string) { try { return lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
export function safeAncestors(path: string): void {
  if (!isAbsolute(path) || resolve(path) !== path || path === parse(path).root) migrationFail('UNSAFE_WORKSPACE', 'Canonical absolute path required');
  for (let cursor = path; ; cursor = dirname(cursor)) {
    const stat = pathStat(cursor);
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) migrationFail('UNSAFE_WORKSPACE', 'Regular directory ancestry required');
    if (pathStat(join(cursor, '.git'))) migrationFail('UNSAFE_WORKSPACE', 'Git data root forbidden');
    if (cursor === dirname(cursor)) break;
  }
}
export function privatePath(path: string, directory: boolean): void {
  const stat = pathStat(path), uid = process.getuid?.();
  if (uid === undefined || !stat || stat.isSymbolicLink() || stat.uid !== uid || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) || (stat.mode & 0o777) !== (directory ? 0o700 : 0o600)) migrationFail('UNSAFE_WORKSPACE', 'Owned private regular path required');
}
function syncDirectory(path: string): void { const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY); try { fsyncSync(fd); } finally { closeSync(fd); } }
function createPrivateFile(path: string, bytes: string | Buffer): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); } syncDirectory(dirname(path));
}
export function readIdentity(root: string, id: string): WorkspaceIdentity {
  safeAncestors(root); privatePath(root, true); const marker = join(root, 'workspace.json'); privatePath(marker, false);
  if (lstatSync(marker).size > 4096) migrationFail('IDENTITY_MISMATCH', 'Oversized identity');
  const value = JSON.parse(readFileSync(marker, 'utf8')) as WorkspaceIdentity;
  if (stableSerialize(Object.keys(value).sort()) !== stableSerialize(['canonicalRoot', 'id', 'ownerUid', 'schema']) || value.schema !== 'evopilot-workspace/v1' || value.id !== id || value.ownerUid !== process.getuid?.() || !isAbsolute(value.canonicalRoot) || resolve(value.canonicalRoot) !== value.canonicalRoot) migrationFail('IDENTITY_MISMATCH', 'Exact same-owner workspace identity required');
  return value;
}
export function writeRelocatedIdentity(root: string, identity: WorkspaceIdentity): void {
  if (identity.canonicalRoot !== root || identity.ownerUid !== process.getuid?.()) migrationFail('IDENTITY_MISMATCH', 'Relocation marker identity differs');
  const marker = join(root, 'workspace.json'), staging = root + '.evopilot-relocation';
  const bytes = Buffer.from(stableSerialize(identity));
  const name = hash(identity).slice(7) + '.pending', temporary = join(staging, name);
  // This protected sibling is outside the copied business inventory. Its only
  // permitted file is bound to the exact target identity, including path and uid.
  safeAncestors(staging);
  if (!pathStat(staging)) { mkdirSync(staging, { mode: 0o700 }); syncDirectory(dirname(staging)); }
  privatePath(staging, true);
  if (readdirSync(staging).some(entry => entry !== name)) migrationFail('RELOCATION_STAGING_CONFLICT', 'Foreign relocation staging content');
  if (pathStat(temporary)) {
    privatePath(temporary, false);
    if (lstatSync(temporary).size > bytes.length) migrationFail('RELOCATION_STAGING_CONFLICT', 'Relocation staging differs');
    const partial = readFileSync(temporary);
    if (!bytes.subarray(0, partial.length).equals(partial)) migrationFail('RELOCATION_STAGING_CONFLICT', 'Relocation staging differs');
    // A killed writer can leave an exact prefix, including zero bytes. Only this
    // proven operation-owned temporary is replaced; no user file is removed.
    if (partial.length !== bytes.length) { unlinkSync(temporary); syncDirectory(staging); }
  }
  if (!pathStat(temporary)) createPrivateFile(temporary, bytes);
  renameSync(temporary, marker); syncDirectory(root); syncDirectory(staging);
  rmdirSync(staging); syncDirectory(dirname(staging));
}
export function keyDirectory(): string { return join(homedir(), '.local', 'share', 'evopilot', 'relocation-keys'); }
function readKey(id: string): Buffer {
  if (!/^[a-f0-9]{64}$/.test(id)) migrationFail('INVALID_LINEAGE', 'Invalid relocation key identity');
  const directory = keyDirectory(); safeAncestors(directory);
  if (!pathStat(directory) || !pathStat(join(directory, id + '.key'))) migrationFail('MISSING_RELOCATION_KEY', 'Retained same-host relocation key required');
  privatePath(directory, true); const file = join(directory, id + '.key'); privatePath(file, false);
  const bytes = readFileSync(file); if (bytes.length !== 32) migrationFail('INVALID_LINEAGE', 'Invalid relocation key'); return bytes;
}
function newKey(): string {
  const directory = keyDirectory(); safeAncestors(directory);
  const missing: string[] = []; for (let path = directory; !pathStat(path); path = dirname(path)) missing.unshift(path);
  for (const path of missing) { mkdirSync(path, { mode: 0o700 }); syncDirectory(dirname(path)); }
  privatePath(directory, true); const id = randomBytes(32).toString('hex'); createPrivateFile(join(directory, id + '.key'), randomBytes(32)); return id;
}
// macOS may change gethostname() with the network while LocalHostName remains
// the configured machine name. Keep signed history and every key/scope check;
// recognize only the current system names, never a name supplied by a caller.
function hostDigests(): string[] {
  const names = [hostname()];
  if (platform() === 'darwin') {
    try {
      const local = execFileSync('/usr/sbin/scutil', ['--get', 'LocalHostName'], {
        encoding: 'utf8', timeout: 1000, maxBuffer: 1024, stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(local)) names.unshift(local + '.local');
    } catch { /* Without a verified system name, retain the exact current-host rule. */ }
  }
  return [...new Set(names)].map(name => hash({ hostname: name, home: homedir(), uid: process.getuid?.() }));
}
const hostDigest = (): string => hostDigests()[0]!;
function hasLineage(db: DatabaseSync): boolean { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_relocations'").get(); }
function prefix(db: DatabaseSync, revision: number) {
  const receipts = db.prepare('SELECT scope,request_id,digest,receipt FROM receipts WHERE CAST(json_extract(receipt,\'$.revision\') AS INTEGER)<=? ORDER BY scope,request_id').all(revision);
  const audit = db.prepare('SELECT revision,uid,operation,request_digest,result_digest FROM audit WHERE revision<=? ORDER BY revision').all(revision);
  const legacyReceipts=receipts.filter(r=>!String(JSON.parse(r.receipt as string).operation).startsWith('native.'));
  const nativeAudit=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='native_audit'").get()?db.prepare('SELECT revision,scope,request_id,receipt FROM native_audit WHERE revision<=? ORDER BY revision').all(revision):[];
  return { receiptsDigest: hash(legacyReceipts), auditDigest: hash(audit), ...(nativeAudit.length?{nativeAuditDigest:hash(nativeAudit)}:{}) };
}
export function readRelocations(db: DatabaseSync, identity: WorkspaceIdentity, product: string): RelocationRecord[] {
  if (!hasLineage(db)) return [];
  const rows = db.prepare('SELECT sequence,record FROM workspace_relocations ORDER BY sequence').all();
  if (rows.length > 64 || !rows.length) migrationFail('INVALID_LINEAGE', 'Bounded nonempty relocation history required');
  const records: RelocationRecord[] = [];
  for (const [index, row] of rows.entries()) {
    if (row.sequence !== index + 1 || typeof row.record !== 'string' || Buffer.byteLength(row.record) > 8388608) migrationFail('INVALID_LINEAGE', 'Invalid relocation row');
    const record = JSON.parse(row.record) as RelocationRecord;
    const { recordDigest, signature, ...subject } = record;
    if (record.schema !== 'evopilot-workspace-relocation/v1' || record.product !== product || recordDigest !== hash(subject) || !hostDigests().includes(record.hostDigest) || !Number.isSafeInteger(record.historyRevision) || record.historyRevision < 0 || !Array.isArray(record.bindings) || record.bindings.length > 20000 || !/^[a-f0-9]{64}$/.test(signature)) migrationFail('INVALID_LINEAGE', 'Relocation metadata differs');
    const expected = createHmac('sha256', readKey(record.keyId)).update(stableSerialize(subject)).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) migrationFail('INVALID_LINEAGE', 'Relocation attestation differs');
    for (const location of [record.from, record.to]) if (location.schema !== identity.schema || location.id !== identity.id || location.ownerUid !== identity.ownerUid || !isAbsolute(location.canonicalRoot) || resolve(location.canonicalRoot) !== location.canonicalRoot) migrationFail('INVALID_LINEAGE', 'Relocation scope differs');
    const previous = records.at(-1);
    if (record.previousDigest !== (previous?.recordDigest ?? null) || (previous && stableSerialize(record.from) !== stableSerialize(previous.to)) || stableSerialize(record.from) === stableSerialize(record.to)) migrationFail('INVALID_LINEAGE', 'Relocation chain differs');
    const saved = prefix(db, record.historyRevision);
    if (saved.receiptsDigest !== record.receiptsDigest || saved.auditDigest !== record.auditDigest || saved.nativeAuditDigest !== record.nativeAuditDigest) migrationFail('INVALID_LINEAGE', 'Historical receipts or audit changed');
    for (const binding of record.bindings) if (binding.workspace.id !== identity.id || binding.workspace.ownerUid !== identity.ownerUid || !/^sha256:[a-f0-9]{64}$/.test(binding.digest)) migrationFail('INVALID_LINEAGE', 'Historical binding differs');
    records.push(record);
  }
  if (stableSerialize(records.at(-1)!.to) !== stableSerialize(identity)) migrationFail('INVALID_LINEAGE', 'Relocation destination differs');
  return records;
}
export function acceptsWorkspace(db: DatabaseSync, identity: WorkspaceIdentity, product: string, historical: unknown, digest: string): boolean {
  if (stableSerialize(identity) === stableSerialize(historical)) return true;
  return readRelocations(db, identity, product).some(record => record.bindings.some(binding => stableSerialize(binding.workspace) === stableSerialize(historical) && binding.digest === digest));
}
export function inspectRecords(db: DatabaseSync, validateState: (value: unknown) => unknown): SnapshotRecords {
  if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' || ![1,2].includes(db.prepare('PRAGMA user_version').get()?.user_version as number)) migrationFail('CORRUPT_STATE', 'Invalid owner database');
  const row = db.prepare('SELECT revision,data FROM state WHERE singleton=1').get();
  if (!row || typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 0 || typeof row.data !== 'string' || Buffer.byteLength(row.data) > 8388608) migrationFail('CORRUPT_STATE', 'Invalid owner state');
  const state = validateState(JSON.parse(row.data));
  const allReceipts = db.prepare('SELECT scope,request_id,digest,receipt FROM receipts ORDER BY scope,request_id').all();
  const receipts=allReceipts.filter(r=>!String(JSON.parse(r.receipt as string).operation).startsWith('native.'));
  const audit = db.prepare('SELECT revision,uid,operation,request_digest,result_digest FROM audit ORDER BY revision').all();
  if (receipts.length > 10000 || audit.length !== row.revision) migrationFail('CORRUPT_STATE', 'Incomplete owner history');
  const revisions = new Set<number>();
  for (const saved of receipts) {
    if (typeof saved.receipt !== 'string' || Buffer.byteLength(saved.receipt) > 1048576) migrationFail('CORRUPT_STATE', 'Invalid retained receipt');
    const receipt = JSON.parse(saved.receipt) as Record<string, unknown>;
    if (typeof receipt.revision !== 'number' || revisions.has(receipt.revision) || receipt.scope === undefined || receipt.result === undefined) migrationFail('CORRUPT_STATE', 'Invalid receipt identity');
    revisions.add(receipt.revision);
    const entry = audit[receipt.revision - 1];
    if (!entry || entry.revision !== receipt.revision || saved.scope !== stableSerialize(receipt.scope) || saved.request_id !== receipt.requestId || saved.digest !== receipt.requestDigest || entry.uid !== receipt.uid || entry.operation !== receipt.operation || entry.request_digest !== receipt.requestDigest || entry.result_digest !== hash(receipt.result)) migrationFail('CORRUPT_STATE', 'Receipt audit binding differs');
  }
  let nativeRecords:NativeSnapshotRecords|undefined;
  if(db.prepare('PRAGMA user_version').get()?.user_version===2){
    const packages=db.prepare('SELECT scope,id,version,data,digest FROM native_packages ORDER BY scope,id,version').all();
    const nativeReceipts=allReceipts.filter(r=>String(JSON.parse(r.receipt as string).operation).startsWith('native.'));
    const nativeAudit=db.prepare('SELECT revision,scope,request_id,receipt FROM native_audit ORDER BY revision').all();
    if(packages.length>10000||nativeAudit.length>20000) migrationFail('CORRUPT_STATE','Unbounded native history');
    const latest=new Map<string,Record<string,unknown>>();
    for(const event of nativeAudit){
      if(typeof event.receipt!=='string'||Buffer.byteLength(event.receipt)>16777216)migrationFail('CORRUPT_STATE','Invalid native event');
      const r=JSON.parse(event.receipt) as Record<string,unknown>,key=String(event.scope)+':'+String(event.request_id),prior=latest.get(key),entry=audit[Number(r.revision)-1];
      if(typeof r.revision!=='number'||r.revision!==event.revision||revisions.has(r.revision)||event.scope!==stableSerialize(r.scope)||event.request_id!==r.requestId||!entry||entry.revision!==r.revision||entry.uid!==r.uid||entry.operation!==r.operation||entry.request_digest!==r.requestDigest||entry.result_digest!==hash(r.result))migrationFail('CORRUPT_STATE','Native event identity/audit differs');
      if(prior&&(r.operation!=='native.package.validate'||(prior.result as Record<string,unknown>).status!=='RUNNING'||(r.result as Record<string,unknown>).status==='RUNNING'||prior.requestDigest!==r.requestDigest||prior.operation!==r.operation))migrationFail('CORRUPT_STATE','Invalid native terminal transition');
      revisions.add(r.revision);latest.set(key,r);
    }
    if(latest.size!==nativeReceipts.length)migrationFail('CORRUPT_STATE','Incomplete native receipts');
    for(const saved of nativeReceipts){const r=latest.get(String(saved.scope)+':'+String(saved.request_id));if(!r||saved.receipt!==stableSerialize(r)||saved.digest!==r.requestDigest)migrationFail('CORRUPT_STATE','Native retained receipt differs');}
    nativeRecords={packages,receipts:nativeReceipts,audit:nativeAudit,digest:hash({packages,receipts:nativeReceipts,audit:nativeAudit}),auditDigest:hash(nativeAudit)};
  }
  if(revisions.size!==row.revision||audit.some((entry,index)=>entry.revision!==index+1||!revisions.has(index+1)))migrationFail('CORRUPT_STATE','Incomplete global revision history');
  const stateDigest = hash({ revision: row.revision, data: row.data }), receiptsDigest = hash(receipts), auditDigest = hash(audit);
  return { revision: row.revision, state, stateDigest, receiptsDigest, auditDigest, recordsDigest: hash({ stateDigest, receiptsDigest, auditDigest,...(nativeRecords?{nativeRecordsDigest:nativeRecords.digest}:{}) }), receiptCount: allReceipts.length,...(nativeRecords?{nativeRecords}:{}) };
}
export function collectBindings(state: unknown): HistoricalBinding[] {
  const value = state as Record<string, unknown>, bindings = new Map<string, HistoricalBinding>();
  const add = (workspace: unknown, digest: unknown) => {
    if (!workspace || typeof workspace !== 'object' || typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(digest)) migrationFail('CORRUPT_STATE', 'Invalid historical owner binding');
    const binding = { workspace: workspace as WorkspaceIdentity, digest }; bindings.set(stableSerialize(binding), binding);
  };
  for (const run of (value.runs ?? []) as { plan: { workspace: unknown }; reviewDigest: string }[]) add(run.plan.workspace, run.reviewDigest);
  for (const asset of (value.assets ?? []) as { review?: { workspace: unknown; reviewDigest: string } | null }[]) if (asset.review) add(asset.review.workspace, asset.review.reviewDigest);
  for (const key of ['producerPlans', 'catalogPlans']) for (const plan of (value[key] ?? []) as { workspace: unknown; reviewDigest: string }[]) add(plan.workspace, plan.reviewDigest);
  for (const revision of (value.catalogRevisions ?? []) as { workspace: unknown; pointer: { workspace: unknown; pointerDigest: string } }[]) { add(revision.workspace, revision.pointer.pointerDigest); add(revision.pointer.workspace, revision.pointer.pointerDigest); }
  return [...bindings.values()].sort((a, b) => stableSerialize(a).localeCompare(stableSerialize(b)));
}
export function appendRelocation(db: DatabaseSync, product: string, from: WorkspaceIdentity, to: WorkspaceIdentity, snapshotDigest: string, records: SnapshotRecords): RelocationRecord {
  const previous = readRelocations(db, from, product).at(-1);
  const keyId = previous?.keyId ?? newKey();
  const subject = { schema: 'evopilot-workspace-relocation/v1' as const, product, from, to, sourceSnapshotDigest: snapshotDigest, historyRevision: records.revision, receiptsDigest: records.receiptsDigest, auditDigest: records.auditDigest, ...(records.nativeRecords?.audit.length?{nativeAuditDigest:records.nativeRecords.auditDigest}:{}), bindings: collectBindings(records.state), previousDigest: previous?.recordDigest ?? null, hostDigest: hostDigest(), keyId, at: new Date().toISOString() };
  const record = { ...subject, recordDigest: hash(subject), signature: createHmac('sha256', readKey(keyId)).update(stableSerialize(subject)).digest('hex') };
  db.exec('CREATE TABLE IF NOT EXISTS workspace_relocations (sequence INTEGER PRIMARY KEY, record TEXT NOT NULL)');
  db.prepare('INSERT INTO workspace_relocations(record) VALUES(?)').run(stableSerialize(record)); return record;
}
export interface BlobInventory { path: string; bytes: number; digest: string }
export function inspectBlobs(root: string, product: string): BlobInventory[] {
  const files: BlobInventory[] = [];
  const visit = (path: string) => {
    privatePath(path, true);
    for (const name of readdirSync(path).sort()) {
      const file = join(path, name), stat = lstatSync(file);
      if (stat.isDirectory()) { visit(file); continue; }
      privatePath(file, false);
      if (stat.size > 8388608 || !/^[a-f0-9]{64}\.(?:json|raw)$/.test(name)) migrationFail('CORRUPT_BLOB', 'Invalid owner content-addressed blob');
      const bytes = readFileSync(file), digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
      if (name.slice(0, 64) !== digest.slice(7)) migrationFail('CORRUPT_BLOB', 'Owner blob digest differs');
      files.push({ path: file.slice(root.length + 1), bytes: bytes.length, digest });
    }
  };
  const publicRoot = join(root, 'public', product); if (pathStat(publicRoot)) { privatePath(join(root, 'public'), true); visit(publicRoot); }
  const projects = join(root, 'private', 'projects');
  if (pathStat(projects)) {
    privatePath(join(root, 'private'), true); privatePath(projects, true);
    for (const id of readdirSync(projects).sort()) { const project = join(projects, id); privatePath(project, true); const owner = join(project, product); if (pathStat(owner)) visit(owner); }
  }
  return files;
}
