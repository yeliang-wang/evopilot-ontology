import { nativeAssertJSON, nativeExact, nativeSha256, nativeStableSerialize, nativeFrozenClone, nativeText, nativeDigest, validateNativeReference } from '../../v1/native.mjs';
export function inspectFeedbackSnapshot(db) {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE name='feedback_identity'").get())
        return null;
    const identity = db.prepare('SELECT * FROM feedback_identity WHERE singleton=1').get();
    if (identity?.schema !== 'evopilot-feedback-store/v1' || !['runtime', 'harness', 'ontology'].includes(String(identity.owner)) || typeof identity.revision !== 'number' || identity.revision < 0 || identity.revision > 10000)
        feedbackFail('FEEDBACK_STATE');
    const records = db.prepare('SELECT * FROM feedback_records ORDER BY scope,kind,id').all(), receipts = db.prepare('SELECT * FROM feedback_receipts ORDER BY scope,id').all(), audit = db.prepare('SELECT * FROM feedback_audit ORDER BY revision').all();
    if (records.length > 6000 || receipts.length > 10000 || audit.length !== identity.revision || audit.some((a, i) => a.revision !== i + 1))
        feedbackFail('FEEDBACK_STATE');
    for (const row of [...records, ...receipts]) {
        if (typeof row.data !== 'string' || Buffer.byteLength(row.data) > 4 * 1024 * 1024 || row.digest !== nativeSha256(JSON.parse(row.data)))
            feedbackFail('FEEDBACK_STATE');
    }
    for (const row of receipts) {
        const r = JSON.parse(String(row.data)), a = audit[r.revision - 1];
        if (!a || a.request_digest !== row.intent || a.result_digest !== nativeSha256(r.result) || r.requestId !== row.id)
            feedbackFail('FEEDBACK_STATE');
    }
    return { schema: 'evopilot-feedback-snapshot/v1', owner: String(identity.owner), revision: identity.revision, recordsDigest: nativeSha256({ identity, records, receipts, audit }), recordCount: records.length, receiptCount: receipts.length };
}
/** A timeout leaves delivery uncertain; callers reconcile retained owner receipts. */
export const FEEDBACK_PROVIDER_TIMEOUT_MS = 5000;
export async function feedbackBounded(call, timeoutMs = FEEDBACK_PROVIDER_TIMEOUT_MS) {
    let timer;
    try {
        return await Promise.race([Promise.resolve().then(call), new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Feedback provider response timed out; inspect retained receipt'), { code: 'FEEDBACK_TIMEOUT' })), timeoutMs); })]);
    }
    finally {
        clearTimeout(timer);
    }
}
export const feedbackEqual = (a, b) => nativeStableSerialize(a) === nativeStableSerialize(b);
export function feedbackFail(code, message = code) { throw Object.assign(new Error(message), { code }); }
export function feedbackScope(scope) {
    nativeExact(scope, ['visibility', 'projectId']);
    nativeText(scope.projectId);
    if (!['public', 'private'].includes(scope.visibility) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(scope.projectId))
        feedbackFail('SCOPE_MISMATCH');
}
export function validateFeedbackEvent(value) {
    nativeAssertJSON(value);
    nativeExact(value, ['schema', 'id', 'workspaceId', 'scope', 'projectId', 'projectCandidateDigest', 'source', 'runId', 'runReviewDigest', 'claimId', 'inputDigest', 'receiptDigest', 'causeId', 'origin', 'stage', 'pins', 'results', 'collectionRefs', 'observation', 'digest']);
    if (value.schema !== 'evopilot-feedback-event/v1' || value.origin !== 'registered-runtime-run' || !['SUCCEEDED', 'FAILED'].includes(value.stage))
        feedbackFail('INVALID_FEEDBACK');
    feedbackScope(value.scope);
    for (const k of ['workspaceId', 'projectId', 'runId'])
        nativeText(value[k]);
    for (const k of ['id', 'projectCandidateDigest', 'runReviewDigest', 'claimId', 'inputDigest', 'receiptDigest', 'causeId', 'digest'])
        nativeDigest(value[k]);
    nativeExact(value.source, ['direction', 'locator', 'revision', 'treeDigest', 'inventoryDigest', 'requirementsDigest']);
    nativeText(value.source.locator);
    nativeText(value.source.revision);
    if (!['forward', 'reverse'].includes(value.source.direction))
        feedbackFail('INVALID_FEEDBACK');
    for (const k of ['treeDigest', 'inventoryDigest', 'requirementsDigest'])
        nativeDigest(value.source[k]);
    nativeExact(value.pins, ['ontology', 'harness']);
    nativeExact(value.results, ['ontology', 'harness']);
    for (const owner of ['ontology', 'harness'])
        validateNativeReference(value.pins[owner], { product: owner, visibility: value.scope.visibility });
    if (!Array.isArray(value.collectionRefs) || value.collectionRefs.length > 2000)
        feedbackFail('INVALID_FEEDBACK');
    for (const ref of value.collectionRefs) {
        nativeExact(ref, ['id', 'digest']);
        nativeText(ref.id);
        nativeDigest(ref.digest);
    }
    const digest = value.digest, subject = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest'));
    if (digest !== nativeSha256(subject) || value.id !== nativeSha256({ workspaceId: value.workspaceId, scope: value.scope, claimId: value.claimId }) || value.causeId !== value.claimId)
        feedbackFail('FEEDBACK_INTEGRITY');
}
export function validateFeedbackReceipt(r, event, owner) {
    nativeExact(r, ['eventId', 'eventDigest', 'owner', 'workspaceId', 'scope', 'candidateId', 'digest']);
    const { digest, ...body } = r;
    if (r.eventId !== event.id || r.eventDigest !== event.digest || r.owner !== owner || r.workspaceId !== event.workspaceId || !feedbackEqual(r.scope, event.scope) || r.candidateId !== event.id + ':' + owner || digest !== nativeSha256(body))
        feedbackFail('FEEDBACK_RECEIPT_MISMATCH');
}
/** Owner-local tables share the owner's SQLite transaction, never a second file. */
export function createFeedbackStore(store, owner) {
    const db = store.db;
    function exists() { return !!db.prepare("SELECT name FROM sqlite_master WHERE name='feedback_identity'").get(); }
    function setup() {
        db.exec('CREATE TABLE IF NOT EXISTS feedback_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),schema TEXT NOT NULL,owner TEXT NOT NULL,revision INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS feedback_records(scope TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(scope,kind,id)); CREATE TABLE IF NOT EXISTS feedback_receipts(scope TEXT NOT NULL,id TEXT NOT NULL,intent TEXT NOT NULL,data TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(scope,id)); CREATE TABLE IF NOT EXISTS feedback_audit(revision INTEGER PRIMARY KEY,request_digest TEXT NOT NULL,result_digest TEXT NOT NULL);');
        if (!db.prepare('SELECT owner FROM feedback_identity WHERE singleton=1').get())
            db.prepare('INSERT INTO feedback_identity VALUES(1,?,?,0)').run('evopilot-feedback-store/v1', owner);
        db.exec('PRAGMA user_version=3');
    }
    function check() {
        store.guard();
        if (!exists())
            return 0;
        const id = db.prepare('SELECT * FROM feedback_identity WHERE singleton=1').get();
        if (id?.schema !== 'evopilot-feedback-store/v1' || id.owner !== owner || typeof id.revision !== 'number' || !Number.isSafeInteger(id.revision) || id.revision < 0 || id.revision > 10000)
            feedbackFail('FEEDBACK_STATE');
        const audit = db.prepare('SELECT * FROM feedback_audit ORDER BY revision').all();
        if (audit.length !== id.revision || audit.some((row, i) => row.revision !== i + 1))
            feedbackFail('FEEDBACK_STATE');
        return id.revision;
    }
    function get(scope, kind, id) {
        check();
        feedbackScope(scope);
        if (!exists())
            return null;
        const r = db.prepare('SELECT data,digest FROM feedback_records WHERE scope=? AND kind=? AND id=?').get(nativeStableSerialize(scope), kind, id);
        if (!r)
            return null;
        if (typeof r.data !== 'string' || r.digest !== nativeSha256(JSON.parse(r.data)))
            feedbackFail('FEEDBACK_STATE');
        // Fresh transaction-local data; mutations only persist through put inside a transaction.
        return JSON.parse(r.data);
    }
    function list(scope, kind) { check(); feedbackScope(scope); if (!exists())
        return []; return db.prepare('SELECT id FROM feedback_records WHERE scope=? AND kind=? ORDER BY id').all(nativeStableSerialize(scope), kind).map(row => get(scope, kind, String(row.id))); }
    function put(scope, kind, id, value) {
        // Caller must be in a transaction: outbox insertion is atomic with the Run receipt.
        if (!db.isTransaction)
            feedbackFail('FEEDBACK_TRANSACTION_REQUIRED');
        nativeAssertJSON(value);
        const data = nativeStableSerialize(value);
        if (Buffer.byteLength(data) > 4 * 1024 * 1024)
            feedbackFail('LIMIT');
        setup();
        if (Number(db.prepare('SELECT COUNT(*) AS n FROM feedback_records').get().n) >= 6000 && !db.prepare('SELECT 1 FROM feedback_records WHERE scope=? AND kind=? AND id=?').get(nativeStableSerialize(scope), kind, id))
            feedbackFail('LIMIT');
        db.prepare('INSERT INTO feedback_records VALUES(?,?,?,?,?) ON CONFLICT(scope,kind,id) DO UPDATE SET data=excluded.data,digest=excluded.digest').run(nativeStableSerialize(scope), kind, id, data, nativeSha256(value));
    }
    function mutate(request, fn) {
        nativeAssertJSON(request);
        nativeExact(request, ['operation', 'scope', 'input', 'requestId', 'expectedRevision']);
        feedbackScope(request.scope);
        nativeText(request.requestId);
        if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0)
            feedbackFail('INVALID_REQUEST');
        const intent = nativeSha256({ operation: request.operation, scope: request.scope, input: request.input });
        db.exec('BEGIN IMMEDIATE');
        try {
            const revision = check();
            setup();
            const old = db.prepare('SELECT intent,data,digest FROM feedback_receipts WHERE scope=? AND id=?').get(nativeStableSerialize(request.scope), request.requestId);
            if (old) {
                if (old.intent !== intent)
                    feedbackFail('REQUEST_CONFLICT');
                const receipt = JSON.parse(String(old.data));
                if (nativeSha256(receipt) !== old.digest)
                    feedbackFail('FEEDBACK_STATE');
                db.exec('COMMIT');
                return receipt;
            }
            if (revision !== request.expectedRevision)
                feedbackFail('REVISION_CONFLICT');
            if (revision >= 10000)
                feedbackFail('LIMIT');
            const result = fn();
            const subject = { revision: revision + 1, result, requestId: request.requestId };
            const receipt = { ...subject, digest: nativeSha256(subject) };
            db.prepare('UPDATE feedback_identity SET revision=? WHERE singleton=1').run(revision + 1);
            db.prepare('INSERT INTO feedback_audit VALUES(?,?,?)').run(revision + 1, intent, nativeSha256(result));
            db.prepare('INSERT INTO feedback_receipts VALUES(?,?,?,?,?)').run(nativeStableSerialize(request.scope), request.requestId, intent, nativeStableSerialize(receipt), nativeSha256(receipt));
            db.exec('COMMIT');
            return nativeFrozenClone(receipt);
        }
        catch (e) {
            db.exec('ROLLBACK');
            throw e;
        }
    }
    function inspect(scope) { return { owner, workspaceId: store.identity.id, scope, revision: check(), authority: false }; }
    function receipt(scope, id) {
        check();
        if (!exists())
            return null;
        const row = db.prepare('SELECT data,digest FROM feedback_receipts WHERE scope=? AND id=?').get(nativeStableSerialize(scope), id);
        if (!row)
            return null;
        const value = JSON.parse(String(row.data));
        if (nativeSha256(value) !== row.digest)
            feedbackFail('FEEDBACK_STATE');
        return nativeFrozenClone(value);
    }
    function recordTransition(intent, result) {
        if (!db.isTransaction)
            feedbackFail('FEEDBACK_TRANSACTION_REQUIRED');
        const revision = check();
        if (revision >= 10000)
            feedbackFail('LIMIT');
        setup();
        db.prepare('UPDATE feedback_identity SET revision=? WHERE singleton=1').run(revision + 1);
        db.prepare('INSERT INTO feedback_audit VALUES(?,?,?)').run(revision + 1, nativeSha256(intent), nativeSha256(result));
    }
    return { get, list, put, mutate, inspect, receipt, recordTransition };
}
