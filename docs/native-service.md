# Corrected native service

Factory: `createOntologyService(options, trustedProviders)` from `@evopilot-next/ontology/service`. Explicitly initialize, call asynchronous `service.native(request)`, then close. Installed `trustedProviders.nativeToolchain` is a shared NativeToolchain; public request JSON never selects executables.

## Requests

Every request contains operation, scope `{visibility,projectId}` and input. Mutations also need requestId and expectedRevision from `workspace.inspect`; IDs bind immutable intent and owner revision provides CAS.

| Operation | Input |
|---|---|
| standard.inspect | {} |
| native.package.put | {package} |
| native.package.inspect / readback / review / publish / reconcile | {id,version} |
| native.package.list | {} |
| native.package.validate | {id,version,context?} |
| native.package.decide | {id,version,reviewDigest,decision,humanEvidenceRef} |
| native.receipt.inspect | {requestId} |

Put, validate, review, decide, publish and reconcile are mutations. Inspect returns the owner-retained package, packageDigest, standardPins, claim, validation, review, decision and published reference. Readback requires publication. Mutations return durable receipts. A published package, publication validation and original decision remain immutable; later context validation produces separate receipts.

Runtime context contains workspaceId, scope, projectCandidateDigest, claimId, inputDigest, effectiveConfigDigest, sourceScopeDigest and requirementSetDigest. Owner receipts retain it exactly. Public owner records can validate for a different same-Workspace consumer scope; private records require the exact private project scope. Context-free authoring PASS cannot substitute for project-completion evidence.

## Toolchain and failure behavior

NativeToolchain has portable lockDigest, dependencyLockDigest (nativeSha256 of dependencyFiles), platform/arch, fixed tool identities, environmentRoot, absolute dependency file paths and SHA-256 hashes. The entire site-packages set is checked; unlisted bytecode/.pth/injection content fails. Python uses -I -B, clean environment, shell=false, 60-second deadline and bounded output. Tool and dependency bytes are checked before and after execution.

Results distinguish CONFORMS, NONCONFORMING, ERROR, UNSUPPORTED and UNKNOWN. Raw upstream reports, stderr, exit/signal, timeout and per-case results are retained. `criteria` maps each actual case to its declared requirementId/variantId, with a digest binding the raw report, package and Runtime context. Missing cases or a failing overall report never yield PASS criteria. The adapter exits 0 for completed conformance and completed nonconformance; status and native graph carry that distinction. Native exceptions exit 2; signal, malformed output and deadline are execution errors. Review/publish require current actual conformance and a distinct human domain decision. Repeating an admitted request reads its receipt. An interrupted claim reconciles without dispatching again.

Historical execute() mutations return HISTORICAL_READ_ONLY. Existing records retain their bytes. The historical native state marker was 2; the first v0.8 admitted authoring write raises it to 4, so older writers reject the new state. Restore an old complete snapshot when reverting. Append-only native_audit retains admission and completion independently of the latest receipt. Snapshots and same-host relocation verify these events, native package/report blobs and historical records; pending work remains unresolved and is not replayed.

The CLI uses the same API:

```sh
node dist/cli.js request --workspace /absolute/private/state-root --workspace-id example --toolchain /absolute/installed/native-toolchain.json --request-file /absolute/request.json
```

Owner request CLI limits remain 512 KiB; SDK package admission is additionally bounded by the installed toolchain and an 8 MiB persisted record limit.

Toolchain configuration is explicit trusted application setup, not a public package input. Missing toolchain fails; it does not fall back to JSON validation.

## Independent replay

Export exact native files and the fixed toolchain lock. For a package with one shapes file, directly use the upstream validator:

```sh
python -I -B -m pyshacl -s shapes/domain.ttl -e model.ttl -m -i none -f turtle instances/current.ttl
```

Explicitly merge multiple shapes/instance RDF graphs when the manifest lists several. Execute every expected positive/negative case and compare report graphs, not blank-node identifiers. Upstream SHACL proves constraint conformance; EvoPilot identity/source/case closure remains a separately documented contract with independently retained inputs.

## Executable checks

`tests/e2e/native-package.test.mjs` checks native layout, pins, source selectors and fixed coverage; `native-lifecycle.test.mjs` runs real pySHACL with positive/negative constraints, restricted SPARQL, context binding, exact human decisions, immutable delivery and interrupted claims. `native-history.test.mjs` verifies old-reader rejection, historical byte preservation and native relocation. `native-process.test.mjs` deliberately supplies faulty trusted process fixtures to verify malformed-output/signal/no-fallback behavior. The deadline is fixed at 60 seconds; the actual 60-second boundary was verified in R1 and is not replaced by a shorter production setting.

`native-upstream.test.mjs` verifies 103 pinned upstream fixture/report expectations in separate actual pySHACL processes, including graph equivalence after serialization and changed-report non-equivalence. Fixture byte hashes and upstream license accompany the files. The upstream graph loader is retained for fixture dependencies, preserving upstream literal-normalization behavior. This is native engine conformance evidence; package metadata and independent business completeness have separate tests.

Frozen `tests/fixtures/historical-v020` is compiled from the recorded v0.2.0 commit solely for synthetic historical state and regression. Its sources/outputs are hashed, omitted from package `files`, and never used by current service routing or production installation.

Before a new decision, retain the actual authorization source and bind it using the [decision evidence format](native-decisions.md). Opaque approval labels no longer authorize new native work; historical receipts remain unchanged.


## v0.8 source candidate: trusted authoring admission

For new asset authoring, configure `trustedProviders.resolveNativeAuthoring` in trusted host code. This synchronous callback must use bounded local reads of reviewed project/source state. It receives Workspace, scope, owner, package digest, source-binding digest and direction, and returns the typed `evopilot-native-authoring-admission/v1` binding with candidate, inventory and requirements digests. Reverse sources also require an actual modeling-intent digest and target L1/L2/L3; forward sources require trusted forward context and null intent/target. Every admission has `authority: false` and grants no verified level or publication decision.

The parent supplies this callback from the exact frozen and materialized project. Missing, stale, ambiguous, asynchronous or malformed results block authoring. There is no request bypass flag. The owner retains the binding separately from native package bytes and rechecks draft validation, review, decision and publication. It rechecks again after validation, so changed evidence cannot commit a passing report; reconcile any retained unresolved claim without redispatch.

Direct SDK hosts must implement the trusted resolver contract. The standalone CLI has no project-context resolver and rejects new authoring with `AUTHORING_CONTEXT_REQUIRED`; use the configured parent service or a trusted SDK host. Published reads and validation remain available. Old unfinished drafts require a fresh bound put with a new request ID; exact old receipts still replay. Upgraded snapshots accept state marker 4. Restore a stopped complete pre-upgrade backup when reverting to old code; never lower the marker manually. This source candidate does not change an existing v0.7 installation.
