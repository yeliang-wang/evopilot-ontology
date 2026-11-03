import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,cpSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createDLRunner} from '../../dist/reasoning/runner.js';
import {readDLToolchain} from '../../dist/reasoning/toolchain.js';
import {validateDLRequest,closureDigest} from '../../dist/reasoning/request.js';
import {hash,hashBytes} from '../../dist/standalone/validation.js';
import {sha,ns,ofn,query,document,request,declaration,sensitive,readonly,impossible,keyed} from '../fixtures/v090/reasoning.mjs';

let base,binding,runner,toolchainFile;
before(()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN,'Prepare an actual installed DL worker and select EVOPILOT_TEST_DL_TOOLCHAIN; mock/skip is not acceptance');
  const selected=readDLToolchain(process.env.EVOPILOT_TEST_DL_TOOLCHAIN);
  assert.equal(selected.workerSourceDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/Worker.java',import.meta.url))),'Installed worker must match current source');
  assert.equal(selected.dependencyLockDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/dependencies.json',import.meta.url))));
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-dl-')));const root=join(base,'runtime');cpSync(selected.root,root,{recursive:true});chmodSync(root,0o700);
  const {digest:_,...identity}={...selected,root};binding={...identity,digest:hash(identity)};
  toolchainFile=join(root,'toolchain.json');writeFileSync(toolchainFile,JSON.stringify(binding),{mode:0o600});
  const workRoot=join(base,'worker');mkdirSync(workRoot,{mode:0o700});runner=createDLRunner({toolchainFile,workRoot});
});
after(()=>{if(base)rmSync(base,{recursive:true,force:true});});
async function run(body,task,status='COMPLETED'){
  const input=request(body,task),result=await runner.run(input);
  assert.equal(result.status,status,JSON.stringify(result));assert.equal(result.requestDigest,hash(input));assert.equal(result.closureDigest,closureDigest(input.closure));assert.equal(result.toolchainDigest,binding.digest);
  return result;
}

test('actual DL classification retains open-world distinction after removing its sole premise',async()=>{
  await run(sensitive,{kind:'entailment',query:query('ClassAssertion(:SensitiveService :api)')},'ENTAILED');
  const removed=sensitive.replace('ObjectPropertyAssertion(:accesses :api :data)','');
  const absent=await run(removed,{kind:'entailment',query:query('ClassAssertion(:SensitiveService :api)')},'NOT_ENTAILED');assert.equal(absent.result.negationInferred,false);
  await run(removed,{kind:'entailment',query:query('ClassAssertion(ObjectComplementOf(:SensitiveService) :api)')},'NOT_ENTAILED');
});

test('empty logical conclusion is explicitly vacuous and is not a business coverage claim',async()=>{
  const result=await run(sensitive,{kind:'entailment',query:query('')},'ENTAILED');
  assert.equal(result.result.vacuous,true);assert.deepEqual(result.result.queryAxioms,[]);
});

test('RDF singleton class expressions follow OWL 2 compatibility mapping including nested datatype facets',async()=>{
  const content=`@prefix : <urn:evopilot:formal-test:> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
:A a owl:Class; owl:equivalentClass [a owl:Class; owl:intersectionOf (:B)] .
:B a owl:Class; owl:equivalentClass [a owl:Class; owl:unionOf (:C)] . :C a owl:Class .
:number a owl:DatatypeProperty .
:Mixed a owl:Class; rdfs:subClassOf [a owl:Class; owl:intersectionOf (
  [a owl:Restriction; owl:onProperty :number; owl:someValuesFrom [a rdfs:Datatype; owl:onDatatype xsd:integer; owl:withRestrictions ([xsd:minInclusive "0"^^xsd:integer])]]
)] .
:a a owl:NamedIndividual, :A, :Mixed; :number "1"^^xsd:integer .`;
  const input=request('',{kind:'entailment',query:query('ClassAssertion(:C :a)')});input.closure.documents=[document(content,{format:'turtle'})];
  assert.equal((await runner.run(input)).status,'ENTAILED');
  const q=`@prefix : <urn:evopilot:formal-test:> . @prefix owl: <http://www.w3.org/2002/07/owl#> .
:C a owl:Class . :a a [a owl:Class; owl:intersectionOf (:C)] .`;
  input.task.query={format:'turtle',content:q,digest:sha(q)};assert.equal((await runner.run(input)).status,'ENTAILED');
  input.task.query=query('ClassAssertion(:Unrelated :a)');assert.equal((await runner.run(input)).status,'NOT_ENTAILED');
  // The RDF compatibility mapping does not legalize malformed Functional Syntax.
  const malformed=declaration({classes:['A','B']})+' EquivalentClasses(:A ObjectIntersectionOf(:B))';
  assert.equal((await runner.run(request(malformed,{kind:'legality'}))).status,'INVALID_INPUT');
});

