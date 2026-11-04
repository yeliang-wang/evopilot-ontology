package org.semanticweb.owlapi.functional.parser;

import java.io.StringReader;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.semanticweb.owlapi.formats.FunctionalSyntaxDocumentFormat;
import org.semanticweb.owlapi.io.OWLParserException;
import org.semanticweb.owlapi.model.OWLAxiom;
import org.semanticweb.owlapi.model.OWLOntology;
import org.semanticweb.owlapi.model.OWLOntologyLoaderConfiguration;

/**
 * EvoPilot's location adapter for the exact OWLAPI 5.5.1 Functional parser.
 * The same package is necessary because upstream Token and TokenManager are
 * package-private. No original parser class is replaced or subclassed through
 * reflection. LocatedTokenizer is derived by the retained parser recipe;
 * its valid lexical token kinds and images remain the upstream implementation's.
 * The identified correction rejects premature EOF while reading a token,
 * which the upstream tokenizer can otherwise mistake for document completion.
 *
 * Locations are half-open offsets in the original Java String, in UTF-16 code
 * units. They are not byte offsets or the upstream diagnostic line/column
 * values. The owner of the immutable document converts and hashes them.
 */
public final class LocatedFunctionalParser implements OWLFunctionalSyntaxParserConstants {
    public static final int MAXIMUM_OCCURRENCES = 200000;
    public static final int MAXIMUM_PREFIXES = 10000;

    private LocatedFunctionalParser() {}

    /**
     * Check the same token stream for the identified premature-token EOF
     * defect without constructing an ontology or allocating an axiom index.
     * This is not a grammar validator or a general repair of upstream lexical
     * errors; the original parser still validates the ensuing token stream.
     */
    public static void verifyLexicalCompleteness(String content) {
        LocatedTokenizer tokenizer = new LocatedTokenizer(new StringReader(Objects.requireNonNull(content)));
        while (tokenizer.getNextToken().kind != EOF) {
            // The renamed tokenizer itself rejects premature token EOF.
        }
    }

    public record Span(int start, int end) {
        public Span {
            if (start < 0 || end <= start) {
                throw new IllegalArgumentException("Nonempty source interval required");
            }
        }
    }

    public record Result(FunctionalSyntaxDocumentFormat format,
            Map<OWLAxiom, List<Span>> occurrences, List<Span> prefixes) {
        public Result {
            Objects.requireNonNull(format);
            Map<OWLAxiom, List<Span>> copy = new LinkedHashMap<>();
            occurrences.forEach((axiom, spans) -> copy.put(axiom, List.copyOf(spans)));
            occurrences = Collections.unmodifiableMap(copy);
            prefixes = List.copyOf(prefixes);
        }
    }

    /** An indexing budget failure never establishes complete source coverage. */
    public static final class LimitException extends RuntimeException {
        private static final long serialVersionUID = 1L;

        public LimitException(String message) {
            super(message);
        }
    }

    /** Used only by the exact renamed tokenizer in this package. */
    static final class LocatedToken extends Token {
        private static final long serialVersionUID = 1L;
        final int start;
        final int end;
        int constructStart = -1;
        int constructKind = -1;
        int parentKind = -1;

        LocatedToken(int kind, String image, int start, int end) {
            super(kind, image);
            this.start = start;
            this.end = end;
        }
    }

    private record Frame(int start, int kind, int parentKind) {}

    /**
     * Associates each closing token with its own lexical construct. Parser
     * lookahead may already have fetched later tokens when addAxiom runs, so
     * neither a global last-closed construct nor the reader cursor is evidence
     * for the axiom's endpoint. Strings, IRIs and comments produce no delimiter
     * tokens for parentheses occurring inside them.
     */
    private static final class TrackingTokens implements TokenManager {
        final LocatedTokenizer tokenizer;
        final ArrayDeque<Frame> frames = new ArrayDeque<>();
        final List<Span> prefixes = new ArrayList<>();
        LocatedToken previous;
        boolean eof;

        TrackingTokens(String content) {
            tokenizer = new LocatedTokenizer(new StringReader(content));
        }

