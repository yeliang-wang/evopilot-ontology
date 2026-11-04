# Independent installation maintenance

This is P4 development behavior, not a release, actual Host acceptance or a
completed MAINT-01 result. Consistent stopped-owner **backup and byte verification**
and protected restore candidate materialization are implemented. Internal inactive
state preparation reconciles selected history and credentials and installs
request-generation guards. Retained-current restoration now verifies the stopped
owner, activates reconciled drafts at the original workspace path and preserves
current installation/worker storage. Missing-owner activation preserves copied
historical worker storage through explicit lineage. Upgrade, customization merge,
complete maintenance acceptance and selected test-asset reset remain required
work. A verified backup or prepared database alone does not
establish full restore capability.

A killed formal worker may leave a journal for its empty `operator.sqlite`
control lease. Cold-backup inspection first proves task completion and worker
exit, validates the owned control store and acquires its exclusive SQLite lease,
then commits the same header version so SQLite can settle that journal. This
does not delete a journal directly or recover business results. Busy, foreign,
oversized or redirected control evidence is refused. Business SQLite sidecars
still block backup. Ordinary lease acquisition retains its allocation-free path
for recovery on a full filesystem.

## Protected restore candidate

The installed operator can materialize a fully byte-verified backup into a new
private candidate directory. This step does not require the old owner directories
or an available Java/Python runtime. It never opens their databases or modifies
their files. The destination must be absent, outside source, with a canonical
private parent and separate from the backup and original installation, workspace
and package runtime. Select a dedicated recovery location outside toolchain trees.

```text
evopilot-ontology restore-stage-inspect --backup ABS_BACKUP --expected-manifest BACKUP_SHA256 --stage-root ABS_NEW_CANDIDATE --request-id RESTORE_ID --json
evopilot-ontology restore-stage-apply --backup ABS_BACKUP --expected-manifest BACKUP_SHA256 --stage-root ABS_NEW_CANDIDATE --request-id RESTORE_ID --expected-report REPORT_SHA256 --json
evopilot-ontology restore-stage-verify --stage-root ABS_CANDIDATE --expected-manifest STAGE_SHA256 --json
```

`BACKUP_SHA256` identifies the original independently retained backup manifest;
`REPORT_SHA256` binds the inspected source, destination, request and parent
identity. `STAGE_SHA256` is the distinct manifest digest in the staging receipt.
Keep both manifests and receipts private. Inspection reports identities and
relative file metadata, without printing credential bytes.

Candidate `installation/` and `workspace/` contain the original file bytes and
modes. Backup control history remains in the original manifest projection;
excluded installation/workspace leases are not fabricated as recovered history.
New staging control files and activation barriers are separate from the snapshot.
The completion manifest maps each original inventory entry to its new physical
file identity. In particular, worker catalogs, archive receipts, task references,
business receipts and credential bytes are not rewritten to match new inodes or
paths. This records storage lineage; activating historical journal lookup still
requires the owner recovery implementation.

Workspace, installation and worker-root barriers are durable before payloads
are copied. Service startup, reviewer writes and new worker admission remain
blocked with `RESTORE_STAGED`. An incomplete barrier also fails closed. The
candidate is **not an executable recovered installation**, even after successful
verification. All reports retain `activation: BLOCKED`; credential state is
`SNAPSHOT_ONLY` and external runtime dependencies are `NOT_VERIFIED`.

After interruption, repeat the exact apply request. Every unfinished attempt
reverifies the entire backup before continuing and after copying. Partial files
must be exact payload prefixes; resume only appends, preserving corruption or
foreign material as an error. The control lease serializes writers. An inactive
private SQLite lease journal can remain after process death; it is bounded to
64 KiB and is not business history. An interruption before any request barrier
is retained leaves an unowned occupied directory. A partial bootstrap barrier
must already contain its complete report digest to identify the original request;
a generic JSON prefix cannot establish ownership. Otherwise preserve the directory
and choose a new destination, rather than automatically adopting or deleting it.

A durable staging manifest is its completion point. Replay returns the original
receipt with `verification: NOT_RUN`, even if source roots are now unavailable or
candidate bytes later change. `restore-stage-verify` independently checks every
candidate byte, mode, physical identity, exact inventory and activation barrier
against the selected staging digest. It does not need the source backup. Copying
the candidate to new inodes invalidates that physical completion identity;
portable backup verification remains a separate capability.

Disk-full errors leave the candidate inactive and the current owner unchanged.
There is no implicit cleanup, owner switch, credential rollback, request replay
or restore abort that deletes partial files. Missing post-backup receipts, newer
immutable history and current credential revocations/rotations must be reconciled
before a future activation command can permit new work. Staging does not satisfy
those obligations, full restore/upgrade acceptance or MAINT-01.

## Inactive state reconciliation

The internal operator module `dist/installation/restore-state.js` prepares a
separate, blocked workspace from a verified selected stage and, where available,
a verified retained-current stage of the same owner and original locations. Its
`inspectRestoreState`, `prepareRestoreState` and `verifyPreparedRestoreState`
functions are preparation primitives used by the retained-current activation
workflow below. Activation binds the latest stopped state and credentials and
proves that the retained stage still represents that owner. Merely supplying a
stage as `retained` to the preparation primitive is not proof of freshness.

Preparation preserves the exact original receipt, audit, intent, model, source,
formal-task, review and immutable delivery rows from both sources. Same-key
conflicts, conflicting published asset/version identities, unknown schemas and
unfinished tasks are refused. Current project identities remain intact, and each
project revision advances once beyond the maximum retained revision. Selected
snapshot intent/source/model/expectation heads become the editable draft heads;
retained review and delivery heads remain selected, including their absence.
Snapshot-only heads are never inserted into an authoritative retained selection;
their immutable review/delivery records remain available as history. Restoring an older draft
therefore cannot restore an approval superseded by a later rejection. Projects
created only after the selected snapshot retain their history with no selected
draft intent. No receipt, audit sequence or published document is rewritten to
match the recovery revision.

With a retained-current stage, credential, token and reviewer issuance bytes are
copied exactly, including revocations and expired credentials. In explicit
lost-owner preparation, old grants are retired or revoked; one new operator grant
has only read/write access to the installation project, never review authority.
It requires an explicit expiry within 30 days when admitted. Private token writes
resume an existing random prefix and never return token material in reports.
Historical reviewer issuance files do not authorize missing grants to be reissued.

A prepared workspace uses `ontology-workspace/v2` identity metadata while keeping
the physical business database at state version 14. The identity records the
selected/retained digests, credential policy, preparation request and a fresh
128-bit generation. The operator admission layer must generate and durably bind
that generation once; exact retries reuse it. A generation already present in
either source identity or its receipts is refused. Old readers that accept only
identity v1 cannot silently open recovered state.

