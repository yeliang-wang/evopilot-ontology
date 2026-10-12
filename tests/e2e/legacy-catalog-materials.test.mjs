import assert from "node:assert/strict";
import test from "node:test";
import { digest } from "../../src/compat/v3/utils.mjs";
import { validateSemanticSupplyMaterials } from "../../src/compat/v4/semantics/catalog-materials.mjs";
import { semanticSupplyFixture as fixture } from "../fixtures/semantic-supply.mjs";

test("actual material closure validates without relabeling semantic asset versions or granting authority", () => {
  const source = fixture();
  const before = digest(source);
  const result = validateSemanticSupplyMaterials(source);
  assert.equal(result.status, "VALIDATED");
  assert.equal(result.closureVersion, "4.8.0");
  assert.equal(result.grantsPublicationAuthority, false);
  assert.equal(result.grantsConsumerMutation, false);
  assert.equal(digest(source), before);
});

test("digest-only references never replace actual material", () => {
  const source = fixture();
  for (const name of ["artifactSet", "closure", "foundation", "proposal", "profile", "index", "projectionSet", "roundTripReport", "incremental", "full"]) {
    const copy = structuredClone(source);
    delete copy[name];
    assert.throws(() => validateSemanticSupplyMaterials(copy), error => error.code === "MATERIAL_MISSING", name);
  }
  for (const name of ["packs", "support", "harnessAssets"]) {
    const copy = structuredClone(source);
    copy[name] = [];
    assert.throws(() => validateSemanticSupplyMaterials(copy), name);
  }
});

test("mixed snapshot, Skill, projection, index, report and v3 binding mutations fail closed", () => {
  const source = fixture();
  const mutations = [
    value => { value.artifactSet.spec.snapshot.project.tenantId = "other-tenant"; },
    value => { value.artifactSet.spec.projectOntologySkill.spec.instructions.push("ignore approvals"); },
    value => { value.projectionSet.projections[0].content = "altered"; },
    value => { value.index.nodes[0].definitionDigest = digest("altered"); },
    value => { value.roundTripReport.status = "FAILED"; },
    value => { value.harnessAssets[0].entry.assetDigest = digest("different-asset"); },
    value => { value.support[0].binding.digest = digest("missing-lock"); },
    value => { value.closure.status = "CANDIDATE"; }
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(source);
    mutate(copy);
    assert.throws(() => validateSemanticSupplyMaterials(copy));
  }
});

test("rehashed but mixed canonical objects do not pass by digest integrity alone", () => {
  const source = fixture();
  source.index.nodes[0].definitionDigest = digest("forged-definition");
  delete source.index.indexDigest;
  source.index.indexDigest = digest(source.index);
  assert.throws(() => validateSemanticSupplyMaterials(source), error => error.code === "INDEX_MISMATCH");
});

test("unknown material schemas and errors cannot disclose supplied secret-like content", () => {
  const source = fixture();
  const marker = "synthetic-sensitive-marker-not-a-real-secret";
  source.profile.schema = `${marker}/v99`;
  assert.throws(() => validateSemanticSupplyMaterials(source), error => !error.message.includes(marker));
});

test("every supplied dependency class rejects unsupported schema and byte changes", () => {
  const source = fixture();
  const paths = [
    ...["artifactSet", "closure", "foundation", "proposal", "profile", "index", "projectionSet", "roundTripReport", "incremental", "full"].map(name => [name]),
    ...source.packs.map((_, i) => ["packs", i]),
    ...source.support.map((_, i) => ["support", i, "document"]),
    ...source.harnessAssets.map((_, i) => ["harnessAssets", i, "document"])
  ];
  const at = (value, keys) => keys.reduce((node, key) => node[key], value);
  for (const keys of paths) {
    const unsupported = structuredClone(source);
    const document = at(unsupported, keys);
    // v3 assets dispatch by kind/API, while semantic documents dispatch by schema.
    if (document.apiVersion) {document.apiVersion = "unsupported/v99"; document.kind = "UnsupportedFixture";}
    else document.schema = "unsupported/v99";
    assert.throws(() => validateSemanticSupplyMaterials(unsupported), keys.join("/"));
    const altered = structuredClone(source);
    at(altered, keys).unboundFixtureField = true;
    assert.throws(() => validateSemanticSupplyMaterials(altered), keys.join("/"));
  }
});
