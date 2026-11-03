# OWL 2 DL execution development checkpoint

This is an internal P2 implementation checkpoint under the [approved plan](ontology-v090-plan.md), not a full-conformance or release claim. The standalone service still reports `reasoningReady: false`: source admission, native v2 lifecycle, durable task receipts, SHACL, complete standards coverage and actual Expert journeys must be connected and accepted before that changes.

## Responsibility and identity

Strict TypeScript owns admission, input/digest validation, toolchain verification, single-worker lease, process deadlines/cancellation and response identity. A compiled Java process performs one formal task using `org.semanticweb.hermit:1.4.5.519` with `owlapi-distribution:5.5.1`. It cannot read or mutate owner asset/review state. HTTP/MCP permission and project scope remain owner-service responsibilities; this internal executor is not an independently authorized business API.

The source dependency manifest records all resolved JAR names, Maven Central coordinates/URLs and SHA-256 hashes. `scripts/build-dl-worker.mjs` verifies that exact dependency directory, compiles the owned Java source, creates an isolated worker JAR, and records a private toolchain binding. Installed execution uses that JAR and dependencies, not Maven or Java source execution. The binding includes the worker source and dependency-manifest digests, installed JAR bytes and modes, and the selected Java 21 executable, libraries, configuration and release identity. The runtime is checked before each task. Dependency/license/security and published-artifact authenticity reviews remain release work; a local hash binding does not establish them.

Prepare the source with the locked Node/TypeScript workflow, resolve the exact `toolchains/owl2-dl/pom.xml` dependencies through Maven Central, and use explicit absolute locations:

```sh
node scripts/build-dl-worker.mjs \
  --dependencies /absolute/resolved/dependencies \
  --java-home /absolute/jdk-21 \
  --output /absolute/new/private/dl-runtime
```

The output directory must be new and outside Git. Select its private `toolchain.json` and a separate private worker directory when constructing `createDLRunner`. Tests use `EVOPILOT_TEST_DL_TOOLCHAIN` and require the installed worker to match current source. No mocked reasoner or skipped missing-toolchain case counts as support. Existing native-v1 regression tests additionally require their original `EVOPILOT_TEST_NATIVE_TOOLCHAIN` binding.

## Request and formal results

The internal `ontology-dl-request/v1` envelope includes a retained request ID, exact document/import closure and a typed task. Documents contain Unicode text, its UTF-8 byte digest, document IRI, ontology/version IRIs and explicit format. Turtle and RDF/XML support native interchange; Functional Syntax supports exact structural queries, explanations and standards fixtures without introducing another mandatory business authoring format.

Tasks currently implemented by the worker are DL profile legality, consistency, arbitrary-class-expression satisfiability, axiom entailment, finite class/object-property/data-property hierarchy and equivalence projections, named-individual realization/identity, and a replayable explanation for an established entailment or inconsistency. Satisfiability uses one query axiom `SubClassOf(owl:Thing expression)` to encode the tested expression; it is not added to the premise ontology. Query ontologies cannot import dependencies.

Statuses distinguish `COMPLETED`, `ENTAILED`, `NOT_ENTAILED`, `INCONSISTENT`, `INVALID_INPUT`, `MISSING_IMPORT`, `TIMEOUT`, `CANCELLED` and `FAILED`. A failed or interrupted task has `complete: false`. Not entailed does not assert negation. Inconsistent input produces no ordinary entailment/projection result. An unsatisfiable class can coexist with a consistent ontology until an incompatible instance is asserted. Finite projections explicitly identify the requested named entities and say that they are not all logical consequences. Identity entailment does not physically merge records.

Entailment checks the complete query axiom set jointly, preserving shared anonymous witnesses; separate per-axiom results would not establish that conjunction. Empty logical conclusions are explicitly labeled `vacuous: true`. Their logical truth cannot satisfy independent business coverage requirements or missing mandatory shapes.

Results bind the exact request, original closure, effective configuration and toolchain digests. They are formal observations; owner-service persistence and actual review remain separate. The executor itself does not implement business request replay, semantic approval or delivery.

## Imports and parsing

Every import edge resolves to exactly one admitted document identity/digest. Missing, conflicting or unreachable inputs are rejected. Expected imports are parsed separately from their supplied in-memory contents; unknown loads are mapped to a non-retrievable URN. No import fetch receives its original HTTP, file or classpath address. Actual import declarations and parsed ontology/version identities must match the supplied closure, then the worker constructs a separate union of the closure's axioms for Direct Semantics.

OWLAPI 5.5.1's strict RDF reader counts import objects as ontology-header candidates and rejects a legal importing document. The adapter therefore uses the normal RDF reader with illegal-punning repair disabled, rejects reported unparsed RDF triples, checks exact identities/imports, and runs the complete `OWL2DLProfile` check before reasoning. This behavior was inspected in the versioned upstream `OWLRDFConsumer` and `TPImportsHandler` source; it does not replace the outstanding syntax/conformance corpus. Original documents are never rewritten with inferred axioms or parser projections.

RDF/XML is independently checked with a constrained SAX parser before OWLAPI parsing. External DTDs/entities and external schema access are refused; internal entity processing is bounded. Input parser errors are explicit failures. Source-level syntactic edge cases, anonymous-individual fragment stability and complete interchange round-trip evidence remain required P2 work.

## Explanations and limits

The explanation task uses actual repeated reasoner calls to remove dispensable logical axioms. Its result contains the remaining supporting axioms, source document digests, structural-axiom selectors and an independently executable Functional Syntax ontology. It does not promise all minimal justifications. Structural selectors are not source line numbers or JSON Pointers. Retaining and resolving the exact parsed-source projection across later sessions is part of the pending native-v2 admission/lifecycle work.

Explanation is a separate task with a 30-second maximum deadline. Its timeout cannot turn a previously established entailment into a negative answer. Other tasks have a 120-second maximum worker deadline. Cancellation and deadline completion wait for process exit and discard partial output; the worker lease is then released.

Current frozen executor budgets: 64 documents; 8 MiB per document; 32 MiB total source text; 48 MiB request; 512 import edges; depth 16 and 8,192 traversal steps; 100,000 parsed axioms; 1,000 requested projection entities/query axioms; 8 MiB output; 64 KiB diagnostic output; JSON depth 24 and 30,000 nodes. These are worker envelopes, distinct from the smaller HTTP transport envelope. Future source-admission handlers must preserve both budgets explicitly.

The JVM has a 1 GiB heap limit, separately bounded direct memory/metadata/code cache, one active processor and Serial GC. These settings do **not** establish the plan's total-process 2 GiB memory ceiling. Actual total-process enforcement and reference-corpus resource acceptance remain P4 obligations; no heap-only measurement may close that requirement.

## Remaining acceptance

Business/regression fixtures exercise actual installed Java processes, not mocked logical results. Their fixed expectations come from the approved scenarios: sensitive classification/open-world absence, dependency chains, read-only conflicts, unsatisfiable templates, key identity, datatype values and finite projections. Import tests use an actual HTTP listener to observe zero dependency/XXE fetches. Explanation tests rerun the returned supporting ontology in a separate actual worker.

Complete W3C Direct Semantics corpus coverage, all standard constructs/datatypes and combination cases are still required, together with independent expected answers. An engine capability gap or valid-DL failure blocks release; it does not narrow the promised reasoning scope. W3C also states that passing its finite test suite alone does not prove complete conformance. See [OWL 2 conformance](https://www.w3.org/TR/owl2-conformance/) and [Direct Semantics](https://www.w3.org/TR/owl2-direct-semantics/).
