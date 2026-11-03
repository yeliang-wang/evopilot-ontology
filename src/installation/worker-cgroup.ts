import {constants,openSync,closeSync,fstatSync,statfsSync,realpathSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {basename,dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {fail} from '../standalone/types.js';

/** Internal Linux mechanism. Installation selection and launch fencing must bind
 * this identity before it can become an owner task's recovery evidence. */
export const WORKER_MEMORY_BYTES=2*1024**3;
const CGROUP2=0x63677270;
const decimal=/^(0|[1-9][0-9]*)$/;
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export interface WorkerCgroup {
  schema:'ontology-worker-cgroup/v1';root:string;path:string;bootId:string;
  rootDevice:string;rootInode:string;device:string;inode:string;uid:number;
  memoryMax:2147483648;swapMax:0;pidsMax:128;
}
export interface WorkerCgroupSnapshot {
  identity:WorkerCgroup;memoryCurrent:number;memoryPeak:number;pidsCurrent:number;
  populated:boolean;memoryEvents:Record<string,number>;observedAt:string;
}
function unsupported():void {
  if(process.platform!=='linux')fail('WORKER_ISOLATION_UNAVAILABLE','Linux cgroup v2 is required; native process limits are not substituted',409);
}
function bootId():string {
  const value=readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
  if(!uuid.test(value))fail('WORKER_ISOLATION_UNAVAILABLE','Kernel boot identity is unavailable',409);
  return value;
}
function directory(path:string):number {
  const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{
    const s=fstatSync(fd);
    if(!s.isDirectory()||s.uid!==process.geteuid!()||(s.mode&0o022)!==0||statfsSync('/proc/self/fd/'+fd).type!==CGROUP2)
      fail('WORKER_ISOLATION_SCOPE','An explicitly delegated, same-user cgroup v2 directory is required',409);
    return fd;
  }catch(e){closeSync(fd);throw e;}
}
function anchor(fd:number,file:string):string {return '/proc/self/fd/'+fd+'/'+file;}
function read(fd:number,file:string):string {return readFileSync(anchor(fd,file),'utf8').trim();}
function number(value:string):number {
  if(!decimal.test(value)||!Number.isSafeInteger(Number(value)))fail('WORKER_ISOLATION_EVIDENCE','Invalid kernel counter',409);
  return Number(value);
}
function counters(value:string):Record<string,number> {
  const output:Record<string,number>={};
  for(const line of value.split('\n')){
    const parts=line.split(' '),key=parts[0];
    if(parts.length!==2||!key||!/^[a-z_]+$/.test(key)||Object.hasOwn(output,key)||Object.keys(output).length>=32)
      fail('WORKER_ISOLATION_EVIDENCE','Invalid kernel event record',409);
    output[key]=number(parts[1]!);
  }
  return output;
}
function validRoot(root:string):void {
  if(typeof root!=='string'||root.length>4096||!root.startsWith('/sys/fs/cgroup/')||realpathSync(root)!==root)
    fail('WORKER_ISOLATION_SCOPE','Canonical delegated child scope required; the global cgroup root is forbidden',409);
}
function validate(value:WorkerCgroup):void {
  unsupported();
  if(!value||value.schema!=='ontology-worker-cgroup/v1'||typeof value.path!=='string'||typeof value.root!=='string'||
    dirname(value.path)!==value.root||!/^ontology-worker-[0-9a-f]{32}$/.test(basename(value.path))||
    !uuid.test(value.bootId)||value.uid!==process.geteuid!()||value.memoryMax!==WORKER_MEMORY_BYTES||value.swapMax!==0||value.pidsMax!==128||
    ![value.rootDevice,value.rootInode,value.device,value.inode].every(v=>typeof v==='string'&&decimal.test(v)))
    fail('WORKER_ISOLATION_IDENTITY','Invalid worker cgroup identity',409);
  validRoot(value.root);
  if(bootId()!==value.bootId)fail('WORKER_ISOLATION_IDENTITY','Kernel boot changed; retained group identity cannot be reused',409);
}
function withGroup<T>(identity:WorkerCgroup,fn:(fd:number)=>T):T {
  validate(identity);const root=directory(identity.root);let child:number|undefined;
  try{
    const parent=fstatSync(root,{bigint:true});
    if(String(parent.dev)!==identity.rootDevice||String(parent.ino)!==identity.rootInode)
      fail('WORKER_ISOLATION_IDENTITY','Delegated cgroup identity changed',409);
    // The open directory descriptors anchor all control-file operations. A
    // replaced pathname cannot redirect a kill to a different kernel group.
    child=directory(anchor(root,basename(identity.path)));
    const actual=fstatSync(child,{bigint:true});
    if(String(actual.dev)!==identity.device||String(actual.ino)!==identity.inode)
      fail('WORKER_ISOLATION_IDENTITY','Worker cgroup identity changed',409);
    return fn(child);
  }finally{if(child!==undefined)closeSync(child);closeSync(root);}
}
function limits(fd:number):void {
  if(read(fd,'cgroup.type')!=='domain'||read(fd,'memory.max')!==String(WORKER_MEMORY_BYTES)||
    read(fd,'memory.swap.max')!=='0'||read(fd,'memory.oom.group')!=='1'||read(fd,'pids.max')!=='128')
    fail('WORKER_ISOLATION_DRIFT','Worker cgroup limits changed; execution cannot be admitted',409);
}
function snapshot(identity:WorkerCgroup,fd:number):WorkerCgroupSnapshot {
  limits(fd);const events=counters(read(fd,'cgroup.events'));
  if(![0,1].includes(events.populated!))fail('WORKER_ISOLATION_EVIDENCE','Missing population state',409);
  const memoryEvents=counters(read(fd,'memory.events'));
  if(!Object.hasOwn(memoryEvents,'oom_kill')||!Object.hasOwn(memoryEvents,'oom'))fail('WORKER_ISOLATION_EVIDENCE','Missing OOM counters',409);
  return {identity:{...identity},memoryCurrent:number(read(fd,'memory.current')),memoryPeak:number(read(fd,'memory.peak')),
    pidsCurrent:number(read(fd,'pids.current')),populated:events.populated===1,memoryEvents,observedAt:new Date().toISOString()};
}
/** Does not create/delegate a parent, enable controllers, invoke sudo, or move any
 * existing process. The operator must supply an already delegated empty scope. */
export function createWorkerCgroup(root:string):WorkerCgroup {
  unsupported();validRoot(root);const parent=directory(root);let fd:number|undefined;
  try{
    const enabled=read(parent,'cgroup.subtree_control').split(' ');
    if(read(parent,'cgroup.type')!=='domain'||read(parent,'cgroup.procs')!==''||!['memory','pids'].every(v=>enabled.includes(v)))
      fail('WORKER_ISOLATION_UNAVAILABLE','Empty domain delegation with memory and pids controllers required',409);
    const name='ontology-worker-'+randomUUID().replaceAll('-','');mkdirSync(anchor(parent,name),{mode:0o700});
    fd=directory(anchor(parent,name));
    for(const [file,value] of [['memory.max',String(WORKER_MEMORY_BYTES)],['memory.swap.max','0'],['memory.oom.group','1'],['pids.max','128']])
      writeFileSync(anchor(fd,file!),value!);
    const p=fstatSync(parent,{bigint:true}),s=fstatSync(fd,{bigint:true});
    const identity:WorkerCgroup={schema:'ontology-worker-cgroup/v1',root,path:join(root,name),bootId:bootId(),
      rootDevice:String(p.dev),rootInode:String(p.ino),device:String(s.dev),inode:String(s.ino),uid:process.geteuid!(),
      memoryMax:2147483648,swapMax:0,pidsMax:128};
    if(snapshot(identity,fd).populated)fail('WORKER_ISOLATION_SCOPE','New worker group is unexpectedly populated',409);
    return identity;
  }finally{if(fd!==undefined)closeSync(fd);closeSync(parent);}
}
/** Call only in the newly spawned executable launcher. It moves itself (0),
 * never a caller-supplied or recovered PID. Limits precede engine execution. */
export function enterWorkerCgroup(identity:WorkerCgroup):void {
  withGroup(identity,fd=>{
    limits(fd);writeFileSync(anchor(fd,'cgroup.procs'),'0');
    const membership=readFileSync('/proc/self/cgroup','utf8').trim();
    if(membership!=='0::'+identity.path.slice('/sys/fs/cgroup'.length))fail('WORKER_ISOLATION_EVIDENCE','Worker did not enter its pinned group',409);
  });
}
export function inspectWorkerCgroup(identity:WorkerCgroup):WorkerCgroupSnapshot {
  return withGroup(identity,fd=>snapshot(identity,fd));
}
/** Whole-group cancellation, including descendants that create new sessions.
 * Empty is an observation, not a durable no-relaunch fence or a task outcome. */
export async function killWorkerCgroup(identity:WorkerCgroup):Promise<WorkerCgroupSnapshot> {
  withGroup(identity,fd=>writeFileSync(anchor(fd,'cgroup.kill'),'1'));
  const deadline=performance.now()+5000;
  for(;;){
    const state=inspectWorkerCgroup(identity);
    if(!state.populated)return state;
    if(performance.now()>=deadline)fail('WORKER_ISOLATION_PENDING','Worker cgroup is still populated; retain uncertain task state',409);
    await delay(20);
  }
}
