# Worker resource isolation development

The approved [v0.9 plan](ontology-v090-plan.md) requires a 2 GiB worker memory ceiling. The internal TypeScript cgroup v2 primitives implement and test a Linux enforcement mechanism. They are **not yet selected by managed installation, used by the formal worker dispatcher, or accepted as owner task recovery evidence**. The current [worker recovery limitations](worker-recovery-v090.md) therefore remain. This document does not mark P4, complete OWL conformance, Host installation or any fixed acceptance variant complete.

## Mechanism choice

| Option | Evidence and consequence |
|---|---|
| JVM heap/direct-memory/metadata flags plus periodic RSS checks | Useful application budgets; these do not establish a kernel limit over all allocations or terminate descendants after observer loss. Retain the existing JVM settings inside the selected resource boundary. |
| Native address-space limits | On the inspected macOS 26.4 ARM host, setting `RLIMIT_AS` to 2 GiB on a new system Python process was rejected. Address-space reservations also differ from charged physical memory. This probe does not establish a usable product boundary or imply that all macOS resource limits are unenforced. |
| Linux cgroup v2 | Chosen internal enforcement mechanism. The kernel charges the worker group and descendants, can terminate the whole group and retains counters while its identity exists. Requires explicitly provisioned delegation and a Linux executor environment. |
| OCI/container backend on macOS or Linux | Could supply a Linux boundary, runtime identity and distribution path, but adds image/daemon lifecycle and cross-platform toolchain binding. No automatic Docker-context selection or existing VM reconfiguration is implemented. A task-private ARM Lima VM was used for actual mechanism tests only. |

This selects a mechanism within the existing resource requirement, not a new public deployment contract. The isolated experiment did not install into the daily environment or alter the existing Colima profile. Public platform support and provisioning still require integrated packaging and installed acceptance.

## Controls and identity

`src/installation/worker-cgroup.ts` requires an existing canonical, same-user delegated child of `/sys/fs/cgroup`, backed by actual cgroup v2, with memory and process controllers enabled. It neither provisions a parent nor invokes privilege escalation. It creates a unique empty worker group and verifies these controls before admitting an executor:

- `memory.max=2147483648`, `memory.swap.max=0`, `memory.oom.group=1`.
- `pids.max=128`, domain grouping, and retained memory/OOM/population counters.
- Kernel boot ID, parent and worker directory device/inode identities, owner UID and exact group path.

The launcher moves only itself using `cgroup.procs=0`, then replaces its executable image. It does not migrate a PID recovered from disk. Open directory descriptors anchor control-file operations; a replaced path cannot redirect group termination. Stale boot/parent/group identities, a missing group, foreign paths and changed budgets refuse admission or inspection. Unsupported hosts fail explicitly; there is no silent unbounded fallback in these primitives.

The kernel's `memory.max` is its hard-memory mechanism, including OOM handling. Its documented semantics permit brief overages under some circumstances; a sampled RSS value is not proof of a mathematically instantaneous ceiling. The actual Python and JVM direct-memory probes each recorded a 2,147,483,648-byte peak and group OOM termination in the tested kernel. Candidate resource acceptance must retain the actual counters and platform limits. See the [kernel cgroup v2 specification](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html) and [Apple address-space limit implementation](https://github.com/apple-oss-distributions/xnu/blob/xnu-12377.1.9/bsd/kern/kern_resource.c).

`killWorkerCgroup` terminates the exact kernel group, including descendants that create new sessions, and waits up to five seconds for an empty population. **An empty population is only an observation.** It cannot prevent a delayed launcher from joining later, reconstruct a missing exit/result, or close an owner task. Those require the original dispatch fence and durable, request-bound reconciliation transaction. Missing or replaced groups are not treated as proof of successful cleanup. No group deletion or retained-record deletion API is added here.

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

## Remaining integration

1. Bind the chosen executor platform, delegated resource scope and budgets into the installed operator's immutable configuration. Verify prerequisites before exposing a runnable formal task; do not silently relax a requested bound.
2. Bind group creation and exact identity into the original owned-worker journal before dispatch; fence delayed launches during cancellation or recovery. Preserve evidence across owner/supervisor loss and kernel restart.
3. Route the actual Java/Python dispatch through the compiled launcher; classify kernel OOM, deadline, cancellation and unavailable evidence without inventing a formal conclusion or exit status.
4. Extend owner reconciliation only with a durable launch fence plus confirmed group closure. Preserve the original task/business receipt and require a new request for later execution.
5. Provide bounded maintenance of empty groups and retained journals, and verify installed distribution, platform/toolchain digests, licenses, reference-corpus budgets and Host journeys.

Rollback at this stage removes only the unselected primitives and their tests. Current managed worker behavior remains unchanged. Once a task has used a future bound backend, its evidence cannot be discarded or reinterpreted as native-worker exit proof during rollback.
