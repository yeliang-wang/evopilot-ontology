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

The caller must inspect a fresh plan after editing any input. Durable upgrade
admission, immutable runtime/toolchain lineage, activation, interruption and
storage-failure recovery remain separate implementation obligations. These
preparation checks do not establish MAINT-02, actual Codex Host behavior or v0.9
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
only constructs a prospective record; there is still no fault-safe product command
that atomically activates a runtime, toolchain and merged plugin together. Tests
explicitly construct versioned metadata fixtures under the owner leases, then
exercise actual installed startup, formal Java/Python validation, historical
receipt readback and lost/current-owner restoration. Such fixtures do not replace
actual upgrade admission, interrupted activation, disk-full recovery, Codex Host
journeys or MAINT-02 acceptance.
