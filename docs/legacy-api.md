# Retained read/query service API

The synchronous `createOntologyService` API from `@evopilot-next/ontology/service` (compiled `dist/service.js`) exposes 28 finite historical queries. Requests have exactly {operation, scope, input}; scope is {visibility: "public" | "private", projectId}. Query requests reject requestId and expectedRevision. Input is bounded descriptor-safe JSON; object arguments remain objects. Unknown top-level input fields are rejected. Nested typed documents retain their owned compatibility contracts and digest validation. No caller-selected module, export, callback, filesystem path, provider or network execution is available.

Every result is {operation, compatibility: "evopilot-harness@4.8.2", previewOnly: true, authority: false, result}. The inner result preserves historical wire schemas, digest conventions, algorithms and status vocabulary. Historical approval/publication fields are calculation evidence only. They cannot approve, publish, mutate or advance any native service record. No query writes assets, source data, decisions, audit, receipts or the global SQLite revision.

Required and optional input fields are listed below. Optional defaults come from the named owned src/compat function; required semantic identities must still be supplied (for example reasoning profiles need id/version or metadata containing both). Proposal createdBy is not accepted: the service supplies uid:<OS uid>.

| Operation | Required input fields | Optional input fields | Owned calculation |
| --- | --- | --- | --- |
| semantic.foundation.inspect | none | metaTypes, relationTypes, limits | grounding.resolveOntologyFoundation |
| semantic.candidates.inspect | sourceConceptHypothesis | candidates, extraction | grounding.createSemanticCandidateSet |
| semantic.grounding.inspect | candidateSet | foundation, concepts, expected, priorResults, locale | grounding.resolveOntologyGrounding |
| semantic.reasoning-profile.inspect | none | id, version, metadata, mode, limits, externalReasoner, supportedRules | interoperability.createOntologyReasoningProfile |
| semantic.index.inspect | snapshot | assets, algorithm, policy, toolchain, cache | interoperability.buildSemanticIndex |
| semantic.affected-subgraph.inspect | index, profile | changedConceptIds, cacheDigest | interoperability.calculateAffectedSubgraph |
| semantic.compute.inspect | index, profile | mode, affectedSubgraph, externalReasonerResult, execution | interoperability.computeSemanticState |
| semantic.compute.compare | incremental, full | none | interoperability.compareSemanticComputations |
| semantic.federation.discover | none | roots, query | interoperability.discoverFederatedPacks |
| semantic.interoperability.inspect | snapshot, profile, index | externalMappings, multilingualTerms, unsupportedSemantics | interoperability.createInteroperabilityProjectionSet |
| semantic.round-trip.inspect | snapshot, projectionSet, index, incremental, full | none | interoperability.verifySemanticRoundTrip |
| semantic.closure.inspect | snapshot, profile, index, projectionSet, roundTripReport | harnessAssets, dependencyLocks, evaluations, rollbackLinks, provenance | interoperability.createTerminalSemanticClosure |
| semantic.closure.slice | closure, expectedClosureDigest | conceptIds | interoperability.sliceTerminalSemanticClosure |
| pack.scaffold.inspect | kind, metadata | spec | packs.createProfessionalPack |
| pack.inspect | pack | availablePacks | packs.inspectProfessionalPack |
| pack.resolve.inspect | none | packs, precedence, targetRoot, expectedBaseDigest, baseSnapshot | packs.resolveProfessionalPackSet |
| pack.benchmark.inspect | id, version, provenance | cases, metrics, evidenceRefs | packs.createPackBenchmarkPackage |
| pack.gold-case.inspect | id, version, source, expectedOutcome, provenance | expectedConcepts, evidenceRefs | packs.createPackGoldCasePackage |
| pack.certification.inspect | pack, benchmark, algorithm, policy, toolchain | goldCases, qualityLevel, signer, evidenceRefs | packs.createPackCertificationRecord |
| semantic.evidence-adapter.inspect | id, version, provenance | sourceTypes | packs.createExternalSemanticEvidenceAdapter |
| semantic.evidence.import.inspect | source | adapter, records, fetchedAt | packs.importExternalSemanticEvidence |
| project-ontology.proposal.inspect | project, packs | precedence, targetRoot, baseSnapshot, expectedBaseDigest, overlay, now | projectOntology.createProjectOntologyProposal |
| project-ontology.snapshot.resolve | proposal, expectedProposalDigest, foundationDigest | priorSnapshot, now | projectOntology.resolveProjectOntologySnapshot |
| project-ontology.projections.inspect | snapshot | none | projectOntology.createProjectionSet |
| project-ontology.skill.inspect | snapshot | projectionSet, artifactSetManifestDigest, instructions | projectOntology.compileProjectOntologySkill |
| ontology.inspect | none | none | stored-source.source.inspect (scoped OntologyPack enumeration) |
| ontology.validate | sourceId | none | stored-source.source.inspect + validation.validateDocument |
| ontology.diff | leftSourceId, rightSourceId | none | stored-source.source.inspect + deterministic structuralDiff |

