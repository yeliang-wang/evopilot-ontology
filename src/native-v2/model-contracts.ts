// Generated from schemas/v2/model.schema.json; edit the schema, then regenerate.
export type Identifier = string;
export type SHA256 = string;
export type OptionalIRI = (string | null);
export type ModelDocument = { readonly "id": Identifier; readonly "documentIri": string; readonly "ontologyIri": OptionalIRI; readonly "versionIri": OptionalIRI; readonly "format": "turtle" | "rdfxml"; readonly "content": string; readonly "digest": SHA256; };
export type ModelClosure = { readonly "rootDocumentId": Identifier; readonly "documents": readonly (ModelDocument)[]; readonly "imports": readonly ({ readonly "from": Identifier; readonly "iri": string; readonly "to": Identifier; })[]; };
export type ModelAnchor = { readonly "documentId": Identifier; readonly "documentDigest": SHA256; readonly "start": number; readonly "end": number; readonly "fragmentDigest": SHA256; };
export type RequirementMapping = { readonly "requirementId": Identifier; readonly "sourceFragmentIds": readonly (Identifier)[]; readonly "anchors": readonly (ModelAnchor)[]; readonly "rationale": string; };
export type ModelDraft = { readonly "schema": "ontology-model-draft/v2"; readonly "assetId": Identifier; readonly "label": string; readonly "intentDigest": SHA256; readonly "sourceSetDigest": SHA256; readonly "expectationsDigest"?: SHA256; readonly "previousDigest": (SHA256 | null); readonly "closure": ModelClosure; readonly "shapes": readonly (ModelDocument)[]; readonly "mappings": readonly (RequirementMapping)[]; readonly "openIssues": readonly (string)[]; };
