import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,cpSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createDLRunner} from '../../dist/reasoning/runner.js';
import {readDLToolchain,verifyDLToolchain} from '../../dist/reasoning/toolchain.js';
import {closureDigest} from '../../dist/reasoning/request.js';
import {createStandaloneService} from '../../dist/standalone/service.js';
import {grantReviewer} from '../../dist/installation/reviewer.js';
import {hash,hashBytes} from '../../dist/standalone/validation.js';
import {explainEvidence} from '../../dist/native-v2/explanations.js';
import {verifyDeliveryBundle} from '@evopilot-next/ontology/native-v2';
import {fixture,prepare,configuration,terminal} from '../helpers/v090-validation.mjs';
import {sourceSet,draft} from '../helpers/v090-native.mjs';

// Actual-toolchain development regressions. All business objects and the one
// explicit reviewer decision below belong only to this isolated synthetic test.
// No fixture result establishes fixed acceptance or a real semantic decision.
const NS='urn:rdf-location:',OWL='http://www.w3.org/2002/07/owl#';
const prefix='@prefix : <'+NS+'> .\n@prefix owl: <'+OWL+'> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n';
let base,binding,runner,sequence=0;
before(()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Actual current DL and SHACL bindings are required; no mock or skip path');
  const selected=readDLToolchain(process.env.EVOPILOT_TEST_DL_TOOLCHAIN);verifyDLToolchain(selected);
  assert.equal(selected.workerSourceDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/Worker.java',import.meta.url))));
  assert.equal(selected.dependencyLockDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/dependencies.json',import.meta.url))));
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-rdf-locations-')));
  const root=join(base,'runtime');cpSync(selected.root,root,{recursive:true});chmodSync(root,0o700);
  const {digest:_,...identity}={...selected,root};binding={...identity,digest:hash(identity)};
  const toolchainFile=join(root,'toolchain.json');writeFileSync(toolchainFile,JSON.stringify(binding),{mode:0o600});
  const workRoot=join(base,'worker');mkdirSync(workRoot,{mode:0o700});runner=createDLRunner({toolchainFile,workRoot});
});
after(()=>{if(base)rmSync(base,{recursive:true,force:true});});

const query=body=>{const content='Prefix(:=<'+NS+'>) Ontology('+body+')';return {format:'functional',content,digest:hashBytes(content)};};
const document=(content,format='turtle')=>({id:'model',documentIri:'https://rdf-location.example/document',ontologyIri:null,versionIri:null,format,content,digest:hashBytes(content)});
function request(doc,target){return {schema:'ontology-dl-request/v1',requestId:'rdf-locations-'+(++sequence),closure:{rootDocumentId:doc.id,documents:[doc],imports:[]},task:{kind:'explanation',target:'entailment',query:target}};}
async function execute(input,status='COMPLETED'){
  const result=await runner.run(input);assert.equal(result.status,status,JSON.stringify(result));assert.equal(result.complete,true);
  assert.equal(result.requestId,input.requestId);assert.equal(result.requestDigest,hash(input));assert.equal(result.closureDigest,closureDigest(input.closure));assert.equal(result.toolchainDigest,binding.digest);
  return result;
}
function projection(input,result){
  const value=draft(hash('synthetic intent'),hash(sourceSet));value.closure=structuredClone(input.closure);
  value.mappings[0].anchors=input.closure.documents.map(d=>({documentId:d.id,documentDigest:d.digest,start:0,end:Buffer.byteLength(d.content),fragmentDigest:d.digest}));
  return explainEvidence({taskId:input.requestId,kind:'dl',request:input,result},{digest:hash(value),draft:value,closureDigest:closureDigest(value.closure)},{sourceSet,fragments:sourceSet.fragments});
}
const sorted=values=>[...new Set(values)].sort((a,b)=>a-b);
function ascending(values){assert.deepEqual(values,sorted(values));for(const id of values)assert.ok(Number.isSafeInteger(id)&&id>0);}
function originalSlice(content,source){
  const bytes=Buffer.from(content),piece=bytes.subarray(source.start,source.end),text=new TextDecoder('utf-8',{fatal:true}).decode(piece);
  assert.ok(source.start>=0&&source.end>source.start&&source.end<=bytes.length);assert.equal(source.fragmentDigest,hashBytes(piece));
  const before=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,source.start));
  // Count raw line breaks before the first/last covered code point. A CRLF is
  // one break, including when a range ends on the CR itself.
  const lineAt=offset=>{let line=1;for(let i=0;i<offset;i++){if(content[i]==='\n'||content[i]==='\r'&&content[i+1]!=='\n')line++;}return line;};
  const last=[...text].at(-1);assert.equal(source.startLine,lineAt(before.length));assert.equal(source.endLine,lineAt(before.length+text.length-last.length));
  return text;
}
function sourceTables(documents,data){
  assert.equal(data.sourceLocationVersion,2);assert.ok(Array.isArray(data.sourceLocationDocuments));
  const tableById=new Map(data.sourceLocationDocuments.map(t=>[t.documentId,t]));assert.equal(tableById.size,data.sourceLocationDocuments.length);
  const origins=data.support.flatMap(a=>a.sources??a.documents);
  for(const table of data.sourceLocationDocuments){
    const doc=documents.find(d=>d.id===table.documentId);assert.ok(doc);assert.equal(table.documentDigest,doc.digest);assert.equal(table.format,'turtle');assert.equal(table.parserId,'owlapi-turtle-occurrences:1');
    for(const name of ['sources','contexts','occurrences'])ascending(table[name].map(v=>v.id));
    const sourceMap=new Map(table.sources.map(v=>[v.id,v])),contextMap=new Map(table.contexts.map(v=>[v.id,v])),occurrenceMap=new Map(table.occurrences.map(v=>[v.id,v]));
    for(const s of table.sources)originalSlice(doc.content,s);
    const neededOccurrences=new Set(),neededSources=new Set(),neededContexts=new Set();
    for(const origin of origins.filter(o=>o.documentId===doc.id)){
      const location=origin.sourceLocation??origin.axiomSourceLocation;assert.equal(location.schema,'ontology-axiom-source-location/v2');assert.equal(location.kind,'RDF_CONSTRUCTION');assert.ok(location.constructionOccurrenceIds.length);
      for(const name of ['constructionOccurrenceIds','parserContextOccurrenceIds']){ascending(location[name]);for(const id of location[name])neededOccurrences.add(id);}
    }
    for(const id of neededOccurrences){
      const occurrence=occurrenceMap.get(id);assert.ok(occurrence,'Every origin resolves in its own document table');
      for(const name of ['subject','predicate','object']){
        const term=occurrence[name];assert.ok(sourceMap.has(term.sourceId));neededSources.add(term.sourceId);ascending(term.contextIds);for(const c of term.contextIds)neededContexts.add(c);
        if(term.generated)assert.ok(['PROPERTY_LIST','COLLECTION','ITEM'].includes(sourceMap.get(term.sourceId).kind),'Generated terms retain a real generating construct');
      }
    }
    const visit=id=>{
      const c=contextMap.get(id);assert.ok(c,'Lexical context reference is closed');ascending(c.dependencyContextIds);
      if(c.sourceId===0)assert.ok(['DOCUMENT','BUILTIN'].includes(c.kind));else{assert.ok(sourceMap.has(c.sourceId));neededSources.add(c.sourceId);}
      for(const child of c.dependencyContextIds){assert.ok(child<c.id);if(!neededContexts.has(child)){neededContexts.add(child);visit(child);}}
    };
    for(const id of [...neededContexts])visit(id);
    assert.deepEqual(table.occurrences.map(v=>v.id),sorted(neededOccurrences),'Table must not retain unrelated RDF events');
    assert.deepEqual(table.sources.map(v=>v.id),sorted(neededSources),'Table contains exactly reachable raw source ranges');
    assert.deepEqual(table.contexts.map(v=>v.id),sorted(neededContexts),'Table contains exactly reachable lexical contexts');
  }
  assert.deepEqual([...tableById.keys()].sort(),[...new Set(origins.filter(o=>documents.find(d=>d.id===o.documentId)?.format==='turtle').map(o=>o.documentId))].sort());
  return tableById;
}
async function explain(content,target){
  const input=request(document(content),target),result=await execute(input),data=result.result;
  assert.equal(data.method,'DELETION_REPLAY');assert.equal(data.replayVerified,true);assert.equal(data.allMinimalJustifications,false);assert.equal(data.replay.digest,hashBytes(data.replay.content));
  sourceTables(input.closure.documents,data);const projected=projection(input,result);assert.equal(projected.axiomSourceLocationCoverage,'COMPLETE');assert.deepEqual(projected.sourceLocationDocuments,data.sourceLocationDocuments);assert.equal(projected.businessMeaningProven,false);
  return {input,result,data,table:data.sourceLocationDocuments[0],projected};
}
function axiom(data,rendering){const entry=data.support.find(a=>a.axiom===rendering);assert.ok(entry,'Expected independent structural axiom '+rendering);assert.equal(entry.axiomDigest,hashBytes(rendering));assert.equal(entry.sources.length,1);return entry.sources[0].sourceLocation;}
function role(location,name,required,excluded){const actual=location[name];for(const id of required)assert.ok(actual.includes(id),name+' missing '+id+': '+actual);for(const id of excluded)assert.ok(!actual.includes(id),name+' borrowed unrelated occurrence '+id+': '+actual);return actual;}
const subSome=name=>'SubClassOf(<'+NS+name+'> ObjectSomeValuesFrom(<'+NS+'p> <'+NS+'C>))';
const text=rows=>prefix+rows.join('\n')+'\n';

