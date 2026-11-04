import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,cpSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDLRunner} from '../../dist/reasoning/runner.js';
import {readDLToolchain} from '../../dist/reasoning/toolchain.js';
import {closureDigest} from '../../dist/reasoning/request.js';
import {hash,hashBytes} from '../../dist/standalone/validation.js';
import {explainEvidence} from '../../dist/native-v2/explanations.js';
import {sha,query,document,declaration,ns} from '../fixtures/v090/reasoning.mjs';
import {sourceSet,draft} from '../helpers/v090-native.mjs';

// Development evidence from the actual worker; these tests never approve a
// business model, deliver an asset, or mark the fixed acceptance matrix PASS.
let base,binding,runner,sequence=0;
before(()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN,'An actual current DL toolchain is required; no mock/skip path');
  const selected=readDLToolchain(process.env.EVOPILOT_TEST_DL_TOOLCHAIN);
  assert.equal(selected.workerSourceDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/Worker.java',import.meta.url))));
  assert.equal(selected.dependencyLockDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/dependencies.json',import.meta.url))));
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-locations-')));
  const root=join(base,'runtime');cpSync(selected.root,root,{recursive:true});chmodSync(root,0o700);
  const {digest:_,...identity}={...selected,root};binding={...identity,digest:hash(identity)};
  const toolchainFile=join(root,'toolchain.json');writeFileSync(toolchainFile,JSON.stringify(binding),{mode:0o600});
  const workRoot=join(base,'worker');mkdirSync(workRoot,{mode:0o700});runner=createDLRunner({toolchainFile,workRoot});
});
after(()=>{if(base)rmSync(base,{recursive:true,force:true});});
const declarations=declaration({classes:['A','B'],individuals:['a']});
const conclusion=query('ClassAssertion(:B :a)');
const prefix='Prefix(:=<'+ns+'>)';
function request(documents,imports=[],task={kind:'explanation',target:'entailment',query:conclusion}){
  return {schema:'ontology-dl-request/v1',requestId:'locations-'+(++sequence),closure:{rootDocumentId:documents[0].id,documents,imports},task};
}
async function run(input,status='COMPLETED'){
  const result=await runner.run(input);assert.equal(result.status,status,JSON.stringify(result));
  assert.equal(result.requestDigest,hash(input));assert.equal(result.closureDigest,closureDigest(input.closure));assert.equal(result.toolchainDigest,binding.digest);return result;
}
function project(input,result){
  const value=draft(hash('intent'),hash(sourceSet));value.closure=structuredClone(input.closure);
  value.mappings[0].anchors=input.closure.documents.map(d=>({documentId:d.id,documentDigest:d.digest,start:0,end:Buffer.byteLength(d.content),fragmentDigest:d.digest}));
  const model={digest:hash(value),draft:value,closureDigest:closureDigest(input.closure)};
  return explainEvidence({taskId:input.requestId,kind:'dl',request:input,result},model,{sourceSet,fragments:sourceSet.fragments});
}
function exactSlice(content,fragment){
  const bytes=Buffer.from(content),slice=bytes.subarray(fragment.start,fragment.end);
  assert.equal(sha(slice),fragment.fragmentDigest);assert.equal(slice.toString('utf8').includes('\uFFFD'),false);
  const startChars=bytes.subarray(0,fragment.start).toString('utf8'),endChars=bytes.subarray(0,fragment.end).toString('utf8');
  assert.equal(fragment.startLine,startChars.split(/\r\n|\r|\n/).length);
  assert.equal(fragment.endLine,endChars.slice(0,-1).split(/\r\n|\r|\n/).length);
  return slice.toString('utf8');
}
function verifyLocations(input,result){
  assert.equal(result.result.sourceLocationVersion,3);assert.ok(Array.isArray(result.result.sourceLocationDocuments));
  const tables=new Map(result.result.sourceLocationDocuments.map(t=>[t.documentId,t]));assert.equal(tables.size,result.result.sourceLocationDocuments.length);
  for(const table of tables.values()){
    const doc=input.closure.documents.find(d=>d.id===table.documentId);assert.ok(doc);assert.equal(table.format,doc.format);assert.equal(table.documentDigest,doc.digest);
    assert.ok(['turtle','rdfxml'].includes(doc.format));
    assert.equal(table.schema,doc.format==='turtle'?'ontology-rdf-source-document/v1':'ontology-rdfxml-source-document/v1');assert.equal(table.parserId,doc.format==='turtle'?'owlapi-turtle-occurrences:1':'owlapi-rdfxml-occurrences:1');
    for(const source of table.sources)exactSlice(doc.content,source);
    const sources=new Set(table.sources.map(s=>s.id)),contexts=new Set(table.contexts.map(c=>c.id));
    const xml=doc.format==='rdfxml',sets=new Set((table.sourceSets??[]).map(s=>s.id)),available=xml?sets:sources,field=xml?'sourceSetId':'sourceId';
    if(xml)for(const set of table.sourceSets){assert.ok(set.sourceIds.length);for(const id of set.sourceIds)assert.ok(sources.has(id));}
    for(const c of table.contexts){if(c[field]===0)assert.ok(['DOCUMENT','BUILTIN'].includes(c.kind));else assert.ok(available.has(c[field]));for(const id of c.dependencyContextIds)assert.ok(contexts.has(id)&&id<c.id);}
    for(const o of table.occurrences)for(const term of [o.subject,o.predicate,o.object]){assert.ok(available.has(term[field]));for(const id of term.contextIds)assert.ok(contexts.has(id));}
  }
  for(const item of result.result.support)for(const origin of item.sources){
    const doc=input.closure.documents.find(d=>d.id===origin.documentId);assert.equal(origin.documentDigest,doc.digest);
    if(doc.format==='turtle'||doc.format==='rdfxml'){
      const location=origin.sourceLocation,table=tables.get(doc.id);assert.ok(table);assert.equal(location.schema,'ontology-axiom-source-location/v2');assert.equal(location.kind,'RDF_CONSTRUCTION');
      assert.ok(location.constructionOccurrenceIds.length);const available=new Set(table.occurrences.map(o=>o.id));
      for(const ids of [location.constructionOccurrenceIds,location.parserContextOccurrenceIds]){assert.deepEqual(ids,[...new Set(ids)].sort((a,b)=>a-b));for(const id of ids)assert.ok(available.has(id));}
      continue;
    }
    const location=origin.sourceLocation;assert.equal(location.schema,'ontology-axiom-source-location/v1');assert.ok(location.occurrences.length);
    for(const o of location.occurrences){assert.equal(o.fragments.length,1);exactSlice(doc.content,o.fragments[0]);}
    for(const p of location.context){assert.equal(p.kind,'PREFIX');assert.ok(exactSlice(doc.content,p).startsWith('Prefix('));}
  }
}

