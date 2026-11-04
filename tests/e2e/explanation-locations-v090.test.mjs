import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,rmSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {execFile} from 'node:child_process';
import {readDLToolchain,verifyDLToolchain,javaClasspath} from '../../dist/reasoning/toolchain.js';
import {hashBytes} from '../../dist/standalone/validation.js';

// Actual parser development regression, with no reasoner, owner mutation,
// synthetic worker reply, formal acceptance, network import or skip fallback.
const javaSource=String.raw`
import java.nio.file.*;
import java.util.*;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.semanticweb.owlapi.apibinding.OWLManager;
import org.semanticweb.owlapi.formats.FunctionalSyntaxDocumentFormat;
import org.semanticweb.owlapi.functional.parser.LocatedFunctionalParser;
import org.semanticweb.owlapi.functional.parser.OWLFunctionalSyntaxParser;
import org.semanticweb.owlapi.functional.parser.OWLFunctionalSyntaxOWLParserFactory;
import org.semanticweb.owlapi.io.StringDocumentSource;
import org.semanticweb.owlapi.model.*;

public final class LocatedParserParity {
    static final ObjectMapper JSON = new ObjectMapper();
    static final IRI DOCUMENT = IRI.create("urn:evopilot:test:located-document");

    static OWLOntologyManager manager() {
        var manager = OWLManager.createOWLOntologyManager();
        // Independent parses would otherwise assign different random names to
        // the same written blank-node label. This setting is shared by both
        // parsers, and is solely for structural equality in this fixture.
        manager.getOntologyConfigurator().withRemapAllAnonymousIndividualsIds(false);
        manager.setOntologyParsers(Set.of(new OWLFunctionalSyntaxOWLParserFactory()));
        manager.setIRIMappers(Set.of(iri -> IRI.create("urn:evopilot:test:unresolvable")));
        return manager;
    }
    static OWLOntologyLoaderConfiguration configuration(JsonNode input) {
        var config = new OWLOntologyLoaderConfiguration().clearIgnoredImports()
                .setLoadAnnotationAxioms(input.path("loadAnnotations").asBoolean(true))
                .setStrict(false).setRepairIllegalPunnings(false)
                .setMissingImportHandlingStrategy(MissingImportHandlingStrategy.THROW_EXCEPTION)
                .setConnectionTimeout(1).setRetriesToAttempt(0).setFollowRedirects(false);
        for (JsonNode iri : input.path("ignoredImports")) config = config.addIgnoredImport(IRI.create(iri.asText()));
        return config;
    }
    static String origin(Class<?> type) throws Exception {
        return Path.of(type.getProtectionDomain().getCodeSource().getLocation().toURI()).toRealPath().toString();
    }
    static ObjectNode interval(String content, LocatedFunctionalParser.Span span) {
        ObjectNode out = JSON.createObjectNode();
        out.put("start", span.start());out.put("end", span.end());
        out.put("text", content.substring(span.start(), span.end()));
        return out;
    }
    static ObjectNode run(JsonNode input) throws Exception {
        String content = input.path("content").asText();
        var originalManager = manager();var locatedManager = manager();
        var original = originalManager.createOntology();var located = locatedManager.createOntology();
        originalManager.setOntologyDocumentIRI(original, DOCUMENT);locatedManager.setOntologyDocumentIRI(located, DOCUMENT);
        ObjectNode out = JSON.createObjectNode();
        try {
            LocatedFunctionalParser.verifyLexicalCompleteness(content);
            out.put("lexicalStatus", "COMPLETE");
        } catch (Exception error) {
            out.put("lexicalStatus", "SYNTAX_ERROR");out.put("lexicalError", error.getClass().getName());
        }
        FunctionalSyntaxDocumentFormat originalFormat = null;
        LocatedFunctionalParser.Result result = null;
        try {
            originalFormat = (FunctionalSyntaxDocumentFormat) new OWLFunctionalSyntaxOWLParserFactory().createParser()
                    .parse(new StringDocumentSource(content, DOCUMENT, new FunctionalSyntaxDocumentFormat(), null), original, configuration(input));
            out.put("originalStatus", "PARSED");
        } catch (Exception error) {
            out.put("originalStatus", "PARSE_ERROR");out.put("originalError", error.getClass().getName());
        }
        try {
            result = LocatedFunctionalParser.parse(content, located, configuration(input), input.path("maximumOccurrences").asInt(200000));
            out.put("locatedStatus", "PARSED");
        } catch (LocatedFunctionalParser.LimitException error) {
            out.put("locatedStatus", "LIMIT");out.put("locatedError", error.getClass().getName());
        } catch (Exception error) {
            out.put("locatedStatus", "PARSE_ERROR");out.put("locatedError", error.getClass().getName());
        }
        out.put("locationResultReturned", result != null);
        out.put("originalAxiomCount", original.getAxiomCount());out.put("locatedAxiomCount", located.getAxiomCount());
        if (result != null && originalFormat != null) {
            out.put("sameAxioms", original.getAxioms().equals(located.getAxioms()));
            out.put("sameOntologyId", original.getOntologyID().equals(located.getOntologyID()));
            out.put("sameImports", original.getImportsDeclarations().equals(located.getImportsDeclarations()));
            out.put("sameOntologyAnnotations", original.getAnnotations().equals(located.getAnnotations()));
            out.put("samePrefixes", originalFormat.getPrefixName2PrefixMap().equals(result.format().getPrefixName2PrefixMap()));
            out.put("indexedAxiomCount", result.occurrences().size());
            out.put("ontologyAnnotationCount", located.annotations().count());
            out.put("anonymousCount", located.axioms().flatMap(a -> a.anonymousIndividuals()).distinct().count());
            out.put("anonymousAxiomReferences", located.axioms().filter(a -> a.anonymousIndividuals().findAny().isPresent()).count());
            ArrayNode axioms = out.putArray("axioms");located.axioms().map(Object::toString).sorted().forEach(axioms::add);
            ArrayNode types = out.putArray("axiomTypes");located.axioms().map(a -> a.getAxiomType().getName()).distinct().sorted().forEach(types::add);
            ArrayNode imports = out.putArray("imports");located.importsDeclarations().map(d -> d.getIRI().toString()).sorted().forEach(imports::add);
            ArrayNode occurrences = out.putArray("occurrences");
            result.occurrences().forEach((axiom, spans) -> spans.forEach(span -> {
                ObjectNode item = interval(content, span);item.put("axiom", axiom.toString());occurrences.add(item);
            }));
            ArrayNode prefixes = out.putArray("prefixes");result.prefixes().forEach(span -> prefixes.add(interval(content, span)));
        }
        return out;
    }
    public static void main(String[] args) throws Exception {
        JsonNode input = JSON.readTree(Files.readAllBytes(Path.of(args[0])));
        ObjectNode out = JSON.createObjectNode(), origins = out.putObject("origins");
        origins.put("facade", origin(LocatedFunctionalParser.class));
        origins.put("locatedTokenizer", origin(Class.forName("org.semanticweb.owlapi.functional.parser.LocatedTokenizer")));
        origins.put("originalParser", origin(OWLFunctionalSyntaxParser.class));
        origins.put("originalTokenizer", origin(Class.forName("org.semanticweb.owlapi.functional.parser.CustomTokenizer")));
        origins.put("originalFactory", origin(OWLFunctionalSyntaxOWLParserFactory.class));
        ArrayNode cases = out.putArray("cases");for (JsonNode item : input) cases.add(run(item));
        System.out.println(JSON.writeValueAsString(out));
    }
}
`;

