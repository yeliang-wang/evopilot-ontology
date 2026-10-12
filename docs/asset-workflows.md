# Ontology asset workflows

Start with the meaning you need to describe and the evidence you have. Ontology 0.1.0 supports a native v1 model lifecycle and retained compatibility workflows. Both produce evidence; neither documentation nor an LLM supplies a human decision.

## Concepts and format choices

A model describes concepts, properties, relations and constraints. Source mappings explain where each statement came from; unresolved issues keep missing or disputed meaning visible. You can begin with requirements alone. Ordinary users can describe these in plain language; a subsequently integrated Host Expert can help author fields and explain review results. That Host/Expert integration is still pending. Today developers use the standalone [CLI](cli.md) or [service](service.md); the JSON examples are integration interfaces, not a requirement that users hand-author raw JSON.

| Format | Contract and purpose |
| --- | --- |
| Native Ontology v1 | `product: "ontology"`, `specVersion: "v1"`, strict asset version; [published package specification](../specifications/v1/README.md), [schema](../specifications/v1/asset.schema.json), [template](../specifications/v1/templates/model.json) |
| Retained H 4.8.2 compatibility | Historical `OntologyPack`, `semantics.evopilot.io/v1` Packs, and `evopilot-harness-…/v1` documents; [legacy contracts](legacy-core.md) and [schema map](../schemas/legacy/v1.json) |

A legacy schema ending in v1 is not native Ontology v1. Native delivery and legacy Catalog are separate wire formats with different digest and material contracts. There is no implicit conversion; [explicit derivation](legacy-migration.md) reports mapping coverage and gaps.

## Forward: requirements to a native delivery

1. Describe the intended business concepts and rules without requiring existing code. For a synthetic orchard, a requirement in `design/orchard-requirements.md` might propose a Harvest concept and an integer quantity. Record the exact source revision and digest with `direction: "forward"` and `design-proposed` status; keep invented examples marked `synthetic`.
2. Draft concepts, properties, relations and supported constraints. Cover every semantic row with a source mapping whose locator, revision and status match the source. Record ambiguity as unresolved issues instead of inventing confirmed meaning.
3. Use `validateOntology` and, when representative instances exist, `validateInstances`. Store a valid draft with `asset.put`; required unresolved issues may remain `PENDING`. Instance validation reports actual coverage, including untested and unsupported constraints.
4. Request `asset.review`, inspect the exact model and returned `reviewDigest`, then record a separate explicit decision through `asset.decide`. The decision binds workspace, project, visibility, model digest and validation. An edit clears prior review and decision.
5. Only a current APPROVE and a VALID model permit a separate `asset.publish`. A PENDING model is refused even if approved. The published id/version is immutable; further changes need a new version. Retain the returned delivery reference and receipt.

The pure `buildDelivery` and `verifyDelivery` APIs build/check deterministic artifacts; they do not record service approval or publication. No workflow automatically generates implementation code or proves business correctness. See the [synthetic forward/reverse examples](../examples/synthetic-models.json) and [native validation contract](../specifications/v1/README.md).

## Reverse: explicit source evidence to the same draft

Read only explicitly scoped source evidence, such as synthetic `src/orchard/harvest.mjs` at a pinned revision. Separate directly observed structure (`source-observed`) from a proposed business interpretation (`inferred`); runtime behavior requires its own `runtime-observed` evidence. Set `direction: "reverse"`, preserve source mappings, and carry uncertainties into the same native draft/review/decision/publication sequence.

For bundled sources, obtain exact keys through `listPublicSources` and install one using `source.install`; `source.list` and `source.inspect` inspect retained evidence. This installer accepts only the four bundled keys, not arbitrary source paths. For historical JSON/YAML, `legacy.import` retains exact inline bytes and origin metadata; invalid but safely parsed documents are quarantined. `legacy.derive` requires an inspected sourceId, a new id/version and explicit visibility, and returns coverage plus unresolved issues. It never imports historical approval. Unsupported projections and missing definitions remain explicit blockers. See [source contracts](public-assets.md) and [derivation](legacy-migration.md).

Classification uses a separately registered sourceId resolved by trusted application code; it does not accept a caller's arbitrary path or automatically register an imported source. Discovery and source presence do not grant permission to read more material.

## Scope, references and developer requests

Every source and dependency needs an explicit identity and visibility. Native provenance digests are declared pins, not proof that bytes were fetched or authenticated. Service dependencies must resolve to already-published Ontology deliveries in the same project, with exact product/id/version/specVersion/visibility/digest references. Dependency digests are delivery digests, distinct from blob hashes. Public assets cannot depend on private assets; private assets may depend on public assets in their project. Cross-project and foreign-product native dependencies are refused.

This standalone API example stores only a synthetic draft. Supply an explicit canonical external workspace as described in the [service contract](service.md); `workspaceRoot` below is a caller-provided value.

```js
import { readFileSync } from 'node:fs';
import { createOntologyService } from '@evopilot-next/ontology/service';

const model = JSON.parse(readFileSync('examples/synthetic-models.json', 'utf8')).assets[0];
const service = createOntologyService({ workspaceRoot, workspaceId: 'demo' });
service.initialize();
const scope = { visibility: 'public', projectId: 'demo' };
try {
  const status = service.execute({ operation: 'workspace.inspect', scope, input: {} });
  const receipt = service.execute({
    operation: 'asset.put', scope, input: { model },
    requestId: 'first-model', expectedRevision: status.revision,
  });
  const retained = service.execute({
    operation: 'receipt.inspect', scope, input: { requestId: receipt.requestId },
  });
} finally {
  service.close();
}
```