test('actual parser locations preserve Unicode, escapes, comments, mixed newlines and duplicate occurrences',async()=>{
  const subclass='SubClassOf(Annotation(rdfs:comment "雪😀 \\" ) # ( \\\\")\r\n :A :B)';
  const first='ClassAssertion(:A :a)',second='ClassAssertion( :A  :a )';
  const content='# 雪😀 '+first+'\r\n'+prefix+'\rPrefix(rdfs:=<http://www.w3.org/2000/01/rdf-schema#>)\nOntology(\r\n'+declarations+'\r'+subclass+'\n'+first+'\r\n'+second+'\n)';
  const input=request([document(content)]),result=await run(input);verifyLocations(input,result);
  const locations=result.result.support.flatMap(a=>a.sources.flatMap(s=>s.sourceLocation.occurrences.map(o=>exactSlice(content,o.fragments[0]))));
  assert.deepEqual(locations.sort(),[subclass,first,second].sort(),'The comment decoy and surrounding document are not axiom occurrences');
  const duplicate=result.result.support.find(a=>a.axiom.startsWith('ClassAssertion('));assert.equal(duplicate.sources.length,1);assert.equal(duplicate.sources[0].sourceLocation.occurrences.length,2);
  const projection=project(input,result);assert.equal(projection.axiomSourceLocationCoverage,'COMPLETE');assert.equal(projection.sourceLinkPrecision,'DOCUMENT_MAPPING_NOT_AXIOM_BYTE_LOCATION');
  assert.equal(projection.support[0].documents[0].mappings[0].axiomByteSpanEstablished,false,'Author business mapping remains distinct from parser location');
  const replay=request([document(result.result.replay.content)],[],{kind:'entailment',query:conclusion});assert.equal((await run(replay,'ENTAILED')).result.jointEntailed,true);
});

