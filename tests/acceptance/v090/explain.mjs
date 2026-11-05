import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {openNativeCollector,query,expectFormal} from './native-public.mjs';
import {hashBytes} from '../../../scripts/standards-gate.mjs';

const converter=new URL('./ReplayConvert.java',import.meta.url),c=await openNativeCollector('EXPLAIN',import.meta.url,[converter]);let problem=null;
const chain='New-Feature-ObjectPropertyChain-001',conflict='DisjointClasses-002';
const conclusion=job=>{const t=job.tasks.find(t=>t.expected==='entailed');assert(t,'Pre-existing upstream entailment required');return t.task.query;};
async function explain(name,original,target='entailment'){
  const job=c.original(original),f=await c.model(name,job),task={kind:'explanation',target,...(target==='entailment'?{query:conclusion(job)}:{})};
  const result=await f.reason(task);assert.equal(result.status,'COMPLETED');assert.equal(result.complete,true);assert.equal(result.error,null);
  const data=result.result;assert.equal(data.method,'DELETION_REPLAY');assert.equal(data.replayVerified,true);assert.equal(data.allMinimalJustifications,false);assert(data.support.length>0);assert.equal(hashBytes(data.replay.content),data.replay.digest);
  for(const ax of data.support){assert.equal(hashBytes(ax.axiom),ax.axiomDigest);assert(ax.sources.length);for(const s of ax.sources){const d=job.closure.documents.find(d=>d.id===s.documentId);assert(d);assert.equal(s.documentDigest,d.digest);assert.equal(s.axiomDigest,ax.axiomDigest);}}
  return {job,f,task,result,data,taskId:f.lastReasoning.taskId};
}
async function projection(item){let content='',offset=0;for(;;){const p=await item.f.read('explanation.read',{assetId:'official',modelDigest:item.f.modelDigest,taskId:item.taskId,offset,maxBytes:4096});content+=p.content;if(p.complete)break;assert(p.nextOffset>offset);offset=p.nextOffset;}return JSON.parse(content);}
function verifyFragments(item){
  assert.equal(item.data.sourceLocationVersion,3);let count=0;
  const tables=new Map(item.data.sourceLocationDocuments.map(t=>[t.documentId,t]));assert.equal(tables.size,item.data.sourceLocationDocuments.length);
  for(const table of tables.values()){
    const d=item.job.closure.documents.find(d=>d.id===table.documentId);assert(d);assert.equal(table.documentDigest,d.digest);assert.equal(table.format,d.format);const bytes=Buffer.from(d.content);
    const lineAt=at=>{let n=1;for(let i=0;i<at;i++)if(bytes[i]===10||bytes[i]===13&&bytes[i+1]!==10)n++;return n;};
    for(const source of table.sources){assert(source.start>=0&&source.end>source.start&&source.end<=bytes.length);const fragment=bytes.subarray(source.start,source.end);assert.equal(hashBytes(fragment),source.fragmentDigest);new TextDecoder('utf-8',{fatal:true}).decode(fragment);new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,source.start));new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,source.end));assert.equal(lineAt(source.start),source.startLine);assert.equal(lineAt(source.end-1),source.endLine);count++;}
  }
  for(const ax of item.data.support)for(const source of ax.sources){const table=tables.get(source.documentId);assert(table);const available=new Set(table.occurrences.map(o=>o.id)),loc=source.sourceLocation;assert.equal(loc.kind,'RDF_CONSTRUCTION');assert(loc.constructionOccurrenceIds.length);for(const id of [...loc.constructionOccurrenceIds,...loc.parserContextOccurrenceIds])assert(available.has(id));}
  assert(count>0);return count;
}
function convertReplay(item,name){
  const tool=JSON.parse(readFileSync(c.config.dl.path));assert.equal(tool.digest,c.config.dl.digest);
  const jars=tool.runtimeFiles.filter(f=>f.kind==='file'&&f.path.startsWith('dependencies/')&&f.path.endsWith('.jar')).map(f=>{const path=join(tool.root,f.path);assert.equal(hashBytes(readFileSync(path)),f.digest);return path;});assert(jars.length);
  const java=join(tool.javaRoot,'bin/java'),javaFile=tool.javaFiles.find(f=>f.path==='bin/java');assert(javaFile);assert.equal(hashBytes(readFileSync(java)),javaFile.digest);
  const input=join(c.root,name+'.ofn'),output=join(c.root,name+'.rdf');writeFileSync(input,item.data.replay.content,{flag:'wx',mode:0o600});
  const converted=spawnSync(java,['-Xmx256m','--class-path',jars.join(':'),fileURLToPath(converter),input,output],{env:{PATH:join(tool.javaRoot,'bin'),LANG:'C.UTF-8',JAVA_TOOL_OPTIONS:'',JDK_JAVA_OPTIONS:'',_JAVA_OPTIONS:''},encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  c.observe({kind:'EXTERNAL_ACCEPTANCE_REPLAY_CONVERTER',productCapability:false,inputDigest:item.data.replay.digest,converterDigest:hashBytes(readFileSync(converter)),toolchainDigest:tool.digest,status:converted.status,signal:converted.signal,stdout:converted.stdout,stderr:converted.stderr});assert.ifError(converted.error);assert.equal(converted.status,0,converted.stderr);
  const content=readFileSync(output,'utf8');return {id:'replay',documentIri:'urn:acceptance:replay:'+name,ontologyIri:null,versionIri:null,format:'rdfxml',content,digest:hashBytes(content)};
}
try{
  await c.case('EXPLAIN-01',async()=>{const x=await explain('explain-positive',chain),r=await x.f.reason({kind:'entailment',query:conclusion(x.job)});expectFormal(r,'ENTAILED');assert.equal(r.result.vacuous,false);return {expected:'Original W3C property-chain entailment has nonempty source-bound replayable supporting axioms',upstream:x.job.caseKey,supportCount:x.data.support.length};});
  await c.case('EXPLAIN-02',async()=>{const x=await explain('explain-conflict',conflict,'inconsistency');expectFormal(await x.f.reason({kind:'consistency'}),'INCONSISTENT');return {expected:'Original W3C disjoint-class inconsistency has nonempty replayable support',upstream:x.job.caseKey,supportCount:x.data.support.length};});
  await c.case('EXPLAIN-03',async()=>{const x=await explain('explain-fragments','New-Feature-Keys-001'),fragmentCount=verifyFragments(x),p=await projection(x);assert.equal(p.axiomSourceLocationCoverage,'COMPLETE');assert.equal(p.businessMeaningProven,false);assert.equal(p.authority,false);assert.deepEqual(p.sourceLocationDocuments,x.data.sourceLocationDocuments);return {expected:'Each supporting parser occurrence resolves to the exact original W3C document and UTF-8 byte span, independently hashed outside the product',upstream:x.job.caseKey,fragmentCount};});
  await c.case('EXPLAIN-04',async()=>{const replays=[];for(const [name,id,target,status] of [['replay-entailment',chain,'entailment','ENTAILED'],['replay-inconsistency',conflict,'inconsistency','INCONSISTENT']]){const x=await explain(name+'-source',id,target),doc=convertReplay(x,name),job={kind:'replay',identifier:name,upstreamId:x.job.upstreamId,caseKey:x.job.caseKey,tasks:[],closure:{rootDocumentId:doc.id,documents:[doc],imports:[]}},f=await c.model(name,job),result=await f.reason(target==='inconsistency'?{kind:'consistency'}:{kind:'entailment',query:conclusion(x.job)});expectFormal(result,status);if(target==='entailment')assert.equal(result.result.vacuous,false);replays.push({upstream:x.job.caseKey,functionalDigest:x.data.replay.digest,rdfxmlDigest:doc.digest,status});}return {expected:'Separate public product tasks reproduce both the upstream entailment and inconsistency from explanation-only support; external format conversion is explicitly attributed',replays};});
  await c.case('EXPLAIN-05',async()=>{const job=c.original(chain),f=await c.model('explain-timeout',job);expectFormal(await f.reason({kind:'entailment',query:conclusion(job)}),'ENTAILED');const entailed=f.lastReasoning,timeout=await f.reason({kind:'explanation',target:'entailment',query:conclusion(job)},{timeoutMs:1});assert.equal(timeout.status,'TIMEOUT');assert.equal(timeout.complete,false);assert.equal(timeout.error.code,'TASK_DEADLINE');assert.equal((await f.read('reasoning.inspect',{taskId:entailed.taskId})).formalStatus,'ENTAILED');const unreadable=await f.request('explanation.read',{assetId:'official',modelDigest:f.modelDigest,taskId:f.lastReasoning.taskId,offset:0,maxBytes:4096});assert.equal(unreadable.body.ok,false);assert.equal(unreadable.body.error.code,'EVIDENCE_INCOMPLETE');return {expected:'A separately bounded explanation timeout cannot erase a completed entailment or become a complete explanation'};});
  await c.case('EXPLAIN-06',async()=>{const job=c.original(chain),f=await c.model('explain-absent',job),target=query('ClassAssertion(<urn:independent:AbsentClass> <urn:independent:AbsentIndividual>)');expectFormal(await f.reason({kind:'entailment',query:target}),'NOT_ENTAILED');const result=await f.reason({kind:'explanation',target:'entailment',query:target});assert.equal(result.status,'INVALID_INPUT');assert.equal(result.complete,false);assert.equal(result.error.code,'NO_EXPLANATION_TARGET');assert.notEqual(result.result?.replayVerified,true);const response=await f.request('explanation.read',{assetId:'official',modelDigest:f.modelDigest,taskId:f.lastReasoning.taskId,offset:0,maxBytes:4096});assert.equal(response.body.ok,false);assert.equal(response.body.error.code,'EVIDENCE_INCOMPLETE');return {expected:'Non-entailed invented conclusions cannot receive a product explanation, regardless of narrative claims',upstream:job.caseKey};});
}catch(e){problem=e.message;}finally{await c.finish(problem);}
