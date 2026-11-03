# Native v2 source admission

Development contract for the approved v0.9 plan. This document covers byte and fragment admission, not the entire native asset lifecycle or completed product acceptance. Historical `specifications/v1` remains unchanged.

## Authoritative structure

[`sources.schema.json`](../../schemas/v2/sources.schema.json) is the authoritative JSON Schema 2020-12 envelope. The bounded generator produces applicable readonly TypeScript types and the runtime schema from that file. Build regenerates them; check rejects drift. Types do not substitute for runtime validation, byte budgets or relational checks. No remote schema loading occurs.

A source set contains 1–64 sources and up to 1,024 fragments. Every source has a unique ID, descriptive locator, revision, origin (`source`, `requirement`, `design`, `reference`), format, original UTF-8 text and SHA-256 digest. Formats are text, JSON, Turtle and RDF/XML. Locators are provenance labels; admission never reads them from disk or dereferences their URLs. The caller must supply the exact material within its authorized project scope. Successful admission does not establish external freshness or that a claimed origin is true.

The source-set identity hashes the schema name, sorted source metadata with original-byte digests, and sorted fragment definitions. Array reordering alone does not change that identity. Changes to bytes, locator, revision, origin, format or selectors do. Original text, including whitespace, is retained in a detached deeply frozen snapshot. This identity is distinct from semantic equivalence and future asset/delivery identity.

## Typed fragment selectors

Every fragment has a distinct ID, a source ID, the exact source digest, a selector and the digest of the selected original bytes. Missing sources, source/fragment digest mismatches and invalid selectors fail admission. A fragment cannot silently follow a new revision of its source.

| Selector | Meaning | Digest input |
|---|---|---|
| `document` | The entire original document, including surrounding whitespace | All original UTF-8 bytes |
| `utf8-range` | Half-open `[start,end)` byte offsets on Unicode code-point boundaries | Exact bytes in that range |
| `json-pointer` | RFC 6901 JSON string representation, only for JSON sources | Exact lexical JSON value token/subtree, retaining its internal whitespace and numeric spelling |

The empty JSON Pointer selects the root JSON value; it excludes whitespace outside that value. It therefore need not have the same digest as the `document` selector. A pointer to a string selects its quoted JSON spelling, not the decoded string. This avoids loss of escaped characters or numeric precision. JSON Pointer unescapes `~1` then `~0`, does not percent-decode, accepts only existing array indices without leading zeroes, and cannot use `-` to create an element. URI fragment notation is not accepted as the JSON string form.

JSON source admission first validates JSON grammar and bounded structure, then uses the pinned YAML parser in JSON mode only to locate lexical node spans and detect duplicate decoded keys. YAML syntax is not accepted as JSON. Duplicate keys fail admission rather than allowing last-value selection. Text offsets may also select exact source text within RDF documents, but do not claim to identify parsed OWL axioms. Parsed RDF/OWL structural selectors require a separately bound parser projection; JSON Pointer is never substituted for them.

## Budgets and ownership

Limits are 8 MiB per document, 32 MiB combined source bytes, 48 MiB request JSON, and 32 MiB combined selected-fragment bytes, counting overlapping selections each time. JSON source traversal is limited to depth 64 and 100,000 value nodes; the source-set envelope uses the existing 24-depth/30,000-node JSON budget. Unicode text must round-trip to UTF-8 without replacement characters. Range endpoints cannot split a multibyte character. Empty text/ranges are representable; they do not satisfy a business requirement merely because their digests are valid.

The pure admission helper neither writes state nor approves assets. The authenticated owner service must persist the source snapshot, project binding and request receipt in its transaction. A source admission result reports `authority: false`, `businessConfirmed: false` and `semanticValidation: NOT_EVALUATED`. Required-source coverage, parsed ontology/SHACL validation, derived views, reviews and immutable delivery remain distinct obligations.

References: [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/json-schema-core), [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901).
