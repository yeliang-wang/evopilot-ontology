# Owned classification service

The seven migrated operations use the owned `compat/v4/classification` engine. They create evidence, never publication, approval, quality eligibility or Harness assets. CLI, MCP, Expert integration and application provider composition remain pending. Filesystem verification is for the operator; E03/E10 are not marked passed.

Construct `createOntologyService({workspaceRoot, workspaceId}, trustedProviders)`, then explicitly `initialize()`. Existing `resolveLegacyHarness` remains supported. The closed trusted provider object additionally accepts:

- `resolveClassificationSource({sourceId, scope, workspace})`: synchronous code callback returning exactly `{sourceId, scope, workspace, resolvedSource}`. `workspace` is the complete service workspace identity, echoed exactly alongside source and scope. `resolvedSource` is an owned engine resolved source descriptor, not a raw path. The composition layer registers and resolves the source; public requests cannot supply provider code, paths or raw workspace configuration.
- `classificationAdvisor(input, context)`: async or synchronous advisor callback with the existing owned candidate-analysis contract. Context includes abort signal and analysis attempt digest. Callback properties are never used as configuration.
- `classificationModel`: exactly `{providerId, modelId, revision, timeoutMs}`. Identities are explicit 1–64 character lowercase alphanumeric/hyphen slugs; timeout is an integer from 1 through 180000 ms. No model configuration file or credentials are accepted.

Every public request has `{operation, scope, input}`. Scope is exactly `{visibility: 'public'|'private', projectId: slug}`. Mutations additionally require a fresh slug `requestId` and exact global `expectedRevision`. Unknown fields and accessors are rejected. Taxonomy must be an inline document accepted by the existing taxonomy resolver; file locator strings are rejected.

| Operation | Method | Exact input |
| --- | --- | --- |
| classification.start | `await service.classify(request)` | `id, sourceId, taxonomy` |
| classification.reanalyze | `await service.classify(request)` | `id, sourceId, taxonomy` |
| classification.inspect | `service.execute(request)` | `id` |
| classification.resume | `service.execute(request)` | `id` |
| classification.list | `service.execute(request)` | none |
| classification.continue_to_harness | `service.execute(request)` | `id, decisionToken, humanEvidence` |
| classification.close | `service.execute(request)` | `id` |

Start, reanalyze, continue_to_harness and close are mutations. Start/reanalyze through execute fail `ASYNC_REQUIRED`. `classify` waits for the bounded runner, but returns the original immutable admission receipt with status PENDING. Read inspect/resume for the current outcome. Replaying the same request reads that original receipt, even with an old expectedRevision; different intent under the same request id fails. A duplicate never invokes the provider. Refresh workspace.inspect for the current revision because admission, private invocation claim and completion each advance the global revision.

Before invocation, a durable private claim records attemptId, inputDigest, modelBinding and engine analysisAttemptDigest. No SQL transaction spans an await. Completion reads the latest state and checks the exact active session/attempt, so unrelated global writes do not discard a valid completion. Neither claims nor completion results are public operations. Attempt identities derive from workspace, scope, session id and caller requestId, without random or time identity fallback.

Prepared source, taxonomy, source snapshot, result, model identity and attempt history persist in optional SQLite state collections compatible with existing version-1 state. Prepared/result blobs are digest checked and verified on reads and replay. Limits are 64 sessions, 16 attempts per session, 16 handoffs per session, the existing 512 KiB JSON bound per prepared/result payload, 8 MiB total state, 10000 receipts and 32 MiB total receipt bytes. Capacity is checked before admission; completion storage failure leaves a recoverable unresolved attempt. No garbage collection or implicit retry is performed.

Successful engine results become COMPLETED. Timeout, throw or invalid provider data becomes UNKNOWN with advisor blocker metadata. Pending attempts observed by another instance or after restart are reported UNKNOWN and remain unresolved. Resume only reads; it never invokes an advisor. Reanalysis requires a new request, a known completed prior attempt, the same registered sourceId and newly validated taxonomy/source. CLOSED and uncertain sessions cannot reopen. Inspect and close remain available after UNKNOWN. Late provider settlement is consumed and cannot replace UNKNOWN/CLOSED. Closing the service instance does not infer provider completion; persisted pending work stays unresolved.

Handoff requires the persisted, integrity-checked TAXONOMY_MATCHED result. `decisionToken` is exactly `CONTINUE_TO_HARNESS:<id>:<analysisResultDigest>`. `humanEvidence` is exactly `{uid, analysisResultDigest, evidenceRef}`; uid must equal both the owning session uid and current OS uid, and the digest must equal the result. evidenceRef is a 1–256 character reference using alphanumerics and `:._/-`, beginning alphanumeric. The owned engine rechecks current source snapshot and result digest. The handoff is retained only in Ontology blobs/history/audit; it starts no Harness session.

Missing configured advisor/model or resolver yields explicit `CLASSIFICATION_PROVIDER_UNAVAILABLE` or `CLASSIFICATION_SOURCE_UNAVAILABLE` before dispatch. Resolver binding mismatch fails before filesystem preparation. Project and visibility boundaries apply even when another session id is known. Errors use safe diagnostics without provider exception text.

Verification: `node scripts/check.mjs` (the check/build implementation), and the read-only discovery test pass locally. Operator command: `node --test tests/e2e/classification-service.test.mjs`, followed by the existing complete suite. Tests use ephemeral synthetic cache documents and the actual owned engine with an explicit synthetic advisor.
