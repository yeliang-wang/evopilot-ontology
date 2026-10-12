# Readonly source classification extraction

This is partial M1 calculation-library work, not full E03 or M1 completion. Historical wire identifiers remain compatibility identifiers. A classification match and immutable handoff evidence do not establish Harness eligibility, approval, or publication.

The compatibility entry adds classification (engine), classifier, classificationAdvisor, classificationEvaluation, sourceDescriptor, and sourceConcept to the existing twelve namespaces. The eight native exports remain unchanged.

The eight copied modules preserve deterministic retrieval, thresholds, ambiguity, evidence normalization and redaction, static text extraction, protected-path and symlink confinement, and taxonomy-before-source-before-Advisor ordering. No source code is executed. Optional unavailable document extractors produce no analyzed text evidence; extractor captures are disposable.

Advisor accepts a trusted application callback through advisorProvider, never serialized source input. modelsFile is inert and does not authorize a provider or read credentials. Missing providers yield MODEL_NOT_CONFIGURED with PROVIDER_REQUIRED guidance and no classifier result. Callback modelBinding may supply providerId, modelId, revision and bindingDigest references; selected model, bounded usage, prompt and response digests are retained without a credential store. There is no automatic retry or fallback.

advisorTimeoutMs (callback timeoutMs) defaults to 180000 ms and must be a finite positive integer at most 180000. Invalid values return INVALID_ADVISOR_TIMEOUT with zero invocations before any durable claim; absent callbacks still return MODEL_NOT_CONFIGURED. A failed synchronous or asynchronous beforeInvocation claim propagates without calling the provider. The callback runs exactly once and may accept a second argument `{signal, analysisAttemptDigest}`; existing one-argument callbacks remain supported.

The deadline clears its timer on every terminal path, signals abort, and returns TRANSPORT_TIMEOUT with providerCompletion UNKNOWN and an inspection-before-new-attempt policy. The engine offers inspect/close, without automatic replay or a human approval gate. An injected callback cannot be forcibly killed: it can ignore abort, and synchronous work can block the event loop and delay timer delivery. Late results are discarded and late rejections consumed. Inspection and reconciliation with actual Runtime provider receipts remain pending integration; a local timeout does not establish whether the external provider finished.

Callback responses pass the vendored descriptor-safe finite, acyclic plain-JSON check before field validation or hashing. Unsafe values, including accessors, cycles and BigInt, return ADVISOR_CONTRACT_REJECTED with rawDigest null, without executing getters or retaining rejected raw content. Valid response receipts, digests and usage retain their existing shape.

Public Git acquisition remains a library capability and was not invoked in this batch. It requires explicit external cache confinement, uses a fixed minimal environment and disabled hooks/credential helpers, and uses public HTTPS without inherited SSH configuration. Local file/directory and ordered-member classification are readonly.

createClassificationHandoff validates the exact result digest, current source-policy version and fresh source evidence, then returns a deeply frozen copy. It neither imports nor creates Harness Operation Sessions.

Original pure classification assertions and all taxonomy boundary assertions were ported. Tests use real synthetic temporary files and injected deterministic test providers; they do not represent real LLM integration. The approved candidate-impact JSON fixture is embedded in the test so installed tests never read the legacy checkout. Persistent CLI, Host, server, replay and recovery portions remain pending.

Verification in this bounded batch: 11 core tests and five selected pure classifier/taxonomy tests passed. Syntax is checked with node --check. Real temporary-file, static extractor, subprocess and package-isolation execution remain for the parent run.

Subsequent bounded callback repair: six focused asynchronous regression tests passed locally, including short deadlines, late completion, claim failures, unsafe JSON and timer cleanup. Full-suite execution remains with the parent run; this repair makes no M1 or E01–E19 acceptance claim.

Pending:
- Real external model integration and Runtime-owned reference-only provider binding (M2).
- Seven persistent classification MCP lifecycle operations: start, inspect, resume, reanalyze, list, continue, close (M2); cancel is an action through close. Retained Host/CLI/server recovery and lifecycle integration remain pending.
- Harness eligibility, Operation Sessions, proposals, approval and publication.
- Full original persistent 48-case gold-matrix replay and real stdio Host acceptance.
- Public Git acquisition, network integration and real temporary-files/process/extractor tests in the parent run.
- Full E03 and M1 completion.

Source and destination hashes, adaptations and original test links are recorded in [legacy-classification provenance](../provenance/legacy-classification.json). Existing [core provenance](../provenance/legacy-core.json) retains its origin and records this request as a subsequent change.
