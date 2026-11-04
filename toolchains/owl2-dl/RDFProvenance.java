package org.semanticweb.owlapi.rdf.rdfxml.parser;

import java.util.*;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import org.semanticweb.owlapi.model.*;

/**
 * Bounded provenance for the actual pinned RDF-to-OWL mapping execution.
 * Sources include positive typing and parser-decision context; they are not a
 * minimal semantic justification or an independently parseable RDF fragment.
 * Original source spans are owned by the syntax adapter, keyed by occurrence ID.
 */
public final class RDFProvenance {
    private static final int PRESERVE = 1;
    private static final int AS_CONTEXT = 2;

    /** Roles describe actual mapper usage, not logical justification membership. */
    public record Sources(Set<Integer> constructionOccurrenceIds,
                          Set<Integer> parserContextOccurrenceIds) {
        public Sources {
            constructionOccurrenceIds = Collections.unmodifiableSet(new TreeSet<>(constructionOccurrenceIds));
            parserContextOccurrenceIds = Collections.unmodifiableSet(new TreeSet<>(parserContextOccurrenceIds));
        }
    }
    public static final class MappingException extends RuntimeException {
        public MappingException(String message) { super(message); }
    }
    public static final class LimitException extends RuntimeException {
        public LimitException(String message) { super(message); }
    }
    public static final class TimeoutException extends RuntimeException {
        public TimeoutException(String message) { super(message); }
    }

    /** One budget must be shared by all documents in the same located request. */
    public static final class Budget {
        public static final int MAX_OCCURRENCES = 200_000;
        public static final int MAX_FACTS = 200_000;
        public static final int MAX_NODES = 500_000;
        public static final int MAX_EDGES = 2_000_000;
        public static final int MAX_AXIOMS = 100_000;
        public static final int MAX_SCOPES = 512;
        public static final int MAX_RESOLUTION = 2_000_000;
        private final long deadline;
        private int occurrences, facts, nodes, edges, axioms, scopes, resolution, ticks;
        public Budget(long deadlineNanos) { deadline = deadlineNanos; }
        public void check() {
            if (System.nanoTime() - deadline >= 0) {
                throw new TimeoutException("RDF provenance exceeded the request deadline");
            }
        }
        private void tick() { if ((++ticks & 255) == 0) check(); }
        private void limit(int value, int maximum, String kind) {
            tick();
            if (value > maximum) throw new LimitException("RDF provenance " + kind + " budget exceeded");
        }
    }

    public record FactKey(IRI subject, IRI predicate, IRI resource, OWLLiteral literal) {
        public FactKey {
            Objects.requireNonNull(subject); Objects.requireNonNull(predicate);
            if ((resource == null) == (literal == null)) {
                throw new MappingException("A fact must have exactly one object kind");
            }
        }
        public static FactKey resource(IRI s, IRI p, IRI o) { return new FactKey(s, p, o, null); }
        public static FactKey literal(IRI s, IRI p, OWLLiteral o) { return new FactKey(s, p, null, o); }
    }

    private static final class Node {
        final int id;
        final Map<Node, Integer> dependencies = new LinkedHashMap<>();
        final Set<Integer> occurrences = new LinkedHashSet<>();
        boolean closed, sourced;
        Node(int id) { this.id = id; }
    }
    private record CacheKey(String kind, IRI node) {}
    private record Cached(Object value, Node provenance) {}
    private record RelationKey(String kind, IRI subject, IRI object) {}
    private record Visit(Node node, boolean context) {}

    public final class Scope implements AutoCloseable {
        private final Node node;
        private final Scope parent;
        private FactKey trigger;
        private Node triggerSource;
        private boolean translation;
        private boolean selectionProbe;
        private int attachmentMode = PRESERVE;
        private boolean closed;
        private Scope(Node node, Scope parent) { this.node = node; this.parent = parent; }
        @Override public void close() {
            if (closed) throw new MappingException("RDF provenance scope closed twice");
            closed = true;
            if (!enabled()) return;
            if (current != this) throw new MappingException("RDF provenance scopes closed out of order");
            node.closed = true;
            for (Node dependency : node.dependencies.keySet()) node.sourced |= dependency.sourced;
            current = parent; budget.scopes--;
            if (parent != null) edge(parent.node, node, attachmentMode);
        }
    }

