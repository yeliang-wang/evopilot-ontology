# Native v2 exact review and private immutable delivery

This implemented development lifecycle binds independently fixed expectations and actual formal results to a reviewable candidate. It does not establish full OWL conformance, actual Host acceptance or software release readiness. [Candidate](../../schemas/v2/candidate.schema.json), [decision](../../schemas/v2/review.schema.json) and [delivery](../../schemas/v2/delivery.schema.json) schemas generate TypeScript/runtime contracts. Historical v1/vendor bytes are unchanged.

## Exact candidate and source explanation

`review.prepare` takes `assetId`, `modelDigest`, proposed business asset `version`, `previousDeliveryDigest` (null for first delivery), `validationTaskId` and `explanationTaskIds`. Versions are explicit bounded identifier labels; the service neither guesses a semantic version nor orders labels lexically. The candidate binds workspace/service/project/asset/version, original intent/source set, model and import closure, independent expectations, exact validation request/result/configuration/toolchain, selected graph, and explanation evidence. There is no package release or remote upload.

The required validation suite must actually be complete and `MATCHED`, with every independently fixed case present, exact native request/graph identity, required negative constraint violations, complete model mappings and no unresolved model issues. Every positive OWL entailment case requires an actual completed entailment explanation of its exact query and closure. Missing, timed-out, mismatched, cancelled or stale evidence blocks candidate preparation. Current toolchain bindings and actual inventories are checked before preparing, approving or delivering. View production and business-source interpretations remain distinct from formal proof.

`explanation.read` takes `assetId`, `modelDigest`, `taskId`, `offset` and `maxBytes`. It projects actual supporting OWL structural axioms, their model-document identities, replay material, author-declared source mappings and original source fragment coordinates. Follow original content with `source.fragment.read` and `model.document.read`. Structural axiom origin comes from the engine; a business mapping is an author interpretation at document level. The output explicitly reports `axiomByteSpanEstablished:false`, `businessMeaningProven:false`, and `sourceLinkPrecision: DOCUMENT_MAPPING_NOT_AXIOM_BYTE_LOCATION`. It does not invent an exact parser token range or claim that a prose sentence formally entails the axiom. Each supporting model document must have a retained source mapping before review can be prepared. A logically valid consequence with no supporting premise is displayed as such, not supplied invented premises. All-minimal-justification enumeration is not promised.

`review.inspect` returns candidate metadata, report digest, applicable latest decision and current/stale status. `review.report.read` returns the complete report in UTF-8 byte pages up to 65,536 bytes. The report includes actual original source bytes, purpose/requirements, model, shapes, expectations, native validation results, explanations and any selected derived view. Its stable digest binds precisely the material shown for review. The Expert presents business meaning and keeps protocol preparation out of the user's task. A report does not claim semantic approval.

## Authenticated semantic decision

Ordinary author credentials have `read`/`write`; `review.decide` requires a separately granted `review` permission. Reviewer-only credentials can read and decide but cannot author a model, run a task, or deliver. The local operator provisions a reviewer while the service is stopped:

```text
evopilot-ontology reviewer-grant --root ABS --workspace ID --service ID --project ID --principal ID --grant-id ID --expires-at UTC --json
evopilot-ontology reviewer-revoke --root ABS --workspace ID --service ID --grant-id ID --json
```

Expiry is an explicit canonical UTC timestamp within 30 days. Issuance retains a private request/token record before atomically changing credential configuration. An identical grant request can reconcile partial issuance; changed parameters or a revoked grant cannot be overwritten. The response exposes the protected credential-file path, never token bytes. The operator prepares a separate reviewer connection using that file. Issuance/revocation cannot run through domain/MCP APIs or while another owner holds the workspace. Revocation prevents subsequent authenticated requests; it does not rewrite already recorded decisions or deliveries. A new explicit rejection can supersede approval of a still-pending candidate.

`review.decide` takes `assetId`, `candidateDigest`, `reportDigest`, `previousDecisionDigest`, `decision: APPROVE | REJECT`, `rationale`, `instruction: {reference,content}` and `requirementIds`. Approval acknowledges every fixed requirement. The server binds the authenticated principal/grant and timestamps the immutable decision. Parent and project-revision checks prevent overwriting another decision. Ordinary author credentials cannot submit a decision even with a self-asserted human name or a quote.