Authenticated discovery exposes the current request prefix `r<generation>.`.
Known original business requests still replay their exact receipts after current
authorization checks. Missing requests outside the current generation return
`REQUEST_OUTCOME_UNKNOWN`; they are never interpreted as unexecuted work. Truly
new requests use the advertised prefix plus a nonempty suffix, at most 62
characters. Do not rename an uncertain old request into the new generation.
The same guard applies to new reviewer grant IDs, preventing an old partially
written issuance file from reviving authority. A second recovery preserves known
earlier-generation receipts and fences missing outcomes from both older periods.
The prefix supplies no authentication, permission, business decision or automatic
redispatch authority.

Database reconciliation is one full-synchronous SQLite transaction. It accepts
only the canonical state-14 schema, at most 500,000 aggregate table rows, the
existing project/receipt/task limits, and a 64 MiB result database. An interrupted
empty transaction can resume; a committed result must match every expected row
and the exact recovery identity before retry continues. Unknown or corrupt
partial state is preserved, not reset. File copying resumes exact prefixes.
Durable barriers precede candidate content and remain after preparation. A
manifest binds the result bytes, modes and new physical file identities; exact
completion replay returns the original receipt with `verification: NOT_RUN`.
Independent verification checks the full prepared inventory without its source
stages. Neither replay nor verification removes a barrier.

Retained-current activation keeps worker evidence newer than the selected
snapshot at its original physical location, verifies external dependencies and
safely switches the workspace. Missing-owner activation resolves copied physical
journal storage through the explicit lineage described below. Prepared database rows
alone cannot establish those guarantees. All preparation receipts therefore
retain `activation: BLOCKED`; MAINT-01 remains unevaluated.

## Restore after both owner directories are lost

Use `restore-lost` only when both original installation and workspace paths are
absent. Mixed loss, an occupied destination (including an empty directory), a
foreign partial recovery, or an unresolved launch on the current host is refused.
The operator never deletes those paths or signals a PID to make them available.
Prepare the selected backup with `restore-stage` first. Its original path strings,
installed runtime and pinned Java/Python selections remain authoritative; this
mode does not substitute another host, upgrade a package or download dependencies.
The private recovery parent and both original parents must share a filesystem.

```text
evopilot-ontology restore-lost-inspect --snapshot ABS_STAGE --snapshot-manifest STAGE_SHA256 --recovery-root ABS_NEW_RECOVERY --request-id RESTORE_ID --rekey-expires-at UTC --json
evopilot-ontology restore-lost-apply --snapshot ABS_STAGE --snapshot-manifest STAGE_SHA256 --recovery-root ABS_NEW_RECOVERY --request-id RESTORE_ID --rekey-expires-at UTC --expected-report REPORT_SHA256 --json
```

Credential expiry must be explicit and within the next 30 days at admission.
The reconciled workspace retires/revokes old grants and generates one fresh,
private read/write operator credential for the installation project. It does not
restore review authority. Old reviewer issuance files and business receipts stay
retained; possession of an old credential or issuance file does not grant access.
The fresh request namespace distinguishes new work from missing pre-recovery
outcomes. This backup cannot recover later data that was never captured.
The service context identifies its decision heads as
`SELECTED_SNAPSHOT_LATER_DECISIONS_UNKNOWN`; snapshot review rows do not prove
that no later decision existed. A retained-current recovery instead identifies
the selected heads as `RETAINED_CURRENT`. These labels describe the retained
source and do not add business or software-release authority.

Newly prepared recovery identities also bind `decisionAuditFloor`. Lost-owner
recovery sets it to the highest audit sequence in the selected snapshot. A new
delivery must have an explicit reviewer decision whose original receipt and
audit entry match its exact owner, project, principal, candidate, input, result,
revision and hashes, at a sequence above that floor. Replaying an old approval
receipt cannot satisfy this requirement. Missing, duplicate or mismatched proof
leaves the decision unconfirmed and `delivery.record` refuses it with
`REVIEW_RECOVERY_REQUIRED`. The operator credential still cannot submit reviews.

A retained-current restore carries the existing floor forward. A reviewer
decision that was confirmed after the earlier loss therefore remains usable
across that restore, even though the request prefix changes. Another lost-owner
restore establishes a new floor and requires new explicit review for subsequent
delivery. Restoring authoritative ordinary v1 state uses a null floor and adds
no loss-related review requirement. Revoking a reviewer's credential prevents
future authenticated actions; it does not revoke a recorded business decision.

Legacy completed v2 recovery identities without a floor remain readable. Their
new deliveries require an exact review receipt/audit in the current recovery
generation. A subsequent restore preserves their history and binds the highest
retained audit sequence as a conservative new floor; it does not guess the old
loss boundary. Incompatible unfinished preparation state is preserved and
refused rather than rewritten. Completed historical receipts are unchanged.

`review.inspect` reports `REVIEW_REQUIRED_AFTER_RECOVERY` for an unconfirmed
snapshot decision. Review-report pages, delivery inspection and export pages
expose `reviewRecovery` alongside the original content. This metadata describes
the recovery proof for that exact review, not full candidate readiness or a
software-release decision. Existing delivery receipts still replay, and exported
bundle bytes remain identical; recovery does not retroactively rewrite or
invalidate an immutable historical delivery.

The recovery namespace also applies to new backup requests, toolchain bindings,
worker rotation, worker cleanup and task reconciliation. Each command first
checks its owning journal for the exact original request. Known matching receipts
remain replayable, including receipts from earlier recovery generations. A missing
older request returns `REQUEST_OUTCOME_UNKNOWN` before admitting work. Use the
prefix returned by recovery only for genuinely new work; renaming an uncertain
retry does not establish permission to execute it again. Exact inspections of
unknown older backup/rotation requests also retain uncertainty. A missing request
inside the current generation keeps the operation's normal not-found response.
Ordinary workspaces without recovery metadata keep their existing request IDs.

Installation files and customizations are copied byte-for-byte into a blocked
candidate. Terminal backup control records projected by the snapshot, including
the selected backup's own receipt, are reconstructed without inventing pending
or failed requests. Original run records, tool bindings, worker catalogs,
rotation receipts and task references remain unchanged. Archived journals retain
their original immutable images in those catalogs. A separate bounded
`worker-storage.json` chain binds each original image, its previous physical
image, the restored inode and unchanged digest to the selected backup and this
activation. Each subsequent restoration retains prior records. A later rotation
of a mutable current journal captures its then-current physical identity.
Copying arbitrary bytes, replacing a file with an identical-byte inode, or
dropping a lineage generation is insufficient to pass archive verification.

