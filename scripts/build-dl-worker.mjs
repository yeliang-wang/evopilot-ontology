import {readFileSync,readdirSync,mkdirSync,copyFileSync,rmSync,realpathSync,writeFileSync,chmodSync,lstatSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createPrivateRoot,writePrivate} from '../dist/installation/files.js';
import {inspectJavaRuntime,inventory,verifyDLToolchain} from '../dist/reasoning/toolchain.js';
import {hash,hashBytes} from '../dist/standalone/validation.js';

const args=process.argv.slice(2),flags=new Map();
for(let i=0;i<args.length;i+=2){if(!['--dependencies','--java-home','--output','--engine-source','--parser-source'].includes(args[i])||flags.has(args[i])||!args[i+1]||!isAbsolute(args[i+1]))throw new Error('Usage: --dependencies ABS --java-home ABS --output ABS --engine-source ABS --parser-source ABS');flags.set(args[i],args[i+1]);}
if(flags.size!==5)throw new Error('Five explicit locations required');
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
  'org/semanticweb/HermiT/datatypes/binarydata/BinaryData.java',
  'org/semanticweb/HermiT/datatypes/anyuri/AnyURIValueSpaceSubset.java'];
if(!Array.isArray(patch.files)||JSON.stringify(patch.files.map(f=>f.sourceEntry).sort())!==JSON.stringify(expectedEntries.sort()))throw new Error('Unknown patched source entries');
if(!Array.isArray(patch.ownedSources)||patch.ownedSources.length!==1||patch.ownedSources[0].file!=='XmlSchemaAutomata.java')throw new Error('Unknown formal helper source');
if(lock.parserPatch?.file!=='parser-compat.json')throw new Error('Unknown parser adapter recipe');
const parserPatchFile=join(directory,lock.parserPatch.file);
if(sha(parserPatchFile)!==lock.parserPatch.sha256)throw new Error('Parser adapter recipe digest mismatch');
const parserPatch=JSON.parse(readFileSync(parserPatchFile)),parserSource=realpathSync(flags.get('--parser-source'));
const parserEntry='org/semanticweb/owlapi/functional/parser/CustomTokenizer.java';
const parserArchiveURL='https://repo.maven.apache.org/maven2/net/sourceforge/owlapi/owlapi-parsers/5.5.1/owlapi-parsers-5.5.1-sources.jar';
const parserArchiveSHA='ca5ade39883033eb730faa86a8c3af1ad8ed6f0484384369b2e5f02af6af4293';
const parserNode=lstatSync(parserSource);
if(parserPatch.schema!=='ontology-dl-parser-compat/v1'||parserPatch.parserId!=='owlapi-functional-locations:1'
  ||parserPatch.sourceArchive?.url!==parserArchiveURL||parserPatch.sourceArchive?.sha256!==parserArchiveSHA
  ||!parserNode.isFile()||parserNode.nlink!==1||parserNode.size!==515012||sha(parserSource)!==parserArchiveSHA)throw new Error('Parser source differs from exact adapter binding');
if(!Array.isArray(parserPatch.files)||parserPatch.files.length!==1||parserPatch.files[0].sourceEntry!==parserEntry||parserPatch.files[0].outputFile!=='LocatedTokenizer.java'
  ||!Array.isArray(parserPatch.ownedSources)||parserPatch.ownedSources.length!==1||parserPatch.ownedSources[0].file!=='LocatedFunctionalParser.java')throw new Error('Unknown parser adapter source entries');
