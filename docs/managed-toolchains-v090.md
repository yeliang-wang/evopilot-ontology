# Managed formal toolchains in the v0.9 development installation

The installed operator can bind already provisioned Java DL and Python SHACL executors to an independent Ontology installation. The managed daemon then uses the same owner service and formal task APIs as foreground `serve`. This is development functionality; it does not establish full OWL conformance, actual Host acceptance or release readiness.

The operation verifies selected installed components. It does not download a JDK/Python runtime, run Maven/pip, build a worker from source, replace an interpreter or infer a component's Release identity from its filename. Complete component distribution and provisioning remain release obligations. Development toolchains must be labeled as such; source test preparation is not evidence of a published installer.

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
