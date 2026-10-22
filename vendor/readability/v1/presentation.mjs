const sections = {
    concepts: { title: '本体概念', columns: [['name', '名称'], ['definition', '定义'], ['types', '原生类型']] },
    properties: { title: '属性定义', columns: [['name', '属性'], ['domain', '定义域'], ['range', '值域'], ['definition', '定义']] },
    relations: { title: '关系', columns: [['subject', '起点'], ['predicate', '关系 / 方向'], ['object', '终点']] },
    constraints: { title: '约束', columns: [['target', '适用对象'], ['path', '属性路径'], ['constraint', '原生约束与值'], ['severity', '严重程度']] },
    instances: { title: '实例声明', columns: [['name', '实例'], ['types', '类型'], ['values', '已声明属性']] },
    rules: { title: 'Harness 规则', columns: [['name', '规则'], ['purpose', '用途 / 质量域'], ['inputs', '输入'], ['parameters', '参数'], ['severity', '严重程度'], ['policy', '纳入验收条件']] },
    results: { title: '验收结果', columns: [['name', '检查项'], ['expected', '预期'], ['actual', '实际'], ['verdict', '检查结论'], ['origin', '证据性质'], ['next', '说明 / 下一步']] },
    planning: { title: '方案条目', columns: [['kind', '性质'], ['text', '内容'], ['disposition', '处理状态'], ['acceptance', '验收条件'], ['basis', '依据 / 关联']] },
    milestones: { title: '里程碑', columns: [['name', '目标'], ['version', '版本'], ['requirements', '需求'], ['dependencies', '依赖']] },
    sources: { title: '来源', columns: [['name', '来源'], ['representation', '保存形式'], ['role', '提供者'], ['content', '内容 / 说明']] }
};
const status = { PASS: '通过', FAIL: '未通过', ERROR: '工具或执行错误', UNKNOWN: '未知', MISSING: '缺少证据', NOT_EXECUTED: '未执行', NOT_EVALUATED: '未评估', DECLARED: '仅声明', PENDING: '待决定', APPROVE: '已批准', REJECT: '已拒绝', CONFORMS: '符合约束', NONCONFORMING: '不符合约束', NOT_ASSERTED: '未作断言', CURRENT: '当前有效', STALE: '已过期', UNBOUND: '未绑定', INCOMPLETE: '未完成', RECORDED: '已有记录', WARN: '警告' };
export function statusText(value) { return status[value] ? status[value] + ' (' + value + ')' : value; }
const origins = { 'synthetic': '合成用例', 'source-declaration': '源码声明', 'design-declaration': '设计声明', 'runtime-observation': '运行观测', 'execution-result': '执行结果', 'imported': '导入证据', 'not-retained-in-package': '本包未保留原观测输入', 'human-reviewed-planning': '人工审阅的方案' };
export function originText(value) { return origins[value] ? origins[value] + ' (' + value + ')' : value; }
export function valueText(value) {
    if (value === null)
        return '未提供';
    if (typeof value === 'string')
        return value;
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    if (typeof value === 'number')
        return String(value);
    if (Array.isArray(value))
        return value.length ? value.map(valueText).join('；') : '无';
    return Object.entries(value).map(([key, v]) => key + ' = ' + valueText(v)).join('；') || '无';
}
function outcome(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (typeof value.conforms === 'boolean')
            return (value.conforms ? '符合约束' : '不符合约束') + ' (conforms=' + value.conforms + ')';
        if (typeof value.status === 'string')
            return statusText(value.status) + (Array.isArray(value.ruleIds) ? '；规则：' + valueText(value.ruleIds) : '');
    }
    return valueText(value);
}
export function resultPresentation(row) {
    const negative = row.verdict === 'PASS' && row.actual !== null && typeof row.actual === 'object' && !Array.isArray(row.actual) && (row.actual.conforms === false || row.actual.status === 'FAIL');
    const next = negative ? '预期拒绝已验证；输入本身未通过，不能据此认定业务执行成功' : row.verdict === 'MISSING' ? '补充该固定检查项的证据' : row.verdict === 'NOT_EXECUTED' ? '按已批准范围执行后保留真实回执' : row.verdict === 'ERROR' ? '检查原始工具回执；不据此断言业务失败' : row.verdict === 'UNKNOWN' ? '回读原始证据确定结果；不得推定通过' : row.verdict === 'FAIL' ? '核对预期与实际，修复后重新验收' : row.origin === 'synthetic' ? '仅证明该合成用例的行为' : '结论仅适用于本条证据与范围';
    return { section: 'results', cells: { name: row.label, expected: outcome(row.expected), actual: outcome(row.actual), verdict: statusText(row.verdict), origin: originText(row.origin), next } };
}
export function buildReadDocument(snapshot) {
    const results = snapshot.rows.filter(r => ['case', 'criterion'].includes(r.kind));
    const counts = new Map();
    for (const r of results)
        counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1);
    const summary = '固定需求 ' + snapshot.denominator.requirements + ' 项，验收变体 ' + snapshot.denominator.variants + ' 项；' + (results.length ? [...counts].map(([s, n]) => statusText(s) + ' ' + n).join('，') : '当前视图无执行结果') + '。资产声明、合成验证与真实执行分别展示；本报告不授予执行或发布权限。';
    const tables = [{ id: 'stages', title: '阶段状态', columns: ['阶段', '状态', '判定边界'], rows: snapshot.stages.map(s => [s.id, statusText(s.status), s.reason]) }];
    for (const [key, definition] of Object.entries(sections)) {
        const entries = snapshot.rows.map((r, i) => ({ r, ref: 'E' + (i + 1), p: r.presentation ?? (['case', 'criterion'].includes(r.kind) ? resultPresentation(r) : null) })).filter(x => x.p?.section === key);
        if (entries.length)
            tables.push({ id: key, title: definition.title, columns: [...definition.columns.map(c => c[1]), '证据'], rows: entries.map(x => [...definition.columns.map(([k]) => x.p.cells[k] ?? '未提供'), x.ref]) });
    }
    const ungrouped = snapshot.rows.filter(r => !r.presentation && !['case', 'criterion'].includes(r.kind));
    if (ungrouped.length)
        tables.push({ id: 'other', title: '其他声明', columns: ['名称', '类型', '状态', '来源', '证据'], rows: ungrouped.map(r => [r.label, r.kind, statusText(r.verdict), originText(r.origin), 'E' + (snapshot.rows.indexOf(r) + 1)]) });
    tables.push({ id: 'identity', title: '版本与来源摘要', columns: ['字段', '值'], rows: [['snapshot', snapshot.digest], ['owner', snapshot.owner], ['workspace', snapshot.workspaceId], ['project', snapshot.scope.visibility + '/' + snapshot.scope.projectId], ['subject', snapshot.subject.id], ['version', snapshot.subject.version ?? '未提供'], ...Object.entries(snapshot.pins).map(([k, v]) => [k, v ?? '未提供'])] });
    tables.push({ id: 'evidence', title: '原始标识与证据', columns: ['证据', '原始标识', '引用', '性质'], rows: snapshot.rows.map((r, i) => ['E' + (i + 1), r.id, r.references.length ? r.references.map(ref => ref.kind + ': ' + ref.id + ' @ ' + (ref.digest ?? '摘要未提供')).join('；') : '未提供', originText(r.origin)]) });
    return { title: snapshot.owner + ' / ' + snapshot.subject.id + (snapshot.subject.version ? ' @ ' + snapshot.subject.version : ''), summary, tables, limitations: snapshot.limitations };
}
export const markdownText = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()#+.!|~-]/g, '\\$&').replace(/[\r\n]+/g, ' ');
const htmlText = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export function renderReadDocument(doc, format) {
    if (format === 'markdown')
        return ['# ' + markdownText(doc.title), '', markdownText(doc.summary), '', ...doc.tables.flatMap(t => ['## ' + t.title, '', '| ' + t.columns.join(' | ') + ' |', '| ' + t.columns.map(() => '---').join(' | ') + ' |', ...t.rows.map(r => '| ' + r.map(markdownText).join(' | ') + ' |'), ...(t.rows.length ? [] : ['| ' + t.columns.map((_, i) => i === 0 ? '未提供' : '—').join(' | ') + ' |']), '']), '## 范围与限制', '', ...doc.limitations.map(x => '- ' + markdownText(x)), ''].join('\n');
    return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' + htmlText(doc.title) + '</title><body><h1>' + htmlText(doc.title) + '</h1><p>' + htmlText(doc.summary) + '</p>' + doc.tables.map(t => '<table><caption>' + htmlText(t.title) + '</caption><thead><tr>' + t.columns.map(c => '<th scope="col">' + htmlText(c) + '</th>').join('') + '</tr></thead><tbody>' + t.rows.map(r => '<tr>' + r.map(c => '<td>' + htmlText(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>').join('') + '<h2>范围与限制</h2><ul>' + doc.limitations.map(x => '<li>' + htmlText(x) + '</li>').join('') + '</ul></body></html>';
}
