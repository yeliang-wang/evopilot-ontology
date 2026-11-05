import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,readFileSync,writeFileSync,rmSync,mkdirSync,statSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {inspectRuntime} from '../../dist/installation/runtime.js';
import {prepareInstallation,inspectInstallation,startInstallation,stopInstallation} from '../../dist/installation/manager.js';
import {processPresent,operatorRequest} from '../../dist/installation/control.js';
import {readConnection,sendRequest} from '../../dist/standalone/client.js';

const source=fileURLToPath(new URL('../..',import.meta.url));
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:30000,maxBuffer:2*1024*1024,...options},(error,stdout,stderr)=>error?reject(new Error(`${file} failed: ${error.code}\n${stdout}\n${stderr}`)):resolve(stdout)));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let base,runtime,runtimeRoot,installedCli;
before(async()=>{
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-installed-')));runtimeRoot=join(base,'runtime');mkdirSync(runtimeRoot,{mode:0o700});
  const packed=JSON.parse(await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',base],{cwd:source}));
  await execute('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',runtimeRoot,join(base,packed[0].filename)],{cwd:base});
  runtime=inspectRuntime(runtimeRoot);installedCli=join(runtimeRoot,'node_modules/.bin/evopilot-ontology');
});
after(()=>{if(base)rmSync(base,{recursive:true,force:true});});

async function fixture(t,name){
  const input={root:join(base,name+'-installation'),workspaceRoot:join(base,name+'-state'),workspaceId:name,projectId:'demo',principalId:'operator',runtimeRoot,runtimeDigest:runtime.digest,mode:'create'};
  const installation=prepareInstallation(input),clients=[],runs=[];
  const start=async()=>{const r=await startInstallation(input.root);runs.push(r.run);return r;};
  t.after(async()=>{
    for(const client of clients)await client.close();
    try{await stopInstallation(input.root);}finally{
      for(const run of runs){
        if(run.pid&&processPresent(run.pid)!==false){for(let i=0;i<40&&processPresent(run.pid)!==false;i++)await pause(50);}
        if(processPresent(run.pid)===false)rmSync(dirname(run.controlSocket),{recursive:true,force:true});
      }
    }
  });
  const connectionFile=join(input.root,'connection.json');
  const request=(operation,input={},extra={})=>({workspaceId:installation.workspaceId,serviceId:installation.serviceId,projectId:'demo',operation,input,...extra});
  const http=(operation,input={},extra={})=>sendRequest(readConnection(connectionFile),request(operation,input,extra),Boolean(extra.requestId));
  const connect=async(mode='legacy')=>{
    const config=JSON.parse(readFileSync(join(input.root,'plugin/.mcp.json'),'utf8')).mcpServers['evopilot-ontology'];
    const transport=new StdioClientTransport({...config,cwd:base,stderr:'pipe'}),client=new Client({name:'installed-bridge-test',version:'0'},{versionNegotiation:{mode}});
    clients.push(client);await client.connect(transport,{timeout:5000});return client;
  };
  const call=(client,name,args={})=>client.callTool({name,arguments:args},{timeout:12000});
  const read=(client,operation,input={})=>call(client,'ontology_read',request(operation,input));
  return {input,installation,clients,runs,start,connectionFile,request,http,connect,call,read};
}
const value=response=>{assert.notEqual(response.isError,true,JSON.stringify(response));return response.structuredContent.result;};

