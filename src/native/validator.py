"""Bounded RDF/SHACL adapter. Domain semantics are evaluated only by pySHACL.
Input is a manifested JSON package on stdin; no remote graph/file arguments.
"""
import importlib.metadata, json, socket, sys, traceback
from pathlib import Path
from rdflib import Graph, Literal, Namespace, RDF, URIRef
from rdflib.plugins.sparql.parser import parseQuery
from rdflib.plugins.sparql.parserutils import CompValue
from pyparsing import ParseResults
from pyshacl import validate
SH=Namespace('http://www.w3.org/ns/shacl#')
OWL=Namespace('http://www.w3.org/2002/07/owl#')
RDFS=Namespace('http://www.w3.org/2000/01/rdf-schema#')
ALLOWED_SH=set('''NodeShape PropertyShape targetNode targetClass targetSubjectsOf targetObjectsOf property path class datatype nodeKind IRI BlankNode Literal BlankNodeOrIRI BlankNodeOrLiteral IRIOrLiteral minCount maxCount minExclusive maxExclusive minInclusive maxInclusive minLength maxLength pattern flags languageIn uniqueLang equals disjoint lessThan lessThanOrEquals and or not xone node qualifiedValueShape qualifiedMinCount qualifiedMaxCount qualifiedValueShapesDisjoint closed ignoredProperties hasValue in name description order group message severity Violation Warning Info deactivated sparql select prefixes declare prefix namespace inversePath alternativePath zeroOrMorePath oneOrMorePath zeroOrOnePath'''.split())
ALLOWED_OWL={'Class','ObjectProperty','DatatypeProperty','Ontology','versionIRI','versionInfo'}
ALLOWED_RDFS={'Class','subClassOf','subPropertyOf','domain','range','label','comment','seeAlso','isDefinedBy','Literal','Resource','Datatype'}
def walk(value):
    if isinstance(value,CompValue):
        yield value
        for v in value.values(): yield from walk(v)
    elif isinstance(value,(list,tuple,ParseResults)):
        for v in value: yield from walk(v)
def diagnostic(code,message,subject=None):
    d={'code':code,'message':message}
    if subject is not None:d['subject']=str(subject)
    return d
def parse(text): return Graph().parse(data=text,format='turtle')
def merge(files,paths):
    g=Graph()
    for p in paths: g+=parse(files[p])
    return g
def guard(model,shapes,data,coverage,bindings):
    errors=[]
    if not len(model) or not len(shapes) or not len(data):errors.append(diagnostic('EMPTY_GRAPH','Model, shapes and instance graphs must be nonempty'))
    allg=model+shapes+data
    for graph in [model,shapes,data]:
        for s,p,o in graph:
            for term in [p,o if p==RDF.type else None]:
                if not isinstance(term,URIRef):continue
                if str(term).startswith(str(SH)) and str(term)[len(str(SH)):] not in ALLOWED_SH:errors.append(diagnostic('UNSUPPORTED_SHACL','Unknown or unsupported executable SHACL vocabulary',term))
                if str(term).startswith(str(OWL)) and str(term)[len(str(OWL)):] not in ALLOWED_OWL:errors.append(diagnostic('UNSUPPORTED_OWL','Outside declared OWL subset',term))
                if str(term).startswith(str(RDFS)) and str(term)[len(str(RDFS)):] not in ALLOWED_RDFS:errors.append(diagnostic('UNSUPPORTED_RDFS','Outside declared RDFS subset',term))
            if p==SH.deactivated and o!=Literal(False):errors.append(diagnostic('DEACTIVATED_SHAPE','Cannot deactivate adopted shapes',s))
    required=[URIRef(x) for x in coverage['requiredShapeIds']]
    for s in required:
        if (s,RDF.type,SH.NodeShape) not in shapes and (s,RDF.type,SH.PropertyShape) not in shapes:errors.append(diagnostic('REQUIRED_SHAPE_MISSING','Required named shape declaration missing',s))
    named_shapes=set(s for kind in [SH.NodeShape,SH.PropertyShape] for s in shapes.subjects(RDF.type,kind) if isinstance(s,URIRef))
    if named_shapes!=set(required):errors.append(diagnostic('SHAPE_CLOSURE_MISMATCH','Every named shape must be in the fixed required coverage ledger'))
    root=URIRef(coverage['projectRoot'])
    if not any((s,SH.targetNode,root) in shapes for s in required):errors.append(diagnostic('ROOT_TARGET_MISSING','A required shape must target the fixed project root',root))
    for e in coverage['expectedEntities']:
        subject=URIRef(e['id'])
        if not str(subject).startswith(coverage['namespace']):errors.append(diagnostic('NAMESPACE_MISMATCH','Expected identity outside declared project namespace',subject))
        if not any(data.triples((subject,None,None))):errors.append(diagnostic('EXPECTED_ENTITY_MISSING','Independent expected identity absent',subject))
        elif (subject,RDF.type,URIRef(e['type'])) not in data:errors.append(diagnostic('EXPECTED_TYPE_MISSING','Explicit expected type absent',subject))
    edges={}
    for s,p,o in shapes:
        if p in [SH.node,SH.property,SH['not'],SH.qualifiedValueShape]:edges.setdefault(s,set()).add(o)
        if p in [SH['and'],SH['or'],SH.xone]:
            try:edges.setdefault(s,set()).update(shapes.items(o))
            except Exception:errors.append(diagnostic('INVALID_LIST','Invalid RDF constraint list',s))
    def cyclic(n,trail):
        return n in trail or any(cyclic(x,trail|{n}) for x in edges.get(n,()))
    if any(cyclic(n,set()) for n in edges):errors.append(diagnostic('UNSUPPORTED_RECURSION','Recursive shape dependencies are unsupported'))
    for query in shapes.objects(None,SH.select):
        try:
            nodes=list(walk(parseQuery(str(query))))
            if not any(n.name=='SelectQuery' for n in nodes):errors.append(diagnostic('UNSUPPORTED_SPARQL','Only local SELECT constraints are supported'))
            for node in nodes:
                if node.name in {'ServiceGraphPattern','DatasetClause','MinusGraphPattern','InlineData','Function','GraphGraphPattern'}:errors.append(diagnostic('UNSUPPORTED_SPARQL','Forbidden SPARQL construct '+node.name))
        except Exception as e:errors.append(diagnostic('INVALID_SPARQL',str(e)))
    # No independently injected custom functions/components, JS/AF or alternate targets.
    for m in bindings['mappings']:
        if not any(allg.triples((URIRef(m['targetId']),None,None))):errors.append(diagnostic('DANGLING_SOURCE_MAPPING','Source mapping target absent',m['targetId']))
    declarations=set()
    for kind in [RDFS.Class,OWL.Class,OWL.ObjectProperty,OWL.DatatypeProperty,RDF.Property]:declarations.update(model.subjects(RDF.type,kind))
    declarations.update(required)
    for subject in declarations:
        if not isinstance(subject,URIRef):errors.append(diagnostic('UNSTABLE_IDENTIFIER','Externally referenced declaration requires stable IRI',subject))
        elif not any(m['targetId']==str(subject) for m in bindings['mappings']):errors.append(diagnostic('MISSING_SOURCE_MAPPING','Semantic declaration lacks classified source binding',subject))
        if isinstance(subject,URIRef) and not str(subject).startswith(coverage['namespace']):errors.append(diagnostic('NAMESPACE_MISMATCH','Owned declarations must use the declared project namespace',subject))
        if str(subject).startswith((str(SH),str(RDF),str(RDFS),str(OWL))):errors.append(diagnostic('RESERVED_NAMESPACE','Project cannot redefine standard vocabulary',subject))
    return errors
