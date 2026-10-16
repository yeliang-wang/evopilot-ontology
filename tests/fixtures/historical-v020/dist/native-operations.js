import { exactFields, textField, sha256, stableSerialize } from '../vendor/compatibility/v1/reference.mjs';
import { validateOntology } from './specification.js';
import { buildDelivery, verifyDelivery } from './delivery.js';
import { fail, LIMITS, slug } from './state.js';
import { importOperations, importMutations, importFields, operateImport } from './import-operations.js';
import { producerOperations, producerMutations, validateProducerRequest, operateProducer } from './producer-operations.js';
import { legacyQueryOperations, validateLegacyQuery, operateLegacyQuery } from './legacy-queries.js';
import { catalogOperations, catalogMutations, validateCatalogRequest, operateCatalog } from './catalog-operations.js';
import { classificationOperations, classificationMutations, validateClassificationRequest, operateClassification } from './classification-operations.js';
export const operations = Object.freeze([...classificationOperations, ...catalogOperations, ...producerOperations, ...legacyQueryOperations, ...importOperations, 'workspace.inspect', 'receipt.inspect', 'asset.put', 'asset.inspect', 'asset.list', 'asset.review', 'asset.decide', 'asset.publish']);
export const mutations = Object.freeze([...classificationMutations, ...catalogMutations, ...producerMutations, ...importMutations, 'asset.put', 'asset.review', 'asset.decide', 'asset.publish']);
export function validateRequest(request) {
    const r = request;
    if (!operations.includes(r.operation))
        fail('UNSUPPORTED_OPERATION', 'Operation is outside this service slice');
    const write = mutations.includes(r.operation);
    exactFields(r, ['operation', 'scope', 'input', ...(write ? ['requestId', 'expectedRevision'] : [])]);
    exactFields(r.scope, ['visibility', 'projectId']);
    slug(r.scope.projectId);
    if (!['public', 'private'].includes(r.scope.visibility))
        fail('INVALID_REQUEST', 'Explicit visibility required');
    if (write) {
        slug(r.requestId);
        if (!Number.isSafeInteger(r.expectedRevision) || r.expectedRevision < 0)
            fail('INVALID_REQUEST', 'Expected nonnegative revision');
    }
    if (classificationOperations.includes(r.operation)) {
        validateClassificationRequest(r);
        return write;
    }
    if (catalogOperations.includes(r.operation)) {
        validateCatalogRequest(r);
        return write;
    }
    if (producerOperations.includes(r.operation)) {
        validateProducerRequest(r);
        return write;
    }
    if (legacyQueryOperations.includes(r.operation)) {
        validateLegacyQuery(r);
        return false;
    }
    const fields = { ...importFields,
        'workspace.inspect': [], 'receipt.inspect': ['requestId'], 'asset.put': ['model'],
        'asset.inspect': ['id', 'version'], 'asset.list': [], 'asset.review': ['id', 'version'],
        'asset.decide': ['id', 'version', 'reviewDigest', 'decision', 'humanEvidenceRef'],
        'asset.publish': ['id', 'version'],
    };
    exactFields(r.input, fields[r.operation]);
    for (const field of fields[r.operation])
        if (field !== 'model' && field !== 'raw')
            textField(r.input[field]);
    if (r.operation === 'legacy.import' && typeof r.input.raw !== 'string')
        fail('INVALID_REQUEST', 'Raw input must be a string');
    if (r.operation === 'receipt.inspect')
        slug(r.input.requestId);
    if (r.operation === 'asset.decide' && (!['APPROVE', 'REJECT'].includes(r.input.decision) || !/^sha256:[a-f0-9]{64}$/.test(r.input.reviewDigest)))
        fail('INVALID_REQUEST', 'Explicit decision and review digest required');
    return write;
}
export function operate(store, state, r) {
    if (classificationOperations.includes(r.operation))
        return operateClassification(store, state, r);
    if (catalogOperations.includes(r.operation))
        return operateCatalog(store, state, r);
    if (producerOperations.includes(r.operation))
        return operateProducer(store, state, r);
    if (legacyQueryOperations.includes(r.operation))
        return operateLegacyQuery(store, state, r);
    if (importOperations.includes(r.operation))
        return operateImport(store, state, r, operate);
    const scopeKey = stableSerialize(r.scope);
    const own = (a) => stableSerialize(a.scope) === scopeKey;
    const find = () => {
        const a = state.assets.find(a => own(a) && a.model.id === r.input.id && a.model.version === r.input.version);
        if (!a)
            fail('NOT_FOUND', 'Asset not found in scope');
        store.verifyBlob(a.scope, a.model);
        if (a.delivery)
            store.verifyBlob(a.scope, a.delivery);
        return a;
    };
    if (r.operation === 'asset.list')
        return state.assets.filter(own).map(a => ({ id: a.model.id, version: a.model.version, digest: a.digest, published: !!a.delivery }));
    if (r.operation === 'asset.put') {
        const model = r.input.model;
        const validation = validateOntology(model);
        if (!validation.valid)
            fail('INVALID_MODEL', 'Ontology model failed validation');
        if (model.visibility !== r.scope.visibility)
            fail('SCOPE_MISMATCH', 'Model visibility differs from scope');
        const prior = state.assets.find(a => own(a) && a.model.id === model.id && a.model.version === model.version);
        if (prior?.delivery)
            fail('IMMUTABLE_VERSION', 'Published id/version cannot change');
        if (!prior && state.assets.length >= LIMITS.assets)
            fail('LIMIT', 'Asset count limit');
        const digest = store.blob(r.scope, model);
        const asset = { scope: r.scope, model, digest, validation, review: null, decision: null, delivery: null };
        if (prior)
            state.assets[state.assets.indexOf(prior)] = asset;
        else
            state.assets.push(asset);
        return { id: model.id, version: model.version, digest, validation };
    }
    const a = find();
    if (r.operation === 'asset.inspect')
        return a;
    if (a.delivery)
        fail('IMMUTABLE_VERSION', 'Published id/version is immutable');
    const reviewSubject = () => ({ workspace: store.identity, scope: a.scope, assetDigest: a.digest, validation: validateOntology(a.model) });
    if (r.operation === 'asset.review') {
        const content = reviewSubject();
        a.review = { ...content, reviewDigest: sha256(content) };
        a.decision = null;
        return a.review;
    }
    const currentReview = () => {
        const current = reviewSubject();
        if (!a.review || a.review.reviewDigest !== sha256(current))
            fail('REVIEW_REQUIRED', 'Current exact review required');
    };
    currentReview();
    if (r.operation === 'asset.decide') {
        if (r.input.reviewDigest !== a.review.reviewDigest)
            fail('REVIEW_MISMATCH', 'Decision must bind exact review');
        a.decision = { reviewDigest: r.input.reviewDigest, decision: r.input.decision, humanEvidenceRef: r.input.humanEvidenceRef, uid: store.uid };
        return a.decision;
    }
    if (!a.decision || a.decision.decision !== 'APPROVE' || a.decision.reviewDigest !== a.review.reviewDigest)
        fail('APPROVAL_REQUIRED', 'Exact human approval required');
    if (validateOntology(a.model).status !== 'VALID')
        fail('PENDING_MODEL', 'Only VALID models may publish');
    for (const ref of a.model.dependencies) {
        const dependency = state.assets.find(d => d.scope.projectId === r.scope.projectId && d.scope.visibility === ref.visibility && d.model.id === ref.id && d.model.version === ref.version && d.delivery);
        if (ref.product !== 'ontology' || !dependency || dependency.delivery.digest !== ref.digest || (a.model.visibility === 'public' && ref.visibility !== 'public'))
            fail('UNSUPPORTED_DEPENDENCY', 'Exact published own Ontology dependency required');
        store.verifyBlob(dependency.scope, dependency.model);
        store.verifyBlob(dependency.scope, dependency.delivery);
        if (!verifyDelivery(dependency.delivery).valid)
            fail('CORRUPT_STATE', 'Invalid dependency delivery');
    }
    const delivery = buildDelivery(a.model);
    if (!verifyDelivery(delivery).valid)
        fail('INVALID_DELIVERY', 'Delivery failed verification');
    const blobDigest = store.blob(a.scope, delivery);
    a.delivery = delivery;
    return { reference: { product: 'ontology', id: a.model.id, version: a.model.version, specVersion: 'v1', visibility: a.model.visibility, digest: delivery.digest }, blobDigest, delivery };
}
