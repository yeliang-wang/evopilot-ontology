import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,readFileSync,writeFileSync,mkdirSync,symlinkSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createSHACLRunner} from '../../dist/native-v2/shacl-runner.js';
import {readSHACLToolchain,verifySHACLToolchain} from '../../dist/native-v2/shacl-toolchain.js';
import {inventory} from '../../dist/reasoning/toolchain.js';
import {readWorkerAttempt} from '../../dist/installation/worker-journal.js';
import {validateSHACLRequest,shaclIdentities} from '../../dist/native-v2/shacl-request.js';
import {hash,hashBytes} from '../../dist/standalone/validation.js';
import {request,document,prefixes,data,shapes} from '../fixtures/v090/shacl.mjs';
const binding=process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN;
test.before(()=>assert(binding,'Actual independently installed v2 SHACL worker required; no skip or mock'));
function runner(t){const root=realpathSync(mkdtempSync(join(tmpdir(),'ontology-shacl-v2-')));t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,run:createSHACLRunner({toolchainFile:binding,workRoot:root}).run};}
function expect(result,status){assert.equal(result.status,status,JSON.stringify(result));assert.equal(result.complete,['CONFORMS','NONCONFORMING'].includes(status));}
test('actual SHACL Core preserves exact asserted-view identities and reports both conformance and violations',async t=>{
 const r=runner(t),input=request(),ok=await r.run(input);expect(ok,'CONFORMS');
 assert.equal(ok.requestDigest,shaclIdentities(input).requestDigest);assert.equal(ok.viewDigest,shaclIdentities(input).viewDigest);assert.equal(ok.result.viewKind,'asserted');assert.equal(ok.result.coverage[0].actualFocusNodes[0],'<urn:demo:svc>');assert.match(ok.result.reportTurtle,/conforms true/);
 const missing=request(data.replace(' ; :owner "operations"','')),bad=await r.run(missing);expect(bad,'NONCONFORMING');assert.notEqual(ok.viewDigest,bad.viewDigest);assert(bad.result.results.some(r=>r.properties.some(p=>p.object==='<http://www.w3.org/ns/shacl#MinCountConstraintComponent>')));
 const datatype=await r.run(request(data.replace('"operations"','42')));expect(datatype,'NONCONFORMING');assert(datatype.result.results.some(r=>r.properties.some(p=>p.object==='<http://www.w3.org/ns/shacl#DatatypeConstraintComponent>')));
});
test('missing, disabled, empty and narrowed required targets never become empty conformance',async t=>{
 const r=runner(t);
 for(const [text,shapeText,code] of [
  [data,shapes.replace(':ServiceShape',':OtherShape'),'REQUIRED_SHAPE_MISSING'],
  [data,shapes.replace('sh:targetClass', 'sh:deactivated true ; sh:targetClass'),'DEACTIVATED_SHAPE'],
  [data,shapes.replace('sh:path', 'sh:deactivated true ; sh:path'),'DEACTIVATED_SHAPE'],
  [data.replace('a :Service','a :Other'),shapes,'EMPTY_REQUIRED_TARGET'],
  [data.replaceAll(':svc',':other'),shapes,'REQUIRED_TARGET_MISSING'],
  [data,shapes+'\n:Undeclared a sh:NodeShape ; sh:targetNode :svc .','UNREGISTERED_TARGET_SHAPE'],
 ]){const result=await r.run(request(text,shapeText));expect(result,'INCOMPLETE_COVERAGE');assert.equal(result.error.code,code);}
});
test('OWL axioms are allowed in the data graph but do not manufacture required SHACL values',async t=>{
 const r=runner(t),text=prefixes+'<urn:model> a owl:Ontology . :Service a owl:Class ; <http://www.w3.org/2000/01/rdf-schema#subClassOf> [ a owl:Restriction ; owl:onProperty :owner ; owl:someValuesFrom xsd:string ] . :svc a :Service .';
 expect(await r.run(request(text)),'NONCONFORMING');
 const implied=prefixes+'<urn:model> a owl:Ontology . :Service a owl:Class . :Other owl:equivalentClass :Service . :svc a :Other ; :owner "operations" .';
 expect(await r.run(request(implied)),'INCOMPLETE_COVERAGE');
});
test('native target discovery includes subclass instances and implicit class targets',async t=>{
 const r=runner(t),text=data.replace('a :Service','a :Special')+' :Special <http://www.w3.org/2000/01/rdf-schema#subClassOf> :Service .';
 expect(await r.run(request(text)),'CONFORMS');
 const input=request(data,shapes.replace(':ServiceShape a sh:NodeShape ; sh:targetClass :Service',':Service a sh:NodeShape, <http://www.w3.org/2000/01/rdf-schema#Class>'));
 input.expectations.requiredShapes[0].shapeIri='urn:demo:Service';input.expectations.digest=hash(input.expectations.requiredShapes);expect(await r.run(input),'CONFORMS');
});
test('bounded local SHACL-SPARQL actually evaluates its SELECT constraint',async t=>{
 const r=runner(t),shape=prefixes+':ServiceShape a sh:NodeShape ; sh:targetClass :Service ; sh:sparql [ sh:select "SELECT $this WHERE { FILTER NOT EXISTS { $this <urn:demo:owner> ?owner } }" ] .';
 expect(await r.run(request(data,shape)),'CONFORMS');expect(await r.run(request(data.replace(' ; :owner "operations"',''),shape)),'NONCONFORMING');
});
test('standard group metadata and SPARQL prefix declarations remain valid',async t=>{
 const r=runner(t),shape=prefixes+':metadata a sh:PropertyGroup ; sh:order 1 . :prefixes sh:declare [ a sh:PrefixDeclaration ; sh:prefix "d" ; sh:namespace "urn:demo:"^^xsd:anyURI ] . :ServiceShape a sh:NodeShape ; sh:targetClass :Service ; sh:property [ sh:path :owner ; sh:group :metadata ; sh:minCount 1 ] ; sh:sparql [ a sh:SPARQLConstraint ; sh:prefixes :prefixes ; sh:select "SELECT $this WHERE { FILTER NOT EXISTS { $this d:owner ?value } }" ] .';
 expect(await r.run(request(data,shape)),'CONFORMS');
});
test('literal target constraints and fixed minimum coverage are checked without fabricated IRI targets',async t=>{
 const r=runner(t),shape=prefixes+':ServiceShape a sh:NodeShape ; sh:targetObjectsOf :owner ; sh:minLength 5 .',input=request(data,shape);
 input.expectations.requiredShapes[0].requiredFocusIris=[];input.expectations.digest=hash(input.expectations.requiredShapes);
 expect(await r.run(input),'CONFORMS');input.view.closure.documents[0]=document('model',data.replace('operations','ops'),'urn:model');expect(await r.run(input),'NONCONFORMING');
 input.expectations.requiredShapes[0].minimumFocusCount=2;input.expectations.digest=hash(input.expectations.requiredShapes);const result=await r.run(input);expect(result,'INCOMPLETE_COVERAGE');assert.equal(result.error.code,'REQUIRED_TARGET_COUNT');
});
test('offline closure must match every parsed import; no remote fetch or implicit shape import',async t=>{
 const r=runner(t),input=request(data+' <urn:model> owl:imports <urn:dependency> .');
 expect(await r.run(input),'MISSING_IMPORT');
 input.view.closure.documents.push(document('dependency','<urn:dependency> a <http://www.w3.org/2002/07/owl#Ontology> .','urn:dependency'));
 input.view.closure.imports.push({from:'model',iri:'urn:dependency',to:'dependency'});expect(await r.run(input),'CONFORMS');
 input.view.closure.documents[0]=document('model',data,'urn:model');expect(await r.run(input),'MISSING_IMPORT');
 expect(await r.run(request(data,shapes+' <urn:shape> <http://www.w3.org/2002/07/owl#imports> <https://example.invalid/shapes> .')),'MISSING_IMPORT');
});
test('RDF/XML is admitted without external entities and has the same constraint outcome',async t=>{
 const r=runner(t),input=request();input.view.closure.documents[0]=document('model','<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:owl="http://www.w3.org/2002/07/owl#" xmlns:d="urn:demo:"><owl:Ontology rdf:about="urn:model"/><d:Service rdf:about="urn:demo:svc"><d:owner>operations</d:owner></d:Service></rdf:RDF>','urn:model','rdfxml');
 expect(await r.run(input),'CONFORMS');
 input.view.closure.documents[0]=document('model','<!DOCTYPE rdf:RDF [<!ENTITY private SYSTEM "file:///etc/passwd">]>'+input.view.closure.documents[0].content,'urn:model','rdfxml');
 const rejected=await r.run(input);expect(rejected,'INVALID_INPUT');assert.equal(rejected.error.code,'XML_DECLARATION_FORBIDDEN');assert(!JSON.stringify(rejected).includes('root:'));
});
test('remote SERVICE, dataset clauses, custom functions and executable extensions are refused without network',async t=>{
 const r=runner(t);let connections=0;const server=createServer((_req,res)=>{connections++;res.end('unexpected');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const port=server.address().port;
 for(const q of [`SELECT $this WHERE { SERVICE <http://127.0.0.1:${port}/> { $this ?p ?o } }`,'SELECT $this FROM <file:///etc/passwd> WHERE { $this ?p ?o }','SELECT $this WHERE { FILTER(<urn:custom:call>($this)) }']){
  const shape=prefixes+':ServiceShape a sh:NodeShape ; sh:targetClass :Service ; sh:sparql [ sh:select '+JSON.stringify(q)+' ] .';expect(await r.run(request(data,shape)),'UNSUPPORTED');
 }
 expect(await r.run(request(data,shapes+' :ServiceShape sh:rule [] .')),'UNSUPPORTED');assert.equal(connections,0);
});
test('recursive or malformed shapes and malformed data remain explicit incomplete results',async t=>{
 const r=runner(t);expect(await r.run(request(data,shapes+' :ServiceShape sh:node :ServiceShape .')),'UNSUPPORTED');
 const bad=await r.run(request(data,shapes.replace('sh:minCount 1','sh:minCount "invalid"')));assert.equal(bad.complete,false);assert.notEqual(bad.status,'CONFORMS');
 expect(await r.run(request('not valid RDF')),'INVALID_INPUT');
});
test('source snapshots and required coverage cannot be silently mutated, downgraded or widened',async t=>{
 const r=runner(t),input=request(),original=shaclIdentities(input),pending=r.run(input);input.view.closure.documents[0].content='caller mutation';const actual=await pending;expect(actual,'CONFORMS');assert.equal(actual.requestDigest,original.requestDigest);
 const bad=request();bad.shapes[0].digest=hashBytes('wrong');assert.throws(()=>validateSHACLRequest(bad),{code:'DIGEST_MISMATCH'});
 const stale=request();stale.expectations.requiredShapes[0].requiredFocusIris.push('urn:demo:other');assert.throws(()=>validateSHACLRequest(stale),{code:'DIGEST_MISMATCH'});
 const derived=request();derived.view.kind='derived';assert.throws(()=>validateSHACLRequest(derived),{code:'SHACL_SCHEMA'});
 const empty=request();empty.expectations.requiredShapes=[];empty.expectations.digest=hash([]);assert.throws(()=>validateSHACLRequest(empty),{code:'SHACL_SCHEMA'});
});
test('one worker lock, timeout and cancellation never return partial conformance',async t=>{
 const r=runner(t),controller=new AbortController();let cancelledAttempt,timedAttempt;
 const pending=r.run(request(),{signal:controller.signal,beforeDispatch:ref=>{cancelledAttempt=ref;}});
 await assert.rejects(r.run(request()),{code:'VALIDATOR_BUSY'});controller.abort();const cancelled=await pending;expect(cancelled,'CANCELLED');
 const confirm=(ref,result,reason)=>{
   const a=readWorkerAttempt(ref);assert.equal(a.outcome.reason,reason);assert.equal(result.result.signal,a.outcome.signal);assert.equal(result.result.exitCode,a.outcome.exitCode);
   if(a.worker){assert.equal(a.outcome.state,'EXITED');assert.equal(a.outcome.signal,'SIGKILL');}
   else{assert.equal(a.outcome.state,'NOT_STARTED');assert.equal(a.outcome.workerPid,null);assert.equal(a.outcome.signal,null);}
 };
 confirm(cancelledAttempt,cancelled,'CANCELLED');
 const timed=await r.run(request(),{timeoutMs:1,beforeDispatch:ref=>{timedAttempt=ref;}});expect(timed,'TIMEOUT');confirm(timedAttempt,timed,'TASK_DEADLINE');
 const before=new AbortController();before.abort();let dispatched=false;expect(await r.run(request(),{signal:before.signal,beforeDispatch:()=>{dispatched=true;}}),'CANCELLED');assert.equal(dispatched,false);
 expect(await r.run(request()),'CONFORMS');
});
test('an installed adapter mismatch is rejected before any validation process',t=>{
 const r=runner(t),value=JSON.parse(readFileSync(binding,'utf8'));value.adapterDigest=hashBytes('different worker');const {digest:_,...identity}=value;value.digest=hash(identity);const path=join(r.root,'toolchain.json');writeFileSync(path,JSON.stringify(value),{mode:0o600});assert.throws(()=>readSHACLToolchain(path),{code:'TOOLCHAIN_DRIFT'});
});
test('Python directory aliases require a fully inventoried target and preserve byte drift checks',t=>{
 // Synthetic filesystem boundary test, not a Python execution/conformance claim.
 const root=realpathSync(mkdtempSync(join(tmpdir(),'ontology-python-links-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const selected=readSHACLToolchain(binding),runtimeRoot=join(root,'runtime'),workerRoot=join(root,'worker');
 for(const path of ['python/lib','venv/lib','unselected'])mkdirSync(join(runtimeRoot,path),{recursive:true,mode:0o700});mkdirSync(workerRoot,{mode:0o700});
 copyFileSync(join(selected.root,'worker.py'),join(workerRoot,'worker.py'));
 writeFileSync(join(runtimeRoot,'python/lib/module.py'),'# fixture\n');writeFileSync(join(runtimeRoot,'venv/lib/module.py'),'# fixture\n');writeFileSync(join(runtimeRoot,'unselected/module.py'),'# outside selected inventory\n');
 const alias=join(runtimeRoot,'venv/lib64');symlinkSync('lib',alias);
 const bound={...selected,root:workerRoot,runtimeRoot,runtimeFiles:inventory(runtimeRoot,['python','venv'])};verifySHACLToolchain(bound);
 writeFileSync(join(runtimeRoot,'venv/lib/module.py'),'# changed\n');assert.throws(()=>verifySHACLToolchain(bound),{code:'TOOLCHAIN_DRIFT'});
 rmSync(alias);symlinkSync('../unselected',alias);bound.runtimeFiles=inventory(runtimeRoot,['python','venv']);assert.throws(()=>verifySHACLToolchain(bound),{code:'TOOLCHAIN_DRIFT'});
 rmSync(alias);symlinkSync(workerRoot,alias);assert.throws(()=>verifySHACLToolchain(bound),{code:'UNSAFE_PATH'});
});