test('already mapped nested ontology annotations pass while dangling reification remains rejected',async()=>{
  const content=`<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:owl="http://www.w3.org/2002/07/owl#" xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#" xmlns:ex="urn:evopilot:formal-test:">
<owl:Ontology rdf:about="urn:evopilot:formal-test:model"><rdfs:label>Model label</rdfs:label></owl:Ontology>
<owl:Annotation><owl:annotatedSource rdf:resource="urn:evopilot:formal-test:model"/><owl:annotatedProperty rdf:resource="http://www.w3.org/2000/01/rdf-schema#label"/><owl:annotatedTarget>Model label</owl:annotatedTarget><ex:author>Fixture author</ex:author></owl:Annotation>
<owl:AnnotationProperty rdf:about="urn:evopilot:formal-test:author"/></rdf:RDF>`;
  const input=request('',{kind:'consistency'});input.closure.documents=[document(content,{format:'rdfxml',ontologyIri:ns+'model'})];
  const accepted=await runner.run(input);assert.equal(accepted.status,'COMPLETED',JSON.stringify(accepted));
  for(const broken of [content.replace('<owl:annotatedTarget>Model label','<owl:annotatedTarget>Unmatched label'),content.replace('<owl:annotatedProperty rdf:resource="http://www.w3.org/2000/01/rdf-schema#label"/>','')]){
    input.closure.documents[0].content=broken;input.closure.documents[0].digest=sha(broken);
    const result=await runner.run(input);assert.equal(result.status,'INVALID_INPUT');assert.equal(result.error.code,'UNPARSED_RDF');
  }
  // A second, untyped reification group must not be accepted just because its
  // values match a different, already parsed nested annotation.
  const extra='<rdf:Description><owl:annotatedSource rdf:resource="urn:evopilot:formal-test:model"/><owl:annotatedProperty rdf:resource="http://www.w3.org/2000/01/rdf-schema#label"/><owl:annotatedTarget>Model label</owl:annotatedTarget></rdf:Description>';
  const broken=content.replace('</rdf:RDF>',extra+'</rdf:RDF>');
  input.closure.documents[0].content=broken;input.closure.documents[0].digest=sha(broken);
  assert.equal((await runner.run(input)).status,'INVALID_INPUT');
});

