import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,readFileSync,writeFileSync,rmSync,mkdirSync,existsSync,copyFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {createServer,request as httpRequest} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {inspectRuntime} from '../../dist/installation/runtime.js';
import {prepareInstallation,bindInstallationToolchains,inspectInstallationToolchains,startInstallation,stopInstallation} from '../../dist/installation/manager.js';
import {processPresent} from '../../dist/installation/control.js';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {hash} from '../../dist/standalone/validation.js';
import {definition,sourceSet,expected,model} from '../helpers/v090-validation.mjs';

const source=fileURLToPath(new URL('../..',import.meta.url));
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:30000,maxBuffer:2*1024*1024,...options},(error,stdout,stderr)=>error?reject(new Error(`${file} failed: ${error.code}\n${stdout}\n${stderr}`)):resolve(stdout)));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let base,runtime,runtimeRoot,cli,dl,shacl;
before(async()=>{
  assert(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Actual pinned installed tools required; no mock or skip');
  dl=JSON.parse(readFileSync(process.env.EVOPILOT_TEST_DL_TOOLCHAIN,'utf8'));shacl=JSON.parse(readFileSync(process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'utf8'));
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-managed-tools-')));runtimeRoot=join(base,'runtime');mkdirSync(runtimeRoot,{mode:0o700});
  const packed=JSON.parse(await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',base],{cwd:source}));
  await execute('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',runtimeRoot,join(base,packed[0].filename)],{cwd:base});
  runtime=inspectRuntime(runtimeRoot);cli=join(runtimeRoot,'node_modules/.bin/evopilot-ontology');
});
after(()=>{if(base)rmSync(base,{recursive:true,force:true});});
const savedJSON=(file,value)=>writeFileSync(file,JSON.stringify(value)+'\n',{mode:0o600});
function fixture(t,name){
  const setup=prepareInstallation({root:join(base,name+'-install'),workspaceRoot:join(base,name+'-workspace'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot,runtimeDigest:runtime.digest,mode:'create'}),clients=[],runs=[];
  // Only the SHACL worker/manifest is copied for drift faults. The actual pinned
  // Python runtime and Java executors remain unchanged, shared read-only fixtures.
  const workerRoot=join(base,name+'-shacl');mkdirSync(workerRoot,{mode:0o700});copyFileSync(join(shacl.root,'worker.py'),join(workerRoot,'worker.py'));chmodSync(join(workerRoot,'worker.py'),0o600);
  const {digest:_,...old}=shacl,identity={...old,root:workerRoot},bound={...identity,digest:hash(identity)},shaclFile=join(workerRoot,'toolchain.json');savedJSON(shaclFile,bound);
  const dlFile=join(base,name+'-dl.json');savedJSON(dlFile,dl);
  const input={requestId:'bind-tools',previousBindingDigest:null,dl:{toolchainFile:dlFile,toolchainDigest:dl.digest},shacl:{toolchainFile:shaclFile,toolchainDigest:bound.digest}};
  const start=async()=>{const r=await startInstallation(setup.root);runs.push(r.run);return r;};
  t.after(async()=>{
    for(const c of clients)await c.close();
    await stopInstallation(setup.root);
    for(const r of runs){for(let i=0;i<60&&processPresent(r.pid)!==false;i++)await pause(50);assert.equal(processPresent(r.pid),false);rmSync(dirname(r.controlSocket),{recursive:true,force:true});}
  });
  const connect=async()=>{
    const config=JSON.parse(readFileSync(join(setup.root,'plugin/.mcp.json'),'utf8')).mcpServers['evopilot-ontology'],client=new Client({name:'installed-formal-tool-test',version:'1'});
    clients.push(client);await client.connect(new StdioClientTransport({...config,cwd:base,stderr:'pipe'}),{timeout:10000});return client;
  };
  const call=async(client,name,args={})=>{const r=await client.callTool({name,arguments:args},{timeout:15000});assert(!r.isError,JSON.stringify(r));return r.structuredContent.result;};
  const request=(operation,input={})=>({workspaceId:setup.workspaceId,serviceId:setup.serviceId,projectId:'demo',operation,input});
  return {setup,input,start,connect,call,request,workerRoot,dlFile,shaclFile};
}
function bindArgs(f,input=f.input){return ['toolchains-bind','--installation',f.setup.root,'--request-id',input.requestId,'--previous-binding',input.previousBindingDigest??'none','--dl-toolchain',input.dl.toolchainFile,'--dl-digest',input.dl.toolchainDigest,'--shacl-toolchain',input.shacl.toolchainFile,'--shacl-digest',input.shacl.toolchainDigest,'--json'];}
async function seed(f,client){
  let revision=0;
  const write=async(operation,input,requestId)=>{const request={...f.request(operation,input),requestId,expectedRevision:revision},receipt=await f.call(client,'ontology_write',request);revision=receipt.revision;return {request,receipt};};
  await write('project.create',{label:'Synthetic installed formal workflow'},'project');
  const intentDigest=(await write('intent.record',{definition,previousDigest:null},'intent')).receipt.result.intentDigest;
  const sourceSetDigest=(await write('source.admit',{intentDigest,sourceSet},'sources')).receipt.result.sourceSetDigest;
  const expectations=expected(intentDigest,sourceSetDigest),expectationsDigest=(await write('expectations.record',{definition:expectations},'expectations')).receipt.result.expectationsDigest;
  const modelDigest=(await write('model.record',{draft:model(intentDigest,sourceSetDigest,expectationsDigest)},'model')).receipt.result.modelDigest;
  return {write,modelDigest};
}
async function terminal(f,client,operation,taskId){
  const end=Date.now()+45000;
  while(Date.now()<end){const r=await f.call(client,'ontology_read',f.request(operation,{taskId}));if(r.state==='FINISHED')return r;await pause(50);}throw Error('Installed actual formal task did not finish');
}

async function transportFaults(t,f){
  const file=join(f.setup.root,'connection.json'),original=readFileSync(file),connection=JSON.parse(original),origin=new URL(connection.origin),forwarded=[],faults=[];
  let selected=null;
  // Fault injection only: forward to this fixture's exact managed loopback
  // owner, never to a remote service. No credential or response body is logged.
  const proxy=createServer((req,res)=>{
    const parts=[];let size=0;req.on('error',()=>{});
    req.on('data',part=>{size+=part.length;if(size>1024*1024)req.destroy();else parts.push(part);});
    req.on('end',()=>{
      const bytes=Buffer.concat(parts);let message;
      try{message=bytes.length?JSON.parse(bytes):{};}catch{res.destroy();return;}
      const name=message.method==='tools/call'?message.params?.name:null,operation=message.params?.arguments?.operation;
      const fault=selected&&name===selected.name&&operation===selected.operation?selected:null;
      if(fault){selected=null;faults.push(fault.mode);}
      if(fault?.mode==='drop-read'){res.destroy();return;}
      if(fault?.mode==='deny'){
        res.writeHead(403,{'content-type':'text/plain','connection':'close'});res.end('PRIVATE_RESPONSE_MUST_NOT_ESCAPE');return;
      }
      if(name)forwarded.push({name,operation,requestId:message.params.arguments?.requestId});
      const upstream=httpRequest({hostname:origin.hostname,port:origin.port,path:req.url,method:req.method,agent:false,headers:{...req.headers,host:origin.host,connection:'close'}},response=>{
        response.on('error',()=>res.destroy());
        if(fault?.mode==='drop-write-response'){response.resume();response.once('end',()=>res.destroy());}
        else{res.writeHead(response.statusCode,response.headers);response.pipe(res);}
      });
      upstream.setTimeout(10000,()=>upstream.destroy());upstream.on('error',()=>res.destroy());upstream.end(bytes);
    });
  });
  await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(0,'127.0.0.1',resolve);});
  t.after(async()=>{writeFileSync(file,original);await new Promise(resolve=>{proxy.close(resolve);proxy.closeAllConnections();});});
  savedJSON(file,{...connection,origin:`http://127.0.0.1:${proxy.address().port}`});
  return {forwarded,faults,arm(name,operation,mode){assert.equal(selected,null);selected={name,operation,mode};}};
}
function transportError(response,phase){
  assert.equal(response.isError,true);const error=response.structuredContent.error;
  assert.equal(error.code,'TRANSPORT_UNKNOWN');assert.equal(error.phase,phase);assert(error.diagnostic.length>0&&error.diagnostic.length<=3);
  assert.equal(JSON.stringify(response).includes('PRIVATE_RESPONSE_MUST_NOT_ESCAPE'),false);
  assert.deepEqual(JSON.parse(response.content[0].text),{error});return error;
}