Preparation reserves 128 KiB of real completion space before copying. The durable
switch intent binds both complete candidate inventories, and releases that reserve
before the directory moves. Installation moves to its original path first, then
task/worker closure is verified using the prepared database, and the workspace
moves to its original path. Activation barriers prevent normal work throughout.
The original receipt is committed before barrier release; the workspace's stage
barrier is removed last. Completion returns `serviceStarted: false`. Use the
normal explicit `start --installation ABS_INSTALLATION --json` command afterwards.

Before switch admission, an explicit abort preserves the candidate and keeps both
original destinations absent:

```text
evopilot-ontology restore-lost-abort --recovery-root ABS_RECOVERY --request-id RESTORE_ID --expected-report REPORT_SHA256 --json
```

After switch admission, only the exact forward continuation is supported. It
checks the retained physical layout, bytes and barriers; unknown material is
preserved. An admitted complete candidate can finish without its original stage.
Exact terminal replay returns the retained receipt with `verification: NOT_RUN`;
it does not revalidate a now-running owner. Keep the private recovery directory
as operator evidence. None of these operations starts a service, rebuilds business
assets, publishes a release or grants semantic approval.

## Restore with the current owner retained

This mode restores selected draft heads while preserving the latest stopped
owner's immutable business history, decisions, grants, installation customization,
runtime/toolchain bindings and worker journals. Both original owner directories
must still exist. Missing directories are refused; the command does not silently
substitute snapshot credentials or switch to a lost-owner policy.

Stop the exact installed owner first. Materialize the selected historical backup
with the staging commands above. Capture and stage a fresh backup of the stopped
current owner after reconciling formal tasks. Use that stage as `--retained`.
The activation operator compares its complete source byte/mode/inode inventory
with the current owner, validates immutable owner identity and task/worker
evidence, and verifies the pinned runtime and Java/Python toolchains. A newly
changed grant, task, file or run after that snapshot requires a fresh retained
snapshot and inspection; no stale source is silently adopted.

```text
evopilot-ontology restore-current-inspect --installation ABS_INSTALLATION --snapshot ABS_SELECTED_STAGE --snapshot-manifest SELECTED_STAGE_SHA256 --retained ABS_CURRENT_STAGE --retained-manifest CURRENT_STAGE_SHA256 --recovery-root ABS_NEW_RECOVERY --request-id RESTORE_ID --json
evopilot-ontology restore-current-apply --installation ABS_INSTALLATION --snapshot ABS_SELECTED_STAGE --snapshot-manifest SELECTED_STAGE_SHA256 --retained ABS_CURRENT_STAGE --retained-manifest CURRENT_STAGE_SHA256 --recovery-root ABS_NEW_RECOVERY --request-id RESTORE_ID --expected-report REPORT_SHA256 --json
evopilot-ontology start --installation ABS_INSTALLATION --json
```

The new private recovery directory must have a canonical private parent on the
workspace filesystem, outside source and separate from installation, workspace,
runtime and both stages. Moving a filesystem mount root is excluded. There must
be room for the prepared workspace and bounded metadata; the old workspace is
retained by rename, not deleted. Application is bound to the exact inspected
report. Admission durably generates a fresh request generation once, freezes
ordinary workspace/installation/worker writes and reserves 128 KiB of real
completion storage. This reserve is bounded headroom, not protection from
unrelated processes exhausting the filesystem.
An interruption before a complete admission is retained leaves an unowned
occupied directory. Preserve it and select a new recovery destination; a generic
partial JSON prefix is not authority to adopt that directory.

The operator reconciles state, proves all retained task references against
current worker evidence, and records the exact prepared manifest. It then
durably admits the directory switch, renames the old workspace to
`ABS_NEW_RECOVERY/previous-workspace`, and moves the verified candidate to the
original workspace path. Existing installation and worker files retain their
original bytes and inodes. Original business receipts and archived journal
identities are not rewritten. Each directory transition is synchronized and
records its phase; another writer, unexpected directory, changed source or
corrupt candidate prevents continuation.

Keep the recovery directory private and retain it with its admission, phase
records, original workspace and activation/release receipts. It is independent
recovery evidence outside the active owner; a later ordinary owner backup does
not implicitly collect that external directory. The preserved workspace remains
blocked from service startup. The new workspace's barriers are released only
after the cutover receipt is durable. Apply never starts the server; use the
explicit installed `start` command, then read authenticated context for the new
request prefix. Current revoked or expired grants remain unusable. Do not use
the prefix to relabel old uncertain work as a new request.

After a process interruption, repeat the exact apply command. Before switch
admission it rechecks current state and resumes the same candidate. After switch
admission it verifies the recorded old/new physical directories and continues
forward. An interruption between renames leaves the installation blocked;
absence of the workspace at that phase does not mean it should be initialized.
Once prepared state and the switch intent are durable, resuming the switch does
not require the source stages to remain available. Unknown replacement material
is preserved rather than overwritten. A committed cutover with pending barrier
release reports `CUTOVER_COMMITTED`; exact retry completes matching cleanup.
Independent inspection reports phase evidence with `verification: NOT_RUN`.

Before switch admission, an explicitly abandoned attempt can release its owned
barriers while retaining all partial candidate files:

```text
evopilot-ontology restore-current-abort --recovery-root ABS_RECOVERY --request-id RESTORE_ID --expected-report REPORT_SHA256 --json
```

Abort refuses an admitted directory switch. Resume that switch instead of
rolling back potentially visible new state. An aborted request cannot be reused.
Terminal apply/abort replay returns its original receipt with `verification:
NOT_RUN`; after completed barrier release it is independent of source stages or
the owner's current location and can be read while the service runs. It does not
attest current file integrity or undo subsequent work. Foreign markers are never
removed as owned cleanup. Missing-owner recovery and copied worker lineage still
need separate actual activation/fault evidence before full MAINT-01 acceptance.

## Cold backup workflow

Use the independently installed compiled `evopilot-ontology` operator. All paths
are explicit and private, outside source repositories. Stop the exact installation
and reconcile unfinished formal tasks first. The destination must be absent with
an existing canonical private parent, separate from installation, workspace,
package runtime and selected Java/Python tool roots.

```text
evopilot-ontology stop --installation ABS_INSTALLATION --json
evopilot-ontology backup-inspect --installation ABS_INSTALLATION --backup ABS_NEW_BACKUP --request-id BACKUP_ID --json
evopilot-ontology backup-apply --installation ABS_INSTALLATION --backup ABS_NEW_BACKUP --request-id BACKUP_ID --expected-report SHA256_FROM_INSPECT --json
evopilot-ontology backup-verify --backup ABS_BACKUP --expected-manifest SHA256_FROM_RECEIPT --json
```

