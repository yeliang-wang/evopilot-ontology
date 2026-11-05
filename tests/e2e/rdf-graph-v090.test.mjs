import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createDLRunner} from '../../dist/reasoning/runner.js';
import {readDLToolchain} from '../../dist/reasoning/toolchain.js';
import {validateDLRequest} from '../../dist/reasoning/request.js';
import {hashBytes} from '../../dist/standalone/validation.js';
import {listenStandalone} from '../../dist/standalone/http.js';
import {fixture,definition,sourceSet,draft} from '../helpers/v090-native.mjs';

const XSD='http://www.w3.org/2001/XMLSchema#',RDF='http://www.w3.org/1999/02/22-rdf-syntax-ns#';
let base,runner,serial=0;
before(()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN,'Actual current graph-capable toolchain required; no skip or mock');
  const binding=readDLToolchain(process.env.EVOPILOT_TEST_DL_TOOLCHAIN);
  assert.equal(binding.workerSourceDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/Worker.java',import.meta.url))));
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-rdf-graph-')));const workRoot=join(base,'worker');mkdirSync(workRoot,{mode:0o700});
  runner=createDLRunner({toolchainFile:process.env.EVOPILOT_TEST_DL_TOOLCHAIN,workRoot});
});
after(()=>{if(base)rmSync(base,{recursive:true,force:true});});
function request(content,format='turtle',documentIri='https://graph.example/dir/model'){
  return {schema:'ontology-dl-request/v1',requestId:'graph-'+(++serial),closure:{rootDocumentId:'graph',documents:[{id:'graph',documentIri,ontologyIri:null,versionIri:null,format,content,digest:hashBytes(content)}],imports:[]},task:{kind:'rdfGraph',documentId:'graph'}};
}
async function graph(input){const value=await runner.run(input);assert.equal(value.status,'COMPLETED',JSON.stringify(value));assert.equal(value.complete,true);assert.equal(value.result.graphDigest,hashBytes(value.result.content));assert.equal(value.result.inferencePerformed,false);assert.equal(value.result.importsFollowed,false);return value.result;}
const lines=g=>g.content.trim().split('\n').sort();

test('Turtle graph output preserves lexical values, base resolution, blank nodes and duplicate elimination',async()=>{
  const input=request('@prefix xsd: <'+XSD+'> . <s> <p> "01"^^xsd:integer, "Hi"@EN, "a\\nb", _:a . _:a <p> <s> . <s> <p> "01"^^xsd:integer .');
  const g=await graph(input),p='<https://graph.example/dir/p>',s='<https://graph.example/dir/s>';
  assert.equal(g.statementCount,6);assert.equal(g.tripleCount,5);
  assert.deepEqual(lines(g),[s+' '+p+' "01"^^<'+XSD+'integer> .',s+' '+p+' "Hi"@en .',s+' '+p+' "a\\nb"^^<'+XSD+'string> .',s+' '+p+' _:b0 .','_:b0 '+p+' '+s+' .'].sort());
  assert.deepEqual(await graph(input),g);
});

test('RDF/XML callbacks expose the asserted graph with xml:base, language and node identity',async()=>{
  const input=request('<rdf:RDF xmlns:rdf="'+RDF+'" xmlns:ex="urn:graph:" xml:base="https://graph.example/base/" xml:lang="EN"><rdf:Description rdf:about="s"><ex:p rdf:nodeID="n"/><ex:p rdf:datatype="'+XSD+'integer">01</ex:p><ex:label>Hello</ex:label></rdf:Description><rdf:Description rdf:nodeID="n"><ex:p rdf:resource="s"/></rdf:Description></rdf:RDF>','rdfxml');
  const g=await graph(input),s='<https://graph.example/base/s>';
  assert.deepEqual(lines(g),[s+' <urn:graph:p> _:b0 .',s+' <urn:graph:p> "01"^^<'+XSD+'integer> .',s+' <urn:graph:label> "Hello"@en .','_:b0 <urn:graph:p> '+s+' .'].sort());
  assert.equal(g.tripleCount,4);assert.equal(g.inputFormat,'rdfxml');
});

test('RDF-valid graphs are inspectable independently of OWL datatype legality',async()=>{
  const input=request('@prefix owl: <http://www.w3.org/2002/07/owl#> . <urn:p> a owl:DatatypeProperty . <urn:s> <urn:p> "not-an-integer"^^<'+XSD+'integer> .');
  assert.equal((await graph(input)).tripleCount,2);
  const legality=await runner.run({...input,requestId:'legality-'+(++serial),task:{kind:'legality'}});
  assert.equal(legality.status,'INVALID_INPUT');assert.equal(legality.complete,false);
});

