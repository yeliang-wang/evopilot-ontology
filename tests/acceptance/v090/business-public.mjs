import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {openCollector} from './public-collector.mjs';
import {source,definition,sourceSet,expected,model} from './business-fixtures.mjs';

export const success=r=>{assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.ok,true);return r.body.result;};
export async function openBusinessCollector(group,entry){
  const c=await openCollector(group,entry,process.argv.slice(2),[import.meta.url,new URL('./business-fixtures.mjs',import.meta.url)]);let serial=0;
  return Object.assign(c,{
    async seed(name,change={}){
      const f=c.fixture(name,true);let revision=0;
      f.read=async(operation,input={})=>success(await f.request(operation,input));
      f.write=async(operation,input={})=>{const r=success(await f.request(operation,input,{requestId:'business-'+(++serial),expectedRevision:revision}));revision=r.revision;return r;};
      f.reject=async(operation,input,code)=>{const r=await f.request(operation,input,{requestId:'refused-'+(++serial),expectedRevision:revision});assert.equal(r.body.ok,false);assert.equal(r.body.error.code,code);assert.equal((await f.read('project.inspect')).revision,revision);};
      f.wait=async(kind,taskId)=>{const end=performance.now()+180000;let inspected;for(;;){inspected=await f.read(kind+'.inspect',{taskId});if(inspected.state==='FINISHED')break;assert(performance.now()<end,'Original task unresolved; no redispatch');await delay(100);}let formal=inspected.result;if(!formal){let offset=0,text='';for(;;){const p=await f.read(kind+'.result.read',{taskId,offset,maxBytes:65536});text+=p.content;if(p.complete)break;offset=p.nextOffset;}formal=JSON.parse(text);}return {taskId,inspected,formal};};
      f.start=async(kind,input)=>{const receipt=await f.write(kind+'.start',{assetId:'services',modelDigest:f.modelDigest,...input});f.tasks.push(receipt.result.taskId);return receipt;};
      f.execute=async(kind,input={})=>{const receipt=await f.start(kind,input),result=await f.wait(kind,receipt.result.taskId);assert.deepEqual(await f.read('receipt.read',{requestId:receipt.requestId}),receipt);return result;};
      await f.write('project.create',{label:'Fixed synthetic service acceptance'});
      f.source=structuredClone(source);f.definition=structuredClone(definition);f.sourceSet=structuredClone(sourceSet);change.sources?.(f);
      f.intentDigest=(await f.write('intent.record',{definition:f.definition,previousDigest:null})).result.intentDigest;
      f.sourceSetDigest=(await f.write('source.admit',{intentDigest:f.intentDigest,sourceSet:f.sourceSet})).result.sourceSetDigest;
      f.expectations=expected(f.intentDigest,f.sourceSetDigest);change.expectations?.(f.expectations);
      f.expectationsDigest=(await f.write('expectations.record',{definition:f.expectations})).result.expectationsDigest;
      f.model=model(f.intentDigest,f.sourceSetDigest,f.expectationsDigest);change.model?.(f.model);
      f.modelDigest=(await f.write('model.record',{draft:f.model})).result.modelDigest;
      f.revise=async draft=>{const receipt=await f.write('model.record',{draft});f.model=draft;f.modelDigest=receipt.result.modelDigest;return receipt;};
      return f;
    }
  });
}
