import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,unlinkSync,rmSync,existsSync,renameSync,openSync,writeSync,closeSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile,spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {inspectRuntime} from '../../dist/installation/runtime.js';
import {prepareInstallation,bindInstallationToolchains} from '../../dist/installation/manager.js';
import {inspectInstallationBackup,backupInstallation} from '../../dist/installation/backup.js';
import {inspectRestoreStage,stageInstallationRestore} from '../../dist/installation/restore-stage.js';
import {inspectRestoreState,prepareRestoreState,verifyPreparedRestoreState,newRestoreGeneration} from '../../dist/installation/restore-state.js';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {openWorkspace,RESTORE_STAGE_BARRIER} from '../../dist/standalone/workspace.js';
import {grantReviewer,revokeReviewer} from '../../dist/installation/reviewer.js';
import {hash,hashBytes} from '../../dist/standalone/validation.js';
import {definition,prepare as prepareModel} from '../helpers/v090-native.mjs';
import {prepare as prepareValidation,terminal} from '../helpers/v090-validation.mjs';

const source=fileURLToPath(new URL('../..',import.meta.url));
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:60000,maxBuffer:8*1024*1024,...options},(e,out,err)=>e?reject(Error(out+'\n'+err)):resolve(out)));
let base,runtime,runtimeRoot;
before(async()=>{base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-restore-state-')));runtimeRoot=join(base,'runtime');mkdirSync(runtimeRoot,{mode:0o700});const pack=JSON.parse(await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',base],{cwd:source}));await execute('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',runtimeRoot,join(base,pack[0].filename)],{cwd:base});runtime=inspectRuntime(runtimeRoot);});
after(()=>{if(base)rmSync(base,{recursive:true,force:true});});
function fixture(name){
  const i=prepareInstallation({root:join(base,name+'-installation'),workspaceRoot:join(base,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot,runtimeDigest:runtime.digest,mode:'create'}),token=readFileSync(i.credentialFile,'utf8');
  const read=(operation,input={})=>({workspaceId:i.workspaceId,serviceId:i.serviceId,projectId:'demo',operation,input}),write=(operation,input,requestId,expectedRevision)=>({...read(operation,input),requestId,expectedRevision});
  return {i,root:i.workspaceRoot,setup:{...i,root:i.workspaceRoot},workRoot:join(i.root,'formal-work'),token,read,write,ordinal:0};
}
function stage(f){const n=++f.ordinal,backupRoot=join(base,f.i.workspaceId+'-backup-'+n),r=inspectInstallationBackup(f.i.root,backupRoot,'backup-'+n),b=backupInstallation(f.i.root,{backupRoot,requestId:'backup-'+n,expectedReportDigest:r.reportDigest});const input={backupRoot,expectedManifestDigest:b.receipt.manifestDigest,stageRoot:join(base,f.i.workspaceId+'-stage-'+n),requestId:'stage-'+n},inspected=inspectRestoreStage(input),done=stageInstallationRestore(input,inspected.reportDigest);return {root:input.stageRoot,manifestDigest:done.receipt.manifestDigest};}
function selection(f,snapshot,retained,name='prepared'){return {snapshot,retained,root:join(base,f.i.workspaceId+'-'+name),requestId:name,generation:newRestoreGeneration(),rekeyExpiresAt:retained?null:new Date(Date.now()+86400000).toISOString()};}
function prepared(input){const inspected=inspectRestoreState(input),done=prepareRestoreState(input,inspected.reportDigest);assert.equal(verifyPreparedRestoreState(input.root,done.receipt.manifestDigest).status,'VERIFIED');return {inspected,done,root:join(input.root,'workspace')};}
// Explicit service-level activation fixture. The product still keeps this
// barrier: these tests do not attest an installed owner/filesystem activation.
function serviceFixture(f,p,configuration={}){assert.throws(()=>openWorkspace(p.root,f.i),{code:'RESTORE_STAGED'});unlinkSync(join(p.root,RESTORE_STAGE_BARRIER));return createStandaloneService({...f.setup,root:p.root,...configuration});}
const revision=(s,f)=>s.request(f.read('project.inspect'),f.token).revision;
const write=(s,f,operation,input,id,token=f.token)=>s.request(f.write(operation,input,id,revision(s,f)),token);
function reviewer(f){const input={...f.setup,projectId:'demo',principalId:'reviewer',grantId:'reviewer',expiresAt:new Date(Date.now()+86400000).toISOString()};return {input,token:readFileSync(grantReviewer(input).credentialFile,'utf8')};}

test('reconciled drafts retain newer immutable models/receipts and current revocations while older missing requests stay unknown',async()=>{
  const f=fixture('history'),review=reviewer(f);let s=createStandaloneService(f.setup);const old=prepareModel(s,f);await s.close();const snapshot=stage(f);
  s=createStandaloneService(f.setup);const next=structuredClone(old.model);next.previousDigest=old.modelDigest;next.label='Newer model kept as immutable history';const req=f.write('model.record',{draft:next},'newer',4),receipt=s.request(req,f.token);await s.close();revokeReviewer({...f.setup,grantId:'reviewer'});const retained=stage(f);
  const originalDB=hashBytes(readFileSync(join(f.root,'ontology.sqlite'))),credentials=readFileSync(join(f.root,'credentials.json')),input=selection(f,snapshot,retained),p=prepared(input);
  assert.deepEqual(readFileSync(join(p.root,'credentials.json')),credentials);assert.equal(p.done.receipt.credentialPolicy,'CURRENT');s=serviceFixture(f,p);
  try{
    const context=s.context(f.token),prefix=context.recovery.requestIdPrefix;assert.equal(context.recovery.missingOlderReceipts,'UNKNOWN');assert.equal(revision(s,f),6);
    assert.equal(s.request(f.read('model.inspect',{assetId:'services',modelDigest:null}),f.token).modelDigest,old.modelDigest);
    assert.equal(s.request(f.read('model.inspect',{assetId:'services',modelDigest:receipt.result.modelDigest}),f.token).current,false);assert.deepEqual(s.request(req,f.token),receipt);
    assert.throws(()=>s.request({...req,input:{draft:old.model}},f.token),{code:'REQUEST_CONFLICT'});
    assert.throws(()=>s.request({...req,requestId:'outcome-not-in-either-snapshot',expectedRevision:6},f.token),{code:'REQUEST_OUTCOME_UNKNOWN'});
    assert.throws(()=>s.request(f.read('receipt.read',{requestId:'outcome-not-in-either-snapshot'}),f.token),{code:'REQUEST_OUTCOME_UNKNOWN'});
    assert.throws(()=>s.request(f.read('receipt.read',{requestId:prefix+'never-admitted'}),f.token),{code:'NOT_FOUND'});
    assert.throws(()=>s.request(f.read('receipt.read',{requestId:'newer'}),review.token),{code:'UNAUTHENTICATED'});assert.equal(revision(s,f),6);
    const copy=s.identity();copy.recovery.generation='0'.repeat(32);assert.equal(s.context(f.token).recovery.requestIdPrefix,prefix);
    const fresh=structuredClone(old.model);fresh.previousDigest=old.modelDigest;fresh.label='Fresh post-recovery authoring';const created=write(s,f,'model.record',{draft:fresh},prefix+'new-model');assert.equal(created.revision,7);assert.equal(created.requestId,prefix+'new-model');
    assert.equal(hashBytes(readFileSync(join(f.root,'ontology.sqlite'))),originalDB);assert.deepEqual(readFileSync(join(f.root,'credentials.json')),credentials);
  }finally{await s.close();}
});

test('lost-owner preparation retires old tokens, keeps revoked reviewer issuance and creates a bounded non-review operator credential',async()=>{
  const f=fixture('lost'),review=reviewer(f),s=createStandaloneService(f.setup);prepareModel(s,f);await s.close();const snapshot=stage(f),input=selection(f,snapshot,null),p=prepared(input),token=readFileSync(join(p.root,'operator-token'),'utf8');
  assert.notEqual(token,f.token);assert.equal(JSON.stringify(p.done).includes(token),false);assert.equal(p.done.receipt.credentialPolicy,'REKEY_LOST_OWNER');
  const creds=JSON.parse(readFileSync(join(p.root,'credentials.json')));assert.equal(creds.grants.find(g=>g.id==='reviewer').revoked,true);const fresh=creds.grants.find(g=>!g.revoked);assert.deepEqual(fresh.permissions,['read','write']);assert.deepEqual(fresh.projectIds,['demo']);assert.equal(fresh.expiresAt,input.rekeyExpiresAt);
  const restored=serviceFixture(f,p);try{assert.throws(()=>restored.context(f.token),{code:'UNAUTHENTICATED'});assert.throws(()=>restored.context(review.token),{code:'UNAUTHENTICATED'});assert.equal(restored.context(token).writeOperations.includes('review.decide'),false);}finally{await restored.close();}
  assert.throws(()=>grantReviewer({...review.input,root:p.root}),{code:'GRANT_CONFLICT'});
});

test('ambiguous immutable histories, owner mismatches and unknown schemas fail before admitting a new candidate',async()=>{
  const f=fixture('conflict'),s=createStandaloneService(f.setup);prepareModel(s,f);await s.close();const snapshot=stage(f);
  const db=new DatabaseSync(join(f.root,'ontology.sqlite'));db.prepare('UPDATE receipts SET receipt=? WHERE request_id=?').run('{"corrupted":"retained"}','model');db.close();const changed=stage(f),input=selection(f,snapshot,changed);
  assert.throws(()=>inspectRestoreState(input),{code:'RESTORE_HISTORY_CONFLICT'});assert.equal(existsSync(input.root),false);
  const g=fixture('foreign');const foreign=stage(g);assert.throws(()=>inspectRestoreState(selection(f,snapshot,foreign,'foreign-prepared')),{code:'RESTORE_OWNER_CONFLICT'});
  const altered=new DatabaseSync(join(g.root,'ontology.sqlite'));altered.exec('CREATE TABLE unexpected(value TEXT)');altered.close();const unknown=stage(g);assert.throws(()=>inspectRestoreState(selection(g,unknown,null)),{code:'RESTORE_STATE'});
});

test('a generation already used in retained receipts is rejected; current expired credentials remain expired',async()=>{
  const f=fixture('namespace'),generation=newRestoreGeneration(),s=createStandaloneService(f.setup);s.request(f.write('project.create',{label:'Namespace collision fixture'},'r'+generation+'.prior',0),f.token);await s.close();const snapshot=stage(f),input={...selection(f,snapshot,null),generation};
  assert.throws(()=>inspectRestoreState(input),{code:'RESTORE_GENERATION_CONFLICT'});assert.equal(existsSync(input.root),false);
  const file=join(f.root,'credentials.json'),creds=JSON.parse(readFileSync(file));creds.grants[0].expiresAt='2000-01-01T00:00:00.000Z';writeFileSync(file,JSON.stringify(creds));const retained=stage(f),p=prepared(selection(f,snapshot,retained,'expired'));
  const restored=serviceFixture(f,p);try{assert.throws(()=>restored.context(f.token),{code:'UNAUTHENTICATED'});}finally{await restored.close();}
});

test('missing old reviewer issuance outcomes cannot revive authority; a genuinely new namespaced grant remains available',async()=>{
  const f=fixture('issuance'),review=reviewer(f),file=join(f.root,'credentials.json'),credentials=JSON.parse(readFileSync(file));
  // Explicit unfinished-issuance fixture: metadata exists, credential admission
  // did not commit. This is not a real reviewer decision or Host acceptance.
  credentials.grants=credentials.grants.filter(g=>g.id!=='reviewer');writeFileSync(file,JSON.stringify(credentials));const snapshot=stage(f),input=selection(f,snapshot,null),p=prepared(input),token=readFileSync(join(p.root,'operator-token'),'utf8'),s=serviceFixture(f,p),prefix=s.context(token).recovery.requestIdPrefix;await s.close();
  assert.throws(()=>grantReviewer({...review.input,root:p.root}),{code:'REQUEST_OUTCOME_UNKNOWN'});assert.throws(()=>grantReviewer({...review.input,root:p.root,grantId:'another-old-missing-id'}),{code:'REQUEST_OUTCOME_UNKNOWN'});
  const granted=grantReviewer({...review.input,root:p.root,grantId:prefix+'new-reviewer'});assert.equal(granted.grantId,prefix+'new-reviewer');assert.notEqual(readFileSync(granted.credentialFile,'utf8'),review.token);
});

test('a second recovery preserves first-generation receipts and makes missing earlier-generation outcomes unknown',async()=>{
  const f=fixture('repeat');let s=createStandaloneService(f.setup);const model=prepareModel(s,f);await s.close();const snapshot=stage(f),firstInput=selection(f,snapshot,snapshot,'first'),first=prepared(firstInput);s=serviceFixture(f,first);const prefix=s.context(f.token).recovery.requestIdPrefix,request=f.write('intent.record',{definition:{...definition,scope:'Later retained purpose'},previousDigest:model.intentDigest},prefix+'later',5),known=s.request(request,f.token);await s.close();
  // Explicit same-path activation fixture solely for exercising a v2 identity
  // through a second genuine backup/staging/state reconciliation pipeline.
  renameSync(f.root,join(base,'repeat-before-fixture-activation'));renameSync(first.root,f.root);const retained=stage(f),secondInput=selection(f,snapshot,retained,'second');
  assert.throws(()=>inspectRestoreState({...secondInput,generation:firstInput.generation}),{code:'RESTORE_GENERATION_CONFLICT'});
  const second=prepared(secondInput);s=serviceFixture(f,second);try{assert.notEqual(s.context(f.token).recovery.requestIdPrefix,prefix);assert.deepEqual(s.request(request,f.token),known);assert.throws(()=>s.request({...request,requestId:prefix+'lost'},f.token),{code:'REQUEST_OUTCOME_UNKNOWN'});assert.equal(s.request(f.read('project.inspect'),f.token).intentDigest,model.intentDigest);}finally{await s.close();}
});

test('prepared metadata recovery preserves exact rows and rekey bytes; altered partial state is never reset',async()=>{
  const f=fixture('resume'),s=createStandaloneService(f.setup);prepareModel(s,f);await s.close();const snapshot=stage(f),input=selection(f,snapshot,null),p=prepared(input),manifest=join(input.root,'manifest.json'),raw=readFileSync(manifest,'utf8'),dbHash=hashBytes(readFileSync(join(p.root,'ontology.sqlite'))),token=readFileSync(join(p.root,'operator-token'));
  // Synthetic post-commit/pre-manifest interruption, explicitly separate from
  // the real killed-copy case below and the Linux low-space collector.
  unlinkSync(manifest);writeFileSync(manifest+'.pending',raw.slice(0,200),{mode:0o600});const resumed=prepareRestoreState(input,p.inspected.reportDigest);assert.deepEqual(resumed.receipt,p.done.receipt);assert.equal(hashBytes(readFileSync(join(p.root,'ontology.sqlite'))),dbHash);assert.deepEqual(readFileSync(join(p.root,'operator-token')),token);
  unlinkSync(manifest);const changed=new DatabaseSync(join(p.root,'ontology.sqlite'));changed.exec('UPDATE projects SET revision=revision+1');changed.close();const corrupt=hashBytes(readFileSync(join(p.root,'ontology.sqlite')));
  assert.throws(()=>prepareRestoreState(input,p.inspected.reportDigest),{code:'RESTORE_STATE_CONFLICT'});assert.equal(hashBytes(readFileSync(join(p.root,'ontology.sqlite'))),corrupt);assert.throws(()=>openWorkspace(p.root,f.i),{code:'RESTORE_STAGED'});
});

test('actual installed preparation resumes after SIGKILL following committed database reconciliation and partial file copying',async()=>{
  const f=fixture('killed'),s=createStandaloneService(f.setup);prepareModel(s,f);await s.close();const fd=openSync(join(f.root,'00-large'),'wx',0o600),block=Buffer.alloc(1024*1024,113);try{for(let i=0;i<64;i++)writeSync(fd,block);}finally{closeSync(fd);}
  const snapshot=stage(f),input=selection(f,snapshot,null),r=inspectRestoreState(input),payload=join(input.root,'workspace/00-large'),module=pathToFileURL(join(runtime.packageRoot,'dist/installation/restore-state.js')).href;
  const script='const {prepareRestoreState}=await import(process.argv[1]);prepareRestoreState(JSON.parse(process.argv[2]),process.argv[3]);';const child=spawn(process.execPath,['--input-type=module','-e',script,module,JSON.stringify(input),r.reportDigest],{stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_NO_WARNINGS:'1'}});let ended=false,killed=false,output='';child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{ended=true;resolve({code,signal});});});
  try{const end=performance.now()+30000;while(!ended&&performance.now()<end){if(existsSync(payload)){const n=lstatSync(payload).size;if(n>1024*1024&&n<64*1024*1024){killed=child.kill('SIGKILL');break;}}await delay(1);}if(!killed)child.kill('SIGKILL');const exit=await closed;assert.equal(killed,true,output);assert.equal(exit.signal,'SIGKILL');const prefix=readFileSync(payload),before=hashBytes(readFileSync(join(input.root,'workspace/ontology.sqlite'))),done=prepareRestoreState(input,r.reportDigest);assert.equal(hashBytes(readFileSync(payload).subarray(0,prefix.length)),hashBytes(prefix));assert.equal(hashBytes(readFileSync(join(input.root,'workspace/ontology.sqlite'))),before);assert.equal(verifyPreparedRestoreState(input.root,done.receipt.manifestDigest).status,'VERIFIED');}
  finally{if(!ended){child.kill('SIGKILL');await closed;}}
});

