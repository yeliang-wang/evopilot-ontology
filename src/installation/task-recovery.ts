import {readInstallation,currentRun} from './manager.js';
import {operatorLock} from './files.js';
import {processPresent} from './control.js';
import {verifyRuntime} from './runtime.js';
import {currentToolchainBinding} from './toolchains.js';
import {openWorkspace} from '../standalone/workspace.js';
import type {WorkspaceStore} from '../standalone/workspace.js';
import {inspectTaskRecovery,reconcileTask} from '../native-v2/task-recovery.js';
import {fail} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

function stopped<T>(path:string,use:(store:WorkspaceStore,installationId:string,roots:string[])=>T):T {
  const installation=readInstallation(path),unlock=operatorLock(installation.root);
  try{
    verifyRuntime(installation.runtime);const run=currentRun(installation);
    if(run&&!['STOPPED','FAILED'].includes(run.state)&&processPresent(run.pid)!==false)fail('INSTALLATION_RUNNING','Stop or reconcile the exact service before task recovery',409);
    const binding=currentToolchainBinding(installation);if(!binding)fail('TOOLCHAIN_BINDING_MISSING','Original managed worker binding is required for recovery',409);
    const store=openWorkspace(installation.workspaceRoot,installation);
    try{return use(store,installation.installationId,[binding.binding.workRoot]);}finally{store.close();}
  }finally{unlock();}
}
export function inspectInstallationTaskRecovery(path:string,projectId:string,taskId:string):Json {
  return stopped(path,(store,_installationId,roots)=>inspectTaskRecovery(store,projectId,taskId,roots));
}
export function reconcileInstallationTask(path:string,input:{projectId:string;taskId:string;requestId:string;expectedReportDigest:string}):Json {
  return stopped(path,(store,installationId,roots)=>reconcileTask(store,{...input,installationId},roots));
}
