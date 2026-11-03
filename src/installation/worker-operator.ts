import {join} from 'node:path';
import {hash} from '../standalone/validation.js';
import type {Json} from '../standalone/types.js';
import {fail} from '../standalone/types.js';
import {privatePath,privateRead,openWorkspace} from '../standalone/workspace.js';
import type {WorkspaceStore} from '../standalone/workspace.js';
import {readInstallation,currentRun} from './manager.js';
import type {Installation} from './manager.js';
import {operatorLock} from './files.js';
import {verifyRuntime} from './runtime.js';
import {processPresent} from './control.js';
import {currentToolchainBinding} from './toolchains.js';
const sha=(value:unknown)=>hash(value as Json);
export async function withStoppedWorkerInstallation<T>(path:string,use:(i:Installation,store:WorkspaceStore,root:string)=>Promise<T>):Promise<T> {
  const i=readInstallation(path),unlock=operatorLock(i.root);
  try{
    verifyRuntime(i.runtime);const run=currentRun(i);
    if(run&&!['STOPPED','FAILED'].includes(run.state)&&processPresent(run.pid)!==false)fail('INSTALLATION_RUNNING','Stop the exact owner before worker maintenance',409);
    const binding=currentToolchainBinding(i);if(!binding)fail('TOOLCHAIN_BINDING_MISSING','Original managed worker root is required',409);
    const root=binding.binding.workRoot,expected={schema:'ontology-managed-work/v1',installationId:i.installationId,workspaceId:i.workspaceId,serviceId:i.serviceId,root};
    privatePath(root,true);if(sha(JSON.parse(privateRead(join(root,'owner.json'),4096)))!==sha(expected))fail('WORK_ROOT_CONFLICT','Foreign worker root',409);
    const store=openWorkspace(i.workspaceRoot,i);
    try{
      if(store.db.prepare("SELECT id FROM native_reasoning_tasks WHERE state!='FINISHED' LIMIT 1").get())fail('TASK_RECOVERY_REQUIRED','Resolve unfinished formal tasks before maintenance',409);
      return await use(i,store,root);
    }finally{store.close();}
  }finally{unlock();}
}
