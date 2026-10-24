import {createHash} from 'node:crypto';
// Synthetic trusted-host fixture only. Never represents actual user intent or approval.
export function syntheticAuthoring(request) {
 const hash=value=>'sha256:'+createHash('sha256').update(JSON.stringify(value)).digest('hex');
 return {...request,schema:'evopilot-native-authoring-admission/v1',candidateDigest:hash(['synthetic-candidate',request.workspaceId,request.scope]),sourceInventoryDigest:hash('synthetic-source'),requirementsDigest:hash('synthetic-independent-requirements'),modelingIntentDigest:request.sourceDirection==='reverse'?hash('synthetic-modeling-intent'):null,targetLevel:request.sourceDirection==='reverse'?'L1':null,authority:false};
}
