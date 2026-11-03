# Owned formal worker recovery

This development implementation adds process evidence and stopped-owner recovery to the [managed installation](managed-toolchains-v090.md). It does not establish complete P4 or v0.9 acceptance. Business state remains version 14. Queued tasks record `ontology-owned-worker/v1` for the existing native supervisor, or `ontology-owned-worker/v2` and the original isolation digest for an explicitly selected systemd backend. Historical tasks without a recognized marker remain readable but cannot be cleared by inferring newer process guarantees.

## Process lifetime and evidence

The TypeScript owner records each attempt before dispatch. A separate compiled Node supervisor starts the exact selected Java or Python executable, verifies the submitted input bytes against the retained input digest, enforces the existing deadline/output budgets and owns the live child handle. The native v1 supervisor stops its child on parent IPC loss. The selected v2 supervisor checks the initiating owner's boot/PID/start-time identity, while its manager independently controls the entire unit. Recovery never signals a PID loaded from historical records.

The private `worker-journal.sqlite` retains immutable intent, supervisor identity, worker identity and observed exit records. The intent binds worker request, configuration and toolchain digests, command/environment, input byte count/digest and limits. Original ontology input and stdout/stderr bodies are not stored in this journal. Exit records retain status, reason, output digests and byte counts. The owner validates returned bytes against the exit record before accepting a worker response. Failure to observe a matching exit/result leaves the task `INTERRUPTED`, rather than reporting an ordinary completed failure and permitting another worker.

The journal is bounded to 4,096 attempts and 64 MiB; an individual intent is limited to 32 KiB. Reaching a limit stops new dispatch without deleting history. Automatic archival/rollover is not implemented. Java/Python remain the only formal executors; the supervisor adds process management, not another reasoning implementation. The selected v2 manager supplies the [kernel resource boundary](worker-isolation-v090.md). Native v1 and Java heap flags alone do not establish the planned hard total-process 2 GiB ceiling. Complete platform distribution and resource acceptance remain open.

## Inspect and reconcile

Recover through the installed local operator, outside ordinary domain/MCP tools. Stop the selected service, or establish that its recorded process is definitely dead. A live foreground owner is also excluded by the workspace lease. The commands use the original managed workspace, task and pinned worker-root binding:

```text
evopilot-ontology task-recovery-inspect --installation ABS --project ID --task ID --json
evopilot-ontology task-reconcile --installation ABS --project ID --task ID --request-id ID --expected-report SHA256 --json
```

Inspect returns a stable `reportDigest`, the original task/input identities, exact worker attempts and blocking reasons. It verifies the task event chain and matching private process evidence, including the originally queued protocol/isolation identity. `ready:true` means the operator can resolve every attempt using a confirmed native exit, exact v2 unit termination or an atomic no-launch fence; it never means the formal task passed. Inspection is read-only and does not stop a unit or commit a recovery result.

An attempt recorded before supervisor startup can be fenced atomically against a later launch. This also covers owner death between committing a worker intent and committing its dispatch event. A supervisor must claim its record before spawning a worker, and cannot claim a fenced attempt. The normalized inspection digest is unchanged by a no-launch fence, so interruption after fencing but before the owner transaction commits can resume the same operator request.

For an admitted v2 attempt, inspection requires retained terminal evidence or the exact manager invocation's observed terminal status and empty group. The v2 report binds the original unit and normalized termination fields. Observation timestamps and newly retained worker outcome hashes do not change the report identity, so interruption after worker reconciliation but before the business transaction can resume with the same inspected digest. A missing unit without previously retained terminal proof remains blocked.

Reconciliation requires the exact inspected digest. After retaining the required worker evidence, it atomically commits a separate business recovery receipt and closes the original task as `FAILED`, `complete:false`, with `OWNER_INTERRUPTED`. The receipt/result bind the recovery report, actual worker exit/fence evidence and v2 terminal evidence when applicable. The original business request receipt remains unchanged; replaying it cannot rerun the task. A later authorized task requires its own explicit request and current revision. No new model, validation result, review decision or delivery is created by recovery.

Exact operator request replay returns its original receipt. Changing its parameters conflicts. Missing or corrupted evidence, a changed inspection, a foreign project/root, a live owner, or a task with contradictory terminal evidence cannot be reconciled. In particular, recovery never overwrites an already retained formal result. Operator inspection/replay also requires a stopped owner in this development interface.

## Failure boundaries and evidence

Actual isolated tests suspend a real test-owned Java worker or Python/pySHACL worker, then terminate the managed service while that child remains alive. Suspension keeps the intended fault window stable under concurrent test load and verifies that the supervisor can stop an unresponsive child. The tests verify child exit, original incomplete-task closure, compiled installed CLI operation, immutable business receipt replay and a subsequent explicitly requested task. Another test terminates the owner before dispatch-event commit and resumes after the no-launch fence.

For native v1, loss of the supervisor after starting a worker can leave exit proof unavailable. That task remains blocked even if a cached PID later disappears. Missing/corrupted journals and legacy untracked workers also retain their barriers. Source fault tests are not actual Host acceptance or release authority.

The [Linux resource-isolation backend](worker-isolation-v090.md) now extends the internal dispatcher and this journal through explicitly selected `ontology-owned-worker/v2` attempts. A systemd user manager creates the bounded kernel group before starting the supervisor and independently enforces the deadline. The additive journal table retains exact invocation, durable stop fence and actual terminal evidence without changing the historical journal version or v1 semantics. Admission/spawn transactions serialize against the fence. Actual tests cover owner/supervisor loss, delayed launch, OOM and loss of both observing processes.

V2 reconciliation can retain `GROUP_TERMINATED` after supervisor loss, with no invented child exit code, signal or formal result. Already committed terminal evidence remains replayable after unit removal; missing units without that evidence preserve the barrier. A successful termination request alone is not proof of closure. Managed installation, formal runner configuration and the stopped-owner commands now use the selected protocol without rewriting historical attempts.

The explicit installed collector in [worker isolation](worker-isolation-v090.md) exercises Java and Python supervisor-loss recovery, an interruption between worker and business commits, exact operator receipt replay, original business receipt replay and a separately requested later task. It uses synthetic business data and actual installed executors; actual Codex Host and complete release acceptance remain separate obligations.

After the business task has a retained terminal result, [completed worker maintenance](managed-toolchains-v090.md#completed-worker-maintenance) can retire its manager units and release its private job bodies. It retains the attempt, outcome, unit-terminal proof and original result/receipt. An unfinished task must be reconciled first. Interrupted cleanup has its own durable request and dispatch barrier; it does not become a second reasoning attempt or a recovered formal result.
