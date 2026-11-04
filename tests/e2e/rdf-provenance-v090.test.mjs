import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {execFile} from 'node:child_process';
import {readDLToolchain,verifyDLToolchain,javaClasspath} from '../../dist/reasoning/toolchain.js';
import {hashBytes} from '../../dist/standalone/validation.js';

// These fixtures identify input statements before parsing. Required/excluded
// sources and target axioms do not come from the mapper's observed source sets.
const javaSource=String.raw`
package io.evopilot.ontology;
import java.nio.file.*;
import java.io.StringReader;
import java.util.*;
import java.util.stream.Collectors;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.semanticweb.owlapi.model.*;
import org.semanticweb.owlapi.formats.*;
import org.semanticweb.owlapi.io.*;
import org.semanticweb.owlapi.rdf.turtle.parser.*;
import org.semanticweb.owlapi.rdf.rdfxml.parser.*;
import org.xml.sax.InputSource;

public final class RDFProvenanceProbe {
  static final ObjectMapper JSON=new ObjectMapper();
  static final IRI BASE=IRI.create("urn:provenance:document");
  static IRI iri(String value){return IRI.create(value);}
  static List<String> strings(JsonNode node){var out=new ArrayList<String>();for(var v:node)out.add(v.asText());return out;}
  static OWLAnnotation nestedAnnotation(OWLDataFactory d,JsonNode q){
    OWLAnnotationValue value=q.path("annotationResource").asBoolean()
      ?iri(q.path("annotationValue").asText()):d.getOWLLiteral(q.path("annotationValue").asText());
    var nested=d.getOWLAnnotation(d.getOWLAnnotationProperty(iri(q.path("nestedProperty").asText())),d.getOWLLiteral(q.path("nestedValue").asText()));
    return d.getOWLAnnotation(d.getOWLAnnotationProperty(iri(q.path("annotationProperty").asText())),value,Set.of(nested));
  }
  static OWLAxiom target(OWLDataFactory d,JsonNode q){
    if(q.path("kind").asText().equals("declaration"))return d.getOWLDeclarationAxiom(switch(q.path("entityKind").asText()){
      case "objectProperty" -> d.getOWLObjectProperty(iri(q.path("iri").asText()));
      case "annotationProperty" -> d.getOWLAnnotationProperty(iri(q.path("iri").asText()));
      default -> d.getOWLClass(iri(q.path("iri").asText()));
    });
    var sub=d.getOWLClass(iri(q.path("sub").asText()));
    return switch(q.path("kind").asText()){
      case "subSome","subSomeInverse" -> {
        OWLObjectPropertyExpression p=d.getOWLObjectProperty(iri(q.path("property").asText()));
        if(q.path("kind").asText().equals("subSomeInverse"))p=p.getInverseProperty();
        yield d.getOWLSubClassOfAxiom(sub,d.getOWLObjectSomeValuesFrom(p,d.getOWLClass(iri(q.path("filler").asText()))));
      }
      case "subAll" -> d.getOWLSubClassOfAxiom(sub,d.getOWLObjectAllValuesFrom(
        d.getOWLObjectProperty(iri(q.path("property").asText())),d.getOWLClass(iri(q.path("filler").asText()))));
      case "subIntersection" -> {
        var operands=new HashSet<OWLClassExpression>();for(var v:q.path("operands"))operands.add(d.getOWLClass(iri(v.asText())));
        yield d.getOWLSubClassOfAxiom(sub,d.getOWLObjectIntersectionOf(operands));
      }
      case "annotatedSubClass" -> d.getOWLSubClassOfAxiom(sub,d.getOWLClass(iri(q.path("sup").asText())),Set.of(
        d.getOWLAnnotation(d.getOWLAnnotationProperty(iri(q.path("annotationProperty").asText())),d.getOWLLiteral(q.path("annotationValue").asText()))));
      case "nestedAnnotatedSubClass" -> d.getOWLSubClassOfAxiom(sub,d.getOWLClass(iri(q.path("sup").asText())),Set.of(nestedAnnotation(d,q)));
      case "subClass" -> d.getOWLSubClassOfAxiom(sub,d.getOWLClass(iri(q.path("sup").asText())));
      case "equivalent" -> d.getOWLEquivalentClassesAxiom(sub,d.getOWLClass(iri(q.path("sup").asText())));
      default -> throw new IllegalArgumentException("Unknown independent target kind");
    };
  }
  static String errorKind(Exception e){
    if(e instanceof RDFProvenance.MappingException)return "MAPPING_ERROR";
    if(e instanceof RDFProvenance.TimeoutException)return "TIMEOUT";
    if(e instanceof RDFProvenance.LimitException||e instanceof LocatedTurtleParser.LimitException)return "LIMIT";
    return "ERROR";
  }
  static String stack(Exception e){var text=new java.io.StringWriter();e.printStackTrace(new java.io.PrintWriter(text));return text.toString();}
  static boolean knownLegacyEmptyFailure(Exception e){
    return e instanceof NullPointerException&&"operands cannot be null or empty".equals(e.getMessage())
      &&Arrays.stream(e.getStackTrace()).anyMatch(f->Set.of(
        "org.semanticweb.owlapi.rdf.rdfxml.parser.Translators$ObjectIntersectionOfTranslator",
        "org.semanticweb.owlapi.rdf.rdfxml.parser.Translators$ObjectUnionOfTranslator",
        "org.semanticweb.owlapi.rdf.rdfxml.parser.TripleHandlers$TPIntersectionOfHandler",
        "org.semanticweb.owlapi.rdf.rdfxml.parser.TripleHandlers$TPUnionOfHandler").contains(f.getClassName()));
  }
  // Historical upstream-baseline tolerance only; never used by the product.
  static boolean legacyAnnotationResidualsMapped(OWLOntology o,List<RDFTriple> triples){
    if(triples.isEmpty())return true;
    // OWLAPI 5.5.1 mapAnnotation retains these three reification triples even
    // after creating a nested ontology annotation. Accept only a complete group
    // whose source/property/value is independently present in that parsed result.
    // Other residuals, dangling groups and mismatched annotation targets still fail.
    var ontology=o.getOntologyID().getOntologyIRI();if(ontology.isEmpty())return false;
    String ns="http://www.w3.org/2002/07/owl#";
    var groups=triples.stream().collect(Collectors.groupingBy(RDFTriple::getSubject));
    for(var entry:groups.entrySet()){
      if(!entry.getKey().isAnonymous()||entry.getValue().size()!=3)return false;
      var fields=new HashMap<String,RDFNode>();
      for(var triple:entry.getValue())if(fields.put(triple.getPredicate().getIRI().toString(),triple.getObject())!=null)return false;
      if(!fields.keySet().equals(Set.of(ns+"annotatedSource",ns+"annotatedProperty",ns+"annotatedTarget")))return false;
      if(!new RDFResourceIRI(ontology.get()).equals(fields.get(ns+"annotatedSource")))return false;
      RDFNode property=fields.get(ns+"annotatedProperty"),target=fields.get(ns+"annotatedTarget");
      boolean mapped=o.annotations().anyMatch(a->{
        if(!a.annotations().findAny().isPresent()||!new RDFResourceIRI(a.getProperty().getIRI()).equals(property))return false;
        OWLAnnotationValue value=a.getValue();
        return value instanceof OWLLiteral literal?new RDFLiteral(literal).equals(target):value instanceof IRI iri&&new RDFResourceIRI(iri).equals(target);
      });
      if(!mapped)return false;
    }
    return true;
  }
  static OWLOntology original(String content,String formatName,List<String> imports)throws Exception{
    var manager=Worker.manager();var ontology=manager.createOntology(new OWLOntologyID());manager.setOntologyDocumentIRI(ontology,BASE);
    var format=(RDFDocumentFormat)Worker.format(formatName);var consumer=new Worker.MappingConsumer(ontology,Worker.loader(imports));consumer.setOntologyFormat(format);
    if(formatName.equals("rdfxml")){
      Worker.safeXML(content);var parser=new RDFParser();consumer.useParser(parser);
      var input=new InputSource(new StringReader(content));input.setSystemId(BASE.toString());parser.parse(input,consumer);
    }else{consumer.startModel(BASE);new TurtleParser(new StringReader(content),consumer,BASE).parseDocument();}
    manager.setOntologyFormat(ontology,format);var metadata=format.getOntologyLoaderMetaData();
    if(metadata.isPresent()&&metadata.get() instanceof RDFParserMetaData rdf
      &&!legacyAnnotationResidualsMapped(ontology,rdf.getUnparsedTriples().toList()))throw new IllegalStateException("Original parser retained unmapped RDF");
    Worker.normalizeRDFClassExpressions(ontology);return ontology;
  }
  static boolean sameMetadata(OWLOntology a,OWLOntology b){return a.getAnnotations().equals(b.getAnnotations())
    &&a.getImportsDeclarations().equals(b.getImportsDeclarations())
    &&a.getOntologyID().getOntologyIRI().equals(b.getOntologyID().getOntologyIRI())
    &&a.getOntologyID().getVersionIRI().equals(b.getOntologyID().getVersionIRI());}
  static Set<OWLAxiom> expected(OWLDataFactory factory,JsonNode input){var result=new HashSet<OWLAxiom>();for(var q:input.path("expectedAxioms"))result.add(target(factory,q));return result;}
  static ObjectNode protocol(JsonNode input){
    var out=JSON.createObjectNode();out.put("indexReturned",false);
    var p=new RDFProvenance(new RDFProvenance.Budget(System.nanoTime()+20_000_000_000L));
    try{
      switch(input.path("protocol").asText()){
        case "zero" -> p.beforeTriple(0);
        case "nested" -> {p.beforeTriple(1);p.beforeTriple(2);}
        case "missing-event" -> {p.beforeTriple(1);p.afterTriple();}
        case "duplicate" -> {
          p.beforeTriple(1);
          try(var scope=p.input(RDFProvenance.FactKey.resource(iri("urn:prov:s"),iri("urn:prov:p"),iri("urn:prov:o")))){}
          p.afterTriple();p.beforeTriple(1);
        }
        default -> throw new IllegalArgumentException("Unknown protocol fixture");
      }
      out.put("status","ACCEPTED");
    }catch(Exception e){out.put("status",errorKind(e));out.put("error",e.toString());}
    return out;
  }
  static void readFact(RDFProvenance p,RDFProvenance.FactKey f){p.readResource(f.subject(),f.predicate(),f.resource());}
  // Internal trace protocol exercise only: these explicit API events are not
  // evidence that a document or ontology passed the native parser/worker.
  static ObjectNode syntheticRoles(JsonNode input){
    var out=JSON.createObjectNode();out.put("internalSyntheticRoleFixture",true);out.put("indexReturned",false);
    var p=new RDFProvenance(new RDFProvenance.Budget(System.nanoTime()+20_000_000_000L));
    var d=Worker.manager().getOWLDataFactory();IRI source=iri("urn:synthetic:source"),first=iri("urn:synthetic:first"),second=iri("urn:synthetic:second");
    IRI note=iri("urn:synthetic:note"),chosen=iri("urn:synthetic:chosen"),wrong=iri("urn:synthetic:wrong");
    boolean chooseFirst=input.path("chooseFirst").asBoolean(),empty=input.path("empty").asBoolean();
    var fs=List.of(RDFProvenance.FactKey.resource(source,iri("urn:synthetic:root"),chosen),
      RDFProvenance.FactKey.resource(first,iri("urn:synthetic:annotatedSource"),source),
      RDFProvenance.FactKey.resource(first,iri("urn:synthetic:annotatedProperty"),note),
      RDFProvenance.FactKey.resource(first,iri("urn:synthetic:annotatedTarget"),chooseFirst?chosen:wrong),
      RDFProvenance.FactKey.resource(first,iri("urn:synthetic:payload"),chosen),
      RDFProvenance.FactKey.resource(second,iri("urn:synthetic:annotatedSource"),source),
      RDFProvenance.FactKey.resource(second,iri("urn:synthetic:annotatedProperty"),note),
      RDFProvenance.FactKey.resource(second,iri("urn:synthetic:annotatedTarget"),chosen),
      RDFProvenance.FactKey.resource(second,iri("urn:synthetic:payload"),chosen));
    try{
      for(int i=0;i<fs.size();i++){
        p.beforeTriple(i+1);try(var scope=p.input(fs.get(i))){
          if(i==1)p.relationAdded("ANNOTATED_SOURCE",source,first);
          if(i==5)p.relationAdded("ANNOTATED_SOURCE",source,second);
        }p.afterTriple();
      }
      var annotation=d.getOWLAnnotation(d.getOWLAnnotationProperty(note),chosen);
      Set<OWLAnnotation> shared=Collections.singleton(annotation);
      var axiom=d.getOWLSubClassOfAxiom(d.getOWLClass(source),d.getOWLThing());
      try(var scope=p.dispatch("synthetic-only",fs.get(0))){
        p.relationUsed("ANNOTATED_SOURCE",source,List.of(first,second));
        var a=p.annotationCandidate(()->{readFact(p,fs.get(4));return empty?Collections.emptySet():input.path("sharedIdentity").asBoolean()?shared:new LinkedHashSet<>(Set.of(annotation));});
        var b=p.annotationCandidate(()->{readFact(p,fs.get(8));return empty?Collections.emptySet():input.path("sharedIdentity").asBoolean()?shared:new LinkedHashSet<>(Set.of(annotation));});
        IRI selected=null;
        try(var selection=p.annotationSelection(source)){
          if(selection.test(first,()->{readFact(p,fs.get(2));readFact(p,fs.get(3));return fs.get(3).resource().equals(chosen);}))selected=first;
          else if(selection.test(second,()->{readFact(p,fs.get(6));readFact(p,fs.get(7));return fs.get(7).resource().equals(chosen);}))selected=second;
          selection.select(selected);
        }
        p.annotationValueUsed(selected.equals(first)?a:b);p.emit(axiom);
      }
      var index=p.finish(Set.of(axiom));var roles=index.sources(axiom);out.put("indexReturned",true);out.put("status","MAPPED");
      out.set("construction",JSON.valueToTree(roles.constructionOccurrenceIds()));out.set("parserContext",JSON.valueToTree(roles.parserContextOccurrenceIds()));out.set("ids",JSON.valueToTree(index.occurrences(axiom)));
    }catch(Exception e){out.put("status",errorKind(e));out.put("error",e.toString());}
    return out;
  }
  static ObjectNode run(JsonNode input)throws Exception {
    if(input.has("protocol"))return protocol(input);
    if(input.path("syntheticRoles").asBoolean())return syntheticRoles(input);
    String content=input.path("content").asText(),formatName=input.path("format").asText("turtle");var out=JSON.createObjectNode();
    out.put("indexReturned",false);var imports=strings(input.path("imports"));
    var document=JSON.createObjectNode();document.put("format",formatName);document.put("content",content);document.put("digest",Worker.sha(content));
    OWLOntology original=null,ordinary=null;Worker.Parsed ordinaryParsed=null;
    try{original=original(content,formatName,imports);out.put("originalStatus","PARSED");}
    catch(Exception e){out.put("originalStatus","ERROR");out.put("originalError",e.toString());out.put("originalErrorStack",stack(e));out.put("knownLegacyEmptyFailure",knownLegacyEmptyFailure(e));}
    try{
      ordinaryParsed=Worker.parse(Worker.manager(),document,BASE.toString(),imports);ordinary=ordinaryParsed.ontology();out.put("ordinaryStatus","PARSED");
      out.set("ordinaryAxioms",JSON.valueToTree(ordinary.axioms().map(Object::toString).sorted().toList()));
      if(original!=null){out.put("ordinaryOriginalAxiomParity",ordinary.getAxioms().equals(original.getAxioms()));out.put("ordinaryOriginalMetadataParity",sameMetadata(ordinary,original));}
      if(input.has("expectedAxioms"))out.put("ordinaryExpectedAxiomParity",ordinary.getAxioms().equals(expected(ordinary.getOWLOntologyManager().getOWLDataFactory(),input)));
      boolean syntaxPresent=true;for(var q:input.path("expectedSyntax"))syntaxPresent&=ordinaryParsed.syntaxAxioms().contains(target(ordinary.getOWLOntologyManager().getOWLDataFactory(),q));
      out.put("expectedSyntaxPresent",syntaxPresent);
    }catch(Exception e){out.put("ordinaryStatus","ERROR");out.put("ordinaryError",e.toString());out.put("ordinaryErrorKind",errorKind(e));out.put("ordinaryErrorStack",stack(e));}
    if(input.path("ordinaryOnly").asBoolean())return out;
    try{
      var manager=Worker.manager();var ontology=manager.createOntology(new OWLOntologyID());manager.setOntologyDocumentIRI(ontology,BASE);
      var budget=new RDFProvenance.Budget(input.path("mode").asText().equals("deadline")?System.nanoTime()-1:System.nanoTime()+20_000_000_000L);
      var p=new RDFProvenance(budget);var consumer=new Worker.LocatedMappingConsumer(ontology,Worker.loader(imports),p);
      consumer.configureDeadline(budget.deadlineNanos());
      var format=new TurtleDocumentFormat();consumer.setOntologyFormat(format);consumer.startModel(BASE);
      boolean unbound=input.path("mode").asText().equals("unbound");
      var raw=LocatedTurtleParser.parse(content,BASE,consumer,new LocatedTurtleParser.OccurrenceObserver(){
        public void beforeTriple(int id){if(!unbound)p.beforeTriple(id);}
        public void afterTriple(){if(!unbound)p.afterTriple();}
      },200000);
      manager.setOntologyFormat(ontology,format);
      var metadata=format.getOntologyLoaderMetaData();
      boolean residuals=metadata.isEmpty()||!(metadata.get() instanceof RDFParserMetaData rdf)
        ||rdf.getUnparsedTriples().findAny().isEmpty();
      out.put("unparsedTriplesAccepted",residuals);
      out.put("preNormalizationAxiomCount",ontology.getAxiomCount());
      Worker.normalizeRDFClassExpressions(ontology,p);
      var index=p.finish(ontology.getAxioms());out.put("indexReturned",true);
      out.put("status","MAPPED");
      if(original!=null){out.put("axiomParity",ontology.getAxioms().equals(original.getAxioms()));out.put("metadataParity",sameMetadata(ontology,original));}
      if(ordinary!=null){out.put("ordinaryAxiomParity",ontology.getAxioms().equals(ordinary.getAxioms()));out.put("ordinaryMetadataParity",sameMetadata(ontology,ordinary));}
      if(input.has("expectedAxioms"))out.put("expectedAxiomParity",ontology.getAxioms().equals(expected(manager.getOWLDataFactory(),input)));
      out.put("axiomCount",ontology.getAxiomCount());out.put("factCount",index.factCount());out.put("occurrenceCount",index.occurrenceCount());
      out.put("ontologyAnnotationCount",ontology.getAnnotations().size());out.put("importCount",ontology.getImportsDeclarations().size());
      if(input.has("expectedOntologyAnnotation"))out.put("expectedOntologyAnnotationPresent",ontology.getAnnotations().contains(nestedAnnotation(manager.getOWLDataFactory(),input.path("expectedOntologyAnnotation"))));
      out.put("indexMatchesFinalAxioms",index.axioms().equals(ontology.getAxioms()));
      if(original!=null)out.set("originalAxioms",JSON.valueToTree(original.axioms().map(Object::toString).sorted().toList()));
      out.set("locatedAxioms",JSON.valueToTree(ontology.axioms().map(Object::toString).sorted().toList()));
      Map<Integer,LocatedTurtleParser.Source> sources=new HashMap<>();for(var s:raw.sources())sources.put(s.id(),s);
      var events=out.putArray("events");for(var event:raw.occurrences()){
        var value=events.addObject();value.put("id",event.id());var spans=value.putArray("spans");
        for(var term:List.of(event.subject(),event.predicate(),event.object())){
          var source=sources.get(term.sourceId());var span=spans.addObject();span.put("start",source.span().start());span.put("end",source.span().end());
          span.put("text",content.substring(source.span().start(),source.span().end()));span.put("generated",term.generated());
        }
      }
      var targets=out.putArray("targets");for(var q:input.path("targets")){
        OWLAxiom axiom=target(manager.getOWLDataFactory(),q);var value=targets.addObject();value.put("name",q.path("name").asText());
        value.put("present",ontology.containsAxiom(axiom));value.put("axiom",axiom.toString());
        if(ontology.containsAxiom(axiom)){
          var ids=index.occurrences(axiom);value.set("ids",JSON.valueToTree(ids));
          boolean immutable=false;try{ids.add(-1);}catch(UnsupportedOperationException expected){immutable=true;}value.put("immutable",immutable);
          var roles=index.sources(axiom);
          value.set("construction",JSON.valueToTree(roles.constructionOccurrenceIds()));
          value.set("parserContext",JSON.valueToTree(roles.parserContextOccurrenceIds()));
          int immutableRoles=0;
          for(var role:List.of(roles.constructionOccurrenceIds(),roles.parserContextOccurrenceIds())){
            try{role.add(-1);}catch(UnsupportedOperationException expected){immutableRoles++;}
          }
          value.put("immutableRoles",immutableRoles==2);
        }
      }
      boolean outsideRefused=false;try{index.occurrences(manager.getOWLDataFactory().getOWLSubClassOfAxiom(
        manager.getOWLDataFactory().getOWLClass(iri("urn:outside:absent")),manager.getOWLDataFactory().getOWLNothing()));}
      catch(RDFProvenance.MappingException expected){outsideRefused=true;}out.put("outsideAxiomRefused",outsideRefused);
      boolean resealRefused=false;try{p.finish(ontology.getAxioms());}catch(RDFProvenance.MappingException expected){resealRefused=true;}
      out.put("resealRefused",resealRefused);
    }catch(Exception e){out.put("status",errorKind(e));out.put("error",e.toString());}
    return out;
  }
  static String origin(Class<?> c)throws Exception{return Path.of(c.getProtectionDomain().getCodeSource().getLocation().toURI()).toRealPath().toString();}
  public static void main(String[] args)throws Exception{
    var input=JSON.readTree(Files.readAllBytes(Path.of(args[0])));var out=JSON.createObjectNode();var classes=out.putObject("classes");
    for(String name:List.of("io.evopilot.ontology.Worker","org.semanticweb.owlapi.rdf.rdfxml.parser.RDFProvenance",
      "org.semanticweb.owlapi.rdf.rdfxml.parser.LocatedRDFConsumerAdapter","org.semanticweb.owlapi.rdf.rdfxml.parser.LocatedRDFConsumer",
      "org.semanticweb.owlapi.rdf.rdfxml.parser.OWLRDFConsumer"))classes.put(name,origin(Class.forName(name)));
    var cases=out.putArray("cases");for(var value:input)cases.add(run(value));System.out.println(JSON.writeValueAsString(out));
  }
}
`;

