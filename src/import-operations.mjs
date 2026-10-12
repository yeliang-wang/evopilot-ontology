import { parseDocument, visit } from 'yaml';
import { createHash } from 'node:crypto';
import { sha256, stableSerialize } from '../vendor/compatibility/v1/reference.mjs';
import { listPublicSources, readPublicSource } from './asset-sources.mjs';
import { inspectLegacySource, deriveLegacyModel } from './migration.mjs';
import { bounded, fail, LIMITS } from './state.mjs';

export const importFields = Object.freeze({
  'source.install': ['sourcePath'], 'source.inspect': ['sourceId'], 'source.list': [],
  'legacy.import': ['raw', 'format', 'sourceLocator', 'sourceRevision', 'sourceVisibility'],
  'legacy.derive': ['sourceId', 'id', 'version', 'visibility'],
});
export const importOperations = Object.freeze(Object.keys(importFields));
export const importMutations = Object.freeze(['source.install', 'legacy.import', 'legacy.derive']);
const origin = s => ({ sourceLocator: s.sourceLocator, sourceRevision: s.sourceRevision, sourceVisibility: s.sourceVisibility });
const sourceKey = s => sha256({ scope: s.scope, rawDigest: s.rawDigest, format: s.format, ...origin(s) });

function parseRaw(raw, format) {
  if (typeof raw !== 'string' || !raw.isWellFormed()) fail('INVALID_ENCODING', 'Source must be a well-formed UTF-8 string; caller retains original');
  if (Buffer.byteLength(raw) > LIMITS.requestBytes) fail('LIMIT', 'Source exceeds byte limit; caller retains original');
  if (!['json', 'yaml'].includes(format)) fail('INVALID_FORMAT', 'Source format must be json or yaml');
  let document;
  try {
    if (format === 'json') document = JSON.parse(raw);
    else {
      const parsed = parseDocument(raw, { uniqueKeys: true, customTags: [] });
      if (parsed.errors.length || parsed.warnings.length) fail('INVALID_SOURCE', 'YAML errors or warnings');
      visit(parsed, (_key, node) => {
        if (node?.tag && !['tag:yaml.org,2002:str', 'tag:yaml.org,2002:int', 'tag:yaml.org,2002:float', 'tag:yaml.org,2002:bool', 'tag:yaml.org,2002:null', 'tag:yaml.org,2002:map', 'tag:yaml.org,2002:seq'].includes(node.tag)) fail('INVALID_SOURCE', 'Custom YAML tags forbidden');
      });
      document = parsed.toJS({ maxAliasCount: 100 });
    }
    bounded(document);
  } catch (e) {
    if (e.code === 'LIMIT') throw e;
    fail('INVALID_SOURCE', 'Malformed or unsafe source; caller retains original bytes');
  }
  return document;
}

export function operateImport(store, state, r, operateNative) {
  const own = s => stableSerialize(s.scope) === stableSerialize(r.scope);
  const sources = state.sources ?? [];
  const inspect = source => {
    if (sourceKey(source) !== source.sourceId || sha256(source.document) !== source.documentDigest) fail('CORRUPT_STATE', 'Source identity differs');
    const raw = store.verifyRawBlob(source.scope, source.rawDigest);
    if (sha256(parseRaw(raw, source.format)) !== source.documentDigest) fail('CORRUPT_BLOB', 'Source document differs');
    return { ...source, raw };
  };
  if (r.operation === 'source.list') return sources.filter(own).map(s => {
    const verified = inspect(s);
    return { sourceId: verified.sourceId, rawDigest: verified.rawDigest, observed: verified.observed, status: verified.status, ...origin(verified) };
  });
  if (r.operation === 'source.inspect' || r.operation === 'legacy.derive') {
    const source = sources.find(s => own(s) && s.sourceId === r.input.sourceId);
    if (!source) fail('NOT_FOUND', 'Source not found in scope');
    const verified = inspect(source);
    if (r.operation === 'source.inspect') return verified;
    if (r.input.visibility !== r.scope.visibility) fail('SCOPE_MISMATCH', 'Draft visibility must match scope');
    if (source.sourceVisibility === 'private' && r.input.visibility === 'public') fail('SCOPE_MISMATCH', 'Private source cannot enter public scope');
    if (!source.inspection.valid) fail('SOURCE_QUARANTINED', 'Source inspection blocks derivation');
    if (state.assets.some(a => own(a) && a.model.id === r.input.id && a.model.version === r.input.version)) fail('ASSET_EXISTS', 'Derivation requires a new id/version');
    const derivation = deriveLegacyModel(source.document, { ...origin(source), id: r.input.id, version: r.input.version, visibility: r.input.visibility, expectedDocumentDigest: source.documentDigest });
    if (!derivation.valid) fail('NOT_DERIVABLE', 'Source has no valid native projection');
    const asset = operateNative(store, state, { ...r, operation: 'asset.put', input: { model: derivation.model } });
    return { sourceId: source.sourceId, ...asset, coverage: derivation.coverage, unresolvedIssues: derivation.model.unresolvedIssues, authority: false };
  }
  let input = r.input;
  if (r.operation === 'source.install') {
    const listed = listPublicSources().sources.find(s => s.owner === 'ontology' && s.sourcePath === input.sourcePath);
    if (!listed) fail('UNKNOWN_SOURCE', 'Exact packaged Ontology source path key required');
    const packaged = readPublicSource(listed.sourcePath);
    input = { raw: packaged.raw, format: 'yaml', sourceLocator: packaged.sourcePath, sourceRevision: packaged.sourceCommit, sourceVisibility: 'public' };
    if (createHash('sha256').update(input.raw).digest('hex') !== packaged.sha256) fail('CORRUPT_BLOB', 'Packaged original bytes differ');
  }
  if (!['public', 'private'].includes(input.sourceVisibility)) fail('INVALID_REQUEST', 'Explicit source visibility required');
  if (input.sourceVisibility === 'private' && r.scope.visibility === 'public') fail('SCOPE_MISMATCH', 'Private source cannot enter public scope');
  const document = parseRaw(input.raw, input.format);
  const inspection = inspectLegacySource(document, origin(input));
  const metadata = document && typeof document === 'object' ? document.metadata : null;
  const observed = inspection.observed ?? {
    id: metadata?.id ?? document?.id ?? null, version: metadata?.version ?? document?.version ?? null,
    lifecycle: metadata?.lifecycle ?? document?.lifecycle ?? null, status: metadata?.status ?? document?.status ?? null,
    kind: document?.kind ?? null, schema: document?.schema ?? null,
  };
  const record = { scope: r.scope, ...origin(input), format: input.format, rawDigest: 'sha256:' + createHash('sha256').update(input.raw).digest('hex'), documentDigest: sha256(document), document, inspection, observed, status: inspection.valid ? 'INSPECTED' : 'QUARANTINED', authority: false };
  record.sourceId = sourceKey(record);
  const prior = sources.find(s => own(s) && s.sourceId === record.sourceId);
  if (prior) { inspect(prior); return prior; }
  if (sources.length >= LIMITS.sources) fail('LIMIT', 'Source count limit');
  store.rawBlob(r.scope, input.raw);
  state.sources ??= [];
  state.sources.push(record);
  return record;
}
