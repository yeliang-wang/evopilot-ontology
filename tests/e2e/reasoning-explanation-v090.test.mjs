import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,cpSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDLRunner} from '../../dist/reasoning/runner.js';
import {readDLToolchain} from '../../dist/reasoning/toolchain.js';
import {closureDigest} from '../../dist/reasoning/request.js';
import {hash,hashBytes} from '../../dist/standalone/validation.js';
import {sha,query,document,request,declaration,readonly,keyed} from '../fixtures/v090/reasoning.mjs';

// Actual-toolchain development regression. These fixtures do not replace the
// fixed reference workload, formal acceptance, or the installed resource proof.
let base,binding,runner,sequence=0;
before(()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN,'Select an actual installed DL toolchain with EVOPILOT_TEST_DL_TOOLCHAIN; this suite has no mock or skip fallback');
  const selected=readDLToolchain(process.env.EVOPILOT_TEST_DL_TOOLCHAIN);
  assert.equal(selected.workerSourceDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/Worker.java',import.meta.url))),'Installed worker must match the current source');
  assert.equal(selected.dependencyLockDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/dependencies.json',import.meta.url))));
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-dl-explanation-')));
  const root=join(base,'runtime');cpSync(selected.root,root,{recursive:true});chmodSync(root,0o700);
  const {digest:_,...identity}={...selected,root};binding={...identity,digest:hash(identity)};
  const toolchainFile=join(root,'toolchain.json');writeFileSync(toolchainFile,JSON.stringify(binding),{mode:0o600});
  const workRoot=join(base,'worker');mkdirSync(workRoot,{mode:0o700});runner=createDLRunner({toolchainFile,workRoot});
});
after(()=>{if(base)rmSync(base,{recursive:true,force:true});});

function input(body,task){return request(body,task,'explanation-regression-'+(++sequence));}
async function execute(value,status='COMPLETED'){
  const result=await runner.run(value);
  assert.equal(result.status,status,JSON.stringify(result));
  assert.equal(result.complete,!['INVALID_INPUT','FAILED','TIMEOUT','CANCELLED','MISSING_IMPORT'].includes(status));
  assert.equal(result.requestId,value.requestId);assert.equal(result.requestDigest,hash(value));
  assert.equal(result.closureDigest,closureDigest(value.closure));assert.equal(result.toolchainDigest,binding.digest);
  assert.equal(result.configurationDigest,runner.configurationDigest(value.task.kind==='explanation'?30000:120000));
  return result;
}
async function explain(body,task){
  const original=input(body,{kind:'explanation',...task});
  const envelope=await execute(original),result=envelope.result;
  assert.equal(result.target,task.target);assert.equal(result.method,'DELETION_REPLAY');assert.equal(result.searchStrategy,'BREADTH_FIRST_BLOCKS');
  assert.equal(result.replayVerified,true);assert.equal(result.allMinimalJustifications,false);
  assert.equal(result.reasoningEngine,'HERMIT_1_4_5_519_EVOPILOT_2_DL');
  assert.equal(result.replay.format,'functional');assert.equal(result.replay.digest,sha(result.replay.content));
  assert.equal(new Set(result.support.map(item=>item.axiomDigest)).size,result.support.length);
  for(const item of result.support){
    assert.equal(item.axiomDigest,sha(item.axiom));assert.ok(item.sources.length>0);
    for(const source of item.sources){
      const doc=original.closure.documents.find(candidate=>candidate.id===source.documentId);
      assert.ok(doc,'Every support selector must name an admitted document');
      assert.equal(source.documentDigest,doc.digest);assert.equal(source.selectorKind,'OWL_STRUCTURAL_AXIOM');
      assert.equal(source.axiomDigest,item.axiomDigest);
    }
  }
  return {original,result};
}
async function replayProof(explanation){
  const replayInput=task=>{
    const value=input('',task);value.closure.documents=[document(explanation.result.replay.content)];return value;
  };
  const legal=await execute(replayInput({kind:'legality'}));assert.equal(legal.result.legal,true);
  if(explanation.original.task.target==='inconsistency'){
    const result=await execute(replayInput({kind:'consistency'}),'INCONSISTENT');
    assert.equal(result.result.consistent,false);return result;
  }
  const result=await execute(replayInput({kind:'entailment',query:explanation.original.task.query}),'ENTAILED');
  assert.equal(result.result.consistent,true);assert.equal(result.result.jointEntailed,true);return result;
}