pack.inspect adapts {pack, availablePacks?} to the two-argument owned function; project-ontology.projections.inspect adapts {snapshot} to its single document argument. Pack functions accept only Ontology kinds, never DomainHarnessPack. Public requests reject nested private Packs/materials. All explicit project bindings, including nested proposals/snapshots/closures, must retain the exact scope projectId and service workspaceId; values are never silently relabeled. Foreign Harness producers are rejected. Closure/index calculations may carry exact {kind,id,version,digest} Harness references as inert evidence.

ontology.inspect takes {} and returns verified stored INSPECTED OntologyPack source records with their complete documents and raw bytes, only from the exact project/visibility scope. It does not enumerate filesystem paths. ontology.validate takes {sourceId} and returns {sourceId, documentDigest, validation} using the current owned historical validator. Quarantine blocks validation. Unsupported kinds fail explicitly. All three queries reuse source.inspect identity, document and raw-byte verification.

ontology.diff takes {leftSourceId,rightSourceId} and compares verified OntologyPack documents recursively. Its sorted JSON Pointer paths escape ~ and /; ADD/REMOVE omit the absent side, preserving absence versus null. Arrays use positional paths. Results are structural evidence with semanticEquivalence: NOT_ASSERTED, never semantic PASS. Quarantined OntologyPacks may be compared diagnostically with status BLOCKED; inspected pairs use COMPARED. This does not assert business-semantic equivalence or unblock validation/derivation.

Project snapshot resolution and closure slicing can calculate from digest-valid historical approvals/publications supplied by the caller. This grants no current service rights. Lifecycle and publication functions are mutations behind the separate producer plan layer below. Native specifications/v1 remains separate; native conversion is only the explicit legacy.derive operation with coverage and unresolved issues.

## Finite retained producers

Mutations require the usual requestId and expectedRevision. First call `producer.prepare` with exactly `{operation,parameters}`. Its persisted, unapproved plan includes a planId and reviewDigest binding complete current workspace identity, exact scope, operation, parameters and every affected current owned record/source digest. It does not bind the global revision. `producer.inspect {planId}` and `producer.list {}` read scoped plans without advancing revision. Then `producer.decide {planId,reviewDigest,decision,humanEvidenceRef}` records a new APPROVE or REJECT and actual store OS uid. Each named producer takes only `{planId}`; it requires the matching operation, a current APPROVE and unchanged dependencies, then consumes the plan in the state/receipt/audit transaction. A second request cannot reuse a consumed plan. The identical requestId replays only its original receipt.

| Prepared operation | Required parameters | Optional parameters |
| --- | --- | --- |
| ontology.publish | sourceId | none |
| pack.lifecycle.create | pack, targetRoot | availablePacks, dependencyClosure, conflictPreview, project, migrationPlan |
| pack.lifecycle.transition | recordId, expectedRecordDigest, action | reason, successor, rollbackTarget, migrationPlan |
| project-ontology.proposal.create | project, packs | precedence, targetRoot, baseSnapshot, expectedBaseDigest, overlay |
| project-ontology.proposal.transition | recordId, expectedProposalDigest, action | reason |
| project-ontology.artifact.publish | recordId, expectedProposalDigest, foundationDigest, version | foundation |
| project-ontology.artifact.transition | artifactRecordId, expectedArtifactDigest, recordId, expectedRecordDigest, action | reason, successor, rollbackTarget, migrationPlan |
| semantic.closure.publish | closure, artifactRecordId, expectedArtifactDigest, version | none |

Proposal create is a new owned draft helper using the existing createProjectOntologyProposal fields except createdBy/now. The service supplies OS actor and time. Proposal transitions permit APPLY, REQUEST_REVIEW, APPROVE, REJECT. Pack transitions permit APPLY, REQUEST_REVIEW, APPROVE, PUBLISH, INSTALL, ACTIVATE, SUPERSEDE, ROLLBACK, DEPRECATE. Artifact transitions permit the last five actions. Compat helpers enforce current stage and the fixed action role; role names are workflow labels, not independently authenticated permissions. Successor and migrationPlan are exact `{id,version,digest}` bindings permitted only for SUPERSEDE; rollbackTarget only for ROLLBACK. Arbitrary historical records, caller actor/time/role, plan status and decision injection are rejected.

