import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
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
import {fixture,sources,expected,model,configuration,terminal} from '../helpers/v090-validation.mjs';
import {sourceSet,draft} from '../helpers/v090-native.mjs';

// Actual Java/Python execution over independently specified, synthetic inputs.
// The reviewer below is a test principal; neither its decision nor this suite
// establishes an actual Host journey, human business approval or fixed acceptance.
const NS='urn:xml-location:',RDF='http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS='http://www.w3.org/2000/01/rdf-schema#',OWL='http://www.w3.org/2002/07/owl#',XSD='http://www.w3.org/2001/XMLSchema#';
let base,binding,runner,sequence=0;
before(()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN&&process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,'Actual current XML DL and SHACL bindings required; no mocks or skips');
  binding=readDLToolchain(process.env.EVOPILOT_TEST_DL_TOOLCHAIN);verifyDLToolchain(binding);
  assert.equal(binding.workerSourceDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/Worker.java',import.meta.url))));
  assert.equal(binding.dependencyLockDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/dependencies.json',import.meta.url))));
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-xml-lifecycle-')));
  const workRoot=join(base,'worker');mkdirSync(workRoot,{mode:0o700});
  runner=createDLRunner({toolchainFile:process.env.EVOPILOT_TEST_DL_TOOLCHAIN,workRoot});
});
after(()=>{if(base)rmSync(base,{recursive:true,force:true});});
const xml=(body,{dtd='',namespace=NS,attributes=''}={})=>'<?xml version="1.0"?>\r\n'+dtd+'\n<rdf:RDF xmlns:rdf="'+RDF+'" xmlns:rdfs="'+RDFS+'" xmlns:owl="'+OWL+'" xmlns:ex="'+namespace+'" '+attributes+'>\r\n'+body+'\n</rdf:RDF>';
const doc=(content,extra={})=>({id:'model',documentIri:'https://xml-location.example/document.rdf',ontologyIri:null,versionIri:null,format:'rdfxml',content,digest:hashBytes(content),...extra});
const query=body=>{const content='Prefix(:=<'+NS+'>) Ontology('+body+')';return {format:'functional',content,digest:hashBytes(content)};};
const request=(documents,target,imports=[])=>({schema:'ontology-dl-request/v1',requestId:'xml-locations-'+(++sequence),closure:{rootDocumentId:documents[0].id,documents,imports},task:{kind:'explanation',target:'entailment',query:target}});
const sorted=values=>[...new Set(values)].sort((a,b)=>a-b);
function ascending(values){assert.deepEqual(values,sorted(values));for(const id of values)assert.ok(Number.isSafeInteger(id)&&id>0);}
function rawFragment(content,source){
  const raw=Buffer.from(content),piece=raw.subarray(source.start,source.end);
  assert.ok(source.start>=0&&source.end>source.start&&source.end<=raw.length);
  assert.equal(hashBytes(piece),source.fragmentDigest);
  const decode=bytes=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  const text=decode(piece);decode(raw.subarray(0,source.start));decode(raw.subarray(0,source.end));
  const lineAt=offset=>{let line=1;for(let i=0;i<offset;i++)if(raw[i]===10||raw[i]===13&&raw[i+1]!==10)line++;return line;};
  assert.equal(source.startLine,lineAt(source.start));assert.equal(source.endLine,lineAt(source.end-1));return text;
}
function tables(documents,data){
  assert.equal(data.sourceLocationVersion,3);assert.ok(Array.isArray(data.sourceLocationDocuments));
  const all=new Map(data.sourceLocationDocuments.map(t=>[t.documentId,t]));assert.equal(all.size,data.sourceLocationDocuments.length);
  assert.deepEqual([...all.keys()],[...all.keys()].sort());
  const origins=data.support.flatMap(a=>a.sources??a.documents);
  for(const table of all.values()){
    const document=documents.find(d=>d.id===table.documentId);assert.ok(document);assert.equal(table.documentDigest,document.digest);assert.equal(table.format,document.format);
    const isXML=table.format==='rdfxml';assert.ok(isXML||table.format==='turtle');
    assert.equal(table.schema,isXML?'ontology-rdfxml-source-document/v1':'ontology-rdf-source-document/v1');
    assert.equal(table.parserId,isXML?'owlapi-rdfxml-occurrences:1':'owlapi-turtle-occurrences:1');
    for(const key of ['sources','contexts','occurrences',...(isXML?['sourceSets']:[])])ascending(table[key].map(v=>v.id));
    const ss=new Map(table.sources.map(s=>[s.id,s])),sets=new Map((table.sourceSets??[]).map(s=>[s.id,s.sourceIds])),cc=new Map(table.contexts.map(c=>[c.id,c])),oo=new Map(table.occurrences.map(o=>[o.id,o]));
    for(const s of ss.values())rawFragment(document.content,s);
    const memberships=new Set();for(const ids of sets.values()){ascending(ids);assert.ok(ids.length);assert.ok(!memberships.has(JSON.stringify(ids)));memberships.add(JSON.stringify(ids));for(const id of ids)assert.ok(ss.has(id));}
    const neededO=new Set(),neededS=new Set(),neededSets=new Set(),neededC=new Set();
    const useSource=id=>{assert.ok(ss.has(id));neededS.add(id);};
    const useSet=id=>{assert.ok(sets.has(id));neededSets.add(id);sets.get(id).forEach(useSource);};
    const visitContext=id=>{
      if(neededC.has(id))return;neededC.add(id);const c=cc.get(id);assert.ok(c);ascending(c.dependencyContextIds);
      const source=isXML?c.sourceSetId:c.sourceId;
      if(source) (isXML?useSet:useSource)(source);
      else{assert.ok(['DOCUMENT','BUILTIN'].includes(c.kind));assert.deepEqual(c.dependencyContextIds,[]);if(c.kind==='DOCUMENT')assert.equal(c.resolved,document.documentIri);if(isXML&&c.kind==='BUILTIN'){assert.equal(c.name,'xml');assert.equal(c.resolved,'http://www.w3.org/XML/1998/namespace');}}
      for(const dependency of c.dependencyContextIds){assert.ok(dependency<c.id);visitContext(dependency);}
    };
    for(const origin of origins.filter(o=>o.documentId===document.id)){
      const group=origin.sourceLocation??origin.axiomSourceLocation;assert.equal(group.schema,'ontology-axiom-source-location/v2');assert.equal(group.kind,'RDF_CONSTRUCTION');assert.ok(group.constructionOccurrenceIds.length);
      for(const name of ['constructionOccurrenceIds','parserContextOccurrenceIds']){ascending(group[name]);for(const id of group[name])neededO.add(id);}
    }
    for(const id of neededO){const o=oo.get(id);assert.ok(o);for(const term of [o.subject,o.predicate,o.object]){(isXML?useSet:useSource)(isXML?term.sourceSetId:term.sourceId);ascending(term.contextIds);term.contextIds.forEach(visitContext);}}
    assert.deepEqual(table.occurrences.map(o=>o.id),sorted(neededO),'No unrelated RDF event in the retained table');
    assert.deepEqual(table.sources.map(s=>s.id),sorted(neededS),'Exactly reachable original byte ranges');
    assert.deepEqual(table.contexts.map(c=>c.id),sorted(neededC),'Exactly reachable parser context DAG');
    if(isXML)assert.deepEqual(table.sourceSets.map(s=>s.id),sorted(neededSets),'Exactly reachable interned source sets');
  }
  assert.deepEqual([...all.keys()].sort(),[...new Set(origins.map(o=>o.documentId))].sort());return all;
}
function termEvidence(document,table,term){
  const ss=new Map(table.sources.map(s=>[s.id,s])),sets=new Map(table.sourceSets.map(s=>[s.id,s.sourceIds])),contexts=new Map(table.contexts.map(c=>[c.id,c]));
  const sourceIds=new Set(sets.get(term.sourceSetId)),contextIds=new Set();
  const visit=id=>{if(contextIds.has(id))return;contextIds.add(id);const c=contexts.get(id);assert.ok(c);if(c.sourceSetId)for(const source of sets.get(c.sourceSetId))sourceIds.add(source);c.dependencyContextIds.forEach(visit);};term.contextIds.forEach(visit);
  return {fragments:[...sourceIds].map(id=>rawFragment(document.content,ss.get(id))),contexts:[...contextIds].map(id=>contexts.get(id))};
}
function axiom(data,rendering){const found=data.support.find(a=>a.axiom===rendering);assert.ok(found,'Independent expected axiom '+rendering);assert.equal(found.axiomDigest,hashBytes(rendering));return found;}
function projected(input,result){
  const value=draft(hash('synthetic XML intent'),hash(sourceSet));value.closure=structuredClone(input.closure);
  value.mappings[0].anchors=input.closure.documents.map(d=>({documentId:d.id,documentDigest:d.digest,start:0,end:Buffer.byteLength(d.content),fragmentDigest:d.digest}));
  return explainEvidence({taskId:input.requestId,kind:'dl',request:input,result},{digest:hash(value),draft:value,closureDigest:closureDigest(value.closure)},{sourceSet,fragments:sourceSet.fragments});
}
async function explain(input){
  const result=await runner.run(input);assert.equal(result.status,'COMPLETED',JSON.stringify(result));assert.equal(result.complete,true);
  assert.equal(result.requestDigest,hash(input));assert.equal(result.closureDigest,closureDigest(input.closure));assert.equal(result.toolchainDigest,binding.digest);
  const data=result.result;assert.equal(data.method,'DELETION_REPLAY');assert.equal(data.replayVerified,true);assert.equal(data.allMinimalJustifications,false);assert.equal(data.replay.digest,hashBytes(data.replay.content));
  tables(input.closure.documents,data);const projection=projected(input,result);assert.equal(projection.axiomSourceLocationCoverage,'COMPLETE');assert.equal(projection.sourceLocationVersion,3);assert.deepEqual(projection.sourceLocationDocuments,data.sourceLocationDocuments);assert.equal(projection.businessMeaningProven,false);
  return {result,data,projection};
}

