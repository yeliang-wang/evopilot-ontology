import {hashBytes} from '../standalone/validation.js';
import type {Json} from '../standalone/types.js';

/** Fictional protocol examples, never imported business assets or owner state.
 * Zero digests mark owner-returned identities that the caller must substitute. */
export function authoringExampleInputs():Record<string,Json> {
  const returned='sha256:'+'0'.repeat(64),ns='urn:guide:';
  const content='Every PublishedService is a Service. Every Service must name at least one owner IRI.';
  const source={id:'requirements',locator:'urn:guide:requirements',revision:'example-v1',origin:'requirement',format:'text',content,digest:hashBytes(content)};
  const {content:_,format:__,...binding}=source;
  const definition={purpose:'Illustrate source-bound authoring',mode:'forward',scope:'Fictional services',exclusions:['Live systems'],sources:[binding],requirements:[{id:'classification',statement:'Every PublishedService is a Service.'},{id:'ownership',statement:'Every Service must name at least one owner IRI.'}]};
  const sourceSet={schema:'ontology-source-set/v2',sources:[source],fragments:[{id:'rules',sourceId:source.id,sourceDigest:source.digest,selector:{kind:'document'},fragmentDigest:source.digest}]};
  const prefix='@prefix ex: <'+ns+'> . @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n';
  const modelText=prefix+'<urn:guide:model> a owl:Ontology . ex:Service a owl:Class . ex:PublishedService a owl:Class ; rdfs:subClassOf ex:Service . ex:owner a owl:ObjectProperty . ex:api a owl:NamedIndividual, ex:Service ; ex:owner ex:team . ex:team a owl:NamedIndividual .\n';
  const shapeText='@prefix ex: <'+ns+'> . @prefix sh: <http://www.w3.org/ns/shacl#> .\nex:ServiceShape a sh:NodeShape ; sh:targetClass ex:Service ; sh:property ex:OwnerConstraint . ex:OwnerConstraint a sh:PropertyShape ; sh:path ex:owner ; sh:minCount 1 ; sh:nodeKind sh:IRI .\n';
  const document=(id:string,text:string,ontologyIri:string|null=null)=>({id,documentIri:ns+id+':document',ontologyIri,versionIri:null,format:'turtle',content:text,digest:hashBytes(text)});
  const modelDocument=document('model',modelText,'urn:guide:model'),shapeDocument=document('shapes',shapeText);
  const fixture=(hasOwner:boolean)=>{const d=document('fixture','@prefix ex: <'+ns+'> . ex:api a ex:Service '+(hasOwner?'; ex:owner ex:team ':'')+'.\n');return {rootDocumentId:d.id,documents:[d],imports:[]};};
  const query=(body:string)=>{const content='Prefix(ex:=<'+ns+'>) Ontology('+body+')';return {format:'functional',content,digest:hashBytes(content)};};
  const requirements=[
    {requirementId:'classification',sourceFragmentIds:['rules'],methods:['owl'],rationale:'The source fixes one-way class inclusion.',targetShapeIris:[],constraintShapeIris:[]},
    {requirementId:'ownership',sourceFragmentIds:['rules'],methods:['shacl'],rationale:'The source requires an explicit owner IRI.',targetShapeIris:[ns+'ServiceShape'],constraintShapeIris:[ns+'OwnerConstraint']},
  ];
  const expected={schema:'ontology-expectations/v2',assetId:'guide-model',intentDigest:returned,sourceSetDigest:returned,previousDigest:null,requirements,
    requiredShapes:[{shapeIri:ns+'ServiceShape',requiredFocusIris:[ns+'api'],minimumFocusCount:1}],cases:[
      {id:'classification-positive',requirementIds:['classification'],sourceFragmentIds:['rules'],rationale:'The stated inclusion must follow.',kind:'owl-entailment',query:query('SubClassOf(ex:PublishedService ex:Service)'),expectedStatus:'ENTAILED'},
      {id:'classification-negative',requirementIds:['classification'],sourceFragmentIds:['rules'],rationale:'The reverse inclusion is not supplied by the source; absence is not negation.',kind:'owl-entailment',query:query('SubClassOf(ex:Service ex:PublishedService)'),expectedStatus:'NOT_ENTAILED'},
      ...[true,false].map(positive=>({id:positive?'owner-positive':'owner-negative',requirementIds:['ownership'],sourceFragmentIds:['rules'],rationale:positive?'An explicit owner satisfies the source requirement.':'A missing owner must violate its named constraint.',kind:'shacl',closure:fixture(positive),expectedConforms:positive,expectedViolationShapeIris:positive?[]:[ns+'OwnerConstraint']})),
    ]};
  const anchor=(d:typeof modelDocument)=>({documentId:d.id,documentDigest:d.digest,start:0,end:Buffer.byteLength(d.content),fragmentDigest:d.digest});
  const draft={schema:'ontology-model-draft/v2',assetId:'guide-model',label:'Fictional service model',intentDigest:returned,sourceSetDigest:returned,expectationsDigest:returned,previousDigest:null,
    closure:{rootDocumentId:'model',documents:[modelDocument],imports:[]},shapes:[shapeDocument],
    mappings:[{requirementId:'classification',sourceFragmentIds:['rules'],anchors:[anchor(modelDocument)],rationale:'The OWL subclass premise represents the source inclusion.'},{requirementId:'ownership',sourceFragmentIds:['rules'],anchors:[anchor(shapeDocument)],rationale:'The named SHACL property constraint checks explicit owner IRIs.'}],openIssues:[]};
  return {
    'guide.read':{topic:'contract:intent.record'},'project.create':{label:'Fictional service modeling'},'project.inspect':{},'project.list':{},'service.inspect':{},
    'receipt.read':{requestId:'retained-original-request-id'},'intent.record':{definition,previousDigest:null},'intent.read':{digest:returned},
    'source.admit':{intentDigest:returned,sourceSet},'source.inspect':{sourceSetDigest:null},
    'source.read':{sourceSetDigest:returned,sourceId:'requirements',offset:0,maxBytes:65536},'source.fragment.read':{sourceSetDigest:returned,fragmentId:'rules',offset:0,maxBytes:65536},
    'expectations.record':{definition:expected},'expectations.inspect':{assetId:'guide-model',expectationsDigest:null},'expectations.list':{afterAssetId:null,limit:20},
    'expectations.read':{assetId:'guide-model',expectationsDigest:returned,offset:0,maxBytes:65536},
    'model.record':{draft},'model.inspect':{assetId:'guide-model',modelDigest:null},'model.list':{afterAssetId:null,limit:20},
    'model.document.read':{assetId:'guide-model',modelDigest:returned,documentId:'model',offset:0,maxBytes:65536},
    'reasoning.start':{assetId:'guide-model',modelDigest:returned,task:{kind:'entailment',query:query('SubClassOf(ex:PublishedService ex:Service)')}},
    'validation.start':{assetId:'guide-model',modelDigest:returned},
  } as Record<string,Json>;
}