Inspection returns the complete relative file inventory, private source identities,
content digests, installation/runtime binding, prior terminal backup receipts,
formal task count and journal counts. It does not print credential bytes. Review
that inventory and bind `backup-apply` to its exact digest. A changed inventory is
refused before a new backup is admitted. Keep the resulting manifest digest
separately as the identity supplied to later verification; reading a digest from
the same untrusted backup is not an independent integrity check.

The backup covers installation configuration and generated/customized plugin
files, run history, workspace identity and business database, credentials,
reviewer issuance/token files, toolchain binding history, current and archived
worker journals, and retained worker job files. Source bytes and immutable
business receipts are not rewritten. SQLite operator/writer lease files,
maintenance barriers and their staging files, and current backup control files
are excluded. Prior terminal backup control records are included as a manifest
projection, preventing recursive self-backups. Runtime/JDK/Python payloads are
external dependencies identified by the original bindings; this backup does not
bundle or provision them. Their selected manifests and matching runtime bytes
remain prerequisites for later recovery design.

All source files must be private, owned, regular and without hard links. Symbolic
links, unresolved database journal/WAL/SHM sidecars, unproven worker exits and
pending worker maintenance/rotation prevent a backup. The operator holds the
installation lock and workspace writer lease. Durable maintenance barriers in
the workspace, installation and configured formal-work root prevent ordinary
service startup, foreground owner writes, reviewer changes and new worker
admission while a backup is unfinished. Unrelated owners remain available.

## Interruption and receipts

Repeat the exact `backup-inspect` parameters to read `PENDING`, `COMPLETED` or
`ABORTED`. Repeat the original apply request to resume a pending copy. Object
files contain a request-bound header followed by the exact source payload;
existing partial bytes must match the expected header/source prefix. Resume
appends missing bytes only. Changed or foreign partial bytes are preserved and
reported, never truncated. Protocol documents likewise use bounded, deterministic
staging bytes, then atomic rename and directory synchronization. These receipts
are content identities and intentionally contain no wall-clock completion claim.

Before committing the manifest, the operator verifies every object and rechecks
the complete source inventory. A durable manifest is the backup completion point.
If the process dies before retaining its installation-side receipt, repeating
apply checks that same completion manifest against the original owner/request
and snapshot digest, then retains its original receipt with `verification:
NOT_RUN` and `completionReconciled: true`. This historical completion remains
readable even if payload objects, the duplicated plan or destination owner file
are later missing or corrupt. It does not claim that a usable copy remains.
Run `backup-verify` separately for current full byte integrity. No source
rollback or fresh snapshot is inferred. Completing or aborting a request retains
its receipt before releasing barriers, with the workspace barrier released last.

An already completed apply returns its original receipt with
`verification: NOT_RUN`; this replay does not claim the current copy is healthy.
Retained receipt inspection does not require the backup destination or its parent
to still exist. Replaying a terminal request with no remaining barriers also
works while the owner is running; unfinished barrier cleanup still takes its lease.
Use `backup-verify` for a new full byte check. Verification works on a privately
copied backup at another canonical location, retaining the original provenance
paths and source inode identities without pretending those inodes still exist.
It rejects missing/extra objects, changed headers, payloads, plan, manifest or
receipt. It never opens the original workspace or launches an executor.

If the source changed or an incomplete copy cannot proceed, explicitly abort:

```text
evopilot-ontology backup-abort --installation ABS_INSTALLATION --request-id BACKUP_ID --expected-report SHA256_FROM_INSPECT --json
```

Abort retains the partial destination and its exact terminal receipt, and releases
only matching maintenance barriers. A different request/report cannot abort the
operation. A valid matching durable completion manifest must be finalized through
apply instead of aborted. An unreadable, corrupt or foreign manifest does not
prevent explicit abort of the retained owner request; all destination bytes are
preserved. `ABORTED` records abandonment of the unfinished operation, not proof
that no files were written or that no recoverable artifact exists. An incompatible
partial terminal-control write is retained in its original staging file while
the chosen terminal state uses a distinct bounded staging path.
An aborted ID cannot be reused; a subsequent backup needs a new request ID and
absent destination. Foreign or malformed source-owner/control-barrier evidence remains an error, not an
authorization to erase it. No automatic recursive cleanup is included.

## Bounds and remaining recovery requirements

Each backup admits at most 10,000 file/directory entries, depth 16, 64 MiB per
source file, 2 GiB logical source bytes, and an 8 MiB manifest envelope. Source
inspection is bounded to 4,096 formal tasks and 17 journals of at most 4,096
attempts each. The installation retains at most 128 backup requests. Capacity
errors preserve existing material; unlimited retention/offload is not claimed.
Before admitting a new request, the installation allocates a private completion
reservation containing 128 KiB of padding, verifies that at least 128 KiB of real
filesystem blocks are allocated, and synchronizes it. Only an exact matching
reservation is released before retaining the completion/abort record. This lets
the owner finish a small terminal write when a payload copy fills the same
filesystem. The control directory has bounded staging and completion headroom;
uncommitted incompatible metadata is preserved. A pre-reservation historical
request can still be reconciled, but cannot retroactively acquire a space
guarantee. Missing/corrupt source control, unavailable storage or unrelated
processes consuming the newly released space can still require operator repair;
they never authorize deleting arbitrary files, weakening evidence or redispatch.
The private operator/writer lease databases retain a committed empty SQLite
header with internal `user_version=1`; they contain no business tables. An older
empty lease is initialized only while its existing exclusive lock is held.
Subsequent acquisition requires no bootstrap rollback-journal allocation, which
would otherwise prevent opening a maintenance lease on a full filesystem.
Initialization keeps the same file identity, and exclusive-lock contention stays
enforced. Foreign lease schemas are preserved and rejected. Business state
version 14 and immutable workspace records are unchanged.
Payload hashing/copying uses fixed-size buffers, and repeated content is stored
once under its digest. Backups contain secrets and keep private permissions;
this local format does not add encryption, remote storage or publication.

Restore must preserve original business receipts and distinguish post-backup
missing outcomes from requests known not to have run. It also must preserve
credential revocation/expiry, immutable archive reference identity and newer
history. Upgrade must account for runtime/toolchain lineage and local plugin
customization. None of these obligations is satisfied by replacing a database
with older copied bytes. Actual historical test-asset reset remains P6 after
installation verification, with no automatic business rebuilding.

