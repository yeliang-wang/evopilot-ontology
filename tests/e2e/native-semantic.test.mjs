import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {fileURLToPath}from'node:url';import{spawnSync}from'node:child_process';
import {validateNativeOntology}from'../../dist/index.js';
import {nativePackage,rehash}from'../fixtures/native/package.mjs';
import {nativeBytesDigest,nativePackageDigest}from'../../vendor/compatibility/v1/native.mjs';
const tools=()=>JSON.parse(readFileSync(process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN,'utf8'));
const ex='https://example.invalid/r1/';
function timelinePackage(){
 const p=nativePackage(),id=ex+'TrajectoryShape';
 const trajectory='\nex:project ex:first ex:event0; ex:last ex:event2 .\nex:event0 a ex:Event; ex:state "NEW"; ex:next ex:event1 .\nex:event1 a ex:Event; ex:state "ACTIVE"; ex:next ex:event2 .\nex:event2 a ex:Event; ex:state "DONE" .\n';
 p.files['model.ttl']+='\nex:Event a owl:Class; rdfs:label "Event"; rdfs:comment "Synthetic ordered lifecycle event"; rdfs:isDefinedBy ex:ontology; rdfs:seeAlso ex:source .';
 const query=`PREFIX ex: <${ex}> SELECT $this WHERE { FILTER NOT EXISTS { $this ex:first ?first; ex:last ?last . ?first ex:state "NEW"; ex:next ?middle . ?middle ex:state "ACTIVE"; ex:next ?last . ?last ex:state "DONE" . FILTER NOT EXISTS { ?last ex:next ?extra } } }`;
 p.files['shapes/domain.ttl']+='\nex:TrajectoryShape a sh:NodeShape; sh:targetNode ex:project; rdfs:label "Trajectory"; rdfs:comment "NEW then ACTIVE then terminal DONE"; rdfs:isDefinedBy ex:ontology; rdfs:seeAlso ex:source; sh:sparql [ sh:select '+JSON.stringify(query)+' ] .';
 for(const path of Object.keys(p.files).filter(x=>x==='instances/current.ttl'||x.startsWith('tests/')&&x.endsWith('.ttl')))p.files[path]+=trajectory;
 const coverage=JSON.parse(p.files['scope/coverage.json']),cases=JSON.parse(p.files['tests/cases.json']);coverage.requiredShapeIds.push(id);coverage.expectedEntities.push(...[0,1,2].map(i=>({id:ex+'event'+i,type:ex+'Event'})));cases.cases.find(c=>c.id==='positive').shapeIds.push(id);
 const negatives=[['illegal-edge',x=>x.replace('ex:next ex:event1','ex:next ex:event2')],['unknown-state',x=>x.replace('"ACTIVE"','"PAUSED"')],['missing-middle',x=>x.replace('ex:event1 a ex:Event; ex:state "ACTIVE"; ex:next ex:event2 .','ex:event1 a ex:Event; ex:state "ACTIVE" .')],['after-terminal',x=>x+'\nex:event2 ex:next ex:event0 .']];
 for(const [name,fn]of negatives){const data='tests/timeline-'+name+'.ttl';p.files[data]=fn(p.files['tests/positive.ttl']);cases.cases.push({id:'timeline-'+name,data,expectedConforms:false,requirementIds:['scope'],shapeIds:[id]});coverage.requiredCaseIds.push('timeline-'+name);}
 p.files['scope/coverage.json']=JSON.stringify(coverage);p.files['tests/cases.json']=JSON.stringify(cases);
 p.files['sources/source.txt']+='\n# Synthetic requirement: NEW -> ACTIVE -> DONE; no missing middle or outgoing terminal transition.\n';const bindings=JSON.parse(p.files['sources/bindings.json']),source=bindings.sources[0];source.digest=nativeBytesDigest(p.files['sources/source.txt']);
 bindings.mappings.push(...['Event','TrajectoryShape'].map(s=>({...bindings.mappings[0],targetId:ex+s})));
 for(const m of bindings.mappings){m.fileDigest=source.digest;m.selector={kind:'lines',start:1,end:p.files[source.contentPath].split('\n').length};m.fragmentDigest=source.digest;}
 p.files['sources/bindings.json']=JSON.stringify(bindings);return rehash(p);
}
test('O09: native SELECT validates legal synthetic trajectory and independently hits four invalid transitions',async()=>{
 const p=timelinePackage(),result=await validateNativeOntology(p,tools());assert.equal(result.status,'CONFORMS',JSON.stringify(result.diagnostics));
 const trajectory=result.caseReports.filter(c=>c.id.startsWith('timeline-'));assert.equal(trajectory.length,4);assert(trajectory.every(c=>!c.actualConforms&&c.matchesExpected&&c.sourceShapeIds.includes(ex+'TrajectoryShape')&&c.rawReport.includes('SPARQLConstraintComponent')));
 for(const c of trajectory){const bad=structuredClone(p);bad.files['instances/current.ttl']=bad.files['tests/'+c.id+'.ttl'];rehash(bad);const actual=await validateNativeOntology(bad,tools());assert.equal(actual.status,'NONCONFORMING',c.id);assert(actual.rawReport.includes('SPARQLConstraintComponent'));}
});
test('O01/O10: identical native bytes independently replay to equivalent reports; whitespace changes package identity',async()=>{
 const toolchain=tools(),p=nativePackage();p.files['instances/current.ttl']=p.files['instances/current.ttl'].replace('ex:limit 3','ex:limit 11');rehash(p);
 const result=await validateNativeOntology(p,toolchain);assert.equal(result.status,'NONCONFORMING');
 const replay=spawnSync(toolchain.tools.python.executable,['-I','-B',fileURLToPath(new URL('../fixtures/native/independent-replay.py',import.meta.url))],{input:JSON.stringify({package:p,rawReport:result.rawReport}),encoding:'utf8',timeout:60000,env:{PATH:''},maxBuffer:16777216});assert.ifError(replay.error);assert.equal(replay.status,0,replay.stderr);
 const report=JSON.parse(replay.stdout);assert.equal(report.conforms,false);assert.equal(report.equivalent,true);assert.equal(report.differentBlankNodeSerializationEquivalent,true);
 const original=nativePackageDigest(p);p.files['model.ttl']+='\n# same graph, new bytes\n';rehash(p);assert.notEqual(nativePackageDigest(p),original);
 const changed=await validateNativeOntology(p,toolchain);assert.equal(changed.status,'NONCONFORMING');assert.notEqual(changed.packageDigest,result.packageDigest);
});
