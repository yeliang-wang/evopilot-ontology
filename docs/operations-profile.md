# Optional operations and fault profile

The `operations-v1` profile supplies reusable definitions for service impact, cause interpretation and references to response evidence. It is an optional extension over the existing native `specifications/v1`. Profile version `1.0.0` is a template version, not an EvoPilot software release or a new base specification.

Ontology owns these definitions and immutable model deliveries. Harness continues to own observations, incidents, runbooks and quality dispositions. Runtime owns approved plans, execution and action receipts. This profile does not create a second incident database, execute a runbook, confirm a cause or authorize a release.

## Standards and precise limits

The implementation uses the existing [RDF/Turtle and bounded SHACL adoption](../specifications/v1/README.md), executed by the existing pinned pySHACL adapter. It adds no Python product logic, external imports, inference or custom SHACL components. The eight required shapes use the already supported local SHACL `SELECT` constraints.

[W3C PROV-O](https://www.w3.org/TR/prov-o/) informs only these explicit vocabulary mappings:

| Local concept or relation | PROV-O mapping | Meaning retained |
|---|---|---|
| `OwnerEvidenceReference` | subclass of `prov:Entity` | A reference describes retained evidence; it does not duplicate the owner's state. |
| `ProblemAssessment` | subclass of `prov:Entity` | A versioned interpretation can be derived from evidence. |
| `ActorReference` | subclass of `prov:Agent` | The operator declares who made the interpretation. This is not authenticated identity. |
| `derivedFrom` | subproperty of `prov:wasDerivedFrom` | An assessment explicitly cites its source evidence. |

These mappings do not enable PROV inference, qualified relations or activity orchestration. Execution remains a Runtime owner reference; the profile does not claim complete PROV-O support. Temporal proximity does not establish causation. [SHACL 2017](https://www.w3.org/TR/2017/REC-shacl-20170720/) supplies validation semantics; the profile's package layout, identity and review boundaries are EvoPilot conventions.

## Definitions and constraints

| Concept | Required relationships or fields |
|---|---|
| `Project` | Fixed root `<namespace>project`, workspace and project identifiers, at least one business capability. |
| `BusinessCapability` | A stable project-owned identity used as an impact endpoint. |
| `Service` | At least one typed capability it implements. |
| `Deployment` | Exactly one typed service, a nonempty environment and fixed source revision. |
| `ProblemAssessment` | Deployment, affected capability, cause assertion, pinned runbook reference, actor and source owner evidence. Multiple causes and assessments are permitted. |
| `CauseAssertion` | Exactly one `OBSERVED`, `SUSPECTED` or `CONFIRMED` classification, a rationale and typed evidence. A confirmed assertion additionally requires a decision reference; other classifications cannot masquerade as confirmed by attaching such a decision. |
| `OwnerEvidenceReference` | Exact owner, workspace, project, record kind, stable ID, revision, SHA-256 digest and Unix timestamp in seconds. |
| `RunbookReference` | An owner reference belonging to Harness, record kind `runbook`, guidance ID and immutable version. It grants no permission. |
| `ActorReference` | A nonempty operator-declared actor ID. |

The permitted owner names are `runtime`, `harness`, `ontology` and `workspace`. Record kinds are `finding`, `observation`, `problem`, `run`, `collection`, `native-package`, `decision` and `runbook`. All references in one instantiated profile must match the root's workspace/project scope. A consumer must resolve the owner record before treating a reference as live evidence; abbreviated API pointers acquire their revision/time details from that resolution.

`CONFIRMED` is an explicit reviewed interpretation, not a value generated from an alert clearing. Native SHACL checks its structure and required evidence reference. It cannot authenticate the referenced decision, establish a causal fact, or determine that a particular repair prevented recurrence. Runtime and Harness must independently resolve the exact owner records and apply their decision and recovery gates.

## Instantiate in a project namespace

The native base requires every owned declaration and named shape to belong to the project's namespace and have a source binding. Therefore the shared profile is a pinned template, instantiated into that namespace. It is not an implicitly imported global ontology.

```js
import {
  inspectOperationsProfile,
  instantiateOperationsProfile,
  verifyOperationsProfilePackage,
} from '@evopilot-next/ontology/service';

const profile = inspectOperationsProfile();
const material = instantiateOperationsProfile({
  namespace: 'urn:my-project:operations:',
  direction: 'reverse',
});
```

Use a project-owned absolute HTTP(S) or URN namespace ending in `/`, `#` or `:`. Reserved W3C and EvoPilot namespaces are rejected. Instantiation is deterministic and performs no owner-state mutation.

The returned material contains these package fragments:

```text
model.ttl                            # required definitions; append project definitions below
shapes/operations.ttl                 # exact required profile constraints
profiles/operations.json              # profile version/digest and instantiated graph digests
sources/operations-model.ttl.txt       # retained original definition template
sources/operations-shapes.ttl.txt      # retained original constraint template
sources/bindings.json                 # base-profile source mapping template
```

It also returns `requiredShapeIds`, declaration identities and the fixed root identity. It deliberately does not invent project instances, a complete coverage denominator, executable acceptance cases or business source mappings. The generated source mappings are marked `inferred` with an explicit deterministic-instantiation rationale; their underlying template bytes remain `observed` source material.

To adopt the fragments:

1. Retain the exact model prefix and complete `shapes/operations.ttl`. Add project definitions after the prefix and additional project shapes in other files. Never remove a required profile constraint.
2. Add real project source documents, exact revisions, file/fragment digests and explicit mappings. Keep the generated base-profile source closure intact. Forward onboarding uses fixed requirements/design evidence; reverse onboarding uses fixed implementation/observation evidence. Neither direction changes the shared definitions.
3. Supply project instances and independent coverage. Include every required profile shape and declaration mapping. Every named shape and required requirement must have a positive and negative native case under the existing base standard.
4. Include the fragments and all other files in the normal native package manifest. Call `verifyOperationsProfilePackage(package)` before normal native validation. This checks the exact profile adoption, including the original source closure; it does not replace `native.package.validate`.
5. Resolve operational references through their owners, review the business interpretation, and use the existing native review/decision/publication lifecycle. Changing an interpretation creates a newly reviewed immutable delivery. Historical packages stay unchanged.

`verifyOperationsProfileMaterial` verifies exact generated fragments. `verifyOperationsProfilePackage` accepts additional project definitions and cases while rejecting altered profile constraints, dropped source mappings or an unpinned profile. Both report `ownerReferencesVerified: false` and confer no authority. The package verifier additionally reports `nativeValidationRequired: true`.

The pinned profile is packaged under [assets/profiles/operations-v1](../assets/profiles/operations-v1/manifest.json). Its manifest and every shipped template/example are checked against compiled digests. The existing `specifications/v1` and native validator remain byte-for-byte unchanged.

## Examples and executable evidence

The public examples are deliberately synthetic:

- [Checkout design](../assets/profiles/operations-v1/examples/checkout.json): forward requirements define `Order`, `PaymentAuthorization` and `authorizesOrder`. The project extension requires the authorization to reference the order and its authorized amount to equal the nonnegative order amount. The operations interpretation remains a suspected payment dependency.
- [Archival export](../assets/profiles/operations-v1/examples/archive-export.json): a fixed synthetic reverse-source declaration defines `ExportJob`, `ExportManifest` and `manifestForJob`. The manifest must reference its job and its exported row count must equal the nonnegative source row count. An observed accounting symptom does not confirm its cause.

Each example ships separate project model and shape templates. These extend the same pinned operations definitions without becoming mandatory domain concepts for every project. The source-binding ledger maps every additional class, relation, property, shape and expected entity to its synthetic domain declaration. Their owner IDs and digests are placeholders. They are suitable for structural tests and must never be presented to a real workflow as receipts or decisions. Actual project evidence and SOPs remain private.

The source-checkout E2E suite at `tests/e2e/operations-profile.test.mjs` proves deterministic namespace instantiation, unchanged base-standard identity, both derivation directions, public/private source isolation and profile integrity. Tests are development files and are not included in the installed product package. Real pinned pySHACL executions run 12 cases in each domain: one positive, nine operations counterexamples and two domain counterexamples (wrong accounting value and wrong relation endpoint). They test every required shape, including wrong relation endpoints, absent owner digests, cross-project scope and confirmed causes lacking decision evidence. A missing toolchain fails the test; it is not silently skipped.

```sh
npm run build
EVOPILOT_TEST_NATIVE_TOOLCHAIN=/absolute/path/to/verified-toolchain.json \
  node --test tests/e2e/operations-profile.test.mjs
```

These profile-domain tests are a separate evidence layer from the parent response-flow fixtures; passing them does not claim that those exact domain packages were exercised by a Runtime repair. Parent response-flow E2E must additionally resolve live owner references, exercise actual action/recovery receipts, preserve FAIL/UNKNOWN under risk exceptions, and verify restart/backup behavior. Passing this profile suite alone does not establish those cross-product outcomes or real-project v1.0 readiness.
