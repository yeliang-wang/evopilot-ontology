# Bounded native inputs and complete metadata reads

Development behavior for the approved v0.9 scope. These bounds connect existing native v2 document admission to the public owner service. They do not establish formal standards acceptance, reference-workload performance, actual Expert Host acceptance or release readiness.

| Operation | Native document JSON | Operation input | Whole owner request |
|---|---:|---:|---:|
| `source.admit` | 48 MiB source set | native maximum + 4 KiB | input maximum + 4 KiB |
| `model.record` | 48 MiB draft | native maximum + 4 KiB | input maximum + 4 KiB |
| `expectations.record` | 16 MiB definition | native maximum + 4 KiB | input maximum + 4 KiB |
| All other operations | existing operation contract | 512 KiB | 512 KiB |

All sizes count encoded UTF-8 JSON bytes, including escapes. Wrapper allowances do not enlarge the underlying native document limit. Source/document/import/fragment limits, finite JSON, depth 24 and 30,000 value nodes remain enforced. Native content strings have their own parser limits. CLI input reading is bounded to the selected operation and checks the selected regular file's identity and stability. The CLI never submits file paths as substitutes for the source bytes.

HTTP validates the actual credential before reserving or receiving a large body. Project/operation permission is checked again by the owner after parsing. JSON requests with write-only credentials do not need discovery permission; MCP discovery retains its read requirement. The HTTP service permits at most 8 active requests, 1 per connection, and 64 MiB of reserved encoded input globally and per principal. A known Content-Length reserves at least 4 KiB; an unknown-length stream reserves the maximum MCP wire envelope until response completion or disconnect. Reservations include requests waiting for responses, and every failure releases them. A competing request receives `TRANSPORT_BUSY`; clients do not automatically retry writes. The existing connection/header limits and 1 MiB/250 ms rejection drain stay bounded.

MCP has a separate 16 KiB envelope allowance around an owner request. Only a real `ontology_write` tool call for one of the three document operations selects the extended limit. Ordinary tool arguments remain subject to the owner's 512 KiB cap. The owner result limit remains 1 MiB. MCP's duplicated text/structured result representation has a separate bounded wire allowance of 8 MiB + 64 KiB; it does not authorize a larger domain result.

The stdio bridge uses bounded framing and backpressure for partial input, queued and in-flight messages and response output. Its encoded-byte credit is retained until a request's response is flushed or the transport fails closed. The shared wire limits are not a claim about JavaScript heap/RSS. Parsing, canonicalization, database copies and response encoding also consume memory. The separate 2 GiB formal-worker ceiling is not a limit on the Node owner or Host process. Reference-workload host-memory measurements remain required.

Ordinary requests/tool calls have a 10-second deadline; the three document writes have a 60-second deadline. Bridge connection and context discovery each retain a 5-second deadline, with a separately bounded framing/lifecycle deadline. A synchronous owner transaction cannot be preempted by a timer. A response lost after commit remains an uncertain outcome: inspect `receipt.read` for the original request in the same principal/project scope, preserve its digest, and do not create a replacement request or automatically redispatch. Timeout is never an empty success.

The database remains state version 14 with a 64 MiB page cap. A large accepted request does not imply that every future model, task and delivery copy will fit. Capacity failure returns `STATE_LIMIT` and rolls back the asset, selected head, revision, receipt and audit together. Previously committed receipts and historical assets remain readable. This design adds no upload staging tables, does not silently split assets and does not overwrite history to make space. The fixed reference workload and complete lifecycle must still be measured against this retained-state budget.

## Metadata that exceeds a response

Source selectors, model mappings/open issues and expectation coverage can legitimately exceed a single response. `source.inspect`, `model.inspect` and `expectations.inspect` expose a `metadata` pointer. At most 256 KiB of canonical metadata is returned inline. Larger projections omit large collections and return counts, identities and `metadata.inline: false`. Incomplete coverage remains explicitly incomplete. Omitted fields never mean empty or fully reviewed collections.

The corresponding `source.metadata.read`, `model.metadata.read` and `expectations.metadata.read` operations require the exact source/model/expectation identity plus `projectionDigest`, `offset` and `maxBytes` (4–65,536). Each page retains the projection digest, total byte count, byte start/end, continuation offset and completeness. Join every page until `nextOffset` is null and verify SHA-256 over the complete canonical JSON UTF-8 bytes before interpreting the complete projection. Original document content remains in the existing document/expectation read operations.

The immutable projection excludes mutable heads and `current`. Freshness is reported separately on every page. A later intent or asset revision can make an unchanged historical projection stale; digest equality does not reactivate it. A mismatched projection digest is refused as `METADATA_CONFLICT`, a split UTF-8 offset is refused, and project/credential checks apply to every page. Expectation write receipts also use the metadata pointer when their complete coverage would exceed the inline budget; exact replay returns the original receipt.

See the [source contract](../specifications/v2/sources.md), [model contract](../specifications/v2/models.md), [expectation contract](../specifications/v2/expectations.md) and [standalone service guide](standalone-v090.md).
