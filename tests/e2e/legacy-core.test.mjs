import fs from "node:fs";
import { mock } from "node:test";
import { stringify } from "yaml";
import Ajv2020 from "ajv/dist/2020.js";
import * as compat from "../../src/compat/index.mjs";
import * as native from "../../dist/index.js";
import { resolveTaxonomy } from "../../src/compat/v4/classification/taxonomy.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "../../src/compat/v3/utils.mjs";
import { validateDocument } from "../../src/compat/v3/schema.mjs";
import { createSemanticCandidateSet, GROUNDING_OUTCOMES, resolveOntologyFoundation, resolveOntologyGrounding } from "../../src/compat/v4/semantics/ontology-grounding.mjs";

const evidenceIds = ["evidence-content", "evidence-dependency"];
const evidenceFamilies = ["lexical-content", "dependency"];

function hypothesis() {
  return { sourceSnapshotDigest: digest("source"), evidenceGraphDigest: digest("graph"), concepts: [] };
}

function candidate(candidateId, label, extra = {}) {
  return { candidateId, label, metaType: "CAPABILITY", evidenceIds, evidenceFamilies, deterministicSignals: [], uncertainty: "BOUNDED", ...extra };
}

test("v4.6 Foundation is minimal, bounded, deterministic, and contains no business values", () => {
  const first = resolveOntologyFoundation();
  const second = resolveOntologyFoundation();
  assert.deepEqual(first, second);
  assert.equal(first.authority.containsBusinessValues, false);
  assert.equal(first.authority.mayDecideEligibility, false);
  assert.deepEqual(first.metaTypes, ["ACTION", "ACTOR", "ATTRIBUTE", "CAPABILITY", "DATA_ASSET", "ENTITY", "EVENT", "PERMISSION", "RELATIONSHIP", "ROLE", "RULE", "STATE", "SYSTEM", "WORKFLOW"]);
  assert.equal(first.metaTypes.includes("BUSINESS_OBJECT"), false);
  assert.equal(first.businessValues, undefined);
  assert.throws(() => resolveOntologyFoundation({ metaTypes: ["CAPABILITY"] }), (error) => error.code === "ONTOLOGY_FOUNDATION_INVALID");
});

test("v4.6 Grounding Resolver emits exactly six finite outcomes with deterministic precedence", () => {
  const foundation = resolveOntologyFoundation();
  const candidateSet = createSemanticCandidateSet({
    sourceConceptHypothesis: hypothesis(),
    candidates: [
      candidate("resolved", "cache", { authoritativeConceptIds: ["cap.cache"] }),
      candidate("unresolved", "unknown"),
      candidate("ambiguous", "shared", { authoritativeConceptIds: ["cap.one", "cap.two"] }),
      candidate("conflicting", "unsafe", { conflictConceptIds: ["cap.blocked"] }),
      candidate("extension", "novel", { proposedExtension: { parentConceptId: "cap.root", definition: "A bounded novel capability." } }),
      candidate("insufficient", "weak", { evidenceIds: ["evidence-content"], evidenceFamilies: ["lexical-content"] })
    ]
  });
  const concepts = [
    { conceptId: "cap.root", label: "root", metaType: "CAPABILITY" },
    { conceptId: "cap.cache", label: "cache", metaType: "CAPABILITY" },
    { conceptId: "cap.one", label: "one", metaType: "CAPABILITY" },
    { conceptId: "cap.two", label: "two", metaType: "CAPABILITY" },
    { conceptId: "cap.blocked", label: "blocked", metaType: "CAPABILITY" }
  ];
  const result = resolveOntologyGrounding({ foundation, candidateSet, concepts });
  assert.equal(validateDocument(foundation).status, "VALIDATED");
  assert.equal(validateDocument(candidateSet).status, "VALIDATED");
  assert.equal(validateDocument(result).status, "VALIDATED");
  assert.deepEqual(new Set(result.results.map((item) => item.outcome)), new Set(GROUNDING_OUTCOMES));
  assert.deepEqual(result.precedence, ["EVIDENCE_INSUFFICIENT", "CONFLICTING_CONCEPT", "AMBIGUOUS_CONCEPT", "RESOLVED", "EXTENSION_REQUIRED", "UNRESOLVED_CONCEPT"]);
  assert.equal(result.results.every((item) => item.userActions.length > 0), true);
  assert.equal(result.presentation.title, "素材中的业务概念分析");
  assert.equal(result.presentation.hostAuthored, false);
  assert.equal(result.authority.provesHarnessEligibility, false);
  const replay = resolveOntologyGrounding({ foundation, candidateSet, concepts, expected: { foundationDigest: foundation.foundationDigest, candidateSetDigest: candidateSet.candidateSetDigest, conceptSetDigest: result.conceptSetDigest }, priorResults: [result] });
  assert.deepEqual(replay.priorResultDigests, [result.groundingResultDigest]);
  assert.throws(() => resolveOntologyGrounding({ foundation, candidateSet, concepts, expected: { conceptSetDigest: digest("drift") } }), (error) => error.code === "ONTOLOGY_CONTEXT_DRIFT");
});