        @Override
        public Token getNextToken() {
            LocatedToken next = (LocatedToken) tokenizer.getNextToken();
            if (next.kind == OPENPAR) {
                frames.push(new Frame(previous == null ? -1 : previous.start,
                        previous == null ? -1 : previous.kind,
                        frames.isEmpty() ? -1 : frames.peek().kind()));
            } else if (next.kind == CLOSEPAR && !frames.isEmpty()) {
                Frame frame = frames.pop();
                next.constructStart = frame.start();
                next.constructKind = frame.kind();
                next.parentKind = frame.parentKind();
                if (frame.kind() == PREFIX && frame.parentKind() == -1) {
                    if (prefixes.size() >= MAXIMUM_PREFIXES) {
                        throw new LimitException("Functional prefix occurrence budget exceeded");
                    }
                    prefixes.add(new Span(frame.start(), next.end));
                }
            } else if (next.kind == EOF) {
                eof = true;
            }
            previous = next;
            return next;
        }
    }

    private static final class Collector extends OWLFunctionalSyntaxParser {
        final OWLOntology destination;
        final int maximumOccurrences;
        final int contentLength;
        final Map<OWLAxiom, List<Span>> occurrences = new LinkedHashMap<>();
        int occurrenceCount;

        Collector(TrackingTokens tokens, OWLOntology ontology, int maximumOccurrences,
                int contentLength) {
            super(tokens);
            destination = ontology;
            this.maximumOccurrences = maximumOccurrences;
            this.contentLength = contentLength;
        }

        @Override
        protected void addAxiom(OWLAxiom axiom) {
            Token current = getToken(0);
            if (!(current instanceof LocatedToken close) || close.kind != CLOSEPAR
                    || close.parentKind != ONTOLOGY || close.constructStart < 0
                    || close.constructStart >= close.end || close.end > contentLength) {
                throw new OWLParserException("Functional axiom has no exact parser interval");
            }
            if (occurrenceCount >= maximumOccurrences) {
                throw new LimitException("Functional axiom occurrence budget exceeded");
            }
            occurrenceCount++;
            super.addAxiom(axiom);
            // Respect the original parser's annotation-loading configuration.
            // Duplicate syntax still appends an occurrence after the ontology
            // itself has deduplicated the structurally equal axiom.
            if (destination.containsAxiom(axiom)) {
                occurrences.computeIfAbsent(axiom, unused -> new ArrayList<>())
                        .add(new Span(close.constructStart, close.end));
            }
        }
    }

    /**
     * Parse into an empty ontology using the original parser/configuration.
     * Prefix declarations are contextual syntax, never logical support axioms.
     * Nothing is returned until the original parse() accepts its final EOF.
     * A parse failure never returns a partial index. Valid lexical semantics
     * are preserved, with explicit refusal of premature token EOF instead of
     * the upstream tokenizer's erroneous document-completion EOF token.
     */
    public static Result parse(String content, OWLOntology ontology,
            OWLOntologyLoaderConfiguration configuration, int maximumOccurrences) {
        Objects.requireNonNull(content);
        Objects.requireNonNull(ontology);
        Objects.requireNonNull(configuration);
        if (maximumOccurrences < 1 || maximumOccurrences > MAXIMUM_OCCURRENCES) {
            throw new IllegalArgumentException("Functional occurrence limit must be 1..200000");
        }
        if (!ontology.getAxioms().isEmpty()) {
            throw new IllegalArgumentException("Functional location parsing needs an empty ontology");
        }
        TrackingTokens tokens = new TrackingTokens(content);
        Collector parser = new Collector(tokens, ontology, maximumOccurrences, content.length());
        parser.setUp(ontology, configuration);
        final FunctionalSyntaxDocumentFormat format;
        try {
            format = parser.parse();
        } catch (ParseException error) {
            throw new OWLParserException(error.getMessage(), error, 0, 0);
        }
        if (!tokens.eof || !tokens.frames.isEmpty()
                || !ontology.getAxioms().equals(parser.occurrences.keySet())) {
            throw new OWLParserException("Functional source index is incomplete");
        }
        return new Result(format, parser.occurrences, tokens.prefixes);
    }
}