test('installed operator creates isolated exact setup and private plugin without embedding a token',async t=>{
  const f=await fixture(t,'setup');
  assert.deepEqual(prepareInstallation(f.input),f.installation);
  const plugin=join(f.input.root,'plugin/.mcp.json'),config=JSON.parse(readFileSync(plugin,'utf8'));
  assert.equal(statSync(plugin).mode&0o777,0o600);
  assert.equal(config.mcpServers['evopilot-ontology'].command,process.execPath);
  assert.ok(!readFileSync(plugin,'utf8').includes(readFileSync(f.installation.credentialFile,'utf8')));
  assert.equal(readFileSync(join(f.input.root,'plugin/skills/evopilot-ontology-expert/SKILL.md'),'utf8'),readFileSync(join(runtime.packageRoot,'src/expert/SKILL.md'),'utf8'));
  assert.equal((await inspectInstallation(f.input.root)).observed,'STOPPED');
  assert.throws(()=>prepareInstallation({...f.input,projectId:'foreign'}),{code:'SETUP_CONFLICT'});
  assert.throws(()=>prepareInstallation({...f.input,root:join(base,'occupied')}),{code:'WORKSPACE_EXISTS'});
  assert.throws(()=>prepareInstallation({...f.input,root:join(base,'wrong-attach'),mode:'attach',serviceId:'foreign'}),{code:'IDENTITY_MISMATCH'});
  assert.throws(()=>prepareInstallation({...f.input,root:join(base,'wrong-principal'),principalId:'foreign',mode:'attach',serviceId:f.installation.serviceId}),{code:'FORBIDDEN'});
  const foreign=join(base,'foreign-installation');mkdirSync(foreign,{mode:0o700});writeFileSync(join(foreign,'keep.txt'),'Unrelated data',{mode:0o600});
  assert.throws(()=>prepareInstallation({...f.input,root:foreign}),{code:'INSTALLATION_EXISTS'});assert.equal(readFileSync(join(foreign,'keep.txt'),'utf8'),'Unrelated data');
  const alias=join(base,'runtime-alias');symlinkSync(runtimeRoot,alias);
  assert.throws(()=>prepareInstallation({...f.input,root:join(alias,'nested-installation')}),{code:'UNSAFE_PATH'});
  assert.equal(existsSync(join(runtimeRoot,'nested-installation')),false);
  for(const parent of [runtimeRoot,f.input.workspaceRoot]){
    const nested=join(parent,'..installation');
    assert.throws(()=>prepareInstallation({...f.input,root:nested}),{code:'UNSAFE_PATH'});
    assert.equal(existsSync(nested),false,'Double-dot-prefixed child names remain inside their parent');
  }
  const nestedState=join(runtimeRoot,'..workspace');
  assert.throws(()=>prepareInstallation({...f.input,root:join(base,'new-owner'),workspaceRoot:nestedState}),{code:'UNSAFE_PATH'});
  assert.equal(existsSync(nestedState),false);
  // Resume an interrupted final manifest write against the original exact workspace identity.
  rmSync(join(f.input.root,'installation.json'));
  assert.deepEqual(prepareInstallation(f.input),f.installation);
  const attached=prepareInstallation({...f.input,root:join(base,'explicit-attach'),mode:'attach',serviceId:f.installation.serviceId});
  assert.equal(attached.serviceId,f.installation.serviceId);assert.notEqual(attached.installationId,f.installation.installationId);
  const inspect=JSON.parse(await execute(process.execPath,[installedCli,'runtime-inspect','--runtime-root',runtimeRoot,'--json'],{cwd:base}));
  assert.deepEqual(inspect.result,runtime);
});