let base,classes,binding,classpath,upstreamJars,ordinal=0;
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:45000,maxBuffer:8*1024*1024,...options},(error,stdout,stderr)=>error?reject(Error(`${file} failed: ${error.code}\n${stdout}\n${stderr}`)):resolve(stdout)));
before(async()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN,'An actual current DL toolchain and its Java compiler are required; no mock or skip fallback');
  binding=readDLToolchain(process.env.EVOPILOT_TEST_DL_TOOLCHAIN);verifyDLToolchain(binding);
  assert.equal(binding.workerSourceDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/Worker.java',import.meta.url))));
  assert.equal(binding.dependencyLockDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/dependencies.json',import.meta.url))));
  const jars=binding.runtimeFiles.filter(f=>f.kind==='file'&&f.path.startsWith('dependencies/')&&f.path.endsWith('.jar'));
  assert.equal(jars.length,83,'Use the complete currently locked upstream dependency set');
  upstreamJars=new Set(jars.filter(f=>/^dependencies\/owlapi-(distribution|parsers)-5\.5\.1\.jar$/.test(f.path)).map(f=>realpathSync(join(binding.root,f.path))));assert.ok(upstreamJars.size>0);
  const javac=join(binding.javaRoot,'bin/javac');assert.equal(lstatSync(javac).isFile(),true,'The selected bound Java root must provide its actual compiler');
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-parser-parity-')));classes=join(base,'classes');mkdirSync(classes,{mode:0o700});
  const source=join(base,'LocatedParserParity.java');writeFileSync(source,javaSource,{mode:0o600});
  classpath=javaClasspath(binding);
  await execute(javac,['-encoding','UTF-8','-cp',classpath,'-d',classes,source],{cwd:base});
});
after(()=>{try{if(binding)verifyDLToolchain(binding);}finally{if(base)rmSync(base,{recursive:true,force:true});}});

