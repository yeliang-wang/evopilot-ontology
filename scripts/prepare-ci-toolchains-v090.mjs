// Source CI preparation only. Distribution installation uses the public installer.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync,realpathSync,openSync,closeSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

assert.equal(process.versions.node,'24.14.0');
const [output,java]=process.argv.slice(2);
assert.equal(process.argv.length,4,'Usage: node scripts/prepare-ci-toolchains-v090.mjs ABS_NEW_OUTPUT ABS_JAVA_HOME');
assert(isAbsolute(output)&&isAbsolute(java));
const source=fileURLToPath(new URL('../',import.meta.url)),root=resolve(output),javaRoot=realpathSync(java);
assert(!root.startsWith(source),'CI materials must remain outside the source checkout');
mkdirSync(root,{mode:0o700});
const write=(name,value)=>writeFileSync(join(root,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
function run(label,args,timeout=300000){
  const stdout=join(root,label+'.stdout'),stderr=join(root,label+'.stderr'),out=openSync(stdout,'wx',0o600),err=openSync(stderr,'wx',0o600);let p;
  // The frozen legacy CLI exits explicitly; a file descriptor preserves its
  // complete large JSON where a pipe may lose pending asynchronous stdout.
  try{p=spawnSync(process.execPath,args,{cwd:source,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore',out,err],timeout});}
  finally{closeSync(out);closeSync(err);}
  write(label+'.json',{args,stdout,stderr,status:p.status,error:p.error?.message??null});
  assert.ifError(p.error);assert.equal(p.status,0,'Inspect retained '+label+'.json before retry');
  try{return JSON.parse(readFileSync(stdout,'utf8'));}catch{throw Error('Invalid JSON; inspect retained '+stdout);}
}
const native=run('native-prepare',['vendor/compatibility/v1/toolchain/cli.js','prepare','--cache',join(root,'native-cache')],600000);
write('native-toolchain.json',native);
assert(isAbsolute(native.environmentRoot));
mkdirSync(join(root,'dependencies'),{mode:0o700});mkdirSync(join(root,'sources'),{mode:0o700});
const lock=JSON.parse(readFileSync(join(source,'toolchains/owl2-dl/dependencies.json')));
const archives=['engine','parser'].map(kind=>({kind,...JSON.parse(readFileSync(join(source,'toolchains/owl2-dl/'+kind+'-compat.json'))).sourceArchive}));
const inputs=[...lock.files.map(f=>({...f,path:'dependencies/'+f.file})),...archives.map(f=>({...f,path:'sources/'+f.kind+'.jar'}))];
let total=0;const receipts=[];
for(const input of inputs){
  assert.match(input.sha256,/^[a-f0-9]{64}$/);const url=new URL(input.url);
  assert.equal(url.origin,'https://repo.maven.apache.org');assert(!url.username&&!url.password&&!url.search&&!url.hash);
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000)});assert.equal(response.status,200);
  const chunks=[];let length=0;
  for await(const chunk of response.body){length+=chunk.length;total+=chunk.length;assert(length<=32*1024*1024&&total<=128*1024*1024,'Dependency download budget exceeded');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks),digest=createHash('sha256').update(bytes).digest('hex');assert.equal(digest,input.sha256,'Locked dependency digest differs');
  assert(!input.path.includes('..')&&!input.path.includes('\\'));
  writeFileSync(join(root,input.path),bytes,{flag:'wx',mode:0o600});receipts.push({url:input.url,path:input.path,bytes:length,digest:'sha256:'+digest});
}
write('download-receipts.json',receipts);
const dl=run('dl-build',['scripts/build-dl-worker.mjs','--dependencies',join(root,'dependencies'),'--java-home',javaRoot,'--output',join(root,'dl'),'--engine-source',join(root,'sources/engine.jar'),'--parser-source',join(root,'sources/parser.jar')]);
const shacl=run('shacl-prepare',['scripts/prepare-shacl-worker.mjs',native.environmentRoot,join(root,'shacl')]);
const variables={EVOPILOT_TEST_NATIVE_TOOLCHAIN:join(root,'native-toolchain.json'),EVOPILOT_TEST_DL_TOOLCHAIN:dl.toolchainFile,EVOPILOT_TEST_SHACL_TOOLCHAIN:shacl.toolchainFile};
for(const value of Object.values(variables))assert(!/[\r\n]/u.test(value));
write('test-environment.json',variables);
if(process.env.GITHUB_ENV)appendFileSync(process.env.GITHUB_ENV,Object.entries(variables).map(([key,value])=>key+'='+value+'\n').join(''));
console.log(JSON.stringify({status:'PREPARED',variables,dlDigest:dl.digest,shaclDigest:shacl.digest,acceptance:'NOT_EVALUATED',releaseAuthorized:false}));
