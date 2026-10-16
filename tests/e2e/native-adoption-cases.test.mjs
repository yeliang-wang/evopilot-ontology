import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,mkdirSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateNativeOntology} from '../../dist/index.js';
import {createOntologyService} from '../../dist/service.js';
import {nativePackage,rehash} from '../fixtures/native/package.mjs';

const tools=()=>JSON.parse(readFileSync(process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN,'utf8'));
const retain=(id,report)=>{const dir=process.env.EVOPILOT_NATIVE_CASE_REPORT_DIR;if(dir){mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'ontology-'+id+'.json'),JSON.stringify({synthetic:true,id,report}),{flag:'wx'});}};
const addData=(p,text)=>{for(const key of Object.keys(p.files))if(key.startsWith('instances/')||key.startsWith('tests/')&&key.endsWith('.ttl'))p.files[key]+='\n'+text;};
const run=p=>validateNativeOntology(rehash(p),tools());

for(const [id,prepare,change,component] of [
 ['core-value-type',()=>{},p=>{p.files['instances/current.ttl']=p.files['instances/current.ttl'].replace('ex:limit 3','ex:limit "three"');},'DatatypeConstraintComponent'],
 ['core-cardinality',()=>{},p=>{p.files['instances/current.ttl']=p.files['instances/current.ttl'].replace('; ex:operation "execute"','');},'MinCountConstraintComponent'],
 ['core-range',()=>{},p=>{p.files['instances/current.ttl']=p.files['instances/current.ttl'].replace('ex:limit 3','ex:limit 11');},'MaxInclusiveConstraintComponent'],
 ['core-string',p=>{p.files['shapes/domain.ttl']+='\nex:KindShape sh:minLength 5 .';},p=>{p.files['instances/current.ttl']=p.files['instances/current.ttl'].replace('"ENGINE"','"ENG"');},'MinLengthConstraintComponent'],
 ['core-property-pair',p=>{p.files['shapes/domain.ttl']+='\nex:LimitShape sh:lessThan ex:rank . ex:CapabilityShape sh:property [ sh:path ex:rank ] .';addData(p,'ex:engine ex:rank 10 . ex:query ex:rank 10 .');},p=>{p.files['instances/current.ttl']=p.files['instances/current.ttl'].replace('ex:engine ex:rank 10','ex:engine ex:rank 2');},'LessThanConstraintComponent'],
 ['core-logical',()=>{},p=>{p.files['instances/current.ttl']=p.files['instances/current.ttl'].replace('"execute"','"search"');},'OrConstraintComponent'],
 ['core-shape',p=>{p.files['shapes/domain.ttl']+='\nex:CapabilitiesShape sh:qualifiedValueShape [ sh:property [ sh:path ex:limit; sh:minInclusive 1 ] ]; sh:qualifiedMinCount 2 .';},p=>{p.files['instances/current.ttl']=p.files['instances/current.ttl'].replace('ex:limit 3','ex:limit 0');},'QualifiedMinCountConstraintComponent'],
 ['core-other',()=>{},p=>{p.files['instances/current.ttl']=p.files['instances/current.ttl'].replace('"ENGINE"','"OTHER"');},'InConstraintComponent']
])test('S03: '+id+' has actual conforming and violating native cases',async()=>{
 const p=nativePackage();prepare(p);const positive=await run(p);assert.equal(positive.status,'CONFORMS',JSON.stringify(positive.diagnostics));
 const q=structuredClone(p);change(q);const negative=await run(q);retain(id,{positive,negative});
 assert.equal(negative.status,'NONCONFORMING');assert(negative.rawReport.includes(component),negative.rawReport);
 assert(negative.results.some(r=>String(r['sh:sourceConstraintComponent']).endsWith(component)&&r['sh:focusNode']));
});

for(const [id,change,status,diagnostic] of [
 ['O05.01',p=>{p.files['instances/current.ttl']='';},'NONCONFORMING','EMPTY_GRAPH'],
 ['O05.03',p=>{p.files['shapes/domain.ttl']=p.files['shapes/domain.ttl'].replace('sh:targetNode ex:project','sh:targetNode ex:nobody').replace('sh:targetClass ex:Capability','sh:targetClass ex:Nobody');},'NONCONFORMING','ROOT_TARGET_MISSING'],
 ['O07.02',p=>{p.files['shapes/domain.ttl']+='\nex:CapabilityShape sh:and _:cycle . _:cycle rdf:first [ sh:class ex:Capability ]; rdf:rest _:cycle .';},'ERROR','INVALID_LIST'],
 ['O07.03',p=>{p.files['shapes/domain.ttl']=p.files['shapes/domain.ttl'].replace('sh:path ex:kind','sh:path "bad path"');},'ERROR',null],
 ['O07.06',p=>{p.files['shapes/domain.ttl']+='\nex:ProjectShape sh:rule [ a sh:TripleRule ] .';},'UNSUPPORTED','UNSUPPORTED_SHACL'],
 ['O07.08',p=>{p.files['shapes/domain.ttl']+='\nex:Custom a sh:ConstraintComponent .';},'UNSUPPORTED','UNSUPPORTED_SHACL'],
 ['S03-rdfs-outside',p=>{p.files['model.ttl']+='\nex:Capability owl:equivalentClass ex:Other .';},'UNSUPPORTED','UNSUPPORTED_OWL']
])test(id+': native boundary returns its explicit non-success diagnosis',async()=>{
 const p=nativePackage();change(p);const report=await run(p);retain(id,report);assert.equal(report.status,status,JSON.stringify(report.diagnostics));
 if(diagnostic)assert(report.diagnostics.some(d=>d.code===diagnostic),JSON.stringify(report.diagnostics));
 assert(report.criteria.every(c=>c.status!=='PASS'));
});

for(const [id,field] of [['O06.03','useShapes'],['O06.04','focusNodes']])test(id+': public owner API refuses caller-selected validation subsets',async()=>{
 const root=mkdtempSync(join(realpathSync(tmpdir()),'ontology-subset-')),service=createOntologyService({workspaceRoot:root,workspaceId:'synthetic'},{nativeToolchain:tools()});
 try {service.initialize();const request={operation:'native.package.validate',scope:{visibility:'private',projectId:'synthetic'},input:{id:'synthetic-model',version:'1.0.0',[field]:['https://example.invalid/r1/ProjectShape']},requestId:id.replace('.','-'),expectedRevision:0};
  await assert.rejects(()=>service.native(request),/Missing or unknown native field/);
  assert.equal(service.execute({operation:'workspace.inspect',scope:request.scope,input:{}}).revision,0);
 }finally{service.close();rmSync(root,{recursive:true,force:true});}
});
