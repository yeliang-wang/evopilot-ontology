import type {DatabaseSync} from 'node:sqlite';
import type {WorkspaceIdentity,Json} from '../standalone/types.js';
import {fail} from '../standalone/types.js';
import {canonical,hash,hashBytes,id,timestamp} from '../standalone/validation.js';
import {recoveryRequestPrefix} from '../standalone/recovery.js';
import {checkDecision} from './lifecycle-contract.js';

export type ReviewRecovery = {
  status:'NO_DECISION'|'NOT_REQUIRED'|'CONFIRMED'|'UNCONFIRMED';
  reviewRequired:boolean;recoveryGeneration:string|null;
  auditSequenceFloor:number|null;auditSequence:number|null;
};

/** This proves only a reviewer submission after the last unknown-history
 * boundary. It never changes the decision, its grant, or a delivered bundle. */
export function reviewRecovery(db:DatabaseSync,identity:WorkspaceIdentity,projectId:string,assetId:string,reviewDigest:string|null):ReviewRecovery {
  if(!db.isTransaction)fail('TRANSACTION_REQUIRED','Review recovery proof requires the owner transaction');
  const recovered=identity.schema==='ontology-workspace/v2',floor=recovered?identity.recovery.decisionAuditFloor:null;
  const state=(status:ReviewRecovery['status'],auditSequence:number|null=null):ReviewRecovery=>({status,reviewRequired:status==='UNCONFIRMED'||status==='NO_DECISION',recoveryGeneration:recovered?identity.recovery.generation:null,auditSequenceFloor:floor??null,auditSequence});
  if(reviewDigest===null)return state('NO_DECISION');
  if(floor===null)return state('NOT_REQUIRED');
  const review=db.prepare('SELECT candidate_digest,document,revision FROM native_reviews WHERE project_id=? AND asset_id=? AND digest=?').get(projectId,assetId,reviewDigest);
  if(!review||typeof review.document!=='string'||!Number.isSafeInteger(review.revision)||Number(review.revision)<1)return state('UNCONFIRMED');
  let decision:unknown;
  try{decision=JSON.parse(review.document);checkDecision(decision);}catch{return state('UNCONFIRMED');}
  if(hash(decision as unknown as Json)!==reviewDigest||decision.candidateDigest!==review.candidate_digest)return state('UNCONFIRMED');
  // The globally monotonic audit sequence survives recovery verbatim. Select
  // at most two candidates: duplicate audit claims are ambiguous, not proof.
  const matches=db.prepare(`SELECT a.*,r.digest AS receipt_request_digest,r.receipt
    FROM audit a JOIN receipts r ON r.project_id=a.project_id AND r.principal_id=a.principal_id AND r.request_id=a.request_id
    WHERE a.project_id=? AND a.principal_id=? AND a.operation='review.decide' AND a.sequence>?
      AND CASE WHEN json_valid(r.receipt) THEN json_extract(r.receipt,'$.revision')=? AND json_extract(r.receipt,'$.result.reviewDigest')=? ELSE 0 END
    ORDER BY a.sequence LIMIT 2`).all(projectId,decision.principalId,floor??0,review.revision,reviewDigest);
  if(matches.length!==1)return state('UNCONFIRMED');
  const row=matches[0];
  if(!Number.isSafeInteger(row.sequence)||typeof row.receipt!=='string')return state('UNCONFIRMED');
  try{id(row.request_id);timestamp(row.recorded_at);}catch{return state('UNCONFIRMED');}
  // Legacy recovered identities have no persisted floor. Their own new request
  // generation is the available conservative boundary until the next restore.
  const prefix=recoveryRequestPrefix(identity);
  if(floor===undefined&&(prefix===null||!row.request_id.startsWith(prefix)||row.request_id.length===prefix.length))return state('UNCONFIRMED');
  const input={assetId,candidateDigest:decision.candidateDigest,reportDigest:decision.reportDigest,previousDecisionDigest:decision.previousDigest,decision:decision.decision,rationale:decision.rationale,instruction:decision.instruction,requirementIds:decision.requirementIds};
  const requestDigest=hash({workspaceId:identity.workspaceId,serviceId:identity.serviceId,projectId,operation:'review.decide',input} as unknown as Json);
  const result={candidateDigest:decision.candidateDigest,reviewDigest,decision:decision.decision,principalId:decision.principalId,instructionVerification:decision.instructionVerification,authorityScope:decision.authorityScope,delivered:false,softwareReleaseAuthority:false};
  const expected={schema:'ontology-receipt/v1',workspaceId:identity.workspaceId,serviceId:identity.serviceId,projectId,principalId:decision.principalId,requestId:row.request_id,requestDigest,operation:'review.decide',revision:review.revision,status:'COMPLETED',recordedAt:row.recorded_at,result};
  if(row.request_digest!==requestDigest||row.receipt_request_digest!==requestDigest||row.receipt!==canonical(expected as unknown as Json)||row.receipt_digest!==hashBytes(row.receipt))return state('UNCONFIRMED');
  return state('CONFIRMED',Number(row.sequence));
}
