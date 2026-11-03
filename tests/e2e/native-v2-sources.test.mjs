import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawnSync} from 'node:child_process';
import {admitSourceSet,SOURCE_LIMITS} from '../../dist/native-v2/sources.js';
import {SOURCE_SCHEMA_DIGEST} from '../../dist/native-v2/schema.js';
import {hashBytes} from '../../dist/standalone/validation.js';

function source(content,format='text',extra={}){return {id:'requirements',locator:'requirements.txt',revision:'v1',origin:'requirement',format,content,digest:hashBytes(content),...extra};}
function fragment(doc,selector,selected,id='f1'){return {id,sourceId:doc.id,sourceDigest:doc.digest,selector,fragmentDigest:hashBytes(selected)};}
function input(doc,fragments=[]){return {schema:'ontology-source-set/v2',sources:[doc],fragments};}
function selected(admission,id='f1'){
  const f=admission.fragments.find(f=>f.id===id),s=admission.sourceSet.sources.find(s=>s.id===f.sourceId);
  return Buffer.from(s.content).subarray(f.startByte,f.endByte).toString('utf8');
}

test('native v2 schema is the generated runtime/type authority and rejects unknown envelopes',()=>{
  assert.equal(SOURCE_SCHEMA_DIGEST,hashBytes(readFileSync(new URL('../../schemas/v2/sources.schema.json',import.meta.url))));
  const generated=spawnSync(process.execPath,['scripts/generate-native-v2.mjs','--check'],{cwd:new URL('../../',import.meta.url),encoding:'utf8'});
  assert.equal(generated.status,0,generated.stderr);
  for(const bad of [{schema:'ontology-source-set/v1',sources:[],fragments:[]},{...input(source('x')),approved:true},input(source('x','yaml')),input(source('x','text',{id:'bad\n'}))])assert.throws(()=>admitSourceSet(bad),{code:'SOURCE_SCHEMA'});
});

test('original bytes, revision and selectors bind a detached immutable source snapshot',()=>{
  const a=source('需求：敏感数据\n'),b=source('Other source','text',{id:'other',origin:'reference'});
  const f=fragment(a,{kind:'document'},a.content),set={schema:'ontology-source-set/v2',sources:[a,b],fragments:[f]};
  const admitted=admitSourceSet(set),reordered=admitSourceSet({...set,sources:[b,a]});
  assert.equal(admitted.sourceSetDigest,reordered.sourceSetDigest);
  assert.equal(selected(admitted),a.content);assert.equal(admitted.authority,false);assert.equal(admitted.businessConfirmed,false);assert.equal(admitted.semanticValidation,'NOT_EVALUATED');
  const changed=structuredClone(set);changed.sources[0].revision='v2';assert.notEqual(admitSourceSet(changed).sourceSetDigest,admitted.sourceSetDigest);
  a.content='Later caller mutation';assert.equal(selected(admitted),'需求：敏感数据\n');
  assert.throws(()=>{admitted.sourceSet.sources[0].content='Mutate retained bytes';},TypeError);
  assert.throws(()=>{admitted.fragments.push({});},TypeError);
});

test('changed bytes, stale source bindings and invented fragment content fail admission',()=>{
  const s=source('Approved requirement text'),f=fragment(s,{kind:'document'},s.content);
  assert.throws(()=>admitSourceSet(input({...s,content:'Different'},[f])),{code:'SOURCE_DIGEST_MISMATCH'});
  const changed=source('Different');assert.throws(()=>admitSourceSet(input(changed,[f])),{code:'SOURCE_CHANGED'});
  assert.throws(()=>admitSourceSet(input(s,[{...f,fragmentDigest:hashBytes('Invented')} ])),{code:'FRAGMENT_DIGEST_MISMATCH'});
  assert.throws(()=>admitSourceSet(input(s,[{...f,sourceId:'absent'}])),{code:'SOURCE_FRAGMENT_MISSING'});
  assert.throws(()=>admitSourceSet({...input(s),sources:[s,s]}),{code:'SOURCE_ID_CONFLICT'});
  assert.throws(()=>admitSourceSet(input(s,[f,f])),{code:'SOURCE_ID_CONFLICT'});
});

test('UTF-8 ranges use byte boundaries, preserve exact text and allow explicit empty ranges',()=>{
  const s=source('A中😀Z');
  for(const [start,end,text] of [[1,4,'中'],[4,8,'😀'],[1,8,'中😀'],[9,9,'']]){
    const admitted=admitSourceSet(input(s,[fragment(s,{kind:'utf8-range',start,end},text)]));assert.equal(selected(admitted),text);
  }
  for(const [start,end] of [[2,4],[4,6],[8,4],[0,10]])assert.throws(()=>admitSourceSet(input(s,[fragment(s,{kind:'utf8-range',start,end},'')])),{code:'SOURCE_FRAGMENT_INVALID'});
  assert.throws(()=>admitSourceSet(input(source('\uD800'))),{code:'SOURCE_ENCODING'});
});

