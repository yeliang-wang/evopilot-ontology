import { inspectReference } from '../vendor/compatibility/v1/reference.mjs';
export { validateOntology } from './specification.mjs';
export { validateInstances } from './instances.mjs';
export { buildDelivery, verifyDelivery } from './delivery.mjs';

export const VERSION = '0.1.0';
export const PRODUCT = 'ontology';

export function capabilities() {
  return Object.freeze({
    product: PRODUCT,
    version: VERSION,
    implementationStage: 'M1_FOUNDATION',
    businessOperationsReady: false,
    persistentBusinessOperationsReady: false,
    pureApi: Object.freeze(['validateOntology', 'validateInstances', 'buildDelivery', 'verifyDelivery']),
    authority: false,
    referenceApi: Object.freeze(['inspectArtifactReference']),
  });
}

export function inspectArtifactReference(ref, observed) {
  return inspectReference(ref, observed, { product: 'ontology' });
}
