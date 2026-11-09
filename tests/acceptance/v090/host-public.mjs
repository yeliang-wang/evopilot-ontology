// Inspect retained actual Codex execution, not an assistant-written PASS summary.
// The operator must capture these records from the real Host before invoking a
// collector. User message identity still requires independent Host verification;
// a JSON document cannot authenticate a human instruction on its own.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {openCollector} from './public-collector.mjs';
import {hashBytes} from '../../../scripts/standards-gate.mjs';
import {hash} from '../../../dist/standalone/validation.js';
import {verifyPublishedInstallation} from './published-installation.mjs';

export function selectModelEntailmentChange(session,beforeModelDigest,afterModelDigest){
  assert.notEqual(beforeModelDigest,afterModelDigest);
  const unknown=session.task('reasoning','NOT_ENTAILED',v=>v.modelDigest===beforeModelDigest);
  const mapped=session.task('reasoning','ENTAILED',v=>v.modelDigest===afterModelDigest&&isDeepStrictEqual(v.result?.result?.queryAxioms,unknown.value.result.result.queryAxioms));
  assert.deepEqual(mapped.start.call.arguments.input.task.query,unknown.start.call.arguments.input.task.query);
  return {unknown,mapped};
}

export function validateCompletedHostCall(call,recovery=null){
  assert(['completed','failed'].includes(call.status),'Actual Host call did not finish');
  assert.equal(call.error,null,'Host transport failure is not a domain refusal');
  if(call.status==='failed'){
    assert.equal(call.server,'evopilot-ontology');
    const value=call.result?.structured_content;
    // MCP validates required scope before dispatching a guide read to the owner.
    // Retain that rejected call, but accept recovery only when the next call is
    // the identical read with the complete, correct owner scope and a result.
    if(value===null&&call.tool==='ontology_read'&&call.arguments?.operation==='guide.read'){
      const keys=['workspaceId','serviceId','projectId'],missing=keys.filter(k=>!Object.hasOwn(call.arguments,k));
      assert(missing.length,'A protocol rejection must identify an actually missing scope');
      assert.deepEqual(Object.keys(call.arguments).sort(),['operation','input',...keys.filter(k=>!missing.includes(k))].sort());
      assert.deepEqual(call.result.content,[{type:'text',text:'Input validation error: Invalid arguments for tool ontology_read: '+missing.map(k=>"data must have required property '"+k+"'").join(', ')}]);
      assert(recovery?.call&&recovery.scope,'A rejected guide read needs its original successful recovery');
      const next=recovery.call;
      assert.equal(next.server,call.server);assert.equal(next.tool,call.tool);assert.equal(next.status,'completed');
      for(const k of keys){assert.equal(typeof recovery.scope[k],'string');assert(recovery.scope[k].length);if(!missing.includes(k))assert.equal(call.arguments[k],recovery.scope[k]);}
      assert.deepEqual(next.arguments,{...call.arguments,...recovery.scope});
      validateCompletedHostCall(next);
      return 'RECOVERED_MCP_GUIDE_SCOPE_REJECTION';
    }
    assert(value&&value.error&&!Object.hasOwn(value,'result'),'Failed Host call needs the original structured owner refusal');
    assert.equal(typeof value.error.code,'string');assert(value.error.code.length);
    assert.equal(typeof value.error.message,'string');
  }else if(call.server==='evopilot-ontology'){
    assert(call.result?.structured_content&&!call.result.structured_content.error);
    assert(Object.hasOwn(call.result.structured_content,'result'));
  }
}