The focused source tests install a packed candidate and cover full private byte
readback, customization/grant preservation, portable verification, live-owner
and unsafe-path refusal, actual process death during copying, exact resume,
source drift/abort, archived/current worker inclusion and selected metadata
interruption states. Synthetic metadata states are identified separately from
actual killed-process evidence. Fixed full-version acceptance remains independent.

The separate Linux `tests/acceptance/v090/backup-faults.mjs` collector requires an
explicitly owned tmpfs fixture capped at 128 MiB. It exercises actual ENOSPC during
copy, abort without external space release, exact resume after deliberate fixture
space release, and a real process kill after manifest persistence followed by
payload corruption and a full filesystem. Mounting/filling that isolated volume
is test infrastructure, not a product installation/restore capability. Reports
retain exact package/component hashes and distinguish original completion from
present copy integrity; they do not establish MAINT-01 restore acceptance.

The installed restore-staging source tests additionally cover preserved original
receipts and pre-revocation credential snapshots, readonly file modes, archived
worker catalogs, explicit new-inode lineage, blocked service/worker startup,
actual SIGKILL and exact-prefix resume, corrupted/missing source material,
independent candidate verification and separately labeled partial-metadata
fixtures. The isolated Linux `tests/acceptance/v090/restore-stage-faults.mjs`
collector exercises actual ENOSPC, retry with zero free bytes, explicit fixture
space release and resume, rejection of a backup corrupted after a disk-full
failure, and actual installed-CLI SIGKILL. It checks that the original owner stays
unchanged and the candidate stays inactive; it does not test activation or claim
that missing historical outcomes have been resolved.

State-reconciliation tests cover current revocations/expiry, lost-owner rekey,
exact old receipts, newer model/review/delivery history, repeated recovery and
unknown-request refusal. Isolated service tests explicitly remove a fixture
barrier to exercise those guards; that test-only step is not product activation.
They distinguish synthetic metadata interruptions from actual process death
after database commit. The Linux `tests/acceptance/v090/restore-state-faults.mjs`
collector uses a separately owned 128 MiB tmpfs fixture to check actual SQLite
disk-full rollback, exact recovery after fixture space release, and SIGKILL
during post-commit copying. Corrupt prefixes must remain unchanged and fail;
only explicit fixture repair permits that test to resume. These checks leave
the original owner unchanged and the candidate inactive, and do not establish
current-owner freshness, activation, actual Codex Host acceptance or MAINT-01.

`restore-activation-v090.test.mjs` additionally exercises the actual installed
retained-current commands, a restarted service handling new requests, repeated
activation, stale-source refusal, original-root preservation and real SIGKILL
during copying and both directory transitions. Actual Java/Python tasks, archived
worker references and new post-activation formal work are checked. Terminal
cleanup metadata fixtures are explicitly synthetic and separate from actual
killed-process evidence. These are owning product/installed-service checks;
they do not establish missing-owner activation or an actual Codex Host journey.

The Linux `tests/acceptance/v090/restore-activation-faults.mjs` collector uses a
separate owned 128 MiB tmpfs. It checks exact retry at zero free bytes, explicit
pre-switch abort using reserved completion space, and a real post-rename SIGKILL
followed by continuation without source stages. It also starts an installed
restored service, executes new Java/Python work under systemd and maintains the
original and new task evidence. Fault fixtures are synthetic private owners,
not production workspaces or Codex Host acceptance.

`restore-lost-v090.test.mjs` checks actual packed CLI activation, credential rekey,
customization/receipt preservation, repeated recovery with intervening worker
rotation, old and new Java/Python task readback, and actual SIGKILL during both
candidate copies and directory moves. The separately owned 128 MiB Linux fixture
in `restore-lost-faults.mjs` checks zero-free-space refusal/abort, post-rename
continuation without the source stage, and an installed restarted service with
archived, current and newly executed systemd-isolated formal tasks. These remain
isolated product evidence, not actual Codex Host or complete MAINT-01 acceptance.

## Preparing Expert customizations for a runtime upgrade

The stopped-owner command below compares the verified installed template (base),
the complete private plugin tree (current), and an explicitly selected, separate
installed runtime (new). Initial installation and this comparison share the same
canonical template generation, including the runtime-specific MCP binding.

```bash
evopilot-ontology upgrade-plugin-inspect \
  --installation /absolute/private/installation \
  --runtime-root /absolute/separate/installed-runtime \
  --runtime-digest sha256:EXACT_SELECTED_RUNTIME_DIGEST \
  --json
```

This is a preparation command. It neither activates the new runtime nor starts
the service, changes workspace/credentials, writes plugin files, verifies the
new formal toolchains, or admits an upgrade request. `MERGED` means only that a
candidate plugin tree could be constructed. The report binds runtime identities,
workspace identity, current physical tree, per-file base/current/new/output
digests and preserved modes. It contains no file contents or credential values.
An operator lease serializes preparation with other installation commands.

Unchanged files retain exact bytes. Independent text edits merge by exact lines,
preserving comments, CRLF and missing final newlines. JSON manifest/MCP edits
merge by object member; arrays are atomic. A structured JSON merge may normalize
formatting. Private files, binary content, executable modes and empty custom
directories are retained. Symlinks, hardlinks, public permissions, file/directory
collisions, invalid required configuration and changed managed launcher bindings
cannot produce an applicable candidate. The owned command, arguments and cleared
Node option variables must match the new runtime; unrelated private MCP settings
and explicitly configured other servers can remain.

Overlapping edits, competing insertions (including ambiguous insertion boundaries),
delete/edit and add/add conflicts remain `CONFLICT`. Conflicts identify paths and
line ranges or JSON pointers, without embedding private values. No conflict
markers become executable configuration. The total tree is bounded to 1,024
entries, depth 24, 16 MiB, and 1 MiB per file; automatic text comparison is bounded
to 10,000 lines and four million LCS cells per comparison. Exceeding text merge
complexity requires an explicit resolution rather than silently choosing a side.

An optional `--resolutions /absolute/private/resolutions.json` selects a private
document with the following structure. The three input digests come from the
exact conflict report; use JSON `null` for an absent input. Each `file` names a
private regular resolved file outside source, or is `null` for an explicit
deletion. Required plugin resources cannot be deleted. Duplicate/unknown paths,
stale digests and resolutions that break the owned launcher remain refused.

```json
{
  "schema": "ontology-plugin-resolutions/v1",
  "resolutions": [{
    "path": "skills/evopilot-ontology-expert/SKILL.md",
    "baseDigest": "sha256:EXACT_BASE_DIGEST",
    "currentDigest": "sha256:EXACT_CURRENT_DIGEST",
    "newDigest": "sha256:EXACT_NEW_DIGEST",
    "file": "/absolute/private/reviewed-SKILL.md"
  }]
}
```