test('actual native explanation resolves relative BASE chains and records the current lexical dependency instead of a stale cached IRI',async()=>{
  const content='@prefix owl: <'+OWL+'> .\n'+String.raw`@base <https://iri.example/a/b/> .
<Thing> a owl:Class . <item> a owl:NamedIndividual . <item> a <Thing> .
@base <../second/> .
<Thing> a owl:Class . <item> a owl:NamedIndividual . <\u0069tem> a <Thing> .`;
  const target='ClassAssertion(<https://iri.example/a/second/Thing> <https://iri.example/a/second/item>)';
  const {data,table}=await explain(content,query(target));
  const location=axiom(data,target);assert.ok(location.constructionOccurrenceIds.length);
  const assertion=table.occurrences.find(o=>o.triple.subject==='https://iri.example/a/second/item'&&o.triple.object.kind==='RESOURCE'&&o.triple.object.value==='https://iri.example/a/second/Thing');
  assert.ok(assertion);assert.ok(location.constructionOccurrenceIds.includes(assertion.id));
  const contexts=new Map(table.contexts.map(c=>[c.id,c])),sources=new Map(table.sources.map(s=>[s.id,s]));
  const subjectContexts=assertion.subject.contextIds.map(id=>contexts.get(id));
  assert.deepEqual(subjectContexts.map(c=>c.resolved),['https://iri.example/a/second/']);
  const active=subjectContexts[0];assert.equal(active.kind,'BASE');assert.equal(active.dependencyContextIds.length,1);
  assert.equal(contexts.get(active.dependencyContextIds[0]).resolved,'https://iri.example/a/b/');
  assert.equal(originalSlice(content,sources.get(active.sourceId)),'@base <../second/> .');
  assert.equal(originalSlice(content,sources.get(assertion.subject.sourceId)),String.raw`<\u0069tem>`);
});