    private final Budget budget;
    private final Map<FactKey, Node> facts = new LinkedHashMap<>();
    private final Map<Integer, FactKey> occurrenceFacts = new LinkedHashMap<>();
    private final Map<OWLAxiom, Set<Node>> axioms = new LinkedHashMap<>();
    private final Map<CacheKey, Cached> caches = new HashMap<>();
    private final IdentityHashMap<Set<IRI>, Map<IRI, Set<Node>>> states = new IdentityHashMap<>();
    private final Map<FactKey, IdentityHashMap<Set<IRI>, Set<IRI>>> inputClassifications = new HashMap<>();
    private final Map<RelationKey, Set<Node>> relations = new HashMap<>();
    private final Map<IRI, Node> omittedRestTerminals = new HashMap<>();
    private final Set<IRI> consumedRestLinks = new HashSet<>();
    private final Map<OWLAnnotation, Set<Node>> pendingAnnotations = new HashMap<>();
    private final IdentityHashMap<Collection<OWLAnnotation>, Node> annotationValues = new IdentityHashMap<>();
    private final Set<Integer> seenOccurrences = new HashSet<>();
    private Scope current;
    private Integer occurrence;
    private FactKey inputFact;
    private boolean inputUsed, finished;
    private int unfinishedSelections;
    private int nextNode;
    private Node builtinContext;

    public RDFProvenance(Budget sharedBudget) { budget = Objects.requireNonNull(sharedBudget); }
    private RDFProvenance() { budget = null; }
    public static RDFProvenance disabled() { return new RDFProvenance(); }
    public boolean enabled() { return budget != null; }
    public boolean started() { return !occurrenceFacts.isEmpty(); }

    private void mutable() {
        if (finished) throw new MappingException("RDF provenance is already sealed");
        budget.tick();
    }
    private Node node() {
        budget.limit(++budget.nodes, Budget.MAX_NODES, "node");
        return new Node(nextNode++);
    }
    private void edge(Node from, Node to) {
        edge(from, to, PRESERVE);
    }
    private void edge(Node from, Node to, int mode) {
        if (from == to) throw new MappingException("RDF provenance contains a self dependency");
        int previous = from.dependencies.getOrDefault(to, 0);
        int added = mode & ~previous;
        if (added != 0) {
            budget.edges += Integer.bitCount(added);
            budget.limit(budget.edges, Budget.MAX_EDGES, "role edge");
            from.dependencies.put(to, previous | mode);
        }
        from.sourced |= to.sourced;
    }
    private void use(Node value) {
        use(value, PRESERVE);
    }
    private void use(Node value, int mode) {
        if (current == null) throw new MappingException("RDF dependency read outside a mapping scope");
        edge(current.node, value, mode);
    }
    private Scope open() {
        if (!enabled()) return new Scope(null, null);
        mutable(); budget.limit(++budget.scopes, Budget.MAX_SCOPES, "scope depth");
        Scope value = new Scope(node(), current); current = value; return value;
    }
    /** Snapshot local, already observed role edges; never climb to a caller. */
    private Node snapshot() {
        if (current == null) throw new MappingException("RDF state has no construction scope");
        Node result = node();
        for (Map.Entry<Node, Integer> dependency : current.node.dependencies.entrySet()) {
            edge(result, dependency.getKey(), dependency.getValue());
        }
        result.closed = true;
        return result;
    }
    /** A context boundary changes this use, never the intrinsic cached value. */
    public Scope context() {
        Scope scope = open(); scope.attachmentMode = AS_CONTEXT; return scope;
    }
    public boolean probe(FactKey trigger, BooleanSupplier action) {
        if (!enabled()) return action.getAsBoolean();
        Node source = facts.get(trigger);
        if (source == null) {
            Scope caller = current;
            while (caller != null && !trigger.equals(caller.trigger)) caller = caller.parent;
            if (caller == null || caller.triggerSource == null) {
                throw new MappingException("RDF selection probe has no bound trigger");
            }
            source = caller.triggerSource;
        }
        try (Scope scope = context()) {
            scope.selectionProbe = true;
            use(source);
            return action.getAsBoolean();
        }
    }
    private void add(Set<Node> target, Node source) {
        if (target.add(source)) budget.limit(++budget.edges, Budget.MAX_EDGES, "reference");
    }
    private Node fact(FactKey key) {
        Node value = facts.get(key);
        if (value == null) throw new MappingException("Selected RDF fact has no input occurrence");
        return value;
    }

