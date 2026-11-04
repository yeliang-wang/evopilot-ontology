import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Writable} from 'node:stream';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {BoundedStdioTransport} from '../../dist/standalone/stdio-transport.js';
import {REQUEST_BUDGETS} from '../../dist/standalone/request-budget.js';
import {sendRequest} from '../../dist/standalone/client.js';
import {initializeWorkspace} from '../../dist/installation/workspace.js';
import {listenStandalone} from '../../dist/standalone/http.js';

// These are transport development fixtures. The echo peer does not model an
// ontology, authorize a business decision, or establish product acceptance.
const moduleURL=new URL('../../dist/standalone/stdio-transport.js',import.meta.url).href;
const digest=text=>createHash('sha256').update(text).digest('hex');
const frame=value=>JSON.stringify(value)+'\n';
const request=(id,operation='source.admit',document='x')=>({jsonrpc:'2.0',id,method:'tools/call',params:{name:'ontology_write',arguments:{operation,input:{document}}}});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,message,timeout=3000){
  const end=Date.now()+timeout;
  while(!predicate()){if(Date.now()>=end)assert.fail(message);await pause(5);}
}
function fixture(t,options={}){
  const input=new PassThrough(),chunks=[],output=new Writable({write(chunk,_encoding,done){chunks.push(Buffer.from(chunk));done();}});
  const transport=new BoundedStdioTransport(input,output,options),seen=[],errors=[];let closed=0;
  transport.onmessage=value=>seen.push(value);transport.onerror=error=>errors.push(error.code);transport.onclose=()=>closed++;
  t.after(async()=>{await transport.close();input.destroy();output.destroy();});
  return {input,output,transport,seen,errors,chunks,get closed(){return closed;}};
}
async function pipeChild(t,code){
  const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['pipe','pipe','pipe']});
  const lines=[],errors=[];let pending='',diagnostic='',exited=false,exitResult;
  const exit=new Promise(resolve=>child.once('exit',(code,signal)=>{exited=true;exitResult={code,signal};resolve(exitResult);}));
  child.stdin.on('error',error=>errors.push(error.code));
  child.stderr.on('data',chunk=>{diagnostic+=chunk;assert.ok(diagnostic.length<65536,'Bounded child diagnostics');});
  child.stdout.on('data',chunk=>{
    pending+=chunk;assert.ok(pending.length<65536,'Echo result is bounded');
    let newline;while((newline=pending.indexOf('\n'))>=0){lines.push(JSON.parse(pending.slice(0,newline)));pending=pending.slice(newline+1);}
  });
  t.after(async()=>{if(!exited){child.kill('SIGKILL');await exit;}assert.ok(exited,'Every owned transport child is waited');});
  const write=async bytes=>{
    const source=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
    for(let offset=0;offset<source.length;offset+=32768){
      await new Promise((resolve,reject)=>child.stdin.write(source.subarray(offset,offset+32768),error=>error?reject(error):resolve()));
    }
  };
  return {child,lines,write,exit,get diagnostic(){return diagnostic;},get exited(){return exited;},get exitResult(){return exitResult;}};
}

test('real stdio pipe accepts a near-48 MiB frame and Unicode document operations without whole-buffer append growth',{timeout:45000},async t=>{
  const p=await pipeChild(t,`
    import {BoundedStdioTransport} from ${JSON.stringify(moduleURL)};
    import {createHash} from 'node:crypto';
    const transport=new BoundedStdioTransport();
    transport.onerror=e=>process.stderr.write(e.code+'\\n');
    transport.onmessage=message=>{
      const text=message.params.arguments.input.document;
      transport.send({jsonrpc:'2.0',id:message.id,result:{bytes:Buffer.byteLength(text),digest:createHash('sha256').update(text).digest('hex')}}).catch(()=>{});
    };
    await transport.start();
  `);
  for(const [id,operation,document] of [
    [1,'source.admit','x'.repeat(REQUEST_BUDGETS.sourceBytes-1024)],
    [2,'model.record','关系😀\\"\n'.repeat(100000)],
    [3,'expectations.record','独立反例'.repeat(100000)],
  ]){
    await p.write(frame(request(id,operation,document)));
    await until(()=>p.lines.some(value=>value.id===id),'Large frame did not receive a response',20000);
    assert.deepEqual(p.lines.find(value=>value.id===id).result,{bytes:Buffer.byteLength(document),digest:digest(document)});
  }
  p.child.stdin.end();await p.exit;
  assert.equal(p.exitResult.code,0);assert.equal(p.diagnostic,'');assert.equal(p.lines.length,3);
});

