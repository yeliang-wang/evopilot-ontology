# Owned formal worker recovery

This development implementation adds process evidence and stopped-owner recovery to the [managed installation](managed-toolchains-v090.md). It does not establish complete P4 or v0.9 acceptance. Business state remains version 14; newly queued tasks explicitly record `ontology-owned-worker/v1`. Historical tasks without that marker remain readable but cannot be cleared by inferring the new process guarantees.

## Process lifetime and evidence

The TypeScript owner records each attempt before dispatch. A separate compiled Node supervisor starts the exact selected Java or Python executable, verifies the submitted input bytes against the retained input digest, enforces the existing deadline/output budgets and owns the live child handle. Loss of its parent IPC connection stops that child. Cancellation and deadline handling use the same handle; recovery never signals a PID loaded from historical records.

The private `worker-journal.sqlite` retains immutable intent, supervisor identity, worker identity and observed exit records. The intent binds worker request, configuration and toolchain digests, command/environment, input byte count/digest and limits. Original ontology input and stdout/stderr bodies are not stored in this journal. Exit records retain status, reason, output digests and byte counts. The owner validates returned bytes against the exit record before accepting a worker response. Failure to observe a matching exit/result leaves the task `INTERRUPTED`, rather than reporting an ordinary completed failure and permitting another worker.

The journal is bounded to 4,096 attempts and 64 MiB; an individual intent is limited to 32 KiB. Reaching a limit stops new dispatch without deleting history. Automatic archival/rollover is not implemented. Java/Python remain the only formal executors; the supervisor adds process management, not another reasoning implementation. Existing worker limits remain in force. The Java heap flags and this supervisor are not proof of the planned hard total-process 2 GiB memory ceiling; that obligation remains open.

## Inspect and reconcile

Recover through the installed local operator, outside ordinary domain/MCP tools. Stop the selected service, or establish that its recorded process is definitely dead. A live foreground owner is also excluded by the workspace lease. The commands use the original managed workspace, task and pinned worker-root binding:

```text
evopilot-ontology task-recovery-inspect --installation ABS --project ID --task ID --json
evopilot-ontology task-reconcile --installation ABS --project ID --task ID --request-id ID --expected-report SHA256 --json
```

Inspect returns a stable `reportDigest`, the original task/input identities, exact worker attempts and blocking reasons. It verifies the task event chain and matching private process evidence. `ready:true` means the operator can resolve every attempt using a confirmed exit or an atomic no-launch fence; it never means the formal task passed.

An attempt recorded before supervisor startup can be fenced atomically against a later launch. This also covers owner death between committing a worker intent and committing its dispatch event. A supervisor must claim its record before spawning a worker, and cannot claim a fenced attempt. The normalized inspection digest is unchanged by a no-launch fence, so interruption after fencing but before the owner transaction commits can resume the same operator request.

Reconciliation requires the exact inspected digest. It atomically retains a separate recovery receipt and closes the original task as `FAILED`, `complete:false`, with `OWNER_INTERRUPTED`. The receipt/result bind the recovery report and actual worker exit/fence evidence. The original business request receipt remains unchanged; replaying it cannot rerun the task. A later authorized task requires its own explicit request and current revision. No new model, validation result, review decision or delivery is created by recovery.

Exact operator request replay returns its original receipt. Changing its parameters conflicts. Missing or corrupted evidence, a changed inspection, a foreign project/root, a live owner, or a task with contradictory terminal evidence cannot be reconciled. In particular, recovery never overwrites an already retained formal result. Operator inspection/replay also requires a stopped owner in this development interface.

## Failure boundaries and evidence

Actual isolated tests suspend a real test-owned Java worker or Python/pySHACL worker, then terminate the managed service while that child remains alive. Suspension keeps the intended fault window stable under concurrent test load and verifies that the supervisor can stop an unresponsive child. The tests verify child exit, original incomplete-task closure, compiled installed CLI operation, immutable business receipt replay and a subsequent explicitly requested task. Another test terminates the owner before dispatch-event commit and resumes after the no-launch fence.

If the supervisor itself is lost after starting a worker, its exit proof may be unavailable. The task remains blocked even if a cached PID later disappears. The implementation does not invent an exit status, clear that barrier, reconstruct an unobserved formal result or guess which PID to kill. Recovery from this stronger loss, missing/corrupted journals, and legacy untracked workers remains an explicit limitation requiring further process-isolation/recovery work. Source fault tests are not actual Host acceptance or release authority.

The [Linux resource-isolation backend](worker-isolation-v090.md) now extends the internal dispatcher and this journal through explicitly selected `ontology-owned-worker/v2` attempts. A systemd user manager creates the bounded kernel group before starting the supervisor and independently enforces the deadline. The additive journal table retains exact invocation, durable stop fence and actual terminal evidence without changing the historical journal version or v1 semantics. Admission/spawn transactions serialize against the fence. Actual tests cover owner/supervisor loss, delayed launch, OOM and loss of both observing processes.

Internal v2 reconciliation can retain `GROUP_TERMINATED` after supervisor loss, with no invented child exit code, signal or formal result. Already committed terminal evidence remains replayable after unit removal; missing units without that evidence preserve the barrier. A successful termination request alone is not proof of closure. The original owner task's protocol marker and installed operator still select v1. **The v2 backend is not yet connected to managed installation, formal runner configuration or these task-reconciliation commands.** Their stronger-loss limitation therefore remains until those contracts and actual installed journeys are implemented and verified.
