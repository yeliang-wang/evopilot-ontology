# ontology local roadmap

Version 0.1.0 is under construction within the approved local v0.1 scope. This document records implementation status; it does not alter the parent governance roadmap, approve additional work or assert M1 completion.

Implemented: native v1 model and instance validation, deterministic deliveries, exact artifact references, historical calculation/classification/catalog compatibility libraries, explicit legacy model derivation, and read-only access to four preserved public ontology sources.

Independent source check/build commands validate this product without a parent generator. Tests and local packed-artifact rehearsal are technical checks, not product acceptance. Retained legacy libraries do not imply completed operational migration.

Implemented in the owned service: the 35 earlier migrated routes and ten `semantic.catalog.*` routes, with scoped producer decisions, persistent Catalog publication, rollback, cumulative revocation and receipt reconciliation. Catalog control helpers are additional to those ten routes. See [Catalog contracts and verification notes](catalog-service.md).

Operator baseline for retained R31: independent check/build passed, 183 of 184 tests passed, including the complete public Catalog scenario. The remaining getter regression is source-repaired; new focused Catalog cases and the unchanged original regression await an operator filesystem/full-suite rerun. Local source check, two filesystem-free tests and producer/Catalog calculation diagnostics passed; sandbox temporary-directory restrictions blocked service initialization in the filesystem tests. R31's uncertain receipt and operator-cancelled old binding remain unchanged; no request was replayed.

The seven persistent classification operations are implemented under Ontology ownership, using the owned engine, durable invocation claims and scoped evidence. See [Classification contracts](classification-service.md). The six retained tests are preserved; the handoff helper now converts underscores in its default request id to hyphens without relaxing product slugs. Source resolvers reject real Promises with `CLASSIFICATION_SOURCE_ASYNC` while consuming rejection, and reject getter objects before access. Added regressions cover no state/dispatch on rejection, successful append-only reanalysis and corrupt retained blobs.

The independent `evopilot-next-ontology` [CLI](cli.md) is implemented with pure discovery, bounded stdin/explicit file requests, closed validation before initialization, unchanged service operations, safe error envelopes and no automatic CAS refresh or retry. Package discovery reports `M2_OWNED_SERVICE` and describes the separate service factory/methods without initializing I/O. Root exports, public model/provider slug contracts and normative v1 wire/schema/model fixtures remain unchanged.

Local source check (also used by build) and frozen vendor verification passed. The focused reference/classification/CLI run completed 19 tests: 10 passed and 9 failed at temporary-directory creation with sandbox `EPERM`, before service initialization. The filesystem-free Promise/getter regression, spawned CLI discovery/input-limit checks and all reference tests passed. Persistence, unchanged handoff/drift assertions, successful reanalysis, corruption and installed-symlink entry scenarios await the operator's filesystem run. Run `node --test tests/e2e/classification-service.test.mjs tests/e2e/cli.test.mjs tests/e2e/reference.test.mjs`, then `npm test` outside this sandbox. No filesystem-suite success is inferred.

Retained R36's 600-second transport timeout remains `OUTCOME_UNCERTAIN`: process absent, source-after verified as `sha256:31a190b12fc5a60774a6440b2f988d231d8aa50ef4cc64acbc2d0dba61ac790b`, binding CANCELLED without replay under the recorded autonomous authority. The independently reported 192-test baseline was 191 PASS / 1 FAIL (the request-id helper). These edits do not mark that historical request SUCCEEDED.

Pending within the existing plan: M3 MCP transport, Expert integration, actual trusted classification/Catalog/Harness provider wiring, workspace integration, full Host and applicable operational/E01–E19 evidence. Final E03/E10 remain pending. GitHub publication is a later separately authorized stage. Stable 1.0, production readiness and full acceptance are not claimed.

See the [product entry and API links](../README.md).

