# Ontology CLI

`evopilot-next-ontology` is the independent package bin for `src/cli.mjs` (Node 24.14.0). A source checkout can use `node src/cli.mjs` or the executable script directly. Installed package-manager symlinks resolve to the same entry. Importing `main` does not initialize storage or run a request.

```text
evopilot-next-ontology capabilities
evopilot-next-ontology help
evopilot-next-ontology version
evopilot-next-ontology request --workspace <canonicalAbsoluteRoot> --workspace-id <slug> [--request-file <absoluteJSONpath>]
```

`--help` and `--version` are aliases. Discovery commands need no workspace and perform no initialization. Requests require both workspace flags; there is no environment, current-directory, home, credential or configuration fallback. Workspace identity and symlink checks belong to the existing owned service. Use a new workspace with an existing canonical parent or an existing service-owned workspace with its exact id.

First use from the source checkout (replace the workspace placeholder with an explicit canonical absolute path):

```sh
ONTOLOGY_WORKSPACE=/absolute/canonical/new-ontology-workspace
node src/cli.mjs version
node src/cli.mjs capabilities
node --input-type=module -e 'import fs from "node:fs"; const model = JSON.parse(fs.readFileSync("examples/synthetic-models.json", "utf8")).assets[0]; console.log(JSON.stringify({operation:"asset.put",scope:{visibility:"public",projectId:"demo"},input:{model},requestId:"first-model",expectedRevision:0}));' |
  node src/cli.mjs request --workspace "$ONTOLOGY_WORKSPACE" --workspace-id demo
printf '%s\n' '{"operation":"workspace.inspect","scope":{"visibility":"public","projectId":"demo"},"input":{}}' |
  node src/cli.mjs request --workspace "$ONTOLOGY_WORKSPACE" --workspace-id demo
printf '%s\n' '{"operation":"asset.list","scope":{"visibility":"public","projectId":"demo"},"input":{}}' |
  node src/cli.mjs request --workspace "$ONTOLOGY_WORKSPACE" --workspace-id demo
printf '%s\n' '{"operation":"receipt.inspect","scope":{"visibility":"public","projectId":"demo"},"input":{"requestId":"first-model"}}' |
  node src/cli.mjs request --workspace "$ONTOLOGY_WORKSPACE" --workspace-id demo
```

The first request stores `examples/synthetic-models.json`'s actual `assets[0]` as a native model. The following commands run in separate processes and read the same durable state. The receipt has revision 1 for a fresh workspace. `asset.inspect` accepts `{id,version}` from `asset.list`. Review, decision and delivery remain absent. Follow the [native modeling/instance APIs](../specifications/v1/README.md) and [service lifecycle](service.md) for explicit review and separately evidenced decisions. The CLI never adds approval or publication operations.

For file input, supply a JSON request in an explicit absolute regular file:

```sh
node src/cli.mjs request --workspace "$ONTOLOGY_WORKSPACE" --workspace-id demo --request-file /absolute/request.json
```

File input replaces stdin. The final file must be regular and not a symlink; device/inode are checked across open, with no-follow and nonblocking flags. Directories, missing files and special files fail safely. Input is one UTF-8 JSON value, bounded to 524288 bytes, 20000 nodes and depth 48. Duplicate/unknown flags, extra fields, unknown operations, invalid scope and malformed envelopes fail before initialization. Native model and operation semantics continue to be validated by the service.

Every request is exactly `{operation,scope,input}` with scope `{visibility:"public"|"private",projectId:slug}`. Mutations also require `requestId:slug` and `expectedRevision:nonnegativeInteger`. A slug is 1–64 lowercase alphanumeric/hyphen characters beginning alphanumeric. Read `workspace.inspect` explicitly to choose a revision. The CLI submits the supplied request once; it never refreshes CAS or retries. Exact duplicate intent under the same scoped request id returns the original receipt; changed intent fails `REQUEST_CONFLICT`, and a new request with stale CAS fails `REVISION_CONFLICT`. Private reads and receipts stay scoped. Retain unknown outcomes and inspect existing evidence without redispatch.

`capabilities` lists the finite supported operations and limits. All operations use `service.execute`, except `classification.start` and `classification.reanalyze`, which await `service.classify`. See [classification workflow](classification-service.md), [Catalog workflow](catalog-service.md), [source import/derivation](legacy-migration.md) and [historical read-only queries/producers](legacy-api.md). These APIs retain their existing envelopes and authority boundaries.

Classification needs trusted code-injected `classificationAdvisor`, `classificationModel` and synchronous `resolveClassificationSource`; Catalog foreign material needs `resolveLegacyHarness`. Embedding applications supply them through `createOntologyService(options, trustedProviders)` from `@evopilot-next/ontology/service`. The standalone CLI accepts no JSON provider configuration and uses no global resolver. It reports `CLASSIFICATION_PROVIDER_UNAVAILABLE`, `CLASSIFICATION_SOURCE_UNAVAILABLE` or Catalog `PROVIDER_REQUIRED` when required providers are absent; discovery and stored read operations remain available subject to their contracts. No source or shell execution is introduced.

Source resolver results must be descriptor-safe bounded JSON with exact source/scope/workspace bindings. A genuine Promise is rejected with `CLASSIFICATION_SOURCE_ASYNC`; its rejection is consumed via `Promise.prototype.then.call` without accessing a returned `then` getter. No attempt is admitted or advisor dispatched. Accessor-bearing returned objects fail before getter access. This requirement applies to embedded service providers as well as the CLI's documented service boundary.

Classification admission receipts remain immutable PENDING evidence; inspect/resume reads the persisted outcome. Explicit reanalysis of a known completed attempt appends history. UNKNOWN attempts are never replayed. `continue_to_harness` requires the exact synthetic or human decision evidence described in the classification contract and only records a handoff; it starts no Harness execution.

Stdout contains one JSON envelope: success `{ok:true,product:"ontology",version,result,authority:false}`, failure `{ok:false,error:{code,message},authority:false}`. Exit codes are 0 success, 1 service failure, 2 invalid arguments/input. Errors expose allowlisted codes and static messages, never raw exception messages, input excerpts, paths or stacks. Unknown input errors become `INVALID_REQUEST`; unknown execution errors become `STATE_ERROR`. `INPUT_FILE` covers file access failures and `LIMIT` covers bounds. Nested successful results preserve the service's documented data, including explicitly stored evidence. Node platform warnings may appear on stderr.

M2 source implementation does not establish Host or production readiness. M3 MCP/Expert integration, actual provider composition and full Host evidence remain pending. The older workflow documents' CLI-pending statements describe their earlier source baseline; this guide records the implemented transport.
