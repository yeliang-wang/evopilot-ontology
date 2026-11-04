import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,rmSync,renameSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {hash,hashBytes} from '../../dist/standalone/validation.js';
import {readConnection,sendRequest} from '../../dist/standalone/client.js';
import {definition,sourceSet,expected,model} from '../helpers/v090-validation.mjs';

const source=fileURLToPath(new URL('../..',import.meta.url));
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:60000,maxBuffer:16*1024*1024,...options},(e,out,err)=>e?reject(Error(out+'\n'+err)):resolve(out)));
const save=(p,v)=>writeFileSync(p,JSON.stringify(v)+'\n',{mode:0o600});
let base,runtime,next,manager,history,contract,toolchains,files,workspace,control,upgrade,backup,stage,lost,retained,backupContract,systemd,systemdApi,journal,cleanupComplete=true;
const code=c=>e=>e.code===c;
before(async()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Actual installed formal tools required');
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-runtime-history-')));
  const pack=JSON.parse(await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',base],{cwd:source})),roots=['base-runtime','next-runtime'].map(n=>join(base,n));
  for(const root of roots){mkdirSync(root,{mode:0o700});await execute('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',root,join(base,pack[0].filename)],{cwd:base});}
  // The second installed package has an explicit synthetic package revision.
  // No test fixture claims a released product or transactionally applied upgrade.
  writeFileSync(join(roots[1],'node_modules/@evopilot-next/ontology/docs/synthetic-runtime-history.txt'),'Synthetic different installed package bytes.\n');
  const installed=join(roots[0],'node_modules/@evopilot-next/ontology'),load=name=>import(pathToFileURL(join(installed,'dist',name+'.js'))),r=await load('installation/runtime');
  runtime=r.inspectRuntime(roots[0]);next=r.inspectRuntime(roots[1]);
  systemdApi=await load('installation/systemd-binding');journal=await load('installation/worker-journal');
  systemd=process.platform==='linux'?systemdApi.inspectSystemdBinding():null;
  [manager,history,contract,toolchains,files,workspace,control,upgrade,backup,stage,lost,retained,backupContract]=await Promise.all(['installation/manager','installation/runtime-history','installation/installation-contract','installation/toolchains','installation/files','standalone/workspace','installation/control','installation/plugin-upgrade','installation/backup','installation/restore-stage','installation/restore-lost','installation/restore-activate','installation/backup-contract'].map(load));
});
after(()=>{if(base&&cleanupComplete)rmSync(base,{recursive:true,force:true});});
function fixture(t,name){
  const input={root:join(base,name+'-installation'),workspaceRoot:join(base,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot:runtime.root,runtimeDigest:runtime.digest,mode:'create'};
  const i=manager.prepareInstallation(input),selection=key=>({toolchainFile:process.env[key],toolchainDigest:JSON.parse(readFileSync(process.env[key])).digest});
  const binding={requestId:'original-bind',previousBindingDigest:null,dl:selection('EVOPILOT_TEST_DL_TOOLCHAIN'),shacl:selection('EVOPILOT_TEST_SHACL_TOOLCHAIN'),...(systemd?{systemd}:{})};
  t.after(async()=>{
    try{
      await manager.stopInstallation(i.root);
      const workRoot=join(i.root,'formal-work');
      if(systemd&&existsSync(join(workRoot,'worker-journal.sqlite'))){
        for(const attempt of journal.currentWorkerAttempts(workRoot).attempts){
          if(!attempt.intent.systemd||!attempt.unit)continue;
          assert.equal(attempt.terminal?.empty,true,'Retain fixture evidence if worker exit is unproven');
          systemdApi.systemdCall(systemd,'/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager','StopUnit','ss',[journal.workerUnitName(attempt.reference),'replace']);
        }
      }
    }catch(e){cleanupComplete=false;throw e;}
  });return {i,input,binding,ordinal:0};
}
const request=(f,operation,input={},extra={})=>({workspaceId:f.i.workspaceId,serviceId:f.i.serviceId,projectId:'demo',operation,input,...extra});
const http=(f,operation,input={},extra={})=>sendRequest(readConnection(join(f.i.root,'connection.json')),request(f,operation,input,extra),Boolean(extra.requestId));
async function seed(f){
  const p=await http(f,'project.create',{label:'Synthetic retained runtime history'},{requestId:'create',expectedRevision:0});
  const intentDigest=(await http(f,'intent.record',{definition,previousDigest:null},{requestId:'intent',expectedRevision:1})).result.intentDigest;
  const sourceSetDigest=(await http(f,'source.admit',{intentDigest,sourceSet},{requestId:'sources',expectedRevision:2})).result.sourceSetDigest;
  const expectationsDigest=(await http(f,'expectations.record',{definition:expected(intentDigest,sourceSetDigest)},{requestId:'expectations',expectedRevision:3})).result.expectationsDigest;
  const modelDigest=(await http(f,'model.record',{draft:model(intentDigest,sourceSetDigest,expectationsDigest)},{requestId:'model',expectedRevision:4})).result.modelDigest;return {original:p,modelDigest};
}
/** Explicit metadata fixture, not a product upgrade command or fault-safe
 * activation. It uses the prospective history builder and real tool binding
 * under both owner leases, then installs the already reviewed plugin buffers. */
function fixtureTransition(f,selected,id){
  const prior=manager.readInstallation(f.i.root),plan=upgrade.preparePluginUpgrade(prior.root,{runtimeRoot:selected.root,runtimeDigest:selected.digest});assert.equal(plan.report.status,'MERGED');
  const ledger=toolchains.readToolchainLedger(prior),previous=ledger.records.at(-1)?.digest??null,unlock=files.operatorLock(prior.root),store=workspace.openWorkspace(prior.workspaceRoot,prior);
  try{
    const receipt=previous?toolchains.recordToolchainBinding({...prior,runtime:selected},{...f.binding,requestId:id+'-tools',previousBindingDigest:previous},ledger):null;
    const candidate=history.appendRuntimeHistory(prior,hashBytes(readFileSync(join(prior.root,'setup.json'))),{requestId:id,planDigest:hash({syntheticFixture:id,pluginPlanDigest:plan.reportDigest}),runtime:selected,previousToolchainBindingDigest:previous,toolchainBindingDigest:receipt?.digest??null,pluginPlanDigest:plan.reportDigest,recordedAt:new Date().toISOString()});
    contract.validateInstallation(candidate);for(const [p,b] of plan.files)writeFileSync(join(prior.root,'plugin',p),b,{mode:0o600});save(join(prior.root,'installation.json'),candidate);f.i=candidate;return {candidate,receipt};
  }finally{store.close();unlock();}
}
function snapshot(f){
  const n=++f.ordinal,g=JSON.parse(readFileSync(join(f.i.workspaceRoot,'identity.json'))).recovery?.generation,requestId=(g?'r'+g+'.':'')+'backup-'+n,backupRoot=join(base,f.i.workspaceId+'-backup-'+n);
  const p=backup.inspectInstallationBackup(f.i.root,backupRoot,requestId),b=backup.backupInstallation(f.i.root,{backupRoot,requestId,expectedReportDigest:p.reportDigest}),v={backupRoot,expectedManifestDigest:b.receipt.manifestDigest,stageRoot:join(base,f.i.workspaceId+'-stage-'+n),requestId:'stage-'+n};
  const report=stage.inspectRestoreStage(v),done=stage.stageInstallationRestore(v,report.reportDigest);return {root:v.stageRoot,manifestDigest:done.receipt.manifestDigest};
}

test('actual managed runs bind complete runtime identities while original setup, run and tool receipts survive a versioned metadata fixture',async t=>{
  const f=fixture(t,'records'),b=manager.bindInstallationToolchains(f.i.root,f.binding),oldRuntime=structuredClone(f.i.runtime),setup=readFileSync(join(f.i.root,'setup.json'));
  const first=await manager.startInstallation(f.i.root);assert.equal(first.run.schema,'ontology-managed-run/v3');assert.equal(first.run.runtimeBindingDigest,hash(oldRuntime));const seeded=await seed(f);await manager.stopInstallation(f.i.root);
  const oldRun=readFileSync(join(f.i.root,'runs',first.run.runId+'.json')),oldLedger=toolchains.readToolchainLedger(f.i).records;
  const moved=fixtureTransition(f,next,'move');assert.deepEqual(toolchains.readToolchainLedger(f.i).records.slice(0,oldLedger.length),oldLedger);assert.equal(moved.receipt.binding.runtimeDigest,next.digest);
  assert.deepEqual(manager.prepareInstallation(f.input),f.i);assert.deepEqual(readFileSync(join(f.i.root,'setup.json')),setup);assert.deepEqual(readFileSync(join(f.i.root,'runs',first.run.runId+'.json')),oldRun);
  const replay=manager.bindInstallationToolchains(f.i.root,f.binding);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,b.receipt);assert.equal(replay.currentBindingDigest,moved.receipt.digest);
  assert.throws(()=>manager.bindInstallationToolchains(f.i.root,{...f.binding,previousBindingDigest:moved.receipt.digest}),code('REQUEST_CONFLICT'));
  const second=await manager.startInstallation(f.i.root);assert.equal(second.run.runtimeBindingDigest,hash(next));assert.equal(second.run.toolchainBindingDigest,moved.receipt.digest);assert.deepEqual(await http(f,'receipt.read',{requestId:'create'}),seeded.original);
  await assert.rejects(control.operatorRequest({...second.run,runtimeBindingDigest:hash(oldRuntime)},'status'),code('IDENTITY_MISMATCH'));
  const validation=await http(f,'validation.start',{assetId:'services',modelDigest:seeded.modelDigest},{requestId:'after-transition-validation',expectedRevision:5});let result;
  for(let n=0;n<600;n++){result=await http(f,'validation.inspect',{taskId:validation.result.taskId});if(result.state==='FINISHED')break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(result.state,'FINISHED');assert.equal(result.formalStatus,'MATCHED');assert.equal(result.complete,true);await manager.stopInstallation(f.i.root);
  assert.deepEqual(readFileSync(join(f.i.root,'runs',first.run.runId+'.json')),oldRun);
});

test('history rejects rewritten origin, chains, current runtime, same-digest aliases and configured-tool removal',t=>{
  const f=fixture(t,'corrupt');manager.bindInstallationToolchains(f.i.root,f.binding);fixtureTransition(f,next,'move');
  for(const mutate of [v=>{v.port=1;},v=>{v.runtime=runtime;},v=>{v.runtimeHistory.records=[];},v=>{v.runtimeHistory.records[0].transition.requestDigest=hash('foreign');v.runtimeHistory.records[0].digest=hash(v.runtimeHistory.records[0].transition);},v=>{v.runtimeHistory.records[0].transition.previousDigest=hash('foreign');v.runtimeHistory.records[0].digest=hash(v.runtimeHistory.records[0].transition);},v=>{v.runtimeHistory.records[0].transition.toolchainBindingDigest=null;v.runtimeHistory.records[0].digest=hash(v.runtimeHistory.records[0].transition);}]){
    const v=structuredClone(f.i);mutate(v);assert.throws(()=>contract.validateInstallation(v),code('RUNTIME_HISTORY'));
  }
  const original=manager.prepareInstallation({...f.input,root:join(base,'alias-original'),workspaceRoot:join(base,'alias-state'),workspaceId:'alias'}),alias={...runtime,root:join(base,'same-bytes-other-root'),packageRoot:join(base,'same-bytes-other-root/node_modules/@evopilot-next/ontology')};
  assert.throws(()=>history.appendRuntimeHistory(original,hash('setup'),{requestId:'alias',planDigest:hash('plan'),runtime:alias,previousToolchainBindingDigest:null,toolchainBindingDigest:null,pluginPlanDigest:hash('plugin'),recordedAt:new Date().toISOString()}),code('RUNTIME_HISTORY'));
  const setupFile=join(f.i.root,'setup.json'),raw=readFileSync(setupFile);writeFileSync(setupFile,Buffer.concat([raw,Buffer.from(' ')]));try{assert.throws(()=>manager.readInstallation(f.i.root),code('RUNTIME_HISTORY'));}finally{writeFileSync(setupFile,raw);}
  const ledger=toolchains.readToolchainLedger(f.i),ledgerFile=join(f.i.root,'toolchain-bindings.json'),bytes=readFileSync(ledgerFile);save(ledgerFile,{...ledger,records:ledger.records.slice(0,1)});
  try{assert.throws(()=>toolchains.readToolchainLedger(f.i),code('TOOLCHAIN_BINDING_MISSING'));}finally{writeFileSync(ledgerFile,bytes);}
  assert.throws(()=>toolchains.verifyManagedToolchains(f.i,ledger.records[0]),code('TOOLCHAIN_BINDING_CONFLICT'));assert.throws(()=>toolchains.verifyManagedToolchains(f.i,null),code('TOOLCHAIN_BINDING_MISSING'));
  const selected=join(f.i.root,'installation.json'),saved=readFileSync(selected);save(selected,{...original,root:f.i.root,runtime:next});try{assert.throws(()=>toolchains.readToolchainLedger(manager.readInstallation(f.i.root)));}finally{writeFileSync(selected,saved);}
});

test('repeated selections preserve every historical binding and cannot reorder a transition around a later rebind',async t=>{
  const f=fixture(t,'sequence'),first=manager.bindInstallationToolchains(f.i.root,f.binding);fixtureTransition(f,next,'second');
  const secondHistory=structuredClone(f.i.runtimeHistory.records),current=toolchains.readToolchainLedger(f.i).records.at(-1),rebind=manager.bindInstallationToolchains(f.i.root,{...f.binding,requestId:'same-runtime-rebind',previousBindingDigest:current.digest});
  fixtureTransition(f,runtime,'third');assert.deepEqual(f.i.runtimeHistory.records.slice(0,1),secondHistory);assert.equal(f.i.runtimeHistory.records[1].transition.previousToolchainBindingDigest,rebind.receipt.digest);assert.equal(toolchains.readToolchainLedger(f.i).records.length,4);
  assert.deepEqual(manager.bindInstallationToolchains(f.i.root,f.binding).receipt,first.receipt);const run=await manager.startInstallation(f.i.root);assert.equal(run.run.runtimeBindingDigest,hash(runtime));await manager.stopInstallation(f.i.root);
  const value=structuredClone(f.i),last=value.runtimeHistory.records[1];last.transition.previousToolchainBindingDigest=current.digest;last.digest=hash(last.transition);contract.validateInstallation(value);assert.throws(()=>toolchains.readToolchainLedger(value),code('TOOLCHAIN_BINDING_CORRUPT'));
});

test('unconfigured history and explicitly legacy v2 run fixtures stay readable without invented runtime claims',async t=>{
  const f=fixture(t,'legacy'),run=await manager.startInstallation(f.i.root);await manager.stopInstallation(f.i.root);
  const path=join(f.i.root,'runs',run.run.runId+'.json'),v=JSON.parse(readFileSync(path));delete v.runtimeBindingDigest;v.schema='ontology-managed-run/v2';save(path,v);const raw=readFileSync(path);
  assert.deepEqual(manager.currentRun(f.i),v);fixtureTransition(f,next,'unconfigured');assert.deepEqual(manager.currentRun(f.i),v);assert.equal(manager.inspectInstallationToolchains(f.i.root).status,'UNCONFIGURED');
  const fresh=await manager.startInstallation(f.i.root);assert.equal(fresh.run.schema,'ontology-managed-run/v3');assert.equal(fresh.run.runtimeBindingDigest,hash(next));assert.deepEqual(readFileSync(path),raw);await manager.stopInstallation(f.i.root);
  // An explicit unstarted-request fixture exercises an actual foreign daemon
  // process. The refusal must leave that request and business state untouched.
  const pointer=join(f.i.root,'current-run.json'),beforePointer=readFileSync(pointer),pending={...fresh.run,runId:'wrong-entry',pid:null,state:'STARTING',origin:null,error:null},pendingFile=join(f.i.root,'runs/wrong-entry.json');
  save(pendingFile,pending);save(pointer,{runId:pending.runId});const pendingBytes=readFileSync(pendingFile),dbBytes=readFileSync(join(f.i.workspaceRoot,'ontology.sqlite')),ownerBytes=readFileSync(join(f.i.root,'installation.json'));
  try{
    await assert.rejects(execute(process.execPath,[join(runtime.packageRoot,'dist/installation/daemon.js'),'--installation',f.i.root,'--run',pending.runId]),/RUNTIME_ENTRY_MISMATCH/);
    assert.deepEqual(readFileSync(pendingFile),pendingBytes);assert.deepEqual(readFileSync(join(f.i.workspaceRoot,'ontology.sqlite')),dbBytes);assert.deepEqual(readFileSync(join(f.i.root,'installation.json')),ownerBytes);
  }finally{writeFileSync(pointer,beforePointer);rmSync(pendingFile);}
  assert.throws(()=>control.validateRun({...v,runtimeBindingDigest:hash(runtime)}),code('INVALID_STATE'));
});

test('actual lost and retained-current restoration preserve upgraded installation history and exact old tool receipts',async t=>{
  const f=fixture(t,'restore'),old=manager.bindInstallationToolchains(f.i.root,f.binding);fixtureTransition(f,next,'move');await manager.startInstallation(f.i.root);const seeded=await seed(f);await manager.stopInstallation(f.i.root);
  const originalInstallation=readFileSync(join(f.i.root,'installation.json')),originalSetup=readFileSync(join(f.i.root,'setup.json')),ledger=readFileSync(join(f.i.root,'toolchain-bindings.json')),snap=snapshot(f);
  const historicalDestination=join(runtime.root,'must-not-write'),staged=stage.readVerifiedRestoreStage(snap.root,snap.manifestDigest);
  assert.throws(()=>backup.inspectInstallationBackup(f.i.root,historicalDestination,'historical-destination'),code('UNSAFE_PATH'));
  assert.throws(()=>stage.inspectRestoreStage({backupRoot:staged.plan.backupRoot,expectedManifestDigest:staged.plan.expectedManifestDigest,stageRoot:historicalDestination,requestId:'historical-stage'}),code('UNSAFE_PATH'));
  assert.throws(()=>retained.inspectRestoreActivation({installationRoot:f.i.root,snapshot:snap,retained:snap,recoveryRoot:historicalDestination,requestId:'historical-retained'}),code('UNSAFE_PATH'));
  assert.throws(()=>history.requireSelectedRuntimeLocation(f.i,{...runtime,digest:hash('in-place-change')}),code('UNSAFE_PATH'));
  const p=backup.inspectInstallationBackup(f.i.root,join(base,'wrong-inventory-backup'),'wrong-inventory'),wrong=structuredClone(p.report);wrong.entries.find(e=>e.scope==='installation'&&e.path==='setup.json').digest=hash('wrong');assert.throws(()=>backupContract.validateBackupPlan(wrong),code('BACKUP_EVIDENCE'));
  for(const root of [f.i.root,f.i.workspaceRoot])renameSync(root,root+'-lost');
  const input={snapshot:snap,recoveryRoot:join(base,'lost-recovery'),requestId:'restore-history',rekeyExpiresAt:new Date(Date.now()+86400000).toISOString()};assert.throws(()=>lost.inspectLostRestore({...input,recoveryRoot:historicalDestination}),code('UNSAFE_PATH'));
  const plan=lost.inspectLostRestore(input),done=lost.activateLostRestore(input,plan.reportDigest);assert.equal(done.status,'ACTIVATED');
  assert.deepEqual(readFileSync(join(f.i.root,'installation.json')),originalInstallation);assert.deepEqual(readFileSync(join(f.i.root,'setup.json')),originalSetup);assert.deepEqual(readFileSync(join(f.i.root,'toolchain-bindings.json')),ledger);
  assert.deepEqual(manager.bindInstallationToolchains(f.i.root,f.binding).receipt,old.receipt);await manager.startInstallation(f.i.root);assert.deepEqual(await http(f,'receipt.read',{requestId:'create'}),seeded.original);await manager.stopInstallation(f.i.root);
  const retainedSnapshot=snapshot(f),retainedInput={installationRoot:f.i.root,snapshot:snap,retained:retainedSnapshot,recoveryRoot:join(base,'retained-recovery'),requestId:'retained-history'},retainedPlan=retained.inspectRestoreActivation(retainedInput),restored=retained.activateRestore(retainedInput,retainedPlan.reportDigest);assert.equal(restored.status,'ACTIVATED');assert.deepEqual(readFileSync(join(f.i.root,'installation.json')),originalInstallation);
  assert.deepEqual(manager.bindInstallationToolchains(f.i.root,f.binding).receipt,old.receipt);const fresh=await manager.startInstallation(f.i.root);assert.equal(fresh.run.runtimeBindingDigest,hash(next));assert.deepEqual(await http(f,'receipt.read',{requestId:'create'}),seeded.original);await manager.stopInstallation(f.i.root);
});