Ontology publication takes one currently verified valid legacy OntologyPack source. Its document and original raw bytes remain unchanged; fresh local publication metadata is returned in the owned record history, preserving the legacy document schema. Historical lifecycle labels confer no rights. Record IDs derive deterministically from scope and concrete identity; an existing published kind/id/version is immutable even under a different requestId.

Artifact publication requires an owned APPROVED proposal and a separate newly approved publication plan. It recomputes snapshot, projections, manifest and skill using owned compat helpers. Version is an explicit numeric MAJOR.MINOR.PATCH with no leading zeroes. Caller priorSnapshot, dependencyLock, projections and skill overrides are unsupported in this first publication API. The result returns `record` and an owned `lifecycle` initially at PUBLISHED. Subsequent transitions require both exact artifact and lifecycle record bindings. INSTALL/ACTIVATE describe local records only: there is no Runtime/Harness installation or activation side effect, software release or foreign state write.

Artifact `foundation` is an optional complete canonical document returned by the owned `resolveOntologyFoundation` helper. Omission selects exactly the builtin foundation. Supplied descriptor-safe data is normalized through that helper's `metaTypes`, `relationTypes` and `limits` inputs, then compared against the entire canonical output, including authority fields and `foundationDigest`. Extra embedded fields, unsupported definitions, noncanonical documents and digest drift fail before preparation writes. The required `foundationDigest` must equal the selected material's digest; unknown digests never fall back. Helper-supported custom limits remain supported. The full foundation and its digest are bound in plan dependencies and retained on the output record, in its history, and as a verified immutable blob for future Catalog reconstruction.

Pack creation validates `pack` plus optional `availablePacks` (an array, default `[]`) with owned inspection and set resolution. Only an exactly identical primary Pack duplicate is normalized away; conflicting identities and other duplicates fail. Every supplied Pack must pass lint, required imports and exact digest checks; cycles and concept conflicts fail. Optional missing imports retain the owned validator's semantics. The service derives `dependencyClosure: {digest: resolved.packSetDigest}` and `conflictPreview: {digest: digest(resolved.conflicts)}`, where `resolved` is the owned `resolveProfessionalPackSet({packs: [pack, ...normalizedAvailablePacks], targetRoot})` output and `digest` is the existing compat/v3 deterministic digest helper. Optional caller pins must equal these exact objects; false pins fail instead of being replaced. The legacy pure helper contract is unchanged.

Pack output `material` contains `pack`, normalized `availablePacks`, `targetRoot`, the complete `resolved` output and both derived pin objects. `materialDigest` is its native stable-JSON SHA-256. Material and digest are bound in plan dependencies, retained on the record and every history entry, and stored as an independently verified immutable blob. Every transition re-inspects and resolves retained material, compares it with the record's Pack/root/pins and prepared dependencies, including at decision and execution time. Approval cannot waive validation. Historical records lacking complete retained material remain readable but transitions fail `MATERIAL_REQUIRED`; no synthetic backfill occurs.

Semantic closure publication requires a digest-valid CANDIDATE closure whose snapshot digest and complete project binding match the owned published artifact. Version must match the closure. New publication authorizationDigest, actor and time derive from this plan decision. Exact Harness references are inert evidence; DomainHarnessPack and full foreign Harness producers are always rejected. Project/workspace/private boundaries reuse the query scope checker.

These APIs provide local operator evidence, not independent multiuser authentication. Any process with the same OS identity can supply an evidence reference. Returned historical APPROVED/PUBLISHED labels never establish new authority. Plans and records are additive SQLite collections bounded to 1,000 each within the existing 8 MiB state limit. Every accessed plan, record document and history blob is checked against durable content. Publication receipts expose record IDs and compat expected digests; receipt.inspect reads the immutable historical result.

## Current service integration and limits

The ten [Catalog routes](catalog-service.md) use the owned SQLite service, exact local decisions and verified producer material. Catalog controls are additional to those ten routes. The legacy file-backed recovery library remains separate and unchanged.

Seven persistent [classification operations](classification-service.md), the [CLI](cli.md), parent Preview MCP routing and unified Expert guidance are implemented. See [integration boundaries](service.md#preview-integration-and-provider-boundaries) for explicit activation and application-provider requirements. Default CLI/Preview deployments do not configure classification or external legacy Harness Catalog providers.

Producer verification covers durable revisions/receipts/audit on rejection, material retention, restart, tamper and unresolved historical records. See the [source validation workflow](../CONTRIBUTING.md) and historical [mapping provenance](../provenance/service-migration.json).