test('RFC 6901 selectors retain lexical values, escapes, Unicode and original numeric spelling',()=>{
  const text=' \n {"": 0, "a/b": ["中😀", {"m~n": 9007199254740993}], "~1": true, "n": null, "__proto__": 1e400, "%2F": "literal"}\n';
  const s=source(text,'json');
  const cases=[['/','0'],['/a~1b/0','"中😀"'],['/a~1b/1/m~0n','9007199254740993'],['/~01','true'],['/n','null'],['/__proto__','1e400'],['/%2F','"literal"']];
  const fs=cases.map(([pointer,value],i)=>fragment(s,{kind:'json-pointer',pointer},value,'f'+i));
  const a=admitSourceSet(input(s,fs));cases.forEach(([,value],i)=>assert.equal(selected(a,'f'+i),value));
  const root=admitSourceSet(input(s,[fragment(s,{kind:'json-pointer',pointer:''},text.trim())]));assert.equal(selected(root),text.trim());
  assert.notEqual(root.fragments[0].fragmentDigest,s.digest);
  const escaped=source('{"v":"\\u4E2D"}','json');assert.equal(selected(admitSourceSet(input(escaped,[fragment(escaped,{kind:'json-pointer',pointer:'/v'},'"\\u4E2D"')]))),'"\\u4E2D"');
});

test('JSON Pointer never selects nonexistent or ambiguous values and never applies to RDF/text',()=>{
  const s=source('{"a":[1],"":"empty"}','json');
  for(const pointer of ['/a/-','/a/01','/a/1','/a/999999999999999999999','/missing','/a/0/child','/constructor'])assert.throws(()=>admitSourceSet(input(s,[fragment(s,{kind:'json-pointer',pointer},'x')])),{code:'SOURCE_FRAGMENT_MISSING'});
  for(const pointer of ['#/a','a','/~2','\n'])assert.throws(()=>admitSourceSet(input(s,[fragment(s,{kind:'json-pointer',pointer},'x')])),{code:'SOURCE_SCHEMA'});
  for(const format of ['text','turtle','rdfxml']){const d=source('{}',format);assert.throws(()=>admitSourceSet(input(d,[fragment(d,{kind:'json-pointer',pointer:''},'{}')])),{code:'SOURCE_FRAGMENT_INVALID'});}
  for(const content of ['{"a":1,"a":2}','{"a":1,"\\u0061":2}'])assert.throws(()=>admitSourceSet(input(source(content,'json'))),{code:'SOURCE_JSON_AMBIGUOUS'});
  for(const content of ['a: 1','{"a": 1,}','// comment\n{}'])assert.throws(()=>admitSourceSet(input(source(content,'json'))),{code:'SOURCE_JSON_INVALID'});
});

test('source/envelope/selection budgets and unsafe objects fail explicitly',()=>{
  assert.throws(()=>admitSourceSet(input(source('中'.repeat(Math.floor(SOURCE_LIMITS.documentBytes/3)+1)))),{code:'INPUT_LIMIT'});
  const nested='['.repeat(66)+'0'+']'.repeat(66);assert.throws(()=>admitSourceSet(input(source(nested,'json'))),{code:'INPUT_LIMIT'});
  const many='['+Array(100001).fill('0').join(',')+']';assert.throws(()=>admitSourceSet(input(source(many,'json'))),{code:'INPUT_LIMIT'});
  const one=source('a'.repeat(1024*1024));const repeated=Array.from({length:33},(_,i)=>fragment(one,{kind:'document'},one.content,'f'+i));
  assert.throws(()=>admitSourceSet(input(one,repeated)),{code:'INPUT_LIMIT'});
  let accessed=false;const unsafe={get schema(){accessed=true;return 'ontology-source-set/v2';}};
  assert.throws(()=>admitSourceSet(unsafe),{code:'INVALID_INPUT'});assert.equal(accessed,false);
  const cyclic={};cyclic.self=cyclic;assert.throws(()=>admitSourceSet(cyclic),{code:'INVALID_INPUT'});
});

test('source locators are retained as labels and never fetched from disk or HTTP',async t=>{
  const base=mkdtempSync(join(tmpdir(),'ontology-source-v2-'));t.after(()=>rmSync(base,{recursive:true,force:true}));
  const path=join(base,'different.txt');writeFileSync(path,'Content must not be read');
  let requests=0;const server=createServer((_req,res)=>{requests++;res.end('Must not fetch');});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  for(const locator of [path,'http://127.0.0.1:'+server.address().port+'/source']){
    const s=source('Explicitly supplied material','text',{locator});assert.equal(selected(admitSourceSet(input(s,[fragment(s,{kind:'document'},s.content)]))),s.content);
  }
  assert.equal(requests,0);
});