    public void beforeTriple(int occurrenceId) {
        if (!enabled()) return;
        mutable(); budget.check();
        if (occurrenceId <= 0 || occurrence != null || current != null || !seenOccurrences.add(occurrenceId)) {
            throw new MappingException("Invalid or overlapping RDF input occurrence");
        }
        budget.limit(++budget.occurrences, Budget.MAX_OCCURRENCES, "occurrence");
        occurrence = occurrenceId; inputUsed = false;
    }
    public void afterTriple() {
        if (!enabled()) return;
        mutable();
        if (occurrence == null || current != null || !inputUsed) {
            throw new MappingException("RDF input occurrence was not mapped exactly once");
        }
        occurrence = null; inputFact = null;
    }
    public Scope input(FactKey canonical) {
        if (!enabled()) return open();
        mutable();
        if (occurrence == null || inputUsed || current != null) {
            throw new MappingException("RDF statement is not bound to its syntax event");
        }
        inputUsed = true; inputFact = canonical;
        Node value = facts.get(canonical);
        if (value == null) {
            budget.limit(++budget.facts, Budget.MAX_FACTS, "fact");
            value = node(); facts.put(canonical, value);
        }
        value.occurrences.add(occurrence); value.sourced = true;
        occurrenceFacts.put(occurrence, canonical);
        Scope scope = open(); scope.trigger = canonical; scope.triggerSource = value; use(value); return scope;
    }
    public Scope dispatch(String phase, FactKey trigger) {
        if (!enabled()) return open();
        Node value = facts.get(trigger);
        // Reification re-entry also depends on the outer source/property/target
        // construction even when the separately asserted base fact exists.
        Node derived = phase.equals("handle") && current != null ? snapshot() : null;
        if (value == null) {
            // TypeAxiomHandler reconstructs its base triple from source/property/target.
            // Only this nested re-entry may lack a separately asserted base triple.
            if (derived == null) {
                throw new MappingException("RDF dispatch has no input fact");
            }
            if (!derived.sourced) throw new MappingException("Reified RDF dispatch has no source");
        }
        Scope scope = open();
        scope.trigger = trigger;
        if (value != null) use(value);
        if (derived != null) use(derived);
        scope.triggerSource = derived == null ? value : value == null ? derived : snapshot();
        return scope;
    }
    public Scope translation(String kind, IRI subject) {
        Objects.requireNonNull(kind); Objects.requireNonNull(subject);
        // A selector can construct/cache a value as a side effect. Preserve the
        // observations which actually led to that construction, as context of
        // this cached value. Copy only observations already made, never an open
        // parent node (which could later contain this translation itself).
        // Stop at an enclosing translation: a nested shared value must not
        // inherit an outer expression's caller/definition merely by nesting.
        Node decision = null;
        if (enabled()) {
            List<Scope> path = new ArrayList<>();
            Scope cursor = current;
            while (cursor != null && !cursor.translation) {
                path.add(cursor);
                if (cursor.selectionProbe) {
                    decision = node();
                    for (Scope observed : path) {
                        for (Map.Entry<Node, Integer> dependency : observed.node.dependencies.entrySet()) {
                            edge(decision, dependency.getKey(), dependency.getValue());
                        }
                    }
                    decision.closed = true;
                    break;
                }
                cursor = cursor.parent;
            }
        }
        Scope scope = open(); scope.translation = true;
        if (decision != null) use(decision, AS_CONTEXT);
        return scope;
    }
    public void readResource(IRI s, IRI p, IRI o) {
        if (enabled() && o != null) { mutable(); use(fact(FactKey.resource(s, p, o))); }
    }
    public void readLiteral(IRI s, IRI p, OWLLiteral o) {
        if (enabled() && o != null) { mutable(); use(fact(FactKey.literal(s, p, o))); }
    }
    /** Explicit references to facts consumed earlier remain source references. */
    public void consumedResource(IRI s, IRI p, IRI o) {
        if (!enabled()) return;
        mutable(); Node prior = facts.get(FactKey.resource(s, p, o));
        if (prior != null) use(prior);
    }
    public void consumedLiteral(IRI s, IRI p, OWLLiteral o) {
        if (!enabled()) return;
        mutable(); Node prior = facts.get(FactKey.literal(s, p, o));
        if (prior != null) use(prior);
    }
    /** The upstream rest handler omits rdf:nil from its mutable rest map. */
    public void restObserved(IRI subject, IRI object) {
        if (!enabled()) return;
        mutable();
        IRI nil = org.semanticweb.owlapi.vocab.OWLRDFVocabulary.RDF_NIL.getIRI();
        if (object.equals(nil)) {
            Node terminal = fact(FactKey.resource(subject,
                org.semanticweb.owlapi.vocab.OWLRDFVocabulary.RDF_REST.getIRI(), object));
            if (omittedRestTerminals.put(subject, terminal) != terminal) {
                budget.limit(++budget.edges, Budget.MAX_EDGES, "list terminal");
            }
        } else {
            // addRest will install this new live link. A previous read of an
            // older link cannot describe the new slot's consumption state.
            consumedRestLinks.remove(subject);
        }
    }
    public void restRead(IRI subject, IRI selected, boolean consume) {
        if (!enabled()) return;
        mutable();
        IRI rest = org.semanticweb.owlapi.vocab.OWLRDFVocabulary.RDF_REST.getIRI();
        if (selected != null) {
            readResource(subject, rest, selected);
            if (consume && consumedRestLinks.add(subject)) {
                budget.limit(++budget.edges, Budget.MAX_EDGES, "consumed list link");
            }
            return;
        }
        // The empty list is itself the built-in terminator and has no invented
        // (rdf:nil rdf:rest rdf:nil) occurrence. Its caller already carries the
        // actual intersection/union/list reference to rdf:nil.
        if (subject.equals(org.semanticweb.owlapi.vocab.OWLRDFVocabulary.RDF_NIL.getIRI())) return;
        if (consumedRestLinks.contains(subject)) {
            throw new MappingException("Consumed RDF list link has no cached traversal provenance");
        }
        Node terminal = omittedRestTerminals.get(subject);
        if (terminal == null) throw new MappingException("RDF list termination has no observed source fact");
        use(terminal);
    }