test("v4.6 rejects LLM-owned authoritative concept identifiers", () => {
  assert.throws(() => createSemanticCandidateSet({ sourceConceptHypothesis: hypothesis(), candidates: [candidate("llm", "cache", { llmAdvice: { selectedConceptId: "cap.cache" } })] }), (error) => error.code === "LLM_AUTHORITY_REJECTED");
});



const declaration = {
  apiVersion: "harness.evopilot.io/v1", kind: "Taxonomy",
  metadata: { namespace: "test.example", name: "serialization", version: "1.0.0" },
  spec: {
    engineRange: ">=4.5.0 <5.0.0",
    requiredCapabilities: ["taxonomy-c14n/v1", "source-concept-hypothesis/v1", "open-world-taxonomy-classifier/v1", "taxonomy-decision-aggregate/v1"],
    axisPolicies: { domainCardinality: "SINGLE", productCardinality: "SINGLE" },
    domains: [{ id: "domain", label: "domain", assignable: false }],
    products: [{ id: "product", label: "product", assignable: false }]
  }
};

const virtualFiles = new Map();
const originalReadFileSync = fs.readFileSync;
mock.method(fs, "readFileSync", (file, ...args) => virtualFiles.has(String(file))
  ? virtualFiles.get(String(file)) : originalReadFileSync(file, ...args));
function fixture(text, extension = "yaml") {
  const file = "/ontology-test-input-" + virtualFiles.size + "." + extension;
  virtualFiles.set(file, Buffer.isBuffer(text) ? text : Buffer.from(text));
  return { root: file, file };
}
function removeFixture(file) { virtualFiles.delete(file); }

test("ordinary JSON and YAML retain identical canonical Taxonomy snapshots", () => {
  const yaml = fixture(stringify(declaration));
  const json = fixture(JSON.stringify(declaration), "json");
  try {
    assert.deepEqual(resolveTaxonomy(yaml.file), resolveTaxonomy(json.file));
    const quoted = structuredClone(declaration);
    quoted.spec.domains[0].label = "literal &anchor *alias !tag << text";
    const literal = fixture(stringify(quoted));
    try { assert.deepEqual(resolveTaxonomy(literal.file), resolveTaxonomy(quoted)); }
    finally { removeFixture(literal.root); }
  } finally {
    removeFixture(yaml.root);
    removeFixture(json.root);
  }
});

test("unsafe YAML forms fail at the readonly loader boundary", async () => {
  const yaml = stringify(declaration);
  const variants = [
    yaml.replace("kind: Taxonomy", "kind: &kind Taxonomy"),
    yaml.replace("kind: Taxonomy", "kind: *unbound"),
    yaml.replace("kind: Taxonomy", "kind: !LocalTag Taxonomy"),
    yaml.replace("metadata:\n", "metadata:\n  <<: { namespace: injected }\n"),
    yaml.replace("kind: Taxonomy", "kind: Taxonomy\nkind: Taxonomy"),
    `${yaml}\n---\nextra: true\n`
  ];
  for (const text of variants) {
    const { root, file } = fixture(text);;
    try {
      assert.throws(() => resolveTaxonomy(file), { code: "TAXONOMY_SERIALIZATION_UNSAFE" });
    } finally { removeFixture(root); }
  }
});