test('unreferenced RDF expressions are mapped and checked without inventing premise or query axioms',async()=>{
  const prefix=`@prefix : <${ns}> . @prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n`;
  const content=prefix+`:A a owl:Class . :B a owl:Class . :p a owl:ObjectProperty .
_:only a owl:Class; owl:intersectionOf (:A [a owl:Class; owl:unionOf (:B)]) .
[] a owl:Restriction; owl:onProperty :p; owl:minCardinality "1"^^xsd:int .`;
  const input=request('',{kind:'consistency'});input.closure.documents=[document(content,{format:'turtle'})];
  const accepted=await runner.run(input);assert.equal(accepted.status,'COMPLETED',JSON.stringify(accepted));
  assert.equal(accepted.result.axiomCount,3,'Only source declarations belong in the premise projection');
  input.task={kind:'entailment',query:{format:'turtle',content,digest:sha(content)}};
  const empty=await runner.run(input);assert.equal(empty.status,'ENTAILED',JSON.stringify(empty));
  assert.equal(empty.result.vacuous,true);assert.deepEqual(empty.result.queryAxioms,[]);
  // An otherwise unused expression still has to respect global DL restrictions.
  const nonsimple=content+':p a owl:TransitiveProperty .';
  input.closure.documents=[document(nonsimple,{format:'turtle'})];input.task={kind:'legality'};
  const invalid=await runner.run(input);assert.equal(invalid.status,'INVALID_INPUT',JSON.stringify(invalid));
  assert.equal(invalid.error.code,'OWL2_DL_PROFILE');
  // Unmapped anonymous nodes may not be replaced with OWLAPI's fresh error classes.
  for(const broken of ['[] a owl:Class .','[] a owl:Restriction; owl:minCardinality "1"^^xsd:int .']){
    input.closure.documents=[document(prefix+broken,{format:'turtle'})];
    const result=await runner.run(input);assert.equal(result.status,'INVALID_INPUT',JSON.stringify(result));
    assert.equal(result.error.code,'RDF_EXPRESSION');
  }
});

test('RDF reflexive class equivalence retains a nonvacuous expression and source annotations',async()=>{
  const content=`@prefix : <${ns}> . @prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
:p a owl:ObjectProperty .
_:c a owl:Restriction; owl:onProperty :p; owl:minCardinality "1"^^xsd:int; owl:equivalentClass _:c .
[] a owl:Axiom; owl:annotatedSource _:c; owl:annotatedProperty owl:equivalentClass; owl:annotatedTarget _:c; rdfs:label "source reflexivity" .`;
  const input=request(declaration({objects:['p']}),{kind:'entailment',query:{format:'turtle',content,digest:sha(content)}});
  const result=await runner.run(input);assert.equal(result.status,'ENTAILED',JSON.stringify(result));
  assert.equal(result.result.vacuous,false);assert.equal(result.result.queryAxioms.length,1);
  assert.match(result.result.queryAxioms[0].axiom,/source reflexivity/);
  assert.match(result.result.queryAxioms[0].axiom,/ObjectMinCardinality/);
  input.task.query=query('EquivalentClasses(:A)');
  assert.equal((await runner.run(input)).status,'INVALID_INPUT','RDF projection does not legalize malformed Functional Syntax');
});

test('RDF reader syntax errors remain invalid inputs rather than engine failures',async()=>{
  for(const [format,content] of [
    ['turtle','@prefix : <urn:test:> . :a a .'],
    ['rdfxml','<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="urn:a" rdf:nodeID="b"/></rdf:RDF>'],
  ]){
    const input=request('',{kind:'legality'});input.closure.documents=[document(content,{format})];
    const result=await runner.run(input);assert.equal(result.status,'INVALID_INPUT',JSON.stringify(result));
    assert.equal(result.error.code,'ONTOLOGY_PARSE');assert.equal(result.complete,false);
  }
});

test('property chains, inverse properties and transitivity entail actual dependency paths',async()=>{
  const body=declaration({objects:['uses','from','depends','usedBy','metricDepends'],individuals:['service','dataset','database','a','b','c']})+`
SubObjectPropertyOf(ObjectPropertyChain(:uses :from) :depends)
InverseObjectProperties(:uses :usedBy)
TransitiveObjectProperty(:metricDepends)
ObjectPropertyAssertion(:uses :service :dataset)
ObjectPropertyAssertion(:from :dataset :database)
ObjectPropertyAssertion(:metricDepends :a :b)
ObjectPropertyAssertion(:metricDepends :b :c)`;
  await run(body,{kind:'entailment',query:query('ObjectPropertyAssertion(:depends :service :database) ObjectPropertyAssertion(:usedBy :dataset :service) ObjectPropertyAssertion(:metricDepends :a :c)')},'ENTAILED');
});

