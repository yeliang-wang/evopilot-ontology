// Generated from schemas/v2/candidate.schema.json; edit the schema, then regenerate.
import type { Identifier as model_Identifier } from "./model-contracts.js";
import type { SHA256 as model_SHA256 } from "./model-contracts.js";
export type Identifier = model_Identifier;
export type SHA256 = model_SHA256;
export type TaskBinding = { readonly "taskId": Identifier; readonly "requestDigest": SHA256; readonly "resultDigest": SHA256; readonly "configurationDigest": SHA256; readonly "toolchainDigest": SHA256; };
export type ReviewCandidate = { readonly "schema": "ontology-review-candidate/v2"; readonly "identity": { readonly "workspaceId": Identifier; readonly "serviceId": Identifier; readonly "projectId": Identifier; readonly "assetId": Identifier; readonly "version": Identifier; }; readonly "previousDeliveryDigest": (SHA256 | null); readonly "intentDigest": SHA256; readonly "sourceSetDigest": SHA256; readonly "modelDigest": SHA256; readonly "expectationsDigest": SHA256; readonly "closureDigest": SHA256; readonly "validation": TaskBinding; readonly "explanations": readonly (TaskBinding)[]; readonly "viewKind": "asserted" | "derived"; readonly "viewDigest": SHA256; readonly "projectionDigest": (SHA256 | null); readonly "requirementIds": readonly (Identifier)[]; };
