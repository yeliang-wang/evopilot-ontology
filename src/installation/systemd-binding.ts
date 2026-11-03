import {execFileSync} from 'node:child_process';
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {fileDigest} from './runtime.js';
import {exact,digest,hash,text} from '../standalone/validation.js';
import type {Json} from '../standalone/types.js';
import {fail} from '../standalone/types.js';

interface Executable {path:string;digest:string;}
export interface SystemdBinding {
  schema:'ontology-systemd-binding/v1';uid:number;runtimeDirectory:string;machineId:string;
  managerVersion:string;run:Executable;bus:Executable;manager:Executable;node:Executable;digest:string;
}
export interface OwnerProcess {bootId:string;pid:number;startTicks:string;}
export interface SystemdSelection {binding:SystemdBinding;owner:OwnerProcess;}
export const systemdEnvironment=(binding:Pick<SystemdBinding,'runtimeDirectory'>)=>({PATH:'',LANG:'C.UTF-8',TZ:'UTC',
  XDG_RUNTIME_DIR:binding.runtimeDirectory,DBUS_SESSION_BUS_ADDRESS:'unix:path='+binding.runtimeDirectory+'/bus'});
export function bootIdentity():string {
  if(process.platform!=='linux')fail('WORKER_ISOLATION_UNAVAILABLE','A selected Linux systemd user manager is required',409);
  const value=readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value))fail('WORKER_ISOLATION_UNAVAILABLE','Invalid kernel boot identity',409);
  return value;
}
export function ownerProcess(pid=process.pid):OwnerProcess {
  const bootId=bootIdentity();
  const stat=readFileSync('/proc/'+pid+'/stat','utf8'),fields=stat.slice(stat.lastIndexOf(') ')+2).trim().split(' '),startTicks=fields[19];
  if(!startTicks||!/^[1-9][0-9]*$/.test(startTicks)||['Z','X'].includes(fields[0]))fail('WORKER_ISOLATION_EVIDENCE','Invalid or terminated owner process birth identity',409);
  return {bootId,pid,startTicks};
}
export function ownerPresent(expected:OwnerProcess):boolean {
  try{return hash({...ownerProcess(expected.pid)})===hash({...expected});}catch{return false;}
}
export function validateSystemdBinding(b:unknown):asserts b is SystemdBinding {
  exact(b,['schema','uid','runtimeDirectory','machineId','managerVersion','run','bus','manager','node','digest']);
  if(b.schema!=='ontology-systemd-binding/v1'||!Number.isSafeInteger(b.uid)||(b.uid as number)<1||b.runtimeDirectory!=='/run/user/'+b.uid||
    typeof b.machineId!=='string'||!/^sha256:[a-f0-9]{64}$/.test(b.machineId)||typeof b.managerVersion!=='string'||!/^255\./.test(b.managerVersion))
    fail('WORKER_ISOLATION_BINDING','Unsupported systemd binding',409);
  for(const key of ['run','bus','manager','node']){const f=b[key];exact(f,['path','digest']);text(f.path,4096);digest(f.digest);if(typeof f.path!=='string'||!f.path.startsWith('/')||/[\0\r\n]/.test(f.path))fail('WORKER_ISOLATION_BINDING','Invalid systemd executable binding',409);}
  digest(b.digest);const {digest:bound,...identity}=b;if(hash(identity as Json)!==bound)fail('WORKER_ISOLATION_BINDING','Systemd binding digest differs',409);
}
export function validateSystemdSelection(value:unknown):asserts value is SystemdSelection {
  exact(value,['binding','owner']);validateSystemdBinding(value.binding);const o=value.owner;
  exact(o,['bootId','pid','startTicks']);text(o.bootId,36);text(o.startTicks,32);
  if(typeof o.bootId!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(o.bootId)||!Number.isSafeInteger(o.pid)||(o.pid as number)<1||typeof o.startTicks!=='string'||!/^\d+$/.test(o.startTicks))fail('WORKER_ISOLATION_BINDING','Invalid initiating owner identity',409);
}
/** Additive identity leaves historical native configuration hashes unchanged. */
export const workerIsolationConfiguration=(bindingDigest:string|null):Record<string,Json>=>bindingDigest===null?{}:{workerIsolation:{protocol:'ontology-owned-worker/v2',bindingDigest}};
/** Typed D-Bus JSON, fixed local user socket, bounded output/deadline, no shell. */
export function systemdCall(binding:SystemdBinding,path:string,iface:string,method:string,signature='',args:string[]=[]):unknown {
  try{
    const output=execFileSync(binding.bus.path,['--user','--json=short','--timeout=2s','call','org.freedesktop.systemd1',path,iface,method,...(signature?[signature,...args]:[])],
      {encoding:'utf8',env:systemdEnvironment(binding),timeout:3000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']});
    if(!output.trim())return [];
    const value:unknown=JSON.parse(output);exact(value,['type','data']);if(!Array.isArray(value.data))throw Error('Invalid bus envelope');return value.data;
  }catch{fail('WORKER_MANAGER_UNAVAILABLE','Exact user-manager response is unavailable; retain uncertain execution state',409);}
}
function property(binding:SystemdBinding,name:string):unknown {
  const reply=systemdCall(binding,'/org/freedesktop/systemd1','org.freedesktop.DBus.Properties','Get','ss',['org.freedesktop.systemd1.Manager',name]) as {data:unknown}[];
  return reply[0]?.data;
}
export function inspectSystemdBinding():SystemdBinding {
  bootIdentity();const uid=process.geteuid!(),runtimeDirectory='/run/user/'+uid;
  if(uid===0)fail('WORKER_ISOLATION_BINDING','Select an ordinary user manager, not a system/root manager',409);
  const s=lstatSync(runtimeDirectory);if(!s.isDirectory()||s.uid!==uid||(s.mode&0o077)!==0||realpathSync(runtimeDirectory)!==runtimeDirectory)fail('WORKER_ISOLATION_BINDING','Private same-user manager scope required',409);
  const executable=(path:string):Executable=>{path=realpathSync(path);return {path,digest:fileDigest(path)};};
  const partial={schema:'ontology-systemd-binding/v1' as const,uid,runtimeDirectory,machineId:hash(readFileSync('/etc/machine-id','utf8').trim()),
    managerVersion:'',run:executable('/usr/bin/systemd-run'),bus:executable('/usr/bin/busctl'),manager:executable('/usr/lib/systemd/systemd'),node:executable(process.execPath)};
  partial.managerVersion=String(property(partial as SystemdBinding,'Version'));
  const result={...partial,digest:hash(partial as unknown as Json)};
  validateSystemdSelection({binding:result,owner:ownerProcess()});return result;
}
export function verifySystemdBinding(binding:SystemdBinding):void {
  validateSystemdSelection({binding,owner:ownerProcess()});
  const actual=inspectSystemdBinding();if(actual.digest!==binding.digest)fail('WORKER_ISOLATION_DRIFT','Selected manager, Node, platform or executable bytes changed; no fallback execution',409);
}
export function managerEnvironmentNames(binding:SystemdBinding):string[] {
  const value=property(binding,'Environment');if(!Array.isArray(value)||value.some(v=>typeof v!=='string'))fail('WORKER_MANAGER_UNAVAILABLE','Manager environment names unavailable',409);
  return [...new Set((value as string[]).map(v=>v.split('=',1)[0]).filter(v=>/^[A-Za-z_][A-Za-z_0-9]*$/.test(v)))];
}
