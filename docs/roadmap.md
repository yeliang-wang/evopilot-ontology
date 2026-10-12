# Ontology implementation status and roadmap

Version 0.1.0 implements the capabilities below within the existing approved scope. This status does not change parent governance or authorize additional goals.

| Implemented capability | Current contract |
| --- | --- |
| Native v1 modeling, instance validation, deterministic delivery and exact references | [Specification](../specifications/v1/README.md) |
| Scoped durable drafts, reviews, separate decisions, publication and receipts | [Owned service](service.md) |
| Four preserved public sources, inline import, quarantine and explicit derivation | [Public sources](public-assets.md), [migration](legacy-migration.md) |
| 28 retained queries, seven producers and proposal-create helper, with plan controls | [Legacy API](legacy-api.md) |
| Ten Catalog routes plus preparation/decision/inspection controls; rollback, cumulative revocation and reconciliation | [Catalog service](catalog-service.md) |
| Seven persistent classification operations with bounded async analysis | [Classification service](classification-service.md) |
| Independent CLI and explicit workspace requests | [CLI](cli.md) |
| Parent Preview MCP SDK routing to owned services, validated trusted-provider forwarding and unified Expert guidance | [Integration boundaries](service.md#preview-integration-and-provider-boundaries) |

The [independent technical baseline](../README.md) covers Ontology check/build and tests, plus parent native v1 core composition with the actual three products. Local verification is technical evidence only. Historical extraction counts, licenses, source commits and audit evidence remain in [provenance](../provenance/migration-current.json); they are not current user prerequisites.

## Current limitations

The default Preview daemon and standalone CLI configure no classification source resolver, advisor, model binding or external legacy Harness Catalog resolver. Applications must supply those trusted providers explicitly. Factory forwarding does not implement them. Neither an old Runtime profile nor stored credentials are inherited automatically.

Activation is explicit per stdio session and off by default. Parent unified Expert guidance and native v1 core composition are implemented. Actual Desktop/Host full-journey acceptance, full migration, E03/E10 and source-ledger closure status must be obtained from a separate local acceptance report bound to the exact candidate; without that report, no acceptance can be claimed. M0 feasibility and source tests cannot substitute for actual Host evidence or establish retention of every historical Host renderer or Harness algorithm.

Native v1 remains a bounded semantic model, not a full OWL/RDF/SHACL/PROV engine. Structured legacy import/derivation is not a source-code parser. Required gaps keep a model PENDING; reviews and human decisions remain separate. Provider uncertainty, storage recovery and scope limits remain those of the [service](service.md), [classification](classification-service.md) and [Catalog](catalog-service.md) contracts.

The separate local acceptance report determines actual candidate status, including full migration and final E03/E10 closure against the exact candidate snapshot, actual Desktop/Host evidence and source ledger. That status is separate from current SDK capabilities and standalone discovery flags. Stable 1.0 readiness and production acceptance are not established by current checks.

## Existing 0.1.x real-project target

Within the existing plan, apply the [forward and reverse workflows](asset-workflows.md) to an explicitly authorized real project, retaining actual source pins, unresolved semantics, review results and separate human decisions. Complete applicable provider-backed workflows and the actual Desktop canonical journey against the exact candidate, then reconcile source-ledger and E03/E10 evidence. This is the existing real-project target, not a new scope or version schedule. Software publication remains a separately authorized stage.
