import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {listenStandalone} from '../../dist/standalone/http.js';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {canonical,hashBytes,validateRequest} from '../../dist/standalone/validation.js';
import {REQUEST_BUDGETS,inputBudget,ownerRequestBudget} from '../../dist/standalone/request-budget.js';
import {fixture,source as smallSource,definition,expected,model} from '../helpers/v090-validation.mjs';
import {prepare as prepareModel,draft,ttl} from '../helpers/v090-native.mjs';

const exec=promisify(execFile),cli=fileURLToPath(new URL('../../dist/standalone/cli.js',import.meta.url));
const bridge=fileURLToPath(new URL('../../dist/standalone/bridge.js',import.meta.url));

for(const mode of ['http','cli','http-mcp','stdio'])test(`${mode}: all three large native writes retain exact receipts and byte readback across owner restart`,{timeout:120000},async t=>{
  const f=fixture(t),connection=join(f.base,'connection.json');let server,client,counter=0;
  const start=async()=>{
    server=await listenStandalone(f.setup);
    writeFileSync(connection,JSON.stringify({schema:'ontology-connection/v1',origin:server.origin,workspaceId:f.setup.workspaceId,serviceId:f.setup.serviceId,projectId:'demo',credentialFile:f.setup.credentialFile}),{mode:0o600});
    if(mode==='http-mcp'||mode==='stdio'){
      client=new Client({name:'synthetic-large-input-check',version:'0'},{versionNegotiation:{mode:'legacy'}});
      const transport=mode==='stdio'?new StdioClientTransport({command:process.execPath,args:[bridge,'--connection',connection],stderr:'pipe',maxBufferSize:REQUEST_BUDGETS.mcpResponseBytes}):new StreamableHTTPClientTransport(new URL(server.origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+f.token}}});
      await client.connect(transport,{timeout:10000});
    }
  };
  const stop=async()=>{await client?.close();client=undefined;await server?.close();server=undefined;};
  t.after(stop);await start();
  const call=async request=>{
    if(mode==='cli'){
      const path=join(f.base,`input-${++counter}.json`);writeFileSync(path,JSON.stringify(request.input));
      const write=request.requestId!==undefined;
      const args=[cli,write?'write':'read','--connection',connection,'--operation',request.operation,'--input',path,...(write?['--request-id',request.requestId,'--expected-revision',String(request.expectedRevision)]:[]),'--json'];
      const {stdout}=await exec(process.execPath,args,{timeout:90000,maxBuffer:2*1024*1024});
      const value=JSON.parse(stdout);assert.equal(value.ok,true,stdout);return value.result;
    }
    if(client){
      const value=await client.callTool({name:request.requestId===undefined?'ontology_read':'ontology_write',arguments:request},{timeout:75000});
      assert.notEqual(value.isError,true,JSON.stringify(value));return value.structuredContent.result;
    }
    const response=await fetch(server.origin+'/v1/request',{method:'POST',headers:{authorization:'Bearer '+f.token,'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(75000)});
    const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));assert.equal(value.ok,true);return value.result;
  };
  const padding='开发材料 😀 " \\ '.repeat(30000);
  const source={...smallSource,content:smallSource.content+'\n'+padding};source.digest=hashBytes(source.content);
  const {content:_,format:__,...binding}=source;
  const fixed={...definition,sources:[binding]};
  await call(f.write('project.create',{label:'Synthetic '+mode+' transport'},'create',0));
  const intentDigest=(await call(f.write('intent.record',{definition:fixed,previousDigest:null},'intent',1))).result.intentDigest;
  const sourceSet={schema:'ontology-source-set/v2',sources:[source],fragments:[{id:'rule',sourceId:source.id,sourceDigest:source.digest,selector:{kind:'utf8-range',start:0,end:Buffer.byteLength(smallSource.content)},fragmentDigest:hashBytes(smallSource.content)}]};
  const sourceRequest=f.write('source.admit',{intentDigest,sourceSet},'sources',2);
  const sourceReceipt=await call(sourceRequest),sourceSetDigest=sourceReceipt.result.sourceSetDigest;
  const expectations=expected(intentDigest,sourceSetDigest),data=expectations.cases.find(c=>c.kind==='shacl').closure.documents[0];
  data.content+='\n# '+padding;data.digest=hashBytes(data.content);
  const expectationRequest=f.write('expectations.record',{definition:expectations},'expectations',3);
  const expectationReceipt=await call(expectationRequest),expectationsDigest=expectationReceipt.result.expectationsDigest;
  assert.equal(expectationReceipt.result.coverage.complete,true);
  const authored=model(intentDigest,sourceSetDigest,expectationsDigest),document=authored.closure.documents[0];
  document.content+='\n# '+padding;document.digest=hashBytes(document.content);
  for(const mapping of authored.mappings)for(const anchor of mapping.anchors)if(anchor.documentId===document.id)anchor.documentDigest=document.digest;
  const modelRequest=f.write('model.record',{draft:authored},'model',4),modelReceipt=await call(modelRequest),modelDigest=modelReceipt.result.modelDigest;
  for(const request of [sourceRequest,expectationRequest,modelRequest])assert.ok(Buffer.byteLength(JSON.stringify(request))>512*1024);
  t.diagnostic(JSON.stringify({mode,encodedRequestBytes:{source:Buffer.byteLength(JSON.stringify(sourceRequest)),expectations:Buffer.byteLength(JSON.stringify(expectationRequest)),model:Buffer.byteLength(JSON.stringify(modelRequest))},sourceSetDigest,expectationsDigest,modelDigest}));
  assert.equal((await call(f.read('project.inspect'))).revision,5);
  await stop();await start();
  for(const [request,receipt] of [[sourceRequest,sourceReceipt],[expectationRequest,expectationReceipt],[modelRequest,modelReceipt]]){
    assert.deepEqual(await call(f.read('receipt.read',{requestId:request.requestId})),receipt);
    assert.deepEqual(await call({...request,expectedRevision:999}),receipt);
  }
  for(const [operation,ids,expectedText] of [
    ['source.read',{sourceSetDigest,sourceId:source.id},source.content],
    ['model.document.read',{assetId:'services',modelDigest,documentId:document.id},document.content],
    ['expectations.read',{assetId:'services',expectationsDigest},canonical(expectations)],
  ]){
    let offset=0,combined='';
    do{const page=await call(f.read(operation,{...ids,offset,maxBytes:65536}));assert.equal(page.current,true);assert.equal(page.complete,page.nextOffset===null);assert.ok(Buffer.byteLength(page.content)<=65536);combined+=page.content;offset=page.nextOffset;}while(offset!==null);
    assert.equal(hashBytes(combined),hashBytes(expectedText));assert.equal(combined,expectedText);
  }
  assert.equal((await call(f.read('project.inspect'))).revision,5);
});

