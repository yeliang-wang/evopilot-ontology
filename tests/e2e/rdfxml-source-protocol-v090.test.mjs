import test from 'node:test';
import assert from 'node:assert/strict';
import {rdfxmlAxiomLocationValidator} from '../../dist/native-v2/rdfxml-axiom-locations.js';
import {rdfAxiomLocationValidator,rdfLocationBudget,RDF_LOCATION_LIMITS} from '../../dist/native-v2/rdf-axiom-locations.js';
import {hashBytes} from '../../dist/standalone/validation.js';

// SYNTHETIC PROTOCOL FIXTURES ONLY. These tables establish byte/reference
// integrity checks, not XML parsing, RDF callback fidelity or OWL attribution.
// Actual parser evidence belongs to a separately bound native worker suite.
function fragment(content,text,from=0){
  const at=content.indexOf(text,from);assert.ok(at>=0,text);const end=at+text.length;
  const line=offset=>content.slice(0,offset).replace(/\r$/u,content[offset]==='\n'?'':'\r').split(/\r\n|\r|\n/u).length;
  return {start:Buffer.byteLength(content.slice(0,at)),end:Buffer.byteLength(content.slice(0,end)),fragmentDigest:hashBytes(text),startLine:line(at),endLine:line(end-Array.from(text).at(-1).length)};
}
const term=(sourceSetId,contextIds=[],extra={})=>({sourceSetId,inherited:false,generated:false,contextIds,...extra});
const location=(constructionOccurrenceIds=[10],parserContextOccurrenceIds=[20])=>({schema:'ontology-axiom-source-location/v2',kind:'RDF_CONSTRUCTION',constructionOccurrenceIds,parserContextOccurrenceIds});
function fixture(){
  const content='\uFEFF<?xml version="1.0"?>\r\n<!DOCTYPE r [<!ENTITY word "λ"><!ATTLIST r xml:lang CDATA "">]>\r<r xmlns="urn:r:" xmlns:ex="urn:ex:" xml:base="../" xml:lang="en">\n <ex:p about="𐐀">A&amp;<![CDATA[β]]>&word;</ex:p>\r\n</r>';
  const document={id:'xml',documentIri:'https://example.test/base/input.rdf',ontologyIri:null,versionIri:null,format:'rdfxml',content,digest:hashBytes(content)};
  const source=(id,kind,text,from=0)=>({id,kind,...fragment(content,text,from)});
  const context=(id,kind,name,resolved,sourceSetId,dependencyContextIds=[])=>({id,kind,name,resolved,sourceSetId,dependencyContextIds});
  const table={schema:'ontology-rdfxml-source-document/v1',documentId:document.id,documentDigest:document.digest,format:'rdfxml',parserId:'owlapi-rdfxml-occurrences:1',
    sources:[source(1,'ELEMENT_NAME','r',content.indexOf('<r ')),source(2,'NAMESPACE','xmlns:ex="urn:ex:"'),source(3,'XML_BASE','xml:base="../"'),source(4,'XML_LANG','xml:lang="en"'),source(5,'ATTRIBUTE','about="𐐀"'),source(6,'ELEMENT_NAME','ex:p'),source(7,'TEXT','A',content.indexOf('<ex:p')),source(8,'ENTITY_REFERENCE','&amp;'),source(9,'CDATA','<![CDATA[β]]>'),source(10,'ENTITY_REFERENCE','&word;'),source(11,'ENTITY_DECLARATION','<!ENTITY word "λ">'),source(12,'DTD_ATTRIBUTE_DECLARATION','<!ATTLIST r xml:lang CDATA "">'),source(13,'ELEMENT','<ex:p about="𐐀">A&amp;<![CDATA[β]]>&word;</ex:p>'),source(14,'NAMESPACE','xmlns="urn:r:"')],
    sourceSets:[{id:1,sourceIds:[5]},{id:2,sourceIds:[6]},{id:3,sourceIds:[7,8,9,10]},{id:4,sourceIds:[2]},{id:5,sourceIds:[3]},{id:6,sourceIds:[4]},{id:7,sourceIds:[11]},{id:8,sourceIds:[10,11]},{id:9,sourceIds:[12]},{id:10,sourceIds:[13]},{id:11,sourceIds:[14]},{id:12,sourceIds:[1]},{id:13,sourceIds:[8]}],
    contexts:[context(1,'DOCUMENT',null,document.documentIri,0),context(2,'BUILTIN','xml','http://www.w3.org/XML/1998/namespace',0),context(3,'NAMESPACE','ex','urn:ex:',4,[1]),context(4,'XML_BASE',null,'https://example.test/',5,[1]),context(5,'XML_LANG',null,'en',6,[2]),context(6,'ENTITY_DECLARATION','word',null,7),context(7,'ENTITY_REFERENCE','word',null,8,[6]),context(8,'DTD_ATTRIBUTE_DECLARATION','r@xml:lang','CDATA',9,[2]),context(9,'DTD_ATTRIBUTE_DEFAULT','r@xml:lang','',9,[8]),context(10,'RDF_LI_ORDER',null,'1',10),context(11,'REIFICATION_ORDER',null,'2',12),context(12,'NAMESPACE','','urn:r:',11,[1]),context(13,'ENTITY_REFERENCE','amp',null,13)],
    occurrences:[{id:10,triple:{subject:'https://example.test/𐐀',predicate:'urn:ex:p',object:{kind:'LITERAL',lexical:'A&βλ',language:'en',datatype:'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString'}},subject:term(1,[4,12]),predicate:term(2,[3]),object:term(3,[5,7,9,13],{generated:true}),generatedKind:'ENTITY_EXPANSION'},
      {id:20,triple:{subject:'_:generated',predicate:'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',object:{kind:'RESOURCE',value:'urn:ex:Generated'}},subject:term(10,[10,11],{generated:true,inherited:true}),predicate:term(12,[2],{generated:true}),object:term(2),generatedKind:'TYPED_NODE'}]};
  return {document,table,locations:[location(),location([20],[10,20])]};
}
function validate(f,budget){const v=rdfxmlAxiomLocationValidator([f.document],[f.table],budget);for(const l of f.locations)assert.deepEqual(v.validate(f.document,l),l);v.finish();return v;}

