import type { Scope, ServiceRequest, OntologyModel, Receipt } from '@evopilot-next/ontology';
import { validateOntology, buildDelivery } from '@evopilot-next/ontology';
import { createOntologyService, type ClassificationReceipt } from '@evopilot-next/ontology/service';

const scope: Scope = { visibility: 'private', projectId: 'sample' };
const inspect: ServiceRequest = { operation: 'workspace.inspect', scope, input: {} };
// @ts-expect-error Scope visibility is a closed vocabulary.
const wrongScope: Scope = { visibility: 'organization', projectId: 'sample' };
// @ts-expect-error Asset inspection requires an exact version field.
const wrongRequest: ServiceRequest = { operation: 'asset.inspect', scope, input: { id: 'sample', revision: 1 } };
// @ts-expect-error Mutations require a request identity and CAS revision.
const missingCAS: ServiceRequest = { operation: 'asset.publish', scope, input: { id: 'sample', version: '1.0.0' } };
function consumer(model: OntologyModel, receipt: Receipt<{ digest: string }>) {
  const report = validateOntology(model);
  if (report.valid && report.status === 'VALID') buildDelivery(model);
  return receipt.result.digest;
}
void [inspect, wrongScope, wrongRequest, missingCAS, consumer];

// Compile actual calls against the package's emitted public exports.
const service = createOntologyService({ workspaceRoot: '/explicit-type-consumer', workspaceId: 'sample' });
const workspace = service.execute({ operation: 'workspace.inspect', scope, input: {} });
const revision: number = workspace.revision;
const asset = service.execute({ operation: 'asset.inspect', scope, input: { id: 'sample', version: '1.0.0' } });
const model: OntologyModel = asset.model;
const valid: boolean = asset.validation.valid;
const deliveryDigest: string | undefined = asset.delivery?.digest;
const put = service.execute({ operation: 'asset.put', scope, input: { model }, requestId: 'put', expectedRevision: revision });
const putDigest: string = put.result.digest;
const putOperation: 'asset.put' = put.operation;
const review = service.execute({ operation: 'asset.review', scope, input: { id: 'sample', version: '1.0.0' }, requestId: 'review', expectedRevision: put.revision });
const reviewDigest: string = review.result.reviewDigest;
const publish = service.execute({ operation: 'asset.publish', scope, input: { id: 'sample', version: '1.0.0' }, requestId: 'publish', expectedRevision: review.revision });
const publishedModel: OntologyModel = publish.result.delivery.model;
const source = service.execute({ operation: 'source.inspect', scope, input: { sourceId: 'source' } });
const raw: string = source.raw;
const admission: Promise<ClassificationReceipt> = service.classify({ operation: 'classification.start', scope, input: { id: 'session', sourceId: 'source', taxonomy: {} }, requestId: 'classify', expectedRevision: revision });
admission.then(receipt => { const attemptId: string = receipt.result.attemptId; const status: 'PENDING' = receipt.result.status; return [attemptId, status]; });
// @ts-expect-error Invalid visibility is rejected by the actual factory API.
service.execute({ operation: 'workspace.inspect', scope: { visibility: 'organization', projectId: 'sample' }, input: {} });
// @ts-expect-error Inspection requires an exact version.
service.execute({ operation: 'asset.inspect', scope, input: { id: 'sample' } });
// @ts-expect-error Mutation requires CAS, even with a request identity.
service.execute({ operation: 'asset.publish', scope, input: { id: 'sample', version: '1.0.0' }, requestId: 'publish' });
// @ts-expect-error Wrong native input fields cannot fall through a historical overload.
service.execute({ operation: 'asset.inspect', scope, input: { id: 'sample', version: '1.0.0', revision: 1 } });
// @ts-expect-error Operation vocabulary is closed.
service.execute({ operation: 'asset.inpsect', scope, input: { id: 'sample', version: '1.0.0' } });
// @ts-expect-error Classification has its own closed asynchronous request boundary.
service.classify({ operation: 'classification.inspect', scope, input: { id: 'session' } });
// @ts-expect-error Classification dispatch requires CAS.
service.classify({ operation: 'classification.start', scope, input: { id: 'session', sourceId: 'source', taxonomy: {} }, requestId: 'classify' });
void [valid, deliveryDigest, putDigest, putOperation, reviewDigest, publishedModel, raw];
service.close();

import type { NativePackage, NativeOntologyValidation, NativeOntologyRecord, NativeToolchain } from '@evopilot-next/ontology';
async function nativeContracts(service:ReturnType<typeof createOntologyService>,pkg:NativePackage,toolchain:NativeToolchain){
 const standard=await service.native({operation:'standard.inspect',scope,input:{}});
 const digest:string=standard.standardDigest;
 const record:NativeOntologyRecord=await service.native({operation:'native.package.inspect',scope,input:{id:'example',version:'1.0.0'}});
 const receipt=await service.native({operation:'native.package.validate',scope,input:{id:'example',version:'1.0.0'},requestId:'validate',expectedRevision:0});
 if(receipt.result.status!=='RUNNING'){const result:NativeOntologyValidation=receipt.result;const ids:string[]=result.criteria.map(c=>c.criterionId);void ids;}
 // @ts-expect-error native mutation requires CAS and request identity
 await service.native({operation:'native.package.put',scope,input:{package:pkg}});
 void [digest,record,toolchain];
}
void nativeContracts;
