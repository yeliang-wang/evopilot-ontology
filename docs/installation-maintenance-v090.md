# Independent installation maintenance

This is P4 development behavior, not a release, actual Host acceptance or a
completed MAINT-01 result. Consistent stopped-owner **backup and byte verification**
and protected restore candidate materialization are implemented. Restore activation,
upgrade, customization merge, credential reconciliation,
post-restore unknown-request protection and selected test-asset reset remain
required work. A verified backup alone does not establish restore capability.

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
