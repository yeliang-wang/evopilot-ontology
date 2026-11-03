// Generated from schemas/v2/shacl.schema.json; edit the schema, then regenerate.
import type { Identifier as model_Identifier } from "./model-contracts.js";
import type { ModelClosure as model_ModelClosure } from "./model-contracts.js";
import type { ModelDocument as model_ModelDocument } from "./model-contracts.js";
import type { OptionalIRI as model_OptionalIRI } from "./model-contracts.js";
import type { SHA256 as model_SHA256 } from "./model-contracts.js";
export type Identifier = model_Identifier;
export type SHA256 = model_SHA256;
export type OptionalIRI = model_OptionalIRI;
export type ModelDocument = model_ModelDocument;
export type ModelClosure = model_ModelClosure;
export type IRI = string;
export type RequiredShape = { readonly "shapeIri": IRI; readonly "requiredFocusIris": readonly (IRI)[]; readonly "minimumFocusCount": number; };
export type AssertedView = { readonly "kind": "asserted"; readonly "closure": ModelClosure; };
export type DerivedView = { readonly "kind": "derived"; readonly "closure": ModelClosure; readonly "projectionDigest": SHA256; readonly "document": ModelDocument; };
export type SHACLRequest = { readonly "schema": "ontology-shacl-request/v2"; readonly "requestId": Identifier; readonly "modelDigest": SHA256; readonly "view": (AssertedView | DerivedView); readonly "shapes": readonly (ModelDocument)[]; readonly "expectations": { readonly "digest": SHA256; readonly "requiredShapes": readonly (RequiredShape)[]; }; };
