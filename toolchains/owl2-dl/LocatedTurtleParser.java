/* EvoPilot Turtle 1.1 semantic/source-location adapter using pinned RDF4J 5.0.2
 * lexical parsing and the OWLAPI callback interface. Exact owned sources and
 * historical OWLAPI-derived helpers remain bound by turtle-compat.json.
 * This class does not replace an upstream RDF4J or OWLAPI class. */
package org.semanticweb.owlapi.rdf.turtle.parser;

import java.io.IOException;
import java.io.StringReader;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.semanticweb.owlapi.model.IRI;
import org.semanticweb.owlapi.vocab.Namespaces;

/** Raw parser occurrences, not a claim that RDF triples are OWL axiom spans. */
public final class LocatedTurtleParser {
    private LocatedTurtleParser() {}

    public record Span(int start, int end) {
        public Span {
            if (start < 0 || end <= start) throw new IllegalArgumentException("Invalid source span");
        }
    }
    public record Source(int id, Span span, String kind) {}
    public record TermSource(int sourceId, boolean inherited, boolean generated,
            List<Integer> contextIds) {
        public TermSource { contextIds = List.copyOf(contextIds); }
    }
    /** Exactly the original callback payload; resource and lexical objects are exclusive. */
    public record Triple(IRI subject, IRI predicate, IRI resourceObject,
            String lexicalObject, String language, IRI datatype) {}
    public record Occurrence(int id, Triple triple, TermSource subject,
            TermSource predicate, TermSource object, String generatedKind) {}
    /** sourceId=0 is implicit document/default-prefix context, never an invented span. */
    public record Context(int id, String kind, String prefixName, IRI resolved,
            int sourceId, List<Integer> dependencyContextIds) {
        public Context { dependencyContextIds = List.copyOf(dependencyContextIds); }
    }
    public record Result(List<Source> sources, List<Occurrence> occurrences,
            List<Context> contexts) {
        public Result {
            sources = List.copyOf(sources);
            occurrences = List.copyOf(occurrences);
            contexts = List.copyOf(contexts);
        }
    }
    public interface OccurrenceObserver {
        void beforeTriple(int occurrenceId);
        void afterTriple();
    }
    public static final class LimitException extends RuntimeException {
        public LimitException(String message) { super(message); }
    }

    public static Result parse(String content, IRI documentIri, TripleHandler semanticSink,
            OccurrenceObserver observer, int maximumOccurrences) throws ParseException, IOException {
        Objects.requireNonNull(content);
        Objects.requireNonNull(documentIri);
        Objects.requireNonNull(semanticSink);
        Objects.requireNonNull(observer);
        RDFIRI.validateAbsolute(documentIri.toString());
        if (maximumOccurrences < 1 || maximumOccurrences > 200000)
            throw new IllegalArgumentException("Occurrence limit must be 1..200000");
        Collector collector = new Collector(content.length(), documentIri, observer, maximumOccurrences);
        new Rio(content, documentIri, semanticSink, collector).run();
        return collector.seal();
    }

    /** Ordinary semantic parsing uses the same IRI correction without allocating
     * source handles, contexts, occurrences or an observer. Located-index limits
     * must not become new limits on ordinary ontology loading. */
    public static void parseUnlocated(String content, IRI documentIri,
            TripleHandler semanticSink) throws ParseException, IOException {
        Objects.requireNonNull(content);
        Objects.requireNonNull(documentIri);
        Objects.requireNonNull(semanticSink);
        RDFIRI.validateAbsolute(documentIri.toString());
        new Rio(content, documentIri, semanticSink, null).run();
    }

    /** RDF4J 5.0.2 supplies the Turtle 1.1 lexical grammar. This adapter retains
     * original character intervals while emitting the same semantic callbacks
     * for located and ordinary parsing. It does not modify upstream classes. */
    static final class Rio extends org.eclipse.rdf4j.rio.turtle.TurtleParser {
        final String content;
        final TripleHandler sink;
        final Collector locations;
        final String documentIri;
        final Map<org.eclipse.rdf4j.model.BNode,IRI> blankNodes=new java.util.LinkedHashMap<>();
        String base;
        int offset, depth, statementStart, directiveSource;
        List<Integer> valueDependencies = List.of();
        record Term(org.eclipse.rdf4j.model.Value value, TermSource source, boolean nonemptyPropertyList) {}

