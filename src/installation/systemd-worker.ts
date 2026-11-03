import {execFileSync} from 'node:child_process';
import {mkdirSync,readdirSync,lstatSync,readFileSync,writeFileSync,statfsSync,openSync,closeSync,fstatSync,constants} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {privatePath,privateRead} from '../standalone/workspace.js';
import {hash,hashBytes} from '../standalone/validation.js';
import type {Json} from '../standalone/types.js';
import {fail,ServiceError} from '../standalone/types.js';
import {systemdCall,systemdEnvironment,bootIdentity} from './systemd-binding.js';
import {readWorkerAttempt,workerUnitName,fenceSystemdWorker,sealWorkerNotStarted,recordUnitTerminal,recordWorkerEvidence} from './worker-journal.js';
import type {WorkerReference,WorkerPlan,WorkerOutcome,UnitRecord,UnitTerminal} from './worker-journal.js';

const manager='/org/freedesktop/systemd1',managerInterface='org.freedesktop.systemd1.Manager';
const launcher=fileURLToPath(new URL('./worker-supervisor.js',import.meta.url));
// RLIMIT_FSIZE also applies to the supervisor's SQLite journal. Output-specific
// byte limits are enforced before the supervisor writes its bounded buffers.
const fileSizeLimit=512*1024*1024;
const sha=(value:unknown)=>hash(value as Json);
type Properties=Record<string,{type:string;data:unknown}>;
const jobRoot=(r:WorkerReference)=>join(r.root,'unit-jobs',r.attemptId);
function definition(reference:WorkerReference,plan:WorkerPlan){
  const selection=plan.systemd;if(!selection)fail('WORKER_PROTOCOL','Bound systemd plan required');
  const dir=jobRoot(reference),escape=(s:string)=>s.replaceAll('%','%%');
  const properties={Description:'Ontology worker '+reference.intentDigest+' '+reference.journalId,
    MemoryMax:'2147483648',MemorySwapMax:'0',MemoryAccounting:'yes',TasksMax:'128',OOMPolicy:'kill',
    RuntimeMaxSec:plan.timeoutMs+'ms',TimeoutStartSec:'5s',TimeoutStopSec:'1s',RemainAfterExit:'yes',Restart:'no',KillMode:'control-group',
    LimitFSIZE:String(fileSizeLimit),UMask:'0077',NoNewPrivileges:'yes',
    WorkingDirectory:escape(reference.root),StandardInput:'file:'+escape(join(dir,'input')),StandardOutput:'file:'+escape(join(dir,'stdout')),StandardError:'file:'+escape(join(dir,'stderr')),
    Environment:'NODE_OPTIONS= NODE_PATH= NODE_NO_WARNINGS=1 LANG=C.UTF-8 TZ=UTC',
    UnsetEnvironment:'LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT GLIBC_TUNABLES'};
  const argv=[selection.binding.node.path,launcher,'--systemd',JSON.stringify(reference)];
  return {properties,argv,digest:sha({binding:selection.binding.digest,properties,argv})};
}
function properties(reference:WorkerReference,iface:string,path:string):Properties {
  const a=readWorkerAttempt(reference),b=a.intent.systemd!.binding;
  const values=systemdCall(b,path,'org.freedesktop.DBus.Properties','GetAll','s',[iface]) as unknown[];
  if(!values[0]||typeof values[0]!=='object'||Array.isArray(values[0]))fail('WORKER_MANAGER_UNAVAILABLE','Typed unit properties unavailable',409);
  return values[0] as Properties;
}
function value(p:Properties,key:string,type:string):unknown {
  if(p[key]?.type!==type)fail('WORKER_UNIT_CHANGED','Required unit property is absent or has another type',409);
  return p[key].data;
}
function unitState(reference:WorkerReference){
  const a=readWorkerAttempt(reference),plan=a.intent,b=plan.systemd!.binding,d=definition(reference,plan);
  if(bootIdentity()!==plan.systemd!.owner.bootId)fail('WORKER_UNIT_CHANGED','Kernel boot changed; original invocation is not established',409);
  const found=systemdCall(b,manager,managerInterface,'GetUnit','s',[workerUnitName(reference)]) as unknown[];
  if(typeof found[0]!=='string'||!found[0].startsWith(manager+'/unit/'))fail('WORKER_UNIT_CHANGED','Invalid manager unit identity',409);
  const u=properties(reference,'org.freedesktop.systemd1.Unit',found[0]),s=properties(reference,'org.freedesktop.systemd1.Service',found[0]);
  const check=(p:Properties,key:string,type:string,expected:unknown)=>{if(sha(value(p,key,type))!==sha(expected))fail('WORKER_UNIT_CHANGED','Selected unit property differs: '+key,409);};
  check(u,'Id','s',workerUnitName(reference));check(u,'Description','s',d.properties.Description);
  for(const [key,type,expected] of [['MemoryMax','t',2147483648],['MemorySwapMax','t',0],['TasksMax','t',128],['OOMPolicy','s','kill'],['RemainAfterExit','b',true],['Restart','s','no'],['KillMode','s','control-group'],['RuntimeMaxUSec','t',plan.timeoutMs*1000],['LimitFSIZE','t',fileSizeLimit],['NoNewPrivileges','b',true]] as const)check(s,key,type,expected);
  const commands=value(s,'ExecStart','a(sasbttttuii)');
  if(!Array.isArray(commands)||commands.length!==1||!Array.isArray(commands[0])||commands[0][0]!==b.node.path||sha(commands[0][1])!==sha(d.argv))fail('WORKER_UNIT_CHANGED','Unit executable or arguments differ',409);
  const bytes=value(u,'InvocationID','ay');
  if(!Array.isArray(bytes)||bytes.length!==16||!bytes.every(n=>Number.isInteger(n)&&n>=0&&n<=255))fail('WORKER_UNIT_CHANGED','Unit invocation identity unavailable',409);
  const invocationId=Buffer.from(bytes).toString('hex');
  if(a.unit&&(a.unit.invocationId!==invocationId||a.unit.configurationDigest!==d.digest))fail('WORKER_UNIT_CHANGED','Original invocation was replaced',409);
  return {attempt:a,definition:d,u,s,invocationId};
}
/** Called inside the actual manager-created supervisor, before engine dispatch. */
export function admittingSystemdUnit(reference:WorkerReference):UnitRecord {
  const {attempt:a,definition:d,s,invocationId}=unitState(reference),controlGroup=value(s,'ControlGroup','s');
  if(value(s,'MainPID','u')!==process.pid||typeof controlGroup!=='string'||!controlGroup.startsWith('/user.slice/user-'+a.intent.systemd!.binding.uid+'.slice/')||readFileSync('/proc/self/cgroup','utf8').trim()!=='0::'+controlGroup)fail('WORKER_UNIT_CHANGED','Supervisor is not inside the selected unit',409);
  const path='/sys/fs/cgroup'+controlGroup,stat=lstatSync(path,{bigint:true});
  if(statfsSync(path).type!==0x63677270||readFileSync(join(path,'memory.max'),'utf8').trim()!=='2147483648'||readFileSync(join(path,'memory.swap.max'),'utf8').trim()!=='0'||readFileSync(join(path,'memory.oom.group'),'utf8').trim()!=='1'||readFileSync(join(path,'pids.max'),'utf8').trim()!=='128')fail('WORKER_ISOLATION_DRIFT','Kernel unit limits do not match the selected budget',409);
  return {schema:'ontology-worker-unit/v1',unitName:workerUnitName(reference),invocationId,bootId:bootIdentity(),supervisorPid:process.pid,configurationDigest:d.digest,controlGroup,device:String(stat.dev),inode:String(stat.ino),recordedAt:new Date().toISOString()};
}
function terminal(reference:WorkerReference):UnitTerminal|null {
  const {attempt:a,u,s}=unitState(reference);
  if(!a.unit)return null;
  const activeState=value(u,'ActiveState','s'),subState=value(u,'SubState','s'),mainPid=value(s,'MainPID','u');
  if(!['active/exited','failed/failed'].includes(activeState+'/'+subState)||mainPid!==0)return null;
  const group=value(s,'ControlGroup','s');
  if(group!==''){
    if(group!==a.unit.controlGroup)fail('WORKER_UNIT_CHANGED','Unit kernel scope changed',409);
    const path='/sys/fs/cgroup'+group;
    try{
      const stat=lstatSync(path,{bigint:true});
      if(String(stat.dev)!==a.unit.device||String(stat.ino)!==a.unit.inode)fail('WORKER_UNIT_CHANGED','Unit kernel identity changed',409);
      if(!/^populated 0$/m.test(readFileSync(join(path,'cgroup.events'),'utf8')))return null;
    }catch(e){
      // The manager can remove the group between its property snapshot and
      // this read. Wait for its explicit empty ControlGroup; absence is no proof.
      if((e as NodeJS.ErrnoException).code==='ENOENT')return null;
      throw e;
    }
  }
  const pid=value(s,'ExecMainPID','u'),code=value(s,'ExecMainCode','i'),status=value(s,'ExecMainStatus','i'),peak=value(s,'MemoryPeak','t');
  if(pid!==a.unit.supervisorPid||!Number.isSafeInteger(code)||!Number.isSafeInteger(status))fail('WORKER_UNIT_CHANGED','Unit terminal process identity differs',409);
  return {unit:a.unit,activeState:String(activeState),subState:String(subState),result:String(value(s,'Result','s')),execMainPid:pid as number,execMainCode:code as number,execMainStatus:status as number,mainPid:0,empty:true,memoryPeak:Number.isSafeInteger(peak)&&Number(peak)>=0?Number(peak):null,recordedAt:new Date().toISOString()};
}
function output(reference:WorkerReference):{stdout:Buffer;stderr:Buffer} {
  const a=readWorkerAttempt(reference),root=jobRoot(reference);privatePath(root,true);
  const read=(file:string,limit:number)=>{
    const path=join(root,file);privatePath(path);const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid!()||(stat.mode&0o077)!==0||stat.size>limit)fail('WORKER_OUTCOME_UNKNOWN','Unit output is not bounded and private',409);
      const bytes=readFileSync(fd);if(bytes.length>limit)fail('WORKER_OUTCOME_UNKNOWN','Unit output grew beyond its bound',409);return bytes;
    }finally{closeSync(fd);}
  };
  return {stdout:read('stdout',a.intent.outputBytes),stderr:read('stderr',a.intent.diagnosticBytes)};
}
function prepare(reference:WorkerReference,input:string):void {
  const a=readWorkerAttempt(reference),base=join(reference.root,'unit-jobs');
  if(hashBytes(input)!==a.intent.stdinDigest||Buffer.byteLength(input)!==a.intent.stdinBytes)fail('WORKER_PROTOCOL','Bound unit input differs');
  try{mkdirSync(base,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}privatePath(base,true);
  const entries=readdirSync(base);if(entries.length>=64)fail('WORKER_JOB_LIMIT','Retained unit jobs reached their fixed count budget',409);
  let bytes=0;for(const name of entries){const path=join(base,name);privatePath(path,true);for(const file of readdirSync(path)){const p=join(path,file);privatePath(p);bytes+=lstatSync(p).size;}}
  if(bytes+a.intent.stdinBytes+a.intent.outputBytes+a.intent.diagnosticBytes>512*1024*1024)fail('WORKER_JOB_LIMIT','Retained unit jobs reached their fixed byte budget',409);
  const root=jobRoot(reference);mkdirSync(root,{mode:0o700});writeFileSync(join(root,'input'),input,{mode:0o600,flag:'wx'});
  for(const name of ['stdout','stderr'])writeFileSync(join(root,name),'',{mode:0o600,flag:'wx'});
}
/** Stop the exact invocation, not a PID. This does not stop or reset other units. */
export function requestSystemdStop(reference:WorkerReference,reason:NonNullable<WorkerOutcome['reason']>):boolean {
  fenceSystemdWorker(reference,reason);const {attempt:a,u,s}=unitState(reference);
  if(['exited','failed'].includes(String(value(u,'SubState','s')))&&value(s,'MainPID','u')===0&&value(s,'ControlGroup','s')==='')return true;
  try{systemdCall(a.intent.systemd!.binding,manager,managerInterface,'KillUnit','ssi',[workerUnitName(reference),'all','9']);return true;}
  catch(e){
    // A manager can report an auxiliary-signal error after killing the main
    // process. The durable fence remains; only subsequent terminal evidence
    // can prove closure. Do not retry a possibly effective control request.
    if(e instanceof ServiceError&&e.code==='WORKER_MANAGER_UNAVAILABLE')return false;
    throw e;
  }
}
/** Reconcile only already-terminal manager evidence. A missing unit is not exit
 * proof. This operation never retries StartTransientUnit or recovers a result. */
export function reconcileSystemdWorker(reference:WorkerReference):boolean {
  let a=readWorkerAttempt(reference);if(!a.intent.systemd)fail('WORKER_PROTOCOL','Bound unit required');
  if(!a.unit){
    if(a.fence){sealWorkerNotStarted(reference);return true;}
    const {u,s}=unitState(reference);
    if(['exited','failed'].includes(String(value(u,'SubState','s')))&&value(s,'MainPID','u')===0&&value(s,'ControlGroup','s')===''){
      const result=value(s,'Result','s');fenceSystemdWorker(reference,result==='oom-kill'?'MEMORY_LIMIT':result==='timeout'?'TASK_DEADLINE':'SPAWN_FAILED');sealWorkerNotStarted(reference);return true;
    }
    return false;
  }
  // A committed terminal receipt survives later unit garbage collection. Never
  // replace it with a new invocation or require a still-live manager to replay it.
  const ended=a.terminal??terminal(reference);if(!ended)return false;
  if(!a.outcome){
    const why=a.fence?.reason??(ended.result==='oom-kill'?'MEMORY_LIMIT':ended.result==='timeout'?'TASK_DEADLINE':'SUPERVISOR_LOST');
    fenceSystemdWorker(reference,why);
  }
  recordUnitTerminal(reference,ended);a=readWorkerAttempt(reference);
  if(!a.outcome){
    const {stdout,stderr}=output(reference);
    recordWorkerEvidence(reference,'outcome',{state:'GROUP_TERMINATED',reason:a.fence!.reason,workerPid:a.worker?.pid??null,exitCode:null,signal:null,stdoutDigest:hashBytes(stdout),stderrDigest:hashBytes(stderr),stdoutBytes:stdout.length,stderrBytes:stderr.length,recordedAt:new Date().toISOString()});
  }
  return true;
}
export async function runSystemdOwnedWorker(reference:WorkerReference,input:string,signal?:AbortSignal):Promise<{outcome:WorkerOutcome;stdout:Buffer;stderr:Buffer}> {
  const plan=readWorkerAttempt(reference).intent,b=plan.systemd!.binding;
  try{prepare(reference,input);}catch(e){fenceSystemdWorker(reference,'SPAWN_FAILED');sealWorkerNotStarted(reference);throw e;}
  const d=definition(reference,plan),deadline=performance.now()+plan.timeoutMs;
  try{
    // Exactly one start request. Lost acknowledgment is an uncertain attempt.
    execFileSync(b.run.path,['--user','--quiet','--expand-environment=no','--unit='+workerUnitName(reference),'--service-type=exec',...Object.entries(d.properties).map(([k,v])=>'--property='+k+'='+v),'--',...d.argv],
      {env:systemdEnvironment(b),encoding:'utf8',timeout:7000,maxBuffer:65536,stdio:['ignore','pipe','pipe']});
    let stopSent=false;
    for(;;){
      const a=readWorkerAttempt(reference);
      if(!stopSent&&(signal?.aborted||performance.now()>=deadline)){
        requestSystemdStop(reference,signal?.aborted?'CANCELLED':'TASK_DEADLINE');stopSent=true;
      }
      if(reconcileSystemdWorker(reference)){
        const observed=readWorkerAttempt(reference),bytes=observed.outcome?.state==='NOT_STARTED'&&!observed.unit?{stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)}:output(reference);
        if(!observed.outcome||observed.unit&&!observed.terminal||observed.terminal?.result!=='success'&&observed.outcome.reason===null||hashBytes(bytes.stdout)!==observed.outcome.stdoutDigest||hashBytes(bytes.stderr)!==observed.outcome.stderrDigest||hashBytes(privateRead(join(jobRoot(reference),'input'),50*1024*1024))!==plan.stdinDigest)fail('WORKER_OUTCOME_UNKNOWN','Unit input/output or closure differs',409);
        return {outcome:observed.outcome,...bytes};
      }
      if(performance.now()>deadline+10000)fail('WORKER_OUTCOME_UNKNOWN','Unit terminal observation is incomplete',409);
      await delay(50);
    }
  }catch(e){fail('WORKER_OUTCOME_UNKNOWN','Bound unit outcome is uncertain'+(e instanceof ServiceError?' ['+e.code+']':'')+'; retain its exact attempt and inspect manager evidence',409);}
}