test("invalid UTF-8 in JSON or YAML is rejected at the readonly loader boundary", async () => {
  for (const extension of ["json", "yaml"]) {
    const document = structuredClone(declaration);
    document.spec.domains[0].label = "UTF8_SENTINEL";
    const text = extension === "json" ? JSON.stringify(document) : stringify(document);
    const [before, after] = text.split("UTF8_SENTINEL");
    for (const invalidBytes of [[0xc0, 0xaf], [0xc3, 0x28], [0xe2, 0x82]]) {
      const { root, file } = fixture(Buffer.concat([Buffer.from(before), Buffer.from(invalidBytes), Buffer.from(after)]), extension);
      try {
        assert.throws(() => resolveTaxonomy(file), { code: "TAXONOMY_SERIALIZATION_UNSAFE" });
      } finally { removeFixture(root); }
    }
  }
});

test("malformed JSON and non-finite JSON numbers produce typed serialization blockers", () => {
  const json = JSON.stringify(declaration);
  for (const text of [json + " trailing", json.replace('"label":"domain"', '"label":1e400'), json.replace('"label":"domain"', '"label":-1e400')]) {
    const { root, file } = fixture(text, "json");
    try { assert.throws(() => resolveTaxonomy(file), { code: "TAXONOMY_SERIALIZATION_UNSAFE" }); }
    finally { removeFixture(root); }
  }
});


