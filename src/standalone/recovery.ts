import {fail} from './types.js';
import type {WorkspaceIdentity,Json} from './types.js';

/** A namespace separates genuinely new requests from outcomes absent in an old
 * snapshot. It is not authentication, permission or a license to rename retries. */
export function recoveryRequestPrefix(identity:WorkspaceIdentity):string|null {
  return identity.schema==='ontology-workspace/v2'?'r'+identity.recovery.generation+'.':null;
}
export function requireFreshRecoveryRequest(identity:WorkspaceIdentity,requestId:string):void {
  const prefix=recoveryRequestPrefix(identity);
  if(prefix!==null&&(!requestId.startsWith(prefix)||requestId.length===prefix.length))fail('REQUEST_OUTCOME_UNKNOWN','Original request outcome is unavailable after recovery; do not redispatch it or rename it as new work',409);
}
export function recoveryContext(identity:WorkspaceIdentity):Json {
  if(identity.schema==='ontology-workspace/v1')return null;
  const floor=identity.recovery.decisionAuditFloor;
  return {...identity.recovery,requestIdPrefix:recoveryRequestPrefix(identity),missingOlderReceipts:'UNKNOWN',draftHeadPolicy:'SELECTED_SNAPSHOT',decisionHeadPolicy:identity.recovery.retainedDigest===null?'SELECTED_SNAPSHOT_LATER_DECISIONS_UNKNOWN':'RETAINED_CURRENT',decisionFreshnessPolicy:floor===null?'NO_LOSS_RESTRICTION':floor===undefined?'CURRENT_RECOVERY_REVIEW_REQUIRED':'REVIEW_AFTER_RETAINED_AUDIT',newRequestSuffixMaximum:62,automaticRedispatch:false,authority:false};
}
