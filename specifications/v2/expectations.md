# Independent native v2 expectations and validation suites

These implemented owner APIs retain independently supplied expected outcomes and execute actual formal checks. They do not prove the author understood the business requirement, record human semantic approval or establish product acceptance. The expected outcome must come from the user's requirements and admitted sources, never solely from the generated model or the validator's actual answer.

## Independent expectation identity

[`expectations.schema.json`](../../schemas/v2/expectations.schema.json) is the authoritative envelope and generates TypeScript/runtime projections. It reuses the model document/closure and SHACL target types. An immutable `ontology-expectations/v2` record binds project/asset, current intent, admitted source snapshot and its previous expectation digest. Its contract digest includes the referenced model and SHACL schema identities.

Each independent intent requirement declares its required methods (`owl`, `shacl` or both), actual source fragments and rationale. SHACL requirements declare stable target-shape and constraint-shape IRIs. Every required target shape must have a requirement owner. Every required method needs positive and negative case coverage, and every declared constraint shape needs a named negative oracle. Missing declarations/cases remain explicitly incomplete; model text cannot supply the missing denominator. Duplicate inputs cannot inflate coverage. Method/shape selection is itself a reviewable interpretation, not an automatically proven business truth.

OWL cases pin a nonempty logical entailment query and an independently expected `ENTAILED` or `NOT_ENTAILED` outcome. Query byte envelopes are verified on admission; formal parsing happens during execution. A logically empty/vacuous query cannot match an acceptance oracle, even if the formal engine correctly returns vacuous entailment. `NOT_ENTAILED` never means the negation was inferred.

SHACL cases pin independent fixture data/import closures, expected conformance and, for negative cases, named constraint shapes that must actually appear as `sh:sourceShape` in the native violation report. Candidate SHACL documents are used for every case; fixture data is never silently merged with the candidate's example individuals. The fixed required target ledger applies to each case. Core constraints used by negative oracles therefore need stable named shapes rather than anonymous IDs. A nonconforming case that violates a different constraint does not match its expected oracle.

The contract permits at most 32 cases and 16 MiB of expectation JSON. Existing RDF/import limits apply to each fixture/query; the owner and transports enforce the native operation's bounded envelope instead of applying the generic 512 KiB request limit to this operation. The 30,000-node and depth-24 JSON limits still apply. Incomplete expectations can be retained and repaired as drafts. The service cannot start a validation suite until the fixed requirement/method/constraint coverage is complete.

## Owner operations

| Operation | Input | Behavior |
|---|---|---|
| `expectations.record` | `definition` | Atomic immutable expectation snapshot, source checks, parent/revision check, receipt and audit |
| `expectations.inspect` | `assetId`, `expectationsDigest` or null | Identities, current/stale state, bounded coverage/case summary and metadata pointer |
| `expectations.metadata.read` | `assetId`, `expectationsDigest`, `projectionDigest`, `offset`, `maxBytes` | Complete stable coverage and fixed case-summary projection in UTF-8 pages up to 65,536 bytes |
| `expectations.read` | `assetId`, `expectationsDigest`, `offset`, `maxBytes` | Canonical definition JSON in UTF-8 pages up to 65,536 bytes |
| `expectations.list` | nullable `afterAssetId`, `limit` 1–100 | Scoped expectation heads, including assets not yet modeled |
| `validation.start` | `assetId`, `modelDigest`, optional `timeoutMs` and `view` | Retain and queue the exact suite; inline expected-outcome overrides are not accepted |
| `validation.inspect` | `taskId` | Lifecycle, actual result/completeness, model/expectation freshness and per-check event summaries |
| `validation.result.read` | `taskId`, `offset`, `maxBytes` | Exact retained result JSON pages and digest |
| `validation.list` | nullable `assetId`, nullable `afterTaskId`, `limit` 1–100 | Scoped task discovery for later conversations |
| `validation.cancel` | `taskId` | Durable cancellation request; actual worker exit determines the terminal result |