test('synthetic XML protocol retains exact Unicode bytes, overlapping fragments, interned sets, roles and context DAG',()=>{
  const f=fixture(),before=JSON.stringify(f),v=validate(f);assert.deepEqual(v.tables,[f.table]);assert.equal(JSON.stringify(f),before);
  assert.equal(f.table.sources[4].end-f.table.sources[4].start,12);assert.equal(f.table.sources[4].startLine,4);
  const whole=f.table.sources[12],attribute=f.table.sources[4];assert.ok(whole.start<attribute.start&&whole.end>attribute.end);
  assert.throws(()=>v.finish(),/finished/u);assert.throws(()=>v.validate(f.document,f.locations[0]),/finished/u);
  const sparse=fixture();sparse.table.sources[4].id=900000;
  for(const set of sparse.table.sourceSets)set.sourceIds=set.sourceIds.map(id=>id===5?900000:id).sort((a,b)=>a-b);
  sparse.table.sources.sort((a,b)=>a.id-b.id);validate(sparse);
});

test('XML callback literals may carry language and datatype together; reset contexts and generated kinds remain representable',()=>{
  const kinds=['TYPED_NODE','PROPERTY_ATTRIBUTE','PARSE_TYPE_RESOURCE','COLLECTION_FIRST','COLLECTION_REST','COLLECTION_TYPE','RDF_LI','REIFICATION','ENTITY_EXPANSION','PARSE_TYPE_LITERAL','REIFICATION_BAG'];
  for(const kind of kinds){const f=fixture();f.table.occurrences[0].generatedKind=kind;validate(f);}
  for(const name of ['word','%parameter','#65','#x41','amp']){const f=fixture();f.table.contexts[6].name=name;validate(f);}
  const f=fixture();f.table.contexts[2].resolved='';f.table.contexts[4].resolved='';f.table.contexts[8].resolved='';
  f.table.contexts[3].resolved='nonempty-base-shape-only'; // This verifier does not implement an IRI/parser oracle.
  f.table.occurrences[0].triple.object.lexical='';validate(f);
  const long=fixture();long.table.occurrences[0].triple.subject='urn:'+('x'.repeat(5000));validate(long);
});

