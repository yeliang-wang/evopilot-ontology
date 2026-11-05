# Selected asset reset

Asset reset is an explicit local operator action. Stop the selected installation first. Ordinary HTTP/MCP modeling tools cannot reset a workspace, and installation does not clear assets.

Create a JSON array of exact project IDs in a private file. Inspect the complete selected inventory:

```sh
evopilot-ontology asset-reset-inspect --installation /absolute/installation --projects /absolute/project-ids.json --request-id reset-001 --json
```

Review `result.report` and `result.reportDigest`. Save the report object itself, without the CLI response envelope, to a private file. Apply that exact report:

```sh
evopilot-ontology asset-reset-apply --installation /absolute/installation --report /absolute/reset-report.json --expected-report sha256:INSPECTED_DIGEST --json
```

The selection clears all native models, source snapshots, intentions, expectations, views, formal tasks, reviews, deliveries, selectors and payload-bearing request receipts for those projects. Project identity, credentials, installation settings, other projects and the append-only audit remain. Project revisions advance. Metadata-only deletion records retain the old content identities and request digests: old references return `ASSET_PURGED`; original request IDs return `REQUEST_PURGED` and cannot dispatch another write. Rebuilding is a separate deliberate action with new content identities and new request IDs.

Managed local copies are also inventoried beneath `asset-exports/<hex-project-id>/` and `asset-cache/<hex-project-id>/` in the workspace. The directory component is the lowercase hexadecimal encoding of the UTF-8 project ID. Only the selected project directories are cleared. Other files, including original requirement files, remain. Links, unsafe permissions, changed content and unknown state layouts stop the operation.

An installation's external backups, legacy asset stores, consumer references and exports saved elsewhere require their own explicit inventory and owner-scoped maintenance. This command does not discover or delete arbitrary external files. The release cutover's P6 inventory must account for those copies before claiming the selected historical test assets are cleared. Software releases, source backups, credentials and independent audit evidence remain protected.

Finish or reconcile outstanding tasks and run worker maintenance for their original resources before reset. An active owner or another writer prevents admission. Once admitted, the durable reset journal blocks workspace use until the exact operation completes. If interrupted, retain the original report and repeat the same apply command; do not submit a new reset identity. A committed database deletion is recognized through its original audit receipt and is not performed twice. Remaining copies are checked and removed, database contents are compacted, and selected absence plus non-target preservation are verified before completion. No temporary payload backup is created by reset.

A completed replay returns the original receipt with `verification: NOT_RUN`; it does not claim a fresh inspection of later business changes. Cold backups include the reset records. Restoring current state across differing reset histories is refused with `RESTORE_RESET_CONFLICT`, so an older snapshot cannot silently resurrect cleared identities. Reset is logical deletion of the selected managed records and copies; it is not storage-device secure erasure.

The v0.9 release and daily test-asset purge still require their separate candidate-bound acceptance and execution decisions. These development commands do not confer semantic approval or release authority.