test('whole-model inconsistency and unsatisfiable uninstantiated classes remain distinct',async()=>{
  await run(readonly,{kind:'consistency'},'INCONSISTENT');
  const blocked=await run(readonly,{kind:'entailment',query:query('ClassAssertion(:ReadOnly :target)')},'INCONSISTENT');assert.equal(blocked.result.axioms,undefined);
  await run(readonly.replace('ObjectPropertyAssertion(:writes :task :target)',''),{kind:'consistency'});
  await run(impossible,{kind:'consistency'});
  assert.equal((await run(impossible,{kind:'satisfiability',query:query('SubClassOf(owl:Thing :Impossible)')})).result.satisfiable,false);
  await run(impossible+'\nClassAssertion(:Impossible :task)',{kind:'consistency'},'INCONSISTENT');
});

test('keys, no unique-name assumption and explicit difference do not become physical merges',async()=>{
  await run(keyed,{kind:'entailment',query:query('SameIndividual(:a :b)')},'ENTAILED');
  const identity=(await run(keyed,{kind:'identity',entities:[ns+'a']})).result.entities[0];assert.deepEqual(identity.same,[ns+'a',ns+'b']);assert.equal(identity.physicalMerge,false);
  await run(keyed+'\nDifferentIndividuals(:a :b)',{kind:'consistency'},'INCONSISTENT');
  const body=declaration({objects:['p'],individuals:['x','a','b']})+'\nFunctionalObjectProperty(:p) ObjectPropertyAssertion(:p :x :a) ObjectPropertyAssertion(:p :x :b)';
  await run(body,{kind:'entailment',query:query('SameIndividual(:a :b)')},'ENTAILED');
});

test('negative assertions and datatype values are checked by the formal engine',async()=>{
  const negative=declaration({objects:['p'],individuals:['a','b']})+'\nNegativeObjectPropertyAssertion(:p :a :b)';
  await run(negative,{kind:'entailment',query:query('NegativeObjectPropertyAssertion(:p :a :b)')},'ENTAILED');
  await run(negative+'\nObjectPropertyAssertion(:p :a :b)',{kind:'consistency'},'INCONSISTENT');
  const values=declaration({data:['code'],individuals:['a']})+'\nFunctionalDataProperty(:code) DataPropertyAssertion(:code :a "01"^^xsd:integer) DataPropertyAssertion(:code :a "1"^^xsd:int)';
  await run(values,{kind:'consistency'});
  await run(values.replace('"1"^^xsd:int','"2"^^xsd:int'),{kind:'consistency'},'INCONSISTENT');
});

test('finite hierarchy and realization projections do not invent anonymous witnesses',async()=>{
  const hierarchy=(await run(sensitive,{kind:'classHierarchy',entities:[ns+'SensitiveService'],direct:false})).result;
  assert.ok(hierarchy.entities[0].super.includes(ns+'Service'));assert.equal(hierarchy.allLogicalConsequences,false);
  const body=declaration({classes:['A','B'],objects:['p'],individuals:['x','named']})+'\nSubClassOf(:A ObjectSomeValuesFrom(:p :B)) ClassAssertion(:A :x)';
  const realization=(await run(body,{kind:'realization',entities:[ns+'x'],direct:false})).result;
  assert.deepEqual(realization.requestedEntities,[ns+'x']);assert.ok(realization.entities[0].types.includes(ns+'A'));
  await run(body,{kind:'entailment',query:query('ObjectPropertyAssertion(:p :x :named)')},'NOT_ENTAILED');
  const props=declaration({objects:['p','q'],data:['first','second']})+'\nSubObjectPropertyOf(:p :q) SubDataPropertyOf(:first :second)';
  assert.ok((await run(props,{kind:'objectPropertyHierarchy',entities:[ns+'p'],direct:false})).result.entities[0].super.includes('<'+ns+'q>'));
  assert.ok((await run(props,{kind:'dataPropertyHierarchy',entities:[ns+'first'],direct:false})).result.entities[0].super.includes(ns+'second'));
});

