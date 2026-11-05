import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,readFileSync,writeFileSync,rmSync,chmodSync,symlinkSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {initializeWorkspace} from '../../dist/installation/workspace.js';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {listenStandalone} from '../../dist/standalone/http.js';
import {hashBytes} from '../../dist/standalone/validation.js';
import {openWorkspace,STATE_VERSION} from '../../dist/standalone/workspace.js';
import {LIMITS} from '../../dist/standalone/types.js';

function fixture(t) {
  const base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-independent-'))),root=join(base,'workspace');
  const setup=initializeWorkspace({root,workspaceId:'isolated',projectId:'demo',principalId:'user'});
  const token=readFileSync(setup.credentialFile,'utf8');
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const read=(operation,input={},extra={})=>({workspaceId:setup.workspaceId,serviceId:setup.serviceId,projectId:'demo',operation,input,...extra});
  const write=(operation,input,requestId,expectedRevision)=>read(operation,input,{requestId,expectedRevision});
  return {base,root,setup,token,read,write};
}
const definition={purpose:'Determine which services process sensitive data',mode:'forward',scope:'Order service and customer dataset',exclusions:['Production observations'],sources:[{id:'requirements',locator:'requirements.txt',revision:'v1',digest:hashBytes('fixed synthetic requirements'),origin:'requirement'}],requirements:[{id:'r1',statement:'Classify access to sensitive data and explain provenance'}]};

test('independent workspace persists intent and idempotent receipts without parent/Runtime/Harness',t=>{
  const f=fixture(t);let s=createStandaloneService(f.setup);t.after(()=>s.close());
  const initial=s.request(f.read('service.inspect'),f.token);assert.equal(initial.acceptanceStatus,'EXTERNAL_EVIDENCE_REQUIRED');assert.equal(initial.reasoningExecutionConfigured,false);assert.equal(initial.nativeAuthoringImplemented,true);assert.equal(initial.productVersion,'0.9.0');
  const create=f.write('project.create',{label:'Synthetic demo'},'create',0);
  const receipt=s.request(create,f.token);assert.equal(receipt.revision,1);
  const recorded=s.request(f.write('intent.record',{definition,previousDigest:null},'intent',1),f.token);
  assert.equal(recorded.revision,2);assert.equal(recorded.result.businessConfirmed,false);
  assert.equal(recorded.result.sourceVerification,'NOT_EVALUATED');
  s.close();s=createStandaloneService(f.setup);
  assert.deepEqual(s.request({...create,expectedRevision:123},f.token),receipt);
  assert.equal(s.request(f.read('project.inspect'),f.token).revision,2);
  assert.deepEqual(s.request(f.read('receipt.read',{requestId:'intent'}),f.token),recorded);
  const retained=s.request(f.read('intent.read',{digest:recorded.result.intentDigest}),f.token);
  assert.deepEqual(retained.definition,definition);
  assert.throws(()=>s.request({...create,input:{label:'Different intent'}},f.token),{code:'REQUEST_CONFLICT'});
  assert.throws(()=>s.request(f.write('intent.record',{definition,previousDigest:null},'stale',0),f.token),{code:'REVISION_CONFLICT'});
  assert.throws(()=>s.request(f.write('intent.record',{definition,previousDigest:null},'wrong-parent',2),f.token),{code:'INTENT_CONFLICT'});
  assert.equal(s.request(f.read('project.inspect'),f.token).revision,2);
});

test('identity, project scope, read-only permissions and revocation govern original receipt replay',t=>{
  const f=fixture(t),s=createStandaloneService(f.setup);t.after(()=>s.close());
  const create=f.write('project.create',{label:'Demo'},'create',0);s.request(create,f.token);
  assert.throws(()=>s.request(f.read('project.inspect',{}, {projectId:'other'}),f.token),{code:'FORBIDDEN'});
  assert.throws(()=>s.request(f.read('project.inspect',{}, {serviceId:'wrong'}),f.token),{code:'IDENTITY_MISMATCH'});
  assert.throws(()=>s.request(f.read('project.inspect'),'x'.repeat(43)),{code:'UNAUTHENTICATED'});
  const file=join(f.root,'credentials.json'),auth=JSON.parse(readFileSync(file,'utf8'));
  auth.grants[0].permissions=['read'];writeFileSync(file,JSON.stringify(auth));
  assert.equal(s.request(f.read('project.inspect'),f.token).revision,1);
  assert.throws(()=>s.request(create,f.token),{code:'FORBIDDEN'});
  auth.grants[0].revoked=true;writeFileSync(file,JSON.stringify(auth));
  assert.throws(()=>s.request(f.read('receipt.read',{requestId:'create'}),f.token),{code:'UNAUTHENTICATED'});
});

test('invalid input cannot create a partial intent, approval or unknown operation',t=>{
  const f=fixture(t),s=createStandaloneService(f.setup);t.after(()=>s.close());
  s.request(f.write('project.create',{label:'Demo'},'create',0),f.token);
  for(const bad of [{...definition,requirements:[]},{...definition,sources:[]},{...definition,approved:true},{...definition,mode:'execute'}]){
    assert.throws(()=>s.request(f.write('intent.record',{definition:bad,previousDigest:null},'bad',1),f.token),{code:'INVALID_INPUT'});
    assert.equal(s.request(f.read('project.inspect'),f.token).revision,1);
  }
  assert.throws(()=>s.request(f.read('installation.delete',{}),f.token),{code:'UNSUPPORTED_OPERATION'});
  assert.throws(()=>s.request(f.read('project.inspect',{unexpected:'field'}),f.token),{code:'INVALID_INPUT'});
  assert.throws(()=>s.request(f.read('project.inspect',JSON.parse('{"__proto__":{}}')),f.token),{code:'INVALID_INPUT'});
});