        Rio(String content, IRI documentIri, TripleHandler sink, Collector locations) {
            this.content=content;this.documentIri=documentIri.toString();this.sink=sink;this.locations=locations;
            var config=getParserConfig();
            config.set(org.eclipse.rdf4j.rio.helpers.BasicParserSettings.VERIFY_DATATYPE_VALUES,false);
            config.set(org.eclipse.rdf4j.rio.helpers.BasicParserSettings.NORMALIZE_DATATYPE_VALUES,false);
            config.set(org.eclipse.rdf4j.rio.helpers.BasicParserSettings.FAIL_ON_UNKNOWN_DATATYPES,false);
            config.set(org.eclipse.rdf4j.rio.helpers.BasicParserSettings.VERIFY_LANGUAGE_TAGS,true);
            config.set(org.eclipse.rdf4j.rio.helpers.BasicParserSettings.FAIL_ON_UNKNOWN_LANGUAGES,false);
            config.set(org.eclipse.rdf4j.rio.helpers.BasicParserSettings.NORMALIZE_LANGUAGE_TAGS,false);
            config.set(org.eclipse.rdf4j.rio.helpers.BasicParserSettings.NAMESPACES,java.util.Set.of());
            config.set(org.eclipse.rdf4j.rio.turtle.TurtleParserSettings.ACCEPT_TURTLESTAR,false);
            config.set(org.eclipse.rdf4j.rio.turtle.TurtleParserSettings.CASE_INSENSITIVE_DIRECTIVES,false);
        }
        void run() throws IOException, ParseException {
            try { parse(new StringReader(content),documentIri);sink.handleEnd(); }
            catch(org.eclipse.rdf4j.rio.RDFParseException e){throw new ParseException(e.getMessage());}
        }
        @Override protected int readCodePoint() throws IOException {
            int c=super.readCodePoint();if(c!=-1)offset+=Character.charCount(c);return c;
        }
        @Override protected void unread(int c) throws IOException {
            super.unread(c);if(c!=-1)offset-=Character.charCount(c);
        }
        @Override protected void unread(String text) throws IOException {super.unread(text);offset-=text.length();}
        @Override protected void setBaseURI(String iri){super.setBaseURI(iri);base=iri;}
        @Override protected org.eclipse.rdf4j.model.IRI createURI(String iri) {
            RDFIRI.validateAbsolute(iri);return super.createURI(iri);
        }
        int end(){int end=offset;while(end>0&&" \t\r\n".indexOf(content.charAt(end-1))>=0)end--;return end;}
        TermSource source(int start,int end,String kind,List<Integer> dependencies){
            return locations==null?null:new TermSource(locations.add(start,end,kind),false,false,dependencies);
        }
        TermSource inherit(TermSource source){return source==null?null:locations.inherit(source);}
        TermSource generated(int id){return locations==null?null:locations.generated(id);}
        int open(int start,String kind){return locations==null?0:locations.add(start,-1,kind);}
        void close(int id){if(locations!=null)locations.sources.get(id-1).end=offset;}
        @Override protected void parseStatement() throws IOException {
            statementStart=offset;directiveSource=0;super.parseStatement();
            if(directiveSource!=0)close(directiveSource);
        }
        @Override protected org.eclipse.rdf4j.model.IRI parseURI() throws IOException {
            int start=offset;verifyCharacterOrFail(readCodePoint(),"<");
            while(true){int c=readCodePoint();if(c==-1)throwEOFException();if(c=='>')break;if(c=='\\'&&readCodePoint()==-1)throwEOFException();}
            LocatedToken token=new LocatedToken(1,content.substring(start,offset),start,offset);
            final String reference;
            try {reference=decodeIri(content,token);}catch(ParseException e){throw new org.eclipse.rdf4j.rio.RDFParseException(e.getMessage());}
            valueDependencies=locations==null||RDFIRI.hasScheme(reference)?List.of():List.of(locations.baseContext);
            return createURI(RDFIRI.resolve(reference,base));
        }
        @Override protected String parseQuotedString() throws IOException {
            int start=offset;super.parseQuotedString();
            try{return decodeString(content,new LocatedToken(1,content.substring(start,offset),start,offset));}
            catch(ParseException e){throw new org.eclipse.rdf4j.rio.RDFParseException(e.getMessage());}
        }
        @Override protected org.eclipse.rdf4j.model.Literal parseNumber() throws IOException {
            int start=offset;var value=super.parseNumber();String raw=content.substring(start,Math.max(start,end()));
            if(!raw.matches("[+-]?(?:[0-9]+|[0-9]*\\.[0-9]+|(?:[0-9]+\\.[0-9]*|\\.[0-9]+|[0-9]+)[eE][+-]?[0-9]+)"))
                reportFatalError("Invalid Turtle numeric token");
            return value;
        }
        @Override protected void parsePrefixID() throws IOException {
            skipWSC();int start=offset;
            super.parsePrefixID();
            int colon=content.indexOf(':',start);String name=content.substring(start,colon).trim()+":";
            String iri=getNamespace(name.substring(0,name.length()-1));
            if(locations!=null){
                if(++locations.explicitContexts>10000)throw new LimitException("Turtle directive budget exceeded");
                directiveSource=open(statementStart,"PREFIX");
                locations.prefixes.put(name,locations.context("PREFIX",name,IRI.create(iri),directiveSource,valueDependencies));
            }
            sink.handlePrefixDirective(name,iri);
        }
        @Override protected void parseBase() throws IOException {
            super.parseBase();
            if(locations!=null){
                if(++locations.explicitContexts>10000)throw new LimitException("Turtle directive budget exceeded");
                directiveSource=open(statementStart,"BASE");
                locations.baseContext=locations.context("BASE",null,IRI.create(base),directiveSource,valueDependencies);
            }
            sink.handleBaseDirective(IRI.create(base));
        }
        @Override protected org.eclipse.rdf4j.model.Value parseQNameOrBoolean() throws IOException {
            int start=offset;var value=super.parseQNameOrBoolean();
            if(locations!=null&&value instanceof org.eclipse.rdf4j.model.IRI){
                String raw=content.substring(start,offset);int colon=raw.indexOf(':');
                Integer id=colon<0?null:locations.prefixes.get(raw.substring(0,colon+1));
                if(id==null)throw new IllegalStateException("Resolved QName has no declared prefix context");
                valueDependencies=List.of(id);
            }
            return value;
        }
        @Override protected void parseTriples() throws IOException {
            Term subject=term();if(!(subject.value() instanceof org.eclipse.rdf4j.model.Resource))reportFatalError("Illegal RDF subject");
            int next=skipWSC();if(!(subject.nonemptyPropertyList()&&next=='.'))predicates(subject);
        }
        void predicates(Term subject) throws IOException {
            boolean inherited=false;
            while(true){
                skipWSC();int start=offset;valueDependencies=List.of();var predicate=super.parsePredicate();
                Term p=new Term(predicate,source(start,end(),"TOKEN",valueDependencies),false);
                Term s=inherited?new Term(subject.value(),inherit(subject.source()),false):subject;
                while(true){
                    skipWSC();Term object=term();emit(s,p,object,null);
                    int c=skipWSC();if(c!=',')break;readCodePoint();
                    s=new Term(s.value(),inherit(s.source()),false);p=new Term(p.value(),inherit(p.source()),false);
                }
                if(skipWSC()!=';')break;
                do{readCodePoint();}while(skipWSC()==';');
                int c=skipWSC();if(c=='.'||c==']')break;
                inherited=true;
            }
        }
        Term term() throws IOException {
            if(++depth>512)throw new LimitException("Turtle source nesting budget exceeded");
            try{
                int start=offset,c=peekCodePoint();
                if(c=='['){
                    readCodePoint();int id=open(start,"PROPERTY_LIST");var node=createNode();Term result=new Term(node,generated(id),false);
                    boolean nonempty=skipWSC()!=']';if(nonempty)predicates(result);
                    verifyCharacterOrFail(readCodePoint(),"]");close(id);return new Term(node,result.source(),nonempty);
                }
                if(c=='('){
                    readCodePoint();int id=open(start,"COLLECTION");TermSource generated=generated(id);
                    var nil=org.eclipse.rdf4j.model.vocabulary.RDF.NIL;
                    if(skipWSC()==')'){readCodePoint();close(id);return new Term(nil,generated,false);}
                    var first=createNode();var current=first;
                    while(true){
                        skipWSC();Term object=term();Term cell=new Term(current,generated,false);
                        emit(cell,new Term(org.eclipse.rdf4j.model.vocabulary.RDF.FIRST,generated,false),object,"COLLECTION_FIRST");
                        if(skipWSC()==')'){
                            readCodePoint();emit(cell,new Term(org.eclipse.rdf4j.model.vocabulary.RDF.REST,generated,false),new Term(nil,generated,false),"COLLECTION_REST");break;
                        }
                        var next=createNode();emit(cell,new Term(org.eclipse.rdf4j.model.vocabulary.RDF.REST,generated,false),new Term(next,generated,false),"COLLECTION_REST");current=next;
                    }
                    close(id);return new Term(first,generated,false);
                }
                valueDependencies=List.of();var value=super.parseValue();
                return new Term(value,source(start,end(),"TOKEN",valueDependencies),false);
            }finally{depth--;}
        }
        IRI iri(org.eclipse.rdf4j.model.Value value){
            // OWLAPI's consumer recognizes only its internal genid convention.
            // Keep a bijection; never expose an RDF blank node as a named IRI
            // or strip user labels in a way that can merge distinct nodes.
            if(value instanceof org.eclipse.rdf4j.model.BNode node)
                return blankNodes.computeIfAbsent(node,k->IRI.create("_:genid-nodeid-rio"+blankNodes.size()));
            return IRI.create(value.stringValue());
        }
        void emit(Term subject,Term predicate,Term object,String kind){
            IRI s=iri(subject.value()),p=iri(predicate.value());var value=object.value();
            TermSource ss=subject.source(),ps=predicate.source(),os=object.source();
            if(value instanceof org.eclipse.rdf4j.model.Literal literal){
                String lexical=literal.getLabel();
                if(literal.getLanguage().isPresent()){
                    String language=literal.getLanguage().get();
                    if(locations==null)sink.handleTriple(s,p,lexical,language);else locations.language(sink,s,p,lexical,language,ss,ps,os,kind);
                }else if(literal.getDatatype().equals(org.eclipse.rdf4j.model.vocabulary.XSD.STRING)){
                    if(locations==null)sink.handleTriple(s,p,lexical);else locations.plain(sink,s,p,lexical,ss,ps,os,kind);
                }else{
                    IRI datatype=iri(literal.getDatatype());
                    if(locations==null)sink.handleTriple(s,p,lexical,datatype);else locations.datatype(sink,s,p,lexical,datatype,ss,ps,os,kind);
                }
            }else{
                IRI o=iri(value);if(locations==null)sink.handleTriple(s,p,o);else locations.resource(sink,s,p,o,ss,ps,os,kind);
            }
        }
    }

