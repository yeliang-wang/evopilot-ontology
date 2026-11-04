import test from 'node:test';
import assert from 'node:assert/strict';
import {rdfAxiomLocationValidator} from '../../dist/native-v2/rdf-axiom-locations.js';
import {explainEvidence} from '../../dist/native-v2/explanations.js';
import {closureDigest} from '../../dist/reasoning/request.js';
import {hash,hashBytes} from '../../dist/standalone/validation.js';
import {sourceSet,draft} from '../helpers/v090-native.mjs';

// Adversarial owner-protocol fixtures, not fabricated evidence of native parser
// execution. Actual worker/business lifecycle coverage is in the native suite.
function fragment(content,text,from=0){
  const at=content.indexOf(text,from);assert.ok(at>=0);const end=at+text.length;
  const line=offset=>content.slice(0,offset).replace(/\r$/u,content[offset]==='\n'?'':'\r').split(/\r\n|\r|\n/u).length;
  return {start:Buffer.byteLength(content.slice(0,at)),end:Buffer.byteLength(content.slice(0,end)),fragmentDigest:hashBytes(text),startLine:line(at),endLine:line(end-Array.from(text).at(-1).length)};
}
const term=(sourceId,contextIds=[],extra={})=>({sourceId,inherited:false,generated:false,contextIds,...extra});
const location=(constructionOccurrenceIds=[10],parserContextOccurrenceIds=[20])=>({schema:'ontology-axiom-source-location/v2',kind:'RDF_CONSTRUCTION',constructionOccurrenceIds,parserContextOccurrenceIds});
function fixture(){
  const content='\uFEFF@prefix ex: <../ns#> .\r\nex:𐐀 rdf:type ex:B .\rex:C rdf:type ex:B .\n';
  const document={id:'model',documentIri:'https://example.test/onto/input.ttl',ontologyIri:null,versionIri:null,format:'turtle',content,digest:hashBytes(content)};
  const second=content.indexOf('ex:C');
  const source=(id,kind,text,from=0)=>({id,kind,...fragment(content,text,from)});
  const table={schema:'ontology-rdf-source-document/v1',documentId:document.id,documentDigest:document.digest,format:'turtle',parserId:'owlapi-turtle-occurrences:1',
    sources:[source(1,'PREFIX','@prefix ex: <../ns#> .'),source(2,'TOKEN','ex:𐐀'),source(3,'TOKEN','rdf:type'),source(4,'TOKEN','ex:B'),source(5,'TOKEN','ex:C'),source(6,'TOKEN','rdf:type',second),source(7,'TOKEN','ex:B',second)],
    contexts:[{id:1,kind:'DOCUMENT',prefixName:null,resolved:document.documentIri,sourceId:0,dependencyContextIds:[]},
      {id:4,kind:'BUILTIN',prefixName:'rdf:',resolved:'http://www.w3.org/1999/02/22-rdf-syntax-ns#',sourceId:0,dependencyContextIds:[]},
      {id:8,kind:'PREFIX',prefixName:'ex:',resolved:'https://example.test/ns#',sourceId:1,dependencyContextIds:[1]}],
    occurrences:[{id:10,triple:{subject:'https://example.test/ns#𐐀',predicate:'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',object:{kind:'RESOURCE',value:'https://example.test/ns#B'}},subject:term(2,[8]),predicate:term(3,[4]),object:term(4,[8]),generatedKind:null},
      {id:20,triple:{subject:'https://example.test/ns#C',predicate:'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',object:{kind:'RESOURCE',value:'https://example.test/ns#B'}},subject:term(5,[8]),predicate:term(6,[4]),object:term(7,[8]),generatedKind:null}]};
  return {document,table,locations:[location([10],[20]),location([20],[10,20])]};
}
function validate(f){const v=rdfAxiomLocationValidator([f.document],[f.table]);for(const l of f.locations)v.validate(f.document,l);v.finish();return v;}

