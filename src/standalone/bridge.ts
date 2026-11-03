import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {Server} from '@modelcontextprotocol/server';
import {serveStdio,StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {readConnection} from './client.js';
import {privateRead} from './workspace.js';
import {LIMITS,ServiceError,fail} from './types.js';
import {pathToFileURL} from 'node:url';
import {realpathSync} from 'node:fs';

/** Credential-file adapter only. It never opens owner state, starts a service or retries a write. */
export function serveBridge(connectionFile:string){
  let active=0;
  const withClient=async<T>(use:(client:Client)=>Promise<T>):Promise<T>=>{
    if(active>=4)fail('BRIDGE_BUSY','Bridge concurrency budget reached',429);active++;
    const client=new Client({name:'evopilot-ontology-private-bridge',version:'0.9.0-dev.P1'});
    try{
      const connection=readConnection(connectionFile),token=privateRead(connection.credentialFile,256);
      if(!/^[A-Za-z0-9_-]{43}$/.test(token))fail('UNAUTHENTICATED','Invalid local service credential',401);
      await client.connect(new StreamableHTTPClientTransport(new URL(connection.origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+token},redirect:'error'}}),{timeout:5000});
      const context=await client.callTool({name:'ontology_context',arguments:{}},{timeout:5000});
      const structured=context.structuredContent;
      const identity=structured&&typeof structured==='object'&&!Array.isArray(structured)&&'result' in structured?structured.result:undefined;
      if(context.isError||!identity||typeof identity!=='object'||Array.isArray(identity)||!('workspaceId' in identity)||!('serviceId' in identity)||identity.workspaceId!==connection.workspaceId||identity.serviceId!==connection.serviceId)fail('IDENTITY_MISMATCH','Connected service differs from installation binding',403);
      return await use(client);
    }finally{try{await client.close();}finally{active--;}}
  };
  return serveStdio(()=>{
    const server=new Server({name:'evopilot-ontology',version:'0.9.0-dev.P1'},{capabilities:{tools:{}},instructions:'Use ontology_context to inspect the actual connected service. This adapter forwards to authenticated HTTP MCP; it has no owner database fallback or installer tools. Reconcile uncertain writes by original request ID.'});
    server.setRequestHandler('tools/list',request=>withClient(client=>client.listTools(request.params,{timeout:5000,cacheMode:'bypass'})));
    server.setRequestHandler('tools/call',async request=>{
      try{return await withClient(client=>client.callTool(request.params,{timeout:10000}));}
      catch(e){return {isError:true,content:[{type:'text',text:JSON.stringify({error:{code:e instanceof ServiceError?e.code:'TRANSPORT_UNKNOWN',message:e instanceof ServiceError?e.message:'Service response unavailable; inspect the original receipt before retrying a write'}})}]};}
    });
    return server;
  },{legacy:'serve',maxSubscriptions:0,transport:new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:LIMITS.requestBytes+4096}),onerror:()=>process.stderr.write('Ontology MCP transport error; no automatic redispatch\n')});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--connection'){process.stderr.write('Expected --connection with an absolute private binding\n');process.exitCode=1;}
  else serveBridge(args[1]);
}
