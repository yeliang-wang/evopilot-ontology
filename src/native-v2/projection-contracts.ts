// Generated from schemas/v2/projection.schema.json; edit the schema, then regenerate.
import type { Identifier as model_Identifier } from "./model-contracts.js";
import type { SHA256 as model_SHA256 } from "./model-contracts.js";
export type Identifier = model_Identifier;
export type SHA256 = model_SHA256;
export type IRI = string;
export type TaskBinding = { readonly "taskId": Identifier; readonly "requestDigest": SHA256; readonly "resultDigest": SHA256; readonly "configurationDigest": SHA256; readonly "toolchainDigest": SHA256; readonly "kind": "classHierarchy" | "objectPropertyHierarchy" | "dataPropertyHierarchy" | "realization" | "identity"; readonly "direct": (boolean | null); readonly "entities": readonly (IRI)[]; readonly "omittedInverseExpressions": number; };
export type Triple = { readonly "subject": IRI; readonly "predicate": IRI; readonly "object": IRI; readonly "taskIds": readonly (Identifier)[]; };
export type DerivedView = { readonly "schema": "ontology-derived-view/v2"; readonly "assetId": Identifier; readonly "modelDigest": SHA256; readonly "sourceSetDigest": SHA256; readonly "closureDigest": SHA256; readonly "scope": "NAMED_REQUESTED_ENTITIES"; readonly "composition": "ASSERTED_PLUS_NAMED_PROJECTION"; readonly "allLogicalConsequences": false; readonly "tasks": readonly (TaskBinding)[]; readonly "triples": readonly (Triple)[]; };
