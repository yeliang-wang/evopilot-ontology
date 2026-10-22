import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDocumentation, validateDocumentation } from '../../scripts/check-documentation.mjs';

function sample() {
  return { owner: 'runtime', version: '0.7.0', documents: {
    'README.md': '# EvoPilot Runtime · v0.7.0 Preview\n\nEarlier v0.6.0 introduced response linkage.\n\n## Install\n\n[Release](https://github.com/yeliang-wang/evopilot-runtime/releases/tag/v0.7.0)\n\nnpm install /downloads/evopilot-next-runtime-0.7.0.tgz\n\ngit clone --branch v0.7.0 https://github.com/yeliang-wang/evopilot-runtime.git\n',
    'CHANGELOG.md': '# Changelog\n\n## 0.7.0 Preview — 2026-10-22\n\n[Release](https://github.com/yeliang-wang/evopilot-runtime/releases/tag/v0.7.0)\n\n## 0.6.0 Preview\n\nRetain historical release descriptions.\n',
    'docs/README.md': '# Documentation\n\nv0.7.0 Preview guides.\n\n[Read](readable-api.md) [Plan](planning-api.md)\n',
    'docs/roadmap.md': '# Roadmap\n\nv0.7.0 implemented. v0.8 candidate remains future work.\n',
    'docs/readable-api.md': '# Readable API\n\nNative inputs remain authoritative.\n',
    'docs/planning-api.md': '# Planning API\n\nPlanning approval does not authorize execution.\n',
  } };
}

test('actual repository current documentation matches its package and feature navigation', async () => {
  const result = await checkDocumentation();
  assert(result.checkedDocuments >= 6); assert.equal(result.authority, false);
});

test('current documentation permits historical records and separately planned future versions', () => {
  assert.equal(validateDocumentation(sample()).version, '0.7.0');
});

for (const [name, file, before, after, error] of [
  ['old default package', 'README.md', 'evopilot-next-runtime-0.7.0.tgz', 'evopilot-next-runtime-0.6.0.tgz', /package version is stale/],
  ['old default clone', 'README.md', '--branch v0.7.0', '--branch v0.6.0', /clone branch is stale/],
  ['old installation link', 'README.md', '## Install\n', '## Install\n\n[Old download](https://github.com/yeliang-wang/evopilot-runtime/releases/tag/v0.6.0)\n', /older release/],
  ['old index version', 'docs/README.md', 'v0.7.0', 'v0.6.0', /introduction/],
  ['unreleased heading', 'CHANGELOG.md', '0.7.0 Preview — 2026-10-22', '0.7.0 Preview candidate — unreleased', /unreleased candidate/],
  ['unreconciled candidate notice', 'docs/readable-api.md', 'Native inputs remain authoritative.', 'Candidate validation is ongoing.', /Obsolete current-release status/],
  ['unreconciled roadmap status', 'docs/roadmap.md', 'v0.7.0 implemented.', 'IMPLEMENTATION_STARTED_ISOLATED v0.7.0', /Obsolete current-release status/],
  ['missing planning route', 'docs/README.md', '[Plan](planning-api.md)', '', /guide missing from index/],
]) {
  test('documentation gate rejects ' + name, () => {
    const value = sample(); assert(value.documents[file].includes(before));
    value.documents[file] = value.documents[file].replace(before, after);
    assert.throws(() => validateDocumentation(value), error);
  });
}

test('documentation gate rejects missing required guides and package version drift', () => {
  const missing = sample(); delete missing.documents['docs/planning-api.md'];
  assert.throws(() => validateDocumentation(missing), /Missing current feature guide/);
  const drift = sample(); drift.version = '0.8.0';
  assert.throws(() => validateDocumentation(drift), /README heading/);
});
