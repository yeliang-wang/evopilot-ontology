/* EvoPilot's separately named adapter for the pinned OWLAPI RDF/XML grammar.
 * rdfxml-compat.json retains the exact upstream sources, notices and patches.
 * The pinned Woodstox provider supplies semantic XML events after the JDK's
 * bounded safety preflight. The original-input scanner supplies coordinates
 * checked against every actual element, attribute and text, never RDF values. */
package org.semanticweb.owlapi.rdf.rdfxml.parser;

import java.io.IOException;
import java.io.StringReader;
import java.util.*;
import javax.xml.XMLConstants;
import javax.xml.parsers.SAXParserFactory;
import org.semanticweb.owlapi.model.IRI;
import org.semanticweb.owlapi.model.NodeID;
import org.semanticweb.owlapi.rdf.turtle.parser.RDFIRI;
import org.xml.sax.*;
import org.xml.sax.ext.DeclHandler;
import org.xml.sax.ext.DefaultHandler2;
import org.xml.sax.ext.Locator2;
import com.ctc.wstx.stax.WstxInputFactory;
import com.ctc.wstx.sax.WstxSAXParserFactory;

/** Locations describe actual RDF construction inputs, not minimal OWL proofs. */
public final class LocatedRDFXMLParser extends LocatedRDFXMLSyntaxParser {
    static final String RDF="http://www.w3.org/1999/02/22-rdf-syntax-ns#";
    static final String XML="http://www.w3.org/XML/1998/namespace";
    static final String XMLNS="http://www.w3.org/2000/xmlns/";
    public record Span(int start,int end) { public Span { if(start<0||end<=start)throw new IllegalArgumentException("Invalid XML source span"); } }
    public record Source(int id,String kind,Span span) {}
    public record SourceSet(int id,List<Integer> sourceIds) { public SourceSet { sourceIds=List.copyOf(sourceIds); } }
    public record TermSource(int sourceSetId,boolean inherited,boolean generated,List<Integer> contextIds) { public TermSource { contextIds=List.copyOf(contextIds); } }
    public record Triple(IRI subject,IRI predicate,IRI resourceObject,String lexicalObject,String language,IRI datatype) {}
    public record Occurrence(int id,Triple triple,TermSource subject,TermSource predicate,TermSource object,String generatedKind) {}
    public record Context(int id,String kind,String name,String resolved,int sourceSetId,List<Integer> dependencyContextIds) { public Context { dependencyContextIds=List.copyOf(dependencyContextIds); } }
    public record Result(List<Source> sources,List<SourceSet> sourceSets,List<Context> contexts,List<Occurrence> occurrences) {
        public Result { sources=List.copyOf(sources);sourceSets=List.copyOf(sourceSets);contexts=List.copyOf(contexts);occurrences=List.copyOf(occurrences); }
    }
    public interface OccurrenceObserver { void beforeTriple(int occurrenceId);void afterTriple(); }
    public static final class MappingException extends RuntimeException { public MappingException(String message){super(message);} }
    public static final class LimitException extends RuntimeException { public LimitException(String message){super(message);} }

