# Independent Ontology development foundation

This is P1 implementation documentation, not a v0.9 release or installed Host acceptance record. The approved [complete plan](ontology-v090-plan.md) still requires native v2, complete OWL 2 DL, SHACL, full Expert journeys, operator installation/recovery, candidate acceptance and selected historical test-asset reset.

The compiled `evopilot-ontology` entry is independent of the historical `evopilot-next-ontology` CLI. `init` creates a new private workspace outside Git; it refuses occupied paths. `serve` runs a foreground loopback service with a single writer lease. `context`, `read` and `write` use that service over HTTP and never fall back to direct database mutation. Every command requires `--json`. Run the command without arguments for its exact syntax.

Operator initialization takes explicit absolute `--root` plus `--workspace`, `--project` and `--principal`. It returns identity and a private credential file location, never the token itself. The token has a 30-day expiry and one explicit project scope. The returned project scope is permitted but initially empty; actual project creation is a separate authorized owner mutation. A server starts with `--root`, `--workspace`, `--service` and optional `--port`, returns its bound origin and `/mcp` URL, and stops on SIGTERM/SIGINT. The foreground entry is not yet a managed service installer.

The CLI connection file is a private regular file with this shape (the values below are examples, not a selected installation):

```json
{
  "schema": "ontology-connection/v1",
  "origin": "http://127.0.0.1:18770",
  "workspaceId": "example",
  "serviceId": "actual-service-id",
  "projectId": "example",
  "credentialFile": "/absolute/private/location/operator-token"
}
```

The JSON endpoint is `POST /v1/request`. Standard MCP uses `POST /mcp`, implemented with the pinned official MCP SDK and both 2025 stateless and 2026 per-request protocol support. Both endpoints require a valid scoped Bearer credential, exact loopback Host, no browser Origin and uncompressed UTF-8 JSON. No remote URL or HTTP redirect may receive CLI credentials. Request bodies are bounded to 512 KiB, graph-independent JSON depth to 24 and nodes to 30,000; domain results to 1 MiB. The initial database is capped at 64 MiB, excluding its bounded transient rollback journal. The service allows at most 32 connections; rejected requests drain at most 1 MiB for at most 250 ms before closing. Invalid, oversized or interrupted exchanges are errors, never empty success. The service is local-only and is not an Internet-facing deployment.

MCP tools are `ontology_context`, `ontology_read` and `ontology_write`. Context reports actual identity, allowed projects/permissions and readiness. Read operations are `service.inspect`, `guide.read`, `project.list`, `project.inspect`, `intent.read` and `receipt.read`. Writes are `project.create` and `intent.record`. Writes require a durable `requestId` and observed `expectedRevision`; exact replay returns its original receipt, while reuse for different content fails. Credential revocation and project permissions apply even to replay. Source bindings in intents remain declarations with `sourceVerification: NOT_EVALUATED`; they are not admitted source collection, semantic review or asset delivery.

The owner Expert source is `src/expert/SKILL.md`. Build generates the plugin Skill from those bytes; the source check rejects divergence. `guide.read` returns current first-use, modeling-intent, recovery or owner-boundary guidance. The development plugin contains a manifest and MCP configuration template; `.mcp.json` and the authenticated local binding are still installer work. Do not install the template as if its placeholder were a working endpoint. This follows the documented [Codex plugin package and authentication format](https://developers.openai.com/api/docs/guides/agents-api/tools/plugins); no token belongs in a public plugin package.

Source tests use synthetic isolated projects and actual HTTP/MCP/CLI processes. They verify persisted intent/receipt readback, concurrent revisions, credential revocation, process death and malformed traffic. They do not establish actual Codex Host installation, business truth, complete inference or release readiness. Unknown write responses require original receipt reconciliation. A missing receipt does not authorize a new request ID or automatic retry.