    /** RDF string escapes belong to the original lexical form, not Java's or
     * OWLAPI EscapeUtils' escape language. Preserve Unicode scalar values. */
    static String decodeString(String content, Token token) throws ParseException {
        if (!(token instanceof LocatedToken value) || content == null
                || value.sourceStart < 0 || value.sourceEnd > content.length())
            throw new ParseException("Missing original Turtle string");
        String raw = content.substring(value.sourceStart, value.sourceEnd);
        if (raw.length() < 2 || raw.charAt(0) != '"' && raw.charAt(0) != '\'')
            throw new ParseException("Invalid Turtle string delimiter");
        char quote = raw.charAt(0);
        int width = raw.length() >= 6 && raw.charAt(1) == quote && raw.charAt(2) == quote ? 3 : 1;
        if (raw.length() < 2 * width || !raw.endsWith(String.valueOf(quote).repeat(width)))
            throw new ParseException("Incomplete Turtle string");
        StringBuilder decoded = new StringBuilder();
        for (int i = width, end = raw.length() - width; i < end;) {
            char c = raw.charAt(i++);
            if (c == '\\') {
                if (i == end) throw new ParseException("Incomplete Turtle string escape");
                char escaped = raw.charAt(i++);
                if (escaped == 'u' || escaped == 'U') {
                    int digits = escaped == 'u' ? 4 : 8;
                    if (end - i < digits) throw new ParseException("Incomplete Turtle string UCHAR");
                    long scalar = 0;
                    for (int n = 0; n < digits; n++) {
                        char h = raw.charAt(i++);
                        int digit = h >= '0' && h <= '9' ? h - '0' : h >= 'a' && h <= 'f' ? h - 'a' + 10 : h >= 'A' && h <= 'F' ? h - 'A' + 10 : -1;
                        if (digit < 0) throw new ParseException("Invalid Turtle string UCHAR");
                        scalar = scalar * 16 + digit;
                    }
                    if (scalar > 0x10FFFF || scalar >= 0xD800 && scalar <= 0xDFFF)
                        throw new ParseException("Turtle string UCHAR is not a Unicode scalar");
                    decoded.appendCodePoint((int) scalar);
                } else decoded.append(switch (escaped) {
                    case 't' -> '\t'; case 'b' -> '\b'; case 'n' -> '\n'; case 'r' -> '\r'; case 'f' -> '\f';
                    case '"' -> '"'; case '\'' -> '\''; case '\\' -> '\\';
                    default -> throw new ParseException("Invalid Turtle string ECHAR");
                });
            } else {
                if (width == 1 && (c == '\n' || c == '\r' || c == quote))
                    throw new ParseException("Unescaped short Turtle string delimiter or newline");
                if (Character.isHighSurrogate(c)) {
                    if (i == end || !Character.isLowSurrogate(raw.charAt(i))) throw new ParseException("Unpaired Turtle string surrogate");
                    decoded.append(c).append(raw.charAt(i++));
                } else {
                    if (Character.isLowSurrogate(c)) throw new ParseException("Unpaired Turtle string surrogate");
                    decoded.append(c);
                }
            }
        }
        return decoded.toString();
    }

