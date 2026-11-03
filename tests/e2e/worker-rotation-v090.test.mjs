import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync,symlinkSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {inspectRuntime} from '../../dist/installation/runtime.js';
import {prepareInstallation,bindInstallationToolchains,startInstallation} from '../../dist/installation/manager.js';
import {inspectInstallationWorkerRotation,rotateInstallationWorkerJournal} from '../../dist/installation/worker-rotation.js';
import {readArchiveCatalog,writeArchiveCatalog,rotationRequestDigest,ARCHIVE_CATALOG,ARCHIVE_LIMIT} from '../../dist/installation/worker-archives.js';
import {createWorkerAttempt,readWorkerAttempt,sealWorkerNotStarted,recordWorkerEvidence,taskWorkerReferences} from '../../dist/installation/worker-journal.js';
import {writePrivate} from '../../dist/installation/files.js';
import {hash,hashBytes} from '../../dist/standalone/validation.js';

const source=fileURLToPath(new URL('../..',import.meta.url));
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:45000,maxBuffer:2*1024*1024,...options},(e,out,err)=>e?reject(Error('Command failed '+e.code+' signal '+e.signal+' '+out+'\n'+err)):resolve(out)));
let base,runtime,runtimeRoot,cli;
before(async()=>{
  assert(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Actual managed tool bindings required');
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-worker-rotation-')));runtimeRoot=join(base,'runtime');mkdirSync(runtimeRoot,{mode:0o700});
  const pack=JSON.parse(await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',base],{cwd:source}));
  await execute('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',runtimeRoot,join(base,pack[0].filename)],{cwd:base});
  runtime=inspectRuntime(runtimeRoot);cli=join(runtime.packageRoot,'dist/standalone/cli.js');
});
after(()=>{if(base)rmSync(base,{recursive:true,force:true});});
const plan=requestId=>({schema:'ontology-owned-worker/v1',requestId,requestDigest:hash(requestId),configurationDigest:hash('config'),toolchainDigest:hash('tool'),executable:process.execPath,args:[],env:{},stdinDigest:hashBytes('x'),stdinBytes:1,timeoutMs:100,outputBytes:100,diagnosticBytes:100});
function fixture(name){
  const setup=prepareInstallation({root:join(base,name+'-installation'),workspaceRoot:join(base,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot,runtimeDigest:runtime.digest,mode:'create'});
  const selection=k=>({toolchainFile:process.env[k],toolchainDigest:JSON.parse(readFileSync(process.env[k])).digest});
  const input={requestId:'bind',previousBindingDigest:null,dl:selection('EVOPILOT_TEST_DL_TOOLCHAIN'),shacl:selection('EVOPILOT_TEST_SHACL_TOOLCHAIN')},binding=bindInstallationToolchains(setup.root,input);
  return {setup,input,binding,root:join(setup.root,'formal-work')};
}
const closed=(root,taskId)=>{const r=createWorkerAttempt(root,plan(taskId));sealWorkerNotStarted(r);return r;};
const apply=async(f,requestId,reportDigest)=>JSON.parse(await execute(process.execPath,[cli,'worker-rotation-apply','--installation',f.setup.root,'--request-id',requestId,'--expected-report',reportDigest,'--json'])).result;

test('installed rotation crosses the 4096-attempt boundary, preserves exact history and refuses archive mutation or missing inventory',async()=>{
  const f=fixture('boundary'),r=closed(f.root,'old-task'),before=readWorkerAttempt(r),file=join(f.root,'worker-journal.sqlite');
  // Synthetic closed history reaches the actual production count limit without
  // launching thousands of processes. Rotation/lookup use installed product code.
  const db=new DatabaseSync(file),row=db.prepare('SELECT * FROM attempts').get();
  db.exec('BEGIN IMMEDIATE');for(let n=1;n<4096;n++){const intent=plan('fixture-'+n);db.prepare('INSERT INTO attempts(id,intent,intent_digest,outcome,outcome_digest) VALUES(?,?,?,?,?)').run(randomUUID(),JSON.stringify(intent),hash(intent),row.outcome,row.outcome_digest);}db.exec('COMMIT');db.close();
  assert.throws(()=>createWorkerAttempt(f.root,plan('over-limit')),e=>e.code==='WORKER_JOURNAL_LIMIT');
  const inspected=await inspectInstallationWorkerRotation(f.setup.root);assert.equal(inspected.report.attempts,4096);const original=readFileSync(file);
  const first=await apply(f,'rotate-1',inspected.reportDigest);assert.equal(first.replayed,false);
  assert.deepEqual(readWorkerAttempt(r),before);assert.deepEqual(taskWorkerReferences(f.root,'old-task'),[r]);assert.deepEqual(readFileSync(file),original);
  assert.throws(()=>recordWorkerEvidence(r,'supervisor',{pid:process.pid,recordedAt:new Date().toISOString()}),e=>e.code==='WORKER_JOURNAL_ARCHIVED');
  const next=closed(f.root,'new-task');assert.notEqual(next.journalId,r.journalId);
  assert.equal((await inspectInstallationWorkerRotation(f.setup.root,'rotate-1')).receipt.archiveDigest,hashBytes(original));
  assert.deepEqual((await apply(f,'rotate-1',inspected.reportDigest)).receipt,first.receipt);
  await assert.rejects(rotateInstallationWorkerJournal(f.setup.root,{requestId:'rotate-1',expectedReportDigest:hash('changed')}),e=>e.code==='REQUEST_CONFLICT');
  const activeFile=join(f.root,readArchiveCatalog(f.root).current.file),heldActive=join(f.root,'held-active'),foreign=join(f.root,'foreign-missing');
  symlinkSync(foreign,activeFile+'-journal');assert.throws(()=>createWorkerAttempt(f.root,plan('unsafe-sidecar')),e=>e.code==='UNSAFE_PATH');assert.equal(existsSync(foreign),false);unlinkSync(activeFile+'-journal');
  symlinkSync(foreign,file+'-journal');assert.throws(()=>readWorkerAttempt(r),e=>e.code==='WORKER_ARCHIVE_EVIDENCE');assert.equal(existsSync(foreign),false);unlinkSync(file+'-journal');
  const retainedCatalog=readFileSync(join(f.root,ARCHIVE_CATALOG)),oversized=structuredClone(readArchiveCatalog(f.root));oversized.archives[0].plan.workRoot='x'.repeat(128*1024);
  assert.throws(()=>writeArchiveCatalog(f.root,oversized,true),e=>e.code==='WORKER_ARCHIVE_LIMIT');assert.deepEqual(readFileSync(join(f.root,ARCHIVE_CATALOG)),retainedCatalog);
  renameSync(activeFile,heldActive);
  assert.throws(()=>createWorkerAttempt(f.root,plan('missing-current')),e=>e.code==='WORKER_EVIDENCE_MISSING');renameSync(heldActive,activeFile);
  const catalog=join(f.root,ARCHIVE_CATALOG),saved=join(f.root,'saved-catalog');renameSync(catalog,saved);
  assert.throws(()=>createWorkerAttempt(f.root,plan('missing-catalog')),e=>e.code==='WORKER_ARCHIVE_EVIDENCE');renameSync(saved,catalog);
  const other=join(f.root,'saved-journal');renameSync(file,other);writeFileSync(file,original,{mode:0o600});
  assert.throws(()=>readWorkerAttempt(r),e=>e.code==='WORKER_ARCHIVE_EVIDENCE');unlinkSync(file);symlinkSync(other,file);assert.throws(()=>readWorkerAttempt(r),e=>e.code==='UNSAFE_PATH');unlinkSync(file);renameSync(other,file);
  const changed=Buffer.from(original);changed[changed.length-1]^=1;writeFileSync(file,changed);assert.throws(()=>readWorkerAttempt(r),e=>e.code==='WORKER_ARCHIVE_EVIDENCE');writeFileSync(file,original);
  for(let n=2;n<=ARCHIVE_LIMIT;n++){
    const report=await inspectInstallationWorkerRotation(f.setup.root);await rotateInstallationWorkerJournal(f.setup.root,{requestId:'rotate-'+n,expectedReportDigest:report.reportDigest});closed(f.root,'generation-'+n);
  }
  await assert.rejects(inspectInstallationWorkerRotation(f.setup.root),e=>e.code==='WORKER_ARCHIVE_LIMIT');
  assert.deepEqual((await apply(f,'rotate-1',inspected.reportDigest)).receipt,first.receipt);assert.deepEqual(readWorkerAttempt(r),before);assert.equal(readArchiveCatalog(f.root).archives.length,ARCHIVE_LIMIT);
});

test('pending rotation and an interrupted empty successor resume the original request while blocking admission, startup and rebinding',async()=>{
  const f=fixture('pending'),r=closed(f.root,'task'),inspected=await inspectInstallationWorkerRotation(f.setup.root),journalId=randomUUID(),next={journalId,file:'worker-journal-'+journalId+'.sqlite'};
  // Explicit crash-state fixture: persisted intent and created-but-uninitialized
  // successor. Actual process-kill coverage lives in the Linux installed collector.
  const pending={requestId:'rotate',requestDigest:rotationRequestDigest(inspected.report),plan:inspected.report,planDigest:inspected.reportDigest,next,receipt:null};
  writePrivate(join(f.root,ARCHIVE_CATALOG),{schema:'ontology-worker-archives/v1',root:f.root,current:{journalId:r.journalId,file:'worker-journal.sqlite'},archives:[],pending});
  writeFileSync(join(f.root,next.file),'',{mode:0o600,flag:'wx'});
  assert.equal((await inspectInstallationWorkerRotation(f.setup.root)).status,'PENDING');
  assert.throws(()=>createWorkerAttempt(f.root,plan('blocked')),e=>e.code==='WORKER_ROTATION_PENDING');
  await assert.rejects(startInstallation(f.setup.root),e=>e.code==='WORKER_ROTATION_PENDING');
  assert.throws(()=>bindInstallationToolchains(f.setup.root,{...f.input,requestId:'rebind',previousBindingDigest:f.binding.receipt.digest}),e=>e.code==='WORKER_ROTATION_PENDING');
  await assert.rejects(rotateInstallationWorkerJournal(f.setup.root,{requestId:'another',expectedReportDigest:inspected.reportDigest}),e=>e.code==='WORKER_ROTATION_PENDING');
  const result=await apply(f,'rotate',inspected.reportDigest);assert.equal(result.receipt.activeJournalId,next.journalId);assert.equal(result.replayed,false);
  assert.equal((await apply(f,'rotate',inspected.reportDigest)).replayed,true);assert.equal(closed(f.root,'after').journalId,next.journalId);assert.equal(readWorkerAttempt(r).outcome.state,'NOT_STARTED');
});

test('a nearly full SQLite journal can retain closure but refuses another launch before consuming its reserved headroom',async()=>{
  const f=fixture('headroom');assert.equal((await inspectInstallationWorkerRotation(f.setup.root)).status,'NOT_NEEDED');
  const foreign=join(f.root,'unwritten');symlinkSync(foreign,join(f.root,'worker-journal.sqlite'));
  await assert.rejects(inspectInstallationWorkerRotation(f.setup.root),e=>e.code==='UNSAFE_PATH');assert.equal(existsSync(foreign),false);unlinkSync(join(f.root,'worker-journal.sqlite'));
  const r=createWorkerAttempt(f.root,plan('pending-task'));
  await assert.rejects(inspectInstallationWorkerRotation(f.setup.root),e=>e.code==='WORKER_EXIT_UNPROVEN');
  const db=new DatabaseSync(join(f.root,'worker-journal.sqlite'));db.exec('CREATE TABLE synthetic_padding(value BLOB); INSERT INTO synthetic_padding VALUES(zeroblob(66060288));');db.close();
  sealWorkerNotStarted(r);assert.equal(readWorkerAttempt(r).outcome.state,'NOT_STARTED');
  assert.throws(()=>createWorkerAttempt(f.root,plan('capacity-refused')),e=>e.code==='WORKER_JOURNAL_LIMIT');
  assert.deepEqual(taskWorkerReferences(f.root,'capacity-refused'),[]);
  const inspected=await inspectInstallationWorkerRotation(f.setup.root);await rotateInstallationWorkerJournal(f.setup.root,{requestId:'rotate-full',expectedReportDigest:inspected.reportDigest});
  assert.notEqual(closed(f.root,'after-capacity-rotation').journalId,r.journalId);assert.equal(readWorkerAttempt(r).outcome.state,'NOT_STARTED');
});
