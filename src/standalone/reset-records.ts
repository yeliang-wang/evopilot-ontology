import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {privatePath,privateRead} from './workspace.js';
import type {MaintenancePermit} from './workspace.js';
import {exact,id,digest,hash} from './validation.js';
import {fail} from './types.js';
import type {Json} from './types.js';

export const RESET_RECORDS='asset-reset-requests';
export const RESET_BYTES=8*1024*1024;
export interface ResetReference {projectId:string;table:string;value:string;}
export interface ResetRequestReference {projectId:string;principalId:string;requestId:string;requestDigest:string;receiptDigest:string;}
export interface ResetCopy {path:string;kind:'file'|'directory';device:string;inode:string;bytes:number;digest:string|null;}
export interface ResetPlan {
 schema:'ontology-asset-reset-plan/v1';installationId:string;workspaceId:string;serviceId:string;workspaceRoot:string;requestId:string;
 projectIds:string[];databaseDigest:string;preservedDigest:string;identityDigest:string;credentialsDigest:string;
 selectedRows:number;tableCounts:Record<string,number>;references:ResetReference[];requests:ResetRequestReference[];copies:ResetCopy[];
}
export interface ResetRecord {plan:ResetPlan;planDigest:string;completed:boolean;}
export const resetKey=(requestId:string):string=>{id(requestId);return Buffer.from(requestId).toString('hex');};
export const resetReceipt=(p:ResetPlan)=>({schema:'ontology-asset-reset-receipt/v1',requestId:p.requestId,planDigest:hash(p as unknown as Json),workspaceId:p.workspaceId,serviceId:p.serviceId,projectIds:p.projectIds,status:'COMPLETED',selectedRows:p.selectedRows,selectedFiles:p.copies.filter(c=>c.kind==='file').length,nonTargetVerified:true,temporaryRecoveryRemaining:0,authority:false});
export function validateResetPlan(v:unknown):asserts v is ResetPlan {
 exact(v,['schema','installationId','workspaceId','serviceId','workspaceRoot','requestId','projectIds','databaseDigest','preservedDigest','identityDigest','credentialsDigest','selectedRows','tableCounts','references','requests','copies']);
 if(v.schema!=='ontology-asset-reset-plan/v1'||typeof v.workspaceRoot!=='string'||!v.workspaceRoot.startsWith('/'))fail('RESET_EVIDENCE','Invalid reset plan');
 for(const k of ['installationId','workspaceId','serviceId','requestId'])id(v[k]);
 for(const k of ['databaseDigest','preservedDigest','identityDigest','credentialsDigest'])digest(v[k]);
 if(!Array.isArray(v.projectIds)||!v.projectIds.length||v.projectIds.length>128||new Set(v.projectIds).size!==v.projectIds.length)fail('RESET_EVIDENCE','Explicit unique project selection required');v.projectIds.forEach(id);
 if(!Number.isSafeInteger(v.selectedRows)||(v.selectedRows as number)<0||(v.selectedRows as number)>100000)fail('RESET_LIMIT','Reset row budget exceeded');
 if(!Array.isArray(v.references)||v.references.length>100000||!Array.isArray(v.requests)||v.requests.length>100000||!Array.isArray(v.copies)||v.copies.length>4096)fail('RESET_LIMIT','Reset inventory budget exceeded');
 for(const r of v.references){exact(r,['projectId','table','value']);id(r.projectId);if(!v.projectIds.includes(r.projectId)||typeof r.table!=='string'||typeof r.value!=='string'||r.value.length>256)fail('RESET_EVIDENCE','Invalid deleted reference');}
 for(const r of v.requests){exact(r,['projectId','principalId','requestId','requestDigest','receiptDigest']);for(const k of ['projectId','principalId','requestId'])id(r[k]);digest(r.requestDigest);digest(r.receiptDigest);if(!v.projectIds.includes(r.projectId))fail('RESET_EVIDENCE','Foreign request tombstone');}
 for(const c of v.copies){exact(c,['path','kind','device','inode','bytes','digest']);if(typeof c.path!=='string'||!c.path||c.path.split('/').some(n=>!n||n==='.'||n==='..')||!['file','directory'].includes(String(c.kind))||typeof c.device!=='string'||typeof c.inode!=='string'||!Number.isSafeInteger(c.bytes)||(c.bytes as number)<0)fail('RESET_EVIDENCE','Invalid copy inventory');if(c.kind==='file')digest(c.digest);else if(c.digest!==null||c.bytes!==0)fail('RESET_EVIDENCE','Invalid directory inventory');}
 if(!v.tableCounts||typeof v.tableCounts!=='object'||Array.isArray(v.tableCounts)||Object.values(v.tableCounts).some(n=>!Number.isSafeInteger(n)||(n as number)<0))fail('RESET_EVIDENCE','Invalid table inventory');
}
/** Called by every workspace guard. Only the exact original operator may pass
 * its unfinished admission; ordinary service requests remain blocked. */
