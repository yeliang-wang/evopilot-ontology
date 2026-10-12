import { digest } from "../../src/compat/v3/utils.mjs";
import { SEMANTIC_CATALOG_SCHEMA, contentPath, supplyBytes, withSupplyDigest } from "../../src/compat/v4/semantics/catalog-contract.mjs";
import { openSemanticCatalogStore } from "../../src/compat/v4/semantics/catalog-store.mjs";

const [root, id, crashAt] = process.argv.slice(2);
let validations = 0;
const document = {schema: "synthetic-store-fixture/v1", id, content: "not a product semantic closure"};
const bytes = supplyBytes(document);
const hash = digest(bytes);
const entry = {kind: "Fixture", id, version: "1.0.0", schema: document.schema, objectDigest: digest(document),
  fileDigest: hash, path: contentPath("materials", hash), bytes: bytes.length,
  scope: {tenantId: "tenant", workspaceId: "workspace", projectId: "project"}, visibility: "PRIVATE",
  provenance: {source: "synthetic-only"}, dependencies: [], parent: null};
const generation = withSupplyDigest({schema: SEMANTIC_CATALOG_SCHEMA, catalogId: "organization", entries: [entry], revokedDigests: []}, "generationDigest");
const store = await openSemanticCatalogStore({catalog: {id: "organization", root, enabled: true, permission: "GRANTED", kind: "ORGANIZATION"},
  policy: {authorize: async ({receipt}) => receipt.authorization.authorizationDigest === digest("fixture-approval"), permitEntry: async () => true},
  validateMaterials: ({generation: value, material}) => {
    if (++validations === 2 && crashAt === "before-pointer") process.exit(86);
    return value.entries.every(item => digest(material.get(item.path)) === item.objectDigest);
  }});
try {
  const result = await store.publish({generation, material: new Map([[entry.path, document]]), requestId: id, expectedHead: null,
    authorization: {decision: "AUTHORIZED", actor: "fixture-publisher", authorizationDigest: digest("fixture-approval")}});
  if (crashAt === "after-pointer") process.exit(87);
  process.stdout.write(JSON.stringify({status: result.status}));
} catch (error) { process.stdout.write(JSON.stringify({status: error.code})); }
