# EvoPilot Ontology 0.1.0

New users: start with [concepts and asset workflows](docs/asset-workflows.md#concepts-and-format-choices). Developers: use the [CLI](docs/cli.md) and [service contract](docs/service.md). Retained capability users: see [Legacy API](docs/legacy-api.md), [Catalog service](docs/catalog-service.md) and [Classification service](docs/classification-service.md). The [documentation index](docs/README.md) routes the packaged guides.

Ontology owns semantic modeling and instance validation. Public root APIs are `inspectArtifactReference`, `validateOntology`, `validateInstances`, `buildDelivery` and `verifyDelivery`. See the [native v1 specification and API guide](specifications/v1/README.md), [schema](specifications/v1/asset.schema.json) and [synthetic examples](examples/synthetic-models.json).

Additional public subpaths:

- `@evopilot-next/ontology/compat`: historical calculation, classification and catalog namespaces. See [core](docs/legacy-core.md), [classification](docs/legacy-classification.md), [catalog](docs/legacy-catalog.md) and the [export inventory](src/compat/index.mjs). Some catalog APIs use explicit caller-selected storage; there is no implicit workspace or running service.
- `@evopilot-next/ontology/migration`: `inspectLegacySource` and `deriveLegacyModel`, an explicit derivation bridge preserving original semantics and unresolved gaps. See [migration guide](docs/legacy-migration.md).
- `@evopilot-next/ontology/sources`: `listPublicSources` and `readPublicSource` for four preserved public ontology sources. See [source guide](docs/public-assets.md) and [provenance](provenance/public-assets.json).
- `@evopilot-next/ontology/service`: `createOntologyService({workspaceRoot,workspaceId}, trustedProviders)` provides the durable local asset lifecycle. Explicit initialization, scoped requests, SQLite transactions and separate human decisions are described in the [service guide](docs/service.md).

Historical wire identities remain compatibility data; native v1 validation does not automatically convert them. These libraries do not implement full OWL/RDF/SHACL/PROV or complete operational migration.

The service also implements seven finite retained producers and an owned proposal-create helper through separate preparation and local operator decisions. See the [producer API](docs/legacy-api.md#finite-retained-producers). Historical approvals are never imported as current authority; no Runtime/Harness software release or activation occurs. The operator-verified independent technical baseline is 201 Ontology tests PASS plus check/build. Parent verification reports 394 tests PASS, zero skipped, using actual Runtime, Harness and Ontology products for native v1 core composition. This does not establish that every advanced workflow is ready by default. Historical [migration provenance](provenance/migration-current.json) remains an audit record.

The root entry also exports `PRODUCT`, `VERSION` and `capabilities()`. Discovery describes `M2_OWNED_SERVICE`: local business operations and persistence are implemented through the separate service export; Host and production readiness remain false. Source import/derivation and [28 historical preview queries](docs/legacy-api.md), ten scoped [Catalog routes](docs/catalog-service.md), seven persistent [classification operations](docs/classification-service.md) and the [standalone CLI](docs/cli.md) are implemented. Classification and foreign Catalog material require explicit trusted application callbacks; the CLI supplies none and returns unavailable errors when they are needed. The new Preview MCP SDK `request(owner, envelope)` routes to the actual owned service: classification start/reanalyze await `classify`, and other operations use synchronous `execute`. Activation is explicit per stdio session and off by default. Parent unified Expert guidance is implemented. Actual Desktop/Host full-journey acceptance, full migration, E03/E10 and source-ledger closure status must be obtained from a separate local acceptance report bound to the exact candidate; without that report, no acceptance can be claimed. M0 feasibility and source tests cannot substitute for actual Host evidence. See [integration boundaries](docs/service.md#preview-integration-and-provider-boundaries).

Neither the default Preview daemon nor the standalone CLI configures `resolveClassificationSource`, `classificationAdvisor`, `classificationModel` or `resolveLegacyHarness`. Explicit application callbacks and model binding are required. Validated factory forwarding of those keys is not a provider implementation; missing providers fail explicitly, with no invented LLM route or old Runtime profile/credential inheritance. The separate exact-candidate-bound local acceptance report determines actual candidate status, including full migration, E03/E10 and source-ledger closure, independently of current SDK capabilities and standalone discovery flags. Reports convey no acceptance, execution or publication authority.

For first use from this checkout, choose a fresh canonical absolute workspace path whose parent exists, then store a synthetic native model and read its durable receipt:

```sh
ONTOLOGY_WORKSPACE=/absolute/canonical/new-ontology-workspace
node src/cli.mjs capabilities
node --input-type=module -e 'import fs from "node:fs"; const model = JSON.parse(fs.readFileSync("examples/synthetic-models.json", "utf8")).assets[0]; console.log(JSON.stringify({operation:"asset.put",scope:{visibility:"public",projectId:"demo"},input:{model},requestId:"first-model",expectedRevision:0}));' |
  node src/cli.mjs request --workspace "$ONTOLOGY_WORKSPACE" --workspace-id demo
printf '%s\n' '{"operation":"receipt.inspect","scope":{"visibility":"public","projectId":"demo"},"input":{"requestId":"first-model"}}' |
  node src/cli.mjs request --workspace "$ONTOLOGY_WORKSPACE" --workspace-id demo
```

The installed bin is `evopilot-next-ontology`. See the [CLI guide](docs/cli.md) for inspection, file input, error codes and modeling/classification workflows. This example creates a draft without review, decision or publication.

Use Node 24.14.0. In this independent source checkout, install from its own committed lock with `npm ci --ignore-scripts --no-audit --no-fund`, then:

```sh
npm run check
npm run build
npm test
```

Build verifies owned ESM sources and pinned vendor bytes; it needs no parent generator or sibling source. Only the parent canonical build regenerates vendor bytes. The same commands work in an unrelated standalone source copy. Installed tarballs omit development scripts/tests; these commands apply to source checkouts. Earlier specification guides describing a parent-first build refer to vendor regeneration, not a prerequisite for validating an existing pinned copy.

Read the [current roadmap](docs/roadmap.md). Final remote URL metadata and GitHub execution remain pending authorization. Local artifact rehearsal is technical evidence only. Licenses and provenance retain their existing ownership.