test('native ordinary and explanation parsing reject structural IRI errors without claiming completed source evidence',async()=>{
  const target=query('ClassAssertion(:A :a)');
  for(const invalid of ['urn:bad%GG','https://[not-ip]/x','1:relative','urn:x#a#b']){
    const content=prefix+':A a owl:Class . :a a owl:NamedIndividual . :a a :A . <'+invalid+'> a owl:Class .';
    for(const task of [{kind:'legality'},{kind:'explanation',target:'entailment',query:target}]){
      const input=request(document(content),target);input.task=task;
      const result=await runner.run(input);assert.equal(result.status,'INVALID_INPUT',JSON.stringify(result));
      assert.equal(result.error.code,'ONTOLOGY_PARSE');assert.equal(result.complete,false);assert.equal(result.result.sourceLocationVersion,undefined);assert.equal(result.result.sourceLocationDocuments,undefined);
    }
  }
});

test('actual explanation preserves shared restriction definitions for first and cached callers in either source order',async()=>{
  const declarations=[':A a owl:Class .',':B a owl:Class .',':C a owl:Class .',':p a owl:ObjectProperty .'];
  const definitions=['_:r a owl:Restriction .','_:r owl:onProperty :p .','_:r owl:someValuesFrom :C .'];
  const callers=[':A rdfs:subClassOf _:r .',':B rdfs:subClassOf _:r .'];
  const unrelated=[':Unrelated a owl:Class .',':Unrelated rdfs:subClassOf :C .'];
  for(const rootsFirst of [false,true]){
    const {data}=await explain(text([...declarations,...(rootsFirst?[...callers,...definitions]:[...definitions,...callers]),...unrelated]),query('SubClassOf(:A ObjectSomeValuesFrom(:p :C)) SubClassOf(:B ObjectSomeValuesFrom(:p :C))'));
    assert.equal(data.support.length,2);
    role(axiom(data,subSome('A')),'constructionOccurrenceIds',rootsFirst?[5,7,8,9]:[5,6,7,8],rootsFirst?[6,10,11]:[9,10,11]);
    role(axiom(data,subSome('B')),'constructionOccurrenceIds',rootsFirst?[6,7,8,9]:[5,6,7,9],rootsFirst?[5,10,11]:[8,10,11]);
  }
});

