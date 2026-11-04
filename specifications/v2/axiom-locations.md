# Optional exact axiom source locations

This development addition identifies original Functional Syntax axiom occurrences. It does not establish source-location support for Turtle or RDF/XML, complete EXPLAIN-03 acceptance, business-source interpretation or a semantic decision. The existing explanation method, replay obligation, task deadlines and output budgets remain unchanged.

Functional Syntax is available in the internal DL request protocol, structural queries, replay documents and fixtures. Native business model authoring remains limited to Turtle and RDF/XML by the unchanged model schema. Consequently, a current native business explanation with supporting premises reports location coverage `UNAVAILABLE`; a premise-free explanation reports `NOT_APPLICABLE`. Complete or partial location projection fixtures exercise the shared DL result protocol, not successful admission of a Functional business model. Exact native business-asset locations still require instrumentation of its admitted formats.

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
