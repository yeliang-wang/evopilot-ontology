# Ontology v1: native RDF and SHACL

This corrects current v1 directly. Software version, asset content version, specification label and actual standard digest are separate. Retired JSON validators are historical readback only.

## Adopted standards

| Layer | Standard / tool | Adopted scope |
|---|---|---|
| Data/syntax | [RDF 1.1](https://www.w3.org/TR/rdf11-concepts/), [Turtle 1.1](https://www.w3.org/TR/turtle/) | UTF-8 Turtle, stable business IRIs, RDF set semantics |
| Declarations | [RDFS 1.1](https://www.w3.org/TR/rdf-schema/), [OWL 2](https://www.w3.org/TR/owl2-overview/) | Named classes/properties, labels, definitions, domain/range and inheritance; no OWL reasoning claim |
| Constraints | [SHACL 2017](https://www.w3.org/TR/2017/REC-shacl-20170720/) | Core and bounded local SELECT interpreted by pySHACL |
| Validator | [pySHACL](https://github.com/RDFLib/pySHACL/tree/v0.40.1) | Exact installed toolchain, no fallback custom engine |
| Integration | EvoPilot convention | Manifest, directories, source scope, coverage, review, decision and immutable publication |

[Support matrix](support-matrix.json), [adoption table](adoption.md), [cases](conformance-cases.json) and [standard lock](standards.lock.json) define supported, restricted and unsupported behavior. The installed toolchain lock is the sole installer byte identity; standard declarations cannot override it.

## Package and layout

```text
model.ttl
shapes/*.ttl
instances/*.ttl
sources/bindings.json
sources/** (original UTF-8 source snapshots)
scope/coverage.json
tests/cases.json
tests/*.ttl
```

`NativePackage` contains a JSON manifest and UTF-8 files map. The exact manifest is case-fold unique, safe-relative-path and SHA-256 checked. No links, traversal, unmanifested files, executable graph extensions, implicit JSON conversion or second model.json source. Source snapshots may contain program text; they are inert provenance bytes and never executed. See [package schema](package.schema.json) and [directory contract](directory-layout.json). Entry points are exactly model, shapes, instances, coverage and cases.

## Definitions and constraints

Named classes, properties and required shapes have stable IRIs, label, definition (`rdfs:comment`), namespace (`rdfs:isDefinedBy`) and source (`rdfs:seeAlso`). [Meta shapes](meta-shapes.ttl) execute these EvoPilot requirements. Business projects add their own namespaces and constraints without redefining standard vocabulary.

SHACL class/type, cardinality, range, string/language, pair, logical, qualified, closed and membership constraints retain native meanings. domain/range declarations cannot replace required explicit instance types. Inference is none. Duplicate triples do not count as multiple events; distinct events require distinct identities.

Local SHACL-SPARQL SELECT is syntax-tree checked. SERVICE, FROM, named graphs, VALUES, MINUS, Update and custom functions are refused. JS, AF rules, custom components, recursive shapes, automatic imports, deactivated shapes and selecting only part of required validation are unsupported. Unknown executable SHACL vocabulary is rejected even if upstream would silently ignore it. Required Warning and Info results are not exempted.

## Independent coverage and sources

`scope/coverage.json`: schema evopilot-ontology-coverage/v1; projectRoot; namespace; expectedEntities `{id,type}`; requiredShapeIds; requiredCaseIds. Establish these from independent authorized source scope before authoring. A required shape targets projectRoot using targetNode. Empty graphs, deleted IDs/types, missing shapes or missing tests cannot pass through zero targets.

[Source bindings](source-bindings.schema.json) contain direction, sources, requirements and mappings. Sources carry id, locator, revision, digest, status, visibility and contentPath. contentPath identifies original manifested UTF-8 bytes under sources/; digest is their complete SHA-256. Mappings bind requirementId, targetId, sourceId, matching status, revision, fileDigest, selector and fragmentDigest. The owner recomputes both digests, requires exact source revision, and rejects absent selectors. A selector is `{kind:"lines",start,end}` (1-based inclusive) or `{kind:"json-pointer",pointer}` (RFC 6901). Line fragments are `text.split("\n").slice(start-1,end).join("\n")`, preserving CR and adding no trailing LF; hash their UTF-8 bytes. JSON Pointer fragments use nativeSha256 of the selected JSON value. Inferred mappings require a nonempty rationale. The parent separately checks the original project inventory; copying self-consistent fabricated bytes is not original-source evidence. Observations and modeling inferences have separately classified sources. Public packages reject private sources. Covered requirements need mappings; required unresolved interpretations block admission. Non-covered dispositions require a reason.

See executable [coverage](coverage.schema.json) and [case catalog](cases.schema.json) schemas.

`tests/cases.json`: schema evopilot-ontology-cases/v1; cases `{id,data,expectedConforms,requirementIds,shapeIds}`. Every required shape and covered required requirement has positive and negative cases. All named NodeShape/PropertyShape declarations belong to the fixed shape set; owned model declarations and expected identities use the declared namespace. Negative cases must actually report their declared shape; labels and counts alone do not establish coverage. Case IDs exactly equal the fixed coverage set. Runtime additionally binds the independently established project-wide requirement contract; owner-supplied coverage is not proof of the full business scope.

## Execution and authority

The owner checks package/source scope, syntax/adoption, meta-SHACL and declaration metadata, fixed identity closure, raw instances and required cases. Reports preserve native focus/path/sourceShape/constraint/severity/value/message. Invalid or missing reports, native execution errors, unsupported features, timeout and process failures never become CONFORMS.

Review binds exact bytes, validation, toolchain, owner standard and workspace. A real human decision binds the review; published asset versions are immutable. Runtime validation adds candidate/claim/source/configuration/requirement context. Graph equivalence explains differences but does not reuse approval for changed bytes.

`standard.inspect` / `inspectOntologyStandard()` derive digests from actual installed normative files in sorted path order; the index does not hash itself. See [native service](../../docs/native-service.md), [re-extraction](re-extraction.md) and [independent replay](../../docs/native-service.md#independent-replay).

Source-binding `status` is `observed` or `inferred`, matching the project and Harness contracts. An inferred mapping may interpret an observed source but must retain a rationale and exact domain review. An inferred source cannot be relabeled as an observed mapping. These interpretation labels are separate from raw evidence origin (design/source declaration, execution result, runtime observation or synthetic evidence).
