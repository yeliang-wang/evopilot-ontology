"""Native v2 SHACL executor: admitted text only; no lifecycle or approval state.

pySHACL supplies constraint semantics and target discovery. This adapter binds
offline graphs and rejects incomplete coverage/unsupported executable features.
It never performs OWL inference or edits the asserted graph.
"""
import hashlib
import importlib.metadata
import json
import socket
import sys
import warnings

from rdflib import BNode, Graph, Literal, Namespace, RDF, URIRef
from rdflib.plugins.sparql.parser import parseQuery
from rdflib.plugins.sparql.parserutils import CompValue
from pyparsing import ParseResults
from pyshacl import validate
from pyshacl.shapes_graph import ShapesGraph

SH = Namespace('http://www.w3.org/ns/shacl#')
OWL = Namespace('http://www.w3.org/2002/07/owl#')
ALLOWED_SH = set('''NodeShape PropertyShape targetNode targetClass targetSubjectsOf
targetObjectsOf property path class datatype nodeKind IRI BlankNode Literal
BlankNodeOrIRI BlankNodeOrLiteral IRIOrLiteral minCount maxCount minExclusive
maxExclusive minInclusive maxInclusive minLength maxLength pattern flags
languageIn uniqueLang equals disjoint lessThan lessThanOrEquals and or not xone
node qualifiedValueShape qualifiedMinCount qualifiedMaxCount qualifiedValueShapesDisjoint
closed ignoredProperties hasValue in name description order group defaultValue
message severity Violation Warning Info deactivated sparql select prefixes declare
prefix namespace inversePath alternativePath zeroOrMorePath oneOrMorePath zeroOrOnePath
SPARQLConstraint PropertyGroup PrefixDeclaration'''.split())


class Rejected(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code = status, code


def reject(status, code, message):
    raise Rejected(status, code, message)


def versions():
    actual = {'python': '.'.join(map(str, sys.version_info[:3])),
              'pyshacl': importlib.metadata.version('pyshacl'),
              'rdflib': importlib.metadata.version('rdflib')}
    if actual != {'python': '3.12.12', 'pyshacl': '0.40.1', 'rdflib': '7.6.0'}:
        reject('FAILED', 'TOOLCHAIN_VERSION', 'Unexpected Python/RDFLib/pySHACL versions')
    return actual


def blocked(*_args, **_kwargs):
    reject('UNSUPPORTED', 'NETWORK_FORBIDDEN', 'Only already admitted local graph text is allowed')


def parse(document, limits):
    content = document['content']
    if 'sha256:' + hashlib.sha256(content.encode('utf-8')).hexdigest() != document['digest']:
        reject('INVALID_INPUT', 'DOCUMENT_DIGEST', 'Document bytes differ from the request identity')
    if document['format'] == 'rdfxml' and ('<!DOCTYPE' in content.upper() or '<!ENTITY' in content.upper()):
        reject('INVALID_INPUT', 'XML_DECLARATION_FORBIDDEN', 'RDF/XML DTD and entity declarations are forbidden')
    try:
        graph = Graph().parse(data=content, publicID=document['documentIri'],
                              format={'turtle': 'turtle', 'rdfxml': 'xml'}[document['format']])
    except Exception as error:
        reject('INVALID_INPUT', 'RDF_PARSE', 'Invalid admitted RDF document: ' + type(error).__name__)
    if len(graph) > limits['triples']:
        reject('FAILED', 'GRAPH_LIMIT', 'Parsed graph exceeds the fixed triple budget')
    ontologies = set(graph.subjects(RDF.type, OWL.Ontology))
    expected = set() if document['ontologyIri'] is None else {URIRef(document['ontologyIri'])}
    if {x for x in ontologies if isinstance(x, URIRef)} != expected or len(ontologies) > 1:
        reject('INVALID_INPUT', 'ONTOLOGY_IDENTITY', 'Declared ontology identity differs from admitted document')
    version_iris = set(graph.objects(None, OWL.versionIRI))
    expected_versions = set() if document['versionIri'] is None else {URIRef(document['versionIri'])}
    if version_iris != expected_versions or any(s not in ontologies for s in graph.subjects(OWL.versionIRI, None)):
        reject('INVALID_INPUT', 'ONTOLOGY_IDENTITY', 'Declared version identity differs from admitted document')
    return graph


def union_documents(documents, limits):
    graph, individual = Graph(), {}
    for document in documents:
        part = parse(document, limits)
        # Rename every blank node per document, including explicit rdf:nodeID.
        # A coincident label in another file must never join anonymous structures.
        remap = {}
        def scoped(term):
            if isinstance(term, BNode):
                return remap.setdefault(term, BNode())
            return term
        scoped_graph = Graph()
        for s, p, o in part:
            scoped_graph.add((scoped(s), p, scoped(o)))
        individual[document['id']] = scoped_graph
        graph += scoped_graph
        if len(graph) > limits['triples']:
            reject('FAILED', 'GRAPH_LIMIT', 'Union graph exceeds the fixed triple budget')
    return graph, individual


def import_guard(closure, parts, shapes):
    for document in closure['documents']:
        part = parts[document['id']]
        actual = set(part.objects(None, OWL.imports))
        expected = {URIRef(e['iri']) for e in closure['imports'] if e['from'] == document['id']}
        if actual != expected:
            reject('MISSING_IMPORT', 'IMPORT_CLOSURE_MISMATCH', 'Every actual import must match its offline locked edge')
        if any((s, RDF.type, OWL.Ontology) not in part for s in part.subjects(OWL.imports, None)):
            reject('INVALID_INPUT', 'IMPORT_SUBJECT', 'Import declarations require an ontology subject')
    if any(shapes.triples((None, OWL.imports, None))):
        reject('MISSING_IMPORT', 'SHAPE_IMPORT_UNBOUND', 'Shape imports have no locked v2 closure; admit complete shape documents')


def walk(value):
    if isinstance(value, CompValue):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, (list, tuple, ParseResults)):
        for child in value:
            yield from walk(child)


