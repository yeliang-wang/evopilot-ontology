# EvoPilot-ontology v0.9.0 Preview implementation plan

Status: implementation authorized; product acceptance NOT_EVALUATED. This plan records intended v0.9 behavior, not existing installed capability. Latest source baseline remains package 0.8.3 until candidate packaging.

## Outcome and ownership

Deliver an independently installable Ontology Expert, plugin, scoped HTTP MCP/service and CLI; complete OWL 2 DL reasoning; source-grounded native asset lifecycle; maintenance and historical test-asset reset. A user can initialize an empty workspace, model, validate, reason, revise, review, deliver, query and evolve without installing the parent, Runtime or Harness. Native asset delivery is local/private unless separately selected; it does not upload to GitHub.

Ontology owns semantic assets, formal inference, SHACL validation, provenance and immutable deliveries. Host models provide conversation/modeling assistance, never logical proof. No embedded LLM account/profile or second Agent loop. Harness remains optional, owns independent quality/grading, and cannot be impersonated by standalone content checks. Runtime owns its execution; no Goal/Run is required for Ontology operations. Parent becomes navigation/composition documentation. Independent Expert/public planning replaces the retired orchestrator entry; do not restore retired skills.

The former v0.9 business-metric candidate must be coordinated in the parent index: retain it as a future candidate without silently incorporating actual observation, SQL or arithmetic execution. No Runtime worktree or independent in-progress plan is overwritten.

## P0–P6

| Stage | Work | Exit evidence |
|---|---|---|
| P0 | Exact source/authorization, replacement ADR, roadmap/Target, fixed requirements and environmental bindings | Verified governance, independent scope, parent coordination record; no synthetic PASS |
| P1 | Independent service, installation, owned Expert/plugin/MCP/CLI and empty workspace entry | Actual Host installation and first-use journey; no parent/Runtime/Harness dependency |
| P2 | Native v2, complete DL reasoning, SHACL, locked imports, explanations and result identity | Standards/task cases with independent expectations and actual locked toolchain |
| P3 | Forward, reverse, composition/evolution, correction/review/delivery/query | Full installed Expert journeys including refusal and resumable drafts |
| P4 | Maintenance, recovery, consumer integration and old-entry handoff | Fault/restart receipts, exact v2 consumer readback, no stale-reference reuse |
| P5 | Exact candidate acceptance, distribution, bilingual docs and CI | All pre-release cases pass for identical candidate; no skip/unknown |
| P6 | Conditional publication, downloaded installation, scoped daily test-asset purge | Post-release actual readback, empty daily ontology workspace, preserved non-target state |

## Standards and complete reasoning

RDF 1.1/Turtle 1.1 authoring, RDF/XML interchange, RDFS and full OWL 2 DL under Direct Semantics. Support the standard datatype map and legal global restrictions. This is not OWL 2 Full, SWRL or arbitrary query execution. OWLAPI/HermiT is the first implementation candidate; verify exact distribution, dependency hashes, licenses and actual capability. An unresolved valid-DL feature gap blocks release rather than narrowing this promise. Java reasoning and Python RDFLib/pySHACL adapters stay bounded upstream executors; owned orchestration uses strict TypeScript.

Tasks: DL legality, consistency, class satisfiability, class/property hierarchy and equivalence, instance realization, property/inverse/transitive/chain entailment, same/different individuals, keys, datatype reasoning and axiom entailment. Freeze separate task outputs, complete standard-conformance corpus plus combination/negative cases, and support matrix. Examples alone do not establish complete support. Resource limits return incomplete status; mandatory reference cases must actually finish.

Result statuses distinguish ENTAILED, NOT_ENTAILED, INCONSISTENT, INVALID_INPUT, MISSING_IMPORT, TIMEOUT, CANCELLED and FAILED; resource-limit details are explicit. Not entailed does not mean its negation. Inconsistent ontologies do not yield ordinary trustworthy business conclusions. Unsatisfiable classes are reported separately from whole-ontology inconsistency. Named result projections are finite and never called all logical consequences. Explanations identify replayable supporting axioms/source fragments; do not promise all minimal justifications. Explanation timeout is separate from entailment outcome.

Lock the complete import closure by identity/digest, resolve offline from admitted materials, refuse missing/conflicting/private-inaccessible dependencies, and never dereference arbitrary remote ontology URLs during reasoning. XML external entities are disabled. Anonymous witnesses are not fabricated named business objects. sameAs is not physical record merge or cross-scope authorization.

## Native assets and convergence

Introduce explicitly versioned native asset contract v2 without editing frozen v1 bytes. Product version, native contract, readiness v2 and business asset version are different identities. OWL model owns formal meanings; SHACL owns graph requirements; JSON Schema 2020-12 owns envelope/manifest structure; generate applicable TypeScript types and projections. Source bindings own provenance/fragment/digest; JSON Pointer applies only to JSON sources. Optional PROV-O mapping is not duplicate mandatory authoring. Independent expected requirements/coverage and case oracles cannot be derived solely from generated models.

SHACL Core plus bounded local SHACL-SPARQL remains independent of OWL reasoning. Every validation names asserted or explicit derived view and its scope/digest. Missing required shapes, disabled shapes, empty required targets, missing coverage and stale report replay cannot pass. OWL ranges and cardinality do not automatically become closed-world required fields. Preserve original file hashes separately from semantic-equivalence checks. Pin inference input closure, tool/config identity, projected result scope, freshness and delivery. Any input/closure change invalidates derived results. Derived files never silently overwrite authoritative inputs.

## Independent Expert extraction

