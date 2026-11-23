import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, readFile, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gate, inspectGovernance } from '../../scripts/roadmap.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const profilePath = 'governance/limited-preview-v090.json';
const targetPath = 'governance/target-v090.json';
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const readJSON = async (dir, path) => JSON.parse(await readFile(join(dir, path), 'utf8'));
const writeJSON = (dir, path, value) => writeFile(join(dir, path), `${JSON.stringify(value, null, 2)}\n`);
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ontology-limited-governance-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(join(root, 'governance'), join(dir, 'governance'), { recursive: true });
  await cp(join(root, 'docs'), join(dir, 'docs'), { recursive: true });
  return dir;
}
async function rebind(dir, field, path) {
  const target = await readJSON(dir, targetPath);
  target[field] = digest(await readFile(join(dir, path)));
  await writeJSON(dir, targetPath, target);
}

test('parallel limited edition preserves the full contract and grants no acceptance or release authority', async () => {
  const result = await inspectGovernance();
  assert.equal(result.caseCount, 143);
  assert.equal(result.limitedPreviewDigest, digest(await readFile(join(root, profilePath))));
  assert.equal(result.limitedPreview.release.tag, 'v0.9.0');
  assert.equal(result.limitedPreview.release.prerelease, true);
  assert.equal(result.limitedPreview.acceptanceStatus, 'NOT_EVALUATED');
  assert.equal(result.limitedPreview.release.releaseAuthorized, false);
  assert.equal(result.limitedPreview.cases.length, 10);
  assert.ok(result.limitedPreview.cases.every(c => c.required && c.status === 'NOT_EVALUATED' && c.evidence.length === 0));
  // These original bound documents must remain byte-for-byte unchanged for this parallel edition.
  assert.equal(result.target.acceptanceDigest, 'sha256:b536bb5e63d2f4da02b9a8166a0f03dd3fdbe1181681e40cf7232a314972ffb8');
  assert.equal(result.target.planDigest, 'sha256:377cf0dba8e6f4648202b8afefca9e9c30c42f488b02fcbd3c174155a0255b6e');
  assert.equal(result.target.adrDigest, 'sha256:8255fe2f6840fa67ca619ab54d37cf4189930cad2cd36e80c39f2e5af5ccb95d');
  assert.equal(result.target.standardsGateDigest, 'sha256:819bc306352a053fbc406e129bde4cc2c80c09f0d4c78234db73d2d689ef850d');
  assert.equal(result.target.standardsProtocolDigest, 'sha256:9a63936555d805fd7b9ffccf541f5013ac5c512e272dcb4b43f692570f5cc7be');
  const scoped = await gate({ stage: 'P0', intent: 'Check limited governance scope', paths: [profilePath] });
  assert.equal(scoped.status, 'ALIGNED');
  assert.equal(scoped.caseCount, 143);
  assert.equal(scoped.acceptance, 'NOT_EVALUATED');
  assert.equal(scoped.releaseAuthorized, false);
  assert.equal(scoped.authority, false);
});

test('missing profile, missing binding and profile/document digest mismatch fail closed', async t => {
  const dir = await fixture(t);
  await rm(join(dir, profilePath));
  await assert.rejects(inspectGovernance(dir), /DEVIATION: missing bound document/);
  await cp(join(root, profilePath), join(dir, profilePath));
  const target = await readJSON(dir, targetPath);
  delete target.limitedPreviewPolicy;
  await writeJSON(dir, targetPath, target);
  await assert.rejects(inspectGovernance(dir), /DEVIATION: missing limited Preview profile binding/);
  await cp(join(root, targetPath), join(dir, targetPath));
  await appendFile(join(dir, profilePath), '\n');
  await assert.rejects(inspectGovernance(dir), /DEVIATION: limitedPreviewDigest drift/);
  await cp(join(root, profilePath), join(dir, profilePath));
  await appendFile(join(dir, 'docs/ontology-v090-limited-preview.md'), '\n');
  await assert.rejects(inspectGovernance(dir), /DEVIATION: limitedPreviewDocumentDigest drift/);
});

test('rehashing cannot relax required cases, standards admission, exclusions, platform or release authority', async t => {
  const dir = await fixture(t);
  const changes = [
    p => { p.cases.pop(); },
    p => { p.cases[1].phase = 'admission'; },
    p => { p.cases[5].required = false; },
    p => { p.cases[0].status = 'PASS'; p.cases[0].evidence = ['invented']; },
    p => { p.cases[4].expected = 'Skip permission checks'; },
    p => { p.standards.families.pop(); },
    p => { p.standards.owlProfile = 'OWL2_EL'; },
    p => { p.standards.completeReportRequired = false; },
    p => { p.standards.decisionBindings.pop(); },
    p => { p.standards.decisionSource = 'AGENT_ASSERTION'; },
    p => { p.standards.decisionLedger = 'review-ledger.json'; },
    p => { p.standards.decisionAction = 'APPROVE_PRODUCT_E2E'; },
    p => { p.standards.decisionSchema = 'ontology-standards-review/v1'; },
    p => { p.standards.decisionSourceSchema = 'ontology-user-review-source/v1'; },
    p => { p.standards.decisionScope = 'ENTER_ORIGINAL_PRODUCT_E2E_ONLY'; },
    p => { p.sequence.reverse(); },
    p => { p.evidence.preApprovalProductRuns = 'FORMAL'; },
    p => { p.evidence.productCasesRequiringReportApproval.pop(); },
    p => { p.evidence.zeroRequiredIsPass = true; },
    p => { p.evidence.missingUnknownFailedStaleOrMismatchedBlocks = false; },
    p => { p.deferred.pop(); },
    p => { p.runtimePolicy = 'ALL_FULL_APIS_DISABLED'; },
    p => { p.platform.os = 'darwin'; },
    p => { p.platform.arch = 'x64'; },
    p => { p.release.prerelease = false; },
    p => { p.release.tag = 'v0.9.0-preview.1'; },
    p => { p.release.exactCandidateDecisionRequired = false; },
    p => { p.release.releaseAuthorized = true; },
    p => { p.fullTarget.deferredIsPass = true; },
    p => { p.acceptanceStatus = 'PASS'; },
    p => { p.unsupportedOverride = 'permit'; },
  ];
  for (const mutate of changes) {
    const profile = await readJSON(root, profilePath);
    mutate(profile);
    await writeJSON(dir, profilePath, profile);
    await rebind(dir, 'limitedPreviewDigest', profilePath);
    await assert.rejects(inspectGovernance(dir), /DEVIATION: limited Preview contract changed/, String(mutate));
  }
});

test('rehashing cannot detach the limited Roadmap or replace the full standards prerequisite', async t => {
  const dir = await fixture(t);
  const path = 'governance/roadmap.json';
  for (const mutate of [
    r => { delete r.limitedPreview; },
    r => { r.limitedPreview.requiredCases = 8; },
    r => { r.limitedPreview.policy = 'governance/acceptance-v090.json'; },
    r => { r.milestones.find(m => m.id === 'P5').entryGate.policy = profilePath; },
  ]) {
    const roadmap = await readJSON(root, path);
    mutate(roadmap);
    await writeJSON(dir, path, roadmap);
    await rebind(dir, 'roadmapDigest', path);
    await assert.rejects(inspectGovernance(dir), /DEVIATION: limited Preview Roadmap binding changed|DEVIATION: missing formal E2E dependency/);
  }
});
