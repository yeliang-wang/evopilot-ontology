import {lstatSync,readdirSync,realpathSync} from 'node:fs';
import {isAbsolute,join,resolve,basename,dirname} from 'node:path';
import {readInstallation,currentRun} from './manager.js';
import type {Installation} from './installation-contract.js';
import {operatorRequest} from './control.js';
import type {RunRecord} from './control.js';
import {currentToolchainBinding} from './toolchains.js';
import {runtimeBindingDigest} from './runtime-history.js';
import {readReviewerGrant} from './reviewer.js';
import {operatorLock,writePrivate} from './files.js';
import {privateRead,requireMaintenanceAvailable} from '../standalone/workspace.js';
import {readConnection,sendRequest} from '../standalone/client.js';
import type {Connection} from '../standalone/client.js';
import {hash,hashBytes,id,object} from '../standalone/validation.js';
import {fail,ServiceError} from '../standalone/types.js';
import type {Json} from '../standalone/types.js';

const identity=(value:unknown):string=>hash(value as Json);
const sameRun=(a:RunRecord,b:RunRecord):boolean=>identity(a)===identity(b);
function requireCurrentRun(i:Installation,run:RunRecord|null):asserts run is RunRecord {
  if(!run||run.state!=='RUNNING'||run.origin===null)fail('INSTALLATION_NOT_RUNNING','Start the selected managed installation before preparing a reviewer connection',409);
  if(run.schema==='ontology-managed-run/v3'?run.runtimeBindingDigest!==runtimeBindingDigest(i.runtime):i.schema!=='ontology-installation/v1')fail('RUNTIME_BINDING_CONFLICT','Live run does not bind the selected installation runtime',409);
  if(run.toolchainBindingDigest!==(currentToolchainBinding(i)?.digest??null))fail('TOOLCHAIN_BINDING_CONFLICT','Live run does not bind the current toolchain selection',409);
}
async function liveRun(i:Installation):Promise<RunRecord> {
  const retained=currentRun(i);requireCurrentRun(i,retained);
  let actual:RunRecord;
  try{actual=await operatorRequest(retained,'status');}
  catch(e){if(e instanceof ServiceError)throw e;fail('SERVICE_UNAVAILABLE','The selected managed owner could not be authenticated',503);}
  requireCurrentRun(i,actual);
  if(!sameRun(retained,actual))fail('CONNECTION_CHANGED','Managed run changed while preparing the reviewer connection',409);
  return actual;
}
function priorConnection(file:string,expected:Connection):{raw:string;stamp:string}|null {
  if(readdirSync(dirname(file)).some(n=>n.startsWith(basename(file)+'.pending-')))fail('CONNECTION_CONFLICT','Interrupted reviewer connection material was preserved',409);
  let node:ReturnType<typeof lstatSync>;
  try{node=lstatSync(file);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
  const existing=readConnection(file);
  if(existing.workspaceId!==expected.workspaceId||existing.serviceId!==expected.serviceId||existing.projectId!==expected.projectId||existing.credentialFile!==expected.credentialFile)fail('CONNECTION_CONFLICT','Existing reviewer connection belongs to another binding',409);
  return {raw:privateRead(file,8192),stamp:identity({dev:node.dev,ino:node.ino,mode:node.mode,size:node.size,mtimeMs:node.mtimeMs,ctimeMs:node.ctimeMs})};
}

/** A derived local connection, not a grant or semantic decision. Refresh after
 * each managed restart; a successful observation is not a liveness lease. */
export async function prepareReviewerConnection(installationRoot:string,grantId:string):Promise<Json> {
  id(grantId);
  if(!isAbsolute(installationRoot)||resolve(installationRoot)!==installationRoot||realpathSync(installationRoot)!==installationRoot)fail('UNSAFE_PATH','Canonical private installation required');
  const installation=readInstallation(installationRoot);
  requireMaintenanceAvailable(installation.root);requireMaintenanceAvailable(installation.workspaceRoot);
  const unlock=operatorLock(installation.root);
  try{
    const selected=()=>readReviewerGrant({root:installation.workspaceRoot,workspaceId:installation.workspaceId,serviceId:installation.serviceId,grantId});
    const reviewer=selected(),run=await liveRun(installation),projectId=reviewer.grant.projectIds[0]!;
    const connection:Connection={schema:'ontology-connection/v1',origin:run.origin!,workspaceId:installation.workspaceId,serviceId:installation.serviceId,projectId,credentialFile:reviewer.credentialFile};
    const file=join(installation.root,'reviewer-connection-'+grantId+'.json'),before=priorConnection(file,connection);
    const observed=await sendRequest(connection,{workspaceId:connection.workspaceId,serviceId:connection.serviceId,projectId,operation:'service.inspect',input:{}},false);
    object(observed);
    if(observed.workspaceId!==installation.workspaceId||observed.serviceId!==installation.serviceId||!Array.isArray(observed.writeOperations)||identity(observed.writeOperations)!==identity(['review.decide']))fail('IDENTITY_MISMATCH','Connected service does not confirm the selected reviewer scope',403);
    const unchanged=async():Promise<void>=>{
      requireMaintenanceAvailable(installation.root);requireMaintenanceAvailable(installation.workspaceRoot);
      if(identity(readInstallation(installation.root))!==identity(installation)||identity(selected())!==identity(reviewer)||!sameRun(run,await liveRun(installation)))fail('CONNECTION_CHANGED','Owner or reviewer binding changed during connection preparation',409);
    };
    await unchanged();
    if(identity(priorConnection(file,connection))!==identity(before))fail('CONNECTION_CHANGED','Reviewer connection file changed during preparation',409);
    const raw=JSON.stringify(connection)+'\n',reused=before?.raw===raw;
    if(!reused)writePrivate(file,connection,before!==null);
    await unchanged();
    if(privateRead(file,8192)!==raw)fail('CONNECTION_CHANGED','Reviewer connection changed after preparation',409);
    return {status:'READY',observed:'RUNNING',installationId:installation.installationId,workspaceId:installation.workspaceId,serviceId:installation.serviceId,
      grantId,principalId:reviewer.grant.principalId,projectId,permissions:['read','review'],expiresAt:reviewer.grant.expiresAt,
      connectionFile:file,connectionDigest:hashBytes(raw),runId:run.runId,origin:connection.origin,reused,authorityScope:'MODEL_SEMANTICS_ONLY',authority:false};
  }finally{unlock();}
}
