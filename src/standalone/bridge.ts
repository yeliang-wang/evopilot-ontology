import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {Server} from '@modelcontextprotocol/server';
import {serveStdio,StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {readConnection} from './client.js';
import {privateRead} from './workspace.js';
import {LIMITS,ServiceError,fail} from './types.js';
import {pathToFileURL} from 'node:url';
import {realpathSync} from 'node:fs';

type BridgePhase='LOCAL_BINDING'|'CONNECT'|'CONTEXT'|'CALL'|'CLOSE';
class BridgeTransportError extends Error {
  readonly diagnostic:{name:string;code:string|number|null;httpStatus:number|null}[]=[];
  constructor(readonly phase:BridgePhase,error:unknown){
    super('Service response unavailable; inspect the original receipt before retrying a write');
    const codes=new Set(['NOT_CONNECTED','ALREADY_CONNECTED','NOT_INITIALIZED','CAPABILITY_NOT_SUPPORTED','REQUEST_TIMEOUT','CONNECTION_CLOSED','SEND_FAILED','INVALID_RESULT','UNSUPPORTED_RESULT_TYPE','ERA_NEGOTIATION_FAILED','CLIENT_HTTP_NOT_IMPLEMENTED','CLIENT_HTTP_AUTHENTICATION','CLIENT_HTTP_FORBIDDEN','CLIENT_HTTP_UNEXPECTED_CONTENT','CLIENT_HTTP_FAILED_TO_OPEN_STREAM','CLIENT_HTTP_FAILED_TO_TERMINATE_SESSION','ECONNRESET','ECONNREFUSED','EPIPE','ETIMEDOUT','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
    let current=error;
    for(let n=0;n<3&&current!==null&&typeof current==='object';n++){
      const e=current as {name?:unknown;code?:unknown;status?:unknown;cause?:unknown};
      this.diagnostic.push({name:typeof e.name==='string'&&['Error','SdkError','SdkHttpError','ProtocolError','TypeError','AbortError','TimeoutError'].includes(e.name)?e.name:'Error',
        code:typeof e.code==='number'&&Number.isSafeInteger(e.code)?e.code:typeof e.code==='string'&&codes.has(e.code)?e.code:null,
        httpStatus:typeof e.status==='number'&&Number.isInteger(e.status)&&e.status>=100&&e.status<=599?e.status:null});
      current=e.cause;
    }
  }
}

/** Credential-file adapter only. It never opens owner state, starts a service or retries a write. */
export function serveBridge(connectionFile:string){
  let active=0;
  const withClient=async<T>(use:(client:Client)=>Promise<T>):Promise<T>=>{
    if(active>=4)fail('BRIDGE_BUSY','Bridge concurrency budget reached',429);active++;
    const client=new Client({name:'evopilot-ontology-private-bridge',version:'0.9.0-dev.P1'});
    let phase:BridgePhase='LOCAL_BINDING',failed=false;
    try{
      const connection=readConnection(connectionFile),token=privateRead(connection.credentialFile,256);
      if(!/^[A-Za-z0-9_-]{43}$/.test(token))fail('UNAUTHENTICATED','Invalid local service credential',401);
      // Each exchange is stateless. Do not let fetch's global connection pool
      // retain sockets beyond this short-lived client's lifetime: sustained
      // reads otherwise reach the owner's per-socket request budget and 503.
      phase='CONNECT';await client.connect(new StreamableHTTPClientTransport(new URL(connection.origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+token,connection:'close'},redirect:'error'}}),{timeout:5000});
      phase='CONTEXT';
      const context=await client.callTool({name:'ontology_context',arguments:{}},{timeout:5000});
      const structured=context.structuredContent;
      const identity=structured&&typeof structured==='object'&&!Array.isArray(structured)&&'result' in structured?structured.result:undefined;
      if(context.isError||!identity||typeof identity!=='object'||Array.isArray(identity)||!('workspaceId' in identity)||!('serviceId' in identity)||identity.workspaceId!==connection.workspaceId||identity.serviceId!==connection.serviceId)fail('IDENTITY_MISMATCH','Connected service differs from installation binding',403);
      phase='CALL';return await use(client);
    }catch(e){failed=true;throw e instanceof ServiceError?e:new BridgeTransportError(phase,e);}
    finally{
      try{await client.close();}catch(e){
        // A confirmed owner response remains valid if local connection cleanup
        // fails. Never turn it into an uncertain mutation or retry the request.
        if(!failed)process.stderr.write(JSON.stringify({code:'BRIDGE_CLEANUP_FAILED',phase:'CLOSE',diagnostic:new BridgeTransportError('CLOSE',e).diagnostic})+'\n');
      }finally{active--;}
    }
  };
  return serveStdio(()=>{
    const server=new Server({name:'evopilot-ontology',version:'0.9.0-dev.P1'},{capabilities:{tools:{}},instructions:'Use ontology_context to inspect the actual connected service. This adapter forwards to authenticated HTTP MCP; it has no owner database fallback or installer tools. Reconcile uncertain writes by original request ID.'});
    server.setRequestHandler('tools/list',request=>withClient(client=>client.listTools(request.params,{timeout:5000,cacheMode:'bypass'})));
    server.setRequestHandler('tools/call',async request=>{
      try{return await withClient(client=>client.callTool(request.params,{timeout:10000}));}
      catch(e){const error={code:e instanceof ServiceError?e.code:'TRANSPORT_UNKNOWN',message:e instanceof ServiceError?e.message:'Service response unavailable; inspect the original receipt before retrying a write',...(e instanceof BridgeTransportError?{phase:e.phase,diagnostic:e.diagnostic}:{})};return {isError:true,content:[{type:'text',text:JSON.stringify({error})}],structuredContent:{error}};}
    });
    return server;
  },{legacy:'serve',maxSubscriptions:0,transport:new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:LIMITS.requestBytes+4096}),onerror:()=>process.stderr.write('Ontology MCP transport error; no automatic redispatch\n')});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--connection'){process.stderr.write('Expected --connection with an absolute private binding\n');process.exitCode=1;}
  else serveBridge(args[1]);
}
