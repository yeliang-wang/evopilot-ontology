import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest,createServer} from 'node:http';
import {connect} from 'node:net';
import {once} from 'node:events';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {initializeWorkspace} from '../../dist/installation/workspace.js';
import {listenStandalone} from '../../dist/standalone/http.js';
import {createOntologyMcp} from '../../dist/standalone/mcp.js';
import {hashBytes} from '../../dist/standalone/validation.js';
import {LIMITS} from '../../dist/standalone/types.js';
import {REQUEST_BUDGETS} from '../../dist/standalone/request-budget.js';

async function fixture(t){
  const base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-http-budget-'))),root=join(base,'owner');
  const setup=initializeWorkspace({root,workspaceId:'isolated',projectId:'demo',principalId:'user'});
  const token=readFileSync(setup.credentialFile,'utf8'),server=await listenStandalone(setup),requests=new Set(),clients=[];
  const read=(operation,input={})=>({workspaceId:setup.workspaceId,serviceId:setup.serviceId,projectId:'demo',operation,input});
  const write=(operation,input,requestId,expectedRevision)=>({...read(operation,input),requestId,expectedRevision});
  const open=({path='/v1/request',bearer=token,length,chunked=false}={})=>{
    let settle;const result=new Promise(resolve=>settle=resolve);
    const headers={authorization:'Bearer '+bearer,'content-type':'application/json',accept:'application/json, text/event-stream',
      ...(chunked?{'transfer-encoding':'chunked'}:length!==undefined?{'content-length':String(length)}:{})};
    const req=httpRequest(server.origin+path,{method:'POST',agent:false,headers},res=>{
      const parts=[];res.on('data',x=>parts.push(x));res.on('error',error=>settle({error}));
      res.on('end',()=>{const raw=Buffer.concat(parts).toString('utf8');let body;try{body=JSON.parse(raw);}catch{body=raw;}settle({status:res.statusCode,body});});
    });
    requests.add(req);req.on('error',error=>settle({error}));req.once('close',()=>requests.delete(req));
    return {req,result};
  };
  const post=async(body,options={})=>{
    const bytes=Buffer.isBuffer(body)?body:Buffer.from(typeof body==='string'?body:JSON.stringify(body));
    const exchange=open({...options,...(!options.chunked?{length:bytes.length}:{})});exchange.req.end(bytes);return exchange.result;
  };
  const held=async(options={})=>{
    const exchange=open(options);exchange.req.flushHeaders();exchange.req.write('{');
    // A real completed exchange gives the server a processing barrier; the
    // held body is still deliberately incomplete, without a fixed sleep.
    assert.equal((await post(read('service.inspect'))).status,200);
    return exchange;
  };
  const available=async()=>{
    const deadline=performance.now()+2000;let reply;
    do{reply=await post(read('service.inspect'),{chunked:true});if(reply.status!==429)break;}while(performance.now()<deadline);
    assert.equal(reply.status,200,JSON.stringify(reply));return reply;
  };
  t.after(async()=>{for(const c of clients)await c.close();for(const req of requests)req.destroy();await server.close();rmSync(base,{recursive:true,force:true});});
  return {base,root,setup,token,server,read,write,open,post,held,available,clients};
}
const value=reply=>{assert.equal(reply.status,200,JSON.stringify(reply));assert.equal(reply.body.ok,true);return reply.body.result;};

