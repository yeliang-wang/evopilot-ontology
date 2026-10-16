import { syntheticDecisionEvidence } from '../fixtures/native/decision-evidence.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,writeFileSync,rmSync,realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createOntologyService } from '../../dist/service.js';
import { validateNativeOntology,validateOntologyPackage } from '../../dist/index.js';
import { nativePackage,rehash } from '../fixtures/native/package.mjs';
const config=process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN;
function tools(){assert(config,'EVOPILOT_TEST_NATIVE_TOOLCHAIN must name a verified installed toolchain; native E2E never skips missing tools');return JSON.parse(readFileSync(config,'utf8'));}
const scope={visibility:'private',projectId:'synthetic'},testRoots=new WeakMap();
function create(){const parent=realpathSync(mkdtempSync(join(tmpdir(),'ontology-native-'))),workspaceRoot=join(parent,'state-root');const options={workspaceRoot,workspaceId:'synthetic'};const service=createOntologyService(options,{nativeToolchain:tools()});service.initialize();testRoots.set(service,parent);return {parent,options,service};}
function revision(s){return s.execute({operation:'workspace.inspect',scope,input:{}}).revision;}
function mutate(s,operation,input,requestId){if(input.humanEvidenceRef?.startsWith('synthetic'))input={...input,humanEvidenceRef:syntheticDecisionEvidence(testRoots.get(s),{owner:'ontology',operation,workspaceId:'synthetic',scope,reviewDigest:input.reviewDigest,decision:input.decision})};return s.native({operation,scope,input,requestId,expectedRevision:revision(s)});}
test('O01/C04/M02: actual native lifecycle, exact review decision, immutable readback and restart',async()=>{
 const {parent,options,service:s}=create();let restarted;
 try{
  const pkg=nativePackage(),identity={id:pkg.manifest.id,version:pkg.manifest.version};
  await mutate(s,'native.package.put',{package:pkg},'put');
  await assert.rejects(mutate(s,'native.package.review',identity,'review-too-early'),{code:'VALIDATION_REQUIRED'});
  const validation=await mutate(s,'native.package.validate',identity,'validate');assert.equal(validation.result.status,'CONFORMS');assert.equal(validation.result.caseReports.length,7);assert.equal(validation.result.criteria.length,7);assert(validation.result.criteria.every(c=>c.criterionId==='scope'&&c.status==='PASS'));assert.deepEqual(validation.result.criteria.map(c=>c.variantId),validation.result.caseReports.map(c=>c.id));assert.equal(validation.result.process.exitCode,0);
  assert.deepEqual(await mutate(s,'native.package.validate',identity,'validate'),validation);
  const review=await mutate(s,'native.package.review',identity,'review');
  await assert.rejects(mutate(s,'native.package.publish',identity,'publish-early'),{code:'APPROVAL_REQUIRED'});
  await assert.rejects(s.native({operation:'native.package.decide',scope,input:{...identity,reviewDigest:review.result.reviewDigest,decision:'APPROVE',humanEvidenceRef:'synthetic-forged-no-evidence'},requestId:'forged-decision',expectedRevision:revision(s)}),{code:'HUMAN_EVIDENCE_REQUIRED'});
  const decided=await mutate(s,'native.package.decide',{...identity,reviewDigest:review.result.reviewDigest,decision:'APPROVE',humanEvidenceRef:'synthetic-test-decision-not-real-user'},'decide');
  const approval=JSON.parse(readFileSync(new URL(decided.result.humanEvidenceRef),'utf8')),source=new URL(approval.source.reference),approvedBytes=readFileSync(source);writeFileSync(source,'changed');
  await assert.rejects(mutate(s,'native.package.publish',identity,'publish-drift'),{code:'HUMAN_EVIDENCE_REQUIRED'});writeFileSync(source,approvedBytes);
  const published=await mutate(s,'native.package.publish',identity,'publish');assert.equal(published.result.reference.standardDigest,pkg.manifest.standardPins.standardDigest);
  await assert.rejects(mutate(s,'native.package.put',{package:pkg},'overwrite'),{code:'IMMUTABLE_VERSION'});
  writeFileSync(source,'changed after immutable publication');
  s.close();restarted=createOntologyService(options,{nativeToolchain:tools()});restarted.initialize();
  const record=await restarted.native({operation:'native.package.readback',scope,input:identity});assert.deepEqual(record.package,pkg);assert.deepEqual(record.reference,published.result.reference);
  assert.deepEqual(await restarted.native({operation:'native.receipt.inspect',scope,input:{requestId:'validate'}}),validation);
  const db=new DatabaseSync(join(options.workspaceRoot,'state/ontology/ontology.db'));assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);db.close();
 }finally{s.close();restarted?.close();rmSync(parent,{recursive:true,force:true});}
});
test('C05: runtime context is retained by the actual owner; wrong scope is refused',async()=>{
 const {parent,service:s}=create();try{
  const pkg=nativePackage(),identity={id:pkg.manifest.id,version:pkg.manifest.version};await mutate(s,'native.package.put',{package:pkg},'put');
  const d='sha256:'+'1'.repeat(64),context={workspaceId:'synthetic',scope,projectCandidateDigest:d,claimId:'claim-1',inputDigest:d,effectiveConfigDigest:d,sourceScopeDigest:d,requirementSetDigest:d};
  await assert.rejects(mutate(s,'native.package.validate',{...identity,context:{...context,workspaceId:'foreign'}},'wrong-context'),{code:'SCOPE_MISMATCH'});
  const receipt=await mutate(s,'native.package.validate',{...identity,context},'validate-context');assert.equal(receipt.result.status,'CONFORMS');assert.deepEqual(receipt.result.context,context);
 }finally{s.close();rmSync(parent,{recursive:true,force:true});}
});
test('O02/O03/O04/O05/O07/O08/O12: product native engine rejects concrete mutations',async()=>{
 const toolchain=tools();
 const cases=[
  ['missing-type',p=>p.files['instances/current.ttl']=p.files['instances/current.ttl'].replace('ex:query a ex:Capability;','ex:query'),'NONCONFORMING'],
  ['missing-object',p=>p.files['instances/current.ttl']=p.files['instances/current.ttl'].replace('ex:query a ex:Capability; ex:kind "QUERY"; ex:operation "search"; ex:limit 5 .',''),'NONCONFORMING'],
  ['missing-relation',p=>p.files['instances/current.ttl']=p.files['instances/current.ttl'].replace('ex:hasCapability ex:engine, ex:query','ex:hasCapability ex:engine'),'NONCONFORMING'],
  ['combination',p=>p.files['instances/current.ttl']=p.files['instances/current.ttl'].replace('ex:operation "execute"','ex:operation "search"'),'NONCONFORMING'],
  ['range',p=>p.files['instances/current.ttl']=p.files['instances/current.ttl'].replace('ex:limit 3','ex:limit 11'),'NONCONFORMING'],
  ['typo',p=>p.files['shapes/domain.ttl']=p.files['shapes/domain.ttl'].replaceAll('sh:minCount','sh:minCounnt'),'UNSUPPORTED'],
  ['js',p=>p.files['shapes/domain.ttl']+='\nex:CapabilityShape sh:js ex:JS .','UNSUPPORTED'],
  ['recursion',p=>p.files['shapes/domain.ttl']+='\nex:CapabilityShape sh:node ex:CapabilityShape .','UNSUPPORTED'],
  ['imports',p=>p.files['model.ttl']+='\nex:ontology owl:imports <https://example.invalid/remote> .','UNSUPPORTED'],
  ['deactivation',p=>p.files['shapes/domain.ttl']+='\nex:CapabilityShape sh:deactivated true .','NONCONFORMING'],
  ['empty-shapes',p=>p.files['shapes/domain.ttl']='','NONCONFORMING'],
  ['meta-definition',p=>p.files['model.ttl']=p.files['model.ttl'].replace('rdfs:comment "Synthetic capability";',''),'NONCONFORMING'],
  ['wrong-negative',p=>p.files['tests/limit.ttl']=p.files['tests/positive.ttl'],'NONCONFORMING'],
  ['malformed-rdf',p=>p.files['instances/current.ttl']='@prefix : <https://example.invalid/> . :x :p [ .','ERROR'],
 ];
 for(const [id,change,expected] of cases){const pkg=nativePackage();change(pkg);rehash(pkg);validateOntologyPackage(pkg);const actual=await validateNativeOntology(pkg,toolchain);assert.equal(actual.status,expected,id);assert.notEqual(actual.status,'CONFORMS',id);}
});
test('S05: no fallback on wrong tool bytes; retired operations cannot produce new assets',async()=>{
 const {parent,service:s}=create();try{
  assert.throws(()=>s.execute({operation:'asset.put',scope,input:{model:{}},requestId:'old-put',expectedRevision:0}),{code:'HISTORICAL_READ_ONLY'});
  const toolchain=tools();toolchain.tools.python.sha256='0'.repeat(64);await assert.rejects(validateNativeOntology(nativePackage(),toolchain),{code:'TOOLCHAIN_DRIFT'});
 }finally{s.close();rmSync(parent,{recursive:true,force:true});}
});

