"""Independent pinned W3C/pySHACL conformance and report-graph oracle.
This exercises the adopted native engine, not EvoPilot package metadata.
"""
import contextlib, hashlib, io, json, logging, socket, sys, subprocess
from pathlib import Path
from rdflib import Graph, Namespace, RDF, URIRef, Literal
from rdflib.compare import isomorphic
from pyshacl import validate
from pyshacl.validator_conformance import check_sht_result
root=Path(sys.argv[1]).resolve()
source=json.loads((root/'source.json').read_text())
MF=Namespace('http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#'); SHT=Namespace('http://www.w3.org/ns/shacl-test#'); SH=Namespace('http://www.w3.org/ns/shacl#')
def blocked(*args,**kwargs):raise RuntimeError('NETWORK_FORBIDDEN')
socket.socket.connect=blocked;socket.socket.connect_ex=blocked;socket.create_connection=blocked
for item in source['cases']+source['resources']:
    assert 'sha256:'+hashlib.sha256((root/item['path']).read_bytes()).hexdigest()==item['sha256']
results=[]
if len(sys.argv)==2:
    # pySHACL/RDFLib retain process-global state for some upstream fixtures.
    # Each pinned upstream test uses its own process, exactly as upstream proof selection.
    for item in source['cases']:
        p=subprocess.run([sys.executable,'-I','-B',str(Path(__file__).resolve()),str(root),item['path']],capture_output=True,text=True,timeout=60)
        assert p.returncode==0,item['path']+'\n'+p.stderr
        results.extend(json.loads(p.stdout)['cases'])
    print(json.dumps({'cases':results,'count':len(results),'passed':sum(r['matchesExpected'] for r in results)}))
    assert results and all(r['matchesExpected'] for r in results)
    raise SystemExit(0)
for fixture in [x for x in source['cases'] if x['path']==sys.argv[2]]:
    path=root/fixture['path']; assert 'sha256:'+hashlib.sha256(path.read_bytes()).hexdigest()==fixture['sha256']
    graph=Graph().parse(path,format='turtle')
    for entry in graph.subjects(RDF.type,SHT.Validate):
        action=graph.value(entry,MF.action);expected=graph.value(entry,MF.result)
        data=graph.value(action,SHT.dataGraph);shapes=graph.value(action,SHT.shapesGraph)
        from urllib.parse import urlparse,unquote
        def local_graph(value):
            if str(value)==path.as_uri(): return graph
            parsed=urlparse(str(value));assert parsed.scheme=='file'
            target=Path(unquote(parsed.path)).resolve();assert target.is_relative_to(root)
            assert any(str(target.relative_to(root))==x['path'] for x in source['resources']+source['cases'])
            return str(target)
        data,shapes=local_graph(data),local_graph(shapes)
        log=io.StringIO();logger=logging.getLogger('fixture');handler=logging.StreamHandler(log);logger.addHandler(handler)
        with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
            conforms,report,_=validate(data,shacl_graph=shapes,inference='none',meta_shacl=False,advanced=False,js=False,do_owl_imports=False,allow_infos=False,allow_warnings=False)
            matched=check_sht_result(report,graph,expected,log=logger)
        logger.removeHandler(handler)
        # Turtle order, prefixes and blank-node labels must not affect graph identity.
        serialized=report.serialize(format='turtle');reparsed=Graph().parse(data=report.serialize(format='nt'),format='nt')
        assert isomorphic(report,reparsed)
        mutant=Graph()+report;report_id=next(mutant.subjects(RDF.type,SH.ValidationReport));mutant.set((report_id,SH.conforms,Literal(not conforms)))
        assert not isomorphic(report,mutant)
        results.append({'path':fixture['path'],'testId':str(entry),'matchesExpected':bool(matched),'conforms':bool(conforms),'rawReport':serialized,'diagnostics':log.getvalue()})
print(json.dumps({'cases':results,'count':len(results),'passed':sum(r['matchesExpected'] for r in results)}))
assert results and all(r['matchesExpected'] for r in results)