test('imported and repeated axioms retain each original document body, never the import edge',async()=>{
  const ax='SubClassOf(:A :B)',rootContent=prefix+' Ontology(<urn:located:root> Import(<urn:located:child>) '+declarations+' '+ax+' ClassAssertion(:A :a))';
  const childContent='# 来源😀\n'+prefix+'\nOntology(<urn:located:child> '+declarations+'\n'+ax+'\n)';
  const input=request([document(rootContent,{ontologyIri:'urn:located:root'}),document(childContent,{id:'child',documentIri:'urn:located:child:document',ontologyIri:'urn:located:child'})],[{from:'root',iri:'urn:located:child',to:'child'}]);
  const result=await run(input);verifyLocations(input,result);
  const support=result.result.support.find(a=>a.axiom.startsWith('SubClassOf('));assert.equal(support.sources.length,2);
  for(const source of support.sources){const content=input.closure.documents.find(d=>d.id===source.documentId).content;assert.equal(exactSlice(content,source.sourceLocation.occurrences[0].fragments[0]),ax);}
  assert.equal(project(input,result).axiomSourceLocationCoverage,'COMPLETE');
});

test('shared anonymous individuals retain structural linkage in parser locations and replay',async()=>{
  const content=prefix+' Ontology(Declaration(Class(:B)) Declaration(ObjectProperty(:p)) Declaration(NamedIndividual(:a)) ObjectPropertyAssertion(:p :a _:shared) ClassAssertion(:B _:shared))';
  const target=query('ObjectPropertyAssertion(:p :a _:witness) ClassAssertion(:B _:witness)');
  const input=request([document(content)],[],{kind:'explanation',target:'entailment',query:target}),result=await run(input);verifyLocations(input,result);
  assert.equal(result.result.support.length,2);
  const fragments=result.result.support.flatMap(a=>a.sources[0].sourceLocation.occurrences.map(o=>exactSlice(content,o.fragments[0])));
  assert.deepEqual(fragments.sort(),['ObjectPropertyAssertion(:p :a _:shared)','ClassAssertion(:B _:shared)'].sort());
  const replay=request([document(result.result.replay.content)],[],{kind:'entailment',query:target});await run(replay,'ENTAILED');
});

test('the same anonymous label in different import documents does not establish a shared witness',async()=>{
  const root=prefix+' Ontology(<urn:located:root> Import(<urn:located:child>) Declaration(ObjectProperty(:p)) Declaration(NamedIndividual(:a)) ObjectPropertyAssertion(:p :a _:shared))';
  const child=prefix+' Ontology(<urn:located:child> Declaration(Class(:B)) ClassAssertion(:B _:shared))';
  const target=query('ObjectPropertyAssertion(:p :a _:witness) ClassAssertion(:B _:witness)');
  const input=request([document(root,{ontologyIri:'urn:located:root'}),document(child,{id:'child',documentIri:'urn:located:child:document',ontologyIri:'urn:located:child'})],[{from:'root',iri:'urn:located:child',to:'child'}],{kind:'explanation',target:'entailment',query:target});
  const result=await run(input,'INVALID_INPUT');assert.equal(result.error.code,'NO_EXPLANATION_TARGET');assert.equal(result.result.sourceLocationVersion,undefined);
});

