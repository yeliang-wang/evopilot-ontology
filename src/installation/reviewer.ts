import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {existsSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {openWorkspace,privateRead,privatePath,requireMaintenanceAvailable,FILES} from '../standalone/workspace.js';
import {writePrivate,readPrivate,outsideSource} from './files.js';
import {id,timestamp,hashBytes,exact,hash,validateCredentials,validateIdentity} from '../standalone/validation.js';
import {fail} from '../standalone/types.js';
import {requireFreshRecoveryRequest} from '../standalone/recovery.js';
import type {Grant,Json} from '../standalone/types.js';

interface ReviewerIssuance {schema:'ontology-reviewer-issuance/v1';requested:{workspaceId:string;serviceId:string;projectId:string;principalId:string;grantId:string;expiresAt:string};token:string;}
function readReviewerIssuance(file:string):ReviewerIssuance {
  let saved:unknown;
  try{saved=readPrivate(file,8192);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')fail('GRANT_CONFLICT','Retained reviewer issuance is missing',409);throw e;}
  exact(saved,['schema','requested','token']);
  exact(saved.requested,['workspaceId','serviceId','projectId','principalId','grantId','expiresAt']);
  for(const key of ['workspaceId','serviceId','projectId','principalId','grantId'])id(saved.requested[key]);timestamp(saved.requested.expiresAt);
  if(saved.schema!=='ontology-reviewer-issuance/v1'||typeof saved.token!=='string'||!/^[-_A-Za-z0-9]{43}$/.test(saved.token))fail('GRANT_CONFLICT','Invalid retained reviewer issuance',409);
  return saved as unknown as ReviewerIssuance;
}

/** Read the current authority without taking the live owner's writer lease.
 * Historical issuance alone never restores a revoked, expired or rekeyed grant. */
export function readReviewerGrant(input:{root:string;workspaceId:string;serviceId:string;grantId:string}):{grant:Grant;credentialFile:string;identityDigest:string} {
  [input.workspaceId,input.serviceId,input.grantId].forEach(id);privatePath(input.root,true);
  if(outsideSource(input.root)!==input.root)fail('UNSAFE_PATH','Canonical reviewer workspace required');
  requireMaintenanceAvailable(input.root);
  const identity=readPrivate(join(input.root,FILES.identity),4096);validateIdentity(identity);
  if(identity.workspaceId!==input.workspaceId||identity.serviceId!==input.serviceId)fail('IDENTITY_MISMATCH','Reviewer workspace differs from installation',403);
  const credentials=readPrivate(join(input.root,FILES.credentials),512*1024);validateCredentials(credentials,identity);
  const grant=credentials.grants.find(g=>g.id===input.grantId);
  if(!grant)fail('NOT_FOUND','Reviewer grant is absent',404);
  if(grant.revoked||Date.parse(grant.expiresAt)<=Date.now())fail('UNAUTHENTICATED','Reviewer grant is expired or revoked',401);
  if(grant.projectIds.length!==1||grant.permissions.length!==2||!grant.permissions.includes('read')||!grant.permissions.includes('review'))fail('GRANT_CONFLICT','Selected grant is not an isolated reviewer',409);
  const saved=readReviewerIssuance(join(input.root,'reviewer-grant-'+input.grantId+'.json'));
  const requested={workspaceId:input.workspaceId,serviceId:input.serviceId,projectId:grant.projectIds[0]!,principalId:grant.principalId,grantId:grant.id,expiresAt:grant.expiresAt};
  const credentialFile=join(input.root,'reviewer-token-'+input.grantId);let token:string;
  try{token=privateRead(credentialFile,128);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')fail('GRANT_CONFLICT','Retained reviewer credential is missing',409);throw e;}
  if(hash(saved.requested)!==hash(requested)||token!==saved.token||hashBytes(token)!==grant.tokenHash)fail('GRANT_CONFLICT','Current reviewer authority differs from its retained issuance',409);
  return {grant,credentialFile,identityDigest:hash(identity as unknown as Json)};
}

/** Local operator only. Requires the owner to be stopped; never reachable by
 * ordinary modeling APIs or the MCP credential. Secret bytes stay private. */
export function grantReviewer(input:{root:string;workspaceId:string;serviceId:string;projectId:string;principalId:string;grantId:string;expiresAt:string}){
  [input.projectId,input.principalId,input.grantId].forEach(id);timestamp(input.expiresAt);
  const store=openWorkspace(input.root,input);
  try{
    const credentials=store.credentials(),grantFile=join(store.root,'reviewer-grant-'+input.grantId+'.json'),credentialFile=join(store.root,'reviewer-token-'+input.grantId);
    if(!credentials.grants.some(g=>g.id===input.grantId))requireFreshRecoveryRequest(store.identity,input.grantId);
    const requested={workspaceId:input.workspaceId,serviceId:input.serviceId,projectId:input.projectId,principalId:input.principalId,grantId:input.grantId,expiresAt:input.expiresAt};
    if(!existsSync(grantFile)){
      if(Date.parse(input.expiresAt)<=Date.now()||Date.parse(input.expiresAt)>Date.now()+30*86400000)fail('INVALID_INPUT','Reviewer grant expiry must be within the next 30 days');
      if(credentials.grants.some(g=>g.id===input.grantId))fail('GRANT_CONFLICT','Existing grant has no matching operator issuance record',409);
      writePrivate(grantFile,{schema:'ontology-reviewer-issuance/v1',requested,token:randomBytes(32).toString('base64url')});
    }
    const saved=readReviewerIssuance(grantFile);
    if(hash(saved.requested)!==hash(requested))fail('GRANT_CONFLICT','Grant ID belongs to another explicit operator request',409);
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
