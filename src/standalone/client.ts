import { isAbsolute } from 'node:path';
import { privateRead } from './workspace.js';
import { exact, id, text, validateRequest } from './validation.js';
import { LIMITS, ServiceError, fail } from './types.js';
import {requestTimeoutMs} from './request-budget.js';
import type { Json, ServiceRequest } from './types.js';

export interface Connection {
  schema:'ontology-connection/v1'; origin:string; workspaceId:string; serviceId:string;
  projectId:string; credentialFile:string;
}
function validateConnection(c: unknown): asserts c is Connection {
  exact(c,['schema','origin','workspaceId','serviceId','projectId','credentialFile']);
  if(c.schema!=='ontology-connection/v1') fail('INVALID_INPUT','Unknown connection schema');
  id(c.workspaceId);id(c.serviceId);id(c.projectId);text(c.origin,100);text(c.credentialFile);
  // Credentials cannot be redirected to remote, browser, aliased or credential-bearing origins.
  if(!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(c.origin)||Number(c.origin.split(':').at(-1))>65535||!isAbsolute(c.credentialFile)) fail('UNSAFE_CONNECTION','Explicit loopback origin and credential file required');
}
export function readConnection(path: string): Connection {
  if(!isAbsolute(path)) fail('UNSAFE_PATH','Absolute private connection file required');
  const c: unknown=JSON.parse(privateRead(path,8192));validateConnection(c);return c;
}
export async function sendRequest(connection: Connection,request: ServiceRequest,write: boolean): Promise<Json> {
  validateConnection(connection);
  validateRequest(request,write);
  if(request.workspaceId!==connection.workspaceId||request.serviceId!==connection.serviceId||request.projectId!==connection.projectId) fail('IDENTITY_MISMATCH','Request differs from selected connection',403);
  const token=privateRead(connection.credentialFile,256);
  if(!/^[A-Za-z0-9_-]{43}$/.test(token)) fail('UNAUTHENTICATED','Invalid local credential file',401);
  let response: Response;
  try {
    response=await fetch(connection.origin+'/v1/request',{method:'POST',redirect:'error',signal:AbortSignal.timeout(requestTimeoutMs(request.operation)),
      headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(request)});
    if(!response.headers.get('content-type')?.startsWith('application/json')||!response.body) throw new Error('Unexpected response');
    const reader=response.body.getReader(),parts:Uint8Array[]=[];let bytes=0;
    while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;
      if(bytes>LIMITS.responseBytes+256){await reader.cancel();throw new Error('Response exceeds budget');}parts.push(next.value);}
    const data:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
    if(response.ok){exact(data,['ok','result']);if(data.ok!==true)throw new Error('Unexpected result');return data.result as Json;}
    exact(data,['ok','error']);exact(data.error,['code','message']);text(data.error.code,96);text(data.error.message);
    if(data.ok!==false)throw new Error('Unexpected failure');
    throw new ServiceError(data.error.code,data.error.message,response.status);
  } catch(e) {
    if(e instanceof ServiceError)throw e;
    fail(write?'REQUEST_UNKNOWN':'SERVICE_UNAVAILABLE',write?'Response uncertain: inspect the original request receipt; do not create a replacement request ID':'Service response unavailable; inspect the selected local connection',503);
  }
}