def result_rows(report):
    return [{str(p).replace(str(SH),'sh:'):str(o) for p,o in report.predicate_objects(r)} for r in report.subjects(RDF.type,SH.ValidationResult)]
def native(data,shapes):
    conforms,report,_=validate(data,shacl_graph=shapes,inference='none',meta_shacl=True,advanced=False,js=False,do_owl_imports=False,allow_infos=False,allow_warnings=False)
    if not isinstance(report,Graph):raise RuntimeError('Native validation did not produce a report graph: '+str(report))
    heads=list(report.subjects(RDF.type,SH.ValidationReport))
    if len(heads)!=1 or list(report.objects(heads[0],SH.conforms)) != [Literal(bool(conforms))]:raise RuntimeError('Invalid native report protocol')
    return bool(conforms),report
def main():
    if sys.version_info[:3] != (3,12,12) or importlib.metadata.version('pyshacl')!='0.40.1' or importlib.metadata.version('rdflib')!='7.6.0':raise RuntimeError('TOOLCHAIN_VERSION_MISMATCH')
    # Deliberately block network at the adapter boundary too. Not an OS sandbox.
    def blocked(*args,**kwargs):raise RuntimeError('NETWORK_FORBIDDEN')
    socket.socket.connect=blocked;socket.socket.connect_ex=blocked;socket.create_connection=blocked
    payload=json.load(sys.stdin); package=payload['package'];files=package['files'];ep=package['manifest']['entrypoints']
    model=parse(files[ep['model']]);shapes=merge(files,ep['shapes']);data=merge(files,ep['instances'])
    coverage=json.loads(files[ep['coverage']]);bindings=json.loads(files[package['manifest']['sourceBindingRef']]);cases=json.loads(files[ep['cases']])
    errors=guard(model,shapes,data,coverage,bindings)
    if errors:
        unsupported=any(d['code'].startswith('UNSUPPORTED') for d in errors)
        invalid=any(d['code'].startswith('INVALID') for d in errors)
        print(json.dumps({'status':'ERROR' if invalid else 'UNSUPPORTED' if unsupported else 'NONCONFORMING','diagnostics':errors,'rawReport':'','modelReport':'','results':[],'caseReports':[]}));return
    meta=parse(payload['metaShapes']);model_ok,model_report=native(model+shapes,meta)
    conforms,report=native(data+model,shapes)
    checks=[]
    for case in cases['cases']:
        case_data=parse(files[case['data']])+model
        actual,r=native(case_data,shapes)
        failures=set(str(x) for x in r.objects(None,SH.sourceShape))
        hit=case['expectedConforms'] or set(case['shapeIds']).issubset(failures)
        matches=actual==case['expectedConforms'] and hit
        checks.append({'id':case['id'],'expectedConforms':case['expectedConforms'],'actualConforms':actual,'matchesExpected':matches,'sourceShapeIds':sorted(failures),'rawReport':r.serialize(format='turtle')})
    if not all(c['matchesExpected'] for c in checks):errors.append(diagnostic('CASE_EXPECTATION_FAILED','Required native case has wrong verdict or failed to exercise its declared shape'))
    print(json.dumps({'status':'CONFORMS' if conforms and model_ok and not errors else 'NONCONFORMING','diagnostics':errors,'rawReport':report.serialize(format='turtle'),'modelReport':model_report.serialize(format='turtle'),'results':result_rows(report)+result_rows(model_report),'caseReports':checks}))
if __name__=='__main__':
    try:main()
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({'status':'ERROR','diagnostics':[diagnostic('NATIVE_EXECUTION_ERROR',type(e).__name__+': '+str(e))],'rawReport':'','modelReport':'','results':[],'caseReports':[]}))
        sys.exit(2)
