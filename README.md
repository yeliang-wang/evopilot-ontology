# EvoPilot Ontology · v0.2.0 Preview

[Quickstart](#quickstart) · [Documentation](docs/README.md) · [CLI](docs/cli.md) · [Contribute](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

Ontology owns domain concepts, relationships, constraints, source grounding and immutable semantic deliveries. It gives public and private projects a common way to describe meaning, retain its sources and expose unanswered business questions.

The [EvoPilot parent distribution](https://github.com/yeliang-wang/evopilot) composes independent repositories: [Ontology](https://github.com/yeliang-wang/evopilot-ontology) for semantics, [Harness](https://github.com/yeliang-wang/evopilot-harness) for QA and evidence, and [Runtime](https://github.com/yeliang-wang/evopilot-runtime) for projects, goals and execution. Runtime composition supplies deterministic ontology-instance and Harness-evidence evaluation, not arbitrary code generation.

| Capability | Entry point |
| --- | --- |
| Model concepts, properties, relations and constraints | [Native v1 specification](specifications/v1/README.md) |
| Validate instances and build or verify deterministic deliveries | `@evopilot-next/ontology` |
| Store scoped drafts, reviews, decisions and immutable deliveries | [Service API](docs/service.md) |
| Submit workspace requests and inspect receipts | [CLI](docs/cli.md) |
| Inspect structured historical assets and derive native drafts | [Migration](docs/legacy-migration.md), `@evopilot-next/ontology/migration` |
| Read bundled public sources | [Public assets](docs/public-assets.md), `@evopilot-next/ontology/sources` |
| Use retained queries, producers, Catalog and classification | [Compatibility API](docs/legacy-api.md), `@evopilot-next/ontology/compat` |

## Three levels of semantic assets

1. **Common native model.** Frozen `specifications/v1` is the minimal common contract for all public and private projects. Start with the [schema](specifications/v1/asset.schema.json), [template](specifications/v1/templates/model.json) and [synthetic examples](examples/synthetic-models.json). Validation checks references, source mappings and constraints; required unresolved issues keep a draft PENDING and block delivery.
2. **Project meaning and its evidence.** Forward requirements and reverse modeling from authorized sources produce the same native contract. The Host interprets explicitly authorized repository sources and retains locators, revisions, digests, observed/inferred mappings and unresolved business questions. Source evidence alone never confirms business meaning. `legacy.import` and `legacy.derive` accept structured JSON/YAML assets; they do not parse arbitrary repositories or Java source.
3. **Additive project extensions.** Namespaced extensions add project-specific data without overriding base fields. Unknown optional extensions remain unevaluated; unknown required extensions fail validation. Visibility and exact dependency pins continue to apply.

Historical Pack, Proposal, Snapshot, grounding, projection, reasoning, Catalog and classification capabilities form a separate compatibility layer. They retain original schema IDs, wire formats and lifecycle vocabulary. They are not automatically equivalent to a native v1 model or delivery. Explicit derivation preserves coverage gaps and requires a fresh native lifecycle.

## Quickstart

Ordinary Codex use starts with the [parent distribution and unified Expert](https://github.com/yeliang-wang/evopilot/blob/main/README.md). Follow the parent [four user journeys](https://github.com/yeliang-wang/evopilot/blob/main/docs/first-journey.md) for composed workflows. The standalone Ontology service can author native assets without an external LLM.

For a source checkout, use **Node 24.14.0** and the committed dependency lock:

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
node dist/cli.js help
node dist/cli.js version
```

Owned source uses strict **TypeScript 5.9.3**, compiled JavaScript and declarations. Historical compatibility JavaScript is retained behind a typed boundary. Build uses the checked-in pinned vendor contract without a sibling checkout. These commands apply to source checkouts; release packages include `dist` exports and the CLI, so consumers need no compiler.

Choose a new canonical absolute workspace path outside the checkout, with an existing parent, to create a synthetic draft:

```sh
ONTOLOGY_WORKSPACE=/absolute/canonical/new-ontology-workspace
node --input-type=module -e 'import fs from "node:fs"; const model = JSON.parse(fs.readFileSync("examples/synthetic-models.json", "utf8")).assets[0]; console.log(JSON.stringify({operation:"asset.put",scope:{visibility:"public",projectId:"demo"},input:{model},requestId:"first-model",expectedRevision:0}));' |
  node dist/cli.js request --workspace "$ONTOLOGY_WORKSPACE" --workspace-id demo
printf '%s\n' '{"operation":"receipt.inspect","scope":{"visibility":"public","projectId":"demo"},"input":{"requestId":"first-model"}}' |
  node dist/cli.js request --workspace "$ONTOLOGY_WORKSPACE" --workspace-id demo
```

This stores a draft and reads its durable receipt. Review, human decision and local asset publication are distinct requests. See [CLI usage](docs/cli.md) for exact envelopes, revision conflicts and uncertain outcomes.

## Install the Preview package

Download the exact [v0.2.0 Preview release](https://github.com/yeliang-wang/evopilot-ontology/releases/tag/v0.2.0). The published [v0.1.0 release](https://github.com/yeliang-wang/evopilot-ontology/releases/tag/v0.1.0) remains historical. See [changes](CHANGELOG.md) and the parent [distribution and checksum guide](https://github.com/yeliang-wang/evopilot/blob/main/docs/github-release.md).

Place all four release assets in one new directory before checking checksums:

- `evopilot-next-ontology-0.2.0.tgz`
- `ontology-dependency-lock.json` (the Ontology `dependency-lock.json` asset uses this owner-prefixed release name)
- `source-revision.txt`
- `SHA256SUMS`

```sh
shasum -a 256 -c SHA256SUMS
cat source-revision.txt
mkdir ontology-0.2.0
tar -xzf evopilot-next-ontology-0.2.0.tgz -C ontology-0.2.0
cp ontology-dependency-lock.json ontology-0.2.0/package/package-lock.json
cd ontology-0.2.0/package
npm ci --omit=dev --ignore-scripts
node dist/cli.js help
node dist/cli.js version
```

Stop if checksum verification fails; compare `source-revision.txt` with the release's exact source commit. Distribution uses release tarballs, not a public npm registry. The installed bin is `evopilot-next-ontology`; SDK subpaths resolve compiled JavaScript and declarations.

## Provider boundaries

Classification requires SDK-injected trusted `resolveClassificationSource`, `classificationAdvisor` and `classificationModel: {providerId, modelId, revision, timeoutMs}`. Foreign Catalog material requires trusted `resolveLegacyHarness`. These are application callbacks and explicit bindings, not public JSON configuration or inherited Host credentials. The standalone CLI and default Preview daemon provide none; missing required providers fail explicitly. See [classification](docs/classification-service.md), [Catalog](docs/catalog-service.md) and [integration](docs/service.md#preview-integration-and-provider-boundaries).

## Documentation and contributions

The [documentation index](docs/README.md) routes concepts, specification, CLI/API and retained capabilities. Read [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md) and the [roadmap](docs/roadmap.md). This edition is Preview. Technical evidence does not grant acceptance or release authority.