The caller must inspect a fresh plan after editing any input. Runtime/toolchain
lineage, internal admission, staging and forward activation are described below;
installed interruption/storage-failure verification remains a separate obligation.
These preparation checks do not establish MAINT-02, actual Codex Host behavior or v0.9
acceptance. Installed source tests use two isolated offline installs and clearly
labeled synthetic upstream templates; they do not impersonate a released upgrade.

## Retaining runtime identity across upgrades

The versioned `ontology-installation/v2` contract retains the original runtime,
the original installation metadata digest, the exact original `setup.json` byte
digest and an ordered chain of runtime transition records. Each record binds its
owner, request and inspected-plan identities, previous transition, complete prior
runtime identity, selected new runtime, old/new toolchain binding digests, plugin
plan and timestamp. The current runtime must match the final transition. History
is bounded to 128 transitions and a 2 MiB installation document. Original v1
installations remain readable and initial setup still produces v1.

Old toolchain records retain their original bytes and digests. Their request
identities are reconstructed against the runtime they originally selected, rather
than against the current package. The complete toolchain sequence must agree with
the runtime transitions, including any intervening rebind. Configured tools cannot
disappear or reuse an old binding as evidence for a new runtime. Current execution
requires a binding for the selected runtime and matching actual Java/Python source
and dependency identities. Reading history does not execute historical packages
or attest that their old filesystem contents remain available.

New managed runs use `ontology-managed-run/v3` and bind the complete runtime
identity, including package root and Node executable/version/digest. The control
socket and daemon launch check that identity together with the toolchain binding.
The daemon also checks its own actual module location before changing a retained
starting record; an entry loaded from another package cannot impersonate the
selected runtime. Refusal preserves the original request for reconciliation.
Historical v2 runs remain readable without retroactively inventing a runtime
claim. An upgraded installation cannot reuse a live v2 run whose runtime is
unproven, or a v3 run bound to a different runtime. Original stopped run records
are not rewritten when a new run starts.

All retained runtime roots stay outside backup, restore-stage, reconciliation and
activation write destinations. New toolchains and candidate runtimes must also
respect those locations. Returning to an exact historical binding can be
represented; assigning different bytes to the same historical package location
cannot. One package digest cannot ambiguously identify multiple retained root or
Node bindings. Backup validation checks that the setup file in its inventory
matches the runtime history, and both restoration modes preserve that history.

These are implemented storage, reader and execution guards. The history builder
constructs a prospective record; the internal activation protocol described below
uses it to verify the selected installation before committing completion. The
public upgrade commands below delegate to that same protocol. Earlier lineage tests explicitly
construct versioned metadata fixtures under the owner leases, then
exercise actual installed startup, formal Java/Python validation, historical
receipt readback and lost/current-owner restoration. Such fixtures do not replace
installed activation and interruption verification, disk-full recovery, Codex Host
journeys or MAINT-02 acceptance.

## Inspecting the complete upgrade selection

`evopilot-ontology upgrade-inspect --installation ABS --input ABS_JSON --json`
now combines the candidate runtime, private plugin merge, stopped workspace
snapshot and actual toolchain verification under the installation and workspace
leases. The private input contains `requestId`, `upgradeRoot`, `runtimeRoot`,
`runtimeDigest`, `toolchains` and optional `resolutionsFile`. `toolchains` contains
the existing `dl`/`shacl` selections and optional exact `systemd` binding. Each tool
selection names `toolchainFile` and `toolchainDigest`.

The upgrade destination must be absent and a canonical sibling of the installation
under its private parent, on the same filesystem. This reserves the location in
the inspected plan for later atomic rename operations; inspection creates no
destination or transaction. Existing owner/package/tool roots remain protected.
The request must be fresh for the current recovery generation and must not reuse
a retained runtime or toolchain request. Resolve unfinished formal tasks before
inspection. Current installation, workspace, credentials, delivered assets,
plugin customizations, original receipts and formal-work ownership stay intact.

The report has a deterministic digest. A later candidate preparation can require
that exact digest and rejects changed owner history, plugin files or selections.
`PLUGIN_CONFLICT` remains a reviewable report and cannot pass admission preparation.
The merged private buffers are returned only to the internal transaction planner;
the CLI reports identities and digests, not private file contents.

Toolchain preparation returns stable proposed binding content without recording a
timestamp, appending a receipt or creating `formal-work`. The staging
transaction durably records the actual binding timestamp before activation. An unconfigured installation may select verified tools or
retain `toolchains: null`; the latter explicitly reports `toolchainsVerified: false`
and establishes no formal reasoning readiness. Configured tools cannot be removed.

This command prepares a complete upgrade selection. Admission,
pre-switch abort, staging and activation are described below. Actual
crash/storage-failure recovery still requires installed verification. Inspection
does not apply the prepared report or satisfy MAINT-02.

## Public upgrade operation and retained status

Use the installed `evopilot-ontology` binary. Each operation requires `--json` and
rejects missing, duplicate or unknown flags. The ordinary selection input is a
bounded UTF-8 JSON object at an absolute regular-file path. Keep the original
input, inspected report and report digest together in private operator storage.

```text
evopilot-ontology upgrade-stage --installation /private/ontology/installation --input /private/ontology/upgrade-input.json --expected-report SHA256 --json
evopilot-ontology upgrade-status --installation /private/ontology/installation --request-id REQUEST_ID --json
evopilot-ontology upgrade-activate --installation /private/ontology/installation --input /private/ontology/upgrade-input.json --expected-report SHA256 --expected-prepared SHA256 --json
evopilot-ontology upgrade-abort --installation /private/ontology/installation --input /private/ontology/upgrade-input.json --expected-report SHA256 --json
```

First run `upgrade-inspect` and resolve any reported plugin conflict. Bind
`upgrade-stage` to the returned `reportDigest`; successful staging returns the
`preparedDigest` required by `upgrade-activate`. Stage replay returns the same
sealed candidate when its evidence remains exact. Activation replay continues
the same switch or returns its retained completed receipt. Neither command starts
the service. Select the separate `start` operation after successful completion
when startup is intended.

Before a switch or its partial record exists, `upgrade-abort` releases the admitted
request while retaining its partial/staged material. An interrupted admission may
have only a `.pending` prefix. In that case supply
`--retained-report /private/ontology/original-report.json` with the exact original
report object and its original `--expected-report` digest. This file contains the
raw report, not the CLI `{ok,result}` wrapper. It uses a separate 8 MiB maintenance
byte limit and bounded JSON nesting; ordinary selection input retains the 512 KiB
request limit. A wrong report cannot authorize reconciliation. After switch
admission, continue with `upgrade-activate`; pre-switch stage/abort cannot reverse
that transaction.

