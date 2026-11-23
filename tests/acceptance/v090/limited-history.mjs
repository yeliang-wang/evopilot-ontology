// OL06 observer. Historical business records are supplied, never generated here.
// A technical observation still requires source-provenance and standards admission review.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,readSync,readFileSync,writeFileSync,lstatSync,readdirSync,realpathSync,readlinkSync,existsSync} from 'node:fs';
import {isAbsolute,join,relative,resolve,dirname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

const repository=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const SHA=/^sha256:[a-f0-9]{64}$/;
export const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
export const hashBytes=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
export const hashValue=v=>hashBytes(canonical(v));
function equal(a,b,message){assert.equal(hashValue(a),hashValue(b),message);}
function separate(a,b){const r=relative(a,b),s=relative(b,a);assert(r&&s&&(r.startsWith('..'+sep)||isAbsolute(r))&&(s.startsWith('..'+sep)||isAbsolute(s)),'Separate canonical roots required');}
function canonicalPath(p){assert(typeof p==='string'&&isAbsolute(p)&&resolve(p)===p&&realpathSync(p)===p,'Canonical existing path required');return p;}
function regular(p,max=16*1024*1024){canonicalPath(p);const s=lstatSync(p);assert(s.isFile()&&s.nlink===1&&s.size<=max,'Bounded regular unlinked file required');return s;}
function fileHash(p,max=256*1024*1024){
  regular(p,max);const fd=openSync(p,constants.O_RDONLY|constants.O_NOFOLLOW),h=createHash('sha256'),buffer=Buffer.alloc(65536);let total=0;
  try{assert(fstatSync(fd).isFile());for(;;){const n=readSync(fd,buffer,0,buffer.length,null);if(!n)break;total+=n;assert(total<=max,'File byte limit');h.update(buffer.subarray(0,n));}}finally{closeSync(fd);}
  return 'sha256:'+h.digest('hex');
}
function reference(ref,max=16*1024*1024){assert(ref&&SHA.test(ref.digest),'Pinned evidence reference required');assert.equal(fileHash(ref.path,max),ref.digest,'Evidence digest changed');return ref;}
function jsonRef(ref){reference(ref);return JSON.parse(readFileSync(ref.path,'utf8'));}
function scope(s){assert(s&&['public','private'].includes(s.visibility)&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(s.projectId),'Explicit historical scope required');}

/** Reproduces the installed runtime file identity, without importing source or
 * executing an unverified CLI. The public package exports are resolved later. */
export function inspectInstalledRuntime(root,expectedDigest){
  canonicalPath(root);separate(root,repository);assert(SHA.test(expectedDigest));const entries=[];let bytes=0,count=0;
  const visit=dir=>{for(const name of readdirSync(dir).sort()){
    const p=join(dir,name),s=lstatSync(p),path=relative(root,p);assert(++count<=20000,'Runtime file limit');
    if(s.isDirectory()){visit(p);continue;}
    if(s.isSymbolicLink()){
      const target=realpathSync(p),r=relative(root,target),link=readlinkSync(p);
      assert(path.startsWith('node_modules/.bin/')&&!isAbsolute(link)&&!r.startsWith('..')&&!isAbsolute(r)&&lstatSync(target).isFile(),'Unsafe runtime link');
      entries.push({path,kind:'link',digest:hashValue(link),mode:s.mode&0o777});continue;
    }
    bytes+=s.size;assert(bytes<=256*1024*1024,'Runtime byte limit');entries.push({path,kind:'file',digest:fileHash(p),mode:s.mode&0o777});
  }};visit(root);assert.equal(hashValue(entries),expectedDigest,'Installed runtime differs from frozen candidate');
  const packageRoot=join(root,'node_modules/@evopilot-next/ontology'),pkg=JSON.parse(readFileSync(join(packageRoot,'package.json'),'utf8'));
  assert.equal(pkg.name,'@evopilot-next/ontology');assert.equal(pkg.version,'0.9.0');
  return {root,packageRoot,digest:expectedDigest,files:entries.length,bytes};
}

/** This validates a binding, not authenticity. Independent review must confirm
 * the archived producer and receipt actually produced the retained export. */
export function validateHistoryProvenance(config,provenance,record,receipt,preparation,delivery=record.delivery,publication=null){
  assert.equal(config.schema,'ontology-limited-history-input/v1');assert.equal(config.caseId,'OL06');
  assert(SHA.test(config.candidateDigest));assert.match(config.sourceCommit,/^[a-f0-9]{40}$/);
  const h=config.history;scope(h.scope);scope(h.foreignScope);assert.notEqual(h.foreignScope.projectId,h.scope.projectId,'Foreign project must differ');
  assert.equal(provenance.schema,'ontology-historical-output-provenance/v1');assert(['RETAINED_ORIGINAL_OUTPUT','PINNED_PUBLISHED_PRODUCER_FIXTURE'].includes(provenance.origin),'Relabeled outputs and synthetic collector doubles cannot satisfy OL06');
  assert.equal(provenance.exportDigest,h.export.digest);assert.equal(provenance.receiptDigest,h.receipt.digest);
  assert.equal(provenance.producer.artifactDigest,h.producerArtifact.digest);assert.notEqual(h.producerArtifact.digest,config.candidateDigest);
  assert.match(provenance.producer.sourceCommit,/^[a-f0-9]{40}$/);assert.notEqual(provenance.producer.sourceCommit,config.sourceCommit,'Original producer must differ from new candidate');
  assert.match(provenance.producer.packageVersion,/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/);
  assert(Number.isFinite(Date.parse(provenance.recordedAt)),'Original observation time required');
  assert(['0.1.0','0.1.1','0.2.0'].includes(provenance.producer.deliveryInterfaceVersion),'Unsupported historical delivery interface');
  assert.equal(delivery?.manifest?.productVersion,provenance.producer.deliveryInterfaceVersion);equal(delivery.model,record.model,'Original pure delivery model differs');
  assert.equal(record.model?.specVersion,'v1');assert.equal(record.model.id,h.id);assert.equal(record.model.version,h.version);equal(record.scope,h.scope,'Export scope differs');
  assert.equal(receipt.requestId,h.requestId);equal(receipt.scope,h.scope,'Receipt scope differs');
  if(receipt.operation==='asset.put'){
    assert.equal(record.delivery,null,'A draft receipt cannot prove publication');assert.equal(receipt.result.digest,record.digest);assert.equal(receipt.result.id,h.id);assert.equal(receipt.result.version,h.version);
    assert(h.delivery&&provenance.deliveryDigest===h.delivery.digest,'Separate original pure delivery output required');assert.equal(delivery.buildReport.authority,false);assert.equal(delivery.buildReport.businessConfirmed,false);assert.equal(delivery.buildReport.released,false);
  }else{assert.equal(receipt.operation,'asset.publish');equal(receipt.result.delivery,record.delivery,'Original publish receipt does not bind exported delivery');assert.equal(receipt.result.reference.digest,record.delivery.digest);}
  if(provenance.origin==='PINNED_PUBLISHED_PRODUCER_FIXTURE'){
    assert(publication&&provenance.publicationEvidence,'Published original package evidence required');assert.equal(publication.schema,'evopilot-release-readback/v1');assert.equal(publication.stage,'published');assert.equal(publication.status,'PASS');
    assert.equal(publication.sourceCommit,provenance.producer.sourceCommit);assert.equal('sha256:'+publication.expectedDigest,h.producerArtifact.digest);assert.equal(publication.remote.draft,false);assert.equal(publication.remote.tagCommit,provenance.producer.sourceCommit);
    assert.equal(preparation.mode,'FRESH_PUBLISHED_PACKAGE_OWNER');
  }else assert.equal(preparation.mode,'EXISTING_ISOLATED_OWNER');
  assert.equal(preparation.schema,'ontology-historical-read-preparation/v1');
  assert.equal(preparation.workspaceRoot,h.workspace.root);assert.equal(preparation.workspaceId,h.workspace.workspaceId);
  assert.equal(preparation.businessDigest,h.workspace.businessDigest);assert.equal(preparation.exportDigest,h.export.digest);assert.equal(preparation.receiptDigest,h.receipt.digest);
  assert.equal(preparation.noBusinessRewrites,true);assert.equal(preparation.quiescent,true);assert.equal(preparation.dailyInstallation,false);
  assert(SHA.test(preparation.ownerPreparationEvidence.digest),'Pinned owner preparation evidence required');
  return {producer:provenance.producer,origin:provenance.origin,scope:h.scope,id:h.id,version:h.version,deliveryDigest:delivery.digest,receiptOperation:receipt.operation};
}

/** Read-only evidence snapshot: immutable SQL values and asset blob bytes.
 * SQLite journal metadata is not claimed to be byte-identical after opening. */
export function historicalBusinessSnapshot(root){
  canonicalPath(root);separate(root,repository);const dbPath=join(root,'state/ontology/ontology.db');regular(dbPath,64*1024*1024);
  // Even a read-only connection to a WAL-mode DB can leave an empty WAL and
  // SHM metadata. Nonempty write journals are not admitted or checkpointed here.
  for(const suffix of ['-wal','-journal'])if(existsSync(dbPath+suffix))assert.equal(regular(dbPath+suffix,64*1024*1024).size,0,'Quiescent checkpointed fixture required');
  if(existsSync(dbPath+'-shm'))regular(dbPath+'-shm',128*1024);
  const db=new DatabaseSync(dbPath,{readOnly:true,allowExtension:false,timeout:1000});let tables,stateVersion;
  try{
    db.exec('PRAGMA query_only=ON');assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');stateVersion=db.prepare('PRAGMA user_version').get().user_version;
    assert([1,2,3,4,5].includes(stateVersion),'Known historical workspace schema required');
    const schema=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();assert(schema.length<=64);
    let rows=0;tables=schema.map(({name,sql})=>{assert(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name));const values=db.prepare('SELECT * FROM "'+name+'" LIMIT 4097').all();rows+=values.length;assert(values.length<=4096&&rows<=20000,'Historical row budget');return {name,sql,rows:values.map(canonical).sort()};});
    assert(['state','receipts','audit'].every(n=>schema.some(s=>s.name===n)),'Original historical tables required');
  }finally{db.close();}
  assert(Buffer.byteLength(canonical(tables))<=32*1024*1024,'Historical record byte budget');
  const files=[];let bytes=0,count=0;
  const visit=p=>{const s=lstatSync(p);assert(!s.isSymbolicLink(),'No links in historical asset inventory');assert(++count<=10000);if(s.isDirectory()){for(const n of readdirSync(p).sort())visit(join(p,n));return;}bytes+=s.size;assert(bytes<=64*1024*1024);files.push({path:relative(root,p),digest:fileHash(p,16*1024*1024),mode:s.mode&0o777});};
  visit(join(root,'workspace.json'));const pub=join(root,'public/ontology');if(existsSync(pub))visit(pub);
  const projects=join(root,'private/projects');if(existsSync(projects)){canonicalPath(projects);for(const n of readdirSync(projects).sort()){canonicalPath(join(projects,n));const p=join(projects,n,'ontology');if(existsSync(p))visit(p);}}
  return {schema:'ontology-historical-business-snapshot/v1',stateVersion,tablesDigest:hashValue(tables),files,digest:hashValue({stateVersion,tables,files})};
}

