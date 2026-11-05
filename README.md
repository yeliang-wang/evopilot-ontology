# EvoPilot Ontology · v0.9.0 Preview

English | [简体中文](README_CN.md)

<!-- distribution-status: source -->

EvoPilot-ontology develops and preserves semantic assets through its own Expert, CLI, MCP service and private workspace. It supports forward modeling from requirements, reverse modeling from admitted sources, OWL reasoning, SHACL validation, explanations, semantic review and immutable delivery. Runtime and Harness are optional consumers; neither is required to use Ontology.

[Quickstart](#quickstart) · [Native v2 standards](specifications/v2/models.md) · [Documentation](docs/README.md) · [Release index](https://github.com/yeliang-wang/evopilot-ontology/releases)

These source pages describe the v0.9.0 scope. Publication and downloadable identities are recorded in the release index; source presence or successful tests do not establish release or business acceptance. The [release sequence](docs/release-v090.md) requires an installed standards report, actual user review, the original full product acceptance and a separate release decision.

<a id="what-is-an-ontology-asset"></a>

## Assets and standards

| Basis | Purpose and scope |
|---|---|
| RDF 1.1, Turtle 1.1, RDF/XML | Preserve graph terms, document bases, stable IRIs and exact source bytes; inspect asserted graph output. |
| RDFS 1.1 and OWL 2 DL | Complete OWL 2 DL Direct Semantics reasoning is the delivery commitment: legality, consistency, entailment, named classification and evidence-bound explanations. OWL Full is outside this commitment. |
| SHACL Core and local SHACL-SPARQL | Inspect asserted or explicitly selected derived graphs and retain full reports. Business validation also checks independent fixed cases, requirements and required target coverage. |
| JSON Schema and JSON envelopes | Validate API shapes, metadata and receipts; these are not an alternative editable ontology. |
| EvoPilot native v2 contracts | Bind intent, original sources, fixed expectations, models, named views, exact review and immutable delivery. |

RDF/OWL documents and SHACL shapes remain the semantic source. Unknown outcomes, unsupported extensions, limits and incomplete results are explicit. A graph that conforms is not automatically a validated business model. Read the [model contract](specifications/v2/models.md), [SHACL profile](specifications/v2/shacl.md) and [reasoning guide](docs/reasoning-v090.md).

For example, a service that accesses a sensitive dataset can be inferred to be a sensitive service from an OWL restriction. SHACL can require that service to have an owner. The Expert shows the original requirement, positive and negative fixed cases, actual inference, constraint violations and supporting axioms. A human separately reviews the exact model before delivery.

## Quickstart

Use **Node 24.14.0**. The independent entry is `evopilot-ontology`; its commands require `--json`. Select the independent Ontology Expert in Codex after explicitly installing and connecting its plugin. The parent Expert is not the installation entry for new v2 work.

### Install the Preview package

The product archive is named `evopilot-next-ontology-0.9.0.tgz`. Obtain the selected package, dependency lock, source revision, checksums and native component/source/notice materials from the reviewed distribution. Verify every selected artifact before installation. Follow the [independent installation guide](docs/standalone-v090.md) and [offline toolchain preparation](docs/managed-toolchains-v090.md); a source-built test package is not evidence of a published Release.

The fixed native distribution recipe targets Linux ARM64 with glibc 2.28 or newer and a usable systemd user manager for bounded workers. Other development hosts or manually provisioned tools do not establish that distribution's supported-platform acceptance. Keep the installed npm runtime, native tools, installation controls and business workspace in separate private directories outside Git. The packaged plugin template requires real connection setup; it does not contain credentials.

### First business workflow

1. Inspect the connected identity, project scope, permissions and available toolchains.
2. Record purpose, scope, exclusions and source revisions; admit the exact source bytes.
3. Fix independent positive/negative expectations before generating the model.
4. Record the RDF/OWL model, SHACL shapes and requirement mappings; run reasoning and business validation.
5. Inspect violations and explanations, correct the model and repeat the required checks.
6. Prepare an exact semantic review; after an actual authorized human decision, record an immutable delivery and verify its readback.

Use the [independent Expert guide](docs/standalone-v090.md), [expectation contract](specifications/v2/expectations.md) and [review/delivery contract](specifications/v2/lifecycle.md). An uncertain write requires inspection of its original receipt. Do not automatically submit a replacement request.

### Develop from source

The source workflow uses locked dependencies and strict TypeScript:

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm run test:governance
```

Native tests additionally require the exact verified toolchains described in the [reasoning guide](docs/reasoning-v090.md) and [SHACL contract](specifications/v2/shacl.md). Missing tools fail explicitly. TypeScript owns product state and policy, Java executes OWL reasoning, and Python adapts RDF/SHACL. See the [language policy](docs/language-policy-v090.md).

## Compatibility and private assets

Historical v1 specifications, compatibility/vendor bytes and immutable records retain their meanings. The historical `evopilot-next-ontology` CLI and root SDK `VERSION` remain at their legacy v0.8.3 interface identity; the independent runtime inventory reports the installed v0.9.0 package. New v2 work uses the independent entry and contracts. No implicit migration, upload or automatic business rebuilding occurs.

The retained content-assessment API selects `standardVersion: "v2"`: L1 domain understanding, L2 implementation specifications, L3 reconstruction specifications. `assetAssessment` and `reconstructionVerification` remain separate; `L3 / NOT_REQUESTED` is valid. These content grades do not prove reconstruction, production readiness or release authority. See the [retained readiness API](docs/readiness-v2.md).

Private workspaces and credentials are not release assets. The selected historical test-asset reset is a separate post-installation operation; business assets are rebuilt manually afterward. A Dashboard is outside this version.

## Documentation and contribution

- [Documentation index](docs/README.md), [accepted plan](docs/ontology-v090-plan.md), [Roadmap](docs/roadmap.md) and [changelog](CHANGELOG.md).
- [Installation maintenance](docs/installation-maintenance-v090.md), [worker recovery](docs/worker-recovery-v090.md) and [standards evaluation](docs/standards-evaluation-v090.md).
- [Contributing](CONTRIBUTING.md), [bilingual maintenance](docs/documentation-languages.md), [security](SECURITY.md), [license](LICENSE) and [notices](NOTICE).