The trust claim is **authenticated reviewer submission**, not independent verification of a remote chat message or the person holding the credential. The trusted reviewer/Host must supply the actual user instruction after presenting this exact report; that evidence remains a separate actual Host acceptance obligation. Source text, test fixtures, LLM-generated assertions, generic implementation authorization and formal checks cannot substitute for a business decision. Source tests label their decisions synthetic. Granting a reviewer credential alone records no semantic decision.

Approval requires a current candidate. A changed source/intent/model/expectation, toolchain binding or preceding delivery makes the old approval inapplicable to new delivery. Rejection can be recorded for a stale candidate and preserves every draft and old delivery. Correct the model, rerun its checks and prepare a new candidate as needed. Do not repeat approval for an unchanged current candidate that already has an applicable actual decision. Decision authority is `MODEL_SEMANTICS_ONLY`; it cannot award Harness grades or authorize software release.

## Immutable local delivery and export

`delivery.record` takes `assetId`, `candidateDigest` and `reviewDigest`, requires author write permission, and rechecks the exact current candidate and latest approved decision. It records a private self-contained bundle, asset-version uniqueness and delivery head in the same project-revision/receipt/audit transaction. Receipt failure rolls all of them back. Exact request replay returns the original receipt; a new request cannot overwrite the same version. Default storage is the owner's private workspace.

The bundle includes typed, canonical JSON parts for the candidate, decision, intent, original source set, model, fixed expectations, complete validation evidence, explanation tasks, and—when selected—the derived view and the actual reasoning tasks from which it is reconstructed. Each part has an exact byte digest; the complete bundle has a separate delivery digest. No credentials or local operator issuance records are included. Original source text can be sensitive and remains private with the asset. The total bundle/report envelope is bounded to 32 MiB, subject to the existing 64 MiB owner-state and transport limits; exceeding a limit fails rather than truncating evidence.

| Operation | Input and behavior |
|---|---|
| `review.list` | `assetId`, nullable `afterDigest`, `limit` 1–100; immutable candidate discovery |
| `delivery.list` | Same pagination fields; immutable delivery discovery |
| `delivery.inspect` | `assetId`, `deliveryDigest`; exact identity, version/lineage, part metadata, latest-head, current-model/source/expectation binding, and current-decision relationship |
| `delivery.export.read` | `assetId`, `deliveryDigest`, byte `offset`, `maxBytes` 4–65,536; canonical bundle pages and original document digest |

Finish every page before treating the export as complete. Old deliveries remain byte-identical after later revisions or service restart, and can be read with formal tools disconnected. Human-readable names alone never identify an asset: consumers retain the exact owner scope and delivery digest.

The public `@evopilot-next/ontology/native-v2` entry exports `verifyDeliveryBundle(value, expectedDigest)` and generated candidate/decision/bundle types. Obtain `expectedDigest` separately from the selected authenticated owner receipt, rather than trusting a digest supplied inside the same untrusted download. The verifier checks schema, complete-byte identity, typed part closure, original source/model/expectation relationships, fixed native check identities, explanation coverage, derived graph reconstruction and exact review/report binding. It does not contact a service, mutate a workspace or rerun formal engines. Its response explicitly reports `externalInstructionVerified:false`, `formalExecutionReplayed:false`, and `softwareReleaseAuthority:false`. Integrity against an arbitrary caller-chosen digest is not issuer authentication or business truth.

For later versions, use the [retained model comparison](comparison.md) with the delivered candidate's exact model/task identities before reviewing the new candidate. It distinguishes declared changes, fixed-case observations and finite projections; the separate report is retained in actual Host review context, not automatically embedded in the delivery bundle.

New development state v14 adds candidates, immutable decisions and deliveries. Earlier development state is rejected without implicit migration. Current daily installations, historical workspaces, private credentials and published packages are not changed by source tests. Complete source-projection precision, managed toolchain/recovery work, actual Host evolution journeys and exact candidate acceptance remain required before v0.9 release.
