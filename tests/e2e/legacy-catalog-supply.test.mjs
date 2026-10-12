import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {digest} from '../../src/compat/v3/utils.mjs';
import {parse, stringify} from 'yaml';
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const writeYaml = (file, value) => fs.writeFileSync(file, stringify(value));
const readYaml = file => parse(fs.readFileSync(file, 'utf8'));
import {assembleSemanticGeneration} from '../../src/compat/v4/semantics/catalog-generation.mjs';
import {SEMANTIC_POLICY_SCHEMA,semanticPublicationSubject} from '../../src/compat/v4/semantics/catalog-supply.mjs';
import {semanticSupplyFixture} from '../fixtures/semantic-supply.mjs';

// External synthetic Workspace only; never writes a repository Catalog.
function preparedSemanticSupply(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "semantic-supply-integration-")));
  t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  fs.mkdirSync(path.join(home, "catalogs/organization"), {recursive: true});
  writeYaml(path.join(home, "config.yaml"), {catalogs: {organization: "./catalogs/organization"}});
  writeYaml(path.join(home, "harness-registry.yaml"), {schema: "evopilot-harness-registry/v2", catalogs: [{id: "organization", root: "./catalogs/organization", enabled: true}]});
  const set = semanticSupplyFixture();
  const organization = path.join(home, "catalogs/organization");
  const foreign = JSON.parse(fs.readFileSync(new URL("../fixtures/harness-materials.json", import.meta.url), "utf8"));
  for (const [i, item] of set.harnessAssets.entries()) {
    item.entry.assetPath = "./assets/" + i + ".yaml";
    fs.mkdirSync(path.join(organization, "assets"), {recursive: true});
    fs.writeFileSync(path.join(organization, item.entry.assetPath), foreign.materials[i].originalBytes);
  }
  // Read-only legacy membership fixture, not a Harness publication API.
  const body = {schema: "evopilot-harness-catalog/v3", catalogId: "organization", generatedBy: "evopilot-harness", assetApiVersion: "harness.evopilot.io/v3", entryCount: set.harnessAssets.length, entries: set.harnessAssets.map(item => item.entry)};
  const index = {...body, catalogDigest: digest(body)};
  const fence = String.fromCharCode(96).repeat(3);
  const markdown = fence + "yaml evopilot-harness-catalog-v3\n" + stringify(index) + fence + "\n";
  fs.writeFileSync(path.join(organization, "CATALOG.md"), markdown);
  writeJson(path.join(organization, "catalog.lock.json"), {...index, markdownDigest: digest(markdown)});
  const input = {schema: "evopilot-harness-semantic-supply-input/v1", sets: [set]};
  const built = assembleSemanticGeneration({catalogId: "organization", sets: input.sets});
  const publication = {decision: "AUTHORIZED", actor: "fixture-publisher", authorizationDigest: digest("synthetic-catalog-decision")};
  const policy = {schema: SEMANTIC_POLICY_SCHEMA, catalogs: [{id: "organization", permission: "GRANTED", trustContext: "synthetic-local",
    rootBindingDigest: digest({id: "organization", root: "./catalogs/organization"}),
    scopes: [{scope: built.generation.sets[0].scope, visibilities: ["PUBLIC", "DOMAIN", "PRIVATE"]}],
    grants: [
      {...set.artifactSet.spec.publication, purpose: "ASSET_PUBLICATION", subjectDigest: set.artifactSet.artifactSetDigest, revoked: false, expiresAt: null},
      {...set.closure.publication, purpose: "ASSET_PUBLICATION", subjectDigest: set.closure.closureDigest, revoked: false, expiresAt: null},
      {...publication, purpose: "CATALOG_PUBLICATION", subjectDigest: semanticPublicationSubject({catalogId: "organization",
        generationDigest: built.generation.generationDigest, expectedHead: null, requestId: "first"}), revoked: false, expiresAt: null}
    ]}]};
  const configFile = path.join(home, "config.yaml");
  writeYaml(configFile, {...readYaml(configFile), semanticCatalogPolicy: "./semantic-catalog-policy.json"});
  writeJson(path.join(home, "semantic-catalog-policy.json"), policy);
  writeJson(path.join(home, "input.json"), input);
  const request = {home, action: "publish", catalogId: "organization", file: "input.json", inputDigest: digest(input),
    expectedGenerationDigest: built.generation.generationDigest, expectedHead: "EMPTY", requestId: "first", publication};
  return {home, organization, input, built, policy, request};
}

import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {semanticCatalogOperation as operation, semanticRecoverySubject} from '../../src/compat/v4/semantics/catalog-supply.mjs';

