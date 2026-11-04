import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,rmSync,lstatSync,readdirSync,readlinkSync,renameSync,symlinkSync,linkSync,unlinkSync,chmodSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';

const source=fileURLToPath(new URL('../..',import.meta.url));
let base,runtimeRoot,runtime,cliFile,bridgeFile,readConnection,sendRequest,hashBytes,processPresent;
const owners=new Set();
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:60000,maxBuffer:4*1024*1024,...options},(error,stdout,stderr)=>error?reject(Error(`${file}: ${error.code}\n${stdout}\n${stderr}`)):resolve(stdout)));
before(async()=>{
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-reviewer-connection-')));runtimeRoot=join(base,'runtime');mkdirSync(runtimeRoot,{mode:0o700});
  const packed=JSON.parse(await execute('npm',['pack','--ignore-scripts','--json','--pack-destination',base],{cwd:source}));
  await execute('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',runtimeRoot,join(base,packed[0].filename)],{cwd:base});
  const installed=join(runtimeRoot,'node_modules/@evopilot-next/ontology'),load=name=>import(pathToFileURL(join(installed,'dist',name+'.js')));
  cliFile=join(installed,'dist/standalone/cli.js');bridgeFile=join(installed,'dist/standalone/bridge.js');
  ({readConnection,sendRequest}=await load('standalone/client'));({hashBytes}=await load('standalone/validation'));({processPresent}=await load('installation/control'));
  runtime=await success(['runtime-inspect','--runtime-root',runtimeRoot,'--json']);
});
after(async()=>{
  const failures=[];
  for(const f of owners)try{await finish(f);}catch(error){failures.push(error);}
  if(failures.length)throw new AggregateError(failures,'Managed owner exit was not proven; private fixtures were preserved');
  if(base)rmSync(base,{recursive:true,force:true});
});
function raw(args){return new Promise((resolve,reject)=>execFile(process.execPath,[cliFile,...args],{cwd:base,timeout:30000,maxBuffer:2*1024*1024,env:{...process.env,NODE_NO_WARNINGS:'1'}},(error,stdout,stderr)=>{
  if(error?.signal||error&&typeof error.code!=='number'){reject(Error('CLI process did not return a determinate result: '+String(error)));return;}
  try{resolve({exitCode:error?.code??0,body:JSON.parse(stdout),stdout,stderr});}catch{reject(Error('CLI did not return one JSON response: '+stderr));}
}));}
async function success(args){const r=await raw(args);assert.equal(r.exitCode,0,r.stdout);assert.equal(r.body.ok,true,r.stdout);return r.body.result;}
function failed(r,code){assert.equal(r.exitCode,1,r.stdout);assert.equal(r.body.ok,false,r.stdout);assert.equal(r.body.error.code,code,r.stdout);}
const command=(f,name)=>[name,'--installation',f.i.root,'--json'];
const connectionArgs=(f,grantId=f.grant.grantId)=>['reviewer-connection','--installation',f.i.root,'--grant-id',grantId,'--json'];
const connectionPath=(f,grantId=f.grant.grantId)=>join(f.i.root,'reviewer-connection-'+grantId+'.json');
const issuancePath=(f,grantId=f.grant.grantId)=>join(f.i.workspaceRoot,'reviewer-grant-'+grantId+'.json');
const tokenPath=(f,grantId=f.grant.grantId)=>join(f.i.workspaceRoot,'reviewer-token-'+grantId);
const readJSON=path=>JSON.parse(readFileSync(path,'utf8'));
function node(path){
  let s;try{s=lstatSync(path,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}
  return {device:String(s.dev),inode:String(s.ino),mode:Number(s.mode&0o777n),links:String(s.nlink),bytes:String(s.size),mtime:String(s.mtimeNs),ctime:String(s.ctimeNs),
    content:s.isSymbolicLink()?{link:readlinkSync(path)}:s.isFile()?{digest:hashBytes(readFileSync(path))}:null};
}
function protectedState(f,extra=[]){
  const paths=[f.i.credentialFile,f.authorFile,join(f.i.workspaceRoot,'credentials.json'),join(f.i.workspaceRoot,'identity.json'),issuancePath(f),tokenPath(f),connectionPath(f),...extra];
  return {files:[...new Set(paths)].sort().map(path=>[path,node(path)]),connections:readdirSync(f.i.root).filter(n=>n.startsWith('reviewer-connection-')).sort()};
}
async function rejectedUnchanged(f,args,code,extra=[]){const before=protectedState(f,extra),r=await raw(args);failed(r,code);assert.deepEqual(protectedState(f,extra),before,'Refusal must preserve existing credential and connection material');return r;}
async function stopped(f){const r=await success(command(f,'stop'));assert.equal(r.observed,'STOPPED');return r;}
async function finish(f){
  for(const client of f.clients)await client.close();f.clients.clear();
  const stop=await stopped(f);assert.equal((await success(command(f,'installation-inspect'))).observed,'STOPPED');
  const until=performance.now()+5000;
  while(stop.run?.pid&&processPresent(stop.run.pid)!==false&&performance.now()<until)await delay(25);
  if(stop.run?.pid)assert.equal(processPresent(stop.run.pid),false,'Do not remove a live managed owner fixture');
  for(const run of f.runs)if(processPresent(run.pid)===false)rmSync(dirname(run.controlSocket),{recursive:true,force:true});
  owners.delete(f);
}
async function fixture(t,name,{start=true,extraGrants=[]}={}){
  const i=await success(['install','--root',join(base,name+'-installation'),'--workspace-root',join(base,name+'-workspace'),'--workspace',name,'--project','demo','--principal','author','--runtime-root',runtimeRoot,'--runtime-digest',runtime.digest,'--mode','create','--port','0','--json']);
  const f={i,authorFile:join(i.root,'connection.json'),clients:new Set(),runs:[],grant:null,extraGrants:new Map()};owners.add(f);t.after(()=>finish(f));
  f.issue=async(grantId='reviewer')=>success(['reviewer-grant','--root',i.workspaceRoot,'--workspace',i.workspaceId,'--service',i.serviceId,'--project',i.projectId,'--principal','reviewer-'+grantId,'--grant-id',grantId,'--expires-at',f.expiresAt,'--json']);
  f.expiresAt=new Date(Date.now()+86400000).toISOString();f.grant=await f.issue();
  for(const id of extraGrants)f.extraGrants.set(id,await f.issue(id));
  f.request=(operation,input={},extra={})=>({workspaceId:i.workspaceId,serviceId:i.serviceId,projectId:i.projectId,operation,input,...extra});
  f.http=(file,operation,input={},extra={})=>sendRequest(readConnection(file),f.request(operation,input,extra),Object.hasOwn(extra,'requestId'));
  f.start=async()=>{const r=await success(command(f,'start'));assert.equal(r.observed,'RUNNING');f.runs.push(r.run);return r;};
  f.connect=async file=>{
    const client=new Client({name:'installed-reviewer-connection-test',version:'0'},{versionNegotiation:{mode:'legacy'}});f.clients.add(client);
    await client.connect(new StdioClientTransport({command:process.execPath,args:[bridgeFile,'--connection',file],cwd:base,stderr:'pipe'}),{timeout:5000});return client;
  };
  f.call=(client,name,args={})=>client.callTool({name,arguments:args},{timeout:12000});
  if(start){await f.start();f.receipt=await f.http(f.authorFile,'project.create',{label:'Synthetic connection permissions'},{requestId:'create',expectedRevision:0});assert.equal(f.receipt.revision,1);}
  return f;
}
const value=response=>{assert.notEqual(response.isError,true,JSON.stringify(response));return response.structuredContent.result;};
async function ready(f){
  const r=await success(connectionArgs(f)),c=readConnection(r.connectionFile);
  assert.equal(r.status,'READY');assert.equal(r.observed,'RUNNING');assert.equal(r.installationId,f.i.installationId);assert.equal(r.workspaceId,f.i.workspaceId);assert.equal(r.serviceId,f.i.serviceId);
  assert.equal(r.grantId,f.grant.grantId);assert.equal(r.principalId,f.grant.principalId);assert.equal(r.projectId,f.i.projectId);assert.deepEqual(r.permissions,['read','review']);assert.equal(r.expiresAt,f.grant.expiresAt);
  assert.equal(r.connectionFile,connectionPath(f));assert.equal(r.connectionDigest,hashBytes(readFileSync(r.connectionFile)));assert.equal(r.origin,c.origin);assert.equal(r.authorityScope,'MODEL_SEMANTICS_ONLY');assert.equal(r.authority,false);
  assert.deepEqual(c,{schema:'ontology-connection/v1',origin:readConnection(f.authorFile).origin,workspaceId:f.i.workspaceId,serviceId:f.i.serviceId,projectId:f.i.projectId,credentialFile:f.grant.credentialFile});
  assert.equal(lstatSync(r.connectionFile).mode&0o777,0o600);
  for(const secret of [readFileSync(f.i.credentialFile,'utf8'),readFileSync(f.grant.credentialFile,'utf8')])assert.equal(JSON.stringify(r).includes(secret),false);
  return r;
}
async function businessUnchanged(f){
  assert.equal((await f.http(f.authorFile,'project.inspect')).revision,1);
  assert.deepEqual(await f.http(f.authorFile,'receipt.read',{requestId:'create'}),f.receipt);
  assert.deepEqual((await f.http(f.authorFile,'review.list',{assetId:'services',afterDigest:null,limit:10})).records,[]);
  assert.deepEqual((await f.http(f.authorFile,'delivery.list',{assetId:'services',afterDigest:null,limit:10})).records,[]);
}

test('installed reviewer connection exposes independent read/review authority over actual HTTP and official MCP without a semantic decision',async t=>{
  const f=await fixture(t,'review-access'),author=[node(f.i.credentialFile),node(f.authorFile)],issued=[node(issuancePath(f)),node(tokenPath(f)),node(join(f.i.workspaceRoot,'credentials.json'))];
  const first=await ready(f);assert.equal(first.reused,false);assert.equal(first.runId,f.runs.at(-1).runId);
  const before=node(first.connectionFile),again=await ready(f);assert.equal(again.reused,true);assert.equal(again.runId,first.runId);assert.deepEqual(node(first.connectionFile),before,'Repeated selection must not rewrite the same connection');
  assert.deepEqual([node(f.i.credentialFile),node(f.authorFile)],author);assert.deepEqual([node(issuancePath(f)),node(tokenPath(f)),node(join(f.i.workspaceRoot,'credentials.json'))],issued);
  const reviewer=await f.connect(first.connectionFile),authorMcp=await f.connect(f.authorFile);
  assert.deepEqual((await reviewer.listTools()).tools.map(x=>x.name).sort(),['ontology_context','ontology_read','ontology_write']);
  const context=value(await f.call(reviewer,'ontology_context'));assert.equal(context.principalId,f.grant.principalId);assert.deepEqual(context.projectIds,['demo']);assert.deepEqual(context.permissions,['read','review']);assert.deepEqual(context.writeOperations,['review.decide']);
  assert.equal(value(await f.call(authorMcp,'ontology_context')).writeOperations.includes('review.decide'),false);
  assert.deepEqual((await success(['context','--connection',first.connectionFile,'--json'])).writeOperations,['review.decide']);
  assert.equal((await f.http(first.connectionFile,'project.inspect')).revision,1);
  assert.deepEqual(value(await f.call(reviewer,'ontology_read',f.request('review.list',{assetId:'services',afterDigest:null,limit:10}))).records,[]);
  // Deliberately incomplete inputs establish which permission gate is reached.
  // No candidate, decision, rationale or user approval is manufactured.
  const review=f.request('review.decide',{}, {requestId:'invalid-review',expectedRevision:1});
  assert.equal((await f.call(authorMcp,'ontology_write',review)).structuredContent.error.code,'FORBIDDEN');
  assert.equal((await f.call(reviewer,'ontology_write',review)).structuredContent.error.code,'INVALID_INPUT');
  await assert.rejects(f.http(f.authorFile,'review.decide',{}, {requestId:'author-review',expectedRevision:1}),{code:'FORBIDDEN'});
  await assert.rejects(f.http(f.authorFile,'reviewer.grant'),{code:'UNSUPPORTED_OPERATION'},'Operator issuance is not an author HTTP operation');
  await assert.rejects(f.http(first.connectionFile,'review.decide',{}, {requestId:'http-invalid-review',expectedRevision:1}),{code:'INVALID_INPUT'});
  for(const operation of ['project.create','intent.record','review.prepare','delivery.record']){
    const request=f.request(operation,{}, {requestId:'denied-'+operation,expectedRevision:1});
    assert.equal((await f.call(reviewer,'ontology_write',request)).structuredContent.error.code,'FORBIDDEN');
    await assert.rejects(f.http(first.connectionFile,operation,{}, {requestId:'http-denied-'+operation,expectedRevision:1}),{code:'FORBIDDEN'});
  }
  await assert.rejects(f.http(first.connectionFile,'receipt.read',{requestId:'create'}),{code:'NOT_FOUND'},'An author receipt does not become a reviewer receipt');
  for(const requestId of ['invalid-review','http-invalid-review'])await assert.rejects(f.http(first.connectionFile,'receipt.read',{requestId}),{code:'NOT_FOUND'});
  await businessUnchanged(f);assert.deepEqual([node(f.i.credentialFile),node(f.authorFile)],author);
});

test('port-zero restart refreshes the same reviewer connection while its existing official MCP client follows the new owner',async t=>{
  const f=await fixture(t,'review-restart'),first=await ready(f),client=await f.connect(first.connectionFile),credential=node(f.i.credentialFile),issuance=node(issuancePath(f)),token=node(tokenPath(f));
  assert.equal(value(await f.call(client,'ontology_read',f.request('project.inspect'))).revision,1);
  await stopped(f);await rejectedUnchanged(f,connectionArgs(f),'INSTALLATION_NOT_RUNNING');
  // Occupying only the departed loopback listener guarantees an actual port
  // change without relying on the OS choosing a different ephemeral port.
  const blocker=createServer();blocker.listen(Number(new URL(first.origin).port),'127.0.0.1');await once(blocker,'listening');
  try{
    const next=await f.start();assert.notEqual(next.run.runId,first.runId);
    const authorConnection=node(f.authorFile),second=await ready(f);assert.equal(second.connectionFile,first.connectionFile);assert.notEqual(second.origin,first.origin);assert.equal(second.runId,next.run.runId);assert.equal(second.reused,false);
    assert.deepEqual(node(f.authorFile),authorConnection,'Reviewer refresh does not rewrite the managed author connection');
    assert.deepEqual([node(f.i.credentialFile),node(issuancePath(f)),node(tokenPath(f))],[credential,issuance,token]);
    assert.equal(value(await f.call(client,'ontology_read',f.request('project.inspect'))).revision,1);await businessUnchanged(f);
    const stable=node(second.connectionFile);assert.equal((await ready(f)).reused,true);assert.deepEqual(node(second.connectionFile),stable);
  }finally{await new Promise((resolve,reject)=>blocker.close(error=>error?reject(error):resolve()));}
});

test('stopped owner and strict CLI inputs refuse creation while original grant replay retains its issuance',async t=>{
  const f=await fixture(t,'review-stopped',{start:false}),original=protectedState(f);
  assert.deepEqual(await f.issue(),f.grant);assert.deepEqual(protectedState(f),original,'An existing operator grant replay must not rotate the reviewer token');
  await rejectedUnchanged(f,connectionArgs(f),'INSTALLATION_NOT_RUNNING');assert.equal(existsSync(connectionPath(f)),false);
  const valid=connectionArgs(f);
  for(const args of [valid.filter(x=>x!=='--json'),valid.slice(0,3).concat('--json'),[...valid,'--grant-id','other'],[...valid,'--force'],['reviewer-connection','--installation','relative','--grant-id','reviewer','--json']])await rejectedUnchanged(f,args,args.includes('relative')?'UNSAFE_PATH':'INVALID_ARGUMENTS');
  assert.equal(existsSync(join(f.i.root,'current-run.json')),false);assert.deepEqual(readdirSync(join(f.i.root,'runs')),[]);
});

test('missing revoked and expired grants cannot create a connection or replace retained reviewer credentials',async t=>{
  const f=await fixture(t,'review-inactive',{extraGrants:['expired']});await ready(f);
  await rejectedUnchanged(f,connectionArgs(f,'missing'),'NOT_FOUND',[connectionPath(f,'missing')]);
  await stopped(f);
  const revoked=await success(['reviewer-revoke','--root',f.i.workspaceRoot,'--workspace',f.i.workspaceId,'--service',f.i.serviceId,'--grant-id',f.grant.grantId,'--json']);assert.equal(revoked.revoked,true);
  // A coherent expired local fixture avoids sleeping or altering the clock.
  // It does not assert that the operator CLI issues already-expired grants.
  const credentials=join(f.i.workspaceRoot,'credentials.json'),auth=readJSON(credentials),expired=readJSON(issuancePath(f,'expired')),at='2000-01-01T00:00:00.000Z';
  auth.grants.find(g=>g.id==='expired').expiresAt=at;expired.requested.expiresAt=at;writeFileSync(credentials,JSON.stringify(auth));writeFileSync(issuancePath(f,'expired'),JSON.stringify(expired));
  const rejectedGrant=await raw(['reviewer-grant','--root',f.i.workspaceRoot,'--workspace',f.i.workspaceId,'--service',f.i.serviceId,'--project',f.i.projectId,'--principal',f.grant.principalId,'--grant-id',f.grant.grantId,'--expires-at',f.expiresAt,'--json']);failed(rejectedGrant,'GRANT_CONFLICT');
  await f.start();await rejectedUnchanged(f,connectionArgs(f),'UNAUTHENTICATED');
  const retainedCredential={...readConnection(connectionPath(f)),origin:readConnection(f.authorFile).origin};
  await assert.rejects(sendRequest(retainedCredential,f.request('project.inspect'),false),{code:'UNAUTHENTICATED'},'The retained credential cannot authenticate to the restarted owner; its old connection file stays untouched');
  await rejectedUnchanged(f,connectionArgs(f,'expired'),'UNAUTHENTICATED',[issuancePath(f,'expired'),tokenPath(f,'expired'),connectionPath(f,'expired')]);
  assert.equal(existsSync(connectionPath(f,'expired')),false);await businessUnchanged(f);
});

test('foreign issuance token and permission bindings fail closed without repairing their bytes',async t=>{
  const f=await fixture(t,'review-binding');await ready(f);
  const credentials=join(f.i.workspaceRoot,'credentials.json');
  const changes=[
    [issuancePath(f),v=>{v.requested.principalId='another-reviewer';}],
    [issuancePath(f),v=>{v.requested.workspaceId='another-workspace';}],
    [credentials,v=>{v.grants.find(g=>g.id===f.grant.grantId).permissions=['read','write','review'];}],
    [credentials,v=>{v.grants.find(g=>g.id===f.grant.grantId).projectIds=['demo','foreign'];}],
    [connectionPath(f),v=>{v.credentialFile=f.i.credentialFile;}],
    [connectionPath(f),v=>{v.serviceId='foreign-service';}],
  ];
  for(const [path,change] of changes){const original=readFileSync(path);try{const value=JSON.parse(original);change(value);writeFileSync(path,JSON.stringify(value));await rejectedUnchanged(f,connectionArgs(f),path===connectionPath(f)?'CONNECTION_CONFLICT':'GRANT_CONFLICT');}finally{writeFileSync(path,original);}}
  const path=tokenPath(f),original=readFileSync(path);try{writeFileSync(path,'x'.repeat(43));await rejectedUnchanged(f,connectionArgs(f),'GRANT_CONFLICT');}finally{writeFileSync(path,original);}
  for(const missing of [issuancePath(f),tokenPath(f)]){
    const retained=missing+'.retained-test';renameSync(missing,retained);
    try{await rejectedUnchanged(f,connectionArgs(f),'GRANT_CONFLICT',[retained]);assert.equal(existsSync(missing),false,'Missing evidence must not be recreated');}finally{renameSync(retained,missing);}
  }
  assert.equal((await ready(f)).reused,true);await businessUnchanged(f);
});

test('private issuance token and connection files reject symlinks hardlinks and public modes while preserving aliases',async t=>{
  const f=await fixture(t,'review-files');await ready(f);let serial=0;
  for(const path of [issuancePath(f),tokenPath(f),connectionPath(f)]){
    const retained=join(base,'reviewer-retained-'+(++serial));renameSync(path,retained);
    try{
      symlinkSync(retained,path);try{await rejectedUnchanged(f,connectionArgs(f),'UNSAFE_PATH',[retained]);}finally{unlinkSync(path);}
      linkSync(retained,path);try{await rejectedUnchanged(f,connectionArgs(f),'UNSAFE_PATH',[retained]);}finally{unlinkSync(path);}
    }finally{renameSync(retained,path);}
    chmodSync(path,0o644);try{await rejectedUnchanged(f,connectionArgs(f),'UNSAFE_PATH');}finally{chmodSync(path,0o600);}
  }
  const pending=connectionPath(f)+'.pending-retained';writeFileSync(pending,'partial connection evidence',{mode:0o600});
  try{await rejectedUnchanged(f,connectionArgs(f),'CONNECTION_CONFLICT',[pending]);}finally{unlinkSync(pending);}
  assert.equal((await ready(f)).reused,true);await businessUnchanged(f);
});
