# Managed formal toolchains in the v0.9 development installation

The installed operator can bind already provisioned Java DL and Python SHACL executors to an independent Ontology installation. The managed daemon then uses the same owner service and formal task APIs as foreground `serve`. This is development functionality; it does not establish full OWL conformance, actual Host acceptance or release readiness.

The operation verifies selected installed components. It does not download a JDK/Python runtime, run Maven/pip, build a worker from source, replace an interpreter or infer a component's Release identity from its filename. Complete component distribution and provisioning remain release obligations. Development toolchains must be labeled as such; source test preparation is not evidence of a published installer.

## Inspect a distribution candidate

The installed operator now has a read-only `distribution-inspect --input ABS_JSON --json` command. It selects an exact manifest from the executing product's compiled catalog and verifies the local artifact bytes. A user-provided manifest, digest or environment variable cannot replace that catalog. The initial `linux-arm64-temurin21-pbs20260211-candidate1` entry is experimental and is not a published distribution or supported-platform declaration.

The input uses this exact shape, with absolute canonical paths substituted for every `ABS_*` value:

```json
{
  "schema": "ontology-distribution-inspect-input/v1",
  "bundleId": "linux-arm64-temurin21-pbs20260211-candidate1",
  "bundleRoot": "ABS_PRIVATE_ARTIFACT_DIRECTORY",
  "runtimeRoot": "ABS_INSTALLED_NPM_RUNTIME",
  "runtimeDigest": "sha256:EXACT_RUNTIME_DIGEST",
  "toolRoot": "ABS_NEW_TOOL_DIRECTORY",
  "installationRoot": "ABS_SELECTED_INSTALLATION",
  "workspaceRoot": "ABS_SELECTED_WORKSPACE"
}
```

Run the command from that exact installed runtime. Keep the artifact directory private and include exactly the eleven flat files named in the packaged `governance/distribution-linux-arm64-v090.json`. The selected bundle includes the prebuilt DL payload, SHACL adapter, Java runtime/source/metadata, Python runtime/build material and pinned wheel payload. It contains no workspace or credentials. Roots must be separate; planned destination parents must already exist and be private. Inspection does not create them.

The report binds the runtime/Node and raw manifest identities, observed artifact hashes, declared execution platform, packaged worker/lock compatibility, proposed four component roots and a fresh capacity observation. `PLAN_VERIFIED` means these inspection conditions hold. `BLOCKED` lists a platform mismatch, package incompatibility, an occupied tool destination insufficient byte capacity or a reported inode shortage. Malformed manifests, unexpected files, changed bytes, unsafe files and observed filesystem races produce structured errors. An unknown catalog ID returns `NO_DISTRIBUTION_CANDIDATE`.

Limits are 256 KiB of manifest data, 64 artifacts, 256 MiB per artifact and 768 MiB of artifact bytes. Hashing uses 64 KiB chunks and checks a 30-second read budget between chunks; this is not an operating-system deadline for a stalled filesystem call. The space estimate includes two declared payload copies, filesystem rounding and a 16 MiB control allowance. It excludes acquisition storage, historical generations, separate Node/product runtime and archival source/notice storage. The report records free inodes when the filesystem reports a positive inode pool; unknown inode capacity remains explicit and does not establish sufficient inode space. Future preparation must inspect the full applicable peak again.

The inspector does not expand archives, generate `pyvenv.cfg`, verify ABI or systemd, execute tools, bind them, start the service or connect the Host. Its `artifactBytesVerified` fact is separate from `expandedInventoryObserved`, `relocationVerified`, `loadabilityVerified`, `resourceBackendVerified` and `toolsBound`, which remain false. Python final-path assembly is explicitly required. Source/notice references preserve selected materials; their presence does not establish redistribution sufficiency or reproducible-build provenance. Legal review and product acceptance remain `NOT_EVALUATED`. Inspection reports are historical observations, not leases or permission to perform later writes.

## Bind and inspect

Prepare an independent installation using the [standalone operator](standalone-v090.md). Obtain the exact absolute private toolchain manifest paths and SHA-256 identities from the selected provisioned artifacts. The Python manifest must use the virtual environment's executable path; resolving it to the underlying interpreter loses the environment's packages. Keep credentials and private paths out of published assets.

Stop the selected managed service before its first binding or a new replacement:

```text
evopilot-ontology stop --installation ABS --json
evopilot-ontology toolchains-bind --installation ABS --request-id ID --previous-binding none --dl-toolchain ABS --dl-digest SHA256 --shacl-toolchain ABS --shacl-digest SHA256 --json
evopilot-ontology toolchains-inspect --installation ABS --json
evopilot-ontology start --installation ABS --json
```

For replacement, pass the exact current `bindingDigest` in `--previous-binding`, and use a new retained request ID. Both executors are selected together; there is no silent partial configuration or automatic unbind. The Expert/operator prepares these references from observed artifacts instead of asking a business user to author hashes.

