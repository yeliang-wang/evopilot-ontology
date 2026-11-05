import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {inspectRuntime} from '../../dist/installation/runtime.js';
import {prepareInstallation} from '../../dist/installation/manager.js';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {inspectAssetReset,applyAssetReset} from '../../dist/installation/asset-reset.js';
import {RESET_RECORDS,resetKey} from '../../dist/standalone/reset-records.js';
import {inspectInstallationBackup,backupInstallation} from '../../dist/installation/backup.js';
import {inspectRestoreStage,stageInstallationRestore} from '../../dist/installation/restore-stage.js';
import {inspectRestoreState} from '../../dist/installation/restore-state.js';
import {hashBytes} from '../../dist/standalone/validation.js';
import {definition,sourceSet,draft} from '../helpers/v090-native.mjs';

let base,runtime,runtimeRoot,cli;
before(()=>{
 base=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'ontology-reset-')));runtimeRoot=join(base,'runtime');fs.mkdirSync(runtimeRoot,{mode:0o700});
 const source=fileURLToPath(new URL('../..',import.meta.url));
 const pack=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',base],{cwd:source}));
 execFileSync('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',runtimeRoot,join(base,pack[0].filename)],{cwd:base,stdio:'pipe'});
 runtime=inspectRuntime(runtimeRoot);cli=join(runtime.packageRoot,'dist/standalone/cli.js');
});
after(()=>{if(base)fs.rmSync(base,{recursive:true,force:true});});
function fixture(name){
 const i=prepareInstallation({root:join(base,name+'-installation'),workspaceRoot:join(base,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot,runtimeDigest:runtime.digest,mode:'create'});
 const cf=join(i.workspaceRoot,'credentials.json'),credentials=JSON.parse(fs.readFileSync(cf));credentials.grants[0].projectIds.push('keep');fs.writeFileSync(cf,JSON.stringify(credentials));
 const token=fs.readFileSync(join(i.workspaceRoot,'operator-token'),'utf8');
 const open=()=>createStandaloneService({root:i.workspaceRoot,workspaceId:i.workspaceId,serviceId:i.serviceId});
 const request=(service,project,operation,input={},requestId,expectedRevision)=>service.request({workspaceId:i.workspaceId,serviceId:i.serviceId,projectId:project,operation,input,...(requestId?{requestId,expectedRevision}:{})},token);
 const s=open(),models={};
 for(const project of ['demo','keep']){
  request(s,project,'project.create',{label:project},'create',0);
  const intent=request(s,project,'intent.record',{definition:{...definition,purpose:definition.purpose+' '+project},previousDigest:null},'intent',1).result.intentDigest;
  const sources=request(s,project,'source.admit',{intentDigest:intent,sourceSet},'sources',2).result.sourceSetDigest;
  const model=draft(intent,sources),digest=request(s,project,'model.record',{draft:model},'model',3).result.modelDigest;models[project]={intent,sources,model,digest};
 }
 s.close();return {i,open,request,models};
}
function copies(f,count=2){
 const root=join(f.i.workspaceRoot,'asset-exports',Buffer.from('demo').toString('hex'));fs.mkdirSync(root,{recursive:true,mode:0o700});
 for(let n=0;n<count;n++)fs.writeFileSync(join(root,'copy-'+String(n).padStart(4,'0')),Buffer.alloc(4096,97+n%20),{mode:0o600});
 return root;
}
const inspect=f=>inspectAssetReset(f.i.root,['demo'],'reset-1');
const apply=(f,r)=>applyAssetReset(f.i.root,r.report,r.reportDigest);
const code=c=>e=>e.code===c;

test('installed reset clears selected models, source copies and exports, preserves credentials/non-target/audit, and prevents old request or asset reuse',()=>{
 const f=fixture('complete'),copyRoot=copies(f),original=join(f.i.workspaceRoot,'original-requirement.txt');fs.writeFileSync(original,'Original source must remain',{mode:0o600});
 const protectedNames=['identity.json','credentials.json','operator-token','original-requirement.txt'],protectedBytes=protectedNames.map(n=>hashBytes(fs.readFileSync(join(f.i.workspaceRoot,n))));
 const r=inspect(f);assert.equal(r.status,'READY');assert(r.report.tableCounts.native_models>0);assert(r.report.requests.length>=4);
 const report=join(base,'complete-report.json');fs.writeFileSync(report,JSON.stringify(r.report),{mode:0o600});
 const out=JSON.parse(execFileSync(process.execPath,[cli,'asset-reset-apply','--installation',f.i.root,'--report',report,'--expected-report',r.reportDigest,'--json'],{encoding:'utf8'}));assert.equal(out.ok,true);assert.equal(out.result.verification,'VERIFIED');
 assert.equal(fs.existsSync(copyRoot),false);assert.deepEqual(protectedNames.map(n=>hashBytes(fs.readFileSync(join(f.i.workspaceRoot,n)))),protectedBytes);
 const s=f.open();try{
  assert.deepEqual(f.request(s,'demo','model.list',{afterAssetId:null,limit:20}).models,[]);
  assert.equal(f.request(s,'keep','model.inspect',{assetId:'services',modelDigest:f.models.keep.digest}).modelDigest,f.models.keep.digest);
  assert.throws(()=>f.request(s,'demo','model.inspect',{assetId:'services',modelDigest:f.models.demo.digest}),code('ASSET_PURGED'));
  assert.throws(()=>f.request(s,'demo','model.record',{draft:f.models.demo.model},'model',4),code('REQUEST_PURGED'));
  assert.throws(()=>f.request(s,'demo','receipt.read',{requestId:'model'}),code('REQUEST_PURGED'));
  assert.throws(()=>f.request(s,'demo','intent.record',{definition:{...definition,purpose:definition.purpose+' demo'},previousDigest:null},'new-intent',5),code('ASSET_PURGED'));
  const next=f.request(s,'demo','intent.record',{definition:{...definition,purpose:'New deliberately rebuilt ontology'},previousDigest:null},'new-intent',5);assert.equal(next.revision,6);
 }finally{s.close();}
 assert.equal(apply(f,r).replayed,true);assert.equal(inspect(f).status,'COMPLETED');
 const db=new DatabaseSync(join(f.i.workspaceRoot,'ontology.sqlite'),{readOnly:true});try{assert.equal(db.prepare("SELECT count(*) n FROM audit WHERE operation='maintenance.asset-reset'").get().n,1);assert.equal(db.prepare("SELECT count(*) n FROM audit WHERE project_id='demo' AND operation!='maintenance.asset-reset'").get().n,5);}finally{db.close();}
 const retained=fs.readFileSync(join(f.i.workspaceRoot,RESET_RECORDS,resetKey('reset-1')+'.json'),'utf8');assert(!retained.includes('A service accessing sensitive data is sensitive.'));
});
test('changed state and concurrent foreground writers refuse reset before an admission exists',()=>{
 const f=fixture('changed'),r=inspect(f),s=f.open();
 try{assert.throws(()=>apply(f,r),code('WORKSPACE_BUSY'));f.request(s,'demo','intent.record',{definition:{...definition,purpose:'Changed before selected reset'},previousDigest:f.models.demo.intent},'changed',4);}finally{s.close();}
 assert.throws(()=>apply(f,r),code('RESET_SOURCE_CHANGED'));assert.equal(fs.existsSync(join(f.i.workspaceRoot,RESET_RECORDS)),false);
});
test('selected copy links and unknown permissions cannot redirect deletion',()=>{
 const f=fixture('linked'),root=copies(f),original=join(base,'outside-original');fs.writeFileSync(original,'preserve',{mode:0o600});fs.symlinkSync(original,join(root,'linked'));
 assert.throws(()=>inspect(f),code('UNSAFE_PATH'));assert.equal(fs.readFileSync(original,'utf8'),'preserve');
});
test('actual SIGKILL after committed deletion blocks new use and resumes the original reset without another deletion transaction',async()=>{
 const f=fixture('interrupted'),root=copies(f,900),r=inspect(f),file=join(base,'interrupted-report.json');fs.writeFileSync(file,JSON.stringify(r.report),{mode:0o600});
 const child=spawn(process.execPath,[cli,'asset-reset-apply','--installation',f.i.root,'--report',file,'--expected-report',r.reportDigest,'--json'],{stdio:['ignore','pipe','pipe']});let ended=false,output='';child.stdout.on('data',b=>output+=b);child.stderr.resume();const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{ended=true;resolve({code,signal});});});let interrupted=false;
 try{
  const end=performance.now()+20000;while(!ended&&performance.now()<end){const left=fs.existsSync(root)?fs.readdirSync(root).length:0;if(left>0&&left<900){interrupted=child.kill('SIGKILL');break;}await delay(1);}
  if(!interrupted)child.kill('SIGKILL');const exit=await closed;assert(interrupted,'Observed real partial copy removal required '+output);assert.equal(exit.signal,'SIGKILL');
  assert.throws(()=>f.open(),code('RESET_PENDING'));assert.throws(()=>inspectAssetReset(f.i.root,['demo'],'other-reset'),code('RESET_PENDING'));assert.equal(inspect(f).status,'PENDING');
  assert.equal(apply(f,r).verification,'VERIFIED');assert.equal(fs.existsSync(root),false);const s=f.open();s.close();
  const db=new DatabaseSync(join(f.i.workspaceRoot,'ontology.sqlite'),{readOnly:true});try{assert.equal(db.prepare("SELECT count(*) n FROM audit WHERE operation='maintenance.asset-reset'").get().n,1);}finally{db.close();}
 }finally{if(!ended){child.kill('SIGKILL');await closed;}}
});
function snapshot(f,name){
 const backup=join(base,name+'-backup'),r=inspectInstallationBackup(f.i.root,backup,name),done=backupInstallation(f.i.root,{backupRoot:backup,requestId:name,expectedReportDigest:r.reportDigest});
 const input={backupRoot:backup,expectedManifestDigest:done.receipt.manifestDigest,stageRoot:join(base,name+'-stage'),requestId:name+'-stage'},p=inspectRestoreStage(input),stage=stageInstallationRestore(input,p.reportDigest);
 return {root:input.stageRoot,manifestDigest:stage.receipt.manifestDigest};
}
test('current recovery refuses a snapshot that would resurrect explicitly cleared identities',()=>{
 const f=fixture('restore'),before=snapshot(f,'before-reset');apply(f,inspect(f));const after=snapshot(f,'after-reset');
 assert.throws(()=>inspectRestoreState({snapshot:before,retained:after,root:join(base,'reset-restore-state'),requestId:'recover',generation:'1'.repeat(32),rekeyExpiresAt:null}),code('RESTORE_RESET_CONFLICT'));
});
