import {readFileSync,readdirSync,mkdirSync,copyFileSync,rmSync,realpathSync,writeFileSync,chmodSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createPrivateRoot,writePrivate} from '../dist/installation/files.js';
import {inspectJavaRuntime,inventory,verifyDLToolchain} from '../dist/reasoning/toolchain.js';
import {hash,hashBytes} from '../dist/standalone/validation.js';

const args=process.argv.slice(2),flags=new Map();
for(let i=0;i<args.length;i+=2){if(!['--dependencies','--java-home','--output'].includes(args[i])||flags.has(args[i])||!args[i+1]||!isAbsolute(args[i+1]))throw new Error('Usage: --dependencies ABS --java-home ABS --output ABS');flags.set(args[i],args[i+1]);}
if(flags.size!==3)throw new Error('Three explicit locations required');
const directory=fileURLToPath(new URL('../toolchains/owl2-dl/',import.meta.url));
const lockBytes=readFileSync(join(directory,'dependencies.json')),lock=JSON.parse(lockBytes);
const dependencies=realpathSync(flags.get('--dependencies')),javaRoot=realpathSync(flags.get('--java-home'));
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
if(JSON.stringify(readdirSync(dependencies).sort())!==JSON.stringify(lock.files.map(f=>f.file).sort()))throw new Error('Dependency closure differs from source lock');
for(const file of lock.files)if(sha(join(dependencies,file.file))!==file.sha256)throw new Error('Dependency digest mismatch: '+file.file);
// java -version normally writes stderr; capture it explicitly without parsing shell output.
const inspected=spawnSync(join(javaRoot,'bin/java'),['-version'],{encoding:'utf8',env:{PATH:join(javaRoot,'bin'),JAVA_TOOL_OPTIONS:'',JDK_JAVA_OPTIONS:'',_JAVA_OPTIONS:''}});
if(inspected.status!==0)throw new Error('Cannot inspect Java');
const javaVersion=(inspected.stderr+inspected.stdout).match(/version "(21\.[^"]+)"/)?.[1];if(!javaVersion)throw new Error('Java 21 required');
const root=createPrivateRoot(flags.get('--output')),classes=join(root,'classes');mkdirSync(classes,{mode:0o700});mkdirSync(join(root,'dependencies'),{mode:0o700});
for(const file of lock.files){copyFileSync(join(dependencies,file.file),join(root,'dependencies',file.file));chmodSync(join(root,'dependencies',file.file),0o600);}
const source=join(directory,'Worker.java'),classpath=lock.files.map(f=>join(root,'dependencies',f.file)).join(process.platform==='win32'?';':':');
const env={PATH:join(javaRoot,'bin'),LANG:'C.UTF-8',JAVA_TOOL_OPTIONS:'',JDK_JAVA_OPTIONS:'',_JAVA_OPTIONS:''};
execFileSync(join(javaRoot,'bin/javac'),['--release','21','-classpath',classpath,'-d',classes,source],{env,stdio:'pipe',timeout:30000});
execFileSync(join(javaRoot,'bin/jar'),['--create','--file',join(root,'worker.jar'),'--date','2026-01-01T00:00:00Z','-C',classes,'.'],{env,stdio:'pipe',timeout:30000});
chmodSync(join(root,'worker.jar'),0o600);rmSync(classes,{recursive:true});
const identity={schema:'ontology-dl-toolchain/v1',root,javaRoot,javaVersion,platform:process.platform,arch:process.arch,engine:lock.engine,owlapi:lock.owlapi,workerSourceDigest:hashBytes(readFileSync(source)),dependencyLockDigest:hashBytes(lockBytes),runtimeFiles:inventory(root),javaFiles:inspectJavaRuntime(javaRoot)};
const binding={...identity,digest:hash(identity)};writePrivate(join(root,'toolchain.json'),binding);verifyDLToolchain(binding);
process.stdout.write(JSON.stringify({toolchainFile:join(root,'toolchain.json'),digest:binding.digest,engine:binding.engine,owlapi:binding.owlapi,javaVersion:binding.javaVersion,releaseReview:'NOT_EVALUATED'})+'\n');
