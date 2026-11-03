import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { createStandaloneService } from './service.js';
import { createOntologyMcp } from './mcp.js';
import { LIMITS, ServiceError, fail } from './types.js';
import { json } from './validation.js';

const token = (request: IncomingMessage): string => {
  const header=request.headers.authorization;
  if (typeof header!=='string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) fail('UNAUTHENTICATED','Bearer credential required',401);
  return header.slice(7);
};
async function discardRejectedBody(req: IncomingMessage):Promise<void>{
  if(req.complete||req.destroyed)return;
  // Small oversize bodies can finish before the rejection is sent. Never drain an unbounded peer.
  await new Promise<void>(resolve=>{
    let bytes=0;
    const finish=()=>{clearTimeout(timer);req.off('data',data);req.off('end',finish);req.off('error',finish);req.off('close',finish);req.pause();resolve();};
    const data=(part:Buffer)=>{bytes+=part.length;if(bytes>2*LIMITS.requestBytes)finish();};
    const timer=setTimeout(finish,250);timer.unref();
    req.on('data',data);req.once('end',finish);req.once('error',finish);req.once('close',finish);req.resume();
  });
}
/** Bounded local JSON and standard MCP adapters share one scoped service and writer. */
export async function listenStandalone(options: {root: string; workspaceId: string; serviceId: string; port?: number}) {
  if (options.port!==undefined && (!Number.isInteger(options.port) || options.port<0 || options.port>65535)) fail('INVALID_INPUT','Invalid loopback port');
  const service=createStandaloneService(options);
  const mcp=createOntologyMcp(service);
  const server=createServer({maxHeaderSize:8192,requestTimeout:10000,headersTimeout:10000}, async (req,res)=>{
    const send=(status: number,body: unknown): void=>{
      res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));
    };
    try {
      for (const header of ['host','authorization','content-type','content-length','origin']) {
        let count=0;for(let i=0;i<req.rawHeaders.length;i+=2) if(req.rawHeaders[i].toLowerCase()===header)count++;
        if(count>1) fail('INVALID_INPUT','Duplicate security or framing header');
      }
      const address=server.address();
      if (!address || typeof address==='string' || req.headers.host!==`127.0.0.1:${address.port}` || req.headers.origin!==undefined) fail('FORBIDDEN','Explicit loopback host and non-browser client required',403);
      if (!['/v1/request','/mcp'].includes(req.url??'')) fail('NOT_FOUND','Unknown route',404);
      const credential=token(req);
      if(req.url==='/mcp') service.context(credential);
      if(req.method!=='POST') fail('METHOD_NOT_ALLOWED','Only bounded POST exchanges are supported',405);
      if (req.headers['content-type']?.split(';')[0].trim()!=='application/json' || req.headers['content-encoding']!==undefined) fail('INVALID_INPUT','Uncompressed JSON required',415);
      const length=req.headers['content-length'];
      if (length!==undefined && (!/^\d+$/.test(length) || Number(length)>LIMITS.requestBytes)) fail('INPUT_LIMIT','Request exceeds byte budget',413);
      const parts: Buffer[]=[];let size=0;
      // Keep the socket alive long enough to return a typed limit error; do not drain an unlimited body.
      await new Promise<void>((resolve,reject)=>{
        const cleanup=()=>{req.off('data',data);req.off('end',end);req.off('error',error);req.off('aborted',aborted);};
        const error=(e: Error)=>{cleanup();reject(e);};
        const aborted=()=>error(new ServiceError('REQUEST_ABORTED','Request body was interrupted',400));
        const end=()=>{cleanup();resolve();};
        const data=(chunk: Buffer)=>{const part=Buffer.from(chunk);size+=part.length;
          if(size>LIMITS.requestBytes){req.pause();error(new ServiceError('INPUT_LIMIT','Request exceeds byte budget',413));return;}parts.push(part);};
        req.on('data',data);req.once('end',end);req.once('error',error);req.once('aborted',aborted);
      });
      let request: unknown;
      try {request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}catch{fail('INVALID_INPUT','Invalid UTF-8 JSON');}
      json(request);
      if(req.url==='/mcp'){
        res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');
        await mcp.handle(req,res,request,credential);
      }else send(200,{ok:true,result:service.request(request,credential)});
    } catch (e) {
      await discardRejectedBody(req);
      if (!res.headersSent && !res.destroyed) {
        res.setHeader('connection','close');
        if (e instanceof ServiceError) send(e.httpStatus,{ok:false,error:{code:e.code,message:e.message}});
        else send(500,{ok:false,error:{code:'INTERNAL_ERROR',message:'Inspect service diagnostics; reconcile uncertain writes before retry'}});
      }
      req.pause();
      res.once('finish',()=>req.destroy());
    }
  });
  server.maxConnections=32;
  server.keepAliveTimeout=1000;server.maxRequestsPerSocket=100;
  try {
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port??0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  }catch(e){await mcp.close();service.close();throw e;}
  const address=server.address();if(!address || typeof address==='string') {service.close();fail('INTERNAL_ERROR','Server did not bind');}
  return {origin:`http://127.0.0.1:${address.port}`,identity:service.identity(),async close(){await mcp.close();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));service.close();}};
}