test('HTTP authenticates before a declared large body and preserves write-only JSON permissions',async t=>{
  const f=await fixture(t);
  const denied=f.open({bearer:'z'.repeat(43),length:REQUEST_BUDGETS.maxOwnerBytes});denied.req.flushHeaders();
  const reply=await denied.result;assert.equal(reply.status,401);assert.equal(reply.body.error.code,'UNAUTHENTICATED');
  await f.available();
  const authFile=join(f.root,'credentials.json'),auth=JSON.parse(readFileSync(authFile,'utf8'));
  auth.grants[0].permissions=['write'];writeFileSync(authFile,JSON.stringify(auth));
  assert.equal(value(await f.post(f.write('project.create',{label:'Write-only owner'},'create',0))).revision,1);
  assert.equal((await f.post(f.read('project.inspect'))).status,403);
  const mcp=await f.post({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'probe',version:'0'}}},{path:'/mcp'});
  assert.equal(mcp.status,403,'MCP discovery still requires read permission');
  auth.grants[0].revoked=true;writeFileSync(authFile,JSON.stringify(auth));
  const revoked=f.open({length:REQUEST_BUDGETS.maxOwnerBytes});revoked.req.flushHeaders();assert.equal((await revoked.result).status,401);
});

test('actual JSON and official MCP admit and replay original source bytes above the SDK 4 MiB default',async t=>{
  const f=await fixture(t),content='Independent bounded source statement.\n'.repeat(140000);
  assert.ok(Buffer.byteLength(content)>4*1024*1024);
  const source={id:'requirements',locator:'synthetic-requirements.txt',revision:'v1',origin:'requirement',format:'text',content,digest:hashBytes(content)};
  const {content:_,format:__,...binding}=source;
  const definition={purpose:'Transport original source material',mode:'forward',scope:'Synthetic bounded input',exclusions:['Formal acceptance'],sources:[binding],requirements:[{id:'r1',statement:'Keep exact supplied source bytes'}]};
  value(await f.post(f.write('project.create',{label:'Large source'},'create',0)));
  const intentDigest=value(await f.post(f.write('intent.record',{definition,previousDigest:null},'intent',1))).result.intentDigest;
  const sourceSet={schema:'ontology-source-set/v2',sources:[source],fragments:[{id:'rule',sourceId:source.id,sourceDigest:source.digest,selector:{kind:'document'},fragmentDigest:source.digest}]};
  const request=f.write('source.admit',{intentDigest,sourceSet},'source',2),receipt=value(await f.post(request));
  assert.equal(receipt.revision,3);
  const c=new Client({name:'http-budget-probe',version:'0'},{versionNegotiation:{mode:'legacy'}});f.clients.push(c);
  await c.connect(new StreamableHTTPClientTransport(new URL(f.server.origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+f.token}}}),{timeout:5000});
  const replay=await c.callTool({name:'ontology_write',arguments:{...request,expectedRevision:999}},{timeout:REQUEST_BUDGETS.largeTimeoutMs});
  assert.notEqual(replay.isError,true);assert.deepEqual(replay.structuredContent.result,receipt);
  const sourceSetDigest=receipt.result.sourceSetDigest;
  const lastOffset=Buffer.byteLength(content)-65536;
  for(const offset of [0,lastOffset]){
    const page=value(await f.post(f.read('source.read',{sourceSetDigest,sourceId:source.id,offset,maxBytes:65536})));
    assert.equal(page.content,Buffer.from(content).subarray(offset,offset+65536).toString('utf8'));
  }
  assert.equal(value(await f.post(f.read('project.inspect'))).revision,3);
  await f.available();
});

test('ordinary, malformed and over-wire requests fail without consuming subsequent reservations',async t=>{
  const f=await fixture(t);
  for(const [body,options,code] of [
    [f.read('service.inspect',{padding:'x'.repeat(LIMITS.requestBytes)}),{},'INPUT_LIMIT'],
    [Buffer.from([0xc0,0xaf]),{},'INVALID_INPUT'],
    ['x'.repeat(LIMITS.requestBytes+1),{chunked:true},'INPUT_LIMIT'],
    [{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'ontology_write',arguments:f.write('source.admit',{sourceSet:{}},'not-dispatched',0)},padding:'x'.repeat(REQUEST_BUDGETS.mcpEnvelopeBytes+1)},{path:'/mcp'},'INPUT_LIMIT'],
  ]){
    const reply=await f.post(body,options);assert.equal(reply.body.error.code,code);await f.available();
  }
  for(const path of ['/v1/request','/mcp']){
    const exchange=f.open({path,length:REQUEST_BUDGETS.maxWireBytes+1});exchange.req.flushHeaders();
    const reply=await exchange.result;assert.equal(reply.status,413);assert.equal(reply.body.error.code,'INPUT_LIMIT');await f.available();
  }
  assert.equal(value(await f.post(f.read('service.inspect'))).project,null);
});

