import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {canonical,hashBytes} from '../../dist/standalone/validation.js';
import {fixture,sources,expected,definition} from '../helpers/v090-validation.mjs';

const caseSummaries=value=>value.cases.map(c=>({id:c.id,kind:c.kind,requirementIds:[...c.requirementIds],
  expected:c.kind==='shacl'?(c.expectedConforms?'CONFORMS':'NONCONFORMING'):c.expectedStatus}));
function nodeCount(value){return 1+(value!==null&&typeof value==='object'?Object.values(value).reduce((n,v)=>n+nodeCount(v),0):0);}

test('small expectation coverage keeps its complete inline shape and pins the same metadata as inspection',t=>{
  const f=fixture(t),service=createStandaloneService(f.setup);t.after(()=>service.close());
  const p=sources(service,f),value=expected(p.intentDigest,p.sourceSetDigest);
  value.cases=value.cases.filter(c=>c.id!=='sensitive-negative');
  const receipt=service.request(f.write('expectations.record',{definition:value},'small',3),f.token);
  assert.deepEqual(receipt.result.coverage,{complete:false,missing:['r1:owl:negative'],requirements:2,cases:3});
  assert.equal(Object.hasOwn(receipt.result,'metadata'),false,'Small write receipts do not pretend to inline the complete inspect projection');
  const ids={assetId:value.assetId,expectationsDigest:receipt.result.expectationsDigest};
  const inspected=service.request(f.read('expectations.inspect',ids),f.token);
  assert.deepEqual(inspected.coverage,receipt.result.coverage);assert.deepEqual(inspected.cases,caseSummaries(value));
  assert.equal(inspected.metadata.inline,true);
  const page=service.request(f.read('expectations.metadata.read',{...ids,projectionDigest:inspected.metadata.projectionDigest,offset:0,maxBytes:65536}),f.token);
  assert.equal(page.complete,true);assert.equal(hashBytes(page.content),inspected.metadata.projectionDigest);
  const {current,metadata,...projection}=inspected;assert.equal(current,true);assert.deepEqual(JSON.parse(page.content),projection);
});

