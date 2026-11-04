/* EvoPilot source-location adapter for the pinned OWLAPI 5.5.1 Turtle parser.
 * The exact upstream-derived sources and their notices are retained through
 * turtle-compat.json. This class does not replace an original OWLAPI class. */
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
        if (maximumOccurrences < 1 || maximumOccurrences > 200000)
            throw new IllegalArgumentException("Occurrence limit must be 1..200000");
        Collector collector = new Collector(content.length(), documentIri, observer, maximumOccurrences);
        LocatedTurtleSyntaxParser parser = new LocatedTurtleSyntaxParser(
                new StringReader(content), semanticSink, documentIri);
        parser.sourceContent = content;
        parser.locations = collector;
        parser.parseDocument();
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
        LocatedTurtleSyntaxParser parser = new LocatedTurtleSyntaxParser(
                new StringReader(content), semanticSink, documentIri);
        parser.sourceContent = content;
        parser.parseDocument();
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
        validateIriCharacters(iri);
        return iri;
    }

    /** RFC 3987 section 2.2 character classes, without URI normalization or a
     * java.net.URI conversion (which rejects some legal Unicode ucschar values).
     * This is a character/escape correction, not a new relative-IRI resolver. */
    private static void validateIriCharacters(String iri) throws ParseException {
        boolean query = false, fragment = false;
        for (int i = 0; i < iri.length();) {
            int cp = iri.codePointAt(i); i += Character.charCount(cp);
            if (cp == '#') { fragment = true; query = false; }
            else if (cp == '?' && !fragment) query = true;
            if (cp < 0x80) {
                if (cp <= 0x20 || cp == 0x7F || "\\<>\"{}|^`".indexOf(cp) >= 0)
                    throw new ParseException("Illegal character in decoded Turtle IRI");
                continue;
            }
            boolean ucschar = cp >= 0xA0 && cp <= 0xD7FF
                    || cp >= 0xF900 && cp <= 0xFDCF
                    || cp >= 0xFDF0 && cp <= 0xFFEF
                    || cp >= 0x10000 && cp <= 0xDFFFD && (cp & 0xFFFF) <= 0xFFFD
                    || cp >= 0xE1000 && cp <= 0xEFFFD;
            boolean privateChar = cp >= 0xE000 && cp <= 0xF8FF
                    || cp >= 0xF0000 && cp <= 0xFFFFD
                    || cp >= 0x100000 && cp <= 0x10FFFD;
            if (!ucschar && !(query && privateChar))
                throw new ParseException("Illegal Unicode character in decoded Turtle IRI");
        }
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
        void rememberIri(String key, boolean created) {
            if (created) iriContexts.put(key, IRI.create(key).isAbsolute() ? List.of() : List.of(baseContext));
            else iriContexts.putIfAbsent(key, List.of());
        }
        int context(String kind, String name, IRI value, int source, List<Integer> deps) {
            int id = contexts.size() + 1; contexts.add(new Context(id, kind, name, value, source, deps)); return id;
        }
        void prefix(int source, String name, IRI value) {
            if (++explicitContexts > 10000) throw new LimitException("Turtle directive budget exceeded");
            prefixes.put(name, context("PREFIX", name, value, source, last.contextIds())); directive = source;
        }
        void base(int source, IRI value) {
            if (++explicitContexts > 10000) throw new LimitException("Turtle directive budget exceeded");
            baseContext = context("BASE", null, value, source, List.of()); directive = source;
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
