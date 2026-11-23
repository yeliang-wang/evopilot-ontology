// Synthetic collector-unit tests only. No historical producer is executed and
// no result from this file is eligible as OL06 product acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {validateHistoryProvenance,observeHistoricalReads,historicalBusinessSnapshot,inspectInstalledRuntime,hashValue,hashBytes,runLimitedHistory} from '../acceptance/v090/limited-history.mjs';
const digest=n=>'sha256:'+n.repeat(64),ref=n=>({path:'/synthetic-only/'+n,digest:digest(n)});
function fixture(){
  const scope={visibility:'private',projectId:'original'},model={id:'synthetic',version:'1.0.0',specVersion:'v1',concepts:[{label:'Synthetic only'}]};
  const delivery={model,manifest:{productVersion:'0.2.0'},digest:digest('d')},record={scope,model,delivery};
  const receipt={operation:'asset.publish',requestId:'original',scope,result:{delivery,reference:{digest:delivery.digest}}};
  const history={scope,foreignScope:{...scope,projectId:'foreign'},id:model.id,version:model.version,requestId:receipt.requestId,export:ref('e'),receipt:ref('f'),producerArtifact:ref('a'),workspace:{root:'/synthetic-only/workspace',workspaceId:'synthetic',businessDigest:digest('b')}};
  const config={schema:'ontology-limited-history-input/v1',caseId:'OL06',candidateDigest:digest('c'),sourceCommit:'1'.repeat(40),history};
  // The retained-origin marker is only a parser fixture; this object is never
  // accepted by runLimitedHistory, which also requires actual pinned files.
  const provenance={schema:'ontology-historical-output-provenance/v1',origin:'RETAINED_ORIGINAL_OUTPUT',exportDigest:history.export.digest,receiptDigest:history.receipt.digest,recordedAt:'2026-01-01T00:00:00Z',producer:{artifactDigest:history.producerArtifact.digest,packageVersion:'0.8.3',deliveryInterfaceVersion:'0.2.0',sourceCommit:'0'.repeat(40)}};
  const preparation={schema:'ontology-historical-read-preparation/v1',mode:'EXISTING_ISOLATED_OWNER',workspaceRoot:history.workspace.root,workspaceId:history.workspace.workspaceId,businessDigest:history.workspace.businessDigest,exportDigest:history.export.digest,receiptDigest:history.receipt.digest,noBusinessRewrites:true,quiescent:true,dailyInstallation:false,ownerPreparationEvidence:ref('a')};
  return {config,history,record,receipt,provenance,preparation};
}
const validate=f=>validateHistoryProvenance(f.config,f.provenance,f.record,f.receipt,f.preparation);
test('synthetic unit: provenance requires original export, receipt and a distinct producer identity',()=>{
  const f=fixture();assert.equal(validate(f).deliveryDigest,digest('d'));
  for(const change of [x=>x.provenance.origin='SYNTHETIC',x=>x.provenance.exportDigest=digest('0'),x=>x.provenance.producer.sourceCommit=x.config.sourceCommit,x=>x.provenance.producer.deliveryInterfaceVersion='0.9.0',x=>x.preparation.dailyInstallation=true,x=>x.preparation.noBusinessRewrites=false,x=>x.preparation.businessDigest=digest('0'),x=>x.receipt={...x.receipt,result:{...x.receipt.result,delivery:{...x.receipt.result.delivery,digest:digest('0')}}}]){
    const bad=fixture();change(bad);assert.throws(()=>validate(bad));
  }
});
test('synthetic unit: source binding alone never becomes executable product evidence',async()=>{
  const f=fixture();validate(f);await assert.rejects(runLimitedHistory(f.config));
});
test('synthetic unit: genuine-published-producer contract allows fictional drafts without semantic approval',()=>{
  const f=fixture(),delivery=structuredClone(f.record.delivery);delivery.buildReport={authority:false,businessConfirmed:false,released:false};
  f.record.delivery=null;f.record.digest=digest('d');f.record.review=null;f.record.decision=null;
  f.history.delivery=ref('b');f.provenance.deliveryDigest=f.history.delivery.digest;f.provenance.origin='PINNED_PUBLISHED_PRODUCER_FIXTURE';f.provenance.publicationEvidence=ref('f');f.provenance.producer.packageVersion='0.2.0';
  f.receipt={...f.receipt,operation:'asset.put',result:{id:f.history.id,version:f.history.version,digest:f.record.digest}};f.preparation.mode='FRESH_PUBLISHED_PACKAGE_OWNER';
  const publication={schema:'evopilot-release-readback/v1',stage:'published',status:'PASS',sourceCommit:f.provenance.producer.sourceCommit,expectedDigest:'a'.repeat(64),remote:{draft:false,tagCommit:f.provenance.producer.sourceCommit}};
  const check=()=>validateHistoryProvenance(f.config,f.provenance,f.record,f.receipt,f.preparation,delivery,publication);
  assert.equal(check().receiptOperation,'asset.put');assert.equal(f.record.decision,null);
  publication.expectedDigest='0'.repeat(64);assert.throws(check);publication.expectedDigest='a'.repeat(64);
  delivery.buildReport.businessConfirmed=true;assert.throws(check);
});
function fakeReader(f){
  return {execute(r){
    if(r.operation==='asset.put')throw Object.assign(Error('retired'),{code:'HISTORICAL_READ_ONLY'});
    if(hashValue(r.scope)!==hashValue(f.history.scope))throw Object.assign(Error('scope'),{code:'NOT_FOUND'});
    if(r.operation==='asset.inspect')return structuredClone(f.record);
    if(r.operation==='receipt.inspect')return structuredClone(f.receipt);
    if(r.operation==='workspace.inspect')return {revision:4};throw Error('Unexpected unit operation');
  }};
}
function fakeApi(f){return {verifyDelivery:d=>({valid:hashValue(d)===hashValue(f.record.delivery),digest:d.digest,authority:false}),validateOntology:m=>({valid:m.specVersion==='v1'})};}
test('synthetic unit: observer requires scoped original reads and explicit rejection outcomes',()=>{
  const f=fixture(),observations=observeHistoricalReads(fakeApi(f),fakeReader(f),f.history,f.record,f.receipt);
  assert.equal(observations.length,9);assert(observations.every(x=>x.status==='PASS'));assert(!('acceptance' in observations));
});
test('synthetic unit: a scope leak, accepted mutation or permissive verifier cannot pass observations',()=>{
  const f=fixture();
  const leak=fakeReader(f),execute=leak.execute;leak.execute=r=>execute({...r,scope:f.history.scope});
  assert.throws(()=>observeHistoricalReads(fakeApi(f),leak,f.history,f.record,f.receipt));
  const writable=fakeReader(f),read=writable.execute;writable.execute=r=>r.operation==='asset.put'?{}:read(r);
  assert.throws(()=>observeHistoricalReads(fakeApi(f),writable,f.history,f.record,f.receipt));
  assert.throws(()=>observeHistoricalReads({...fakeApi(f),verifyDelivery:d=>({valid:true,digest:d.digest,authority:false})},fakeReader(f),f.history,f.record,f.receipt));
  assert.throws(()=>observeHistoricalReads({...fakeApi(f),validateOntology:()=>({valid:true})},fakeReader(f),f.history,f.record,f.receipt));
});
function directory(t){const root=realpathSync(mkdtempSync(join(tmpdir(),'ontology-history-unit-')));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
function snapshotFixture(t){
  const root=directory(t),dir=join(root,'state/ontology');mkdirSync(dir,{recursive:true,mode:0o700});writeFileSync(join(root,'workspace.json'),'{"synthetic":true}',{mode:0o600});
  const path=join(dir,'ontology.db'),db=new DatabaseSync(path);db.exec("CREATE TABLE state(id INTEGER,data TEXT); INSERT INTO state VALUES(1,'original'); CREATE TABLE receipts(id TEXT); CREATE TABLE audit(id TEXT); PRAGMA user_version=1;");db.close();return {root,path};
}
test('synthetic unit: snapshot reads preserve original DB bytes and detect altered business rows',t=>{
  const f=snapshotFixture(t),before=hashBytes(readFileSync(f.path)),snapshot=historicalBusinessSnapshot(f.root);
  assert.equal(hashBytes(readFileSync(f.path)),before);assert.equal(historicalBusinessSnapshot(f.root).digest,snapshot.digest);
  let db=new DatabaseSync(f.path);db.exec('PRAGMA user_version=2');db.close();assert.notEqual(historicalBusinessSnapshot(f.root).digest,snapshot.digest);
  db=new DatabaseSync(f.path);db.exec("PRAGMA user_version=1; UPDATE state SET data='changed'");db.close();assert.notEqual(historicalBusinessSnapshot(f.root).digest,snapshot.digest);
});
test('synthetic unit: uncheckpointed owners and linked evidence fail before API entry',t=>{
  const f=snapshotFixture(t);writeFileSync(f.path+'-wal','not checkpointed');assert.throws(()=>historicalBusinessSnapshot(f.root),/Quiescent/);rmSync(f.path+'-wal');
  const assets=join(f.root,'public/ontology');mkdirSync(assets,{recursive:true});symlinkSync(join(f.root,'workspace.json'),join(assets,'foreign.json'));assert.throws(()=>historicalBusinessSnapshot(f.root),/No links/);
});
test('synthetic unit: repeated read-only WAL snapshots tolerate empty SQLite sidecar metadata',t=>{
  const f=snapshotFixture(t),db=new DatabaseSync(f.path);db.exec('PRAGMA journal_mode=WAL');db.close();
  const before=hashBytes(readFileSync(f.path)),first=historicalBusinessSnapshot(f.root);assert.equal(historicalBusinessSnapshot(f.root).digest,first.digest);assert.equal(hashBytes(readFileSync(f.path)),before);
});
test('synthetic unit: a claimed installed runtime digest must match actual package bytes',t=>{
  const root=directory(t),pkg=join(root,'node_modules/@evopilot-next/ontology');mkdirSync(pkg,{recursive:true});writeFileSync(join(pkg,'package.json'),JSON.stringify({name:'@evopilot-next/ontology',version:'0.9.0'}));
  assert.throws(()=>inspectInstalledRuntime(root,digest('0')),/differs from frozen candidate/);
});
