import type { ProvenanceSource, ModelValidation, Rejection } from "./types.js";
import { assertJSON, exactFields, textField, validateEnvelope, ENVELOPE_FIELDS, SOURCE_STATUSES, frozenClone } from '../vendor/compatibility/v1/reference.mjs';

export const MODEL_FIELDS = ['concepts', 'properties', 'relations', 'constraints', 'sourceMappings', 'unresolvedIssues'];
export function primitive(value: unknown, type: string) {
  return type === 'integer' ? Number.isInteger(value) : typeof value === type && (type !== 'number' || Number.isFinite(value));
}
export function failure(error: unknown, path = '$'): Rejection {
  return frozenClone({ valid: false, status: 'REJECTED', errors: [{ code: 'INVALID_DATA', path, message: error instanceof Error ? error.message : 'Invalid data' }], authority: false, businessConfirmed: false, released: false });
}

// Syntax is closed; references, ownership and source coverage are semantic checks.
export function validateOntology(input: unknown): ModelValidation | Rejection {
  let path = '$';
  try {
    assertJSON(input);
    exactFields(input, [...ENVELOPE_FIELDS, ...MODEL_FIELDS]);
    const envelope = validateEnvelope(input);
    // The envelope validator checks provenance before these fields are read.
    const asset = input as Record<string, unknown> & { provenance: { sources: ProvenanceSource[] } };
    exactFields(asset, [...ENVELOPE_FIELDS, ...MODEL_FIELDS]);
    if (asset.product !== 'ontology') throw new TypeError('Expected ontology product');
    const all = new Map<string, unknown>(asset.provenance.sources.map(s => [s.id, s]));
    const rows = (name: string, required: string[], optional: string[] = []) => {
      path = `$.${name}`;
      const values = asset[name];
      if (!Array.isArray(values)) throw new TypeError('Expected array');
      for (const [i, row] of values.entries()) {
        path = `$.${name}[${i}]`;
        exactFields(row, required, optional); textField(row.id);
        if (all.has(row.id)) throw new TypeError('Globally duplicate row id');
        all.set(row.id, row);
      }
      return new Map<string, Record<string, unknown> & { id: string }>(values.map((r: unknown) => {
        exactFields(r, required, optional); textField(r.id);
        return [r.id, r as Record<string, unknown> & { id: string }];
      }));
    };
    const concepts = rows('concepts', ['id', 'label', 'definition']);
    if (!concepts.size) throw new TypeError('At least one concept required');
    for (const c of concepts.values()) { textField(c.label); textField(c.definition); }
    const properties = rows('properties', ['id', 'conceptRef', 'type', 'required']);
    for (const p of properties.values()) {
      if (!concepts.has(p.conceptRef as string) || !['string', 'number', 'integer', 'boolean'].includes(p.type as string) || typeof p.required !== 'boolean') throw new TypeError('Invalid property type/owner/required');
    }
    const relations = rows('relations', ['id', 'from', 'to', 'directed']);
    for (const r of relations.values()) if (r.directed !== true || !concepts.has(r.from as string) || !concepts.has(r.to as string)) throw new TypeError('Invalid directed relation ends');
    const constraints = rows('constraints', ['id', 'conceptRef', 'propertyRef', 'kind', 'required'], ['minimum', 'maximum', 'values', 'minCount', 'maxCount', 'description']);
    const constraintResults = [];
    for (const c of constraints.values()) {
      path = `$.constraints.${c.id}`;
      const p = properties.get(c.propertyRef as string);
      if (!p || p.conceptRef !== c.conceptRef || typeof c.required !== 'boolean') throw new TypeError('Constraint property ownership mismatch');
      const base = ['id', 'conceptRef', 'propertyRef', 'kind', 'required'];
      if (c.kind === 'numeric-range') {
        exactFields(c, [...base, 'minimum', 'maximum']);
        if (!['integer', 'number'].includes(p.type as string) || typeof c.minimum !== 'number' || typeof c.maximum !== 'number' || c.minimum > c.maximum) throw new TypeError('Invalid numeric range');
      } else if (c.kind === 'enum') {
        exactFields(c, [...base, 'values']);
        if (!Array.isArray(c.values) || !c.values.length || c.values.some(v => !primitive(v, p.type as string)) || new Set(c.values).size !== c.values.length) throw new TypeError('Invalid typed unique enum');
      } else if (c.kind === 'cardinality') {
        exactFields(c, [...base, 'minCount', 'maxCount']);
        if (typeof c.minCount !== 'number' || typeof c.maxCount !== 'number' || !Number.isSafeInteger(c.minCount) || !Number.isSafeInteger(c.maxCount) || c.minCount < 0 || c.maxCount < c.minCount) throw new TypeError('Invalid cardinality');
      } else if (c.kind === 'descriptive-range') {
        exactFields(c, [...base, 'description']); textField(c.description);
        if (c.required) throw new TypeError('Required descriptive constraint unsupported');
      } else throw new TypeError('Unknown constraint kind');
      constraintResults.push({ id: c.id, status: c.kind === 'descriptive-range' ? 'UNSUPPORTED' : 'NOT_CHECKED' });
    }
    const semantic = new Set([...concepts.keys(), ...properties.keys(), ...relations.keys(), ...constraints.keys()]);
    const mappings = rows('sourceMappings', ['id', 'targetRef', 'sourceRef', 'sourceLocator', 'sourceRevision', 'status']);
    const sources = new Map(asset.provenance.sources.map(s => [s.id, s]));
    const covered = new Set(); const bindings = new Set();
    for (const m of mappings.values()) {
      path = `$.sourceMappings.${m.id}`;
      const s = sources.get(m.sourceRef as string);
      if (!semantic.has(m.targetRef as string) || !s || m.sourceLocator !== s.locator || m.sourceRevision !== s.revision || !SOURCE_STATUSES.includes(m.status as string) || m.status !== s.status) throw new TypeError('Source mapping mismatch or dangling reference');
      const binding = JSON.stringify([m.targetRef, m.sourceRef]);
      if (bindings.has(binding)) throw new TypeError('Duplicate source mapping');
      bindings.add(binding); covered.add(m.targetRef);
    }
    if ([...semantic].some(id => !covered.has(id))) throw new TypeError('Missing semantic source coverage');
    const issues = rows('unresolvedIssues', ['id', 'description', 'targetRef', 'required']);
    for (const issue of issues.values()) { textField(issue.description); if (!semantic.has(issue.targetRef as string) || typeof issue.required !== 'boolean') throw new TypeError('Invalid unresolved issue'); }
    const pending = [...issues.values()].filter(i => i.required).map(i => i.id);
    return frozenClone({ valid: true, status: pending.length ? 'PENDING' : 'VALID', errors: [], pending, extensions: envelope.extensions, constraints: constraintResults, authority: false, businessConfirmed: false, released: false });
  } catch (error) { return failure(error, path); }
}
