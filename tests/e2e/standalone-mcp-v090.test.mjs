import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {initializeWorkspace} from '../../dist/installation/workspace.js';
import {listenStandalone} from '../../dist/standalone/http.js';
import {hashBytes} from '../../dist/standalone/validation.js';

async function fixture(t){
  const base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-mcp-'))),root=join(base,'state');
  const setup=initializeWorkspace({root,workspaceId:'isolated',projectId:'demo',principalId:'user'});
  const token=readFileSync(setup.credentialFile,'utf8'),server=await listenStandalone(setup),clients=[];
  t.after(async()=>{for(const c of clients)await c.close();await server.close();rmSync(base,{recursive:true,force:true});});
  const client=async(mode='legacy',bearer=token)=>{
    const c=new Client({name:'independent-acceptance-probe',version:'0.0.0'},{versionNegotiation:{mode}});clients.push(c);
    await c.connect(new StreamableHTTPClientTransport(new URL(server.origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+bearer}}}),{timeout:5000});
    return c;
  };
  const read=(operation,input={},extra={})=>({workspaceId:setup.workspaceId,serviceId:setup.serviceId,projectId:'demo',operation,input,...extra});
  const write=(operation,input,requestId,expectedRevision)=>read(operation,input,{requestId,expectedRevision});
  const call=(c,name,args={})=>c.callTool({name,arguments:args},{timeout:5000});
  return {base,root,setup,token,server,client,read,write,call};
}
const definition={purpose:'Source-grounded sensitive service classification',mode:'forward',scope:'Synthetic service model',exclusions:['Live data'],sources:[{id:'req',locator:'requirements.txt',revision:'v1',digest:hashBytes('independently fixed example'),origin:'requirement'}],requirements:[{id:'r1',statement:'Sensitive access is classified with its supporting premises'}]};
const value=r=>{assert.notEqual(r.isError,true,JSON.stringify(r));return r.structuredContent.result;};

for(const mode of ['legacy','auto'])test('official MCP client '+mode+' discovers scoped context and retains exact domain receipts',async t=>{
  const f=await fixture(t),c=await f.client(mode);
  const list=await c.listTools();assert.deepEqual(list.tools.map(x=>x.name).sort(),['ontology_context','ontology_read','ontology_write']);
  assert.equal(list.tools.find(x=>x.name==='ontology_read').annotations.readOnlyHint,true);
  const context=value(await f.call(c,'ontology_context'));
  assert.equal(context.serviceId,f.setup.serviceId);assert.equal(context.workspaceId,'isolated');assert.deepEqual(context.projectIds,['demo']);
  assert.equal(context.reasoningReady,false);assert.equal(context.authority,false);
  if(mode==='auto')assert.ok(c.getDiscoverResult(),'modern discovery must actually negotiate');
  const create=f.write('project.create',{label:'Synthetic MCP'},'create',0);
  const first=value(await f.call(c,'ontology_write',create));assert.equal(first.revision,1);
  const intent=value(await f.call(c,'ontology_write',f.write('intent.record',{definition,previousDigest:null},'intent',1)));
  assert.equal(intent.revision,2);assert.equal(intent.result.businessConfirmed,false);
  const second=await f.client(mode);
  assert.deepEqual(value(await f.call(second,'ontology_write',{...create,expectedRevision:123})),first);
  assert.deepEqual(value(await f.call(second,'ontology_read',f.read('receipt.read',{requestId:'intent'}))),intent);
  assert.deepEqual(value(await f.call(second,'ontology_read',f.read('intent.read',{digest:intent.result.intentDigest}))).definition,definition);
  const conflict=await f.call(c,'ontology_write',{...create,input:{label:'changed'}});assert.equal(conflict.structuredContent.error.code,'REQUEST_CONFLICT');
  assert.equal(value(await f.call(c,'ontology_read',f.read('project.inspect'))).revision,2);
});

