# EvoPilot Ontology v1 — normative minimal core

JSON is the native interchange. This document, [asset.schema.json](asset.schema.json), and runtime semantic validation jointly define v1. Schema checks syntax; runtime additionally checks duplicate IDs, closed references, ownership, complete source coverage, matching source revisions/statuses, typed enums and ordered bounds. Both checks are required. The API performs syntax and semantics itself without a schema dependency.

The common envelope requires id/version/product/specVersion/visibility/provenance/dependencies/extensions. Product is ontology, specVersion is v1, and versions are strict SemVer core (major.minor.patch, no leading zeros, prerelease or build suffix). The frozen six-field reference wire and independent CONTRACT_REVISION 1.0.0 remain unchanged. Dependencies are exact references including digests; duplicate product/id identities and private dependencies of public assets are rejected.

Only finite acyclic descriptor-safe JSON is accepted: plain objects, dense arrays, strings, finite numbers, booleans and null. Accessors, symbols, nonenumerable properties, executable values, undefined, sparse/decorated arrays and cycles are rejected before value traversal. Serialization sorts object keys, preserves array order and uses JSON number/string encoding; SHA256 hashes the serialized UTF-8 bytes. This is not a claim of an external canonicalization standard. Snapshots/reports are deeply frozen clones; inputs remain unchanged.

Provenance requires direction forward|reverse and nonempty sources. Every source has id/kind/locator/revision/digest/status. Status is design-proposed, design-confirmed, source-observed, inferred, runtime-observed, human-reviewed or synthetic. This vocabulary is EvoPilot design; no status grants approval or is automatically promoted. Source digests are declared pins, not evidence external bytes were fetched or authenticated.

All outer fields and six model arrays are mandatory; unknown fields fail closed:

- concepts: at least one row with id/label/definition.
- properties: id/conceptRef/type/required. Type is string|number|integer|boolean; required is boolean.
- relations: id/from/to/directed; directed must be true and ends reference concepts.
- constraints: id/conceptRef/propertyRef/kind/required plus kind-specific fields below. Property ownership must match conceptRef.
- sourceMappings: id/targetRef/sourceRef/sourceLocator/sourceRevision/status. Every concept, property, relation and constraint needs coverage. Locator, revision and status exactly match its source. Duplicate target/source pairs fail.
- unresolvedIssues: id/description/targetRef/required. Targets are semantic rows; required issues give valid draft status PENDING but block delivery.

Row IDs are globally unique across sources, semantic rows, mappings and issues. Text fields are nonempty trimmed strings without control characters. All internal references are closed.

numeric-range requires finite minimum/maximum, inclusive and ordered, on numeric properties. enum requires nonempty typed unique values. cardinality requires safe-integer nonnegative minCount/maxCount in order. descriptive-range requires description and required:false; it is always UNSUPPORTED. Unknown kinds, including required ones, are rejected. Unsupported is never PASS.

Extensions remain additive and inert. Envelopes are exactly namespace/version/required/data. Namespace is dotted lowercase identifiers; versions are strict SemVer core. Duplicate namespaces and base-field conflicts/overrides fail. local.notes@1.0.0 validates data:{annotation:{text,language?}}, both nonempty text strings, no extra fields. Required local.notes is meaningful typed annotation validation, without executable behavior. Unknown optional extensions are retained and reported NOT_EVALUATED; unknown required ones fail. Caller string arrays cannot register support.

validateOntology(asset) returns an immutable structured report, errors with code/path/message, pending issues, extensions and constraint instance statuses NOT_CHECKED or UNSUPPORTED. Malformed nested input produces rejection reports rather than escaping validation exceptions.

validateInstances(asset, instances) accepts exactly {entities,relations}. Entities are id/conceptRef/properties, with properties mapping property IDs to arrays of values, even for single values. Required properties need at least one value; false and zero count. Relations are id/relationRef/from/to, with existing entity endpoints matching declared concept types. IDs are unique across entity/relation rows. Primitive types and numeric-range/enum/cardinality are enforced independently. Coverage records actual tested entity counts and PASS/FAIL/NOT_CHECKED/UNSUPPORTED for each constraint. Empty data is never full coverage. Empty optional values leave value constraints untested; cardinality still evaluates count. valid concerns supplied data; complete and untested disclose coverage. This is not proof about all possible instances.

buildDelivery(asset) rejects invalid models and required unresolved issues. It returns model/provenance/sourceMappings/unresolvedIssues/validationReport/buildReport/manifest/digest. Without instance data the build always records instanceValidation:NOT_CHECKED. Manifest pins spec v1, implementation productVersion, asset identity/version/visibility, modelDigest, contentDigest and exact dependency references/digests. Content digest covers all fields preceding manifest; outer digest covers content plus manifest. No time/random values enter artifacts.

verifyDelivery(delivery) validates the model and rebuilds/compares the entire deterministic artifact, rejecting unknown fields and tampered reports. A self-consistent rebuilt model is a different artifact, not proof of matching an external trusted pin. Integrity is not authority: authority/businessConfirmed/released remain false.

[sources.json](sources.json) records exact sources, clause boundaries and test names. No full OWL/RDF/SHACL/PROV compliance, RDF serialization, inference, ontology reasoning or ROBOT execution is claimed.

[Template](templates/model.json) and [examples](../../examples/synthetic-models.json) are entirely synthetic: orchard and observatory × forward requirement-only/reverse invented source-derived × public/private = eight assets. Each exact synthetic locator identifies record-1 at synthetic-r1. Source digest bytes are UTF-8 text "Synthetic <domain> <direction> record-1". No real implementation or private data is represented.

Source checkout: run `npm run build` from the parent to generate pinned vendors, then `npm test`. Child `npm test` requires that parent build first. E01–E19, full legacy migration, service/Host acceptance and release remain pending.

[Historical source inspection and explicit native derivation](legacy-derivation.md) use a separate public migration subpath and do not change the native contract.
