# Optional exact axiom source locations

Version 1 identifies original Functional Syntax axiom occurrences. Version 2 adds shared Turtle source tables and distinguishes actual RDF construction inputs from parser-selection context. Version 3 adds RDF/XML source sets and permits both RDF formats in the same explanation. No protocol version alone establishes complete EXPLAIN-03 acceptance, business-source interpretation or a semantic decision. The existing explanation method, replay obligation, task deadlines and output budgets remain unchanged; exact distribution and native journey evidence remain required.

Functional Syntax is available in the internal DL request protocol, structural queries, replay documents and fixtures. Native business model authoring remains limited to Turtle and RDF/XML by the unchanged model schema. A version-1 native business explanation with supporting premises reports location coverage `UNAVAILABLE`; a premise-free explanation reports `NOT_APPLICABLE`. Functional location fixtures exercise the shared DL result protocol, not admission of a Functional business model. Version-2 native Turtle explanations can establish exact original-source sets under the additional rules below.

An internal DL explanation result can contain `sourceLocationVersion: 1`. When that field is present, every Functional Syntax origin in `support[].sources[]` must contain the following complete `sourceLocation` group. Other formats must omit that group. A version-1 worker that cannot establish a required Functional location must return an incomplete task rather than inventing a range or omitting that origin.

```text
{
  schema: "ontology-axiom-source-location/v1",
  occurrences: [
    { fragments: [
      { start, end, fragmentDigest, startLine, endLine }
    ] }
  ],
  context: [
    { kind: "PREFIX", start, end, fragmentDigest, startLine, endLine }
  ]
}
```

The enclosing origin retains its exact `documentId`, `documentDigest` and structural `axiomDigest`. The document digest binds the original admitted UTF-8 bytes, including any BOM and original line endings. The fragment digest is SHA-256 of precisely `bytes[start:end]`; it is not the structural axiom digest. No normalized serialization or author-declared model anchor substitutes for these original bytes.

- `start` is a zero-based UTF-8 byte offset; `end` is exclusive. Both are safe integers on UTF-8 boundaries, with `0 <= start < end <= documentBytes`. A Functional fragment covers the complete top-level axiom, from its opening keyword through its closing parenthesis. Internal whitespace, comments and annotations remain part of that range.
- `startLine` and `endLine` are one-based inclusive lines of the first and last covered characters. `endLine` is not the line of the exclusive end cursor. CRLF counts as one line break; a bare CR or LF also counts as one. The next line begins after the entire line-break sequence. A BOM contributes bytes, not a line. Column numbers are not defined.
- `occurrences` is nonempty. In this version each occurrence has exactly one fragment; the array does not authorize multi-fragment attribution for another format. Occurrences are ordered by byte offset, unique and nonoverlapping. Repeated structural axioms in one document retain their separate textual occurrences; shared axioms in different documents retain separate origins.
- `context` contains the document's original prefix declarations, each as a complete `PREFIX` range. It can be empty. Prefix ranges are ordered, nonoverlapping and precede the axiom ranges. Every reported axiom from one document uses the same prefix context. The enclosing document IRI remains the original parsing base; a reconstructed prefix string is not original-source evidence.