    /** Initial built-in vocabulary only; the adapter requires a fresh ontology. */
    public void seedState(Set<IRI> state) {
        if (!enabled()) return;
        mutable();
        if (started() || current != null) throw new MappingException("Late RDF context seeding");
        if (builtinContext == null) { builtinContext = node(); builtinContext.closed = true; }
        Map<IRI, Set<Node>> values = states.computeIfAbsent(state, k -> new HashMap<>());
        for (IRI iri : state) add(values.computeIfAbsent(iri, k -> new LinkedHashSet<>()), builtinContext);
    }
    public void stateAdd(Set<IRI> state, IRI iri) {
        // Repeated inferred typing is not a new change to the parser's state.
        // Duplicate textual facts are retained on the original fact leaf instead.
        boolean changed = state.add(iri);
        if (!enabled()) return;
        mutable();
        if (inputFact != null) {
            // A root can witness its own classification during streaming even
            // when the global set already contained the node. Retain that local
            // observation for later mop-up; do not append it to global causes.
            Set<IRI> observed = inputClassifications
                .computeIfAbsent(inputFact, k -> new IdentityHashMap<>())
                .computeIfAbsent(state, k -> new HashSet<>());
            if (observed.add(iri)) budget.limit(++budget.edges, Budget.MAX_EDGES, "classification witness");
        }
        if (!changed) return;
        if (current == null) {
            if (started()) throw new MappingException("RDF classification changed outside mapping");
            return; // Constructor seedState records the initial vocabulary explicitly.
        }
        Node cause = snapshot();
        if (!cause.sourced) throw new MappingException("RDF classification has no local source witness");
        add(states.computeIfAbsent(state, k -> new HashMap<>())
            .computeIfAbsent(iri, k -> new LinkedHashSet<>()), cause);
    }
    public boolean stateContains(Set<IRI> state, IRI iri) {
        boolean result = state.contains(iri);
        if (!enabled() || current == null || !result) return result;
        mutable();
        // Translation caches must never inherit the caller's root through this
        // optimization. Only a dispatch frame can reuse its own recorded witness.
        Scope dispatch = current;
        while (dispatch != null && dispatch.trigger == null && !dispatch.translation) dispatch = dispatch.parent;
        if (dispatch != null && !dispatch.translation && dispatch.trigger != null) {
            Map<Set<IRI>, Set<IRI>> local = inputClassifications.get(dispatch.trigger);
            if (local != null && local.getOrDefault(state, Collections.emptySet()).contains(iri)) {
                use(fact(dispatch.trigger), AS_CONTEXT); return true;
            }
        }
        Set<Node> reasons = states.getOrDefault(state, Collections.emptyMap()).get(iri);
        if (reasons == null || reasons.isEmpty()) throw new MappingException("RDF classification has no provenance");
        for (Node reason : reasons) use(reason, AS_CONTEXT);
        return result;
    }
    public void relationAdded(String kind, IRI subject, IRI object) {
        if (!enabled()) return;
        mutable();
        add(relations.computeIfAbsent(new RelationKey(kind, subject, object), k -> new LinkedHashSet<>()), snapshot());
    }
    public void relationUsed(String kind, IRI subject, Collection<IRI> objects) {
        if (!enabled()) return;
        mutable();
        for (IRI object : objects) {
            Set<Node> reasons = relations.get(new RelationKey(kind, subject, object));
            if (reasons == null) throw new MappingException("RDF annotation relation has no provenance");
            // This API enumerates candidates. The selected annotation relation
            // is separately retained as construction by AnnotationSelection.
            for (Node reason : reasons) use(reason, AS_CONTEXT);
        }
    }
    /** Candidate annotation values retain their intrinsic roles behind a context edge. */
    public Set<OWLAnnotation> annotationCandidate(Supplier<Set<OWLAnnotation>> action) {
        if (!enabled()) return action.get();
        try (Scope candidate = context()) {
            Set<OWLAnnotation> value = action.get();
            if (!value.isEmpty()) {
                if (annotationValues.put(value, candidate.node) != null) {
                    throw new MappingException("An annotation value has ambiguous candidate provenance");
                }
                budget.limit(++budget.edges, Budget.MAX_EDGES, "annotation value reference");
            }
            return value;
        }
    }
    public void annotationValueUsed(Collection<OWLAnnotation> value) {
        if (!enabled() || value.isEmpty()) return;
        mutable(); Node source = annotationValues.get(value);
        if (source == null || !source.closed) throw new MappingException("Selected annotation value has no completed provenance");
        use(source);
    }
    public final class AnnotationSelection implements AutoCloseable {
        private final IRI source;
        private final Scope scope;
        private final Map<IRI, Node> matching = new HashMap<>();
        private boolean selected;
        private AnnotationSelection(IRI source) {
            this.source = source; scope = context();
            if (enabled()) unfinishedSelections++;
        }
        public boolean test(IRI candidate, BooleanSupplier action) {
            if (!enabled()) return action.getAsBoolean();
            if (selected || current != scope) throw new MappingException("Invalid annotation selection lifecycle");
            try (Scope observation = open()) {
                boolean matches = action.getAsBoolean();
                if (matches) {
                    if (matching.put(candidate, observation.node) != null) {
                        throw new MappingException("Duplicate annotation candidate");
                    }
                    budget.limit(++budget.edges, Budget.MAX_EDGES, "annotation candidate reference");
                }
                return matches;
            }
        }
        public void select(IRI candidate) {
            if (!enabled()) return;
            if (selected || current != scope) throw new MappingException("Annotation selection already completed");
            selected = true; unfinishedSelections--;
            if (candidate == null) return;
            Node chosen = matching.get(candidate);
            Set<Node> links = relations.get(new RelationKey("ANNOTATED_SOURCE", source, candidate));
            if (chosen == null || !chosen.closed || links == null || scope.parent == null) {
                throw new MappingException("Selected annotation relation has no actual matching observation");
            }
            edge(scope.parent.node, chosen, PRESERVE);
            for (Node link : links) edge(scope.parent.node, link, PRESERVE);
        }
        @Override public void close() { scope.close(); }
    }
    public AnnotationSelection annotationSelection(IRI source) { return new AnnotationSelection(source); }
    public void pendingAdded(Set<OWLAnnotation> annotations) {
        if (!enabled() || annotations.isEmpty()) return;
        mutable(); Node reason = snapshot();
        for (OWLAnnotation annotation : annotations) {
            add(pendingAnnotations.computeIfAbsent(annotation, k -> new LinkedHashSet<>()), reason);
        }
    }
    public void pendingTaken(Set<OWLAnnotation> annotations) {
        if (!enabled() || annotations.isEmpty()) return;
        mutable();
        for (OWLAnnotation annotation : annotations) {
            Set<Node> reasons = pendingAnnotations.remove(annotation);
            if (reasons == null) throw new MappingException("Pending annotation has no provenance");
            for (Node reason : reasons) use(reason);
        }
    }
    public void cachePut(String kind, IRI key, Object actualValue) {
        if (!enabled()) return;
        mutable();
        if (current == null || actualValue == null) throw new MappingException("Invalid RDF cache provenance");
        caches.put(new CacheKey(kind, key), new Cached(actualValue, current.node));
    }
    public void cacheUse(String kind, IRI key, Object actualValue) {
        if (!enabled() || actualValue == null) return;
        mutable(); Cached saved = caches.get(new CacheKey(kind, key));
        if (saved == null || saved.value != actualValue || !saved.provenance.closed) {
            throw new MappingException("RDF cache hit has no completed matching provenance");
        }
        use(saved.provenance);
    }
    public void emit(OWLAxiom axiom) {
        if (!enabled()) return;
        mutable();
        if (current == null) throw new MappingException("OWL axiom emitted outside RDF mapping");
        Set<Node> sources = axioms.get(axiom);
        if (sources == null) {
            budget.limit(++budget.axioms, Budget.MAX_AXIOMS, "axiom");
            sources = new LinkedHashSet<>(); axioms.put(axiom, sources);
        }
        // Keep the deferred construction, including reads/consumption after addAxiom.
        add(sources, current.node);
    }
    public void removed(OWLAxiom axiom) {
        if (!enabled()) return;
        mutable(); // Retain history; finish projects only actual final ontology members.
    }
    public void transfer(OWLAxiom before, OWLAxiom after) {
        if (!enabled()) throw new MappingException("Normalization requires enabled RDF provenance");
        mutable();
        Set<Node> origins = axioms.get(before);
        if (origins == null || origins.isEmpty()) throw new MappingException("Normalized axiom has no source");
        if (before.equals(after)) return;
        Set<Node> destination = axioms.get(after);
        if (destination == null) {
            budget.limit(++budget.axioms, Budget.MAX_AXIOMS, "axiom");
            destination = new LinkedHashSet<>(); axioms.put(after, destination);
        }
        for (Node origin : origins) add(destination, origin);
    }
    public Index finish(Set<OWLAxiom> finalAxioms) {
        if (!enabled()) throw new MappingException("Disabled RDF provenance cannot produce an index");
        mutable(); budget.check();
        if (current != null || occurrence != null || pendingAnnotations.size() > 0 || unfinishedSelections != 0) {
            throw new MappingException("RDF mapping has unfinished provenance state");
        }
        Map<OWLAxiom, Set<Node>> retained = new LinkedHashMap<>();
        for (OWLAxiom axiom : finalAxioms) {
            Set<Node> sources = axioms.get(axiom);
            if (sources == null || sources.isEmpty() || sources.stream().anyMatch(n -> !n.closed)
                || sources.stream().noneMatch(n -> n.sourced)) {
                throw new MappingException("Final OWL axiom has no complete RDF construction");
            }
            retained.put(axiom, Collections.unmodifiableSet(new LinkedHashSet<>(sources)));
        }
        for (Node value : facts.values()) value.closed = true;
        finished = true;
        return new Index(Collections.unmodifiableMap(retained));
    }

