# ontology local roadmap

Version 0.1.0 is under construction within the approved local v0.1 scope. This document records implementation status; it does not alter the parent governance roadmap, approve additional work or assert M1 completion.

Implemented: native v1 model and instance validation, deterministic deliveries, exact artifact references, historical calculation/classification/catalog compatibility libraries, explicit legacy model derivation, and read-only access to four preserved public ontology sources.

Independent source check/build commands validate this product without a parent generator. Tests and local packed-artifact rehearsal are technical checks, not product acceptance. Retained legacy libraries do not imply completed operational migration.

Implemented in the owned service: the 35 earlier migrated routes and ten `semantic.catalog.*` routes, with scoped producer decisions, persistent Catalog publication, rollback, cumulative revocation and receipt reconciliation. Catalog control helpers are additional to those ten routes. See [Catalog contracts and verification notes](catalog-service.md).

Operator baseline for retained R31: independent check/build passed, 183 of 184 tests passed, including the complete public Catalog scenario. The remaining getter regression is source-repaired; new focused Catalog cases and the unchanged original regression await an operator filesystem/full-suite rerun. Local source check, two filesystem-free tests and producer/Catalog calculation diagnostics passed; sandbox temporary-directory restrictions blocked service initialization in the filesystem tests. R31's uncertain receipt and operator-cancelled old binding remain unchanged; no request was replayed.

Pending within the existing plan: seven persistent classification operations (start, inspect, resume, reanalyze, list, continue, close), CLI/MCP transport, Expert integration, actual trusted Harness provider wiring, workspace integration and applicable operational/E01–E19 evidence. GitHub publication is a later separately authorized stage. Stable 1.0, production readiness and full acceptance are not claimed.

See the [product entry and API links](../README.md).

