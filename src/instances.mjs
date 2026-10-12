import { assertJSON, exactFields, textField, frozenClone } from '../vendor/compatibility/v1/reference.mjs';
import { validateOntology, primitive, failure } from './specification.mjs';

export function validateInstances(asset, instances) {
  const model = validateOntology(asset);
  if (!model.valid) return model;
  let path = '$';
  try {
    assertJSON(instances); exactFields(instances, ['entities', 'relations']);
    if (!Array.isArray(instances.entities) || !Array.isArray(instances.relations)) throw new TypeError('Expected entity/relation arrays');
    const concepts = new Set(asset.concepts.map(c => c.id));
    const properties = new Map(asset.properties.map(p => [p.id, p]));
    const entities = new Map(); const ids = new Set(); const errors = [];
    const reject = (code, message) => errors.push({ code, path, message });
    for (const [i, e] of instances.entities.entries()) {
      path = `$.entities[${i}]`;
      exactFields(e, ['id', 'conceptRef', 'properties']); textField(e.id);
      if (ids.has(e.id) || !concepts.has(e.conceptRef)) throw new TypeError('Duplicate entity or unknown concept');
      ids.add(e.id); entities.set(e.id, e);
      if (!e.properties || typeof e.properties !== 'object' || Array.isArray(e.properties)) throw new TypeError('Expected property object');
      for (const [id, values] of Object.entries(e.properties)) {
        const p = properties.get(id);
        if (!p || p.conceptRef !== e.conceptRef || !Array.isArray(values)) throw new TypeError('Unknown property, owner mismatch or non-array values');
        if (values.some(v => !primitive(v, p.type))) reject('TYPE', `Invalid ${p.type} values for ${id}`);
      }
      for (const p of properties.values()) if (p.conceptRef === e.conceptRef && p.required && !(Object.hasOwn(e.properties, p.id) && e.properties[p.id].length)) reject('REQUIRED', `Missing required ${p.id}`);
    }
    const relations = new Map(asset.relations.map(r => [r.id, r]));
    for (const [i, r] of instances.relations.entries()) {
      path = `$.relations[${i}]`; exactFields(r, ['id', 'relationRef', 'from', 'to']); textField(r.id);
      const type = relations.get(r.relationRef);
      if (ids.has(r.id) || !type || !entities.has(r.from) || !entities.has(r.to) || entities.get(r.from).conceptRef !== type.from || entities.get(r.to).conceptRef !== type.to) throw new TypeError('Invalid relation endpoints/type/id');
      ids.add(r.id);
    }
    const coverage = asset.constraints.map(c => {
      const relevant = instances.entities.filter(e => e.conceptRef === c.conceptRef);
      if (c.kind === 'descriptive-range') return { id: c.id, status: 'UNSUPPORTED', tested: 0 };
      let tested = 0; let failed = false;
      for (const e of relevant) {
        path = `$.entities.${e.id}.properties.${c.propertyRef}`;
        const values = Object.hasOwn(e.properties, c.propertyRef) ? e.properties[c.propertyRef] : [];
        if (c.kind !== 'cardinality' && values.length === 0) continue;
        tested++;
        const ok = c.kind === 'cardinality' ? values.length >= c.minCount && values.length <= c.maxCount
          : c.kind === 'numeric-range' ? values.every(v => typeof v === 'number' && v >= c.minimum && v <= c.maximum)
            : values.every(v => c.values.includes(v));
        if (!ok) { failed = true; reject('CONSTRAINT', `Constraint ${c.id} failed`); }
      }
      return { id: c.id, status: failed ? 'FAIL' : tested ? 'PASS' : 'NOT_CHECKED', tested };
    });
    const untested = coverage.filter(c => c.status === 'NOT_CHECKED' || c.status === 'UNSUPPORTED').map(c => c.id);
    const complete = instances.entities.length > 0 && !untested.length && asset.concepts.every(c => instances.entities.some(e => e.conceptRef === c.id));
    return frozenClone({ valid: !errors.length, status: errors.length ? 'FAIL' : complete ? 'PASS' : 'NOT_CHECKED', errors, coverage, untested, complete, entityCount: entities.size, authority: false, businessConfirmed: false, released: false });
  } catch (error) { return failure(error, path); }
}