    /** Decode IRIREF UCHARs exactly once from the original input. JavaCharStream
     * already applies Java-style lowercase-u translation to token.image, so the
     * transformed image cannot establish either the original escape grammar or
     * whether a backslash was itself escaped. QName decoding is not changed. */
    static String decodeIri(String content, Token token) throws ParseException {
        if (content == null || !(token instanceof LocatedToken value)
                || value.sourceStart < 0 || value.sourceEnd > content.length()
                || value.sourceEnd - value.sourceStart < 2
                || content.charAt(value.sourceStart) != '<'
                || content.charAt(value.sourceEnd - 1) != '>')
            throw new ParseException("Missing original Turtle IRIREF");
        StringBuilder decoded = new StringBuilder(value.sourceEnd - value.sourceStart - 2);
        for (int i = value.sourceStart + 1, end = value.sourceEnd - 1; i < end;) {
            char c = content.charAt(i++);
            if (c == '\\') {
                if (i >= end) throw new ParseException("Incomplete Turtle IRI escape");
                char kind = content.charAt(i++);
                int digits = kind == 'u' ? 4 : kind == 'U' ? 8 : 0;
                if (digits == 0 || end - i < digits)
                    throw new ParseException("Invalid Turtle IRI UCHAR");
                long scalar = 0;
                for (int n = 0; n < digits; n++) {
                    char h = content.charAt(i++);
                    int digit = h >= '0' && h <= '9' ? h - '0'
                            : h >= 'A' && h <= 'F' ? h - 'A' + 10
                            : h >= 'a' && h <= 'f' ? h - 'a' + 10 : -1;
                    if (digit < 0) throw new ParseException("Invalid Turtle IRI hexadecimal escape");
                    scalar = scalar * 16 + digit;
                }
                if (scalar > 0x10FFFF || scalar >= 0xD800 && scalar <= 0xDFFF)
                    throw new ParseException("Turtle IRI escape is not a Unicode scalar");
                decoded.appendCodePoint((int) scalar);
            } else if (Character.isHighSurrogate(c)) {
                if (i >= end || !Character.isLowSurrogate(content.charAt(i)))
                    throw new ParseException("Unpaired surrogate in Turtle IRI");
                decoded.append(c).append(content.charAt(i++));
            } else {
                if (Character.isLowSurrogate(c)) throw new ParseException("Unpaired surrogate in Turtle IRI");
                decoded.append(c);
            }
        }
        String iri = decoded.toString();
        RDFIRI.validateReference(iri);
        return iri;
    }