test('v2 preserves shared IDs, original Unicode bytes, distinct roles and implicit contexts',()=>{
  const f=fixture(),before=JSON.stringify(f),v=validate(f);
  assert.deepEqual(v.tables,[f.table]);assert.equal(JSON.stringify(f),before);
  assert.equal(f.table.sources[1].end-f.table.sources[1].start,7,'The non-BMP local name is measured in UTF-8 bytes');
  assert.equal(f.table.sources[1].startLine,2);assert.equal(f.table.sources[4].startLine,3);
  assert.ok(f.locations[1].constructionOccurrenceIds.some(id=>f.locations[1].parserContextOccurrenceIds.includes(id)),'Roles may overlap');
  assert.throws(()=>v.validate(f.document,f.locations[0]),/already finished/u);
  assert.throws(()=>v.finish(),/already finished/u);
  const sparse=fixture();sparse.table.sources[1].id=500000;sparse.table.occurrences[0].subject.sourceId=500000;sparse.table.sources.sort((a,b)=>a.id-b.id);
  validate(sparse); // A retained handle ID is not bounded by the table's record count.
});

test('nested/shared source spans are allowed without inventing a complete-axiom span',()=>{
  const f=fixture(),s=f.table.sources[1],last=f.table.sources[3];
  f.table.sources.push({id:100,kind:'PROPERTY_LIST',start:s.start,end:last.end,fragmentDigest:hashBytes(Buffer.from(f.document.content).subarray(s.start,last.end)),startLine:2,endLine:2});
  f.table.occurrences[1].subject=term(100,[],{generated:true,inherited:true});f.table.occurrences[1].generatedKind='BLANK_PROPERTY_LIST';
  f.table.sources=f.table.sources.filter(s=>s.id!==5);
  validate(f);
  assert.notEqual(f.table.sources.find(s=>s.id===100).start,f.table.sources[2].start);
});

test('original bytes, exact table closure and reference tampering fail closed',()=>{
  const mutations=[
    f=>{f.table.documentDigest=hash('other');},f=>{f.table.documentId='other';},f=>{f.table.format='rdfxml';},f=>{f.table.parserId='unlocked';},
    f=>{f.table.sources[1].fragmentDigest=hash('other');},f=>{f.table.sources[1].start+=4;},f=>{f.table.sources[1].end--;},
    f=>{f.table.sources[1].startLine++;},f=>{f.table.sources[1].endLine++;},f=>{f.table.sources[1].end=Infinity;},
    f=>{f.table.sources[1].id=f.table.sources[0].id;},f=>{f.table.sources.reverse();},f=>{f.table.sources[1].id=0;},
    f=>{f.table.sources.push({...f.table.sources[1],id:900});},f=>{f.table.occurrences.push({...f.table.occurrences[1],id:30});},
    f=>{f.table.occurrences[0].subject.sourceId=999;},f=>{f.table.occurrences[0].subject.sourceId=0;},f=>{f.table.occurrences[0].subject.sourceId=1;},
    f=>{f.table.occurrences[0].subject.contextIds=[999];},f=>{f.table.occurrences[0].subject.contextIds=[8,8];},
    f=>{f.locations[0].constructionOccurrenceIds=[];},f=>{f.locations[0].constructionOccurrenceIds=[20,10];},f=>{f.locations[0].constructionOccurrenceIds=[10,10];},f=>{f.locations[0].parserContextOccurrenceIds=[99];},
    f=>{f.table.occurrences[0].generatedKind='GUESS';},f=>{f.table.occurrences[0].generatedKind='COLLECTION_TYPE';},
    f=>{f.table.occurrences[0].subject.generated=true;},f=>{f.table.occurrences[0].subject.inherited='yes';},
    f=>{f.table.occurrences[0].triple.object={kind:'LITERAL',lexical:'x',language:'en',datatype:'urn:d'};},
    f=>{f.table.occurrences[0].triple.subject='\uD800';},f=>{f.table.occurrences[0].triple.extra=true;},
    f=>{f.table.contexts[0].sourceId=1;},f=>{f.table.contexts[0].resolved='urn:other';},f=>{f.table.contexts[1].sourceId=1;},
    f=>{f.table.contexts[1].prefixName='invented:';},f=>{f.table.contexts[1].resolved='urn:other';},f=>{f.table.contexts[2].sourceId=2;},
    f=>{f.table.contexts[2].dependencyContextIds=[8];},f=>{f.table.contexts[2].dependencyContextIds=[7];},
    f=>{f.table.contexts.push({...f.table.contexts[0],id:9});},f=>{f.table.contexts[1].kind='XML_NAMESPACE';},
  ];
  for(const [i,mutate] of mutations.entries()){const f=fixture();mutate(f);assert.throws(()=>validate(f),undefined,'mutation '+i);}
  const f=fixture(),other={...f.document,id:'other'};
  const v=rdfAxiomLocationValidator([f.document,other],[f.table]);
  assert.throws(()=>v.validate(other,f.locations[0]),/no source table/u,'Numeric IDs cannot cross the original document binding');
});