test('real XML explanation binds two independent OWL premises to original Unicode attribute ranges and closed source sets',async()=>{
  const content=xml('<!-- 雪😀 decoy rdf:resource="'+NS+'B" -->\r\n<owl:Class rdf:about="'+NS+'A雪😀"><rdfs:subClassOf rdf:resource="'+NS+'B"/></owl:Class>\r<owl:Class rdf:about="'+NS+'B"/>\n<owl:NamedIndividual rdf:about="'+NS+'a"><rdf:type rdf:resource="'+NS+'A雪😀"/></owl:NamedIndividual>');
  const document=doc(content),input=request([document],query('ClassAssertion(:B :a)')),{data}=await explain(input);assert.equal(data.support.length,2);
  const subclass=axiom(data,'SubClassOf(<'+NS+'A雪😀> <'+NS+'B>)'),assertion=axiom(data,'ClassAssertion(<'+NS+'A雪😀> <'+NS+'a>)'),table=data.sourceLocationDocuments[0];
  const expected=[{axiom:subclass,subject:NS+'A雪😀',predicate:RDFS+'subClassOf',object:NS+'B',fragment:'rdf:resource="'+NS+'B"'},{axiom:assertion,subject:NS+'a',predicate:RDF+'type',object:NS+'A雪😀',fragment:'rdf:resource="'+NS+'A雪😀"'}];
  for(const oracle of expected){
    const occurrence=table.occurrences.find(o=>o.triple.subject===oracle.subject&&o.triple.predicate===oracle.predicate&&o.triple.object.kind==='RESOURCE'&&o.triple.object.value===oracle.object);assert.ok(occurrence);
    assert.ok(oracle.axiom.sources[0].sourceLocation.constructionOccurrenceIds.includes(occurrence.id));
    assert.ok(termEvidence(document,table,occurrence.object).fragments.includes(oracle.fragment));
  }
  assert.ok(table.sources.every(s=>!rawFragment(content,s).includes('decoy')),'Comment text is never attributed as an OWL premise');
});

