package io.evopilot.ontology;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.stream.*;
import javax.xml.XMLConstants;
import javax.xml.parsers.SAXParserFactory;
import org.xml.sax.*;
import org.xml.sax.ext.DefaultHandler2;
import org.semanticweb.owlapi.apibinding.OWLManager;
import org.semanticweb.owlapi.model.*;
import org.semanticweb.owlapi.formats.*;
import org.semanticweb.owlapi.io.*;
import org.semanticweb.owlapi.profiles.OWL2DLProfile;
import org.semanticweb.owlapi.util.OWLObjectTransformer;
import org.semanticweb.owlapi.reasoner.*;
import org.semanticweb.owlapi.functional.parser.OWLFunctionalSyntaxOWLParserFactory;
import org.semanticweb.owlapi.rdf.rdfxml.parser.RDFXMLParserFactory;
import org.semanticweb.owlapi.rdf.turtle.parser.TurtleOntologyParserFactory;
import org.semanticweb.HermiT.Configuration;
import org.semanticweb.HermiT.ReasonerFactory;

/** One bounded formal task. No owner state, permissions, user decisions or network resolution. */
public final class Worker {
  static final ObjectMapper JSON=new ObjectMapper().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION);
  static final int INPUT_BYTES=48*1024*1024, OUTPUT_BYTES=8*1024*1024, AXIOMS=100000;
  static String refusedImport=null;
  static int importTraversals=0;
  static final class Refusal extends RuntimeException {
    final String status,code;
    Refusal(String status,String code,String message){super(message);this.status=status;this.code=code;}
  }
  static Refusal invalid(String code,String message){return new Refusal("INVALID_INPUT",code,message);}
  static void require(boolean condition,String code,String message){if(!condition)throw invalid(code,message);}
  static String str(JsonNode v,String key){JsonNode n=v.get(key);require(n!=null&&n.isTextual(),"INVALID_ENVELOPE","Expected text field");return n.textValue();}
  static String sha(String text)throws Exception{return "sha256:"+HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));}
  static OWLDocumentFormat format(String name){return switch(name){case "turtle"->new TurtleDocumentFormat();case "rdfxml"->new RDFXMLDocumentFormat();case "functional"->new FunctionalSyntaxDocumentFormat();default->throw invalid("UNSUPPORTED_FORMAT","Unsupported ontology format");};}
  static void deadline(long end){if(System.nanoTime()>end)throw new Refusal("TIMEOUT","TASK_DEADLINE","Formal task deadline reached");}

  static void safeXML(String text)throws Exception {
    SAXParserFactory factory=SAXParserFactory.newInstance();factory.setNamespaceAware(true);factory.setXIncludeAware(false);
    factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING,true);
    XMLReader reader=factory.newSAXParser().getXMLReader();
    reader.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD,"");reader.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA,"");
    reader.setFeature("http://xml.org/sax/features/external-general-entities",false);
    reader.setFeature("http://xml.org/sax/features/external-parameter-entities",false);
    reader.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd",false);
    DefaultHandler2 handler=new DefaultHandler2(){int depth=0;
      public void startDTD(String name,String publicId,String systemId)throws SAXException{if(publicId!=null||systemId!=null)throw new SAXException("External DTD refused");}
      public void externalEntityDecl(String name,String publicId,String systemId)throws SAXException{throw new SAXException("External entity refused");}
      public InputSource resolveEntity(String publicId,String systemId)throws SAXException{throw new SAXException("External entity refused");}
      public void startElement(String uri,String local,String name,Attributes a)throws SAXException{if(++depth>256)throw new SAXException("XML depth budget");}
      public void endElement(String uri,String local,String name){depth--;}
      public void fatalError(SAXParseException e)throws SAXException{throw e;}
    };
    reader.setContentHandler(handler);reader.setEntityResolver(handler);reader.setErrorHandler(handler);
    reader.setProperty("http://xml.org/sax/properties/lexical-handler",handler);reader.setProperty("http://xml.org/sax/properties/declaration-handler",handler);
    reader.parse(new InputSource(new StringReader(text)));
  }
  static OWLOntologyManager manager(){
    OWLOntologyManager m=OWLManager.createOWLOntologyManager();
    m.setOntologyParsers(Set.of(new RDFXMLParserFactory(),new TurtleOntologyParserFactory(),new OWLFunctionalSyntaxOWLParserFactory()));
    // OWLAPI also calls IRI mappers while assigning internal document identities. Map
    // every potential load to a non-retrievable URN instead of throwing during that
    // metadata operation. Expected imports are parsed separately from admitted bytes.
    m.setIRIMappers(Set.of(iri->IRI.create("urn:evopilot:unresolvable:"+Integer.toUnsignedString(iri.hashCode()))));
    m.addMissingImportListener(event->{refusedImport=event.getImportedOntologyURI().toString();});
    return m;
  }
  static OWLOntologyLoaderConfiguration loader(Collection<String> ignored){
    // OWLAPI 5.5.1's strict RDF reader counts owl:imports objects as additional
    // ontology headers and rejects legal imports. Use its normal reader, then verify
    // the exact header/import identities, unparsed triples and complete DL profile.
    var c=new OWLOntologyLoaderConfiguration().clearIgnoredImports().setStrict(false).setRepairIllegalPunnings(false)
      .setMissingImportHandlingStrategy(MissingImportHandlingStrategy.THROW_EXCEPTION).setConnectionTimeout(1).setRetriesToAttempt(0)
      .setFollowRedirects(false).setEntityExpansionLimit("1000");
    for(String iri:ignored)c=c.addIgnoredImport(IRI.create(iri));return c;
  }
  static boolean annotationResidualsMapped(OWLOntology o,List<RDFTriple> triples){
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
  @SuppressWarnings("unchecked")
  static void normalizeRDFClassExpressions(OWLOntology o){
    // OWL 2 RDF Mapping, Table 15: OWL 1 empty/singleton class intersections,
    // unions and empty enumerations have defined OWL 2 structural projections.
    // Preserve source bytes; normalize only the separate parsed RDF projection.
    var m=o.getOWLOntologyManager();var d=m.getOWLDataFactory();
    Class<Object> witness=(Class<Object>)(Class<?>)OWLClassExpression.class;
    // The Object callback also returns OWLFacet unchanged: OWLAPI 5.5.1 invokes
    // that callback outside the witness filter while traversing datatype facets.
    var transformer=new OWLObjectTransformer<Object>(x->true,value->{
      if(value instanceof OWLObjectIntersectionOf c){var args=c.operands().toList();if(args.isEmpty())return d.getOWLThing();if(args.size()==1)return args.get(0);}
      if(value instanceof OWLObjectUnionOf c){var args=c.operands().toList();if(args.isEmpty())return d.getOWLNothing();if(args.size()==1)return args.get(0);}
      if(value instanceof OWLObjectOneOf c&&c.individuals().findAny().isEmpty())return d.getOWLNothing();
      return value;
    },d,witness);
    for(int iteration=0;iteration<256;iteration++){
      // Transform axiom content only. change(ontology) also emits annotation/ID
      // replacement operations even when they are unchanged, preventing a fixed point.
      var changes=new ArrayList<OWLOntologyChange>();
      for(var ax:o.axioms().toList())for(var change:transformer.change(ax))changes.add(change.createOntologyChange(o));
      if(changes.isEmpty())return;m.applyChanges(changes);
    }
    throw invalid("NORMALIZATION_DEPTH","RDF expression projection exceeds its depth budget");
  }
  static OWLOntology parse(OWLOntologyManager m,JsonNode doc,String base,Collection<String> imports)throws Exception {
    String content=str(doc,"content"),f=str(doc,"format");require(content.getBytes(StandardCharsets.UTF_8).length<=8*1024*1024,"INPUT_LIMIT","Document byte budget");
    require(sha(content).equals(str(doc,"digest")),"DIGEST_MISMATCH","Document bytes differ from binding");
    if(f.equals("rdfxml"))try{safeXML(content);}catch(Exception e){throw invalid("UNSAFE_XML","Malformed, external-entity or over-budget XML");}
    var result=m.loadOntologyFromOntologyDocument(new StringDocumentSource(content,IRI.create(base),format(f),null),loader(imports));
    require(m.getOntologyFormat(result).getKey().equals(format(f).getKey()),"FORMAT_MISMATCH","Parsed format differs from declared format");
    var metadata=m.getOntologyFormat(result).getOntologyLoaderMetaData();
    if(metadata.isPresent()&&metadata.get() instanceof RDFParserMetaData rdf)require(annotationResidualsMapped(result,rdf.getUnparsedTriples().toList()),"UNPARSED_RDF","RDF triples were not mapped to OWL axioms");
    if(!f.equals("functional"))normalizeRDFClassExpressions(result);
    return result;
  }
  record Loaded(OWLOntologyManager manager,OWLOntology ontology,Map<OWLAxiom,List<JsonNode>> origins){}
  static OWLOntology anonymous(OWLOntologyManager manager,Collection<OWLAxiom> axioms)throws Exception {
    var ontology=manager.createOntology(new OWLOntologyID());manager.addAxioms(ontology,new HashSet<>(axioms));return ontology;
  }
  static Loaded load(JsonNode closure,long end)throws Exception {
    require(closure!=null&&closure.isObject(),"INVALID_ENVELOPE","Closure required");
    JsonNode docs=closure.get("documents"),edges=closure.get("imports");
    require(docs!=null&&docs.isArray()&&docs.size()>0&&docs.size()<=64&&edges!=null&&edges.isArray()&&edges.size()<=512,"INPUT_LIMIT","Bounded closure required");
    var m=manager();var origins=new HashMap<OWLAxiom,List<JsonNode>>();var byId=new HashMap<String,JsonNode>();
    var expected=new HashMap<String,Map<String,String>>();var alias=new HashMap<String,String>();int bytes=0;
    for(JsonNode d:docs){String id=str(d,"id");require(byId.put(id,d)==null,"IMPORT_CONFLICT","Duplicate document identity");bytes+=str(d,"content").getBytes(StandardCharsets.UTF_8).length;
      for(String key:List.of("documentIri","ontologyIri","versionIri")){JsonNode a=d.get(key);require(a!=null,"INVALID_ENVELOPE","Missing document identity");if(a.isNull())continue;String old=alias.put(a.asText(),id);require(old==null||old.equals(id),"IMPORT_CONFLICT","Conflicting ontology identity");}
    }
    require(bytes<=32*1024*1024,"INPUT_LIMIT","Closure byte budget");
    for(JsonNode e:edges){String from=str(e,"from"),iri=str(e,"iri"),to=str(e,"to");require(byId.containsKey(from)&&byId.containsKey(to),"MISSING_IMPORT","Pinned document absent");require(to.equals(alias.get(iri)),"IMPORT_CONFLICT","Import target identity differs");require(expected.computeIfAbsent(from,k->new HashMap<>()).put(iri,to)==null,"IMPORT_CONFLICT","Duplicate import binding");}
    var reachable=new HashSet<String>();walk(str(closure,"rootDocumentId"),expected,byId,new HashSet<>(),reachable);
    require(reachable.size()==byId.size(),"UNREACHABLE_DOCUMENT","Closure contains unused documents");
    for(String id:byId.keySet().stream().sorted().toList()){
      deadline(end);JsonNode d=byId.get(id);var imports=expected.getOrDefault(id,Map.of());
      var o=parse(m,d,str(d,"documentIri"),imports.keySet());
      String ontology=o.getOntologyID().getOntologyIRI().map(Object::toString).orElse(null),version=o.getOntologyID().getVersionIRI().map(Object::toString).orElse(null);
      require(Objects.equals(ontology,d.get("ontologyIri").isNull()?null:d.get("ontologyIri").asText())&&Objects.equals(version,d.get("versionIri").isNull()?null:d.get("versionIri").asText()),"ONTOLOGY_IDENTITY_MISMATCH","Parsed ontology identity differs from admitted identity");
      var actual=o.importsDeclarations().map(x->x.getIRI().toString()).collect(Collectors.toSet());
      if(!actual.equals(imports.keySet()))throw new Refusal("MISSING_IMPORT","IMPORT_CLOSURE_MISMATCH","Declared imports differ from pinned closure");
      for(OWLAxiom ax:o.axioms().toList()){origins.computeIfAbsent(ax,k->new ArrayList<>()).add(d);if(origins.size()>AXIOMS)throw invalid("AXIOM_LIMIT","Axiom budget exceeded");}
    }
    // OWL Direct Semantics applies to the union of the complete imports closure. Inputs
    // remain distinct in origins; this derived union never overwrites their original bytes.
    return new Loaded(m,anonymous(m,origins.keySet()),origins);
  }
  static void walk(String id,Map<String,Map<String,String>> edges,Map<String,JsonNode> docs,Set<String> path,Set<String> reached){
    require(++importTraversals<=8192,"IMPORT_TRAVERSAL_LIMIT","Import traversal budget");require(docs.containsKey(id),"MISSING_IMPORT","Root document absent");if(path.contains(id))return;require(path.size()<16,"IMPORT_DEPTH","Import depth budget");
    reached.add(id);var next=new HashSet<>(path);next.add(id);for(String to:edges.getOrDefault(id,Map.of()).values())walk(to,edges,docs,next,reached);
  }
  static List<OWLAxiom> queries(JsonNode task)throws Exception {
    JsonNode q=task.get("query");require(q!=null&&q.isObject(),"INVALID_QUERY","Query ontology required");
    OWLOntology o=parse(manager(),q,"urn:evopilot:ontology:query",List.of());
    require(o.importsDeclarations().findAny().isEmpty(),"INVALID_QUERY","Query cannot import documents");
    // Query fragments may omit declarations, which have no Direct Semantics meaning.
    // Supply declarations only in this separate profile-check projection, never as premises.
    var qm=o.getOWLOntologyManager();o.signature().toList().forEach(e->qm.addAxiom(o,qm.getOWLDataFactory().getOWLDeclarationAxiom(e)));
    require(new OWL2DLProfile().checkOntology(o).isInProfile(),"INVALID_QUERY","Query violates OWL 2 DL restrictions");
    List<OWLAxiom> axioms=o.logicalAxioms().map(a->(OWLAxiom)a).sorted(Comparator.comparing(Object::toString)).toList();
    require(axioms.size()<=1000,"INVALID_QUERY","Query axiom budget exceeded");return axioms;
  }
  static OWLReasoner reasoner(OWLOntology o,long end){
    deadline(end);Configuration c=new Configuration();c.ignoreUnsupportedDatatypes=false;c.throwInconsistentOntologyException=true;
    c.individualTaskTimeout=Math.max(1,(end-System.nanoTime())/1000000);return new ReasonerFactory().createReasoner(o,c);
  }
  static boolean entailed(OWLReasoner r,List<OWLAxiom> axioms){
    for(OWLAxiom ax:axioms)if(!r.isEntailmentCheckingSupported(ax.getAxiomType()))throw new Refusal("FAILED","ENGINE_CAPABILITY_GAP","Engine does not support this entailment axiom type: "+ax.getAxiomType());
    // Shared anonymous individuals make a query a joint existential conjunction.
    // Separate per-axiom answers do not establish that shared witness.
    return r.isEntailed(new HashSet<>(axioms));
  }
  static List<String> names(Stream<? extends OWLEntity> values){return values.map(x->x.getIRI().toString()).distinct().sorted().toList();}
  static ObjectNode execute(JsonNode request,long end)throws Exception {
    Loaded loaded=load(request.get("closure"),end);OWLOntology o=loaded.ontology();JsonNode task=request.get("task");String kind=str(task,"kind");
    ObjectNode out=JSON.createObjectNode();ObjectNode result=out.putObject("result");out.put("status","COMPLETED");out.put("complete",true);
    result.put("semantics","OWL_2_DL_DIRECT");result.put("axiomCount",o.getAxiomCount());
    var profile=new OWL2DLProfile().checkOntology(o);
    if(!profile.isInProfile()){
      out.put("status","INVALID_INPUT");out.put("complete",false);result.put("legal",false);ArrayNode violations=result.putArray("violations");
      for(var v:profile.getViolations().stream().limit(1000).toList()){ObjectNode entry=violations.addObject();entry.put("type",v.getClass().getSimpleName());entry.put("detail",v.toString());}
      result.put("violationsComplete",profile.getViolations().size()<=1000);out.putObject("error").put("code","OWL2_DL_PROFILE").put("message","Ontology violates OWL 2 DL restrictions");return out;
    }
    result.put("legal",true);if(kind.equals("legality"))return out;
    List<OWLAxiom> q=List.of();if(List.of("entailment","satisfiability").contains(kind)||kind.equals("explanation")&&str(task,"target").equals("entailment"))q=queries(task);
    OWLReasoner r=reasoner(o,end);
    try{
      boolean consistent=r.isConsistent();result.put("consistent",consistent);
      if(kind.equals("explanation"))return explanation(loaded,task,q,r,consistent,end);
      if(!consistent){out.put("status","INCONSISTENT");return out;}
      OWLDataFactory d=loaded.manager().getOWLDataFactory();
      switch(kind){
        case "consistency":break;
        case "entailment":{
          boolean all=entailed(r,q);ArrayNode items=result.putArray("queryAxioms");
          for(OWLAxiom ax:q){deadline(end);ObjectNode item=items.addObject();item.put("axiom",ax.toString());item.put("axiomDigest",sha(ax.toString()));}
          result.put("jointEntailed",all);
          result.put("vacuous",q.isEmpty());
          out.put("status",all?"ENTAILED":"NOT_ENTAILED");result.put("negationInferred",false);break;
        }
        case "satisfiability":{
          require(q.size()==1&&q.get(0) instanceof OWLSubClassOfAxiom&&((OWLSubClassOfAxiom)q.get(0)).getSubClass().isOWLThing(),"INVALID_QUERY","Satisfiability query must be one SubClassOf(owl:Thing expression) axiom");
          result.put("satisfiable",r.isSatisfiable(((OWLSubClassOfAxiom)q.get(0)).getSuperClass()));break;
        }
        case "classHierarchy":case "objectPropertyHierarchy":case "dataPropertyHierarchy":case "realization":case "identity":{
          JsonNode entities=task.get("entities");require(entities!=null&&entities.isArray()&&entities.size()>0&&entities.size()<=1000,"INVALID_QUERY","Finite entity scope required");
          ArrayNode items=result.putArray("entities");boolean direct=task.path("direct").asBoolean();result.put("projection","NAMED_REQUESTED_ENTITIES");result.set("requestedEntities",entities.deepCopy());result.put("allLogicalConsequences",false);
          for(JsonNode entity:entities){deadline(end);IRI iri=IRI.create(entity.asText());ObjectNode item=items.addObject();item.put("iri",iri.toString());
            switch(kind){
              case "classHierarchy":{var x=d.getOWLClass(iri);item.set("equivalent",JSON.valueToTree(names(r.getEquivalentClasses(x).entities())));item.set("super",JSON.valueToTree(names(r.getSuperClasses(x,direct).entities())));item.set("sub",JSON.valueToTree(names(r.getSubClasses(x,direct).entities())));item.put("satisfiable",r.isSatisfiable(x));break;}
              case "objectPropertyHierarchy":{var x=d.getOWLObjectProperty(iri);item.set("equivalent",JSON.valueToTree(r.getEquivalentObjectProperties(x).entities().map(Object::toString).sorted().toList()));item.set("super",JSON.valueToTree(r.getSuperObjectProperties(x,direct).entities().map(Object::toString).sorted().toList()));item.set("sub",JSON.valueToTree(r.getSubObjectProperties(x,direct).entities().map(Object::toString).sorted().toList()));break;}
              case "dataPropertyHierarchy":{var x=d.getOWLDataProperty(iri);item.set("equivalent",JSON.valueToTree(names(r.getEquivalentDataProperties(x).entities())));item.set("super",JSON.valueToTree(names(r.getSuperDataProperties(x,direct).entities())));item.set("sub",JSON.valueToTree(names(r.getSubDataProperties(x,direct).entities())));break;}
              case "realization":item.set("types",JSON.valueToTree(names(r.getTypes(d.getOWLNamedIndividual(iri),direct).entities())));break;
              case "identity":{var x=d.getOWLNamedIndividual(iri);item.set("same",JSON.valueToTree(names(r.getSameIndividuals(x).entities())));item.set("different",JSON.valueToTree(names(r.getDifferentIndividuals(x).entities())));item.put("physicalMerge",false);break;}
            }
          }break;
        }
        default:throw invalid("UNKNOWN_TASK","Unknown formal task");
      }
      deadline(end);return out;
    }finally{r.dispose();}
  }
  static ObjectNode explanation(Loaded loaded,JsonNode task,List<OWLAxiom> q,OWLReasoner original,boolean consistent,long end)throws Exception {
    boolean inconsistency=str(task,"target").equals("inconsistency");
    require(inconsistency||consistent,"INCONSISTENT_PREMISE","Ordinary entailment explanation requires consistent premises");
    require(inconsistency?!consistent:entailed(original,q),"NO_EXPLANATION_TARGET","Requested conclusion is not established");
    var declarations=loaded.ontology().axioms().filter(a->!a.isLogicalAxiom()).collect(Collectors.toSet());
    var support=new LinkedHashSet<OWLAxiom>(loaded.ontology().logicalAxioms().sorted(Comparator.comparing(Object::toString)).toList());
    for(OWLAxiom ax:new ArrayList<>(support)){
      deadline(end);var candidate=new HashSet<>(support);candidate.remove(ax);candidate.addAll(declarations);var m=manager();var o=anonymous(m,candidate);var r=reasoner(o,end);
      try{boolean c=r.isConsistent();if(inconsistency?!c:c&&entailed(r,q))support.remove(ax);}finally{r.dispose();}
    }
    deadline(end);ObjectNode out=JSON.createObjectNode();out.put("status","COMPLETED");out.put("complete",true);ObjectNode result=out.putObject("result");
    result.put("target",str(task,"target"));result.put("method","DELETION_REPLAY");result.put("allMinimalJustifications",false);ArrayNode supporting=result.putArray("support");
    for(OWLAxiom ax:support){ObjectNode item=supporting.addObject();item.put("axiom",ax.toString());item.put("axiomDigest",sha(ax.toString()));ArrayNode sources=item.putArray("sources");
      for(JsonNode doc:loaded.origins().get(ax)){ObjectNode s=sources.addObject();s.put("documentId",str(doc,"id"));s.put("documentDigest",str(doc,"digest"));s.put("selectorKind","OWL_STRUCTURAL_AXIOM");s.put("axiomDigest",sha(ax.toString()));}
    }
    var replay=new HashSet<>(support);replay.addAll(declarations);var m=manager();var ontology=anonymous(m,replay);var target=new StringDocumentTarget();m.saveOntology(ontology,new FunctionalSyntaxDocumentFormat(),target);
    ObjectNode replayNode=result.putObject("replay");replayNode.put("format","functional");replayNode.put("content",target.toString());replayNode.put("digest",sha(target.toString()));return out;
  }
  static Refusal refusal(Throwable error){
    if(refusedImport!=null)return new Refusal("MISSING_IMPORT","MISSING_IMPORT","Unbound ontology import: "+refusedImport);
    for(Throwable e=error;e!=null;e=e.getCause())if(e instanceof Refusal)return (Refusal)e;
    for(Throwable e=error;e!=null;e=e.getCause()){
      if(e instanceof UnloadableImportException||e instanceof OWLOntologyFactoryNotFoundException)return new Refusal("MISSING_IMPORT","MISSING_IMPORT","An import has no admitted offline document");
      if(e instanceof TimeOutException)return new Refusal("TIMEOUT","ENGINE_TIMEOUT","Formal engine deadline reached");
      if(e instanceof OWLOntologyCreationException)return invalid("ONTOLOGY_PARSE","Ontology could not be parsed without external resolution");
    }
    return new Refusal("FAILED","ENGINE_FAILURE","Formal engine failed; no logical conclusion established");
  }
  public static void main(String[] args)throws Exception {
    System.setProperty("javax.xml.accessExternalDTD","");System.setProperty("javax.xml.accessExternalSchema","");System.setProperty("jdk.xml.entityExpansionLimit","1000");System.setProperty("jdk.xml.totalEntitySizeLimit","8388608");
    ObjectNode response=JSON.createObjectNode();response.put("schema","ontology-dl-worker-result/v1");
    try{
      byte[] input=System.in.readNBytes(INPUT_BYTES+1);require(input.length<=INPUT_BYTES,"INPUT_LIMIT","Worker request byte budget");
      JsonNode request=JSON.readTree(input);require(request!=null&&request.isObject()&&str(request,"schema").equals("ontology-dl-worker-request/v1"),"INVALID_ENVELOPE","Worker request schema mismatch");
      for(String key:List.of("requestId","requestDigest","closureDigest","configurationDigest"))response.put(key,str(request,key));
      long ms=request.path("timeoutMs").asLong(0),maximum=str(request.get("task"),"kind").equals("explanation")?30000:120000;
      require(ms>=1&&ms<=maximum,"INVALID_ENVELOPE","Task deadline outside fixed budget");
      response.setAll(execute(request,System.nanoTime()+ms*1000000));
      if(!response.has("error"))response.putNull("error");
    }catch(Throwable e){Refusal r=refusal(e);response.put("status",r.status);response.put("complete",false);response.set("result",JSON.createObjectNode());response.putObject("error").put("code",r.code).put("message",r.getMessage());}
    byte[] output=JSON.writeValueAsBytes(response);
    if(output.length>OUTPUT_BYTES){response.put("status","FAILED");response.put("complete",false);response.set("result",JSON.createObjectNode());response.putObject("error").put("code","OUTPUT_LIMIT").put("message","Formal output exceeds fixed byte budget");output=JSON.writeValueAsBytes(response);}
    System.out.write(output);System.out.write('\n');System.out.flush();
  }
}