test("compat namespaces remain separate from native-standard exports", () => {
  assert.deepEqual(Object.keys(compat).sort(), ["catalogBudget","catalogContract","catalogGeneration","catalogMaterials","catalogStore","catalogSupply","classification","classificationAdvisor","classificationEvaluation","classifier","grounding","interoperability","packs","projectOntology","sourceConcept","sourceDescriptor","taxonomy","validation"]);
  assert.equal(Object.keys(native).length, 33);
  assert.equal(compat.taxonomy.COMPATIBILITY_ENGINE_VERSION, "4.8.2");
  assert.throws(() => resolveTaxonomy({...declaration, spec: {...declaration.spec, engineRange: ">=5.0.0"}}), {code: "TAXONOMY_ENGINE_RANGE_UNSUPPORTED"});
});
function authorInput(kind = "DomainOntologyPack", harnessGuidance = []) {
  return {kind, metadata: {id: "test-domain", version: "1.0.0", namespace: "test.domain", root: "DOMAIN_TEAM", visibility: "DOMAIN", owner: "team", provenance: {author: "author", reviewers: [], approvers: [], publishers: [], sourceRefs: ["source://test"]}},
    spec: {concepts: [{conceptId: "test.domain:item", label: "Item", metaType: "ENTITY", definition: "An item.", evidenceRefs: ["source://item"]}], harnessGuidance}};
}
test("Ontology authoring rejects Harness kinds and guidance while retaining empty-field digests", () => {
  const {createProfessionalPack, validateProfessionalPack, resolveProfessionalPackSet} = compat.packs;
  assert.throws(() => createProfessionalPack(authorInput("DomainHarnessPack")), {code: "PACK_KIND_INVALID"});
  assert.throws(() => createProfessionalPack(authorInput("DomainOntologyPack", [{topic: "x", guidance: "y"}])), {code: "HARNESS_GUIDANCE_NOT_ALLOWED"});
  const pack = createProfessionalPack(authorInput());
  assert.deepEqual(pack.spec.harnessGuidance, []);
  const core = structuredClone(pack); delete core.metadata.digest;
  assert.equal(pack.metadata.digest, digest(core));
  for (const kind of compat.packs.PROFESSIONAL_PACK_KINDS) {
    assert.equal(validateDocument(createProfessionalPack(authorInput(kind))).valid, true);
  }
  const rejected = {...pack, kind: "DomainHarnessPack"};
  assert.throws(() => validateProfessionalPack(rejected), {code: "PACK_SCHEMA_INVALID"});
  assert.throws(() => resolveProfessionalPackSet({packs: [rejected]}), {code: "PACK_SCHEMA_INVALID"});
  assert.equal(validateDocument(rejected).valid, false);
  for (const kind of ["HarnessComponent", "HarnessProfile", "HarnessBundle", "EvaluationPack", "SemanticIndex", "OntologyReasoningProfile"]) {
    assert.equal(validateDocument({kind}).valid, false);
  }
  assert.throws(() => compat.packs.transitionPackLifecycle({action: "APPLY", actor: "author", actorRole: "PUBLISHER"}), {code: "PACK_LIFECYCLE_ROLE_INVALID"});
});
test("every bundled historical schema compiles strictly and enforces required fields", () => {
  const schemas = JSON.parse(fs.readFileSync(new URL("../../schemas/legacy/v1.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(schemas).sort(), ["affected-subgraph-v1.schema.json","classification-analysis-receipt-v1.schema.json","classification-evaluation-report-v1.schema.json","classification-handoff-v1.schema.json","classification-session-v1.schema.json","external-semantic-evidence-adapter-v1.schema.json","external-semantic-evidence-v1.schema.json","federated-pack-discovery-v1.schema.json","harness-asset-v3.schema.json","harness-semantic-requirements-v1.schema.json","ontology-foundation-v1.schema.json","ontology-grounding-result-v1.schema.json","ontology-pack-v1.schema.json","ontology-reasoning-profile-v1.schema.json","pack-benchmark-v1.schema.json","pack-certification-v1.schema.json","pack-gold-case-v1.schema.json","pack-lifecycle-record-v1.schema.json","professional-pack-inspection-v1.schema.json","professional-pack-v1.schema.json","project-ontology-artifact-lifecycle-v1.schema.json","project-ontology-artifact-set-v1.schema.json","project-ontology-projection-set-v1.schema.json","project-ontology-proposal-v1.schema.json","project-ontology-skill-v1.schema.json","resolved-professional-pack-set-v1.schema.json","resolved-project-ontology-snapshot-v1.schema.json","resolved-taxonomy-snapshot-v1.schema.json","semantic-candidate-set-v1.schema.json","semantic-catalog-lock-v1.schema.json","semantic-catalog-pointer-v1.schema.json","semantic-catalog-policy-v1.schema.json","semantic-catalog-receipt-v1.schema.json","semantic-catalog-recovery-v1.schema.json","semantic-catalog-v1.schema.json","semantic-compatibility-report-v1.schema.json","semantic-computation-v1.schema.json","semantic-index-v1.schema.json","semantic-interoperability-projection-set-v1.schema.json","semantic-round-trip-report-v1.schema.json","source-concept-hypothesis-v1.schema.json","source-descriptor-v1.schema.json","taxonomy-analysis-result-v1.schema.json","taxonomy-v1.schema.json","terminal-semantic-closure-v1.schema.json","terminal-semantic-slice-v1.schema.json"]);
  for (const [name, schema] of Object.entries(schemas)) {
    const ajv = new Ajv2020({strict: true, allErrors: true});
    for (const [other, dependency] of Object.entries(schemas)) if (other !== name) ajv.addSchema(dependency);
    const validate = ajv.compile(schema);
    assert.equal(validate({}), false, name);
    assert(validate.errors.some(error => error.keyword === "required"), name);
  }
});

test("unknown compatibility namespaces and wire kinds remain rejected", () => {
  for (const name of ["unknown", "harness", "engine", "lifecycle"]) assert.equal(Object.hasOwn(compat, name), false);
  for (const value of [{kind: "Unknown"}, {kind: "toString"}, {schema: "toString"}, {schema: "evopilot-harness-semantic-catalog/v999"}, {...compat.grounding.resolveOntologyFoundation(), schema: "unknown/v1"}]) assert.equal(validateDocument(value).valid, false);
});
