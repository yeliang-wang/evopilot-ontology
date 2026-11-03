import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {existsSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {openWorkspace,privateRead,FILES} from '../standalone/workspace.js';
import {writePrivate,readPrivate} from './files.js';
import {id,timestamp,hashBytes,exact,hash,validateCredentials} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import type {Grant,Json} from '../standalone/types.js';

/** Local operator only. Requires the owner to be stopped; never reachable by
 * ordinary modeling APIs or the MCP credential. Secret bytes stay private. */
export function grantReviewer(input:{root:string;workspaceId:string;serviceId:string;projectId:string;principalId:string;grantId:string;expiresAt:string}){
  [input.projectId,input.principalId,input.grantId].forEach(id);timestamp(input.expiresAt);
  const store=openWorkspace(input.root,input);
  try{
    const credentials=store.credentials(),grantFile=join(store.root,'reviewer-grant-'+input.grantId+'.json'),credentialFile=join(store.root,'reviewer-token-'+input.grantId);
    const requested={workspaceId:input.workspaceId,serviceId:input.serviceId,projectId:input.projectId,principalId:input.principalId,grantId:input.grantId,expiresAt:input.expiresAt};
    if(!existsSync(grantFile)){
      if(Date.parse(input.expiresAt)<=Date.now()||Date.parse(input.expiresAt)>Date.now()+30*86400000)fail('INVALID_INPUT','Reviewer grant expiry must be within the next 30 days');
      if(credentials.grants.some(g=>g.id===input.grantId))fail('GRANT_CONFLICT','Existing grant has no matching operator issuance record',409);
      writePrivate(grantFile,{schema:'ontology-reviewer-issuance/v1',requested,token:randomBytes(32).toString('base64url')});
    }
    const saved=readPrivate(grantFile,8192);exact(saved,['schema','requested','token']);
    if(saved.schema!=='ontology-reviewer-issuance/v1'||hash(saved.requested as Json)!==hash(requested)||typeof saved.token!=='string'||!/^[-_A-Za-z0-9]{43}$/.test(saved.token))fail('GRANT_CONFLICT','Grant ID belongs to another explicit operator request',409);
    if(!existsSync(credentialFile)){const fd=openSync(credentialFile,'wx',0o600);try{writeFileSync(fd,saved.token);fsyncSync(fd);}finally{closeSync(fd);}}
    if(privateRead(credentialFile,128)!==saved.token)fail('GRANT_CONFLICT','Reviewer credential bytes differ from issuance record',409);
    const grant:Grant={id:input.grantId,principalId:input.principalId,projectIds:[input.projectId],permissions:['read','review'],expiresAt:input.expiresAt,revoked:false,tokenHash:hashBytes(saved.token)},existing=credentials.grants.find(g=>g.id===input.grantId);
    if(existing){if(hash(existing as unknown as Json)!==hash(grant as unknown as Json))fail('GRANT_CONFLICT','Existing or revoked grant cannot be overwritten',409);}
    else{credentials.grants.push(grant);validateCredentials(credentials,store.identity);store.guard();writePrivate(join(store.root,FILES.credentials),credentials,true);}
    return {grantId:grant.id,principalId:grant.principalId,projectId:input.projectId,permissions:[...grant.permissions],expiresAt:grant.expiresAt,credentialFile,authorityScope:'MODEL_SEMANTICS_ONLY'};
  }finally{store.close();}
}
export function revokeReviewer(input:{root:string;workspaceId:string;serviceId:string;grantId:string}){
  id(input.grantId);const store=openWorkspace(input.root,input);
  try{const credentials=store.credentials(),grant=credentials.grants.find(g=>g.id===input.grantId&&g.permissions.includes('review'));if(!grant)fail('NOT_FOUND','Reviewer grant is absent',404);
    grant.revoked=true;store.guard();writePrivate(join(store.root,FILES.credentials),credentials,true);return {grantId:grant.id,revoked:true};
  }finally{store.close();}
}
