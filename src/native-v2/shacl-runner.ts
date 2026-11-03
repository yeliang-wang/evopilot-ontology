import {spawn} from 'node:child_process';
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
    async run(value:unknown,options:{timeoutMs?:number;signal?:AbortSignal}={}):Promise<SHACLResponse>{
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
        return await new Promise<SHACLResponse>(resolve=>{
          const child=spawn(binding.python,[...SHACL_PYTHON_ARGUMENTS,join(binding.root,'worker.py')],{cwd:workRoot,shell:false,stdio:['pipe','pipe','pipe'],env:{PATH:'',LANG:'C.UTF-8',TZ:'UTC',PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1',TMPDIR:workRoot}});
          let outputBytes=0,errorBytes=0,spawnFailed=false,terminal:{status:SHACLStatus;code:string;message:string}|null=null;
          const output:Buffer[]=[],diagnostics:Buffer[]=[];
          const terminate=(status:SHACLStatus,code:string,message:string)=>{if(terminal)return;terminal={status,code,message};child.kill('SIGKILL');};
          const timer=setTimeout(()=>terminate('TIMEOUT','TASK_DEADLINE','SHACL deadline reached; partial result discarded'),timeoutMs);
          const abort=()=>terminate('CANCELLED','CANCELLED','Cancellation confirmed by worker exit');options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
          child.on('error',()=>{spawnFailed=true;});child.stdin.on('error',()=>{});
          child.stdout.on('data',(b:Buffer)=>{outputBytes+=b.length;if(outputBytes>SHACL_LIMITS.outputBytes)terminate('FAILED','OUTPUT_LIMIT','SHACL output budget exceeded');else output.push(b);});
          child.stderr.on('data',(b:Buffer)=>{errorBytes+=b.length;if(errorBytes>SHACL_LIMITS.diagnosticBytes)terminate('FAILED','DIAGNOSTIC_LIMIT','SHACL diagnostic budget exceeded');else diagnostics.push(b);});
          child.once('close',(code,signal)=>{
            clearTimeout(timer);options.signal?.removeEventListener('abort',abort);
            const diagnostic={stderrDigest:hashBytes(Buffer.concat(diagnostics)),stderrBytes:errorBytes,exitCode:code,signal};
            if(terminal){resolve(failure(terminal.status,terminal.code,terminal.message,diagnostic));return;}
            if(spawnFailed||code!==0){resolve(failure('FAILED','WORKER_EXIT','Validation worker did not complete',diagnostic));return;}
            try{
              const actual:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(output)));boundedJSON(actual,SHACL_LIMITS.outputBytes);
              exact(actual,['schema','requestId',...Object.keys(identities),'configurationDigest','status','complete','result','error']);
              if(actual.schema!=='ontology-shacl-worker-result/v2'||actual.requestId!==request.requestId||Object.entries(identities).some(([k,v])=>actual[k]!==v)||actual.configurationDigest!==configurationDigest||!statuses.includes(actual.status as SHACLStatus)||typeof actual.complete!=='boolean')throw Error('Worker identity mismatch');
              const formal=actual.status==='CONFORMS'||actual.status==='NONCONFORMING';
              if(actual.complete!==formal)throw Error('Invalid completion state');
              if(formal){
                exact(actual.result,['viewKind','dataTriples','shapeTriples','coverage','reportTurtle','results']);
                if(actual.error!==null||actual.result.viewKind!=='asserted'||typeof actual.result.reportTurtle!=='string'||!actual.result.reportTurtle||!Array.isArray(actual.result.results)||!Array.isArray(actual.result.coverage)||actual.result.coverage.length!==request.expectations.requiredShapes.length)throw Error('Missing native report or coverage');
                if(actual.status==='CONFORMS'&&actual.result.results.length||actual.status==='NONCONFORMING'&&!actual.result.results.length)throw Error('Native conformance and report disagree');
                const seen=new Set<string>();
                for(const c of actual.result.coverage){exact(c,['shapeIri','minimumFocusCount','requiredFocusIris','actualFocusNodes','complete']);const expected=request.expectations.requiredShapes.find(e=>e.shapeIri===c.shapeIri);if(!expected||seen.has(expected.shapeIri)||c.complete!==true||c.minimumFocusCount!==expected.minimumFocusCount||!Array.isArray(c.requiredFocusIris)||hash(c.requiredFocusIris as Json)!==hash([...expected.requiredFocusIris].sort())||!Array.isArray(c.actualFocusNodes)||c.actualFocusNodes.length<expected.minimumFocusCount||c.actualFocusNodes.some(n=>typeof n!=='string')||new Set(c.actualFocusNodes).size!==c.actualFocusNodes.length||expected.requiredFocusIris.some(iri=>!(c.actualFocusNodes as unknown[]).includes('<'+iri+'>')))throw Error('Incomplete target coverage');seen.add(expected.shapeIri);}
              }else{exact(actual.error,['code','message']);if(typeof actual.error.code!=='string'||typeof actual.error.message!=='string')throw Error('Invalid worker error');}
              verifySHACLToolchain(binding);
              resolve({...envelope,status:actual.status as SHACLStatus,complete:actual.complete,elapsedMs:Math.ceil(performance.now()-started),result:actual.result as Json,error:actual.error as SHACLResponse['error']});
            }catch(e){resolve(failure('FAILED',e instanceof ServiceError?e.code:'WORKER_PROTOCOL','Malformed, mismatched or changed validation execution; no conformance established',diagnostic));}
          });
          child.stdin.end(JSON.stringify({request,...identities,configurationDigest,limits:SHACL_LIMITS}));
        });
      }finally{unlock();}
    },
  };
}