test('partial raw bytes share admission with uncompleted requests and resume after a response',async t=>{
  const f=fixture(t,{maxMessageBytes:1024,aggregateBytes:4096,maxResponseBytes:1024,maxRequests:8});await f.transport.start();
  const messages=Array.from({length:5},(_,index)=>({jsonrpc:'2.0',id:index,method:'ping',params:{document:'x'.repeat(800)}}));
  f.input.write(messages.map(frame).join(''));
  await until(()=>f.seen.length===3,'First three requests must enter');await pause(25);
  assert.deepEqual(f.seen.map(x=>x.id),[0,1,2]);
  await f.transport.send({jsonrpc:'2.0',id:0,result:{}});
  await until(()=>f.seen.length===4,'Releasing request credit must resume its partial successor');
  await f.transport.send({jsonrpc:'2.0',id:1,result:{}});
  await until(()=>f.seen.length===5,'Second release must resume input');
  assert.deepEqual(f.seen.map(x=>x.id),[0,1,2,3,4]);assert.deepEqual(f.errors,[]);
});

test('request count and slow stdout provide backpressure without dropping or redispatching input',async t=>{
  const input=new PassThrough(),callbacks=[],wire=[];
  const output=new Writable({highWaterMark:1,write(chunk,_encoding,done){wire.push(chunk.toString());callbacks.push(done);}});
  const transport=new BoundedStdioTransport(input,output,{maxMessageBytes:1024,aggregateBytes:4096,maxResponseBytes:1024,maxRequests:2});
  const seen=[];transport.onmessage=value=>seen.push(value);
  t.after(async()=>{await transport.close();input.destroy();output.destroy();});await transport.start();
  input.write([1,2,3].map(id=>frame({jsonrpc:'2.0',id,method:'ping'})).join(''));
  await until(()=>seen.length===2,'Count limit must permit two');
  const sent=transport.send({jsonrpc:'2.0',id:1,result:{ok:true}});
  await until(()=>callbacks.length===1,'First response must reach stdout');await pause(25);
  assert.deepEqual(seen.map(x=>x.id),[1,2]);
  callbacks.shift()();await sent;await until(()=>seen.length===3,'Input must resume after stdout completes');
  assert.deepEqual(seen.map(x=>x.id),[1,2,3]);assert.equal(wire.length,1);
});

test('coalesced notifications do not consume permanent request slots; string and numeric IDs remain distinct',async t=>{
  const f=fixture(t,{maxMessageBytes:1024,aggregateBytes:4096,maxResponseBytes:1024,maxRequests:2});await f.transport.start();
  const notifications=Array.from({length:150},()=>({jsonrpc:'2.0',method:'notifications/initialized'}));
  f.input.write([...notifications,{jsonrpc:'2.0',id:1,method:'ping'},{jsonrpc:'2.0',id:'1',method:'ping'}].map(frame).join(''));
  await until(()=>f.seen.length===152,'Notifications must not leak admission');
  assert.equal(f.seen.at(-2).id,1);assert.equal(f.seen.at(-1).id,'1');assert.deepEqual(f.errors,[]);
  await f.transport.send({jsonrpc:'2.0',id:1,result:{}});await f.transport.send({jsonrpc:'2.0',id:'1',result:{}});
  f.input.write(frame({jsonrpc:'2.0',id:1,method:'ping'}));await until(()=>f.seen.length===153,'A completed ID may be reused');
});