test('C02/C05: public owner validation binds a private consumer; private cross-project remains denied',async()=>{
 const {parent,service:s}=create();try{
  const pkg=nativePackage({visibility:'public'}),owner={visibility:'public',projectId:'shared'},identity={id:pkg.manifest.id,version:pkg.manifest.version};
  const d='sha256:'+'2'.repeat(64),context={workspaceId:'synthetic',scope,projectCandidateDigest:d,claimId:'public-consumer',inputDigest:d,effectiveConfigDigest:d,sourceScopeDigest:d,requirementSetDigest:d};
  const call=(operation,input,requestId)=>s.native({operation,scope:owner,input,requestId,expectedRevision:revision(s)});
  await call('native.package.put',{package:pkg},'public-put');
  const receipt=await call('native.package.validate',{...identity,context},'public-validate');assert.equal(receipt.result.status,'CONFORMS');assert.deepEqual(receipt.result.context,context);assert.deepEqual(receipt.scope,owner);
  const privatePkg=nativePackage();await mutate(s,'native.package.put',{package:privatePkg},'private-put');
  await assert.rejects(mutate(s,'native.package.validate',{...identity,context:{...context,scope:{...scope,projectId:'foreign'}}},'cross-private'),{code:'SCOPE_MISMATCH'});
 }finally{s.close();rmSync(parent,{recursive:true,force:true});}
});

