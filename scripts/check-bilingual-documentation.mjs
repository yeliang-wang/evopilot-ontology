import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Source-maintenance checks only: matching text fragments cannot certify meaning.
const blocks = text => [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```\s*$/gm)].map(m => m[0].trim());
const tokens = text => [...new Set([...text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '').matchAll(/`([^`\n]+)`/g)].map(m => m[1]).filter(s => /^[\x20-\x7e]+$/.test(s)))].sort();
const links = text => [...text.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)].map(m => m[1]);
const slug = text => text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');

export function validateBilingualReadmes({ version, repository, en, zh }) {
  assert(en?.trim() && zh?.trim(), 'Both README languages are required');
  for (const [language, text] of [['en', en], ['zh', zh]]) {
    assert(text.split('\n')[0].includes('v' + version + ' Preview'), 'Stale bilingual heading: ' + language);
    assert(text.includes('https://github.com/yeliang-wang/' + repository + '/releases/tag/v' + version), 'Missing exact owning release: ' + language);
    assert(text.includes('24.14.0'), 'Missing Node prerequisite: ' + language);
    for (const token of ['L1', 'L2', 'L3', 'standardVersion: "v2"', 'assetAssessment', 'reconstructionVerification', 'NOT_REQUESTED']) assert(text.includes(token), 'Missing content boundary token: ' + language + '/' + token);
    for (const m of text.matchAll(/evopilot-(?:next-(?:runtime|harness|ontology)-)?(\d+\.\d+\.\d+)(?:-preview)?\.(?:tgz|tar\.gz)/g)) assert.equal(m[1], version, 'Stale bilingual package');
    for (const m of text.matchAll(/releases\/tag\/v(\d+\.\d+\.\d+)/g)) assert.equal(m[1], version, 'Stale bilingual release');
  }
  assert(en.split('\n').slice(0,5).join('\n').includes('[简体中文](README_CN.md)'), 'English language switch missing');
  assert(zh.split('\n').slice(0,5).join('\n').includes('[English](README.md)'), 'Chinese language switch missing');
  assert.deepEqual(blocks(zh), blocks(en), 'Bilingual command/code blocks differ');
  assert.deepEqual(tokens(zh), tokens(en), 'Bilingual technical tokens differ');
  assert.equal(zh.split('\n').filter(l => /^#{1,3} /.test(l)).length, en.split('\n').filter(l => /^#{1,3} /.test(l)).length, 'Bilingual section count differs');
  for (const link of links(zh)) assert(!/^https:\/\/github.com\/yeliang-wang\/evopilot(?:-(?:runtime|harness|ontology))?\/blob\/main\/README\.md/.test(link), 'Chinese product navigation must use README_CN.md');
  return { version, repository, codeBlocks: blocks(en).length, semanticReview: 'REQUIRED_SEPARATELY', authority: false };
}

export function checkLocalLinks(root, filename, text) {
  const absoluteRoot = path.resolve(root);
  for (const dest of links(text)) {
    if (/^[a-z][a-z\d+.-]*:/i.test(dest)) continue;
    assert(!dest.startsWith('/'), 'Nonportable absolute link in ' + filename);
    const [relative, fragment] = dest.split('#');
    const target = relative ? path.resolve(root, path.dirname(filename), decodeURIComponent(relative.split('?')[0])) : path.resolve(root, filename);
    assert(target === absoluteRoot || target.startsWith(absoluteRoot + path.sep), 'Link escapes owning repository: ' + filename);
    assert(fs.existsSync(target), 'Missing link target: ' + filename + ' -> ' + dest);
    if (fragment && path.extname(target) === '.md') {
      const targetText = fs.readFileSync(target, 'utf8');
      const seen = new Map();
      const anchors = [...targetText.matchAll(/^(#{1,6})\s+(.+)$/gm)].map(m => {
        const key = slug(m[2]); const count = seen.get(key) ?? 0; seen.set(key, count + 1); return count ? key + '-' + count : key;
      });
      anchors.push(...[...targetText.matchAll(/<a\s+(?:id|name)=["']([^"']+)["']/g)].map(m => m[1]));
      assert(anchors.includes(decodeURIComponent(fragment)), 'Missing link anchor: ' + filename + ' -> ' + dest);
    }
  }
}

export async function checkBilingualDocumentation(root) {
  const read = name => fs.readFileSync(path.join(root, name), 'utf8');
  const pkg = JSON.parse(read('package.json')), owner = pkg.name.replace('@evopilot-next/', '');
  const repository = 'evopilot' + (owner === 'stack' ? '' : '-' + owner);
  const result = validateBilingualReadmes({ version: pkg.version, repository, en: read('README.md'), zh: read('README_CN.md') });
  const files = ['README.md', 'README_CN.md', 'docs/documentation-languages.md'];
  for (const f of fs.readdirSync(path.join(root, 'docs/zh-CN'))) if (f.endsWith('.md')) files.push('docs/zh-CN/' + f);
  for (const f of files) checkLocalLinks(root, f, read(f));
  assert(read('docs/README.md').includes('](zh-CN/README.md)'), 'Chinese index route missing');
  assert(read('docs/zh-CN/README.md').includes('](../README.md)'), 'English index route missing');
  if (owner !== 'stack') assert(pkg.files.includes('README_CN.md') && pkg.files.includes('docs'), 'Chinese docs missing from package whitelist');
  else {
    assert.deepEqual(blocks(read('docs/zh-CN/installation.md')), blocks(read('docs/installation.md')), 'Chinese installation commands drift');
    const standard = await import(pathToFileURL(path.join(root, 'integration/compatibility/usability/v2/contract.mjs')).href);
    const guide = read('docs/zh-CN/asset-readiness.md');
    for (const id of [...standard.READINESS_FACETS, ...standard.READINESS_CLOSURE]) assert(guide.includes(id), 'Chinese readiness guide missing ' + id);
  }
  return { ...result, checkedPages: files.length };
}