test('Turtle, RDF/XML and imports mixed with Functional Syntax retain complete original-source locations',async()=>{
  const turtle='@prefix : <'+ns+'> . @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . :A a owl:Class ; rdfs:subClassOf :B . :B a owl:Class . :a a owl:NamedIndividual, :A .';
  const only=request([document(turtle,{format:'turtle'})]),plain=await run(only);verifyLocations(only,plain);
  const p=project(only,plain);assert.equal(p.axiomSourceLocationCoverage,'COMPLETE');assert.equal(p.sourceLocationDocuments.length,1);
  for(const ax of p.support)for(const d of ax.documents){assert.equal(d.axiomSourceLocation.kind,'RDF_CONSTRUCTION');assert.ok(d.axiomSourceLocation.constructionOccurrenceIds.length);}
  const xml='<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#" xmlns:owl="http://www.w3.org/2002/07/owl#"><owl:Class rdf:about="'+ns+'A"><rdfs:subClassOf rdf:resource="'+ns+'B"/></owl:Class><owl:Class rdf:about="'+ns+'B"/><owl:NamedIndividual rdf:about="'+ns+'a"><rdf:type rdf:resource="'+ns+'A"/></owl:NamedIndividual></rdf:RDF>';
  const xmlInput=request([document(xml,{format:'rdfxml'})]),xmlResult=await run(xmlInput);verifyLocations(xmlInput,xmlResult);const xmlProjection=project(xmlInput,xmlResult);assert.equal(xmlProjection.axiomSourceLocationCoverage,'COMPLETE');assert.equal(xmlProjection.sourceLocationDocuments.length,1);
  for(const ax of xmlProjection.support)for(const d of ax.documents){assert.equal(d.axiomSourceLocation.kind,'RDF_CONSTRUCTION');assert.ok(d.axiomSourceLocation.constructionOccurrenceIds.length);}
  const functional=prefix+' Ontology(<urn:located:root> Import(<urn:located:child>) '+declarations+' ClassAssertion(:A :a))';
  const child=turtle.replace(':a a owl:NamedIndividual, :A .','<urn:located:child> a owl:Ontology .');
  const mixed=request([document(functional,{ontologyIri:'urn:located:root'}),document(child,{id:'child',documentIri:'urn:located:child:document',ontologyIri:'urn:located:child',format:'turtle'})],[{from:'root',iri:'urn:located:child',to:'child'}]);
  const result=await run(mixed);verifyLocations(mixed,result);assert.equal(project(mixed,result).axiomSourceLocationCoverage,'COMPLETE');
  const xmlChild=xml.replace('<owl:NamedIndividual rdf:about="'+ns+'a"><rdf:type rdf:resource="'+ns+'A"/></owl:NamedIndividual>','<owl:Ontology rdf:about="urn:located:child"/>');
  const mixedXML=request([document(functional,{ontologyIri:'urn:located:root'}),document(xmlChild,{id:'child',documentIri:'urn:located:child:document',ontologyIri:'urn:located:child',format:'rdfxml'})],[{from:'root',iri:'urn:located:child',to:'child'}]);
  const xmlMixedResult=await run(mixedXML);verifyLocations(mixedXML,xmlMixedResult);assert.equal(project(mixedXML,xmlMixedResult).axiomSourceLocationCoverage,'COMPLETE');
});

test('empty support is not applicable; malformed source never produces successful location evidence',async()=>{
  const input=request([document(prefix+' Ontology('+declarations+')')],[],{kind:'explanation',target:'entailment',query:query('SubClassOf(:A :A)')}),result=await run(input);
  assert.deepEqual(result.result.support,[]);assert.deepEqual(result.result.sourceLocationDocuments,[]);assert.equal(project(input,result).axiomSourceLocationCoverage,'NOT_APPLICABLE');
  const malformed=request([document(prefix+' Ontology('+declarations+' SubClassOf(:A :B) ClassAssertion(:A :a)')]);
  const failed=await run(malformed,'INVALID_INPUT');assert.equal(failed.complete,false);assert.equal(failed.result.sourceLocationVersion,undefined);
});