test('MCP and JSON requests share one CAS history and tool schemas cannot cross read/write boundaries',async t=>{
  const f=await fixture(t),c=await f.client();
  const create=f.write('project.create',{label:'Shared history'},'mcp-create',0);
  const receipt=value(await f.call(c,'ontology_write',create));
  const post=body=>fetch(f.server.origin+'/v1/request',{method:'POST',headers:{authorization:'Bearer '+f.token,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.deepEqual((await (await post(create)).json()).result,receipt);
  const responses=await Promise.all([
    f.call(c,'ontology_write',f.write('intent.record',{definition,previousDigest:null},'mcp-intent',1)),
    post(f.write('intent.record',{definition,previousDigest:null},'json-intent',1)).then(r=>r.json()),
  ]);
  assert.equal(responses.filter(r=>r.isError===true||r.ok===false).length,1);
  assert.equal(value(await f.call(c,'ontology_read',f.read('project.inspect'))).revision,2);
  assert.equal((await f.call(c,'ontology_read',create)).isError,true);
  assert.equal((await f.call(c,'ontology_write',f.read('project.inspect'))).isError,true);
  assert.equal((await f.call(c,'ontology_read',f.read('installation.delete'))).isError,true);
  const foreign=await f.call(c,'ontology_read',f.read('project.inspect',{}, {projectId:'foreign'}));
  assert.equal(foreign.structuredContent.error.code,'FORBIDDEN');
  const wrong=await f.call(c,'ontology_read',f.read('project.inspect',{}, {serviceId:'foreign'}));
  assert.equal(wrong.structuredContent.error.code,'IDENTITY_MISMATCH');
});

test('MCP rechecks current credentials on discovery and every call including receipt replay',async t=>{
  const f=await fixture(t),c=await f.client();
  const create=f.write('project.create',{label:'Revocation'},'create',0);value(await f.call(c,'ontology_write',create));
  const file=join(f.root,'credentials.json'),auth=JSON.parse(readFileSync(file,'utf8'));
  auth.grants[0].permissions=['read'];writeFileSync(file,JSON.stringify(auth));
  assert.equal((await f.call(c,'ontology_write',create)).structuredContent.error.code,'FORBIDDEN');
  assert.deepEqual(value(await f.call(c,'ontology_context')).writeOperations,[]);
  assert.equal(value(await f.call(c,'ontology_read',f.read('receipt.read',{requestId:'create'}))).revision,1);
  auth.grants[0].revoked=true;writeFileSync(file,JSON.stringify(auth));
  await assert.rejects(f.call(c,'ontology_context'));
  await assert.rejects(c.listTools(undefined,{cacheMode:'bypass',timeout:5000}));
  await assert.rejects(f.client('legacy'));
  await assert.rejects(f.client('auto','x'.repeat(43)));
});

test('MCP rejects browser origins, malformed UTF-8 and oversized chunked exchanges before dispatch',async t=>{
  const f=await fixture(t);
  const post=(body,headers={})=>fetch(f.server.origin+'/mcp',{method:'POST',headers:{authorization:'Bearer '+f.token,'content-type':'application/json',accept:'application/json, text/event-stream',...headers},body});
  const initialize=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'probe',version:'0'}}});
  assert.equal((await post(initialize,{origin:'http://localhost'})).status,403);
  assert.equal((await post(initialize,{authorization:'Bearer invalid'})).status,401);
  assert.equal((await post(Buffer.from([0xc0,0xaf]))).status,400);
  const chunked=await new Promise((resolve,reject)=>{
    const request=httpRequest(f.server.origin+'/mcp',{method:'POST',headers:{authorization:'Bearer '+f.token,'content-type':'application/json','transfer-encoding':'chunked'}},res=>{
      let data='';res.on('data',v=>data+=v);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}));
    });request.on('error',reject);for(let i=0;i<9;i++)request.write('x'.repeat(65536));request.end();
  });
  assert.equal(chunked.status,413);assert.equal(chunked.body.error.code,'INPUT_LIMIT');
  const c=await f.client();assert.equal(value(await f.call(c,'ontology_read',f.read('service.inspect'))).project,null);
});
