// Formal product collectors must enter through the actual standards review.
// No source test result, caller-supplied PASS or environment flag bypasses it.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,realpathSync,openSync,closeSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {preflightProductE2E} from '../../../scripts/formal-e2e.mjs';
import {hashBytes,evidenceReader} from '../../../scripts/standards-gate.mjs';

const repository=fileURLToPath(new URL('../../../',import.meta.url));
export function collectorArguments(args){
  assert.equal(args.length,6,'Usage: --evidence ABS_STANDARDS --request REL_REQUEST --output ABS_NEW_OUTPUT');
  assert.deepEqual([args[0],args[2],args[4]],['--evidence','--request','--output']);
  assert(isAbsolute(args[1])&&isAbsolute(args[5]));assert(!isAbsolute(args[3])&&!args[3].split('/').some(x=>!x||x==='.'||x==='..')&&!args[3].includes('\\'));
  return {evidence:args[1],request:args[3],output:args[5]};
}
export async function openCollector(group,entry,args=process.argv.slice(2),dependencies=[]){
  const options=collectorArguments(args);
  // This happens before mkdir, any installation mutation or any product call.
  const admission=await preflightProductE2E(options.evidence,options.request,repository);
  assert.equal(admission.status,'ALLOW_PRODUCT_E2E');
  const reader=evidenceReader(options.evidence,repository),freeze=reader.json('freeze.json'),evaluator=reader.refJson(freeze.evaluator);
  const configuration=evaluator.files.find(x=>x.path==='configuration.json');assert(configuration,'Frozen installed configuration required');
  const config=reader.refJson(configuration),tools=reader.refJson(freeze.toolchain);
  assert.equal(config.runtimeDigest,tools.runtime.digest);assert.equal(config.dl.digest,tools.dl.digest);assert.equal(config.shacl.digest,tools.shacl.digest);
  assert.equal(realpathSync(process.execPath),realpathSync(config.node));assert.equal(process.versions.node,'24.14.0');
  const matrix=JSON.parse(readFileSync(join(repository,'governance/acceptance-v090.json'))),cases=matrix.cases.filter(c=>c.group===group);assert(cases.length);
  const collectorPath=fileURLToPath(entry),relativePath=collectorPath.slice(repository.length);assert(cases.every(c=>c.collector===relativePath),'Collector must own exactly its declared matrix group');
  const root=resolve(options.output);assert(!root.startsWith(repository)&&realpathSync(resolve(root,'..'))===resolve(root,'..'));mkdirSync(root,{mode:0o700});
  const put=(name,value)=>{assert(!isAbsolute(name)&&!name.split('/').some(x=>!x||x==='.'||x==='..'));const p=join(root,name);mkdirSync(resolve(p,'..'),{recursive:true,mode:0o700});const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');writeFileSync(p,bytes,{mode:0o600,flag:'wx'});return {path:name,digest:hashBytes(bytes)};};
  const dependencyFiles=dependencies.map(url=>{const path=fileURLToPath(url);assert(path.startsWith(repository));return {path:path.slice(repository.length),digest:hashBytes(readFileSync(path))};});
  const binding={schema:'ontology-product-collector-binding/v1',group,admission,collector:{path:relativePath,digest:hashBytes(readFileSync(collectorPath))},driverDigest:hashBytes(readFileSync(fileURLToPath(import.meta.url))),dependencyFiles,configurationDigest:configuration.digest,startedAt:new Date().toISOString(),caseIds:cases.map(c=>c.id)};
  const bindingRef=put('binding.json',binding),cli=join(config.runtimeRoot,'node_modules/@evopilot-next/ontology/dist/standalone/cli.js'),trace=[],results=[],fixtures=[];let serial=0;
  function command(args){
    const id=String(++serial).padStart(4,'0'),stdout=join(root,'command-'+id+'.stdout'),stderr=join(root,'command-'+id+'.stderr'),out=openSync(stdout,'wx',0o600),err=openSync(stderr,'wx',0o600);let p;
    try{p=spawnSync(process.execPath,[cli,...args,'--json'],{env:{...process.env,NODE_NO_WARNINGS:'1'},cwd:root,stdio:['ignore',out,err],timeout:120000});}finally{closeSync(out);closeSync(err);}
    const text=readFileSync(stdout,'utf8'),error=readFileSync(stderr,'utf8');assert(Buffer.byteLength(text)<=32*1024*1024&&Buffer.byteLength(error)<=1024*1024);
    const observation={kind:'CLI',args,status:p.status,signal:p.signal,error:p.error?.message??null,stdout:{path:'command-'+id+'.stdout',digest:hashBytes(text)},stderr:{path:'command-'+id+'.stderr',digest:hashBytes(error)}};trace.push(observation);
    assert.ifError(p.error);assert(p.status!==null,'Unknown command outcome; reconcile original owner before continuing');let body;try{body=JSON.parse(text);}catch{throw Error('CLI response missing; inspect '+stdout);}
    return {status:p.status,body};
  }
  const ok=args=>{const r=command(args);assert.equal(r.status,0);assert.equal(r.body.ok,true,JSON.stringify(r.body));return r.body.result;};
  const runtime=ok(['runtime-inspect','--runtime-root',config.runtimeRoot]);assert.equal(runtime.digest,config.runtimeDigest);assert.equal(runtime.version,'0.9.0');
  function fixture(name,native=false){
    assert.match(name,/^[a-z][a-z0-9-]+$/u);const directory=join(root,name);mkdirSync(directory,{mode:0o700});const installation=join(directory,'installation'),workspace=join(directory,'workspace');
    ok(['install','--root',installation,'--workspace-root',workspace,'--workspace',name,'--project','demo','--principal','evaluator','--runtime-root',config.runtimeRoot,'--runtime-digest',config.runtimeDigest,'--mode','create']);
    if(native)ok(['toolchains-bind','--installation',installation,'--request-id','bind','--previous-binding','none','--dl-toolchain',config.dl.path,'--dl-digest',config.dl.digest,'--shacl-toolchain',config.shacl.path,'--shacl-digest',config.shacl.digest,'--systemd-digest',config.systemdDigest]);
    const f={installation,workspace,connection:null,token:null,running:false,tasks:[],cleaned:false,
      start(){ok(['start','--installation',installation]);this.running=true;this.connection=JSON.parse(readFileSync(join(installation,'connection.json')));this.token=readFileSync(this.connection.credentialFile,'utf8');},
      stop(){if(this.running){ok(['stop','--installation',installation]);this.running=false;}},
      async request(operation,input={},write=null,overrides={},credential=null){
        const c=this.connection;assert(c);const body={workspaceId:c.workspaceId,serviceId:c.serviceId,projectId:c.projectId,operation,input,...(write??{}),...overrides};
        const response=await fetch(c.origin+'/v1/request',{method:'POST',headers:{authorization:'Bearer '+(credential??this.token),'content-type':'application/json',connection:'close'},body:JSON.stringify(body),signal:AbortSignal.timeout(65000)});
        const text=await response.text();assert(Buffer.byteLength(text)<=32*1024*1024);const value=JSON.parse(text);trace.push({kind:'HTTP',request:body,status:response.status,body:value});return {status:response.status,body:value};
      }};fixtures.push(f);f.start();return f;
  }
  function closeFixture(f){
    f.stop();if(f.cleaned)return;
    for(const taskId of f.tasks){const plan=ok(['worker-maintenance-inspect','--installation',f.installation,'--project','demo','--task',taskId]);if(plan.status==='COMPLETED'||plan.status==='NOT_NEEDED')continue;ok(['worker-maintenance-apply','--installation',f.installation,'--project','demo','--task',taskId,'--request-id',plan.requestId??'maint-'+taskId,'--expected-report',plan.reportDigest]);}
    f.cleaned=true;
  }
  return {root,repository,admission,config,cases,put,command,ok,fixture,
    frozen(name){const ref=evaluator.files.find(f=>f.path===name);assert(ref,'Input must belong to the frozen evaluator inventory');return reader.refJson(ref);},
    support(name){const manifest=reader.json('product-inputs.json');assert.equal(manifest.schema,'ontology-private-product-support/v1');assert(Array.isArray(manifest.files)&&manifest.files.length<=1000);const refs=manifest.files.filter(f=>f.id===name);assert.equal(refs.length,1,'Exact supplemental evidence required');const value=reader.refJson(refs[0].file);trace.push({kind:'SUPPORTING_EVIDENCE',id:name,file:refs[0].file,value});return value;},
    observe(value){trace.push(value);},
    async case(id,run){
      assert(cases.some(c=>c.id===id)&&!results.some(r=>r.id===id));const from=trace.length,startedAt=new Date().toISOString();let status='PASS',comparison;
      try{comparison=await run();assert(comparison&&typeof comparison.expected==='string','Explicit original expectation required');for(const f of fixtures)closeFixture(f);}catch(e){status='FAIL';comparison={error:e.message};}
      const observation=put(id+'/observation.json',{schema:'ontology-product-case-observation/v1',id,origin:cases.find(c=>c.id===id).requiredOrigin,candidateDigest:admission.bindings.candidateDigest,admissionDecisionDigest:admission.decisionDigest,collectorBinding:bindingRef,startedAt,completedAt:new Date().toISOString(),trace:trace.slice(from)});
      results.push({id,status,observation,comparison:put(id+'/comparison.json',{schema:'ontology-product-case-comparison/v1',id,status,...comparison})});
      if(status!=='PASS')throw Error(id+' failed; original evidence retained');
    },
    async finish(problem=null){
      const cleanupErrors=[];for(const f of fixtures){try{f.stop();}catch(e){cleanupErrors.push(e.message);}}for(const f of fixtures){try{closeFixture(f);}catch(e){cleanupErrors.push(e.message);}}const cleanup=cleanupErrors.length?cleanupErrors:null;
      for(const c of cases)if(!results.some(r=>r.id===c.id))results.push({id:c.id,status:'NOT_RUN',reason:'Collector stopped before this original case'});
      reader.recheck();const recheck=await preflightProductE2E(options.evidence,options.request,repository);assert.deepEqual(recheck,admission);
      const result={schema:'ontology-product-group-result/v1',group,candidateDigest:admission.bindings.candidateDigest,binding:bindingRef,completedAt:new Date().toISOString(),cases:results,problem,cleanup,status:!problem&&!cleanup&&results.every(r=>r.status==='PASS')?'PASS':'FAILED',releaseAuthorized:false};put('result.json',result);console.log(JSON.stringify({group,status:result.status,cases:results.length,problem,cleanup}));if(result.status!=='PASS')process.exitCode=1;return result;
    }};
}
