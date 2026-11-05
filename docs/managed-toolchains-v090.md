# Managed formal toolchains in the v0.9 development installation

The installed operator can prepare one pinned offline distribution candidate and explicitly bind provisioned Java DL and Python SHACL executors to an independent Ontology installation. The managed daemon then uses the same owner service and formal task APIs as foreground `serve`. This is development functionality; it does not establish full OWL conformance, actual Host acceptance or release readiness.

These operations verify selected local components. They do not download a JDK/Python runtime, run Maven/pip, build a worker from source, replace an interpreter or infer a component's Release identity from its filename. The offline preparation below covers a fixed development candidate; a complete supported distribution remains a release obligation. Development toolchains must be labeled as such; source test preparation is not evidence of a published installer.

## Inspect a distribution candidate

The installed operator now has a read-only `distribution-inspect --input ABS_JSON --json` command. It selects an exact manifest from the executing product's compiled catalog and verifies the local artifact bytes. A user-provided manifest, digest or environment variable cannot replace that catalog. The current `linux-arm64-temurin21-pbs20260211-candidate3` entry binds the corrected RDF/SHACL adapters and complete Java source/notice companions. Historical candidate1 and candidate2 identities remain immutable. A catalog entry is not a published distribution or a supported-platform acceptance claim.

The input uses this exact shape, with absolute canonical paths substituted for every `ABS_*` value:

```json
{
  "schema": "ontology-distribution-inspect-input/v1",
  "bundleId": "linux-arm64-temurin21-pbs20260211-candidate3",
  "bundleRoot": "ABS_PRIVATE_ARTIFACT_DIRECTORY",
  "runtimeRoot": "ABS_INSTALLED_NPM_RUNTIME",
  "runtimeDigest": "sha256:EXACT_RUNTIME_DIGEST",
  "toolRoot": "ABS_NEW_TOOL_DIRECTORY",
  "installationRoot": "ABS_SELECTED_INSTALLATION",
  "workspaceRoot": "ABS_SELECTED_WORKSPACE"
}
```

Run the command from that exact installed runtime. Keep the artifact directory private and include exactly the thirteen flat files named in the packaged `governance/distribution-linux-arm64-v090.json`. The selected bundle includes the prebuilt DL payload, SHACL adapter, Java runtime/source/metadata, Python runtime/build material and pinned wheel payload. It contains no workspace or credentials. Roots must be separate; planned destination parents must already exist and be private. Inspection does not create them.

The report binds the runtime/Node and raw manifest identities, observed artifact hashes, declared execution platform, packaged worker/lock compatibility, proposed four component roots and a fresh capacity observation. `PLAN_VERIFIED` means these inspection conditions hold. `BLOCKED` lists a platform mismatch, package incompatibility, an occupied tool destination, insufficient byte capacity or a reported inode shortage. Malformed manifests, unexpected files, changed bytes, unsafe files and observed filesystem races produce structured errors. An unknown catalog ID returns `NO_DISTRIBUTION_CANDIDATE`.

Limits are 256 KiB of manifest data, 64 artifacts, 256 MiB per artifact and 768 MiB of artifact bytes. Hashing uses 64 KiB chunks and checks a 30-second read budget between chunks; this is not an operating-system deadline for a stalled filesystem call. The space estimate includes two declared payload copies, filesystem rounding and a 16 MiB control allowance. It excludes acquisition storage, historical generations, separate Node/product runtime and archival source/notice storage. The report records free inodes when the filesystem reports a positive inode pool; unknown inode capacity remains explicit and does not establish sufficient inode space. Offline preparation refreshes remaining payload and control capacity before writing payloads.

The inspector does not expand archives, generate `pyvenv.cfg`, verify ABI or systemd, execute tools, bind them, start the service or connect the Host. Its `artifactBytesVerified` fact is separate from `expandedInventoryObserved`, `relocationVerified`, `loadabilityVerified`, `resourceBackendVerified` and `toolsBound`, which remain false. Python final-path assembly is explicitly required. Source/notice references preserve selected materials; their presence does not establish redistribution sufficiency or reproducible-build provenance. Legal review and product acceptance remain `NOT_EVALUATED`. Inspection reports are historical observations, not leases or permission to perform later writes.

## Inspect runtime archive contents

`distribution-inventory --input ABS_JSON --json` accepts the same input and first performs the raw distribution inspection above. It then streams the four selected runtime tar payloads: DL, Java, Python and the outer wheel tar. Prefix removal is fixed in product code for this exact candidate. Operators cannot supply a recipe, manifest or budget override. The complete raw bundle and selected package are checked again after the asynchronous scans.

Each inventory records normalized paths, file hashes and lengths, safe owner-only modes, explicit or derived directories, raw symbolic-link text and the final target resolved within the archive's virtual tree. The scanner does not follow links on the host. It rejects escape paths, duplicate entries, conflicting parents, dangling or cyclic links, and paths written through a symbolic-link ancestor. Directory names remain case-sensitive: the selected Python archive includes names that differ only by case. The report requires a case-sensitive destination; it has not verified the destination filesystem's behavior.