test('shared list facts remain construction for both axioms while matcher context remains a separate role',async()=>{
  const content=text([':A a owl:Class .',':B a owl:Class .',':C a owl:Class .',':D a owl:Class .','_:left a owl:Class .','_:left owl:intersectionOf _:list .','_:list rdf:first :C .','_:list rdf:rest _:tail .','_:tail rdf:first :D .','_:tail rdf:rest rdf:nil .','_:right a owl:Class .','_:right owl:intersectionOf _:list .',':A rdfs:subClassOf _:left .',':B rdfs:subClassOf _:right .',':Unrelated a owl:Class .',':Unrelated rdfs:subClassOf :C .']);
  const {data,table}=await explain(content,query('SubClassOf(:A ObjectIntersectionOf(:C :D)) SubClassOf(:B ObjectIntersectionOf(:C :D))'));assert.equal(data.support.length,2);
  const find=name=>axiom(data,'SubClassOf(<'+NS+name+'> ObjectIntersectionOf(<'+NS+'C> <'+NS+'D>))');
  role(find('A'),'constructionOccurrenceIds',[6,7,8,9,10,13],[12,14,15,16]);role(find('B'),'constructionOccurrenceIds',[7,8,9,10,12,14],[6,13,15,16]);
  role(find('A'),'parserContextOccurrenceIds',[6],[12,14,15,16]);role(find('B'),'parserContextOccurrenceIds',[12],[6,13,15,16]);
  assert.equal(table.occurrences.filter(o=>o.id===10).length,1,'One shared rdf:nil tail event is stored once, referenced by both axioms');
});

test('streaming universal-restriction classification does not demote cached constructor inputs into context only',async()=>{
  const content=text([':A a owl:Class .',':B a owl:Class .',':C a owl:Class .',':p a owl:ObjectProperty .','_:r a owl:Restriction .','_:r owl:onProperty :p .','_:r owl:allValuesFrom :C .',':A rdfs:subClassOf _:r .',':B rdfs:subClassOf _:r .',':Unrelated a owl:Class .',':Unrelated rdfs:subClassOf :C .']);
  const {data}=await explain(content,query('SubClassOf(:A ObjectAllValuesFrom(:p :C)) SubClassOf(:B ObjectAllValuesFrom(:p :C))'));
  for(const [name,own,other] of [['A',8,9],['B',9,8]]){
    const location=axiom(data,'SubClassOf(<'+NS+name+'> ObjectAllValuesFrom(<'+NS+'p> <'+NS+'C>))');
    role(location,'constructionOccurrenceIds',[5,6,7,own],[other,10,11]);role(location,'parserContextOccurrenceIds',[4,7],[other,10,11]);
  }
});

test('duplicate RDF events keep original non-BMP and escaped UTF-8 tokens, hashes and mixed-newline coordinates',async()=>{
  const literalIRI='<'+NS+'A😀>',escapedIRI='<'+NS+'A\\U0001F600>',superIRI='<'+NS+'B雪>';
  const content='# decoy 雪😀 '+literalIRI+'\r\n'+prefix+literalIRI+' a owl:Class .\r'+superIRI+' a owl:Class .\n'+literalIRI+' rdfs:subClassOf '+superIRI+' .\r\n'+escapedIRI+' rdfs:subClassOf '+superIRI+' .\r:Unrelated a owl:Class .\n:Unrelated rdfs:subClassOf '+superIRI+' .\n';
  const target=query('SubClassOf('+literalIRI+' '+superIRI+')'),{data,table,input}=await explain(content,target);assert.equal(data.support.length,1);
  const location=axiom(data,'SubClassOf('+literalIRI+' '+superIRI+')');role(location,'constructionOccurrenceIds',[3,4],[5,6]);
  const triples=[3,4].map(id=>table.occurrences.find(o=>o.id===id));assert.deepEqual(triples[0].triple,triples[1].triple);assert.notEqual(triples[0].subject.sourceId,triples[1].subject.sourceId);
  for(const [o,spelling] of [[triples[0],literalIRI],[triples[1],escapedIRI]]){
    const source=table.sources.find(s=>s.id===o.subject.sourceId);assert.equal(originalSlice(content,source),spelling);
    const start=content.indexOf(spelling+' rdfs:subClassOf');assert.equal(source.start,Buffer.byteLength(content.slice(0,start)));assert.equal(source.end,source.start+Buffer.byteLength(spelling));
  }
  const replay=request(document(data.replay.content,'functional'),target);replay.task={kind:'entailment',query:target};assert.equal((await execute(replay,'ENTAILED')).result.jointEntailed,true);
  assert.equal(input.closure.documents[0].digest,hashBytes(content));
});