test('empty graphs and import statements do not fabricate inference or fetch dependencies',async()=>{
  const empty=await graph(request('# no triples\n'));assert.equal(empty.content,'');assert.equal(empty.tripleCount,0);
  const g=await graph(request('<urn:model> <http://www.w3.org/2002/07/owl#imports> <https://example.invalid/unbound> .'));
  assert.equal(g.tripleCount,1);assert.match(g.content,/example.invalid\/unbound/);
});

test('syntax failures return incomplete parse errors, and invalid task selection fails admission',async()=>{
  for(const [content,format] of [['<urn:s> <urn:p> .','turtle'],['<rdf:RDF xmlns:rdf="'+RDF+'"><rdf:Description','rdfxml']]){
    const result=await runner.run(request(content,format));assert.equal(result.status,'INVALID_INPUT',JSON.stringify(result));assert.equal(result.complete,false);assert.equal(result.error.code,'ONTOLOGY_PARSE');assert.equal(result.result.content,undefined);
  }
  const input=request('<urn:s> <urn:p> <urn:o> .');
  assert.throws(()=>validateDLRequest({...input,task:{kind:'rdfGraph',documentId:'absent'}}),{code:'INVALID_INPUT'});
  assert.throws(()=>validateDLRequest(request('Ontology()','functional')),{code:'INVALID_INPUT'});
});

test('public owner HTTP tasks retain graph results, exact original documents and receipts across restart',async t=>{
  const f=fixture(t),options={...f.setup,reasoning:{toolchainFile:process.env.EVOPILOT_TEST_DL_TOOLCHAIN,workRoot:f.workRoot}};
  let server=await listenStandalone(options);t.after(()=>server.close());
  const call=async(operation,input={},requestId,revision)=>{
    const response=await fetch(server.origin+'/v1/request',{method:'POST',headers:{authorization:'Bearer '+f.token,'content-type':'application/json'},body:JSON.stringify(requestId===undefined?f.read(operation,input):f.write(operation,input,requestId,revision))});
    const body=await response.json();assert.equal(body.ok,true,JSON.stringify(body));return body.result;
  };
  await call('project.create',{label:'Graph inspection'},'create',0);
  const intent=(await call('intent.record',{definition,previousDigest:null},'intent',1)).result.intentDigest;
  const source=(await call('source.admit',{intentDigest:intent,sourceSet},'source',2)).result.sourceSetDigest;
  const authored=draft(intent,source,'<urn:s> <urn:p> "original" .');authored.closure.documents[0].ontologyIri=null;
  const model=(await call('model.record',{draft:authored},'model',3)).result.modelDigest;
  const input={assetId:'services',modelDigest:model,task:{kind:'rdfGraph',documentId:'model'}};
  const receipt=await call('reasoning.start',input,'graph-start',4);assert.ok(receipt.result.taskId);
  let task;const end=Date.now()+10000;
  do{task=await call('reasoning.inspect',{taskId:receipt.result.taskId});if(task.state==='FINISHED')break;await delay(25);}while(Date.now()<end);
  assert.equal(task.state,'FINISHED');assert.equal(task.result.status,'COMPLETED');
  assert.equal(task.result.result.content,'<urn:s> <urn:p> "original"^^<'+XSD+'string> .\n');
  await server.close();server=await listenStandalone(options);
  assert.deepEqual(await call('receipt.read',{requestId:'graph-start'}),receipt);
  assert.deepEqual(await call('reasoning.inspect',{taskId:receipt.result.taskId}),task);
  const original=await call('model.document.read',{assetId:'services',modelDigest:model,documentId:'model',offset:0,maxBytes:65536});assert.equal(original.content,authored.closure.documents[0].content);
});

test('Turtle original strings decode all ECHARs and UCHARs once and reject illegal escapes',async()=>{
  const cases=[
    [String.raw`"a\tb\bc\nd\re\f\"\'\\"`,"a\tb\bc\nd\re\f\"'\\"],
    [String.raw`"\u0041\U0001F600"`,'A😀'],
    [String.raw`"\\u0041"`,String.raw`\u0041`],
    ["'''first\nsecond'''",'first\nsecond'],
  ];
  for(const [source,expected] of cases){
    const g=await graph(request('<urn:s> <urn:p> '+source+' .'));
    assert.equal(g.content,'<urn:s> <urn:p> '+JSON.stringify(expected)+'^^<'+XSD+'string> .\n');
  }
  for(const source of [String.raw`"bad\q"`,String.raw`"\U00110000"`,String.raw`"\uD800"`]){
    const result=await runner.run(request('<urn:s> <urn:p> '+source+' .'));
    assert.equal(result.status,'INVALID_INPUT',source+' '+JSON.stringify(result));assert.equal(result.complete,false);
  }
});
