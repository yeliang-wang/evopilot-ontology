import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {initializeWorkspace} from '../../dist/installation/workspace.js';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {listenStandalone} from '../../dist/standalone/http.js';
import {hashBytes} from '../../dist/standalone/validation.js';

const content='{"sensitivity":"敏感😀", "policy":"read-only"}\n';
const source={id:'requirements',locator:'requirements.json',revision:'v1',origin:'requirement',format:'json',content,digest:hashBytes(content)};
const sourceSet={schema:'ontology-source-set/v2',sources:[source],fragments:[{id:'sensitivity',sourceId:source.id,sourceDigest:source.digest,selector:{kind:'json-pointer',pointer:'/sensitivity'},fragmentDigest:hashBytes('"敏感😀"')}]};
const {format:_,content:__,...binding}=source;
const definition={purpose:'Classify sensitive services',mode:'forward',scope:'Synthetic service and dataset',exclusions:['Production access'],sources:[binding],requirements:[{id:'sensitive',statement:'Classify access to sensitive data and explain original evidence'}]};
function fixture(t){
  const base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-source-store-'))),root=join(base,'workspace');
  const setup=initializeWorkspace({root,workspaceId:'isolated',projectId:'demo',principalId:'user'}),token=readFileSync(setup.credentialFile,'utf8');
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const read=(operation,input={},projectId='demo')=>({workspaceId:setup.workspaceId,serviceId:setup.serviceId,projectId,operation,input});
  const write=(operation,input,requestId,expectedRevision,projectId='demo')=>({...read(operation,input,projectId),requestId,expectedRevision});
  return {base,root,setup,token,read,write};
}
function prepare(s,f){
  s.request(f.write('project.create',{label:'Synthetic demo'},'create',0),f.token);
  return s.request(f.write('intent.record',{definition,previousDigest:null},'intent',1),f.token).result.intentDigest;
}

test('source admission survives restart and exact replay without reactivating stale intent evidence',t=>{
  const f=fixture(t);let s=createStandaloneService(f.setup);t.after(()=>s.close());const intentDigest=prepare(s,f);
  const request=f.write('source.admit',{intentDigest,sourceSet},'admit',2),receipt=s.request(request,f.token),d=receipt.result.sourceSetDigest;
  assert.equal(receipt.revision,3);assert.equal(receipt.result.status,'ADMITTED');assert.equal(receipt.result.businessConfirmed,false);
  s.close();s=createStandaloneService(f.setup);
  assert.deepEqual(s.request({...request,expectedRevision:999},f.token),receipt);
  const inspected=s.request(f.read('source.inspect',{sourceSetDigest:null}),f.token);assert.equal(inspected.current,true);assert.equal(inspected.sourceSetDigest,d);
  assert.equal(s.request(f.read('service.inspect'),f.token).nativeV2Ready,false);
  const next=s.request(f.write('intent.record',{definition:{...definition,scope:'Changed declared scope'},previousDigest:intentDigest},'intent-next',3),f.token);
  assert.equal(s.request(f.read('project.inspect'),f.token).sourceAdmission.status,'STALE');
  assert.equal(s.request(f.read('source.inspect',{sourceSetDigest:d}),f.token).current,false);
  assert.deepEqual(s.request(request,f.token),receipt);
  assert.equal(s.request(f.read('project.inspect'),f.token).sourceAdmission.status,'STALE');
  assert.throws(()=>s.request(f.write('source.admit',{intentDigest,sourceSet},'old-intent',4),f.token),{code:'INTENT_CONFLICT'});
  const rebind=s.request(f.write('source.admit',{intentDigest:next.result.intentDigest,sourceSet},'rebind',4),f.token);
  assert.equal(rebind.result.sourceSetDigest,d);assert.equal(s.request(f.read('project.inspect'),f.token).sourceAdmission.status,'CURRENT');
});

