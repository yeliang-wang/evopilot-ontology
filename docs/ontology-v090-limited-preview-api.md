# Ontology v0.9.0 limited Preview operator and API

[Release and isolated installation](ontology-v090-limited-preview-install.md) | [简体中文](#中文操作参考)

Use the installed `evopilot-ontology` CLI and the private connection file from a running v0.9.0 installation. This workflow covers local native modeling, retained reads and declared validation. The exact source reference also describes operations from the full v0.9 development plan. For their release scope, see the [limited profile](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/ontology-v090-limited-preview.md).

## Discover scope and contracts

Run these commands with `ONTOLOGY` set to the absolute installed executable and `CONNECTION` set to the generated private `connection.json`. Use the connection from the current service run. `context` calls scoped `service.inspect`, which returns the actual workspace and service identities, selected project's state, available read/write operations, executor configuration flags and exact toolchain digests.

```sh
"$ONTOLOGY" context --connection "$CONNECTION" --json
"$ONTOLOGY" read --connection "$CONNECTION" --operation project.list --json
```

For a contract lookup, save `{"topic":"contract:model.record"}` in a private JSON file. Set `INPUT` to its canonical absolute path and run the following. Use `first-use` for the workflow or `contracts` for the operation index.

```sh
"$ONTOLOGY" read --connection "$CONNECTION" --operation guide.read --input "$INPUT" --json
```

Read `reasoningExecutionConfigured`, `shaclExecutionConfigured` and `validationExecutionConfigured` before dispatching a task. `acceptanceStatus: "EXTERNAL_EVIDENCE_REQUIRED"` means the service delegates acceptance to the separate release and candidate records. Configuration and a successful request establish technical observations. Business approval requires its own decision.

## Model, read and validate

| Step | Owner operations and inputs |
| --- | --- |
| Identify the project | `project.list` and `project.inspect` read the scoped project and current revision. In a newly permitted empty scope, `project.create` accepts `{"label":"Example project"}` with expected revision 0. |
| Retain intent and sources | `intent.record` accepts a definition and its previous digest. `source.admit` binds the exact intent digest and source set. Use `source.inspect` and `source.read` to read the retained metadata and bytes. |
| Bind expectations and model | Use `expectations.record` to retain independent expected cases, followed by `model.record` with the exact current intent, sources and expectations. Read the retained version using `model.inspect` and `model.document.read`. |
| Evaluate the selected inputs | `reasoning.start` submits an OWL task against the exact model. `validation.start` runs the fixed expectation suite. `shacl.start` runs a graph-only SHACL check. Read the task and its terminal result using the matching `*.inspect` and `*.result.read` operations. |

For a write, use `write --connection ABS_CONNECTION --operation NAME --input ABS_INPUT --request-id ID --expected-revision N --json`. Retain the request ID, exact input and observed revision for that write. For document reads, use the selected source/model digest and follow each page's `nextOffset` until it is null. A completed write receipt for a queued task records submission. Inspect the task's terminal result for the actual check.

The pinned schemas define the exact payloads and formats. [Sources](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/specifications/v2/sources.md) · [Models and reasoning](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/specifications/v2/models.md) · [Expectations and validation](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/specifications/v2/expectations.md) · [SHACL](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/specifications/v2/shacl.md)

## HTTP and MCP

The local owner uses the exact loopback origin from the generated connection. Use the scoped Bearer credential from its private credential file. Both endpoints require POST with uncompressed UTF-8 JSON and the service's exact loopback Host. The service rejects requests that include a browser `Origin` header.

| Interface | Request |
| --- | --- |
| `POST /v1/request` | Send `workspaceId`, `serviceId`, `projectId`, `operation` and an object-valued `input`. Writes also require `requestId` and `expectedRevision`. The response has either `ok: true` with `result` or `ok: false` with `error`. |
| `POST /mcp` | Use a Streamable HTTP MCP client. Call `ontology_context` with `{}` to discover the principal, permitted projects and available operations. Pass the same owner fields to `ontology_read` or `ontology_write`. Tool results expose `structuredContent.result` or an error with `isError: true` and `structuredContent.error`. |

The generated private plugin connects through a stdio adapter that reads the connection and credential files. Actual Desktop Expert activation is deferred for this Preview. The full transport, limits and connection file contracts are pinned in the [standalone reference](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/standalone-v090.md) and [large input reference](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/large-inputs-v090.md).

## Reconcile uncertain responses

If a write times out or reports `REQUEST_UNKNOWN`, use `receipt.read` with input `{"requestId":"ORIGINAL_ID"}` in the same project and principal scope. Exact replay of a committed write returns its retained receipt. Reusing that request ID for different content returns `REQUEST_CONFLICT`. A missing receipt requires further reconciliation before any retry or replacement request. If a status read fails, inspect the same task ID. Consult the [pinned worker recovery procedure](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/worker-recovery-v090.md) if a formal task or worker remains unresolved.

Historical reads use `createOntologyService` from the installed `@evopilot-next/ontology/service` export against an explicitly selected, quiescent, checkpointed v1 workspace. The scoped historical operations are `asset.inspect` and `receipt.inspect`. The limited qualification used a fictional fixture from a pinned old release. For evidence and input requirements, see the [historical read contract](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/ontology-v090-history-read.md).

## 中文操作参考

启动隔离安装后，使用已安装的 `evopilot-ontology` 与当前服务运行生成的私有 `connection.json`。所有 CLI 命令均带 `--json`。先用 `context --connection ABS_CONNECTION --json` 读取实际工作区、服务、项目状态及执行器配置。以 `guide.read` 读取 `{"topic":"first-use"}` 或 `{"topic":"contract:model.record"}`。输入放入私有 JSON 文件，使用 `--input` 加规范绝对路径。

- 建模按 `project.inspect`、`intent.record`、`source.admit`、`expectations.record`、`model.record` 推进。新授权范围内尚无项目时，`project.create` 使用期望修订号 0。读取 `source.read` 或 `model.document.read` 时，固定来源或模型摘要，按 `nextOffset` 续读。
- `reasoning.start` 提交 OWL 任务，`validation.start` 运行固定预期用例，`shacl.start` 检查选定图。用对应的 `*.inspect` 和 `*.result.read` 读取终态。入队回执只记录任务提交，执行器配置也只表明工具已配置。业务批准另有决策依据。
- HTTP 使用 `POST /v1/request`，MCP 使用 `POST /mcp`，均要求精确回环 Host、私有 Bearer 凭据、未压缩 UTF-8 JSON，且请求不带浏览器 `Origin`。MCP 使用 `ontology_context` 发现权限，使用 `ontology_read` 和 `ontology_write` 访问 owner。域请求字段见上表。私有插件模板由安装生成，实际 Desktop Expert 启用仍在暂缓范围。
- 写操作保留原始 `requestId`、输入及 `expectedRevision`。写入结果不明时，用同一主体和项目通过 `receipt.read` 查询原始 ID。结果未知或回执缺失时，先核对原请求和服务状态。任务状态读取失败时继续检查原任务 ID。
- 历史兼容使用新包公开只读接口读取显式选择的隔离 v1 工作区。限定验收使用由已发布旧包生成的虚构夹具。旧安装升级仍暂缓。参见[固定版本历史读取说明](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/ontology-v090-history-read.md)。
