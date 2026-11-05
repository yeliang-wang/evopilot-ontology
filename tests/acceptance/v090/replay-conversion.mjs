// Acceptance-only serialization adapter. It is never a product parser capability.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {hashBytes} from '../../../scripts/standards-gate.mjs';
export const converterSource=new URL('./ReplayConvert.java',import.meta.url);
export function convertFunctional(c,content,name,purpose){
  assert.match(name,/^[a-z0-9-]+$/);assert(purpose);
  const tool=JSON.parse(readFileSync(c.config.dl.path));assert.equal(tool.digest,c.config.dl.digest);
  const jars=tool.runtimeFiles.filter(f=>f.kind==='file'&&f.path.startsWith('dependencies/')&&f.path.endsWith('.jar')).map(f=>{const path=join(tool.root,f.path);assert.equal(hashBytes(readFileSync(path)),f.digest);return path;});assert(jars.length);
  const java=join(tool.javaRoot,'bin/java'),javaFile=tool.javaFiles.find(f=>f.path==='bin/java');assert(javaFile);assert.equal(hashBytes(readFileSync(java)),javaFile.digest);
  const prepared=c.support('external-replay-converter');assert.equal(prepared.schema,'ontology-private-external-replay-converter/v1');assert.equal(prepared.productCapability,false);assert.equal(prepared.className,'ReplayConvert');assert.equal(prepared.sourceDigest,hashBytes(readFileSync(converterSource)));assert.equal(prepared.compiler.release,21);assert.equal(prepared.compiler.dependencyLockDigest,tool.dependencyLockDigest);
  const classes=join(c.root,'external-converter'),classFile=join(classes,'ReplayConvert.class'),classBytes=c.evidenceReference(prepared.classFile);assert(classBytes.length>4&&classBytes.readUInt32BE(0)===0xcafebabe);
  if(existsSync(classFile))assert.deepEqual(readFileSync(classFile),classBytes);else{mkdirSync(classes,{mode:0o700});writeFileSync(classFile,classBytes,{flag:'wx',mode:0o600});}
  const input=join(c.root,name+'.ofn'),output=join(c.root,name+'.rdf');writeFileSync(input,content,{flag:'wx',mode:0o600});
  const p=spawnSync(java,['-Xmx256m','--class-path',[classes,...jars].join(':'),'ReplayConvert',input,output],{env:{PATH:join(tool.javaRoot,'bin'),LANG:'C.UTF-8',JAVA_TOOL_OPTIONS:'',JDK_JAVA_OPTIONS:'',_JAVA_OPTIONS:''},encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  c.observe({kind:'EXTERNAL_ACCEPTANCE_FORMAT_CONVERTER',productCapability:false,purpose,inputDigest:hashBytes(content),converterDigest:prepared.sourceDigest,compiledClassDigest:prepared.classFile.digest,compiler:prepared.compiler,toolchainDigest:tool.digest,status:p.status,signal:p.signal,stdout:p.stdout,stderr:p.stderr});assert.ifError(p.error);assert.equal(p.status,0,p.stderr);
  const rdfxml=readFileSync(output,'utf8'),metadata=JSON.parse(p.stdout);assert.equal(metadata.logicalAxiomsEqual,true);
  return {content:rdfxml,digest:hashBytes(rdfxml),metadata};
}
