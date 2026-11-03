# Native v2 named derived views

The owner retains immutable finite RDF projections from actual completed OWL tasks. This implements selected graph readback and SHACL composition; it does not establish full v0.9 acceptance, semantic review or delivery. The authoritative [JSON Schema](../../schemas/v2/projection.schema.json) generates the TypeScript contract and runtime validator. Historical v1 bytes remain unchanged.

## Production and identity

`view.record` takes `assetId`, `modelDigest` and 1–8 distinct `taskIds`. It uses the normal project revision, request receipt and audit transaction. Each task must be retained in the selected project and exact model, have a complete, consistent and legal `COMPLETED` result, and bind the currently configured reasoning toolchain. Caller-provided triples, executable paths or result replacements are rejected. Receipt replay returns the original view without reactivating it.

Named projections support class, object-property and data-property hierarchy, realization and identity tasks. Request entity scope and hierarchy directness remain explicit. Classes produce named subclass/equivalent-class triples; properties produce named subproperty/equivalent-property triples; realization produces named individual types; identity produces same/different-individual relations. Original individuals are never physically merged. Anonymous inverse-property expressions are retained in the formal task result and counted as `omittedInverseExpressions` in the view; they are not misrepresented as named properties. No anonymous witnesses, inferred literal/property-value assertions or arbitrary existential consequences are fabricated. This bounded RDF projection does not narrow the separately required full OWL 2 DL reasoning semantics.

Every triple links to the task IDs supporting its projection. Every task binding records exact request, result, configuration and toolchain digests, entity scope and directness. The view binds the model, original source-set and locked input-closure digests. Its digest covers the complete manifest, ordered triples and task bindings; its Turtle document has a separate original-byte digest. Reordering selected task IDs does not create a different projection. Readback verifies both the stored digest and reconstruction from the retained actual task results. Named projections may include already asserted triples; they are entailment projections, not a set-difference proof of novelty.

The selected scope is `NAMED_REQUESTED_ENTITIES`, with `allLogicalConsequences:false`. Absence means only `NOT_IN_THIS_PROJECTION`; it never proves negation. Model requirement/source mappings remain proposed interpretations. This task-level provenance does not falsely identify a particular business sentence as a formally proven axiom justification; source-projected supporting-axiom explanations remain separate work.

## Reading and explicit graph selection

| Operation | Input and result |
|---|---|
| `view.list` | `assetId`, nullable `afterDigest`, `limit` 1–100; immutable view/model identities and cursor |
| `view.inspect` | `assetId`, `viewDigest`; scope, task provenance, triple count, document digest, current model binding and configured-toolchain match |
| `view.read` | `assetId`, `viewDigest`, `format: json \| turtle`, byte `offset`, `maxBytes` 4–65,536; original-byte digest and UTF-8-safe continuation |
| `view.query` | `assetId`, `viewDigest`, nullable IRI `subject`/`predicate`/`object`, integer `offset`, `limit` 1–100; matching derived triples, task IDs and explicit projection scope |

Read/query outputs contain the **derived component only**. Read authoritative original documents with `model.document.read`; their bytes are never rewritten. The view's composition declaration specifies how it participates in validation, not the contents of its exported Turtle file. These bounded filters are not arbitrary SPARQL or a general graph server.

`validation.start` takes optional `view`. Omission or `{kind:"asserted"}` selects the original locked RDF closure. `{kind:"derived",viewDigest}` selects the original closure plus this exact owner-retained named component. The service loads the document; business requests cannot inject a replacement graph. The SHACL request/result bind kind, projection digest and document bytes through `viewDigest`. Python validates the union with inference disabled. OWL checks still run against the original premises. Independent SHACL positive/negative fixtures remain their exact asserted input graphs; derived candidate facts never leak into their oracles.

For a service accessing sensitive data, OWL realization can establish `svc rdf:type SensitiveService` without that triple appearing in the authored file. A `sh:hasValue SensitiveService` constraint on `rdf:type` can therefore fail on the asserted graph and conform on the explicitly combined graph. The selected view is part of the result identity; choosing the graph remains a business modeling decision, never an automatic tactic to obtain a pass. Neither outcome records human approval.

## Staleness, limits and recovery

Intent, original source-set, current model or independent expectation changes invalidate the view for current use. Historical reads remain available and report `current:false`. Toolchain changes are separately visible; they block creation/selection of a view produced by the previous toolchain. New reasoning against the exact new candidate is required. A failed/incomplete/inconsistent/cancelled task, unknown task, mismatched model or forged document cannot produce a view.

Each view permits at most 8 tasks, 50,000 distinct triples and 16 MiB of manifest bytes, subject also to the existing finite worker-output, transport and owner-state budgets. Larger scopes fail explicitly; they are never truncated into a complete view. Reads remain bounded and may require smaller query pages to meet the existing 1 MiB response limit. No task dispatch occurs during view readback or derivation replay. New development state v13 adds the immutable view table; earlier development state versions are rejected without implicit migration. Daily workspaces remain untouched.
