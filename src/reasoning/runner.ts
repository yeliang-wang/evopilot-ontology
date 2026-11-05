import {runOwnedWorker} from '../installation/worker-process.js';
import type {WorkerObservation} from '../installation/worker-process.js';
import {workerIsolationConfiguration,verifySystemdBinding} from '../installation/systemd-binding.js';
import type {SystemdBinding} from '../installation/systemd-binding.js';
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

export function dlConfiguration(timeoutMs:number,isolationDigest:string|null=null):string {
  return hash({timeoutMs,jvm:[...DL_JVM_ARGUMENTS],limits:{...DL_LIMITS},...workerIsolationConfiguration(isolationDigest)});
}
export function createDLRunner(options:{toolchainFile:string;workRoot:string;systemd?:SystemdBinding}){
  const systemd=options.systemd?structuredClone(options.systemd):undefined;if(systemd)verifySystemdBinding(systemd);
  const binding=readDLToolchain(options.toolchainFile);
  privatePath(options.workRoot,true);const workRoot=outsideSource(options.workRoot);
  assertSeparate(workRoot,binding.root);assertSeparate(workRoot,binding.javaRoot);
  return {
    toolchainDigest:binding.digest,
    workerIsolationDigest:systemd?.digest??null,
    configurationDigest:(timeoutMs:number)=>dlConfiguration(timeoutMs,systemd?.digest??null),
    async run(value:unknown,options:{timeoutMs?:number;signal?:AbortSignal}&WorkerObservation={}):Promise<DLResponse>{
      validateDLRequest(value);
      // Copy admitted input before asynchronous execution so caller mutation cannot change it.
      const request:DLRequest=structuredClone(value),requestDigest=hash(request as unknown as Json),closure=closureDigest(request.closure);
      const maximum=request.task.kind==='explanation'?DL_LIMITS.explanationMs:DL_LIMITS.taskMs,timeoutMs=options.timeoutMs??maximum;
      if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>maximum)fail('INVALID_INPUT','Deadline outside fixed task budget');
      const configurationDigest=dlConfiguration(timeoutMs,systemd?.digest??null),started=performance.now();
      const envelope={schema:'ontology-dl-result/v1' as const,requestId:request.requestId,requestDigest,closureDigest:closure,configurationDigest,toolchainDigest:binding.digest};
      const failure=(status:DLStatus,code:string,message:string,result:Json={}):DLResponse=>({...envelope,status,complete:false,elapsedMs:Math.ceil(performance.now()-started),result,error:{code,message}});
      if(options.signal?.aborted)return failure('CANCELLED','CANCELLED_BEFORE_START','Cancelled before worker execution');
      let unlock:()=>void;
      try{unlock=operatorLock(workRoot);}catch(e){if(e instanceof ServiceError&&e.code==='INSTALLATION_BUSY')fail('REASONER_BUSY','The owner already has an active reasoning worker',409);throw e;}
      try{
        verifyDLToolchain(binding);
        if(options.signal?.aborted)return failure('CANCELLED','CANCELLED_BEFORE_START','Cancelled before worker execution');
        const input=JSON.stringify({...request,schema:'ontology-dl-worker-request/v1',requestDigest,closureDigest:closure,configurationDigest,timeoutMs});
        const {outcome,stdout,stderr}=await runOwnedWorker({workRoot,requestId:request.requestId,requestDigest,configurationDigest,toolchainDigest:binding.digest,
          executable:join(binding.javaRoot,'bin/java'),args:[...DL_JVM_ARGUMENTS,'-Djava.io.tmpdir='+workRoot,'-cp',javaClasspath(binding),'io.evopilot.ontology.Worker'],
          env:{PATH:join(binding.javaRoot,'bin'),LANG:'C.UTF-8',TZ:'UTC',JAVA_TOOL_OPTIONS:'',JDK_JAVA_OPTIONS:'',_JAVA_OPTIONS:''},input,timeoutMs,outputBytes:DL_LIMITS.outputBytes+4096,diagnosticBytes:65536,signal:options.signal,beforeDispatch:options.beforeDispatch,systemd});
        const diagnostic={stderrDigest:hashBytes(stderr),stderrBytes:outcome.stderrBytes,exitCode:outcome.exitCode,signal:outcome.signal};
        if(outcome.reason){const status:DLStatus=outcome.reason==='TASK_DEADLINE'?'TIMEOUT':['CANCELLED','OWNER_LOST'].includes(outcome.reason)?'CANCELLED':'FAILED';return failure(status,outcome.reason,'Owned worker did not complete; retained execution termination or no-launch fence is confirmed',diagnostic);}
        if(outcome.state!=='EXITED'||outcome.exitCode!==0){return failure('FAILED',stderr.includes(Buffer.from('OutOfMemoryError'))?'MEMORY_LIMIT':'WORKER_EXIT','Formal worker did not produce a completed response',diagnostic);}
        try{
          const actual:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(stdout));boundedJSON(actual,DL_LIMITS.outputBytes+4096);
          exact(actual,['schema','requestId','requestDigest','closureDigest','configurationDigest','status','complete','result','error']);
          if(actual.schema!=='ontology-dl-worker-result/v1'||actual.requestId!==request.requestId||actual.requestDigest!==requestDigest||actual.closureDigest!==closure||actual.configurationDigest!==configurationDigest||!statuses.includes(actual.status as DLStatus)||typeof actual.complete!=='boolean')throw new Error('Worker identity mismatch');
          if(['INVALID_INPUT','MISSING_IMPORT','TIMEOUT','CANCELLED','FAILED'].includes(actual.status as string)&&actual.complete)throw new Error('Failure marked complete');
          if(actual.error!==null){exact(actual.error,['code','message']);if(typeof actual.error.code!=='string'||typeof actual.error.message!=='string')throw new Error('Invalid diagnostic');}
          if(request.task.kind==='rdfGraph'){
            if(['ENTAILED','NOT_ENTAILED','INCONSISTENT'].includes(actual.status as string))throw new Error('RDF parsing cannot establish OWL conclusions');
            if(actual.status==='COMPLETED'){
              const result=actual.result;exact(result,['semantics','scope','documentId','documentDigest','documentIri','inputFormat','format','content','graphDigest','statementCount','tripleCount','importsFollowed','inferencePerformed']);
              const selected=request.closure.documents.find(d=>d.id===(request.task as {documentId:string}).documentId)!;
              if(actual.complete!==true||actual.error!==null||result.semantics!=='RDF_1_1_ASSERTED_GRAPH'||result.scope!=='SELECTED_DOCUMENT'||result.documentId!==selected.id||result.documentDigest!==selected.digest||result.documentIri!==selected.documentIri||result.inputFormat!==selected.format||result.format!=='ntriples'||typeof result.content!=='string'||result.graphDigest!==hashBytes(result.content)||result.importsFollowed!==false||result.inferencePerformed!==false)throw new Error('RDF graph result identity mismatch');
              if(!Number.isSafeInteger(result.statementCount)||!Number.isSafeInteger(result.tripleCount)||(result.tripleCount as number)<0||(result.statementCount as number)<(result.tripleCount as number)||(result.statementCount as number)>DL_LIMITS.axioms||result.content.split('\n').length-1!==result.tripleCount||result.tripleCount!==0&&!result.content.endsWith('\n'))throw new Error('RDF graph result count mismatch');
            }
          }
          return {...envelope,status:actual.status as DLStatus,complete:actual.complete,elapsedMs:Math.ceil(performance.now()-started),result:actual.result as Json,error:actual.error as DLResponse['error']};
        }catch{return failure('FAILED','WORKER_PROTOCOL','Malformed or mismatched worker response; no logical conclusion established',diagnostic);}
      }finally{unlock();}
    },
  };
}