The worker must bind the parsed structural axiom, including its annotations and document-scoped anonymous-individual identity, to these original parser ranges. A textual match against `OWLAxiom.toString()`, a matching byte hash alone, or a business-source mapping does not establish that relationship. Separate snippet parsing must not change anonymous-individual scope or the original prefix/base interpretation. These rules follow the distinction between syntax, structure and anonymous-individual scope in the [OWL 2 Structural Specification](https://www.w3.org/TR/owl2-syntax/).

The owner first verifies the retained task's request, closure, result, configuration and toolchain bindings. It then checks the optional group's exact shape, original document and fragment hashes, UTF-8 boundaries, derived line numbers, ordered ranges and consistent prefix context. Across all reported axioms in a document, axiom ranges must not overlap and prefix context must end before the first located axiom. This byte-integrity check does not independently rerun the OWL parser or the reasoner. Structural attribution remains evidence produced by the exact bound worker; arbitrary caller-selected rehashed JSON is not proof of execution.

There are at most 200,000 fragment/context records per document and across one explanation projection, counting repeated context references. Original document and loaded closure bytes remain bounded to 8 MiB and 32 MiB respectively. Reported axiom fragment bytes cannot exceed their source document's bytes. The owner scans each original document once for all line-number checks and hashes a shared prefix context once. Existing worker output, retained-state, review-report and transport limits continue to apply. Over-budget or malformed metadata is rejected rather than truncated into a complete result.

For version-1 evidence, each projected support document adds `axiomSourceLocation`: the validated group for Functional Syntax, or `{status:"UNAVAILABLE", reason:"FORMAT_NOT_INSTRUMENTED"}` for another format. The projection also contains `sourceLocationVersion: 1` and `axiomSourceLocationCoverage`:

| Value | Meaning |
|---|---|
| `COMPLETE` | Every supporting axiom/document origin has an instrumented location group. |
| `PARTIAL` | At least one origin is instrumented and at least one uses an uninstrumented format. |
| `UNAVAILABLE` | Support exists, but none of its origins is instrumented. |
| `NOT_APPLICABLE` | The established target has no supporting premise; no source occurrence is invented. |

Coverage describes locations in the supporting model documents, not all OWL formats or business-source coverage. Existing `sourceLinksComplete`, `sourceLinkPrecision: DOCUMENT_MAPPING_NOT_AXIOM_BYTE_LOCATION`, mapping-level `axiomByteSpanEstablished:false`, and `businessMeaningProven:false` keep their meaning: the business links remain author-declared document mappings. Exact formal-axiom coordinates do not upgrade those interpretations to proof.

Historical evidence without `sourceLocationVersion` must not contain `sourceLocation` on an origin. It follows the original projection path with no new fields, including no synthetic `UNAVAILABLE` value. Existing projection key order, serialized bytes and digests remain unchanged for the same retained evidence. New evidence has its own result/projection identity; it never rewrites an earlier review report or delivery.

## Version 2: shared Turtle source sets

`sourceLocationVersion: 2` requires a top-level `sourceLocationDocuments` array in the worker result and owner projection. The array is present even when empty. It is forbidden for historical unversioned and version-1 results. The owner preserves the shared tables once at projection level; it does not expand them into every supporting axiom.

A Functional origin retains exactly the version-1 group and all version-1 validation rules. A Turtle origin requires this exact group:

```text
{
  schema: "ontology-axiom-source-location/v2",
  kind: "RDF_CONSTRUCTION",
  constructionOccurrenceIds: [ positiveInteger, ... ],
  parserContextOccurrenceIds: [ positiveInteger, ... ]
}
```

Both arrays are unique and numerically ascending. Construction references are nonempty; parser-context references can be empty. An occurrence can appear in both arrays. Removing it from one role merely because it appears in the other loses evidence. These IDs resolve only in the table for the enclosing origin's exact `documentId` and `documentDigest`.

`constructionOccurrenceIds` identifies the actual RDF inputs used to build the structural axiom, including its arguments and annotations. `parserContextOccurrenceIds` identifies actual classification, matching and selection dependencies observed by the mapper. Parser context is not a second logical justification, nor does its presence establish that each referenced fact is logically necessary. The worker's independently replayed structural support remains the explanation. The owner verifies the retained task and byte/reference integrity; it does not independently re-execute RDF-to-OWL mapping or infer these roles from the raw terms.

Each shared table has exactly these fields:

```text
{
  schema: "ontology-rdf-source-document/v1",
  documentId, documentDigest,
  format: "turtle",
  parserId: "owlapi-turtle-occurrences:1",
  sources: [
    { id, kind, start, end, fragmentDigest, startLine, endLine }
  ],
  contexts: [
    { id, kind, prefixName, resolved, sourceId, dependencyContextIds }
  ],
  occurrences: [
    { id, triple, subject, predicate, object, generatedKind }
  ]
}
```

Tables are unique and ordered by `documentId`. Each of the three tables within a document has unique ascending positive safe-integer IDs. IDs retain the parser's document-local identity; pruning unused entries can leave gaps. An ID can exceed the number of retained records. An identical numeric ID in another document is a different identity and cannot satisfy a reference.

- A source `kind` is `TOKEN`, `PROPERTY_LIST`, `COLLECTION`, `ITEM`, `PREFIX` or `BASE`. Its five fragment fields use the exact original UTF-8, digest and line rules described for version 1. Original spelling, escapes, BOM and line endings remain intact. Unlike Functional axiom ranges, RDF ranges may nest, overlap or recur in several axioms. A collection or property-list range is a generating construct, not a claim that one contiguous substring is the complete OWL axiom. Shared ranges are hashed once per original document/start/end; each declaration must still agree with the original bytes and line numbers.
- `subject`, `predicate` and `object` beside `triple` are each exactly `{sourceId, inherited, generated, contextIds}`. `sourceId` is positive and references an original token or construct. `inherited` and `generated` are booleans. Context IDs are unique, ascending and resolve in the same document. Generated terms require a `PROPERTY_LIST`, `COLLECTION` or `ITEM` source, rather than an invented zero-length span. Inherited terms preserve the original source handle across Turtle shorthand.
- `triple` is exactly `{subject, predicate, object}`. Its subject and predicate are the actual callback IRI strings. Its object is either `{kind:"RESOURCE", value}` or `{kind:"LITERAL", lexical, language, datatype}`. Literal language and datatype are nullable and mutually exclusive for this Turtle callback protocol; an empty lexical value is legal. Semantic strings are subject to the existing aggregate byte/node budgets, not an invented per-IRI length restriction. These callback values are evidence from the bound parser, not an owner-side lexical reconstruction.
- `generatedKind` is `null`, `BLANK_PROPERTY_LIST`, `COLLECTION_FIRST`, `COLLECTION_REST` or `COLLECTION_TYPE`. A non-null value requires a generated term. Generated triples remain tied to the actual source construct and are never represented as separately written triples.
- Context `kind` is `DOCUMENT`, `BUILTIN`, `PREFIX` or `BASE`. `prefixName` is `null` for document/base context and includes its trailing colon for prefix/builtin context. `resolved` is the actual parser context IRI. Context dependency IDs are unique, ascending and strictly earlier than the context ID, forming a closed acyclic graph. An explicit prefix/base context references a source of the corresponding kind.

Only implicit `DOCUMENT` and `BUILTIN` contexts use `sourceId: 0`; they have no source fragment and no dependency contexts. Document context must match the original `documentIri`. Builtins are exactly the pinned parser's defaults: `owl:` → `http://www.w3.org/2002/07/owl#`, `rdfs:` → `http://www.w3.org/2000/01/rdf-schema#`, `rdf:` → `http://www.w3.org/1999/02/22-rdf-syntax-ns#`, `xsd:` → `http://www.w3.org/2001/XMLSchema#`, `xml:` → `http://www.w3.org/XML/1998/namespace`, and `:` → `http://www.semanticweb.org/owl/owlapi/turtle#`. An explicit redeclaration is a separate context with its own original directive range. Implicit context is not fabricated original text.

The lexical context table explains term resolution; it is a separate dimension from the mapper's `parserContextOccurrenceIds`. For example, a prefix declaration explains a QName's IRI, while a positive type check explains why a mapper selected a particular interpretation. Neither context replaces the actual construction inputs.

Every table contains exactly the dependency closure reached from the supporting origins' two role arrays: occurrence → term source/context → context source/dependencies. Absent references, conflicting IDs, unused records, unrelated document tables, unknown keys and unknown kinds are rejected. The outer retained result digest binds the whole table and its references; no independently asserted table digest substitutes for that retained execution binding.

Version-2 validation shares a 200,000-record ceiling across RDF source/context/occurrence records and Functional fragment/context records. It also bounds all reference-list entries and source edges to 1,000,000, counting repeated origin references, and caps hashing of distinct source ranges at 64 MiB across the explanation. Nested spans therefore cannot cause unbounded repeated hashing. These are defensive ceilings, not a claim that every combination fits the output: the existing 30,000 JSON-node/depth-24 structure budget and 8 MiB DL result budget still apply first. The original 8 MiB document, 32 MiB closure, task deadline, 32 MiB review/delivery and 64 KiB page limits remain unchanged. Exhaustion yields an incomplete/failed result or rejects malformed retained metadata; it never silently removes records while claiming complete coverage.

For version 2, coverage `COMPLETE` means every supporting origin has a validated Functional group or Turtle source set. `PARTIAL` means instrumented origins coexist with RDF/XML origins, which still project `{status:"UNAVAILABLE", reason:"FORMAT_NOT_INSTRUMENTED"}`. RDF/XML-only support is `UNAVAILABLE`; empty support is `NOT_APPLICABLE` and requires empty shared tables. Version 1 keeps its original Functional-only coverage semantics. The new formal-source evidence does not change author-declared business mappings, review authority, semantic approval or software-release authority.

## Version 3: RDF/XML and mixed source tables

`sourceLocationVersion: 3` requires a location group for every supporting origin. Functional Syntax keeps the version-1 group; Turtle and RDF/XML both use the version-2 `RDF_CONSTRUCTION` group with separate construction and parser-context role arrays. An RDF/XML origin resolves its occurrence IDs only against its own XML table. The single `sourceLocationDocuments` array contains Turtle and XML tables in ascending, unique `documentId` order. Functional documents do not acquire a shared table. Version-3 coverage is `COMPLETE` for nonempty support and `NOT_APPLICABLE` for empty support; missing XML attribution is a failed/incomplete result, never an `UNAVAILABLE` fallback.

An XML table has exactly this shape:

```text
{
  schema: "ontology-rdfxml-source-document/v1",
  documentId, documentDigest,
  format: "rdfxml", parserId: "owlapi-rdfxml-occurrences:1",
  sources: [{ id, kind, start, end, fragmentDigest, startLine, endLine }],
  sourceSets: [{ id, sourceIds: [positiveInteger, ...] }],
  contexts: [{ id, kind, name, resolved, sourceSetId, dependencyContextIds }],
  occurrences: [{ id, triple, subject, predicate, object, generatedKind }]
}
```

IDs are positive, unique, and ascending within each array; retained parser IDs may have gaps. `sourceIds` is nonempty, unique and ascending. Equal memberships share one source-set ID. A term has exactly `{sourceSetId, inherited, generated, contextIds}`. Its source set is required and nonempty; its context list is unique and ascending. The `triple` resource/literal union is the same as Turtle. XML callbacks can retain both a language and a datatype; the mapper applies datatype precedence, and the table preserves the actual callback rather than rewriting its terms.

XML source kinds are `ELEMENT_NAME`, `ATTRIBUTE`, `TEXT`, `CDATA`, `ELEMENT`, `ENTITY_REFERENCE`, `ENTITY_DECLARATION`, `DTD_ATTRIBUTE_DECLARATION`, `NAMESPACE`, `XML_BASE`, and `XML_LANG`. Fragments bind the original unexpanded UTF-8 document bytes with the existing exclusive-end and covered-character line rules. A multi-fragment source set can therefore retain both an entity declaration and its use without pretending that expanded text was literally present at one range. Overlapping spans are permitted and are hashed once per distinct range.

Contexts form an earlier-ID dependency DAG. `DOCUMENT` binds the original parsing IRI; `BUILTIN` binds only the implicit `xml` namespace. These have source-set ID zero and no dependencies. All other contexts require a positive original source set:

- `NAMESPACE`: prefix name and resolved namespace, each permitting an empty string.
- `XML_BASE` and `XML_LANG`: null name and resolved base/language; language can be empty.
- `ENTITY_DECLARATION` and `ENTITY_REFERENCE`: the general, parameter or character-reference name and null resolved value.
- `DTD_ATTRIBUTE_DECLARATION` and `DTD_ATTRIBUTE_DEFAULT`: `elementQName@attributeQName` and respectively the declared type or normalized default value.
- `RDF_LI_ORDER` and `REIFICATION_ORDER`: null name and a positive decimal position.

`generatedKind` is null or one of `TYPED_NODE`, `PROPERTY_ATTRIBUTE`, `PARSE_TYPE_RESOURCE`, `COLLECTION_FIRST`, `COLLECTION_REST`, `COLLECTION_TYPE`, `RDF_LI`, `REIFICATION`, `ENTITY_EXPANSION`, `PARSE_TYPE_LITERAL`, and `REIFICATION_BAG`. A non-null kind requires a generated term with original generating sources. These labels describe parser production, not invented logical premises.

Every table contains exactly the reachable occurrence → term → source-set/context → source/context-dependency closure. The owner rejects unused, missing or cross-document records, duplicate set membership, unknown keys, and inconsistent byte identities. XML source-set records and all membership/term/context/origin reference edges participate in the same version-2 budgets shared across both RDF formats and Functional locations. No table gets a separate allowance. Output size, JSON structure, source admission and deadline limits remain unchanged.

The applicable syntax is [RDF 1.1 XML Syntax](https://www.w3.org/TR/rdf-syntax-grammar/), which normatively references XML 1.0 Fifth Edition and Namespaces in XML 1.0. The parser accepts XML 1.0 or an omitted XML declaration; XML 1.1 is explicitly refused. External entities and DTD retrieval remain disabled. Internal declarations/defaults are handled within the existing expansion, total entity-size and depth limits. This syntax boundary does not narrow the committed OWL 2 DL Direct Semantics constructs or datatype map.

Historical unversioned, version-1 and version-2 evidence retain their original projection shape, field order and serialized bytes. In particular, historical version-2 XML origins keep their `UNAVAILABLE` interpretation. Version-3 tables never rewrite old review or delivery identities, and formal source coordinates do not establish business meaning or grant human approval.
