import { buildReadDocument, renderReadDocument, valueText } from './presentation.mjs';
import { createHash } from 'node:crypto';
export function readFail(code) { throw Object.assign(new Error(code), { code }); }
export function readStable(value) {
    const ancestors = new Set();
    let visited = 0;
    function serialize(value, depth = 0) {
        if (depth > 64 || ++visited > 2000000)
            readFail('READABLE_LIMIT');
        if (value && typeof value === 'object') {
            if (ancestors.has(value))
                readFail('READABLE_INVALID_JSON');
            ancestors.add(value);
        }
        try {
            return encode(value, depth);
        }
        finally {
            if (value && typeof value === 'object')
                ancestors.delete(value);
        }
    }
    function encode(value, depth) {
        if (value === null || typeof value === 'boolean' || typeof value === 'string')
            return JSON.stringify(value);
        if (typeof value === 'number' && Number.isFinite(value))
            return JSON.stringify(value);
        if (Array.isArray(value))
            return '[' + value.map(v => serialize(v, depth + 1)).join(',') + ']';
        if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null))
            return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + serialize(value[k], depth + 1)).join(',') + '}';
        return readFail('READABLE_INVALID_JSON');
    }
    return serialize(value);
}
export const readDigest = (value) => 'sha256:' + createHash('sha256').update(readStable(value)).digest('hex');
export function readSnapshot(body) {
    if (body.rows.length > 20000 || new Set(body.rows.map(r => r.id)).size !== body.rows.length)
        readFail('READABLE_LIMIT');
    const value = { schema: 'evopilot-readable-snapshot/v1', ...body, authority: false };
    const bytes = readStable(value);
    if (Buffer.byteLength(bytes) > 33554432)
        readFail('READABLE_LIMIT');
    return JSON.parse(readStable({ ...value, digest: readDigest(value) }));
}
export function verifyReadSnapshot(snapshot) {
    const { digest, ...body } = snapshot;
    if (snapshot.schema !== 'evopilot-readable-snapshot/v1' || snapshot.authority !== false || digest !== readDigest(body))
        readFail('READABLE_SNAPSHOT_DRIFT');
}
export function queryReadSnapshot(snapshot, query = {}) {
    verifyReadSnapshot(snapshot);
    if (Object.keys(query).some(k => !['limit', 'cursor', 'search', 'kind', 'verdict', 'expectedDigest'].includes(k)))
        readFail('READABLE_QUERY');
    if (query.expectedDigest !== undefined && query.expectedDigest !== snapshot.digest)
        readFail('READABLE_SNAPSHOT_DRIFT');
    const limit = query.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
        readFail('READABLE_QUERY');
    for (const v of [query.search, query.kind, query.verdict])
        if (v !== undefined && (typeof v !== 'string' || v.length > 256))
            readFail('READABLE_QUERY');
    const filter = { search: query.search ?? '', kind: query.kind ?? '', verdict: query.verdict ?? '' }, filterDigest = readDigest(filter);
    const rows = snapshot.rows.filter(r => (!filter.kind || r.kind === filter.kind) && (!filter.verdict || r.verdict === filter.verdict) && (!filter.search || (r.id + ' ' + r.label).toLowerCase().includes(filter.search.toLowerCase())));
    let offset = 0;
    if (query.cursor !== undefined) {
        if (typeof query.cursor !== 'string' || query.cursor.length > 1024)
            readFail('READABLE_QUERY');
        let cursor;
        try {
            cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
        }
        catch {
            return readFail('READABLE_QUERY');
        }
        if (cursor.snapshot !== snapshot.digest || cursor.filter !== filterDigest)
            readFail('READABLE_SNAPSHOT_DRIFT');
        if (!Number.isSafeInteger(cursor.offset) || Number(cursor.offset) < 0 || Number(cursor.offset) > rows.length)
            readFail('READABLE_QUERY');
        offset = Number(cursor.offset);
    }
    const page = rows.slice(offset, offset + limit), end = offset + page.length;
    const document = buildReadDocument({ ...snapshot, rows: page });
    document.summary = '分页视图：显示 ' + page.length + ' / 匹配 ' + rows.length + ' / 全部 ' + snapshot.rows.length + ' 条；偏移 ' + offset + '。下述状态统计只包含当前页，固定验收总数不变。' + document.summary;
    const markdown = renderReadDocument(document, 'markdown');
    return { markdown, snapshotDigest: snapshot.digest, subject: snapshot.subject, pins: snapshot.pins, denominator: snapshot.denominator, total: snapshot.rows.length, matching: rows.length, offset, rows: page, nextCursor: end < rows.length ? Buffer.from(JSON.stringify({ snapshot: snapshot.digest, filter: filterDigest, offset: end })).toString('base64url') : null, authority: false };
}
export function compareReadSnapshots(before, after, query = {}) {
    verifyReadSnapshot(before);
    verifyReadSnapshot(after);
    if (before.owner !== after.owner || before.workspaceId !== after.workspaceId || readStable(before.scope) !== readStable(after.scope) || before.subject.id !== after.subject.id)
        readFail('READABLE_COMPARISON_SCOPE');
    if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).some(k => !['limit', 'cursor'].includes(k)))
        readFail('READABLE_QUERY');
    const limit = query.limit ?? 10;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
        readFail('READABLE_QUERY');
    const prior = new Map(before.rows.map(r => [r.id, r])), next = new Map(after.rows.map(r => [r.id, r]));
    const all = [...new Set([...prior.keys(), ...next.keys()])].sort().flatMap(id => {
        const a = prior.get(id), b = next.get(id);
        return readStable(a ?? null) === readStable(b ?? null) ? [] : [{ id, change: !a ? 'ADDED' : !b ? 'REMOVED' : 'CHANGED', before: a ?? null, after: b ?? null }];
    });
    // Present changed declarations/results before rows whose evidence digest alone changed.
    // This ordering is a display rule, not a business-impact or equivalence judgement.
    const evidenceOnly = (c) => c.before && c.after && readStable({ ...c.before, references: [] }) === readStable({ ...c.after, references: [] }) ? 1 : 0;
    all.sort((a, b) => evidenceOnly(a) - evidenceOnly(b));
    const comparisonDigest = readDigest({ before: before.digest, after: after.digest });
    let offset = 0;
    if (query.cursor !== undefined) {
        if (typeof query.cursor !== 'string' || query.cursor.length > 1024)
            readFail('READABLE_QUERY');
        let cursor;
        try {
            cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
        }
        catch {
            return readFail('READABLE_QUERY');
        }
        if (!cursor || cursor.comparison !== comparisonDigest)
            readFail('READABLE_SNAPSHOT_DRIFT');
        if (!Number.isSafeInteger(cursor.offset) || Number(cursor.offset) < 0 || Number(cursor.offset) > all.length)
            readFail('READABLE_QUERY');
        offset = Number(cursor.offset);
    }
    function page(changes) {
        const table = { id: 'changes', title: '版本差异', columns: ['标识', '变化', '字段', '之前', '之后'], rows: changes.flatMap(c => {
                const a = c.before, b = c.after;
                const keys = [...new Set([...Object.keys(a?.presentation?.cells ?? {}), ...Object.keys(b?.presentation?.cells ?? {})])];
                const fields = keys.filter(k => a?.presentation?.cells[k] !== b?.presentation?.cells[k]).map(k => [c.id, c.change, k, a?.presentation?.cells[k] ?? '未提供', b?.presentation?.cells[k] ?? '未提供']);
                for (const key of ['label', 'verdict', 'expected', 'actual', 'origin', 'references'])
                    if (readStable(a?.[key] ?? null) !== readStable(b?.[key] ?? null))
                        fields.push([c.id, c.change, key, valueText(a?.[key] ?? null), valueText(b?.[key] ?? null)]);
                if (readStable(a?.details ?? null) !== readStable(b?.details ?? null))
                    fields.push([c.id, c.change, '原始记录摘要（完整值见 changes）', a ? readDigest(a.details) : '未提供', b ? readDigest(b.details) : '未提供']);
                return fields;
            }) };
        const end = offset + changes.length, nextCursor = end < all.length ? Buffer.from(JSON.stringify({ comparison: comparisonDigest, offset: end })).toString('base64url') : null;
        const markdown = renderReadDocument({ title: before.subject.id + '：' + before.subject.version + ' → ' + after.subject.version, summary: '分页差异 ' + changes.length + ' / ' + all.length + ' 条，偏移 ' + offset + '。' + (nextCursor ? '仍有后续页面。' : '已到末页。') + '固定验收总数：之前 ' + before.denominator.variants + '，之后 ' + after.denominator.variants + '。只比较这两个精确快照；变更不是自动接受或发布。', tables: [table, { id: 'pins', title: '对比基线', columns: ['版本', '快照', '资产摘要'], rows: [[before.subject.version ?? '未提供', before.digest, before.pins.packageDigest ?? '未提供'], [after.subject.version ?? '未提供', after.digest, after.pins.packageDigest ?? '未提供']] }], limitations: ['NOT_ASSERTED: 不断言完整 OWL/业务语义等价或 Rego 程序等价', 'REVIEW_REQUIRED: 业务影响需根据精确变更和证据审阅', '表格中的原始记录摘要不是原始值；本页 changes 保留完整记录。读取 nextCursor 至末页才完成全量差异回读。'] }, 'markdown');
        return { schema: 'evopilot-readable-comparison/v1', markdown, table, owner: before.owner, scope: before.scope, before: { subject: before.subject, pins: before.pins, digest: before.digest }, after: { subject: after.subject, pins: after.pins, digest: after.digest }, changes, totalChanges: all.length, returnedChanges: changes.length, offset, nextCursor, comparisonDigest, beforeDenominator: before.denominator, afterDenominator: after.denominator,
            comparisonProfile: 'Exact projected fields and stable identities; no OWL inference or automatic business impact analysis', semanticEquivalence: 'NOT_ASSERTED', impact: 'REVIEW_REQUIRED', authority: false };
    }
    // Bound each public response, including duplicated human and structured views.
    // Never truncate a row: reduce page length, or return an explicit limit error.
    let count = Math.min(limit, all.length - offset), result = page(all.slice(offset, offset + count));
    while (Buffer.byteLength(JSON.stringify(result)) > 12288) {
        if (count <= 1)
            readFail('READABLE_LIMIT');
        count--;
        result = page(all.slice(offset, offset + count));
    }
    return result;
}
export function renderReadSnapshot(snapshot, format) {
    verifyReadSnapshot(snapshot);
    if (format === 'json')
        return JSON.stringify(snapshot, null, 2) + '\n';
    if (format !== 'markdown' && format !== 'html')
        readFail('READABLE_FORMAT');
    return renderReadDocument(buildReadDocument(snapshot), format);
}
export const READABLE_OPERATIONS = ['readable.list', 'readable.snapshot', 'readable.query', 'readable.export', 'readable.compare'];
export function createReadableAPI(access) {
    function exact(value, required, optional = []) { if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => ![...required, ...optional].includes(k)))
        readFail('READABLE_QUERY'); }
    function identity(input) {
        if (typeof input.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.id))
            readFail('READABLE_QUERY');
        if (access.kind === 'asset' && (typeof input.version !== 'string' || input.version.length < 1 || input.version.length > 128))
            readFail('READABLE_QUERY');
        if (input.runId !== undefined && (typeof input.runId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.runId)))
            readFail('READABLE_QUERY');
        return { id: input.id, ...(input.version ? { version: input.version } : {}), ...(input.runId ? { runId: input.runId } : {}) };
    }
    return async function readable(request) {
        const serialized = readStable(request);
        if (Buffer.byteLength(serialized) > 16384)
            readFail('READABLE_LIMIT');
        request = JSON.parse(serialized);
        exact(request, ['operation', 'scope', 'input']);
        exact(request.scope, ['visibility', 'projectId']);
        if (!['private', 'public'].includes(request.scope.visibility) || typeof request.scope.projectId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(request.scope.projectId))
            readFail('READABLE_SCOPE');
        const { scope, input, operation } = request;
        if (operation === 'readable.list') {
            exact(input, []);
            return access.list(scope);
        }
        if (operation === 'readable.compare') {
            if (access.kind !== 'asset')
                readFail('READABLE_COMPARISON_UNSUPPORTED');
            exact(input, ['id', 'beforeVersion', 'afterVersion'], ['query']);
            if (input.query !== undefined)
                exact(input.query, [], ['limit', 'cursor']);
            const a = identity({ id: input.id, version: input.beforeVersion }), b = identity({ id: input.id, version: input.afterVersion });
            const before = await access.get(scope, a), after = await access.get(scope, b), check = await access.get(scope, a);
            if (check.digest !== before.digest)
                readFail('READABLE_SNAPSHOT_DRIFT');
            return { ...compareReadSnapshots(before, after, input.query), rdfGraphEquivalentWithinProfile: before.owner === 'ontology' ? before.pins.canonicalGraphDigest === after.pins.canonicalGraphDigest : null };
        }
        const required = ['id', ...(access.kind === 'asset' ? ['version'] : [])], optional = access.kind === 'project' ? ['runId'] : [];
        if (operation === 'readable.snapshot') {
            exact(input, required, optional);
            return access.get(scope, identity(input));
        }
        if (operation === 'readable.query') {
            exact(input, [...required, 'query'], optional);
            exact(input.query, [], ['limit', 'cursor', 'search', 'kind', 'verdict', 'expectedDigest']);
            return queryReadSnapshot(await access.get(scope, identity(input)), input.query);
        }
        if (operation === 'readable.export') {
            exact(input, [...required, 'format', 'expectedDigest'], optional);
            if (!['json', 'markdown', 'html'].includes(String(input.format)))
                readFail('READABLE_FORMAT');
            const snapshot = await access.get(scope, identity(input));
            if (input.expectedDigest !== snapshot.digest)
                readFail('READABLE_SNAPSHOT_DRIFT');
            return { snapshotDigest: snapshot.digest, format: input.format, content: renderReadSnapshot(snapshot, input.format), authority: false };
        }
        return readFail('READABLE_OPERATION');
    };
}