test('occupied paths, linked files, loose permissions and state substitution are refused',t=>{
  const f=fixture(t);
  assert.throws(()=>initializeWorkspace({root:f.root,workspaceId:'other',projectId:'demo',principalId:'user'}),{code:'WORKSPACE_EXISTS'});
  chmodSync(join(f.root,'credentials.json'),0o644);
  assert.throws(()=>createStandaloneService(f.setup),{code:'UNSAFE_PATH'});
  chmodSync(join(f.root,'credentials.json'),0o600);
  const db=new DatabaseSync(join(f.root,'ontology.sqlite'));db.exec('PRAGMA user_version=99');db.close();
  assert.throws(()=>createStandaloneService(f.setup),{code:'UNSUPPORTED_STATE'});
  const d2=new DatabaseSync(join(f.root,'ontology.sqlite'));d2.exec('PRAGMA user_version='+STATE_VERSION);d2.close();
  const file=join(f.root,'credentials.json');renameSync(file,file+'.old');symlinkSync(file+'.old',file);
  assert.throws(()=>createStandaloneService(f.setup),{code:'UNSAFE_PATH'});
});

test('single writer lock rejects a second writer and releases on owner close',t=>{
  const f=fixture(t),s=createStandaloneService(f.setup);
  assert.throws(()=>createStandaloneService(f.setup),{code:'WORKSPACE_BUSY'});
  s.close();const other=createStandaloneService(f.setup);other.close();
});

test('protected database byte ceiling rejects over-budget allocation and remains readable',t=>{
  const f=fixture(t),store=openWorkspace(f.root,f.setup);
  try{
    store.db.exec('CREATE TABLE capacity_probe(content BLOB)');
    assert.throws(()=>store.db.prepare('INSERT INTO capacity_probe VALUES(zeroblob(?))').run(LIMITS.stateBytes),e=>e.errcode===13);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM capacity_probe').get().n,0);
    assert.equal(store.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }finally{store.close();}
  const s=createStandaloneService(f.setup);try{assert.equal(s.request(f.read('service.inspect'),f.token).project,null);}finally{s.close();}
});

test('actual child death releases writer lease without replaying committed mutation',async t=>{
  const f=fixture(t);
  const url=new URL('../../dist/standalone/service.js',import.meta.url).href;
  const code=`import {readFileSync} from 'node:fs'; import {createStandaloneService} from ${JSON.stringify(url)};
  const setup=JSON.parse(process.argv[1]); const s=createStandaloneService(setup);
  const result=s.request({workspaceId:setup.workspaceId,serviceId:setup.serviceId,projectId:'demo',operation:'project.create',input:{label:'Child'},requestId:'child-create',expectedRevision:0},readFileSync(setup.credentialFile,'utf8'));
  // Keep the service reachable for the simulated owner's lifetime. An empty
  // timer retains only the process; GC can legitimately finalize unused SQLite handles.
  setInterval(()=>s.identity(),1000);globalThis.gc();process.send({revision:result.revision});`;
  const child=spawn(process.execPath,['--expose-gc','--input-type=module','-e',code,JSON.stringify(f.setup)],{stdio:['ignore','ignore','pipe','ipc']});
  let stderr='';child.stderr.on('data',x=>stderr+=x);t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  const ready=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error('child exited '+stderr);}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('child timeout')),10000);timer.unref();})]);
  assert.equal(ready[0].revision,1);
  assert.throws(()=>createStandaloneService(f.setup),{code:'WORKSPACE_BUSY'});
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  const service=createStandaloneService(f.setup);t.after(()=>service.close());
  assert.equal(service.request(f.read('receipt.read',{requestId:'child-create'}),f.token).revision,1);
  assert.equal(service.request(f.read('project.inspect'),f.token).revision,1);
});

test('actual loopback HTTP uses the same scope/CAS/receipt service and rejects browser requests',async t=>{
  const f=fixture(t),http=await listenStandalone(f.setup);t.after(()=>http.close());
  const post=(body,headers={})=>fetch(http.origin+'/v1/request',{method:'POST',headers:{authorization:'Bearer '+f.token,'content-type':'application/json',...headers},body:JSON.stringify(body)});
  const create=f.write('project.create',{label:'HTTP demo'},'create',0);
  const created=await post(create);assert.equal(created.status,200);const first=await created.json();
  const writes=await Promise.all(['one','two'].map(requestId=>post(f.write('intent.record',{definition,previousDigest:null},requestId,1))));
  assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);
  const replay=await post(create);assert.deepEqual(await replay.json(),first);
  assert.equal((await post(f.read('project.inspect'),{origin:'https://evil.invalid'})).status,403);
  const wrongHost=await new Promise((resolve,reject)=>{
    const req=httpRequest(http.origin+'/v1/request',{method:'POST',headers:{host:'evil.invalid',authorization:'Bearer '+f.token,'content-type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',reject);req.end(JSON.stringify(f.read('project.inspect')));
  });
  assert.equal(wrongHost,403);
  assert.equal((await post(f.read('project.inspect'),{authorization:'Bearer invalid'})).status,401);
  assert.equal((await post(f.read('project.inspect',{}, {projectId:'foreign'}))).status,403);
  const oversized=await post(f.read('project.inspect',{padding:'x'.repeat(600000)}));assert.equal(oversized.status,413);
});