test('illegal global restrictions fail before ordinary reasoning',async()=>{
  const body=declaration({classes:['A'],objects:['p']})+'\nTransitiveObjectProperty(:p) SubClassOf(:A ObjectMaxCardinality(1 :p))';
  const result=await run(body,{kind:'legality'},'INVALID_INPUT');assert.equal(result.error.code,'OWL2_DL_PROFILE');assert.ok(result.result.violations.length>0);
});

test('joint anonymous-individual queries do not combine different witnesses into one',async()=>{
  const body=declaration({classes:['B'],objects:['p'],individuals:['a','x','y']})+'\nObjectPropertyAssertion(:p :a :x) ClassAssertion(:B :y) DifferentIndividuals(:x :y)';
  const task={kind:'entailment',query:query('ObjectPropertyAssertion(:p :a _:shared) ClassAssertion(:B _:shared)')};
  await run(body,task,'NOT_ENTAILED');
  await run(body+'\nClassAssertion(:B :x)',task,'ENTAILED');
});

test('pinned transitive imports combine Turtle and RDF/XML without fetching their addresses',async t=>{
  let contacts=0;const server=createServer((req,res)=>{contacts++;res.end('must not read');});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const origin='http://127.0.0.1:'+server.address().port;
  const ttl=`@prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . @prefix : <${ns}> .
<${origin}/root> a owl:Ontology ; owl:imports <${origin}/middle> . :x a owl:NamedIndividual, :A . :A a owl:Class .`;
  const middle=`@prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . @prefix : <${ns}> .
<${origin}/middle> a owl:Ontology ; owl:imports <${origin}/leaf> . :A a owl:Class ; rdfs:subClassOf :B . :B a owl:Class .`;
  const xml=`<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#" xmlns:owl="http://www.w3.org/2002/07/owl#"><owl:Ontology rdf:about="${origin}/leaf"/><owl:Class rdf:about="${ns}B"><rdfs:subClassOf rdf:resource="${ns}C"/></owl:Class><owl:Class rdf:about="${ns}C"/></rdf:RDF>`;
  const docs=[['root',ttl,'turtle'],['middle',middle,'turtle'],['leaf',xml,'rdfxml']].map(([id,content,format])=>document(content,{id,format,documentIri:origin+'/'+id,ontologyIri:origin+'/'+id}));
  const input={schema:'ontology-dl-request/v1',requestId:'imports',closure:{rootDocumentId:'root',documents:docs,imports:[{from:'root',iri:origin+'/middle',to:'middle'},{from:'middle',iri:origin+'/leaf',to:'leaf'}]},task:{kind:'entailment',query:query('ClassAssertion(:C :x)')}};
  const result=await runner.run(input);assert.equal(result.status,'ENTAILED',JSON.stringify(result));assert.equal(contacts,0);
  const missing=structuredClone(input);missing.closure.documents=[docs[0]];missing.closure.imports=[];
  const absent=await runner.run(missing);assert.equal(absent.status,'MISSING_IMPORT',JSON.stringify(absent));assert.equal(contacts,0);
  const wrong=structuredClone(input);wrong.closure.documents[2].ontologyIri=origin+'/wrong';
  const mismatch=await runner.run(wrong);assert.equal(mismatch.status,'INVALID_INPUT');assert.equal(mismatch.error.code,'ONTOLOGY_IDENTITY_MISMATCH');
  const conflict=structuredClone(input);conflict.closure.documents[2].ontologyIri=origin+'/middle';assert.throws(()=>validateDLRequest(conflict),{code:'IMPORT_CONFLICT'});
  const xxe=`<?xml version="1.0"?><!DOCTYPE rdf:RDF [<!ENTITY xxe SYSTEM "${origin}/secret">]><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"><rdf:Description rdf:about="urn:x"><rdfs:label>&xxe;</rdfs:label></rdf:Description></rdf:RDF>`;
  const unsafe=request('',{kind:'consistency'});unsafe.closure.documents=[document(xxe,{format:'rdfxml'})];
  const refused=await runner.run(unsafe);assert.equal(refused.status,'INVALID_INPUT');assert.equal(refused.error.code,'UNSAFE_XML');assert.equal(contacts,0);
});