test('document identity, exact source bytes, UTF-8 boundaries and inclusive CRLF line claims cannot be forged',()=>{
  const mutations=[
    f=>{f.table.documentId='foreign';},f=>{f.table.documentDigest=hashBytes('different');},f=>{f.table.format='turtle';},f=>{f.table.parserId='unlocked';},f=>{f.table.schema='ontology-rdf-source-document/v1';},
    f=>{f.document.content+=' ';},f=>{f.document.digest=hashBytes('unrelated');},f=>{f.table.sources[4].fragmentDigest=hashBytes('false');},
    f=>{const raw=Buffer.from(f.document.content);f.table.sources[4].start=raw.indexOf(Buffer.from('𐐀'))+1;},f=>{const raw=Buffer.from(f.document.content);f.table.sources[4].end=raw.indexOf(Buffer.from('𐐀'))+2;},
    f=>{f.table.sources[4].end=f.table.sources[4].start;},f=>{f.table.sources[4].start=-1;},f=>{f.table.sources[4].end=Infinity;},f=>{f.table.sources[4].end=Buffer.byteLength(f.document.content)+1;},
    f=>{f.table.sources[4].startLine++;},f=>{f.table.sources[4].endLine--;},f=>{f.table.sources[0].startLine=2;},f=>{f.table.sources[0].endLine=2;},
    f=>{f.table.sources[0].kind='TOKEN';},f=>{f.table.sources[0].extra=true;},f=>{f.table.sources[0].id=0;},f=>{f.table.sources.reverse();},
  ];
  for(const [i,mutate] of mutations.entries()){const f=fixture();mutate(f);assert.throws(()=>validate(f),undefined,'XML bytes mutation '+i);}
});

test('source-set interning and same-document reference closure reject missing, duplicate and unused members',()=>{
  const mutations=[
    f=>{f.table.sourceSets[0].sourceIds=[];},f=>{f.table.sourceSets[0].sourceIds=[0];},f=>{f.table.sourceSets[0].sourceIds=[999];},f=>{f.table.sourceSets[0].sourceIds=[5,5];},
    f=>{f.table.sourceSets[2].sourceIds.reverse();},f=>{f.table.sourceSets[0].id=0;},f=>{f.table.sourceSets.reverse();},f=>{f.table.sourceSets[1].id=1;},
    f=>{f.table.sourceSets.push({id:999,sourceIds:[5]});},f=>{f.table.sourceSets.push({id:999,sourceIds:[1,2]});},
    f=>{f.table.sources.push({...f.table.sources[0],id:999});},f=>{f.table.contexts.push({...f.table.contexts[2],id:999});},
    f=>{f.table.occurrences.push({...f.table.occurrences[0],id:99});},f=>{f.table.occurrences[0].subject.sourceSetId=0;},f=>{f.table.occurrences[0].subject.sourceSetId=999;},
    f=>{f.table.occurrences[0].subject.contextIds=[999];},f=>{f.table.occurrences[0].subject.contextIds=[4,4];},
    f=>{f.locations[0].constructionOccurrenceIds=[];},f=>{f.locations[0].constructionOccurrenceIds=[20,10];},f=>{f.locations[0].parserContextOccurrenceIds=[20,20];},f=>{f.locations[0].constructionOccurrenceIds=[99];},
  ];
  for(const [i,mutate] of mutations.entries()){const f=fixture();mutate(f);assert.throws(()=>validate(f),undefined,'XML reference mutation '+i);}
  const f=fixture(),other={...f.document,id:'other'};const v=rdfxmlAxiomLocationValidator([f.document,other],[f.table]);
  assert.throws(()=>v.validate(other,f.locations[0]),undefined,'Occurrence IDs cannot cross an original document identity');
  assert.throws(()=>rdfxmlAxiomLocationValidator([f.document],[f.table,f.table]));
  const unused=rdfxmlAxiomLocationValidator([f.document],[f.table]);assert.throws(()=>unused.finish());
});

