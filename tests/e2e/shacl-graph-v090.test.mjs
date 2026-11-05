import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createSHACLRunner} from '../../dist/native-v2/shacl-runner.js';
import {validateSHACLGraphRequest} from '../../dist/native-v2/shacl-graph-request.js';
import {hashBytes} from '../../dist/standalone/validation.js';
import {listenStandalone} from '../../dist/standalone/http.js';
import {fixture,definition,sourceSet,draft} from '../helpers/v090-native.mjs';
import {request,data,shapes,prefixes} from '../fixtures/v090/shacl.mjs';
const binding=process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN;
test.before(()=>assert(binding,'Actual graph-capable SHACL toolchain is required; no mocks or skip'));
function graphRequest(text=data,shapeText=shapes){const {expectations:_,...r}=request(text,shapeText);return {...r,schema:'ontology-shacl-graph-request/v2'};}
function runner(t){const workRoot=realpathSync(mkdtempSync(join(tmpdir(),'shacl-graph-')));t.after(()=>rmSync(workRoot,{recursive:true,force:true}));return createSHACLRunner({toolchainFile:binding,workRoot});}
function completed(r,status){assert.equal(r.status,status,JSON.stringify(r));assert.equal(r.complete,true);assert.equal(r.expectationsDigest,null);assert.equal(r.result.validationScope,'GRAPH_ONLY');assert.equal(r.result.coverage,null);assert.match(r.result.reportTurtle,/conforms/);}
test('raw SHACL semantics retain anonymous, empty-target and disabled shapes without passing lifecycle coverage',async t=>{
 const run=runner(t);
 for(const [text,shapeText,coverageCode] of [[data.replace('a :Service','a :Other'),shapes,'EMPTY_REQUIRED_TARGET'],[data,shapes.replace('sh:targetClass','sh:deactivated true ; sh:targetClass'),'DEACTIVATED_SHAPE']]){
  completed(await run.runGraph(graphRequest(text,shapeText)),'CONFORMS');
  const required=await run.run(request(text,shapeText));assert.equal(required.status,'INCOMPLETE_COVERAGE');assert.equal(required.error.code,coverageCode);
 }
 completed(await run.runGraph(graphRequest(data,shapes.replaceAll(':ServiceShape','_:shape'))),'CONFORMS');
 completed(await run.runGraph(graphRequest(data.replace(' ; :owner "operations"',''),shapes.replaceAll(':ServiceShape','_:shape'))),'NONCONFORMING');
});
test('graph inspection preserves lexical terms and strict separate request identities',async t=>{
 const run=runner(t),g=graphRequest(prefixes+':value :p "01"^^xsd:integer .',prefixes+'[] a sh:NodeShape ; sh:targetObjectsOf :p ; sh:minLength 2 .');g.view.closure.documents[0].ontologyIri=null;
 completed(await run.runGraph(g),'CONFORMS');
 assert.throws(()=>validateSHACLGraphRequest({...g,expectations:request().expectations}),{code:'SHACL_SCHEMA'});
 const bad=structuredClone(g);bad.shapes[0].digest=hashBytes('wrong');assert.throws(()=>validateSHACLGraphRequest(bad),{code:'DIGEST_MISMATCH'});
});
test('standards-defined validation failures stay distinct from parse failures, unsupported extensions and cancellation',async t=>{
 const run=runner(t),shape=prefixes+':ServiceShape a sh:NodeShape ; sh:targetClass :Service ; sh:sparql [ sh:select "SELECT $this WHERE { VALUES ?x { true } }" ] .';
 const failure=await run.runGraph(graphRequest(data,shape));assert.equal(failure.status,'VALIDATION_FAILURE');assert.equal(failure.complete,false);assert.equal(failure.error.code,'SHACL_VALIDATION_FAILURE');
 assert.equal((await run.runGraph(graphRequest('not valid Turtle'))).status,'INVALID_INPUT');
 assert.equal((await run.runGraph(graphRequest(data,shapes+' :ServiceShape sh:rule [] .'))).status,'UNSUPPORTED');
 const c=new AbortController();c.abort();assert.equal((await run.runGraph(graphRequest(),{signal:c.signal})).status,'CANCELLED');
});
test('public HTTP graph task retains exact reports and receipts across restart and cannot serve as business validation',async t=>{
 const f=fixture(t),shaclWork=join(f.base,'shacl');mkdirSync(shaclWork,{mode:0o700});
 const setup={...f.setup,validation:{toolchainFile:binding,workRoot:shaclWork}};let http=await listenStandalone(setup);t.after(()=>http.close());
 const post=async value=>{const res=await fetch(http.origin+'/v1/request',{method:'POST',headers:{authorization:'Bearer '+f.token,'content-type':'application/json'},body:JSON.stringify(value)});return {status:res.status,body:await res.json()};};
 const ok=async value=>{const r=await post(value);assert.equal(r.status,200,JSON.stringify(r.body));return r.body.result;};
 await ok(f.write('project.create',{label:'SHACL inspection'},'project',0));
 const i=(await ok(f.write('intent.record',{definition,previousDigest:null},'intent',1))).result.intentDigest;
 const s=(await ok(f.write('source.admit',{intentDigest:i,sourceSet},'sources',2))).result.sourceSetDigest;
 const model=draft(i,s);model.shapes=graphRequest().shapes;
 const m=(await ok(f.write('model.record',{draft:model},'model',3))).result.modelDigest;
 const start=f.write('shacl.start',{assetId:'services',modelDigest:m},'graph',4),receipt=await ok(start);let result;
 for(let n=0;n<1000;n++){result=await ok(f.read('shacl.inspect',{taskId:receipt.result.taskId}));if(result.state==='FINISHED')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(result.kind,'shacl');assert.equal(result.complete,true,JSON.stringify(result));assert.equal(result.result.expectationsDigest,null);assert.equal(result.result.result.validationScope,'GRAPH_ONLY');assert.equal(result.formalStatus,'NONCONFORMING');
 assert.equal((await post(f.read('validation.inspect',{taskId:receipt.result.taskId}))).status,404);
 assert.notEqual((await post(f.write('validation.start',{assetId:'services',modelDigest:m},'suite',5))).status,200);
 let text='',offset=0;for(;;){const page=await ok(f.read('shacl.result.read',{taskId:receipt.result.taskId,offset,maxBytes:257}));text+=page.content;if(page.complete)break;offset=page.nextOffset;}
 assert.deepEqual(JSON.parse(text),result.result);
 await http.close();http=await listenStandalone(setup);assert.deepEqual(await ok(start),receipt);assert.equal((await ok(f.read('shacl.inspect',{taskId:receipt.result.taskId}))).resultDigest,result.resultDigest);
});

test('same original graph used in both roles preserves shared blank nodes and refuses conflicting identities',async t=>{
 const run=runner(t),text=prefixes+'_:x :p "value" . [] a sh:NodeShape ; sh:targetNode _:x ; sh:property [ sh:path :p ; sh:minCount 1 ] .',g=graphRequest(text,text);g.view.closure.documents[0].ontologyIri=null;g.shapes[0].ontologyIri=null;g.shapes[0].documentIri=g.view.closure.documents[0].documentIri;
 completed(await run.runGraph(g),'CONFORMS');const conflict=structuredClone(g);conflict.shapes[0].content+=' ';conflict.shapes[0].digest=hashBytes(conflict.shapes[0].content);assert.throws(()=>validateSHACLGraphRequest(conflict),{code:'SHACL_SCHEMA'});
});
test('literal uniqueLang activation and malformed literal report bytes preserve RDF terms',async t=>{
 const run=runner(t),text=prefixes+':x :p "a"@en, "b"@en .',shape=prefixes+'[] a sh:PropertyShape ; sh:targetNode :x ; sh:path :p ; sh:uniqueLang "1"^^xsd:boolean .';
 const g=graphRequest(text,shape);g.view.closure.documents[0].ontologyIri=null;completed(await run.runGraph(g),'CONFORMS');
 const active=graphRequest(text,shape.replace('"1"^^xsd:boolean','true'));active.view.closure.documents[0].ontologyIri=null;completed(await run.runGraph(active),'NONCONFORMING');
 const ill=graphRequest(prefixes+':x :p "none"^^xsd:boolean .',prefixes+'[] a sh:PropertyShape ; sh:targetNode :x ; sh:path :p ; sh:datatype xsd:string .');ill.view.closure.documents[0].ontologyIri=null;
 const result=await run.runGraph(ill);completed(result,'NONCONFORMING');assert.match(result.result.reportTurtle,/<http:\/\/www\.w3\.org\/ns\/shacl#value> "none"\^\^<http:\/\/www\.w3\.org\/2001\/XMLSchema#boolean>/);
});

test('local prefix imports are traversed without fetching and preserve the exact graph documents',async t=>{
 const run=runner(t),shape=prefixes+':root owl:imports :decls . :decls sh:declare [ sh:prefix "d" ; sh:namespace "urn:demo:"^^xsd:anyURI ] . :ServiceShape a sh:NodeShape ; sh:targetNode :svc ; sh:sparql [ sh:prefixes :root ; sh:select '+JSON.stringify('SELECT $this WHERE { $this d:owner ?v . FILTER (?v = "operations") }')+' ] .';
 const g=graphRequest(data,shape),before=structuredClone(g);completed(await run.runGraph(g),'NONCONFORMING');assert.deepEqual(g,before);
 const required=await run.run(request(data,shape));assert.equal(required.status,'MISSING_IMPORT');assert.equal(required.error.code,'SHAPE_IMPORT_UNBOUND');
});
