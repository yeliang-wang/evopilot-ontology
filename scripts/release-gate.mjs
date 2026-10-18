import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const repositories = Object.freeze({
  'yeliang-wang/evopilot': 1416267165,
  'yeliang-wang/evopilot-runtime': 1416265295,
  'yeliang-wang/evopilot-harness': 1416266281,
  'yeliang-wang/evopilot-ontology': 1416266852,
});
const owners = ['runtime', 'harness', 'ontology'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const tarball = owner => `evopilot-next-${owner}-0.5.0.tgz`;
export function validateInputs(input) {
  assert(Object.hasOwn(repositories, input.repository), 'Repository not allowed');
  assert.match(input.expectedCommit, /^[a-f0-9]{40}$/);
  assert.equal(input.expectedCommit.length, 40);
  assert.match(input.sourceRunId, /^[1-9][0-9]*$/);
  assert(Number.isSafeInteger(Number(input.sourceRunId)), 'Invalid run ID');
  assert.equal(String(Number(input.sourceRunId)), input.sourceRunId);
  assert.match(input.expectedDigest, /^[a-f0-9]{64}$/);
  assert.equal(input.expectedDigest.length, 64);
  assert(['true', 'false'].includes(input.publish), 'Invalid publish input');
  assert.equal(typeof input.decisionRef, 'string');
  if (input.publish === 'true') assert(input.decisionRef.trim(), 'Explicit reviewed decision_ref required');
  return input.repository === 'yeliang-wang/evopilot' ? 'stack' : input.repository.split('-').at(-1);
}
export function validateRun(run, input, head, pkg) {
  const owner = validateInputs(input);
  assert.equal(head, input.expectedCommit, 'Checkout HEAD mismatch');
  assert.equal(pkg.version, '0.5.0');
  assert.equal(pkg.name, '@evopilot-next/' + owner);
  assert.equal(run.id, Number(input.sourceRunId));
  assert.equal(run.repository?.full_name, input.repository);
  assert.equal(run.repository?.id, repositories[input.repository], 'Repository ID mismatch');
  assert.equal(run.head_sha, input.expectedCommit);
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'success');
  assert.equal(run.path, '.github/workflows/ci.yml', 'Source must be ci.yml');
  assert(['push', 'workflow_dispatch', 'pull_request'].includes(run.event), 'Invalid source event');
  if (run.event === 'pull_request') assert.equal(run.head_repository?.id, repositories[input.repository], 'Foreign PR');
  return { technicalValidation: true, authority: false, expectedCommit: head };
}
export function validateArtifact(metadata, input) {
  validateInputs(input);
  assert.equal(input.repository, 'yeliang-wang/evopilot');
  assert.equal(metadata.total_count, metadata.artifacts?.length, 'Incomplete artifact metadata');
  const matches = metadata.artifacts.filter(a => a.name === `evopilot-0.5.0-preview-${input.expectedCommit}`);
  assert.equal(matches.length, 1, 'Expected exactly one named artifact');
  const a = matches[0];
  assert(Number.isSafeInteger(a.id) && a.id > 0);
  assert.equal(a.expired, false);
  assert.equal(a.workflow_run?.id, Number(input.sourceRunId));
  assert.equal(a.workflow_run?.head_sha, input.expectedCommit);
  assert.equal(a.workflow_run?.repository_id, repositories[input.repository]);
  assert.equal(a.workflow_run?.head_repository_id, repositories[input.repository]);
  assert.equal(a.digest, 'sha256:' + input.expectedDigest);
  return a.id;
}
export function validateDigest(bytes, expected) {
  assert.match(expected, /^[a-f0-9]{64}$/);
  assert.equal(expected.length, 64);
  assert.equal(sha256(bytes), expected, 'SHA256 mismatch');
}
export const parentFiles = ['evopilot-0.5.0-preview.tar.gz', ...owners.map(o => `${o}/${tarball(o)}`),
  'harness/dependency-lock.json', 'ontology/dependency-lock.json', 'source-revision.txt', 'SHA256SUMS'];
