import {createServer} from 'node:net';
import {chmodSync,realpathSync,rmSync,rmdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {readInstallation,currentRun,writeRun} from './manager.js';
import {verifyRuntime} from './runtime.js';
import {currentToolchainBinding,verifyManagedToolchains} from './toolchains.js';
import {writePrivate} from './files.js';
import {listenStandalone} from '../standalone/http.js';
import {ServiceError,fail} from '../standalone/types.js';
import {exact} from '../standalone/validation.js';
import {runtimeBindingDigest} from './runtime-history.js';

export async function runDaemon(root:string,runId:string):Promise<void>{
  const installation=readInstallation(root),run=currentRun(installation);
  if(!run||run.runId!==runId||run.state!=='STARTING')fail('LAUNCH_CONFLICT','Daemon requires its exact retained starting request',409);
  if(realpathSync(fileURLToPath(import.meta.url))!==join(installation.runtime.packageRoot,'dist/installation/daemon.js'))fail('RUNTIME_ENTRY_MISMATCH','Launch the retained request using its selected installed daemon entry',409);
  let service:Awaited<ReturnType<typeof listenStandalone>>|undefined,control:ReturnType<typeof createServer>|undefined;
  let shutdown:Promise<void>|undefined;
  const stop=():Promise<void>=>{
    if(shutdown)return shutdown;
    shutdown=(async()=>{
      if(control)await new Promise<void>(resolve=>control!.close(()=>resolve()));
      await service?.close();run.state='STOPPED';writeRun(installation,run);
      try{rmSync(run.controlSocket);rmdirSync(dirname(run.controlSocket));}catch{}
    })();return shutdown;
  };
  try{
    if(run.schema==='ontology-managed-run/v3'?run.runtimeBindingDigest!==runtimeBindingDigest(installation.runtime):installation.schema!=='ontology-installation/v1')fail('RUNTIME_BINDING_CONFLICT','Managed launch requires its exact selected runtime',409);
    run.pid=process.pid;writeRun(installation,run);verifyRuntime(installation.runtime);
    const binding=currentToolchainBinding(installation);
    if(run.toolchainBindingDigest!==(binding?.digest??null))fail('TOOLCHAIN_BINDING_CONFLICT','Managed run toolchain binding changed before launch',409);
    const formal=verifyManagedToolchains(installation,binding);
    service=await listenStandalone({root:installation.workspaceRoot,workspaceId:installation.workspaceId,serviceId:installation.serviceId,port:installation.port,...formal});
    control=createServer(socket=>{
      let data='',handled=false;socket.setTimeout(2000,()=>socket.destroy());
      socket.on('error',()=>{});
      socket.on('data',chunk=>{
        if(handled)return;data+=chunk.toString('utf8');if(Buffer.byteLength(data)>1024){socket.destroy();return;}if(!data.includes('\n'))return;handled=true;
        try{
          const request:unknown=JSON.parse(data.split('\n')[0]);exact(request,['installationId','runId','operation']);
          if(request.installationId!==installation.installationId||request.runId!==run.runId||!['status','stop'].includes(request.operation as string))fail('FORBIDDEN','Private operator identity mismatch',403);
          socket.end(JSON.stringify(run)+'\n',()=>{if(request.operation==='stop')void stop();});
        }catch{socket.destroy();}
      });
    });
    control.maxConnections=4;
    await new Promise<void>((resolve,reject)=>{control!.once('error',reject);control!.listen(run.controlSocket,()=>{control!.removeListener('error',reject);resolve();});});
    chmodSync(run.controlSocket,0o600);
    writePrivate(join(installation.root,'connection.json'),{schema:'ontology-connection/v1',origin:service.origin,workspaceId:installation.workspaceId,serviceId:installation.serviceId,projectId:installation.projectId,credentialFile:installation.credentialFile},true);
    run.origin=service.origin;run.state='RUNNING';writeRun(installation,run);
    const signal=()=>{void stop();};process.once('SIGTERM',signal);process.once('SIGINT',signal);
    await new Promise<void>(resolve=>control!.once('close',()=>resolve()));
    await shutdown;process.off('SIGTERM',signal);process.off('SIGINT',signal);
  }catch(e){
    if(control)await new Promise<void>(resolve=>control!.close(()=>resolve()));
    await service?.close();run.state='FAILED';run.error=e instanceof ServiceError?e.code:'START_FAILED';writeRun(installation,run);
    try{rmSync(run.controlSocket);rmdirSync(dirname(run.controlSocket));}catch{}
    throw e;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
  const args=process.argv.slice(2);
  if(args.length!==4||args[0]!=='--installation'||args[2]!=='--run'){process.stderr.write('Invalid managed daemon arguments\n');process.exitCode=1;}
  else runDaemon(args[1],args[3]).catch(e=>{process.stderr.write(JSON.stringify({code:e instanceof ServiceError?e.code:'DAEMON_FAILED'})+'\n');process.exitCode=1;});
}