Ontology owns one canonical Expert source; plugin resources are generated/package-verified from it. Extract purpose/scope/source binding, forward/reverse/composition modeling, definitions/constraints/provenance explanation, validation/correction/comparison, review/publication/export, receipt reconciliation and owned maintenance from the parent. Add DL reasoning/explanations and independent first use. Map every extracted journey to its original current guide and exact owning API; historical retired mutations are not restored. Keep Runtime software execution and Harness quality policy at their owners. Transfer ownership and provide explicit old-entry handoff; no divergent copied guide remains authoritative.

The plugin contains Skill plus authenticated HTTP MCP configuration; CLI and MCP use the same owner service and single writer. Selection persists across follow-ups but does not govern unrelated chats. Inspect actual installation/service/project rather than inferring readiness from a plugin name. Users need not write raw envelopes, hashes or decisions. Preserve scoped requests, expected revisions, request IDs, durable receipts and recoverable drafts. No direct DB fallback, implicit credential copying, automatic redispatch after unknown response or fabricated human review. Installer/maintenance privileges are not reachable through ordinary domain APIs.

User journey: actual installation/connection/toolchain -> purpose/sources/independent expectations -> draft -> SHACL/OWL/coverage -> explain and correct -> review exact candidate -> immutable private delivery -> source-bound queries -> source/requirement changes -> compare/reason/review/new delivery. Recovery resumes owner records across conversations. Rejection preserves draft and prior delivery. Formal grades remain optional Harness results, never locally self-awarded.

## Business journeys and independent expectations

1. Sensitive-service classification: Service and accesses some SensitiveDataset implies SensitiveService by reviewed equivalence. Remove the sole access premise: NOT_ENTAILED, not automatically non-sensitive. Explain and replay all premises.
2. Dependency chain: usesDataset followed by sourcedFrom entails dependsOnSource; changed source changes downstream inference, not a confirmed incident cause.
3. Read-only conflict: read-only defined as no write target, explicit write target yields inconsistency; correction restores consistency.
4. Unsatisfiable template: subclass of two disjoint execution modes is unsatisfiable without making an uninstantiated ontology inconsistent; adding an instance changes that result.
5. Identity mapping: legal key premises entail same individual; explicit different-individual assertion exposes inconsistency; no physical merge or access expansion.
6. Metric dependency: declared transitive dependencies produce indirect dependency and bounded impact report, not live values/arithmetic.
7. Cross-model alignment: reviewed equivalence/subsumption propagates classifications; ambiguous lexical labels alone never create equivalence.

All three entry journeys (forward, source-grounded reverse, composition/evolution) include actual Host correction, refusal, delivery, later-session readback and at least one substantive model change. Synthetic isolated assets are labeled; they do not certify private business truth. Daily business assets are not rebuilt automatically.

## Workspace reset and integration

At P6 inventory both editable and protected test-asset stores, including legacy copies, history/export/cache/index and active consumer references. Exact real paths/scopes are private evidence, never public governance. Pause relevant writers and consumers; journal a resumable owner-scoped reset; independently verify deletion and preserved non-target records after restart. Reset is explicit maintenance, never an installation side effect. Temporary recovery material is purged after verified completion; retain minimal manifests/digests/audit receipts. Interrupted reset blocks affected use and reconciles its original journal.

Delete selected test ontologies and asset-contained source copies; clear active pointers. Keep original source/requirements, credentials, workspace identity/config, installed tools, independent audit, historical source backups and software releases. Historical execution references retain their old identity and become unavailable; they never resolve to same-name new content. No recursive whole-workspace deletion or whole Runtime database purge. Capture the initial complete deletion inventory at execution, not a fixed count from earlier inspections.

Affected Harness dependencies must become unavailable. Already-authorized test Harness deletion is separately scoped/receipted; no Harness rebuilding or unrelated product evolution is required. New v2 public consumer contract and explicit unsupported-version behavior require integration verification. Cross-owner cleanup uses owner APIs/explicit maintenance, not silent foreign-store edits. Parent old-entry routing must not break active Runtime work.

## Resource and execution envelope

Initial reference corpus target: 2,000 logical axioms, 5,000 named individuals, 20,000 instance assertions, with individually pinned complexity patterns. One reasoning worker, 120-second task deadline, 2 GiB worker memory ceiling; explanation has a separate 30-second deadline. These are acceptance targets, not measured performance or a guarantee for arbitrary ontologies. Pin actual hardware/OS/JDK/toolchain before execution. Larger/adversarial and cancellation fixtures verify limits; host-process overhead is reported separately. No ArgoDB/database/SSH/production load tests are required. Transport/source/import byte/count/depth budgets must be frozen before exposing those handlers; failure must not become empty success.

## Acceptance and release

The machine matrix maps every required capability to fixed independent observations, positive/negative/recovery variants and an expected collector. Matrix existence, guidance text, build, tests and CI do not self-certify Host or product acceptance. Standard conformance uses W3C cases plus independently fixed task/combination oracles; no generated answer is its own oracle. Every receipt binds exact candidate/tool/input hashes and origin. Reference cases cannot be waived by reporting resource limits. Required missing/skipped/unknown/unrun cases block pre-release readiness. Post-release downloaded package/current installation/empty-workspace checks remain required for final completion.

Scope excludes Dashboard/browser UI, universal codegen/LinkML platform, arbitrary SQL, live metric arithmetic, production actions, SWRL, general BI/graph hosting and automatic private asset rebuilding. Readable graph/entity/constraint/source projections are in scope, not a new UI. Published old versions/standards remain immutable.

References: [OWL 2 Direct Semantics](https://www.w3.org/TR/owl2-direct-semantics/), [OWL 2 conformance](https://www.w3.org/TR/owl2-conformance/), [SHACL](https://www.w3.org/TR/shacl/), [replacement ADR](architecture/0001-ontology-v090-independence.md), [acceptance matrix](../governance/acceptance-v090.json).