export function validateArchiveNames(names) {
  assert.equal(new Set(names).size, names.length, 'Duplicate ZIP path');
  assert.deepEqual(names.filter(n => !owners.map(o => o + '/').includes(n)).sort(), [...parentFiles].sort(), 'ZIP path allowlist mismatch');
}
export function validateChecksums(files) {
  const lines = files.get('SHA256SUMS').toString().trimEnd().split('\n');
  const seen = new Set();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([a-zA-Z0-9./-]+)$/.exec(line);
    assert(match, 'Invalid checksum line');
    const [, digest, name] = match;
    assert(name !== 'SHA256SUMS' && files.has(name) && !seen.has(name), 'Unexpected checksum path');
    seen.add(name); validateDigest(files.get(name), digest);
  }
  assert.deepEqual([...seen].sort(), [...files.keys()].filter(n => n !== 'SHA256SUMS').sort(), 'Incomplete checksums');
}
export function validateRevision(text, commit, gitlinks) {
  const lines = text.split('\n');
  assert.equal(lines.pop(), '', 'Revision record must end with newline');
  assert.equal(lines.shift(), commit);
  assert.equal(lines.length, 3);
  const actual = {};
  for (const line of lines) {
    const m = /^ ([a-f0-9]{40}) projects\/evopilot-(runtime|harness|ontology)(?: \([^\r\n]*\))?$/.exec(line);
    assert(m && !Object.hasOwn(actual, m[2]), 'Invalid submodule revision');
    actual[m[2]] = m[1];
  }
  assert.deepEqual(actual, gitlinks, 'Gitlink mismatch');
}
export function validatePack(records, owner) {
  assert(owners.includes(owner));
  assert(Array.isArray(records) && records.length === 1);
  assert.equal(records[0].name, '@evopilot-next/' + owner);
  assert.equal(records[0].version, '0.5.0');
  assert.equal(records[0].filename, tarball(owner));
  return records[0].filename;
}
function command(name, args, options = {}) {
  const result = spawnSync(name, args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...options });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${name} failed; inspect retained evidence before retry: ${result.stderr}`);
  return result.stdout;
}
const read = filename => { assert(fs.lstatSync(filename).isFile() && !fs.lstatSync(filename).isSymbolicLink()); return fs.readFileSync(filename); };
const write = (filename, bytes) => fs.writeFileSync(filename, bytes, { flag: 'wx' });
const api = endpoint => JSON.parse(command('gh', ['api', endpoint]));
function environment() {
  const e = process.env;
  return { repository: e.GITHUB_REPOSITORY, expectedCommit: e.EXPECTED_COMMIT, sourceRunId: e.SOURCE_RUN_ID,
    expectedDigest: e.EXPECTED_DIGEST, publish: e.PUBLISH, decisionRef: e.DECISION_REF };
}
export function assetNames(owner) {
  return owner === 'stack' ? ['evopilot-0.5.0-preview.tar.gz', ...owners.map(tarball),
    'harness-dependency-lock.json', 'ontology-dependency-lock.json', 'source-revision.txt', 'SHA256SUMS']
    : [tarball(owner), ...(owner === 'runtime' ? [] : [owner + '-dependency-lock.json']), 'source-revision.txt', 'SHA256SUMS'];
}
function checksumText(files) {
  return [...files].map(([name, bytes]) => `${sha256(bytes)}  ${name}\n`).join('');
}
function prepare(input, owner, out) {
  const evidence = path.join(process.env.RUNNER_TEMP, 'release-evidence'); fs.mkdirSync(evidence);
  const run = api(`repos/${input.repository}/actions/runs/${input.sourceRunId}`);
  write(path.join(evidence, 'source-run.json'), JSON.stringify(run, null, 2));
  validateRun(run, input, command('git', ['rev-parse', 'HEAD']).trim(), JSON.parse(read('package.json')));
  fs.mkdirSync(out);
  const files = new Map();
  if (owner === 'stack') {
    const metadata = api(`repos/${input.repository}/actions/runs/${input.sourceRunId}/artifacts?per_page=100`);
    write(path.join(evidence, 'artifacts.json'), JSON.stringify(metadata, null, 2));
    const id = validateArtifact(metadata, input), zip = path.join(evidence, 'source.zip');
    const fd = fs.openSync(zip, 'wx');
    try { command('gh', ['api', `repos/${input.repository}/actions/artifacts/${id}/zip`], { stdio: ['ignore', fd, 'pipe'] }); }
    finally { fs.closeSync(fd); }
    validateDigest(read(zip), input.expectedDigest);
    validateArchiveNames(command('unzip', ['-Z1', zip]).trimEnd().split('\n'));
    // Read allowlisted entries as bytes; never let ZIP paths or symlinks write to disk.
    for (const name of parentFiles) files.set(name, command('unzip', ['-p', zip, name], { encoding: null }));
    validateChecksums(files);
    const gitlinks = {};
    for (const o of owners) {
      const entry = command('git', ['ls-tree', 'HEAD', '--', `projects/evopilot-${o}`]);
      const m = /^160000 commit ([a-f0-9]{40})\tprojects\/evopilot-(runtime|harness|ontology)\n$/.exec(entry);
      assert(m && m[2] === o, 'Missing gitlink'); gitlinks[o] = m[1];
    }
    validateRevision(files.get('source-revision.txt').toString(), input.expectedCommit, gitlinks);
    files.delete('SHA256SUMS');
    for (const [name, bytes] of [...files]) if (name.includes('/')) {
      files.delete(name);
      files.set(name.endsWith('/dependency-lock.json') ? name.split('/')[0] + '-dependency-lock.json' : path.basename(name), bytes);
    }
  } else {
    const pack = path.join(process.env.RUNNER_TEMP, 'child-pack'); fs.mkdirSync(pack);
    command('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    command('npm', ['run', 'build']);
    const filename = validatePack(JSON.parse(command('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', pack])), owner);
    const bytes = read(path.join(pack, filename)); validateDigest(bytes, input.expectedDigest); files.set(filename, bytes);
    if (owner !== 'runtime') files.set(owner + '-dependency-lock.json', read('package-lock.json'));
    files.set('source-revision.txt', Buffer.from(input.expectedCommit + '\n'));
  }
  files.set('SHA256SUMS', Buffer.from(checksumText(files)));
  for (const [name, bytes] of files) write(path.join(out, name), bytes);
  write(path.join(out, 'release-notes.md'), releaseNotes(input, owner));
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `artifactName=release-ready-${input.expectedCommit}\nexpectedCommit=${input.expectedCommit}\n`);
  console.log('Technical validation passed; no acceptance or release authority inferred.');
}
export function releaseNotes(input, owner) {
  assert.equal(validateInputs(input), owner, 'Release notes role mismatch');
  const role = { stack: 'Parent composition and portable distribution', runtime: 'Runtime projects, goals, execution and durable receipts', harness: 'Harness quality assets and evaluation', ontology: 'Ontology semantic models and validation' }[owner];
  const repository = `https://github.com/${input.repository}`;
  const docs = `${repository}/blob/${input.expectedCommit}`;
  const api = owner === 'runtime' ? `[Service API](${docs}/docs/service.md) · [CLI](${docs}/docs/cli.md)` : `[Product documentation](${docs}/README.md)`;
  return `# EvoPilot 0.5.0 Preview

${role}. Use Node 24.14.0. This Preview adds a bounded OpenSLO v1 profile, actual read-only Prometheus measurement, authenticated Alertmanager ingress, pinned native Rego evaluation, retained incidents and reviewable Runtime repair candidates. An explicitly enabled macOS launchd worker continues independently of Codex and resumes selected schedules from retained watermarks. Expert guides cover configuration, observations, repair review, regression comparisons and stopped-state recovery. Native RDF/Turtle/SHACL and Rego v1 standards and v0.3 toolchain pins remain unchanged. Online writes require database marker 4; rollback requires a matching verified pre-upgrade backup. A finding cannot select a patch version, release software, weaken a policy or mutate Ontology. This is a bounded local integration, not full OpenSLO compliance, a metrics platform, autonomous repair or arbitrary Host interception. Sources use strict TypeScript. Compiled JavaScript and declarations are shipped. Each private Workspace retains registered execution feedback, durable Runtime outboxes and protected collection/Run receipts. Native specifications/v1 retain their v0.3 contracts, including SHACL 2017 and Rego v1. Keep a matching backup for rollback.

[Repository](${repository}) · [Exact source commit](${repository}/tree/${input.expectedCommit}) · [Successful source CI](${repository}/actions/runs/${input.sourceRunId})

## Downloads and installation

[Download v0.5.0 assets](${repository}/releases/tag/v0.5.0). Verify every downloaded asset against SHA256SUMS and inspect source-revision.txt before installation. ${api} · [Installation and source instructions](${docs}/README.md) · [Distribution and checksum guide](https://github.com/yeliang-wang/evopilot/blob/main/docs/github-release.md).

The parent consumes the exact verified source-CI ZIP without rebuilding. Child preparation installs locked development tools, builds, then packs; its tarball must match the expected source-distribution SHA256. Runtime has no runtime dependencies and no Runtime dependency-lock asset. Compiler development dependencies are not installed runtime dependencies. Harness and Ontology retain their named dependency-lock assets. Installed component tarballs include compiled dist and declarations, and omit development scripts/tests; package scripts are for source maintainers.

## Composition and limitations

[Parent releases](https://github.com/yeliang-wang/evopilot/releases) · [Runtime](https://github.com/yeliang-wang/evopilot-runtime) · [Harness](https://github.com/yeliang-wang/evopilot-harness) · [Ontology](https://github.com/yeliang-wang/evopilot-ontology).

Standalone Runtime inspection and project/goal planning need no execution provider. Preparing pinned runs and executing them require configured trusted resolvers and an executor; the default standalone CLI does not perform coding work. Parent composition is documented separately. This Preview does not establish Host acceptance, arbitrary coding-agent support, production readiness or GA. There is no npm publication. Technical checks and source CI provide evidence independently of acceptance and release authority; publication is conditional on all required acceptance and the explicit recorded decision.
`;
}
export function validateAbsence(response, exitCode) {
  const status = /^HTTP\/\S+ (\d{3})\b/m.exec(response)?.[1];
  assert(exitCode !== null && exitCode !== 0 && status === '404', 'inspect-existing-before-retry: release/tag exists or absence is uncertain');
}
function requireAbsent(endpoint) {
  const r = spawnSync('gh', ['api', '--include', endpoint], { encoding: 'utf8' });
  assert.ifError(r.error);
  validateAbsence(r.stdout, r.status);
}
function publish(input, owner, out) {
  assert.equal(input.publish, 'true');
  assert.equal(command('git', ['rev-parse', 'HEAD']).trim(), input.expectedCommit);
  const names = assetNames(owner);
  assert.deepEqual(fs.readdirSync(out).sort(), [...names, 'release-notes.md'].sort(), 'Prepared asset allowlist mismatch');
  const files = new Map(names.map(n => [n, read(path.join(out, n))])); validateChecksums(files);
  assert.equal(read(path.join(out, 'release-notes.md')).toString(), releaseNotes(input, owner));
  const revision = files.get('source-revision.txt').toString();
  assert.equal(revision.split('\n')[0], input.expectedCommit);
  if (owner !== 'stack') { assert.equal(revision, input.expectedCommit + '\n'); validateDigest(files.get(tarball(owner)), input.expectedDigest); }
  requireAbsent(`repos/${input.repository}/releases/tags/v0.5.0`);
  requireAbsent(`repos/${input.repository}/git/ref/tags/v0.5.0`);
  // No retries or cleanup after either mutation: reconcile an uncertain outcome manually.
  command('gh', ['api', '--method', 'POST', `repos/${input.repository}/git/refs`, '-f', 'ref=refs/tags/v0.5.0', '-f', `sha=${input.expectedCommit}`]);
  command('gh', ['release', 'create', 'v0.5.0', '--repo', input.repository, '--verify-tag', '--prerelease', '--latest=false',
    '--title', 'EvoPilot 0.5.0 Preview', '--notes-file', path.join(out, 'release-notes.md'), ...names.map(n => path.join(out, n))]);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    assert.equal(process.versions.node, '24.14.0', 'Use Node 24.14.0');
    const input = environment(), owner = validateInputs(input);
    assert.equal(process.argv.length, 3);
    const operation = process.argv[2]; assert(['prepare', 'publish'].includes(operation));
    const out = path.join(process.env.RUNNER_TEMP, 'release-assets');
    (operation === 'prepare' ? prepare : publish)(input, owner, out);
  } catch (error) { console.error(error.message + '\nEvidence retained. Manual reconciliation required; do not automatically retry.'); process.exitCode = 1; }
}
