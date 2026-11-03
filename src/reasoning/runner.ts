import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {operatorLock,outsideSource,assertSeparate} from '../installation/files.js';
import {privatePath} from '../standalone/workspace.js';
import {exact,hash,hashBytes} from '../standalone/validation.js';
import {fail,ServiceError} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';
import {validateDLRequest,closureDigest,boundedJSON} from './request.js';
import {readDLToolchain,verifyDLToolchain,javaClasspath} from './toolchain.js';
import {DL_LIMITS} from './types.js';
import type {DLRequest,DLResponse,DLStatus} from './types.js';

// Heap, direct memory and JVM metadata are bounded separately. These flags are not
// evidence of a total-process 2 GiB hard limit; P4 must establish that limit separately.
export const DL_JVM_ARGUMENTS=Object.freeze(['-Xms32m','-Xmx1024m','-Xss512k','-XX:MaxMetaspaceSize=128m','-XX:MaxDirectMemorySize=128m','-XX:ReservedCodeCacheSize=64m','-XX:ActiveProcessorCount=1','-XX:+UseSerialGC','-Dfile.encoding=UTF-8','-Duser.timezone=UTC','-Djavax.xml.accessExternalDTD=','-Djavax.xml.accessExternalSchema=']);
const statuses:DLStatus[]=['COMPLETED','ENTAILED','NOT_ENTAILED','INCONSISTENT','INVALID_INPUT','MISSING_IMPORT','TIMEOUT','CANCELLED','FAILED'];