for(const file of parserPatch.files){
  if(!/^[a-f0-9]{64}$/.test(file.sourceSHA256)||!/^[a-f0-9]{64}$/.test(file.patchedSourceSHA256)||!Array.isArray(file.changes)||!file.changes.length
    ||file.changes.some(c=>typeof c.find!=='string'||!c.find||typeof c.replace!=='string'||!Number.isSafeInteger(c.occurrences)||c.occurrences<1))throw new Error('Invalid parser adapter patch');
}
if(!/^[a-f0-9]{64}$/.test(parserPatch.ownedSources[0].sha256)||typeof parserPatch.notice!=='string'||!parserPatch.notice.trim()||Buffer.byteLength(parserPatch.notice)>16384)throw new Error('Invalid parser adapter source notice');
const turtlePackage='org/semanticweb/owlapi/rdf/turtle/parser/',rdfPackage='org/semanticweb/owlapi/rdf/rdfxml/parser/';
const additionalParserSpecs=[
  {key:'turtlePatch',file:'turtle-compat.json',parserId:'owlapi-turtle-occurrences:1',provenance:'turtle',notice:'EVOPILOT-TURTLE-MODIFICATION.txt',package:turtlePackage,
    files:[
      ['TurtleParser.java','LocatedTurtleSyntaxParser.java','3a1d6dc6f2b02fe8963fc65f22faa3b2c8a5234b90471691942eee33e019a8fd'],
      ['JavaCharStream.java','LocatedTurtleCharStream.java','ddd395b54f835a6d5c8ca31c9c7141c8ddc3ca6db6b0ee54bdfe79f607918fc6'],
      ['TurtleParserTokenManager.java','LocatedTurtleTokenManager.java','190b0a01242d12aaa42e77b059dfc4b555e6a666f5dad212a25a23de4178e7d6'],
    ],owned:['LocatedTurtleParser.java','RDFIRI.java']},
  {key:'rdfMappingPatch',file:'rdf-mapping-compat.json',parserId:'owlapi-rdf-mapping-provenance:1',provenance:'rdf-mapping',notice:'EVOPILOT-RDF-MAPPING-MODIFICATION.txt',package:rdfPackage,
    files:[
      ['OWLRDFConsumer.java','LocatedRDFConsumer.java','cff71d016eab2e7b3f27920d83204f26e7fb6bfdcddc82ccdd06da7fc010567b'],
      ['Translators.java','LocatedTranslators.java','16f0dcf7bb7e32e3880835c8d94626e4893a21725b443a3b8738e33b8c557b34'],
      ['TripleHandlers.java','LocatedTripleHandlers.java','96877b272df96ee480b27a7fb1974744c2101bd00273ddeb6e8b6034d895f70a'],
      ['OptimisedListTranslator.java','LocatedOptimisedListTranslator.java','7f2f16421fecdc6688db09b9a32a43fc946348ce74cfb41eb3b53716a8b7a564'],
    ],owned:['LocatedRDFConsumerAdapter.java','RDFProvenance.java']},
  {key:'rdfxmlPatch',file:'rdfxml-compat.json',parserId:'owlapi-rdfxml-occurrences:1',provenance:'rdfxml',notice:'EVOPILOT-RDFXML-MODIFICATION.txt',package:rdfPackage,
    files:[
      ['RDFParser.java','LocatedRDFXMLSyntaxParser.java','c756d2bfe0ff851c534f72b7e37a8741864c3622686e3efb77b5b2830a09b8b6'],
      ['StartRDF.java','LocatedXMLStartRDF.java','17c2a6e67704e02f7a44a6f6ede656ab901c83141d210ba99a5690d581b447bf'],
    ],owned:['LocatedRDFXMLParser.java','RDFXMLRawScanner.java'],
    additionalClassRoots:['LocatedXMLAbstractState','LocatedXMLEmptyPropertyElement','LocatedXMLNodeElement','LocatedXMLNodeElementList',
      'LocatedXMLParseTypeCollectionElement','LocatedXMLResourceOrLiteralElement','LocatedXMLParseTypeLiteralElement','LocatedXMLParseTypeResourceElement',
      'LocatedXMLPropertyElementList','LocatedXMLReificationManager','LocatedXMLReifiedStatementBag']},
];
// The approved entry/output sets live here, not in the supplied recipes. A
// recipe hash alone cannot widen the source extraction or compiled class scope.
const additionalParsers=additionalParserSpecs.map(spec=>{
  const binding=lock[spec.key];
  if(!binding||JSON.stringify(Object.keys(binding).sort())!==JSON.stringify(['file','sha256'])||binding.file!==spec.file||!/^[a-f0-9]{64}$/.test(binding.sha256))throw new Error('Unknown additional parser recipe binding: '+spec.key);
  const recipeFile=join(directory,spec.file);
  if(sha(recipeFile)!==binding.sha256)throw new Error('Additional parser recipe digest mismatch: '+spec.file);
  const recipe=JSON.parse(readFileSync(recipeFile));
  if(recipe.schema!=='ontology-dl-parser-compat/v1'||recipe.parserId!==spec.parserId||recipe.sourceArchive?.url!==parserArchiveURL||recipe.sourceArchive?.sha256!==parserArchiveSHA)throw new Error('Additional parser source differs from its exact binding');
  const expected=spec.files.map(([entry,output,sourceSHA256])=>[spec.package+entry,output,sourceSHA256]);
  if(!Array.isArray(recipe.files)||JSON.stringify(recipe.files.map(f=>[f.sourceEntry,f.outputFile,f.sourceSHA256]).sort())!==JSON.stringify(expected.sort())
    ||!Array.isArray(recipe.ownedSources)||JSON.stringify(recipe.ownedSources.map(f=>f.file).sort())!==JSON.stringify([...spec.owned].sort()))throw new Error('Unknown additional parser source entries');
  for(const file of recipe.files){
    if(!/^[a-f0-9]{64}$/.test(file.patchedSourceSHA256)||!Array.isArray(file.changes)||!file.changes.length
      ||file.changes.some(c=>typeof c.find!=='string'||!c.find||typeof c.replace!=='string'||!Number.isSafeInteger(c.occurrences)||c.occurrences<1))throw new Error('Invalid additional parser patch');
  }
  if(recipe.ownedSources.some(f=>!/^[a-f0-9]{64}$/.test(f.sha256))||typeof recipe.notice!=='string'||!recipe.notice.trim()||Buffer.byteLength(recipe.notice)>16384)throw new Error('Invalid additional parser helper or notice');
  return {...spec,recipeFile,recipe,digest:binding.sha256};
});
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
// This is a separately named tokenizer/facade, not an override of OWLAPI's
// original classes. Keep its exact source, recipe and notice inside the existing
// engine-source inventory so executable and provenance drift fail together.
const parserProvenance=join(provenance,'parser');mkdirSync(parserProvenance,{mode:0o700});
const retainedParserArchive=join(parserProvenance,'upstream-sources.jar');
copyFileSync(parserSource,retainedParserArchive);chmodSync(retainedParserArchive,0o600);
copyFileSync(parserPatchFile,join(parserProvenance,'parser-compat.json'));chmodSync(join(parserProvenance,'parser-compat.json'),0o600);
if(sha(retainedParserArchive)!==parserArchiveSHA||sha(join(parserProvenance,'parser-compat.json'))!==lock.parserPatch.sha256)throw new Error('Copied parser source provenance differs');
const listing=execFileSync(join(javaRoot,'bin/jar'),['--list','--file',retainedParserArchive],{env,encoding:'utf8',stdio:'pipe',timeout:30000,maxBuffer:4*1024*1024});
const parserMembers=listing.split(/\r?\n/);if(parserMembers.at(-1)==='')parserMembers.pop();
if(!parserMembers.length||parserMembers.length>10000||new Set(parserMembers).size!==parserMembers.length
  ||parserMembers.some(name=>!name||name.length>4096||isAbsolute(name)||/[\\\x00-\x1f\x7f]/.test(name)||name.replace(/\/$/,'').split('/').some(p=>['','..','.'].includes(p)))
  ||parserMembers.filter(name=>name===parserEntry).length!==1||parserMembers.some(name=>name!==parserEntry&&name.startsWith(parserEntry)))throw new Error('Unsafe or ambiguous parser archive members');