def shape_guard(shapes, limits):
    for s, p, o in shapes:
        for term in (p, o if p == RDF.type else None):
            if isinstance(term, URIRef) and str(term).startswith(str(SH)) and str(term)[len(str(SH)):] not in ALLOWED_SH:
                reject('UNSUPPORTED', 'SHACL_VOCABULARY', 'Unsupported executable SHACL term: ' + str(term))
        if p == SH.deactivated and o != Literal(False):
            reject('INCOMPLETE_COVERAGE', 'DEACTIVATED_SHAPE', 'Disabled shapes cannot establish required validation')
    edges = {}
    for s, p, o in shapes:
        if p in (SH.node, SH.property, SH['not'], SH.qualifiedValueShape):
            edges.setdefault(s, set()).add(o)
        if p in (SH['and'], SH['or'], SH.xone):
            try:
                items = list(shapes.items(o))
            except Exception:
                reject('INVALID_INPUT', 'INVALID_LIST', 'Malformed constraint list')
            edges.setdefault(s, set()).update(items)
    heights, active = {}, set()
    def visit(node):
        if node in active:
            reject('UNSUPPORTED', 'RECURSIVE_SHAPE', 'Recursive shapes require undefined SHACL recursion semantics')
        if node in heights:
            return heights[node]
        if len(active) > limits['shapeDepth']:
            reject('FAILED', 'SHAPE_DEPTH_LIMIT', 'Shape dependency depth exceeds the fixed budget')
        active.add(node)
        height = max((1 + visit(child) for child in edges.get(node, ())), default=0)
        if height > limits['shapeDepth']:
            reject('FAILED', 'SHAPE_DEPTH_LIMIT', 'Shape dependency depth exceeds the fixed budget')
        active.remove(node)
        heights[node] = height
        return height
    for node in edges:
        visit(node)
    for query in shapes.objects(None, SH.select):
        if not isinstance(query, Literal):
            reject('INVALID_INPUT', 'INVALID_SPARQL', 'A SELECT constraint must be a literal')
        try:
            nodes = list(walk(parseQuery(str(query))))
        except Exception:
            reject('INVALID_INPUT', 'INVALID_SPARQL', 'Malformed SELECT constraint')
        if not any(n.name == 'SelectQuery' for n in nodes):
            reject('UNSUPPORTED', 'SPARQL_FORM', 'Only local SELECT constraints are supported')
        for node in nodes:
            if node.name in {'ServiceGraphPattern', 'DatasetClause', 'MinusGraphPattern', 'InlineData', 'Function', 'GraphGraphPattern'}:
                reject('UNSUPPORTED', 'SPARQL_CONSTRUCT', 'Forbidden local constraint construct: ' + node.name)