`payloadRecipeDigest` identifies the product's fixed tar transformations. `payloadTarInventoryDigest` binds the resulting stable content inventories without observation time or available-space measurements. These digests cover tar inventory only; `distribution-prepare` also binds its exact request, final paths, wheel contents and write/recovery rules.

This bounded reader supports regular files, directories and symbolic links in POSIX/GNU ustar, plus per-file PAX `mtime` metadata. Hard links, device nodes, sparse files, global PAX and unrecognized extensions are refused. Headers, numeric fields, checksums, entry sizes, file padding and end markers are validated. Limits cover raw input, decoded tar bytes, total file bytes, entry count, individual files and an aggregate 60-second scanning budget. Streams are closed on completion or failure; a stalled operating-system filesystem call is not guaranteed to obey the user-space timer.

`payloadTarInventoryObserved:true` describes this content observation. `expandedInventoryObserved` remains false: the wheel ZIP members have not been inventoried, no final Python environment has been created, and source archives have not been expanded. The command creates no files, leases or tool bindings and runs no executors. A platform mismatch can coexist with a valid archive inventory because scanning foreign-platform bytes does not establish that they can execute. This report is a preparation input, not a completed installation or permission to write later.

## Prepare the offline candidate

`distribution-prepare` materializes the selected candidate without launching Java, Python, a package manager or another child process. This recipe requires Linux ARM64, glibc 2.28 or newer, the exact selected installed Ontology package and Node 24.14.0. The thirteen local artifacts described above must already be present. It is not a downloader or a general tar/wheel installer.

First retain the complete successful JSON output from `distribution-inspect` or `distribution-inventory`. The prepare input nests that command's exact input under `distribution` and adds the request identity, a new private control directory and the saved `reportDigest`:

```json
{
  "schema": "ontology-distribution-prepare-input/v1",
  "requestId": "offline-tools-01",
  "controlRoot": "ABS_NEW_PRIVATE_CONTROL_DIRECTORY",
  "inspectionDigest": "sha256:EXACT_SAVED_REPORT_DIGEST",
  "distribution": {
    "schema": "ontology-distribution-inspect-input/v1",
    "bundleId": "linux-arm64-temurin21-pbs20260211-candidate3",
    "bundleRoot": "ABS_PRIVATE_ARTIFACT_DIRECTORY",
    "runtimeRoot": "ABS_INSTALLED_NPM_RUNTIME",
    "runtimeDigest": "sha256:EXACT_RUNTIME_DIGEST",
    "toolRoot": "ABS_NEW_TOOL_DIRECTORY",
    "installationRoot": "ABS_SELECTED_INSTALLATION",
    "workspaceRoot": "ABS_SELECTED_WORKSPACE"
  }
}
```

Replace all placeholders with observed identities and absolute canonical paths. Leave `controlRoot` and `toolRoot` absent for a new request; their private mode-0700 parent directories must already exist outside source checkouts. Keep the input and saved inspection files outside those roots and the exact artifact directory. All selected roots must remain separate. Preparation does not create or modify the selected installation or business workspace; their paths constrain where tools may be placed.

These are reference invocations with placeholders, not an installed-release acceptance record:

```text
evopilot-ontology distribution-prepare --input ABS_PREPARE_JSON --inspection ABS_SAVED_INSPECTION_JSON --json
evopilot-ontology distribution-prepare-status --input ABS_PREPARE_JSON --json
```

The saved inspection file can contain the CLI's complete `{ "ok": true, "result": ... }` response or its unwrapped result containing `report`, `reportDigest` and `authority`. A bare report is insufficient. New preparation requires `--inspection`; its file is bounded to 8 MiB. The original report is retained unchanged. Fresh preparation checks compare its stable selections and directory identities, while refreshing capacity separately; a new observation timestamp is not a new request.

The fixed recipe writes these final locations:

| Component | Location beneath `toolRoot` | Preparation |
| --- | --- | --- |
| DL worker and dependencies | `dl/` | Expand the pinned prebuilt DL payload. |
| Java runtime | `java/` | Expand the pinned Temurin JRE. |
| Python runtime and environment | `python/python/`, `python/venv/` | Expand PBS Python, copy the eight pinned pure-Python wheels into the venv, and generate its configuration and interpreter links at the final absolute path. |
| SHACL adapter | `shacl/worker.py` | Copy the exact packaged adapter bytes. |

Wheel inspection validates the pinned ZIP contents and `RECORD` hashes before copying files. Native extensions, `.data` layouts, `.pth` files and unsupported ZIP features are refused. There is no dependency resolution, build hook, pip execution or generated console-script installation. Java/Python source archives remain unexpanded source materials. The final Python environment is bound to its absolute location; moving the completed tool tree is not a supported relocation operation.

