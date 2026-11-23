import test from 'node:test';
import assert from 'node:assert/strict';
import {publicationRefusalProbes} from '../acceptance/v090/limited-preview.mjs';
import {hashBytes} from '../../scripts/standards-gate.mjs';

test('limited collector exercises intended refusal paths without product calls or publication',()=>{
  const admission={bindings:{candidateDigest:hashBytes('synthetic candidate'),targetDigest:hashBytes('synthetic target'),limitedPolicyDigest:hashBytes('synthetic policy')},decisionDigest:hashBytes('synthetic admission; not authority')};
  const event=publicationRefusalProbes(admission,'a'.repeat(40),['OL02','OL03','OL05','OL06','OL07','OL08']);
  for(const key of ['missingDecision','foreignCandidate','agentApproval','missingRequiredEvidence','failedRequiredEvidence','unknownRequiredEvidence','staleCandidateEvidence'])assert.equal(event[key],'REFUSED');
  assert.equal(event.remoteOperations,0);assert.equal(event.releaseAuthorized,false);assert.equal(event.syntheticProbe,true);assert.equal(event.kind,'EXACT_SOURCE_RELEASE_GATE_NEGATIVES');
});
