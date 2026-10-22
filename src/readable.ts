import {ontologyPresentation,relationTriple,nativeTerm,shapeNodeKind,shapeNodeRank} from './readable-presentation.js';
import type {Term} from './readable-presentation.js';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validateOntologyPackage,packageParts} from './native/package.js';
import {verifyOntologyToolchain} from './native/validator.js';
import {nativeSha256,nativePackageDigest,nativeBytesDigest} from '../vendor/compatibility/v1/native.mjs';
import type {NativeOntologyRecord,NativeToolchain} from './native/types.js';
import {readSnapshot,readFail,readDigest,readStable} from '../vendor/readability/v1/readability.mjs';
import type {ReadScope,ReadSnapshot,ReadRow,JSONValue} from '../vendor/readability/v1/readability.mjs';
interface GraphProjection {graphs:{path:string;role:string;triples:[Term,Term,Term][]}[];total:number}
const adapter=fileURLToPath(new URL('../src/native/readmodel.py',import.meta.url));
async function graphProjection(record:NativeOntologyRecord,tools:NativeToolchain):Promise<GraphProjection>{
 verifyOntologyToolchain(tools);const adapterDigest=nativeBytesDigest(readFileSync(adapter)),ep=record.package.manifest.entrypoints;
 const graphs=[{role:'model',path:ep.model as string},...(ep.shapes as string[]).map(path=>({role:'shape',path})),...(ep.instances as string[]).map(path=>({role:'instance',path}))].map(g=>({...g,content:record.package.files[g.path]}));
 const payload=JSON.stringify({graphs});if(Buffer.byteLength(payload)>33554432)readFail('READABLE_LIMIT');
 const raw=await new Promise<string>((resolve,reject)=>{
  const child=spawn(tools.tools.python.executable,['-I','-B',adapter],{cwd:tools.environmentRoot,env:{PATH:'',LANG:'C.UTF-8',PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'},stdio:['pipe','pipe','pipe'],shell:false});
  const chunks:Buffer[]=[];let size=0,failed=false;
  const abort=()=>{failed=true;child.kill('SIGKILL');};const timer=setTimeout(abort,60000);
  child.stdout.on('data',(b:Buffer)=>{size+=b.length;if(size>16777216)abort();else chunks.push(b);});child.stderr.resume();child.stdin.on('error',abort);
  child.on('error',()=>{clearTimeout(timer);reject(Object.assign(Error('READABLE_RDF_UNAVAILABLE'),{code:'READABLE_RDF_UNAVAILABLE'}));});
  child.on('close',(code,signal)=>{clearTimeout(timer);if(code!==0||signal||failed)reject(Object.assign(Error('READABLE_RDF_UNAVAILABLE'),{code:'READABLE_RDF_UNAVAILABLE'}));else resolve(Buffer.concat(chunks).toString());});child.stdin.end(payload);
 });
 verifyOntologyToolchain(tools);if(nativeBytesDigest(readFileSync(adapter))!==adapterDigest)readFail('READABLE_EVIDENCE_DRIFT');
 const parsed=JSON.parse(raw) as GraphProjection;if(!Array.isArray(parsed.graphs)||!Number.isSafeInteger(parsed.total)||parsed.total>20000)readFail('READABLE_LIMIT');return parsed;
}
export async function ontologyReadSnapshot(record:NativeOntologyRecord,workspaceId:string,scope:ReadScope,tools:NativeToolchain):Promise<ReadSnapshot>{
 if(nativeSha256(record.scope)!==nativeSha256(scope)||record.workspace.id!==workspaceId)readFail('READABLE_SCOPE');
 const pkg=validateOntologyPackage(record.package,scope),parts=packageParts(pkg),report=record.validation;
 if(report){const {reportDigest,...body}=report;if(nativeSha256(body)!==reportDigest||report.packageDigest!==nativePackageDigest(pkg))readFail('READABLE_EVIDENCE_DRIFT');}
 const graphs=await graphProjection(record,tools),rows:ReadRow[]=[];
 const presentation=ontologyPresentation(graphs.graphs);
 for(const g of graphs.graphs){
  const subjects=[...new Set(g.triples.map(t=>t[0].kind+':'+t[0].value))].sort();
  const groups=subjects.map(subject=>({subject,triples:g.triples.filter(t=>t[0].kind+':'+t[0].value===subject)}));
  if(g.role==='shape')groups.sort((a,b)=>shapeNodeRank(a.triples)-shapeNodeRank(b.triples));
  for(const {subject,triples} of groups){const id=triples[0][0].value,kind=g.role==='shape'?shapeNodeKind(triples):g.role==='model'?'entity':'instance';
   const labels=triples.filter(t=>t[1].value==='http://www.w3.org/2000/01/rdf-schema#label').map(t=>t[2].value+(t[2].language?' @'+t[2].language:''));
   rows.push({id:g.role+':'+g.path+':'+subject,kind,label:labels.join(' / ')||id,...(kind==='structure'?{}:{presentation:presentation.present(g.role,g.path,triples)}),verdict:'DECLARED',expected:null,actual:null,origin:parts.bindings.direction==='forward'?'design-declaration':'source-declaration',references:[{kind:'graph',id:g.path,digest:nativeBytesDigest(pkg.files[g.path])}],details:triples as unknown as JSONValue});
  }
  for(const triple of g.triples.filter(t=>relationTriple(t,g.role))){
   const [subject,predicate,object]=triple;
   rows.push({id:'relation:'+g.role+':'+g.path+':'+readDigest(triple),kind:'relation',label:presentation.name(predicate,g.path),verdict:'DECLARED',expected:null,actual:null,origin:parts.bindings.direction==='forward'?'design-declaration':'source-declaration',references:[{kind:'graph',id:g.path,digest:nativeBytesDigest(pkg.files[g.path])}],details:triple as unknown as JSONValue,presentation:{section:'relations',cells:{subject:presentation.name(subject,g.path),predicate:nativeTerm(predicate)+' →',object:presentation.name(object,g.path)}}});
  }
 }
 for(const c of parts.cases.cases)for(const criterionId of c.requirementIds){const actual=report?.caseReports.find(x=>x.id===c.id),criterion=report?.criteria.find(x=>x.criterionId===criterionId&&x.variantId===c.id);
  rows.push({id:'case:'+criterionId+':'+c.id,kind:'case',label:criterionId+' / '+c.id,verdict:actual&&criterion?criterion.status:report?.status==='ERROR'?'ERROR':report?'UNKNOWN':'NOT_EXECUTED',expected:{conforms:c.expectedConforms},actual:actual?{conforms:actual.actualConforms,matchesExpected:actual.matchesExpected}:null,origin:'synthetic',references:[{kind:'fixture',id:c.data,digest:nativeBytesDigest(pkg.files[c.data])},{kind:'native-report',id:c.id,digest:actual?nativeSha256(actual):null}],details:{shapeIds:c.shapeIds,rawReport:actual?.rawReport??null,meaning:'Case PASS means actual conformance matches the expected outcome, including intentional rejection'}});
 }
 return readSnapshot({owner:'ontology',workspaceId,scope,subject:{kind:'asset',id:pkg.manifest.id,version:pkg.manifest.version},pins:{packageDigest:nativePackageDigest(pkg),standardDigest:pkg.manifest.standardPins.standardDigest,reportDigest:report?.reportDigest??null,sourceBindingsDigest:nativeSha256(parts.bindings),canonicalGraphDigest:readDigest(graphs.graphs.map(g=>({path:g.path,role:g.role,triples:g.triples}))),toolchainLockDigest:tools.lockDigest},rows,
 denominator:{requirements:parts.bindings.requirements.filter(r=>r.required).length,variants:parts.cases.cases.reduce((n,c)=>n+c.requirementIds.length,0)},stages:[{id:'asset-conformance',status:report?.status??'NOT_EVALUATED',reason:'RDF/SHACL result does not imply accepted business semantics'},{id:'owner-review',status:record.decision?.decision??'PENDING',reason:record.reference?'Published owner delivery':'No published owner delivery established'},{id:'software-release',status:'NOT_ASSERTED',reason:'Independent project release authority'}],limitations:['Canonical RDF graphs are compared by graph role and path; blank-node labels are canonical only within each graph','No OWL inference, business semantic equivalence or automatic impact approval','Labels are read from rdfs:label; definitions from rdfs:comment, skos:definition or sh:description. Missing labels use native identifiers; no translation or business meaning is invented','SHACL paths and complex expressions retain their native nodes; this view does not flatten them into invented predicates or cardinalities','Raw declarations and fixed synthetic fixture results remain distinct']});
}