test('supporting axioms carry source selectors and independently replay the conclusion',async()=>{
  const original=request(sensitive,{kind:'explanation',target:'entailment',query:query('ClassAssertion(:SensitiveService :api)')});
  const explanation=await runner.run(original);assert.equal(explanation.status,'COMPLETED',JSON.stringify(explanation));
  assert.equal(explanation.result.allMinimalJustifications,false);assert.ok(explanation.result.support.length>0);
  for(const ax of explanation.result.support){assert.equal(ax.axiomDigest,sha(ax.axiom));assert.equal(ax.sources[0].documentDigest,original.closure.documents[0].digest);assert.equal(ax.sources[0].selectorKind,'OWL_STRUCTURAL_AXIOM');}
  const replay=request('',{kind:'entailment',query:original.task.query});replay.closure.documents=[document(explanation.result.replay.content)];
  assert.equal((await runner.run(replay)).status,'ENTAILED');
  const conflict=await run(readonly,{kind:'explanation',target:'inconsistency'});
  const second=request('',{kind:'consistency'});second.closure.documents=[document(conflict.result.replay.content)];
  assert.equal((await runner.run(second)).status,'INCONSISTENT');
});

test('changed input, unsafe JSON and invalid closure fail before process execution',()=>{
  const input=request(sensitive,{kind:'consistency'});input.closure.documents[0].content+=' ';assert.throws(()=>validateDLRequest(input),{code:'DIGEST_MISMATCH'});
  const unbound=request(sensitive,{kind:'consistency'});unbound.closure.documents.push(document(ofn(''),{id:'unused',documentIri:ns+'unused'}));assert.throws(()=>validateDLRequest(unbound),{code:'INVALID_INPUT'});
  const accessor=request(sensitive,{kind:'consistency'});Object.defineProperty(accessor.task,'surprise',{get:()=>{throw new Error('getter must not run');}});assert.throws(()=>validateDLRequest(accessor),{code:'INVALID_INPUT'});
  const holes=request(sensitive,{kind:'identity',entities:new Array(3)});assert.throws(()=>validateDLRequest(holes),{code:'INVALID_INPUT'});
  const large=request(sensitive+'\n#'+ 'x'.repeat(600000),{kind:'consistency'});assert.doesNotThrow(()=>validateDLRequest(large),'Formal worker byte budget is distinct from HTTP transport envelope budget');
});

test('deadline, cancellation and concurrent calls retain explicit incomplete outcomes and release worker lease',async()=>{
  const input=request(sensitive,{kind:'consistency'});
  const timeout=await runner.run(input,{timeoutMs:1});assert.equal(timeout.status,'TIMEOUT');assert.equal(timeout.complete,false);
  const stopped=new AbortController();stopped.abort();assert.equal((await runner.run(input,{signal:stopped.signal})).status,'CANCELLED');
  const controller=new AbortController();const running=runner.run(input,{signal:controller.signal});
  await assert.rejects(runner.run(input),{code:'REASONER_BUSY'});controller.abort();assert.equal((await running).status,'CANCELLED');
  assert.equal((await runner.run(input)).status,'COMPLETED');
});

test('installed executable drift is refused without running modified code',async()=>{
  const path=join(binding.root,'worker.jar'),bytes=readFileSync(path);
  try{writeFileSync(path,Buffer.concat([bytes,Buffer.from('changed')]));await assert.rejects(runner.run(request(sensitive,{kind:'consistency'})),{code:'TOOLCHAIN_DRIFT'});}
  finally{writeFileSync(path,bytes);}
});