test('sustained installed bridge reads outlive the per-socket request budget without retries',async t=>{
  const f=fixture(t,'sustained');await f.start();const client=await f.connect();
  // Each bridge call performs multiple HTTP exchanges. Cross the actual
  // server's 100-request socket budget even with two pooled connections.
  for(let n=0;n<130;n++)assert.equal((await f.call(client,'ontology_context')).serviceId,f.setup.serviceId);
});

test('compiled installed operator binds actual executors and managed MCP executes them across restart',async t=>{
  const f=fixture(t,'actual');assert.equal(inspectInstallationToolchains(f.setup.root).status,'UNCONFIGURED');
  const bound=JSON.parse(await execute(process.execPath,[cli,...bindArgs(f)],{cwd:base})).result;assert.equal(bound.replayed,false);assert.equal(bound.receipt.binding.runtimeDigest,runtime.digest);
  const first=await f.start();assert.equal(first.run.schema,'ontology-managed-run/v3');assert.equal(first.run.runtimeBindingDigest,hash(runtime));assert.equal(first.run.toolchainBindingDigest,bound.receipt.digest);
  const client=await f.connect(),context=await f.call(client,'ontology_context');assert.equal(context.reasoningExecutionConfigured,true);assert.equal(context.validationExecutionConfigured,true);assert.equal(context.toolchainDigest,dl.digest);assert.equal(context.acceptanceStatus,'EXTERNAL_EVIDENCE_REQUIRED');assert.equal(context.productVersion,'0.9.0');assert.equal(context.nativeAuthoringImplemented,true);assert.equal(context.authority,false);assert.equal(context.writeOperations.includes('toolchains-bind'),false);
  const p=await seed(f,client),v=await p.write('validation.start',{assetId:'services',modelDigest:p.modelDigest},'validate'),result=await terminal(f,client,'validation.inspect',v.receipt.result.taskId);assert.equal(result.formalStatus,'MATCHED');assert.equal(result.complete,true);
  const r=await p.write('reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task:{kind:'consistency'}},'reason');assert.equal((await terminal(f,client,'reasoning.inspect',r.receipt.result.taskId)).formalStatus,'COMPLETED');
  const repeated=bindInstallationToolchains(f.setup.root,f.input);assert.deepEqual(repeated.receipt,bound.receipt);assert.equal(repeated.replayed,true);
  assert.throws(()=>bindInstallationToolchains(f.setup.root,{...f.input,requestId:'replace',previousBindingDigest:bound.receipt.digest}),{code:'INSTALLATION_RUNNING'});
  const inspected=JSON.parse(await execute(process.execPath,[cli,'toolchains-inspect','--installation',f.setup.root,'--json'],{cwd:base})).result;assert.equal(inspected.status,'VERIFIED');assert.equal(inspected.bindingDigest,bound.receipt.digest);
  await stopInstallation(f.setup.root);const second=await f.start();assert.notEqual(first.run.runId,second.run.runId);assert.equal(second.run.toolchainBindingDigest,bound.receipt.digest);
  assert.deepEqual(await f.call(client,'ontology_write',v.request),v.receipt);assert.equal((await f.call(client,'ontology_read',f.request('validation.inspect',{taskId:v.receipt.result.taskId}))).resultDigest,result.resultDigest);
});

test('installed bridge diagnoses lost reads and reconciles a committed write by its original receipt without redispatch',async t=>{
  const f=fixture(t,'transport');bindInstallationToolchains(f.setup.root,f.input);await f.start();const client=await f.connect(),p=await seed(f,client);
  const v=await p.write('validation.start',{assetId:'services',modelDigest:p.modelDigest},'validate'),proxy=await transportFaults(t,f);
  proxy.arm('ontology_read','validation.inspect','drop-read');
  const failed=await client.callTool({name:'ontology_read',arguments:f.request('validation.inspect',{taskId:v.receipt.result.taskId})},{timeout:15000});
  const error=transportError(failed,'CALL');assert(error.diagnostic.some(d=>['UND_ERR_SOCKET','ECONNRESET'].includes(d.code)));
  // An explicit read of the same known task is recovery, not a replacement
  // validation request. Ordinary polling still fails on any unexpected error.
  assert.equal((await terminal(f,client,'validation.inspect',v.receipt.result.taskId)).formalStatus,'MATCHED');
  const validations=await f.call(client,'ontology_read',f.request('validation.list',{assetId:'services',afterTaskId:null,limit:10}));
  assert.deepEqual(validations.tasks.map(r=>r.taskId),[v.receipt.result.taskId]);assert.equal(validations.nextCursor,null);
  assert.deepEqual(await f.call(client,'ontology_read',f.request('receipt.read',{requestId:'validate'})),v.receipt);

  const request={...f.request('reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task:{kind:'consistency'}}),requestId:'lost-reason-response',expectedRevision:v.receipt.revision};
  proxy.arm('ontology_write','reasoning.start','drop-write-response');
  transportError(await client.callTool({name:'ontology_write',arguments:request},{timeout:15000}),'CALL');
  const receipt=await f.call(client,'ontology_read',f.request('receipt.read',{requestId:request.requestId}));
  assert.equal(receipt.revision,v.receipt.revision+1);assert.equal((await terminal(f,client,'reasoning.inspect',receipt.result.taskId)).formalStatus,'COMPLETED');
  const tasks=await f.call(client,'ontology_read',f.request('reasoning.list',{assetId:'services',afterTaskId:null,limit:10}));
  assert.deepEqual(tasks.tasks.map(r=>r.taskId),[receipt.result.taskId]);assert.equal(tasks.nextCursor,null);
  assert.deepEqual(proxy.forwarded.filter(r=>r.name==='ontology_write'),[{name:'ontology_write',operation:'reasoning.start',requestId:request.requestId}]);

  proxy.arm('ontology_context',undefined,'deny');
  const denied=transportError(await client.callTool({name:'ontology_context',arguments:{}},{timeout:15000}),'CONTEXT');
  assert(denied.diagnostic.some(d=>d.httpStatus===403));assert.deepEqual(proxy.faults,['drop-read','drop-write-response','deny']);
  assert.equal((await f.call(client,'ontology_context')).serviceId,f.setup.serviceId);
});

test('operator receipts preserve history, reject changed replay and require exact current parent',async t=>{
  const f=fixture(t,'receipts'),first=bindInstallationToolchains(f.setup.root,f.input);
  assert.throws(()=>bindInstallationToolchains(f.setup.root,{...f.input,previousBindingDigest:first.receipt.digest}),{code:'REQUEST_CONFLICT'});
  assert.throws(()=>bindInstallationToolchains(f.setup.root,{...f.input,requestId:'wrong-parent'}),{code:'TOOLCHAIN_BINDING_CONFLICT'});
  const next=bindInstallationToolchains(f.setup.root,{...f.input,requestId:'rebind',previousBindingDigest:first.receipt.digest});assert.notEqual(next.receipt.digest,first.receipt.digest);assert.equal(next.receipt.binding.previousDigest,first.receipt.digest);
  const replay=bindInstallationToolchains(f.setup.root,f.input);assert.deepEqual(replay.receipt,first.receipt);assert.equal(replay.currentBindingDigest,next.receipt.digest);
  const ledgerFile=join(f.setup.root,'toolchain-bindings.json'),bytes=readFileSync(ledgerFile),ledger=JSON.parse(bytes);assert.equal(ledger.records.length,2);assert.equal((await f.start()).run.toolchainBindingDigest,next.receipt.digest);
  await stopInstallation(f.setup.root);ledger.records.pop();savedJSON(ledgerFile,ledger);
  try{await assert.rejects(f.start(),{code:'TOOLCHAIN_BINDING_MISSING'});}finally{writeFileSync(ledgerFile,bytes);}
});

test('wrong digest, package source mismatch and live foreground owner cannot change bindings',async t=>{
  const f=fixture(t,'refuse');assert.throws(()=>bindInstallationToolchains(f.setup.root,{...f.input,dl:{...f.input.dl,toolchainDigest:hash('wrong')}}),{code:'TOOLCHAIN_BINDING_DRIFT'});assert.equal(existsSync(join(f.setup.root,'toolchain-bindings.json')),false);
  const {digest:_,...identity}=dl,wrong={...identity,workerSourceDigest:hash('different-worker')},forged={...wrong,digest:hash(wrong)};savedJSON(f.dlFile,forged);
  assert.throws(()=>bindInstallationToolchains(f.setup.root,{...f.input,dl:{...f.input.dl,toolchainDigest:forged.digest}}),{code:'PACKAGE_TOOLCHAIN_MISMATCH'});savedJSON(f.dlFile,dl);
  const live=createStandaloneService({root:f.setup.workspaceRoot,workspaceId:f.setup.workspaceId,serviceId:f.setup.serviceId});
  try{assert.throws(()=>bindInstallationToolchains(f.setup.root,f.input),{code:'WORKSPACE_BUSY'});}finally{await live.close();}
  assert.equal(existsSync(join(f.setup.root,'toolchain-bindings.json')),false);
});

test('worker drift or missing bound manifest fails before launch and never falls back to unconfigured service',async t=>{
  const f=fixture(t,'drift'),bound=bindInstallationToolchains(f.setup.root,f.input),worker=join(f.workerRoot,'worker.py'),original=readFileSync(worker);
  try{writeFileSync(worker,Buffer.concat([original,Buffer.from('\n# deliberate isolated drift\n')]));await assert.rejects(f.start(),{code:'TOOLCHAIN_DRIFT'});assert.equal(existsSync(join(f.setup.root,'current-run.json')),false);}finally{writeFileSync(worker,original);}
  const manifest=readFileSync(f.shaclFile);rmSync(f.shaclFile);
  try{await assert.rejects(f.start());assert.equal(existsSync(join(f.setup.root,'current-run.json')),false);assert.deepEqual(bindInstallationToolchains(f.setup.root,f.input).receipt,bound.receipt);}finally{writeFileSync(f.shaclFile,manifest,{mode:0o600});}
  assert.equal((await f.start()).run.toolchainBindingDigest,bound.receipt.digest);
});

test('owned empty work-directory interruption resumes while foreign marker or corrupted ledger is refused',async t=>{
  const f=fixture(t,'workdir'),work=join(f.setup.root,'formal-work');mkdirSync(work,{mode:0o700});const bound=bindInstallationToolchains(f.setup.root,f.input),marker=join(work,'owner.json'),original=readFileSync(marker);
  savedJSON(marker,{foreign:true});try{await assert.rejects(f.start(),{code:'WORK_ROOT_CONFLICT'});}finally{writeFileSync(marker,original);}
  const ledgerFile=join(f.setup.root,'toolchain-bindings.json'),ledgerBytes=readFileSync(ledgerFile),ledger=JSON.parse(ledgerBytes);ledger.records[0].binding.requestDigest=hash('forged');ledger.records[0].digest=hash(ledger.records[0].binding);savedJSON(ledgerFile,ledger);
  try{assert.throws(()=>inspectInstallationToolchains(f.setup.root),{code:'TOOLCHAIN_BINDING_CORRUPT'});await assert.rejects(f.start(),{code:'TOOLCHAIN_BINDING_CORRUPT'});}finally{writeFileSync(ledgerFile,ledgerBytes);}
  assert.equal(inspectInstallationToolchains(f.setup.root).bindingDigest,bound.receipt.digest);
});

test('missing binding history cannot become an unconfigured launch or a replacement first binding',async t=>{
  const f=fixture(t,'lost-history'),bound=bindInstallationToolchains(f.setup.root,f.input),ledgerFile=join(f.setup.root,'toolchain-bindings.json'),original=readFileSync(ledgerFile);
  rmSync(ledgerFile);
  try{
    await assert.rejects(f.start(),{code:'TOOLCHAIN_BINDING_MISSING'});assert.equal(existsSync(join(f.setup.root,'current-run.json')),false);
    assert.throws(()=>bindInstallationToolchains(f.setup.root,{...f.input,requestId:'replacement-first'}),{code:'TOOLCHAIN_BINDING_MISSING'});
  }finally{writeFileSync(ledgerFile,original,{mode:0o600});}
  // Simulate a crash after the binding receipt committed but before creation of
  // its otherwise empty worker directory. Explicit start resumes that owned setup.
  rmSync(join(f.setup.root,'formal-work'),{recursive:true});const first=await f.start();assert.equal(first.run.toolchainBindingDigest,bound.receipt.digest);await stopInstallation(f.setup.root);
  rmSync(ledgerFile);rmSync(join(f.setup.root,'formal-work'),{recursive:true});
  try{
    await assert.rejects(f.start(),{code:'TOOLCHAIN_BINDING_MISSING'});
    assert.throws(()=>inspectInstallationToolchains(f.setup.root),{code:'TOOLCHAIN_BINDING_MISSING'});
    assert.throws(()=>bindInstallationToolchains(f.setup.root,{...f.input,requestId:'lost-history-replacement'}),{code:'TOOLCHAIN_BINDING_MISSING'});
  }finally{writeFileSync(ledgerFile,original,{mode:0o600});}
});

test('a retained interrupted task blocks replacement without being cleared or redispatched',async t=>{
  const f=fixture(t,'barrier'),bound=bindInstallationToolchains(f.setup.root,f.input);await f.start();const client=await f.connect(),p=await seed(f,client),r=await p.write('reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task:{kind:'consistency'}},'reason');await terminal(f,client,'reasoning.inspect',r.receipt.result.taskId);await stopInstallation(f.setup.root);
  const db=new DatabaseSync(join(f.setup.workspaceRoot,'ontology.sqlite'));db.prepare("UPDATE native_reasoning_tasks SET state='INTERRUPTED' WHERE id=?").run(r.receipt.result.taskId);
  try{
    assert.throws(()=>bindInstallationToolchains(f.setup.root,{...f.input,requestId:'unsafe-rebind',previousBindingDigest:bound.receipt.digest}),{code:'TASK_RECOVERY_REQUIRED'});
    assert.equal(db.prepare('SELECT state FROM native_reasoning_tasks WHERE id=?').get(r.receipt.result.taskId).state,'INTERRUPTED');assert.equal(JSON.parse(readFileSync(join(f.setup.root,'toolchain-bindings.json'),'utf8')).records.length,1);
  }finally{db.prepare("UPDATE native_reasoning_tasks SET state='FINISHED' WHERE id=?").run(r.receipt.result.taskId);db.close();}
});
