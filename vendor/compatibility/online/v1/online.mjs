import { nativeAssertJSON, nativeExact, nativeSha256, nativeFrozenClone, nativeDigest, validateNativeReference } from '../../v1/native.mjs';
export const ONLINE_CONTRACT = 'evopilot-online/v1';
export const ONLINE_LIMITS = Object.freeze({ bindings: 64, samples: 2048, queryBytes: 2048, windowSeconds: 2592000, responseBytes: 1048576, timeoutMs: 5000, alerts: 128, backlogPerTick: 8 });
export function onlineFail(code, message = code) { throw Object.assign(new Error(message), { code }); }
export function onlineSlug(v) { if (typeof v !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(v))
    onlineFail('ONLINE_ID'); }
function openSLOName(v) { if (typeof v !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(v))
    onlineFail('OPENSLO_NAME'); }
export function onlineText(v, max = 256) { if (typeof v !== 'string' || !v.trim() || Buffer.byteLength(v) > max || /[\u0000-\u001f]/.test(v))
    onlineFail('ONLINE_TEXT'); }
export function onlineSeconds(v) { if (typeof v !== 'string' || !/^[1-9][0-9]*(s|m|h|d|w)$/.test(v))
    onlineFail('ONLINE_DURATION'); const n = Number(v.slice(0, -1)) * ({ s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[v.slice(-1)] ?? 0); if (!Number.isSafeInteger(n) || n > ONLINE_LIMITS.windowSeconds)
    onlineFail('ONLINE_DURATION'); return n; }
export function inspectOnlineSLO(value) {
    nativeAssertJSON(value);
    nativeExact(value, ['apiVersion', 'kind', 'metadata', 'spec']);
    if (value.apiVersion !== 'openslo/v1' || value.kind !== 'SLO')
        onlineFail('OPENSLO_UNSUPPORTED');
    nativeExact(value.metadata, ['name']);
    openSLOName(value.metadata.name);
    nativeExact(value.spec, ['service', 'indicator', 'timeWindow', 'budgetingMethod', 'objectives']);
    const s = value.spec;
    openSLOName(s.service);
    if (s.budgetingMethod !== 'RatioTimeslices')
        onlineFail('OPENSLO_UNSUPPORTED');
    nativeExact(s.indicator, ['metadata', 'spec']);
    nativeExact(s.indicator.metadata, ['name']);
    openSLOName(s.indicator.metadata.name);
    nativeExact(s.indicator.spec, ['ratioMetric']);
    nativeExact(s.indicator.spec.ratioMetric, ['good', 'total']);
    const metric = (v) => { nativeExact(v, ['metricSource']); nativeExact(v.metricSource, ['type', 'spec']); if (v.metricSource.type !== 'Prometheus')
        onlineFail('OPENSLO_PROVIDER'); nativeExact(v.metricSource.spec, ['query', 'freshnessQuery', 'unit']); const m = v.metricSource.spec; onlineText(m.query, ONLINE_LIMITS.queryBytes); onlineText(m.freshnessQuery, ONLINE_LIMITS.queryBytes); if (m.unit !== 'events' && m.unit !== 'events_per_second')
        onlineFail('OPENSLO_UNIT'); return { query: m.query, freshnessQuery: m.freshnessQuery, unit: m.unit }; };
    const good = metric(s.indicator.spec.ratioMetric.good), total = metric(s.indicator.spec.ratioMetric.total);
    if (good.unit !== total.unit)
        onlineFail('OPENSLO_UNIT');
    if (!Array.isArray(s.timeWindow) || s.timeWindow.length !== 1 || !Array.isArray(s.objectives) || s.objectives.length !== 1)
        onlineFail('OPENSLO_UNSUPPORTED');
    nativeExact(s.timeWindow[0], ['duration', 'isRolling']);
    if (s.timeWindow[0].isRolling !== true)
        onlineFail('OPENSLO_UNSUPPORTED');
    nativeExact(s.objectives[0], ['target', 'timeSliceWindow']);
    const objective = s.objectives[0];
    if (typeof objective.target !== 'number' || !Number.isFinite(objective.target) || objective.target < 0 || objective.target >= 1)
        onlineFail('OPENSLO_TARGET');
    const windowSeconds = onlineSeconds(s.timeWindow[0].duration), stepSeconds = onlineSeconds(objective.timeSliceWindow);
    if (stepSeconds > 3600 || windowSeconds % stepSeconds || windowSeconds / stepSeconds < 2 || windowSeconds / stepSeconds > ONLINE_LIMITS.samples)
        onlineFail('OPENSLO_WINDOW');
    return nativeFrozenClone({ name: value.metadata.name, service: s.service, windowSeconds, stepSeconds, target: objective.target, good, total, profile: 'openslo-v1-ratio-timeslices', digest: nativeSha256(value) });
}
export function validateOnlineBindingSpec(value) {
    nativeAssertJSON(value);
    nativeExact(value, ['id', 'serviceId', 'environment', 'deploymentRevision', 'providerId', 'alertSourceId', 'policy', 'slo', 'intervalSeconds']);
    for (const k of ['id', 'serviceId', 'environment', 'providerId', 'alertSourceId'])
        onlineSlug(value[k]);
    onlineText(value.deploymentRevision, 128);
    validateNativeReference(value.policy, { product: 'harness' });
    const slo = inspectOnlineSLO(value.slo);
    if (slo.service !== value.serviceId)
        onlineFail('ONLINE_SERVICE_MISMATCH');
    if (typeof value.intervalSeconds !== 'number' || !Number.isSafeInteger(value.intervalSeconds) || value.intervalSeconds < slo.stepSeconds || value.intervalSeconds > 86400 || value.intervalSeconds % slo.stepSeconds)
        onlineFail('ONLINE_INTERVAL');
}
export const onlineEqual = (a, b) => nativeSha256(a) === nativeSha256(b);
export function measurementBody(binding, windowEnd, points, reasons, responseDigests) {
    const { windowSeconds, stepSeconds } = binding.slo;
    const windowStart = windowEnd - windowSeconds + stepSeconds;
    const errors = [...new Set(reasons)].sort();
    if (!Number.isSafeInteger(windowEnd) || windowEnd < windowSeconds || windowEnd % stepSeconds)
        onlineFail('ONLINE_WINDOW');
    if (points.length !== windowSeconds / stepSeconds)
        errors.push('MISSING_SAMPLES');
    for (const [i, p] of points.entries()) {
        nativeExact(p, ['time', 'good', 'total', 'goodSourceTime', 'totalSourceTime']);
        if (p.time !== windowStart + i * stepSeconds || !Number.isSafeInteger(p.time))
            errors.push('PARTIAL_WINDOW');
        if (![p.good, p.total, p.goodSourceTime, p.totalSourceTime].every(Number.isFinite) || p.good < 0 || p.total < 0 || p.good > p.total)
            errors.push('INVALID_SAMPLE');
        if (p.total === 0)
            errors.push('ZERO_DENOMINATOR');
        if (p.goodSourceTime > p.time || p.totalSourceTime > p.time)
            errors.push('FUTURE_SAMPLE');
    }
    const unique = [...new Set(errors)].sort();
    const complete = unique.length === 0;
    return { schema: 'evopilot-online-measurement/v1', bindingDigest: binding.reviewDigest, providerId: binding.spec.providerId, windowStart, windowEnd, stepSeconds, status: complete ? 'COMPLETE' : 'INCOMPLETE', reasons: unique, points, ratio: complete ? points.reduce((n, p) => n + p.good / p.total, 0) / points.length : null, responseDigests };
}
export function validateOnlineMeasurement(value, binding, windowEnd) {
    nativeAssertJSON(value);
    nativeExact(value, ['schema', 'bindingDigest', 'providerId', 'windowStart', 'windowEnd', 'stepSeconds', 'status', 'reasons', 'points', 'ratio', 'responseDigests', 'digest']);
    if (!Array.isArray(value.points) || value.points.length > ONLINE_LIMITS.samples || !Array.isArray(value.reasons) || value.reasons.some(r => typeof r !== 'string' || !/^[A-Z_]{1,64}$/.test(r)) || !Array.isArray(value.responseDigests) || value.responseDigests.length > 4)
        onlineFail('ONLINE_MEASUREMENT');
    value.responseDigests.forEach(nativeDigest);
    const expected = measurementBody(binding, windowEnd, value.points, value.reasons, value.responseDigests);
    if (!onlineEqual(value, { ...expected, digest: nativeSha256(expected) }))
        onlineFail('ONLINE_MEASUREMENT_INTEGRITY');
}
export function validateOnlineFinding(value) {
    nativeAssertJSON(value);
    nativeExact(value, ['schema', 'id', 'workspaceId', 'scope', 'bindingId', 'bindingDigest', 'serviceId', 'environment', 'deploymentRevision', 'policy', 'incidentId', 'source', 'state', 'at', 'evidenceDigest', 'causeId', 'candidate', 'digest']);
    if (value.schema !== 'evopilot-online-finding/v1' || !['evaluation', 'alertmanager'].includes(String(value.source)) || !['FIRING', 'RESOLVED'].includes(String(value.state)) || typeof value.at !== 'number' || !Number.isSafeInteger(value.at) || value.at < 0)
        onlineFail('ONLINE_FINDING');
    const body = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest'));
    if (value.digest !== nativeSha256(body))
        onlineFail('ONLINE_INTEGRITY');
    validateNativeReference(value.policy, { product: 'harness' });
    for (const key of ['id', 'bindingDigest', 'incidentId', 'evidenceDigest', 'causeId', 'digest'])
        nativeDigest(value[key]);
    for (const key of ['serviceId', 'environment'])
        onlineSlug(value[key]);
    onlineText(value.deploymentRevision, 128);
    nativeExact(value.scope, ['visibility', 'projectId']);
    if (!['public', 'private'].includes(String(value.scope.visibility)))
        onlineFail('ONLINE_SCOPE');
    onlineSlug(value.scope.projectId);
    onlineSlug(value.workspaceId);
    onlineSlug(value.bindingId);
    nativeExact(value.candidate, ['kind', 'status']);
    if (value.candidate.kind !== 'regression' || value.candidate.status !== 'REVIEW_REQUIRED')
        onlineFail('ONLINE_FINDING');
}
