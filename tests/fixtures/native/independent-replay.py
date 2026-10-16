"""Direct upstream replay of package graph bytes; no EvoPilot validator import."""
import json,sys
from rdflib import Graph
from rdflib.compare import isomorphic
from pyshacl import validate
x=json.load(sys.stdin);p=x['package'];files=p['files'];ep=p['manifest']['entrypoints']
def graph(paths):
    value=Graph()
    for path in paths:value+=Graph().parse(data=files[path],format='turtle')
    return value
model=graph([ep['model']]);data=graph(ep['instances'])+model;shapes=graph(ep['shapes'])
conforms,report,_=validate(data,shacl_graph=shapes,meta_shacl=True,inference='none',advanced=False,js=False,do_owl_imports=False,allow_infos=False,allow_warnings=False)
expected=Graph().parse(data=x['rawReport'],format='turtle');reordered=Graph().parse(data=report.serialize(format='nt'),format='nt')
print(json.dumps({'conforms':bool(conforms),'equivalent':isomorphic(report,expected),'differentBlankNodeSerializationEquivalent':isomorphic(report,reordered),'rawReport':report.serialize(format='turtle')}))
