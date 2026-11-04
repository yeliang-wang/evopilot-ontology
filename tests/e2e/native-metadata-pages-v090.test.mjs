import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {canonical,hashBytes} from '../../dist/standalone/validation.js';
import {fixture,draft,definition} from '../helpers/v090-native.mjs';

test('large native metadata remains completely readable with pinned identity, UTF-8 pages and independent freshness',t=>{
  const f=fixture(t),authFile=join(f.root,'credentials.json'),auth=JSON.parse(readFileSync(authFile,'utf8'));
  auth.grants[0].projectIds.push('other');writeFileSync(authFile,JSON.stringify(auth));
  let service=createStandaloneService(f.setup);t.after(()=>service.close());
  const read=(operation,input,projectId='demo')=>service.request({...f.read(operation,input),projectId},f.token);
  const write=(operation,input,requestId,revision)=>service.request(f.write(operation,input,requestId,revision),f.token);
  const key='字段'.repeat(600),selected='敏感😀',content=JSON.stringify({[key]:selected});
  const source={id:'requirement',locator:'fixed-development.json',revision:'v1',origin:'requirement',format:'json',content,digest:hashBytes(content)};
  const {format:_,content:__,...binding}=source;
  const intent={...definition,sources:[binding]};
  const fragments=Array.from({length:350},(_,i)=>({id:i===0?'rule':`rule-${i}`,sourceId:source.id,sourceDigest:source.digest,
    selector:{kind:'json-pointer',pointer:'/'+key},fragmentDigest:hashBytes(JSON.stringify(selected))}));
  write('project.create',{label:'Synthetic large metadata'},'create',0);
  const intentDigest=write('intent.record',{definition:intent,previousDigest:null},'intent',1).result.intentDigest;
  const sourceSet={schema:'ontology-source-set/v2',sources:[source],fragments};
  const sourceReceipt=write('source.admit',{intentDigest,sourceSet},'sources',2),sourceSetDigest=sourceReceipt.result.sourceSetDigest;
  const model=draft(intentDigest,sourceSetDigest);
  model.openIssues=Array.from({length:350},(_,i)=>`Development issue ${i}: `+'业务😀'.repeat(350));
  const modelReceipt=write('model.record',{draft:model},'model',3),modelDigest=modelReceipt.result.modelDigest;
  const cases=[
    {inspect:'source.inspect',operation:'source.metadata.read',ids:{sourceSetDigest},omitted:['sources','fragments'],check:m=>{assert.deepEqual(m.fragments.map(f=>f.selector),fragments.map(f=>f.selector));assert.equal(m.sources[0].digest,source.digest);assert.equal(m.fragments.length,350);}},
    {inspect:'model.inspect',operation:'model.metadata.read',ids:{assetId:'services',modelDigest},omitted:['openIssues','mappings','closure'],check:m=>{assert.deepEqual(m.openIssues,model.openIssues);assert.deepEqual(m.mappings,model.mappings);assert.equal(m.closure.documents[0].digest,model.closure.documents[0].digest);assert.equal(Object.hasOwn(m.closure.documents[0],'content'),false);}},
  ];
  for(const c of cases){
    const inspected=read(c.inspect,c.ids);assert.equal(inspected.current,true);assert.equal(inspected.metadata.inline,false);
    assert.ok(inspected.metadata.bytes>1024*1024);assert.ok(Buffer.byteLength(JSON.stringify(inspected))<256*1024);
    c.omitted.forEach(key=>assert.equal(Object.hasOwn(inspected,key),false));
    assert.equal(inspected.metadata.operation,c.operation);c.pointer=inspected.metadata;
  }
  // Read the retained bytes from a new owner instance, not the admission objects.
  service.close();service=createStandaloneService(f.setup);
  assert.deepEqual(write('source.admit',{intentDigest,sourceSet},'sources',999),sourceReceipt);
  assert.deepEqual(write('model.record',{draft:model},'model',999),modelReceipt);
  for(const c of cases){
    let offset=0,combined='',pages=0;
    do {
      const page=read(c.operation,{...c.ids,projectionDigest:c.pointer.projectionDigest,offset,maxBytes:65536});
      assert.equal(page.current,true);assert.equal(page.projectionDigest,c.pointer.projectionDigest);assert.equal(page.startByte,offset);
      assert.equal(Buffer.byteLength(page.content),page.endByte-page.startByte);assert.ok(Buffer.byteLength(page.content)<=65536);
      assert.equal(page.complete,page.nextOffset===null);combined+=page.content;offset=page.nextOffset;pages++;
    }while(offset!==null);
    assert.ok(pages>16);assert.equal(hashBytes(combined),c.pointer.projectionDigest);assert.equal(Buffer.byteLength(combined),c.pointer.bytes);
    assert.equal(canonical(JSON.parse(combined)),combined);c.check(JSON.parse(combined));
    const bytes=Buffer.from(combined),interior=bytes.findIndex(b=>(b&0xc0)===0x80);
    assert.ok(interior>0);
    for(const offset of [-1,interior,bytes.length+1])assert.throws(()=>read(c.operation,{...c.ids,projectionDigest:c.pointer.projectionDigest,offset,maxBytes:65536}),{code:'INVALID_INPUT'});
    assert.throws(()=>read(c.operation,{...c.ids,projectionDigest:hashBytes('wrong'),offset:0,maxBytes:65536}),{code:'METADATA_CONFLICT'});
    assert.throws(()=>read(c.operation,{...c.ids,projectionDigest:c.pointer.projectionDigest,offset:0,maxBytes:65537}),{code:'INVALID_INPUT'});
    const final=read(c.operation,{...c.ids,projectionDigest:c.pointer.projectionDigest,offset:bytes.length,maxBytes:4});
    assert.equal(final.content,'');assert.equal(final.complete,true);
  }
  write('intent.record',{definition:{...intent,scope:'A changed current interpretation'},previousDigest:intentDigest},'changed',4);
  service.request({...f.write('project.create',{label:'Other scope'},'other',0),projectId:'other'},f.token);
  for(const c of cases){
    const inspected=read(c.inspect,c.ids);assert.equal(inspected.current,false);assert.deepEqual(inspected.metadata,c.pointer);
    const input={...c.ids,projectionDigest:c.pointer.projectionDigest,offset:0,maxBytes:64};
    assert.equal(read(c.operation,input).current,false);
    assert.throws(()=>read(c.operation,input,'other'),{code:'NOT_FOUND'});
    assert.throws(()=>read(c.operation,input,'foreign'),{code:'FORBIDDEN'});
  }
  auth.grants[0].revoked=true;writeFileSync(authFile,JSON.stringify(auth));
  const c=cases[0];assert.throws(()=>read(c.operation,{...c.ids,projectionDigest:c.pointer.projectionDigest,offset:0,maxBytes:64}),{code:'UNAUTHENTICATED'});
});