export async function openHostCollector(group,entry,dependencies=[]){
  const c=await openCollector(group,entry,process.argv.slice(2),[import.meta.url,new URL('./published-installation.mjs',import.meta.url),...dependencies]),sessions=new Map();
  let hostConfig=group==='FINAL'?null:c.config;
  const json=ref=>JSON.parse(c.evidenceReference(ref));
  function session(id){
    assert(hostConfig,'The fresh published installation must be independently verified first');
    if(sessions.has(id))return sessions.get(id);
    const record=c.support('host-'+id);assert.equal(record.schema,'ontology-private-actual-host-session/v1');assert.equal(record.candidateDigest,c.admission.bindings.candidateDigest);assert.equal(record.admissionDecisionDigest,c.admission.decisionDigest);assert(Date.parse(record.startedAt)>=Date.parse(c.admission.reviewedAt));assert(Date.parse(record.completedAt)>=Date.parse(record.startedAt));
    assert.equal(record.host.name,'Codex');for(const key of ['version','provider','model'])assert.equal(typeof record.host[key],'string');assert.match(record.host.executableDigest,/^sha256:[a-f0-9]{64}$/);
    const invocation=json(record.invocation),process=json(record.process),prompt=c.evidenceReference(record.prompt).toString(),stdout=c.evidenceReference(record.stdout).toString();assert.equal(hashBytes(prompt),invocation.promptDigest);assert.equal(process.exitCode,0);assert.equal(process.ownedChildWaited,true);assert.equal(process.problem,null);assert.equal(process.dailyConfigUnchanged,true);assert.equal(invocation.authCopied,false);
    assert(Array.isArray(invocation.argv)&&invocation.argv.length);assert(!invocation.argv.some(x=>/^(--yolo|--dangerously-bypass-approvals-and-sandbox)$/.test(x)));
    const events=stdout.trim().split('\n').map(s=>JSON.parse(s));assert(events.some(e=>e.type==='thread.started'));assert(events.some(e=>e.type==='turn.completed'));assert(!events.some(e=>['error','turn.failed'].includes(e.type)));
    const threadIds=[...new Set(events.filter(e=>e.type==='thread.started').map(e=>e.thread_id))];assert.equal(threadIds.length,1);assert.equal(threadIds[0],record.threadId);
    const items=events.filter(e=>e.type==='item.completed').map(e=>e.item),calls=items.filter(i=>i.type==='mcp_tool_call'),writes=calls.filter(i=>i.tool==='ontology_write');
    const protocolRejections=new Set();
    for(const [index,call] of calls.entries()){
      const classification=validateCompletedHostCall(call,{call:calls[index+1],scope:record.scope});
      if(classification){protocolRejections.add(call);c.observe({kind:classification,sessionId:id,rejectedCall:call,recoveredCall:calls[index+1],ownerOperationExecutedByRejectedCall:false});continue;}
      if(call.tool!=='ontology_context'&&call.server==='evopilot-ontology'&&!call.result?.structured_content?.error){assert.equal(call.arguments.workspaceId,record.scope.workspaceId);assert.equal(call.arguments.serviceId,record.scope.serviceId);assert.equal(call.arguments.projectId,record.scope.projectId);}
    }
    const value=call=>{assert.equal(call.result?.is_error??false,false);const content=call.result?.structured_content;assert(content&&!content.error,'Actual MCP result required');assert(Object.hasOwn(content,'result'));return content.result;};
    const results=operation=>calls.filter(i=>!protocolRejections.has(i)&&(i.tool==='ontology_context'?operation==='ontology_context':i.arguments?.operation===operation)&&!(i.result?.is_error||i.result?.structured_content?.error)).map(i=>({call:i,value:value(i)}));
    const refused=(operation,code)=>{const matches=calls.filter(i=>i.arguments?.operation===operation&&i.result?.structured_content?.error?.code===code);assert(matches.length,'Actual refusal absent: '+operation+'/'+code);return matches.at(-1);};
    const contexts=results('ontology_context');if(record.selected){assert(contexts.length);for(const {value:v} of contexts){assert.equal(v.product,'evopilot-ontology');assert.equal(v.productVersion,'0.9.0');assert.equal(v.workspaceId,record.scope.workspaceId);assert.equal(v.serviceId,record.scope.serviceId);assert(v.projectIds.includes(record.scope.projectId));assert.equal(v.authority,false);if(record.requiresNative){assert.equal(v.toolchainDigest,hostConfig.dl.digest);assert.equal(v.shaclToolchainDigest,hostConfig.shacl.digest);}}}
    const answers=items.filter(i=>i.type==='agent_message').map(i=>i.text).join('\n');assert(answers.length);
    const one=(operation,predicate=()=>true)=>{const matches=results(operation).filter(x=>predicate(x.value,x.call));assert(matches.length,'Actual Host call absent: '+id+'/'+operation);return matches.at(-1);};
    const task=(kind,status,predicate=()=>true)=>{const x=one(kind+'.inspect',(v,i)=>v.state==='FINISHED'&&v.formalStatus===status&&predicate(v,i));assert.equal(x.value.complete,true);assert(x.value.result,'Full formal result must be observed; paginated tasks need a separate complete capture');assert.equal(x.value.result.complete,true);assert.equal(x.value.result.error,null);assert.equal(hash(x.value.result),x.value.resultDigest);if(kind==='reasoning')assert.equal(x.value.result.toolchainDigest,hostConfig.dl.digest);const start=one(kind+'.start',v=>v.result.taskId===x.value.taskId);assert.equal(start.call.arguments.input.modelDigest,x.value.modelDigest);return {...x,start};};
    const page=(operation,predicate=()=>true)=>{const matches=results(operation).filter(x=>predicate(x.value,x.call));assert(matches.length);let offset=0,content='',identity=null,done=false;for(const {value:v} of matches){if(v.offset!==offset)continue;if(identity===null)identity=v.documentDigest??v.resultDigest??v.projectionDigest??null;assert.equal(v.documentDigest??v.resultDigest??v.projectionDigest??null,identity);content+=v.content;done=v.complete||v.nextOffset===null;if(done)break;assert(v.nextOffset>offset);offset=v.nextOffset;}assert(done,'Incomplete Host document pagination');return {content,value:JSON.parse(content),identity};};
    const result={record,invocation,process,prompt,items,calls,writes,answers,results,one,task,page,value,refused};sessions.set(id,result);return result;
  }
  function userDecision(id,candidateDigest,reportDigest,decision){
    const d=c.support('semantic-decision-'+id);assert.equal(d.schema,'ontology-private-actual-semantic-decision/v1');assert.equal(d.candidateDigest,candidateDigest);assert.equal(d.reportDigest,reportDigest);assert.equal(d.decision,decision);assert.equal(d.softwareReleaseAuthorized,false);const source=json(d.source);assert.equal(source.role,'user');for(const key of ['threadId','turnId','messageId','text'])assert(source[key]);assert.equal(source.action,decision);assert.equal(source.bindings.candidateDigest,candidateDigest);assert.equal(source.bindings.reportDigest,reportDigest);assert(Date.parse(source.occurredAt)>=Date.parse(d.reportPresentedAt));return {record:d,source};
  }
  async function readback(s,operation,input){
    const owner=c.support('host-owner-'+s.record.scope.serviceId);assert.equal(owner.schema,'ontology-private-host-owner/v1');assert.equal(owner.runtimeDigest,hostConfig.runtimeDigest);assert(isAbsolute(owner.installation));const binding=c.ok(['toolchains-inspect','--installation',owner.installation]);assert.equal(binding.binding.runtimeDigest,hostConfig.runtimeDigest);const connection=JSON.parse(readFileSync(join(owner.installation,'connection.json')));for(const k of ['workspaceId','serviceId','projectId'])assert.equal(connection[k],s.record.scope[k]);const token=readFileSync(connection.credentialFile,'utf8');
    const request={...s.record.scope,operation,input},response=await fetch(connection.origin+'/v1/request',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(65000)}),body=await response.json();c.observe({kind:'INDEPENDENT_ACTUAL_HOST_OWNER_READBACK',request,status:response.status,body});assert.equal(response.status,200);assert.equal(body.ok,true);return body.result;
  }
  function operator(id){
    const record=c.support('operator-'+id);assert.equal(record.schema,'ontology-private-installed-operator-trace/v1');assert.equal(record.candidateDigest,c.admission.bindings.candidateDigest);assert.equal(record.admissionDecisionDigest,c.admission.decisionDigest);assert(record.steps.length);
    const steps=record.steps.map(step=>{assert(Date.parse(step.startedAt)>=Date.parse(c.admission.reviewedAt));assert(Date.parse(step.completedAt)>=Date.parse(step.startedAt));assert.equal(step.argv[0],c.config.node);assert.equal(step.argv[1],join(hostConfig.runtimeRoot,'node_modules/@evopilot-next/ontology/dist/standalone/cli.js'));assert(step.argv.includes('--json'));const stdout=c.evidenceReference(step.stdout).toString(),stderr=c.evidenceReference(step.stderr).toString(),body=JSON.parse(stdout);assert.equal(step.exitCode===0,body.ok===true);c.observe({kind:'ORIGINAL_INSTALLED_OPERATOR_COMMAND',...step,body,stderr});return {...step,body};});
    return {record,steps,one(action,predicate=()=>true){const matches=steps.filter(s=>s.argv[2]===action&&predicate(s.body,s));assert(matches.length,'Original operator command absent: '+action);return matches.at(-1);}};
  }
  return Object.assign(c,{session,userDecision,readback,operator,evidenceJSON:json,selectPublishedInstallation(){assert.equal(group,'FINAL');assert.equal(sessions.size,0);const verified=verifyPublishedInstallation(c);if(hostConfig)assert.deepEqual(verified,hostConfig);hostConfig=verified;return verified;}});
}