test('large incomplete expectation coverage commits, replays and remains fully readable across restart and freshness changes',t=>{
  const f=fixture(t),authFile=join(f.root,'credentials.json'),auth=JSON.parse(readFileSync(authFile,'utf8'));
  auth.grants[0].projectIds.push('other');writeFileSync(authFile,JSON.stringify(auth));
  let service=createStandaloneService(f.setup);t.after(()=>service.close());
  const read=(operation,input,projectId='demo')=>service.request({...f.read(operation,input),projectId},f.token);
  const write=(operation,input,requestId,revision)=>service.request(f.write(operation,input,requestId,revision),f.token);
  const p=sources(service,f),value=expected(p.intentDigest,p.sourceSetDigest);
  // Undeclared required shapes are legal incomplete drafts. Their exact IRI
  // evidence must remain available instead of preventing the receipt commit.
  const extraShapes=Array.from({length:350},(_,i)=>({shapeIri:`urn:shape:${i}:`+'字段'.repeat(600),minimumFocusCount:1,requiredFocusIris:[]}));
  value.requiredShapes.push(...extraShapes);
  const request=f.write('expectations.record',{definition:value},'large',3);
  assert.ok(Buffer.byteLength(JSON.stringify(request))>1024*1024);assert.ok(nodeCount(request)<30000);
  const receipt=service.request(request,f.token),ids={assetId:value.assetId,expectationsDigest:receipt.result.expectationsDigest};
  assert.equal(receipt.revision,4);assert.ok(Buffer.byteLength(JSON.stringify(receipt))<256*1024);
  assert.deepEqual(receipt.result.coverage,{complete:false,requirements:2,cases:4,missingCount:350});
  assert.equal(Object.hasOwn(receipt.result.coverage,'missing'),false);assert.equal(Object.hasOwn(receipt.result,'cases'),false);
  const pointer=receipt.result.metadata;assert.equal(pointer.inline,false);assert.equal(pointer.operation,'expectations.metadata.read');
  assert.ok(pointer.bytes>1024*1024);
  const inspected=read('expectations.inspect',ids);assert.equal(inspected.current,true);
  assert.deepEqual(inspected.coverage,receipt.result.coverage);assert.deepEqual(inspected.metadata,pointer);
  assert.equal(inspected.requiredShapes,351);assert.equal(inspected.caseCount,4);assert.equal(Object.hasOwn(inspected,'cases'),false);
  assert.ok(Buffer.byteLength(JSON.stringify(inspected))<256*1024);

  service.close();service=createStandaloneService(f.setup);
  assert.deepEqual(service.request({...request,expectedRevision:999},f.token),receipt);
  assert.deepEqual(read('receipt.read',{requestId:'large'}),receipt);assert.equal(read('project.inspect',{}).revision,4);
  let offset=0,combined='',pages=0;
  do {
    const page=read('expectations.metadata.read',{...ids,projectionDigest:pointer.projectionDigest,offset,maxBytes:65536});
    assert.equal(page.current,true);assert.equal(page.assetId,ids.assetId);assert.equal(page.expectationsDigest,ids.expectationsDigest);
    assert.equal(page.startByte,offset);assert.equal(page.projectionDigest,pointer.projectionDigest);assert.equal(page.bytes,pointer.bytes);
    assert.equal(Buffer.byteLength(page.content),page.endByte-page.startByte);assert.ok(Buffer.byteLength(page.content)<=65536);
    assert.equal(page.complete,page.nextOffset===null);combined+=page.content;offset=page.nextOffset;pages++;
  }while(offset!==null);
  assert.ok(pages>16);assert.equal(Buffer.byteLength(combined),pointer.bytes);assert.equal(hashBytes(combined),pointer.projectionDigest);
  const projection=JSON.parse(combined);assert.equal(canonical(projection),combined);assert.equal(Object.hasOwn(projection,'current'),false);
  assert.deepEqual(projection.coverage,{complete:false,missing:extraShapes.map(s=>'shape:'+s.shapeIri+':requirement'),requirements:2,cases:4});
  assert.deepEqual(projection.cases,caseSummaries(value));assert.equal(projection.requiredShapes,value.requiredShapes.length);
  assert.equal(projection.expectationsDigest,ids.expectationsDigest);assert.equal(projection.intentDigest,p.intentDigest);assert.equal(projection.sourceSetDigest,p.sourceSetDigest);
  const bytes=Buffer.from(combined),interior=bytes.findIndex(b=>(b&0xc0)===0x80),pageInput={...ids,projectionDigest:pointer.projectionDigest,offset:0,maxBytes:65536};
  assert.ok(interior>0);
  for(const offset of [-1,interior,bytes.length+1])assert.throws(()=>read('expectations.metadata.read',{...pageInput,offset}),{code:'INVALID_INPUT'});
  for(const maxBytes of [3,65537])assert.throws(()=>read('expectations.metadata.read',{...pageInput,maxBytes}),{code:'INVALID_INPUT'});
  assert.throws(()=>read('expectations.metadata.read',{...pageInput,projectionDigest:hashBytes('different projection')}),{code:'METADATA_CONFLICT'});
  assert.throws(()=>read('expectations.metadata.read',{...pageInput,expectationsDigest:hashBytes('absent expectations')}),{code:'NOT_FOUND'});
  const end=read('expectations.metadata.read',{...pageInput,offset:bytes.length,maxBytes:4});assert.equal(end.content,'');assert.equal(end.complete,true);

  const replacement=expected(p.intentDigest,p.sourceSetDigest,ids.expectationsDigest);
  const next=write('expectations.record',{definition:replacement},'replacement',4);
  const nextPointer=read('expectations.inspect',{assetId:ids.assetId,expectationsDigest:next.result.expectationsDigest}).metadata;
  assert.equal(read('expectations.inspect',ids).current,false);assert.deepEqual(read('expectations.inspect',ids).metadata,pointer);
  assert.equal(read('expectations.metadata.read',pageInput).current,false);
  assert.deepEqual(service.request({...request,expectedRevision:999},f.token),receipt);
  assert.equal(read('expectations.inspect',{assetId:ids.assetId,expectationsDigest:null}).expectationsDigest,next.result.expectationsDigest);
  write('intent.record',{definition:{...definition,scope:'Changed independently scoped interpretation'},previousDigest:p.intentDigest},'changed-intent',5);
  const nextIds={assetId:ids.assetId,expectationsDigest:next.result.expectationsDigest};
  assert.equal(read('expectations.inspect',nextIds).current,false);assert.deepEqual(read('expectations.inspect',nextIds).metadata,nextPointer);
  service.request({...f.write('project.create',{label:'Different authorized scope'},'other',0),projectId:'other'},f.token);
  assert.throws(()=>read('expectations.metadata.read',pageInput,'other'),{code:'NOT_FOUND'});
  assert.throws(()=>read('expectations.metadata.read',pageInput,'foreign'),{code:'FORBIDDEN'});
  auth.grants[0].revoked=true;writeFileSync(authFile,JSON.stringify(auth));
  assert.throws(()=>read('expectations.metadata.read',pageInput),{code:'UNAUTHENTICATED'});
});
