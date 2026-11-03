# Native v2 retained model comparison

`model.compare.read` compares exact historical or current versions of one asset in the authenticated workspace/service/project. It is a read operation: no new task, model, receipt, decision, delivery or source fetch is created. A read cannot revive stale evidence. This is implemented source behavior; actual Host evolution acceptance remains required.

The input is `assetId`, `from`, `to`, `offset` and `maxBytes`. Each side contains `modelDigest`, `validationTaskId` and `viewDigest`; use explicit null for either optional evidence selection. All supplied evidence must belong to that exact model and asset. The owner revalidates original source/model/expectation bindings, complete native check identities and any selected derived graph against retained actual reasoning tasks. Unknown, unfinished, interrupted, incomplete, wrong-model or corrupted selected evidence is refused. Omitting a task explicitly yields `NOT_EVALUATED`, never an unchanged or passing formal comparison. Complete `MISMATCH` suites are useful comparison evidence; they remain ineligible for candidate review.

For a delivered baseline, follow `delivery.inspect` to its `candidateDigest`, then `review.inspect` to its model, validation task and optional `projectionDigest`. This distinguishes the actual delivered version from a newer unreviewed draft. The service does not guess versions from names or lexical ordering, or guess that two renamed entities are equivalent.

## Report and interpretation

The deterministic `ontology-model-comparison/v2` report binds both exact input sets and the selected task request/result/configuration/toolchain identities. It reports:

- Purpose/scope/mode, requirement statements, source metadata/fragments, original ontology/shape document byte identities, root/import changes, declared mappings, independent expectations and unresolved issues.
- Each fixed case's original expected and actual outcomes, evidence digest and match result. Added/removed cases, changed query or fixture, changed oracle, changed requirement/shape bindings and changed toolchain are explicit. A fixed-case regression is reported only with the same probe/oracle/required-shape set and toolchain; candidate shapes may change because they are what the fixture tests.
- Gained/lost OWL entailment only for the same exact query with consistent completed models and the same toolchain. `NOT_ENTAILED` never proves negation. Inconsistency is shown in base checks and prevents ordinary gain/loss claims. Changed probes cannot establish a regression. A changed expected answer is shown even when both versions' suites match.
- Requirement impact supported by changed source fragments, authored document mappings, expectations and observed cases. A changed import closure triggers recheck visibility for all requirements. These are potential impact and interpretation records, not parser-level axiom provenance, complete dependency analysis or proof of business meaning.
- Optional finite named projection differences, with per-triple task provenance and both selection scopes. Comparability requires equal task kinds, requested entities/directness and toolchain. A triple observed only on one side is not proof of negation; different selection scopes are explicitly non-comparable. Omitted inverse expressions remain counted.

Original bytes and semantic meaning are separate: whitespace or serialization changes still change document identity, while unchanged fixed-case results do not prove semantic equivalence. The report explicitly retains `semanticEquivalence: NOT_PROVEN` and `completeImpactAnalysis:false`. It does not claim all consequences or live downstream execution impact.

## Pagination, freshness and review

`offset`/`maxBytes` use UTF-8 bytes, with pages of 4–65,536 bytes and no split characters. Read through `nextOffset:null`. Every page carries the complete report's `reportDigest`/`documentDigest`; verify the assembled bytes. The report is bounded to 32 MiB and fails rather than truncating. Original full content remains available through `source.fragment.read`, `source.read` and `model.document.read`.

Freshness is outside the hashed report: each page names the currently observed project revision and both models' current-binding/configured-toolchain relationships. The same exact historical comparison remains byte-identical after later revisions or restart and can be read with executors disconnected. This preserves history without asserting it is usable for a new decision.

The Expert shows this report beside the exact new candidate, follows changed premises to their original source fragments, resolves mismatches without weakening independent oracles, and retains the comparison's from/to/report identities in the actual Host review context. The current delivery bundle does not automatically embed the separate comparison report. Actual semantic approval and immutable new delivery use the [lifecycle operations](lifecycle.md); a comparison read never grants either authority. Source tests use explicitly synthetic decisions, not actual business approval.
