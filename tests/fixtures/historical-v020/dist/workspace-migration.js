/** Public owner API. Call only with all workspace services quiescent. */
import { DatabaseSync } from 'node:sqlite';
import { join, sep } from 'node:path';
import { stableSerialize } from '../vendor/compatibility/v1/reference.mjs';
import { openState, validateState } from './state.js';
import { hash, migrationFail, pathStat, privatePath, readIdentity, safeAncestors, readRelocations, inspectRecords, inspectBlobs, collectBindings, appendRelocation, writeRelocatedIdentity } from './location-lineage.js';
const product = 'ontology';
function options(value) {
    if (!value || stableSerialize(Object.keys(value).sort()) !== stableSerialize(['workspaceId', 'workspaceRoot']) || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.workspaceId))
        migrationFail('INVALID_REQUEST', 'Exact workspace options required');
    const identity = readIdentity(value.workspaceRoot, value.workspaceId);
    if (identity.canonicalRoot !== value.workspaceRoot)
        migrationFail('IDENTITY_MISMATCH', 'Existing canonical workspace required');
    databasePath(value.workspaceRoot);
}
function databasePath(root) {
    safeAncestors(root);
    privatePath(root, true);
    privatePath(join(root, 'state'), true);
    privatePath(join(root, 'state', product), true);
    const path = join(root, 'state', product, product + '.db');
    privatePath(path, false);
    for (const suffix of ['-wal', '-shm', '-journal'])
        if (pathStat(path + suffix))
            privatePath(path + suffix, false);
    return path;
}
function unresolved(state) {
    const value = state, output = [];
    for (const raw of (value.runs ?? [])) {
        if (['RUNNING', 'UNKNOWN'].includes(raw.stage))
            output.push({ kind: 'runtime-run', id: String(raw.id), status: String(raw.stage), nextAction: 'RECONCILE_OR_CANCEL' });
        else if (['PREPARED', 'APPROVED'].includes(raw.stage))
            output.push({ kind: 'runtime-run', id: String(raw.id), status: String(raw.stage), nextAction: 'REPREPARE_AND_REVIEW' });
    }
    for (const raw of (value.classificationSessions ?? []))
        if (['PENDING', 'UNKNOWN'].includes(raw.status))
            output.push({ kind: 'classification', id: String(raw.id), status: String(raw.status), nextAction: 'RECONCILE_OR_CANCEL' });
    for (const key of ['producerPlans', 'catalogPlans'])
        for (const raw of (value[key] ?? []))
            if (raw.status === 'PREPARED')
                output.push({ kind: key, id: String(raw.planId), status: 'PREPARED', nextAction: 'REPREPARE_AND_REVIEW' });
    return output;
}
function verifyOwnerMaterials(state, blobs) {
    const value = state;
    const requireBlob = (scope, document, digest = hash(document), raw = false) => {
        const prefix = scope.visibility === 'public' ? 'public/' + product : 'private/projects/' + scope.projectId + '/' + product;
        if (!blobs.some(blob => blob.path === prefix + (raw ? '/sources/' : '/') + digest.slice(7) + (raw ? '.raw' : '.json') && blob.digest === digest))
            migrationFail('CORRUPT_BLOB', 'Referenced owner material is missing');
        if (!raw && digest !== hash(document))
            migrationFail('CORRUPT_BLOB', 'Referenced owner material differs');
    };
    for (const asset of (value.assets ?? [])) {
        requireBlob(asset.scope, asset.model, asset.digest);
        if (asset.delivery)
            requireBlob(asset.scope, asset.delivery);
        if (asset.review) {
            const { reviewDigest, ...subject } = asset.review;
            if (reviewDigest !== hash(subject))
                migrationFail('CORRUPT_STATE', 'Asset review differs');
        }
    }
    for (const source of (value.sources ?? []))
        requireBlob(source.scope, null, source.rawDigest, true);
    for (const key of ['producerPlans', 'catalogPlans'])
        for (const plan of (value[key] ?? [])) {
            requireBlob(plan.scope, plan);
            const fields = key === 'producerPlans' ? ['workspace', 'scope', 'operation', 'parameters', 'dependencies'] : ['workspace', 'scope', 'parameters', 'dependencies', 'inputDigest', 'expectedGenerationDigest', 'transitionDigest'];
            if (plan.reviewDigest !== hash(Object.fromEntries(fields.map(field => [field, plan[field]]))))
                migrationFail('CORRUPT_STATE', 'Owned plan review differs');
        }
    for (const revision of (value.catalogRevisions ?? [])) {
        requireBlob(revision.scope, revision);
        const { pointerDigest, ...subject } = revision.pointer;
        if (pointerDigest !== hash(subject))
            migrationFail('CORRUPT_STATE', 'Catalog pointer differs');
    }
}
function snapshot(db, identity, root) {
    const records = inspectRecords(db, value => validateState(value));
    const lineage = readRelocations(db, identity, product), blobs = inspectBlobs(root, product);
    for (const binding of collectBindings(records.state)) {
        if (stableSerialize(binding.workspace) !== stableSerialize(identity) && !lineage.some(record => record.bindings.some(retained => stableSerialize(retained) === stableSerialize(binding))))
            migrationFail('CORRUPT_STATE', 'Unattested historical owner identity');
    }
    verifyOwnerMaterials(records.state, blobs);
    const subject = { schema: 'evopilot-owner-workspace-snapshot/v1', product, identity, revision: records.revision, stateDigest: records.stateDigest, receiptsDigest: records.receiptsDigest, auditDigest: records.auditDigest, recordsDigest: records.recordsDigest, receiptCount: records.receiptCount, blobs, blobsDigest: hash(blobs), lineageDigest: hash(lineage), requiredKeyIds: [...new Set(lineage.map(record => record.keyId))].sort(), unresolved: unresolved(records.state) };
    return { manifest: { ...subject, snapshotDigest: hash(subject) }, records };
}
export function inspectWorkspaceSnapshot(value) {
    options(value);
    const store = openState(value.workspaceRoot, value.workspaceId);
    try {
        store.guard();
        store.db.exec('BEGIN IMMEDIATE');
        try {
            const result = snapshot(store.db, store.identity, value.workspaceRoot).manifest;
            store.db.exec('COMMIT');
            return result;
        }
        catch (error) {
            store.db.exec('ROLLBACK');
            throw error;
        }
    }
    finally {
        store.db.close();
    }
}
export function relocateWorkspaceSnapshot(value) {
    if (!value || stableSerialize(Object.keys(value).sort()) !== stableSerialize(['destinationRoot', 'expectedSnapshotDigest', 'sourceRoot', 'workspaceId']) || !/^sha256:[a-f0-9]{64}$/.test(value.expectedSnapshotDigest))
        migrationFail('INVALID_REQUEST', 'Exact relocation options required');
    const { sourceRoot, destinationRoot, workspaceId } = value;
    if (sourceRoot === destinationRoot || sourceRoot.startsWith(destinationRoot + sep) || destinationRoot.startsWith(sourceRoot + sep))
        migrationFail('UNSAFE_WORKSPACE', 'Separate relocation roots required');
    options({ workspaceRoot: sourceRoot, workspaceId });
    safeAncestors(destinationRoot);
    const source = openState(sourceRoot, workspaceId);
    let target, sourceTransaction = false, targetTransaction = false;
    try {
        source.guard();
        source.db.exec('BEGIN IMMEDIATE');
        sourceTransaction = true;
        const original = snapshot(source.db, source.identity, sourceRoot);
        if (original.manifest.snapshotDigest !== value.expectedSnapshotDigest)
            migrationFail('SNAPSHOT_DRIFT', 'Source changed after snapshot');
        const from = original.manifest.identity, to = { ...from, canonicalRoot: destinationRoot };
        const marker = readIdentity(destinationRoot, workspaceId);
        if (stableSerialize(marker) !== stableSerialize(from) && stableSerialize(marker) !== stableSerialize(to))
            migrationFail('IDENTITY_MISMATCH', 'Copied identity differs');
        target = new DatabaseSync(databasePath(destinationRoot), { timeout: 1000, allowExtension: false });
        target.enableDefensive(true);
        target.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
        targetTransaction = true;
        let previous = [];
        try {
            previous = readRelocations(target, to, product);
        }
        catch (error) {
            if (error.code !== 'INVALID_LINEAGE')
                throw error;
        }
        const completed = previous.at(-1);
        if (completed?.sourceSnapshotDigest === value.expectedSnapshotDigest && stableSerialize(completed.from) === stableSerialize(from) && stableSerialize(completed.to) === stableSerialize(to)) {
            const restored = snapshot(target, to, destinationRoot).manifest;
            if (restored.recordsDigest !== original.manifest.recordsDigest || restored.blobsDigest !== original.manifest.blobsDigest)
                migrationFail('SNAPSHOT_DRIFT', 'Relocated state changed; do not retry against stale source');
            target.exec('COMMIT');
            targetTransaction = false;
            writeRelocatedIdentity(destinationRoot, to);
            source.db.exec('COMMIT');
            sourceTransaction = false;
            return { schema: 'evopilot-owner-workspace-relocation-result/v1', product, from, to, sourceSnapshotDigest: value.expectedSnapshotDigest, relocationDigest: completed.recordDigest, requiredKeyIds: restored.requiredKeyIds, snapshot: restored, authority: false };
        }
        const copied = snapshot(target, from, destinationRoot);
        if (copied.manifest.snapshotDigest !== original.manifest.snapshotDigest)
            migrationFail('SNAPSHOT_DRIFT', 'Copied owner data differs');
        const record = appendRelocation(target, product, from, to, value.expectedSnapshotDigest, copied.records);
        const restored = snapshot(target, to, destinationRoot).manifest;
        target.exec('COMMIT');
        targetTransaction = false;
        writeRelocatedIdentity(destinationRoot, to);
        source.db.exec('COMMIT');
        sourceTransaction = false;
        return { schema: 'evopilot-owner-workspace-relocation-result/v1', product, from, to, sourceSnapshotDigest: value.expectedSnapshotDigest, relocationDigest: record.recordDigest, requiredKeyIds: restored.requiredKeyIds, snapshot: restored, authority: false };
    }
    finally {
        if (targetTransaction)
            target.exec('ROLLBACK');
        if (sourceTransaction)
            source.db.exec('ROLLBACK');
        target?.close();
        source.db.close();
    }
}
