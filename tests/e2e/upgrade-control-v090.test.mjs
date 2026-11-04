import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync,lstatSync,unlinkSync,existsSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';

const source=fileURLToPath(new URL('../..',import.meta.url));
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:60000,maxBuffer:16*1024*1024,...options},(e,out,err)=>e?reject(Error(out+'\n'+err)):resolve(out)));
const code=c=>e=>e.code===c;
let base,runtime,next,manager,plan,control,workspace,backup,tools;
before(async()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Real installed tools required');
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-upgrade-control-')));
  const pack=JSON.parse(await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',base],{cwd:source})),roots=['base-runtime','next-runtime'].map(n=>join(base,n));
  for(const root of roots){mkdirSync(root,{mode:0o700});await execute('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',root,join(base,pack[0].filename)],{cwd:base});}
  // Real offline installations, with a synthetic next template; no release or
  // runtime activation is claimed by these admission-stage tests.
  const skill=join(roots[1],'node_modules/@evopilot-next/ontology/plugins/codex/skills/evopilot-ontology-expert/SKILL.md');writeFileSync(skill,readFileSync(skill,'utf8')+'\nSynthetic candidate template.\n');
  const installed=join(roots[0],'node_modules/@evopilot-next/ontology'),load=n=>import(pathToFileURL(join(installed,'dist',n+'.js'))),r=await load('installation/runtime');
  runtime=r.inspectRuntime(roots[0]);next=r.inspectRuntime(roots[1]);manager=await load('installation/manager');plan=await load('installation/upgrade-plan');control=await load('installation/upgrade-control');workspace=await load('standalone/workspace');backup=await load('installation/backup');
  const select=k=>({toolchainFile:process.env[k],toolchainDigest:JSON.parse(readFileSync(process.env[k])).digest});tools={dl:select('EVOPILOT_TEST_DL_TOOLCHAIN'),shacl:select('EVOPILOT_TEST_SHACL_TOOLCHAIN')};
});
after(()=>{if(base)rmSync(base,{recursive:true,force:true});});
function fixture(name,configured=false){
  const i=manager.prepareInstallation({root:join(base,name+'-installation'),workspaceRoot:join(base,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot:runtime.root,runtimeDigest:runtime.digest,mode:'create'});
  const binding={requestId:'original-bind',previousBindingDigest:null,...tools};if(configured)manager.bindInstallationToolchains(i.root,binding);
  const input={requestId:'upgrade-'+name,upgradeRoot:join(base,name+'-upgrade'),runtimeRoot:next.root,runtimeDigest:next.digest,toolchains:configured?tools:null};
  const p=plan.prepareInstallationUpgrade(i.root,input);return {i,binding,input,p};
}
const admit=f=>control.admitInstallationUpgrade(f.i.root,f.input,f.p.reportDigest);
const abort=(f,report)=>control.abortInstallationUpgrade(f.i.root,f.input,f.p.reportDigest,report);
const record=(f,suffix='.json')=>join(f.i.root,workspace.UPGRADE_RECORDS,workspace.upgradeControlKey(f.input.requestId)+suffix);
const marker=(root)=>join(root,workspace.UPGRADE_BARRIER);
function inventory(root){const out=[];const visit=(p,r)=>{const s=lstatSync(p);out.push([r,s.dev,s.ino,s.mode&0o777,s.isFile()?readFileSync(p).toString('base64'):null]);if(s.isDirectory())for(const n of readdirSync(p).sort())visit(join(p,n),r+'/'+n);};visit(root,'');return out;}

test('installed admission blocks all owner writes, preserves original bindings and abort replays without reopening runtime',async()=>{
  const f=fixture('owner',true),before=inventory(f.i.workspaceRoot),plugin=inventory(join(f.i.root,'plugin'));
  const a=admit(f);assert.equal(a.status,'ADMITTED');assert.equal(admit(f).replayed,true);
  assert.deepEqual(inventory(join(f.i.root,'plugin')),plugin);assert.equal(manager.readInstallation(f.i.root).runtime.digest,runtime.digest);assert.equal(existsSync(f.input.upgradeRoot),false);
  for(const root of [f.i.root,f.i.workspaceRoot,join(f.i.root,'formal-work')])assert.throws(()=>workspace.requireMaintenanceAvailable(root),code('UPGRADE_PENDING'));
  assert.throws(()=>workspace.openWorkspace(f.i.workspaceRoot,f.i),code('UPGRADE_PENDING'));
  await assert.rejects(manager.startInstallation(f.i.root),code('UPGRADE_PENDING'));
  assert.throws(()=>manager.bindInstallationToolchains(f.i.root,{...f.binding,requestId:'another-bind'}),code('UPGRADE_PENDING'));
  assert.equal(manager.bindInstallationToolchains(f.i.root,f.binding).replayed,true);
  assert.throws(()=>backup.inspectInstallationBackup(f.i.root,join(base,'blocked-backup'),'blocked-backup'),code('UPGRADE_PENDING'));
  assert.throws(()=>control.admitInstallationUpgrade(f.i.root,{...f.input,runtimeDigest:'sha256:'+'f'.repeat(64)},f.p.reportDigest),code('REQUEST_CONFLICT'));
  const receipt=abort(f);assert.equal(receipt.status,'ABORTED');assert.throws(()=>plan.prepareInstallationUpgrade(f.i.root,f.input),code('REQUEST_CONFLICT'));assert.deepEqual(inventory(f.i.workspaceRoot),before);assert.deepEqual(inventory(join(f.i.root,'plugin')),plugin);
  const moved=next.root+'-unavailable';renameSync(next.root,moved);
  try{assert.equal(abort(f).replayed,true);assert.equal(admit(f).status,'ABORTED');}finally{renameSync(moved,next.root);}
  for(const root of [f.i.root,f.i.workspaceRoot,join(f.i.root,'formal-work')])workspace.requireMaintenanceAvailable(root);
  const b=backup.inspectInstallationBackup(f.i.root,join(base,'after-abort-backup'),'after-abort');assert.ok(b.report.entries.some(e=>e.path===workspace.UPGRADE_RECORDS+'/'+workspace.upgradeControlKey(f.input.requestId)+'.released.json'));
});
test('durable admission alone blocks installation use; absent and exact partial barriers resume without discarding owner bytes',()=>{
  const f=fixture('interrupted');admit(f);
  // Explicit synthetic interruption states, not a SIGKILL/ENOSPC claim.
  for(const root of [f.i.root,f.i.workspaceRoot])unlinkSync(marker(root));
  assert.throws(()=>workspace.requireMaintenanceAvailable(f.i.root),code('UPGRADE_PENDING'));
  assert.equal(admit(f).replayed,true);
  const raw=readFileSync(marker(f.i.workspaceRoot));unlinkSync(marker(f.i.workspaceRoot));writeFileSync(marker(f.i.workspaceRoot)+'.pending',raw.subarray(0,71),{mode:0o600});
  assert.throws(()=>workspace.openWorkspace(f.i.workspaceRoot,f.i),code('UPGRADE_PENDING'));assert.equal(admit(f).replayed,true);assert.deepEqual(readFileSync(marker(f.i.workspaceRoot)),raw);abort(f);
});
test('changed source after the admission window refuses resume while explicit pre-switch abort preserves the change',()=>{
  const f=fixture('changed');admit(f);unlinkSync(marker(f.i.workspaceRoot));unlinkSync(marker(f.i.root));
  const path=join(f.i.root,'plugin/custom-note.txt');writeFileSync(path,'preserve this later local change',{mode:0o600});
  assert.throws(()=>admit(f),code('UPGRADE_CHANGED'));assert.equal(abort(f).status,'ABORTED');assert.equal(readFileSync(path,'utf8'),'preserve this later local change');workspace.requireMaintenanceAvailable(f.i.root);
});
test('retained exact report can abort a partial admission even after source bytes changed',()=>{
  const f=fixture('prefix');admit(f);const raw=readFileSync(record(f));
  for(const root of [f.i.root,f.i.workspaceRoot])unlinkSync(marker(root));unlinkSync(record(f));unlinkSync(record(f,'.reserve'));writeFileSync(record(f)+'.pending',raw.subarray(0,1000),{mode:0o600});
  const custom=join(f.i.root,'plugin/late.txt');writeFileSync(custom,'retain',{mode:0o600});
  assert.throws(()=>admit(f),code('UPGRADE_CHANGED'));assert.throws(()=>abort(f),code('UPGRADE_ADMISSION_MISSING'));assert.equal(abort(f,f.p.report).status,'ABORTED');assert.equal(readFileSync(custom,'utf8'),'retain');assert.deepEqual(readFileSync(record(f)),raw);
});
test('foreign barrier bytes and unrecognized staging material are preserved and cannot be cleared by abort',()=>{
  const f=fixture('foreign');admit(f);const original=readFileSync(marker(f.i.workspaceRoot));unlinkSync(marker(f.i.workspaceRoot));writeFileSync(marker(f.i.workspaceRoot)+'.pending','foreign',{mode:0o600});
  assert.throws(()=>admit(f),code('UPGRADE_EVIDENCE'));assert.throws(()=>abort(f),code('UPGRADE_EVIDENCE'));assert.equal(readFileSync(marker(f.i.workspaceRoot)+'.pending','utf8'),'foreign');
  unlinkSync(marker(f.i.workspaceRoot)+'.pending');writeFileSync(marker(f.i.workspaceRoot),original,{mode:0o600});
  mkdirSync(f.input.upgradeRoot,{mode:0o700});writeFileSync(join(f.input.upgradeRoot,'foreign'),'keep',{mode:0o600});assert.throws(()=>abort(f),code('UPGRADE_PHASE_UNKNOWN'));assert.equal(readFileSync(join(f.input.upgradeRoot,'foreign'),'utf8'),'keep');
});
test('partial abort is irreversible and replay clears only the originally owned barriers',()=>{
  const f=fixture('abort-resume');admit(f);abort(f);const raw=readFileSync(record(f,'.aborted.json'));unlinkSync(record(f,'.released.json'));unlinkSync(record(f,'.aborted.json'));writeFileSync(record(f,'.aborted.json.pending'),raw.subarray(0,80),{mode:0o600});
  assert.throws(()=>admit(f),code('UPGRADE_ABORT_PENDING'));assert.equal(abort(f).status,'ABORTED');assert.equal(abort(f).replayed,true);workspace.requireMaintenanceAvailable(f.i.root);
});
test('physical owner replacement and control corruption refuse mutation',()=>{
  const f=fixture('identity');admit(f);const original=record(f),before=readFileSync(original),dir=join(f.i.root,workspace.UPGRADE_RECORDS),old=dir+'-old';renameSync(dir,old);mkdirSync(dir,{mode:0o700});
  for(const name of readdirSync(old))writeFileSync(join(dir,name),readFileSync(join(old,name)),{mode:0o600});
  assert.throws(()=>admit(f),code('UPGRADE_CHANGED'));assert.throws(()=>abort(f),code('UPGRADE_CHANGED'));assert.deepEqual(readFileSync(original),before);
});
test('request IDs with reserved-looking suffixes remain distinct in history and old records stay snapshot-bound',()=>{
  const f=fixture('names');f.input.requestId='name.aborted';f.p=plan.prepareInstallationUpgrade(f.i.root,f.input);admit(f);abort(f);
  const second={...f.input,requestId:'name',upgradeRoot:join(base,'names-second-stage')},p=plan.prepareInstallationUpgrade(f.i.root,second);assert.ok(p.report.ownerSnapshot.entries.some(e=>e.path.endsWith(workspace.upgradeControlKey(f.input.requestId)+'.released.json')));
  control.admitInstallationUpgrade(f.i.root,second,p.reportDigest);control.abortInstallationUpgrade(f.i.root,second,p.reportDigest);workspace.requireMaintenanceAvailable(f.i.root);
  const released=JSON.parse(readFileSync(record(f,'.released.json')));released.abortDigest='sha256:'+'f'.repeat(64);writeFileSync(record(f,'.released.json'),JSON.stringify(released)+'\n');assert.throws(()=>workspace.requireMaintenanceAvailable(f.i.root),code('UPGRADE_EVIDENCE'));
});

test('a mismatching partial admission remains blocked and byte-for-byte preserved',()=>{
  const f=fixture('bad-prefix');admit(f);for(const root of [f.i.root,f.i.workspaceRoot])unlinkSync(marker(root));unlinkSync(record(f));unlinkSync(record(f,'.reserve'));writeFileSync(record(f)+'.pending','{"foreign":true}',{mode:0o600});
  assert.throws(()=>admit(f),code('BACKUP_EVIDENCE'));assert.throws(()=>abort(f,f.p.report),code('BACKUP_EVIDENCE'));assert.equal(readFileSync(record(f)+'.pending','utf8'),'{"foreign":true}');assert.throws(()=>workspace.requireMaintenanceAvailable(f.i.root),code('UPGRADE_PENDING'));
});