test('owner budgets reserve only the three native writes and preserve JSON structure and input caps',()=>{
  const envelope={workspaceId:'w',serviceId:'s',projectId:'p',operation:'source.admit',input:{text:'x'.repeat(600000)},requestId:'r',expectedRevision:0};
  for(const operation of ['source.admit','model.record','expectations.record'])assert.doesNotThrow(()=>validateRequest({...envelope,operation},true));
  for(const operation of ['project.create','intent.record','reasoning.start','source.metadata.read','unknown'])assert.throws(()=>validateRequest({...envelope,operation},true),{code:'INPUT_LIMIT'});
  assert.equal(inputBudget('expectations.record'),16*1024*1024+4096);assert.equal(ownerRequestBudget('source.admit'),48*1024*1024+8192);
  assert.throws(()=>validateRequest({...envelope,operation:'expectations.record',input:{text:'x'.repeat(inputBudget('expectations.record'))}},true),{code:'INPUT_LIMIT'});
  let nested='value';for(let i=0;i<25;i++)nested={nested};
  assert.throws(()=>validateRequest({...envelope,input:{nested}},true),{code:'INPUT_LIMIT'});
  assert.throws(()=>validateRequest({...envelope,input:{items:Array.from({length:30001},()=>0)}},true),{code:'INPUT_LIMIT'});
});

test('actual 64 MiB SQLite capacity failure rolls back the large model, head, revision and receipt', {timeout:120000},t=>{
  const f=fixture(t);let service=createStandaloneService(f.setup);t.after(()=>service.close());
  const p=prepareModel(service,f);let previous=p.modelDigest,revision=4,lastReceipt,lastRequest,failure;
  const body=ttl+'\n# '+'x'.repeat(8*1024*1024-Buffer.byteLength(ttl)-16);
  for(let i=0;i<10;i++){
    const value=draft(p.intentDigest,p.sourceSetDigest,body+String(i),previous),request=f.write('model.record',{draft:value},`fill-${i}`,revision);
    try{lastReceipt=service.request(request,f.token);lastRequest=request;previous=lastReceipt.result.modelDigest;revision++;}
    catch(error){assert.equal(error.code,'STATE_LIMIT');failure=request;break;}
  }
  assert.ok(failure,'must exercise actual configured SQLite page limit');assert.ok(lastReceipt);
  assert.equal(service.request(f.read('project.inspect'),f.token).revision,revision);
  assert.equal(service.request(f.read('model.inspect',{assetId:'services',modelDigest:null}),f.token).modelDigest,previous);
  assert.throws(()=>service.request(f.read('receipt.read',{requestId:failure.requestId}),f.token),{code:'NOT_FOUND'});
  service.close();
  const db=new DatabaseSync(join(f.root,'ontology.sqlite'),{readOnly:true});
  try{
    assert.equal(db.prepare('SELECT count(*) AS n FROM native_models WHERE digest=?').get(hashBytes(canonical(failure.input.draft))).n,0);
    for(const table of ['receipts','audit'])assert.equal(db.prepare('SELECT count(*) AS n FROM '+table+' WHERE request_id=?').get(failure.requestId).n,0);
    assert.equal(db.prepare('SELECT digest FROM native_model_heads WHERE project_id=? AND asset_id=?').get('demo','services').digest,previous);
    const stateBytes=Number(db.prepare('PRAGMA page_count').get().page_count)*Number(db.prepare('PRAGMA page_size').get().page_size);
    assert.ok(stateBytes<=64*1024*1024);
    t.diagnostic(JSON.stringify({committedLargeModels:revision-4,retainedStateBytes:stateBytes,capacityBytes:64*1024*1024,failureCode:'STATE_LIMIT',failedRequestId:failure.requestId,revision,lastCommittedModelDigest:previous}));
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }finally{db.close();}
  service=createStandaloneService(f.setup);
  assert.deepEqual(service.request({...lastRequest,expectedRevision:0},f.token),lastReceipt);
  assert.throws(()=>service.request(failure,f.token),{code:'STATE_LIMIT'});
  assert.equal(service.request(f.read('project.inspect'),f.token).revision,revision);
  assert.equal(service.request(f.read('model.inspect',{assetId:'services',modelDigest:null}),f.token).modelDigest,previous);
});