test('context shapes and earlier-ID dependencies reject forged implicit or unsupported environments',()=>{
  const mutations=[
    f=>{f.table.contexts[0].name='x';},f=>{f.table.contexts[0].resolved='urn:foreign';},f=>{f.table.contexts[0].sourceSetId=1;},f=>{f.table.contexts[0].dependencyContextIds=[2];},
    f=>{f.table.contexts[1].name='xml:';},f=>{f.table.contexts[1].resolved='urn:foreign';},f=>{f.table.contexts[1].sourceSetId=1;},
    f=>{f.table.contexts[2].sourceSetId=0;},f=>{f.table.contexts[2].sourceSetId=999;},f=>{f.table.contexts[2].name=null;},
    f=>{f.table.contexts[3].name='base';},f=>{f.table.contexts[3].resolved='';},f=>{f.table.contexts[4].name='lang';},f=>{f.table.contexts[4].resolved=null;},
    f=>{f.table.contexts[5].name=null;},f=>{f.table.contexts[5].resolved='expanded text';},f=>{f.table.contexts[6].resolved='λ';},
    f=>{f.table.contexts[7].name=null;},f=>{f.table.contexts[7].resolved='';},f=>{f.table.contexts[8].resolved=null;},
    f=>{f.table.contexts[9].name='li';},f=>{f.table.contexts[9].resolved='0';},f=>{f.table.contexts[10].resolved='1.5';},
    f=>{f.table.contexts[6].dependencyContextIds=[7];},f=>{f.table.contexts[6].dependencyContextIds=[999];},f=>{f.table.contexts[6].dependencyContextIds=[6,6];},
    f=>{f.table.contexts[6].dependencyContextIds=[6,1];},f=>{f.table.contexts[6].kind='EXTERNAL_ENTITY';},f=>{f.table.contexts.push({...f.table.contexts[0],id:99});},
  ];
  for(const [i,mutate] of mutations.entries()){const f=fixture();mutate(f);assert.throws(()=>validate(f),undefined,'XML context mutation '+i);}
});

test('triple and term metadata are scalar, exact and bounded without claiming reconstruction of XML semantics',()=>{
  const mutations=[
    f=>{f.table.occurrences[0].triple.subject='\uD800';},f=>{f.table.occurrences[0].triple.predicate='';},f=>{f.table.occurrences[0].triple.object.lexical='\uDFFF';},
    f=>{f.table.occurrences[0].triple.object.language=3;},f=>{f.table.occurrences[0].triple.object.datatype={};},f=>{f.table.occurrences[1].triple.object.value='';},
    f=>{f.table.occurrences[0].triple.object={kind:'UNKNOWN',value:'x'};},f=>{f.table.occurrences[0].triple.object.value='extraneous';},
    f=>{f.table.occurrences[0].subject.inherited=1;},f=>{f.table.occurrences[0].object.generated='yes';},f=>{f.table.occurrences[0].subject.sourceId=1;},
    f=>{f.table.occurrences[0].generatedKind='GUESS';},f=>{f.table.occurrences[0].object.generated=false;},f=>{f.table.occurrences[0].extra=true;},
  ];
  for(const [i,mutate] of mutations.entries()){const f=fixture();mutate(f);assert.throws(()=>validate(f),undefined,'XML metadata mutation '+i);}
  const f=fixture();assert.throws(()=>rdfxmlAxiomLocationValidator([f.document],[Array(15000).fill(null),Array(15000).fill(null)]),/budget/u);
});