test('real formal review and delivery history retains later rejection and delivery selection when drafts roll back',async()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Actual tools required');
  const f=fixture('decisions'),review=reviewer(f),selected=k=>({toolchainFile:process.env[k],toolchainDigest:JSON.parse(readFileSync(process.env[k])).digest});bindInstallationToolchains(f.i.root,{requestId:'tools',previousBindingDigest:null,dl:selected('EVOPILOT_TEST_DL_TOOLCHAIN'),shacl:selected('EVOPILOT_TEST_SHACL_TOOLCHAIN')});
  const configuration={reasoning:{toolchainFile:process.env.EVOPILOT_TEST_DL_TOOLCHAIN,workRoot:f.workRoot},validation:{toolchainFile:process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,workRoot:f.workRoot}};let s=createStandaloneService({...f.setup,...configuration});
  const model=prepareValidation(s,f),validation=write(s,f,'validation.start',{assetId:'services',modelDigest:model.modelDigest},'validate');assert.equal((await terminal(s,f,validation.result.taskId)).formalStatus,'MATCHED');
  const explanation=write(s,f,'reasoning.start',{assetId:'services',modelDigest:model.modelDigest,task:{kind:'explanation',target:'entailment',query:model.expectations.cases[0].query}},'explain'),taskId=explanation.result.taskId;let result;
  for(let i=0;i<1500;i++){result=s.request(f.read('reasoning.inspect',{taskId}),f.token);if(result.state==='FINISHED')break;await delay(20);}assert.equal(result.formalStatus,'COMPLETED');
  const candidate=(version,previousDeliveryDigest)=>write(s,f,'review.prepare',{assetId:'services',modelDigest:model.modelDigest,version,previousDeliveryDigest,validationTaskId:validation.result.taskId,explanationTaskIds:[taskId]},'candidate-'+version).result;
  const decide=(c,decision,previousDecisionDigest=null)=>({assetId:'services',candidateDigest:c.candidateDigest,reportDigest:c.reportDigest,previousDecisionDigest,decision,rationale:'Synthetic recovery test decision.',instruction:{reference:'urn:test:restore-state',content:'Synthetic fixture only: '+decision+' this exact candidate.'},requirementIds:decision==='APPROVE'?['r1','r2']:[]});
  const first=candidate('1.0.0',null),approved=write(s,f,'review.decide',decide(first,'APPROVE'),'approve-1',review.token),delivery=write(s,f,'delivery.record',{assetId:'services',candidateDigest:first.candidateDigest,reviewDigest:approved.result.reviewDigest},'deliver-1');await s.close();const snapshot=stage(f);
  s=createStandaloneService({...f.setup,...configuration});const second=candidate('1.0.1',delivery.result.deliveryDigest),approved2=write(s,f,'review.decide',decide(second,'APPROVE'),'approve-2',review.token),delivery2=write(s,f,'delivery.record',{assetId:'services',candidateDigest:second.candidateDigest,reviewDigest:approved2.result.reviewDigest},'deliver-2');
  const rejected=write(s,f,'review.decide',decide(first,'REJECT',approved.result.reviewDigest),'reject-old',review.token);await s.close();const retained=stage(f),input=selection(f,snapshot,retained),p=prepared(input);s=serviceFixture(f,p,configuration);
  try{
    const old=s.request(f.read('review.inspect',{assetId:'services',candidateDigest:first.candidateDigest}),f.token);assert.equal(old.decision.decision,'REJECT');assert.equal(old.reviewDigest,rejected.result.reviewDigest);
    assert.equal(s.request(f.read('delivery.inspect',{assetId:'services',deliveryDigest:delivery.result.deliveryDigest}),f.token).isLatestDelivery,false);assert.equal(s.request(f.read('delivery.inspect',{assetId:'services',deliveryDigest:delivery2.result.deliveryDigest}),f.token).isLatestDelivery,true);
    assert.deepEqual(s.request(f.read('receipt.read',{requestId:'reject-old'}),review.token),rejected);const prefix=s.context(f.token).recovery.requestIdPrefix;
    assert.throws(()=>write(s,f,'delivery.record',{assetId:'services',candidateDigest:first.candidateDigest,reviewDigest:approved.result.reviewDigest},prefix+'must-not-resurrect'),e=>['STALE_REVIEW','STALE_CANDIDATE','DELIVERY_CONFLICT'].includes(e.code));
  }finally{await s.close();}
});