test('source metadata, source bytes and independent declaration completeness govern admission atomically',t=>{
  const f=fixture(t),s=createStandaloneService(f.setup);t.after(()=>s.close());const intentDigest=prepare(s,f);
  const variants=[
    [{...sourceSet,sources:[{...source,locator:'different'}]},'SOURCE_BINDING_CONFLICT'],
    [{...sourceSet,sources:[{...source,content:'wrong'}]},'SOURCE_DIGEST_MISMATCH'],
    [{...sourceSet,sources:[source,{...source,id:'extra'}]},'SOURCE_BINDING_CONFLICT'],
    [{...sourceSet,fragments:[{...sourceSet.fragments[0],fragmentDigest:hashBytes('invented')}]},'FRAGMENT_DIGEST_MISMATCH'],
  ];
  for(const [set,code] of variants){
    assert.throws(()=>s.request(f.write('source.admit',{intentDigest,sourceSet:set},'failed',2),f.token),{code});
    assert.equal(s.request(f.read('project.inspect'),f.token).revision,2);
    assert.equal(s.request(f.read('source.inspect',{sourceSetDigest:null}),f.token).status,'ABSENT');
    assert.throws(()=>s.request(f.read('receipt.read',{requestId:'failed'}),f.token),{code:'NOT_FOUND'});
  }
});

test('source and fragment pages preserve exact UTF-8 bytes and never claim a partial document complete',t=>{
  const f=fixture(t),s=createStandaloneService(f.setup);t.after(()=>s.close());const intentDigest=prepare(s,f);
  const d=s.request(f.write('source.admit',{intentDigest,sourceSet},'admit',2),f.token).result.sourceSetDigest;
  for(const [op,key,value,expected] of [['source.read','sourceId',source.id,content],['source.fragment.read','fragmentId','sensitivity','"敏感😀"']]){
    let offset=0,combined='',pages=0;
    do{const page=s.request(f.read(op,{sourceSetDigest:d,[key]:value,offset,maxBytes:4}),f.token);combined+=page.content;pages++;
      assert.equal(page.sourceDigest,source.digest);assert.equal(page.current,true);assert.equal(page.complete,page.nextOffset===null);
      if(page.nextOffset!==null)assert(page.nextOffset>offset);offset=page.nextOffset;
    }while(offset!==null);
    assert.equal(combined,expected);assert(pages>1);
  }
  assert.throws(()=>s.request(f.read('source.fragment.read',{sourceSetDigest:d,fragmentId:'sensitivity',offset:2,maxBytes:4}),f.token),{code:'SOURCE_FRAGMENT_INVALID'});
  assert.throws(()=>s.request(f.read('source.read',{sourceSetDigest:d,sourceId:source.id,offset:0,maxBytes:65537}),f.token),{code:'INVALID_INPUT'});
});

test('project isolation, permissions and credential revocation apply to source reads and receipt replay',t=>{
  const f=fixture(t),file=join(f.root,'credentials.json'),grants=JSON.parse(readFileSync(file,'utf8'));grants.grants[0].projectIds.push('other');writeFileSync(file,JSON.stringify(grants));
  const s=createStandaloneService(f.setup);t.after(()=>s.close());const intentDigest=prepare(s,f);
  const request=f.write('source.admit',{intentDigest,sourceSet},'admit',2),d=s.request(request,f.token).result.sourceSetDigest;
  s.request(f.write('project.create',{label:'Other scope'},'other-create',0,'other'),f.token);
  assert.throws(()=>s.request(f.read('source.inspect',{sourceSetDigest:d},'other'),f.token),{code:'NOT_FOUND'});
  assert.throws(()=>s.request(f.read('source.inspect',{sourceSetDigest:d},'foreign'),f.token),{code:'FORBIDDEN'});
  grants.grants[0].permissions=['read'];writeFileSync(file,JSON.stringify(grants));
  assert.equal(s.request(f.read('source.inspect',{sourceSetDigest:d}),f.token).current,true);
  assert.throws(()=>s.request(request,f.token),{code:'FORBIDDEN'});
  grants.grants[0].revoked=true;writeFileSync(file,JSON.stringify(grants));
  assert.throws(()=>s.request(f.read('source.inspect',{sourceSetDigest:d}),f.token),{code:'UNAUTHENTICATED'});
});

