import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { PACKAGE_ROOT } from "./constants.mjs";

import { digest } from "./utils.mjs";

// Foreign Harness material validation only; no production API.
const SCHEMAS = {
  Taxonomy: "taxonomy-v1.schema.json",
  HarnessComponent: "harness-asset-v3.schema.json",
  HarnessProfile: "harness-asset-v3.schema.json",
  HarnessBundle: "harness-asset-v3.schema.json",
  "OntologyPack": "ontology-pack-v1.schema.json",
  "DomainOntologyPack": "professional-pack-v1.schema.json",
  "ProductOntologyPack": "professional-pack-v1.schema.json",
  "OrganizationOntologyPack": "professional-pack-v1.schema.json",
  "ProjectOntologyOverlay": "professional-pack-v1.schema.json",
  "ProjectOntologyArtifactSet": "project-ontology-artifact-set-v1.schema.json",
  "ProjectOntologySkill": "project-ontology-skill-v1.schema.json",
  "OntologyReasoningProfile": "ontology-reasoning-profile-v1.schema.json",
  "SemanticIndex": "semantic-index-v1.schema.json",
  "FederatedPackDiscovery": "federated-pack-discovery-v1.schema.json",
  "TerminalSemanticClosure": "terminal-semantic-closure-v1.schema.json"
};

const CONTRACT_SCHEMAS = {
  "evopilot-harness-classification-analysis-receipt/v1": "classification-analysis-receipt-v1.schema.json",
  "evopilot-harness-classification-evaluation-report/v1": "classification-evaluation-report-v1.schema.json",
  "evopilot-harness-classification-handoff/v1": "classification-handoff-v1.schema.json",
  "evopilot-harness-classification-session/v1": "classification-session-v1.schema.json",
  "evopilot-harness-resolved-taxonomy-snapshot/v1": "resolved-taxonomy-snapshot-v1.schema.json",
  "evopilot-harness-source-concept-hypothesis/v1": "source-concept-hypothesis-v1.schema.json",
  "evopilot-harness-source-descriptor/v1": "source-descriptor-v1.schema.json",
  "evopilot-harness-taxonomy-analysis-result/v1": "taxonomy-analysis-result-v1.schema.json",

  "evopilot-harness-semantic-catalog-pointer/v1": "semantic-catalog-pointer-v1.schema.json",
  "evopilot-harness-semantic-catalog/v1": "semantic-catalog-v1.schema.json",
  "evopilot-harness-semantic-catalog-receipt/v1": "semantic-catalog-receipt-v1.schema.json",
  "evopilot-harness-semantic-catalog-lock/v1": "semantic-catalog-lock-v1.schema.json",
  "evopilot-harness-semantic-catalog-recovery/v1": "semantic-catalog-recovery-v1.schema.json",
  "evopilot-harness-semantic-catalog-policy/v1": "semantic-catalog-policy-v1.schema.json",
  "evopilot-harness-ontology-foundation/v1": "ontology-foundation-v1.schema.json",
  "evopilot-harness-semantic-candidate-set/v1": "semantic-candidate-set-v1.schema.json",
  "evopilot-harness-ontology-grounding-result/v1": "ontology-grounding-result-v1.schema.json",
  "evopilot-harness-semantic-requirements/v1": "harness-semantic-requirements-v1.schema.json",
  "evopilot-harness-semantic-compatibility-report/v1": "semantic-compatibility-report-v1.schema.json",
  "evopilot-harness-resolved-professional-pack-set/v1": "resolved-professional-pack-set-v1.schema.json",
  "evopilot-harness-pack-lifecycle-record/v1": "pack-lifecycle-record-v1.schema.json",
  "evopilot-harness-pack-certification/v1": "pack-certification-v1.schema.json",
  "evopilot-harness-external-semantic-evidence/v1": "external-semantic-evidence-v1.schema.json",
  "evopilot-harness-project-ontology-proposal/v1": "project-ontology-proposal-v1.schema.json",
  "evopilot-harness-resolved-project-ontology-snapshot/v1": "resolved-project-ontology-snapshot-v1.schema.json",
  "evopilot-harness-project-ontology-projection-set/v1": "project-ontology-projection-set-v1.schema.json",
  "evopilot-harness-project-ontology-artifact-set/v1": "project-ontology-artifact-set-v1.schema.json",
  "evopilot-harness-project-ontology-skill/v1": "project-ontology-skill-v1.schema.json",
  "evopilot-harness-project-ontology-artifact-lifecycle/v1": "project-ontology-artifact-lifecycle-v1.schema.json",
  "evopilot-harness-professional-pack-inspection/v1": "professional-pack-inspection-v1.schema.json",
  "evopilot-harness-pack-benchmark/v1": "pack-benchmark-v1.schema.json",
  "evopilot-harness-pack-gold-case/v1": "pack-gold-case-v1.schema.json",
  "evopilot-harness-external-semantic-evidence-adapter/v1": "external-semantic-evidence-adapter-v1.schema.json",
  "evopilot-harness-ontology-reasoning-profile/v1": "ontology-reasoning-profile-v1.schema.json",
  "evopilot-harness-semantic-index/v1": "semantic-index-v1.schema.json",
  "evopilot-harness-affected-subgraph/v1": "affected-subgraph-v1.schema.json",
  "evopilot-harness-semantic-computation/v1": "semantic-computation-v1.schema.json",
  "evopilot-harness-federated-pack-discovery/v1": "federated-pack-discovery-v1.schema.json",
  "evopilot-harness-semantic-interoperability-projection-set/v1": "semantic-interoperability-projection-set-v1.schema.json",
  "evopilot-harness-semantic-round-trip-report/v1": "semantic-round-trip-report-v1.schema.json",
  "evopilot-harness-terminal-semantic-closure/v1": "terminal-semantic-closure-v1.schema.json",
  "evopilot-harness-terminal-semantic-slice/v1": "terminal-semantic-slice-v1.schema.json"
};