execFileSync(join(javaRoot,'bin/jar'),['--extract','--file',retainedParserArchive,parserEntry],{cwd:parserProvenance,env,stdio:'pipe',timeout:30000});
for(const file of parserPatch.files){
  const input=join(parserProvenance,file.sourceEntry),node=lstatSync(input);
  if(!node.isFile()||node.nlink!==1||node.size>2*1024*1024||sha(input)!==file.sourceSHA256)throw new Error('Upstream parser source entry differs');
  let content=readFileSync(input,'utf8');
  for(const change of file.changes){if(content.split(change.find).length-1!==change.occurrences)throw new Error('Parser adapter patch context differs');content=content.split(change.find).join(change.replace);}
  if(hashBytes(Buffer.from(content))!=='sha256:'+file.patchedSourceSHA256)throw new Error('Patched parser source digest mismatch');
  const target=join(parserProvenance,file.outputFile);writeFileSync(target,content,{mode:0o600,flag:'wx'});modified.push(target);
}
for(const file of parserPatch.ownedSources){
  const input=join(directory,file.file),target=join(parserProvenance,file.file);
  if(sha(input)!==file.sha256)throw new Error('Owned parser facade digest mismatch');
  copyFileSync(input,target);chmodSync(target,0o600);if(sha(target)!==file.sha256)throw new Error('Copied parser facade differs');modified.push(target);
}
rmSync(join(parserProvenance,'org'),{recursive:true});
for(const adapter of additionalParsers){
  const targetRoot=join(provenance,adapter.provenance);mkdirSync(targetRoot,{mode:0o700});
  const retainedArchive=join(targetRoot,'upstream-sources.jar'),retainedRecipe=join(targetRoot,adapter.file);
  copyFileSync(retainedParserArchive,retainedArchive);chmodSync(retainedArchive,0o600);
  copyFileSync(adapter.recipeFile,retainedRecipe);chmodSync(retainedRecipe,0o600);
  if(sha(retainedArchive)!==parserArchiveSHA||sha(retainedRecipe)!==adapter.digest)throw new Error('Copied additional parser provenance differs');
  const entries=adapter.recipe.files.map(f=>f.sourceEntry);
  if(entries.some(entry=>parserMembers.filter(name=>name===entry).length!==1||parserMembers.some(name=>name!==entry&&name.startsWith(entry))))throw new Error('Ambiguous additional parser archive member');
  execFileSync(join(javaRoot,'bin/jar'),['--extract','--file',retainedArchive,...entries],{cwd:targetRoot,env,stdio:'pipe',timeout:30000});
  for(const file of adapter.recipe.files){
    const input=join(targetRoot,file.sourceEntry),node=lstatSync(input);
    if(!node.isFile()||node.nlink!==1||node.size>2*1024*1024||sha(input)!==file.sourceSHA256)throw new Error('Additional parser source entry differs');
    let content=readFileSync(input,'utf8');
    for(const change of file.changes){if(content.split(change.find).length-1!==change.occurrences)throw new Error('Additional parser patch context differs');content=content.split(change.find).join(change.replace);}
    if(hashBytes(Buffer.from(content))!=='sha256:'+file.patchedSourceSHA256)throw new Error('Additional patched parser source digest mismatch');
    const target=join(targetRoot,file.outputFile);writeFileSync(target,content,{mode:0o600,flag:'wx'});modified.push(target);
  }
  for(const file of adapter.recipe.ownedSources){
    const input=join(directory,file.file),target=join(targetRoot,file.file),node=lstatSync(input);
    if(!node.isFile()||node.nlink!==1||node.size>2*1024*1024||sha(input)!==file.sha256)throw new Error('Additional parser helper digest mismatch');
    copyFileSync(input,target);chmodSync(target,0o600);if(sha(target)!==file.sha256)throw new Error('Copied additional parser helper differs');modified.push(target);
  }
  rmSync(join(targetRoot,'org'),{recursive:true});
}
// The worker JAR precedes upstream JARs explicitly in javaClasspath. Its modified
// HermiT class is separately identified by the engine label and source manifest.
execFileSync(join(javaRoot,'bin/javac'),['--release','21','-classpath',classpath,'-d',classes,source,...modified],{env,stdio:'pipe',timeout:30000});
const classRoots=['org/semanticweb/owlapi/functional/parser/LocatedTokenizer','org/semanticweb/owlapi/functional/parser/LocatedFunctionalParser',
  ...additionalParsers.flatMap(adapter=>[
    ...[...adapter.files.map(([,output])=>output),...adapter.owned].map(file=>adapter.package+file.slice(0,-5)),
    ...(adapter.additionalClassRoots??[]).map(name=>adapter.package+name)])];
