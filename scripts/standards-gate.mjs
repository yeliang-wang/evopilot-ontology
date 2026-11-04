import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants, openSync, closeSync, fstatSync, readSync, lstatSync, realpathSync, existsSync} from 'node:fs';
import {resolve, relative, isAbsolute, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectGovernance} from './roadmap.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const STATUSES=['PASS','FAIL','ERROR','NOT_RUN','EXCLUDED'];
export const hashBytes=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
export const hashValue=value=>hashBytes(JSON.stringify(value));
const reject=(code,message)=>{throw Object.assign(new Error(code+': '+message),{code});};
const requireValue=(condition,code,message)=>{if(!condition)reject(code,message);};
const digest=value=>requireValue(typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value),'INVALID_EVIDENCE','Invalid digest');
const text=value=>requireValue(typeof value==='string'&&value.trim().length>0&&value.length<=8192,'INVALID_EVIDENCE','Missing or oversized text');
const time=value=>{requireValue(typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value)),'INVALID_EVIDENCE','Invalid timestamp');return Date.parse(value);};
const array=(value,max=100000)=>requireValue(Array.isArray(value)&&value.length<=max,'INVALID_EVIDENCE','Expected bounded array');
const same=(a,b,message)=>{try{assert.deepEqual(a,b);}catch{reject('BINDING_MISMATCH',message);}};
function exact(value,required,optional=[]){
  requireValue(value&&typeof value==='object'&&!Array.isArray(value),'INVALID_EVIDENCE','Expected object');
  requireValue(required.every(k=>Object.hasOwn(value,k))&&Object.keys(value).every(k=>required.includes(k)||optional.includes(k)),'INVALID_EVIDENCE','Unknown or missing fields');
}
function fileBytes(path,max=32*1024*1024){
  requireValue(realpathSync(path)===path,'UNSAFE_EVIDENCE','Symbolic paths are not evidence');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=fstatSync(fd);requireValue(before.isFile()&&before.nlink===1&&before.size<=max,'UNSAFE_EVIDENCE','Expected bounded unlinked regular file');
    const result=Buffer.alloc(before.size);let offset=0;
    while(offset<result.length){const n=readSync(fd,result,offset,result.length-offset,null);requireValue(n>0,'EVIDENCE_CHANGED','Short read');offset+=n;}
    const after=fstatSync(fd),current=lstatSync(path);
    requireValue([after,current].every(s=>s.dev===before.dev&&s.ino===before.ino&&s.size===before.size&&s.mtimeMs===before.mtimeMs),'EVIDENCE_CHANGED','File changed during read');
    return result;
  }finally{closeSync(fd);}
}
export function evidenceReader(root,repositoryRoot=ROOT){
  requireValue(isAbsolute(root)&&realpathSync(root)===root&&lstatSync(root).isDirectory(),'UNSAFE_EVIDENCE','Canonical private evidence directory required');
  const rel=relative(realpathSync(repositoryRoot),root);
  requireValue(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel),'UNSAFE_EVIDENCE','Evidence must be outside source');
  const reads=new Map();
  function read(name){
    requireValue(typeof name==='string'&&!isAbsolute(name)&&!name.includes('\\')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'),'UNSAFE_EVIDENCE','Contained relative evidence path required');
    const bytes=fileBytes(resolve(root,name)),h=hashBytes(bytes);
    if(reads.has(name))requireValue(reads.get(name)===h,'EVIDENCE_CHANGED','Evidence changed between reads');
    reads.set(name,h);return bytes;
  }
  function ref(value){exact(value,['path','digest']);digest(value.digest);const bytes=read(value.path);requireValue(hashBytes(bytes)===value.digest,'BINDING_MISMATCH','Referenced bytes changed: '+value.path);return bytes;}
  const json=name=>JSON.parse(read(name).toString('utf8'));
  const refJson=value=>JSON.parse(ref(value).toString('utf8'));
  const recheck=()=>{for(const [name,h] of reads)requireValue(hashBytes(fileBytes(resolve(root,name)))===h,'EVIDENCE_CHANGED','Evidence changed during gate');};
  return {root,read,ref,json,refJson,recheck};
}

