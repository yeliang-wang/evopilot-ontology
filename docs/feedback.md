# Execution feedback

The independently versioned `vendor/compatibility/feedback/v1` module defines event, receipt, proposal, review and disposition fields. The service exposes `feedback(envelope)` and lists supported operations in `capabilities().feedbackOperations`. Read the [shared workflow and API inputs](https://github.com/yeliang-wang/evopilot/blob/main/docs/feedback.md) for configuration, review, failure recovery and upgrade semantics.

Records belong to private owner state, scoped by Workspace and project. Native asset standards, source bindings, rules, coverage and immutable publication remain governed by this owner's existing `specifications/v1` (Runtime consumes those owner contracts). Feedback does not replace native validation, approve semantics, infer a software release, intercept arbitrary Agent activity or run online monitoring.

The first feedback write advances SQLite schema to 3. Close older connections and make a verified complete backup before upgrade. Old readers must reject feedback state. Rollback uses a matching installation and pre-upgrade backup; never rewrite historical records or schema markers.