const compiledParserNames=[];
function compiledParserFiles(path){
  for(const name of readdirSync(join(classes,path))){
    const relative=path+'/'+name,node=lstatSync(join(classes,relative));
    if(node.isDirectory()){compiledParserFiles(relative);continue;}
    if(!node.isFile()||node.nlink!==1||!name.endsWith('.class')||compiledParserNames.length>=10000)throw new Error('Unexpected compiled OWLAPI parser material');
    compiledParserNames.push(relative);
  }
}
compiledParserFiles('org/semanticweb/owlapi');
if(classRoots.some(root=>!compiledParserNames.includes(root+'.class'))||compiledParserNames.some(name=>!classRoots.some(root=>name===root+'.class'||name.startsWith(root+'$')&&/^\$[A-Za-z0-9_$]+\.class$/.test(name.slice(root.length)))))throw new Error('Compiled parser classes differ from the approved renamed closure');
// Inspect every locked binary, including package-private and nested classes.
// The only intentional upstream replacements are the separately bound HermiT
// sources; no original OWLAPI binary name may enter the worker JAR.
const upstreamClasses=new Set();let upstreamEntries=0;
for(const dependency of lock.files){
  const binary=join(root,'dependencies',dependency.file);
  if(sha(binary)!==dependency.sha256)throw new Error('Dependency changed before compiled parser comparison');
  const names=execFileSync(join(javaRoot,'bin/jar'),['--list','--file',binary],{env,encoding:'utf8',stdio:'pipe',timeout:30000,maxBuffer:4*1024*1024}).split(/\r?\n/).filter(Boolean);
  if((upstreamEntries+=names.length)>100000)throw new Error('Upstream class inventory exceeds its build budget');
  for(const name of names)if(name.endsWith('.class'))upstreamClasses.add(name.replace(/^META-INF\/versions\/[0-9]+\//,''));
  if(sha(binary)!==dependency.sha256)throw new Error('Dependency changed during compiled parser comparison');
}
if(compiledParserNames.some(name=>upstreamClasses.has(name)))throw new Error('Parser adapter must not shadow an original upstream class');
mkdirSync(join(classes,'META-INF'),{mode:0o700});writeFileSync(join(classes,'META-INF','EVOPILOT-ENGINE-MODIFICATION.txt'),patch.notice+'\nSource and recipe: ../engine-source\n',{mode:0o600});
writeFileSync(join(classes,'META-INF','EVOPILOT-PARSER-MODIFICATION.txt'),parserPatch.notice+'\nAdapter: '+parserPatch.parserId+'\nSource and recipe: ../engine-source/parser\n',{mode:0o600});
for(const adapter of additionalParsers)writeFileSync(join(classes,'META-INF',adapter.notice),adapter.recipe.notice+'\nAdapter: '+adapter.parserId+'\nSource and recipe: ../engine-source/'+adapter.provenance+'\n',{mode:0o600});
execFileSync(join(javaRoot,'bin/jar'),['--create','--file',join(root,'worker.jar'),'--date','2026-01-01T00:00:00Z','-C',classes,'.'],{env,stdio:'pipe',timeout:30000});
chmodSync(join(root,'worker.jar'),0o600);rmSync(classes,{recursive:true});
const identity={schema:'ontology-dl-toolchain/v1',root,javaRoot,javaVersion,platform:process.platform,arch:process.arch,engine:lock.engine,owlapi:lock.owlapi,workerSourceDigest:hashBytes(readFileSync(source)),dependencyLockDigest:hashBytes(lockBytes),runtimeFiles:inventory(root),javaFiles:inspectJavaRuntime(javaRoot)};
const binding={...identity,digest:hash(identity)};writePrivate(join(root,'toolchain.json'),binding);verifyDLToolchain(binding);
process.stdout.write(JSON.stringify({toolchainFile:join(root,'toolchain.json'),digest:binding.digest,engine:binding.engine,owlapi:binding.owlapi,javaVersion:binding.javaVersion,releaseReview:'NOT_EVALUATED'})+'\n');
