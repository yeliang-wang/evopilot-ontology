import assert from 'node:assert/strict';
import {openNativeCollector,expectFormal} from './native-public.mjs';
import {convertFunctional,converterSource} from './replay-conversion.mjs';
import {classes,properties,datatypes,dataRanges,restrictions,combined,ontology,semantics} from './dl-fixtures.mjs';
import {hashBytes} from '../../../scripts/standards-gate.mjs';

export async function collectPublicDL(entry,{validateDataset,matchesExpected}){
  const c=await openNativeCollector('DL',entry,[import.meta.url,new URL('./dl-fixtures.mjs',import.meta.url),new URL('./replay-conversion.mjs',import.meta.url),converterSource]);let problem=null,serial=0;
  const dataset=c.frozen('owl-inputs.json');validateDataset(dataset);
  const profile=c.frozen('owl-public-profile.json'),converted=new Map(),observations=[],originalResults=[];
  const q=body=>{const content=ontology(body);return {format:'functional',content,digest:hashBytes(content)};};
  function prepareOriginal(jobs){
    const first=jobs[0],record=profile.cases.find(p=>p.identifier===first.case);assert(record);
    const closure=structuredClone(first.request.closure);
    if(first.format==='functional'){
      assert.equal(closure.imports.length,0);assert.equal(closure.documents.length,1);
      const old=closure.documents[0];let output=converted.get(first.premiseDigest);
      if(!output){output=convertFunctional(c,old.content,'official-format-'+(++serial),'Original W3C Functional Syntax input; lossless external RDF/XML conversion; upstream expected result unchanged');converted.set(first.premiseDigest,output);}
      closure.documents[0]={...old,format:'rdfxml',content:output.content,digest:output.digest};
      c.observe({kind:'ORIGINAL_UPSTREAM_SERIALIZATION',originalInputDigest:first.premiseDigest,originalDocumentDigest:old.digest,convertedDocumentDigest:output.digest,metadata:output.metadata,productFunctionalImportClaim:false});
    }
    for(const j of jobs){assert.equal(j.premiseDigest,first.premiseDigest);assert.equal(j.format,first.format);assert.equal(j.extractionError,null);}
    return {kind:first.format==='functional'?'owl-converted':'owl',identifier:first.case,caseKey:record.caseKey,upstreamId:record.caseKey.replace(/^w3c-owl2#/,''),closure,tasks:jobs.map(j=>({id:j.id,expected:j.expected,task:j.request.task}))};
  }
  async function originalBatch(select){
    const selected=dataset.jobs.filter(select),groups=new Map();
    for(const j of selected){const key=j.case+'\0'+j.format;groups.set(key,[...(groups.get(key)??[]),j]);}
    for(const jobs of groups.values()){
      const job=prepareOriginal(jobs),f=await c.model('dl-official-'+(++serial),job);
      for(const j of jobs){const actual=await f.reason(j.request.task);assert(matchesExpected(j.expected,actual),JSON.stringify({id:j.id,expected:j.expected,actual}));originalResults.push({id:j.id,case:j.case,format:j.format,expected:j.expected,taskId:f.lastReasoning.taskId,modelDigest:f.modelDigest,status:actual.status});}
      c.closeFixture(f);
      if(originalResults.length%25<jobs.length)console.log(JSON.stringify({group:'DL',originalCompleted:originalResults.length,required:dataset.jobs.length}));
    }
    return selected.length;
  }
  async function witness(item,invalid=false){
    const content=ontology(item.body),name='dl-witness-'+(++serial),converted=convertFunctional(c,content,name,'Explicitly synthetic witness derived from '+item.basis+'; not an official W3C test'),document={id:'root',documentIri:'urn:acceptance:'+name,ontologyIri:null,versionIri:null,format:'rdfxml',content:converted.content,digest:converted.digest};
    const job={kind:'normative-dl',identifier:item.id,upstreamId:item.basis,caseKey:'normative-derived:'+item.id,closure:{rootDocumentId:'root',documents:[document],imports:[]},tasks:[]};
    c.observe({kind:'NORMATIVE_DERIVED_WITNESS',officialW3CTest:false,id:item.id,basis:item.basis,originalFunctionalDigest:hashBytes(content),query:item.query??null,expected:invalid?'INVALID_INPUT':item.status,expectedViolation:item.violation??null});
    const f=await c.model(name,job),legality=await f.reason({kind:'legality'});
    if(invalid){assert.equal(legality.status,'INVALID_INPUT');assert.equal(legality.complete,false);assert.equal(legality.result.legal,false);assert.equal(legality.error.code,'OWL2_DL_PROFILE');assert(legality.result.violations.some(v=>v.type===item.violation),JSON.stringify(legality));}
    else{
      const legal=expectFormal(legality,'COMPLETED');assert.equal(legal.axiomCount,converted.metadata.outputAxiomCount,'No parsed premise axiom may silently disappear');
      const consistency=expectFormal(await f.reason({kind:'consistency'}),'COMPLETED');assert.equal(consistency.consistent,true);
      const answer=expectFormal(await f.reason({kind:'entailment',query:q(item.query)}),item.status);assert.equal(answer.vacuous,false);assert(answer.queryAxioms.length>0);
      if(item.negative)expectFormal(await f.reason({kind:'entailment',query:q(item.negative)}),'NOT_ENTAILED');
      observations.push({id:item.id,sourceDigest:hashBytes(content),rdfxmlDigest:document.digest,modelDigest:f.modelDigest,axiomCount:legal.axiomCount,logicalAxiomCount:converted.metadata.logicalAxiomCount,queryAxioms:answer.queryAxioms.length,taskId:f.lastReasoning.taskId});
    }
    c.closeFixture(f);return {id:item.id,modelDigest:f.modelDigest,taskId:f.lastReasoning.taskId};
  }
  try{
    await c.case('DL-01',async()=>{const tasks=await originalBatch(j=>!['entailed','not-entailed'].includes(j.expected));assert.equal(tasks,612);return {expected:'All original W3C legality/consistency jobs keep their fixed oracle, including every original Functional Syntax case through disclosed lossless external conversion',tasks,originalCases:dataset.cases.length};});
    await c.case('DL-02',async()=>{const tasks=await originalBatch(j=>['entailed','not-entailed'].includes(j.expected));assert.equal(tasks,101);assert.equal(originalResults.length,713);assert.equal(new Set(originalResults.map(r=>r.id)).size,713);c.put('all-original-results.json',originalResults);return {expected:'All 90 original positive and 11 negative W3C entailment jobs execute through the installed owner API; no selection or changed expectation',tasks,completeOriginalJobs:713};});
    await c.case('DL-03',async()=>{assert.equal(classes.length,24);for(const item of classes)await witness(item);return {expected:'Every class expression form, including qualified and unqualified cardinalities, satisfies its predeclared semantic witness and refuses its complement',basis:semantics+'#Class_Expressions',witnesses:classes.map(x=>x.id),officialCorpus:'all-original-results.json',supplementalOrigin:'NORMATIVE_DERIVED_NOT_OFFICIAL_W3C'};});
    await c.case('DL-04',async()=>{assert.equal(properties.length,20);for(const item of properties)await witness(item);return {expected:'All object/data property axiom forms have fixed nonvacuous consequences through the installed product',witnesses:properties.map(x=>x.id),supplementalOrigin:'NORMATIVE_DERIVED_NOT_OFFICIAL_W3C'};});
    await c.case('DL-05',async()=>{for(const item of [datatypes,...dataRanges])await witness(item);return {expected:'Every standard datatype plus rdfs:Literal participates in actual value membership; all data range constructors and named datatype definition retain their semantics',witnesses:[datatypes,...dataRanges].map(x=>x.id),supplementalOrigin:'NORMATIVE_DERIVED_NOT_OFFICIAL_W3C'};});
    await c.case('DL-06',async()=>{const ids=['New-Feature-Keys-001','New-Feature-Keys-002','New-Feature-NegativeObjectPropertyAssertion-001','New-Feature-NegativeDataPropertyAssertion-001','owl2-rl-rules-fp-differentFrom'];for(const id of ids){const f=await c.model('dl-assertion-'+(++serial),c.original(id));await f.official();c.closeFixture(f);}return {expected:'Original W3C keys/equality/difference and positive-versus-negative object/data assertion oracles all hold',upstream:ids};});
    await c.case('DL-07',async()=>{for(const item of restrictions)await witness(item,true);return {expected:'All specified non-simple property restrictions, irregular hierarchy, datatype cycles/duplicate definitions and illegal top data property positions reject before ordinary reasoning',witnesses:restrictions.map(x=>x.id),supplementalOrigin:'NORMATIVE_DERIVED_NOT_OFFICIAL_W3C'};});
    await c.case('DL-08',async()=>{await witness(combined);return {expected:'A legal combination of chain/inverse, intersection/existential, datatype restriction, key and equality entails the independently specified joint consequences',basis:combined.basis,supplementalOrigin:'NORMATIVE_DERIVED_NOT_OFFICIAL_W3C'};});
    await c.case('DL-09',async()=>{assert.equal(observations.length,classes.length+properties.length+dataRanges.length+2);assert(observations.every(x=>x.axiomCount>=x.logicalAxiomCount&&x.logicalAxiomCount>0&&x.queryAxioms>0));assert.equal(originalResults.length,713);c.observe({kind:'NO_SILENT_DROP_COMPARISON',independentParsedAxiomCounts:true,observations,originalJobCount:originalResults.length});c.put('construct-observations.json',observations);return {expected:'Every legal supplemental premise retains the independently serialized axiom count and produces nonvacuous expected consequences; every original corpus job has an exact completed public receipt',originalJobs:713,constructWitnesses:observations.length,finiteTestsProveUniversalConformance:false};});
  }catch(e){problem=e.message;}finally{await c.finish(problem);}
}