    static IRI validatedTerm(IRI value) {
        RDFIRI.validateAbsolute(value.toString());
        return value;
    }

    /** Uses original token identity/kind/image; offsets include the raw escape spelling. */
    static final class LocatedToken extends Token {
        final int sourceStart;
        final int sourceEnd;
        LocatedToken(int kind, String image, int start, int end) {
            super(kind, image);
            sourceStart = start;
            sourceEnd = end;
        }
    }
    private static final class PendingSource {
        final int id;
        final int start;
        final String kind;
        int end;
        PendingSource(int id, int start, int end, String kind) {
            this.id = id; this.start = start; this.end = end; this.kind = kind;
        }
    }

    /** Internal handles can precede their closing token; no partial Result escapes. */
    static final class Collector {
        final int length;
        final int maximum;
        final OccurrenceObserver observer;
        final ArrayList<PendingSource> sources = new ArrayList<>();
        final ArrayList<Occurrence> occurrences = new ArrayList<>();
        final ArrayList<Context> contexts = new ArrayList<>();
        final ArrayDeque<Integer> open = new ArrayDeque<>();
        final Map<String, Integer> prefixes = new HashMap<>();
        final Map<String, List<Integer>> iriContexts = new HashMap<>();
        TermSource last;
        int baseContext;
        int directive = -1;
        int explicitContexts;
        boolean sealed;