The command retains the original inspection, a stable preparation plan, physical root/component identities and immutable phase records in `controlRoot`. Writes use owned directory descriptors, reject links or replacements at write paths, and resume only exact selected file prefixes. Unknown entries, changed prefixes, conflicting records and missing previously bound roots are preserved and refused. Final file/link inventories and the two generated toolchain manifests are compared with the admitted tar, wheel, configuration and adapter plan before completion. The plan retains package source/lock compatibility as well as payload identities. Status, terminal replay and forward-only completion reconstruct the entire expected toolchain manifests from that original plan; a changed manifest cannot become valid by recomputing its own digest or a later verification record.

Admission first retains an abort receipt ready for publication and an actually allocated 8 MiB completion reserve. A private SQLite lease serializes preparation and abort for that control root; a competing operation returns `DISTRIBUTION_PREPARATION_BUSY`. Do not remove the lease or its journal to bypass it. Control records are bounded to 8 MiB each and 40 MiB in aggregate. The combined wheel expansion is bounded to 32 MiB and 2,000 file entries, with separate per-wheel and materialized-tree limits. Capacity checks account for the selected tool and control filesystems; they are observations, not an unlimited-space guarantee.

To resume, use the same command and the unchanged input. Once the original inspection is fully retained, `--inspection` can be omitted; supply the same saved inspection if bootstrap still needs it:

```text
evopilot-ontology distribution-prepare --input ABS_PREPARE_JSON --json
```

To cancel an owned request before forward completion has committed, explicitly select abort:

```text
evopilot-ontology distribution-prepare-abort --input ABS_PREPARE_JSON --json
```

Status reads retained control records without acquiring a lease, repairing SQLite or inspecting current executables. Its phase does not assert that a process is alive; `processLiveness:NOT_INFERRED` and `currentToolVerification:NOT_RUN` remain explicit.

| Status | Operator meaning |
| --- | --- |
| `NOT_FOUND` | No control directory exists at the selected path. |
| `UNOWNED_BOOTSTRAP` | No complete owner is retained. Preserve the directory; automatic adoption is unavailable. |
| `BOOTSTRAP_PENDING`, `ADMISSION_PENDING` | Resume the original input and, when needed, its saved inspection. |
| `TOOL_ROOT_BINDING_PENDING`, `TOOL_ROOT_OWNED`, `COMPONENT_ROOT_BINDING_PENDING`, `MATERIALIZING` | Ownership binding or payload preparation is incomplete. Resume requires the original retained identities and material. |
| `MATERIALIZATION_COMMIT_PENDING`, `FINALIZING`, `VERIFIED` | Materialization or its final control records have not reached the terminal receipt. |
| `COMPLETION_PENDING` | `recoveryDirection:FORWARD_ONLY`; repeat prepare to finish the committed completion. Abort is unavailable. |
| `ABORT_PENDING` | `recoveryDirection:ABORT_ONLY`; repeat abort. Preparation cannot continue. |
| `PREPARED`, `ABORTED` | A terminal receipt is retained. Exact replay returns that receipt without rerunning preparation. |

`partialRecordsRequireOriginalInputs:true` means some incomplete records cannot be reconstructed from the retained status evidence alone. Status does not repair them or grant permission to adopt a directory. In particular, a crash between creating `controlRoot` and fully writing its owner leaves an unowned bootstrap. A tool directory without its complete owner marker is also refused. Preserve such directories and use new unused destinations for a new request; there is no promise that every interruption before ownership becomes durable can automatically resume.

For an admitted request, the reserve is atomically renamed to commit either completion or abort before its padding is released. Missing or contradictory reserve records are errors; they are not silently recreated. An interrupted terminal operation follows its recorded direction. Abort retains partial tools and control evidence, performs no recursive cleanup and does not undo a completed preparation. On `STORAGE_FULL`, inspect retained status and available capacity before selecting the permitted recovery path; a failed call is not proof that no writes occurred.

Successful preparation returns `PREPARED`, `filesMaterialized:true` and the private `dl`/`shacl` manifest paths and digests for the explicit binding flow below. It means the selected files were materialized and verified against their plan. `loadabilityVerified`, `resourceBackendVerified`, `toolsBound`, `serviceStarted` and `hostConnected` remain false, with `productAcceptance:NOT_EVALUATED`. No reasoner or interpreter has run. Actual formal-worker execution, Host integration, redistribution review and release acceptance still require their own evidence.

Exact terminal replay reads the retained control evidence before checking the original runtime or bundle. It can recover a receipt after those source materials become unavailable, provided the required control records and directory identities remain intact. That historical receipt does not establish current tool health. Preparation never automatically binds the tools, starts an installation or connects a Host.

## Bind and inspect

Prepare an independent installation using the [standalone operator](standalone-v090.md). Obtain the exact absolute private toolchain manifest paths and SHA-256 identities from the selected provisioned artifacts or the offline `PREPARED` receipt above. The Python manifest must use the virtual environment's executable path; resolving it to the underlying interpreter loses the environment's packages. Keep credentials and private paths out of published assets.

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
