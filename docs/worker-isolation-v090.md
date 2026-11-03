# Worker resource isolation development

The approved [v0.9 plan](ontology-v090-plan.md) requires a 2 GiB worker memory ceiling. The TypeScript worker dispatcher supports an explicitly selected Linux systemd user manager, with kernel placement before supervisor creation and a durable launch fence. [Managed installation](managed-toolchains-v090.md), formal Java/Python runners and stopped-owner [task reconciliation](worker-recovery-v090.md) now bind that selection. Actual executable and fault collectors exercise the compiled path. This document does not mark P4, complete OWL conformance, Host installation or any fixed acceptance variant complete. Native development selection remains available and does not supply this kernel limit.

## Mechanism choice

| Option | Evidence and consequence |
|---|---|
| JVM heap/direct-memory/metadata flags plus periodic RSS checks | Useful application budgets; these do not establish a kernel limit over all allocations or terminate descendants after observer loss. Retain the existing JVM settings inside the selected resource boundary. |
| Native address-space limits | On the inspected macOS 26.4 ARM host, setting `RLIMIT_AS` to 2 GiB on a new system Python process was rejected. Address-space reservations also differ from charged physical memory. This probe does not establish a usable product boundary or imply that all macOS resource limits are unenforced. |
| Linux cgroup v2 | Chosen internal enforcement mechanism. The kernel charges the worker group and descendants, can terminate the whole group and retains counters while its identity exists. Requires explicitly provisioned delegation and a Linux executor environment. |
| systemd user service over cgroup v2 | Chosen internal dispatch backend. The manager places the supervisor in its bounded group before exec and independently enforces its wall deadline. This avoids the gap between spawning a launcher and its later self-entry into a cgroup. Explicitly selected systemd 255.x on Linux only; provisioning is not implemented. |
| OCI/container backend on macOS or Linux | Could supply a Linux boundary, runtime identity and distribution path, but adds image/daemon lifecycle and cross-platform toolchain binding. No automatic Docker-context selection or existing VM reconfiguration is implemented. A task-private ARM Lima VM was used for actual mechanism tests only. |

This selects a mechanism within the existing resource requirement, not a new public deployment contract. The isolated experiments did not install into the daily environment or alter the existing Colima profile. Public platform support and provisioning still require integrated packaging and installed acceptance.

## Controls and identity

`src/installation/worker-cgroup.ts` requires an existing canonical, same-user delegated child of `/sys/fs/cgroup`, backed by actual cgroup v2, with memory and process controllers enabled. It neither provisions a parent nor invokes privilege escalation. It creates a unique empty worker group and verifies these controls before admitting an executor:

- `memory.max=2147483648`, `memory.swap.max=0`, `memory.oom.group=1`.
- `pids.max=128`, domain grouping, and retained memory/OOM/population counters.
- Kernel boot ID, parent and worker directory device/inode identities, owner UID and exact group path.

The launcher moves only itself using `cgroup.procs=0`, then replaces its executable image. It does not migrate a PID recovered from disk. Open directory descriptors anchor control-file operations; a replaced path cannot redirect group termination. Stale boot/parent/group identities, a missing group, foreign paths and changed budgets refuse admission or inspection. Unsupported hosts fail explicitly; there is no silent unbounded fallback in these primitives.

The kernel's `memory.max` is its hard-memory mechanism, including OOM handling. Its documented semantics permit brief overages under some circumstances; a sampled RSS value is not proof of a mathematically instantaneous ceiling. The actual Python and JVM direct-memory probes each recorded a 2,147,483,648-byte peak and group OOM termination in the tested kernel. Candidate resource acceptance must retain the actual counters and platform limits. See the [kernel cgroup v2 specification](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html) and [Apple address-space limit implementation](https://github.com/apple-oss-distributions/xnu/blob/xnu-12377.1.9/bsd/kern/kern_resource.c).

`killWorkerCgroup` terminates the exact kernel group, including descendants that create new sessions, and waits up to five seconds for an empty population. **An empty population is only an observation.** It cannot prevent a delayed launcher from joining later, reconstruct a missing exit/result, or close an owner task. Those require the original dispatch fence and durable, request-bound reconciliation transaction. Missing or replaced groups are not treated as proof of successful cleanup. No group deletion or retained-record deletion API is added here.

