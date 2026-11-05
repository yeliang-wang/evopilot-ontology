import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,realpathSync} from 'node:fs';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createDLRunner} from '../../../dist/reasoning/runner.js';
import {readDLToolchain} from '../../../dist/reasoning/toolchain.js';
import {hash,hashBytes} from '../../../dist/standalone/validation.js';
import {privatePath} from '../../../dist/standalone/workspace.js';
import {outsideSource,operatorLock} from '../../../dist/installation/files.js';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const sourceLock=JSON.parse(readFileSync(new URL('./w3c-source.json',import.meta.url),'utf8'));
const extractor=fileURLToPath(new URL('./extract-w3c.py',import.meta.url));

// Independent upstream expected values are evaluated against a completed formal
// response, never against generated examples or an expectation inferred from output.
export function matchesExpected(expected,response){
  if(response?.complete!==true||response.error!==null||response.result?.legal!==true)return false;
  switch(expected){
    case 'legality':return response.status==='COMPLETED';
    case 'consistent':return response.status==='COMPLETED'&&response.result.consistent===true;
    case 'inconsistent':return response.status==='INCONSISTENT'&&response.result.consistent===false;
    case 'entailed':return response.status==='ENTAILED'&&response.result.consistent===true;
    case 'not-entailed':return response.status==='NOT_ENTAILED'&&response.result.consistent===true;
    default:throw new Error('Unknown external expectation');
  }
}

export function validateDataset(value){
  assert.equal(value.schema,'ontology-w3c-extracted/v1');assert.deepEqual(value.source,sourceLock);
  assert.equal(value.extractor.sha256,hashBytes(readFileSync(extractor)));
  assert.equal(value.cases.length,sourceLock.caseCount);assert.equal(new Set(value.cases).size,sourceLock.caseCount);
  assert.equal(value.jobs.length,sourceLock.jobCount);assert.equal(new Set(value.jobs.map(x=>x.id)).size,sourceLock.jobCount);
  const counts={},cases=new Set();
  for(const job of value.jobs){
    assert.match(job.id,/^[a-f0-9]{64}$/);assert(value.cases.includes(job.case));cases.add(job.case);
    assert.equal(job.request.requestId,'w3c-'+job.id);assert.equal(job.request.schema,'ontology-dl-request/v1');
    assert(Object.hasOwn(sourceLock.expectedCounts,job.expected));counts[job.expected]=(counts[job.expected]??0)+1;
  }
  assert.equal(cases.size,sourceLock.caseCount);assert.deepEqual(counts,sourceLock.expectedCounts);
}

function treeFiles(dir){
  return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const path=join(dir,entry.name);assert(!entry.isSymbolicLink(),'Evidence cannot follow source-tree symlinks');
    return entry.isDirectory()?treeFiles(path):[path];
  });
}
function artifacts(){
  const paths=['src','dist','toolchains'].flatMap(p=>treeFiles(join(root,p)));
  paths.push(...['package.json','package-lock.json','tests/acceptance/v090/dl.mjs','tests/acceptance/v090/extract-w3c.py','tests/acceptance/v090/w3c-source.json'].map(p=>join(root,p)));
  return paths.sort().map(path=>({path:relative(root,path),digest:hashBytes(readFileSync(path))}));
}
function writeNew(path,value){writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});}
function git(args){
  const result=spawnSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});
  assert.equal(result.status,0,result.stderr);return result.stdout;
}