async function inspect(...cases){
  const file=join(base,'input-'+(++ordinal)+'.json');writeFileSync(file,JSON.stringify(cases),{mode:0o600});
  const result=JSON.parse(await execute(join(binding.javaRoot,'bin/java'),['-Xmx512m','-cp',[classes,classpath].join(delimiter),'LocatedParserParity',file],{cwd:base}));
  const worker=realpathSync(join(binding.root,'worker.jar'));
  assert.equal(result.origins.facade,worker);assert.equal(result.origins.locatedTokenizer,worker);
  for(const key of ['originalParser','originalTokenizer','originalFactory'])assert.ok(upstreamJars.has(result.origins[key]),key+' must come from an unchanged locked upstream JAR');
  assert.equal(result.cases.length,cases.length);return result.cases;
}
function document({axioms,prefixes=['Prefix(:=<urn:location:>)'],header='Ontology(<urn:location:ontology>\n',separator='\n',leading='# 中文😀: fake SubClassOf(:X :Y), Prefix(:=<urn:fake:>)\r\n'}={}){
  let content=leading;const expected=[],contexts=[];
  const append=(text,list)=>{const start=content.length;content+=text;list.push({start,end:content.length,text});};
  for(const prefix of prefixes){append(prefix,contexts);content+='\r\n';}
  content+=header;
  for(const axiom of axioms){content+='\t';append(axiom,expected);content+=separator;}
  content+=')\n# trailing comment has fake ) and HasKey(:Fake () ())';
  return {content,expected,contexts};
}
function parsed(result,fixture,expected=fixture.expected){
  assert.equal(result.originalStatus,'PARSED',JSON.stringify(result));assert.equal(result.locatedStatus,'PARSED',JSON.stringify(result));assert.equal(result.locationResultReturned,true);
  assert.equal(result.lexicalStatus,'COMPLETE');
  for(const key of ['sameAxioms','sameOntologyId','sameImports','sameOntologyAnnotations','samePrefixes'])assert.equal(result[key],true,key);
  assert.equal(result.indexedAxiomCount,result.locatedAxiomCount);assert.equal(result.originalAxiomCount,result.locatedAxiomCount);
  const intervals=result.occurrences.map(({start,end,text})=>({start,end,text})).sort((a,b)=>a.start-b.start);
  assert.deepEqual(intervals,expected,'Locations must equal intervals fixed while assembling original input, not a search through parser output');
  assert.deepEqual(result.prefixes,fixture.contexts);return result;
}