const fivePremise=declaration({classes:['ServiceType','Service','SensitiveDataset','SensitiveService'],objects:['accesses'],individuals:['api','data']})+`
SubClassOf(:ServiceType :Service)
EquivalentClasses(:SensitiveService ObjectIntersectionOf(:Service ObjectSomeValuesFrom(:accesses :SensitiveDataset)))
ClassAssertion(:ServiceType :api)
ClassAssertion(:SensitiveDataset :data)
ObjectPropertyAssertion(:accesses :api :data)
AnnotationAssertion(<http://www.w3.org/2000/01/rdf-schema#comment> :api "explanation provenance")`;
const sensitiveQuery=query('ClassAssertion(:SensitiveService :api)');

test('five necessary business premises produce source-bound, independently replayable support',async()=>{
  const result=await explain(fivePremise,{target:'entailment',query:sensitiveQuery});
  // This fixture has exactly five necessary logical premises; this assertion
  // does not promise minimal support for arbitrary ontologies or all supports.
  assert.equal(result.result.support.length,5);
  assert.ok(result.result.replay.content.includes('explanation provenance'),'Nonlogical provenance remains in the serialized background');
  const replay=await replayProof(result);assert.equal(replay.result.vacuous,false);
});

test('one thousand unrelated assertions do not bury the replayable business support',async()=>{
  const names=Array.from({length:1000},(_,i)=>'noise'+String(i).padStart(4,'0'));
  const unrelated=declaration({classes:['Noise'],individuals:names})+'\n'+names.map(name=>'ClassAssertion(:Noise :'+name+')').join('\n');
  const result=await explain(fivePremise+'\n'+unrelated,{target:'entailment',query:sensitiveQuery});
  assert.equal(result.result.support.length,5);
  assert.ok(result.result.support.every(item=>!item.axiom.includes('Noise')&&!item.axiom.includes('noise')));
  await replayProof(result);
});

test('an inconsistency explanation serializes a legal ontology that independently remains inconsistent',async()=>{
  const result=await explain(readonly,{target:'inconsistency'});
  assert.ok(result.result.support.length>0);await replayProof(result);
});

test('an empty conclusion has empty logical support and stays explicitly vacuous on replay',async()=>{
  const result=await explain(fivePremise,{target:'entailment',query:query('')});
  assert.deepEqual(result.result.support,[]);
  const replay=await replayProof(result);assert.equal(replay.result.vacuous,true);assert.deepEqual(replay.result.queryAxioms,[]);
});

test('two anonymous query axioms share one witness throughout explanation and serialized replay',async()=>{
  const body=declaration({classes:['B'],objects:['p'],individuals:['a','x','y']})+'\nObjectPropertyAssertion(:p :a :x) ClassAssertion(:B :y) DifferentIndividuals(:x :y)';
  const joint=query('ObjectPropertyAssertion(:p :a _:shared) ClassAssertion(:B _:shared)');
  // Both existential conclusions hold separately; their conjunction with the
  // same witness does not. An axiom-by-axiom check would accept this wrongly.
  await execute(input(body,{kind:'entailment',query:query('ObjectPropertyAssertion(:p :a _:shared)')}),'ENTAILED');
  await execute(input(body,{kind:'entailment',query:query('ClassAssertion(:B _:shared)')}),'ENTAILED');
  const absent=await execute(input(body,{kind:'entailment',query:joint}),'NOT_ENTAILED');assert.equal(absent.result.jointEntailed,false);
  const refused=await execute(input(body,{kind:'explanation',target:'entailment',query:joint}),'INVALID_INPUT');
  assert.equal(refused.error.code,'NO_EXPLANATION_TARGET');
  const result=await explain(body+'\nClassAssertion(:B :x)',{target:'entailment',query:joint});
  const replay=await replayProof(result);assert.equal(replay.result.queryAxioms.length,2);assert.equal(replay.result.vacuous,false);
});

