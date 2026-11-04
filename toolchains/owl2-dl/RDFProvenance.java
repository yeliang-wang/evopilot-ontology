package org.semanticweb.owlapi.rdf.rdfxml.parser;

import java.util.*;
import org.semanticweb.owlapi.model.*;

/**
 * Bounded provenance for the actual pinned RDF-to-OWL mapping execution.
 * Sources include positive typing and parser-decision context; they are not a
 * minimal semantic justification or an independently parseable RDF fragment.
 * Original source spans are owned by the syntax adapter, keyed by occurrence ID.
 */
public final class RDFProvenance {
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
        final Set<Node> dependencies = new LinkedHashSet<>();
        final Set<Integer> occurrences = new LinkedHashSet<>();
        boolean closed, sourced;
        Node(int id) { this.id = id; }
    }
    private record CacheKey(String kind, IRI node) {}
    private record Cached(Object value, Node provenance) {}
    private record RelationKey(String kind, IRI subject, IRI object) {}

    public final class Scope implements AutoCloseable {
        private final Node node;
        private final Scope parent;
        private FactKey trigger;
        private boolean translation;
        private boolean closed;
        private Scope(Node node, Scope parent) { this.node = node; this.parent = parent; }
        @Override public void close() {
            if (closed) throw new MappingException("RDF provenance scope closed twice");
            closed = true;
            if (!enabled()) return;
            if (current != this) throw new MappingException("RDF provenance scopes closed out of order");
            node.closed = true;
            for (Node dependency : node.dependencies) node.sourced |= dependency.sourced;
            current = parent; budget.scopes--;
            if (parent != null) edge(parent.node, node);
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
    private final Set<Integer> seenOccurrences = new HashSet<>();
    private Scope current;
    private Integer occurrence;
    private FactKey inputFact;
    private boolean inputUsed, finished;
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
        if (from == to) throw new MappingException("RDF provenance contains a self dependency");
        if (from.dependencies.add(to)) budget.limit(++budget.edges, Budget.MAX_EDGES, "edge");
        from.sourced |= to.sourced;
    }
    private void use(Node value) {
        if (current == null) throw new MappingException("RDF dependency read outside a mapping scope");
        edge(current.node, value);
    }
    private Scope open() {
        if (!enabled()) return new Scope(null, null);
        mutable(); budget.limit(++budget.scopes, Budget.MAX_SCOPES, "scope depth");
        Scope value = new Scope(node(), current); current = value; return value;
    }
    /** Snapshot only dependencies already observed, never a mutable ancestor frame. */
    private Node snapshot() {
        if (current == null) throw new MappingException("RDF state has no construction scope");
        Node result = node();
        Scope source = current;
        while (source.node.dependencies.isEmpty() && source.parent != null) source = source.parent;
        for (Node dependency : source.node.dependencies) edge(result, dependency);
        result.closed = true;
        return result;
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
        Scope scope = open(); scope.trigger = canonical; use(value); return scope;
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
        return scope;
    }
    public Scope translation(String kind, IRI subject) {
        Objects.requireNonNull(kind); Objects.requireNonNull(subject);
        Scope scope = open(); scope.translation = true; return scope;
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
        add(states.computeIfAbsent(state, k -> new HashMap<>())
            .computeIfAbsent(iri, k -> new LinkedHashSet<>()), snapshot());
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
                use(fact(dispatch.trigger)); return true;
            }
        }
        Set<Node> reasons = states.getOrDefault(state, Collections.emptyMap()).get(iri);
        if (reasons == null || reasons.isEmpty()) throw new MappingException("RDF classification has no provenance");
        for (Node reason : reasons) use(reason);
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
            for (Node reason : reasons) use(reason);
        }
    }
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
        if (current != null || occurrence != null || pendingAnnotations.size() > 0) {
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
        private final Map<OWLAxiom, Set<Integer>> resolved = new HashMap<>();
        private Index(Map<OWLAxiom, Set<Node>> retained) { this.retained = retained; }
        public int factCount() { return facts.size(); }
        public int occurrenceCount() { return occurrenceFacts.size(); }
        public Set<OWLAxiom> axioms() { return retained.keySet(); }
        public Set<Integer> occurrences(OWLAxiom axiom) {
            budget.check();
            Set<Integer> cached = resolved.get(axiom); if (cached != null) return cached;
            Set<Node> roots = retained.get(axiom);
            if (roots == null) throw new MappingException("Axiom is outside the final RDF provenance index");
            TreeSet<Integer> result = new TreeSet<>();
            Set<Node> visited = Collections.newSetFromMap(new IdentityHashMap<>());
            ArrayDeque<Node> pending = new ArrayDeque<>(roots);
            while (!pending.isEmpty()) {
                Node value = pending.removeLast();
                if (!visited.add(value)) continue;
                budget.limit(++budget.resolution, Budget.MAX_RESOLUTION, "resolution");
                if (!value.closed) throw new MappingException("Unsealed RDF source dependency");
                for (int id : value.occurrences) if (result.add(id)) {
                    budget.limit(++budget.resolution, Budget.MAX_RESOLUTION, "resolution");
                }
                pending.addAll(value.dependencies);
            }
            if (result.isEmpty()) throw new MappingException("OWL axiom has no original RDF occurrence");
            Set<Integer> answer = Collections.unmodifiableSet(result); resolved.put(axiom, answer); return answer;
        }
    }
}
