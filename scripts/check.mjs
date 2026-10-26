import { checkDocumentation } from './check-documentation.mjs';
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
  "version": "0.8.2",
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
expected.exports['./workspace-migration'] = { types: './dist/workspace-migration.d.ts', import: './dist/workspace-migration.js' };
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
  await checkDocumentation();
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
  assert.equal(manifest.contractRevision,'1.1.0');assert.equal(manifest.module,'native.mjs');assert.equal(manifest.legacyModule,'reference.mjs');assert.equal(manifest.legacySha256,PIN);
  assert.deepEqual(manifest.children,['projects/evopilot-runtime','projects/evopilot-harness','projects/evopilot-ontology']);
  for(const [name,hash] of Object.entries({...manifest.files,[manifest.module]:manifest.sha256,[manifest.legacyModule]:PIN}))assert.equal(createHash('sha256').update(await readFile(resolve(vendor,name))).digest('hex'),hash);
  const generatedRoot = resolve(vendor, 'toolchain');
  const generated = JSON.parse(await readFile(resolve(generatedRoot, 'manifest.json'), 'utf8'));
  assert.equal(generated.schema, 'evopilot-generated-toolchain/v1');
  for (const entry of generated.files) {
    assert(/^[a-zA-Z0-9_./-]+$/.test(entry.path) && !entry.path.split('/').includes('..'));
    assert.equal(createHash('sha256').update(await readFile(resolve(generatedRoot, entry.path))).digest('hex'), entry.sha256);
  }
  const feedbackRoot=resolve(ROOT,'vendor/compatibility/feedback/v1');
  const feedbackManifest=JSON.parse(await readFile(resolve(feedbackRoot,'manifest.json'),'utf8'));
  assert.equal(feedbackManifest.schema,'evopilot-feedback-distribution/v1');
  assert.deepEqual(Object.keys(feedbackManifest.files).sort(),['feedback.d.mts','feedback.mjs','owner.d.mts','owner.mjs']);
  for(const [name,digest] of Object.entries(feedbackManifest.files))assert.equal(createHash('sha256').update(await readFile(resolve(feedbackRoot,name))).digest('hex'),digest);
  const feedbackImports=['feedback.mjs','owner.mjs'].map(n=>resolve(feedbackRoot,n));
  const onlineRoot=resolve(ROOT,'vendor/compatibility/online/v1');
  const onlineManifest=JSON.parse(await readFile(resolve(onlineRoot,'manifest.json'),'utf8'));
  assert.equal(onlineManifest.schema,'evopilot-online-distribution/v1');
  assert.equal(onlineManifest.nativeContractUnchanged,true);
  assert.deepEqual(Object.keys(onlineManifest.files).sort(),['online.d.mts','online.mjs']);
  for(const [name,digest] of Object.entries(onlineManifest.files))assert.equal(createHash('sha256').update(await readFile(resolve(onlineRoot,name))).digest('hex'),digest);
  const onlineImports=[resolve(onlineRoot,'online.mjs')];
  const responseRoot=resolve(ROOT,'vendor/compatibility/response/v1');
  const responseManifest=JSON.parse(await readFile(resolve(responseRoot,'manifest.json'),'utf8'));
  assert.equal(responseManifest.schema,'evopilot-response-distribution/v1');
  assert.deepEqual(Object.keys(responseManifest.files).sort(),['response.d.mts','response.mjs']);
  for(const [file,digest] of Object.entries(responseManifest.files))assert.equal(createHash('sha256').update(await readFile(resolve(responseRoot,file))).digest('hex'),digest,'Response vendor changed');
  const responseImports=[resolve(responseRoot,'response.mjs')];
  const readabilityRoot=resolve(ROOT,'vendor/readability/v1');
  const readabilityManifest=JSON.parse(await readFile(resolve(readabilityRoot,'manifest.json'),'utf8'));
  assert.equal(readabilityManifest.schema,'evopilot-readability-distribution/v1');
  assert.deepEqual(Object.keys(readabilityManifest.files).sort(),['presentation.d.mts','presentation.mjs','readability.d.mts','readability.mjs']);
  for(const [name,hash] of Object.entries(readabilityManifest.files))assert.equal(createHash('sha256').update(await readFile(resolve(readabilityRoot,name))).digest('hex'),hash);
  const readabilityImports=['readability.mjs','presentation.mjs'].map(name=>resolve(readabilityRoot,name));


  const readinessRoot=resolve(ROOT,'vendor/compatibility/usability/v2');
  const readinessManifest=JSON.parse(await readFile(resolve(readinessRoot,'manifest.json'),'utf8'));
  assert.equal(readinessManifest.schema,'evopilot-usability-distribution/v2');
  assert.equal(readinessManifest.nativeContractUnchanged,true);
  assert.deepEqual(Object.keys(readinessManifest.files).sort(),['authoring.d.mts','authoring.mjs','contract.d.mts','contract.mjs']);
  for(const [name,digest] of Object.entries(readinessManifest.files))assert.equal(createHash('sha256').update(await readFile(resolve(readinessRoot,name))).digest('hex'),digest,'Readiness vendor changed');
  const readinessImports=['authoring.mjs','contract.mjs'].map(name=>resolve(readinessRoot,name));
  const usabilityRoot=resolve(ROOT,'vendor/usability/v1');
  const usabilityManifest=JSON.parse(await readFile(resolve(usabilityRoot,'manifest.json'),'utf8'));
  assert.equal(usabilityManifest.schema,'evopilot-usability-distribution/v1');
  assert.equal(usabilityManifest.nativeContractUnchanged,true);
  assert.deepEqual(Object.keys(usabilityManifest.files).sort(),['assessment.d.mts','assessment.mjs','authoring.d.mts','authoring.mjs','contract.d.mts','contract.mjs','oracle.d.mts','oracle.mjs']);
  for(const [name,hash] of Object.entries(usabilityManifest.files))assert.equal(createHash('sha256').update(await readFile(resolve(usabilityRoot,name))).digest('hex'),hash);
  const usabilityImports=['contract.mjs','authoring.mjs','assessment.mjs','oracle.mjs'].map(name=>resolve(usabilityRoot,name));

  const sources = [...await files(resolve(ROOT, 'src')), ...await files(resolve(ROOT, 'vendor'))];
  for (const path of sources) {
    if (path.endsWith('.d.ts') || path.endsWith('.d.mts')) continue;
    if (!path.endsWith('.mjs') && !path.endsWith('.ts') && !path.startsWith(generatedRoot + sep)) continue;
    if (path.startsWith(generatedRoot + sep) && !/\.(js|ts)$/.test(path)) continue;
    assert(!(dirname(path) === resolve(ROOT, 'src') && path.endsWith('.mjs')), 'Transitional top-level .mjs implementation must be removed: ' + path);
    const source = await readFile(path, 'utf8');
    if (path.endsWith('.mjs') || path.endsWith('.js')) {
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
      assert(target.startsWith(resolve(ROOT, 'src') + sep) || feedbackImports.includes(target) || onlineImports.includes(target) || responseImports.includes(target) || readabilityImports.includes(target) || readinessImports.includes(target) || usabilityImports.includes(target) || path.startsWith(generatedRoot + sep) && target.startsWith(generatedRoot + sep) || [resolve(vendor, 'reference.mjs'),resolve(vendor,'native.mjs'),resolve(vendor,'decision-evidence.mjs')].includes(target), 'Foreign source import');
      assert((await lstat(target)).isFile(), 'Import must be an owned regular file');
    }
  }
  const code = [
    "import assert from 'node:assert/strict';",
    'const api = await import(' + JSON.stringify(pathToFileURL(resolve(ROOT, 'dist/index.js')).href) + ');',
    'assert.equal(api.PRODUCT, ' + JSON.stringify(PRODUCT) + ');',
    "assert.equal(api.VERSION, '0.8.2');",
    'assert.equal(api.capabilities().authority, false);',
    'assert.equal(api.capabilities().businessOperationsReady, true);',
    'await import(' + JSON.stringify(pathToFileURL(resolve(ROOT, 'dist/cli.js')).href) + ');',
    'const service = await import(' + JSON.stringify(pathToFileURL(resolve(ROOT, 'dist/service.js')).href) + ');',
    "const discovery = service.createOntologyService({ workspaceRoot: '/explicit-discovery-only', workspaceId: 'discovery' });",
    "assert(discovery.capabilities().nativeOperations.includes('native.package.publish'));assert(!discovery.capabilities().operations.includes('asset.publish'));",
    "assert.equal(typeof discovery.native, 'function');",
    "assert.equal(discovery.capabilities().historicalOperationsReadOnly,true); discovery.close();",
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