        Collector(int length, IRI base, OccurrenceObserver observer, int maximum) {
            this.length = length; this.observer = observer; this.maximum = maximum;
            baseContext = context("DOCUMENT", null, base, 0, List.of());
            // Match the pinned DefaultPrefixManager.setupDefaultPrefixes().
            builtin("owl:", Namespaces.OWL.toString());
            builtin("rdfs:", Namespaces.RDFS.toString());
            builtin("rdf:", Namespaces.RDF.toString());
            builtin("xsd:", Namespaces.XSD.toString());
            builtin("xml:", Namespaces.XML.toString());
            prefixes.put(":", context("BUILTIN", ":",
                    IRI.create("http://www.semanticweb.org/owl/owlapi/turtle#"), 0, List.of()));
        }
        private void builtin(String name, String namespace) {
            prefixes.put(name, context("BUILTIN", name, IRI.create(namespace), 0, List.of()));
        }
        LocatedToken located(Token token) {
            if (!(token instanceof LocatedToken value) || value.kind == 0
                    || value.sourceStart < 0 || value.sourceEnd <= value.sourceStart
                    || value.sourceEnd > length)
                throw new IllegalStateException("Missing exact Turtle token source");
            return value;
        }
        int add(int start, int end, String kind) {
            if (sealed || sources.size() >= maximum * 8 + 20002)
                throw new LimitException("Turtle source-handle budget exceeded");
            int id = sources.size() + 1; sources.add(new PendingSource(id, start, end, kind)); return id;
        }
        int open(Token token, String kind) {
            if (open.size() >= 512) throw new LimitException("Turtle source nesting budget exceeded");
            int id = add(located(token).sourceStart, -1, kind); open.push(id); return id;
        }
        void close(int id, Token token) {
            if (open.isEmpty() || open.pop() != id) throw new IllegalStateException("Unbalanced Turtle source scope");
            PendingSource value = sources.get(id - 1);
            value.end = located(token).sourceEnd;
            if (value.end <= value.start) throw new IllegalStateException("Empty Turtle source scope");
        }
        TermSource range(Token first, Token lastToken, String kind, List<Integer> dependencies) {
            int id = add(located(first).sourceStart, located(lastToken).sourceEnd, kind);
            return new TermSource(id, false, false, dependencies);
        }
        TermSource token(Token token) { return range(token, token, "TOKEN", List.of()); }
        TermSource generated(int sourceId) { return new TermSource(sourceId, false, true, List.of()); }
        TermSource inherit(TermSource value) {
            return new TermSource(value.sourceId(), true, value.generated(), value.contextIds());
        }
        IRI tokenTerm(Token token, IRI value) { last = token(token); return value; }
        IRI iriTerm(Token token, IRI value, String key) {
            last = range(token, token, "TOKEN", iriContexts.getOrDefault(key, List.of())); return value;
        }
        IRI qnameTerm(Token token, IRI value) {
            String name = token.image.substring(0, token.image.indexOf(':') + 1);
            Integer id = prefixes.get(name);
            if (!name.equals("_:") && id == null)
                throw new IllegalStateException("Resolved Turtle QName has no prefix context");
            // The upstream _: branch resolves a genid through getIRI, not the prefix map.
            List<Integer> deps = name.equals("_:")
                    ? iriContexts.getOrDefault("genid" + token.image.substring(2), List.of())
                    : List.of(id);
            last = range(token, token, "TOKEN", deps); return value;
        }
        void rememberIri(String key) {
            // Resolution happens for each occurrence, even when its resulting
            // absolute IRI object is cached. Dependencies follow the current base.
            iriContexts.put(key, RDFIRI.hasScheme(key) ? List.of() : List.of(baseContext));
        }
        int context(String kind, String name, IRI value, int source, List<Integer> deps) {
            int id = contexts.size() + 1; contexts.add(new Context(id, kind, name, value, source, deps)); return id;
        }
        void prefix(int source, String name, IRI value) {
            if (++explicitContexts > 10000) throw new LimitException("Turtle directive budget exceeded");
            prefixes.put(name, context("PREFIX", name, value, source, last.contextIds())); directive = source;
        }
        void base(int source, IRI value, String reference) {
            if (++explicitContexts > 10000) throw new LimitException("Turtle directive budget exceeded");
            List<Integer> dependencies = RDFIRI.hasScheme(reference) ? List.of() : List.of(baseContext);
            baseContext = context("BASE", null, value, source, dependencies); directive = source;
        }
        void closeDirective(Token token) {
            if (directive < 0) throw new IllegalStateException("Turtle directive has no source");
            close(directive, token); directive = -1;
        }
        TermSource literal(Token first, Token lastToken, List<Integer> deps) {
            return range(first, lastToken, "TOKEN", deps);
        }
        int record(Triple value, TermSource subject, TermSource predicate, TermSource object, String kind) {
            if (sealed || occurrences.size() >= maximum) throw new LimitException("Turtle triple occurrence budget exceeded");
            Objects.requireNonNull(subject); Objects.requireNonNull(predicate); Objects.requireNonNull(object);
            if (kind == null && subject.generated()
                    && sources.get(subject.sourceId() - 1).kind.equals("PROPERTY_LIST")) kind = "BLANK_PROPERTY_LIST";
            int id = occurrences.size() + 1; occurrences.add(new Occurrence(id, value, subject, predicate, object, kind));
            observer.beforeTriple(id); return id;
        }
        void resource(TripleHandler sink, IRI s, IRI p, IRI o,
                TermSource ss, TermSource ps, TermSource os, String kind) {
            record(new Triple(s,p,o,null,null,null),ss,ps,os,kind);
            try { sink.handleTriple(s,p,o); } finally { observer.afterTriple(); }
        }
        void plain(TripleHandler sink, IRI s, IRI p, String o,
                TermSource ss, TermSource ps, TermSource os, String kind) {
            record(new Triple(s,p,null,o,null,null),ss,ps,os,kind);
            try { sink.handleTriple(s,p,o); } finally { observer.afterTriple(); }
        }
        void language(TripleHandler sink, IRI s, IRI p, String o, String lang,
                TermSource ss, TermSource ps, TermSource os, String kind) {
            record(new Triple(s,p,null,o,lang,null),ss,ps,os,kind);
            try { sink.handleTriple(s,p,o,lang); } finally { observer.afterTriple(); }
        }
        void datatype(TripleHandler sink, IRI s, IRI p, String o, IRI datatype,
                TermSource ss, TermSource ps, TermSource os, String kind) {
            record(new Triple(s,p,null,o,null,datatype),ss,ps,os,kind);
            try { sink.handleTriple(s,p,o,datatype); } finally { observer.afterTriple(); }
        }
        Result seal() {
            if (sealed || !open.isEmpty() || directive != -1) throw new IllegalStateException("Incomplete Turtle source index");
            ArrayList<Source> result = new ArrayList<>();
            for (PendingSource source : sources) {
                if (source.start < 0 || source.end > length || source.end <= source.start)
                    throw new IllegalStateException("Unsealed Turtle source interval");
                result.add(new Source(source.id, new Span(source.start, source.end), source.kind));
            }
            sealed = true; return new Result(result, occurrences, contexts);
        }
    }
}
