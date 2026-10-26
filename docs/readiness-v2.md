# Ontology asset readiness v2 API

Call the public service's `readiness(envelope)` method. This is additive; existing `usability.*` and native package APIs retain their old meaning. Every envelope carries exact project scope and `input.standardVersion: "v2"`. Mutations require `requestId` and `expectedRevision`; reads reject mutation fields. Responses retain `authority: false`.

| Operation | Inputs and meaning |
|---|---|
| `readiness.standard.inspect` | Inspect exact v2 definition and digest. |
| `readiness.package.inspect` | Project exact id/version including published flag, intent, specification and normative files. |
| `readiness.package.export` | Return the same fixed, independently verifiable normative projection. |
| `readiness.package.verify` | Verify supplied projection integrity and current workspace/scope; confers no grade. |

L1 is domain understanding, L2 is implementation specification, and L3 is complete reconstruction specification for the selected scope. The grade depends on independently fixed requirements, source-grounded or design-declared content, provenance and criterion-level semantic review. Mechanical validation alone cannot establish semantic correctness.

`assetAssessment` contains level, status, freshness, gaps and evidence origin. `reconstructionVerification` is independent and defaults to NOT_REQUESTED. A qualified v2 L3 never proves that generated software has actually been reconstructed, is functionally equivalent or is production ready. Actual linked evidence retains its original standard and scope.

Intent/specification drift or a confirmed semantic defect reopens content qualification. External execution environment unavailability affects optional reconstruction freshness, not the content grade. Missing version, unresolved content, source/scope mismatch, missing native publication and altered file hashes are rejected or retained as incomplete as appropriate. No readiness operation invokes an execution adapter, business database or SSH.

The parent supplies trusted cross-owner providers through public APIs. The request payload cannot select a provider or claim a grade. Missing providers fail closed. Native asset publication and actual human semantic decisions remain independent of assessment and technical validation.

[Workflow and field meanings](https://github.com/yeliang-wang/evopilot/blob/v0.8.1/docs/asset-readiness-v081-workflow.md) · [Migration and rollback](https://github.com/yeliang-wang/evopilot/blob/v0.8.1/docs/migration-v080-v081.md).
