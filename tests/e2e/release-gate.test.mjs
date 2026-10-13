import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { repositories, validateInputs, validateRun, validateArtifact, validateDigest,
  parentFiles, validateArchiveNames, validateChecksums, validateRevision, validatePack,
  tarball, sha256, releaseNotes, validateAbsence } from '../../scripts/release-gate.mjs';

const input = { repository: 'yeliang-wang/evopilot', expectedCommit: 'd4a9201169a82c36875bf6bc28c784fb3fb7122a',
  sourceRunId: '38328075766', expectedDigest: 'dffe37b209fed4d9a8d9da83a43b834d78e7a5532917ef0a0b265b9107158002',
  publish: 'false', decisionRef: '' };
const pkg = { name: '@evopilot-next/stack', version: '0.1.0' };
// Fixtures use the retained source run identifiers; no network or publication.
const run = { id: 38328075766, repository: { full_name: input.repository, id: 1416267165 },
  head_repository: { id: 1416267165 }, head_sha: input.expectedCommit,
  path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success', event: 'push' };
const artifact = { id: 11781746590, name: `evopilot-0.1.0-preview-${input.expectedCommit}`, expired: false,
  digest: 'sha256:' + input.expectedDigest,
  workflow_run: { id: run.id, head_sha: input.expectedCommit, repository_id: 1416267165, head_repository_id: 1416267165 } };
const metadata = a => ({ total_count: 1, artifacts: [a] });
test('retained positive metadata is technical validation only', () => {
  assert.deepEqual(validateRun(run, input, input.expectedCommit, pkg), {
    technicalValidation: true, authority: false, expectedCommit: input.expectedCommit,
  });
  assert.equal(validateArtifact(metadata(artifact), input), 11781746590);
  for (const event of ['push', 'workflow_dispatch', 'pull_request']) validateRun({ ...run, event }, input, input.expectedCommit, pkg);
});
for (const [name, change] of Object.entries({
  repository: { repository: { ...run.repository, full_name: 'attacker/evopilot' } },
  repositoryID: { repository: { ...run.repository, id: 1 } },
  SHA: { head_sha: 'a'.repeat(40) }, runID: { id: 2 },
  ownReleaseWorkflow: { path: '.github/workflows/release.yml' }, CIpath: { path: 'ci.yml' },
  status: { status: 'in_progress' }, conclusion: { conclusion: 'failure' }, event: { event: 'release' },
  fork: { event: 'pull_request', head_repository: { id: 1 } },
  missingForkIdentity: { event: 'pull_request', head_repository: null },
})) test('reject source ' + name, () => assert.throws(() => validateRun({ ...run, ...change }, input, input.expectedCommit, pkg)));
test('exact checkout, package identity and version', () => {
  assert.throws(() => validateRun(run, input, 'a'.repeat(40), pkg));
  assert.throws(() => validateRun(run, input, input.expectedCommit, { ...pkg, version: '1.0.0' }));
  assert.throws(() => validateRun(run, input, input.expectedCommit, { ...pkg, name: 'other' }));
  for (const [repository, id] of Object.entries(repositories)) {
    const i = { ...input, repository }, owner = validateInputs(i);
    validateRun({ ...run, repository: { full_name: repository, id }, head_repository: { id } }, i, input.expectedCommit,
      { name: '@evopilot-next/' + owner, version: '0.1.0' });
  }
});
for (const [name, change] of Object.entries({ name: { name: 'wrong' }, expiry: { expired: true },
  hash: { digest: 'sha256:' + '0'.repeat(64) }, id: { id: '../escape' },
  SHA: { workflow_run: { ...artifact.workflow_run, head_sha: 'a'.repeat(40) } },
  repositoryID: { workflow_run: { ...artifact.workflow_run, repository_id: 1 } },
  headRepositoryID: { workflow_run: { ...artifact.workflow_run, head_repository_id: 1 } },
  runID: { workflow_run: { ...artifact.workflow_run, id: 1 } },
})) test('reject artifact ' + name, () => assert.throws(() => validateArtifact(metadata({ ...artifact, ...change }), input)));
test('artifact ambiguity and incomplete pagination fail closed', () => {
  assert.throws(() => validateArtifact({ total_count: 2, artifacts: [artifact, artifact] }, input));
  assert.throws(() => validateArtifact({ total_count: 2, artifacts: [artifact] }, input));
  assert.throws(() => validateArtifact({ total_count: 0, artifacts: [] }, input));
});
test('strict inputs and decision reference syntax do not imply authority', () => {
  for (const change of [{ expectedCommit: 'A'.repeat(40) }, { expectedCommit: input.expectedCommit + '\n' },
    { sourceRunId: '0' }, { sourceRunId: '01' }, { sourceRunId: '1;echo bad' },
    { sourceRunId: '99999999999999999999' }, { expectedDigest: 'A'.repeat(64) },
    { repository: 'yeliang-wang/other' }, { publish: 'yes' }, { publish: 'true', decisionRef: ' \n' }]) {
    assert.throws(() => validateInputs({ ...input, ...change }));
  }
  assert.equal(validateInputs({ ...input, publish: 'true', decisionRef: 'external-reviewed-reference' }), 'stack');
});
test('ZIP bytes are pinned and archive paths strictly allowlisted', () => {
  const bytes = Buffer.from('fixture zip bytes'); validateDigest(bytes, sha256(bytes));
  assert.throws(() => validateDigest(bytes, input.expectedDigest));
  validateArchiveNames(parentFiles); validateArchiveNames([...parentFiles, 'runtime/', 'harness/', 'ontology/']);
  for (const names of [[...parentFiles, '../escape'], [...parentFiles, 'private.json'],
    [...parentFiles, parentFiles[0]], parentFiles.slice(1)]) assert.throws(() => validateArchiveNames(names));
});
test('checksums cover every original file exactly once', () => {
  const files = new Map(parentFiles.filter(n => n !== 'SHA256SUMS').map(n => [n, Buffer.from(n)]));
  const sums = [...files].map(([n, b]) => `${sha256(b)}  ${n}\n`).join('');
  files.set('SHA256SUMS', Buffer.from(sums)); validateChecksums(files);
  for (const text of [sums + sums.split('\n')[0] + '\n', sums.replace('runtime/', '../'), sums.split('\n').slice(1).join('\n')]) {
    assert.throws(() => validateChecksums(new Map(files).set('SHA256SUMS', Buffer.from(text))));
  }
  assert.throws(() => validateChecksums(new Map(files).set(parentFiles[0], Buffer.from('changed'))));
});
test('revision records match parent and all three gitlinks', () => {
  const links = { runtime: 'a'.repeat(40), harness: 'b'.repeat(40), ontology: 'c'.repeat(40) };
  const revision = input.expectedCommit + '\n' + Object.entries(links).map(([o, s]) => ` ${s} projects/evopilot-${o} (heads/main)\n`).join('');
  validateRevision(revision, input.expectedCommit, links);
  for (const text of [revision.replace(input.expectedCommit, links.runtime), revision.replace(links.harness, links.runtime),
    revision.replace(' projects/evopilot-runtime', ' projects/evopilot-other'), revision.replace('\n ', '\n+'), revision + 'extra\n']) {
    assert.throws(() => validateRevision(text, input.expectedCommit, links));
  }
});
test('child pack filenames are exact and notes contain only public references', () => {
  for (const owner of ['runtime', 'harness', 'ontology']) {
    const pack = { name: '@evopilot-next/' + owner, version: '0.1.0', filename: tarball(owner) };
    assert.equal(validatePack([pack], owner), tarball(owner));
    for (const change of [{ filename: '../' + pack.filename }, { version: '1.0.0' }, { name: 'wrong' }]) {
      assert.throws(() => validatePack([{ ...pack, ...change }], owner));
    }
  }
  const notes = releaseNotes({ ...input, decisionRef: '/private/operator-evidence' }, 'stack');
  assert(!notes.includes('/private/')); assert(notes.includes(input.expectedCommit)); assert(notes.includes('24.14.0'));
});
test('common workflow separates preparation from publication without inline input shell code', () => {
  const yaml = fs.readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
  assert.match(yaml, /name: Preview release preparation/);
  assert.match(yaml, /cancel-in-progress: false/);
  assert.match(yaml, /publish:\n    if: \$\{\{ inputs.publish \}\}\n    needs: prepare/);
  assert.equal((yaml.match(/contents: write/g) ?? []).length, 1);
  for (const line of yaml.split('\n').filter(l => /run:/.test(l))) assert(!line.includes('${{'));
  assert.match(yaml, /actions\/download-artifact@v4/);
});
test('remote mutations require definitive absence; existing and uncertain outcomes fail', () => {
  validateAbsence('HTTP/2.0 404 Not Found\n\n{"message":"Not Found"}', 1);
  for (const [response, status] of [['HTTP/2.0 200 OK', 0], ['HTTP/2.0 403 Forbidden', 1],
    ['HTTP/2.0 500 Server Error', 1], ['', 1], ['HTTP/2.0 404 Not Found', null], ['HTTP/2.0 404 Not Found', 0]]) {
    assert.throws(() => validateAbsence(response, status), /inspect-existing-before-retry/);
  }
});