`upgrade-status` reads only retained installation-side records. It does not open
the business database, acquire or create a writer/operator lock, settle a marker,
repair an incomplete record, or inspect external runtime/tool health. Missing
live `installation.json` during component renames and unavailable external stage
directories therefore do not prevent retained-status inspection. A changing read
sample is refused so the caller can repeat the read.

| Retained phase | Meaning and recovery direction |
| --- | --- |
| `NOT_FOUND` | No record for the selected request was observed. |
| `ADMISSION_PENDING` | Reconcile the original admission; a prefix is not a complete admission. |
| `ADMITTED` / `STAGE_OWNED` | Continue the pre-switch operation or abort; stage ownership alone does not prove a sealed candidate. |
| `SWITCH_PENDING` / `SWITCH_RECORDED` | Only exact forward recovery is permitted. |
| `ABORT_PENDING` / `ABORTED` | Complete the original abort until its release is validated. |
| `COMPLETED` | Complete remaining cleanup unless the release is already validated. |

The separate `releaseState` distinguishes absent, partial and validated release
records. A validated terminal release needs no transaction recovery. Pending files
never establish a completed milestone. Before a switch records its prepared
digest, status leaves that digest null; use exact stage replay to recover the
sealed digest. `FORWARD_ONLY` describes protocol direction, not proof that every
external artifact needed for recovery is currently available.

Historical completed/aborted status and receipt replay validate retained evidence
without asserting current service health. Status reports
`validation: RETAINED_RECORDS_ONLY`, `runtimeHealth: NOT_CHECKED`,
`productAcceptance: NOT_EVALUATED` and `authority: false`. Contradictory, orphaned,
changed or unsafe control material is preserved and refused.

An actual local filesystem `ENOSPC` failure is reported as `STORAGE_FULL` with a
fixed message that does not expose filesystem paths. Existing typed product errors
keep their own codes. A storage error does not imply that the operation made no
writes: inspect retained state and available space before selecting recovery.
The CLI does not automatically retry, abort or roll back the request.

The development probe `tests/faults/upgrade-enospc.mjs` exercises installed public
upgrade commands on synthetic owners in a separately owned Linux tmpfs, bounded
to 128 MiB. Its fixture marker, mount identity, permissions and capacity must be
verified before filling that volume. Installed runtimes, tools and evidence stay
outside the fault volume. The probe distinguishes an observed filler-write
`ENOSPC`, zero available blocks, and the product command's error; these are separate
observations. Process interruption counts only when the child actually exits by
`SIGKILL` and retained post-exit records establish the interrupted phase.

This probe is development evidence. It does not replace the MAINT acceptance
collector, the standards-first formal evaluation sequence, actual Codex Host
journeys, or verification on other filesystems and platforms.


## Durable upgrade admission and pre-switch abort

The installed internal transaction module now retains an exact upgrade admission
in `upgrade-requests/` inside the selected installation. Its hexadecimal filename
encodes the request ID without confusing IDs such as `name.aborted` with protocol
suffixes. The admission binds the complete inspected plan, exact inputs, original
owner identities and the control directory's physical identity. The complete
plan is revalidated under the installation and workspace leases before admission.
A changed input or stale report cannot reuse an admitted request.

Pending admissions block ordinary installation startup, new tool binding and
backup even if interruption occurred before the maintenance barriers were written.
The transaction also places owned barriers in the original workspace and any
configured formal-work directory. An unconfigured empty worker directory remains
untouched; when tools are first selected, their owner and barrier are staged. Exact partial barriers can resume; unknown bytes, replaced
roots and unrelated staging material are preserved and refused. Existing tool
binding receipts remain readable. New business writes require the transaction to
finish or be explicitly aborted.

Admission reserves bounded real filesystem blocks for completion metadata. This
is not protection against unrelated consumers exhausting that filesystem. Resume
verifies the original source and candidate again; a later source change refuses
resume. Pre-switch abort preserves the later source change, records the abort
before clearing its own barriers, and never starts the service or changes runtime,
plugin, credentials or toolchain bindings. If admission itself was only partially
written, retain the original complete inspected report: abort uses it to reconcile
only an exact prefix, without relying on the source still matching that report.
After an abort has begun, admission cannot reverse it. Released receipts replay
without requiring the selected candidate runtime to remain available.

Historical upgrade records remain part of subsequent backup inventories and
upgrade snapshots. Only the active request's bounded control files are excluded
from its own source comparison; its exact protocol verifies those files separately.
The record budget is 128 requests, 1,024 control files and 64 MiB of aggregate
control metadata, with completion headroom checked before admission; nothing is
silently pruned. An aborted request ID cannot be reused for a new upgrade inspection.

This is an internal implementation stage, with no public admission command yet.
Admission alone does not create the sibling staging directory or activate a runtime.
The internal component-switch protocol below is a separate step. Its installed
restart and SIGKILL checks, ENOSPC recovery and full maintenance acceptance remain
evidence obligations. Tests that reconstruct
partial protocol files are synthetic interruption evidence, not actual crash or
disk-full acceptance. Product acceptance and release authority remain unchanged.


## Staging an admitted upgrade

The internal stage transaction retains a physically owned sibling directory with
`next/`, `pending/`, a committed timestamp and `prepared.json`. Its owner anchor
is stored beside the installation's admission, so an occupied foreign directory
cannot become a candidate. An admitted root interrupted before ownership commit
can be adopted only while empty and with an exact ownership-record prefix.
Missing or replaced anchored roots are refused; no replacement is silently created.

The `next/` image contains the merged private plugin, a versioned installation
with its complete runtime lineage, and, when tools are configured, the complete
prospective toolchain ledger. A first tool binding also stages its logical worker
owner and maintenance barrier. The new first-tool worker directory uses mode `0700`, so a read-only original
empty directory cannot prevent subsequent worker writes. The original empty
directory and its mode remain unchanged during staging. Existing configured
worker histories remain in their original location. An unconfigured empty directory
is preserved until the internal switch described below. Original runtime selection,
plugin files, credentials, business state, toolchain ledger and worker journals
remain unchanged during staging.

The binding and runtime transition use one durably committed timestamp. Retries
reuse it and preserve uncommitted timestamp attempts as inert evidence, bounded to
16 attempts. Payload writes use a separate namespace keyed by the relative path's
SHA-256 digest. A legitimate custom `*.pending` file cannot collide with protocol
files. Binary bytes, empty directories and private file/directory modes are
retained. Exact pending prefixes can continue; foreign bytes are preserved.

