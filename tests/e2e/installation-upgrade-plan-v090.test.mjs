import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync,lstatSync,cpSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {hashBytes} from '../../dist/standalone/validation.js';
import {PLUGIN_PATHS as P} from '../../dist/installation/plugin-content.js';

const source=fileURLToPath(new URL('../..',import.meta.url));
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:60000,maxBuffer:16*1024*1024,...options},(e,out,err)=>e?reject(Error(out+'\n'+err)):resolve(out)));
const code=c=>e=>e.code===c;
let base,runtime,next,manager,upgrade,tools,cli;
before(async()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Real installed tools required');
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-upgrade-plan-')));
  const pack=JSON.parse(await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',base],{cwd:source})),roots=['base-runtime','next-runtime'].map(n=>join(base,n));
  for(const root of roots){mkdirSync(root,{mode:0o700});await execute('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',root,join(base,pack[0].filename)],{cwd:base});}
  // Actual package installations with an explicitly synthetic next template.
  // This is not a released version or a transactionally activated upgrade.
  const skill=join(roots[1],'node_modules/@evopilot-next/ontology/plugins/codex',P.skill);
  writeFileSync(skill,readFileSync(skill,'utf8').replace('description: Use the selected','description: Synthetic next template; use the selected'));
  const installed=join(roots[0],'node_modules/@evopilot-next/ontology'),load=n=>import(pathToFileURL(join(installed,'dist',n+'.js'))),r=await load('installation/runtime');
  runtime=r.inspectRuntime(roots[0]);next=r.inspectRuntime(roots[1]);manager=await load('installation/manager');upgrade=await load('installation/upgrade-plan');
  const select=k=>({toolchainFile:process.env[k],toolchainDigest:JSON.parse(readFileSync(process.env[k])).digest});tools={dl:select('EVOPILOT_TEST_DL_TOOLCHAIN'),shacl:select('EVOPILOT_TEST_SHACL_TOOLCHAIN')};cli=join(installed,'dist/standalone/cli.js');
});
after(()=>{if(base)rmSync(base,{recursive:true,force:true});});
function fixture(name,configured=true){
  const i=manager.prepareInstallation({root:join(base,name+'-installation'),workspaceRoot:join(base,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot:runtime.root,runtimeDigest:runtime.digest,mode:'create'});
  const binding={requestId:'original-bind',previousBindingDigest:null,...tools};if(configured)manager.bindInstallationToolchains(i.root,binding);
  return {i,binding,input:{requestId:'upgrade-'+name,upgradeRoot:join(base,name+'-upgrade'),runtimeRoot:next.root,runtimeDigest:next.digest,toolchains:tools}};
}
function inventory(root){
  const result=[];const visit=(p,r)=>{const s=lstatSync(p);result.push([r,s.dev,s.ino,s.mode&0o777,s.isFile()?hashBytes(readFileSync(p)):null]);if(s.isDirectory())for(const n of readdirSync(p).sort())visit(join(p,n),r+'/'+n);};visit(root,'');return result;
}
const prepare=(f,expected)=>upgrade.prepareInstallationUpgrade(f.i.root,f.input,expected);

test('installed upgrade inspection binds one stable owner/plugin/tool plan without changing current installation',async()=>{
  const f=fixture('stable'),custom=join(f.i.root,'plugin/private.bin');writeFileSync(custom,Buffer.from('private-synthetic-sentinel'),{mode:0o600});
  const before=[inventory(f.i.root),inventory(f.i.workspaceRoot)],first=prepare(f),again=prepare(f,first.reportDigest);
  assert.equal(first.reportDigest,again.reportDigest);assert.equal(first.report.status,'READY');assert.equal(first.report.runtimeActivated,false);assert.equal(first.report.toolchainsVerified,true);
  assert.equal(first.report.ownerSnapshot.installation.runtime.digest,runtime.digest);assert.equal(first.report.toolchainDraft.runtimeDigest,next.digest);assert.equal(first.report.toolchainDraft.requestId,f.input.requestId);assert.equal(Object.hasOwn(first.report.toolchainDraft,'recordedAt'),false);
  assert.deepEqual(first.files.get('private.bin'),readFileSync(custom));assert.deepEqual([inventory(f.i.root),inventory(f.i.workspaceRoot)],before);assert.equal(existsSync(f.input.upgradeRoot),false);
  const request=join(base,'upgrade-input.json');writeFileSync(request,JSON.stringify(f.input),{mode:0o600});const out=await execute(process.execPath,[cli,'upgrade-inspect','--installation',f.i.root,'--input',request,'--json']);
  assert.equal(JSON.parse(out).result.reportDigest,first.reportDigest);assert.ok(!out.includes('private-synthetic-sentinel'));assert.equal(manager.readInstallation(f.i.root).runtime.digest,runtime.digest);
  assert.equal(manager.bindInstallationToolchains(f.i.root,f.binding).replayed,true);
});
test('unconfigured preparation creates no formal-work, while configured tools cannot be removed or silently changed',()=>{
  const f=fixture('unconfigured',false),p=prepare(f);assert.equal(p.report.toolchainsVerified,true);assert.equal(p.report.toolchainDraft.previousDigest,null);assert.equal(existsSync(join(f.i.root,'formal-work')),false);assert.equal(existsSync(join(f.i.root,'toolchain-bindings.json')),false);
  const empty=upgrade.prepareInstallationUpgrade(f.i.root,{...f.input,toolchains:null});assert.equal(empty.report.toolchainDraft,null);assert.equal(empty.report.toolchainsVerified,false);
  const g=fixture('configured'),before=[inventory(g.i.root),inventory(g.i.workspaceRoot)];assert.throws(()=>upgrade.prepareInstallationUpgrade(g.i.root,{...g.input,toolchains:null}),code('TOOLCHAIN_BINDING_MISSING'));
  assert.throws(()=>upgrade.prepareInstallationUpgrade(g.i.root,{...g.input,resolutionsFile:''}),code('UNSAFE_PATH'));
  assert.throws(()=>upgrade.prepareInstallationUpgrade(g.i.root,{...g.input,toolchains:{...tools,dl:{...tools.dl,toolchainDigest:hashBytes('wrong')}}}),code('TOOLCHAIN_BINDING_DRIFT'));
  assert.throws(()=>upgrade.prepareInstallationUpgrade(g.i.root,{...g.input,requestId:'original-bind'}),code('REQUEST_CONFLICT'));
  assert.deepEqual([inventory(g.i.root),inventory(g.i.workspaceRoot)],before);
});
test('live owner and changed owner history refuse the previously inspected plan',async()=>{
  const f=fixture('stale'),p=prepare(f);await manager.startInstallation(f.i.root);
  try{assert.throws(()=>prepare(f),code('INSTALLATION_RUNNING'));}finally{await manager.stopInstallation(f.i.root);}
  assert.throws(()=>prepare(f,p.reportDigest),code('UPGRADE_CHANGED'));
  const nextPlan=prepare(f);writeFileSync(join(f.i.root,'plugin/new-note.txt'),'Retain local customization',{mode:0o600});assert.throws(()=>prepare(f,nextPlan.reportDigest),code('UPGRADE_CHANGED'));assert.equal(existsSync(f.input.upgradeRoot),false);
});
test('conflicting plugin changes remain reviewable but cannot become an admissible upgrade',()=>{
  const f=fixture('conflict'),skill=join(f.i.root,'plugin',P.skill);writeFileSync(skill,readFileSync(skill,'utf8').replace('description: Use the selected','description: Conflicting private description; use the selected'));
  const before=inventory(f.i.root),p=prepare(f);assert.equal(p.report.status,'PLUGIN_CONFLICT');assert.throws(()=>prepare(f,p.reportDigest),code('PLUGIN_CONFLICT'));assert.deepEqual(inventory(f.i.root),before);
});
test('occupied or non-sibling staging and mismatched candidate worker sources cannot alter owners',async()=>{
  const f=fixture('location'),before=[inventory(f.i.root),inventory(f.i.workspaceRoot)];
  for(const upgradeRoot of [f.i.root,join(f.i.root,'stage'),join(next.root,'stage')])assert.throws(()=>upgrade.prepareInstallationUpgrade(f.i.root,{...f.input,upgradeRoot}),e=>['UPGRADE_LOCATION','UNSAFE_PATH'].includes(e.code));
  mkdirSync(f.input.upgradeRoot,{mode:0o700});writeFileSync(join(f.input.upgradeRoot,'foreign'),'preserve',{mode:0o600});assert.throws(()=>prepare(f),code('UPGRADE_EXISTS'));assert.equal(readFileSync(join(f.input.upgradeRoot,'foreign'),'utf8'),'preserve');
  const badRoot=join(base,'bad-runtime');cpSync(next.root,badRoot,{recursive:true,verbatimSymlinks:true});const worker=join(badRoot,'node_modules/@evopilot-next/ontology/toolchains/owl2-dl/Worker.java');writeFileSync(worker,readFileSync(worker,'utf8')+'\n// Synthetic incompatible source revision\n');
  const r=await import(pathToFileURL(join(runtime.packageRoot,'dist/installation/runtime.js'))),bad=r.inspectRuntime(badRoot);
  assert.throws(()=>upgrade.prepareInstallationUpgrade(f.i.root,{...f.input,upgradeRoot:join(base,'bad-candidate-stage'),runtimeRoot:bad.root,runtimeDigest:bad.digest}),code('PACKAGE_TOOLCHAIN_MISMATCH'));
  const aliasRoot=join(base,'same-package-alias');cpSync(runtime.root,aliasRoot,{recursive:true,verbatimSymlinks:true});const alias=r.inspectRuntime(aliasRoot);assert.equal(alias.digest,runtime.digest);
  assert.throws(()=>upgrade.prepareInstallationUpgrade(f.i.root,{...f.input,upgradeRoot:join(base,'alias-stage'),runtimeRoot:alias.root,runtimeDigest:alias.digest}),code('RUNTIME_HISTORY'));
  assert.deepEqual([inventory(f.i.root),inventory(f.i.workspaceRoot)],before);
});