export function summarize(corpus,results,families){
  const byKey=new Map(results.map(r=>[r.key,r]));
  return families.map(family=>{
    const cases=corpus.cases.filter(c=>c.family===family),counts=Object.fromEntries(STATUSES.map(s=>[s,0]));
    for(const c of cases)counts[byKey.get(c.key).status]++;
    const required=cases.filter(c=>c.applicability==='REQUIRED').length;
    return {family,required,...counts,passRatio:required?counts.PASS/required:null};
  });
}
function inspectCorpus(corpus,reader,policy){
  exact(corpus,['schema','sources','cases']);requireValue(corpus.schema==='ontology-standards-corpus/v1','INVALID_EVIDENCE','Unknown corpus');array(corpus.sources,1000);array(corpus.cases);
  const sources=new Map();
  for(const source of corpus.sources){
    exact(source,['id','url','specification','revision','license','manifest','files']);text(source.id);text(source.url);text(source.specification);text(source.revision);text(source.license);
    requireValue(!sources.has(source.id),'INVALID_EVIDENCE','Duplicate source');reader.ref(source.manifest);array(source.files);const files=new Set([source.manifest.digest]);
    for(const f of source.files){reader.ref(f);files.add(f.digest);}sources.set(source.id,{source,files});
  }
  const ids=new Set(),upstreamIds=new Set();
  for(const c of corpus.cases){
    exact(c,['key','sourceId','upstreamId','family','upstreamStatus','applicability','reason','inputDigests','expectedDigests','complex']);
    text(c.sourceId);text(c.upstreamId);text(c.reason);requireValue(c.key===c.sourceId+'#'+c.upstreamId&&!ids.has(c.key),'INVALID_EVIDENCE','Duplicate or foreign upstream case');ids.add(c.key);
    requireValue(/^[a-z][a-z0-9+.-]*:\S+$/i.test(c.upstreamId),'INVALID_EVIDENCE','Full upstream identifier required');
    requireValue(!upstreamIds.has(c.upstreamId),'INVALID_EVIDENCE','Same upstream case listed through different sources');upstreamIds.add(c.upstreamId);
    requireValue(sources.has(c.sourceId)&&policy.families.includes(c.family)&&typeof c.complex==='boolean','INVALID_EVIDENCE','Unknown case source/family');
    requireValue(['REQUIRED','EXCLUDED'].includes(c.applicability),'INVALID_EVIDENCE','Unfrozen applicability');text(c.upstreamStatus);
    if(c.applicability==='REQUIRED')requireValue(c.upstreamStatus===policy.officialStatus,'INVALID_EVIDENCE','Only approved official cases enter denominator');
    array(c.inputDigests);array(c.expectedDigests);requireValue(c.inputDigests.length>0&&c.expectedDigests.length>0,'INVALID_EVIDENCE','Missing input/oracle');
    for(const d of [...c.inputDigests,...c.expectedDigests]){digest(d);requireValue(sources.get(c.sourceId).files.has(d),'INVALID_EVIDENCE','Input/oracle outside frozen source');}
  }
}
function inspectReport(report,corpus,reader,freeze,freezeDigest,policy){
  exact(report,['schema','freezeDigest','candidateDigest','corpusDigest','toolchainDigest','evaluatorDigest','startedAt','completedAt','cases','families','complexView','fullReport','limitations']);
  requireValue(report.schema==='ontology-standards-report/v1','INVALID_EVIDENCE','Unknown report');
  for(const k of ['candidate','corpus','toolchain','evaluator'])same(report[k+'Digest'],freeze[k].digest,'Report '+k+' differs');same(report.freezeDigest,freezeDigest,'Report freeze differs');
  requireValue(time(report.startedAt)>=time(freeze.createdAt)&&time(report.completedAt)>=time(report.startedAt),'INVALID_EVIDENCE','Evaluation predates freeze');
  requireValue(reader.ref(report.fullReport).length>0,'INVALID_EVIDENCE','Missing full human report');array(report.limitations);report.limitations.forEach(text);array(report.cases);
  requireValue(report.cases.length===corpus.cases.length&&new Set(report.cases.map(r=>r.key)).size===report.cases.length,'INVALID_EVIDENCE','Missing/duplicate results');
  const byKey=new Map(report.cases.map(r=>[r.key,r]));
  for(const c of corpus.cases){
    const r=byKey.get(c.key);exact(r,['key','status','reason'],['observation','comparison','booleanStatus','reportStatus']);
    requireValue(STATUSES.includes(r.status),'INVALID_EVIDENCE','Unknown result');text(r.reason);
    if(c.applicability==='EXCLUDED'){requireValue(r.status==='EXCLUDED'&&r.reason===c.reason,'INVALID_EVIDENCE','Excluded applicability changed');continue;}
    requireValue(r.status!=='EXCLUDED','INVALID_EVIDENCE','Required case excluded after freeze');
    if(r.status==='NOT_RUN'||r.status==='ERROR')continue;
    const o=reader.refJson(r.observation),comparison=reader.refJson(r.comparison);
    exact(o,['schema','origin','candidateDigest','freezeDigest','transport','operation','request','response','startedAt','completedAt']);
    requireValue(o.schema==='ontology-standards-observation/v1'&&o.origin==='INSTALLED_PUBLIC_PRODUCT'&&['CLI','HTTP','MCP'].includes(o.transport),'INVALID_EVIDENCE','Component diagnosis is not product E2E');text(o.operation);
    same(o.candidateDigest,freeze.candidate.digest,'Observed wrong package');same(o.freezeDigest,freezeDigest,'Observed wrong freeze');reader.ref(o.request);reader.ref(o.response);
    requireValue(time(o.startedAt)>=time(report.startedAt)&&time(o.completedAt)>=time(o.startedAt)&&time(o.completedAt)<=time(report.completedAt),'INVALID_EVIDENCE','Observation outside report interval');
    exact(comparison,['schema','caseKey','evaluatorDigest','expectedDigests','actualDigest','status'],['booleanStatus','reportStatus']);
    requireValue(comparison.schema==='ontology-standards-comparison/v1','INVALID_EVIDENCE','Unknown comparison');same(comparison.caseKey,c.key,'Comparison case differs');same(comparison.evaluatorDigest,freeze.evaluator.digest,'Comparator changed');same(comparison.expectedDigests,c.expectedDigests,'Oracle changed');same(comparison.actualDigest,o.response.digest,'Product response differs');same(comparison.status,r.status,'Comparator status differs');
    if(c.family.startsWith('shacl-')){
      requireValue(['PASS','FAIL'].includes(r.booleanStatus)&&['PASS','FAIL'].includes(r.reportStatus),'INVALID_EVIDENCE','SHACL requires two comparisons');
      same(comparison.booleanStatus,r.booleanStatus,'Boolean comparison differs');same(comparison.reportStatus,r.reportStatus,'Report comparison differs');
      requireValue((r.status==='PASS')===(r.booleanStatus==='PASS'&&r.reportStatus==='PASS'),'INVALID_EVIDENCE','Boolean-only SHACL success');
    }
  }
  const families=summarize(corpus,report.cases,policy.families);same(report.families,families,'Summary differs from frozen denominator');
  same(report.complexView,[...corpus.cases.filter(c=>c.complex).map(c=>c.key)].sort(),'Complex view duplicates or omits upstream IDs');
  return {families,passed:families.every(f=>f.required>0&&f.PASS===f.required&&f.FAIL===0&&f.ERROR===0&&f.NOT_RUN===0)};
}
function inspectReview(ledger,reader,bindings,report){
  exact(ledger,['schema','records']);requireValue(ledger.schema==='ontology-standards-review-ledger/v1','INVALID_EVIDENCE','Unknown review ledger');array(ledger.records,1024);
  if(!ledger.records.length)reject('USER_REVIEW_REQUIRED','Present full report and await explicit approval');
  let previousDigest=null,previousTime=-Infinity;const messages=new Set();
  for(const r of ledger.records){
    exact(r,['previousDigest','decision','digest']);same(r.previousDigest,previousDigest,'Review chain differs');digest(r.digest);
    same(r.digest,hashValue({previousDigest:r.previousDigest,decision:r.decision}),'Review record changed');
    const d=r.decision;exact(d,['schema','actor','action','bindings','reviewedAt','source']);
    requireValue(d.schema==='ontology-standards-review/v1'&&d.actor==='USER'&&['APPROVE_PRODUCT_E2E','REJECT','REQUEST_CHANGES'].includes(d.action),'USER_REVIEW_REQUIRED','Explicit user decision required');
    exact(d.bindings,Object.keys(bindings));Object.values(d.bindings).forEach(digest);
    const source=reader.refJson(d.source);exact(source,['schema','role','threadId','turnId','messageId','text','action','bindings','occurredAt']);
    requireValue(source.schema==='ontology-user-review-source/v1'&&source.role==='user','USER_REVIEW_REQUIRED','Actual user message record required');
    for(const k of ['threadId','turnId','messageId','text'])text(source[k]);const key=[source.threadId,source.turnId,source.messageId].join('/');requireValue(!messages.has(key),'INVALID_EVIDENCE','Repeated user message');messages.add(key);
    same(source.action,d.action,'User action differs');same(source.bindings,d.bindings,'User reviewed different bindings');same(source.occurredAt,d.reviewedAt,'User review time differs');
    requireValue(time(d.reviewedAt)>=previousTime,'INVALID_EVIDENCE','Review order differs');previousTime=time(d.reviewedAt);previousDigest=r.digest;
  }
  const latest=ledger.records.at(-1);same(latest.decision.bindings,bindings,'Latest review is for changed basis');
  requireValue(time(latest.decision.reviewedAt)>=time(report.completedAt),'USER_REVIEW_REQUIRED','Approval predates full report');
  requireValue(latest.decision.action==='APPROVE_PRODUCT_E2E','USER_REVIEW_BLOCKED','Latest user decision blocks progression');
  return {decisionDigest:latest.digest,reviewedAt:latest.decision.reviewedAt};
}

