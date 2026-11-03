// Generated from schemas/v2/sources.schema.json; edit the schema, then regenerate.
export type Identifier = string;
export type SHA256 = string;
export type SourceDocument = { readonly "id": Identifier; readonly "locator": string; readonly "revision": string; readonly "origin": "source" | "requirement" | "design" | "reference"; readonly "format": "text" | "json" | "turtle" | "rdfxml"; readonly "content": string; readonly "digest": SHA256; };
export type SourceFragment = { readonly "id": Identifier; readonly "sourceId": Identifier; readonly "sourceDigest": SHA256; readonly "selector": SourceSelector; readonly "fragmentDigest": SHA256; };
export type SourceSelector = ({ readonly "kind": "document"; } | { readonly "kind": "utf8-range"; readonly "start": number; readonly "end": number; } | { readonly "kind": "json-pointer"; readonly "pointer": string; });
export type SourceSet = { readonly "schema": "ontology-source-set/v2"; readonly "sources": readonly (SourceDocument)[]; readonly "fragments": readonly (SourceFragment)[]; };
