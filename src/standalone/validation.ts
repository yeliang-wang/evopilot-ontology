import { createHash } from 'node:crypto';
import { fail, LIMITS } from './types.js';
import type { Json, ModelingIntent, ServiceRequest, Credentials, WorkspaceIdentity } from './types.js';

export function json(value: unknown): asserts value is Json {
  let nodes = 0;
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > LIMITS.jsonNodes || depth > LIMITS.jsonDepth) fail('INPUT_LIMIT', 'JSON structure exceeds budget', 413);
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (Array.isArray(v)) { for (const item of v) visit(item, depth + 1); return; }
    if (v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v))) {
      for (const [key, item] of Object.entries(v)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('INVALID_INPUT', 'Reserved JSON member');
        visit(item, depth + 1);
      }
      return;
    }
    fail('INVALID_INPUT', 'Plain finite JSON required');
  };
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > LIMITS.requestBytes) fail('INPUT_LIMIT', 'Request exceeds byte budget', 413);
}
export function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_INPUT', 'Object required');
}
export function exact(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  object(value);
  if (required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => ![...required, ...optional].includes(k))) fail('INVALID_INPUT', 'Unexpected or missing fields');
}
export function text(value: unknown, max = 4000): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) fail('INVALID_INPUT', 'Bounded nonempty text required');
}
export function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(value)) fail('INVALID_INPUT', 'Invalid identifier');
}
export function digest(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) fail('INVALID_INPUT', 'SHA-256 identity required');
}
export function canonical(value: Json): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function hashBytes(value: string | Buffer): string { return 'sha256:' + createHash('sha256').update(value).digest('hex'); }
export function hash(value: Json): string { return hashBytes(canonical(value)); }
export function validateIdentity(value: unknown): asserts value is WorkspaceIdentity {
  exact(value, ['schema','workspaceId','serviceId','stateVersion','createdAt']);
  if (value.schema !== 'ontology-workspace/v1' || value.stateVersion !== 14) fail('UNSUPPORTED_STATE', 'Independent Ontology state v14 required');
  id(value.workspaceId); id(value.serviceId); timestamp(value.createdAt);
}
export function timestamp(value: unknown): asserts value is string {
  text(value, 32);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('INVALID_INPUT', 'Canonical UTC timestamp required');
}
export function validateCredentials(value: unknown, identity: WorkspaceIdentity): asserts value is Credentials {
  exact(value, ['schema','workspaceId','serviceId','grants']);
  if (value.schema !== 'ontology-credentials/v1' || value.workspaceId !== identity.workspaceId || value.serviceId !== identity.serviceId) fail('IDENTITY_MISMATCH', 'Credential identity does not match service', 403);
  if (!Array.isArray(value.grants) || value.grants.length > LIMITS.grants) fail('INVALID_INPUT', 'Invalid grants');
  const ids = new Set<string>(), tokens = new Set<string>();
  for (const grant of value.grants) {
    exact(grant, ['id','principalId','tokenHash','projectIds','permissions','expiresAt','revoked']);
    id(grant.id); id(grant.principalId); digest(grant.tokenHash); timestamp(grant.expiresAt);
    if (ids.has(grant.id) || tokens.has(grant.tokenHash)) fail('INVALID_INPUT', 'Duplicate grant identity');
    ids.add(grant.id); tokens.add(grant.tokenHash);
    if (typeof grant.revoked !== 'boolean' || !Array.isArray(grant.projectIds) || !grant.projectIds.length || grant.projectIds.length > LIMITS.projects) fail('INVALID_INPUT', 'Explicit bounded project scope required');
    grant.projectIds.forEach(id);
    if (new Set(grant.projectIds).size !== grant.projectIds.length || !Array.isArray(grant.permissions) || !grant.permissions.length || grant.permissions.some(p => !['read','write','review'].includes(p)) || new Set(grant.permissions).size !== grant.permissions.length) fail('INVALID_INPUT', 'Invalid grant scope');
  }
}
export function validateRequest(value: unknown, write: boolean): asserts value is ServiceRequest {
  json(value);
  exact(value, ['workspaceId','serviceId','projectId','operation','input', ...(write ? ['requestId','expectedRevision'] : [])]);
  id(value.workspaceId); id(value.serviceId); id(value.projectId); text(value.operation, 96); object(value.input);
  if (write) {
    id(value.requestId);
    if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) fail('INVALID_INPUT', 'Nonnegative safe expectedRevision required');
  }
}
export function validateIntent(value: unknown): asserts value is ModelingIntent {
  exact(value, ['purpose','mode','scope','exclusions','sources','requirements']);
  text(value.purpose); text(value.scope);
  if (!['forward','reverse','composition'].includes(value.mode as string)) fail('INVALID_INPUT', 'Explicit modeling mode required');
  if (!Array.isArray(value.exclusions) || value.exclusions.length > 100) fail('INPUT_LIMIT', 'Exclusion budget');
  value.exclusions.forEach(v => text(v));
  if (!Array.isArray(value.sources) || !value.sources.length || value.sources.length > LIMITS.sourceBindings) fail('INVALID_INPUT', 'Fixed sources required');
  const sourceIds = new Set<string>();
  for (const source of value.sources) {
    exact(source, ['id','locator','revision','digest','origin']); id(source.id); text(source.locator); text(source.revision, 200); digest(source.digest);
    if (!['source','requirement','design','reference'].includes(source.origin as string) || sourceIds.has(source.id)) fail('INVALID_INPUT', 'Source origin or identity');
    sourceIds.add(source.id);
  }
  if (!Array.isArray(value.requirements) || !value.requirements.length || value.requirements.length > LIMITS.requirements) fail('INVALID_INPUT', 'Independent expected requirements required');
  const requirementIds = new Set<string>();
  for (const req of value.requirements) { exact(req, ['id','statement']); id(req.id); text(req.statement); if (requirementIds.has(req.id)) fail('INVALID_INPUT', 'Duplicate requirement'); requirementIds.add(req.id); }
}