After expectations exist, `model.record` must bind their current `expectationsDigest`. Editing either the expectations or the source/intent makes the former model/result noncurrent; the author explicitly records a new model binding before another suite. Historical records and exact receipt replay never reactivate old heads. Records, tasks and reads remain credential/project scoped.

An expectation's stable metadata projection includes its immutable identities, complete `coverage.missing` evidence and all fixed case summaries. Inspection always returns a `metadata` pointer with the projection digest, canonical JSON UTF-8 byte length, reader operation, page limit and `inline` flag. At or below 256 KiB, inspection includes the complete projection with `inline:true`; the small write receipt keeps its original coverage shape and has no metadata pointer. Above that bound, the write receipt also includes the pointer with `inline:false`, neither response includes `coverage.missing`, and inspection omits `cases`; `coverage.missingCount`, the coverage requirement/case counts, inspection's `caseCount` and `metadata.inline:false` describe the omission. Missing evidence is never replaced with an empty list or a truncated success. The pointer permits full readback even when the missing-coverage ledger alone exceeds the 1 MiB response budget.

Metadata pages pin both the expectation digest and projection digest. The projection excludes mutable freshness; each page reports `current` separately, so historical bytes and their digest remain stable after a new expectation or intent is recorded. A mismatched projection digest, invalid UTF-8 offset, page size outside 4–65,536 bytes or wrong project scope is rejected. `expectations.read` remains the complete canonical definition reader, including fixture/query content; metadata pages contain the coverage projection and case summaries rather than those documents. Successful authoring or complete page retrieval does not make incomplete coverage complete or supply business approval.

## Execution and outcomes

A suite uses the same owner lease, transaction, task queue and cancellation/restart barriers as individual reasoning tasks. The receipt/task/audit transaction must commit before any worker dispatch. DL and SHACL cannot run concurrently through different domain operations. Startup retains interrupted tasks without redispatch. Operator reconciliation and hard process-memory enforcement remain pending P4 work.

The fixed suite consists of candidate OWL legality/consistency, candidate SHACL against the explicitly selected view (asserted by default), and every independently declared OWL/SHACL case. The actual pinned Java and Python executors run sequentially. Each completed check records its expected/actual status, match, full native result and digest; a durable `CHECK_FINISHED` event identifies progress. A lost owner does not imply that missing evidence completed, and an event digest alone cannot substitute for retained full evidence.

`MATCHED` means every fixed formal check completed and matched, with complete source mappings. `MISMATCH` means all completed but at least one expected outcome or mapping did not match. `INCOMPLETE`, `TIMEOUT`, `CANCELLED` and `FAILED` cannot pass; they retain available checks and explicitly list missing check IDs. The suite stops at an incomplete formal check, cancellation or deadline and never auto-retries it. Unresolved model issues remain visible and require review even when formal expectations match. No outcome awards a Harness grade or approves delivery.

The total suite deadline is at most 120 seconds and retained suite evidence at most 16 MiB. Each child uses the smaller of its own limit and the remaining suite budget; exact effective child configurations remain in its result. An oversized or missing result cannot be replaced by an empty pass. Large retained results use paginated readback. Asynchronous progress/completion does not change the project authoring revision.

Foreground service configuration adds paired `--shacl-toolchain ABS --shacl-work-root ABS` to the DL toolchain options. Both actual executors are required for a full suite. `validationExecutionConfigured` reports this binding independently of product readiness, and `validationToolchainDigest` combines their exact identities. Domain requests cannot supply executable paths. Managed installation binding, source-projected explanations, semantic review/delivery and actual Expert/Host acceptance remain required work.

Validation can explicitly select an [owner-retained derived view](views.md) for the candidate check. Its request and response bind the graph kind and exact view digest. OWL checks continue to use the original closure. Independent positive/negative SHACL fixtures remain unchanged asserted graphs; candidate entailments never leak into those fixture oracles. A stale view or changed reasoning toolchain cannot be selected.