test('invalid framing, UTF-8, structure and oversized ordinary calls close before dispatch',async t=>{
  const invalid=[
    ['malformed',Buffer.from('{secret-input\n'),'STDIO_INVALID_MESSAGE'],
    ['UTF-8',Buffer.from([0xff,10]),'STDIO_INVALID_MESSAGE'],
    ['batch',Buffer.from('[{"jsonrpc":"2.0","id":1,"method":"ping"}]\n'),'STDIO_INVALID_MESSAGE'],
    ['version',Buffer.from('{"jsonrpc":"1.0","id":1,"method":"ping"}\n'),'STDIO_INVALID_MESSAGE'],
    ['raw budget',Buffer.from('x'.repeat(1025)),'STDIO_FRAME_LIMIT'],
    ['nesting',Buffer.from('{"jsonrpc":"2.0","id":1,"method":"ping","params":{"x":'+'['.repeat(26)+'0'+']'.repeat(26)+'}}\n'),'STDIO_INVALID_MESSAGE'],
  ];
  for(const [name,bytes,code] of invalid)await t.test(name,async t=>{
    const f=fixture(t,{maxMessageBytes:1024,aggregateBytes:4096,maxResponseBytes:1024});await f.transport.start();f.input.write(bytes);
    await until(()=>f.closed===1,'Invalid channel must close');assert.deepEqual(f.errors,[code]);assert.equal(f.seen.length,0);
  });
  await t.test('ordinary operation cannot borrow document budget',async t=>{
    const f=fixture(t);await f.transport.start();f.input.write(frame(request(1,'project.create','x'.repeat(600*1024))));
    await until(()=>f.closed===1,'Ordinary large call must close');assert.deepEqual(f.errors,['STDIO_FRAME_LIMIT']);assert.equal(f.seen.length,0);
  });
  for(const where of ['params metadata','unknown outer member'])await t.test(where+' cannot borrow document budget',async t=>{
    const f=fixture(t),value=request(1);
    if(where==='params metadata')value.params._meta={padding:'x'.repeat(REQUEST_BUDGETS.mcpEnvelopeBytes)};
    else value.unknownPadding='x'.repeat(REQUEST_BUDGETS.mcpEnvelopeBytes);
    await f.transport.start();f.input.write(frame(value));
    await until(()=>f.closed===1,'Large wrapper must close before SDK dispatch');assert.deepEqual(f.errors,['STDIO_FRAME_LIMIT']);assert.equal(f.seen.length,0);
  });
});

test('truncation, a stalled partial frame and duplicate active IDs have explicit terminal failures',async t=>{
  await t.test('truncated EOF',async t=>{
    const f=fixture(t);await f.transport.start();f.input.end('{"jsonrpc":"2.0"');
    await until(()=>f.closed===1,'EOF must close');assert.deepEqual(f.errors,['STDIO_TRUNCATED']);assert.equal(f.seen.length,0);
  });
  await t.test('partial deadline',async t=>{
    const f=fixture(t,{partialTimeoutMs:30});await f.transport.start();f.input.write('{');
    await until(()=>f.closed===1,'Incomplete frame must expire');assert.deepEqual(f.errors,['STDIO_FRAME_TIMEOUT']);assert.equal(f.seen.length,0);
  });
  await t.test('duplicate IDs',async t=>{
    const f=fixture(t);await f.transport.start();f.input.write(frame(request(7))+frame(request(7)));
    await until(()=>f.closed===1,'Duplicate active ID must close');assert.deepEqual(f.errors,['STDIO_DUPLICATE_ID']);assert.equal(f.seen.length,1);
  });
});

test('cancel notification alone cannot release retained request bytes; completed cancellation and close clean up once',async t=>{
  const f=fixture(t,{maxMessageBytes:1024,aggregateBytes:4096,maxResponseBytes:1024,maxRequests:2});await f.transport.start();
  f.input.write(frame(request(1))+frame({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:1}}));
  await until(()=>f.seen.length===2,'Cancellation must be delivered');
  // The handler, not an untrusted notification, proves its cleanup has completed.
  f.transport.releaseCancelledRequest(1);f.input.write(frame(request(1)));
  await until(()=>f.seen.length===3,'Completed cancelled request must release its ID');
  await f.transport.close();await f.transport.close();assert.equal(f.closed,1);
  await assert.rejects(f.transport.send({jsonrpc:'2.0',id:1,result:{}}),{code:'STDIO_CLOSED'});
  assert.equal(f.input.listenerCount('readable'),0);assert.equal(f.input.listenerCount('end'),0);assert.equal(f.input.listenerCount('close'),0);
});

