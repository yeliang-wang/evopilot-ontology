import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,readFileSync,mkdirSync,rmSync,renameSync,writeFileSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile,spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {inspectRuntime} from '../../dist/installation/runtime.js';
import {operatorLock,settleOperatorJournal} from '../../dist/installation/files.js';
import {prepareInstallation,bindInstallationToolchains,startInstallation,stopInstallation} from '../../dist/installation/manager.js';
import {inspectInstallationTaskRecovery,reconcileInstallationTask} from '../../dist/installation/task-recovery.js';
import {inspectInstallationBackup,backupInstallation} from '../../dist/installation/backup.js';
import {inspectRestoreStage,stageInstallationRestore} from '../../dist/installation/restore-stage.js';
import {inspectLostRestore,activateLostRestore} from '../../dist/installation/restore-lost.js';
import {taskWorkerReferences,readWorkerAttempt,sealWorkerNotStarted,recordWorkerEvidence} from '../../dist/installation/worker-journal.js';
import {processPresent} from '../../dist/installation/control.js';
import {readConnection,sendRequest} from '../../dist/standalone/client.js';
import {hash} from '../../dist/standalone/validation.js';
import {definition,sourceSet,expected,model} from '../helpers/v090-validation.mjs';

const source=fileURLToPath(new URL('../..',import.meta.url)),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:30000,maxBuffer:2*1024*1024,...options},(e,out,err)=>e?reject(Error(`Command failed: ${e.code}\n${out}\n${err}`)):resolve(out)));
async function until(check){const end=Date.now()+15000;while(Date.now()<end){const value=await check();if(value)return value;await pause(10);}throw Error('Owned worker observation did not reach the expected state');}
let base,runtime,runtimeRoot,cli;
before(async()=>{
  assert(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Actual installed DL/SHACL tools required');
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-worker-recovery-')));runtimeRoot=join(base,'runtime');mkdirSync(runtimeRoot,{mode:0o700});
  const pack=JSON.parse(await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',base],{cwd:source}));
  await execute('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',runtimeRoot,join(base,pack[0].filename)],{cwd:base});
  runtime=inspectRuntime(runtimeRoot);cli=join(runtimeRoot,'node_modules/.bin/evopilot-ontology');
});
after(()=>{if(base)rmSync(base,{recursive:true,force:true});});
function fixture(t,name){
  const setup=prepareInstallation({root:join(base,name+'-installation'),workspaceRoot:join(base,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot,runtimeDigest:runtime.digest,mode:'create'}),runs=[],attempts=[],unproven=new Set();
  const selection=key=>({toolchainFile:process.env[key],toolchainDigest:JSON.parse(readFileSync(process.env[key])).digest});
  bindInstallationToolchains(setup.root,{requestId:'bind',previousBindingDigest:null,dl:selection('EVOPILOT_TEST_DL_TOOLCHAIN'),shacl:selection('EVOPILOT_TEST_SHACL_TOOLCHAIN')});
  const workRoot=join(setup.root,'formal-work'),request=(operation,input={})=>({workspaceId:setup.workspaceId,serviceId:setup.serviceId,projectId:'demo',operation,input});
  const http=req=>sendRequest(readConnection(join(setup.root,'connection.json')),req,Boolean(req.requestId));
  const start=async()=>{const r=await startInstallation(setup.root);runs.push(r.run);return r.run;};
  t.after(async()=>{
    await stopInstallation(setup.root);
    for(const ref of attempts){if(!unproven.has(ref.attemptId))await until(()=>readWorkerAttempt(ref).outcome);const a=readWorkerAttempt(ref);for(const pid of [a.worker?.pid,a.supervisor?.pid].filter(Boolean))await until(()=>processPresent(pid)===false);}
    for(const r of runs){await until(()=>processPresent(r.pid)===false);rmSync(dirname(r.controlSocket),{recursive:true,force:true});}
  });
  return {setup,workRoot,start,request,http,attempts,unproven};
}
async function seed(f){
  let revision=0;
  const write=async(operation,input,requestId)=>{const request={...f.request(operation,input),requestId,expectedRevision:revision},receipt=await f.http(request);revision=receipt.revision;return {request,receipt};};
  await write('project.create',{label:'Synthetic worker recovery'},'project');
  const intentDigest=(await write('intent.record',{definition,previousDigest:null},'intent')).receipt.result.intentDigest;
  const sourceSetDigest=(await write('source.admit',{intentDigest,sourceSet},'sources')).receipt.result.sourceSetDigest;
  const expectationsDigest=(await write('expectations.record',{definition:expected(intentDigest,sourceSetDigest)},'expectations')).receipt.result.expectationsDigest;
  const modelDigest=(await write('model.record',{draft:model(intentDigest,sourceSetDigest,expectationsDigest)},'model')).receipt.result.modelDigest;
  return {write,modelDigest};
}
async function active(f,taskId,kind,suspend=false){
  return until(()=>{
    for(const ref of taskWorkerReferences(f.workRoot,taskId)){
      const a=readWorkerAttempt(ref);
      if(a.worker&&!a.outcome&&(kind==='dl'?a.intent.executable.endsWith('/bin/java'):a.intent.executable.includes('/bin/python'))){
        // Hold this exact test-owned child alive across slower operator checks.
        // SIGKILL from its real supervisor must still stop a suspended worker.
        if(suspend)process.kill(a.worker.pid,'SIGSTOP');f.attempts.push(ref);return a;
      }
    }
  });
}
async function killOwner(f,run,a){
  assert.equal(processPresent(a.worker.pid),true);process.kill(run.pid,'SIGKILL');await until(()=>processPresent(run.pid)===false);
  const exit=await until(()=>readWorkerAttempt(a.reference).outcome);assert.equal(exit.state,'EXITED');assert.equal(exit.reason,'OWNER_LOST');assert.equal(exit.signal,'SIGKILL');
  await until(()=>processPresent(a.worker.pid)===false);return exit;
}
function recoveryInput(taskId,reportDigest){return {projectId:'demo',taskId,requestId:'recover-original',expectedReportDigest:reportDigest};}
async function installedRecovery(f,input){return JSON.parse(await execute(process.execPath,[cli,'task-reconcile','--installation',f.setup.root,'--project',input.projectId,'--task',input.taskId,'--request-id',input.requestId,'--expected-report',input.expectedReportDigest,'--json'],{cwd:base})).result;}

for(const kind of ['dl','shacl'])test('actual '+kind+' worker exits after managed owner death; compiled operator closes only the original incomplete task',async t=>{
  const f=fixture(t,'crash-'+kind),run=await f.start(),p=await seed(f);
  const started=await p.write(kind==='dl'?'reasoning.start':'validation.start',{assetId:'services',modelDigest:p.modelDigest,...(kind==='dl'?{task:{kind:'consistency'}}:{})},'original');
  const taskId=started.receipt.result.taskId,a=await active(f,taskId,kind,true);
  assert.throws(()=>inspectInstallationTaskRecovery(f.setup.root,'demo',taskId),{code:'INSTALLATION_RUNNING'});
  await killOwner(f,run,a);
  const inspected=JSON.parse(await execute(process.execPath,[cli,'task-recovery-inspect','--installation',f.setup.root,'--project','demo','--task',taskId,'--json'],{cwd:base})).result;
  assert.equal(inspected.report.ready,true);assert(inspected.report.attempts.length>0);assert.equal(inspected.report.formalResultRecovered,false);
  const input=recoveryInput(taskId,inspected.reportDigest),recovered=await installedRecovery(f,input);assert.equal(recovered.replayed,false);
  assert.deepEqual(reconcileInstallationTask(f.setup.root,input).receipt,recovered.receipt);
  assert.throws(()=>reconcileInstallationTask(f.setup.root,{...input,expectedReportDigest:hash('changed')}),{code:'REQUEST_CONFLICT'});
  await f.start();const operation=kind==='dl'?'reasoning.inspect':'validation.inspect',result=await f.http(f.request(operation,{taskId}));
  assert.equal(result.state,'FINISHED');assert.equal(result.complete,false);assert.equal(result.formalStatus,'FAILED');assert.equal(result.result.error.code,'OWNER_INTERRUPTED');
  const attemptCount=taskWorkerReferences(f.workRoot,taskId).length;assert.deepEqual(await f.http(started.request),started.receipt);assert.equal(taskWorkerReferences(f.workRoot,taskId).length,attemptCount);
  const next=await p.write('reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task:{kind:'consistency'}},'explicit-new-task');
  const completed=await until(async()=>{const r=await f.http(f.request('reasoning.inspect',{taskId:next.receipt.result.taskId}));return r.state==='FINISHED'&&r;});assert.equal(completed.formalStatus,'COMPLETED');
  if(kind==='dl'){
    await stopInstallation(f.setup.root);for(const r of f.attempts.map(ref=>readWorkerAttempt(ref)))for(const pid of [r.worker?.pid,r.supervisor?.pid].filter(Boolean))await until(()=>processPresent(pid)===false);
    const backupRoot=join(base,'recovered-task-backup'),report=inspectInstallationBackup(f.setup.root,backupRoot,'backup');
    const backed=backupInstallation(f.setup.root,{backupRoot,requestId:'backup',expectedReportDigest:report.reportDigest}),stageInput={backupRoot,expectedManifestDigest:backed.receipt.manifestDigest,stageRoot:join(base,'recovered-task-stage'),requestId:'stage'},stageReport=inspectRestoreStage(stageInput),staged=stageInstallationRestore(stageInput,stageReport.reportDigest);
    for(const path of [f.setup.root,f.setup.workspaceRoot])renameSync(path,path+'-lost');
    const restore={snapshot:{root:stageInput.stageRoot,manifestDigest:staged.receipt.manifestDigest},recoveryRoot:join(base,'recovered-task-restore'),requestId:'restore',rekeyExpiresAt:new Date(Date.now()+86400000).toISOString()},inspected=inspectLostRestore(restore),restored=activateLostRestore(restore,inspected.reportDigest);
    assert.deepEqual((await installedRecovery(f,input)).receipt,recovered.receipt);assert.throws(()=>reconcileInstallationTask(f.setup.root,{...input,requestId:'missing-before-restore'}),{code:'REQUEST_OUTCOME_UNKNOWN'});
    assert.throws(()=>reconcileInstallationTask(f.setup.root,{...input,taskId:'task-not-in-snapshot',requestId:restored.receipt.requestIdPrefix+'new'}),{code:'NOT_FOUND'});
    const freshRun=await f.start();assert.deepEqual(await f.http(f.request(operation,{taskId})),result);
    const project=await f.http(f.request('project.inspect')),fresh=await f.http({...f.request('reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task:{kind:'consistency'}}),requestId:restored.receipt.requestIdPrefix+'new-task',expectedRevision:project.revision}),freshTask=fresh.result.taskId,worker=await active(f,freshTask,'dl',true);await killOwner(f,freshRun,worker);
    const inspection=inspectInstallationTaskRecovery(f.setup.root,'demo',freshTask),freshInput={projectId:'demo',taskId:freshTask,requestId:restored.receipt.requestIdPrefix+'new-reconcile',expectedReportDigest:inspection.reportDigest};assert.equal(inspection.report.ready,true);const closed=await installedRecovery(f,freshInput);assert.equal(closed.replayed,false);assert.deepEqual(reconcileInstallationTask(f.setup.root,freshInput).receipt,closed.receipt);
  }
});

test('cold backup control cleanup preserves active, foreign, oversized and redirected lease evidence',()=>{
  const fixture=name=>{const root=join(base,'lease-'+name);mkdirSync(root,{mode:0o700});operatorLock(root)();return {root,path:join(root,'operator.sqlite'),journal:join(root,'operator.sqlite-journal')};};
  const busy=fixture('busy'),db=new DatabaseSync(busy.path);db.exec('BEGIN EXCLUSIVE;PRAGMA user_version=1');
  try{const before=readFileSync(busy.journal);assert.throws(()=>settleOperatorJournal(busy.root),{code:'INSTALLATION_BUSY'});assert.deepEqual(readFileSync(busy.journal),before);}finally{db.exec('ROLLBACK');db.close();}
  const foreign=fixture('foreign'),other=new DatabaseSync(foreign.path);other.exec('CREATE TABLE foreign_data(value TEXT)');other.close();writeFileSync(foreign.journal,Buffer.alloc(512),{mode:0o600});
  const before=readFileSync(foreign.path),journal=readFileSync(foreign.journal);assert.throws(()=>settleOperatorJournal(foreign.root),{code:'LEASE_EVIDENCE'});assert.deepEqual(readFileSync(foreign.path),before);assert.deepEqual(readFileSync(foreign.journal),journal);
  const large=fixture('large'),payload=Buffer.alloc(65537,83);writeFileSync(large.journal,payload,{mode:0o600});assert.throws(()=>settleOperatorJournal(large.root),{code:'LEASE_EVIDENCE'});assert.deepEqual(readFileSync(large.journal),payload);
  const redirected=fixture('redirected'),absent=join(base,'absent-journal');symlinkSync(absent,redirected.journal);assert.throws(()=>settleOperatorJournal(redirected.root),{code:'UNSAFE_PATH'});assert.equal(existsSync(absent),false);
});

test('missing or changed exit proof and stale inspection cannot clear an interrupted task',async t=>{
  const f=fixture(t,'missing-proof'),run=await f.start(),p=await seed(f),started=await p.write('reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task:{kind:'consistency'}},'original'),taskId=started.receipt.result.taskId,a=await active(f,taskId,'dl',true);await killOwner(f,run,a);
  // The committed outcome is visible before the supervisor finishes its final
  // journal read. Let that exact producer exit before corrupting its evidence.
  await until(()=>processPresent(a.supervisor.pid)===false);
  const db=new DatabaseSync(join(f.workRoot,'worker-journal.sqlite')),saved=db.prepare('SELECT outcome,outcome_digest FROM attempts WHERE id=?').get(a.reference.attemptId);
  try{
    db.prepare('UPDATE attempts SET outcome=NULL,outcome_digest=NULL WHERE id=?').run(a.reference.attemptId);
    const missing=inspectInstallationTaskRecovery(f.setup.root,'demo',taskId);assert.equal(missing.report.ready,false);assert(missing.report.blockers.includes('WORKER_EXIT_UNPROVEN'));
    assert.throws(()=>reconcileInstallationTask(f.setup.root,recoveryInput(taskId,missing.reportDigest)),{code:'TASK_RECOVERY_REQUIRED'});
    db.prepare('UPDATE attempts SET outcome=?,outcome_digest=? WHERE id=?').run(saved.outcome,hash('corrupt'),a.reference.attemptId);
    assert.equal(inspectInstallationTaskRecovery(f.setup.root,'demo',taskId).report.ready,false);
  }finally{try{db.prepare('UPDATE attempts SET outcome=?,outcome_digest=? WHERE id=?').run(saved.outcome,saved.outcome_digest,a.reference.attemptId);}finally{db.close();}}
  assert.throws(()=>reconcileInstallationTask(f.setup.root,recoveryInput(taskId,hash('stale'))),{code:'RECOVERY_CONFLICT'});
  const current=inspectInstallationTaskRecovery(f.setup.root,'demo',taskId);assert.equal(current.report.ready,true);assert.equal(current.report.state,'RUNNING');
  assert.throws(()=>inspectInstallationTaskRecovery(f.setup.root,'foreign',taskId),{code:'NOT_FOUND'});
  reconcileInstallationTask(f.setup.root,recoveryInput(taskId,current.reportDigest));
  const owner=new DatabaseSync(join(f.setup.workspaceRoot,'ontology.sqlite')),before=owner.prepare('SELECT result,result_digest FROM native_reasoning_tasks WHERE id=?').get(taskId);
  owner.prepare("UPDATE native_reasoning_tasks SET state='INTERRUPTED' WHERE id=?").run(taskId);
  try{assert.throws(()=>inspectInstallationTaskRecovery(f.setup.root,'demo',taskId),{code:'RECOVERY_EVIDENCE_INVALID'});assert.deepEqual(owner.prepare('SELECT result,result_digest FROM native_reasoning_tasks WHERE id=?').get(taskId),before);}
  finally{owner.prepare("UPDATE native_reasoning_tasks SET state='FINISHED' WHERE id=?").run(taskId);owner.close();}
});

test('actual supervisor loss retains an interruption barrier even when the unobserved worker later exits',async t=>{
  const f=fixture(t,'supervisor-loss');await f.start();const p=await seed(f),started=await p.write('reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task:{kind:'consistency'}},'original'),taskId=started.receipt.result.taskId,a=await active(f,taskId,'dl');
  f.unproven.add(a.reference.attemptId);assert.equal(processPresent(a.supervisor.pid),true);process.kill(a.supervisor.pid,'SIGKILL');
  const interrupted=await until(async()=>{const r=await f.http(f.request('reasoning.inspect',{taskId}));return r.state==='INTERRUPTED'&&r;});
  assert.equal(interrupted.result,null);assert.equal(interrupted.complete,false);
  await assert.rejects(p.write('reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task:{kind:'consistency'}},'forbidden-replacement'),{code:'REASONER_BUSY'});
  await stopInstallation(f.setup.root);await until(()=>processPresent(a.worker.pid)===false);
  const inspected=inspectInstallationTaskRecovery(f.setup.root,'demo',taskId);assert.equal(inspected.report.ready,false);assert(inspected.report.blockers.includes('WORKER_EXIT_UNPROVEN'));
  assert.throws(()=>reconcileInstallationTask(f.setup.root,recoveryInput(taskId,inspected.reportDigest)),{code:'TASK_RECOVERY_REQUIRED'});assert.equal(readWorkerAttempt(a.reference).outcome,null);
});

test('owner death before dispatch commit is fenced atomically and recovery resumes after an interrupted fence write',async t=>{
  const f=fixture(t,'pre-dispatch');await f.start();const p=await seed(f);await stopInstallation(f.setup.root);
  const request={...f.request('reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task:{kind:'consistency'}}),requestId:'original',expectedRevision:5};
  const module=pathToFileURL(join(runtime.packageRoot,'dist/standalone/service.js')).href;
  // Kill the isolated owner exactly while its WORKER_ATTEMPT event transaction
  // is uncommitted. The actual journal intent already exists; no worker is mocked.
  const code=`import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import {createStandaloneService} from ${JSON.stringify(module)};const o=JSON.parse(process.argv[1]);const prepare=DatabaseSync.prototype.prepare;DatabaseSync.prototype.prepare=function(sql){const s=prepare.call(this,sql);if(sql.startsWith('INSERT INTO native_reasoning_events')){const run=s.run.bind(s);s.run=(...a)=>{if(a[1]==='WORKER_ATTEMPT')process.exit(0);return run(...a);};}return s;};const s=createStandaloneService(o.options);console.log(JSON.stringify(s.request(o.request,readFileSync(o.credential,'utf8'))));`;
  const options={root:f.setup.workspaceRoot,workspaceId:f.setup.workspaceId,serviceId:f.setup.serviceId,reasoning:{toolchainFile:process.env.EVOPILOT_TEST_DL_TOOLCHAIN,workRoot:f.workRoot}};
  const receipt=JSON.parse(await execute(process.execPath,['--input-type=module','-e',code,JSON.stringify({options,request,credential:f.setup.credentialFile})],{cwd:base})),taskId=receipt.result.taskId;
  const refs=taskWorkerReferences(f.workRoot,taskId);assert.equal(refs.length,1);assert.equal(readWorkerAttempt(refs[0]).supervisor,null);assert.equal(readWorkerAttempt(refs[0]).outcome,null);
  const before=inspectInstallationTaskRecovery(f.setup.root,'demo',taskId);assert.equal(before.report.ready,true);assert.equal(before.report.attempts[0].resolution,'VERIFY_NO_LAUNCH_FENCE');
  sealWorkerNotStarted(refs[0]);assert.equal(inspectInstallationTaskRecovery(f.setup.root,'demo',taskId).reportDigest,before.reportDigest);
  const recovered=await installedRecovery(f,recoveryInput(taskId,before.reportDigest));assert.equal(recovered.replayed,false);
  assert.throws(()=>recordWorkerEvidence(refs[0],'supervisor',{pid:process.pid,recordedAt:new Date().toISOString()}),{code:'WORKER_EVIDENCE_CONFLICT'});
  const delayed=spawn(process.execPath,[join(runtime.packageRoot,'dist/installation/worker-supervisor.js'),JSON.stringify(refs[0])],{cwd:base,stdio:['pipe','ignore','ignore','ipc'],env:{NODE_NO_WARNINGS:'1'}});
  delayed.stdin.end();const exitCode=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{delayed.kill('SIGKILL');reject(Error('Delayed supervisor failed to refuse its fenced attempt'));},5000);delayed.once('close',code=>{clearTimeout(timer);resolve(code);});delayed.once('error',reject);});
  assert.equal(exitCode,1);assert.equal(readWorkerAttempt(refs[0]).supervisor,null);
  assert.equal(readWorkerAttempt(refs[0]).worker,null);
  await f.start();assert.deepEqual(await f.http(request),receipt);assert.equal((await f.http(f.request('reasoning.inspect',{taskId}))).formalStatus,'FAILED');
});