test('ordinary raw whitespace and Unicode escapes cannot bypass the operation wire budget',async t=>{
  const f=await fixture(t);
  for(const path of ['/v1/request','/mcp']){
    const owner=f.read('service.inspect'),body=Buffer.from(JSON.stringify(path==='/mcp'?{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'ontology_read',arguments:owner}}:owner));
    const limit=LIMITS.requestBytes+(path==='/mcp'?REQUEST_BUDGETS.mcpEnvelopeBytes:0);
    const atLimit=Buffer.concat([Buffer.alloc(limit-body.length,0x20),body]);
    assert.equal((await f.post(atLimit,{path})).status,200,'Legal whitespace inside the exact wire ceiling remains accepted');
    const over=await f.post(Buffer.concat([Buffer.from(' '),atLimit]),{path});
    assert.equal(over.status,413);assert.equal(over.body.error.code,'INPUT_LIMIT');await f.available();
  }
  value(await f.post(f.write('project.create',{label:'Raw encoded input'},'create',0)));
  const definition={purpose:'Original encoded byte budget',mode:'forward',scope:'Synthetic transport input',exclusions:Array.from({length:100},()=> 'x'.repeat(1000)),
    sources:[{id:'source',locator:'source.txt',revision:'v1',digest:hashBytes('source'),origin:'requirement'}],requirements:[{id:'r1',statement:'Reject the oversized representation before mutation'}]};
  const owner=f.write('intent.record',{definition,previousDigest:null},'escaped-intent',1);
  assert.ok(Buffer.byteLength(JSON.stringify(owner))<LIMITS.requestBytes);
  for(const path of ['/v1/request','/mcp']){
    const body=path==='/mcp'?{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'ontology_write',arguments:owner}}:owner;
    const raw=Buffer.from(JSON.stringify(body).replaceAll('x','\\u0078'));
    assert.ok(raw.length>LIMITS.requestBytes+REQUEST_BUDGETS.mcpEnvelopeBytes);
    const reply=await f.post(raw,{path});assert.equal(reply.status,413);assert.equal(reply.body.error.code,'INPUT_LIMIT');await f.available();
    assert.equal(value(await f.post(f.read('project.inspect'))).revision,1);
    assert.equal((await f.post(f.read('receipt.read',{requestId:'escaped-intent'}))).status,404);
  }
  // The decoded material is legitimate. Reusing the rejected request ID in its
  // bounded representation proves that no draft or receipt was partially kept.
  assert.equal(value(await f.post(owner)).revision,2);
});

test('declared-byte and unknown-length quotas bind principals and the service, then release on disconnect',async t=>{
  const f=await fixture(t),authFile=join(f.root,'credentials.json'),auth=JSON.parse(readFileSync(authFile,'utf8'));
  const samePrincipal='s'.repeat(43),otherPrincipal='o'.repeat(43);
  auth.grants.push({...auth.grants[0],id:'same',tokenHash:hashBytes(samePrincipal)},{...auth.grants[0],id:'other',principalId:'other',tokenHash:hashBytes(otherPrincipal)});
  writeFileSync(authFile,JSON.stringify(auth));
  for(const chunked of [false,true]){
    const first=await f.held(chunked?{chunked:true}:{length:40*1024*1024});
    for(const bearer of [samePrincipal,otherPrincipal]){
      const second=f.open(chunked?{bearer,chunked:true}:{bearer,length:40*1024*1024});second.req.flushHeaders();
      const reply=await second.result;assert.equal(reply.status,429);assert.equal(reply.body.error.code,'TRANSPORT_BUSY');
    }
    first.req.destroy();await f.available();
  }
});

