# Independent installation maintenance

This is P4 development behavior, not a release, actual Host acceptance or a
completed MAINT-01 result. Consistent stopped-owner **backup and byte verification**
are implemented. Restore, upgrade, customization merge, credential reconciliation,
post-restore unknown-request protection and selected test-asset reset remain
required work. A verified backup alone does not establish restore capability.

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
apply verifies that same manifest and completes the original receipt. No source
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
operation. A durable manifest must be finalized through apply instead of aborted.
An aborted ID cannot be reused; a subsequent backup needs a new request ID and
absent destination. Foreign or malformed owner evidence remains an error, not an
authorization to erase it. No automatic recursive cleanup is included.

## Bounds and remaining recovery requirements

Each backup admits at most 10,000 file/directory entries, depth 16, 64 MiB per
source file, 2 GiB logical source bytes, and an 8 MiB manifest envelope. Source
inspection is bounded to 4,096 formal tasks and 17 journals of at most 4,096
attempts each. The installation retains at most 128 backup requests. Capacity
errors preserve existing material; unlimited retention/offload is not claimed.
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
