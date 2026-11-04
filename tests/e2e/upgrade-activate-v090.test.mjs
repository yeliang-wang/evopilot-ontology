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
const upgradeFailure=e=>typeof e.code==='string'&&e.code.startsWith('UPGRADE_');
let base,runtime,next,manager,plan,control,stage,activation,workspace,validation,toolchains,history,backup,restore,tools,activationURL;
const startedRoots=new Set();
before(async()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Real installed tools required');
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-upgrade-activate-')));
  const pack=JSON.parse(await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',base],{cwd:source})),roots=['base-runtime','next-runtime'].map(n=>join(base,n));
  for(const root of roots){mkdirSync(root,{mode:0o700});await execute('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',root,join(base,pack[0].filename)],{cwd:base});}
  // Actual offline installed packages; the different upstream template is
  // explicitly synthetic. These development cases do not represent a release.
  const skill=join(roots[1],'node_modules/@evopilot-next/ontology/plugins/codex/skills/evopilot-ontology-expert/SKILL.md');writeFileSync(skill,readFileSync(skill,'utf8')+'\nSynthetic activation candidate template.\n');
  const installed=join(roots[0],'node_modules/@evopilot-next/ontology'),load=n=>import(pathToFileURL(join(installed,'dist',n+'.js'))),r=await load('installation/runtime');
  runtime=r.inspectRuntime(roots[0]);next=r.inspectRuntime(roots[1]);manager=await load('installation/manager');plan=await load('installation/upgrade-plan');control=await load('installation/upgrade-control');stage=await load('installation/upgrade-stage');activationURL=pathToFileURL(join(installed,'dist/installation/upgrade-activate.js')).href;activation=await load('installation/upgrade-activate');workspace=await load('standalone/workspace');validation=await load('standalone/validation');toolchains=await load('installation/toolchains');history=await load('installation/runtime-history');backup=await load('installation/backup');restore=await load('installation/restore-stage');
  const select=k=>({toolchainFile:process.env[k],toolchainDigest:JSON.parse(readFileSync(process.env[k])).digest});tools={dl:select('EVOPILOT_TEST_DL_TOOLCHAIN'),shacl:select('EVOPILOT_TEST_SHACL_TOOLCHAIN')};
});
function writable(path){const s=lstatSync(path);if(s.isDirectory()){chmodSync(path,0o700);for(const n of readdirSync(path))writable(join(path,n));}}
function mirrorModes(from,to){const s=lstatSync(from);chmodSync(to,s.mode&0o777);if(s.isDirectory())for(const n of readdirSync(from))mirrorModes(join(from,n),join(to,n));}
after(async()=>{
  const failed=[];for(const root of startedRoots)try{await manager.stopInstallation(root);}catch(e){failed.push(e);}
  if(failed.length)throw new AggregateError(failed,'Owned service exit is unproven; isolated fixtures were preserved');
  if(base){writable(base);rmSync(base,{recursive:true,force:true});}
});
function fixture(name,configured=true,selectTools=configured){
  const i=manager.prepareInstallation({root:join(base,name+'-installation'),workspaceRoot:join(base,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot:runtime.root,runtimeDigest:runtime.digest,mode:'create'}),binding={requestId:'original-bind',previousBindingDigest:null,...tools};
  if(configured)manager.bindInstallationToolchains(i.root,binding);
  return {i,binding,input:{requestId:'activate-'+name,upgradeRoot:join(base,name+'-upgrade'),runtimeRoot:next.root,runtimeDigest:next.digest,toolchains:selectTools?tools:null},p:null,s:null,reserve:null};
}
function prepare(f){f.p=plan.prepareInstallationUpgrade(f.i.root,f.input);f.s=stage.stageInstallationUpgrade(f.i.root,f.input,f.p.reportDigest);f.reserve=readFileSync(requestFile(f,'.reserve'));return f;}
const activate=f=>activation.activateInstallationUpgrade(f.i.root,f.input,f.p.reportDigest,f.s.preparedDigest);
const abort=f=>control.abortInstallationUpgrade(f.i.root,f.input,f.p.reportDigest);
const requestFile=(f,suffix='.json')=>join(f.i.root,workspace.UPGRADE_RECORDS,workspace.upgradeControlKey(f.input.requestId)+suffix);
const readJSON=path=>JSON.parse(readFileSync(path));
const node=path=>{const s=lstatSync(path,{bigint:true});return {device:String(s.dev),inode:String(s.ino),mode:Number(s.mode&0o777n)};};
function snapshot(root){const out=[];const visit=(path,relative)=>{const s=lstatSync(path);out.push([relative,s.dev,s.ino,s.mode&0o777,s.isFile()?validation.hashBytes(readFileSync(path)):null]);if(s.isDirectory())for(const n of readdirSync(path).sort())visit(join(path,n),relative?relative+'/'+n:n);};visit(root,'');return out;}
function rejectsWithoutMutation(f,expected){
  const roots=[f.i.root,f.i.workspaceRoot,f.input.upgradeRoot],before=roots.map(snapshot);
  assert.throws(()=>activate(f),code(expected));
  for(let index=0;index<roots.length;index++)assert.deepEqual(snapshot(roots[index]),before[index],'Rejected activation changed '+roots[index]);
}
function marker(f,root){const a=readJSON(requestFile(f)),i=a.report.ownerSnapshot.installation;return {schema:'ontology-upgrade-barrier/v1',root,upgradeRoot:f.input.upgradeRoot,installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,requestId:f.input.requestId,requestDigest:a.requestDigest,reportDigest:a.reportDigest};}
function barriers(f,roots=[f.i.root,f.i.workspaceRoot,join(f.i.root,'formal-work')]){for(const root of roots)if(existsSync(root))writeFileSync(join(root,workspace.UPGRADE_BARRIER),JSON.stringify(marker(f,root))+'\n',{mode:0o600});}
// Test-fixture reconstruction only: macOS requires directory owner-write for
// rename across parents. Restore the canonical mode immediately after moving.
function fixtureRename(from,to){
  const original=node(from),directory=lstatSync(from).isDirectory();
  if(directory&&original.mode!==0o700)chmodSync(from,0o700);
  try{renameSync(from,to);}finally{if(directory)chmodSync(existsSync(from)?from:to,original.mode);}
}
async function startAndStop(f,expected){
  startedRoots.add(f.i.root);
  try{const result=await manager.startInstallation(f.i.root);assert.equal(result.observed,'RUNNING');assert.equal(result.run.runtimeBindingDigest,history.runtimeBindingDigest(expected));return result.run;}
  finally{await manager.stopInstallation(f.i.root);startedRoots.delete(f.i.root);}
}
/** Reconstructs a documented pre-completion physical arrangement from a real
 * completed configured upgrade. All old/new component inodes and bytes survive;
 * only terminal control state is rewound. This is synthetic interruption evidence. */
function rewindConfigured(f){
  const sw=readJSON(requestFile(f,'.switch.json'));assert.ok(!sw.components.some(c=>c.name==='formal-work'));
  for(const c of sw.components){fixtureRename(join(f.i.root,c.name),join(f.input.upgradeRoot,'next',c.name));if(c.previous!==null)fixtureRename(join(f.input.upgradeRoot,'previous',c.name),join(f.i.root,c.name));}
  for(const suffix of ['.completed.json','.released.json'])unlinkSync(requestFile(f,suffix));
  writeFileSync(requestFile(f,'.reserve'),f.reserve,{mode:0o600});barriers(f);return sw;
}
function completedComponent(f,c){
  if(c.previous!==null)fixtureRename(join(f.i.root,c.name),join(f.input.upgradeRoot,'previous',c.name));
  fixtureRename(join(f.input.upgradeRoot,'next',c.name),join(f.i.root,c.name));
}

test('installed activation retains old component identities and actually restarts with the new runtime and tool binding',async()=>{
  const f=fixture('restart'),custom=join(f.i.root,'plugin/private.bin');writeFileSync(custom,Buffer.from([0,255,42,128]),{mode:0o400});
  const originalRun=await startAndStop(f,runtime),oldRunFile=join(f.i.root,'runs',originalRun.runId+'.json'),oldRunBytes=readFileSync(oldRunFile),originalWorkspace=snapshot(f.i.workspaceRoot),oldPlugin=snapshot(join(f.i.root,'plugin')),oldInstall=node(join(f.i.root,'installation.json')),oldLedger=node(join(f.i.root,'toolchain-bindings.json')),work=node(join(f.i.root,'formal-work'));
  prepare(f);const result=activate(f),current=manager.readInstallation(f.i.root),ledger=toolchains.readToolchainLedger(current);
  assert.equal(result.status,'COMPLETED');assert.equal(result.runtimeActivated,true);assert.equal(result.serviceStarted,false);assert.equal(current.runtime.digest,next.digest);assert.equal(ledger.records.length,2);assert.equal(ledger.records.at(-1).digest,f.s.toolchainBindingDigest);
  assert.deepEqual(node(join(f.input.upgradeRoot,'previous/installation.json')),oldInstall);assert.deepEqual(node(join(f.input.upgradeRoot,'previous/toolchain-bindings.json')),oldLedger);assert.deepEqual(snapshot(join(f.input.upgradeRoot,'previous/plugin')),oldPlugin);assert.deepEqual(node(join(f.i.root,'formal-work')),work);
  assert.deepEqual(snapshot(f.i.workspaceRoot),originalWorkspace);assert.deepEqual(readFileSync(oldRunFile),oldRunBytes);assert.deepEqual(readFileSync(custom),Buffer.from([0,255,42,128]));assert.equal(manager.currentRun(current).runId,originalRun.runId,'Activation must not auto-start a new run');
  assert.equal(manager.bindInstallationToolchains(f.i.root,f.binding).replayed,true);
  for(const root of [f.i.root,f.i.workspaceRoot,join(f.i.root,'formal-work')])workspace.requireMaintenanceAvailable(root);
  const run=await startAndStop(f,next);assert.notEqual(run.runId,originalRun.runId);assert.equal(run.toolchainBindingDigest,f.s.toolchainBindingDigest);assert.deepEqual(readFileSync(oldRunFile),oldRunBytes);
});

test('first configured upgrade preserves an empty original worker directory and installs a writable owned root; null tools stay explicit',async()=>{
  const f=fixture('first-tools',false,true),work=join(f.i.root,'formal-work');mkdirSync(work,{mode:0o500});const original=node(work),before=snapshot(f.i.workspaceRoot);prepare(f);activate(f);
  assert.deepEqual(node(join(f.input.upgradeRoot,'previous/formal-work')),original);assert.equal(node(work).mode,0o700);assert.notEqual(node(work).inode,original.inode);assert.equal(readJSON(join(work,'owner.json')).root,work);assert.equal(manager.inspectInstallationToolchains(f.i.root).status,'VERIFIED');assert.deepEqual(snapshot(f.i.workspaceRoot),before);await startAndStop(f,next);
  const unconfigured=prepare(fixture('still-unconfigured',false,false));activate(unconfigured);assert.equal(manager.inspectInstallationToolchains(unconfigured.i.root).status,'UNCONFIGURED');assert.equal(existsSync(join(unconfigured.i.root,'toolchain-bindings.json')),false);assert.equal(existsSync(join(unconfigured.i.root,'formal-work')),false);
});

test('synthetic interrupted selected-root chmod states resume to the original sealed directory modes',()=>{
  for(const position of ['old-live','old-kept','new-next','new-live']){
    const f=fixture('mode-'+position),live=join(f.i.root,'plugin'),kept=join(f.input.upgradeRoot,'previous/plugin'),candidate=join(f.input.upgradeRoot,'next/plugin');chmodSync(live,0o500);
    const original=snapshot(live),originalWorkspace=snapshot(f.i.workspaceRoot),work=node(join(f.i.root,'formal-work'));prepare(f);const nextImage=snapshot(candidate),first=activate(f),sw=rewindConfigured(f),component=sw.components.find(c=>c.name==='plugin'),switchBytes=readFileSync(requestFile(f,'.switch.json'));assert.ok(component);assert.equal(component.previous.mode,0o500);assert.equal(component.next.mode,0o500);
    // This is synthetic crash-state reconstruction from real completed nodes.
    // It retains the original sealed images and switch bytes without resealing.
    let transient;
    if(position==='old-live')transient=live;
    else if(position==='new-live'){completedComponent(f,component);transient=live;}
    else{fixtureRename(live,kept);transient=position==='old-kept'?kept:candidate;}
    chmodSync(transient,0o700);assert.equal(node(transient).mode,0o700);assert.throws(()=>abort(f),code('UPGRADE_SWITCH_PENDING'));
    const resumed=activate(f);assert.equal(resumed.status,'COMPLETED');assert.deepEqual(resumed.receipt,first.receipt);assert.deepEqual(readFileSync(requestFile(f,'.switch.json')),switchBytes);
    assert.deepEqual(snapshot(kept),original);assert.deepEqual(snapshot(live),nextImage);assert.equal(node(kept).mode,0o500);assert.equal(node(live).mode,0o500);assert.deepEqual(node(join(f.i.root,'formal-work')),work);assert.deepEqual(snapshot(f.i.workspaceRoot),originalWorkspace);
    for(const c of sw.components){assert.deepEqual(node(join(f.i.root,c.name)),c.next);if(c.previous!==null)assert.deepEqual(node(join(f.input.upgradeRoot,'previous',c.name)),c.previous);}
    assert.equal(activate(f).replayed,true);
  }
});

test('synthetic interrupted component renames resume exactly while live installation metadata is absent',()=>{
  const f=prepare(fixture('missing-metadata')),originalWorkspace=snapshot(f.i.workspaceRoot);activate(f);const sw=rewindConfigured(f),plugin=sw.components.find(c=>c.name==='plugin'),metadata=sw.components.find(c=>c.name==='installation.json');assert.ok(plugin&&metadata);
  completedComponent(f,plugin);renameSync(join(f.i.root,'installation.json'),join(f.input.upgradeRoot,'previous/installation.json'));assert.equal(existsSync(join(f.i.root,'installation.json')),false);
  assert.throws(()=>abort(f),code('UPGRADE_SWITCH_PENDING'));
  const resumed=activate(f);assert.equal(resumed.status,'COMPLETED');assert.equal(manager.readInstallation(f.i.root).runtime.digest,next.digest);assert.equal(activate(f).replayed,true);
  assert.deepEqual(snapshot(f.i.workspaceRoot).filter(e=>e[0]!==workspace.UPGRADE_BARRIER),originalWorkspace.filter(e=>e[0]!==workspace.UPGRADE_BARRIER));
  for(const c of sw.components){assert.deepEqual(node(join(f.i.root,c.name)),c.next);if(c.previous!==null)assert.deepEqual(node(join(f.input.upgradeRoot,'previous',c.name)),c.previous);}
});

test('a partial switch admission disables abort and resumes only its exact retained protocol prefix',()=>{
  const f=prepare(fixture('switch-prefix'));activate(f);rewindConfigured(f);const full=readFileSync(requestFile(f,'.switch.json'));unlinkSync(requestFile(f,'.switch.json'));writeFileSync(requestFile(f,'.switch.json.pending'),full.subarray(0,200),{mode:0o600});
  assert.throws(()=>abort(f),code('UPGRADE_SWITCH_PENDING'));assert.equal(activate(f).status,'COMPLETED');assert.deepEqual(readFileSync(requestFile(f,'.switch.json')),full);
});

test('stale selections, modified sealed bytes, foreign markers and ambiguous physical locations cannot be adopted',()=>{
  const stale=prepare(fixture('stale')),before=snapshot(stale.i.root);assert.throws(()=>activation.activateInstallationUpgrade(stale.i.root,stale.input,stale.p.reportDigest,'sha256:'+'f'.repeat(64)),upgradeFailure);assert.deepEqual(snapshot(stale.i.root),before);
  const changed=prepare(fixture('changed')),path=join(changed.input.upgradeRoot,'next/plugin/.mcp.json'),original=readFileSync(path);writeFileSync(path,Buffer.concat([original,Buffer.from(' ')]));const old=readFileSync(join(changed.i.root,'installation.json'));assert.throws(()=>activate(changed),upgradeFailure);assert.deepEqual(readFileSync(join(changed.i.root,'installation.json')),old);assert.deepEqual(readFileSync(path),Buffer.concat([original,Buffer.from(' ')]));
  const foreign=prepare(fixture('foreign-marker')),barrier=join(foreign.i.workspaceRoot,workspace.UPGRADE_BARRIER);writeFileSync(barrier,JSON.stringify({...readJSON(barrier),requestId:'another-request'})+'\n');const bytes=readFileSync(barrier);assert.throws(()=>activate(foreign),upgradeFailure);assert.deepEqual(readFileSync(barrier),bytes);
  const corrupt=prepare(fixture('corrupt-switch'));activate(corrupt);rewindConfigured(corrupt);const switchFile=requestFile(corrupt,'.switch.json'),wrong={...readJSON(switchFile),requestDigest:'sha256:'+'f'.repeat(64)};writeFileSync(switchFile,JSON.stringify(wrong)+'\n');const corruptOwner=snapshot(corrupt.i.root),corruptCandidate=snapshot(corrupt.input.upgradeRoot);assert.throws(()=>activate(corrupt),upgradeFailure);assert.deepEqual(snapshot(corrupt.i.root),corruptOwner);assert.deepEqual(snapshot(corrupt.input.upgradeRoot),corruptCandidate);
  const ambiguous=prepare(fixture('ambiguous'));activate(ambiguous);rewindConfigured(ambiguous);const copied=join(ambiguous.input.upgradeRoot,'previous/plugin');cpSync(join(ambiguous.i.root,'plugin'),copied,{recursive:true});mirrorModes(join(ambiguous.i.root,'plugin'),copied);const live=snapshot(join(ambiguous.i.root,'plugin')),copy=snapshot(copied);assert.throws(()=>activate(ambiguous),upgradeFailure);assert.deepEqual(snapshot(join(ambiguous.i.root,'plugin')),live);assert.deepEqual(snapshot(copied),copy);
});

test('an existing readonly preservation root is rejected before switch admission without changing its identity or mode',()=>{
  const f=prepare(fixture('readonly-previous')),previous=join(f.input.upgradeRoot,'previous');mkdirSync(previous,{mode:0o500});const original=node(previous);
  rejectsWithoutMutation(f,'UPGRADE_SWITCH_EVIDENCE');assert.deepEqual(node(previous),original);assert.equal(node(previous).mode,0o500);
  for(const suffix of ['.switch.json','.switch.json.pending','.completed.json','.completed.json.pending'])assert.equal(existsSync(requestFile(f,suffix)),false);
});

test('configured worker backup and restore maintenance barriers block activation before switch without changing owner data',()=>{
  for(const operation of ['backup','restore']){
    const f=prepare(fixture('worker-'+operation)),work=join(f.i.root,'formal-work'),original=node(work),identity={installationId:f.i.installationId,workspaceId:f.i.workspaceId,serviceId:f.i.serviceId,requestId:'retained-'+operation,requestDigest:validation.hashBytes(Buffer.from('retained-'+operation))};
    // Synthetic retained markers use the actual owner barrier schemas. They
    // must be rejected by maintenance guards before inventory or rename work.
    const value=operation==='backup'?{schema:'ontology-maintenance-barrier/v1',operation:'BACKUP',root:work,backupRoot:join(base,'retained-worker-backup'),...identity,reportDigest:validation.hashBytes(Buffer.from('retained-backup-report'))}:{schema:'ontology-restore-activation-barrier/v1',root:work,recoveryRoot:join(base,'retained-worker-recovery'),...identity};
    const path=join(work,operation==='backup'?workspace.MAINTENANCE_FILE:workspace.RESTORE_ACTIVATION_BARRIER);writeFileSync(path,JSON.stringify(value)+'\n',{mode:0o600});
    assert.deepEqual(operation==='backup'?workspace.readMaintenanceBarrier(work):workspace.readRestoreActivationBarrier(work),value);rejectsWithoutMutation(f,operation==='backup'?'BACKUP_PENDING':'RESTORE_ACTIVATION_PENDING');assert.deepEqual(node(work),original);
    for(const suffix of ['.switch.json','.switch.json.pending','.completed.json','.completed.json.pending'])assert.equal(existsSync(requestFile(f,suffix)),false);
    assert.equal(existsSync(join(f.input.upgradeRoot,'previous')),false);
  }
});

test('tampered reserved completion space is rejected before switch admission or any resumed component rename',()=>{
  for(const admitted of [false,true]){
    const f=prepare(fixture(admitted?'reserve-after-switch':'reserve-before-switch'));
    if(admitted){activate(f);rewindConfigured(f);}
    const reserve=requestFile(f,'.reserve');writeFileSync(reserve,JSON.stringify({...readJSON(reserve),requestDigest:'sha256:'+'f'.repeat(64)})+'\n');
    rejectsWithoutMutation(f,'UPGRADE_EVIDENCE');assert.equal(existsSync(requestFile(f,'.switch.json')),admitted);assert.equal(existsSync(requestFile(f,'.completed.json')),false);
  }
});

test('a partial completion cannot admit or finish an absent or merely partial switch',()=>{
  const f=prepare(fixture('completion-without-switch'));activate(f);const completion=readFileSync(requestFile(f,'.completed.json')),switchBytes=readFileSync(requestFile(f,'.switch.json'));rewindConfigured(f);
  unlinkSync(requestFile(f,'.switch.json'));writeFileSync(requestFile(f,'.completed.json.pending'),completion.subarray(0,200),{mode:0o600});
  rejectsWithoutMutation(f,'UPGRADE_SWITCH_EVIDENCE');assert.equal(existsSync(requestFile(f,'.switch.json')),false);
  writeFileSync(requestFile(f,'.switch.json.pending'),switchBytes.subarray(0,200),{mode:0o600});
  rejectsWithoutMutation(f,'UPGRADE_SWITCH_EVIDENCE');assert.equal(existsSync(requestFile(f,'.switch.json')),false);
});

test('a partial completion requires every component installed and the exact deterministic receipt prefix before mutation',()=>{
  const f=prepare(fixture('completion-prefix'));const original=activate(f),completion=readFileSync(requestFile(f,'.completed.json')),sw=rewindConfigured(f),pending=requestFile(f,'.completed.json.pending');
  writeFileSync(pending,completion.subarray(0,200),{mode:0o600});
  // Synthetic committed switch with a premature completion prefix: all READY.
  rejectsWithoutMutation(f,'UPGRADE_SWITCH_EVIDENCE');
  const plugin=sw.components.find(c=>c.name==='plugin'),metadata=sw.components.find(c=>c.name==='installation.json');assert.ok(plugin&&metadata);
  completedComponent(f,plugin);renameSync(join(f.i.root,metadata.name),join(f.input.upgradeRoot,'previous',metadata.name));
  // Exact original nodes now span INSTALLED, READY and OLD_MOVED, with no live
  // installation.json. A completion prefix cannot authorize more renames.
  assert.equal(existsSync(join(f.i.root,metadata.name)),false);rejectsWithoutMutation(f,'UPGRADE_SWITCH_EVIDENCE');
  for(const component of sw.components)if(component!==plugin&&component!==metadata)completedComponent(f,component);
  renameSync(join(f.input.upgradeRoot,'next',metadata.name),join(f.i.root,metadata.name));
  for(const component of sw.components)assert.deepEqual(node(join(f.i.root,component.name)),component.next);
  writeFileSync(pending,JSON.stringify({...JSON.parse(completion),transitionDigest:'sha256:'+'f'.repeat(64)})+'\n');
  rejectsWithoutMutation(f,'UPGRADE_SWITCH_EVIDENCE');
  // An actual interrupted completion write occurs after reserve release. Once
  // all nodes are installed, only the original deterministic prefix may resume.
  writeFileSync(pending,completion.subarray(0,completion.length-5));unlinkSync(requestFile(f,'.reserve'));
  const resumed=activate(f);assert.equal(resumed.status,'COMPLETED');assert.deepEqual(resumed.receipt,original.receipt);assert.deepEqual(readFileSync(requestFile(f,'.completed.json')),completion);assert.equal(existsSync(pending),false);
  for(const root of [f.i.root,f.i.workspaceRoot,join(f.i.root,'formal-work')])workspace.requireMaintenanceAvailable(root);
});

test('released completion replay rejects exact same-request reserve and partial control leftovers without adopting or cleaning them',()=>{
  const f=prepare(fixture('released-leftovers')),completed=activate(f),leftovers=[['.reserve',f.reserve],['.reserve.pending',f.reserve.subarray(0,200)],...['.json','.stage.json','.switch.json','.completed.json','.released.json'].map(suffix=>[suffix+'.pending',readFileSync(requestFile(f,suffix)).subarray(0,200)])];
  for(const [suffix,bytes] of leftovers){
    const path=requestFile(f,suffix);writeFileSync(path,bytes,{mode:0o600});rejectsWithoutMutation(f,'UPGRADE_SWITCH_EVIDENCE');unlinkSync(path);
  }
  assert.deepEqual(activate(f).receipt,completed.receipt);assert.equal(activate(f).replayed,true);
});

test('durable completion resumes barrier cleanup without reattesting the old source or removed first-tool barrier inode',()=>{
  const f=prepare(fixture('completion-cleanup',false,true)),first=activate(f),completedBytes=readFileSync(requestFile(f,'.completed.json'));unlinkSync(requestFile(f,'.released.json'));
  // Synthetic completion-before-release state. A workspace may have received
  // later writes after its barrier was cleared; cleanup cannot roll them back.
  const note=join(f.i.workspaceRoot,'later-owner-note.txt');writeFileSync(note,'retain later owner material',{mode:0o600});barriers(f,[f.i.workspaceRoot,join(f.i.root,'formal-work')]);const result=activate(f);
  assert.deepEqual(result.receipt,first.receipt);assert.deepEqual(readFileSync(requestFile(f,'.completed.json')),completedBytes);assert.equal(readFileSync(note,'utf8'),'retain later owner material');for(const root of [f.i.root,f.i.workspaceRoot,join(f.i.root,'formal-work')])workspace.requireMaintenanceAvailable(root);assert.equal(activate(f).replayed,true);
});

test('completion cleanup rejects a changed transition digest and preserves all retained owner barriers',()=>{
  const f=prepare(fixture('completion-transition'));activate(f);unlinkSync(requestFile(f,'.released.json'));barriers(f);
  const path=requestFile(f,'.completed.json');writeFileSync(path,JSON.stringify({...readJSON(path),transitionDigest:'sha256:'+'f'.repeat(64)})+'\n');
  rejectsWithoutMutation(f,'UPGRADE_SWITCH_EVIDENCE');
  for(const root of [f.i.root,f.i.workspaceRoot,join(f.i.root,'formal-work')])assert.equal(readFileSync(join(root,workspace.UPGRADE_BARRIER),'utf8'),JSON.stringify(marker(f,root))+'\n');
  assert.equal(existsSync(requestFile(f,'.released.json')),false);
});

test('historical completion survives another upgrade, unavailable staged/runtime files, and backup/restore materialization',()=>{
  const f=prepare(fixture('history')),first=activate(f),retained=readFileSync(requestFile(f,'.completed.json')),second={...f,input:{...f.input,requestId:'return-original-runtime',upgradeRoot:join(base,'history-second-upgrade'),runtimeRoot:runtime.root,runtimeDigest:runtime.digest},p:null,s:null};prepare(second);activate(second);
  assert.equal(manager.readInstallation(f.i.root).runtime.digest,runtime.digest);assert.equal(toolchains.readToolchainLedger(manager.readInstallation(f.i.root)).records.length,3);assert.deepEqual(activate(f).receipt,first.receipt);assert.deepEqual(readFileSync(requestFile(f,'.completed.json')),retained);
  renameSync(f.input.upgradeRoot,f.input.upgradeRoot+'-retained');
  for(const root of [next.root,runtime.root]){const missing=root+'-unavailable';renameSync(root,missing);try{assert.deepEqual(activate(f).receipt,first.receipt);}finally{renameSync(missing,root);}}
  const backupRoot=join(base,'history-backup'),requestId='history-cold-backup',inspection=backup.inspectInstallationBackup(f.i.root,backupRoot,requestId),snapshotResult=backup.backupInstallation(f.i.root,{backupRoot,requestId,expectedReportDigest:inspection.reportDigest});
  for(const suffix of ['.json','.stage.json','.switch.json','.completed.json','.released.json'])assert.ok(inspection.report.entries.some(e=>e.path===workspace.UPGRADE_RECORDS+'/'+workspace.upgradeControlKey(f.input.requestId)+suffix));
  const restoreInput={backupRoot,expectedManifestDigest:snapshotResult.receipt.manifestDigest,stageRoot:join(base,'history-restored'),requestId:'history-restore-materialization'},restorePlan=restore.inspectRestoreStage(restoreInput),restored=restore.stageInstallationRestore(restoreInput,restorePlan.reportDigest);assert.equal(restore.verifyRestoreStage(restoreInput.stageRoot,restored.receipt.manifestDigest).status,'VERIFIED');
  for(const suffix of ['.switch.json','.completed.json','.released.json'])assert.deepEqual(readFileSync(join(restoreInput.stageRoot,'installation',workspace.UPGRADE_RECORDS,workspace.upgradeControlKey(f.input.requestId)+suffix)),readFileSync(requestFile(f,suffix)));
});

test('an actual installed activation child killed after switch admission resumes the same request without automatic restart',async()=>{
  const f=prepare(fixture('actual-kill')),originalWorkspace=snapshot(f.i.workspaceRoot),request=join(base,'actual-activation-request.json');writeFileSync(request,JSON.stringify({root:f.i.root,input:f.input,report:f.p.reportDigest,prepared:f.s.preparedDigest}),{mode:0o600});
  let child,signalSent=false,timedOut=false,output='',timer;
  const watcher=watch(join(f.i.root,workspace.UPGRADE_RECORDS),{persistent:false},()=>{if(child&&!signalSent&&existsSync(requestFile(f,'.switch.json'))&&!existsSync(requestFile(f,'.completed.json')))signalSent=child.kill('SIGKILL');});
  const exited=new Promise((resolve,reject)=>{
    child=spawn(process.execPath,['--input-type=module','-e',"import {readFileSync} from 'node:fs'; const p=JSON.parse(readFileSync(process.argv[2]));const m=await import(process.argv[1]);m.activateInstallationUpgrade(p.root,p.input,p.report,p.prepared);",activationURL,request],{stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},60000);
  });
  try{const result=await exited;assert.equal(timedOut,false,output);assert.equal(signalSent,true,output);assert.equal(result.signal,'SIGKILL',output);assert.ok(existsSync(requestFile(f,'.switch.json')));assert.equal(existsSync(requestFile(f,'.completed.json')),false,'Observed kill must precede durable completion');}
  finally{clearTimeout(timer);watcher.close();if(child?.pid&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
  assert.throws(()=>abort(f),code('UPGRADE_SWITCH_PENDING'));const resumed=activate(f);assert.equal(resumed.status,'COMPLETED');assert.equal(resumed.serviceStarted,false);assert.equal(manager.currentRun(manager.readInstallation(f.i.root)),null);assert.equal(activate(f).replayed,true);
  assert.deepEqual(snapshot(f.i.workspaceRoot).filter(e=>e[0]!==workspace.UPGRADE_BARRIER),originalWorkspace.filter(e=>e[0]!==workspace.UPGRADE_BARRIER));
});