for(const mode of ['legacy','auto'])test('installed private bridge '+mode+' shares HTTP receipts and survives managed restart',async t=>{
  const f=await fixture(t,'bridge-'+mode),first=await f.start();
  assert.equal(first.observed,'RUNNING');assert.equal(first.reused,false);
  const again=await f.start();assert.equal(again.reused,true);assert.equal(again.run.runId,first.run.runId);assert.equal(again.run.pid,first.run.pid);
  const client=await f.connect(mode),list=await client.listTools(undefined,{cacheMode:'bypass',timeout:10000});
  assert.deepEqual(list.tools.map(x=>x.name).sort(),['ontology_context','ontology_read','ontology_write']);
  const context=value(await f.call(client,'ontology_context'));assert.equal(context.serviceId,f.installation.serviceId);assert.equal(context.acceptanceStatus,'EXTERNAL_EVIDENCE_REQUIRED');
  if(mode==='auto')assert.ok(client.getDiscoverResult());
  const write=f.request('project.create',{label:'Installed bridge project'},{requestId:'create',expectedRevision:0});
  const receipt=value(await f.call(client,'ontology_write',write));assert.equal(receipt.revision,1);
  assert.deepEqual(await f.http('receipt.read',{requestId:'create'}),receipt);
  const cli=JSON.parse(await execute(process.execPath,[installedCli,'context','--connection',f.connectionFile,'--json'],{cwd:base}));assert.equal(cli.result.project.revision,1);
  assert.equal((await stopInstallation(f.input.root)).observed,'STOPPED');
  assert.equal((await f.call(client,'ontology_write',write)).isError,true);
  const second=await f.start();assert.notEqual(second.run.runId,first.run.runId);
  assert.deepEqual(value(await f.read(client,'receipt.read',{requestId:'create'})),receipt);
  assert.deepEqual(value(await f.call(client,'ontology_write',write)),receipt);
  assert.equal(value(await f.read(client,'project.inspect')).revision,1);
  await client.close();assert.equal((await inspectInstallation(f.input.root)).observed,'RUNNING');
});

test('managed process death is observed and a new run retains committed receipts',async t=>{
  const f=await fixture(t,'crash'),first=await f.start();
  const receipt=await f.http('project.create',{label:'Retain after actual process kill'},{requestId:'committed',expectedRevision:0});
  process.kill(first.run.pid,'SIGKILL');
  for(let i=0;i<80&&processPresent(first.run.pid)!==false;i++)await pause(50);
  assert.equal(processPresent(first.run.pid),false);assert.equal((await inspectInstallation(f.input.root)).observed,'DEAD');
  const second=await f.start();assert.notEqual(first.run.runId,second.run.runId);
  assert.deepEqual(await f.http('receipt.read',{requestId:'committed'}),receipt);
  await assert.rejects(operatorRequest({...second.run,runId:first.run.runId},'stop'));
  assert.equal((await inspectInstallation(f.input.root)).observed,'RUNNING');
});

test('bridge rechecks private connection identity, current credential and permissions',async t=>{
  const f=await fixture(t,'auth');await f.start();const client=await f.connect();
  value(await f.call(client,'ontology_write',f.request('project.create',{label:'Auth'},{requestId:'create',expectedRevision:0})));
  const connection=readFileSync(f.connectionFile,'utf8');
  writeFileSync(f.connectionFile,JSON.stringify({...JSON.parse(connection),serviceId:'foreign'}));
  assert.equal((await f.read(client,'project.inspect')).isError,true);
  writeFileSync(f.connectionFile,connection);
  const path=join(f.input.workspaceRoot,'credentials.json'),credentials=JSON.parse(readFileSync(path,'utf8'));
  credentials.grants[0].permissions=['read'];writeFileSync(path,JSON.stringify(credentials));
  assert.deepEqual(value(await f.call(client,'ontology_context')).writeOperations,[]);
  assert.equal((await f.call(client,'ontology_write',f.request('project.create',{label:'Auth'},{requestId:'create',expectedRevision:0}))).isError,true);
  assert.equal(value(await f.read(client,'receipt.read',{requestId:'create'})).revision,1);
  credentials.grants[0].revoked=true;writeFileSync(path,JSON.stringify(credentials));
  assert.equal((await f.call(client,'ontology_context')).isError,true);
  await assert.rejects(client.listTools(undefined,{cacheMode:'bypass',timeout:10000}));
});

test('changed installed runtime is refused before launching a process',async t=>{
  const f=await fixture(t,'drift'),path=join(runtime.packageRoot,'dist/standalone/bridge.js'),original=readFileSync(path);
  try{
    writeFileSync(path,Buffer.concat([original,Buffer.from('\n// synthetic drift\n')]));
    await assert.rejects(startInstallation(f.input.root),{code:'RUNTIME_CHANGED'});
    assert.equal(existsSync(join(f.input.root,'current-run.json')),false);
  }finally{writeFileSync(path,original);}
  assert.equal(inspectRuntime(runtimeRoot).digest,runtime.digest);
});