let base,classes,binding,classpath,jars,sequence=0;
const execute=(file,args,options={})=>new Promise((resolve,reject)=>execFile(file,args,{timeout:45000,maxBuffer:16*1024*1024,...options},(error,stdout,stderr)=>error?reject(Error(`${file}: ${error.message}\n${stdout}\n${stderr}`)):resolve(stdout)));
before(async()=>{
  assert.ok(process.env.EVOPILOT_TEST_DL_TOOLCHAIN,'An actual current toolchain is required; no mock or skip path');
  binding=readDLToolchain(process.env.EVOPILOT_TEST_DL_TOOLCHAIN);verifyDLToolchain(binding);
  assert.equal(binding.workerSourceDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/Worker.java',import.meta.url))));
  assert.equal(binding.dependencyLockDigest,hashBytes(readFileSync(new URL('../../toolchains/owl2-dl/dependencies.json',import.meta.url))));
  jars=new Set(binding.runtimeFiles.filter(f=>/^dependencies\/owlapi-(distribution|parsers)-5\.5\.1\.jar$/.test(f.path)).map(f=>realpathSync(join(binding.root,f.path))));
  base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-rdf-provenance-')));classes=join(base,'classes');mkdirSync(classes,{mode:0o700});
  const source=join(base,'RDFProvenanceProbe.java');writeFileSync(source,javaSource,{mode:0o600});classpath=javaClasspath(binding);
  await execute(join(binding.javaRoot,'bin/javac'),['-encoding','UTF-8','-cp',classpath,'-d',classes,source]);
});
after(()=>{try{if(binding)verifyDLToolchain(binding);}finally{if(base)rmSync(base,{recursive:true,force:true});}});
async function inspect(...inputs){
  const path=join(base,'input-'+(++sequence)+'.json');writeFileSync(path,JSON.stringify(inputs),{mode:0o600});
  const result=JSON.parse(await execute(join(binding.javaRoot,'bin/java'),['-Xmx512m','-cp',[classes,classpath].join(delimiter),'io.evopilot.ontology.RDFProvenanceProbe',path]));
  for(const [name,path] of Object.entries(result.classes))assert.ok(name.endsWith('.OWLRDFConsumer')?jars.has(path):path===realpathSync(join(binding.root,'worker.jar')),name+' class origin');
  return result.cases;
}
const ns='urn:prov:';
const prefixes='@prefix : <urn:prov:> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n';
function fixture(rows,targets,extra={}){
  let content=prefixes;const lines=[];
  for(const [index,[id,text]] of rows.entries()){assert.equal(id,index+1,'Hand-authored occurrence ledger must be consecutive');const start=content.length;content+=text;lines.push({id,start,end:content.length});content+='\n';}
  return {content,targets,imports:[],lines,...extra};
}
const some=(name,sub)=>({name,kind:'subSome',sub:ns+sub,property:ns+'p',filler:ns+'C'});
const sub=(name,a,b)=>({name,kind:'subClass',sub:ns+a,sup:b.includes(':')?b:ns+b});
const thing='http://www.w3.org/2002/07/owl#Thing',nothing='http://www.w3.org/2002/07/owl#Nothing';
const declaration=(name,entityKind='class')=>({kind:'declaration',iri:ns+name,entityKind});
function ordinary(result,input){
  assert.equal(result.ordinaryStatus,'PARSED',JSON.stringify(result));assert.equal(result.expectedSyntaxPresent,true);
  if(input.legacyEmpty){assert.equal(result.originalStatus,'ERROR',JSON.stringify(result));assert.equal(result.knownLegacyEmptyFailure,true,result.originalErrorStack);}
  else if(input.legacyNested){assert.equal(result.originalStatus,'ERROR',JSON.stringify(result));assert.match(result.originalError,/Original parser retained unmapped RDF/);}
  else{assert.equal(result.originalStatus,'PARSED',JSON.stringify(result));assert.equal(result.ordinaryOriginalAxiomParity,true,JSON.stringify(result));assert.equal(result.ordinaryOriginalMetadataParity,true);}
  if(input.expectedAxioms)assert.equal(result.ordinaryExpectedAxiomParity,true,JSON.stringify(result));
}
function mapped(result,input){
  ordinary(result,input);assert.equal(result.status,'MAPPED',JSON.stringify(result));assert.equal(result.indexReturned,true);
  if(!input.legacyEmpty&&!input.legacyNested){assert.equal(result.axiomParity,true,JSON.stringify(result));assert.equal(result.metadataParity,true);}
  for(const key of ['ordinaryAxiomParity','ordinaryMetadataParity','unparsedTriplesAccepted','indexMatchesFinalAxioms','outsideAxiomRefused','resealRefused'])assert.equal(result[key],true,key+' '+JSON.stringify(result));
  if(input.expectedAxioms)assert.equal(result.expectedAxiomParity,true,JSON.stringify(result));
  assert.equal(result.occurrenceCount,input.lines.length);assert.deepEqual(result.events.map(e=>e.id),input.lines.map(l=>l.id));
  for(const [index,event] of result.events.entries())for(const span of event.spans){const line=input.lines[index];assert.equal(span.generated,false);assert.ok(span.start>=line.start&&span.end<=line.end&&span.end>span.start);assert.equal(input.content.slice(span.start,span.end),span.text);}
}
function sources(result,name,required,excluded){
  const target=result.targets.find(t=>t.name===name);assert.ok(target,name);assert.equal(target.present,true,target.axiom);assert.equal(target.immutable,true);
  const ids=new Set(target.ids);assert.equal(ids.size,target.ids.length);assert.deepEqual(target.ids,[...target.ids].sort((a,b)=>a-b));
  for(const id of required)assert.ok(ids.has(id),`${name}: missing independently required occurrence ${id}; got ${target.ids}`);
  for(const id of excluded)assert.ok(!ids.has(id),`${name}: unrelated/caller occurrence ${id} leaked; got ${target.ids}`);
  assert.equal(target.immutableRoles,true);
  for(const role of ['construction','parserContext'])assert.deepEqual(target[role],[...new Set(target[role])].sort((a,b)=>a-b),name+' '+role);
  assert.ok(target.construction.length>0,name+' must retain an actual construction');
  assert.deepEqual([...new Set([...target.construction,...target.parserContext])].sort((a,b)=>a-b),target.ids,name+' roles must partition the union allowing overlap');
}
function roleSources(result,name,role,required,excluded=[]){
  const target=result.targets.find(t=>t.name===name);assert.ok(target?.present,name);
  for(const id of required)assert.ok(target[role].includes(id),`${name} ${role}: required ${id}; got ${target[role]}`);
  for(const id of excluded)assert.ok(!target[role].includes(id),`${name} ${role}: excluded ${id}; got ${target[role]}`);
  return target[role];
}

test('shared restriction keeps its definition on first use and cache hits without another caller root',async()=>{
  const declarations=[[1,':A a owl:Class .'],[2,':B a owl:Class .'],[3,':C a owl:Class .'],[4,':p a owl:ObjectProperty .']];
  const defined=fixture([...declarations,[5,'_:r a owl:Restriction .'],[6,'_:r owl:onProperty :p .'],[7,'_:r owl:someValuesFrom :C .'],[8,':A rdfs:subClassOf _:r .'],[9,':B rdfs:subClassOf _:r .'],[10,':Unrelated a owl:Class .'],[11,':Unrelated rdfs:subClassOf :C .']],[some('A','A'),some('B','B')]);
  const rootsFirst=fixture([...declarations,[5,':A rdfs:subClassOf _:r .'],[6,':B rdfs:subClassOf _:r .'],[7,'_:r a owl:Restriction .'],[8,'_:r owl:onProperty :p .'],[9,'_:r owl:someValuesFrom :C .'],[10,':Unrelated a owl:Class .'],[11,':Unrelated rdfs:subClassOf :C .']],[some('A','A'),some('B','B')]);
  const [a,b]=await inspect(defined,rootsFirst);mapped(a,defined);mapped(b,rootsFirst);
  sources(a,'A',[5,6,7,8],[9,10,11]);sources(a,'B',[5,6,7,9],[8,10,11]);
  sources(b,'A',[5,7,8,9],[6,10,11]);sources(b,'B',[6,7,8,9],[5,10,11]);
  roleSources(a,'A','construction',[5,6,7,8],[9,10,11]);roleSources(a,'B','construction',[5,6,7,9],[8,10,11]);
  roleSources(b,'A','construction',[5,7,8,9],[6,10,11]);roleSources(b,'B','construction',[6,7,8,9],[5,10,11]);
});

test('shared RDF list cache preserves first/rest facts without the other expression root',async()=>{
  const input=fixture([[1,':A a owl:Class .'],[2,':B a owl:Class .'],[3,':C a owl:Class .'],[4,':D a owl:Class .'],[5,'_:left a owl:Class .'],[6,'_:left owl:intersectionOf _:list .'],[7,'_:list rdf:first :C .'],[8,'_:list rdf:rest _:tail .'],[9,'_:tail rdf:first :D .'],[10,'_:tail rdf:rest rdf:nil .'],[11,'_:right a owl:Class .'],[12,'_:right owl:intersectionOf _:list .'],[13,':A rdfs:subClassOf _:left .'],[14,':B rdfs:subClassOf _:right .'],[15,':Unrelated a owl:Class .'],[16,':Unrelated rdfs:subClassOf :C .']],['A','B'].map(name=>({name,kind:'subIntersection',sub:ns+name,operands:[ns+'C',ns+'D']})));
  const [r]=await inspect(input);mapped(r,input);sources(r,'A',[6,7,8,9,10,13],[12,14,15,16]);sources(r,'B',[7,8,9,10,12,14],[6,13,15,16]);
  roleSources(r,'A','construction',[6,7,8,9,10,13],[12,14,15,16]);roleSources(r,'B','construction',[7,8,9,10,12,14],[6,13,15,16]);
  // Each intersection predicate is both an actual matcher observation and a
  // constructor lookup; the two roles must not be made mutually exclusive.
  roleSources(r,'A','parserContext',[6],[12,14,15,16]);roleSources(r,'B','parserContext',[12],[6,13,15,16]);
});

test('different syntax events for one canonical RDF fact all survive deduplication',async()=>{
  const input=fixture([[1,':A a owl:Class .'],[2,':B a owl:Class .'],[3,':A rdfs:subClassOf :B .'],[4,'<urn:prov:A> <http://www.w3.org/2000/01/rdf-schema#subClassOf> <urn:prov:B> .'],[5,':Unrelated a owl:Class .'],[6,':Unrelated rdfs:subClassOf :B .']],[sub('A','A','B')]);
  const [r]=await inspect(input);mapped(r,input);assert.equal(r.factCount,5);assert.equal(r.occurrenceCount,6);sources(r,'A',[3,4],[5,6]);
  roleSources(r,'A','construction',[3,4],[5,6]);
});

test('annotated axiom retains reification typing and relations while ontology annotations/imports stay unchanged',async()=>{
  const input=fixture([[1,':A a owl:Class .'],[2,':B a owl:Class .'],[3,':note a owl:AnnotationProperty .'],[4,':A rdfs:subClassOf :B .'],[5,'_:annotation a owl:Axiom .'],[6,'_:annotation owl:annotatedSource :A .'],[7,'_:annotation owl:annotatedProperty rdfs:subClassOf .'],[8,'_:annotation owl:annotatedTarget :B .'],[9,'_:annotation :note "regulated" .'],[10,':Ontology a owl:Ontology .'],[11,':Ontology rdfs:label "owner annotation" .'],[12,':Ontology owl:imports <urn:prov:dependency> .'],[13,':Unrelated a owl:Class .'],[14,':Unrelated rdfs:subClassOf :B .']],[{name:'annotated',kind:'annotatedSubClass',sub:ns+'A',sup:ns+'B',annotationProperty:ns+'note',annotationValue:'regulated'},sub('removed-base','A','B')],{imports:['urn:prov:dependency']});
  const [r]=await inspect(input);mapped(r,input);assert.equal(r.ontologyAnnotationCount,1);assert.equal(r.importCount,1);sources(r,'annotated',[4,5,6,7,8,9],[10,11,12,13,14]);assert.equal(r.targets.find(t=>t.name==='removed-base').present,false);
  roleSources(r,'annotated','construction',[4,5,6,7,8,9],[1,2,3,10,11,12,13,14]);
  roleSources(r,'annotated','parserContext',[3],[10,11,12,13,14]);
});

test('singleton normalization, collision and reflexive equivalence retain independent original parity',async()=>{
  const targets=[sub('singleton-collision','A','B'),sub('reflexive','A','A')];
  const input=fixture([[1,':A a owl:Class .'],[2,':B a owl:Class .'],[3,'_:single a owl:Class .'],[4,'_:single owl:intersectionOf _:cell .'],[5,'_:cell rdf:first :B .'],[6,'_:cell rdf:rest rdf:nil .'],[7,':A rdfs:subClassOf _:single .'],[8,':A rdfs:subClassOf :B .'],[9,':A owl:equivalentClass :A .'],[10,':Unrelated a owl:Class .'],[11,':Unrelated rdfs:subClassOf :B .']],targets,{expectedAxioms:[declaration('A'),declaration('B'),declaration('Unrelated'),...targets,sub('unrelated','Unrelated','B')]});
  const [r]=await inspect(input);mapped(r,input);sources(r,'singleton-collision',[4,5,6,7,8],[9,10,11]);sources(r,'reflexive',[9],[4,5,6,7,8,10,11]);
  roleSources(r,'singleton-collision','construction',[4,5,6,7,8],[9,10,11]);roleSources(r,'reflexive','construction',[9],[4,5,6,7,8,10,11]);
});

test('anonymous rdf:nil intersection and union correct the proven legacy factory failure with complete independent axioms',async()=>{
  const targets=[sub('intersection','TopUser',thing),sub('union','BottomUser',nothing)];
  const input=fixture([[1,':TopUser a owl:Class .'],[2,':BottomUser a owl:Class .'],[3,'_:i a owl:Class .'],[4,'_:i owl:intersectionOf rdf:nil .'],[5,':TopUser rdfs:subClassOf _:i .'],[6,'_:u a owl:Class .'],[7,'_:u owl:unionOf rdf:nil .'],[8,':BottomUser rdfs:subClassOf _:u .']],targets,{legacyEmpty:true,expectedAxioms:[declaration('TopUser'),declaration('BottomUser'),...targets]});
  const [r]=await inspect(input);mapped(r,input);sources(r,'intersection',[4,5],[6,7,8]);sources(r,'union',[7,8],[3,4,5]);
});

test('nested empty class expression and unreferenced empty definition preserve profile closure without source contamination',async()=>{
  const target={...some('nested','A'),filler:thing};
  const input=fixture([[1,':A a owl:Class .'],[2,':p a owl:ObjectProperty .'],[3,'_:empty a owl:Class .'],[4,'_:empty owl:intersectionOf rdf:nil .'],[5,'_:r a owl:Restriction .'],[6,'_:r owl:onProperty :p .'],[7,'_:r owl:someValuesFrom _:empty .'],[8,':A rdfs:subClassOf _:r .'],[9,'_:unreferenced a owl:Class .'],[10,'_:unreferenced owl:unionOf rdf:nil .']],[target],{legacyEmpty:true,expectedAxioms:[declaration('A'),declaration('p','objectProperty'),target],expectedSyntax:[{kind:'subClass',sub:thing,sup:thing},{kind:'subClass',sub:nothing,sup:nothing}]});
  const [r]=await inspect(input);mapped(r,input);sources(r,'nested',[4,5,6,7,8],[9,10]);
});

test('named rdf:nil shorthand uses equivalent classes and retains the actual shorthand root',async()=>{
  const targets=[{name:'named-intersection',kind:'equivalent',sub:ns+'Top',sup:thing},{name:'named-union',kind:'equivalent',sub:ns+'Bottom',sup:nothing}];
  const input=fixture([[1,':Top a owl:Class .'],[2,':Bottom a owl:Class .'],[3,':Top owl:intersectionOf rdf:nil .'],[4,':Bottom owl:unionOf rdf:nil .'],[5,':Unrelated a owl:Class .'],[6,':Other a owl:Class .'],[7,':Unrelated rdfs:subClassOf :Other .']],targets,{legacyEmpty:true,expectedAxioms:[declaration('Top'),declaration('Bottom'),declaration('Unrelated'),declaration('Other'),sub('unrelated','Unrelated','Other'),...targets]});
  const [r]=await inspect(input);mapped(r,input);
  // Pinned TripleHandlers.TPIntersectionOfHandler.canHandleStreaming reads
  // Top's type (1), then classifies rdf:nil while processing (3). During
  // mop-up AbstractTriplePredicateHandler.canHandle calls inferTypes before
  // comparing predicates; inferTypes first reads the object's classification.
  // Thus union (4) really depends on positive parser context (1,3), even though
  // neither its exact-nil branch nor its named class translation reads a list
  // cache. This is mapping-input provenance, not a minimal justification.
  // Independent statements (5,6,7) remain excluded from both source sets.
  // The intersection can reuse its own streaming classification witness (3);
  // its source set need not repeat the declaration used to seed nil's state.
  sources(r,'named-intersection',[3],[4,5,6,7]);sources(r,'named-union',[1,3,4],[5,6,7]);
  assert.deepEqual(roleSources(r,'named-union','construction',[4],[1,3,5,6,7]),[4]);
  roleSources(r,'named-union','parserContext',[1,3],[5,6,7]);
  roleSources(r,'named-intersection','construction',[3],[1,2,4,5,6,7]);
});

test('empty individual enumeration retains the previously supported original projection',async()=>{
  const targets=[sub('enumeration','Nobody',nothing)];
  const input=fixture([[1,':Nobody a owl:Class .'],[2,'_:empty a owl:Class .'],[3,'_:empty owl:oneOf rdf:nil .'],[4,':Nobody rdfs:subClassOf _:empty .']],targets,{expectedAxioms:[declaration('Nobody'),...targets]});
  const [r]=await inspect(input);mapped(r,input);sources(r,'enumeration',[3,4],[]);
});

test('non-nil missing RDF list contents are rejected rather than normalized to an empty class',async()=>{
  const input=fixture([[1,':A a owl:Class .'],[2,'_:bad a owl:Class .'],[3,'_:bad owl:intersectionOf _:missing .'],[4,':A rdfs:subClassOf _:bad .']],[sub('must-not-be-derived','A',thing)]);
  const [r]=await inspect(input);assert.equal(r.originalStatus,'ERROR',JSON.stringify(r));assert.equal(r.ordinaryStatus,'ERROR',JSON.stringify(r));assert.ok(['ERROR','MAPPING_ERROR'].includes(r.ordinaryErrorKind));assert.ok(['ERROR','MAPPING_ERROR'].includes(r.status));assert.equal(r.indexReturned,false);assert.equal(r.targets,undefined);
});

test('ordinary RDFXML preserves original parsing and implements the same exact empty-list compatibility correction',async()=>{
  const open='<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#" xmlns:owl="http://www.w3.org/2002/07/owl#">',close='</rdf:RDF>';
  const plain={format:'rdfxml',ordinaryOnly:true,imports:[],content:open+'<owl:Class rdf:about="urn:prov:A"><rdfs:subClassOf rdf:resource="urn:prov:B"/></owl:Class><owl:Class rdf:about="urn:prov:B"/>'+close,expectedAxioms:[declaration('A'),declaration('B'),sub('A','A','B')]};
  const empty={format:'rdfxml',ordinaryOnly:true,legacyEmpty:true,imports:[],content:open+'<owl:Class rdf:about="urn:prov:Top"><rdfs:subClassOf><owl:Class><owl:intersectionOf rdf:resource="http://www.w3.org/1999/02/22-rdf-syntax-ns#nil"/></owl:Class></rdfs:subClassOf></owl:Class><owl:Class rdf:about="urn:prov:Bottom"><rdfs:subClassOf><owl:Class><owl:unionOf rdf:resource="http://www.w3.org/1999/02/22-rdf-syntax-ns#nil"/></owl:Class></rdfs:subClassOf></owl:Class>'+close,expectedAxioms:[declaration('Top'),declaration('Bottom'),sub('top','Top',thing),sub('bottom','Bottom',nothing)]};
  const [a,b]=await inspect(plain,empty);ordinary(a,plain);ordinary(b,empty);assert.equal(a.indexReturned,false);assert.equal(b.indexReturned,false);
});

test('shared inverse property construction retains inverseOf without inheriting another restriction caller',async()=>{
  const input=fixture([[1,':A a owl:Class .'],[2,':B a owl:Class .'],[3,':C a owl:Class .'],[4,':p a owl:ObjectProperty .'],[5,'_:inverse owl:inverseOf :p .'],[6,'_:left a owl:Restriction .'],[7,'_:left owl:onProperty _:inverse .'],[8,'_:left owl:someValuesFrom :C .'],[9,'_:right a owl:Restriction .'],[10,'_:right owl:onProperty _:inverse .'],[11,'_:right owl:someValuesFrom :C .'],[12,':A rdfs:subClassOf _:left .'],[13,':B rdfs:subClassOf _:right .'],[14,':Unrelated a owl:Class .'],[15,':Unrelated rdfs:subClassOf :C .']],['A','B'].map(name=>({...some(name,name),kind:'subSomeInverse'})));
  const [r]=await inspect(input);mapped(r,input);sources(r,'A',[5,6,7,8,12],[9,10,11,13,14,15]);sources(r,'B',[5,9,10,11,13],[6,7,8,12,14,15]);
  roleSources(r,'A','construction',[5,6,7,8,12],[9,10,11,13,14,15]);roleSources(r,'B','construction',[5,9,10,11,13],[6,7,8,12,14,15]);
});

test('streaming allValuesFrom probe may populate a cache without making its intrinsic construction context-only',async()=>{
  // The pinned TPAllValuesFromHandler.canHandleStreaming calls ce(s) after
  // finding a known object property and named filler. This is a real cache
  // write inside a selection probe, before either subclass caller arrives.
  const input=fixture([[1,':A a owl:Class .'],[2,':B a owl:Class .'],[3,':C a owl:Class .'],[4,':p a owl:ObjectProperty .'],[5,'_:r a owl:Restriction .'],[6,'_:r owl:onProperty :p .'],[7,'_:r owl:allValuesFrom :C .'],[8,':A rdfs:subClassOf _:r .'],[9,':B rdfs:subClassOf _:r .'],[10,':Unrelated a owl:Class .'],[11,':Unrelated rdfs:subClassOf :C .']],['A','B'].map(name=>({...some(name,name),kind:'subAll'})));
  const [r]=await inspect(input);mapped(r,input);
  sources(r,'A',[5,6,7,8],[9,10,11]);sources(r,'B',[5,6,7,9],[8,10,11]);
  roleSources(r,'A','construction',[5,6,7,8],[9,10,11]);roleSources(r,'B','construction',[5,6,7,9],[8,10,11]);
  roleSources(r,'A','parserContext',[4,7],[9,10,11]);roleSources(r,'B','parserContext',[4,7],[8,10,11]);
});

test('nested axiom annotations consume both actually attached complete reifications, preserving the original-parser refusal as history',async()=>{
  const inputs=[false,true].map(resource=>{
    const value=resource?':chosen':'"chosen"';
    const target={name:'nested',kind:'nestedAnnotatedSubClass',sub:ns+'A',sup:ns+'B',annotationProperty:ns+'note',annotationValue:resource?ns+'chosen':'chosen',annotationResource:resource,nestedProperty:ns+'mark',nestedValue:'selected'};
    return fixture([[1,':A a owl:Class .'],[2,':B a owl:Class .'],[3,':note a owl:AnnotationProperty .'],[4,':mark a owl:AnnotationProperty .'],[5,':A rdfs:subClassOf :B .'],[6,'_:ax a owl:Axiom .'],[7,'_:ax owl:annotatedSource :A .'],[8,'_:ax owl:annotatedProperty rdfs:subClassOf .'],[9,'_:ax owl:annotatedTarget :B .'],[10,`_:ax :note ${value} .`],
      [11,'_:first a owl:Annotation .'],[12,'_:first owl:annotatedSource _:ax .'],[13,'_:first owl:annotatedProperty :note .'],[14,`_:first owl:annotatedTarget ${value} .`],[15,'_:first :mark "selected" .'],
      [16,'_:second a owl:Annotation .'],[17,'_:second owl:annotatedSource _:ax .'],[18,'_:second owl:annotatedProperty :note .'],[19,`_:second owl:annotatedTarget ${value} .`],[20,'_:second :mark "selected" .'],
      [21,':Unrelated a owl:Class .'],[22,':Unrelated rdfs:subClassOf :B .']],
    [target],{legacyNested:true,expectedAxioms:[declaration('A'),declaration('B'),declaration('note','annotationProperty'),declaration('mark','annotationProperty'),declaration('Unrelated'),sub('unrelated','Unrelated','B'),target]});
  });
  const results=await inspect(...inputs);
  for(const [i,r] of results.entries()){
    mapped(r,inputs[i]);sources(r,'nested',Array.from({length:16},(_,i)=>i+5),[21,22]);
    roleSources(r,'nested','construction',Array.from({length:16},(_,i)=>i+5),[1,2,3,4,21,22]);
  }
});

test('actual accepted nested ontology annotations exercise literal and resource selectors without weakening residual guards',async()=>{
  const inputs=[false,true].map(resource=>{
    const value=resource?':chosen':'"chosen"';
    const annotation={annotationProperty:ns+'note',annotationValue:resource?ns+'chosen':'chosen',annotationResource:resource,nestedProperty:ns+'mark',nestedValue:'selected'};
    return fixture([[1,':Ontology a owl:Ontology .'],[2,':note a owl:AnnotationProperty .'],[3,':mark a owl:AnnotationProperty .'],[4,`:Ontology :note ${value} .`],
      [5,'_:first a owl:Annotation .'],[6,'_:first owl:annotatedSource :Ontology .'],[7,'_:first owl:annotatedProperty :note .'],[8,`_:first owl:annotatedTarget ${value} .`],[9,'_:first :mark "selected" .'],
      [10,'_:second a owl:Annotation .'],[11,'_:second owl:annotatedSource :Ontology .'],[12,'_:second owl:annotatedProperty :note .'],[13,`_:second owl:annotatedTarget ${value} .`],[14,'_:second :mark "selected" .'],
      [15,':Unrelated a owl:Class .'],[16,':Other a owl:Class .'],[17,':Unrelated rdfs:subClassOf :Other .']],
    [sub('unrelated','Unrelated','Other')],{expectedOntologyAnnotation:annotation});
  });
  const results=await inspect(...inputs);
  for(const [i,r] of results.entries()){
    mapped(r,inputs[i]);assert.equal(r.ontologyAnnotationCount,1);assert.equal(r.expectedOntologyAnnotationPresent,true);
    sources(r,'unrelated',[17],Array.from({length:14},(_,i)=>i+1));
  }
});

test('internal synthetic trace API promotes only selected candidate identities and does not merge shared empty/singleton values',async()=>{
  const [first,second,empty,shared]=await inspect(
    {syntheticRoles:true,chooseFirst:true},{syntheticRoles:true,chooseFirst:false},
    {syntheticRoles:true,chooseFirst:false,empty:true},{syntheticRoles:true,chooseFirst:false,sharedIdentity:true});
  for(const r of [first,second,empty,shared])assert.equal(r.internalSyntheticRoleFixture,true);
  for(const r of [first,second,empty]){
    assert.equal(r.status,'MAPPED',JSON.stringify(r));assert.equal(r.indexReturned,true);
    assert.ok(r.parserContext.includes(5)&&r.parserContext.includes(9),'Both eager payload reads remain context');
    assert.deepEqual([...new Set([...r.construction,...r.parserContext])].sort((a,b)=>a-b),r.ids);
  }
  assert.deepEqual(first.construction,[1,2,3,4,5]);assert.deepEqual(second.construction,[1,6,7,8,9]);
  assert.deepEqual(empty.construction,[1,6,7,8]);
  assert.equal(shared.status,'MAPPING_ERROR',JSON.stringify(shared));assert.equal(shared.indexReturned,false);
  assert.match(shared.error,/ambiguous candidate provenance/);
});

test('unbound statement, expired deadline and invalid observer lifecycle fail without a completed index',async()=>{
  const input=fixture([[1,':A a owl:Class .'],[2,':B a owl:Class .'],[3,':A rdfs:subClassOf :B .']],[sub('A','A','B')]);
  const [unbound,expired,...protocol]=await inspect({...input,mode:'unbound'},{...input,mode:'deadline'},...['zero','nested','missing-event','duplicate'].map(protocol=>({protocol})));
  for(const r of [unbound,expired])assert.equal(r.originalStatus,'PARSED',JSON.stringify(r));
  assert.equal(unbound.status,'MAPPING_ERROR',JSON.stringify(unbound));assert.equal(expired.status,'TIMEOUT',JSON.stringify(expired));
  for(const r of protocol)assert.equal(r.status,'MAPPING_ERROR',JSON.stringify(r));
  for(const r of [unbound,expired,...protocol]){assert.equal(r.indexReturned,false);assert.equal(r.targets,undefined);}
});