## Manager-owned dispatch

`systemd-binding.ts` binds the ordinary user manager socket, machine identity, manager version and selected Node/systemd-run/busctl/manager executable file digests. A v2 attempt also binds the initiating owner's boot/PID/start-time identity. The dispatcher verifies its selected binding before creating an attempt. This is not yet a packaged manager/runtime dependency closure or a public platform-support declaration.

`systemd-worker.ts` starts one uniquely named transient service, with `MemoryMax=2147483648`, zero swap, OOM group termination, `TasksMax=128`, `KillMode=control-group`, no restart, a bounded runtime and one-second stop timeout. The unit starts the compiled supervisor directly, without a shell. The supervisor checks the exact unit invocation, arguments, kernel membership and memory/process controls before claiming admission. Java/Python children inherit this group. The original bare cgroup self-entry primitives remain independently testable; they are not the dispatch entry.

Input/output files are private and input bytes must match the journal. The supervisor bounds output buffers before writing them, and the owner verifies file type/ownership/size and exact outcome hashes. The additional per-file kernel ceiling is 512 MiB, large enough for the separately bounded 64 MiB SQLite journal and rollback journal; applying the much smaller stdout budget to every file prevented journal transactions. Retained jobs are capped at 64 and 512 MiB of current files plus the next job's reserved input/output budgets. Reaching either limit stops new work. The [stopped-owner maintenance operator](managed-toolchains-v090.md#completed-worker-maintenance) releases completed tasks' job files and manager units. Journal archival/rollover remains pending.

The additive `ontology-owned-worker/v2` records a unit invocation, kernel group identity, immutable stop fence and terminal manager evidence. Supervisor admission and engine spawn serialize with the fence in the same SQLite database. A delayed supervisor cannot pass a committed fence. The supervisor supplies engine input only after its spawn transaction commits. A crash after spawn remains inside the already established unit, which has its independent manager deadline.

Stopping requests whole-unit termination, including detached descendants. A manager control error can follow a partially successful signal; no control acknowledgment is treated as exit proof and no uncertain start/control request is automatically retried. Reconciliation requires the exact invocation's terminal status and an empty group. A group disappearing between observations causes another bounded observation, not invented closure. Missing or changed evidence preserves the barrier. Once committed, terminal evidence remains replayable after unit garbage collection.

If the child exit was observed, the existing exit record is retained. If the supervisor was lost, `GROUP_TERMINATED` binds the actual manager closure and fence, with **null child exit code and signal**. It does not reconstruct a formal result. Kernel OOM, cancellation, deadline and owner/supervisor loss remain explicit failures. A missing/unsafe manager memory-peak value is recorded as null rather than fabricated. The separate stopped-owner operator can use this evidence to close the original business task as incomplete, preserving the original business receipt.

## Actual verification

The explicit collector `tests/acceptance/v090/worker-cgroup.mjs` requires Linux, Node 24.14.0, an operator-selected delegation and an actual hash-verified Java 21 toolchain. It runs the compiled TypeScript module and real executables; absent prerequisites fail instead of producing a skip. The launcher and heap-bypass allocator are test fixtures, not product entry points.

```text
node tests/acceptance/v090/worker-cgroup.mjs --root=/sys/fs/cgroup/OWNED_DELEGATION --toolchain=/PRIVATE/toolchain.json --out=/PRIVATE/result.json
```

The collector process must already run in a child of its delegation, with permission for sibling migration; the delegated parent itself stays empty. Provisioning is an explicit isolated operator action, outside this collector. Worker groups are disposable synthetic resources. The output directory must be private, and an existing report cannot be overwritten.

The initial actual run used Linux 6.8.0-117 on ARM64, Node 24.14.0, OpenJDK 21.0.2, and the unchanged pinned HermiT/JFact/OWLAPI worker bytes. Nine groups of checks passed without skips:

