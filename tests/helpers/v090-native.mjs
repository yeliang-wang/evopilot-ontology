import {mkdtempSync,realpathSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializeWorkspace} from '../../dist/installation/workspace.js';
import {hashBytes} from '../../dist/standalone/validation.js';

export const source={id:'requirement',locator:'business-requirement.txt',revision:'v1',origin:'requirement',format:'text',content:'A service accessing sensitive data is sensitive.'};source.digest=hashBytes(source.content);
const {content:_,format:__,...binding}=source;
export const definition={purpose:'Identify sensitive services',mode:'forward',scope:'Synthetic order service',exclusions:['Live data'],sources:[binding],requirements:[{id:'r1',statement:source.content}]};
export const sourceSet={schema:'ontology-source-set/v2',sources:[source],fragments:[{id:'rule',sourceId:source.id,sourceDigest:source.digest,selector:{kind:'document'},fragmentDigest:source.digest}]};
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
export function fixture(t){
 const base=realpathSync(mkdtempSync(join(tmpdir(),'ontology-model-v2-'))),root=join(base,'workspace'),workRoot=join(base,'worker');mkdirSync(workRoot,{mode:0o700});
 const setup=initializeWorkspace({root,workspaceId:'isolated',projectId:'demo',principalId:'user'}),token=readFileSync(setup.credentialFile,'utf8');t.after(()=>rmSync(base,{recursive:true,force:true}));
 const read=(operation,input={})=>({workspaceId:setup.workspaceId,serviceId:setup.serviceId,projectId:'demo',operation,input});
 const write=(operation,input,requestId,expectedRevision)=>({...read(operation,input),requestId,expectedRevision});
 return {base,root,workRoot,setup,token,read,write};
}
export function prepare(service,f){
 service.request(f.write('project.create',{label:'Synthetic model'},'create',0),f.token);
 const intentDigest=service.request(f.write('intent.record',{definition,previousDigest:null},'intent',1),f.token).result.intentDigest;
 const sourceSetDigest=service.request(f.write('source.admit',{intentDigest,sourceSet},'sources',2),f.token).result.sourceSetDigest;
 const model=draft(intentDigest,sourceSetDigest),modelDigest=service.request(f.write('model.record',{draft:model},'model',3),f.token).result.modelDigest;
 return {intentDigest,sourceSetDigest,model,modelDigest};
}
