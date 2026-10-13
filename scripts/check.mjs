import assert from 'node:assert/strict';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isBuiltin } from 'node:module';
import { spawnSync } from 'node:child_process';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PRODUCT = 'ontology';
const PIN = 'df4f7246ae35ef9114e2b93663d520e7ff4f44f14f886ac8ba43e9fc080ddc9a';
const expected = {
  "name": "@evopilot-next/ontology",
  "version": "0.1.1",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24.14.0"
  },
  "files": [
    "dist",
    "src",
    "vendor",
    "README.md",
    "specifications",
    "examples",
    "schemas",
    "docs",
    "provenance",
    "LICENSE",
    "NOTICE",
    "assets",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CHANGELOG.md"
  ],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./compat": {
      "types": "./dist/compat/index.d.mts",
      "import": "./dist/compat/index.mjs"
    },
    "./migration": {
      "types": "./dist/migration.d.ts",
      "import": "./dist/migration.js"
    },
    "./sources": {
      "types": "./dist/asset-sources.d.ts",
      "import": "./dist/asset-sources.js"
    },
    "./service": {
      "types": "./dist/service.d.ts",
      "import": "./dist/service.js"
    }
  },
  "scripts": {
    "build": "node scripts/build.mjs",
    "check": "tsc --noEmit && node scripts/check.mjs",
    "test": "node --test tests/e2e/*.test.mjs"
  },
  "dependencies": {
    "ajv": "8.20.0",
    "yaml": "2.9.0"
  },
  "devDependencies": {
    "typescript": "5.9.3",
    "@types/node": "24.19.2"
  }
};
const specifiers = source => [...source.matchAll(/^[\t ]*(?:import\s+(?:(?:[\w$]+(?:\s*,\s*)?)?(?:\{[^}]*\}|\*\s+as\s+[\w$]+)?\s*from\s*)?|export\s+(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)\s+from\s*)['"]([^'"]+)['"]/gm)].map(match => match[1]);

async function files(directory) {
  assert((await lstat(directory)).isDirectory(), 'Owned tree must be a regular directory');
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    assert(!entry.isSymbolicLink(), 'Symlink forbidden: ' + path);
    if (entry.isDirectory()) result.push(...await files(path));
    else { assert(entry.isFile()); result.push(path); }
  }
  return result;
}

export async function checkSource() {
  const pkg = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(pkg[key], value, key);
  for (const key of ['peerDependencies', 'optionalDependencies']) assert.deepEqual(pkg[key] ?? {}, {});
  assert.deepEqual(pkg.bin, { 'evopilot-next-ontology': 'dist/cli.js' });
  // Public type consumers must resolve emitted package exports, never source aliases.
  for (const entry of Object.values(pkg.exports)) {
    for (const target of [entry.types, entry.import]) {
      assert((await lstat(resolve(ROOT, target))).isFile(), 'Build package exports before check: ' + target);
    }
  }
  const consumer = spawnSync(process.execPath, [resolve(ROOT, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2023', '--module', 'NodeNext', 'tests/types/contracts.ts'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, OPENSSL_CONF: '/dev/null' },
  });
  assert.ifError(consumer.error); assert.equal(consumer.status, 0, consumer.stdout + consumer.stderr);
  const lock = JSON.parse(await readFile(resolve(ROOT, 'package-lock.json'), 'utf8'));
  assert.deepEqual(lock.packages[''].bin, pkg.bin);
  assert((await lstat(resolve(ROOT, 'dist/cli.js'))).mode & 0o111);
  assert((await readFile(resolve(ROOT, 'dist/cli.js'), 'utf8')).startsWith('#!/usr/bin/env node\n'));
  const vendor = resolve(ROOT, 'vendor/compatibility/v1');
  const manifest = JSON.parse(await readFile(resolve(vendor, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest, {
    contractRevision: '1.0.0', module: 'reference.mjs', sha256: PIN,
    children: ['projects/evopilot-runtime', 'projects/evopilot-harness', 'projects/evopilot-ontology'],
  });
  const bytes = await readFile(resolve(vendor, manifest.module));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), PIN);
  const sources = [...await files(resolve(ROOT, 'src')), ...await files(resolve(ROOT, 'vendor'))];
  for (const path of sources) {
    if (path.endsWith('.d.ts') || path.endsWith('.d.mts')) continue;
    if (!path.endsWith('.mjs') && !path.endsWith('.ts')) continue;
    assert(!(dirname(path) === resolve(ROOT, 'src') && path.endsWith('.mjs')), 'Transitional top-level .mjs implementation must be removed: ' + path);
    const source = await readFile(path, 'utf8');
    if (path.endsWith('.mjs')) {
    const syntax = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    assert.ifError(syntax.error); assert.equal(syntax.status, 0, syntax.stderr);
    }
    assert.doesNotMatch(source, /\bimport\s*\(|\brequire\s*\(|\beval\s*\(|\/Users\/|\/home\/|EVOPILOT_HARNESS_HOME|defaultHarnessHome|\.evopilot-harness|\bprocess\s*(?:\.\s*(?:env|cwd|chdir)|\[)|\bglobalThis\s*(?:\.|\[)|\bm0\//);
    for (const specifier of specifiers(source)) {
      if (isBuiltin(specifier)) continue;
      if (specifier === 'yaml' && (path.endsWith('/src/asset-sources.ts') || path === resolve(ROOT, 'src/import-operations.ts') || PRODUCT === 'ontology' && path.includes('/src/compat/'))) continue;
      if (PRODUCT === 'ontology' && path.includes('/src/compat/') && specifier === 'ajv/dist/2020.js') continue;
      assert(specifier.startsWith('.'), 'Undeclared import: ' + specifier);
      const target = resolve(dirname(path), path.endsWith('.ts') && specifier.endsWith('.js') ? specifier.slice(0, -3) + '.ts' : specifier);
      assert(target.startsWith(resolve(ROOT, 'src') + sep) || target === resolve(vendor, 'reference.mjs'), 'Foreign source import');
      assert((await lstat(target)).isFile(), 'Import must be an owned regular file');
    }
  }
  const code = [
    "import assert from 'node:assert/strict';",
    'const api = await import(' + JSON.stringify(pathToFileURL(resolve(ROOT, 'dist/index.js')).href) + ');',
    'assert.equal(api.PRODUCT, ' + JSON.stringify(PRODUCT) + ');',
    "assert.equal(api.VERSION, '0.1.1');",
    'assert.equal(api.capabilities().authority, false);',
    'assert.equal(api.capabilities().businessOperationsReady, true);',
    'await import(' + JSON.stringify(pathToFileURL(resolve(ROOT, 'dist/cli.js')).href) + ');',
    'const service = await import(' + JSON.stringify(pathToFileURL(resolve(ROOT, 'dist/service.js')).href) + ');',
    "const discovery = service.createOntologyService({ workspaceRoot: '/explicit-discovery-only', workspaceId: 'discovery' });",
    "assert(discovery.capabilities().operations.includes('asset.publish'));",
    "assert.equal(typeof discovery.classify, 'function');",
    "assert.equal(discovery.capabilities().operations.filter(x => x.startsWith('classification.')).length, 7); discovery.close();",
  ].join('\n');
  const result = spawnSync(process.execPath, ['--permission', '--allow-fs-read=' + ROOT, '--input-type=module', '-e', code], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', OPENSSL_CONF: '/dev/null' },
  });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assert.equal(process.argv.length, 2, 'Usage: node scripts/check.mjs');
    await checkSource();
    console.log(PRODUCT + ': owned ESM sources and pinned vendor verified; no acceptance inferred');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