export async function collect(options){
  for(const name of ['archive','python','toolchain','output'])assert(isAbsolute(options[name]),name+' requires an absolute path');
  const archive=readFileSync(options.archive);assert.equal(archive.length,sourceLock.bytes);assert.equal(hashBytes(archive),'sha256:'+sourceLock.sha256);
  const binding=readDLToolchain(options.toolchain);
  assert.equal(binding.workerSourceDigest,hashBytes(readFileSync(join(root,'toolchains/owl2-dl/Worker.java'))),'Installed worker is stale');
  assert.equal(binding.dependencyLockDigest,hashBytes(readFileSync(join(root,'toolchains/owl2-dl/dependencies.json'))));
  const dependencies=JSON.parse(readFileSync(join(root,'toolchains/owl2-dl/dependencies.json')));
  assert.equal(dependencies.enginePatch.file,'engine-compat.json');
  assert.equal(hashBytes(readFileSync(join(root,'toolchains/owl2-dl/engine-compat.json'))),'sha256:'+dependencies.enginePatch.sha256);
  // Preserve the selected venv entry path; resolving its executable symlink before
  // launch would silently lose the venv's pinned RDFLib installation.
  const python=options.python,extracted=spawnSync(python,[extractor,'--archive',options.archive,'--lock',join(root,'tests/acceptance/v090/w3c-source.json')],{encoding:'utf8',timeout:30000,maxBuffer:64*1024*1024,env:{PATH:process.env.PATH,LANG:'C.UTF-8',PYTHONDONTWRITEBYTECODE:'1'}});
  assert.equal(extracted.status,0,extracted.stderr);const dataset=JSON.parse(extracted.stdout);validateDataset(dataset);
  const allArtifacts=artifacts(),sourceIdentity={head:git(['rev-parse','HEAD']).trim(),diffDigest:hashBytes(git(['diff','--binary','HEAD'])),artifactsDigest:hash(allArtifacts)};
  const manifest={schema:'ontology-w3c-collection/v1',sourceIdentity,artifactFiles:allArtifacts,source:sourceLock,
    datasetDigest:hash(dataset),toolchainDigest:binding.digest,extractor:dataset.extractor,
    node:{version:process.version,digest:hashBytes(readFileSync(process.execPath))},python:{executable:python,binary:realpathSync(python),digest:hashBytes(readFileSync(python))},
    deadlineMs:options.timeoutMs??120000,limit:options.limit??null,case:options.case??null,
    authority:false,productAcceptance:'NOT_EVALUATED'};
  outsideSource(dirname(options.output));
  if(!existsSync(options.output))mkdirSync(options.output,{mode:0o700});
  privatePath(options.output,true);const output=outsideSource(options.output);
  const unlock=operatorLock(output);
  try{
    const manifestPath=join(output,'manifest.json');
    if(existsSync(manifestPath))assert.deepEqual(JSON.parse(readFileSync(manifestPath,'utf8')),manifest,'Resume requires identical source/tool/input/selection; use a new output for changed evidence');
    else{writeNew(manifestPath,manifest);writeNew(join(output,'inputs.json'),dataset);}
    const worker=join(output,'worker'),receipts=join(output,'receipts');
    for(const dir of [worker,receipts]){if(!existsSync(dir))mkdirSync(dir,{mode:0o700});privatePath(dir,true);}
    const runner=createDLRunner({toolchainFile:options.toolchain,workRoot:worker});
    let jobs=dataset.jobs;if(options.case)jobs=jobs.filter(job=>job.case===options.case);assert(jobs.length>0,'No selected jobs');
    if(options.limit!==undefined){assert(Number.isSafeInteger(options.limit)&&options.limit>0);jobs=jobs.slice(0,options.limit);}
    const totals={PASS:0,FAIL:0},failures=[];let index=0;
    for(const job of jobs){
      const path=join(receipts,job.id+'.json');let receipt;
      if(existsSync(path)){
        receipt=JSON.parse(readFileSync(path,'utf8'));assert.equal(receipt.manifestDigest,hash(manifest));assert.equal(receipt.inputDigest,hash(job));
        assert.equal(receipt.status,matchesExpected(job.expected,receipt.response)?'PASS':'FAIL','Retained verdict differs from actual response');
      }else{
        let response=null,error=job.extractionError;
        if(!error)try{response=await runner.run(job.request,{timeoutMs:manifest.deadlineMs});}catch(e){error={code:e.code??'COLLECTION_FAILED',detail:e.message};}
        receipt={schema:'ontology-w3c-receipt/v1',manifestDigest:hash(manifest),inputDigest:hash(job),id:job.id,
          case:job.case,format:job.format,type:job.type,expected:job.expected,
          status:matchesExpected(job.expected,response)?'PASS':'FAIL',response,collectionError:error};
        writeNew(path,receipt);
      }
      totals[receipt.status]++;
      if(receipt.status==='FAIL')failures.push({id:job.id,case:job.case,format:job.format,expected:job.expected,
        actual:receipt.response?.status??null,error:receipt.collectionError??receipt.response?.error??null});
      index++;
      if(index%10===0||receipt.status==='FAIL'||index===jobs.length)process.stdout.write(JSON.stringify({index,total:jobs.length,totals,last:{case:job.case,format:job.format,expected:job.expected,status:receipt.status}})+'\n');
    }
    const sourceUnchanged=hash(artifacts())===manifest.sourceIdentity.artifactsDigest;
    const complete=jobs.length===sourceLock.jobCount&&sourceUnchanged;
    const result={schema:'ontology-w3c-summary/v1',manifestDigest:hash(manifest),complete,sourceUnchanged,totalRequired:sourceLock.jobCount,
      selected:jobs.length,totals,failures,status:!complete?'INCOMPLETE':totals.FAIL?'FAIL':'PASS',
      productAcceptance:'NOT_EVALUATED',fullConformanceProven:false,authority:false};
    // A summary is an observation; existing per-job receipts are never replaced.
    const summaryPath=join(output,'summary-'+hash(result).slice(7)+'.json');if(!existsSync(summaryPath))writeNew(summaryPath,result);
    process.stdout.write(JSON.stringify({summary:summaryPath,status:result.status,totals,complete})+'\n');return result;
  }finally{unlock();}
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  if(process.argv[2]==='--evidence'){
    await (await import('./dl-public.mjs')).collectPublicDL(import.meta.url,{validateDataset,matchesExpected});
  }else{
  const options={};
  for(let i=2;i<process.argv.length;i+=2){
    const name=process.argv[i]?.replace(/^--/,'');assert(['archive','python','toolchain','output','limit','case','timeoutMs'].includes(name),'Unknown argument');
    assert(process.argv[i+1]&&!Object.hasOwn(options,name),'Missing or duplicate argument');
    options[name]=['limit','timeoutMs'].includes(name)?Number(process.argv[i+1]):process.argv[i+1];
  }
  const result=await collect(options);process.exitCode=result.status==='PASS'?0:1;
  }
}
