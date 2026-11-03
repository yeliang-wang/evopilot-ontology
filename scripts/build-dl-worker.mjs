import {readFileSync,readdirSync,mkdirSync,copyFileSync,rmSync,realpathSync,writeFileSync,chmodSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createPrivateRoot,writePrivate} from '../dist/installation/files.js';
import {inspectJavaRuntime,inventory,verifyDLToolchain} from '../dist/reasoning/toolchain.js';
import {hash,hashBytes} from '../dist/standalone/validation.js';

const args=process.argv.slice(2),flags=new Map();
for(let i=0;i<args.length;i+=2){if(!['--dependencies','--java-home','--output','--engine-source'].includes(args[i])||flags.has(args[i])||!args[i+1]||!isAbsolute(args[i+1]))throw new Error('Usage: --dependencies ABS --java-home ABS --output ABS --engine-source ABS');flags.set(args[i],args[i+1]);}
if(flags.size!==4)throw new Error('Four explicit locations required');
const directory=fileURLToPath(new URL('../toolchains/owl2-dl/',import.meta.url));
const lockBytes=readFileSync(join(directory,'dependencies.json')),lock=JSON.parse(lockBytes);
const dependencies=realpathSync(flags.get('--dependencies')),javaRoot=realpathSync(flags.get('--java-home'));
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
if(lock.enginePatch.file!=='engine-compat.json')throw new Error('Unknown engine patch source');
const patchFile=join(directory,lock.enginePatch.file);
if(sha(patchFile)!==lock.enginePatch.sha256)throw new Error('Engine patch digest mismatch');
const patch=JSON.parse(readFileSync(patchFile)),engineSource=realpathSync(flags.get('--engine-source'));
if(patch.schema!=='ontology-dl-engine-compat/v2'||patch.engine!=='org.semanticweb.hermit:1.4.5.519+evopilot.2'||sha(engineSource)!==patch.sourceArchive.sha256)throw new Error('Engine source differs from exact compatibility binding');
const expectedEntries=['org/semanticweb/HermiT/structural/ExpressionManager.java',
  'org/semanticweb/HermiT/datatypes/rdfplainliteral/RDFPlainLiteralPatternValueSpaceSubset.java',
  'org/semanticweb/HermiT/datatypes/rdfplainliteral/RDFPlainLiteralLengthInterval.java',
  'org/semanticweb/HermiT/datatypes/anyuri/AnyURIValueSpaceSubset.java'];
