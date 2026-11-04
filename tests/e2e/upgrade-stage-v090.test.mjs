import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync,lstatSync,unlinkSync,existsSync,renameSync,chmodSync,cpSync,watch} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile,spawn} from 'node:child_process';

const source=fileURLToPath(new URL('../..',import.meta.url));
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:60000,maxBuffer:16*1024*1024,...options},(e,out,err)=>e?reject(Error(out+'\n'+err)):resolve(out)));
const code=c=>e=>e.code===c;
let base,runtime,next,manager,plan,control,stage,files,workspace,validation,toolchains,tools,stageURL;
before(async()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Real installed tools required');
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-upgrade-stage-')));
  const pack=JSON.parse(await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',base],{cwd:source})),roots=['base-runtime','next-runtime'].map(n=>join(base,n));
  for(const root of roots){mkdirSync(root,{mode:0o700});await execute('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',root,join(base,pack[0].filename)],{cwd:base});}
  // Actual offline installs with a clearly synthetic upstream template change.
  const skill=join(roots[1],'node_modules/@evopilot-next/ontology/plugins/codex/skills/evopilot-ontology-expert/SKILL.md');writeFileSync(skill,readFileSync(skill,'utf8')+'\nSynthetic candidate template.\n');
  const installed=join(roots[0],'node_modules/@evopilot-next/ontology'),load=n=>import(pathToFileURL(join(installed,'dist',n+'.js'))),r=await load('installation/runtime');
  runtime=r.inspectRuntime(roots[0]);next=r.inspectRuntime(roots[1]);manager=await load('installation/manager');plan=await load('installation/upgrade-plan');control=await load('installation/upgrade-control');stageURL=pathToFileURL(join(installed,'dist/installation/upgrade-stage.js')).href;stage=await load('installation/upgrade-stage');files=await load('installation/upgrade-stage-files');workspace=await load('standalone/workspace');validation=await load('standalone/validation');toolchains=await load('installation/toolchains');
  const select=k=>({toolchainFile:process.env[k],toolchainDigest:JSON.parse(readFileSync(process.env[k])).digest});tools={dl:select('EVOPILOT_TEST_DL_TOOLCHAIN'),shacl:select('EVOPILOT_TEST_SHACL_TOOLCHAIN')};
});
function mirrorModes(from,to){const s=lstatSync(from);chmodSync(to,s.mode&0o777);if(s.isDirectory())for(const n of readdirSync(from))mirrorModes(join(from,n),join(to,n));}
function writable(p){const s=lstatSync(p);if(s.isDirectory()){chmodSync(p,0o700);for(const n of readdirSync(p))writable(join(p,n));}}
after(()=>{if(base){writable(base);rmSync(base,{recursive:true,force:true});}});
function fixture(name,configured=false,selectTools=configured){
  const i=manager.prepareInstallation({root:join(base,name+'-installation'),workspaceRoot:join(base,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot:runtime.root,runtimeDigest:runtime.digest,mode:'create'});
  if(configured)manager.bindInstallationToolchains(i.root,{requestId:'original-bind',previousBindingDigest:null,...tools});
  const input={requestId:'stage-'+name,upgradeRoot:join(base,name+'-upgrade'),runtimeRoot:next.root,runtimeDigest:next.digest,toolchains:selectTools?tools:null};
  return {i,input,p:null};
}
function inspect(f){f.p=plan.prepareInstallationUpgrade(f.i.root,f.input);return f;}
const stageIt=f=>stage.stageInstallationUpgrade(f.i.root,f.input,f.p.reportDigest);
const abort=f=>control.abortInstallationUpgrade(f.i.root,f.input,f.p.reportDigest);
const requestFile=(f,suffix='.json')=>join(f.i.root,workspace.UPGRADE_RECORDS,workspace.upgradeControlKey(f.input.requestId)+suffix);
const candidate=f=>join(f.input.upgradeRoot,'next');
const readJSON=p=>JSON.parse(readFileSync(p));
function snapshot(root){const out=[];const visit=(p,r)=>{const s=lstatSync(p);out.push([r,s.dev,s.ino,s.mode&0o777,s.isFile()?validation.hashBytes(readFileSync(p)):null]);if(s.isDirectory())for(const n of readdirSync(p).sort())visit(join(p,n),r+'/'+n);};visit(root,'');return out;}
function addCustom(f){
  const root=join(f.i.root,'plugin');mkdirSync(join(root,'private'),{mode:0o700});mkdirSync(join(root,'private/empty'),{mode:0o500});
  const bytes=Buffer.from([0,1,255,128,0,92,110]);writeFileSync(join(root,'private/data.pending'),bytes,{mode:0o400});writeFileSync(join(root,'local.sh'),'#!/bin/sh\nexit 0\n',{mode:0o500});chmodSync(join(root,'private'),0o500);return bytes;
}

test('complete installed stage preserves current owner and seals private binaries, empty directories, modes and immutable histories',()=>{
  const f=fixture('complete',true),bytes=addCustom(f);inspect(f);
  const originalPlugin=snapshot(join(f.i.root,'plugin')),originalWorkspace=snapshot(f.i.workspaceRoot),oldMetadata=readFileSync(join(f.i.root,'installation.json')),oldLedger=readFileSync(join(f.i.root,'toolchain-bindings.json'));
  const first=stageIt(f);assert.equal(first.status,'STAGED');assert.equal(first.runtimeActivated,false);const staged=candidate(f),i=readJSON(join(staged,'installation.json')),ledger=toolchains.readToolchainLedger(i,staged);
  assert.equal(i.schema,'ontology-installation/v2');assert.equal(i.runtime.digest,next.digest);assert.equal(i.runtimeHistory.initial.digest,runtime.digest);assert.equal(ledger.records.length,2);assert.deepEqual(ledger.records[0],JSON.parse(oldLedger).records[0]);assert.equal(ledger.records[1].binding.recordedAt,first.recordedAt);assert.equal(i.runtimeHistory.records[0].transition.recordedAt,first.recordedAt);assert.equal(i.runtimeHistory.records[0].transition.toolchainBindingDigest,first.toolchainBindingDigest);
  assert.deepEqual(readFileSync(join(staged,'plugin/private/data.pending')),bytes);assert.equal(lstatSync(join(staged,'plugin/private/data.pending')).mode&0o777,0o400);assert.equal(lstatSync(join(staged,'plugin/local.sh')).mode&0o777,0o500);assert.equal(lstatSync(join(staged,'plugin/private/empty')).mode&0o777,0o500);assert.equal(readdirSync(join(staged,'plugin/private/empty')).length,0);
  const mcp=readJSON(join(staged,'plugin/.mcp.json'));assert.equal(mcp.mcpServers['evopilot-ontology'].args[0],join(next.packageRoot,'dist/standalone/bridge.js'));
  const sealed=snapshot(f.input.upgradeRoot),again=stageIt(f);assert.equal(again.replayed,true);assert.equal(again.preparedDigest,first.preparedDigest);assert.equal(again.recordedAt,first.recordedAt);assert.deepEqual(snapshot(f.input.upgradeRoot),sealed);
  assert.deepEqual(readFileSync(join(f.i.root,'installation.json')),oldMetadata);assert.deepEqual(readFileSync(join(f.i.root,'toolchain-bindings.json')),oldLedger);assert.deepEqual(snapshot(join(f.i.root,'plugin')),originalPlugin);assert.equal(existsSync(join(staged,'formal-work')),false);
  abort(f);assert.deepEqual(snapshot(f.i.workspaceRoot),originalWorkspace);assert.deepEqual(snapshot(f.input.upgradeRoot),sealed);workspace.requireMaintenanceAvailable(f.i.root);assert.throws(()=>stageIt(f),code('UPGRADE_ABORTED'));
});
test('unconfigured and first-tool stages distinguish absent or empty original worker roots without mutating either',()=>{
  const empty=inspect(fixture('unconfigured'));stageIt(empty);const unconfigured=readJSON(join(candidate(empty),'installation.json'));assert.equal(unconfigured.runtimeHistory.records[0].transition.toolchainBindingDigest,null);assert.equal(existsSync(join(candidate(empty),'toolchain-bindings.json')),false);abort(empty);
  for(const name of ['new-tools','empty-work']){
    const f=fixture(name,false,true);if(name==='empty-work')mkdirSync(join(f.i.root,'formal-work'),{mode:0o500});inspect(f);const original=existsSync(join(f.i.root,'formal-work'))?snapshot(join(f.i.root,'formal-work')):null;
    const first=stageIt(f),nextRoot=candidate(f),nextInstallation=readJSON(join(nextRoot,'installation.json'));assert.equal(toolchains.readToolchainLedger(nextInstallation,nextRoot).records.length,1);assert.equal(lstatSync(join(nextRoot,'formal-work')).mode&0o777,0o700);assert.equal(readJSON(join(nextRoot,'formal-work/owner.json')).root,join(f.i.root,'formal-work'));assert.equal(readJSON(join(nextRoot,'formal-work',workspace.UPGRADE_BARRIER)).requestDigest,first.requestDigest);
    assert.equal(stageIt(f).preparedDigest,first.preparedDigest);if(original)assert.deepEqual(snapshot(join(f.i.root,'formal-work')),original);else assert.equal(existsSync(join(f.i.root,'formal-work')),false);abort(f);
  }
  const earlier=fixture('earlier-empty',false,true),work=join(earlier.i.root,'formal-work');mkdirSync(work,{mode:0o700});inspect(earlier);control.admitInstallationUpgrade(earlier.i.root,earlier.input,earlier.p.reportDigest);
  // Reconstruct the previous internal candidate's empty-work barrier. Its
  // explicit abort must clear its own marker without inventing a tool owner.
  const marker=readJSON(join(earlier.i.workspaceRoot,workspace.UPGRADE_BARRIER));writeFileSync(join(work,workspace.UPGRADE_BARRIER),JSON.stringify({...marker,root:work})+'\n',{mode:0o600});abort(earlier);assert.deepEqual(readdirSync(work),[]);
});
test('synthetic interrupted binary and prepared-record writes resume exact prefixes while retaining the committed timestamp',()=>{
  const f=fixture('prefix');addCustom(f);inspect(f);const first=stageIt(f),root=f.input.upgradeRoot,prepared=join(root,'prepared.json'),target=join(candidate(f),'plugin/local.sh'),raw=readFileSync(target),pending=join(root,'pending',validation.hashBytes('plugin/local.sh').slice(7));
  // These are reconstructed protocol states, not actual SIGKILL/ENOSPC evidence.
  unlinkSync(prepared);unlinkSync(target);writeFileSync(pending,raw.subarray(0,6),{mode:0o600});const resumed=stageIt(f);assert.equal(resumed.recordedAt,first.recordedAt);assert.deepEqual(readFileSync(target),raw);assert.equal(lstatSync(target).mode&0o777,0o500);assert.equal(existsSync(pending),false);
  const seal=readFileSync(prepared),image=snapshot(candidate(f));unlinkSync(prepared);writeFileSync(prepared+'.pending',seal.subarray(0,1000),{mode:0o600});assert.equal(stageIt(f).preparedDigest,resumed.preparedDigest);assert.deepEqual(readFileSync(prepared),seal);assert.deepEqual(snapshot(candidate(f)),image);abort(f);
});
test('a sealed image cannot be silently rebuilt after byte drift or equal-byte inode replacement',()=>{
  const changed=inspect(fixture('changed'));stageIt(changed);const file=join(candidate(changed),'plugin/local-note.txt');writeFileSync(file,'retain changed candidate',{mode:0o600});const prior=readFileSync(join(changed.input.upgradeRoot,'prepared.json'));
  assert.throws(()=>stageIt(changed),code('UPGRADE_STAGE_EVIDENCE'));assert.deepEqual(readFileSync(join(changed.input.upgradeRoot,'prepared.json')),prior);abort(changed);assert.equal(readFileSync(file,'utf8'),'retain changed candidate');
  const swapped=inspect(fixture('swapped'));stageIt(swapped);const root=join(candidate(swapped),'plugin'),moved=join(base,'preserved-plugin');renameSync(root,moved);cpSync(moved,root,{recursive:true});mirrorModes(moved,root);assert.deepEqual(snapshot(root).map(e=>[e[0],e[3],e[4]]),snapshot(moved).map(e=>[e[0],e[3],e[4]]));assert.throws(()=>stageIt(swapped),code('UPGRADE_STAGE_EVIDENCE'));abort(swapped);
});
test('empty admitted stage roots and exact partial ownership records recover; unrelated staging content remains untouched',()=>{
  const f=inspect(fixture('owner-prefix'));control.admitInstallationUpgrade(f.i.root,f.input,f.p.reportDigest);mkdirSync(f.input.upgradeRoot,{mode:0o700});const a=readJSON(requestFile(f));files.ensureUpgradeStage(a);const owner=readFileSync(requestFile(f,'.stage.json'));unlinkSync(requestFile(f,'.stage.json'));writeFileSync(requestFile(f,'.stage.json.pending'),owner.subarray(0,100),{mode:0o600});stageIt(f);assert.deepEqual(readFileSync(requestFile(f,'.stage.json')),owner);abort(f);
  const foreign=inspect(fixture('foreign-root'));control.admitInstallationUpgrade(foreign.i.root,foreign.input,foreign.p.reportDigest);mkdirSync(foreign.input.upgradeRoot,{mode:0o700});writeFileSync(join(foreign.input.upgradeRoot,'foreign'),'preserve',{mode:0o600});assert.throws(()=>stageIt(foreign),code('UPGRADE_PHASE_UNKNOWN'));assert.throws(()=>abort(foreign),code('UPGRADE_PHASE_UNKNOWN'));assert.equal(readFileSync(join(foreign.input.upgradeRoot,'foreign'),'utf8'),'preserve');
});
test('source changes after staging refuse continuation and pre-switch abort retains both source changes and candidate data',()=>{
  const f=inspect(fixture('source'));stageIt(f);const candidateBefore=snapshot(f.input.upgradeRoot),note=join(f.i.root,'plugin/late.txt');writeFileSync(note,'preserve later source change',{mode:0o600});assert.throws(()=>stageIt(f),code('UPGRADE_CHANGED'));abort(f);assert.equal(readFileSync(note,'utf8'),'preserve later source change');assert.deepEqual(snapshot(f.input.upgradeRoot),candidateBefore);
  const stageRoot=f.input.upgradeRoot,moved=stageRoot+'-retained';renameSync(stageRoot,moved);assert.equal(abort(f).replayed,true);workspace.requireMaintenanceAvailable(f.i.root);
});
test('orphan timestamp attempts remain inert while unknown switch material blocks both staging and abort',()=>{
  const f=inspect(fixture('timestamp'));control.admitInstallationUpgrade(f.i.root,f.input,f.p.reportDigest);files.ensureUpgradeStage(readJSON(requestFile(f)));const orphan=join(f.input.upgradeRoot,'recorded-at.json.pending-11111111-1111-1111-1111-111111111111');writeFileSync(orphan,'{"interrupted":',{mode:0o600});stageIt(f);assert.equal(readFileSync(orphan,'utf8'),'{"interrupted":');
  const switched=join(f.input.upgradeRoot,'switch.json');writeFileSync(switched,'unproven phase',{mode:0o600});assert.throws(()=>stageIt(f),code('UPGRADE_PHASE_UNKNOWN'));assert.throws(()=>abort(f),code('UPGRADE_PHASE_UNKNOWN'));assert.equal(readFileSync(switched,'utf8'),'unproven phase');
});

test('an actual installed staging child killed after owner-anchor creation resumes the same admitted request',async()=>{
  const f=inspect(fixture('actual-kill',true));control.admitInstallationUpgrade(f.i.root,f.input,f.p.reportDigest);const original=readFileSync(join(f.i.root,'installation.json')),originalLedger=readFileSync(join(f.i.root,'toolchain-bindings.json'));
  const request=join(base,'actual-kill-request.json');writeFileSync(request,JSON.stringify({root:f.i.root,input:f.input,digest:f.p.reportDigest}),{mode:0o600});
  let child,signalSent=false,output='';
  const watcher=watch(join(f.i.root,workspace.UPGRADE_RECORDS),{persistent:false},()=>{if(child&&!signalSent&&existsSync(requestFile(f,'.stage.json'))){signalSent=child.kill('SIGKILL');}});
  let timer;
  try{
    const exited=new Promise((resolve,reject)=>{
      child=spawn(process.execPath,['--input-type=module','-e',"import {readFileSync} from 'node:fs'; const p=JSON.parse(readFileSync(process.argv[2]));const s=await import(process.argv[1]);s.stageInstallationUpgrade(p.root,p.input,p.digest);",stageURL,request],{stdio:['ignore','pipe','pipe']});
      child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));
      timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Owned staging child did not reach its durable stage anchor within the test budget: '+output));},60000);
    });
    const result=await exited;assert.equal(signalSent,true,output);assert.equal(result.signal,'SIGKILL',output);assert.ok(existsSync(requestFile(f,'.stage.json')));assert.equal(existsSync(join(f.input.upgradeRoot,'prepared.json')),false,'Kill must precede prepared image completion');
  }finally{clearTimeout(timer);watcher.close();}
  assert.deepEqual(readFileSync(join(f.i.root,'installation.json')),original);assert.deepEqual(readFileSync(join(f.i.root,'toolchain-bindings.json')),originalLedger);
  const timestampFile=join(f.input.upgradeRoot,'recorded-at.json'),retainedTime=existsSync(timestampFile)?readJSON(timestampFile).recordedAt:null;
  const resumed=stageIt(f);assert.equal(resumed.status,'STAGED');if(retainedTime)assert.equal(resumed.recordedAt,retainedTime);assert.equal(stageIt(f).preparedDigest,resumed.preparedDigest);abort(f);workspace.requireMaintenanceAvailable(f.i.root);
});