const validatorCache = new Map();

export function validateDocument(document, file = "<memory>") {
  if (document?.kind === "DomainHarnessPack") return { status: "FAILED", valid: false, file, kind: document.kind, errors: [{ path: "/kind", message: "Harness authoring is outside Ontology compatibility" }] };
  const schemaName = document?.schema != null
    ? (Object.hasOwn(CONTRACT_SCHEMAS, document.schema) ? CONTRACT_SCHEMAS[document.schema] : undefined)
    : (Object.hasOwn(SCHEMAS, document?.kind) ? SCHEMAS[document.kind] : undefined);
  if (!schemaName) return { status: "FAILED", valid: false, file, kind: document?.kind ?? null, errors: [{ path: "/kind", message: "unsupported Ontology compatibility document kind or contract schema" }] };
  let validate = validatorCache.get(schemaName);
  if (!validate) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const schemas = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "schemas/legacy/v1.json"), "utf8"));
    for (const [name, schema] of Object.entries(schemas)) if (name !== schemaName) ajv.addSchema(schema);
    validate = ajv.compile(schemas[schemaName]);
    validatorCache.set(schemaName, validate);
  }
  const valid = Boolean(validate(document));
  const semanticErrors = valid ? semanticClosureErrors(document) : [];
  const complete = valid && semanticErrors.length === 0;
  return {
    status: complete ? "VALIDATED" : "FAILED",
    valid: complete,
    file,
    kind: document.kind,
    id: document?.metadata?.id ?? null,
    version: document?.metadata?.version ?? null,
    errors: !valid ? (validate.errors ?? []).map((error) => ({
      path: error.instancePath || "/",
      keyword: error.keyword,
      message: error.message,
      params: error.params
    })) : semanticErrors
  };
}

function semanticClosureErrors(document) {
  const requirements = document?.kind === "HarnessBundle" ? document.spec?.semanticRequirements : null;
  if (!requirements) return [];
  const copy = structuredClone(requirements);
  delete copy.requirementsDigest;
  const actual = digest(copy);
  return actual === requirements.requirementsDigest ? [] : [{ path: "/spec/semanticRequirements/requirementsDigest", keyword: "immutableClosure", message: "must bind the canonical semantic requirements", params: { expected: actual } }];
}