if(!Array.isArray(patch.files)||JSON.stringify(patch.files.map(f=>f.sourceEntry).sort())!==JSON.stringify(expectedEntries.sort()))throw new Error('Unknown patched source entries');
if(!Array.isArray(patch.ownedSources)||patch.ownedSources.length!==1||patch.ownedSources[0].file!=='XmlSchemaAutomata.java')throw new Error('Unknown formal helper source');
if(JSON.stringify(readdirSync(dependencies).sort())!==JSON.stringify(lock.files.map(f=>f.file).sort()))throw new Error('Dependency closure differs from source lock');
for(const file of lock.files)if(sha(join(dependencies,file.file))!==file.sha256)throw new Error('Dependency digest mismatch: '+file.file);
// java -version normally writes stderr; capture it explicitly without parsing shell output.
const inspected=spawnSync(join(javaRoot,'bin/java'),['-version'],{encoding:'utf8',env:{PATH:join(javaRoot,'bin'),JAVA_TOOL_OPTIONS:'',JDK_JAVA_OPTIONS:'',_JAVA_OPTIONS:''}});
if(inspected.status!==0)throw new Error('Cannot inspect Java');
const javaVersion=(inspected.stderr+inspected.stdout).match(/version "(21\.[^"]+)"/)?.[1];if(!javaVersion)throw new Error('Java 21 required');
const root=createPrivateRoot(flags.get('--output')),classes=join(root,'classes');mkdirSync(classes,{mode:0o700});mkdirSync(join(root,'dependencies'),{mode:0o700});
for(const file of lock.files){const target=join(root,'dependencies',file.file);copyFileSync(join(dependencies,file.file),target);chmodSync(target,0o600);if(sha(target)!==file.sha256)throw new Error('Copied dependency digest differs: '+file.file);}
const source=join(directory,'Worker.java'),classpath=lock.files.map(f=>join(root,'dependencies',f.file)).join(process.platform==='win32'?';':':');
const env={PATH:join(javaRoot,'bin'),LANG:'C.UTF-8',JAVA_TOOL_OPTIONS:'',JDK_JAVA_OPTIONS:'',_JAVA_OPTIONS:''};
// Extract only the named entries from the already hash-verified upstream archive.
// Retain original archive, modification recipe and exact modified source together
// with the installed artifact; the upstream dependency JAR itself is untouched.
const provenance=join(root,'engine-source');mkdirSync(provenance,{mode:0o700});
copyFileSync(engineSource,join(provenance,'upstream-sources.jar'));chmodSync(join(provenance,'upstream-sources.jar'),0o600);
copyFileSync(patchFile,join(provenance,'engine-compat.json'));chmodSync(join(provenance,'engine-compat.json'),0o600);
if(sha(join(provenance,'upstream-sources.jar'))!==patch.sourceArchive.sha256||sha(join(provenance,'engine-compat.json'))!==lock.enginePatch.sha256)throw new Error('Copied engine source provenance differs');
execFileSync(join(javaRoot,'bin/jar'),['--extract','--file',join(provenance,'upstream-sources.jar'),...expectedEntries],{cwd:provenance,env,stdio:'pipe',timeout:30000});
const modified=[];
for(const file of patch.files){
  const upstreamSource=join(provenance,file.sourceEntry);
  if(sha(upstreamSource)!==file.sourceSHA256)throw new Error('Upstream source entry digest mismatch');
  let patched=readFileSync(upstreamSource,'utf8');
  for(const change of file.changes){if(!change.find||patched.split(change.find).length-1!==change.occurrences)throw new Error('Engine patch context differs');patched=patched.split(change.find).join(change.replace);}
  if(hashBytes(Buffer.from(patched))!=='sha256:'+file.patchedSourceSHA256)throw new Error('Patched source digest mismatch');
  const target=join(provenance,file.sourceEntry.split('/').at(-1));writeFileSync(target,patched,{mode:0o600});modified.push(target);
}
for(const file of patch.ownedSources){
  const input=join(directory,file.file),target=join(provenance,file.file);
  if(sha(input)!==file.sha256)throw new Error('Owned formal helper digest mismatch');
  copyFileSync(input,target);chmodSync(target,0o600);if(sha(target)!==file.sha256)throw new Error('Copied formal helper differs');modified.push(target);
}
rmSync(join(provenance,'org'),{recursive:true});
// The worker JAR precedes upstream JARs explicitly in javaClasspath. Its modified
// HermiT class is separately identified by the engine label and source manifest.
execFileSync(join(javaRoot,'bin/javac'),['--release','21','-classpath',classpath,'-d',classes,source,...modified],{env,stdio:'pipe',timeout:30000});
mkdirSync(join(classes,'META-INF'),{mode:0o700});writeFileSync(join(classes,'META-INF','EVOPILOT-ENGINE-MODIFICATION.txt'),patch.notice+'\nSource and recipe: ../engine-source\n',{mode:0o600});
execFileSync(join(javaRoot,'bin/jar'),['--create','--file',join(root,'worker.jar'),'--date','2026-01-01T00:00:00Z','-C',classes,'.'],{env,stdio:'pipe',timeout:30000});
chmodSync(join(root,'worker.jar'),0o600);rmSync(classes,{recursive:true});
const identity={schema:'ontology-dl-toolchain/v1',root,javaRoot,javaVersion,platform:process.platform,arch:process.arch,engine:lock.engine,owlapi:lock.owlapi,workerSourceDigest:hashBytes(readFileSync(source)),dependencyLockDigest:hashBytes(lockBytes),runtimeFiles:inventory(root),javaFiles:inspectJavaRuntime(javaRoot)};
const binding={...identity,digest:hash(identity)};writePrivate(join(root,'toolchain.json'),binding);verifyDLToolchain(binding);
process.stdout.write(JSON.stringify({toolchainFile:join(root,'toolchain.json'),digest:binding.digest,engine:binding.engine,owlapi:binding.owlapi,javaVersion:binding.javaVersion,releaseReview:'NOT_EVALUATED'})+'\n');
