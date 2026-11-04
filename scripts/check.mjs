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
  "version": "0.8.3",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24.14.0"
  },
  "files": [
    "dist",
    "plugins",
    "governance",
    "src",
    "toolchains",
    "vendor",
    "README.md",
    "README_CN.md",
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
    "test": "node --test tests/e2e/*.test.mjs",
    "test:governance": "node --test tests/governance/*.test.mjs",
    "acceptance:product:preflight": "node scripts/formal-e2e.mjs"
  },
  "dependencies": {
    "@modelcontextprotocol/client": "2.4.0",
    "@modelcontextprotocol/node": "2.1.2",
    "@modelcontextprotocol/server": "2.4.0",
    "ajv": "8.20.0",
    "yaml": "2.9.0"
  },
  "devDependencies": {
    "typescript": "5.9.3",
    "@types/node": "24.19.2"
  }
};
expected.exports['./workspace-migration'] = { types: './dist/workspace-migration.d.ts', import: './dist/workspace-migration.js' };
expected.exports['./standalone'] = {types:'./dist/standalone/http.d.ts',import:'./dist/standalone/http.js'};
expected.exports['./standalone-client'] = {types:'./dist/standalone/client.d.ts',import:'./dist/standalone/client.js'};
expected.exports['./native-v2']={types:'./dist/native-v2/consumer.d.ts',import:'./dist/native-v2/consumer.js'};
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
  const nativeGeneration=spawnSync(process.execPath,[resolve(ROOT,'scripts/generate-native-v2.mjs'),'--check'],{cwd:ROOT,encoding:'utf8'});
  assert.ifError(nativeGeneration.error);assert.equal(nativeGeneration.status,0,nativeGeneration.stdout+nativeGeneration.stderr);
  const pkg = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(pkg[key], value, key);
  for (const key of ['peerDependencies', 'optionalDependencies']) assert.deepEqual(pkg[key] ?? {}, {});
  assert.deepEqual(pkg.bin, { 'evopilot-next-ontology': 'dist/cli.js', 'evopilot-ontology':'dist/standalone/cli.js' });
  assert.equal(await readFile(resolve(ROOT,'plugins/codex/skills/evopilot-ontology-expert/SKILL.md'),'utf8'),await readFile(resolve(ROOT,'src/expert/SKILL.md'),'utf8'),'Packaged Expert must be generated from its sole owner source');
  assert((await lstat(resolve(ROOT,'dist/standalone/cli.js'))).mode&0o111);
  const dl=JSON.parse(await readFile(resolve(ROOT,'toolchains/owl2-dl/dependencies.json'),'utf8'));
  assert.equal(dl.schema,'ontology-dl-dependencies/v1');assert.equal(dl.engine,'hermit:1.4.5.519+evopilot.2;jfact:5.0.3;structural-alc:1');assert.equal(dl.owlapi,'owlapi-distribution:5.5.1');
  assert.equal(dl.enginePatch.file,'engine-compat.json');
  const patchBytes=await readFile(resolve(ROOT,'toolchains/owl2-dl/engine-compat.json'));
  assert.equal(createHash('sha256').update(patchBytes).digest('hex'),dl.enginePatch.sha256);
  const patch=JSON.parse(patchBytes);assert.equal(patch.schema,'ontology-dl-engine-compat/v2');assert.equal(patch.engine,'org.semanticweb.hermit:1.4.5.519+evopilot.2');
  assert.equal(patch.upstreamEngine,'org.semanticweb.hermit:1.4.5.519');assert.equal(patch.license,'LGPL-3.0-or-later');
  assert.match(patch.sourceArchive.sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(patch.files.map(f=>f.sourceEntry).sort(),[
    'org/semanticweb/HermiT/structural/ExpressionManager.java',
    'org/semanticweb/HermiT/datatypes/rdfplainliteral/RDFPlainLiteralPatternValueSpaceSubset.java',
    'org/semanticweb/HermiT/datatypes/rdfplainliteral/RDFPlainLiteralLengthInterval.java',
    'org/semanticweb/HermiT/datatypes/anyuri/AnyURIValueSpaceSubset.java',
  ].sort());
  for(const file of patch.files){
    for(const value of [file.sourceSHA256,file.patchedSourceSHA256])assert.match(value,/^[a-f0-9]{64}$/);
    assert(file.changes.length>0&&file.changes.every(c=>c.find&&typeof c.replace==='string'&&Number.isInteger(c.occurrences)&&c.occurrences>0));
  }
  assert.deepEqual(patch.ownedSources.map(f=>f.file),['XmlSchemaAutomata.java']);
  for(const file of patch.ownedSources){
    const source=resolve(ROOT,'toolchains/owl2-dl',file.file);
    assert((await lstat(source)).isFile());
    assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'),file.sha256);
  }
  assert.deepEqual(Object.keys(dl.parserPatch).sort(),['file','sha256']);
  assert.equal(dl.parserPatch.file,'parser-compat.json');assert.match(dl.parserPatch.sha256,/^[a-f0-9]{64}$/);
  const parserBytes=await readFile(resolve(ROOT,'toolchains/owl2-dl/parser-compat.json'));
  assert.equal(createHash('sha256').update(parserBytes).digest('hex'),dl.parserPatch.sha256);
  const parser=JSON.parse(parserBytes);
  assert.equal(parser.schema,'ontology-dl-parser-compat/v1');assert.equal(parser.parserId,'owlapi-functional-locations:1');
  assert.equal(parser.sourceArchive.url,'https://repo.maven.apache.org/maven2/net/sourceforge/owlapi/owlapi-parsers/5.5.1/owlapi-parsers-5.5.1-sources.jar');
  assert.equal(parser.sourceArchive.sha256,'ca5ade39883033eb730faa86a8c3af1ad8ed6f0484384369b2e5f02af6af4293');
  assert.equal(parser.files.length,1);
  assert.equal(parser.files[0].sourceEntry,'org/semanticweb/owlapi/functional/parser/CustomTokenizer.java');
  assert.equal(parser.files[0].sourceSHA256,'7a809981541711b882baa4caeca7037abae3a71e7b6bd69d72745d2ff440d1cf');
  assert.equal(parser.files[0].outputFile,'LocatedTokenizer.java');assert.match(parser.files[0].patchedSourceSHA256,/^[a-f0-9]{64}$/);
  assert(Array.isArray(parser.files[0].changes)&&parser.files[0].changes.length>0);
  assert(parser.files[0].changes.every(c=>typeof c.find==='string'&&c.find&&typeof c.replace==='string'&&Number.isSafeInteger(c.occurrences)&&c.occurrences>0));
  assert.deepEqual(parser.ownedSources.map(f=>f.file),['LocatedFunctionalParser.java']);
  for(const file of parser.ownedSources){
    assert.match(file.sha256,/^[a-f0-9]{64}$/);
    const source=resolve(ROOT,'toolchains/owl2-dl',file.file),node=await lstat(source);
    assert(node.isFile()&&node.nlink===1);
    assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'),file.sha256);
  }
  assert(typeof parser.notice==='string'&&parser.notice.trim()&&Buffer.byteLength(parser.notice)<=16384);
  const additionalParsers=[
    {key:'turtlePatch',file:'turtle-compat.json',parserId:'owlapi-turtle-occurrences:1',package:'org/semanticweb/owlapi/rdf/turtle/parser/',
      files:[
        ['TurtleParser.java','LocatedTurtleSyntaxParser.java','3a1d6dc6f2b02fe8963fc65f22faa3b2c8a5234b90471691942eee33e019a8fd'],
        ['JavaCharStream.java','LocatedTurtleCharStream.java','ddd395b54f835a6d5c8ca31c9c7141c8ddc3ca6db6b0ee54bdfe79f607918fc6'],
        ['TurtleParserTokenManager.java','LocatedTurtleTokenManager.java','190b0a01242d12aaa42e77b059dfc4b555e6a666f5dad212a25a23de4178e7d6'],
      ],owned:['LocatedTurtleParser.java','RDFIRI.java']},
    {key:'rdfMappingPatch',file:'rdf-mapping-compat.json',parserId:'owlapi-rdf-mapping-provenance:1',package:'org/semanticweb/owlapi/rdf/rdfxml/parser/',
      files:[
        ['OWLRDFConsumer.java','LocatedRDFConsumer.java','cff71d016eab2e7b3f27920d83204f26e7fb6bfdcddc82ccdd06da7fc010567b'],
        ['Translators.java','LocatedTranslators.java','16f0dcf7bb7e32e3880835c8d94626e4893a21725b443a3b8738e33b8c557b34'],
        ['TripleHandlers.java','LocatedTripleHandlers.java','96877b272df96ee480b27a7fb1974744c2101bd00273ddeb6e8b6034d895f70a'],
        ['OptimisedListTranslator.java','LocatedOptimisedListTranslator.java','7f2f16421fecdc6688db09b9a32a43fc946348ce74cfb41eb3b53716a8b7a564'],
      ],owned:['LocatedRDFConsumerAdapter.java','RDFProvenance.java']},
    {key:'rdfxmlPatch',file:'rdfxml-compat.json',parserId:'owlapi-rdfxml-occurrences:1',package:'org/semanticweb/owlapi/rdf/rdfxml/parser/',
      files:[
        ['RDFParser.java','LocatedRDFXMLSyntaxParser.java','c756d2bfe0ff851c534f72b7e37a8741864c3622686e3efb77b5b2830a09b8b6'],
        ['StartRDF.java','LocatedXMLStartRDF.java','17c2a6e67704e02f7a44a6f6ede656ab901c83141d210ba99a5690d581b447bf'],
      ],owned:['LocatedRDFXMLParser.java','RDFXMLRawScanner.java']},
  ];
  for(const spec of additionalParsers){
    const binding=dl[spec.key];assert.deepEqual(Object.keys(binding).sort(),['file','sha256']);assert.equal(binding.file,spec.file);assert.match(binding.sha256,/^[a-f0-9]{64}$/);
    const recipeBytes=await readFile(resolve(ROOT,'toolchains/owl2-dl',spec.file));
    assert.equal(createHash('sha256').update(recipeBytes).digest('hex'),binding.sha256);
    const recipe=JSON.parse(recipeBytes);assert.equal(recipe.schema,'ontology-dl-parser-compat/v1');assert.equal(recipe.parserId,spec.parserId);
    assert.equal(recipe.sourceArchive.url,parser.sourceArchive.url);assert.equal(recipe.sourceArchive.sha256,parser.sourceArchive.sha256);
    assert.deepEqual(recipe.files.map(f=>[f.sourceEntry,f.outputFile,f.sourceSHA256]).sort(),spec.files.map(([entry,output,sourceSHA256])=>[spec.package+entry,output,sourceSHA256]).sort());
    for(const file of recipe.files){
      assert.match(file.patchedSourceSHA256,/^[a-f0-9]{64}$/);
      assert(Array.isArray(file.changes)&&file.changes.length>0);
      assert(file.changes.every(c=>typeof c.find==='string'&&c.find&&typeof c.replace==='string'&&Number.isSafeInteger(c.occurrences)&&c.occurrences>0));
    }
    assert.deepEqual(recipe.ownedSources.map(f=>f.file).sort(),[...spec.owned].sort());
    for(const file of recipe.ownedSources){
      assert.match(file.sha256,/^[a-f0-9]{64}$/);
      const source=resolve(ROOT,'toolchains/owl2-dl',file.file),node=await lstat(source),bytes=await readFile(source);
      assert(node.isFile()&&node.nlink===1&&node.size<=2*1024*1024);
      assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
      assert(bytes.toString('utf8').split(/\r?\n/).some(line=>line.trim()==='package '+spec.package.slice(0,-1).replaceAll('/','.')+';'),'Owned parser helper must keep its approved package');
    }
    assert(typeof recipe.notice==='string'&&recipe.notice.trim()&&Buffer.byteLength(recipe.notice)<=16384);
  }
  assert(dl.files.length>0&&new Set(dl.files.map(f=>f.file)).size===dl.files.length);
  for(const f of dl.files){assert.match(f.file,/^[A-Za-z0-9._-]+\.jar$/);assert.match(f.sha256,/^[a-f0-9]{64}$/);assert(!f.repositoryPath.split('/').some(x=>['','..','.'].includes(x)));assert.equal(f.url,'https://repo.maven.apache.org/maven2/'+f.repositoryPath);assert(f.repositoryPath.endsWith('/'+f.file));}
  assert((await lstat(resolve(ROOT,'toolchains/owl2-dl/Worker.java'))).isFile());
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
      if (path===resolve(ROOT,'src/standalone/mcp.ts') && ['@modelcontextprotocol/server','@modelcontextprotocol/node'].includes(specifier)) continue;
      if (path===resolve(ROOT,'src/standalone/bridge.ts') && ['@modelcontextprotocol/server','@modelcontextprotocol/server/stdio','@modelcontextprotocol/client'].includes(specifier)) continue;
      if (path===resolve(ROOT,'src/standalone/stdio-transport.ts') && specifier==='@modelcontextprotocol/server') continue;
      if (specifier === 'yaml' && (path.endsWith('/src/asset-sources.ts') || path === resolve(ROOT, 'src/import-operations.ts') || PRODUCT === 'ontology' && path.includes('/src/compat/'))) continue;
      if (specifier === 'yaml' && ['src/installation/plugin-content.ts','src/installation/plugin-merge.ts'].some(p=>path===resolve(ROOT,p))) continue;
      if (PRODUCT === 'ontology' && path.includes('/src/compat/') && specifier === 'ajv/dist/2020.js') continue;
      if (path === resolve(ROOT,'src/native-v2/sources.ts') && ['ajv/dist/2020.js','yaml'].includes(specifier)) continue;
      if (['src/native-v2/models.ts','src/native-v2/shacl-request.ts','src/native-v2/expectations.ts','src/native-v2/projection.ts','src/native-v2/lifecycle-contract.ts'].some(p=>path===resolve(ROOT,p)) && specifier==='ajv/dist/2020.js') continue;
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
    "assert.equal(api.VERSION, '0.8.3');",
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