test('failure after source persistence rolls back snapshot, active pointer, revision and receipt together',t=>{
  const f=fixture(t);let s=createStandaloneService(f.setup);const intentDigest=prepare(s,f);s.close();
  const db=new DatabaseSync(join(f.root,'ontology.sqlite'));db.exec("CREATE TRIGGER injected_receipt_failure BEFORE INSERT ON receipts WHEN NEW.request_id='fault' BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END");db.close();
  s=createStandaloneService(f.setup);t.after(()=>s.close());
  assert.throws(()=>s.request(f.write('source.admit',{intentDigest,sourceSet},'fault',2),f.token),/injected receipt failure/);
  assert.equal(s.request(f.read('project.inspect'),f.token).revision,2);
  assert.equal(s.request(f.read('source.inspect',{sourceSetDigest:null}),f.token).status,'ABSENT');
  assert.throws(()=>s.request(f.read('receipt.read',{requestId:'fault'}),f.token),{code:'NOT_FOUND'});
  s.close();const inspect=new DatabaseSync(join(f.root,'ontology.sqlite'));try{
    for(const table of ['native_source_sets','native_source_admissions','native_source_heads'])assert.equal(inspect.prepare('SELECT count(*) AS n FROM '+table).get().n,0);
  }finally{inspect.close();}
});

test('stored-byte corruption and an old state version are refused without automatic repair',t=>{
  const f=fixture(t);let s=createStandaloneService(f.setup);const intentDigest=prepare(s,f);
  const d=s.request(f.write('source.admit',{intentDigest,sourceSet},'admit',2),f.token).result.sourceSetDigest;s.close();
  const db=new DatabaseSync(join(f.root,'ontology.sqlite'));db.prepare('UPDATE native_source_sets SET document=?').run(JSON.stringify({...sourceSet,sources:[{...source,content:'tampered'}]}));db.close();
  s=createStandaloneService(f.setup);assert.throws(()=>s.request(f.read('source.inspect',{sourceSetDigest:d}),f.token),{code:'CORRUPT_STATE'});s.close();
  const file=join(f.root,'identity.json'),identity=JSON.parse(readFileSync(file,'utf8'));identity.stateVersion=9;const raw=JSON.stringify(identity);writeFileSync(file,raw);
  const previous=hashBytes(readFileSync(join(f.root,'ontology.sqlite')));
  assert.throws(()=>createStandaloneService(f.setup),{code:'UNSUPPORTED_STATE'});
  assert.equal(readFileSync(file,'utf8'),raw);assert.equal(hashBytes(readFileSync(join(f.root,'ontology.sqlite'))),previous);
});

test('actual HTTP routes source writes and bounded readback through the same owner receipts',async t=>{
  const f=fixture(t),http=await listenStandalone(f.setup);t.after(()=>http.close());
  const post=async body=>{const response=await fetch(http.origin+'/v1/request',{method:'POST',headers:{authorization:'Bearer '+f.token,'content-type':'application/json'},body:JSON.stringify(body)});const envelope=await response.json();assert.equal(response.status,200,JSON.stringify(envelope));assert.equal(envelope.ok,true);return envelope.result;};
  await post(f.write('project.create',{label:'HTTP source'},'create',0));
  const intent=await post(f.write('intent.record',{definition,previousDigest:null},'intent',1));
  const admitted=await post(f.write('source.admit',{intentDigest:intent.result.intentDigest,sourceSet},'admit',2));
  assert.deepEqual(await post(f.read('receipt.read',{requestId:'admit'})),admitted);
  const fragment=await post(f.read('source.fragment.read',{sourceSetDigest:admitted.result.sourceSetDigest,fragmentId:'sensitivity',offset:0,maxBytes:65536}));
  assert.equal(fragment.content,'"敏感😀"');assert.equal(fragment.complete,true);
});