    static final class Store {
        final int length;final RDFProvenance.Budget budget;
        final ArrayList<Source> sources=new ArrayList<>();final ArrayList<SourceSet> sets=new ArrayList<>();
        final ArrayList<Context> contexts=new ArrayList<>();final ArrayList<Occurrence> occurrences=new ArrayList<>();
        final Map<String,Integer> sourceIndex=new HashMap<>();final Map<List<Integer>,Integer> setIndex=new HashMap<>();
        Store(int length,RDFProvenance.Budget budget){this.length=length;this.budget=Objects.requireNonNull(budget);}
        void check(){budget.check();}void records(int n){budget.sourceRecords(n);}void references(int n){budget.sourceReferences(n);}
        int source(String kind,int start,int end){check();if(start<0||end<=start||end>length)throw new MappingException("XML source outside original document");
            String key=kind+':'+start+':'+end;Integer old=sourceIndex.get(key);if(old!=null)return old;records(1);int id=sources.size()+1;sources.add(new Source(id,kind,new Span(start,end)));sourceIndex.put(key,id);return id;}
        int set(Collection<Integer> ids){check();List<Integer> key=List.copyOf(new TreeSet<>(ids));if(key.isEmpty()||key.get(0)<1||key.get(key.size()-1)>sources.size())throw new MappingException("Invalid XML source set");
            Integer old=setIndex.get(key);if(old!=null)return old;records(1);references(key.size());int id=sets.size()+1;sets.add(new SourceSet(id,key));setIndex.put(key,id);return id;}
        int union(Collection<Integer> sourceSets){TreeSet<Integer> ids=new TreeSet<>();for(int id:sourceSets){check();if(id<1||id>sets.size())throw new MappingException("Unknown XML source set");ids.addAll(sets.get(id-1).sourceIds());}return set(ids);}
        int context(String kind,String name,String resolved,int sourceSet,List<Integer> dependencies){check();List<Integer> deps=List.copyOf(new TreeSet<>(dependencies));
            if(sourceSet<0||sourceSet>sets.size()||sourceSet==0&&!Set.of("DOCUMENT","BUILTIN").contains(kind)||!deps.isEmpty()&&(deps.get(0)<1||deps.get(deps.size()-1)>contexts.size()))throw new MappingException("Invalid XML context closure");
            records(1);references(deps.size()+(sourceSet==0?0:1));int id=contexts.size()+1;contexts.add(new Context(id,kind,name,resolved,sourceSet,deps));return id;}
        Result seal(){check();return new Result(sources,sets,contexts,occurrences);}
    }
    static final class Binding { final String value;final int context;Binding(String value,int context){this.value=value;this.context=context;} }
    static final class Frame {
        final RDFXMLRawScanner.Node raw;final Frame parent;final Map<String,Binding> namespaces;
        final Map<String,RDFXMLRawScanner.Attribute> expandedAttributes=new LinkedHashMap<>();
        final StringBuilder text=new StringBuilder();final List<Frame> children=new ArrayList<>();
        final String base;final int baseContext;final String lang;final int langContext;
        TermSource reification;int liContext;
        Frame(RDFXMLRawScanner.Node raw,Frame parent,Map<String,Binding> ns,String base,int baseContext,String lang,int langContext){this.raw=raw;this.parent=parent;namespaces=Map.copyOf(ns);this.base=base;this.baseContext=baseContext;this.lang=lang;this.langContext=langContext;}
    }
    static final class Emission {
        final TermSource subject,predicate,object,reification;final String kind;
        Emission(TermSource s,TermSource p,TermSource o,TermSource r,String k){subject=s;predicate=p;object=o;reification=r;kind=k;}
    }
    final String content;final IRI document;final Store store;final OccurrenceObserver observer;
    final ArrayDeque<Frame> frames=new ArrayDeque<>();RDFXMLRawScanner scanner;int nextNode,documentContext,xmlContext;boolean used;
    public LocatedRDFXMLParser(String content,IRI documentIri,OccurrenceObserver observer,RDFProvenance.Budget budget){
        this.content=Objects.requireNonNull(content);document=Objects.requireNonNull(documentIri);RDFIRI.validateAbsolute(document.toString());
        this.observer=Objects.requireNonNull(observer);store=new Store(content.length(),budget);bridge=this;
    }
    /** The ordinary path uses the identical corrected grammar without indexing. */
    public LocatedRDFXMLParser(String content,IRI documentIri){this.content=Objects.requireNonNull(content);document=Objects.requireNonNull(documentIri);RDFIRI.validateAbsolute(document.toString());observer=null;store=null;bridge=this;}
    public Result parse(RDFConsumer consumer)throws SAXException,IOException {
        if(store==null)throw new IllegalStateException("Located constructor required");run(consumer);return store.seal();
    }
    public void parseUnlocated(RDFConsumer consumer)throws SAXException,IOException {if(store!=null)throw new IllegalStateException("Ordinary constructor required");run(consumer);}
    void run(RDFConsumer consumer)throws SAXException,IOException {
        if(used)throw new IllegalStateException("XML parser instances are single use");used=true;
        if(store!=null){documentContext=store.context("DOCUMENT",null,document.toString(),0,List.of());xmlContext=store.context("BUILTIN","xml",XML,0,List.of());}
        InputSource input=new InputSource(new StringReader(content));input.setSystemId(document.toString());super.parse(input,Objects.requireNonNull(consumer));
        if(store!=null&&(!frames.isEmpty()||nextNode!=scanner.preorder.size()))throw new MappingException("Incomplete SAX/original-source correspondence");
    }
    Frame frame(){return store==null?null:frames.peek();}
    static List<Integer> merged(Collection<Integer> a,Collection<Integer> b){return RDFXMLRawScanner.merge(a,b);}
    void parseXML(InputSource input,DeclHandler declarations)throws SAXException,IOException {
        try {
            // The pinned JDK is the bounded security preflight, not the semantic
            // source: its entity scanner wrongly normalizes referenced CRs in
            // internal-entity text. Both passes read the same immutable String.
            SAXParserFactory factory=SAXParserFactory.newDefaultInstance();factory.setNamespaceAware(true);factory.setXIncludeAware(false);factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING,true);
            XMLReader reader=factory.newSAXParser().getXMLReader();
            reader.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD,"");reader.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA,"");
            reader.setFeature("http://xml.org/sax/features/external-general-entities",false);reader.setFeature("http://xml.org/sax/features/external-parameter-entities",false);reader.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd",false);
            reader.setProperty("http://www.oracle.com/xml/jaxp/properties/entityExpansionLimit","1000");
            reader.setProperty("http://www.oracle.com/xml/jaxp/properties/totalEntitySizeLimit","8388608");
            DefaultHandler2 guard=new DefaultHandler2(){
                int depth;Locator2 locator;
                void check(){if(store!=null)store.check();}
                public void setDocumentLocator(Locator value){if(!(value instanceof Locator2 actual))throw new MappingException("XML version locator unavailable");locator=actual;}
                public void startElement(String u,String l,String n,Attributes a)throws SAXException{
                    check();
                    // At startElement the mature parser has consumed the XML
                    // declaration. startDocument may precede that declaration.
                    // RDF 1.1 XML Syntax normatively uses XML 1.0 Fifth Edition.
                    if(locator==null||!"1.0".equals(locator.getXMLVersion()))throw new SAXException("RDF/XML requires XML 1.0");
                    if(++depth>256)throw new SAXException("XML depth budget");
                }
                public void endElement(String u,String l,String n){check();depth--;}
                public void characters(char[] c,int s,int n){check();}
                public void startDTD(String name,String publicId,String systemId)throws SAXException{if(publicId!=null||systemId!=null)throw new SAXException("External XML DTD refused");}
                public void externalEntityDecl(String name,String publicId,String systemId)throws SAXException{throw new SAXException("External XML entity refused");}
                // Woodstox 4.1.4 does not expose parsed-entity declarations to
                // DeclHandler. Preserve original format-prefix metadata from
                // the mature JDK declaration parser; no RDF statement or text
                // is constructed from this preflight callback.
                public void internalEntityDecl(String name,String value)throws SAXException{check();declarations.internalEntityDecl(name,value);}
                public InputSource resolveEntity(String publicId,String systemId)throws SAXException{throw new SAXException("External XML entity refused");}
                public InputSource resolveEntity(String name,String publicId,String base,String systemId)throws SAXException{throw new SAXException("External XML entity refused");}
                public void fatalError(SAXParseException e)throws SAXException{throw e;}
                public void error(SAXParseException e)throws SAXException{throw e;}
            };
            reader.setContentHandler(guard);reader.setEntityResolver(guard);reader.setErrorHandler(guard);
            reader.setProperty("http://xml.org/sax/properties/lexical-handler",guard);reader.setProperty("http://xml.org/sax/properties/declaration-handler",guard);reader.parse(input);
            // Index only after the shared safety/version preflight has passed;
            // ordinary parsing never creates a lexical/source index.
            if(store!=null)scanner=new RDFXMLRawScanner(content,store);
            WstxInputFactory stax=new WstxInputFactory();stax.getConfig().doSupportDTDs(true);stax.getConfig().doSupportExternalEntities(false);
            javax.xml.stream.XMLResolver deny=(publicId,systemId,base,namespace)->{throw new javax.xml.stream.XMLStreamException("External XML retrieval refused");};
            stax.getConfig().setDtdResolver(deny);stax.getConfig().setEntityResolver(deny);
            XMLReader semantic=new WstxSAXParserFactory(stax).newSAXParser().getXMLReader();
            semantic.setContentHandler(this);semantic.setEntityResolver(guard);semantic.setErrorHandler(guard);semantic.setProperty("http://xml.org/sax/properties/lexical-handler",guard);
            semantic.setProperty("http://xml.org/sax/properties/declaration-handler",new DeclHandler(){
                // Already transferred once by the JDK declaration callback.
                public void internalEntityDecl(String n,String v){}
                public void externalEntityDecl(String n,String p,String s)throws SAXException{throw new SAXException("External XML entity refused");}
                public void elementDecl(String n,String m)throws SAXException{declarations.elementDecl(n,m);}
                public void attributeDecl(String e,String a,String t,String m,String v)throws SAXException{declarations.attributeDecl(e,a,t,m,v);}
            });
            // RDFParser already retains the exact document IRI as its semantic
            // base. Woodstox treats InputSource.systemId as a retrievable URL,
            // which rejects valid RDF bases such as urn: and custom schemes.
            // The complete input is in memory and all external resolution is
            // denied, so no physical retrieval identifier is needed here.
            InputSource sameInput=new InputSource(new StringReader(content));semantic.parse(sameInput);
        }catch(javax.xml.parsers.ParserConfigurationException e){throw new SAXException("Secure XML parser configuration unavailable",e);}
    }
    @Override public void processingInstruction(String target,String data){if("include-rdf".equals(target))throw new MappingException("External RDF inclusion is not an admitted closure operation");super.processingInstruction(target,data);}
    int xmlDepth;
    @Override public void startElement(String uri,String local,String qname,Attributes attributes)throws SAXException {
        if(++xmlDepth>256)throw new LimitException("XML depth budget");if(store!=null)open(uri,local,qname,attributes);super.startElement(uri,local,qname,attributes);
    }
    @Override public void endElement(String uri,String local,String qname)throws SAXException {
        super.endElement(uri,local,qname);if(store!=null){Frame f=frames.pop();if(!f.raw.qname.equals(qname)||!f.text.toString().equals(f.raw.textValue.toString()))throw new MappingException("SAX text/end event differs from original XML");store.check();}xmlDepth--;
    }
    @Override public void characters(char[] chars,int start,int length)throws SAXException {if(store!=null&&!frames.isEmpty()){frames.peek().text.append(chars,start,length);store.check();}super.characters(chars,start,length);}
    @Override public void ignorableWhitespace(char[] chars,int start,int length)throws SAXException {if(store!=null&&!frames.isEmpty())frames.peek().text.append(chars,start,length);super.ignorableWhitespace(chars,start,length);}
    void open(String uri,String local,String qname,Attributes attributes){
        store.check();if(nextNode>=scanner.preorder.size())throw new MappingException("SAX element has no original source");RDFXMLRawScanner.Node raw=scanner.preorder.get(nextNode++);Frame parent=frames.peek();
        if(!raw.qname.equals(qname)||raw.parent!=(parent==null?null:parent.raw))throw new MappingException("SAX element order differs from original XML");
        Map<String,Binding> ns=new LinkedHashMap<>();if(parent!=null)ns.putAll(parent.namespaces);else ns.put("xml",new Binding(XML,xmlContext));
        for(var a:raw.attributes.values())if(a.name.equals("xmlns")||a.name.startsWith("xmlns:")){
            String prefix=a.name.equals("xmlns")?"":a.name.substring(6);if(!a.value.isEmpty())RDFIRI.validateAbsolute(a.value);
            int ctx=store.context("NAMESPACE",prefix,a.value,a.sourceSet,a.contexts);ns.put(prefix,new Binding(a.value,ctx));
        }
        String base=parent==null?document.toString():parent.base;int baseCtx=parent==null?documentContext:parent.baseContext;
        var a=raw.attributes.get("xml:base");if(a!=null){base=RDFIRI.resolve(a.value,base);baseCtx=store.context("XML_BASE",null,base,a.sourceSet,merged(a.contexts,List.of(baseCtx,xmlContext)));}
        String lang=parent==null?null:parent.lang;int langCtx=parent==null?0:parent.langContext;a=raw.attributes.get("xml:lang");
        if(a!=null){lang=a.value;langCtx=store.context("XML_LANG",null,lang,a.sourceSet,merged(a.contexts,List.of(xmlContext)));}
        Frame f=new Frame(raw,parent,ns,base,baseCtx,lang,langCtx);if(parent!=null)parent.children.add(f);
        if(!expanded(qname,false,ns).equals(uri+local))throw new MappingException("SAX element namespace differs from original XML");
        for(var attr:raw.attributes.values())if(!attr.name.equals("xmlns")&&!attr.name.startsWith("xmlns:")){
            String expanded=expanded(attr.name,true,ns);if(f.expandedAttributes.putIfAbsent(expanded,attr)!=null)throw new MappingException("Duplicate expanded original XML attribute");
        }
        Set<String> seen=new HashSet<>();for(int i=0;i<attributes.getLength();i++){
            if(XMLNS.equals(attributes.getURI(i)))continue;String key=attributes.getURI(i)+attributes.getLocalName(i);var indexed=f.expandedAttributes.get(key);
            if(indexed==null||!indexed.name.equals(attributes.getQName(i))||!indexed.value.equals(attributes.getValue(i))||!seen.add(key))throw new MappingException("SAX attribute differs from original XML/DTD normalization");
        }
        if(seen.size()!=f.expandedAttributes.size())throw new MappingException("Original XML attribute missing from actual SAX event");frames.push(f);
    }
    String expanded(String qname,boolean attribute,Map<String,Binding> ns){int colon=qname.indexOf(':');String prefix=colon<0?"":qname.substring(0,colon),local=colon<0?qname:qname.substring(colon+1);
        if(colon<0&&attribute)return local;Binding b=ns.get(prefix);if(b==null){if(colon<0)return local;throw new MappingException("QName has no original namespace context");}return b.value+local;}
    List<Integer> qnameContexts(Frame f,String qname,boolean attribute){int colon=qname.indexOf(':');if(colon<0&&attribute)return List.of();String prefix=colon<0?"":qname.substring(0,colon);Binding b=f.namespaces.get(prefix);if(b==null){if(colon<0)return List.of();throw new MappingException("QName context missing");}return List.of(b.context);}
    TermSource term(int set,boolean inherited,boolean generated,Collection<Integer> contexts){if(store==null)return null;List<Integer> ids=List.copyOf(new TreeSet<>(contexts));store.references(1+ids.size());return new TermSource(set,inherited,generated,ids);}
    TermSource inherit(TermSource t){return store==null?null:term(t.sourceSetId,true,t.generated,t.contextIds);}
    TermSource generated(Frame f){return store==null?null:term(f.raw.elementSource(),false,true,f.raw.inheritedContexts());}
    TermSource attribute(Frame f,String expandedName,boolean iriValue,boolean languageValue){if(store==null)return null;var a=f.expandedAttributes.get(expandedName);if(a==null)throw new MappingException("Required RDF attribute has no actual original source");List<Integer> ctx=merged(a.contexts,qnameContexts(f,a.name,true));if(iriValue)ctx=merged(ctx,List.of(f.baseContext));if(languageValue&&f.langContext>0)ctx=merged(ctx,List.of(f.langContext));return term(a.sourceSet,false,false,ctx);}
    TermSource subject(Frame f,boolean dummy){if(store==null)return null;if(!dummy){for(String a:List.of("ID","about","nodeID"))if(f.expandedAttributes.containsKey(RDF+a))return attribute(f,RDF+a,!a.equals("nodeID"),false);}return generated(f);}
    TermSource resource(Frame f){if(store==null)return null;for(String a:List.of("resource","nodeID"))if(f.expandedAttributes.containsKey(RDF+a))return attribute(f,RDF+a,a.equals("resource"),false);return generated(f);}
    TermSource predicate(Frame f){if(store==null)return null;List<Integer> ctx=merged(f.raw.inheritedContexts(),qnameContexts(f,f.raw.qname,false));if(f.liContext>0)ctx=merged(ctx,List.of(f.liContext));return term(f.raw.nameSource(),false,f.liContext>0,ctx);}
    TermSource literal(Frame f,boolean xmlLiteral){if(store==null)return null;List<Integer> sets=new ArrayList<>(f.raw.textSources);TreeSet<Integer> ctx=new TreeSet<>(f.raw.textContexts);
        if(xmlLiteral){for(Frame child:f.children){sets.add(child.raw.elementSource());literalContexts(child,ctx);} }
        for(String n:List.of("datatype","parseType")){var a=f.expandedAttributes.get(RDF+n);if(a!=null){sets.add(a.sourceSet);ctx.addAll(a.contexts);ctx.addAll(qnameContexts(f,a.name,true));if(n.equals("datatype"))ctx.add(f.baseContext);}}
        if(sets.isEmpty())sets.add(f.raw.elementSource());if(f.langContext>0)ctx.add(f.langContext);ctx.addAll(f.raw.inheritedContexts());return term(store.union(sets),false,xmlLiteral,ctx);}
    void literalContexts(Frame f,Set<Integer> ids){ids.addAll(f.raw.inheritedContexts());ids.addAll(qnameContexts(f,f.raw.qname,false));for(var a:f.raw.attributes.values()){ids.addAll(a.contexts);if(!a.name.equals("xmlns")&&!a.name.startsWith("xmlns:"))ids.addAll(qnameContexts(f,a.name,true));}ids.addAll(f.raw.textContexts);for(Frame c:f.children)literalContexts(c,ids);}
    Emission emission(Frame f,TermSource s,TermSource o,String kind){if(store==null)return null;
        if(kind==null&&f.liContext>0)kind="RDF_LI";
        // A lexical element supplied by an entity is distinct from an ordinary
        // element whose text payload merely contains an entity reference.
        if(kind==null&&f.raw.inheritedContexts().stream().anyMatch(id->store.contexts.get(id-1).kind().equals("ENTITY_REFERENCE")))kind="ENTITY_EXPANSION";
        return new Emission(inherit(s),predicate(f),o,f.reification,kind);}
    Emission typed(Frame f,TermSource s){if(store==null)return null;TermSource name=term(f.raw.nameSource(),false,false,merged(f.raw.inheritedContexts(),qnameContexts(f,f.raw.qname,false)));return new Emission(s,generated(f),name,f.reification,"TYPED_NODE");}
    Emission property(Frame f,TermSource s,Attributes a,int i,boolean resource){if(store==null)return null;String key=a.getURI(i)+a.getLocalName(i);var raw=f.expandedAttributes.get(key);TermSource p=term(raw.sourceSet,false,false,merged(raw.contexts,qnameContexts(f,raw.name,true)));return new Emission(s,p,attribute(f,key,resource,!resource),f.reification,"PROPERTY_ATTRIBUTE");}
    Emission synthetic(TermSource s,TermSource p,TermSource o,String kind){return store==null?null:new Emission(s,p,o,null,kind);}
    TermSource collectionCell(Frame property,Frame child){if(store==null)return null;return term(store.union(List.of(property.raw.elementSource(),child.raw.elementSource())),false,true,merged(property.raw.inheritedContexts(),child.raw.inheritedContexts()));}
    int li(Frame owner,long ordinal){if(store==null)return 0;Frame f=frame();List<Integer> deps=merged(f.raw.inheritedContexts(),qnameContexts(f,f.raw.qname,false));if(owner.liContext>0)deps=merged(deps,List.of(owner.liContext));int ctx=store.context("RDF_LI_ORDER",null,Long.toString(ordinal),f.raw.nameSource(),deps);f.liContext=ctx;owner.liContext=ctx;return ctx;}
    void rememberReification(String id){if(store!=null){Frame f=frame();f.reification=id==null?null:f.expandedAttributes.containsKey(RDF+"ID")?attribute(f,RDF+"ID",true,false):generated(f);}}
    TermSource bag(Frame f){return store==null?null:attribute(f,RDF+"bagID",true,false);}
    Emission bagType(TermSource bag,Frame f){return store==null?null:synthetic(bag,generated(f),generated(f),"REIFICATION_BAG");}
    int bagOrder(Frame f,long ordinal,int previous){if(store==null)return 0;List<Integer> deps=f.raw.inheritedContexts();if(previous>0)deps=merged(deps,List.of(previous));return store.context("REIFICATION_ORDER",null,Long.toString(ordinal),f.raw.elementSource(),deps);}
    Emission bagMember(TermSource bag,int order){if(store==null)return null;Frame f=frame();return synthetic(inherit(bag),term(f.raw.elementSource(),false,true,List.of(order)),Objects.requireNonNull(f.reification),"REIFICATION_BAG");}
    static void validResource(String value){if(!NodeID.isAnonymousNodeIRI(value))RDFIRI.validateAbsolute(value);}
    void event(String s,String p,String o,String lexical,String lang,String datatype,Emission e,Runnable action){
        validResource(s);RDFIRI.validateAbsolute(p);if(o!=null)validResource(o);if(datatype!=null)RDFIRI.validateAbsolute(datatype);
        if(store==null){action.run();return;}if(e==null||e.subject==null||e.predicate==null||e.object==null)throw new MappingException("Actual RDF callback lacks its construction source");
        store.records(1);store.references(3);int id=store.occurrences.size()+1;Triple t=new Triple(IRI.create(s),IRI.create(p),o==null?null:IRI.create(o),lexical,lang,datatype==null?null:IRI.create(datatype));
        store.occurrences.add(new Occurrence(id,t,e.subject,e.predicate,e.object,e.kind));observer.beforeTriple(id);try{action.run();}finally{observer.afterTriple();}
    }
    Emission reified(Emission e,TermSource object){if(store==null)return null;if(e.reification==null)throw new MappingException("Reification callback lacks source");TermSource generated=term(e.reification.sourceSetId,false,true,e.reification.contextIds);return synthetic(e.reification,generated,object,"REIFICATION");}
    void emitResource(String subject,String predicate,String object,String reificationID,Emission e){
        RDFConsumer c=getRDFConsumer();String s=c.remapOnlyIfRemapped(subject);event(s,predicate,object,null,null,null,e,()->c.statementWithResourceValue(s,predicate,object));
        if(reificationID!=null){TermSource r=store==null?null:e.reification;
            event(reificationID,RDF+"type",RDF+"Statement",null,null,null,reified(e,r),()->c.statementWithResourceValue(reificationID,RDF+"type",RDF+"Statement"));
            event(reificationID,RDF+"subject",s,null,null,null,reified(e,store==null?null:inherit(e.subject)),()->c.statementWithResourceValue(reificationID,RDF+"subject",s));
            event(reificationID,RDF+"predicate",predicate,null,null,null,reified(e,store==null?null:inherit(e.predicate)),()->c.statementWithResourceValue(reificationID,RDF+"predicate",predicate));
            event(reificationID,RDF+"object",object,null,null,null,reified(e,store==null?null:inherit(e.object)),()->c.statementWithResourceValue(reificationID,RDF+"object",object));
        }
    }
    void emitLiteral(String subject,String predicate,String object,String datatype,String reificationID,Emission e){
        RDFConsumer c=getRDFConsumer();String lang=language;event(subject,predicate,null,object,lang,datatype,e,()->c.statementWithLiteralValue(subject,predicate,object,lang,datatype));
        if(reificationID!=null){TermSource r=store==null?null:e.reification;
            event(reificationID,RDF+"type",RDF+"Statement",null,null,null,reified(e,r),()->c.statementWithResourceValue(reificationID,RDF+"type",RDF+"Statement"));
            event(reificationID,RDF+"subject",subject,null,null,null,reified(e,store==null?null:inherit(e.subject)),()->c.statementWithResourceValue(reificationID,RDF+"subject",subject));
            event(reificationID,RDF+"predicate",predicate,null,null,null,reified(e,store==null?null:inherit(e.predicate)),()->c.statementWithResourceValue(reificationID,RDF+"predicate",predicate));
            event(reificationID,RDF+"object",null,object,lang,datatype,reified(e,store==null?null:inherit(e.object)),()->c.statementWithLiteralValue(reificationID,RDF+"object",object,lang,datatype));
        }
    }
}
