import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {matchesExpected} from '../acceptance/v090/dl.mjs';

test('standard collector refuses incomplete, wrong-status and inconsistent entailment evidence',()=>{
  const response={complete:true,error:null,status:'ENTAILED',result:{legal:true,consistent:true}};
  assert.equal(matchesExpected('entailed',response),true);
  assert.equal(matchesExpected('not-entailed',response),false);
  for(const status of ['TIMEOUT','CANCELLED','FAILED','INVALID_INPUT','INCONSISTENT'])assert.equal(matchesExpected('entailed',{...response,status}),false);
  assert.equal(matchesExpected('entailed',{...response,complete:false}),false);
  assert.equal(matchesExpected('entailed',{...response,error:{code:'ENGINE_CAPABILITY_GAP'}}),false);
  assert.equal(matchesExpected('entailed',{...response,result:{legal:true,consistent:false}}),false);
  assert.equal(matchesExpected('entailed',null),false);
  assert.equal(matchesExpected('inconsistent',{...response,status:'INCONSISTENT',result:{legal:true,consistent:false}}),true);
  assert.equal(matchesExpected('inconsistent',{...response,status:'INCONSISTENT'}),false);
  assert.equal(matchesExpected('consistent',{...response,status:'COMPLETED'}),true);
  assert.equal(matchesExpected('legality',{...response,status:'COMPLETED',result:{legal:false}}),false);
  assert.throws(()=>matchesExpected('invented',response),/Unknown external expectation/);
});

test('independent fixture metadata parser retains identities and never treats quoted import text as an import',()=>{
  assert.ok(process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN,'Select the actual pinned RDFLib toolchain');
  const python=JSON.parse(readFileSync(process.env.EVOPILOT_TEST_NATIVE_TOOLCHAIN,'utf8')).tools.python.executable;
  const extractor=fileURLToPath(new URL('../acceptance/v090/extract-w3c.py',import.meta.url));
  const script=String.raw`
import importlib.util,json,sys
s=importlib.util.spec_from_file_location('extract',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
actual=m.functional_metadata('Prefix( : = <urn:test:> ) Ontology( :model :version Import( :dependency ) Annotation( <urn:label> "Import(<urn:fake>)" ) )')
assert actual=={'ontologyIri':'urn:test:model','versionIri':'urn:test:version','imports':['urn:test:dependency']},actual
assert m.functional_metadata('Prefix(:=<urn:test:>) Ontology()')=={'ontologyIri':None,'versionIri':None,'imports':[]}
xml='<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:owl="http://www.w3.org/2002/07/owl#" xml:base="https://example.test/model"><owl:Ontology rdf:about=""><owl:versionIRI rdf:resource="version"/><owl:imports rdf:resource="dependency"/></owl:Ontology></rdf:RDF>'
assert m.xml_metadata(xml,'urn:ignored')=={'ontologyIri':'https://example.test/model','versionIri':'https://example.test/version','imports':['https://example.test/dependency']}
try:m.xml_metadata('<!DOCTYPE rdf:RDF SYSTEM "file:///forbidden">'+xml,'urn:test')
except ValueError as e:assert 'External XML' in str(e)
else:raise AssertionError('External XML was accepted')
print(json.dumps({'metadata':'PASS','externalXml':'REFUSED'}))
`;
  const result=spawnSync(python,['-B','-c',script,extractor],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{metadata:'PASS',externalXml:'REFUSED'});
});
