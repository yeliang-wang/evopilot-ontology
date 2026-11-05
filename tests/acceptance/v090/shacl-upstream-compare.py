"""Independent acceptance comparator: complete official SHACL result graphs.

Normalization follows the same frozen W3C report rules as the prerequisite
standards evaluation. No product implementation or generated oracle is loaded.
"""
import json, sys
import rdflib
from rdflib import Graph, Literal, BNode, URIRef, RDF, RDFS, XSD, Namespace
from rdflib.compare import isomorphic
rdflib.NORMALIZE_LITERALS = False
SH = Namespace('http://www.w3.org/ns/shacl#')
MF = Namespace('http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#')
PATHS = {RDF.first, RDF.rest, SH.inversePath, SH.alternativePath, SH.zeroOrMorePath, SH.oneOrMorePath, SH.zeroOrOnePath}
PROPS = {SH.focusNode, SH.resultPath, SH.resultSeverity, SH.sourceConstraint, SH.sourceConstraintComponent, SH.sourceShape, SH.value}

def term(x):
    if isinstance(x, Literal):
        if x.language: return Literal(str(x), lang=x.language.lower(), normalize=False)
        if x.datatype is None: return Literal(str(x), datatype=XSD.string, normalize=False)
    return x

def normalize(g, root, messages):
    result = Graph(); rows = list(g.objects(root, SH.result)); assert len(rows) == len(set(rows))
    remap = {x: BNode() for x in [root, *rows]}
    def named(x): return remap.get(x, term(x))
    def path(x, ancestors=frozenset()):
        if not isinstance(x, BNode): return named(x)
        assert x not in ancestors and len(ancestors) < 64
        n = BNode(); triples = [(p, o) for p, o in g.predicate_objects(x) if p in PATHS]; assert triples
        for p, o in triples: result.add((n, p, path(o, ancestors | {x})))
        return n
    def typed(node, kind):
        types = set(g.objects(node, RDF.type))
        assert any(t == kind or kind in set(g.transitive_objects(t, RDFS.subClassOf)) for t in types)
        result.add((named(node), RDF.type, kind))
    typed(root, SH.ValidationReport)
    for value in g.objects(root, SH.conforms): result.add((named(root), SH.conforms, term(value)))
    for row in rows:
        result.add((named(root), SH.result, named(row))); typed(row, SH.ValidationResult)
        for p, o in g.predicate_objects(row):
            if p in PROPS or p == SH.resultMessage and term(o) in messages:
                result.add((named(row), p, path(o) if p == SH.resultPath else named(o)))
    return result

def compare(value):
    original, response = value['original'], value['formal']
    manifest = Graph().parse(data=value['manifest'], publicID=original['manifest']['url'], format='turtle')
    expected = manifest.value(URIRef(original['id']), MF.result); assert expected is not None
    if original['expectedFailure']:
        assert response['status'] == 'VALIDATION_FAILURE' and response['complete'] is False
        assert response['error']['code'] == 'SHACL_VALIDATION_FAILURE'
        return {'booleanStatus': 'PASS', 'reportStatus': 'PASS', 'expectedValidationFailure': True}
    assert response['status'] in ['CONFORMS', 'NONCONFORMING'] and response['complete'] is True and response['error'] is None
    conforms = manifest.value(expected, SH.conforms); assert isinstance(conforms, Literal) and conforms.datatype == XSD.boolean
    assert (response['status'] == 'CONFORMS') == bool(conforms.toPython())
    graph = Graph().parse(data=response['result']['reportTurtle'], format='turtle')
    heads = list(graph.subjects(RDF.type, SH.ValidationReport)); assert len(heads) == 1
    assert list(graph.objects(heads[0], SH.conforms)) == [Literal(response['status'] == 'CONFORMS')]
    messages = {term(v) for row in manifest.objects(expected, SH.result) for v in manifest.objects(row, SH.resultMessage)}
    eg, ag = normalize(manifest, expected, messages), normalize(graph, heads[0], messages)
    assert isomorphic(eg, ag), 'Complete validation report differs from the independent upstream oracle'
    return {'booleanStatus': 'PASS', 'reportStatus': 'PASS', 'expectedTriples': len(eg), 'actualTriples': len(ag)}

if __name__ == '__main__':
    assert rdflib.__version__ == '7.6.0'
    print(json.dumps(compare(json.load(sys.stdin))))
