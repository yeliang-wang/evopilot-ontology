import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,existsSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {collectorArguments,openCollector,verifyArtifactChunks} from '../acceptance/v090/public-collector.mjs';
import {hashBytes} from '../../scripts/standards-gate.mjs';
import {verifyRuntimePayload,verifyRelocatedPython} from '../acceptance/v090/published-installation.mjs';
import {validateCompletedHostCall,selectModelEntailmentChange} from '../acceptance/v090/host-public.mjs';
test('actual Host domain refusals retain structured errors while transport failures and unfinished calls cannot pass',()=>{
  const refused={server:'evopilot-ontology',status:'failed',error:null,result:{structured_content:{error:{code:'NOT_FOUND',message:'Project not initialized'}}}};
  assert.doesNotThrow(()=>validateCompletedHostCall(refused));
  assert.doesNotThrow(()=>validateCompletedHostCall({...refused,status:'completed',result:{structured_content:{result:{authority:false}}}}));
  for(const changed of [{...refused,status:'in_progress'},{...refused,error:{message:'Connection failed'}},{...refused,result:null},{...refused,result:{structured_content:{error:{message:'No typed code'}}}},{...refused,status:'completed'},{...refused,result:{structured_content:{...refused.result.structured_content,result:{}}}}])assert.throws(()=>validateCompletedHostCall(changed));
});
test('formal collector refuses a missing report approval before creating an output or installation',async t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'ontology-collector-gate-')));t.after(()=>rmSync(root,{recursive:true,force:true}));const output=join(root,'must-not-exist');
  await assert.rejects(openCollector('AUTH',new URL('../acceptance/v090/auth.mjs',import.meta.url),['--evidence',root,'--request','product-e2e-request.json','--output',output]));assert.equal(existsSync(output),false);
});
test('an MCP guide scope rejection requires the identical successful scoped read and never substitutes for owner execution',()=>{
  const scope={workspaceId:'isolated',serviceId:'owner',projectId:'demo'};
  const rejected={server:'evopilot-ontology',tool:'ontology_read',status:'failed',error:null,arguments:{operation:'guide.read',input:{topic:'evolution'}},result:{structured_content:null,content:[{type:'text',text:"Input validation error: Invalid arguments for tool ontology_read: data must have required property 'workspaceId', data must have required property 'serviceId', data must have required property 'projectId'"}]}};
  const recovered={...rejected,status:'completed',arguments:{...rejected.arguments,...scope},result:{structured_content:{result:{topic:'evolution'}}}};
  assert.equal(validateCompletedHostCall(rejected,{call:recovered,scope}),'RECOVERED_MCP_GUIDE_SCOPE_REJECTION');
  assert.throws(()=>validateCompletedHostCall(rejected));
  for(const change of [{...rejected,tool:'ontology_write'},{...rejected,error:{message:'Connection lost'}},{...rejected,status:'in_progress'},{...rejected,arguments:{...rejected.arguments,operation:'delivery.inspect'}},{...rejected,result:{...rejected.result,content:[{type:'text',text:'Unknown failure'}]}},{...rejected,arguments:{...rejected.arguments,workspaceId:'foreign'}}])assert.throws(()=>validateCompletedHostCall(change,{call:recovered,scope}));
  for(const next of [{...recovered,status:'failed'},{...recovered,error:{message:'Timeout'}},{...recovered,arguments:{...recovered.arguments,projectId:'foreign'}},{...recovered,arguments:{...recovered.arguments,input:{topic:'delivery'}}},{...recovered,result:{structured_content:{error:{code:'NOT_FOUND',message:'Missing guide'}}}}])assert.throws(()=>validateCompletedHostCall(rejected,{call:next,scope}));
});
test('formal collector command line cannot select traversal, implicit source or unknown switches',()=>{
  for(const args of [[],['--evidence','relative','--request','r.json','--output','/tmp/new'],['--evidence','/tmp/evidence','--request','../r.json','--output','/tmp/new'],['--evidence','/tmp/evidence','--request','r.json','--force','/tmp/new']])assert.throws(()=>collectorArguments(args));
});
test('large artifact evidence cannot omit, reorder, substitute or duplicate byte chunks',()=>{
  const chunks=new Map([['first',Buffer.from('original archive prefix')],['second',Buffer.from('original archive suffix')]]);
  const refs=[...chunks].map(([path,bytes])=>({path,digest:hashBytes(bytes)})),content=Buffer.concat([...chunks.values()]);
  const manifest={schema:'ontology-private-artifact-chunks/v1',bytes:content.length,digest:hashBytes(content),chunks:refs};
  const read=ref=>{const value=chunks.get(ref.path);assert.equal(hashBytes(value),ref.digest);return value;};
  assert.deepEqual(verifyArtifactChunks(manifest,read),{bytes:content.length,digest:hashBytes(content)});
  for(const changed of [{...manifest,chunks:refs.slice(0,1)},{...manifest,chunks:[...refs].reverse()},{...manifest,chunks:[refs[0],refs[0]]},{...manifest,bytes:content.length+1},{...manifest,digest:hashBytes('other archive')}])assert.throws(()=>verifyArtifactChunks(changed,read));
  assert.throws(()=>verifyArtifactChunks(manifest,()=>Buffer.alloc(16*1024*1024+1)));
  chunks.set('second',Buffer.from('different archive suffix'));assert.throws(()=>verifyArtifactChunks(manifest,read));
});
test('fresh installation permits only npm archive/name metadata differences and rejects executable, dependency and inventory drift',t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'ontology-fresh-binding-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const write=(base,path,value)=>{const p=join(base,path);mkdirSync(dirname(p),{recursive:true,mode:0o700});writeFileSync(p,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});};
  const before=join(root,'before'),after=join(root,'after');
  for(const [base,name,archive] of [[before,'runtime','file:../package/evopilot-next-ontology-0.9.0.tgz'],[after,'published-runtime','file:/download/evopilot-next-ontology-0.9.0.tgz']]){
    const dependencies={'@evopilot-next/ontology':archive},own={version:'0.9.0',resolved:archive,integrity:'same-original-archive'},packages={'':{dependencies},'node_modules/@evopilot-next/ontology':own};
    write(base,'package.json',{dependencies});write(base,'package-lock.json',{name,lockfileVersion:3,packages});write(base,'node_modules/.package-lock.json',{name,lockfileVersion:3,packages:{'node_modules/@evopilot-next/ontology':own}});write(base,'node_modules/@evopilot-next/ontology/dist/cli.js','original executable');write(base,'node_modules/dependency/index.js','original dependency');
  }
  assert.equal(verifyRuntimePayload(before,after).metadataPathDifferences.length,3);
  write(after,'node_modules/dependency/index.js','substituted dependency');assert.throws(()=>verifyRuntimePayload(before,after),/Executable or dependency bytes changed/);write(after,'node_modules/dependency/index.js','original dependency');
  write(after,'node_modules/@evopilot-next/ontology/dist/cli.js','substituted executable');assert.throws(()=>verifyRuntimePayload(before,after),/Executable or dependency bytes changed/);write(after,'node_modules/@evopilot-next/ontology/dist/cli.js','original executable');
  write(after,'unexpected.js','extra');assert.throws(()=>verifyRuntimePayload(before,after),/inventory differs/);rmSync(join(after,'unexpected.js'));
  write(after,'package.json',{dependencies:{'@evopilot-next/ontology':'file:/download/evopilot-next-ontology-0.9.0.tgz'},scripts:{postinstall:'unexpected'}});assert.throws(()=>verifyRuntimePayload(before,after),/npm dependency lock differs/);
});
test('native relocation permits exact generated venv roots but rejects code changes and unrelated native payload drift',t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'ontology-native-relocation-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const before=join(root,'before'),after=join(root,'after'),make=(base,text,path='venv/bin/pyshacl')=>{const p=join(base,path);mkdirSync(dirname(p),{recursive:true,mode:0o700});writeFileSync(p,text,{mode:0o600});return {schema:'fixture',root:base+'-adapter',runtimeRoot:base,python:join(base,'venv/bin/python3.12'),adapterDigest:hashBytes('same adapter'),digest:hashBytes(base),runtimeFiles:[{path,kind:'file',mode:0o600,digest:hashBytes(text)}]};};
  const reference=make(before,'#!'+before+'/venv/bin/python3.12\nprint("verified")\n'),actual=make(after,'#!'+after+'/venv/bin/python3.12\nprint("verified")\n');
  assert.deepEqual(verifyRelocatedPython(reference,actual),['venv/bin/pyshacl']);
  assert.throws(()=>verifyRelocatedPython(reference,make(after,'#!'+after+'/venv/bin/python3.12\nprint("changed")\n')),/Only the exact Python installation root/);
  const left=make(before,'original native bytes','venv/lib/payload.py'),right=make(after,'changed native bytes','venv/lib/payload.py');assert.throws(()=>verifyRelocatedPython(left,right),/outside generated venv paths/);
});


