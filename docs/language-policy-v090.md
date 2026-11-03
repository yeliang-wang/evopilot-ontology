# EvoPilot-ontology v0.9 language responsibilities

This supplements the [approved v0.9 plan](ontology-v090-plan.md) and [independence ADR](architecture/0001-ontology-v090-independence.md). It clarifies their existing strict-TypeScript orchestration, bounded Python validation and Java DL reasoning boundaries. It does not expand the version scope, authorize a backend rewrite, introduce a browser UI, or establish acceptance.

## Verified OpenHands reference

The user requested OpenHands as a reference on 2026-11-03. The inspected main-repository revision is `85dd5b5a0f2078822175f75cb73887bb0168e744`. At that revision the package is `@openhands/agent-canvas`; its source is React/TypeScript, with Node.js `.mjs` launch/build scripts and separate Agent Server/automation processes. The current repository must not be described from an older monolithic Python-backend layout.

The current README places the Python SDK, Agent Server and canonical server API in `OpenHands/software-agent-sdk`, and identifies `OpenHands/typescript-client` as the browser-compatible API client consumed by Canvas. The previously inspected SDK revision below also retained a TypeScript client with an API-generation/check workflow; that historical file location is not the current repository-ownership claim. This demonstrates component and contract ownership across languages, not a requirement that every backend use Python.

Primary references:

- [Canvas package and build configuration](https://github.com/OpenHands/OpenHands/blob/85dd5b5a0f2078822175f75cb73887bb0168e744/package.json)
- [Current Canvas repository ownership](https://github.com/OpenHands/OpenHands/blob/85dd5b5a0f2078822175f75cb73887bb0168e744/README.md#repository-boundaries)
- [Compiled frontend and service launcher](https://github.com/OpenHands/OpenHands/blob/85dd5b5a0f2078822175f75cb73887bb0168e744/bin/agent-canvas.mjs)
- [Central runtime version/configuration bindings](https://github.com/OpenHands/OpenHands/blob/85dd5b5a0f2078822175f75cb73887bb0168e744/config/defaults.json)
- [SDK Python workspace](https://github.com/OpenHands/software-agent-sdk/blob/77e7ce75c7c10d3604308cefd986575daa186ff0/pyproject.toml)
- [Previously inspected SDK TypeScript client and API checks](https://github.com/OpenHands/software-agent-sdk/blob/77e7ce75c7c10d3604308cefd986575daa186ff0/clients/typescript/package.json)

## Ontology classification and responsibility

| Category | Language / representation | v0.9 responsibility | Boundary |
|---|---|---|---|
| Owned product implementation | Strict TypeScript | Owner service, HTTP/MCP/CLI, Expert operation routing, workspace identities, permission checks, lifecycle, receipts, review/delivery, installation and recovery | Compile to JavaScript for installed execution; one owner of mutation and decision state |
| RDF/constraint executor | Python | Bounded RDFLib/pySHACL parsing and SHACL execution against exact admitted inputs | Return formal reports; no second asset lifecycle, approval policy, credential registry or Agent loop |
| Description-logic executor | Java | OWLAPI/HermiT integration, DL legality, consistency, entailment and supporting-axiom explanation tasks | Actual complete OWL 2 DL conformance remains a release obligation; no silent profile downgrade |
| Generated/runtime JavaScript | JavaScript | Compiled TypeScript runtime; existing bounded build/package/test drivers and frozen compatibility bytes | New product behavior stays in TypeScript; never hand-edit emitted `dist` or expand the frozen compatibility implementation |
| Formal domain languages | OWL/RDFS, SHACL and scoped SPARQL | Semantic axioms, graph constraints and supported graph queries | These specify ontology semantics/validation, not operating authority; no arbitrary remote queries |
| Serialization/contracts/configuration | Turtle, RDF/XML, JSON/JSON Schema, YAML, TOML/XML where required by tools | Assets, interchange, versioned worker/API envelopes, manifests and toolchain/build configuration | A file format is not an additional application implementation language; one authoritative contract, generated applicable projections |
| Local persistence | SQLite/SQL | Transactional owner state, indexes and request/audit receipts | Service-owned prepared operations; no user-controlled arbitrary SQL or foreign-owner database access |
| Expert/documentation | Markdown with YAML metadata | Canonical Skill, task guidance, readable reports and references | Guidance drives verified owner APIs; prose does not prove inference or authorize a decision |
| Packaging/environment glue | Shell, CI YAML, optional container build files | Minimal launch, dependency preparation and CI adapters when required | No business policy, acceptance decisions or state migration hidden in shell scripts |
| Future visual interface | TypeScript/React and CSS if separately approved | Potential later asset visualization and interaction | No Dashboard/browser UI obligation is introduced into v0.9 |

Rego/OPA remains a Harness concern. Referencing the OpenHands UI/Agent stack does not add its agent execution, scheduling, telemetry, desktop UI or model-account management to Ontology.

## Selection rationale and business path

Keeping TypeScript as the product owner and using Python/Java executors preserves one lifecycle while reusing the formal tooling required by v0.9. These language boundaries do not require three network microservices. Moving the entire owner service to Python would duplicate or replace current scope/auth/receipt logic and still need the Java DL engine; the OpenHands reference supplies no Ontology-specific reason for that rewrite. Reimplementing RDF/SHACL and complete DL entirely in TypeScript would create a much larger standards-conformance burden. The selected division follows the already approved plan.

For the sensitive-service example, the TypeScript service admits a versioned model and fixed sources, the Python adapter validates the selected graph view against SHACL, and the Java adapter establishes whether the OWL axioms entail `SensitiveService`. TypeScript retains the exact reports, identities and actual review, then performs immutable delivery. The Expert explains the result and its supporting sources. A SHACL pass does not create an OWL entailment; an entailment does not record human approval.

## Delivery checks

- Keep component dependencies, interpreter/JDK identities, hashes and licenses in explicit toolchain records. The OpenHands versions above are reference observations, not automatic dependency upgrades for this product.
- Version worker/API contracts and validate both requests and responses. Preserve input closure, tool/config identity, output scope, time/memory limits and explicit failure states across language boundaries.
- Run actual upstream Python/Java tools in conformance and business-task tests; a mock worker cannot establish full reasoning or native validation support.
- Check strict TypeScript and installed compiled entry points, generated Skill equivalence, frozen compatibility bytes, package closure and cross-language negative/recovery paths. Language statistics or a successful build are not product acceptance.
- Maintain the existing P0–P6 plan, fixed independent expectations and actual Host acceptance. Keep mutable business state in the TypeScript owner service and admit only versioned results from workers.