test('XML entity, CDATA and DTD-default provenance retain separate original causes of fixed data and object property assertions',async()=>{
  const dtd='<!DOCTYPE rdf:RDF [<!ENTITY label "财务"><!ENTITY target "'+NS+'target"><!ATTLIST ex:link rdf:resource CDATA "&target;">]>';
  const content=xml('<owl:DatatypeProperty rdf:about="'+NS+'p"/><owl:ObjectProperty rdf:about="'+NS+'link"/>\n<owl:NamedIndividual rdf:about="'+NS+'target"/>\n<owl:NamedIndividual rdf:about="'+NS+'a"><ex:p rdf:datatype="'+XSD+'string">A&label;<![CDATA[😀<&]]></ex:p><ex:link/></owl:NamedIndividual>',{dtd});
  const target=query('DataPropertyAssertion(:p :a "A财务😀<&"^^<'+XSD+'string>) ObjectPropertyAssertion(:link :a :target)'),document=doc(content),{data}=await explain(request([document],target));
  assert.equal(data.support.length,2);axiom(data,'DataPropertyAssertion(<'+NS+'p> <'+NS+'a> "A财务😀<&"^^xsd:string)');axiom(data,'ObjectPropertyAssertion(<'+NS+'link> <'+NS+'a> <'+NS+'target>)');
  const table=data.sourceLocationDocuments[0],literal=table.occurrences.find(o=>o.triple.predicate===NS+'p'),link=table.occurrences.find(o=>o.triple.predicate===NS+'link');assert.ok(literal&&link);
  assert.deepEqual(literal.triple,{subject:NS+'a',predicate:NS+'p',object:{kind:'LITERAL',lexical:'A财务😀<&',language:null,datatype:XSD+'string'}});
  assert.deepEqual(link.triple,{subject:NS+'a',predicate:NS+'link',object:{kind:'RESOURCE',value:NS+'target'}});
  const lit=termEvidence(document,table,literal.object),ref=termEvidence(document,table,link.object);
  for(const raw of ['&label;','<!ENTITY label "财务">','<![CDATA[😀<&]]>'])assert.ok(lit.fragments.some(s=>s.includes(raw)),raw);
  for(const kind of ['ENTITY_REFERENCE','ENTITY_DECLARATION'])assert.ok(lit.contexts.some(c=>c.kind===kind),kind);
  for(const kind of ['DTD_ATTRIBUTE_DEFAULT','DTD_ATTRIBUTE_DECLARATION','ENTITY_REFERENCE','ENTITY_DECLARATION'])assert.ok(ref.contexts.some(c=>c.kind===kind),kind);
  // A declaration fragment ends at this attribute's default; the closing
  // ATTLIST delimiter may follow additional, unrelated attribute definitions.
  assert.ok(ref.fragments.includes('<!ATTLIST ex:link rdf:resource CDATA "&target;"'));assert.ok(ref.fragments.some(s=>s.includes('<!ENTITY target "'+NS+'target">')));
});

