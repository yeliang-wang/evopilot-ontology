import { inspectReference } from '../vendor/compatibility/v1/reference.mjs';
export { validateOntology } from './specification.js';
export { validateInstances } from './instances.js';
export { buildDelivery, verifyDelivery } from './delivery.js';
export { inspectOntologyStandard } from './native/standard.js';
export { validateOntologyPackage } from './native/package.js';
export { validateNativeOntology, verifyOntologyToolchain } from './native/validator.js';
export type * from './native/types.js';

export const VERSION = '0.8.3';
export const PRODUCT = 'ontology';

export function capabilities() {
  return Object.freeze({
    product: PRODUCT,
    version: VERSION,
    implementationStage: 'NATIVE_STANDARDS',
    businessOperationsReady: true,
    persistentBusinessOperationsReady: true,
    pureApi: Object.freeze(['inspectOntologyStandard','validateOntologyPackage']),
    nativeValidationApi: 'validateNativeOntology',
    historicalPureApi: Object.freeze(['validateOntology', 'validateInstances', 'buildDelivery', 'verifyDelivery']),
    serviceApi: Object.freeze({ subpath: '@evopilot-next/ontology/service', factory: 'createOntologyService', methods: Object.freeze(['capabilities', 'initialize', 'execute', 'native', 'close']) }),
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

export {READINESS_CLOSURE,READINESS_FACETS,READINESS_SPEC_PATH,READINESS_STANDARD,READINESS_STANDARD_DIGEST,assertReadinessVersion,boundedReadiness,noReconstruction,readinessBytesDigest,readinessCriteria,readinessDigest,readinessFail,readinessId,readinessPath,readinessText,validateReadinessIntent,validateReadinessReconstruction,validateReadinessReview,validateReadinessSpecification,verifyReadinessProjection} from '../vendor/compatibility/usability/v2/contract.mjs';
export type {ReadinessLevel,ReadinessSource,ReadinessRequirement,ReadinessIntent,ReadinessIntentRecord,ReadinessCitation,ReadinessStatement,ReadinessSpecification,ReadinessProjection,ReadinessReview,ReadinessReconstruction,ReadinessResult} from '../vendor/compatibility/usability/v2/contract.mjs';
export {projectReadinessPackage} from './readiness.js';
