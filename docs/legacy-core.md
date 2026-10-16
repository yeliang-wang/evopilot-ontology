# Historical calculation compatibility

> Historical interface reference. Corrected-v1 work uses the [native service](native-service.md) and [current specification](../specifications/v1/README.md). Retired JSON, producer, Catalog and classification mutation operations are rejected; descriptions below explain retained historical records, not current execution authority.


These retained calculation libraries originate from EvoPilot Harness 4.8.2, commit `372733fd7b67ec3bee9efe6322f0229db77b160d`. Core v1 specifications remain the sole native normative basis. Use the [owned service](service.md) and [query/producer contracts](legacy-api.md) for scoped persistence and decisions. Compatibility calculations convey no acceptance or release authority.

Import the six named namespaces from `@evopilot-next/ontology/compat`: `taxonomy`, `grounding`, `packs`, `projectOntology`, `interoperability`, and `validation`. They compute synchronously over supplied values. Taxonomy can explicitly read a user-selected file. Validation lazily reads this package's bundled schema map; no external product, default home, session, store, credentials or network is consulted. Importing the module performs no filesystem reads or writes. Functions with historical names such as publish, transition, install or activate only calculate documents and validate supplied proof/role/digest bindings; they do not carry out persistent operations or grant authority.

Historical wire IDs, schema IDs, canonicalization and digest algorithms remain compatibility identities, not native v1 assets. The initial Core extraction selected 31 source JSON schema objects keyed by original filename, not all legacy schemas or Expert copies. Its v1 filename refers to the historical schema bundle only. Source hashes and adaptations are recorded in [provenance](../provenance/legacy-core.json). Taxonomy engineRange explicitly uses compatibility engine 4.8.2, independent of this product's 0.1.0 version. Historical semantic-index toolchain defaults remain digest inputs, not claims about a running service.

Professional Pack creation, validation and resolution accept only DomainOntologyPack, ProductOntologyPack, OrganizationOntologyPack and ProjectOntologyOverlay. DomainHarnessPack is rejected. Nonempty or malformed harnessGuidance is rejected; the empty array and existing ontology digest rules remain. Harness producers belong to the Harness product. Historical requirements/compatibility schemas support readonly material validation only. The general validator has no Harness asset authoring or filesystem tree API.

Dependencies are pinned to ajv 8.20.0 and yaml 2.9.0. The lockfile preserves the six dependency package entries and registry integrity from the verified reference lock, with this package's root identity. Source-checkout dependencies are installed from this package's own lock; no parent dependencies are required. No third-party implementation is copied into src.

Tests retain pure assertions from v4.7 project ontology, v4.8 interoperability, v4.6 grounding and v4.5 taxonomy serialization. Taxonomy tests supply virtual readonly files, preserving JSON/YAML bytes and rejection assertions without temporary filesystem writes. Additional checks cover namespace isolation, four accepted kinds, Harness rejection, required fields, strict schema compilation, compatibility engine range and role rejection. The root isolation test imports compatibility code under Node permissions that permit only this product directory, exercising locally owned dependencies and schemas.

## Current integration and retained limits

Persistent native lifecycle, source import/derivation, retained queries and producers now belong to the [owned service](service.md), with [CLI](cli.md) and parent Preview routing. Library calculations do not themselves persist decisions, install assets or activate Runtime/Harness behavior.

Retaining these namespaces does not claim every historical Engine dispatch, Host renderer, Harness requirements producer, HarnessBundle closure algorithm or operational scenario is migrated. Use the [current roadmap](roadmap.md) for the separate exact-candidate-bound local acceptance report requirement covering Host/source-ledger closure and E03/E10; without that report, no acceptance can be claimed.

See the [independent technical baseline](../README.md), [current schema provenance](../provenance/legacy-schema-sources.json) and [explicit derivation bridge](legacy-migration.md). The initial 31-schema count describes that extraction set, not a fixed live total. Original source commits, licenses and provenance remain retained.
