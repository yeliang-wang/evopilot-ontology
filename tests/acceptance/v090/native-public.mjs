import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {openCollector} from './public-collector.mjs';
import {hashBytes} from '../../../scripts/standards-gate.mjs';

export const query=content=>({format:'functional',content:'Ontology('+content+')',digest:hashBytes('Ontology('+content+')')});
export const successful=r=>{assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.ok,true);return r.body.result;};
export function expectFormal(r,status){assert.equal(r.status,status);assert.equal(r.complete,true);assert.equal(r.error,null);assert.equal(r.result.legal,true);return r.result;}
export async function openNativeCollector(group,entry,dependencies=[]){
  const c=await openCollector(group,entry,process.argv.slice(2),[import.meta.url,...dependencies]);
  const jobs=c.frozen('jobs.json').filter(j=>j.kind==='owl');let serial=0;
  return Object.assign(c,{
    original(name){const job=jobs.find(j=>j.identifier===name);assert(job,'Original RDF/XML case missing: '+name);return structuredClone(job);},
    async model(name,job){
      const f=c.fixture(name,true);let revision=0;
      f.read=async(operation,input={})=>successful(await f.request(operation,input));
      f.write=async(operation,input={})=>{const r=successful(await f.request(operation,input,{requestId:'native-'+(++serial),expectedRevision:revision}));revision=r.revision;return r;};
      await f.write('project.create',{label:job.identifier});
      const content=JSON.stringify({upstreamId:job.upstreamId,caseKey:job.caseKey,originalTasks:job.tasks,originalDocuments:job.closure.documents.map(({content,...d})=>d)});
      const source={id:'upstream',locator:job.upstreamId,revision:'frozen-official-corpus',origin:'reference',format:'json',content,digest:hashBytes(content)};
      const {content:_,format:__,...binding}=source;
      const definition={purpose:job.kind==='owl'?'Fixed public product acceptance on original W3C inputs':'Fixed synthetic public integration acceptance',mode:'forward',scope:job.upstreamId,exclusions:['Semantic approval','Business delivery','Software release'],sources:[binding],requirements:[{id:'official',statement:job.kind==='owl'?'Retain original premises and upstream expectations; independently specified API probes do not modify the premises.':'Retain the explicitly synthetic fixture and compare against its predeclared integration expectations.'}]};
      const intentDigest=(await f.write('intent.record',{definition,previousDigest:null})).result.intentDigest;
      const sourceSet={schema:'ontology-source-set/v2',sources:[source],fragments:[{id:'official',sourceId:source.id,sourceDigest:source.digest,selector:{kind:'document'},fragmentDigest:source.digest}]};
      const sourceSetDigest=(await f.write('source.admit',{intentDigest,sourceSet})).result.sourceSetDigest;
      const draft={schema:'ontology-model-draft/v2',assetId:'official',label:job.identifier,intentDigest,sourceSetDigest,previousDigest:null,closure:job.closure,shapes:[],mappings:[],openIssues:['Upstream semantics acceptance; business coverage and semantic review are not asserted.']};
      const modelDigest=(await f.write('model.record',{draft})).result.modelDigest;
      f.draft=draft;f.modelDigest=modelDigest;
      f.reject=async(operation,input,code)=>{const r=await f.request(operation,input,{requestId:'refused-'+(++serial),expectedRevision:revision});assert.notEqual(r.status,200);assert.equal(r.body.ok,false);assert.equal(r.body.error.code,code);assert.equal((await f.read('project.inspect')).revision,revision);return r.body.error;};
      f.reason=async(task,options={})=>{
        const receipt=await f.write('reasoning.start',{assetId:'official',modelDigest,task,...options}),taskId=receipt.result.taskId;f.tasks.push(taskId);const end=performance.now()+180000;let inspected;
        for(;;){inspected=await f.read('reasoning.inspect',{taskId});if(inspected.state==='FINISHED')break;assert.notEqual(inspected.state,'INTERRUPTED','Original task interrupted; retain its exact receipt and reconcile without redispatch');assert(performance.now()<end,'Original task did not finish; retain receipt and reconcile without redispatch');await delay(100);}
        let formal=inspected.result;if(!formal){let content='',offset=0;for(;;){const page=await f.read('reasoning.result.read',{taskId,offset,maxBytes:65536});content+=page.content;if(page.complete)break;offset=page.nextOffset;}formal=JSON.parse(content);}
        assert.deepEqual(await f.read('receipt.read',{requestId:receipt.requestId}),receipt);
        f.lastReasoning={taskId,receipt,inspected,formal};return formal;
      };
      f.official=async()=>{for(const t of job.tasks){const r=await f.reason(t.task),status={legality:'COMPLETED',consistent:'COMPLETED',inconsistent:'INCONSISTENT',entailed:'ENTAILED','not-entailed':'NOT_ENTAILED'}[t.expected];expectFormal(r,status);if(t.expected!=='legality')assert.equal(r.result.consistent,t.expected!=='inconsistent');}return {caseKey:job.caseKey,originalTaskIds:job.tasks.map(t=>t.id)};};
      return f;
    }
  });
}
