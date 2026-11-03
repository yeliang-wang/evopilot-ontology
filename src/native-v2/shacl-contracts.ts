// Generated from schemas/v2/shacl.schema.json; edit the schema, then regenerate.
import type { Identifier as ModelIdentifier, ModelClosure as ModelModelClosure, ModelDocument as ModelModelDocument, OptionalIRI as ModelOptionalIRI, SHA256 as ModelSHA256 } from './model-contracts.js';
export type Identifier = ModelIdentifier;
export type SHA256 = ModelSHA256;
export type OptionalIRI = ModelOptionalIRI;
export type ModelDocument = ModelModelDocument;
export type ModelClosure = ModelModelClosure;
export type IRI = string;
export type RequiredShape = { readonly "shapeIri": IRI; readonly "requiredFocusIris": readonly (IRI)[]; readonly "minimumFocusCount": number; };
export type SHACLRequest = { readonly "schema": "ontology-shacl-request/v2"; readonly "requestId": Identifier; readonly "modelDigest": SHA256; readonly "view": { readonly "kind": "asserted"; readonly "closure": ModelClosure; }; readonly "shapes": readonly (ModelDocument)[]; readonly "expectations": { readonly "digest": SHA256; readonly "requiredShapes": readonly (RequiredShape)[]; }; };
