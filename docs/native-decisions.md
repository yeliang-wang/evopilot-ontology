# Native decision evidence

New corrected-v1 decisions require a readable local evidence record. A nonempty label such as `human:approved`, an absent file, or a successful validation report cannot establish this record.

`humanEvidenceRef` is a `file:` URL with `#sha256=<64 lowercase hex characters>`. It addresses a bounded regular UTF-8 JSON file with this structure:

```json
{
  "schema": "evopilot-decision-evidence/v1",
  "subject": {
    "owner": "ontology",
    "operation": "native.package.decide",
    "workspaceId": "my-workspace",
    "scope": { "visibility": "private", "projectId": "my-project" },
    "reviewDigest": "sha256:<exact review digest>",
    "decision": "APPROVE"
  },
  "source": {
    "reference": "file:///private/approval-source.json#sha256=<source bytes digest>",
    "description": "Reference to the actual operator authorization and its boundaries"
  }
}
```

The trusted operator records the actual authorization, then binds it to the exact reviewed operation. The owner verifies the record and its source bytes, workspace, visibility, project, operation, decision and review digest. No network lookup occurs. Changed or unavailable evidence blocks a new decision, publication or execution. Preserve these files with the private workspace's approval evidence and backups. Do not put private authorization records in a public repository.

This is integrity and scope validation within the existing trusted local operator model. It does not authenticate the person who wrote a file, prove human presence, or prevent a trusted local operator from creating a false attestation. The operator must not infer business approval from tests, model output or schema validity. Synthetic test records are explicitly labelled and carry no real business authority.

Existing immutable publications, decisions and receipts retain their original bytes and remain available for historical readback and reconciliation. Historical opaque references do not authorize a new action under the current check. Rebinding a new candidate requires evidence for the actual authorization; do not rewrite old records or rerun an uncertain claim to obtain a new receipt.
