# EvoPilot Ontology · v0.8.3 Preview

English | [简体中文](README_CN.md)

Ontology defines domain concepts, relationships, constraints and provenance, then preserves reviewed immutable semantic assets. It works with [EvoPilot Expert](https://github.com/yeliang-wang/evopilot/blob/main/README.md), [Harness](https://github.com/yeliang-wang/evopilot-harness/blob/main/README.md) for quality and evidence, and [Runtime](https://github.com/yeliang-wang/evopilot-runtime/blob/main/README.md) for execution and project completion.

[Quickstart](#quickstart) · [Standards](specifications/README.md) · [Native API](docs/native-service.md) · [Documentation](docs/README.md) · [Release](https://github.com/yeliang-wang/evopilot-ontology/releases/tag/v0.8.3)

<a id="what-is-an-ontology-asset"></a>

## Assets and standards

| Basis | Supported use |
|---|---|
| RDF 1.1 / Turtle 1.1 | Native models, shapes and instances with stable IRIs |
| RDFS 1.1 / OWL 2 declarations | Bounded concepts, properties, relations and metadata; no full OWL reasoning |
| SHACL 2017 / pySHACL | Core and restricted local SELECT validation, preserving upstream reports |
| EvoPilot conventions | Package layout, source and requirement bindings, review and immutable publication |

The editable model is `model.ttl`; `shapes/` contains native constraints and `instances/` contains actual or explicitly synthetic facts. Source bindings distinguish observed facts from inference. Independent coverage fixes expected identities, shapes and cases before generation.

Current `service.native()` operations perform package admission, validation, exact review, a separate domain decision, publication and protected readback. Successful validation alone does not approve business meaning or prove complete coverage. Historical JSON models and Catalog queries remain read-only; old mutation entrypoints reject new work.

Read the [v1 specification](specifications/v1/README.md), [support matrix](specifications/v1/support-matrix.json), [tool versions](specifications/v1/standards.lock.json) and [re-extraction guide](specifications/v1/re-extraction.md). The same basis applies to forward/reverse modeling and public/private projects.

## Quickstart

For Codex, start with the [parent installation](https://github.com/yeliang-wang/evopilot/blob/main/docs/installation.md) and unified Expert. It guides purpose, scope, modeling, validation and review; no separate Ontology plugin is required.

### Install the Preview package

Use **Node 24.14.0**. Place all four assets from [v0.8.3 Preview](https://github.com/yeliang-wang/evopilot-ontology/releases/tag/v0.8.3) in a new directory: `evopilot-next-ontology-0.8.3.tgz`, `ontology-dependency-lock.json`, `source-revision.txt` and `SHA256SUMS`.

```sh
shasum -a 256 -c SHA256SUMS
cat source-revision.txt
mkdir ontology-0.8.3
tar -xzf evopilot-next-ontology-0.8.3.tgz -C ontology-0.8.3
cp ontology-dependency-lock.json ontology-0.8.3/package/package-lock.json
cd ontology-0.8.3/package
npm ci --omit=dev --ignore-scripts
node dist/cli.js help
node dist/cli.js version
```

Stop on checksum failure and compare the revision with the release source. Distribution uses GitHub Releases, not an npm registry. SDK exports resolve compiled JavaScript and declarations; the installed bin is `evopilot-next-ontology`. Development scripts and tests are excluded from installed packages.

### Develop from source

In a source checkout, prepare the parent-pinned native toolchain and use locked development dependencies:

```sh
npm ci --ignore-scripts
npm run build
npm run check
EVOPILOT_TEST_NATIVE_TOOLCHAIN=/absolute/path/to/verified/native-toolchain.json npm test
```

Missing native tools fail explicitly. Trusted service construction supplies tool paths; asset JSON cannot choose executables. Maintained services and lifecycle logic use strict TypeScript; a pinned Python adapter invokes RDFLib/pySHACL. See [native API and independent replay](docs/native-service.md).

## Content levels and modeling scope

Before source reverse modeling, document-driven design or asset composition, fix purpose, full scope, source revisions, independent requirements and target level. Current grading selects `standardVersion: "v2"`: L1 domain understanding, L2 implementation specifications, L3 complete reconstruction specifications. Ontology holds the normative content; Harness assesses it. See the [v2 API](docs/readiness-v2.md).

L3 does not require software reconstruction or the original environment. `assetAssessment` and `reconstructionVerification` are separate; `L3 / NOT_REQUESTED` is valid. It does not prove generated functional equivalence, identical code, production readiness or release authority. Missing required content blocks qualification. Historical usability v1 records retain their original meaning.

Public visibility does not authorize upload. Received execution feedback proposes semantic impact and exact-version reuse or new delivery; it never approves or publishes assets. Optional operations profiles retain source bindings and constraints. Preview is not GA.

## Documentation and contribution

- [Documentation index](docs/README.md), [native decisions](docs/native-decisions.md), [readable API](docs/readable-api.md) and [operations profiles](docs/operations-profile.md).
- [Feedback](docs/feedback.md), [changelog](CHANGELOG.md), [Roadmap](docs/roadmap.md) and [contribution guide](CONTRIBUTING.md).
- [Bilingual maintenance](docs/documentation-languages.md), [security](SECURITY.md), [Apache-2.0 license](LICENSE) and [notices](NOTICE).
- [Parent implementation-language policy](https://github.com/yeliang-wang/evopilot/blob/main/docs/language-policy.md) and [distribution/checksum guide](https://github.com/yeliang-wang/evopilot/blob/main/docs/github-release.md).

These source pages include documentation improvements after v0.8.3. Existing tagged archives retain their original documentation; future releases package the updated pages.
