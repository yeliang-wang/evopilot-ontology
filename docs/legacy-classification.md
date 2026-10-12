# Retained source classification library

This compatibility library underlies the seven-operation [owned classification service](classification-service.md). Historical wire identifiers remain compatibility identifiers. A classification match and immutable handoff evidence do not establish Harness eligibility, approval, or publication.

The compatibility entry adds classification (engine), classifier, classificationAdvisor, classificationEvaluation, sourceDescriptor, and sourceConcept to the existing twelve namespaces. The eight native exports remain unchanged.

The eight copied modules preserve deterministic retrieval, thresholds, ambiguity, evidence normalization and redaction, static text extraction, protected-path and symlink confinement, and taxonomy-before-source-before-Advisor ordering. No source code is executed. Optional unavailable document extractors produce no analyzed text evidence; extractor captures are disposable.

Advisor accepts a trusted application callback through advisorProvider, never serialized source input. modelsFile is inert and does not authorize a provider or read credentials. Missing providers yield MODEL_NOT_CONFIGURED with PROVIDER_REQUIRED guidance and no classifier result. Callback modelBinding may supply providerId, modelId, revision and bindingDigest references; selected model, bounded usage, prompt and response digests are retained without a credential store. There is no automatic retry or fallback.

advisorTimeoutMs (callback timeoutMs) defaults to 180000 ms and must be a finite positive integer at most 180000. Invalid values return INVALID_ADVISOR_TIMEOUT with zero invocations before any durable claim; absent callbacks still return MODEL_NOT_CONFIGURED. A failed synchronous or asynchronous beforeInvocation claim propagates without calling the provider. The callback runs exactly once and may accept a second argument `{signal, analysisAttemptDigest}`; existing one-argument callbacks remain supported.

The deadline clears its timer on every terminal path, signals abort, and returns TRANSPORT_TIMEOUT with providerCompletion UNKNOWN and an inspection-before-new-attempt policy. The engine offers inspect/close, without automatic replay or a human approval gate. An injected callback cannot be forcibly killed: it can ignore abort, and synchronous work can block the event loop and delay timer delivery. Late results are discarded and late rejections consumed. The [owned service](classification-service.md) persists claims and outcomes, but application-specific reconciliation with external provider receipts remains necessary; a local timeout does not establish whether the external provider finished.

Callback responses pass the vendored descriptor-safe finite, acyclic plain-JSON check before field validation or hashing. Unsafe values, including accessors, cycles and BigInt, return ADVISOR_CONTRACT_REJECTED with rawDigest null, without executing getters or retaining rejected raw content. Valid response receipts, digests and usage retain their existing shape.

Public Git acquisition remains an explicit library capability. It requires explicit external cache confinement, uses a fixed minimal environment and disabled hooks/credential helpers, and uses public HTTPS without inherited SSH configuration. Local file/directory and ordered-member classification are readonly.

createClassificationHandoff validates the exact result digest, current source-policy version and fresh source evidence, then returns a deeply frozen copy. It neither imports nor creates Harness Operation Sessions.

Original pure classification and taxonomy boundary assertions are retained. Tests use synthetic source files and explicit deterministic advisors with the owned engine; they do not establish real LLM integration. See the [independent technical baseline](../README.md).

The [owned classification service](classification-service.md) implements start, inspect, resume, reanalyze, list, continue_to_harness and close, with durable claims, immutable admission receipts and bounded recovery. The [CLI](cli.md) and parent Preview MCP route these operations; start/reanalyze await classify. Resume only reads, UNKNOWN is never replayed, and reanalysis requires a known completed attempt. There is no separate cancel operation; close records closure.

Explicit application source/advisor/model configuration is required. Default CLI and Preview deployments provide none, and no old Runtime profiles or credentials are inherited. Harness eligibility, sessions and publication remain separate authority boundaries. Actual Desktop/Host full-journey acceptance, full migration, E03/E10 and source-ledger closure status must be obtained from a separate local acceptance report bound to the exact candidate; without that report, no acceptance can be claimed. Retention does not establish the full historical Host or gold-matrix journey.

Source and destination hashes, adaptations and original test links remain in [classification provenance](../provenance/legacy-classification.json) and [core provenance](../provenance/legacy-core.json).
