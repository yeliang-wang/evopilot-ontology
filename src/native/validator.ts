import { spawn } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeBytesDigest, nativeDigest, nativeExact, nativeFrozenClone, nativePackageDigest, nativeSha256, nativeStableSerialize, nativeAssertJSON } from '../../vendor/compatibility/v1/native.mjs';
import type { NativePackage, NativeToolchain, NativeValidationContext, NativeCriterionResult } from '../../vendor/compatibility/v1/native.mjs';
import type { NativeOntologyValidation } from './types.js';
import { standardDirectory } from './standard.js';
import { validateOntologyPackage, packageParts } from './package.js';
import { fail } from '../state.js';
export const ontologyAdapterDigest = ():string => nativeBytesDigest(readFileSync(adapterPath));
const adapterPath = fileURLToPath(new URL('../../src/native/validator.py', import.meta.url));
const hex = /^[a-f0-9]{64}$/;
export function verifyOntologyToolchain(value: NativeToolchain): Readonly<NativeToolchain> {
  nativeAssertJSON(value);
  nativeExact(value,['schema','lockDigest','platform','arch','tools','dependencyLockDigest','timeoutMs','maxInputBytes','maxPackageBytes','environmentRoot','dependencyFiles']);
  if(value.schema!=='evopilot-native-toolchain/v1'||value.platform!==process.platform||value.arch!==process.arch||!value.environmentRoot||!isAbsolute(value.environmentRoot))fail('TOOLCHAIN_NOT_READY','Explicit installed platform and environment required');
  nativeDigest(value.lockDigest);nativeDigest(value.dependencyLockDigest);
  if(value.timeoutMs!==60000||!Number.isSafeInteger(value.maxInputBytes)||value.maxInputBytes<1||value.maxInputBytes>134217728||!Number.isSafeInteger(value.maxPackageBytes)||value.maxPackageBytes<1||value.maxPackageBytes>134217728)fail('TOOLCHAIN_NOT_READY','Fixed deadline and bounded input limits required');
  const environment=realpathSync(value.environmentRoot);
  const inside=(path:string):string=>{if(!isAbsolute(path))fail('TOOLCHAIN_NOT_READY','Absolute trusted tool path required');const resolved=realpathSync(path);if(!resolved.startsWith(environment+sep))fail('TOOLCHAIN_NOT_READY','Tool outside locked environment');return resolved;};
  const python=value.tools.python;
  if(!python||python.version!=='3.12.12'||!hex.test(python.sha256)||value.tools.pyshacl?.version!=='0.40.1')fail('TOOLCHAIN_NOT_READY','Pinned Python/pySHACL versions required');
  for(const tool of Object.values(value.tools)){
    const path=inside(tool.executable);if(!lstatSync(path).isFile()||!hex.test(tool.sha256)||nativeBytesDigest(readFileSync(path)).slice(7)!==tool.sha256)fail('TOOLCHAIN_DRIFT','Tool bytes differ from installed lock');
  }
  if(!Array.isArray(value.dependencyFiles)||!value.dependencyFiles.length)fail('TOOLCHAIN_NOT_READY','Complete dependency file lock required');
  const paths=new Set<string>(),roots=new Set<string>();
  for(const file of value.dependencyFiles){
    nativeExact(file,['path','sha256']); const path=inside(file.path);
    if(paths.has(path)||lstatSync(file.path).isSymbolicLink()||!lstatSync(path).isFile()||!hex.test(file.sha256)||nativeBytesDigest(readFileSync(path)).slice(7)!==file.sha256)fail('TOOLCHAIN_DRIFT','Dependency bytes or path differ');
    paths.add(path); const index=path.indexOf(sep+'site-packages'+sep);if(index>=0)roots.add(path.slice(0,index)+(sep+'site-packages'));
    const stdlib=path.indexOf(sep+'lib'+sep+'python3.12'+sep);if(stdlib>=0)roots.add(path.slice(0,stdlib)+(sep+'lib'+sep+'python3.12'));
  }
  if(!roots.size)fail('TOOLCHAIN_NOT_READY','Python dependency site directory missing');
  const visit=(path:string):void=>{for(const name of readdirSync(path)){const p=join(path,name),s=lstatSync(p);if(s.isSymbolicLink())fail('TOOLCHAIN_DRIFT','Linked dependency forbidden');if(s.isDirectory())visit(p);else if(!s.isFile()||!paths.has(p))fail('TOOLCHAIN_DRIFT','Unmanifested dependency/bytecode/injection file');}};
  roots.forEach(visit);
  if(nativeSha256(value.dependencyFiles)!==value.dependencyLockDigest)fail('TOOLCHAIN_DRIFT','Dependency lock digest mismatch');
  return nativeFrozenClone(value);
}
export async function validateNativeOntology(pkg: NativePackage, toolchain: NativeToolchain, context: NativeValidationContext|null = null): Promise<NativeOntologyValidation> {
  validateOntologyPackage(pkg);
  const tools=verifyOntologyToolchain(toolchain),adapterDigest=nativeBytesDigest(readFileSync(adapterPath));
  const payload=JSON.stringify({package:pkg,metaShapes:readFileSync(join(standardDirectory(),'meta-shapes.ttl'),'utf8')});
  if(Buffer.byteLength(payload)>tools.maxInputBytes||Buffer.byteLength(nativeStableSerialize(pkg))>tools.maxPackageBytes)fail('PACKAGE_LIMIT','Package exceeds installed tool limits');
  const start=Date.now();let timedOut=false,overflow=false;
  const processResult=await new Promise<NativeOntologyValidation['process']>((resolve)=>{
    let stdout='',stderr='',done=false;
    const child=spawn(tools.tools.python.executable,['-I','-B',adapterPath],{cwd:tools.environmentRoot,env:{PATH:'',LANG:'C.UTF-8',PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'},stdio:['pipe','pipe','pipe'],shell:false});
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},60000);
    const append=(chunk:Buffer,which:'stdout'|'stderr'):void=>{if(which==='stdout')stdout+=chunk.toString('utf8');else stderr+=chunk.toString('utf8');if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>16777216){overflow=true;child.kill('SIGKILL');}};
    child.stdout.on('data',(b:Buffer)=>append(b,'stdout'));child.stderr.on('data',(b:Buffer)=>append(b,'stderr'));
    const finish=(exitCode:number|null,signal:string|null):void=>{if(done)return;done=true;clearTimeout(timer);resolve({exitCode,signal,timedOut,stdout,stderr,durationMs:Date.now()-start});};
    child.on('error',e=>{stderr+=e.message;finish(null,null);});child.on('close',finish);child.stdin.on('error',()=>{});child.stdin.end(payload);
  });
  let parsed: Pick<NativeOntologyValidation,'status'|'rawReport'|'modelReport'|'diagnostics'|'results'|'caseReports'>;
  try {
    const raw:unknown=JSON.parse(processResult.stdout);nativeAssertJSON(raw);nativeExact(raw,['status','rawReport','modelReport','diagnostics','results','caseReports']);
    if(!['CONFORMS','NONCONFORMING','ERROR','UNSUPPORTED'].includes(raw.status as string)||typeof raw.rawReport!=='string'||typeof raw.modelReport!=='string'||!Array.isArray(raw.diagnostics)||!Array.isArray(raw.results)||!Array.isArray(raw.caseReports))throw Error('Malformed native adapter report');
    parsed=raw as typeof parsed;
    if(processResult.timedOut||processResult.signal||overflow||processResult.exitCode!==0&&parsed.status!=='ERROR')throw Error('Native process did not complete successfully');
    if(parsed.status==='CONFORMS'&&(!parsed.rawReport||!parsed.modelReport||!parsed.caseReports.length||parsed.caseReports.some(c=>!c.matchesExpected)))throw Error('Missing required native report or cases');
    verifyOntologyToolchain(tools);validateOntologyPackage(pkg);
    if(nativeBytesDigest(readFileSync(adapterPath))!==adapterDigest)throw Error('Adapter changed during validation');
  } catch(e) { parsed={status:'ERROR',rawReport:'',modelReport:'',results:[],caseReports:[],diagnostics:[{code:timedOut?'TIMEOUT':overflow?'OUTPUT_LIMIT':'INVALID_NATIVE_REPORT',message:e instanceof Error?e.message:'Native error'}]}; }
  const packageDigest=nativePackageDigest(pkg),{cases}=packageParts(pkg);
  const reportIds=parsed.caseReports.map(c=>c.id);
  if(new Set(reportIds).size!==reportIds.length||reportIds.some(id=>!cases.cases.some(c=>c.id===id))||parsed.status==='CONFORMS'&&cases.cases.some(c=>!reportIds.includes(c.id))){parsed={...parsed,status:'ERROR',diagnostics:[...parsed.diagnostics,{code:'INVALID_CASE_REPORT',message:'Actual case report identity differs from fixed manifest'}]};}
  const criteria:NativeCriterionResult[]=cases.cases.flatMap(c=>c.requirementIds.map(criterionId=>{
    const actual=parsed.caseReports.find(x=>x.id===c.id);
    const status:NativeCriterionResult['status']=parsed.status==='ERROR'?'ERROR':parsed.status==='UNSUPPORTED'?'ERROR':!actual?'UNKNOWN':actual.expectedConforms!==c.expectedConforms||!actual.matchesExpected||!actual.rawReport?'FAIL':parsed.status==='CONFORMS'?'PASS':'FAIL';
    return {criterionId,variantId:c.id,status,evidenceDigest:nativeSha256({criterionId,variantId:c.id,status,packageDigest,context,caseReport:actual??null,rawReport:parsed.rawReport,modelReport:parsed.modelReport,adapterDigest,toolchainLockDigest:tools.lockDigest})};
  }));
  const content={schema:'evopilot-ontology-validation/v1' as const,...parsed,criteria,packageDigest,standardPins:pkg.manifest.standardPins,toolchainLockDigest:tools.lockDigest,adapterDigest,process:processResult,context,authority:false as const,businessConfirmed:false as const};
  return nativeFrozenClone({...content,reportDigest:nativeSha256(content)}) as NativeOntologyValidation;
}
