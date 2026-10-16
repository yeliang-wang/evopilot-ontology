import { assertJSON, exactFields, textField, sha256, stableSerialize, frozenClone } from '../vendor/compatibility/v1/reference.mjs';
import { validateOntology } from './specification.js';
import { validation as legacy_validation } from "./compat/index.mjs";
const { validateDocument } = legacy_validation;
import { packs as legacy_packs } from "./compat/index.mjs";
const { PROFESSIONAL_PACK_KINDS, validateProfessionalPack } = legacy_packs;
import { projectOntology as legacy_projectOntology } from "./compat/index.mjs";
const { validateProjectOntologyDocument } = legacy_projectOntology;
import { interoperability as legacy_interoperability } from "./compat/index.mjs";
const { validateSemanticInteroperabilityDocument } = legacy_interoperability;
import { catalogContract as legacy_catalogContract } from "./compat/index.mjs";
const { validateSupplyDigest, validateSemanticGeneration, validateSemanticPointer } = legacy_catalogContract;
import { taxonomy as legacy_taxonomy } from "./compat/index.mjs";
const { resolveTaxonomy } = legacy_taxonomy;
const authority = { authority: false, businessConfirmed: false, released: false };
const escape = (s) => String(s).replaceAll('~', '~0').replaceAll('/', '~1');
function optionsFor(options, derive) {
    assertJSON(options);
    exactFields(options, ['sourceLocator', 'sourceRevision', 'sourceVisibility', ...(derive ? ['id', 'version', 'visibility'] : [])], ['expectedDocumentDigest']);
    textField(options.sourceLocator);
    textField(options.sourceRevision);
    if (!['public', 'private'].includes(options.sourceVisibility))
        throw new TypeError('Explicit sourceVisibility required');
    if (derive && (!['public', 'private'].includes(options.visibility) || options.sourceVisibility === 'private' && options.visibility === 'public'))
        throw new TypeError('Private source cannot become public');
    if (options.expectedDocumentDigest !== undefined && !/^sha256:[a-f0-9]{64}$/.test(options.expectedDocumentDigest))
        throw new TypeError('Invalid expectedDocumentDigest');
}
function rejected(type, error) {
    return frozenClone({ type, valid: false, status: 'BLOCKED', errors: [{ code: 'MIGRATION_BLOCKER', message: error instanceof Error ? error.message : 'Invalid input' }], ...authority });
}
function validateHistorical(d) {
    if (['HarnessComponent', 'HarnessProfile', 'HarnessBundle', 'DomainHarnessPack'].includes(d.kind) || d.schema === 'evopilot-harness-semantic-requirements/v1')
        throw new TypeError('Foreign Harness material is not import authority');
    const result = validateDocument(d);
    if (!result.valid)
        throw new TypeError('Unknown or invalid historical schema/kind/version: ' + JSON.stringify(result.errors));
    if (PROFESSIONAL_PACK_KINDS.includes(d.kind))
        validateProfessionalPack(d);
    if (d.kind === 'Taxonomy')
        resolveTaxonomy(d);
    if (/^evopilot-harness-(project-ontology-(proposal|artifact-set|skill)|resolved-project-ontology-snapshot)\/v1$/.test(d.schema))
        validateProjectOntologyDocument(d);
    if (/^evopilot-harness-(ontology-reasoning-profile|semantic-index|affected-subgraph|semantic-computation|federated-pack-discovery|semantic-interoperability-projection-set|semantic-round-trip-report|terminal-semantic-closure|terminal-semantic-slice)\/v1$/.test(d.schema))
        validateSemanticInteroperabilityDocument(d);
    if (d.schema === 'evopilot-harness-semantic-catalog/v1')
        validateSemanticGeneration(d);
    if (d.schema === 'evopilot-harness-semantic-catalog-pointer/v1')
        validateSemanticPointer(d);
    // Historical self-digests are distinct from references to other documents.
    // Explicit schema-owned digest fields avoid treating dependency digests as self-digests.
    const selfFields = { 'classification-analysis-receipt': 'receiptDigest', 'classification-session': 'sessionDigest', 'classification-handoff': 'handoffDigest', 'source-concept-hypothesis': 'hypothesisDigest', 'taxonomy-analysis-result': 'analysisResultDigest', 'ontology-grounding-result': 'groundingResultDigest', 'external-semantic-evidence': 'evidencePackageDigest', 'external-semantic-evidence-adapter': 'adapterDigest', 'pack-benchmark': 'benchmarkDigest', 'pack-certification': 'certificationDigest', 'pack-gold-case': 'goldCaseDigest', 'semantic-catalog-lock': 'lockDigest', 'semantic-catalog-recovery': 'recoveryDigest', 'project-ontology-projection-set': 'projectionSetDigest', 'semantic-compatibility-report': 'compatibilityReportDigest', 'resolved-project-ontology-snapshot': 'snapshotDigest', 'project-ontology-proposal': 'proposalDigest', 'project-ontology-artifact-set': 'artifactSetDigest', 'project-ontology-skill': 'skillDigest', 'resolved-professional-pack-set': 'packSetDigest', 'resolved-taxonomy-snapshot': 'taxonomyDigest', 'classification-evaluation-report': 'reportDigest', 'ontology-foundation': 'foundationDigest', 'semantic-candidate-set': 'candidateSetDigest', 'pack-lifecycle-record': 'recordDigest', 'project-ontology-artifact-lifecycle': 'recordDigest', 'professional-pack-inspection': 'inspectionDigest', 'semantic-catalog-receipt': 'receiptDigest' };
    const name = d.schema?.replace('evopilot-harness-', '').replace('/v1', '');
    if (selfFields[name])
        validateSupplyDigest(d, selfFields[name], d.schema);
    for (const nested of [d.resolvedPackSet, d.spec?.snapshot, d.spec?.projectOntologySkill])
        if (nested)
            validateHistorical(nested);
    return selfFields[name] ?? { 'semantic-catalog': 'generationDigest', 'semantic-catalog-pointer': 'pointerDigest', 'ontology-reasoning-profile': 'profileDigest', 'semantic-index': 'indexDigest', 'affected-subgraph': 'affectedSubgraphDigest', 'semantic-computation': 'computationDigest', 'federated-pack-discovery': 'discoveryDigest', 'semantic-interoperability-projection-set': 'projectionSetDigest', 'semantic-round-trip-report': 'reportDigest', 'terminal-semantic-closure': 'closureDigest', 'terminal-semantic-slice': 'sliceDigest' }[name] ?? null;
}
function inspect(input, options) {
    assertJSON(input);
    const document = input;
    if (!document || typeof document !== 'object' || Array.isArray(document))
        throw new TypeError('Expected historical document');
    const documentDigest = sha256(document);
    if (options.expectedDocumentDigest && options.expectedDocumentDigest !== documentDigest)
        throw new TypeError('Document digest drift');
    const digestField = validateHistorical(document);
    return { type: 'LegacySourceInspection', valid: true, status: 'INSPECTED', documentDigest,
        sourceLocator: options.sourceLocator, sourceRevision: options.sourceRevision, sourceVisibility: options.sourceVisibility,
        observed: { schema: document.schema ?? null, apiVersion: document.apiVersion ?? null, kind: document.kind ?? null, id: document.metadata?.id ?? document.id ?? null, version: document.metadata?.version ?? document.version ?? null, digest: document.metadata?.digest ?? document.digest ?? document[digestField] ?? null, status: document.status ?? null, lifecycle: document.metadata?.lifecycle ?? null },
        preservation: { status: 'PENDING_PRODUCT_IMPORT', completeDocument: document, canonicalJSON: stableSerialize(document), sourceSemantics: 'PRESERVED_IN_ORIGINAL_DOCUMENT', originalBytesAvailable: false }, ...authority };
}
export function inspectLegacySource(document, options) {
    try {
        optionsFor(options, false);
        return frozenClone(inspect(document, options));
    }
    catch (error) {
        return rejected('LegacySourceInspection', error);
    }
}
export function deriveLegacyModel(input, options) {
    try {
        optionsFor(options, true);
        const inspection = inspect(input, options);
        // inspect has run the historical schema-specific validators.
        const document = input;
        let groups = [];
        if (PROFESSIONAL_PACK_KINDS.includes(document.kind) || document.kind === 'OntologyPack')
            groups = [['/spec/concepts', document.spec.concepts]];
        else if (document.kind === 'Taxonomy')
            groups = [['/spec/domains', document.spec.domains], ['/spec/products', document.spec.products]];
        else if (document.schema === 'evopilot-harness-resolved-project-ontology-snapshot/v1')
            groups = [['/concepts', document.concepts]];
        else if (document.schema === 'evopilot-harness-project-ontology-proposal/v1')
            groups = [['/resolvedPackSet/concepts', document.resolvedPackSet.concepts]];
        else if (document.kind === 'ProjectOntologyArtifactSet')
            groups = [['/spec/snapshot/concepts', document.spec.snapshot.concepts]];
        if (!groups.some(([, rows]) => rows?.length))
            return frozenClone({ type: 'LegacyModelDerivation', valid: false, status: 'NO_MODEL_PROJECTION', inspection, ...authority });
        const model = { id: options.id, version: options.version, visibility: options.visibility, product: 'ontology', specVersion: 'v1', provenance: { direction: 'reverse', sources: [] }, dependencies: [], extensions: [], concepts: [], properties: [], relations: [], constraints: [], sourceMappings: [], unresolvedIssues: [] };
        const mappings = [], gaps = [], used = new Set(), covered = new Set();
        const fresh = (base) => { let id = base; while (used.has(id))
            id += '-'; used.add(id); return id; };
        const rows = groups.flatMap(([base, values]) => values.map((row, i) => ({ row, pointer: `${base}/${i}`, base })));
        for (const { row } of rows) {
            textField(row.conceptId ?? row.id);
            if (used.has(row.conceptId ?? row.id))
                throw new TypeError('Ambiguous duplicate concept identity');
            used.add(row.conceptId ?? row.id);
        }
        const source = (pointer, status) => {
            const s = { id: fresh('legacy-source'), kind: status === 'inferred' ? 'legacy-derivation' : 'historical-document', locator: options.sourceLocator + '#' + pointer, revision: options.sourceRevision, digest: inspection.documentDigest, status };
            model.provenance.sources.push(s);
            return s;
        };
        const map = (targetRef, pointer, status, targetPointer) => {
            const s = source(pointer, status);
            model.sourceMappings.push({ id: fresh('legacy-mapping'), targetRef, sourceRef: s.id, sourceLocator: s.locator, sourceRevision: s.revision, status });
            mappings.push({ sourcePointer: pointer, targetPointer, status });
            covered.add(pointer);
        };
        const gap = (targetRef, pointer, reason) => {
            model.unresolvedIssues.push({ id: fresh('legacy-issue'), targetRef, description: `${reason}: ${pointer}`, required: true });
            gaps.push({ sourcePointer: pointer, targetRef, reason, required: true });
        };
        rows.forEach(({ row, pointer }, i) => {
            const id = row.conceptId ?? row.id, definition = row.definition;
            model.concepts.push({ id, label: row.label ?? id, definition: definition ?? 'UNCONFIRMED: business definition requires review.' });
            for (const key of [row.conceptId ? 'conceptId' : 'id', ...(row.label ? ['label'] : []), ...(definition ? ['definition'] : [])])
                map(id, `${pointer}/${key}`, 'source-observed', `/concepts/${i}/${key === 'conceptId' ? 'id' : key}`);
            if (!row.label) {
                map(id, pointer, 'inferred', `/concepts/${i}/label`);
            }
            if (!definition) {
                map(id, pointer, 'inferred', `/concepts/${i}/definition`);
                gap(id, pointer, 'MISSING_BUSINESS_DEFINITION');
            }
            for (const key of Object.keys(row))
                if (!['conceptId', 'id', 'label', 'definition', 'parents', 'relationships', 'aliases', 'terms', 'evidenceRefs', 'provenance', 'sourcePack', 'metaType'].includes(key) && row[key] != null && row[key] !== false && (!Array.isArray(row[key]) || row[key].length))
                    gap(id, `${pointer}/${escape(key)}`, 'UNREPRESENTED_CONCEPT_SEMANTICS');
        });
        for (const { row, pointer, base } of rows) {
            const from = row.conceptId ?? row.id;
            for (const [i, to] of (row.parents ?? []).entries()) {
                const p = `${pointer}/parents/${i}`;
                if (!rows.some(r => (r.row.conceptId ?? r.row.id) === to && r.base === base)) {
                    gap(from, p, 'MISSING_REFERENCED_CONCEPT');
                    continue;
                }
                const id = fresh(`parent:${from}:${to}`), index = model.relations.length;
                model.relations.push({ id, from, to, directed: true });
                map(id, p, 'source-observed', `/relations/${index}`);
            }
            for (const [i, relation] of (row.relationships ?? []).entries()) {
                const p = `${pointer}/relationships/${i}`;
                if (relation && typeof relation === 'object' && Object.keys(relation).every(k => ['id', 'from', 'to', 'directed'].includes(k)) && relation.from === from && relation.directed === true && rows.some(r => (r.row.conceptId ?? r.row.id) === relation.to)) {
                    const id = fresh(relation.id ?? 'legacy-relation'), index = model.relations.length;
                    model.relations.push({ id, from, to: relation.to, directed: true });
                    map(id, p, 'source-observed', `/relations/${index}`);
                }
                else
                    gap(from, p, 'UNSUPPORTED_RELATIONSHIP');
            }
        }
        const preserved = [];
        const walk = (value, pointer = '') => {
            if (covered.has(pointer))
                return;
            if (value && typeof value === 'object' && Object.keys(value).length)
                for (const k of Object.keys(value).sort())
                    walk(value[k], `${pointer}/${escape(k)}`);
            else
                preserved.push({ sourcePointer: pointer, disposition: 'PRESERVED_IN_ORIGINAL_ONLY', equivalentSemantics: false });
        };
        walk(document);
        const semanticFields = new Set(['rules', 'shapes', 'constraints', 'properties', 'equivalences', 'replacements', 'deprecations', 'imports', 'roles', 'axisPolicies', 'overlay']);
        const scan = (v, p = '') => { if (!v || typeof v !== 'object')
            return; for (const [k, val] of Object.entries(v)) {
            const ptr = `${p}/${escape(k)}`;
            if (semanticFields.has(k) && val != null && (typeof val !== 'object' || Object.keys(val).length))
                gap(model.concepts[0].id, ptr, 'UNSUPPORTED_CORE_SEMANTICS');
            else
                scan(val, ptr);
        } };
        scan(document);
        const validation = validateOntology(model);
        if (!validation.valid)
            throw new TypeError('Native derivation invalid: ' + JSON.stringify(validation.errors));
        return frozenClone({ type: 'LegacyModelDerivation', valid: true, status: validation.status, model, validation, inspection, coverage: { mappings, gaps, preserved, fullSemanticRoundTrip: false }, ...authority });
    }
    catch (error) {
        return rejected('LegacyModelDerivation', error);
    }
}
