import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {listenStandalone} from '../../dist/standalone/http.js';
import {READ_OPERATIONS,WRITE_OPERATIONS} from '../../dist/standalone/service.js';
import {expertGuide} from '../../dist/expert/guide.js';
import {hash} from '../../dist/standalone/validation.js';

function validate(contract,input){
  const ajv=new Ajv2020({strict:true,allErrors:true});
  for(const reference of contract.referencedSchemas)ajv.addSchema(reference.value);
  const check=ajv.compile(contract.inputSchema);
  assert.equal(check(input),true,contract.operation+': '+JSON.stringify(check.errors));
}

test('public Expert contracts cover actual registered operations and compile with complete schema references',()=>{
  const index=expertGuide('contracts');
  assert.deepEqual(index.operations.map(v=>v.operation),[...READ_OPERATIONS,...WRITE_OPERATIONS].sort());
  for(const {operation,input} of index.operations){
    const contract=expertGuide(input.topic),{contractDigest,...body}=contract;
    assert.equal(contractDigest,hash(body));assert.equal(contract.authority,false);
    assert.equal(contract.tool,WRITE_OPERATIONS.includes(operation)?'ontology_write':'ontology_read');
    const ajv=new Ajv2020({strict:true});
    contract.referencedSchemas.forEach(r=>ajv.addSchema(r.value));
    ajv.compile(contract.inputSchema);
    if(contract.exampleInput!==null)validate(contract,contract.exampleInput);
    contract.inputSchema.properties.invented={type:'string'};
    assert.equal(expertGuide(input.topic).contractDigest,contractDigest);
    assert.equal(Object.hasOwn(expertGuide(input.topic).inputSchema.properties,'invented'),false);
  }
  assert.throws(()=>expertGuide('contract:missing.operation'),{code:'NOT_FOUND'});
  const intent=expertGuide('contract:intent.record');
  assert.deepEqual(intent.inputSchema.required,['definition','previousDigest']);
  const invalid={intent:intent.exampleInput.definition,previousDigest:null};
  const check=new Ajv2020().compile(intent.inputSchema);assert.equal(check(invalid),false);
});

test('actual MCP authoring succeeds using only public guide examples and owner-returned identities',async t=>{
  const base=mkdtempSync(join(tmpdir(),'ontology-expert-contracts-')),root=join(base,'owner');
  const cli=fileURLToPath(new URL('../../dist/standalone/cli.js',import.meta.url));
  const initialized=JSON.parse(execFileSync(process.execPath,[cli,'init','--root',root,'--workspace','guide-contracts','--project','demo','--principal','author','--json'],{encoding:'utf8'}));
  assert.equal(initialized.ok,true);const identity=initialized.result;
  const server=await listenStandalone({root,workspaceId:identity.workspaceId,serviceId:identity.serviceId});
  const client=new Client({name:'public-expert-contract-regression',version:'0'});
  t.after(async()=>{await client.close();await server.close();rmSync(base,{recursive:true,force:true});});
  await client.connect(new StreamableHTTPClientTransport(new URL(server.origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+readFileSync(identity.credentialFile,'utf8')}}}));
  const tools=await client.listTools();
  assert.match(tools.tools.find(t=>t.name==='ontology_read').description,/contract:/);
  assert.equal(tools.tools.find(t=>t.name==='ontology_write').annotations.destructiveHint,true);
  const context=(await client.callTool({name:'ontology_context',arguments:{}})).structuredContent.result;
  assert.equal(context.workspaceId,identity.workspaceId);
  let revision=0;
  const call=async(operation,input,write=false)=>{
    const request={workspaceId:context.workspaceId,serviceId:context.serviceId,projectId:'demo',operation,input,
      ...(write?{requestId:'guide-'+operation.replaceAll('.','-'),expectedRevision:revision}:{})};
    const response=await client.callTool({name:write?'ontology_write':'ontology_read',arguments:request});
    assert.equal(response.isError??false,false,JSON.stringify(response));
    const value=response.structuredContent;assert.ok(Object.hasOwn(value,'result'),JSON.stringify(value));
    if(write){revision=value.result.revision;return value.result.result;}
    return value.result;
  };
  const contract=operation=>call('guide.read',{topic:'contract:'+operation});
  const example=async(operation,adapt=x=>x)=>{const guide=await contract(operation),input=adapt(guide.exampleInput);validate(guide,input);return {input,result:await call(operation,input,true)};};
  const first=await call('guide.read',{topic:'first-use'});
  assert.ok(first.inputContracts.some(c=>c.operation==='project.create'));
  await example('project.create');
  const intent=await example('intent.record');
  const admitted=await example('source.admit',x=>({...x,intentDigest:intent.result.intentDigest}));
  const expectations=await example('expectations.record',x=>({definition:{...x.definition,intentDigest:intent.result.intentDigest,sourceSetDigest:admitted.result.sourceSetDigest}}));
  const model=await example('model.record',x=>({draft:{...x.draft,intentDigest:intent.result.intentDigest,sourceSetDigest:admitted.result.sourceSetDigest,expectationsDigest:expectations.result.expectationsDigest}}));
  assert.equal(revision,5);
  const project=await call('project.inspect',{});assert.equal(project.revision,5);assert.equal(project.intentDigest,intent.result.intentDigest);
  const retainedIntent=await call('intent.read',{digest:intent.result.intentDigest});assert.deepEqual(retainedIntent.definition,intent.input.definition);
  const inspected=await call('model.inspect',{assetId:model.input.draft.assetId,modelDigest:model.result.modelDigest});
  assert.equal(inspected.current,true);
  const document=await call('model.document.read',{assetId:model.input.draft.assetId,modelDigest:model.result.modelDigest,documentId:'model',offset:0,maxBytes:65536});
  assert.equal(document.content,model.input.draft.closure.documents[0].content);
  const saved=await call('receipt.read',{requestId:'guide-model-record'});assert.equal(saved.revision,5);assert.equal(saved.result.modelDigest,model.result.modelDigest);
  assert.equal((await call('reasoning.list',{assetId:null,afterTaskId:null,limit:100})).tasks.length,0);
  assert.equal((await call('validation.list',{assetId:null,afterTaskId:null,limit:100})).tasks.length,0);
});