export function createDLRunner(options:{toolchainFile:string;workRoot:string}){
  const binding=readDLToolchain(options.toolchainFile);
  privatePath(options.workRoot,true);const workRoot=outsideSource(options.workRoot);
  assertSeparate(workRoot,binding.root);assertSeparate(workRoot,binding.javaRoot);
  return {
    toolchainDigest:binding.digest,
    async run(value:unknown,options:{timeoutMs?:number;signal?:AbortSignal}={}):Promise<DLResponse>{
      validateDLRequest(value);
      // Copy admitted input before asynchronous execution so caller mutation cannot change it.
      const request:DLRequest=structuredClone(value),requestDigest=hash(request as unknown as Json),closure=closureDigest(request.closure);
      const maximum=request.task.kind==='explanation'?DL_LIMITS.explanationMs:DL_LIMITS.taskMs,timeoutMs=options.timeoutMs??maximum;
      if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>maximum)fail('INVALID_INPUT','Deadline outside fixed task budget');
      const configurationDigest=hash({timeoutMs,jvm:[...DL_JVM_ARGUMENTS],limits:{...DL_LIMITS}}),started=performance.now();
      const envelope={schema:'ontology-dl-result/v1' as const,requestId:request.requestId,requestDigest,closureDigest:closure,configurationDigest,toolchainDigest:binding.digest};
      const failure=(status:DLStatus,code:string,message:string,result:Json={}):DLResponse=>({...envelope,status,complete:false,elapsedMs:Math.ceil(performance.now()-started),result,error:{code,message}});
      if(options.signal?.aborted)return failure('CANCELLED','CANCELLED_BEFORE_START','Cancelled before worker execution');
      let unlock:()=>void;
      try{unlock=operatorLock(workRoot);}catch(e){if(e instanceof ServiceError&&e.code==='INSTALLATION_BUSY')fail('REASONER_BUSY','The owner already has an active reasoning worker',409);throw e;}
      try{
        verifyDLToolchain(binding);
        if(options.signal?.aborted)return failure('CANCELLED','CANCELLED_BEFORE_START','Cancelled before worker execution');
        const input=JSON.stringify({...request,schema:'ontology-dl-worker-request/v1',requestDigest,closureDigest:closure,configurationDigest,timeoutMs});
        return await new Promise<DLResponse>(resolve=>{
          const child=spawn(join(binding.javaRoot,'bin/java'),[...DL_JVM_ARGUMENTS,'-Djava.io.tmpdir='+workRoot,'-cp',javaClasspath(binding),'io.evopilot.ontology.Worker'],{cwd:workRoot,stdio:['pipe','pipe','pipe'],env:{PATH:join(binding.javaRoot,'bin'),LANG:'C.UTF-8',TZ:'UTC',JAVA_TOOL_OPTIONS:'',JDK_JAVA_OPTIONS:'',_JAVA_OPTIONS:''}});
          let outputBytes=0,errorBytes=0,spawnFailed=false,terminal:{status:DLStatus;code:string;message:string}|null=null;
          const output:Buffer[]=[],diagnostics:Buffer[]=[];
          const terminate=(status:DLStatus,code:string,message:string)=>{if(terminal)return;terminal={status,code,message};child.kill('SIGKILL');};
          const timer=setTimeout(()=>terminate('TIMEOUT','TASK_DEADLINE','Worker deadline reached; partial output discarded'),timeoutMs);
          const abort=()=>terminate('CANCELLED','CANCELLED','Worker cancellation confirmed by process exit');options.signal?.addEventListener('abort',abort,{once:true});
          if(options.signal?.aborted)abort();
          child.on('error',()=>{spawnFailed=true;});child.stdin.on('error',()=>{});
          child.stdout.on('data',(chunk:Buffer)=>{outputBytes+=chunk.length;if(outputBytes>DL_LIMITS.outputBytes+4096)terminate('FAILED','OUTPUT_LIMIT','Worker output exceeds fixed budget');else output.push(chunk);});
          child.stderr.on('data',(chunk:Buffer)=>{errorBytes+=chunk.length;if(errorBytes>65536)terminate('FAILED','DIAGNOSTIC_LIMIT','Worker diagnostics exceed fixed budget');else diagnostics.push(chunk);});
          child.once('close',(code,signal)=>{
            clearTimeout(timer);options.signal?.removeEventListener('abort',abort);
            const diagnostic={stderrDigest:hashBytes(Buffer.concat(diagnostics)),stderrBytes:errorBytes,exitCode:code,signal};
            if(terminal){resolve(failure(terminal.status,terminal.code,terminal.message,diagnostic));return;}
            if(spawnFailed||code!==0){const memory=Buffer.concat(diagnostics).includes(Buffer.from('OutOfMemoryError'));resolve(failure('FAILED',memory?'MEMORY_LIMIT':'WORKER_EXIT','Formal worker did not produce a completed response',diagnostic));return;}
            try{
              const actual:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(output)));boundedJSON(actual,DL_LIMITS.outputBytes+4096);
              exact(actual,['schema','requestId','requestDigest','closureDigest','configurationDigest','status','complete','result','error']);
              if(actual.schema!=='ontology-dl-worker-result/v1'||actual.requestId!==request.requestId||actual.requestDigest!==requestDigest||actual.closureDigest!==closure||actual.configurationDigest!==configurationDigest||!statuses.includes(actual.status as DLStatus)||typeof actual.complete!=='boolean')throw new Error('Worker identity mismatch');
              if(['INVALID_INPUT','MISSING_IMPORT','TIMEOUT','CANCELLED','FAILED'].includes(actual.status as string)&&actual.complete)throw new Error('Failure marked complete');
              if(actual.error!==null){exact(actual.error,['code','message']);if(typeof actual.error.code!=='string'||typeof actual.error.message!=='string')throw new Error('Invalid diagnostic');}
              resolve({...envelope,status:actual.status as DLStatus,complete:actual.complete,elapsedMs:Math.ceil(performance.now()-started),result:actual.result as Json,error:actual.error as DLResponse['error']});
            }catch{resolve(failure('FAILED','WORKER_PROTOCOL','Malformed or mismatched worker response; no logical conclusion established',diagnostic));}
          });
          child.stdin.end(input);
        });
      }finally{unlock();}
    },
  };
}