test('custom datatype definitions remain visible support and keep the serialized replay legal',async()=>{
  const body=declaration({data:['n'],individuals:['a']})+`
Declaration(Datatype(:Small))
Declaration(Datatype(:Unused))
DatatypeDefinition(:Small DataOneOf("1"^^xsd:integer))
DatatypeDefinition(:Unused DataOneOf("2"^^xsd:integer))
DataPropertyAssertion(:n :a "1"^^xsd:integer)`;
  const result=await explain(body,{target:'entailment',query:query('ClassAssertion(DataSomeValuesFrom(:n :Small) :a)')});
  const definitions=result.result.support.filter(item=>item.axiom.startsWith('DatatypeDefinition('));
  assert.equal(definitions.length,2,'Even the irrelevant datatype definition is deliberately retained, without a minimality claim');
  assert.ok(definitions.some(item=>item.axiom.includes('Small')));assert.ok(definitions.some(item=>item.axiom.includes('Unused')));
  assert.ok(result.result.replay.content.includes('DatatypeDefinition('));await replayProof(result);
});

test('non-entailment, consistent inconsistency targets, and inconsistent entailment premises are refused',async()=>{
  const missing=fivePremise.replace('ObjectPropertyAssertion(:accesses :api :data)','');
  const absent=await execute(input(missing,{kind:'explanation',target:'entailment',query:sensitiveQuery}),'INVALID_INPUT');
  assert.equal(absent.error.code,'NO_EXPLANATION_TARGET');assert.equal(absent.result.replayVerified,undefined);
  const consistent=await execute(input(fivePremise,{kind:'explanation',target:'inconsistency'}),'INVALID_INPUT');
  assert.equal(consistent.error.code,'NO_EXPLANATION_TARGET');assert.equal(consistent.result.replayVerified,undefined);
  const inconsistent=await execute(input(readonly,{kind:'explanation',target:'entailment',query:query('ClassAssertion(:ReadOnly :task)')}),'INVALID_INPUT');
  assert.equal(inconsistent.error.code,'INCONSISTENT_PREMISE');assert.equal(inconsistent.result.replayVerified,undefined);
});

test('entities occurring only in a tautological query do not become supporting premises',async()=>{
  // Reflexive class inclusion and membership in owl:Thing hold independently
  // of any source fact. Both entity IRIs are absent from the source ontology.
  const conclusion=query('SubClassOf(:QueryOnly :QueryOnly) ClassAssertion(owl:Thing :queryOnlyIndividual)');
  assert.ok(!fivePremise.includes('QueryOnly')&&!fivePremise.includes('queryOnlyIndividual'));
  const result=await explain(fivePremise,{target:'entailment',query:conclusion});
  assert.deepEqual(result.result.support,[]);
  const replay=await replayProof(result);assert.equal(replay.result.vacuous,false);assert.equal(replay.result.queryAxioms.length,2);
});

test('legal class and named-individual punning keeps both declaration types during support reduction',async()=>{
  const body=declaration({classes:['Person','Agent','Noise'],individuals:['Person','noise']})+`
SubClassOf(:Person :Agent)
ClassAssertion(:Person :Person)
ClassAssertion(:Noise :noise)`;
  const result=await explain(body,{target:'entailment',query:query('ClassAssertion(:Agent :Person)')});
  // The Person class and the Person individual share an IRI, but are distinct
  // OWL entities. Neither declaration may displace the other in an oracle.
  assert.equal(result.result.support.length,2);
  assert.ok(result.result.support.every(item=>!item.axiom.includes('Noise')&&!item.axiom.includes('noise')));
  await replayProof(result);
});

test('a key establishes named-individual identity and its explanation survives independent replay',async()=>{
  const body=keyed+'\n'+declaration({classes:['Noise'],individuals:['noise']})+'\nClassAssertion(:Noise :noise)';
  const conclusion=query('SameIndividual(:a :b)');
  const result=await explain(body,{target:'entailment',query:conclusion});
  // Two Connection memberships, two shared values, and HasKey establish this
  // identity. The expected identity is fixed by that rule, not worker output.
  assert.equal(result.result.support.length,5);
  assert.equal(result.result.support.filter(item=>item.axiom.startsWith('HasKey(')).length,1);
  assert.ok(result.result.support.every(item=>!item.axiom.includes('Noise')&&!item.axiom.includes('noise')));
  await replayProof(result);
  const outsideKeyClass=body.replace('ClassAssertion(:Connection :b)','');
  const negative=await execute(input(outsideKeyClass,{kind:'entailment',query:conclusion}),'NOT_ENTAILED');
  assert.equal(negative.result.negationInferred,false);
  const refused=await execute(input(outsideKeyClass,{kind:'explanation',target:'entailment',query:conclusion}),'INVALID_INPUT');
  assert.equal(refused.error.code,'NO_EXPLANATION_TARGET');
});