test('retained lexical contexts bind each relative occurrence to its current BASE while prefix bindings retain their declaration context',async()=>{
  const content='@base <https://first.example/> .\n@prefix ex: <relative/> .\n<subject> a owl:NamedIndividual .\n<object> a owl:NamedIndividual .\nex:p a owl:ObjectProperty .\n<subject> ex:p <object> .\n@base <https://second.example/> .\n<subject> ex:p <object> .\n@prefix ex: <https://changed.example/> .\nex:p a owl:ObjectProperty .\n<new> a owl:NamedIndividual .\n<fresh> a owl:NamedIndividual .\n<new> ex:p <fresh> .\n@prefix unused: <https://unrelated.example/> .\n';
  const target=query('ObjectPropertyAssertion(<https://first.example/relative/p> <https://first.example/subject> <https://first.example/object>) ObjectPropertyAssertion(<https://first.example/relative/p> <https://second.example/subject> <https://second.example/object>) ObjectPropertyAssertion(<https://changed.example/p> <https://second.example/new> <https://second.example/fresh>)');
  const {data,table}=await explain(content,target);assert.equal(data.support.length,3);
  const byId=new Map(table.occurrences.map(o=>[o.id,o])),contexts=new Map(table.contexts.map(c=>[c.id,c]));
  // Fixed source-event positions and RFC-derived identifiers are the oracle.
  // The old cross-BASE cache defect is retained only in the upstream parser test.
  assert.deepEqual([4,5,9].map(id=>byId.get(id).triple),[
    {subject:'https://first.example/subject',predicate:'https://first.example/relative/p',object:{kind:'RESOURCE',value:'https://first.example/object'}},
    {subject:'https://second.example/subject',predicate:'https://first.example/relative/p',object:{kind:'RESOURCE',value:'https://second.example/object'}},
    {subject:'https://second.example/new',predicate:'https://changed.example/p',object:{kind:'RESOURCE',value:'https://second.example/fresh'}}
  ]);
  const expand=id=>{const c=contexts.get(id);return [c,...c.dependencyContextIds.flatMap(expand)];};const forTerm=t=>t.contextIds.flatMap(expand);
  const first=forTerm(byId.get(4).subject),current=forTerm(byId.get(5).subject);
  assert.ok(first.some(c=>c.kind==='BASE'&&c.resolved==='https://first.example/'));assert.ok(!first.some(c=>c.resolved==='https://second.example/'));
  assert.ok(current.some(c=>c.kind==='BASE'&&c.resolved==='https://second.example/'));assert.ok(!current.some(c=>c.resolved==='https://first.example/'));
  assert.ok(forTerm(byId.get(5).predicate).some(c=>c.kind==='PREFIX'&&c.resolved==='https://first.example/relative/'));
  assert.ok(forTerm(byId.get(9).predicate).some(c=>c.kind==='PREFIX'&&c.resolved==='https://changed.example/'));
  assert.ok(forTerm(byId.get(9).subject).some(c=>c.kind==='BASE'&&c.resolved==='https://second.example/'));assert.ok(!table.contexts.some(c=>c.prefixName==='unused:'));
});