function tinyTurtle(){
  const content='x',document={id:'turtle',documentIri:'urn:turtle',ontologyIri:null,versionIri:null,format:'turtle',content,digest:hashBytes(content)};
  return {document,table:{schema:'ontology-rdf-source-document/v1',documentId:document.id,documentDigest:document.digest,format:'turtle',parserId:'owlapi-turtle-occurrences:1',sources:[{id:1,kind:'TOKEN',...fragment(content,'x')}],contexts:[],occurrences:[{id:1,triple:{subject:'urn:s',predicate:'urn:p',object:{kind:'RESOURCE',value:'urn:o'}},subject:{sourceId:1,inherited:false,generated:false,contextIds:[]},predicate:{sourceId:1,inherited:false,generated:false,contextIds:[]},object:{sourceId:1,inherited:false,generated:false,contextIds:[]},generatedKind:null}]}};
}
test('shared record/reference reservations survive switching between Turtle and XML validators',()=>{
  for(const kind of ['record','reference']){
    const shared=rdfLocationBudget(),charged={record:0,reference:0};
    const budget={...shared,record(n=1){charged.record+=n;shared.record(n);},reference(n=1){charged.reference+=n;shared.reference(n);}};
    const t=tinyTurtle(),tv=rdfAxiomLocationValidator([t.document],[t.table],budget);tv.validate(t.document,location([1],[]));tv.finish();
    const maximum=kind==='record'?RDF_LOCATION_LIMITS.records:RDF_LOCATION_LIMITS.references;
    budget[kind](maximum-charged[kind]);const f=fixture();
    assert.throws(()=>validate(f,budget),/budget/u,kind+' cap is shared across formats');
  }
  const f=fixture(),b=rdfLocationBudget();validate(f,b);
  const other={...f.document,content:f.document.content+' ',digest:hashBytes(f.document.content+' ')};
  const table={...f.table,documentDigest:other.digest};assert.throws(()=>rdfxmlAxiomLocationValidator([other],[table],b),/identity/u);
});

test('shared hash-work budget refuses XML spans before hashing a forged fragment after Turtle reservations',()=>{
  const raw='x'.repeat(2*1024*1024),t=tinyTurtle();t.document.content=raw;t.document.digest=hashBytes(raw);t.table.documentDigest=t.document.digest;
  t.table.sources=Array.from({length:31},(_,i)=>({id:i+1,kind:'TOKEN',start:i,end:raw.length,fragmentDigest:hashBytes(raw.slice(i)),startLine:1,endLine:1}));
  t.table.occurrences=Array.from({length:31},(_,i)=>({...t.table.occurrences[0],id:i+1,subject:{...t.table.occurrences[0].subject,sourceId:i+1}}));
  const shared=rdfLocationBudget(),tv=rdfAxiomLocationValidator([t.document],[t.table],shared);tv.validate(t.document,location(t.table.occurrences.map(o=>o.id),[]));tv.finish();
  const content='x'.repeat(3*1024*1024),document={id:'large-xml',documentIri:'urn:large:xml',ontologyIri:null,versionIri:null,format:'rdfxml',content,digest:hashBytes(content)};
  const table={schema:'ontology-rdfxml-source-document/v1',documentId:document.id,documentDigest:document.digest,format:'rdfxml',parserId:'owlapi-rdfxml-occurrences:1',sources:[{id:1,kind:'TEXT',start:0,end:content.length,fragmentDigest:hashBytes('forged'),startLine:1,endLine:1}],sourceSets:[],contexts:[],occurrences:[]};
  assert.throws(()=>rdfxmlAxiomLocationValidator([document],[table],shared),/hashing budget/u,'The shared preflight must reject before checking the forged XML fragment digest');
});
