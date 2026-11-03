import {runOwnedWorker} from '../installation/worker-process.js';
import type {WorkerObservation} from '../installation/worker-process.js';
import {join} from 'node:path';
import {operatorLock,outsideSource,assertSeparate} from '../installation/files.js';
import {privatePath} from '../standalone/workspace.js';
import {exact,hash,hashBytes} from '../standalone/validation.js';
import {fail,ServiceError} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {boundedJSON} from '../reasoning/request.js';
import {validateSHACLRequest,shaclIdentities,SHACL_LIMITS} from './shacl-request.js';
import type {SHACLResponse,SHACLStatus} from './shacl-request.js';
import {readSHACLToolchain,verifySHACLToolchain} from './shacl-toolchain.js';

const statuses:SHACLStatus[]=['CONFORMS','NONCONFORMING','INVALID_INPUT','MISSING_IMPORT','INCOMPLETE_COVERAGE','UNSUPPORTED','TIMEOUT','CANCELLED','FAILED'];
export const SHACL_PYTHON_ARGUMENTS=Object.freeze(['-I','-B']);
export function createSHACLRunner(options:{toolchainFile:string;workRoot:string}){
  const binding=readSHACLToolchain(options.toolchainFile);
  privatePath(options.workRoot,true);const workRoot=outsideSource(options.workRoot);
  assertSeparate(workRoot,binding.root);assertSeparate(workRoot,binding.runtimeRoot);
  return {
    toolchainDigest:binding.digest,
    async run(value:unknown,options:{timeoutMs?:number;signal?:AbortSignal}&WorkerObservation={}):Promise<SHACLResponse>{
      validateSHACLRequest(value);const request=structuredClone(value),identities=shaclIdentities(request),timeoutMs=options.timeoutMs??SHACL_LIMITS.taskMs;
      if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>SHACL_LIMITS.taskMs)fail('INVALID_INPUT','SHACL deadline exceeds the fixed envelope');
      const configurationDigest=hash({timeoutMs,python:[...SHACL_PYTHON_ARGUMENTS],inference:'none',metaSHACL:true,advanced:false,js:false,imports:false,limits:{...SHACL_LIMITS}}),started=performance.now();
      const envelope={schema:'ontology-shacl-result/v2' as const,requestId:request.requestId,...identities,configurationDigest,toolchainDigest:binding.digest};
      const failure=(status:SHACLStatus,code:string,message:string,result:Json={}):SHACLResponse=>({...envelope,status,complete:false,elapsedMs:Math.ceil(performance.now()-started),result,error:{code,message}});
      if(options.signal?.aborted)return failure('CANCELLED','CANCELLED_BEFORE_START','Cancelled before validation');
      let unlock:()=>void;
      try{unlock=operatorLock(workRoot);}catch(e){if(e instanceof ServiceError&&e.code==='INSTALLATION_BUSY')fail('VALIDATOR_BUSY','The owner already has an active validation worker',409);throw e;}
      try{
        verifySHACLToolchain(binding);
        if(options.signal?.aborted)return failure('CANCELLED','CANCELLED_BEFORE_START','Cancelled before validation');
        const {outcome,stdout,stderr}=await runOwnedWorker({workRoot,requestId:request.requestId,requestDigest:identities.requestDigest,configurationDigest,toolchainDigest:binding.digest,
          executable:binding.python,args:[...SHACL_PYTHON_ARGUMENTS,join(binding.root,'worker.py')],env:{PATH:'',LANG:'C.UTF-8',TZ:'UTC',PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1',TMPDIR:workRoot},
          input:JSON.stringify({request,...identities,configurationDigest,limits:SHACL_LIMITS}),timeoutMs,outputBytes:SHACL_LIMITS.outputBytes,diagnosticBytes:SHACL_LIMITS.diagnosticBytes,signal:options.signal,beforeDispatch:options.beforeDispatch});
        const diagnostic={stderrDigest:hashBytes(stderr),stderrBytes:outcome.stderrBytes,exitCode:outcome.exitCode,signal:outcome.signal};
        if(outcome.reason){const status:SHACLStatus=outcome.reason==='TASK_DEADLINE'?'TIMEOUT':['CANCELLED','OWNER_LOST'].includes(outcome.reason)?'CANCELLED':'FAILED';return failure(status,outcome.reason,'Owned validation worker did not complete; retained process exit is confirmed',diagnostic);}
        if(outcome.state!=='EXITED'||outcome.exitCode!==0)return failure('FAILED','WORKER_EXIT','Validation worker did not complete',diagnostic);
        try{
          const actual:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(stdout));boundedJSON(actual,SHACL_LIMITS.outputBytes);
          exact(actual,['schema','requestId',...Object.keys(identities),'configurationDigest','status','complete','result','error']);
          if(actual.schema!=='ontology-shacl-worker-result/v2'||actual.requestId!==request.requestId||Object.entries(identities).some(([k,v])=>actual[k]!==v)||actual.configurationDigest!==configurationDigest||!statuses.includes(actual.status as SHACLStatus)||typeof actual.complete!=='boolean')throw Error('Worker identity mismatch');
          const formal=actual.status==='CONFORMS'||actual.status==='NONCONFORMING';
          if(actual.complete!==formal)throw Error('Invalid completion state');
          if(formal){
            exact(actual.result,['viewKind','dataTriples','shapeTriples','coverage','reportTurtle','results']);
            if(actual.error!==null||actual.result.viewKind!==request.view.kind||typeof actual.result.reportTurtle!=='string'||!actual.result.reportTurtle||!Array.isArray(actual.result.results)||!Array.isArray(actual.result.coverage)||actual.result.coverage.length!==request.expectations.requiredShapes.length)throw Error('Missing native report or coverage');
            if(actual.status==='CONFORMS'&&actual.result.results.length||actual.status==='NONCONFORMING'&&!actual.result.results.length)throw Error('Native conformance and report disagree');
            const seen=new Set<string>();
            for(const c of actual.result.coverage){exact(c,['shapeIri','minimumFocusCount','requiredFocusIris','actualFocusNodes','complete']);const expected=request.expectations.requiredShapes.find(e=>e.shapeIri===c.shapeIri);if(!expected||seen.has(expected.shapeIri)||c.complete!==true||c.minimumFocusCount!==expected.minimumFocusCount||!Array.isArray(c.requiredFocusIris)||hash(c.requiredFocusIris as Json)!==hash([...expected.requiredFocusIris].sort())||!Array.isArray(c.actualFocusNodes)||c.actualFocusNodes.length<expected.minimumFocusCount||c.actualFocusNodes.some(n=>typeof n!=='string')||new Set(c.actualFocusNodes).size!==c.actualFocusNodes.length||expected.requiredFocusIris.some(iri=>!(c.actualFocusNodes as unknown[]).includes('<'+iri+'>')))throw Error('Incomplete target coverage');seen.add(expected.shapeIri);}
          }else{exact(actual.error,['code','message']);if(typeof actual.error.code!=='string'||typeof actual.error.message!=='string')throw Error('Invalid worker error');}
          verifySHACLToolchain(binding);
          return {...envelope,status:actual.status as SHACLStatus,complete:actual.complete,elapsedMs:Math.ceil(performance.now()-started),result:actual.result as Json,error:actual.error as SHACLResponse['error']};
        }catch(e){return failure('FAILED',e instanceof ServiceError?e.code:'WORKER_PROTOCOL','Malformed, mismatched or changed validation execution; no conformance established',diagnostic);}
      }finally{unlock();}
    },
  };
}