Before sealing, staging revalidates the original source and selected runtime and
tools. It verifies the candidate's complete contents and cross-checks runtime and
toolchain history through the ordinary installed validators. The prepared record
binds file bytes, modes and physical identities, including the committed timestamp
and stage directories. A sealed image cannot be silently repaired or rebuilt after
content drift or equal-byte inode replacement. Resume returns the same timestamp,
binding identity and prepared digest when the original image is unchanged.

The candidate image is bounded to 2,048 entries, depth 28, 2 MiB per file and 24 MiB
in total, in addition to the stricter plugin limits. Pending payloads must be exact
prefixes of the same bounded planned files. Stage metadata permits only the defined
layout. The activation protocol separately owns `previous/` and the installation-side
switch record; foreign or unrecognized top-level material blocks continuation.

Pre-switch abort retains the staged payloads and records the stage-owner digest in
its released receipt before ordinary owner use resumes. Historical replay validates
that retained receipt without requiring the external staged directory to remain
available. Staging evidence proves staging and pre-switch abort only; the internal
component-switch implementation below has separate verification obligations.
Staging evidence does not establish activation recovery, automatic start,
disk-full acceptance or product/release acceptance.


Installed development verification additionally kills an owned staging child with
`SIGKILL` after its durable stage anchor appears and before a prepared image exists,
then resumes the same request. This single real interruption does not establish
switch-phase crash recovery, ENOSPC behavior, Linux parity or formal maintenance
acceptance. Reconstructed partial payload/metadata cases remain separately labeled.

## Internal activation and forward recovery

The internal `activateInstallationUpgrade` entry requires an admitted, sealed stage
and its exact `expectedPreparedDigest`. It does not implicitly prepare or rebuild a candidate.
Before switching, it verifies the admission, stage owner, prepared image, original
owner roots and unchanged source snapshot. It reconstructs the prospective runtime
transition and toolchain ledger from the admitted original installation and ledger,
and checks them against the staged installation. The transition and binding use
the stage's committed `recordedAt`; activation does not invent a new completion
timestamp.

Before the first component rename, activation records
`ontology-upgrade-switch/v1` in the installation's request directory. The record
binds the request, admission, inspected report, stage owner and prepared digests,
the physical identity of the stage's `previous/` directory, and each selected
component's original and candidate physical identities. The selected components
are the plugin and installation metadata, the toolchain ledger when tools are
selected, and a new `formal-work` directory only for a first tool binding. Existing
configured worker directories and their histories are not switched.

Each component with an original permits exactly three arrangements:

| Arrangement | Installation location | Stage `previous/` | Stage `next/` |
| --- | --- | --- | --- |
| Ready | Original | Absent | Candidate |
| Original retained | Absent | Original | Candidate |
| Installed | Candidate | Original | Absent |

Components that had no original permit only the ready and installed arrangements,
with their `previous/` location always absent. For example, a first binding can
introduce a previously absent ledger or worker directory. An existing empty worker
directory is retained as the original, while the staged replacement uses mode
`0700`. Every location is checked against its bound physical identity, bytes and
canonical modes, subject only to the directory-mode transition below. Duplicate,
missing, replaced or foreign material is preserved and refused.
Individual renames advance these arrangements under the owner leases and durable
maintenance barriers. The component set is not presented as one atomic filesystem
rename.

On macOS, moving a read-only directory between parents may require owner-write on
that directory. Only after the switch record is fully durable and validated may
a selected component root directory temporarily use `canonicalMode | 0200`. The
directory must retain its bound device and inode; a pending switch write alone
does not permit this transition. Mode and directory changes are synchronized before
and after the rename. Resume recognizes only the canonical mode or this exact
temporary mode at the proven component location. The retained original and
installed candidate both regain their canonical modes, durably, before completion
is recorded. Child entries, existing configured worker directories and other roots
keep their original modes.

Once a switch record or its pending write exists, recovery is forward-only and
pre-switch abort is refused. Resume continues the same admitted request from its
proven arrangement; it does not silently roll back or overwrite an unexpected
location. Original components remain in `previous/`. Until completion is recorded,
each continuation verifies unchanged business data, credentials and other owner
history as well as the original and candidate component images. A changed source
cannot be accepted by merely retrying the request.

After all selected components are installed and verified, activation durably writes
`ontology-upgrade-completed/v1`. This receipt binds the admitted request and report,
prepared and stage-owner digests, switch digest, selected installation and runtime
identities, toolchain binding and transition digest. It records
`runtimeActivated: true`, `serviceStarted: false` and `authority: false`. The exact
completion reservation is released immediately before this write to make its
reserved space available. Durable completion precedes cleanup of the transaction's
exact remaining maintenance markers; cleanup also requires the reservation to be
absent. Only then is `ontology-upgrade-released/v2` written.

If cleanup is interrupted after completion, continuation validates the physical
owner and current installation identity, the bound completion envelope and each
remaining exact marker. It does not compare the old business or credential snapshot
again: completion has already established the new selection, and released owners
may have resumed writes during partial cleanup. Unknown markers remain a refusal;
their presence cannot be treated as successful cleanup.

Ordinary owner use remains blocked by pending switch/completion records or an
unreleased request. A completed release is recognized only from exactly the five
installation-side admission, stage, switch, completed and released records, with
no pending, reservation or aborted leftovers. Historical replay verifies their
digest and request bindings without requiring the external candidate runtime or
stage directory to remain available. It does not establish current runtime health
or the continuing availability of retained originals.

Retained systemd workers can have been launched by an earlier installed runtime.
For an already admitted unit, maintenance and recovery verify its exact original
configuration digest and InvocationID, including the original supervisor path,
Node executable and reference arguments. They do not substitute the calling CLI's
supervisor path, import or execute the historical supervisor, or infer a new launch
authorization from manager observations. Before a unit has an admitted record,
the supervisor path must still match the current runtime. Existing boot, resource,
process and cgroup checks remain required. An interrupted maintenance request
resumes its original request ID and inspected report digest.

The public activation CLI delegates to this contract and does not automatically
start the service. Installed development verification covers actual
restart with the selected runtime and binding, actual `SIGKILL` recovery, and
preservation of a read-only original worker directory during a first binding.
It also exercises exact partial-record recovery, overlapping-maintenance refusal,
changed evidence, terminal history and backup/restore materialization.
Reconstructed transitional-mode and interrupted-rename cases are labeled synthetic
and remain distinct from actual process restart and `SIGKILL` scenarios. Bounded
Linux ENOSPC and process-interruption checks use the development probe described
above; only its observed failure boundaries count. Exhaustive fault coverage,
other filesystems/platforms, actual Codex Host journeys and full MAINT-02 acceptance
remain unproven. Code implementation and development results do not approve
product acceptance or release.
