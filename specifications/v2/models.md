# Native v2 model drafts and formal tasks

Development contract under the approved v0.9 plan. Source tests do not establish complete OWL 2 DL conformance, actual Host acceptance, business approval or release readiness. Frozen v1 assets/specifications remain unchanged.

## Model identity and source grounding

[`model.schema.json`](../../schemas/v2/model.schema.json) owns the draft envelope and generates applicable readonly TypeScript types and its runtime schema. A draft binds an asset ID, current modeling-intent digest, current admitted source-set digest and previous draft digest. It contains an explicit OWL document/import closure, separate SHACL documents, requirement mappings and unresolved issues. Native authoring formats are Turtle and RDF/XML; the formal task query interface also supports Functional Syntax. Product version, state schema version, native contract version and future business asset version are separate identities.

The owner service records each draft immutably in the selected project. Both project revision and asset parent must match. Changing an intent or source admission makes the former model stale; changing a draft makes the former draft historical. Exact original-request replay returns its old receipt without changing the current head. Historical drafts and original document bytes remain readable by explicit identity.

Envelope checks verify bytes, document identities, the pinned import graph and mapping references. They do not parse logical RDF or establish legal OWL semantics. Syntax-invalid logical content can remain a repairable draft for a subsequent formal task. Source labels are never dereferenced. SHACL documents do not enter the OWL premise closure. The original document and closure digests remain distinct from semantic-equivalence claims.

Mappings reference independently retained intent requirements, admitted source fragments and nonempty UTF-8 ranges in model/shape documents. Ranges bind exact document and fragment digests. Unknown requirements, missing fragments and invented byte ranges fail. Omitted mappings remain explicit `missing` requirements and open issues remain visible. `mapping.complete` means all declared requirements have mappings; `semanticCoverage: NOT_EVALUATED` remains explicit. A range can locate relevant text but is not a parsed OWL axiom selector or a proof that the requirement is satisfied. Independent expected cases, parsed projections, SHACL checks and actual review remain required before delivery.

The request envelope is at most 48 MiB internally, with the existing DL closure limits (64 documents, 8 MiB/document, 32 MiB closure). SHACL text is separately limited to 16 MiB. Referenced model ranges total at most 32 MiB. The current 512 KiB HTTP envelope remains the tighter inline-operation limit. Document readback uses at most 65,536 original UTF-8 bytes per page and never splits a character.

## Owner operations

| Operation | Input | Result |
|---|---|---|
| `model.record` | `draft` | Durable project receipt with immutable model/closure digests, mapping completeness and unresolved count |
| `model.list` | `afterAssetId` (nullable), `limit` (1–100) | Scoped asset heads, current/stale indicators, cursor and observed project revision |
| `model.inspect` | `assetId`, `modelDigest` or null for the current asset head | Metadata, document manifests, mappings, issues and current/stale relationship |
| `model.document.read` | `assetId`, `modelDigest`, `documentId`, `offset`, `maxBytes` | Exact original-byte page and continuation offset |
| `reasoning.start` | `assetId`, `modelDigest`, typed `task`, optional bounded `timeoutMs` | Durable `QUEUED` task receipt; no logical conclusion yet |
| `reasoning.inspect` | `taskId` | Task state, exact identities, formal status/completeness, retained result when small, current/stale relationship and recent events |
| `reasoning.result.read` | `taskId`, `offset`, `maxBytes` | Pages of the exact retained JSON result, with its digest |
| `reasoning.cancel` | `taskId` | Cancellation request or confirmed pre-dispatch cancellation; active exit confirmation arrives in the task result |

All writes use the existing authenticated principal/project scope, request ID and expected project revision. Source/model/task records cannot be submitted as arbitrary formal results. Only the configured executor can produce task results. Internal modules share the owner's SQLite transaction/lease and cannot open a second product writer. Workspaces and reasoning worker directories are separate private locations.

## Task lifecycle and exact results

The start transaction retains the immutable model, complete formal request, closure, selected toolchain and effective configuration identities together with its normal receipt and audit. Dispatch is scheduled only after that transaction commits. A failed receipt insertion rolls back the task and never launches its worker. Only one queued/running task is accepted per owner service; another request receives a typed busy failure, not an automatic retry.

Task execution uses the actual installed Java toolchain. It stores a result only when request, closure, configuration and toolchain identities match. Formal statuses and completeness preserve the [reasoning executor contract](../../docs/reasoning-v090.md). Missing entailment is not negation; inconsistency is not ordinary business success. A model/source/intent change marks an older result noncurrent, even if that result correctly completed for its original input. Toolchain identity matching is reported separately. No result overwrites the asserted model or becomes semantic approval.

The request receipt proves that the task was accepted, not that inference completed. Task events and result digest have their own durable identity; asynchronous completion does not mutate a model or increment its project authoring revision. Review/delivery must later bind an exact terminal result digest, not merely a start receipt or project revision. Results larger than 256 KiB use paginated JSON readback. Task inspection returns at most the latest 100 event summaries, with total count and explicit completeness.

Queued cancellation can complete before dispatch. Active cancellation first records `CANCEL_REQUESTED`, then kills the owned worker; the runner waits for actual child exit and discards partial output before retaining `CANCELLED`. Ordinary service shutdown similarly waits for its active worker. Deadline failures remain incomplete. A persistence fault leaves the task unresolved and blocks further execution rather than returning a fabricated result.

Startup converts retained queued/running/cancel-requested tasks to `INTERRUPTED` and records the previous state. It never automatically redispatches them. Because process exit cannot be inferred from a lost owner, an interrupted task blocks new tasks until explicit operator recovery can verify and reconcile it. That recovery operation and orphan/total-memory enforcement remain pending P4 work; no cached PID is blindly signaled. Completed task replay/readback survives a restart without dispatch.

## Development configuration and remaining work

Foreground startup accepts paired `--dl-toolchain ABS` and `--dl-work-root ABS` operator arguments. Both refer to separately prepared private installed artifacts. Ordinary domain requests cannot choose executable paths or modify the toolchain. Absence of configuration returns `TOOLCHAIN_NOT_READY`. This optional execution binding is reported independently of product readiness: `reasoningReady` and `nativeV2Ready` remain false until the full required implementation and acceptance are satisfied.

Managed installation toolchain preparation/binding, larger-material uploads, native SHACL execution, independent expected-case coverage, derived graph views, semantic review, immutable delivery/export, full Expert/Host journeys and explicit interruption recovery remain required work. This draft/task implementation does not close those obligations.