test('stdout limits and late write errors reject pending sends and disclose no payload',async t=>{
  await t.test('output limit',async t=>{
    const f=fixture(t,{maxMessageBytes:1024,aggregateBytes:4096,maxResponseBytes:1024});await f.transport.start();
    await assert.rejects(f.transport.send({jsonrpc:'2.0',id:1,result:{secret:'x'.repeat(1100)}}),{code:'STDIO_OUTPUT_LIMIT'});
    assert.equal(f.closed,1);assert.deepEqual(f.errors,['STDIO_OUTPUT_LIMIT']);assert.equal(f.chunks.length,0);
  });
  await t.test('write failure',async()=>{
    const input=new PassThrough(),output=new Writable({write(_chunk,_encoding,done){setImmediate(()=>done(Error('private-token-do-not-disclose')));}});
    const transport=new BoundedStdioTransport(input,output),errors=[];let closed=0;transport.onerror=error=>errors.push(error.message);transport.onclose=()=>closed++;
    await transport.start();await assert.rejects(transport.send({jsonrpc:'2.0',id:1,result:{}}),{code:'STDIO_CLOSED'});
    await pause(15);assert.equal(closed,1);assert.deepEqual(errors,['STDIO_OUTPUT_ERROR']);await transport.close();input.destroy();output.destroy();
  });
});

for(const mode of ['legacy','auto'])test('actual SDK '+mode+' negotiation, notifications and cancellation survive bounded stdio',{timeout:15000},async t=>{
  const code=`
    import {BoundedStdioTransport} from ${JSON.stringify(moduleURL)};
    import {Server} from '@modelcontextprotocol/server';
    import {serveStdio} from '@modelcontextprotocol/server/stdio';
    const transport=new BoundedStdioTransport();
    serveStdio(()=>{
      const server=new Server({name:'transport-test',version:'1'},{capabilities:{tools:{}}});
      server.setRequestHandler('tools/list',()=>({tools:[{name:'ontology_write',inputSchema:{type:'object'}}]}));
      server.setRequestHandler('tools/call',async(request,context)=>{
        try{
          if(request.params.arguments?.wait)await new Promise(resolve=>context.mcpReq.signal.addEventListener('abort',resolve,{once:true}));
          return {content:[{type:'text',text:'echo'}],structuredContent:{bytes:Buffer.byteLength(request.params.arguments?.input?.document??'')}};
        }finally{if(context.mcpReq.signal.aborted)transport.releaseCancelledRequest(context.mcpReq.id);}
      });return server;
    },{transport,legacy:'serve',maxSubscriptions:0});
  `;
  const transport=new StdioClientTransport({command:process.execPath,args:['--input-type=module','-e',code],stderr:'pipe',maxBufferSize:REQUEST_BUDGETS.mcpResponseBytes});
  const client=new Client({name:'bounded-pipe-test',version:'1'},{versionNegotiation:{mode}});let stderr='';transport.stderr?.on('data',x=>stderr+=x);
  t.after(()=>client.close());await client.connect(transport,{timeout:5000});
  assert.equal((await client.listTools()).tools[0].name,'ontology_write');
  const document='x'.repeat(700*1024),result=await client.callTool({name:'ontology_write',arguments:{operation:'source.admit',input:{document}}},{timeout:5000});
  assert.equal(result.structuredContent.bytes,document.length);
  const controller=new AbortController();
  const cancelled=client.callTool({name:'ontology_write',arguments:{operation:'source.admit',wait:true}},{signal:controller.signal,timeout:5000});
  const rejected=assert.rejects(cancelled);await pause(30);
  assert.equal((await client.listTools(undefined,{timeout:1000})).tools.length,1,'One held call must not stall independent reads');
  controller.abort();await rejected;
  assert.equal((await client.listTools()).tools.length,1);
  await client.close();assert.equal(stderr,'');
});