test('premature token EOF is rejected in ordinary premises, located explanations and queries',async()=>{
  const valid=prefix+' Ontology('+declarations+' SubClassOf(:A :B) ClassAssertion(:A :a))';
  for(const suffix of [' "unfinished 雪😀',' 7',' ^'])for(const task of [{kind:'legality'},{kind:'entailment',query:conclusion},{kind:'explanation',target:'entailment',query:conclusion}]){
    const input=request([document(valid+suffix)],[],task),result=await run(input,'INVALID_INPUT');
    assert.equal(result.error.code,'ONTOLOGY_PARSE');assert.equal(result.complete,false);assert.equal(result.result.sourceLocationVersion,undefined);
  }
  const invalidQuery=conclusion.content+' "escaped quote: \\"';
  for(const kind of ['entailment','explanation']){
    const task={kind,...(kind==='explanation'?{target:'entailment'}:{}),query:{format:'functional',content:invalidQuery,digest:sha(invalidQuery)}};
    const result=await run(request([document(valid)],[],task),'INVALID_INPUT');assert.equal(result.error.code,'ONTOLOGY_PARSE');assert.equal(result.complete,false);
  }
  const comment=request([document(valid+' # "an unfinished quote inside a comment is valid')]);
  const result=await run(comment);verifyLocations(comment,result);assert.equal(project(comment,result).axiomSourceLocationCoverage,'COMPLETE');
});

test('exact source validation rejects altered ranges, hashes, lines and coverage; legacy projection stays unchanged',async()=>{
  const content='# 雪😀\r\n'+prefix+'\rOntology('+declarations+' SubClassOf(:A :B) ClassAssertion(:A :a))';
  const input=request([document(content)]),result=await run(input),baseline=project(input,result);
  const changed=mutate=>{const clone=structuredClone(result);mutate(clone.result);return clone;};
  const first=d=>d.support[0].sources[0].sourceLocation.occurrences[0].fragments[0];
  for(const mutate of [
    d=>{d.sourceLocationVersion=4;},d=>{delete d.sourceLocationDocuments;},d=>{delete d.support[0].sources[0].sourceLocation;},
    d=>{first(d).start=-1;},d=>{first(d).end=content.length+1000;},d=>{first(d).start+=0.5;},
    d=>{first(d).start=4;},d=>{first(d).fragmentDigest=hash('wrong');},d=>{first(d).startLine++;},d=>{first(d).endLine++;},
    d=>{d.support[0].sources[0].sourceLocation.occurrences=[];},
    d=>{d.support[0].sources[0].sourceLocation.occurrences.push(structuredClone(d.support[0].sources[0].sourceLocation.occurrences[0]));},
    d=>{d.support[0].sources[0].sourceLocation.context[0].kind='AXIOM';},
    d=>{d.support[0].sources[0].sourceLocation.context[0].fragmentDigest=hash('wrong');},
    d=>{delete d.sourceLocationVersion;},
  ])assert.throws(()=>project(input,changed(mutate)));
  const v1=changed(d=>{d.sourceLocationVersion=1;delete d.sourceLocationDocuments;}),v1Projection=project(input,v1),v1Expected=structuredClone(baseline);
  v1Expected.sourceLocationVersion=1;delete v1Expected.sourceLocationDocuments;v1Expected.task.resultDigest=hash(v1);
  assert.equal(JSON.stringify(v1Projection),JSON.stringify(v1Expected));assert.equal(hash(v1Projection),hash(v1Expected));
  const legacy=changed(d=>{delete d.sourceLocationVersion;delete d.sourceLocationDocuments;for(const a of d.support)for(const s of a.sources)delete s.sourceLocation;});
  const old=project(input,legacy),expected=structuredClone(baseline);delete expected.sourceLocationVersion;delete expected.axiomSourceLocationCoverage;delete expected.sourceLocationDocuments;
  for(const a of expected.support)for(const d of a.documents)delete d.axiomSourceLocation;expected.task.resultDigest=hash(legacy);
  assert.equal(JSON.stringify(old),JSON.stringify(expected));assert.equal(hash(old),hash(expected));
  assert.equal(hash(project(input,result)),hash(baseline),'Protocol mutation probes do not modify the real native result');
});
