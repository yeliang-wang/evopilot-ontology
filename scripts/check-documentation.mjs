import { checkBilingualDocumentation } from './check-bilingual-documentation.mjs';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// This is source-maintenance tooling, not an acceptance or publication decision.
// Historical changelog sections, frozen specifications and fixtures are excluded.
export function validateDocumentation({ version, owner, documents }) {
  assert(/^\d+\.\d+\.\d+$/.test(version), 'Expected a release documentation version');
  assert(['stack', 'runtime', 'harness', 'ontology'].includes(owner), 'Unknown documentation owner');
  for (const name of ['README.md', 'CHANGELOG.md', 'docs/README.md', 'docs/roadmap.md']) {
    assert(typeof documents[name] === 'string' && documents[name].trim(), 'Missing current document: ' + name);
  }
  const readme = documents['README.md'];
  assert(readme.split('\n')[0].includes('v' + version + ' Preview'), 'README heading must identify the current Preview');
  const introduction = documents['docs/README.md'].split(/\n\s*\n/).find(p => !p.startsWith('#'));
  assert(introduction?.includes('v' + version + ' Preview'), 'Documentation introduction must identify the current Preview');
  const sections = documents['CHANGELOG.md'].split(/^## /m).slice(1);
  const current = sections.find(s => s.startsWith(version + ' '));
  assert(current && sections[0] === current, 'Current changelog release must be first');
  assert(!/\bcandidate\b|\bunreleased\b/i.test(current.split('\n')[0]), 'Current changelog must not claim an unreleased candidate');
  const repository = 'evopilot' + (owner === 'stack' ? '' : '-' + owner);
  const release = 'https://github.com/yeliang-wang/' + repository + '/releases/tag/v' + version;
  assert(readme.includes(release), 'README must link the owning current release');
  assert(current.includes(release), 'Current changelog must link the owning release');

  const packages = [...readme.matchAll(/evopilot-(?:next-(?:runtime|harness|ontology)-)?(\d+\.\d+\.\d+)(?:-preview)?\.(?:tgz|tar\.gz)/g)];
  assert(packages.length, 'README must name a versioned distribution');
  for (const match of packages) assert.equal(match[1], version, 'Default README package version is stale');
  for (const match of readme.matchAll(/git clone\s+--branch\s+v(\d+\.\d+\.\d+)/g)) {
    assert.equal(match[1], version, 'Default clone branch is stale');
  }
  for (const section of readme.split(/^## /m).slice(1)) {
    if (!/install|quickstart/i.test(section.split('\n')[0])) continue;
    for (const match of section.matchAll(/releases\/tag\/v(\d+\.\d+\.\d+)/g)) {
      // Explicit historical links are allowed only outside current setup steps.
      assert.equal(match[1], version, 'Current installation section links an older release');
    }
  }

  const majorMinor = version.split('.').slice(0, 2).join('.');
  const staleVersion = new RegExp('\\bv(?:' + escape(version) + '|' + escape(majorMinor) + ') (?:Preview )?candidate\\b', 'i');
  const staleStatus = /Candidate (?:validation is ongoing|verification is in progress)|acceptance and daily cutover remain pending|Daily installation and shared maintenance remain deferred/i;
  const staleRoadmap = new RegExp('IMPLEMENTATION_STARTED_ISOLATED v' + escape(version));
  for (const [name, full] of Object.entries(documents)) {
    const text = name === 'CHANGELOG.md' ? current : full;
    assert(!staleVersion.test(text) && !staleStatus.test(text) && !staleRoadmap.test(text), 'Obsolete current-release status in ' + name);
  }
  const required = owner === 'stack' ? ['planning.md', 'readable-assets.md', 'preflight-maintenance.md']
    : ['readable-api.md', ...(owner === 'runtime' ? ['planning-api.md'] : [])];
  for (const name of required) {
    assert(documents['docs/' + name]?.trim(), 'Missing current feature guide: ' + name);
    assert(documents['docs/README.md'].includes('](' + name + ')'), 'Current guide missing from index: ' + name);
  }
  return { owner, version, checkedDocuments: Object.keys(documents).length, authority: false };
}

export async function checkDocumentation(root = fileURLToPath(new URL('../', import.meta.url))) {
  await checkBilingualDocumentation(root);
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const owner = pkg.name.replace('@evopilot-next/', '');
  const names = ['README.md', 'CHANGELOG.md', ...(await readdir(resolve(root, 'docs')))
    .filter(name => name.endsWith('.md') && !name.startsWith('legacy-')).map(name => 'docs/' + name)];
  const documents = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(resolve(root, name), 'utf8')])));
  return validateDocumentation({ version: pkg.version, owner, documents });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await checkDocumentation())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