/** Pure observation helper. It cannot load a runtime or emit OL06 acceptance. */
export function observeHistoricalReads(api,service,h,record,receipt,delivery=record.delivery){
  const observations=[];const checked=(id,fn)=>{fn();observations.push({id,status:'PASS'});};
  const read=(operation,input,selected=h.scope)=>service.execute({operation,scope:selected,input});
  const identity={id:h.id,version:h.version};
  checked('exact-asset-read',()=>equal(read('asset.inspect',identity),record,'Historical asset changed'));
  checked('exact-receipt-read',()=>equal(read('receipt.inspect',{requestId:h.requestId}),receipt,'Historical receipt changed'));
  checked('delivery-verification',()=>{const result=api.verifyDelivery(delivery);assert.equal(result.valid,true);assert.equal(result.digest,delivery.digest);assert.equal(result.authority,false);});
  checked('cross-project-denied',()=>assert.throws(()=>read('asset.inspect',identity,h.foreignScope),{code:'NOT_FOUND'}));
  checked('cross-visibility-denied',()=>assert.throws(()=>read('asset.inspect',identity,{...h.scope,visibility:h.scope.visibility==='private'?'public':'private'}),{code:'NOT_FOUND'}));
  checked('foreign-receipt-denied',()=>assert.throws(()=>read('receipt.inspect',{requestId:h.requestId},h.foreignScope),{code:'NOT_FOUND'}));
  checked('tampered-delivery-rejected',()=>{const bad=structuredClone(delivery);bad.model.concepts[0].label+=' altered';assert.equal(api.verifyDelivery(bad).valid,false);});
  checked('unknown-schema-rejected',()=>assert.equal(api.validateOntology({...record.model,specVersion:'unknown-ol06'}).valid,false));
  checked('retired-mutation-denied',()=>assert.throws(()=>service.execute({operation:'asset.put',scope:h.scope,input:{model:record.model},requestId:'ol06-must-not-write',expectedRevision:read('workspace.inspect',{}).revision}),{code:'HISTORICAL_READ_ONLY'}));
  return observations;
}