test('O08/O09: restricted local SELECT detects state contradiction and rejects remote/dataset/query extensions',async()=>{
 const toolchain=tools(),query='SELECT $this WHERE { $this <https://example.invalid/r1/phase> "bad" }';
 for(const [name,select,expected] of [
  ['local',query,'CONFORMS'],
  ['SERVICE','SELECT $this WHERE { SERVICE <https://example.invalid/> { $this ?p ?o } }','UNSUPPORTED'],
  ['FROM','SELECT $this FROM <https://example.invalid/> WHERE { $this ?p ?o }','UNSUPPORTED'],
  ['GRAPH','SELECT $this WHERE { GRAPH ?g { $this ?p ?o } }','UNSUPPORTED'],
  ['VALUES','SELECT $this WHERE { VALUES $this { <https://example.invalid/> } }','UNSUPPORTED'],
  ['MINUS','SELECT $this WHERE { $this ?p ?o MINUS { $this ?q ?z } }','UNSUPPORTED'],
  ['malformed','SELECT {','ERROR']
 ]){const p=nativePackage();p.files['shapes/domain.ttl']+='\nex:ProjectShape sh:sparql [ sh:select '+JSON.stringify(select)+' ] .';rehash(p);const result=await validateNativeOntology(p,toolchain);assert.equal(result.status,expected,name);if(name==='local'){p.files['instances/current.ttl']+='\nex:project ex:phase "bad" .';rehash(p);const wrong=await validateNativeOntology(p,toolchain);assert.equal(wrong.status,'NONCONFORMING');assert(wrong.rawReport.includes('SPARQLConstraintComponent'));}}
});
test('O11: close during actual validation becomes UNKNOWN on restart; replay never launches a second attempt',async()=>{
 const {parent,options,service:s}=create();let next;try{
  const p=nativePackage(),id={id:p.manifest.id,version:p.manifest.version};await mutate(s,'native.package.put',{package:p},'put');
  const running=mutate(s,'native.package.validate',id,'interrupted');s.close();await assert.rejects(running,{code:'CLOSED'});
  next=createOntologyService(options,{nativeToolchain:tools()});next.initialize();const inspect=()=>next.native({operation:'native.package.inspect',scope,input:id});
  assert.equal((await inspect()).claim.status,'UNKNOWN');const before=revision(next),pending=await mutate(next,'native.package.validate',id,'interrupted');assert.equal(pending.result.status,'RUNNING');assert.equal(revision(next),before);assert.equal((await inspect()).claim.attempt,1);
  const reconciled=await mutate(next,'native.package.reconcile',id,'reconcile');assert.equal(reconciled.result.claim.status,'UNKNOWN');assert.equal(reconciled.result.redispatched,false);
  const retried=await mutate(next,'native.package.validate',id,'new-reviewed-attempt');assert.equal(retried.result.status,'CONFORMS');assert.equal((await inspect()).claim.attempt,2);
 }finally{s.close();next?.close();rmSync(parent,{recursive:true,force:true});}
});
