import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { createStandaloneService } from './service.js';
import { createOntologyMcp, validateMcpEnvelope } from './mcp.js';
import { LIMITS, ServiceError, fail } from './types.js';
import { json } from './validation.js';
import { REQUEST_BUDGETS, ownerRequestBudget, requestTimeoutMs } from './request-budget.js';
import type { ReasoningConfiguration } from '../native-v2/tasks.js';

const token = (request: IncomingMessage): string => {
  const header=request.headers.authorization;
  if (typeof header!=='string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) fail('UNAUTHENTICATED','Bearer credential required',401);
  return header.slice(7);
};
async function discardRejectedBody(req: IncomingMessage):Promise<void>{
  if(req.complete||req.destroyed)return;
  // This refusal allowance stays small even when document admission grows.
  await new Promise<void>(resolve=>{
    let bytes=0;
    const finish=()=>{clearTimeout(timer);req.off('data',data);req.off('end',finish);req.off('error',finish);req.off('close',finish);req.pause();resolve();};
    const data=(part:Buffer)=>{bytes+=part.length;if(bytes>2*LIMITS.requestBytes)finish();};
    const timer=setTimeout(finish,250);timer.unref();
    req.on('data',data);req.once('end',finish);req.once('error',finish);req.once('close',finish);req.resume();
  });
}
async function readBody(req:IncomingMessage,maxBytes:number,timeoutMs:number):Promise<Buffer>{
  if(req.destroyed)fail('REQUEST_ABORTED','Request body was interrupted',400);
  return new Promise<Buffer>((resolve,reject)=>{
    const parts:Buffer[]=[];let size=0;
    const cleanup=()=>{clearTimeout(timer);req.off('data',data);req.off('end',end);req.off('error',error);req.off('aborted',aborted);req.off('close',aborted);};
    const error=(e:Error)=>{cleanup();parts.length=0;req.pause();reject(e);};
    const aborted=()=>error(new ServiceError('REQUEST_ABORTED','Request body was interrupted',400));
    const end=()=>{cleanup();const body=Buffer.concat(parts,size);parts.length=0;resolve(body);};
    const data=(part:Buffer)=>{
      size+=part.length;
      if(size>maxBytes){error(new ServiceError('INPUT_LIMIT','Request exceeds reserved byte budget',413));return;}
      parts.push(part);
    };
    const timer=setTimeout(()=>error(new ServiceError('REQUEST_TIMEOUT','Request body deadline exceeded; inspect the original receipt before retrying a write',408)),timeoutMs);timer.unref();
    req.on('data',data);req.once('end',end);req.once('error',error);req.once('aborted',aborted);req.once('close',aborted);
  });
}
/** Bounded local JSON and standard MCP adapters share one scoped service and writer. */
export async function listenStandalone(options: {root: string; workspaceId: string; serviceId: string; port?: number;reasoning?:ReasoningConfiguration;validation?:ReasoningConfiguration}) {
  if (options.port!==undefined && (!Number.isInteger(options.port) || options.port<0 || options.port>65535)) fail('INVALID_INPUT','Invalid loopback port');
  const service=createStandaloneService(options),mcp=createOntologyMcp(service);
  const connections=new Set<Socket>(),principals=new Map<string,number>();
  let active=0,reservedBytes=0;
  const reserve=(socket:Socket,principalId:string,bytes:number):(()=>void)=>{
    if(connections.has(socket))fail('TRANSPORT_BUSY','Only one active request is allowed per connection',429);
    const principalBytes=principals.get(principalId)??0;
    if(active>=REQUEST_BUDGETS.activeRequests||reservedBytes+bytes>REQUEST_BUDGETS.aggregateBytes||principalBytes+bytes>REQUEST_BUDGETS.aggregateBytes)
      fail('TRANSPORT_BUSY','Authenticated request count or byte budget is occupied',429);
    connections.add(socket);principals.set(principalId,principalBytes+bytes);active++;reservedBytes+=bytes;
    let released=false;
    return ()=>{
      if(released)return;released=true;connections.delete(socket);active--;reservedBytes-=bytes;
      const remaining=principals.get(principalId)!-bytes;
      if(remaining===0)principals.delete(principalId);else principals.set(principalId,remaining);
    };
  };
  const server=createServer({maxHeaderSize:8192,requestTimeout:REQUEST_BUDGETS.largeTimeoutMs,headersTimeout:REQUEST_BUDGETS.ordinaryTimeoutMs}, async (req,res)=>{
    const started=performance.now();let release:(()=>void)|undefined,responseTimer:NodeJS.Timeout|undefined;
    // Hold the reservation through response flush/close, not merely dispatch.
    const terminal=new Promise<void>(resolve=>{res.once('finish',resolve);res.once('close',resolve);});
    res.on('error',()=>{});
    const responseDeadline=(duration:number):void=>{
      clearTimeout(responseTimer);
      responseTimer=setTimeout(()=>res.destroy(),Math.max(1,duration));responseTimer.unref();
    };
    const send=(status: number,body: unknown): void=>{
      const encoded=JSON.stringify(body);
      if(Buffer.byteLength(encoded)>LIMITS.responseBytes+1024)fail('OUTPUT_LIMIT','HTTP response exceeds byte budget',413);
      res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(encoded);
    };
    try {
      for (const header of ['host','authorization','content-type','content-length','origin','transfer-encoding']) {
        let count=0;for(let i=0;i<req.rawHeaders.length;i+=2) if(req.rawHeaders[i].toLowerCase()===header)count++;
        if(count>1) fail('INVALID_INPUT','Duplicate security or framing header');
      }
      const address=server.address();
      if (!address || typeof address==='string' || req.headers.host!==`127.0.0.1:${address.port}` || req.headers.origin!==undefined) fail('FORBIDDEN','Explicit loopback host and non-browser client required',403);
      if (!['/v1/request','/mcp'].includes(req.url??'')) fail('NOT_FOUND','Unknown route',404);
      const credential=token(req),{principalId}=service.authenticateTransport(credential);
      if(req.url==='/mcp') service.context(credential);
      if(req.method!=='POST') fail('METHOD_NOT_ALLOWED','Only bounded POST exchanges are supported',405);
      if (req.headers['content-type']?.split(';')[0].trim()!=='application/json' || req.headers['content-encoding']!==undefined) fail('INVALID_INPUT','Uncompressed JSON required',415);
      const wireLimit=req.url==='/mcp'?REQUEST_BUDGETS.maxWireBytes:REQUEST_BUDGETS.maxOwnerBytes;
      const length=req.headers['content-length'];
      if(length!==undefined&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>wireLimit))fail('INPUT_LIMIT','Request exceeds wire byte budget',413);
      const declaredBytes=length===undefined?undefined:Number(length);
      // Unknown-length streams reserve the largest wire envelope, even on the
      // JSON route. They cannot grow into another request's reservation.
      const charge=declaredBytes===undefined?REQUEST_BUDGETS.maxWireBytes:Math.max(4096,declaredBytes);
      release=reserve(req.socket,principalId,charge);
      const receiveTimeout=declaredBytes!==undefined&&declaredBytes<=LIMITS.requestBytes?REQUEST_BUDGETS.ordinaryTimeoutMs:REQUEST_BUDGETS.largeTimeoutMs;
      const bytes=await readBody(req,declaredBytes??wireLimit,receiveTimeout);
      let request: unknown;
      try{request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
      catch{if(bytes.length>LIMITS.requestBytes)fail('INPUT_LIMIT','Oversized request is not a valid document operation',413);fail('INVALID_INPUT','Invalid UTF-8 JSON');}
      // The largest raw reservation is not permission for a large ordinary
      // operation. Owner validation applies the operation-specific input limit.
      json(request,wireLimit);
      const operation=req.url==='/mcp'?validateMcpEnvelope(request):request!==null&&typeof request==='object'&&!Array.isArray(request)?request.operation:undefined;
      // Parsing collapses whitespace and JSON escapes. Charge the original
      // representation as well as the validated, decoded owner envelope.
      const operationWireLimit=ownerRequestBudget(operation)+(req.url==='/mcp'?REQUEST_BUDGETS.mcpEnvelopeBytes:0);
      if(bytes.length>operationWireLimit)fail('INPUT_LIMIT','Original request exceeds its operation wire byte budget',413);
      const remaining=requestTimeoutMs(operation)-(performance.now()-started);
      if(remaining<=0)fail('REQUEST_TIMEOUT','Request deadline exceeded before dispatch',408);
      responseDeadline(remaining);
      if(req.url==='/mcp'){
        res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');
        await mcp.handle(req,res,request,credential);
      }else{
        const result=service.request(request,credential);
        // A synchronous transaction cannot be preempted. If its response
        // deadline passed, retain its receipt as an uncertain write outcome.
        if(performance.now()-started>=requestTimeoutMs(operation))res.destroy();else send(200,{ok:true,result});
      }
      await terminal;
    } catch (e) {
      responseDeadline(REQUEST_BUDGETS.ordinaryTimeoutMs);
      await discardRejectedBody(req);
      if (!res.headersSent && !res.destroyed) {
        res.setHeader('connection','close');
        if (e instanceof ServiceError) send(e.httpStatus,{ok:false,error:{code:e.code,message:e.message}});
        else send(500,{ok:false,error:{code:'INTERNAL_ERROR',message:'Inspect service diagnostics; reconcile uncertain writes before retry'}});
      }else if(!res.destroyed&&!res.writableEnded)res.destroy();
      req.pause();
      if(res.writableFinished)req.destroy();else res.once('finish',()=>req.destroy());
      await terminal;
    }finally{clearTimeout(responseTimer);release?.();}
  });
  server.maxConnections=32;
  server.keepAliveTimeout=1000;server.maxRequestsPerSocket=100;
  try {
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port??0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  }catch(e){await mcp.close();service.close();throw e;}
  const address=server.address();if(!address || typeof address==='string') {service.close();fail('INTERNAL_ERROR','Server did not bind');}
  return {origin:`http://127.0.0.1:${address.port}`,identity:service.identity(),async close(){await mcp.close();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await service.close();}};
}
