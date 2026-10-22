# EvoPilot Ontology · v0.7.0 Preview

[Quickstart](#quickstart) · [Standards](specifications/README.md) · [Native API](docs/native-service.md) · [Documentation](docs/README.md) · [Contribute](CONTRIBUTING.md)

Ontology owns domain definitions, relationships, constraints, source grounding and immutable semantic deliveries. It works with [EvoPilot Expert](https://github.com/yeliang-wang/evopilot), [Harness](https://github.com/yeliang-wang/evopilot-harness) for QA/evidence and [Runtime](https://github.com/yeliang-wang/evopilot-runtime) for execution and project completion.

Earlier **v0.6.0** introduced an optional pinned operations profile with project-local declarations, provenance and SHACL constraints. It retains source-bound semantic-impact review and exact-version reuse or new native delivery. Corrected-v1 ontology standards are unchanged; online findings and valid graphs do not confirm causes or approve domain changes. Read [the operations profile guide](docs/operations-profile.md). The [release tag](https://github.com/yeliang-wang/evopilot-ontology/releases/tag/v0.6.0) records the exact published source and artifacts.

v0.7 adds [readable owner reports](docs/readable-api.md), exact-version pagination and explicit evidence boundaries. Native standards and decision authority are unchanged. Publication records are on the [v0.7.0 release page](https://github.com/yeliang-wang/evopilot-ontology/releases/tag/v0.7.0).

## Adopted standards and tools

| Basis | Adoption |
|---|---|
| RDF 1.1 / Turtle 1.1 | Native model, shapes and instance files with stable IRIs |
| RDFS 1.1 / OWL 2 declarations | Bounded concepts/properties/relations and metadata; no full OWL reasoning |
| SHACL 2017 / pySHACL | Core and restricted local SELECT, original upstream reports |
| EvoPilot conventions | Package layout, exact source/coverage bindings, lifecycle and immutable delivery |

The [v1 specification](specifications/v1/README.md), [support matrix](specifications/v1/support-matrix.json), [adoption table](specifications/v1/adoption.md) and [toolchain reference](specifications/v1/standards.lock.json) state exact versions, limits and executable tests. Public/private projects and forward/reverse workflows use this same basis. Required unsupported or unresolved work never becomes a completed project.

## What is an Ontology asset?

The editable model is `model.ttl`; relationships and constraints use native RDF and SHACL under `shapes/`, while `instances/` supplies actual or explicitly synthetic facts. Source bindings separate observed facts from inferred modeling choices. Independent coverage fixes expected identities, shapes and cases before generation; a successful validator alone cannot prove a project is complete.

Current work uses `service.native()`: package admission, real validation, exact review, a distinct domain decision, immutable publication and protected readback. `standard.inspect` reports installed normative bytes. Old JSON models, Catalog and historical queries remain read-only evidence; retired mutation entrypoints reject new work. See [re-extraction](specifications/v1/re-extraction.md).

## Quickstart

Users start through the parent distribution's unified Expert. It initializes a private Workspace and guides scope, modeling, validation and review. Source developers use Node 24.14.0 and locked dependencies:

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm test
```

Native tests require the verified installed toolchain in `EVOPILOT_TEST_NATIVE_TOOLCHAIN`; missing tools fail explicitly. Production tool paths come only from trusted service construction, not asset JSON. Owned orchestration is strict TypeScript; a small Python adapter invokes upstream RDF/SHACL rather than implementing another rule language. [Native API and independent replay](docs/native-service.md) document exact operations and errors.

## Install the Preview package

For packaged installation, use the exact [v0.7.0 Preview release](https://github.com/yeliang-wang/evopilot-ontology/releases/tag/v0.7.0). Earlier editions remain available in the [release history](https://github.com/yeliang-wang/evopilot-ontology/releases). See [changes](CHANGELOG.md) and the parent [distribution and checksum guide](https://github.com/yeliang-wang/evopilot/blob/main/docs/github-release.md).

Place all four release assets in one new directory before checking checksums:

- `evopilot-next-ontology-0.7.0.tgz`
- `ontology-dependency-lock.json` (the Ontology `dependency-lock.json` asset uses this owner-prefixed release name)
- `source-revision.txt`
- `SHA256SUMS`

```sh
shasum -a 256 -c SHA256SUMS
cat source-revision.txt
mkdir ontology-0.7.0
tar -xzf evopilot-next-ontology-0.7.0.tgz -C ontology-0.7.0
cp ontology-dependency-lock.json ontology-0.7.0/package/package-lock.json
cd ontology-0.7.0/package
npm ci --omit=dev --ignore-scripts
node dist/cli.js help
node dist/cli.js version
```

Stop if checksum verification fails; compare `source-revision.txt` with the release's exact source commit. Distribution uses release tarballs, not a public npm registry. The installed bin is `evopilot-next-ontology`; SDK subpaths resolve compiled JavaScript and declarations.

## Documentation and contributions

[Documentation index](docs/README.md), [contribution guide](CONTRIBUTING.md), [security](SECURITY.md), and [Roadmap](docs/roadmap.md). Match package versions to their release tag; historical downloads retain their original capabilities. Technical validation grants neither domain approval nor release authority.

Native approvals bind readable, digest-pinned evidence to the exact review, Workspace and operation. See [decision evidence](docs/native-decisions.md) for the format, historical readback and trusted-operator boundary.

## Execution feedback

Introduced in v0.4 and retained in v0.6, this flow adds private, source-bound feedback through the public service API. This owner receives protected Runtime evidence and records reviewed impact, exact-version reuse or a new native delivery. Receiving evidence does not approve or publish assets. See [feedback](docs/feedback.md). Native v0.3 standard and contract bytes remain unchanged. Publication and exact installed acceptance are recorded separately.

## Implementation languages

Product services, lifecycle and the operations-profile implementation use strict TypeScript. Installed processes execute compiled JavaScript, and packages expose TypeScript declarations; handwritten JavaScript is limited to build/package/test drivers and hash-pinned historical compatibility modules. The pinned Python adapter invokes RDFLib/pySHACL, while domain models and constraints remain native Turtle/SHACL. See the parent [language policy](https://github.com/yeliang-wang/evopilot/blob/main/docs/language-policy.md) for exact boundaries and checks.
