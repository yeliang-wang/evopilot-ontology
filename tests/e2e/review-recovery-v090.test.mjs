import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,renameSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {prepare,terminal} from '../helpers/v090-validation.mjs';

// Actual installed product APIs, real Java/Python evidence and explicit synthetic
// reviewer credentials. These fixture decisions do not approve business assets.
const source=fileURLToPath(new URL('../..',import.meta.url)),api={};let base,runtime,cli;
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:60000,maxBuffer:4*1024*1024,...options},(e,out,err)=>e?reject(Error(out+'\n'+err)):resolve(out)));
before(async()=>{
  assert(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Actual installed formal tools required');
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-review-recovery-')));const runtimeRoot=join(base,'runtime');mkdirSync(runtimeRoot,{mode:0o700});
  const pack=JSON.parse(await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',base],{cwd:source}));await execute('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',runtimeRoot,join(base,pack[0].filename)],{cwd:base});
  const pkg=join(runtimeRoot,'node_modules/@evopilot-next/ontology');
  for(const name of ['installation/runtime','installation/manager','installation/backup','installation/restore-stage','installation/restore-state','installation/restore-lost','installation/restore-activate','installation/reviewer','standalone/service','standalone/validation'])Object.assign(api,await import(pathToFileURL(join(pkg,'dist',name+'.js')).href));
  runtime=api.inspectRuntime(runtimeRoot);cli=join(pkg,'dist/standalone/cli.js');
});
after(()=>{if(base)rmSync(base,{recursive:true,force:true});});
function fixture(t,name){
  const i=api.prepareInstallation({root:join(base,name+'-installation'),workspaceRoot:join(base,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot:runtime.root,runtimeDigest:runtime.digest,mode:'create'});
  const select=k=>({toolchainFile:process.env[k],toolchainDigest:JSON.parse(readFileSync(process.env[k])).digest});api.bindInstallationToolchains(i.root,{requestId:'tools',previousBindingDigest:null,dl:select('EVOPILOT_TEST_DL_TOOLCHAIN'),shacl:select('EVOPILOT_TEST_SHACL_TOOLCHAIN')});
  const f={i,root:i.workspaceRoot,setup:{...i,root:i.workspaceRoot},workRoot:join(i.root,'formal-work'),token:readFileSync(i.credentialFile,'utf8'),s:null,ordinal:0,restores:0,grants:0};
  f.read=(operation,input={})=>({workspaceId:i.workspaceId,serviceId:i.serviceId,projectId:'demo',operation,input});f.write=(operation,input,requestId,expectedRevision)=>({...f.read(operation,input),requestId,expectedRevision});t.after(()=>close(f));issue(f);return f;
}
const identity=f=>JSON.parse(readFileSync(join(f.root,'identity.json')));
const prefix=f=>identity(f).recovery?'r'+identity(f).recovery.generation+'.':'';
function open(f){assert.equal(f.s,null);f.s=api.createStandaloneService({...f.setup,reasoning:{toolchainFile:process.env.EVOPILOT_TEST_DL_TOOLCHAIN,workRoot:f.workRoot},validation:{toolchainFile:process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,workRoot:f.workRoot}});return f.s;}
async function close(f){if(f.s){await f.s.close();f.s=null;}}
const read=(f,operation,input={})=>f.s.request(f.read(operation,input),f.token);
const revision=f=>read(f,'project.inspect').revision;
function write(f,operation,input,suffix,token=f.token){const request=f.write(operation,input,prefix(f)+suffix,revision(f));return {request,receipt:f.s.request(request,token)};}
function issue(f){assert.equal(f.s,null);const grantId=prefix(f)+'reviewer-'+(++f.grants),grant=api.grantReviewer({...f.setup,projectId:'demo',principalId:'synthetic-reviewer',grantId,expiresAt:new Date(Date.now()+86400000).toISOString()});f.reviewer={grantId,token:readFileSync(grant.credentialFile,'utf8')};return f.reviewer;}
async function seed(f){
  open(f);f.model=prepare(f.s,f);const validation=write(f,'validation.start',{assetId:'services',modelDigest:f.model.modelDigest},'validate').receipt;assert.equal((await terminal(f.s,f,validation.result.taskId)).formalStatus,'MATCHED');
  const query=f.model.expectations.cases.find(c=>c.kind==='owl-entailment'&&c.expectedStatus==='ENTAILED').query,explanation=write(f,'reasoning.start',{assetId:'services',modelDigest:f.model.modelDigest,task:{kind:'explanation',target:'entailment',query}},'explain').receipt;
  let result;const deadline=Date.now()+30000;while(Date.now()<deadline){result=read(f,'reasoning.inspect',{taskId:explanation.result.taskId});if(result.state==='FINISHED')break;await new Promise(r=>setTimeout(r,20));}assert.equal(result.formalStatus,'COMPLETED');
  f.tasks={validationTaskId:validation.result.taskId,explanationTaskIds:[explanation.result.taskId]};return candidate(f,'1.0.0',null);
}
const candidate=(f,version,previousDeliveryDigest)=>write(f,'review.prepare',{assetId:'services',modelDigest:f.model.modelDigest,version,previousDeliveryDigest,...f.tasks},'candidate-'+version).receipt.result;
const decisionInput=(c,decision,previousDecisionDigest)=>({assetId:'services',candidateDigest:c.candidateDigest,reportDigest:c.reportDigest,previousDecisionDigest,decision,rationale:'Synthetic recovery fixture: explicit review of this exact candidate.',instruction:{reference:'urn:test:recovery-review',content:'Synthetic fixture only: '+decision+' this exact candidate and its declared requirements.'},requirementIds:decision==='APPROVE'?['r1','r2']:[]});
const decide=(f,c,suffix,parent=null,decision='APPROVE')=>write(f,'review.decide',decisionInput(c,decision,parent),suffix,f.reviewer.token);
const deliver=(f,c,d,suffix)=>write(f,'delivery.record',{assetId:'services',candidateDigest:c.candidateDigest,reviewDigest:d.receipt.result.reviewDigest},suffix);
const inspect=(f,c)=>read(f,'review.inspect',{assetId:'services',candidateDigest:c.candidateDigest});
function bundle(f,digest){let content='',offset=0;do{const p=read(f,'delivery.export.read',{assetId:'services',deliveryDigest:digest,offset,maxBytes:65536});content+=p.content;offset=p.nextOffset;}while(offset!==null);return content;}
function stage(f){
  assert.equal(f.s,null);const n=++f.ordinal,backupRoot=join(base,f.i.workspaceId+'-backup-'+n),requestId=prefix(f)+'backup-'+n,report=api.inspectInstallationBackup(f.i.root,backupRoot,requestId),backed=api.backupInstallation(f.i.root,{backupRoot,requestId,expectedReportDigest:report.reportDigest});
  const input={backupRoot,expectedManifestDigest:backed.receipt.manifestDigest,stageRoot:join(base,f.i.workspaceId+'-stage-'+n),requestId:'stage-'+n},r=api.inspectRestoreStage(input),done=api.stageInstallationRestore(input,r.reportDigest);return {root:input.stageRoot,manifestDigest:done.receipt.manifestDigest};
}
async function lost(f,snapshot){
  assert.equal(f.s,null);const n=++f.restores;for(const p of [f.i.root,f.root])renameSync(p,p+'-lost-'+n);
  const v={snapshot,recoveryRoot:join(base,f.i.workspaceId+'-lost-restore-'+n),requestId:'lost-'+n,rekeyExpiresAt:new Date(Date.now()+86400000).toISOString()},r=api.inspectLostRestore(v);
  const done=JSON.parse(await execute(process.execPath,[cli,'restore-lost-apply','--snapshot',snapshot.root,'--snapshot-manifest',snapshot.manifestDigest,'--recovery-root',v.recoveryRoot,'--request-id',v.requestId,'--rekey-expires-at',v.rekeyExpiresAt,'--expected-report',r.reportDigest,'--json'])).result;assert.equal(done.status,'ACTIVATED');f.token=readFileSync(f.i.credentialFile,'utf8');return done;
}
function retained(f,snapshot){assert.equal(f.s,null);const current=stage(f),n=++f.restores,v={installationRoot:f.i.root,snapshot,retained:current,recoveryRoot:join(base,f.i.workspaceId+'-current-restore-'+n),requestId:'current-'+n},r=api.inspectRestoreActivation(v),done=api.activateRestore(v,r.reportDigest);assert.equal(done.status,'ACTIVATED');return done;}
function denied(f,c,d,suffix){const before=revision(f);assert.throws(()=>deliver(f,c,d,suffix),{code:'REVIEW_RECOVERY_REQUIRED'});assert.equal(revision(f),before);assert.throws(()=>read(f,'receipt.read',{requestId:prefix(f)+suffix}),{code:'NOT_FOUND'});}

test('installed lost/current/lost recovery requires fresh review for new delivery and preserves exact historical deliveries',async t=>{
  const f=fixture(t,'chain'),first=await seed(f),a1=decide(f,first,'approve-1'),d1=deliver(f,first,a1,'deliver-1'),oldBundle=bundle(f,d1.receipt.result.deliveryDigest),second=candidate(f,'1.0.1',d1.receipt.result.deliveryDigest),a2=decide(f,second,'approve-2');await close(f);const snapshot=stage(f);
  open(f);decide(f,second,'later-lost-rejection',a2.receipt.result.reviewDigest,'REJECT');await close(f);const oldReviewer=f.reviewer.token;await lost(f,snapshot);const floor=identity(f).recovery.decisionAuditFloor;assert(Number.isSafeInteger(floor));open(f);
  assert.throws(()=>f.s.context(oldReviewer),{code:'UNAUTHENTICATED'});assert.deepEqual(f.s.request(d1.request,f.token),d1.receipt);assert.equal(bundle(f,d1.receipt.result.deliveryDigest),oldBundle);
  const stale=inspect(f,second);assert.equal(stale.decision.decision,'APPROVE');assert.equal(stale.status,'REVIEW_REQUIRED_AFTER_RECOVERY');assert.equal(stale.reviewRecovery.status,'UNCONFIRMED');assert.equal(stale.reviewRecovery.auditSequenceFloor,floor);
  assert.equal(read(f,'review.report.read',{assetId:'services',candidateDigest:second.candidateDigest,offset:0,maxBytes:4096}).reviewRecovery.reviewRequired,true);
  denied(f,second,a2,'old-approval-denied');assert.throws(()=>write(f,'review.decide',decisionInput(second,'APPROVE',a2.receipt.result.reviewDigest),'operator-cannot-approve'),{code:'FORBIDDEN'});await close(f);issue(f);open(f);
  assert.deepEqual(f.s.request(a2.request,f.reviewer.token),a2.receipt);denied(f,second,a2,'replay-is-not-reconfirmation');
  const fresh=decide(f,second,'reaffirm-2',a2.receipt.result.reviewDigest),confirmed=inspect(f,second);assert.equal(confirmed.reviewRecovery.status,'CONFIRMED');assert(confirmed.reviewRecovery.auditSequence>floor);await close(f);
  retained(f,snapshot);assert.equal(identity(f).recovery.decisionAuditFloor,floor);open(f);assert.equal(inspect(f,second).reviewRecovery.status,'CONFIRMED');const d2=deliver(f,second,fresh,'deliver-2'),third=candidate(f,'1.0.2',d2.receipt.result.deliveryDigest),a3=decide(f,third,'approve-3');await close(f);const secondSnapshot=stage(f);await lost(f,secondSnapshot);assert(identity(f).recovery.decisionAuditFloor>floor);open(f);
  assert.deepEqual(f.s.request(d2.request,f.token),d2.receipt);assert.equal(bundle(f,d1.receipt.result.deliveryDigest),oldBundle);assert.equal(read(f,'delivery.inspect',{assetId:'services',deliveryDigest:d2.receipt.result.deliveryDigest}).reviewRecovery.status,'UNCONFIRMED');denied(f,third,a3,'second-loss-denied');await close(f);issue(f);open(f);
  const rejected=decide(f,third,'reject-after-second-loss',a3.receipt.result.reviewDigest,'REJECT');assert.equal(inspect(f,third).reviewRecovery.status,'CONFIRMED');assert.throws(()=>deliver(f,third,rejected,'rejected-delivery'),{code:'REVIEW_REJECTED'});
  const approved=decide(f,third,'approve-after-rejection',rejected.receipt.result.reviewDigest);assert.equal(deliver(f,third,approved,'deliver-3').receipt.result.status,'DELIVERED');
});

test('retaining authoritative current state preserves a decision after its issuing credential is revoked',async t=>{
  const f=fixture(t,'retained'),c=await seed(f),approved=decide(f,c,'approve');await close(f);const snapshot=stage(f);api.revokeReviewer({...f.setup,grantId:f.reviewer.grantId});retained(f,snapshot);assert.equal(identity(f).recovery.decisionAuditFloor,null);open(f);
  assert.throws(()=>f.s.context(f.reviewer.token),{code:'UNAUTHENTICATED'});assert.equal(inspect(f,c).reviewRecovery.status,'NOT_REQUIRED');assert.equal(deliver(f,c,approved,'delivery').receipt.result.status,'DELIVERED');
});

test('snapshot-only review and delivery heads cannot replace absent authoritative current heads',async t=>{
  const f=fixture(t,'heads'),c=await seed(f);await close(f);const early=stage(f);open(f);const approved=decide(f,c,'later-approve'),delivered=deliver(f,c,approved,'later-delivery'),original=bundle(f,delivered.receipt.result.deliveryDigest);await close(f);const future=stage(f);
  await lost(f,early);retained(f,future);open(f);const v=inspect(f,c);assert.equal(v.reviewDigest,null);assert.equal(v.status,'AWAITING_DECISION');assert.equal(v.reviewRecovery.status,'NO_DECISION');
  const historical=read(f,'delivery.inspect',{assetId:'services',deliveryDigest:delivered.receipt.result.deliveryDigest});assert.equal(historical.isLatestDelivery,false);assert.equal(historical.currentDecisionMatches,false);assert.equal(bundle(f,delivered.receipt.result.deliveryDigest),original);assert.deepEqual(f.s.request(delivered.request,f.token),delivered.receipt);assert.throws(()=>deliver(f,c,approved,'must-not-select-snapshot-head'),{code:'STALE_REVIEW'});
});

test('legacy recovered identities fail closed, permit a real current-generation review and gain a fixed floor on the next restore',async t=>{
  const f=fixture(t,'legacy'),c=await seed(f),approved=decide(f,c,'old-approve');await close(f);const snapshot=stage(f);await lost(f,snapshot);
  // Explicit legacy-format fixture: keep the file and SQLite identity identical.
  const v=identity(f);delete v.recovery.decisionAuditFloor;const raw=JSON.stringify(v)+'\n';writeFileSync(join(f.root,'identity.json'),raw);const db=new DatabaseSync(join(f.root,'ontology.sqlite'));db.prepare('UPDATE workspace SET identity=?').run(raw);db.close();
  open(f);assert.equal(f.s.context(f.token).recovery.decisionFreshnessPolicy,'CURRENT_RECOVERY_REVIEW_REQUIRED');denied(f,c,approved,'legacy-old-denied');await close(f);issue(f);open(f);const fresh=decide(f,c,'legacy-fresh',approved.receipt.result.reviewDigest);assert.equal(inspect(f,c).reviewRecovery.status,'CONFIRMED');await close(f);open(f);assert.equal(inspect(f,c).reviewRecovery.status,'CONFIRMED');await close(f);
  retained(f,snapshot);assert(Number.isSafeInteger(identity(f).recovery.decisionAuditFloor));open(f);denied(f,c,fresh,'legacy-boundary-not-guessed');const reaffirmed=decide(f,c,'after-fixed-floor',fresh.receipt.result.reviewDigest);assert.equal(deliver(f,c,reaffirmed,'delivery').receipt.result.status,'DELIVERED');
});

test('missing, duplicate or mismatched reviewer audit/receipt evidence cannot authorize recovered delivery',async t=>{
  const f=fixture(t,'proof'),c=await seed(f),approved=decide(f,c,'old-approve');await close(f);const snapshot=stage(f);await lost(f,snapshot);issue(f);open(f);const fresh=decide(f,c,'fresh',approved.receipt.result.reviewDigest);assert.equal(inspect(f,c).reviewRecovery.status,'CONFIRMED');await close(f);
  const file=join(f.root,'ontology.sqlite'),original=new DatabaseSync(file),audit={...original.prepare('SELECT * FROM audit WHERE request_id=?').get(fresh.request.requestId)},receipt={...original.prepare('SELECT * FROM receipts WHERE request_id=?').get(fresh.request.requestId)};original.close();
  for(const fault of ['missing','duplicate','wrong-audit-digest','coherent-foreign-receipt']){
    let extra=null;const db=new DatabaseSync(file);
    if(fault==='missing')db.prepare('DELETE FROM audit WHERE sequence=?').run(audit.sequence);
    else if(fault==='duplicate'){const fields=Object.keys(audit).filter(k=>k!=='sequence');extra=db.prepare('INSERT INTO audit('+fields.join(',')+') VALUES('+fields.map(()=>'?').join(',')+')').run(...fields.map(k=>audit[k])).lastInsertRowid;}
    else if(fault==='wrong-audit-digest')db.prepare('UPDATE audit SET receipt_digest=? WHERE sequence=?').run(api.hash('foreign'),audit.sequence);
    else{const altered=JSON.parse(receipt.receipt);altered.workspaceId='another-workspace';const raw=api.canonical(altered);db.prepare('UPDATE receipts SET receipt=? WHERE request_id=?').run(raw,fresh.request.requestId);db.prepare('UPDATE audit SET receipt_digest=? WHERE sequence=?').run(api.hashBytes(raw),audit.sequence);}
    db.close();
    try{open(f);assert.equal(inspect(f,c).reviewRecovery.status,'UNCONFIRMED',fault);denied(f,c,fresh,'refuse-'+fault);}
    finally{await close(f);const repair=new DatabaseSync(file);if(extra!==null)repair.prepare('DELETE FROM audit WHERE sequence=?').run(extra);repair.prepare('DELETE FROM audit WHERE sequence=?').run(audit.sequence);const fields=Object.keys(audit);repair.prepare('INSERT INTO audit('+fields.join(',')+') VALUES('+fields.map(()=>'?').join(',')+')').run(...fields.map(k=>audit[k]));repair.prepare('UPDATE receipts SET digest=?,receipt=? WHERE request_id=?').run(receipt.digest,receipt.receipt,fresh.request.requestId);repair.close();}
  }
  api.revokeReviewer({...f.setup,grantId:f.reviewer.grantId});open(f);assert.equal(inspect(f,c).reviewRecovery.status,'CONFIRMED');assert.equal(deliver(f,c,fresh,'delivery-with-original-decision').receipt.result.status,'DELIVERED');
  await close(f);
  // A self-consistent backup of an invalid identity must fail before a recovery
  // candidate is admitted, rather than silently lowering its decision boundary.
  const changed=new DatabaseSync(file),v=identity(f);v.recovery.decisionAuditFloor=Number(changed.prepare('SELECT max(sequence) AS n FROM audit').get().n)+1;const raw=JSON.stringify(v)+'\n';writeFileSync(join(f.root,'identity.json'),raw);changed.prepare('UPDATE workspace SET identity=?').run(raw);changed.close();
  const invalid=stage(f),root=join(base,'invalid-decision-floor');assert.throws(()=>api.inspectRestoreState({snapshot:invalid,retained:null,root,requestId:'invalid-floor',generation:api.newRestoreGeneration(),rekeyExpiresAt:new Date(Date.now()+86400000).toISOString()}),{code:'RESTORE_STATE'});assert.equal(existsSync(root),false);
});
