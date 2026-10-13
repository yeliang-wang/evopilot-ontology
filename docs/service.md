# Owned Ontology service

For modeling concepts, see the [asset overview](../README.md#three-levels-of-semantic-assets); for standalone transport, see [CLI](cli.md). This reference describes current owned API and persistence boundaries. See the [current roadmap](roadmap.md) for implementation status and [migration provenance](../provenance/migration-current.json) for historical evidence.

Import `createOntologyService` from `@evopilot-next/ontology/service`. The factory accepts `createOntologyService({workspaceRoot, workspaceId}, trustedProviders)`. The optional second argument is trusted application code: classification uses `resolveClassificationSource`, `classificationAdvisor` and `classificationModel`; foreign Catalog material uses `resolveLegacyHarness`. Their exact contracts are in [Classification service](classification-service.md) and [Catalog service](catalog-service.md). Public JSON cannot inject callbacks; missing required providers fail explicitly. Neither the standalone CLI nor the default Preview daemon configures these providers. The returned API has `capabilities()`, `initialize()`, `execute(request)` and `close()`, plus async `classify(request)` for classification start/reanalyze. Import, construction and capabilities create nothing. `initialize()` explicitly opens or creates an external workspace; `close()` is idempotent and ends the instance. No ambient environment/default workspace is used.

```js
import { createOntologyService } from '@evopilot-next/ontology/service';

const service = createOntologyService({ workspaceRoot: '/absolute/external/workspace', workspaceId: 'example' });
service.initialize();
const scope = { visibility: 'public', projectId: 'example' };
const status = service.execute({ operation: 'workspace.inspect', scope, input: {} });
// Each mutation is a separate caller request with a fresh requestId.
const receipt = service.execute({
  operation: 'asset.put', scope, requestId: 'put-1',
  expectedRevision: status.revision, input: { model },
});
service.close();
```

Requests are closed finite descriptor-safe JSON. Every request has `operation`, `scope` and `input`; only mutations additionally require `requestId` and `expectedRevision`. Scope is always `{visibility:'public'|'private',projectId:slug}`. Workspace ids, project ids and request ids are lowercase alphanumeric/hyphen slugs, 1–64 characters, beginning alphanumeric. Caller actors are rejected; receipts and audit use the OS uid. Reads and receipts never return another project or visibility's records; the global revision itself is visible in every scope. The workspace marker does not register a Runtime project or grant authority.

| Operation | Exact input fields | Effect |
| --- | --- | --- |
| workspace.inspect | none | Workspace id, global revision and scoped asset count |
| receipt.inspect | requestId | Original scoped durable receipt |
| asset.list | none | Scoped asset summaries |
| asset.inspect | id, version | Scoped model, validation, review, decision and delivery |
| asset.put | model | Valid native draft, including PENDING; clears review/decision |
| asset.review | id, version | Workspace identity, scope, model digest and validation bound by reviewDigest |
| asset.decide | id, version, reviewDigest, decision, humanEvidenceRef | Explicit APPROVE or REJECT against the current review |
| asset.publish | id, version | Approved, still-current VALID model becomes immutable |
| source.install | sourcePath | Install an exact key from own listPublicSources() |
| source.list | none | Verified source summaries in current scope |
| source.inspect | sourceId | Retained record, inspection and verified original raw string |
| legacy.import | raw, format, sourceLocator, sourceRevision, sourceVisibility | Retain bounded inline JSON/YAML; quarantine invalid structure/schema |
| legacy.derive | sourceId, id, version, visibility | Derive a new native draft with coverage and unresolved issues |

Every review subject includes the complete workspace identity (including id and canonicalRoot), exact project/visibility scope, model digest and current validation. Decision and publication use the same subject to reject stale or foreign reviews. Existing reviews without this binding require a fresh review.

Source installation accepts only the four bundled Ontology source path keys returned by the existing `listPublicSources()` API and reads them through `readPublicSource()`. It accepts no arbitrary filesystem paths, URLs to fetch or foreign Harness sources. Source list/inspect are scoped to the current project and visibility. Public sources may enter private scopes; private sources cannot enter public scopes. Inline source visibility is caller-supplied origin metadata, not a classification oracle.

Inline `raw` is a well-formed Unicode string whose exact UTF-8 bytes are retained, including comments, whitespace and line endings. Binary/non-UTF-8 inputs are unsupported. JSON must parse to bounded finite descriptor-safe JSON. YAML uses parseDocument with unique keys, rejects warnings and custom tags, and limits alias expansion to 100 before applying the same JSON limits. Malformed encoding, malformed/unsafe syntax and oversized input fail without a receipt: the caller retains the original. Safely parsed documents with unknown schemas or invalid legacy structure are stored as QUARANTINED with inspection blockers and cannot derive assets.

Raw bytes are hashed without JSON canonicalization and stored as `sources/<sha256>.raw` in the owning Ontology blob subtree. Source identity hashes raw digest, format, exact origin and destination scope; byte variants with the same observed historical id/version remain distinct. Inspection preserves the document and observed identity/version/lifecycle without inventing missing versions. Reads verify raw hashes and retained documents. Raw materialization precedes the single state/receipt/audit transaction commit; failed commits may leave orphan bytes. Existing schema-v1 assets-only state remains supported; the validated sources collection is added lazily, with a 1,000-source limit.

Derivation requires a stored, successfully inspected, derivable source and explicit new id/version/visibility matching the current scope. It passes exact retained origin and expectedDocumentDigest to deriveLegacyModel, then saves a valid native draft through asset.put within the same transaction. Existing draft or published id/version pairs are never overwritten by derivation. Results include coverage and unresolved issues; required gaps keep models PENDING and prevent publication. Review, decision and delivery begin empty. Source instructions and executable code are never run or adopted.

Human evidence is an explicit reference supplied by the local operator, not independently authenticated identity. Validation and legacy state never imply approval. Review, decision and publication cannot auto-chain. Dependencies must be exact already-published Ontology delivery references in the same project, with matching version, digest and visibility. Private assets may depend on public assets in that project; public assets cannot depend on private assets. Missing and foreign-product dependencies are unsupported. Dependency digests are delivery digests; the raw delivery blob hash is separately returned as `blobDigest`. Existing `buildDelivery` and `verifyDelivery` remain unchanged. Local asset publication is not a software Release.

Workspace roots must be absolute canonical paths outside source/Git trees, with existing parents and no symlink ancestors. Initialization accepts a new/empty owner-only root or a verified identity. It rejects unknown nonempty roots, malformed/mismatched markers, wrong uid, unsafe modes, linked directories/files and hard-linked product files. It creates `workspace.json` with exactly `{schema:'evopilot-workspace/v1',id,canonicalRoot,ownerUid}` and `state/ontology/ontology.db`. Shared identity can later host other products; this service writes only its own state and asset subtrees. Directories are 0700 and files 0600. Product paths and SQLite sidecars are checked before open and requests. Corrupt or unknown databases fail; they are never recreated. This is local single-user security, not protection against malicious same-uid processes or concurrent path substitution by them.

SQLite is the state authority, using built-in `node:sqlite` DatabaseSync, timeout 1000 ms, extensions disabled, defensive mode enabled, WAL and synchronous FULL. SQL text is constant and JSON values are bound. Every mutation uses BEGIN IMMEDIATE with a global compare-and-swap revision. State, receipt and uid/operation/digest/revision audit commit together; failed requests get no durable receipt or revision. Audit contains no raw models, evidence references or credentials. Same request id and scope plus identical operation/input returns the original receipt even with a stale expectedRevision; changed content conflicts. Scope is part of the request-id key. There is no external-work retry, generic SQL operation or store-write RPC.

Models and deliveries use canonical JSON bytes in content-addressed files under `public/ontology` or `private/projects/<slug>/ontology`. Files are exclusively created, fsynced and hash/byte checked before database reference commit. Existing mismatched bytes fail instead of being overwritten. A crash/failure can leave an unreferenced orphan blob or an incomplete initialization; committed state never intentionally references a partial delivery. Blob garbage collection and automated initialization recovery are not implemented. Reopening an incomplete/corrupt database requires operator investigation, not deletion/recreation by this API.

Limits: requests 512 KiB, 20,000 JSON nodes, depth 48; 1,000 asset versions, 10,000 receipts, 8 MiB serialized state and 32 MiB receipt bodies. Retained orphan blobs are not garbage-collected or included in these logical limits. Errors have codes including INVALID_REQUEST, LIMIT, NOT_INITIALIZED, CLOSED, UNSAFE_WORKSPACE, UNKNOWN_WORKSPACE, IDENTITY_MISMATCH, CORRUPT_STATE, CORRUPT_BLOB, STATE_ERROR, NOT_FOUND, REVISION_CONFLICT, REQUEST_CONFLICT, INVALID_MODEL, SCOPE_MISMATCH, IMMUTABLE_VERSION, REVIEW_REQUIRED, REVIEW_MISMATCH, APPROVAL_REQUIRED, PENDING_MODEL and UNSUPPORTED_DEPENDENCY. Lock/SQLite failures do not authorize redispatch of uncertain work; inspect the exact request receipt first.

The supported service target is Node **24.14.0**, with built-in `node:sqlite`. The SQLite API remains experimental. See [source validation](../CONTRIBUTING.md) for build, type checks and regression commands. Native asset authoring requires no external LLM.

Existing pure/compat/migration/source APIs, v1 fixtures, schemas, public sources and vendor bytes remain unchanged. The [28 retained legacy queries](legacy-api.md) now run synchronously as read-only previews. The ten scoped Catalog routes are implemented (see [Catalog service](catalog-service.md)); the seven persistent classification routes are now implemented (see [Classification service](classification-service.md)). The standalone CLI is implemented. Parent Preview MCP routing and unified Expert guidance are implemented. Application-specific advanced providers remain required. Unsupported operations fail explicitly.

The complete closed query and producer input tables, historical calculation authority boundary and scoped stored-source validation/diff behavior are documented in [Legacy API](legacy-api.md). Seven retained producers and the proposal.create helper use producer.prepare/inspect/list/decide. Named producers accept only planId. Their exact current dependency bindings survive their own prepare/decision revision changes, but reject changed records. Query outputs never grant native review or publication rights.

Producer plans and records each have a 1,000-entry limit and share the existing total state/receipt limits. Durable document/history/plan blobs follow the same verification and orphan-on-failure behavior as asset blobs. Fresh decisions use actual OS uid and explicit local evidence references; this is not independent multiuser authentication. Artifact INSTALL/ACTIVATE are local lifecycle records with no Runtime or Harness side effect. Local operations do not establish acceptance or production readiness.

## Preview integration and provider boundaries

Ordinary Codex use comes from the [parent distribution and unified Expert](https://github.com/yeliang-wang/evopilot/blob/main/README.md); see the [four journeys](https://github.com/yeliang-wang/evopilot/blob/main/docs/first-journey.md). The parent Preview MCP SDK exposes `request(owner, envelope)`. Owner `ontology` routes the unchanged envelope to this service: `classification.start` and `classification.reanalyze` await `service.classify`; other operations use synchronous `service.execute`. Activation is explicit per stdio session and off by default. Discovery and guidance-only requests remain passive.

Runtime composition provides deterministic ontology-instance and Harness-evidence evaluation, not arbitrary code generation. Harness QA/evidence and Runtime execution retain their independent ownership.

The parent factory forwards validated trusted-provider keys. Neither the default Preview daemon nor standalone CLI supplies `resolveClassificationSource`, `classificationAdvisor`, `classificationModel` or `resolveLegacyHarness`. Classification needs all three of its bindings, including exactly `{providerId, modelId, revision, timeoutMs}`; foreign Catalog material needs the resolver. These are SDK-injected application providers, not public JSON or inherited Host credentials. Missing classification configuration yields `CLASSIFICATION_PROVIDER_UNAVAILABLE` or `CLASSIFICATION_SOURCE_UNAVAILABLE`; absent foreign Catalog providers yield `PROVIDER_REQUIRED`.

For repository reverse modeling, the Host interprets authorized sources into the native contract with observed/inferred mappings and unresolved business questions. Source evidence alone never confirms business meaning. The structured JSON/YAML legacy bridge does not parse arbitrary repositories or Java source. Retained historical schemas remain distinct from native v1.

Source consumers build before importing `dist/service.js`; installed consumers use `@evopilot-next/ontology/service`. Technical evidence and local lifecycle decisions do not confer software release authority.
