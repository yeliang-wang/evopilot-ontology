import {hash,hashBytes} from '../../../dist/standalone/validation.js';
export const prefixes='@prefix : <urn:demo:> . @prefix sh: <http://www.w3.org/ns/shacl#> . @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n';
export const data=prefixes+'<urn:model> a owl:Ontology . :svc a :Service ; :owner "operations" .';
export const shapes=prefixes+':ServiceShape a sh:NodeShape ; sh:targetClass :Service ; sh:property [ sh:path :owner ; sh:minCount 1 ; sh:datatype xsd:string ] .';
export function document(id,content,ontologyIri=null,format='turtle'){return {id,documentIri:'urn:document:'+id,ontologyIri,versionIri:null,format,content,digest:hashBytes(content)};}
export function request(text=data,shapeText=shapes){
 const requiredShapes=[{shapeIri:'urn:demo:ServiceShape',minimumFocusCount:1,requiredFocusIris:['urn:demo:svc']}];
 return {schema:'ontology-shacl-request/v2',requestId:'fixed-shacl',modelDigest:hash('synthetic-model'),view:{kind:'asserted',closure:{rootDocumentId:'model',documents:[document('model',text,'urn:model')],imports:[]}},shapes:[document('shapes',shapeText)],expectations:{digest:hash(requiredShapes),requiredShapes}};
}
