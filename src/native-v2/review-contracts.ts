// Generated from schemas/v2/review.schema.json; edit the schema, then regenerate.
import type { Identifier as model_Identifier } from "./model-contracts.js";
import type { SHA256 as model_SHA256 } from "./model-contracts.js";
export type Identifier = model_Identifier;
export type SHA256 = model_SHA256;
export type ReviewDecision = { readonly "schema": "ontology-review-decision/v2"; readonly "candidateDigest": SHA256; readonly "reportDigest": SHA256; readonly "previousDigest": (SHA256 | null); readonly "decision": "APPROVE" | "REJECT"; readonly "principalId": Identifier; readonly "grantId": Identifier; readonly "requirementIds": readonly (Identifier)[]; readonly "rationale": string; readonly "instruction": { readonly "reference": string; readonly "content": string; }; readonly "instructionDigest": SHA256; readonly "instructionVerification": "AUTHENTICATED_REVIEWER_SUBMISSION"; readonly "authorityScope": "MODEL_SEMANTICS_ONLY"; readonly "recordedAt": string; };