test('a lost HTTP write response stays REQUEST_UNKNOWN and is never automatically sent twice',async t=>{
  const base=mkdtempSync(join(tmpdir(),'ontology-transport-unknown-')),credentialFile=join(base,'token');writeFileSync(credentialFile,'x'.repeat(43),{mode:0o600});
  let calls=0;const server=createServer((request,response)=>{calls++;request.resume();request.on('end',()=>response.destroy());});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(base,{recursive:true,force:true});});
  const connection={schema:'ontology-connection/v1',origin:'http://127.0.0.1:'+server.address().port,workspaceId:'test',serviceId:'test',projectId:'test',credentialFile};
  const value={workspaceId:'test',serviceId:'test',projectId:'test',operation:'source.admit',input:{document:'x'.repeat(700*1024)},requestId:'original',expectedRevision:0};
  await assert.rejects(sendRequest(connection,value,true),{code:'REQUEST_UNKNOWN'});assert.equal(calls,1);
});

test('actual bridge lost response preserves the committed owner receipt and does not redispatch',{timeout:15000},async t=>{
  const base=mkdtempSync(join(tmpdir(),'ontology-bridge-unknown-')),root=join(base,'workspace');
  const setup=initializeWorkspace({root,workspaceId:'isolated',projectId:'demo',principalId:'author'});
  const owner=await listenStandalone({root,workspaceId:setup.workspaceId,serviceId:setup.serviceId});let lost=0;
  // Fault proxy is a separately attributable transport fixture, not a product
  // remote connection. It drops only one already-completed synthetic mutation.
  const proxy=createServer((request,response)=>{
    const parts=[];request.on('data',chunk=>parts.push(chunk));request.on('end',async()=>{
      try{
        const body=Buffer.concat(parts),value=JSON.parse(body.toString('utf8'));
        const headers={};for(const [name,value] of Object.entries(request.headers))if(!['host','connection','content-length','transfer-encoding'].includes(name)&&typeof value==='string')headers[name]=value;
        headers.connection='close';
        const upstream=await fetch(owner.origin+request.url,{method:request.method,headers,body,signal:AbortSignal.timeout(5000)}),bytes=Buffer.from(await upstream.arrayBuffer());
        if(value.method==='tools/call'&&value.params?.arguments?.operation==='project.create'){lost++;response.destroy();return;}
        response.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/json'});response.end(bytes);
      }catch{response.destroy();}
    });
  });
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  const connection={schema:'ontology-connection/v1',origin:'http://127.0.0.1:'+proxy.address().port,workspaceId:setup.workspaceId,serviceId:setup.serviceId,projectId:'demo',credentialFile:setup.credentialFile};
  const connectionFile=join(base,'connection.json');writeFileSync(connectionFile,JSON.stringify(connection),{mode:0o600});
  const transport=new StdioClientTransport({command:process.execPath,args:[new URL('../../dist/standalone/bridge.js',import.meta.url).pathname,'--connection',connectionFile],stderr:'pipe'});
  const client=new Client({name:'unknown-bridge-test',version:'1'});
  t.after(async()=>{await client.close();proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));await owner.close();rmSync(base,{recursive:true,force:true});});
  await client.connect(transport,{timeout:5000});
  const request={workspaceId:setup.workspaceId,serviceId:setup.serviceId,projectId:'demo',operation:'project.create',input:{label:'Synthetic uncertain transport'},requestId:'original',expectedRevision:0};
  const result=await client.callTool({name:'ontology_write',arguments:request},{timeout:7000});
  assert.equal(result.isError,true);assert.equal(result.structuredContent.error.code,'TRANSPORT_UNKNOWN');assert.equal(lost,1);
  const read={workspaceId:setup.workspaceId,serviceId:setup.serviceId,projectId:'demo',operation:'receipt.read',input:{requestId:'original'}};
  const receipt=await sendRequest({...connection,origin:owner.origin},read,false);
  assert.equal(receipt.requestId,'original');assert.equal(receipt.revision,1);assert.equal(lost,1);
});