test('long semantic IRIs and empty literals retain the existing byte budget rather than an invented term cap',()=>{
  const f=fixture();f.table.occurrences[0].triple.subject='urn:'+('x'.repeat(5000));
  f.table.occurrences[1].triple.object={kind:'LITERAL',lexical:'',language:null,datatype:null};validate(f);
});

function evidenceFixture(f=fixture()){
  const modelDraft=draft(hash('intent'),hash(sourceSet),f.document.content);modelDraft.closure.documents=[f.document];
  modelDraft.mappings[0].anchors=[{documentId:f.document.id,documentDigest:f.document.digest,start:0,end:Buffer.byteLength(f.document.content),fragmentDigest:f.document.digest}];
  const model={draft:modelDraft,digest:hash(modelDraft),closureDigest:closureDigest(modelDraft.closure)};
  const content='Ontology(SubClassOf(<urn:A> <urn:A>))',request={schema:'ontology-dl-request/v1',requestId:'protocol-fixture',closure:modelDraft.closure,task:{kind:'explanation',target:'entailment',query:{format:'functional',content,digest:hashBytes(content)}}};
  const data={target:'entailment',method:'DELETION_REPLAY',allMinimalJustifications:false,sourceLocationVersion:2,sourceLocationDocuments:[f.table],
    support:f.locations.map((l,i)=>{const axiom='SubClassOf(<urn:A'+i+'> <urn:B>)';return {axiom,axiomDigest:hashBytes(axiom),sources:[{documentId:f.document.id,documentDigest:f.document.digest,selectorKind:'OWL_STRUCTURAL_AXIOM',axiomDigest:hashBytes(axiom),sourceLocation:l}]};}),replay:{format:'functional',content,digest:hashBytes(content)}};
  const result={schema:'ontology-dl-result/v1',requestId:request.requestId,requestDigest:hash(request),closureDigest:model.closureDigest,configurationDigest:hash('configuration'),toolchainDigest:hash('toolchain'),status:'COMPLETED',complete:true,elapsedMs:1,result:data,error:null};
  const evidence={taskId:request.requestId,kind:'dl',request,result};
  return {model,evidence,project:()=>explainEvidence(evidence,model,{sourceSet,fragments:sourceSet.fragments})};
}

test('v2 explanation projection keeps one shared table and leaves business mapping authority unchanged',()=>{
  const f=evidenceFixture(),p=f.project();assert.equal(p.sourceLocationVersion,2);assert.equal(p.axiomSourceLocationCoverage,'COMPLETE');
  assert.equal(p.sourceLocationDocuments.length,1);assert.equal(p.support.length,2);
  assert.equal(p.support[0].documents[0].mappings[0].axiomByteSpanEstablished,false);
  assert.equal(p.businessMeaningProven,false);assert.equal(p.authority,false);assert.equal(p.sourceLinkPrecision,'DOCUMENT_MAPPING_NOT_AXIOM_BYTE_LOCATION');
  assert.equal(JSON.stringify(f.project()),JSON.stringify(p));
  for(const change of [d=>{delete d.sourceLocationDocuments;},d=>{d.sourceLocationVersion=1;},d=>{delete d.sourceLocationVersion;},d=>{d.sourceLocationVersion=4;},d=>{delete d.support[0].sources[0].sourceLocation;}]){
    const c=evidenceFixture();change(c.evidence.result.result);assert.throws(c.project);
  }
  const empty=evidenceFixture();empty.evidence.result.result.support=[];empty.evidence.result.result.sourceLocationDocuments=[];
  assert.equal(empty.project().axiomSourceLocationCoverage,'NOT_APPLICABLE');
  const extra=evidenceFixture();extra.evidence.result.result.support=[];assert.throws(extra.project,/exactly the referenced/u);
});