test('actual upstream and located parsers agree on full axiom sets with exact Unicode comments strings and shared blank-node locations',async()=>{
  const axioms=[
    'Declaration(Class(:服务😀))','Declaration(Class(:B))','Declaration(ObjectProperty(:p))','Declaration(DataProperty(:key))',
    'Declaration(Datatype(:Small))','Declaration(NamedIndividual(:a))','Declaration(NamedIndividual(:b))','Declaration(Class(:a))','Declaration(AnnotationProperty(:label))',
    String.raw`SubClassOf(Annotation(:label "a quote: \" and slash: \\; fake ) SubClassOf(:X :Y) 中文😀") :服务😀 ObjectSomeValuesFrom(:p :B))`,
    'EquivalentClasses(:B ObjectIntersectionOf(:服务😀 ObjectAllValuesFrom(:p :服务😀)))','SubClassOf(:B ObjectMinCardinality(1 :p :服务😀))',
    'HasKey(:服务😀 (:p) (:key))','DatatypeDefinition(:Small DatatypeRestriction(xsd:integer xsd:minInclusive "1"^^xsd:integer))',
    'ClassAssertion(:服务😀 :a)','ObjectPropertyAssertion(:p :a _:shared)','ClassAssertion(:B _:shared)',
    String.raw`DataPropertyAssertion(:key :a "data # ( ) Prefix(:=<urn:fake:>) \"quoted\" \\ 中文😀")`,
    'NegativeObjectPropertyAssertion(:p :a :b)','NegativeDataPropertyAssertion(:key :b "blocked")',
    'AnnotationAssertion(:label :a "nonlogical body")',
    'SubClassOf(\r\n# delimiter ) and fake Declaration(Class(:Noise))\n :服务😀\t:B)',
  ];
  const f=document({axioms,prefixes:['Prefix(:=<urn:location:>)','Prefix(xsd:=<http://www.w3.org/2001/XMLSchema#>)'],
    header:'Ontology(<urn:location:ontology> <urn:location:version>\nImport(<urn:location:ignored>)\nAnnotation(:label "ontology-only # ( )")\n',separator:'\r\n\r'});
  const [result]=await inspect({content:f.content,ignoredImports:['urn:location:ignored']});parsed(result,f);
  assert.equal(result.locatedAxiomCount,axioms.length);assert.equal(result.ontologyAnnotationCount,1);assert.deepEqual(result.imports,['urn:location:ignored']);
  assert.equal(result.anonymousCount,1);assert.equal(result.anonymousAxiomReferences,2,'Two axioms must keep the same explicitly written blank-node witness');
  for(const type of ['Declaration','SubClassOf','HasKey','DatatypeDefinition','NegativeObjectPropertyAssertion','NegativeDataPropertyAssertion','AnnotationAssertion'])assert.ok(result.axiomTypes.includes(type),type);
});

test('equal duplicate axioms retain separate raw intervals and consume the occurrence budget before ontology set deduplication',async()=>{
  const axiom='SubClassOf(:A :B)',f=document({axioms:[axiom,axiom,axiom]});
  const [boundary,limited]=await inspect({content:f.content,maximumOccurrences:3},{content:f.content,maximumOccurrences:2});
  parsed(boundary,f);assert.equal(boundary.locatedAxiomCount,1);assert.equal(boundary.occurrences.length,3);assert.equal(new Set(boundary.occurrences.map(x=>x.axiom)).size,1);
  assert.equal(limited.originalStatus,'PARSED');assert.equal(limited.locatedStatus,'LIMIT');assert.equal(limited.locationResultReturned,false);assert.equal(limited.occurrences,undefined);
});

test('the same annotation-loading and ignored-import configuration preserves parser semantics without treating ontology metadata as an axiom',async()=>{
  const annotation='AnnotationAssertion(:label :a "annotation axiom")',f=document({axioms:['Declaration(Class(:A))',annotation,'SubClassOf(:A :B)'],
    header:'Ontology(<urn:location:ontology>\nImport(<urn:location:ignored>)\nAnnotation(:label "ontology annotation")\n'});
  const [all,without]=await inspect({content:f.content,ignoredImports:['urn:location:ignored'],loadAnnotations:true},{content:f.content,ignoredImports:['urn:location:ignored'],loadAnnotations:false});
  parsed(all,f);parsed(without,f,f.expected.filter(x=>x.text!==annotation));
  assert.equal(all.locatedAxiomCount,3);assert.equal(without.locatedAxiomCount,2);assert.equal(without.ontologyAnnotationCount,1);assert.deepEqual(without.imports,['urn:location:ignored']);
});