/** Read-only verification. Callers must independently verify the actual Host user
 * message before storing a source record; structured JSON cannot authenticate it. */
export async function checkStandardsGate(root,requested,repositoryRoot=ROOT){
  const governance=await inspectGovernance(repositoryRoot),reader=evidenceReader(root,repositoryRoot);
  const policy=JSON.parse(fileBytes(resolve(repositoryRoot,'governance/standards-gate-v090.json'))),freezeBytes=reader.read('freeze.json'),freeze=JSON.parse(freezeBytes);
  exact(freeze,['schema','createdAt','targetDigest','policyDigest','candidate','toolchain','corpus','evaluator']);
  requireValue(freeze.schema==='ontology-standards-freeze/v1','INVALID_EVIDENCE','Unknown freeze');time(freeze.createdAt);
  same(freeze.targetDigest,governance.targetDigest,'Target changed');same(freeze.policyDigest,governance.target.standardsGateDigest,'Policy changed');
  for(const k of ['candidate','toolchain','corpus','evaluator'])reader.ref(freeze[k]);
  const freezeDigest=hashBytes(freezeBytes),reportBytes=reader.read('report.json'),report=JSON.parse(reportBytes),corpus=reader.refJson(freeze.corpus);
  const bindings={candidateDigest:freeze.candidate.digest,corpusDigest:freeze.corpus.digest,toolchainDigest:freeze.toolchain.digest,reportDigest:hashBytes(reportBytes),freezeDigest,targetDigest:governance.targetDigest};
  exact(requested,['candidateDigest','corpusDigest','toolchainDigest','reportDigest']);
  for(const k of Object.keys(requested)){digest(requested[k]);same(requested[k],bindings[k],'Requested '+k+' differs');}
  inspectCorpus(corpus,reader,policy);const technical=inspectReport(report,corpus,reader,freeze,freezeDigest,policy);
  requireValue(technical.passed,'TECHNICAL_BLOCKED','All frozen required families/cases need complete passing evidence');
  requireValue(existsSync(resolve(root,'review-ledger.json')),'USER_REVIEW_REQUIRED','Present full report and await explicit approval');
  const review=inspectReview(reader.json('review-ledger.json'),reader,bindings,report);reader.recheck();
  const after=await inspectGovernance(repositoryRoot);same(after.targetDigest,governance.targetDigest,'Governance changed during check');
  return {schema:'ontology-product-e2e-admission/v1',status:'ALLOW_PRODUCT_E2E',scope:policy.decisionScope,bindings,...review,families:technical.families,acceptance:'NOT_EVALUATED',releaseAuthorized:false};
}
