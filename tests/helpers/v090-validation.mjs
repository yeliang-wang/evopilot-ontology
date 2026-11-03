import {hashBytes} from '../../dist/standalone/validation.js';
import {draft,ttl,query,fixture} from './v090-native.mjs';
export {fixture};
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
export function sources(s,f){
 s.request(f.write('project.create',{label:'Synthetic validation'},'create',0),f.token);
 const intentDigest=s.request(f.write('intent.record',{definition,previousDigest:null},'intent',1),f.token).result.intentDigest;
 const sourceSetDigest=s.request(f.write('source.admit',{intentDigest,sourceSet},'sources',2),f.token).result.sourceSetDigest;return {intentDigest,sourceSetDigest};
}
export function prepare(s,f,mutate=()=>{}){
 const p=sources(s,f),expectations=expected(p.intentDigest,p.sourceSetDigest);mutate(expectations);
 const expectationsDigest=s.request(f.write('expectations.record',{definition:expectations},'expectations',3),f.token).result.expectationsDigest;
 const value=model(p.intentDigest,p.sourceSetDigest,expectationsDigest),modelDigest=s.request(f.write('model.record',{draft:value},'model',4),f.token).result.modelDigest;
 return {...p,expectations,expectationsDigest,model:value,modelDigest};
}
export async function terminal(s,f,taskId){const end=Date.now()+30000;while(Date.now()<end){const value=s.request(f.read('validation.inspect',{taskId}),f.token);if(value.state==='FINISHED')return value;await new Promise(r=>setTimeout(r,25));}throw Error('Actual validation did not finish');}
export function configuration(f){return {...f.setup,reasoning:{toolchainFile:process.env.EVOPILOT_TEST_DL_TOOLCHAIN,workRoot:f.workRoot},validation:{toolchainFile:process.env.EVOPILOT_TEST_SHACL_TOOLCHAIN,workRoot:f.workRoot}};}