def coverage(data, shapes, expected, limits):
    # Use the same pinned upstream target resolver, including subclass and
    # implicit class targets. Do not insert expected nodes as artificial targets.
    discovered = {s.node: s for s in ShapesGraph(shapes).shapes}
    required = {URIRef(r['shapeIri']): r for r in expected['requiredShapes']}
    rows, total = [], 0
    for node in required:
        if node not in discovered:
            reject('INCOMPLETE_COVERAGE', 'REQUIRED_SHAPE_MISSING', 'Required named shape is absent: ' + str(node))
    for node, shape in discovered.items():
        focuses = shape.focus_nodes(data)
        if focuses and node not in required:
            reject('INCOMPLETE_COVERAGE', 'UNREGISTERED_TARGET_SHAPE', 'A targeted shape has no independent coverage entry')
        if node not in required:
            continue
        if not focuses:
            reject('INCOMPLETE_COVERAGE', 'EMPTY_REQUIRED_TARGET', 'Required shape has no actual focus nodes: ' + str(node))
        if len(focuses) < required[node]['minimumFocusCount']:
            reject('INCOMPLETE_COVERAGE', 'REQUIRED_TARGET_COUNT', 'Actual focus count is below the independently fixed minimum')
        wanted = {URIRef(x) for x in required[node]['requiredFocusIris']}
        if not wanted.issubset(focuses):
            reject('INCOMPLETE_COVERAGE', 'REQUIRED_TARGET_MISSING', 'Actual targets omit independently required focus nodes')
        total += len(focuses)
        if total > limits['focusNodes']:
            reject('FAILED', 'FOCUS_LIMIT', 'Actual focus node count exceeds the fixed budget')
        rows.append({'shapeIri': str(node), 'requiredFocusIris': sorted(map(str, wanted)), 'minimumFocusCount': required[node]['minimumFocusCount'],
                     'actualFocusNodes': sorted(x.n3() for x in focuses), 'complete': True})
    return sorted(rows, key=lambda row: row['shapeIri'])


def main(payload):
    limits = payload['limits']
    request = payload['request']
    result = {}
    envelope = {k: payload[k] for k in ('requestDigest', 'closureDigest', 'viewDigest', 'shapesDigest', 'expectationsDigest', 'configurationDigest')}
    envelope.update(schema='ontology-shacl-worker-result/v2', requestId=request['requestId'])
    try:
        versions()
        data, parts = union_documents(request['view']['closure']['documents'], limits)
        shapes, _ = union_documents(request['shapes'], limits)
        import_guard(request['view']['closure'], parts, shapes)
        shape_guard(shapes, limits)
        observed = coverage(data, shapes, request['expectations'], limits)
        result = {'viewKind': request['view']['kind'], 'dataTriples': len(data), 'shapeTriples': len(shapes), 'coverage': observed}
        with warnings.catch_warnings():
            warnings.simplefilter('error')
            conforms, report, _ = validate(data, shacl_graph=shapes, inference='none',
                                           meta_shacl=True, advanced=False, js=False,
                                           do_owl_imports=False, allow_infos=False,
                                           allow_warnings=False, inplace=False,
                                           max_validation_depth=limits['shapeDepth'])
        if not isinstance(report, Graph):
            reject('INVALID_INPUT', 'SHACL_VALIDATION_FAILURE', 'Native SHACL did not produce a report graph')
        heads = list(report.subjects(RDF.type, SH.ValidationReport))
        if len(heads) != 1 or list(report.objects(heads[0], SH.conforms)) != [Literal(bool(conforms))]:
            reject('FAILED', 'SHACL_REPORT_PROTOCOL', 'Native SHACL report has an invalid conformance field')
        rows = []
        for node in report.subjects(RDF.type, SH.ValidationResult):
            rows.append({'node': node.n3(), 'properties': sorted(
                [{'predicate': str(p), 'object': o.n3()} for p, o in report.predicate_objects(node)],
                key=lambda p: (p['predicate'], p['object']))})
        result.update(reportTurtle=report.serialize(format='turtle'), results=rows)
        response = {**envelope, 'status': 'CONFORMS' if conforms else 'NONCONFORMING', 'complete': True, 'result': result, 'error': None}
    except Rejected as error:
        response = {**envelope, 'status': error.status, 'complete': False, 'result': result,
                    'error': {'code': error.code, 'message': str(error)}}
    except Exception as error:
        # Includes malformed shapes, upstream validation errors and recursion
        # warnings: no exception can become an empty conforming report.
        response = {**envelope, 'status': 'FAILED', 'complete': False, 'result': result,
                    'error': {'code': 'SHACL_EXECUTION', 'message': type(error).__name__ + ': ' + str(error)[:2000]}}
    encoded = json.dumps(response, ensure_ascii=True)
    if len(encoded.encode('utf-8')) > limits['outputBytes']:
        encoded = json.dumps({**envelope, 'status': 'FAILED', 'complete': False, 'result': {},
                              'error': {'code': 'OUTPUT_LIMIT', 'message': 'Report exceeds fixed output budget'}})
    print(encoded)


if __name__ == '__main__':
    if sys.argv[1:] == ['--probe']:
        print(json.dumps(versions()))
    else:
        # Defense in depth; this is not an OS network sandbox. Formats and SELECT
        # algebra are constrained above, and external entities are rejected.
        socket.socket.connect = blocked
        socket.socket.connect_ex = blocked
        socket.create_connection = blocked
        socket.getaddrinfo = blocked
        main(json.load(sys.stdin))
