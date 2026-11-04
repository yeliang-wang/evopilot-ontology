import {isAbsolute,join,resolve} from 'node:path';
import {exact,id,text} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import {validateRuntimeBinding} from './runtime.js';
import type {RuntimeBinding} from './runtime.js';
import {validateRuntimeHistory} from './runtime-history.js';
import type {RuntimeHistory} from './runtime-history.js';

interface InstallationBase {installationId:string;root:string;workspaceRoot:string;workspaceId:string;serviceId:string;projectId:string;principalId:string;credentialFile:string;runtime:RuntimeBinding;port:number;createdAt:string;}
export type Installation=InstallationBase&({schema:'ontology-installation/v1'}|{schema:'ontology-installation/v2';runtimeHistory:RuntimeHistory});
export const INSTALLATION_BYTES=2*1024*1024;
export function validateInstallation(value:unknown,root?:string):asserts value is Installation {
  exact(value,['schema','installationId','root','workspaceRoot','workspaceId','serviceId','projectId','principalId','credentialFile','runtime','port','createdAt'],['runtimeHistory']);
  if(!['ontology-installation/v1','ontology-installation/v2'].includes(value.schema as string)||root!==undefined&&value.root!==root)fail('IDENTITY_MISMATCH','Unknown or moved installation',403);
  for(const k of ['installationId','workspaceId','serviceId','projectId','principalId'])id(value[k]);
  for(const k of ['root','workspaceRoot','credentialFile']){text(value[k],4096);if(!isAbsolute(value[k] as string)||resolve(value[k] as string)!==value[k])fail('INVALID_STATE','Canonical installation references required');}
  if(value.credentialFile!==join(value.workspaceRoot as string,'operator-token')||!Number.isInteger(value.port)||(value.port as number)<0||(value.port as number)>65535)fail('INVALID_STATE','Invalid installation credential or port');
  text(value.createdAt,40);validateRuntimeBinding(value.runtime);
  if(Buffer.byteLength(JSON.stringify(value))>INSTALLATION_BYTES)fail('RUNTIME_HISTORY_LIMIT','Installation history exceeds its byte budget',413);
  if(value.schema==='ontology-installation/v1'){if(Object.hasOwn(value,'runtimeHistory'))fail('RUNTIME_HISTORY','Original installation cannot contain an unversioned runtime history',409);}
  else validateRuntimeHistory(value as unknown as Installation&{schema:'ontology-installation/v2'});
}
