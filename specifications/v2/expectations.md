# Independent native v2 expectations and validation suites

These implemented owner APIs retain independently supplied expected outcomes and execute actual formal checks. They do not prove the author understood the business requirement, record human semantic approval or establish product acceptance. The expected outcome must come from the user's requirements and admitted sources, never solely from the generated model or the validator's actual answer.

## Independent expectation identity

[`expectations.schema.json`](../../schemas/v2/expectations.schema.json) is the authoritative envelope and generates TypeScript/runtime projections. It reuses the model document/closure and SHACL target types. An immutable `ontology-expectations/v2` record binds project/asset, current intent, admitted source snapshot and its previous expectation digest. Its contract digest includes the referenced model and SHACL schema identities.

Each independent intent requirement declares its required methods (`owl`, `shacl` or both), actual source fragments and rationale. SHACL requirements declare stable target-shape and constraint-shape IRIs. Every required target shape must have a requirement owner. Every required method needs positive and negative case coverage, and every declared constraint shape needs a named negative oracle. Missing declarations/cases remain explicitly incomplete; model text cannot supply the missing denominator. Duplicate inputs cannot inflate coverage. Method/shape selection is itself a reviewable interpretation, not an automatically proven business truth.

OWL cases pin a nonempty logical entailment query and an independently expected `ENTAILED` or `NOT_ENTAILED` outcome. Query byte envelopes are verified on admission; formal parsing happens during execution. A logically empty/vacuous query cannot match an acceptance oracle, even if the formal engine correctly returns vacuous entailment. `NOT_ENTAILED` never means the negation was inferred.

SHACL cases pin independent fixture data/import closures, expected conformance and, for negative cases, named constraint shapes that must actually appear as `sh:sourceShape` in the native violation report. Candidate SHACL documents are used for every case; fixture data is never silently merged with the candidate's example individuals. The fixed required target ledger applies to each case. Core constraints used by negative oracles therefore need stable named shapes rather than anonymous IDs. A nonconforming case that violates a different constraint does not match its expected oracle.

The contract permits at most 32 cases and 16 MiB of expectation JSON internally. Existing RDF/import limits apply to each fixture/query, and the 512 KiB HTTP request limit remains the tighter inline limit. Incomplete expectations can be retained and repaired as drafts. The service cannot start a validation suite until the fixed requirement/method/constraint coverage is complete.

## Owner operations

| Operation | Input | Behavior |
|---|---|---|
| `expectations.record` | `definition` | Atomic immutable expectation snapshot, source checks, parent/revision check, receipt and audit |
| `expectations.inspect` | `assetId`, `expectationsDigest` or null | Identities, current/stale state, coverage and fixed case summaries |
| `expectations.read` | `assetId`, `expectationsDigest`, `offset`, `maxBytes` | Canonical definition JSON in UTF-8 pages up to 65,536 bytes |
| `expectations.list` | nullable `afterAssetId`, `limit` 1–100 | Scoped expectation heads, including assets not yet modeled |
| `validation.start` | `assetId`, `modelDigest`, optional `timeoutMs` | Retain and queue the exact suite; inline expected-outcome overrides are not accepted |
| `validation.inspect` | `taskId` | Lifecycle, actual result/completeness, model/expectation freshness and per-check event summaries |
| `validation.result.read` | `taskId`, `offset`, `maxBytes` | Exact retained result JSON pages and digest |
| `validation.list` | nullable `assetId`, nullable `afterTaskId`, `limit` 1–100 | Scoped task discovery for later conversations |
| `validation.cancel` | `taskId` | Durable cancellation request; actual worker exit determines the terminal result |

After expectations exist, `model.record` must bind their current `expectationsDigest`. Editing either the expectations or the source/intent makes the former model/result noncurrent; the author explicitly records a new model binding before another suite. Historical records and exact receipt replay never reactivate old heads. Records, tasks and reads remain credential/project scoped.

## Execution and outcomes

A suite uses the same owner lease, transaction, task queue and cancellation/restart barriers as individual reasoning tasks. The receipt/task/audit transaction must commit before any worker dispatch. DL and SHACL cannot run concurrently through different domain operations. Startup retains interrupted tasks without redispatch. Operator reconciliation and hard process-memory enforcement remain pending P4 work.

The fixed suite consists of candidate OWL legality/consistency, candidate asserted-view SHACL, and every independently declared OWL/SHACL case. The actual pinned Java and Python executors run sequentially. Each completed check records its expected/actual status, match, full native result and digest; a durable `CHECK_FINISHED` event identifies progress. A lost owner does not imply that missing evidence completed, and an event digest alone cannot substitute for retained full evidence.

`MATCHED` means every fixed formal check completed and matched, with complete source mappings. `MISMATCH` means all completed but at least one expected outcome or mapping did not match. `INCOMPLETE`, `TIMEOUT`, `CANCELLED` and `FAILED` cannot pass; they retain available checks and explicitly list missing check IDs. The suite stops at an incomplete formal check, cancellation or deadline and never auto-retries it. Unresolved model issues remain visible and require review even when formal expectations match. No outcome awards a Harness grade or approves delivery.

The total suite deadline is at most 120 seconds and retained suite evidence at most 16 MiB. Each child uses the smaller of its own limit and the remaining suite budget; exact effective child configurations remain in its result. An oversized or missing result cannot be replaced by an empty pass. Large retained results use paginated readback. Asynchronous progress/completion does not change the project authoring revision.

Foreground service configuration adds paired `--shacl-toolchain ABS --shacl-work-root ABS` to the DL toolchain options. Both actual executors are required for a full suite. `validationExecutionConfigured` reports this binding independently of product readiness, and `validationToolchainDigest` combines their exact identities. Domain requests cannot supply executable paths. Managed installation binding, derived-view validation, source-projected explanations, semantic review/delivery and actual Expert/Host acceptance remain required work.
