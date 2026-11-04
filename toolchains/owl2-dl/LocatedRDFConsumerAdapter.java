package org.semanticweb.owlapi.rdf.rdfxml.parser;

import java.util.*;
import javax.annotation.Nullable;
import org.semanticweb.owlapi.model.*;
import org.semanticweb.owlapi.rdf.turtle.parser.TripleHandler;
import static org.semanticweb.owlapi.vocab.OWLRDFVocabulary.*;

/** Owned bridge to the renamed mapper; no original OWLAPI class is replaced. */
public class LocatedRDFConsumerAdapter extends LocatedRDFConsumer implements TripleHandler {
    public static final class SemanticException extends RuntimeException {
        public SemanticException(String message) { super(message); }
    }
    private static final int MAX_FACTS = 200_000, MAX_REFERENCES = 2_000_000, MAX_DEPTH = 128;
    private static final long MAX_STEPS = 8_000_000;
    private final OWLOntology semanticOntology;
    private final Set<RDFProvenance.FactKey> inputFacts = new LinkedHashSet<>();
    private final Map<IRI, List<RDFProvenance.FactKey>> bySubject = new HashMap<>(), incoming = new HashMap<>();
    private final Map<IRI, Reification> reifications = new LinkedHashMap<>();
    private final Set<IRI> committed = new HashSet<>(), translating = new HashSet<>();
    private final IdentityHashMap<Set<OWLAnnotation>, Batch> batches = new IdentityHashMap<>();
    private final IdentityHashMap<Set<OWLAnnotation>, Issued> issuedSets = new IdentityHashMap<>();
    private Batch pendingBatch = new Batch();
    private Frame frame;
    private long deadline = System.nanoTime() + 30_000_000_000L, steps;
    private int references, depth, dispatchDepth;
    private boolean inputSealed, complete;

    private record Reification(IRI node, RDFProvenance.FactKey type,
        RDFProvenance.FactKey source, RDFProvenance.FactKey property, RDFProvenance.FactKey target) {}
    private static final class Batch {
        final Map<OWLAnnotation, Set<Reification>> uses = new LinkedHashMap<>();
    }
    private static final class Issued {
        final Set<OWLAnnotation> values;
        final Batch batch;
        final Set<OWLAnnotation> attached = new HashSet<>();
        boolean active = true;
        Issued(Set<OWLAnnotation> values, Batch batch) { this.values = values; this.batch = batch; }
    }
    private static final class Frame {
        final Frame parent;
        Issued last;
        Frame(Frame parent) { this.parent = parent; }
    }