test('actual duplicate-event explanation refuses an oversized source table before claiming completion',async()=>{
  // One supporting axiom has many distinct written occurrences. This stays
  // below the source-record ceiling but exceeds the unchanged JSON-node limit;
  // the worker must return an explicit failure, never a truncated success.
  const content=text([':A a owl:Class .',':a a owl:NamedIndividual .',...Array(800).fill(':a a :A .')]);
  const input=request(document(content),query('ClassAssertion(:A :a)')),result=await runner.run(input);
  assert.equal(result.status,'FAILED',JSON.stringify(result));assert.equal(result.complete,false);
  assert.equal(result.error.code,'OUTPUT_LIMIT');assert.equal(result.requestDigest,hash(input));
  assert.equal(result.closureDigest,closureDigest(input.closure));assert.equal(result.toolchainDigest,binding.digest);
  for(const name of ['sourceLocationVersion','sourceLocationDocuments','support'])assert.equal(Object.hasOwn(result.result,name),false);
});

const revision=(s,f)=>s.request(f.read('project.inspect'),f.token).revision;
const write=(s,f,operation,input,id,token=f.token)=>s.request(f.write(operation,input,id,revision(s,f)),token);
function paged(s,f,operation,input,maxBytes=4096){
  let content='',offset=0,first,pages=0;const before=revision(s,f);
  do{const p=s.request(f.read(operation,{...input,offset,maxBytes}),f.token);first??=p;pages++;assert.equal(p.offset,offset);assert.equal(p.documentDigest,first.documentDigest);assert.ok(Buffer.byteLength(p.content)<=maxBytes);content+=p.content;offset=p.nextOffset;if(offset!==null)assert.equal(p.complete,false);else assert.equal(p.complete,true);}while(offset!==null);
  assert.equal(revision(s,f),before);assert.equal(hashBytes(content),first.documentDigest);return {value:JSON.parse(content),first,pages,content};
}
async function explanationTask(s,f,p){
  const q=p.expectations.cases.find(c=>c.kind==='owl-entailment'&&c.expectedStatus==='ENTAILED').query;
  const receipt=write(s,f,'reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task:{kind:'explanation',target:'entailment',query:q},timeoutMs:30000},'synthetic-rdf-explanation'),taskId=receipt.result.taskId,end=Date.now()+45000;
  while(Date.now()<end){const value=s.request(f.read('reasoning.inspect',{taskId}),f.token);if(value.state==='FINISHED'){assert.equal(value.formalStatus,'COMPLETED',JSON.stringify(value));assert.equal(value.complete,true);return taskId;}assert.notEqual(value.state,'INTERRUPTED');await delay(25);}
  throw Error('Actual RDF explanation did not finish within its observation budget');
}

test('synthetic native Turtle admission retains exact source tables through review, private immutable delivery and offline integrity verification',async t=>{
  const f=fixture(t),grant=grantReviewer({root:f.root,workspaceId:f.setup.workspaceId,serviceId:f.setup.serviceId,projectId:'demo',principalId:'synthetic-rdf-reviewer',grantId:'rdf-reviewer-test',expiresAt:new Date(Date.now()+86400000).toISOString()});
  const reviewerToken=readFileSync(grant.credentialFile,'utf8');let s=createStandaloneService(configuration(f));t.after(()=>s.close());
  const p=prepare(s,f),validation=write(s,f,'validation.start',{assetId:'services',modelDigest:p.modelDigest},'synthetic-rdf-validation');assert.equal((await terminal(s,f,validation.result.taskId)).formalStatus,'MATCHED');
  const taskId=await explanationTask(s,f,p),read=paged(s,f,'explanation.read',{assetId:'services',modelDigest:p.modelDigest,taskId},512),report=read.value;
  assert.ok(read.pages>1);assert.equal(read.first.projectionDigest,hash(report));assert.equal(report.sourceLocationVersion,2);assert.equal(report.axiomSourceLocationCoverage,'COMPLETE');assert.equal(report.replayVerified,true);
  sourceTables(p.model.closure.documents,report);assert.equal(report.support.length,4,'The fixture has exactly the equivalence and three necessary assertion premises');
  assert.ok(report.sourceLocationDocuments[0].occurrences.some(o=>o.generatedKind==='COLLECTION_FIRST'));assert.ok(report.sourceLocationDocuments[0].occurrences.some(o=>o.generatedKind==='COLLECTION_REST'));
  assert.equal(report.sourceLinksComplete,true);assert.equal(report.businessMeaningProven,false);assert.equal(report.authority,false);
  for(const ax of report.support)for(const doc of ax.documents)for(const mapping of doc.mappings){assert.equal(mapping.axiomByteSpanEstablished,false);assert.equal(mapping.businessMeaningProven,false);}
  const reviewInput={assetId:'services',modelDigest:p.modelDigest,version:'rdf-source-test-01',previousDeliveryDigest:null,validationTaskId:validation.result.taskId,explanationTaskIds:[taskId]},reviewRequest=f.write('review.prepare',reviewInput,'synthetic-rdf-review',revision(s,f));
  const prepared=s.request(reviewRequest,f.token),candidate=prepared.result;assert.equal(candidate.status,'AWAITING_DECISION');assert.deepEqual(s.request(reviewRequest,f.token),prepared);
  const review=paged(s,f,'review.report.read',{assetId:'services',candidateDigest:candidate.candidateDigest});assert.ok(review.pages>1);assert.equal(hash(review.value),candidate.reportDigest);assert.deepEqual(review.value.explanations[0].report,report);assert.equal(review.value.formalResultsAreBusinessApproval,false);
  assert.equal(s.context(f.token).writeOperations.includes('review.decide'),false);assert.deepEqual(s.context(reviewerToken).writeOperations,['review.decide']);
  const decisionInput={assetId:'services',candidateDigest:candidate.candidateDigest,reportDigest:candidate.reportDigest,previousDecisionDigest:null,decision:'APPROVE',rationale:'Synthetic regression only: independently inspected the fixed fixture and exact retained report.',instruction:{reference:'urn:test:synthetic-rdf-source-review',content:'Synthetic test fixture only: approve this exact candidate for r1 and r2. This is not a real business instruction.'},requirementIds:['r1','r2']};
  assert.throws(()=>write(s,f,'review.decide',decisionInput,'author-cannot-review'),{code:'FORBIDDEN'});assert.throws(()=>write(s,f,'model.record',{draft:p.model},'reviewer-cannot-author',reviewerToken),{code:'FORBIDDEN'});
  const decisionRequest=f.write('review.decide',decisionInput,'synthetic-rdf-decision',revision(s,f)),decision=s.request(decisionRequest,reviewerToken);assert.equal(decision.result.principalId,'synthetic-rdf-reviewer');
  const deliveryRequest=f.write('delivery.record',{assetId:'services',candidateDigest:candidate.candidateDigest,reviewDigest:decision.result.reviewDigest},'synthetic-rdf-delivery',revision(s,f)),delivered=s.request(deliveryRequest,f.token),digest=delivered.result.deliveryDigest;
  const exported=paged(s,f,'delivery.export.read',{assetId:'services',deliveryDigest:digest}),bundle=exported.value;assert.equal(bundle.visibility,'private');assert.equal(bundle.identity.version,'rdf-source-test-01');
  const offline=join(f.base,'synthetic-rdf-delivery.json');writeFileSync(offline,exported.content,{mode:0o600});s.close();
  // Existing offline verification is pinned digest/content verification, not
  // a digital signature, Host instruction authentication or formal rerun.
  const readback=JSON.parse(readFileSync(offline,'utf8')),verified=verifyDeliveryBundle(readback,digest);
  assert.equal(verified.integrityVerified,true);assert.equal(verified.externalInstructionVerified,false);assert.equal(verified.formalExecutionReplayed,false);assert.equal(verified.softwareReleaseAuthority,false);
  const evidence=JSON.parse(readback.parts.find(part=>part.kind==='explanation').content);assert.deepEqual(evidence.result.result.sourceLocationDocuments,report.sourceLocationDocuments);sourceTables(p.model.closure.documents,evidence.result.result);
  const exportedModel=JSON.parse(readback.parts.find(part=>part.kind==='model').content);assert.deepEqual(exportedModel,p.model);
  assert.throws(()=>verifyDeliveryBundle(readback,hash('foreign owner digest')),{code:'DELIVERY_DIGEST'});
  const tampered=structuredClone(readback);tampered.parts.find(part=>part.kind==='explanation').content+=' ';assert.throws(()=>verifyDeliveryBundle(tampered,hash(tampered)),{code:'DELIVERY_PART'});
  s=createStandaloneService(f.setup);assert.deepEqual(s.request(decisionRequest,reviewerToken),decision);assert.deepEqual(s.request(deliveryRequest,f.token),delivered);
  assert.equal(paged(s,f,'delivery.export.read',{assetId:'services',deliveryDigest:digest}).content,exported.content,'Restart without executors leaves immutable delivery bytes unchanged');
});