test('Turtle import plus XML body retains each independently necessary premise in its own original document table',async()=>{
  const root=doc('@prefix owl: <'+OWL+'> . <urn:xml-location:root> a owl:Ontology; owl:imports <urn:xml-location:child> . <'+NS+'A> a owl:Class . <'+NS+'B> a owl:Class . <'+NS+'a> a owl:NamedIndividual, <'+NS+'A> .',{id:'root',documentIri:'https://xml-location.example/root.ttl',ontologyIri:'urn:xml-location:root',format:'turtle'});
  const child=doc(xml('<owl:Ontology rdf:about="urn:xml-location:child"/><owl:Class rdf:about="'+NS+'A"><rdfs:subClassOf rdf:resource="'+NS+'B"/></owl:Class><owl:Class rdf:about="'+NS+'B"/>'),{id:'child',documentIri:'https://xml-location.example/child.rdf',ontologyIri:'urn:xml-location:child'});
  const {data,projection}=await explain(request([root,child],query('ClassAssertion(:B :a)'),[{from:'root',iri:'urn:xml-location:child',to:'child'}]));assert.equal(data.support.length,2);
  assert.deepEqual(axiom(data,'SubClassOf(<'+NS+'A> <'+NS+'B>)').sources.map(s=>s.documentId),['child']);assert.deepEqual(axiom(data,'ClassAssertion(<'+NS+'A> <'+NS+'a>)').sources.map(s=>s.documentId),['root']);
  assert.deepEqual(data.sourceLocationDocuments.map(t=>[t.documentId,t.format]),[['child','rdfxml'],['root','turtle']]);assert.equal(projection.axiomSourceLocationCoverage,'COMPLETE');
  for(const table of data.sourceLocationDocuments)assert.ok(table.occurrences.every(o=>o.triple.predicate!==OWL+'imports'),'Import edges are not substituted for the actual axiom body');
});