    public LocatedRDFConsumerAdapter(OWLOntology ontology,
        OWLOntologyLoaderConfiguration configuration, RDFProvenance provenance) {
        super(ontology, configuration, Objects.requireNonNull(provenance));
        semanticOntology = ontology;
    }
    /** The worker supplies its existing absolute task deadline, before any input. */
    public final void configureDeadline(long absoluteNanos) {
        if (!inputFacts.isEmpty() || inputSealed) throw invalid("Late annotation deadline configuration");
        deadline = absoluteNanos; check();
    }
    private SemanticException invalid(String message) { return new SemanticException(message); }
    private void check() {
        if (System.nanoTime() - deadline >= 0) throw new RDFProvenance.TimeoutException("RDF annotation mapping exceeded the task deadline");
    }
    private void tick() {
        if (++steps > MAX_STEPS) throw new RDFProvenance.LimitException("RDF annotation mapping step budget exceeded");
        if ((steps & 255) == 0) check();
    }
    private void reference() {
        tick();
        if (++references > MAX_REFERENCES) throw new RDFProvenance.LimitException("RDF annotation mapping reference budget exceeded");
    }
    @Override protected void semanticInput(RDFProvenance.FactKey fact) {
        check();
        if (inputSealed || complete) throw invalid("RDF input after annotation sealing");
        if (!inputFacts.add(fact)) return;
        if (inputFacts.size() > MAX_FACTS) throw new RDFProvenance.LimitException("RDF annotation mapping fact budget exceeded");
        bySubject.computeIfAbsent(fact.subject(), k -> new ArrayList<>()).add(fact); reference();
        if (fact.resource() != null) { incoming.computeIfAbsent(fact.resource(), k -> new ArrayList<>()).add(fact); reference(); }
    }
    @Override protected AnnotationDispatchScope annotationDispatch() {
        tick();
        if (++dispatchDepth > 512) throw new RDFProvenance.LimitException("RDF annotation dispatch depth exceeded");
        Frame owned = new Frame(frame); frame = owned;
        return new AnnotationDispatchScope() {
            private boolean closed;
            @Override public void close() {
                if (closed || frame != owned) throw invalid("Annotation dispatch closed out of order");
                closed = true;
                if (owned.last != null) owned.last.active = false;
                frame = owned.parent; dispatchDepth--;
            }
        };
    }
    private List<RDFProvenance.FactKey> facts(IRI subject, IRI predicate) {
        List<RDFProvenance.FactKey> result = new ArrayList<>();
        for (var f : bySubject.getOrDefault(subject, List.of())) { tick(); if (f.predicate().equals(predicate)) result.add(f); }
        return result;
    }
    private RDFProvenance.FactKey single(IRI subject, IRI predicate, boolean resourceOnly) {
        var values = facts(subject, predicate);
        if (values.size() != 1 || resourceOnly && values.get(0).resource() == null) throw invalid("Incomplete or conflicting annotation reification");
        return values.get(0);
    }
    private boolean typed(IRI subject, IRI type) {
        return inputFacts.contains(RDFProvenance.FactKey.resource(subject, RDF_TYPE.getIRI(), type));
    }
    private boolean field(IRI predicate) {
        return predicate.equals(OWL_ANNOTATED_SOURCE.getIRI()) || predicate.equals(OWL_ANNOTATED_PROPERTY.getIRI()) || predicate.equals(OWL_ANNOTATED_TARGET.getIRI());
    }
    private void sealInput() {
        check(); inputSealed = true;
        Set<IRI> candidates = new LinkedHashSet<>();
        for (var f : inputFacts) {
            tick();
            if (field(f.predicate()) || f.predicate().equals(RDF_TYPE.getIRI()) && OWL_ANNOTATION.getIRI().equals(f.resource())) candidates.add(f.subject());
        }
        for (IRI node : candidates) {
            tick();
            if (typed(node, OWL_AXIOM.getIRI())) {
                if (typed(node, OWL_ANNOTATION.getIRI())) throw invalid("A reification node has conflicting kinds");
                continue; // The pinned axiom handler owns owl:Axiom groups.
            }
            if (!isAnonymousNode(node) || !typed(node, OWL_ANNOTATION.getIRI())) throw invalid("Annotation reification requires its own blank-node typing");
            Reification r = new Reification(node, RDFProvenance.FactKey.resource(node, RDF_TYPE.getIRI(), OWL_ANNOTATION.getIRI()),
                single(node, OWL_ANNOTATED_SOURCE.getIRI(), true), single(node, OWL_ANNOTATED_PROPERTY.getIRI(), true), single(node, OWL_ANNOTATED_TARGET.getIRI(), false));
            RDFProvenance.FactKey base = new RDFProvenance.FactKey(r.source.resource(), r.property.resource(), r.target.resource(), r.target.literal());
            if (!inputFacts.contains(base)) throw invalid("Annotation reification has no exact base triple");
            reifications.put(node, r); reference();
        }
        for (Reification r : reifications.values()) {
            for (var f : bySubject.getOrDefault(r.node, List.of())) {
                tick();
                if (f.equals(r.type) || f.equals(r.source) || f.equals(r.property) || f.equals(r.target)) continue;
                if (!isApLax(f.predicate())) throw invalid("Annotation reification has an extra outgoing structural use");
            }
            for (var f : incoming.getOrDefault(r.node, List.of())) {
                tick();
                if (!f.predicate().equals(OWL_ANNOTATED_SOURCE.getIRI()) || !reifications.containsKey(f.subject())) throw invalid("Annotation reification has an extra incoming use");
            }
        }
    }
    // Early annotated-declaration processing cannot know all nested annotations.
    // The ordinary base declaration is still streamed; reified attachment waits
    // for the original complete-graph axiom handler during mop-up.
    @Override protected void checkForAndProcessAnnotatedDeclaration(IRI n) {
        if (inputSealed) super.checkForAndProcessAnnotatedDeclaration(n);
    }
    @Override public void endModel() {
        if (inputSealed || complete) throw invalid("RDF annotation mapping ended twice");
        sealInput(); super.endModel(); check();
        if (frame != null || !pendingBatch.uses.isEmpty() || !committed.equals(reifications.keySet())) throw invalid("Unselected or unattached annotation reification remains");
        complete = true;
    }
    private Batch batch(Set<OWLAnnotation> values) {
        Batch result = batches.get(values);
        if (result == null) { result = new Batch(); batches.put(values, result); reference(); }
        return result;
    }
    private void addUse(Batch batch, OWLAnnotation annotation, Collection<Reification> uses) {
        Set<Reification> destination = batch.uses.get(annotation);
        if (destination == null) { destination = new LinkedHashSet<>(); batch.uses.put(annotation, destination); reference(); }
        for (Reification r : uses) { tick(); if (destination.add(r)) reference(); }
    }
    @Override public Set<OWLAnnotation> translateAnnotations(IRI n) {
        if (!inputSealed) throw invalid("Annotation translation before complete RDF input");
        check();
        if (++depth > MAX_DEPTH) throw new RDFProvenance.LimitException("RDF annotation nesting budget exceeded");
        if (!translating.add(n)) throw invalid("Cyclic annotation reification");
        try {
            Set<OWLAnnotation> result = super.translateAnnotations(n);
            batch(result); return result;
        } finally { translating.remove(n); depth--; }
    }
    private void observe(RDFProvenance.FactKey f) {
        if (f.resource() != null) provenance.readResource(f.subject(), f.predicate(), f.resource());
        else provenance.readLiteral(f.subject(), f.predicate(), f.literal());
    }
    private List<IRI> selected(IRI n, IRI p, IRI resource, OWLLiteral literal) {
        List<IRI> result = new ArrayList<>();
        try (RDFProvenance.AnnotationSelection selection = provenance.annotationSelection(n)) {
            for (IRI candidate : getAnnotatedSourceAnnotationMainNodes(n)) {
                tick(); Reification r = reifications.get(candidate);
                if (r == null) continue;
                if (selection.test(candidate, () -> {
                    observe(r.source); observe(r.property); observe(r.target);
                    return r.source.resource().equals(n) && r.property.resource().equals(p)
                        && Objects.equals(r.target.resource(), resource) && Objects.equals(r.target.literal(), literal);
                })) result.add(candidate);
            }
            selection.selectAll(result);
        }
        return result;
    }
    private void mappedAnnotation(IRI n, IRI p, IRI resource, OWLLiteral literal,
        Map<IRI, Collection<OWLAnnotation>> candidates, Set<OWLAnnotation> destination) {
        List<IRI> selected = selected(n, p, resource, literal);
        OWLAnnotationValue value = literal != null ? literal : isAnonymousNode(resource) ? getOWLAnonymousIndividual(resource.toString()) : resource;
        OWLAnnotationProperty property = getDataFactory().getOWLAnnotationProperty(p);
        if (selected.isEmpty()) {
            OWLAnnotation annotation = getDataFactory().getOWLAnnotation(property, value);
            destination.add(annotation); addUse(batch(destination), annotation, List.of()); return;
        }
        for (IRI node : selected) {
            Collection<OWLAnnotation> children = candidates.get(node);
            if (!(children instanceof Set<?>)) throw invalid("Selected annotation candidate has no completed batch");
            @SuppressWarnings("unchecked") Set<OWLAnnotation> childSet = (Set<OWLAnnotation>) children;
            Batch childBatch = batches.get(childSet);
            if (childBatch == null) throw invalid("Selected annotation batch has no identity");
            provenance.annotationValueUsed(children);
            Reification r = reifications.get(node); observe(r.type);
            OWLAnnotation annotation = getDataFactory().getOWLAnnotation(property, value, children);
            destination.add(annotation); addUse(batch(destination), annotation, List.of(r));
            for (Set<Reification> uses : childBatch.uses.values()) addUse(batch(destination), annotation, uses);
        }
    }
    @Override protected void mapAnnotation(IRI n, Map<IRI, Collection<OWLAnnotation>> candidates,
        Set<OWLAnnotation> destination, IRI p) {
        IRI resource = getResourceObject(n, p, true);
        while (resource != null) {
            tick(); mappedAnnotation(n, p, resource, null, candidates, destination);
            consumeTriple(n, p, resource); resource = getResourceObject(n, p, true);
        }
        OWLLiteral literal = getLiteralObject(n, p, true);
        while (literal != null) {
            tick(); mappedAnnotation(n, p, null, literal, candidates, destination);
            consumeTriple(n, p, literal); literal = getLiteralObject(n, p, true);
        }
    }
    @Override protected void addPendingAnnotations(Set<OWLAnnotation> values) {
        if (!values.isEmpty()) {
            Batch b = batches.get(values);
            if (b == null || !b.uses.keySet().equals(values)) throw invalid("Pending annotation batch has no exact identity");
            for (var e : b.uses.entrySet()) addUse(pendingBatch, e.getKey(), e.getValue());
            Issued previous = issuedSets.get(values); if (previous != null) previous.active = false;
        }
        super.addPendingAnnotations(values);
    }
    @Override public Set<OWLAnnotation> getPendingAnnotations() {
        Set<OWLAnnotation> values = super.getPendingAnnotations();
        if (!pendingBatch.uses.keySet().equals(values)) throw invalid("Pending annotation value/receipt mismatch");
        if (frame != null && frame.last != null) frame.last.active = false;
        if (values.isEmpty()) { if (frame != null) frame.last = null; return values; }
        if (frame == null) throw invalid("Annotation batch issued outside a dispatch");
        Batch b = pendingBatch; pendingBatch = new Batch(); batches.put(values, b); reference();
        Issued issued = new Issued(values, b); issuedSets.put(values, issued); reference(); frame.last = issued;
        return values;
    }
    private void preflight(Collection<Reification> uses) {
        for (Reification r : uses) {
            tick(); if (committed.contains(r.node)) continue;
            for (var f : List.of(r.source, r.property, r.target)) {
                boolean present = f.resource() != null ? isTriplePresent(f.subject(), f.predicate(), f.resource(), false)
                    : isTriplePresent(f.subject(), f.predicate(), f.literal(), false);
                if (!present) throw invalid("Selected annotation reification is no longer exact");
            }
        }
    }
    private void commit(Collection<Reification> uses) {
        preflight(uses);
        for (Reification r : uses) {
            tick(); if (!committed.add(r.node)) continue;
            for (var f : List.of(r.type, r.source, r.property, r.target)) {
                if (f.resource() != null) consumeTriple(f.subject(), f.predicate(), f.resource());
                else consumeTriple(f.subject(), f.predicate(), f.literal());
            }
        }
    }
    @Override protected void addAxiom(OWLAxiom axiom) {
        Issued issued = frame == null ? null : frame.last;
        Set<Reification> uses = new LinkedHashSet<>();
        if (issued != null && issued.active) {
            if (!issued.values.equals(axiom.getAnnotations())) throw invalid("Issued annotations were not used by this axiom");
            for (var value : issued.batch.uses.values()) { for (Reification r : value) { tick(); uses.add(r); } }
            preflight(uses);
        }
        super.addAxiom(axiom);
        if (issued != null && issued.active && (!axiom.isAnnotationAxiom() || getConfiguration().isLoadAnnotationAxioms())) {
            commit(uses); issued.active = false;
        }
    }
    @Override protected void addOntologyAnnotation(OWLAnnotation annotation) {
        Issued issued = frame == null ? null : frame.last;
        Set<Reification> uses = Set.of();
        if (issued != null && issued.active) {
            uses = issued.batch.uses.get(annotation);
            if (uses == null || !issued.values.contains(annotation)) throw invalid("Issued ontology annotation was not selected");
            preflight(uses);
        }
        super.addOntologyAnnotation(annotation);
        if (issued != null && issued.active) {
            if (!semanticOntology.getAnnotations().contains(annotation)) throw invalid("Ontology annotation was not attached");
            commit(uses); issued.attached.add(annotation);
            if (issued.attached.equals(issued.values)) issued.active = false;
        }
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