test('alignment compares the same query across exact model revisions despite unrelated earlier positive results',()=>{
  const make=(modelDigest,status,axiom,query=axiom)=>({value:{modelDigest,formalStatus:status,result:{result:{queryAxioms:[{axiom}]}}},start:{call:{arguments:{input:{task:{query:{format:'functional',content:query,digest:hashBytes(query)}}}}}}});
  const originalA=make('before','ENTAILED','A(a)'),originalB=make('before','NOT_ENTAILED','B(a)'),mappedA=make('after','ENTAILED','A(a)'),mappedB=make('after','ENTAILED','B(a)');
  const session=rows=>({task(kind,status,predicate){assert.equal(kind,'reasoning');const x=rows.find(x=>x.value.formalStatus===status&&predicate(x.value));assert(x,'No matching actual task');return x;}});
  const result=selectModelEntailmentChange(session([originalA,originalB,mappedA,mappedB]),'before','after');
  assert.equal(result.unknown,originalB);assert.equal(result.mapped,mappedB);
  for(const rows of [[originalA,originalB,mappedA],[originalA,originalB,make('foreign','ENTAILED','B(a)')],[originalA,originalB,make('after','ENTAILED','B(a)','changed query bytes')]])assert.throws(()=>selectModelEntailmentChange(session(rows),'before','after'));
});