Reads have exactly `{operation, scope, input}`; mutations additionally have a fresh requestId and the observed global expectedRevision. Do not automatically refresh/retry on conflicts. The [service input table](service.md) specifies separate review/decision/publication requests, including `humanEvidenceRef`; the [CLI guide](cli.md) shows the same envelope. An evidence reference is a local operator assertion, not independently authenticated identity.

## Retained classification and grounding

The seven operations are `classification.start`, `classification.inspect`, `classification.resume`, `classification.reanalyze`, `classification.list`, `classification.continue_to_harness` and `classification.close`. Start/reanalyze use async `service.classify`; the others use `execute`. Trusted source resolution, advisor and explicit model binding are prerequisites. The CLI configures none of these callbacks automatically. See the [exact classification inputs and handoff evidence](classification-service.md).

A TAXONOMY_MATCHED result means the taxonomy matches the analyzed source; it is not Harness approval or quality eligibility. An exact user decision can record a handoff, but starts no Harness session. Admission receipts remain PENDING; inspect/resume reads the current outcome. Reanalysis is only for a known completed prior attempt.

Grounding separates `semantic.foundation.inspect` (business-neutral primitives), `semantic.candidates.inspect` (evidence-bound candidates) and `semantic.grounding.inspect` (results with uncertainty). Foundation, candidates and grounding results are distinct from Harness quality/eligibility. Weak or conflicting evidence must remain unresolved. See [query contracts](legacy-api.md) and [retained core](legacy-core.md).

## Retained Packs, proposals and immutable artifacts

An OntologyPack source uses `ontology.inspect`, `ontology.validate` and `ontology.diff`; its local publication is `ontology.publish`. Professional DomainOntologyPack, ProductOntologyPack, OrganizationOntologyPack and ProjectOntologyOverlay use `pack.scaffold.inspect`, `pack.inspect` and `pack.resolve.inspect`. Imports and bases require exact pins; private organization material cannot enter public scope. DomainHarnessPack is outside Ontology ownership.

Preview with `project-ontology.proposal.inspect`. To persist any named producer, call `producer.prepare` with its operation and parameters, read `producer.inspect`, separately `producer.decide` against the exact reviewDigest, then invoke the named operation with only `{planId}`. Plans bind verified current dependencies and are consumed once. Use `pack.lifecycle.create` / `pack.lifecycle.transition` for Packs and `project-ontology.proposal.create` / `project-ontology.proposal.transition` for proposals. Imported PUBLISHED labels cannot manufacture current lifecycle authority.

An approved owned proposal still needs a separate publication plan for `project-ontology.artifact.publish`. It recomputes an immutable snapshot (ResolvedProjectOntologySnapshot), projections, manifest and compiled ProjectOntologySkill. Preview calculations are `project-ontology.snapshot.resolve`, `project-ontology.projections.inspect` and `project-ontology.skill.inspect`; the Skill is read-only guidance, not an executable plugin or truth store. Unsupported projections remain NON_APPLICABLE. `project-ontology.artifact.transition` records later local lifecycle actions; INSTALL/ACTIVATE have no Runtime/Harness side effect. See [producer inputs and lifecycle rules](legacy-api.md#finite-retained-producers).

## Retained computation, interoperability and closure

Build a reasoning profile and index through `semantic.reasoning-profile.inspect` and `semantic.index.inspect`, then identify changes with `semantic.affected-subgraph.inspect`. Run `semantic.compute.inspect` for incremental and full modes with identical bindings; `semantic.compute.compare` checks equivalence. Supply qualified external reasoner results as data; these operations do not launch a reasoner.

Use `semantic.interoperability.inspect`, `semantic.round-trip.inspect` and `semantic.closure.inspect` for projections, round-trip evidence and a candidate closure. Publication is the separately planned `semantic.closure.publish`, bound to the exact owned artifact; `semantic.closure.slice` is a digest-bound read. `semantic.federation.discover` reads supplied root descriptions without network access or permission grants. Benchmark, gold-case, certification and external-evidence queries remain advisory. See the [full query table](legacy-api.md) and [compatibility APIs](legacy-core.md).

## Retained Catalog and uncertain outcomes

For a complete legacy generation, use `semantic.catalog.preview`, `catalog.prepare`, `catalog.plan-inspect`, a separate `catalog.decide`, then `semantic.catalog.publish`. Inspect the result with `semantic.catalog.inspect` and the exact receipt with `semantic.catalog.readback`. Rollback/revocation use `semantic.catalog.transition-preview` and fresh plans for `semantic.catalog.rollback` / `semantic.catalog.revoke`.

Catalog checks real scoped producer history, consumed decisions, source/material digests and immutable blobs. Foreign Harness material requires the trusted `resolveLegacyHarness` callback returning verified exact material; a PUBLISHED label alone is insufficient. Absent providers fail explicitly. An absent head is EMPTY, not an empty published fallback; initial empty publication is rejected. See [Catalog inputs, material verification and recovery](catalog-service.md) and [compatibility library](legacy-catalog.md).

On timeout or UNKNOWN, retain the original request identity and inspect receipts; never redispatch uncertain work. Classification resume does not invoke the advisor. Catalog uses `semantic.catalog.recovery-inspect` / `semantic.catalog.recovery-readback`; `semantic.catalog.recover` records reconciliation with its own requestId and revision. It neither republishes nor unlocks old file stores. Preserve unresolved failures.

Current local evidence reports 201 passing product tests, check/build and offline artifact smoke. Some detailed retained guides preserve earlier pending-test/CLI notes; the [current migration summary](../provenance/migration-current.json) records the newer bounded evidence. MCP, Host/Expert/provider composition and final source-ledger closure remain pending; E03/E10 and full migration are not complete. Local evidence conveys no acceptance or software release authority.
