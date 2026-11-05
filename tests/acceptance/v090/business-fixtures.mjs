// Fixed synthetic requirements and oracles, independent of product observations.
import {createHash} from 'node:crypto';
const hashBytes=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
export const ttl=`@prefix : <urn:demo:> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
<urn:model> a owl:Ontology .
:Service a owl:Class . :SensitiveDataset a owl:Class . :SensitiveService a owl:Class .
:accesses a owl:ObjectProperty .
:SensitiveService owl:equivalentClass [ a owl:Class ; owl:intersectionOf (:Service [ a owl:Restriction ; owl:onProperty :accesses ; owl:someValuesFrom :SensitiveDataset ]) ] .
:svc a owl:NamedIndividual, :Service ; :accesses :data .
:data a owl:NamedIndividual, :SensitiveDataset .
`;
export const query={format:'functional',content:'Prefix(:=<urn:demo:>) Ontology(ClassAssertion(:SensitiveService :svc))'};query.digest=hashBytes(query.content);
export function draft(intentDigest,sourceSetDigest,text=ttl,previousDigest=null){
 const document={id:'model',documentIri:'urn:model:document',ontologyIri:'urn:model',versionIri:null,format:'turtle',content:text,digest:hashBytes(text)};
 return {schema:'ontology-model-draft/v2',assetId:'services',label:'Sensitive services',intentDigest,sourceSetDigest,previousDigest,closure:{rootDocumentId:'model',documents:[document],imports:[]},shapes:[],
 mappings:[{requirementId:'r1',sourceFragmentIds:['rule'],anchors:[{documentId:'model',documentDigest:document.digest,start:0,end:Buffer.byteLength(text),fragmentDigest:document.digest}],rationale:'The equivalence encodes the fixed requirement.'}],openIssues:[]};
}
export const source={id:'requirements',locator:'fixed-requirements.txt',revision:'v1',origin:'requirement',format:'text',content:'A service accessing sensitive data is sensitive. A public service with no sensitive access must not be inferred sensitive from this model. Every service must declare a textual owner; an absent owner is invalid.'};source.digest=hashBytes(source.content);
const {content:_,format:__,...binding}=source;
export const definition={purpose:'Classify services and validate ownership',mode:'forward',scope:'Synthetic services',exclusions:['Live data'],sources:[binding],requirements:[{id:'r1',statement:'Sensitive access entails sensitive service; absent premise does not entail it.'},{id:'r2',statement:'Every service declares an owner string.'}]};
export const sourceSet={schema:'ontology-source-set/v2',sources:[source],fragments:[{id:'rule',sourceId:source.id,sourceDigest:source.digest,selector:{kind:'document'},fragmentDigest:source.digest}]};
const prefix='@prefix : <urn:demo:> . @prefix sh: <http://www.w3.org/ns/shacl#> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n';
export const shapeText=prefix+':ServiceShape a sh:NodeShape ; sh:targetClass :Service ; sh:property :OwnerConstraint . :OwnerConstraint a sh:PropertyShape ; sh:path :owner ; sh:minCount 1 ; sh:datatype xsd:string .';
export const modelText=ttl+' :owner a owl:DatatypeProperty . :svc :owner "operations" . :publicService a owl:NamedIndividual, :Service ; :owner "public operations" .';
const negativeQuery={format:'functional',content:'Prefix(:=<urn:demo:>) Ontology(ClassAssertion(:SensitiveService :publicService))'};negativeQuery.digest=hashBytes(negativeQuery.content);
function caseClosure(id,text){return {rootDocumentId:id,documents:[{id,documentIri:'urn:fixture:'+id,ontologyIri:null,versionIri:null,format:'turtle',content:text,digest:hashBytes(text)}],imports:[]};}
export function expected(intentDigest,sourceSetDigest,previousDigest=null){
 const basis={sourceFragmentIds:['rule'],rationale:'The original independent requirement fixes this expectation.'};
 return {schema:'ontology-expectations/v2',assetId:'services',intentDigest,sourceSetDigest,previousDigest,
  requirements:[{requirementId:'r1',methods:['owl'],targetShapeIris:[],constraintShapeIris:[],...basis},{requirementId:'r2',methods:['shacl'],targetShapeIris:['urn:demo:ServiceShape'],constraintShapeIris:['urn:demo:OwnerConstraint'],...basis}],
  requiredShapes:[{shapeIri:'urn:demo:ServiceShape',minimumFocusCount:1,requiredFocusIris:['urn:demo:svc']}],
  cases:[{id:'sensitive-positive',kind:'owl-entailment',query,expectedStatus:'ENTAILED',requirementIds:['r1'],...basis},
   {id:'sensitive-negative',kind:'owl-entailment',query:negativeQuery,expectedStatus:'NOT_ENTAILED',requirementIds:['r1'],...basis},
   {id:'owner-positive',kind:'shacl',closure:caseClosure('valid-owner',prefix+':svc a :Service ; :owner "operations" .'),expectedConforms:true,expectedViolationShapeIris:[],requirementIds:['r2'],...basis},
   {id:'owner-negative',kind:'shacl',closure:caseClosure('absent-owner',prefix+':svc a :Service .'),expectedConforms:false,expectedViolationShapeIris:['urn:demo:OwnerConstraint'],requirementIds:['r2'],...basis}]};
}
export function model(intentDigest,sourceSetDigest,expectationsDigest,previousDigest=null,shapes=shapeText){
 const value=draft(intentDigest,sourceSetDigest,modelText,previousDigest),document={id:'constraints',documentIri:'urn:constraints:document',ontologyIri:null,versionIri:null,format:'turtle',content:shapes,digest:hashBytes(shapes)};
 value.expectationsDigest=expectationsDigest;value.shapes=[document];value.mappings.push({requirementId:'r2',sourceFragmentIds:['rule'],anchors:[{documentId:document.id,documentDigest:document.digest,start:0,end:Buffer.byteLength(shapes),fragmentDigest:document.digest}],rationale:'This property shape implements the independent ownership requirement.'});return value;
}