test('active-request slots release after truncated clients and do not accumulate across failures',async t=>{
  const f=await fixture(t),pending=[];
  for(let i=0;i<REQUEST_BUDGETS.activeRequests;i++){
    const exchange=f.open({length:32});exchange.req.flushHeaders();exchange.req.write('{');pending.push(exchange);
    if(i+1<REQUEST_BUDGETS.activeRequests)assert.equal((await f.post(f.read('service.inspect'))).status,200);
  }
  const busy=await f.post(f.read('service.inspect'));assert.equal(busy.status,429);assert.equal(busy.body.error.code,'TRANSPORT_BUSY');
  for(const exchange of pending)exchange.req.destroy();await f.available();
  for(let i=0;i<REQUEST_BUDGETS.activeRequests+2;i++)assert.equal((await f.post('{')).body.error.code,'INVALID_INPUT');
  await f.available();
});

test('one connection cannot pipeline another active owner request',async t=>{
  const f=await fixture(t),url=new URL(f.server.origin),socket=connect(Number(url.port),url.hostname);t.after(()=>socket.destroy());
  await once(socket,'connect');let raw='';socket.on('data',x=>raw+=x.toString('utf8'));
  const first=JSON.stringify(f.write('project.create',{label:'Only first pipeline operation'},'first',0));
  const second=JSON.stringify(f.write('project.create',{label:'Must not replay on connection'},'second',0));
  const frame=body=>`POST /v1/request HTTP/1.1\r\nHost: ${url.host}\r\nAuthorization: Bearer ${f.token}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
  const closed=once(socket,'close');socket.write(frame(first)+frame(second));await closed;
  assert.match(raw,/429 Too Many Requests/);assert.match(raw,/TRANSPORT_BUSY/);
  assert.equal(value(await f.post(f.read('project.inspect'))).revision,1);
  const missing=await f.post(f.read('receipt.read',{requestId:'second'}));assert.notEqual(missing.status,200);
  await f.available();
});

test('an incomplete small body reaches its actual deadline and returns the reservation', {timeout:20000},async t=>{
  const f=await fixture(t),started=performance.now(),exchange=f.open({length:32});exchange.req.flushHeaders();exchange.req.write('{');
  const reply=await exchange.result;assert.equal(reply.status,408);assert.equal(reply.body.error.code,'REQUEST_TIMEOUT');
  assert.ok(performance.now()-started>=REQUEST_BUDGETS.ordinaryTimeoutMs-250);
  await f.available();assert.equal(value(await f.post(f.read('service.inspect'))).project,null);
});

test('MCP adapter closes over-budget generated wire output rather than returning partial success',async t=>{
  // Adapter fault injection: an owner-shaped dependency violates its normal
  // result ceiling. This is not a claim that real owner results can exceed it.
  const mcp=createOntologyMcp({context:()=>({workspaceId:'isolated',serviceId:'service',projectIds:['demo']}),request:()=>({value:'x'.repeat(Math.ceil(REQUEST_BUDGETS.mcpResponseBytes/2))})});
  const server=createServer(async(req,res)=>{
    // The official client can probe a GET stream. Match the real product's
    // POST-only boundary before parsing; this fixture does not offer that stream.
    if(req.method!=='POST'){res.writeHead(405,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'METHOD_NOT_ALLOWED'}}));return;}
    const parts=[];for await(const p of req)parts.push(p);await mcp.handle(req,res,JSON.parse(Buffer.concat(parts).toString('utf8')),'t'.repeat(43));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const client=new Client({name:'response-budget-probe',version:'0'},{versionNegotiation:{mode:'legacy'}});
  t.after(async()=>{await client.close();await mcp.close();await new Promise(resolve=>server.close(resolve));});
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`)),{timeout:5000});
  await assert.rejects(client.callTool({name:'ontology_read',arguments:{workspaceId:'isolated',serviceId:'service',projectId:'demo',operation:'service.inspect',input:{}}},{timeout:5000}));
});