test('malformed XML and external entity requests never return successful partial explanation locations',async()=>{
  const inputs=[xml('<owl:Class rdf:about="'+NS+'A">'),xml('<owl:NamedIndividual rdf:about="'+NS+'a"><ex:p>&external;</ex:p></owl:NamedIndividual>',{dtd:'<!DOCTYPE rdf:RDF [<!ENTITY external SYSTEM "file:///must-not-open">]>'})];
  for(const content of inputs){const input=request([doc(content)],query('ClassAssertion(:A :a)')),result=await runner.run(input);assert.equal(result.status,'INVALID_INPUT',JSON.stringify(result));assert.equal(result.complete,false);assert.equal(result.requestDigest,hash(input));for(const key of ['sourceLocationVersion','sourceLocationDocuments','support'])assert.equal(Object.hasOwn(result.result,key),false);}
});

const businessXML=xml(`<owl:Ontology rdf:about="urn:model"/>
<owl:Class rdf:about="urn:demo:Service"/><owl:Class rdf:about="urn:demo:SensitiveDataset"/>
<owl:ObjectProperty rdf:about="urn:demo:accesses"/><owl:DatatypeProperty rdf:about="urn:demo:owner"/>
<owl:Class rdf:about="urn:demo:SensitiveService"><owl:equivalentClass><owl:Class><owl:intersectionOf rdf:parseType="Collection"><rdf:Description rdf:about="urn:demo:Service"/><owl:Restriction><owl:onProperty rdf:resource="urn:demo:accesses"/><owl:someValuesFrom rdf:resource="urn:demo:SensitiveDataset"/></owl:Restriction></owl:intersectionOf></owl:Class></owl:equivalentClass></owl:Class>
<owl:NamedIndividual rdf:about="urn:demo:svc"><rdf:type rdf:resource="urn:demo:Service"/><ex:accesses rdf:resource="urn:demo:data"/><ex:owner>operations</ex:owner></owl:NamedIndividual>
<owl:NamedIndividual rdf:about="urn:demo:data"><rdf:type rdf:resource="urn:demo:SensitiveDataset"/></owl:NamedIndividual>
<owl:NamedIndividual rdf:about="urn:demo:publicService"><rdf:type rdf:resource="urn:demo:Service"/><ex:owner>public operations</ex:owner></owl:NamedIndividual>`,{namespace:'urn:demo:'});
const revision=(s,f)=>s.request(f.read('project.inspect'),f.token).revision;
const write=(s,f,operation,input,id,token=f.token)=>s.request(f.write(operation,input,id,revision(s,f)),token);
function paged(s,f,operation,input,maxBytes=512){
  let content='',offset=0,first,pages=0;const originalRevision=revision(s,f);
  do{const p=s.request(f.read(operation,{...input,offset,maxBytes}),f.token);first??=p;pages++;assert.equal(p.offset,offset);assert.equal(p.documentDigest,first.documentDigest);assert.ok(Buffer.byteLength(p.content)<=maxBytes);content+=p.content;offset=p.nextOffset;assert.equal(p.complete,offset===null);}while(offset!==null);
  assert.equal(revision(s,f),originalRevision);assert.equal(hashBytes(content),first.documentDigest);return {value:JSON.parse(content),first,pages,content};
}
async function explanationTask(s,f,p){
  const q=p.expectations.cases.find(c=>c.kind==='owl-entailment'&&c.expectedStatus==='ENTAILED').query;
  const receipt=write(s,f,'reasoning.start',{assetId:'services',modelDigest:p.modelDigest,task:{kind:'explanation',target:'entailment',query:q},timeoutMs:30000},'synthetic-xml-explanation'),taskId=receipt.result.taskId,end=Date.now()+45000;
  while(Date.now()<end){const v=s.request(f.read('reasoning.inspect',{taskId}),f.token);if(v.state==='FINISHED'){assert.equal(v.formalStatus,'COMPLETED',JSON.stringify(v));assert.equal(v.complete,true);return taskId;}assert.notEqual(v.state,'INTERRUPTED');await delay(25);}throw Error('Actual XML explanation did not finish');
}
test('synthetic XML native lifecycle preserves fixed OWL and SHACL checks, paged review and private delivery through offline readback and restart',async t=>{
  const f=fixture(t),grant=grantReviewer({root:f.root,workspaceId:f.setup.workspaceId,serviceId:f.setup.serviceId,projectId:'demo',principalId:'synthetic-xml-reviewer',grantId:'xml-reviewer-test',expiresAt:new Date(Date.now()+86400000).toISOString()});
  const reviewerToken=readFileSync(grant.credentialFile,'utf8');let s=createStandaloneService(configuration(f));t.after(()=>s.close());
  const p=sources(s,f);p.expectations=expected(p.intentDigest,p.sourceSetDigest);p.expectationsDigest=write(s,f,'expectations.record',{definition:p.expectations},'xml-expectations').result.expectationsDigest;
  p.model=model(p.intentDigest,p.sourceSetDigest,p.expectationsDigest);
  const document=doc(businessXML,{documentIri:'urn:model:document',ontologyIri:'urn:model'});p.model.closure.documents=[document];
  p.model.mappings[0].anchors=[{documentId:document.id,documentDigest:document.digest,start:0,end:Buffer.byteLength(businessXML),fragmentDigest:document.digest}];
  p.modelDigest=write(s,f,'model.record',{draft:p.model},'xml-model').result.modelDigest;
  const validation=write(s,f,'validation.start',{assetId:'services',modelDigest:p.modelDigest},'xml-validation');assert.equal((await terminal(s,f,validation.result.taskId)).formalStatus,'MATCHED');
  const taskId=await explanationTask(s,f,p),read=paged(s,f,'explanation.read',{assetId:'services',modelDigest:p.modelDigest,taskId}),report=read.value;
  assert.ok(read.pages>1);assert.equal(hash(report),read.first.projectionDigest);assert.equal(report.sourceLocationVersion,3);assert.equal(report.axiomSourceLocationCoverage,'COMPLETE');assert.equal(report.replayVerified,true);assert.equal(report.support.length,4);
  for(const rendering of ['ClassAssertion(<urn:demo:Service> <urn:demo:svc>)','ClassAssertion(<urn:demo:SensitiveDataset> <urn:demo:data>)','ObjectPropertyAssertion(<urn:demo:accesses> <urn:demo:svc> <urn:demo:data>)'])axiom(report,rendering);
  const equivalence=report.support.find(a=>a.axiom.startsWith('EquivalentClasses('));assert.ok(equivalence);for(const text of ['<urn:demo:SensitiveService>','ObjectIntersectionOf(','<urn:demo:Service>','ObjectSomeValuesFrom(<urn:demo:accesses> <urn:demo:SensitiveDataset>)'])assert.ok(equivalence.axiom.includes(text));
  tables(p.model.closure.documents,report);assert.equal(report.sourceLinksComplete,true);assert.equal(report.businessMeaningProven,false);assert.equal(report.authority,false);
  assert.ok(report.sourceLocationDocuments[0].occurrences.some(o=>o.generatedKind==='COLLECTION_FIRST'));assert.ok(report.sourceLocationDocuments[0].occurrences.some(o=>o.generatedKind==='COLLECTION_REST'));
  const reviewRequest=f.write('review.prepare',{assetId:'services',modelDigest:p.modelDigest,version:'xml-source-test-01',previousDeliveryDigest:null,validationTaskId:validation.result.taskId,explanationTaskIds:[taskId]},'xml-review',revision(s,f));
  const prepared=s.request(reviewRequest,f.token),candidate=prepared.result;assert.equal(candidate.status,'AWAITING_DECISION');assert.deepEqual(s.request(reviewRequest,f.token),prepared);
  const review=paged(s,f,'review.report.read',{assetId:'services',candidateDigest:candidate.candidateDigest},4096);assert.ok(review.pages>1);assert.equal(hash(review.value),candidate.reportDigest);assert.deepEqual(review.value.explanations[0].report,report);assert.equal(review.value.formalResultsAreBusinessApproval,false);
  const decisionInput={assetId:'services',candidateDigest:candidate.candidateDigest,reportDigest:candidate.reportDigest,previousDecisionDigest:null,decision:'APPROVE',rationale:'Synthetic XML regression principal only; not an actual human or Host decision.',instruction:{reference:'urn:test:synthetic-xml-review',content:'Synthetic fixture only: approve this exact retained candidate for r1 and r2; no actual business instruction or release authorization.'},requirementIds:['r1','r2']};
  assert.equal(s.context(f.token).writeOperations.includes('review.decide'),false);assert.deepEqual(s.context(reviewerToken).writeOperations,['review.decide']);assert.throws(()=>write(s,f,'review.decide',decisionInput,'xml-author-refused'),{code:'FORBIDDEN'});
  const decisionRequest=f.write('review.decide',decisionInput,'xml-test-decision',revision(s,f)),decision=s.request(decisionRequest,reviewerToken);assert.equal(decision.result.principalId,'synthetic-xml-reviewer');
  const deliveryRequest=f.write('delivery.record',{assetId:'services',candidateDigest:candidate.candidateDigest,reviewDigest:decision.result.reviewDigest},'xml-delivery',revision(s,f)),delivered=s.request(deliveryRequest,f.token),digest=delivered.result.deliveryDigest;
  const exported=paged(s,f,'delivery.export.read',{assetId:'services',deliveryDigest:digest},4096);assert.equal(exported.value.visibility,'private');assert.equal(exported.value.identity.version,'xml-source-test-01');
  const offline=join(f.base,'synthetic-xml-delivery.json');writeFileSync(offline,exported.content,{mode:0o600});s.close();
  const bundle=JSON.parse(readFileSync(offline,'utf8')),verified=verifyDeliveryBundle(bundle,digest);assert.equal(verified.integrityVerified,true);assert.equal(verified.externalInstructionVerified,false);assert.equal(verified.formalExecutionReplayed,false);assert.equal(verified.softwareReleaseAuthority,false);
  const evidence=JSON.parse(bundle.parts.find(part=>part.kind==='explanation').content);assert.deepEqual(evidence.result.result.sourceLocationDocuments,report.sourceLocationDocuments);tables(p.model.closure.documents,evidence.result.result);
  assert.deepEqual(JSON.parse(bundle.parts.find(part=>part.kind==='model').content),p.model);
  const tampered=structuredClone(bundle);tampered.parts.find(part=>part.kind==='explanation').content+=' ';assert.throws(()=>verifyDeliveryBundle(tampered,hash(tampered)),{code:'DELIVERY_PART'});
  s=createStandaloneService(f.setup);assert.deepEqual(s.request(decisionRequest,reviewerToken),decision);assert.deepEqual(s.request(deliveryRequest,f.token),delivered);assert.equal(paged(s,f,'delivery.export.read',{assetId:'services',deliveryDigest:digest},4096).content,exported.content);
});
