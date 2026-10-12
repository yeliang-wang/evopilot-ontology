# Inspect and derive historical sources

Use the separate [migration contract](../specifications/v1/legacy-derivation.md) for explicit inspection and native-v1 derivation. Existing native and compatibility exports are unchanged.

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

The public historical software-engineering OntologyPack has published lifecycle metadata but lacks business definitions and contains references outside its concept set. It therefore yields an honest pending model. Its original JSON, lifecycle and digest remain unchanged; source bytes must be retained by the caller. Lexical terms and classification roles do not become confirmed business definitions.

The [current schema provenance](../provenance/legacy-schema-sources.json) lists the live inventory and eight additional classification/source schemas from commit `372733fd7b67ec3bee9efe6322f0229db77b160d`. Foreign Harness validation in Catalog remains independent of Ontology source import authority. No M1/E03/acceptance or semantic round-trip completion is claimed.