export async function runLimitedHistory(config){
  assert.equal(process.versions.node,'24.14.0','Use pinned Node 24.14.0');
  const h=config.history;assert(h,'Original historical evidence is required');
  const record=jsonRef(h.export),receipt=jsonRef(h.receipt),provenance=jsonRef(h.provenance),preparation=jsonRef(h.workspace.preparation);
  const delivery=h.delivery?jsonRef(h.delivery):record.delivery,publication=provenance.publicationEvidence?jsonRef(provenance.publicationEvidence):null;
  reference(h.producerArtifact,256*1024*1024);reference(preparation.ownerPreparationEvidence);
  const selected=validateHistoryProvenance(config,provenance,record,receipt,preparation,delivery,publication);
  const runtime=inspectInstalledRuntime(config.runtime.root,config.runtime.digest),root=canonicalPath(h.workspace.root);separate(root,runtime.root);
  const evidence=[h.export,h.receipt,h.provenance,h.workspace.preparation,preparation.ownerPreparationEvidence,...(h.delivery?[h.delivery]:[]),...(provenance.publicationEvidence?[provenance.publicationEvidence]:[])];
  for(const ref of [...evidence,h.producerArtifact])separate(root,canonicalPath(ref.path));
  const before=historicalBusinessSnapshot(root);assert.equal(before.digest,h.workspace.businessDigest,'Prepared business inventory changed');
  const pkg=JSON.parse(readFileSync(join(runtime.packageRoot,'package.json'),'utf8'));
  const load=async entry=>{const declared=pkg.exports[entry]?.import;assert(typeof declared==='string'&&declared.startsWith('./dist/'),'Installed public ESM export required');const p=canonicalPath(resolve(runtime.packageRoot,declared));assert(p.startsWith(join(runtime.packageRoot,'dist')+sep),'Only installed public compiled API allowed');return import(pathToFileURL(p).href);};
  const api=await load('.'),{createOntologyService}=await load('./service');
  let service,observations;
  try{service=createOntologyService({workspaceRoot:root,workspaceId:h.workspace.workspaceId});service.initialize();observations=observeHistoricalReads(api,service,h,record,receipt,delivery);}
  finally{
    service?.close();assert.equal(historicalBusinessSnapshot(root).digest,before.digest,'Historical business rows or blobs changed');
    for(const ref of evidence)reference(ref);
    reference(h.producerArtifact,256*1024*1024);inspectInstalledRuntime(config.runtime.root,config.runtime.digest);
  }
  return {schema:'ontology-limited-history-observation/v1',caseId:'OL06',status:'OBSERVED',technicalStatus:'PASS',acceptance:'REVIEW_REQUIRED',authority:false,releaseAuthorized:false,
    bindings:{candidateDigest:config.candidateDigest,sourceCommit:config.sourceCommit,runtimeDigest:runtime.digest,collectorDigest:fileHash(fileURLToPath(import.meta.url)),inputDigest:hashValue(config),export:h.export,receipt:h.receipt,provenance:h.provenance,preparation:h.workspace.preparation,producerArtifact:h.producerArtifact,businessDigest:before.digest,...(h.delivery?{delivery:h.delivery}:{}),...(provenance.publicationEvidence?{publicationEvidence:provenance.publicationEvidence}:{})},
    selected,observations:[...observations,{id:'business-and-original-evidence-preserved',status:'PASS'}],
    limitations:['Technical observation requires independent historical provenance review and candidate-bound standards admission.','Only the selected v1 asset/delivery interface and retained public reader are exercised.','No old installation upgrade, v2 schema migration, old-engine execution, desktop journey or release authority is established.']};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);assert.deepEqual([args[0],args[2]],['--input','--output']);assert.equal(args.length,4);
  const input=canonicalPath(args[1]),output=resolve(args[3]);assert(isAbsolute(args[3])&&realpathSync(dirname(output))===dirname(output));separate(output,repository);assert(!existsSync(output),'Output must be new');
  let result;try{regular(input);const config=JSON.parse(readFileSync(input,'utf8'));separate(output,config.runtime.root);separate(output,config.history.workspace.root);result=await runLimitedHistory(config);}
  catch(error){result={schema:'ontology-limited-history-observation/v1',caseId:'OL06',status:'BLOCKED',technicalStatus:'NOT_ESTABLISHED',acceptance:'NOT_EVALUATED',authority:false,releaseAuthorized:false,problem:{code:error.code??'HISTORY_EVIDENCE_INVALID',message:String(error.message).slice(0,1000)}};process.exitCode=1;}
  writeFileSync(output,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({caseId:result.caseId,status:result.status,technicalStatus:result.technicalStatus,acceptance:result.acceptance,output}));
}
