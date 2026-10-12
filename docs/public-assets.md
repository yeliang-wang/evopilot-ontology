# Preserved public sources

Import `listPublicSources` and `readPublicSource` from `@evopilot-next/ontology/sources`.
The list report contains `sources` summaries; pass an exact `sourcePath` to read its
UTF-8 `raw` text, parsed `document`, byte length, SHA-256, and observed identity.
Both APIs return deeply frozen JSON reports with status `PRESERVED_SOURCE` and
`authority`, `businessConfirmed`, and `released` set to false.

The original 105 sources are partitioned into 101 Harness sources and four Ontology
packs. DomainHarnessPack guidance belongs to Harness. Kindless templates are
identified by their declared historical schema; bindings and export mappings retain
their own classification. Missing identity fields remain null. Raw and declared
document digests are distinct.

This package lazily reads only its fixed packaged archive, verifies a compiled
archive hash and every source's bytes, classification and parsed identity on access,
and parses YAML with duplicate-key checks, core tags, and an alias limit of 100.
Keys are manifest identifiers, never filesystem inputs. All original paths,
including `ontology/examples/example-finance-harness-guidance.yaml`, assetPath references and recipe strings,
are inert provenance. Original lifecycle and example labels confer no authority.

Source preservation is not native-v1 validation or product import completion.
The main API and existing compat/migration APIs remain unchanged. Inspect these four documents with `inspectLegacySource` from `@evopilot-next/ontology/migration`; `deriveLegacyModel` may return PENDING when business definitions or semantic mappings remain unresolved.
No global source loader or import API is exposed. See
[provenance](../provenance/public-assets.json), [LICENSE](../LICENSE) and [NOTICE](../NOTICE).
The provenance links the preserved source commit at the verified historical
`yeliang-wang/evopilot-harness` origin. Original paths remain inert; no files were moved.

