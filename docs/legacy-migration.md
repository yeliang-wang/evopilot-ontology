# Inspect and derive historical sources

Use the separate [migration contract](../specifications/v1/legacy-derivation.md) for explicit inspection and native-v1 derivation of structured historical assets. These APIs are not arbitrary source-code parsers. For source reverse modeling, the Host inspects explicitly authorized files and authors native v1 observations with real locator/revision/digest pins, then stores the model through `asset.put`; see [asset workflows](asset-workflows.md#reverse-explicit-source-evidence-to-the-same-draft).

```js
import { inspectLegacySource, deriveLegacyModel } from '@evopilot-next/ontology/migration';
const source = { sourceLocator: 'archive://ontology/source', sourceRevision: 'commit-or-revision', sourceVisibility: 'private' };
const inspected = inspectLegacySource(document, source);
const derived = deriveLegacyModel(document, {
  ...source, expectedDocumentDigest: inspected.documentDigest,
  id: 'new-project-model', version: '1.0.0', visibility: 'private'
});
```

Check report validity before accessing model data. `INSPECTED` binds a complete original document but is not import completion. `PENDING` is a structurally valid native model with required unresolved issues; delivery refuses it. `NO_MODEL_PROJECTION` explicitly identifies technical-only records. `BLOCKED` includes invalid documents, unknown versions, digest drift and forbidden visibility transitions.

The public historical software-engineering OntologyPack has published lifecycle metadata but lacks business definitions and contains references outside its concept set. It therefore yields an honest pending model. Its original JSON, lifecycle and digest remain unchanged; callers of the pure API must retain source bytes. The [owned service](service.md) implements durable `legacy.import`, scoped `source.inspect` and `legacy.derive`: it retains exact inline bytes, quarantines safely parsed invalid documents and derives a new draft with no inherited review or approval. Lexical terms and classification roles do not become confirmed business definitions.

The [current schema provenance](../provenance/legacy-schema-sources.json) lists the live inventory and eight additional classification/source schemas from commit `372733fd7b67ec3bee9efe6322f0229db77b160d`. Foreign Harness validation in Catalog remains independent of Ontology source import authority. Actual Desktop/Host full-journey acceptance, full migration, E03/E10 and source-ledger closure status must be obtained from a separate local acceptance report bound to the exact candidate; without that report, no acceptance can be claimed. Derivation does not establish semantic round-trip completion.
