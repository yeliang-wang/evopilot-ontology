import { inspectReference } from '../vendor/compatibility/v1/reference.mjs';
export { validateOntology } from './specification.js';
export { validateInstances } from './instances.js';
export { buildDelivery, verifyDelivery } from './delivery.js';

export const VERSION = '0.1.1';
export const PRODUCT = 'ontology';

export function capabilities() {
  return Object.freeze({
    product: PRODUCT,
    version: VERSION,
    implementationStage: 'M2_OWNED_SERVICE',
    businessOperationsReady: true,
    persistentBusinessOperationsReady: true,
    pureApi: Object.freeze(['validateOntology', 'validateInstances', 'buildDelivery', 'verifyDelivery']),
    serviceApi: Object.freeze({ subpath: '@evopilot-next/ontology/service', factory: 'createOntologyService', methods: Object.freeze(['capabilities', 'initialize', 'execute', 'classify', 'close']) }),
    cli: 'evopilot-next-ontology',
    hostReady: false,
    productionReady: false,
    authority: false,
    referenceApi: Object.freeze(['inspectArtifactReference']),
  });
}

export function inspectArtifactReference(ref: unknown, observed: unknown) {
  return inspectReference(ref, observed, { product: 'ontology' });
}

export type * from "./types.js";
