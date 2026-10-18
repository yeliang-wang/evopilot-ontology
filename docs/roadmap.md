# Ontology roadmap

## v0.1.0 history

The [published v0.1.0 Preview](https://github.com/yeliang-wang/evopilot-ontology/releases/tag/v0.1.0) established native v1 modeling, instance validation and deterministic deliveries; scoped drafts, reviews, decisions and receipts; structured source import/derivation; retained queries and producers; Catalog and classification; and the standalone CLI. Historical extraction and mapping evidence remains in [migration provenance](../provenance/migration-current.json).

## v0.1.1 delivery repair

[v0.1.1 Preview](https://github.com/yeliang-wang/evopilot-ontology/releases/tag/v0.1.1) delivers strict TypeScript 5.9.3 owned source, compiled JavaScript and declaration exports, and refreshed public documentation and package guidance. Consumers need no compiler. Historical compatibility JavaScript remains behind a typed boundary. Frozen native v1 specifications, schema IDs, APIs and lifecycle semantics remain intact. See [CHANGELOG](../CHANGELOG.md).

The [native specification](../specifications/v1/README.md), [service](service.md), [CLI](cli.md), [retained API](legacy-api.md), [Catalog](catalog-service.md) and [classification](classification-service.md) describe current capabilities. Native authoring is standalone; advanced workflows require their documented trusted providers. Parent Runtime composition evaluates ontology instances and Harness evidence deterministically.

## v0.2.0 Workspace history

The current package version is 0.2.0. Its Workspace scope separates editable project files from protected owner state and provides workspace identity, explicit attachment, same-host relocation/snapshot support and recovery documentation. Historical asset records and receipts remain immutable. See the [CHANGELOG](../CHANGELOG.md) and [parent Workspace Target](https://github.com/yeliang-wang/evopilot/blob/main/governance/workspace-v02.json). This history summary does not claim new acceptance or publish a user's project status.

## v0.3.0 standards correction — IMPLEMENTING

The approved Preview correction corrects **`specifications/v1` directly**. It does not create a `specifications/v2` migration route. The correction adopts RDF 1.1/Turtle 1.1, an explicit RDFS/OWL declaration subset, SHACL 2017 Core and restricted local SHACL-SPARQL, with pySHACL as the native validator. EvoPilot retains project/package identity, source bindings, lifecycle decisions and immutable delivery; its directory and packaging conventions are not W3C standards.

The approved scope includes declarations, configuration, relations, constraints, expected source/model coverage, observed-versus-inferred provenance, native positive/negative fixtures and upstream report readback. Reverse onboarding re-extracts assets from a fixed source baseline; forward onboarding derives them from fixed requirements/design evidence. Earlier deliveries and approvals remain historical evidence, not automatic approval of corrected assets. The unchanged `v1` directory name is insufficient identity: the corrected standard, support profile, toolchain and asset content must have exact version/digest bindings.

Readme and reference documentation must identify each adopted standard, its supported subset, limitations, upstream executor and executable conformance tests. Acceptance must include missing entities/relations, empty validation targets, disabled required shapes, unsupported constructs, old-report reuse and independent upstream replay. Validation does not establish complete business meaning or grant delivery/release authority. Source interpretation and unresolved modeling questions remain explicit review work.

Standards and implementation references: [RDF 1.1](https://www.w3.org/TR/2014/REC-rdf11-concepts-20140225/), [Turtle 1.1](https://www.w3.org/TR/2014/REC-turtle-20140225/), [RDFS 1.1](https://www.w3.org/TR/2014/REC-rdf-schema-20140225/), [OWL 2](https://www.w3.org/TR/2012/REC-owl2-overview-20121211/), [SHACL 2017](https://www.w3.org/TR/2017/REC-shacl-20170720/) and [pySHACL](https://github.com/RDFLib/pySHACL). Implementation follows the approved parent `governance/standards-v03.json` Target. Current source is the 0.3.0 candidate; acceptance, installed cutover and conditional publication remain pending. Historical releases remain unchanged.

## Future candidates outside v0.3.0

Ontology's role is to maintain project domain assets and their traceable evolution for the user's AI development assistant. The candidates below extend that role when real project needs justify them; they do not turn Ontology into a general ontology editor, knowledge-graph hosting service or code-generation platform. They have no assigned software version or date, are not approved implementation Targets, and do not add prerequisites to the existing [v1.0 readiness criteria](https://github.com/yeliang-wang/evopilot/blob/main/governance/readiness-v1.json). The [parent Roadmap](https://github.com/yeliang-wang/evopilot/blob/main/docs/roadmap.md) coordinates cross-product scope.

### ONT-F01 — Semantic evolution and compatibility

- **Status:** `CANDIDATE`; separate Target review required.
- **Trigger:** Repeated real-project changes need reliable rename, deprecation, replacement or relationship-change handling beyond the current source-bound impact review.
- **Scope:** Build on the baseline's stable IRIs and version bindings. Add explicit label-only rename versus identifier replacement, deprecation/replacement lineage, semantic diffs and affected Harness/Runtime reference reports. Preserve past deliveries and distinguish compatible changes from changes requiring a new review.
- **Acceptance:** Fixtures demonstrate rename, property/range/cardinality changes, deprecation and replacement; every changed semantic element has a classified impact. Referenced deprecated identifiers cannot disappear silently; old deliveries remain readable; stale dependent references are detected; a new review is required where the declared compatibility contract demands it. Compare a real two-round project change with the reviewed expected impact set, including unaffected assets that may be reused.
- **Non-goals:** Automatic resolution of business meaning, automatic approval, rewriting historical deliveries, or treating raw text/RDF serialization differences as a complete semantic diff.
- **References:** [OWL 2](https://www.w3.org/TR/2012/REC-owl2-overview-20121211/) and [SHACL](https://www.w3.org/TR/2017/REC-shacl-20170720/) define relevant model/constraint semantics; EvoPilot must separately specify its evolution and compatibility contract.

### ONT-F02 — Demand-driven interoperability and generation

- **Status:** `CANDIDATE`; separate Target review required.
- **Trigger:** A connected project needs a concrete interchange format or generated schema that the native RDF/SHACL delivery cannot directly supply.
- **Scope:** Review a bounded mapping to or from formats such as LinkML and JSON Schema for that consumer. Declare the authoritative source, supported feature mapping, generator/version, deterministic output and explicit losses. Keep generated outputs distinguishable from editable source assets.
- **Acceptance:** A supported feature corpus round-trips with the declared semantic guarantees; unsupported/lossy mappings produce an explicit report or fail as specified, never silent success. Repeated generation is reproducible; generated output validates in the target's native tool; changes to generated files cannot silently become a second source of truth.
- **Non-goals:** Full language/framework/database generation, claiming all formats have equivalent semantics, or making a second modeling language mandatory for every project.
- **Reference:** [LinkML generators](https://linkml.io/linkml/generators/index.html) provide an upstream comparison and potential adapter source, not an automatic promise to implement every generator.

### ONT-F03 — Pinned external vocabulary and ontology imports

- **Status:** `CONDITIONAL_RESEARCH`; scope and feasibility review precede any implementation Target.
- **Trigger:** A real project requires an external vocabulary or ontology whose terms cannot reasonably remain a small explicitly declared local dependency.
- **Scope:** Evaluate offline, version/digest-pinned imports with a complete dependency closure, source/license records and explicit namespace/version conflict handling. Assess bounded module extraction where it reduces unnecessary dependencies.
- **Acceptance:** A reviewed pilot imports the same bytes offline; changed or missing dependencies fail; cyclic imports and incompatible namespace/version combinations receive deterministic diagnostics; licenses and provenance remain attached through delivery. Negative tests confirm that validation performs no implicit network fetch.
- **Non-goals:** Unbounded web crawling, an ontology registry/hosting platform, automatic semantic alignment, or implicit trust in imported business definitions.
- **References:** [ROBOT extraction](https://robot.obolibrary.org/extract) and [Ontology Development Kit](https://github.com/INCATools/ontology-development-kit) inform dependency/module engineering; their full workflows are outside this candidate.

### ONT-F04 — Optional logical reasoning validation

- **Status:** `CONDITIONAL_RESEARCH`; scope and feasibility review precede any implementation Target.
- **Trigger:** A project has an explicit logical consistency or class-inference requirement not addressed by its adopted SHACL constraints.
- **Scope:** Evaluate one declared OWL profile and a pinned reasoner, with a supported-construct matrix, inference provenance and bounded time/memory. Report logical consistency/inferred results separately from asserted facts, SHACL validation and business acceptance.
- **Acceptance:** Known consistent and inconsistent cases produce expected native reasoner results; unsupported axioms and time/resource limits cannot become PASS; results reproduce under the pinned profile/toolchain. Derived statements are marked and traceable; SHACL and project coverage checks continue to run independently.
- **Non-goals:** Full unrestricted OWL reasoning by default, replacing SHACL or human domain review, inventing business facts, or building a new reasoner.
- **References:** [OWL 2 profiles](https://www.w3.org/TR/2012/REC-owl2-profiles-20121211/) and [ROBOT reasoning](https://robot.obolibrary.org/reason).

## Target and release authority

Each candidate requires a reviewed trigger, explicit scope and exclusions, exact repository/file bindings, compatibility impacts and executable acceptance before implementation. Broader modeling languages, provider integrations and additional real-project workflows remain subject to that review. Candidate registration does not authorize a future standards-version change, implementation or release. User-specific choices, progress, approvals and evidence stay in private workspace/audit records; public Roadmaps contain generic product criteria only.

Technical validation, actual workflow acceptance and software release authorization remain distinct. Release requires applicable acceptance and explicit recorded authorization for the exact candidate, following the [parent release workflow](https://github.com/yeliang-wang/evopilot/blob/main/docs/github-release.md).

## Approved v0.4 execution feedback

Status: implementing the parent [36-variant Target](https://github.com/yeliang-wang/evopilot/blob/main/governance/feedback-v04.json). Add this owner's capture/delivery or impact-review responsibilities through public APIs, preserve native v0.3 standards and historical records, and verify real Host, restart, upgrade, source CI and release readback. v0.5 online Harness work remains a separate target; neither authorizes v1.0.