The binding records installation/workspace/service identity, installed product runtime digest, exact toolchain manifest paths/digests, parent binding, request identity, timestamp and an installation-owned private worker directory. The operation verifies the actual JDK/JAR and Python/venv inventories, pinned engine/library identities, and OWL worker/dependency-lock/SHACL adapter source identities against the installed product package. A manifest self-hash alone is insufficient. This verifies byte identity and compatibility with the selected package; it does not independently prove a binary was built from its declared source or rerun conformance tests.

On a provisioned Linux systemd 255.x user manager, explicitly select the [resource-isolation backend](worker-isolation-v090.md):

```text
evopilot-ontology worker-isolation-inspect --json
evopilot-ontology toolchains-bind --installation ABS --request-id ID --previous-binding none --dl-toolchain ABS --dl-digest SHA256 --shacl-toolchain ABS --shacl-digest SHA256 --systemd-digest INSPECTED_SHA256 --json
```

The inspected manager binding covers the local user, machine, manager version and executable identities. The selected digest must match a fresh local inspection. Unsupported platforms, missing prerequisites and drift fail explicitly; this command does not provision a manager or switch environments. Foreground `serve` also accepts `--systemd-digest` when a formal executor is configured.

An explicit selection creates `ontology-managed-toolchain-binding/v2` and binds both formal executors to the same manager. Their configuration digests and queued task events retain that isolation identity. Omitting the option preserves the existing development v1 selection and its historical hashes; that path does not establish a hard 2 GiB total-process limit. Neither the optional backend nor these commands complete the platform distribution obligation for v0.9.

Python manifest validation uses its own 4 MiB and 10,000-file envelope, separate from semantic request budgets. Runtime verification includes file bytes and symbolic-link targets. Linux virtual environments' `lib64 -> lib` alias is admitted only when the target directory's contents were directly inventoried. Links to unselected or external content are refused.

`toolchains-inspect` returns `UNCONFIGURED` before the first selection, or `VERIFIED` only after actual current files pass verification. Its `executorsReplayed:false` and `productAcceptance:NOT_EVALUATED` remain explicit. Run actual reasoning/validation through the connected service to establish task behavior. A missing or changed component produces an error rather than `VERIFIED` or fallback to an unconfigured service.

## Receipts and recovery

Binding history resides in a private bounded `toolchain-bindings.json` ledger, separate from business asset state. One atomic rename commits the complete parent chain and request receipt. The limits are 128 binding records and 2 MiB; reaching either limit fails without dropping history. The service never reads arbitrary operator requests from ontology sources or domain APIs.

An exact request replay returns its original `receipt`, `replayed:true` and the separately observed `currentBindingDigest`, even if a later binding has replaced it. The old receipt does not reactivate its selection. Reusing an ID with different parameters fails. A replay can recover a receipt while the service is running or a component is unavailable; it does not claim current component health. Inspect the current binding separately.

New binding requires both the installation operator lock and the workspace's exclusive owner lease. A live managed or foreground owner blocks replacement. Unknown managed launch/process state must be reconciled before replacement. Queued, running, cancellation-pending or interrupted formal tasks also block replacement; this command never clears or redispatches them. The separate [task recovery operator](worker-recovery-v090.md) verifies retained worker exits, exact unit termination for v2 attempts, or atomic no-launch fences before closing an interrupted task as incomplete; missing evidence remains blocked.

The private `formal-work` directory has an exact owner marker. The binding receipt commits before creating this directory; if creation is interrupted, an explicit start can resume the owned setup from the retained receipt. An empty directory left before marker creation can resume; occupied unowned or foreign-marked directories are refused. Worker contents and historical records are not recursively cleaned by binding. A missing ledger with retained worker state or a previously bound managed run is refused rather than treated as unconfigured. Ledger corruption, changed owner identity and drifted component bytes fail explicitly. Stopping the original managed service remains available when a toolchain has drifted; stop does not need to execute or validate the reasoner.

## Managed startup

New launches use `ontology-managed-run/v2` and retain the selected toolchain binding digest, or explicit null when no binding has ever been configured. The parent verifies current executors before creating a launch record; the daemon repeats verification and checks the same binding before opening the service. Existing live runs are reused only with the same selected binding. Current tool identities are visible through `ontology_context`/`service.inspect`, and every task retains its own tool/configuration/input/result identity.

Managed run v1 is not silently rewritten or inferred to have a toolchain binding. Use its original operator reader to stop/reconcile a historical development run; installation upgrade/cutover requires its own verified procedure. Business workspace state remains version 14. Daily installations and historical assets are not changed by this source implementation or its isolated tests.

After startup, inspect `reasoningExecutionConfigured`, `validationExecutionConfigured` and exact toolchain digests. These configuration fields do not turn `reasoningReady`/`nativeV2Ready` into accepted v0.9 claims. The packaged private MCP bridge can execute and read actual formal tasks through this managed service. Restart preserves completed task results and original write receipts; it does not rerun them.

## Completed worker maintenance

After all formal tasks have finished or been reconciled, stop the selected owner. The operator can inspect and release one completed task's selected-systemd job files and retained manager units:

```text
evopilot-ontology worker-maintenance-inspect --installation ABS --project ID --task ID --json
evopilot-ontology worker-maintenance-apply --installation ABS --project ID --task ID --request-id ID --expected-report SHA256 --json
```

Inspection returns `READY`, `PENDING` or `COMPLETED` with the exact report identity and any original maintenance request/receipt; `NOT_NEEDED` means the completed task dispatched no worker. A new request binds the completed business result and task event chain, worker outcome/terminal digests, directory identities and the selected `input`, `stdout` and `stderr` files. It checks actual bytes against retained worker evidence. Unexpected files, links, replacement directories, changed contents, unfinished tasks or a live owner are refused. An unlaunched fenced attempt may have only partially created job files; those exact files are inventoried separately.

Apply first commits a private journal plan and reserves bounded receipt space. A pending plan blocks new worker dispatch, managed startup and toolchain replacement. It verifies and retires each already closed manager invocation, observes actual unit absence, then removes only the inventoried files using anchored directory descriptors. It never kills a live worker, deletes a business model/result, clears a recovery barrier or rewrites original business receipts. Manager failure is not treated as unit absence. The [systemd D-Bus interface](https://www.freedesktop.org/software/systemd/man/255/org.freedesktop.systemd1.html) supplies the exact-unit listing and retirement operations.

If interrupted, resume the original request ID and expected report digest. Files already removed under its committed plan are recognized; unexpected replacement material is preserved and blocks continuation. A repeated completed request returns its original receipt; changed parameters conflict. Completion rechecks selected directory/unit absence and the unchanged business evidence. The receipt describes the original cleanup observation, not future manager health.

Plans contain at most 128 attempts and 512 KiB, with only the three fixed job filenames admitted. They and their receipts stay in the existing 64 MiB worker journal; maintenance history is capped at 4,096 requests per journal. Worker attempts, exit/terminal records and file digests remain retained. This frees the 64-job/512-MiB cache budget; it does not reset the 4,096-attempt journal limit. The separate rotation operator below starts a new journal. Installation backup/restore/upgrade and the separately scoped historical asset reset remain additional obligations. Cleanup is an explicit operator action and is unavailable through ordinary domain/MCP mutation APIs.

## Worker journal rotation

After all formal tasks have finished or been reconciled, stop the owner and finish cache/unit maintenance for every selected-systemd task in the current journal. Then inspect and explicitly apply rotation:

```text
evopilot-ontology worker-rotation-inspect --installation ABS --json
evopilot-ontology worker-rotation-apply --installation ABS --request-id ID --expected-report SHA256 --json
evopilot-ontology worker-rotation-inspect --installation ABS --request-id ID --json
```

The report binds the original journal ID, path, device/inode, bytes and SHA-256, attempt/maintenance counts and installation owner. An unfinished worker or pending maintenance blocks rotation. A selected-systemd attempt needs its retained launch fence, outcome, actual terminal evidence when launched, completed cache/unit maintenance receipt and absent job directory. Native development attempts require a retained outcome. No process is launched or killed by rotation.

The private `worker-archives.json` catalog commits the original request and successor identity before creating the successor database. While it is pending, new dispatch, managed startup, toolchain replacement and new maintenance are refused. Resume the same request ID and report digest; a created but uninitialized empty successor can resume, while an occupied or foreign database is preserved and refused. The original journal remains at its original path throughout. Once the empty successor is durable, one atomic catalog replacement commits activation and the rotation receipt together. If the caller loses its response, replay returns that original receipt without another rotation.

Original worker references and business/recovery/maintenance receipts stay unchanged. Readers route by the original journal ID; archived databases are opened read-only and their fixed bytes and filesystem identity are checked. Historical task lookup and maintenance request conflicts span archived and active journals. Changed/missing archives, replaced files, redirected paths or a missing catalog with retained successor shards fail explicitly. A completed receipt is a historical observation, not permission to rerun an executor. The original request can be inspected with `--request-id`; without it, inspection describes a pending rotation or the next current-journal rotation.

Each journal retains its 4,096-attempt and 64 MiB limits. Before admission, the owner leaves 1 MiB of transaction/maintenance headroom, 128 KiB for the next launch closure plus intent overhead, and 8 KiB plus three serialized work-root copies per unmaintained systemd attempt for later cleanup metadata (including long or escaped paths). Capacity exhaustion refuses dispatch before spawning an executor. The catalog permits 16 archived journals plus one active journal, at most 1,088 MiB of database files, and is capped at 128 KiB, with 4 KiB reserved for the completion receipt before a pending rotation is written. SQLite rollback sidecars, retained job files and private atomic-write staging files have separate storage costs. Reaching the archive limit stops further rotation without deleting history; there is no unlimited-retention claim or automatic archive pruning/export. This bounded rotation is separate from installation backup/restore and archival offload.

Rotation is an explicit stopped-owner operator operation, unavailable through ordinary domain/MCP mutation APIs. Its isolated count/capacity, interruption, exact replay and negative-path tests do not establish complete installation maintenance or actual Host acceptance.
