// Generated from schemas/v2/expectations.schema.json; edit the schema, then regenerate.
import type { Identifier as model_Identifier } from "./model-contracts.js";
import type { ModelClosure as model_ModelClosure } from "./model-contracts.js";
import type { SHA256 as model_SHA256 } from "./model-contracts.js";
import type { IRI as shacl_IRI } from "./shacl-contracts.js";
import type { RequiredShape as shacl_RequiredShape } from "./shacl-contracts.js";
export type Identifier = model_Identifier;
export type SHA256 = model_SHA256;
export type ModelClosure = model_ModelClosure;
export type RequiredShape = shacl_RequiredShape;
export type IRI = shacl_IRI;
export type RequirementExpectation = { readonly "requirementId": Identifier; readonly "sourceFragmentIds": readonly (Identifier)[]; readonly "methods": readonly ("owl" | "shacl")[]; readonly "rationale": string; readonly "targetShapeIris": readonly (IRI)[]; readonly "constraintShapeIris": readonly (IRI)[]; };
export type OWLQuery = { readonly "format": "turtle" | "rdfxml" | "functional"; readonly "content": string; readonly "digest": SHA256; };
export type OWLCase = { readonly "id": Identifier; readonly "requirementIds": readonly (Identifier)[]; readonly "sourceFragmentIds": readonly (Identifier)[]; readonly "rationale": string; readonly "kind": "owl-entailment"; readonly "query": OWLQuery; readonly "expectedStatus": "ENTAILED" | "NOT_ENTAILED"; };
export type SHACLCase = { readonly "id": Identifier; readonly "requirementIds": readonly (Identifier)[]; readonly "sourceFragmentIds": readonly (Identifier)[]; readonly "rationale": string; readonly "kind": "shacl"; readonly "closure": ModelClosure; readonly "expectedConforms": boolean; readonly "expectedViolationShapeIris": readonly (IRI)[]; };
export type ExpectationSet = { readonly "schema": "ontology-expectations/v2"; readonly "assetId": Identifier; readonly "intentDigest": SHA256; readonly "sourceSetDigest": SHA256; readonly "previousDigest": (SHA256 | null); readonly "requirements": readonly (RequirementExpectation)[]; readonly "requiredShapes": readonly (RequiredShape)[]; readonly "cases": readonly ((OWLCase | SHACLCase))[]; };