test('successive documents keep independent prefix meaning source intervals and occurrence indexes',async()=>{
  const first=document({prefixes:['Prefix(:=<urn:first:>)','Prefix(:=<urn:effective:>)'],axioms:['ClassAssertion(:A _:shared)','ObjectPropertyAssertion(:p :a _:shared)']}),
    second=document({prefixes:['Prefix(:=<urn:second:>)'],axioms:['ClassAssertion(:A _:shared)'],leading:'\r\n'});
  const [a,b]=await inspect({content:first.content},{content:second.content});parsed(a,first);parsed(b,second);
  assert.equal(a.anonymousCount,1);assert.equal(b.anonymousCount,1);assert.ok(a.axioms.every(x=>x.includes('urn:effective:')));assert.ok(b.axioms.every(x=>x.includes('urn:second:')));
  assert.ok(b.axioms.every(x=>!x.includes('urn:effective:')));assert.equal(b.occurrences.length,1);assert.equal(b.prefixes.length,1);
});

test('malformed documents cannot return a partial index after earlier valid axiom callbacks',async()=>{
  const head='Prefix(:=<urn:location:>)\nOntology(Declaration(Class(:A))\n';
  const results=await inspect(...[
    head+'SubClassOf(:A',
    head+'AnnotationAssertion(:label :a "unfinished',
    head+') Declaration(Class(:Later))',
  ].map(content=>({content})));
  for(const result of results){assert.equal(result.originalStatus,'PARSE_ERROR');assert.equal(result.locatedStatus,'PARSE_ERROR');assert.equal(result.locationResultReturned,false);assert.equal(result.occurrences,undefined);assert.ok(result.locatedAxiomCount>=1,'The earlier declaration reached the real parser before failure');}
});

test('premature token EOF after a complete ontology is rejected despite the upstream false EOF, while comment quotes stay legal',async()=>{
  const f=document({axioms:['Declaration(Class(:A))']}),tails=[
    '"unfinished',
    String.raw`"escaped quote: \" still open`,
    String.raw`"escaped slash: \\ still open`,
    '"中文😀\n第二行未结束',
    '"trailing escape \\',
    '7','^',
  ];
  const bad=await inspect(...tails.map(tail=>({content:f.content+'\n'+tail})));
  for(const result of bad){
    assert.equal(result.originalStatus,'PARSED','The unchanged upstream tokenizer is the observed false-EOF baseline');
    assert.equal(result.originalAxiomCount,1);assert.equal(result.locatedStatus,'PARSE_ERROR');assert.equal(result.locationResultReturned,false);assert.equal(result.occurrences,undefined);
    assert.equal(result.lexicalStatus,'SYNTAX_ERROR');assert.equal(result.lexicalError,'org.semanticweb.owlapi.io.OWLParserException');
  }
  const good=[f.content+'\n# "unfinished quote remains a comment',f.content+'\n# "quote and \\\n# next comment "',f.content+'\n \t\r\n'];
  const accepted=await inspect(...good.map(content=>({content})));
  accepted.forEach((result,index)=>parsed(result,{...f,content:good[index]}));
  const [closed]=await inspect({content:'"closed literal"'});
  assert.equal(closed.lexicalStatus,'COMPLETE','A complete token is accepted by the lexical precheck alone');
  assert.equal(closed.originalStatus,'PARSE_ERROR');assert.equal(closed.locatedStatus,'PARSE_ERROR','The original grammar still requires an ontology');
});

test('prefix occurrence limits count repeated declarations independently of the effective prefix map',async()=>{
  const prefix='Prefix(:=<urn:bounded:>)',at=document({prefixes:Array(10000).fill(prefix),axioms:[],leading:''}),over=document({prefixes:Array(10001).fill(prefix),axioms:[],leading:''});
  const [accepted,limited]=await inspect({content:at.content},{content:over.content});parsed(accepted,at);assert.equal(accepted.prefixes.length,10000);assert.equal(accepted.locatedAxiomCount,0);
  assert.equal(limited.originalStatus,'PARSED');assert.equal(limited.locatedStatus,'LIMIT');assert.equal(limited.locationResultReturned,false);assert.equal(limited.prefixes,undefined);
});
