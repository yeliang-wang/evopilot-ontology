# EvoPilot Ontology 0.1.0

Ontology owns semantic modeling and instance validation. Public root APIs are `inspectArtifactReference`, `validateOntology`, `validateInstances`, `buildDelivery` and `verifyDelivery`. See the [native v1 specification and API guide](specifications/v1/README.md), [schema](specifications/v1/asset.schema.json) and [synthetic examples](examples/synthetic-models.json).

Additional public subpaths:

- `@evopilot-next/ontology/compat`: historical calculation, classification and catalog namespaces. See [core](docs/legacy-core.md), [classification](docs/legacy-classification.md), [catalog](docs/legacy-catalog.md) and the [export inventory](src/compat/index.mjs). Some catalog APIs use explicit caller-selected storage; there is no implicit workspace or running service.
- `@evopilot-next/ontology/migration`: `inspectLegacySource` and `deriveLegacyModel`, an explicit derivation bridge preserving original semantics and unresolved gaps. See [migration guide](docs/legacy-migration.md).
- `@evopilot-next/ontology/sources`: `listPublicSources` and `readPublicSource` for four preserved public ontology sources. See [source guide](docs/public-assets.md) and [provenance](provenance/public-assets.json).
- `@evopilot-next/ontology/service`: `createOntologyService({workspaceRoot,workspaceId})` provides the first M2 durable local asset lifecycle. Explicit initialization, scoped requests, SQLite transactions and separate human decisions are described in the [service guide](docs/service.md).

Historical wire identities remain compatibility data; native v1 validation does not automatically convert them. These libraries do not implement full OWL/RDF/SHACL/PROV or complete operational migration.

The service also implements seven finite retained producers and an owned proposal-create helper through separate preparation and local operator decisions. See the [producer API](docs/legacy-api.md#finite-retained-producers). Historical approvals are never imported as current authority; no Runtime/Harness software release or activation occurs. Filesystem producer tests await operator execution.

All root APIs also expose `PRODUCT`, `VERSION` and `capabilities()`. Existing root readiness remains false and reports convey no acceptance, execution or publication authority. The separate service implements only the first M2 local lifecycle slice; source import/derivation and [28 historical preview queries](docs/legacy-api.md) are implemented. Ten Catalog operations, seven persistent classification operations, CLI/MCP and unified Expert/plugin delivery remain pending. This source is not stable 1.0 or production-ready, and does not establish M1 or full acceptance.

Use Node 24.14.0. In this independent source checkout, install from its own committed lock with `npm ci --ignore-scripts --no-audit --no-fund`, then:

```sh
npm run check
npm run build
npm test
```

Build verifies owned ESM sources and pinned vendor bytes; it needs no parent generator or sibling source. Only the parent canonical build regenerates vendor bytes. The same commands work in an unrelated standalone source copy. Installed tarballs omit development scripts/tests; these commands apply to source checkouts. Earlier specification guides describing a parent-first build refer to vendor regeneration, not a prerequisite for validating an existing pinned copy.

Read the [current roadmap](docs/roadmap.md). Final remote URL metadata and GitHub execution remain pending authorization. Local artifact rehearsal is technical evidence only. Licenses and provenance retain their existing ownership.