    public final class Index {
        private final Map<OWLAxiom, Set<Node>> retained;
        private final Map<OWLAxiom, Sources> resolved = new HashMap<>();
        private final Map<OWLAxiom, Set<Integer>> unions = new HashMap<>();
        private Index(Map<OWLAxiom, Set<Node>> retained) { this.retained = retained; }
        public int factCount() { return facts.size(); }
        public int occurrenceCount() { return occurrenceFacts.size(); }
        public Set<OWLAxiom> axioms() { return retained.keySet(); }
        public Set<Integer> occurrences(OWLAxiom axiom) {
            Sources roles = sources(axiom);
            Set<Integer> value = unions.get(axiom);
            if (value == null) {
                TreeSet<Integer> all = new TreeSet<>(roles.constructionOccurrenceIds());
                all.addAll(roles.parserContextOccurrenceIds());
                value = Collections.unmodifiableSet(all); unions.put(axiom, value);
            }
            return value;
        }
        public Sources sources(OWLAxiom axiom) {
            budget.check();
            Sources cached = resolved.get(axiom); if (cached != null) return cached;
            Set<Node> roots = retained.get(axiom);
            if (roots == null) throw new MappingException("Axiom is outside the final RDF provenance index");
            TreeSet<Integer> construction = new TreeSet<>(), context = new TreeSet<>();
            Set<Visit> visited = new HashSet<>();
            ArrayDeque<Visit> pending = new ArrayDeque<>();
            for (Node root : roots) pending.add(new Visit(root, false));
            while (!pending.isEmpty()) {
                Visit visit = pending.removeLast();
                if (!visited.add(visit)) continue;
                Node value = visit.node();
                budget.limit(++budget.resolution, Budget.MAX_RESOLUTION, "resolution");
                if (!value.closed) throw new MappingException("Unsealed RDF source dependency");
                Set<Integer> destination = visit.context() ? context : construction;
                for (int id : value.occurrences) if (destination.add(id)) {
                    budget.limit(++budget.resolution, Budget.MAX_RESOLUTION, "resolution");
                }
                for (Map.Entry<Node, Integer> dependency : value.dependencies.entrySet()) {
                    if ((dependency.getValue() & PRESERVE) != 0) pending.add(new Visit(dependency.getKey(), visit.context()));
                    if ((dependency.getValue() & AS_CONTEXT) != 0) pending.add(new Visit(dependency.getKey(), true));
                }
            }
            if (construction.isEmpty()) throw new MappingException("OWL axiom has no original construction occurrence");
            Sources answer = new Sources(construction, context); resolved.put(axiom, answer); return answer;
        }
    }
}
