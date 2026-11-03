import {createConnection} from 'node:net';
import {dirname} from 'node:path';
import {lstatSync} from 'node:fs';
import {privatePath} from '../standalone/workspace.js';
import {fail} from '../standalone/types.js';
import {exact,id,text} from '../standalone/validation.js';

export interface RunRecord {schema:'ontology-managed-run/v1';installationId:string;runId:string;createdAt:string;pid:number|null;controlSocket:string;state:'STARTING'|'RUNNING'|'STOPPED'|'FAILED';origin:string|null;error:string|null;}
export function validateRun(value:unknown):asserts value is RunRecord{
  exact(value,['schema','installationId','runId','createdAt','pid','controlSocket','state','origin','error']);
  if(value.schema!=='ontology-managed-run/v1')fail('INVALID_STATE','Unknown managed run');
  id(value.installationId);id(value.runId);text(value.createdAt,40);text(value.controlSocket,1000);
  if(value.pid!==null&&(!Number.isSafeInteger(value.pid)||(value.pid as number)<1))fail('INVALID_STATE','Invalid process identity');
  if(!['STARTING','RUNNING','STOPPED','FAILED'].includes(value.state as string))fail('INVALID_STATE','Invalid managed run state');
  if(value.origin!==null)text(value.origin,100);if(value.error!==null)text(value.error,96);
}
export function processPresent(pid:number|null):boolean|null{
  if(pid===null)return null;
  try{process.kill(pid,0);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')return false;return null;}
}
export async function operatorRequest(run:RunRecord,operation:'status'|'stop'):Promise<RunRecord>{
  privatePath(dirname(run.controlSocket),true);
  const s=lstatSync(run.controlSocket);
  if(!s.isSocket()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o077))fail('UNSAFE_PATH','Private owned control socket required');
  return new Promise((resolve,reject)=>{
    const socket=createConnection(run.controlSocket);let data='';let finished=false;
    const done=(error?:Error,value?:RunRecord)=>{if(finished)return;finished=true;socket.destroy();error?reject(error):resolve(value!);};
    socket.setTimeout(2000,()=>done(new Error('Control timeout')));socket.on('error',e=>done(e));
    socket.on('connect',()=>socket.write(JSON.stringify({installationId:run.installationId,runId:run.runId,operation})+'\n'));
    socket.on('data',chunk=>{data+=chunk.toString('utf8');if(Buffer.byteLength(data)>4096){done(new Error('Control output budget'));return;}
      if(!data.includes('\n'))return;try{const value:unknown=JSON.parse(data.split('\n')[0]);validateRun(value);if(value.installationId!==run.installationId||value.runId!==run.runId)fail('IDENTITY_MISMATCH','Foreign managed process',403);done(undefined,value);}catch(e){done(e instanceof Error?e:new Error('Control response'));}});
    socket.on('end',()=>{if(!finished)done(new Error('Control closed without receipt'));});
  });
}