test('legacy and v1 evidence preserve serialized projection shape and digest without backfilled tables',()=>{
  const f=evidenceFixture(),data=f.evidence.result.result;delete data.sourceLocationDocuments;data.sourceLocationVersion=1;
  for(const entry of data.support)for(const s of entry.sources)delete s.sourceLocation;
  const v1=f.project();assert.equal(v1.axiomSourceLocationCoverage,'UNAVAILABLE');assert.equal(Object.hasOwn(v1,'sourceLocationDocuments'),false);
  delete data.sourceLocationVersion;const legacy=f.project(),expected=structuredClone(v1);
  delete expected.sourceLocationVersion;delete expected.axiomSourceLocationCoverage;
  for(const ax of expected.support)for(const d of ax.documents)delete d.axiomSourceLocation;
  expected.task.resultDigest=hash(f.evidence.result);
  assert.equal(JSON.stringify(legacy),JSON.stringify(expected));assert.equal(hash(legacy),hash(expected));
  data.sourceLocationDocuments=[];assert.throws(f.project,/exactly source location version 2/u);
});

test('v2 keeps Functional v1 groups intact and mixed RDF/XML support explicitly partial',()=>{
  const axiom='SubClassOf(<urn:A> <urn:B>)',content='Ontology('+axiom+')',d={id:'model',documentIri:'urn:functional:document',ontologyIri:null,versionIri:null,format:'functional',content,digest:hashBytes(content)};
  const l={schema:'ontology-axiom-source-location/v1',occurrences:[{fragments:[fragment(content,axiom)]}],context:[]};
  const f=evidenceFixture({document:d,table:null,locations:[l]});f.evidence.result.result.sourceLocationDocuments=[];
  assert.deepEqual(f.project().support[0].documents[0].axiomSourceLocation,l);assert.equal(f.project().axiomSourceLocationCoverage,'COMPLETE');
  const mixed=evidenceFixture(),xml={id:'xml',documentIri:'urn:xml:document',ontologyIri:null,versionIri:null,format:'rdfxml',content:'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>',digest:''};xml.digest=hashBytes(xml.content);
  mixed.model.draft.closure.documents.push(xml);mixed.model.draft.closure.imports.push({from:'model',iri:xml.documentIri,to:xml.id});
  mixed.model.closureDigest=closureDigest(mixed.model.draft.closure);mixed.model.digest=hash(mixed.model.draft);
  mixed.evidence.result.closureDigest=mixed.model.closureDigest;mixed.evidence.result.requestDigest=hash(mixed.evidence.request);
  const entry=mixed.evidence.result.result.support[0];entry.sources.push({documentId:xml.id,documentDigest:xml.digest,selectorKind:'OWL_STRUCTURAL_AXIOM',axiomDigest:entry.axiomDigest});
  const p=mixed.project();assert.equal(p.axiomSourceLocationCoverage,'PARTIAL');assert.deepEqual(p.support[0].documents[1].axiomSourceLocation,{status:'UNAVAILABLE',reason:'FORMAT_NOT_INSTRUMENTED'});
});

// Synthetic retained envelopes establish protocol integrity only. The actual
// parser, attribution and native delivery require the real XML worker suite.
function mixedV3(){
  const f=evidenceFixture(),content='<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="urn:A"><p:note xmlns:p="urn:p:">v</p:note></rdf:Description></rdf:RDF>';
  const xml={id:'xml',documentIri:'urn:xml:document',ontologyIri:null,versionIri:null,format:'rdfxml',content,digest:hashBytes(content)};
  const xmlTerm={sourceSetId:1,inherited:false,generated:false,contextIds:[]};
  const table={schema:'ontology-rdfxml-source-document/v1',documentId:xml.id,documentDigest:xml.digest,format:'rdfxml',parserId:'owlapi-rdfxml-occurrences:1',
    sources:[{id:1,kind:'ELEMENT',...fragment(content,content)}],sourceSets:[{id:1,sourceIds:[1]}],contexts:[],
    occurrences:[{id:10,triple:{subject:'urn:A',predicate:'urn:p:note',object:{kind:'LITERAL',lexical:'v',language:null,datatype:null}},subject:{...xmlTerm},predicate:{...xmlTerm},object:{...xmlTerm},generatedKind:null}]};
  f.model.draft.closure.documents.push(xml);f.model.draft.closure.imports.push({from:'model',iri:xml.documentIri,to:xml.id});
  f.model.closureDigest=closureDigest(f.model.draft.closure);f.model.digest=hash(f.model.draft);
  f.evidence.result.closureDigest=f.model.closureDigest;f.evidence.result.requestDigest=hash(f.evidence.request);
  const data=f.evidence.result.result;data.sourceLocationVersion=3;data.sourceLocationDocuments.push(table);
  const entry=data.support[0];entry.sources.push({documentId:xml.id,documentDigest:xml.digest,selectorKind:'OWL_STRUCTURAL_AXIOM',axiomDigest:entry.axiomDigest,sourceLocation:location([10],[])});
  return f;
}

