import {createHash} from 'node:crypto';
export const sha=text=>'sha256:'+createHash('sha256').update(text).digest('hex');
export const ns='urn:evopilot:formal-test:';
export const ofn=body=>'Prefix(:=<'+ns+'>) Prefix(owl:=<http://www.w3.org/2002/07/owl#>) Prefix(xsd:=<http://www.w3.org/2001/XMLSchema#>) Ontology(\n'+body+'\n)';
export const query=body=>{const content=ofn(body);return {format:'functional',content,digest:sha(content)};};
export const document=(content,extra={})=>({id:'root',documentIri:ns+'document',ontologyIri:null,versionIri:null,format:'functional',content,digest:sha(content),...extra});
export const request=(body,task,requestId='formal-test')=>({schema:'ontology-dl-request/v1',requestId,closure:{rootDocumentId:'root',documents:[document(ofn(body))],imports:[]},task});
export const declaration=({classes=[],objects=[],data=[],individuals=[]})=>[
  ...classes.map(n=>`Declaration(Class(:${n}))`),...objects.map(n=>`Declaration(ObjectProperty(:${n}))`),...data.map(n=>`Declaration(DataProperty(:${n}))`),...individuals.map(n=>`Declaration(NamedIndividual(:${n}))`),
].join('\n');
export const sensitive=declaration({classes:['Service','SensitiveDataset','SensitiveService'],objects:['accesses'],individuals:['api','data']})+`
EquivalentClasses(:SensitiveService ObjectIntersectionOf(:Service ObjectSomeValuesFrom(:accesses :SensitiveDataset)))
ClassAssertion(:Service :api)
ClassAssertion(:SensitiveDataset :data)
ObjectPropertyAssertion(:accesses :api :data)`;
export const readonly=declaration({classes:['ReadOnly'],objects:['writes'],individuals:['task','target']})+`
SubClassOf(:ReadOnly ObjectMaxCardinality(0 :writes))
ClassAssertion(:ReadOnly :task)
ObjectPropertyAssertion(:writes :task :target)`;
export const impossible=declaration({classes:['ModeA','ModeB','Impossible'],individuals:['task']})+`
DisjointClasses(:ModeA :ModeB)
SubClassOf(:Impossible :ModeA)
SubClassOf(:Impossible :ModeB)`;
export const keyed=declaration({classes:['Connection'],data:['identity'],individuals:['a','b']})+`
HasKey(:Connection () (:identity))
ClassAssertion(:Connection :a)
ClassAssertion(:Connection :b)
DataPropertyAssertion(:identity :a "shared")
DataPropertyAssertion(:identity :b "shared")`;