function grant(setup, subjectDigest, purpose = 'CATALOG_PUBLICATION') {
  setup.policy.catalogs[0].grants.push({...setup.request.publication, purpose, subjectDigest, revoked: false, expiresAt: null});
  writeJson(path.join(setup.home, 'semantic-catalog-policy.json'), setup.policy);
}
test('explicit Ontology home prepares, previews, publishes and retains exact request receipt', async t => {
  const s = preparedSemanticSupply(t);
  const preview = await operation({...s.request, action: 'preview'});
  assert.equal(preview.status, 'READY');
  assert.equal(preview.grantsPublicationAuthority, false);
  assert.equal(preview.generationDigest, s.built.generation.generationDigest);
  await assert.rejects(operation({...s.request, publication: undefined}), {code: 'WIRE_SCHEMA_INVALID'});
  await assert.rejects(operation({...s.request, publication: {...s.request.publication, authorizationDigest: digest('not-granted')}}), {code: 'PERMISSION_DENIED'});
  const scopes = s.policy.catalogs[0].scopes;
  s.policy.catalogs[0].scopes = [];
  writeJson(path.join(s.home, 'semantic-catalog-policy.json'), s.policy);
  await assert.rejects(operation({...s.request, action: 'preview'}), {code: 'PERMISSION_DENIED'});
  s.policy.catalogs[0].scopes = scopes;
  writeJson(path.join(s.home, 'semantic-catalog-policy.json'), s.policy);
  const published = await operation(s.request);
  assert.equal(published.status, 'PUBLISHED');
  const read = () => operation({home: s.home, action: 'readback', requestId: 'first'});
  const receipt = await read();
  assert.equal(receipt.status, 'COMMITTED');
  assert.deepEqual(receipt.receipt, published.receipt);
  assert.deepEqual(await read(), receipt);
  await assert.rejects(operation(s.request), {code: 'CONFLICT'});
  grant(s, semanticPublicationSubject({catalogId: 'organization', generationDigest: s.built.generation.generationDigest, expectedHead: null, requestId: 'conflict'}));
  await assert.rejects(operation({...s.request, requestId: 'conflict'}), {code: 'CONFLICT'});
  assert.equal((await operation({home: s.home, action: 'inspect'})).status, 'AVAILABLE');
});
test('rollback and revoke bind transition preview and preserve revocations', async t => {
  const s = preparedSemanticSupply(t);
  const first = await operation(s.request);
  let head = first.pointer.pointerDigest;
  for (const action of ['rollback', 'revoke']) {
    const extra = action === 'rollback' ? {targetPointerDigest: first.pointer.pointerDigest} : {revokedDigests: [s.input.sets[0].closure.closureDigest]};
    const preview = await operation({home: s.home, action: 'transition-preview', transition: action.toUpperCase(), expectedHead: head, ...extra});
    assert.equal(preview.status, 'READY');
    assert.equal(preview.grantsPublicationAuthority, false);
    grant(s, semanticPublicationSubject({catalogId: 'organization', generationDigest: preview.generationDigest, expectedHead: head, action: action.toUpperCase(), requestId: action, transitionDigest: preview.transitionDigest}));
    const result = await operation({home: s.home, action, expectedHead: head, expectedGenerationDigest: preview.generationDigest, requestId: action, publication: s.request.publication, ...extra});
    assert.equal(result.status, 'PUBLISHED');
    assert.equal(result.receipt.action, action.toUpperCase());
    assert.equal((await operation({home: s.home, action: 'readback', requestId: action})).status, 'COMMITTED');
    head = result.pointer.pointerDigest;
  }
});
for (const [stage, exit, outcome] of [['before-pointer', 86, 'NOT_COMMITTED'], ['after-pointer', 87, 'COMMITTED']]) {
  test('crash recovery and response loss: ' + stage, async t => {
    const s = preparedSemanticSupply(t);
    writeJson(path.join(s.home, 'fixture-request.json'), s.request);
    const child = spawnSync(process.execPath, [new URL('../fixtures/semantic-supply-crash.mjs', import.meta.url).pathname, s.home, stage], {encoding: 'utf8', timeout: 20000});
    assert.equal(child.status, exit, child.stderr || child.stdout);
    const inspection = await operation({home: s.home, action: 'recovery-inspect'});
    assert.equal(inspection.status, 'RECOVERABLE');
    assert.equal(inspection.grantsRecoveryAuthority, false);
    const request = {home: s.home, action: 'recover', expectedLockDigest: inspection.lockDigest, expectedHead: inspection.expectedHead ?? 'EMPTY', recoveryId: 'recover-first', publication: s.request.publication};
    grant(s, semanticRecoverySubject({catalogId: 'organization', lockDigest: inspection.lockDigest, expectedHead: inspection.expectedHead, recoveryId: request.recoveryId}), 'CATALOG_RECOVERY');
    const recovered = await operation(request);
    assert.equal(recovered.status, 'RECOVERED');
    assert.equal(recovered.record.publicationOutcome, outcome);
    assert.equal(recovered.mutationReplayed, false);
    const readback = await operation({home: s.home, action: 'recovery-readback', recoveryId: request.recoveryId});
    assert.deepEqual(readback.record, recovered.record);
    assert.deepEqual((await operation(request)).record, recovered.record);
    if (outcome === 'COMMITTED') assert.equal((await operation({home: s.home, action: 'readback', requestId: 'first'})).status, 'COMMITTED');
  });
}
