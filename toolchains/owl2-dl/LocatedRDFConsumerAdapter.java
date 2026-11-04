package org.semanticweb.owlapi.rdf.rdfxml.parser;

import java.util.Objects;
import javax.annotation.Nullable;
import org.semanticweb.owlapi.model.*;
import org.semanticweb.owlapi.rdf.turtle.parser.TripleHandler;

/** Owned bridge to the renamed mapper; no original OWLAPI class is replaced. */
public class LocatedRDFConsumerAdapter extends LocatedRDFConsumer implements TripleHandler {
    public LocatedRDFConsumerAdapter(OWLOntology ontology,
        OWLOntologyLoaderConfiguration configuration, RDFProvenance provenance) {
        super(ontology, configuration, Objects.requireNonNull(provenance));
    }
    @Override public void handlePrefixDirective(String name, String prefix) {}
    @Override public void handleBaseDirective(IRI base) {}
    @Override public void handleComment(String comment) {}
    @Override public void handleTriple(IRI s, IRI p, IRI o) { statementWithResourceValue(s, p, o); }
    @Override public void handleTriple(IRI s, IRI p, String o) { statementWithLiteralValue(s, p, o, null, null); }
    @Override public void handleTriple(IRI s, IRI p, String o, @Nullable String lang) {
        statementWithLiteralValue(s, p, o, lang, null);
    }
    @Override public void handleTriple(IRI s, IRI p, String o, @Nullable IRI datatype) {
        statementWithLiteralValue(s, p, o, null, datatype);
    }
    @Override public void handleEnd() { endModel(); }
}