export function readResetRecords(root:string,permit?:MaintenancePermit):ResetRecord[] {
 if(!readdirSync(root).includes(RESET_RECORDS))return [];
 const directory=join(root,RESET_RECORDS);privatePath(directory,true);const names=readdirSync(directory).sort();
 if(names.length>512)fail('RESET_LIMIT','Reset control history exceeds budget',409);
 const keys=new Set<string>();
 for(const n of names){const m=/^([a-f0-9]{2,192})\.json(?:\.pending|\.completed(?:\.pending)?)?$/.exec(n);if(!m)fail('RESET_EVIDENCE','Unknown reset control material was preserved',409);keys.add(m[1]!);privatePath(join(directory,n));}
 const result:ResetRecord[]=[];let bytes=0;
 for(const key of keys){
  const requestId=Buffer.from(key,'hex').toString();if(resetKey(requestId)!==key)fail('RESET_EVIDENCE','Invalid reset request identity',409);
  const own=permit?.operation==='RESET'&&permit.requestId===requestId;
  if(!names.includes(key+'.json')){if(!own)fail('RESET_PENDING','Resume the original asset reset before using this workspace',409);continue;}
  const raw=privateRead(join(directory,key+'.json'),RESET_BYTES);bytes+=Buffer.byteLength(raw);if(bytes>64*1024*1024)fail('RESET_LIMIT','Reset history byte budget exceeded',409);
  const v:unknown=JSON.parse(raw);exact(v,['plan','planDigest']);validateResetPlan(v.plan);digest(v.planDigest);
  if(v.plan.requestId!==requestId||hash(v.plan as unknown as Json)!==v.planDigest)fail('RESET_EVIDENCE','Reset admission binding differs',409);
  const completed=names.includes(key+'.json.completed');
  if(completed){const receipt:unknown=JSON.parse(privateRead(join(directory,key+'.json.completed'),65536));if(hash(receipt as Json)!==hash(resetReceipt(v.plan) as Json)||names.some(n=>n.startsWith(key+'.')&&n.endsWith('.pending')))fail('RESET_EVIDENCE','Reset completion binding differs',409);}
  else if(!own||permit.requestDigest!==v.planDigest)fail('RESET_PENDING','Resume the original asset reset before using this workspace',409);
  result.push({plan:v.plan,planDigest:v.planDigest,completed});
 }
 return result;
}
const operationTable:Record<string,string>={intent:'intents',source:'native_source_sets',model:'native_models',expectations:'native_expectations',view:'native_views',review:'native_reviews',delivery:'native_deliveries',reasoning:'native_reasoning_tasks',validation:'native_reasoning_tasks',shacl:'native_reasoning_tasks',explanation:'native_reasoning_tasks'};
export function guardResetRequest(records:ResetRecord[],projectId:string,principalId:string,requestId:string|undefined,operation:string,input:Record<string,unknown>,result?:Json):void {
 const selected=records.filter(r=>r.completed&&r.plan.projectIds.includes(projectId));
 if(!selected.length)return;
 const oldRequest=requestId??(operation==='receipt.read'&&typeof input.requestId==='string'?input.requestId:undefined);
 if(oldRequest&&selected.some(r=>r.plan.requests.some(q=>q.projectId===projectId&&q.principalId===principalId&&q.requestId===oldRequest)))fail('REQUEST_PURGED','Original request content was explicitly cleared; inspect its reset audit, never redispatch',410);
 const fields:Record<string,string>={modelDigest:'native_models',intentDigest:'intents',sourceSetDigest:'native_source_sets',expectationsDigest:'native_expectations',viewDigest:'native_views',reviewDigest:'native_reviews',candidateDigest:'native_review_candidates',deliveryDigest:'native_deliveries',taskId:'native_reasoning_tasks',digest:operationTable[operation.split('.')[0]!]??''};
 const object=result&&typeof result==='object'&&!Array.isArray(result)?result:input;
 for(const [field,table] of Object.entries(fields)){const value=object[field];if(typeof value==='string'&&selected.some(r=>r.plan.references.some(x=>x.projectId===projectId&&x.table===table&&x.value===value)))fail('ASSET_PURGED','Selected historical identity was cleared and cannot resolve to new content',410);}
}
