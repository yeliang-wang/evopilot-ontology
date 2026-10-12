# Historical calculation compatibility

This is one bounded, partial M1 extraction batch from EvoPilot Harness 4.8.2, commit `372733fd7b67ec3bee9efe6322f0229db77b160d`. It does not complete E03 or M1 and conveys no acceptance, release or service authority. Core v1 specifications remain the sole native normative basis. Existing native exports and behavior are unchanged.

Import the six named namespaces from `@evopilot-next/ontology/compat`: `taxonomy`, `grounding`, `packs`, `projectOntology`, `interoperability`, and `validation`. They compute synchronously over supplied values. Taxonomy can explicitly read a user-selected file. Validation lazily reads this package's bundled schema map; no external product, default home, session, store, credentials or network is consulted. Importing the module performs no filesystem reads or writes. Functions with historical names such as publish, transition, install or activate only calculate documents and validate supplied proof/role/digest bindings; they do not carry out persistent operations or grant authority.

Historical wire IDs, schema IDs, canonicalization and digest algorithms remain compatibility identities, not native v1 assets. The initial Core extraction selected 31 source JSON schema objects keyed by original filename, not all legacy schemas or Expert copies. Its v1 filename refers to the historical schema bundle only. Source hashes and adaptations are recorded in [provenance](../provenance/legacy-core.json). Taxonomy engineRange explicitly uses compatibility engine 4.8.2, independent of this product's 0.1.0 version. Historical semantic-index toolchain defaults remain digest inputs, not claims about a running service.

Professional Pack creation, validation and resolution accept only DomainOntologyPack, ProductOntologyPack, OrganizationOntologyPack and ProjectOntologyOverlay. DomainHarnessPack is rejected. Nonempty or malformed harnessGuidance is rejected; the empty array and existing ontology digest rules remain. Harness producers belong to the Harness product. Historical requirements/compatibility schemas support readonly material validation only. The general validator has no Harness asset authoring or filesystem tree API.

Dependencies are pinned to ajv 8.20.0 and yaml 2.9.0. The lockfile preserves the six dependency package entries and registry integrity from the verified reference lock, with this package's root identity. Install in this independent package after the bounded edit; no parent dependencies are required. No third-party implementation is copied into src.

Tests retain pure assertions from v4.7 project ontology, v4.8 interoperability, v4.6 grounding and v4.5 taxonomy serialization. Taxonomy tests supply virtual readonly files, preserving JSON/YAML bytes and rejection assertions without temporary filesystem writes. Additional checks cover namespace isolation, four accepted kinds, Harness rejection, required fields, strict schema compilation, compatibility engine range and role rejection. The root isolation test imports compatibility code under Node permissions that permit only this product directory, exercising locally owned dependencies and schemas.

Pending subsequent batches:

- Persistent lifecycle/service/API operations, CLI, MCP, installation, activation and publication transports.
- Product-owned persistence for the explicit native Core v1 derivation bridge; historical artifacts are never implicitly relabeled.
- v4.7 Engine operation-family registration and workspace-backed dispatch.
- v4.8 closure Engine slicing with exact/stale digests and persisted-file non-mutation; CLI actor/digest/snapshot round trips; Engine interoperability dispatch.
- v4.6 Harness semantic requirements production, compatibility evaluation, HarnessBundle closure and Engine diagnostics.
- v4.5 integration proof that rejected taxonomy never opens Source or invokes Advisor.

Local syntax and provenance checks are recorded in the provenance file. Dependency-backed tests remain pending until the exact lock is installed. No global PASS or migration acceptance is asserted.

For the live inventory and subsequent extraction details, see [current schema provenance](../provenance/legacy-schema-sources.json) and the [explicit derivation bridge](legacy-migration.md). Earlier counts describe extraction sets, not a fixed live total.
