# Ontology documentation

Ontology 0.1.0 has a native v1 lifecycle and separately retained compatibility capabilities.

| Start here | Guide |
| --- | --- |
| New users: concepts, forward requirements or reverse source evidence | [Concepts and asset workflows](asset-workflows.md#concepts-and-format-choices) |
| Developers: standalone commands and request examples | [CLI](cli.md) |
| Developers: owned storage, scope, decisions and API inputs | [Service](service.md) |
| Native model authors | [v1 specification](../specifications/v1/README.md), [schema](../specifications/v1/asset.schema.json), [synthetic examples](../examples/synthetic-models.json) |
| Retained queries, Packs and producers | [Legacy API](legacy-api.md), [core library](legacy-core.md) |
| Retained Catalog users | [Catalog service](catalog-service.md), [Catalog library](legacy-catalog.md) |
| Retained classification users | [Classification service](classification-service.md), [classification library](legacy-classification.md) |
| Source import and derivation | [Public sources](public-assets.md), [migration](legacy-migration.md) |
| Current status and historical evidence | [Roadmap](roadmap.md), [historical migration provenance](../provenance/migration-current.json) |

The package includes this docs directory and its linked specifications, examples, source and provenance. Native v1 delivery and legacy Catalog are separate formats; conversion is explicit. For ordinary source reverse modeling, author native v1 evidence and use `asset.put`; the legacy bridge accepts structured historical assets, not arbitrary source code.

The owned service, CLI, parent Preview MCP routing and unified Expert guidance are implemented. See [integration and provider prerequisites](service.md#preview-integration-and-provider-boundaries) and the [independent technical baseline](../README.md). Actual Desktop/Host full-journey acceptance, full migration, E03/E10 and source-ledger closure status must be obtained from a separate local acceptance report bound to the exact candidate; without that report, no acceptance can be claimed. Documentation, discovery and test results grant no acceptance or release authority.