test('v3 projects mixed Turtle and multi-fragment XML tables without altering v2 or business authority',()=>{
  const f=mixedV3(),p=f.project();assert.equal(p.sourceLocationVersion,3);assert.equal(p.axiomSourceLocationCoverage,'COMPLETE');
  assert.deepEqual(p.sourceLocationDocuments,f.evidence.result.result.sourceLocationDocuments);assert.equal(p.businessMeaningProven,false);assert.equal(p.authority,false);
  assert.deepEqual(p.support[0].documents[1].axiomSourceLocation,location([10],[]));
  const older=mixedV3(),data=older.evidence.result.result;data.sourceLocationVersion=2;data.sourceLocationDocuments.pop();delete data.support[0].sources[1].sourceLocation;
  const p2=older.project();assert.equal(p2.sourceLocationVersion,2);assert.equal(p2.axiomSourceLocationCoverage,'PARTIAL');
  assert.deepEqual(p2.support[0].documents[1].axiomSourceLocation,{status:'UNAVAILABLE',reason:'FORMAT_NOT_INSTRUMENTED'});
  const turtle=evidenceFixture(),before=turtle.project();turtle.evidence.result.result.sourceLocationVersion=3;
  const expected=structuredClone(before);expected.sourceLocationVersion=3;expected.task.resultDigest=hash(turtle.evidence.result);
  assert.equal(JSON.stringify(turtle.project()),JSON.stringify(expected),'Existing Turtle values and projection order remain intact');
});

test('v3 rejects cross-format table/order substitution, omitted XML locations and unreferenced sources',()=>{
  const changes=[
    d=>{d.sourceLocationDocuments.reverse();},d=>{d.sourceLocationDocuments.push(d.sourceLocationDocuments[1]);},
    d=>{d.sourceLocationDocuments[1].documentId='model';},d=>{d.sourceLocationDocuments[1].format='turtle';},
    d=>{d.sourceLocationDocuments[1].format='functional';},d=>{d.sourceLocationDocuments[1].parserId='unbound';},
    d=>{d.sourceLocationDocuments.pop();},d=>{delete d.support[0].sources[1].sourceLocation;},
    d=>{d.support[0].sources[1].sourceLocation.constructionOccurrenceIds=[20];},
    d=>{d.sourceLocationDocuments[1].sourceSets.push({id:2,sourceIds:[1]});},
    d=>{d.support[0].sources.pop();},d=>{d.sourceLocationVersion=2;},
  ];
  for(const [i,change] of changes.entries()){const f=mixedV3();change(f.evidence.result.result);assert.throws(f.project,undefined,'v3 mutation '+i);}
  const empty=mixedV3();empty.evidence.result.result.support=[];empty.evidence.result.result.sourceLocationDocuments=[];
  assert.equal(empty.project().axiomSourceLocationCoverage,'NOT_APPLICABLE');
});

test('shared tables retain JSON structure, reference and unique-range work limits',()=>{
  const f=fixture(),overNodes=[Array(15000).fill(null),Array(15000).fill(null)];
  assert.throws(()=>rdfAxiomLocationValidator([f.document],overNodes),error=>error.code==='INPUT_LIMIT'&&/structure budget/u.test(error.message));
  const many=fixture();many.table.sources=many.table.sources.filter(s=>s.id<=4);
  many.table.occurrences=Array.from({length:500},(_,i)=>({...many.table.occurrences[0],id:i+1}));
  const v=rdfAxiomLocationValidator([many.document],[many.table]),refs=many.table.occurrences.map(o=>o.id),l=location(refs,refs);
  assert.throws(()=>{for(let i=0;i<1001;i++)v.validate(many.document,l);},/reference budget/u);
  const raw='x'.repeat(8*1024*1024),large={...f.document,content:raw,digest:hashBytes(raw)};
  const table={...f.table,documentDigest:large.digest,sources:Array.from({length:10},(_,i)=>({id:i+1,kind:'TOKEN',start:i,end:raw.length,fragmentDigest:hashBytes(raw.slice(i)),startLine:1,endLine:1})),contexts:[],occurrences:[]};
  assert.throws(()=>rdfAxiomLocationValidator([large],[table]),/hashing budget/u);
});