- Normal execution; Python allocation exceeding the 2 GiB budget; Java direct allocation exceeding it with only a 64 MiB heap.
- Sensitive-service entailment, removal of its premise, key-based identity and read-only inconsistency, covering both selected reasoning engines.
- Loss of a test supervisor with a live detached descendant, followed by whole-group cancellation and empty-population observation.
- Eight negative variants: wrong boot, group inode, parent inode, declared budget or path; changed kernel budget; missing group; replaced group.

Reports retain exact compiled-module/fixture/collector digests, toolchain identity, expected and actual formal results, group identities, memory peaks and OOM counters. Private host paths, downloads, VM configuration, failed experiments and cleanup evidence remain outside source. The 9-check report and prior feasibility probes are component evidence; they do not replace the fixed v0.9 acceptance matrix or the required reference corpus.

The additional explicit collector exercises actual manager-owned dispatch:

```text
node tests/acceptance/v090/systemd-worker.mjs --root=/PRIVATE/NEW_PROBE_ROOT --toolchain=/PRIVATE/toolchain.json --out=/PRIVATE/result.json
```

It requires an existing ordinary Linux user manager and real bound Java tools. It does not provision or reconfigure a manager. All test processes, units and input are synthetic and disposable; retained evidence stays private. Sixteen cases passed on the tested Linux ARM64/systemd 255.4 platform without skips: normal execution, Python OOM, Java direct-memory OOM, four formal business cases, output and diagnostic limits, cancellation, delayed launch after a fence, owner loss, supervisor loss, independent manager timeout with the supervisor stopped and owner killed, terminal replay after unit removal, and missing-unit refusal without prior terminal proof. The latter must retain the new-dispatch barrier. These component results do not establish actual Host behavior or full OWL conformance.

The installed-package integration collector requires separately prepared, hash-bound Java and Python/SHACL executors plus a complete npm-installed Ontology runtime:

```text
node tests/acceptance/v090/systemd-managed.mjs --root=/PRIVATE/NEW_PROBE_ROOT --runtime=/PRIVATE/INSTALLED_RUNTIME --dl=/PRIVATE/dl-toolchain.json --shacl=/PRIVATE/shacl-toolchain.json --out=/PRIVATE/result.json
```

It binds the actual inspected manager through the compiled installed operator and exercises four case groups: MCP validation and restart, interrupted worker maintenance, Java supervisor loss, and Python supervisor loss. The normal task runs actual consistency, SHACL and four independently expected positive/negative cases, then checks completed result and receipt replay across restart. The maintenance case kills the actual operator after partial directory removal, verifies startup/dispatch/rebinding barriers and resumes the original request. Corrupted bytes, file symlinks, unexpected files, directory replacement and changed-request parameters are refused without deleting unselected material. The loss cases suspend the exact test unit supervisor, kill the fixture owner and supervisor, observe manager closure, reconcile through the installed CLI, restart, preserve the original failed task/receipt and run a separately requested task. Cleaning a recovered failed task must preserve both its recovery receipt and the later task's cache. Fault signals are confined to synthetic fixture identities; product recovery does not signal retained PIDs.

The collector also checks refusal of a wrong selected manager digest, live-owner recovery refusal, changed-request conflicts, and interruption after worker-journal reconciliation but before the owner transaction. Its report includes exact component artifacts, installed runtime, toolchain and manager identities. A positive collector result remains synthetic installed-package evidence, not an actual Codex Host session, a published installer or complete standards conformance.

## Remaining integration

1. Provide journal archival/rollover beyond the retained 4,096-attempt/64-MiB limit, preserving original evidence and receipt lookup. Completed-task cache/unit maintenance does not satisfy the separate backup, upgrade and historical asset-reset obligations.
2. Deliver installed distribution/provisioning, complete platform/toolchain digests and licenses. Optional selection of a pre-provisioned Linux backend does not complete platform support or the default resource contract.
3. Verify aggregate budgets, the required reference corpus and actual Host journeys against the exact release candidate.

Omitting the new selection preserves native development behavior and historical configuration hashes. An explicitly selected binding never falls back to it on drift. Removing a selected backend does not permit deleting retained v2 attempts or interpreting group termination as a native worker exit. Any later installed cutover must preserve already dispatched attempts and their original recovery semantics.
