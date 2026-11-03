// Explicit operator preparation of an already provisioned private Python
// runtime. No network, package installation, daily workspace or Harness tools.
import assert from 'node:assert/strict';
import {copyFileSync,chmodSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createPrivateRoot,writePrivate,assertSeparate,outsideSource} from '../dist/installation/files.js';
import {privatePath} from '../dist/standalone/workspace.js';
import {fileDigest} from '../dist/installation/runtime.js';
import {inventory} from '../dist/reasoning/toolchain.js';
import {hash} from '../dist/standalone/validation.js';
import {shaclWorkerSource,readSHACLToolchain,verifySHACLToolchain} from '../dist/native-v2/shacl-toolchain.js';

assert.equal(process.argv.length,4,'Usage: node scripts/prepare-shacl-worker.mjs ABS_PRIVATE_RUNTIME_ROOT ABS_NEW_WORKER_ROOT');
const runtimeRoot=outsideSource(process.argv[2]);privatePath(runtimeRoot,true);
const root=createPrivateRoot(process.argv[3]);assertSeparate(runtimeRoot,root);
const python=join(runtimeRoot,'venv','bin','python3.12');
assert.equal(realpathSync(python),realpathSync(join(runtimeRoot,'python','bin','python3.12')));
const source=shaclWorkerSource(),adapterDigest=fileDigest(source,1024*1024);
copyFileSync(source,join(root,'worker.py'));chmodSync(join(root,'worker.py'),0o600);
const runtimeFiles=inventory(runtimeRoot,['python','venv']);
const probe=spawnSync(python,['-I','-B',join(root,'worker.py'),'--probe'],{cwd:root,env:{PATH:'',LANG:'C.UTF-8',PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1'},encoding:'utf8',timeout:10000,maxBuffer:65536});
assert.ifError(probe.error);assert.equal(probe.status,0,probe.stderr);assert.deepEqual(JSON.parse(probe.stdout),{python:'3.12.12',pyshacl:'0.40.1',rdflib:'7.6.0'});
const identity={schema:'ontology-shacl-toolchain/v2',root,runtimeRoot,python,pythonVersion:'3.12.12',pyshacl:'0.40.1',rdflib:'7.6.0',platform:process.platform,arch:process.arch,adapterDigest,runtimeFiles};
writePrivate(join(root,'toolchain.json'),{...identity,digest:hash(identity)});
const binding=readSHACLToolchain(join(root,'toolchain.json'));verifySHACLToolchain(binding);
console.log(JSON.stringify({toolchainFile:join(root,'toolchain.json'),digest:binding.digest,adapterDigest,runtimeFiles:runtimeFiles.length,acceptance:'NOT_EVALUATED'}));
