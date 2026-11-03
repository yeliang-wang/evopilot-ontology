// Generated from schemas/v2/delivery.schema.json; edit the schema, then regenerate.
import type { Identifier as model_Identifier } from "./model-contracts.js";
import type { SHA256 as model_SHA256 } from "./model-contracts.js";
export type Identifier = model_Identifier;
export type SHA256 = model_SHA256;
export type Part = { readonly "id": Identifier; readonly "kind": "candidate" | "decision" | "intent" | "source-set" | "expectations" | "model" | "validation" | "explanation" | "derived-view" | "projection-task"; readonly "digest": SHA256; readonly "content": string; };
export type DeliveryBundle = { readonly "schema": "ontology-delivery-bundle/v2"; readonly "identity": { readonly "workspaceId": Identifier; readonly "serviceId": Identifier; readonly "projectId": Identifier; readonly "assetId": Identifier; readonly "version": Identifier; }; readonly "candidateDigest": SHA256; readonly "reviewDigest": SHA256; readonly "previousDeliveryDigest": (SHA256 | null); readonly "publisherPrincipalId": Identifier; readonly "recordedAt": string; readonly "visibility": "private"; readonly "parts": readonly (Part)[]; };