test('v2 reuses Functional verification while retaining prefix, overlap and integrity rules',()=>{
  const f=fixture(),prefix='Prefix(:=<urn:test:>)',a='SubClassOf(:A :B)',b='SubClassOf(:B :C)',content=prefix+'\r\nOntology('+a+'\n'+b+')';
  const document={id:'functional',documentIri:'urn:functional:document',ontologyIri:null,versionIri:null,format:'functional',content,digest:hashBytes(content)};
  const group=axiom=>({schema:'ontology-axiom-source-location/v1',occurrences:[{fragments:[fragment(content,axiom)]}],context:[{kind:'PREFIX',...fragment(content,prefix)}]});
  const v=rdfAxiomLocationValidator([f.document,document],[f.table]);
  assert.deepEqual(v.functional(document,group(a)),group(a));assert.deepEqual(v.functional(document,group(b)),group(b));
  for(const l of f.locations)v.validate(f.document,l);v.finish();
  const duplicate=rdfAxiomLocationValidator([document],[]);duplicate.functional(document,group(a));
  assert.throws(()=>duplicate.functional(document,group(a)),/must not overlap/u,'Repeated Functional occurrence is rejected before another fragment hash');
  const bad=group(a);bad.occurrences[0].fragments[0].fragmentDigest=hash('unverified declaration');
  assert.throws(()=>rdfAxiomLocationValidator([document],[]).functional(document,bad),/digest differs from original bytes/u,'A budget reservation is never a verified digest');
  const wrongLine=group(a);wrongLine.occurrences[0].fragments[0].startLine=1;
  const lines=rdfAxiomLocationValidator([document],[]);lines.functional(document,wrongLine);
  assert.throws(()=>lines.finish(),/line number differs/u,'The unchanged Functional finish still validates original lines');
});

test('Functional preflight shares the RDF hash-work budget before the old verifier hashes fragments',()=>{
  // Roughly 5 MiB of original documents; nested ranges intentionally amplify
  // fragment work across the fixed 64 MiB ceiling without a large input/load.
  const raw='x'.repeat(3*1024*1024),rdf={id:'rdf',documentIri:'urn:rdf:document',ontologyIri:null,versionIri:null,format:'turtle',content:raw,digest:hashBytes(raw)};
  const axiom='SubClassOf(Annotation(<urn:note> "'+'x'.repeat(2*1024*1024)+'") <urn:A> <urn:B>)',content='Ontology('+axiom+')';
  const functional={id:'functional',documentIri:'urn:functional:document',ontologyIri:null,versionIri:null,format:'functional',content,digest:hashBytes(content)};
  const group={schema:'ontology-axiom-source-location/v1',occurrences:[{fragments:[fragment(content,axiom)]}],context:[]};
  function table(count){return {schema:'ontology-rdf-source-document/v1',documentId:rdf.id,documentDigest:rdf.digest,format:'turtle',parserId:'owlapi-turtle-occurrences:1',contexts:[],
    sources:Array.from({length:count},(_,i)=>({id:i+1,kind:'TOKEN',start:i,end:raw.length,fragmentDigest:hashBytes(raw.slice(i)),startLine:1,endLine:1})),
    occurrences:Array.from({length:count},(_,i)=>({id:i+1,triple:{subject:'urn:s',predicate:'urn:p',object:{kind:'RESOURCE',value:'urn:o'}},subject:term(i+1),predicate:term(i+1),object:term(i+1),generatedKind:null}))};}
  const admittedTable=table(20),admitted=rdfAxiomLocationValidator([rdf,functional],[admittedTable]);
  admitted.validate(rdf,location(admittedTable.occurrences.map(o=>o.id),[]));assert.deepEqual(admitted.functional(functional,group),group);admitted.finish();
  const over=rdfAxiomLocationValidator([rdf,functional],[table(21)]),wrongDigest=structuredClone(group);
  wrongDigest.occurrences[0].fragments[0].fragmentDigest=hash('would fail old integrity check');
  assert.throws(()=>over.functional(functional,wrongDigest),/hashing budget/u,'Shared preflight must refuse before the old fragment-integrity hash');
});
