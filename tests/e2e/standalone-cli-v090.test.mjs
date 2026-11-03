import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,writeFileSync,rmSync,chmodSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile,spawn} from 'node:child_process';
import {once} from 'node:events';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {readFileSync} from 'node:fs';

const cli=fileURLToPath(new URL('../../dist/standalone/cli.js',import.meta.url));
function run(args,entry=cli){return new Promise((resolve,reject)=>execFile(process.execPath,[entry,...args,'--json'],{timeout:8000,maxBuffer:1024*1024},(error,stdout,stderr)=>{
  try{resolve({status:error?.code??0,...JSON.parse(stdout)});}catch{reject(new Error('CLI returned no typed response: '+stderr));}
}));}
test('installed-style bin symlink invokes the compiled operator entry',async t=>{
  const base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-bin-'))),entry=join(base,'evopilot-ontology');
  t.after(()=>rmSync(base,{recursive:true,force:true}));symlinkSync(cli,entry);
  const result=await run(['init','--root',join(base,'state'),'--workspace','symlink','--project','demo','--principal','user'],entry);
  assert.equal(result.ok,true);assert.equal(result.result.workspaceId,'symlink');
});
async function setup(t){
  const base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-cli-'))),root=join(base,'workspace');
  const initialized=await run(['init','--root',root,'--workspace','cli','--project','demo','--principal','operator']);
  assert.equal(initialized.ok,true);const setup=initialized.result;
  const child=spawn(process.execPath,[cli,'serve','--root',root,'--workspace',setup.workspaceId,'--service',setup.serviceId,'--json'],{stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',v=>stderr+=v);
  let stopped=false;
  const stop=async()=>{if(stopped)return;stopped=true;const exit=once(child,'exit');child.kill('SIGTERM');await exit;};
  t.after(async()=>{await stop();rmSync(base,{recursive:true,force:true});});
  const started=await new Promise((resolve,reject)=>{
    let stdout='';const timer=setTimeout(()=>reject(new Error('Serve startup timeout: '+stderr)),5000);timer.unref();
    child.stdout.on('data',v=>{stdout+=v;if(stdout.includes('\n')){clearTimeout(timer);resolve(JSON.parse(stdout.split('\n')[0]).result);}});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error('Serve exited '+code+' '+stderr));});
  });
  const connection=join(base,'connection.json');writeFileSync(connection,JSON.stringify({schema:'ontology-connection/v1',origin:started.origin,workspaceId:setup.workspaceId,serviceId:setup.serviceId,projectId:'demo',credentialFile:setup.credentialFile}),{mode:0o600});
  const input=(name,data)=>{const path=join(base,name+'.json');writeFileSync(path,JSON.stringify(data));return path;};
  return {base,root,setup,started,connection,input,stop};
}

test('actual CLI init/serve/client and MCP share retained writes; shut down never triggers replay',async t=>{
  const f=await setup(t);
  assert.equal((await run(['context','--connection',f.connection])).result.project,null);
  const input=f.input('create',{label:'CLI-created project'});
  const args=['write','--connection',f.connection,'--operation','project.create','--input',input,'--request-id','create','--expected-revision','0'];
  const first=await run(args);assert.equal(first.result.revision,1);assert.equal(first.status,0);
  assert.deepEqual(await run(args),first);
  const c=new Client({name:'cli-readback',version:'0'});
  await c.connect(new StreamableHTTPClientTransport(new URL(f.started.mcpUrl),{requestInit:{headers:{authorization:'Bearer '+readFileSync(f.setup.credentialFile,'utf8')}}}));
  const call=(operation,input)=>c.callTool({name:'ontology_read',arguments:{workspaceId:f.setup.workspaceId,serviceId:f.setup.serviceId,projectId:'demo',operation,input}});
  try{
    assert.deepEqual((await call('receipt.read',{requestId:'create'})).structuredContent.result,first.result);
    const guide=(await call('guide.read',{topic:'first-use'})).structuredContent.result;
    assert.equal(guide.authority,false);assert.ok(guide.operations.includes('project.create'));
  }finally{await c.close();}
  const inspect=await run(['context','--connection',f.connection]);assert.equal(inspect.result.project.revision,1);
  await f.stop();
  const unknown=await run(args);assert.equal(unknown.ok,false);assert.equal(unknown.error.code,'REQUEST_UNKNOWN');
});

test('CLI refuses remote credential destinations, unknown operations and invalid write flags before dispatch',async t=>{
  const f=await setup(t);
  const invalid=await run(['read','--connection',f.connection,'--operation','project.create']);assert.equal(invalid.error.code,'UNSUPPORTED_OPERATION');
  const missing=await run(['write','--connection',f.connection,'--operation','project.create']);assert.equal(missing.error.code,'INVALID_ARGUMENTS');
  const large=f.input('oversize',{label:'x'.repeat(600000)});
  assert.equal((await run(['write','--connection',f.connection,'--operation','project.create','--input',large,'--request-id','oversize','--expected-revision','0'])).error.code,'INPUT_LIMIT');
  const occupied=await run(['init','--root',f.root,'--workspace','other','--project','other','--principal','operator']);assert.equal(occupied.error.code,'WORKSPACE_EXISTS');
  const original=JSON.parse(readFileSync(f.connection,'utf8'));
  for(const origin of ['https://example.invalid','http://localhost:1234','http://127.0.0.1:65536','http://user@127.0.0.1:1234']){
    writeFileSync(f.connection,JSON.stringify({...original,origin}));
    assert.equal((await run(['context','--connection',f.connection])).error.code,'UNSAFE_CONNECTION');
  }
  writeFileSync(f.connection,JSON.stringify(original));chmodSync(f.connection,0o644);
  assert.equal((await run(['context','--connection',f.connection])).error.code,'UNSAFE_PATH');
  chmodSync(f.connection,0o600);
  assert.equal((await run(['context','--connection',f.connection])).result.project,null);
});
