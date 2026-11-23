# Install an isolated Ontology v0.9.0 limited Preview candidate

This guide is for an operator evaluating a selected Ontology candidate in a new **Linux arm64** environment. Its goal is an isolated installation with the selected native executors and readable service identity. It does not claim that a release has been published, that the candidate has passed acceptance or that a daily Codex installation should be switched. The intended independent GitHub release uses tag `v0.9.0` and `prerelease=true`; consult the [owning release index](https://github.com/yeliang-wang/evopilot-ontology/releases) for actual publication records.

The [limited profile](ontology-v090-limited-preview.md) covers native modeling, reads and declared validation. Full OWL 2 DL and all six standards families remain required: `rdf11-turtle-syntax`, `rdf11-turtle-eval`, `rdfxml`, `owl2-dl`, `shacl-core` and `shacl-sparql-local`. Actual Desktop journeys, cross-component delivery, daily installation/plugin switching, test-asset cleanup and old-installation upgrades remain deferred. The [complete operator reference](standalone-v090.md), [full plan](ontology-v090-plan.md) and [maintenance reference](installation-maintenance-v090.md) remain available for separately scoped work.

## Prerequisites and exact materials

Use Node **24.14.0**, Linux arm64, glibc **2.28 or newer**, a case-sensitive filesystem and a usable **systemd 255.x user manager** for the selected bounded formal-worker backend. The pinned native recipe is `linux-arm64-temurin21-pbs20260211-candidate7`. A different operating system, manually assembled executor or successful foreign-platform archive scan does not establish this distribution's platform acceptance.

Select and verify the exact product archive `evopilot-next-ontology-0.9.0.tgz`, source revision, dependency lock, checksums and the thirteen flat native component/source/notice artifacts named by the selected packaged `governance/distribution-linux-arm64-v090-candidate7.json`. A local catalog record or filename is not published-release provenance. Keep the native artifact directory separate from checksum/review files: the native inspector expects exactly its selected flat files.

Prepare separate private directories outside Git for the npm runtime, native artifact bundle, native tools, preparation control, installation controls and business workspace. Planned destination parents must already exist with private mode 0700; the new tool/control/workspace destinations must be unused. Never select a daily installation, existing project workspace or its credentials. Native Java/Python source and notices stay with the selected distribution materials; they are not business assets.

The commands below are reference invocations verified against `src/standalone/cli.ts`, the managed installation code and the existing isolated installation test. They were not executed as installation acceptance while writing this guide. Replace every `ABS_*`, `ID_*` and `SHA256_*` placeholder with an actual selected path, identity or observed digest. All operator paths must be canonical and absolute. Every Ontology command requires `--json`.

## Install and inspect the selected npm runtime

The existing isolated installation path uses a separately provisioned npm dependency cache. With the selected archive and its verified locked dependencies available in that cache, install into a new prefix:

```text
npm install --offline --ignore-scripts --no-audit --no-fund --prefix ABS_RUNTIME ABS_ARCHIVE/evopilot-next-ontology-0.9.0.tgz
ABS_RUNTIME/node_modules/.bin/evopilot-ontology runtime-inspect --runtime-root ABS_RUNTIME --json
```

A missing offline dependency is a prerequisite failure; do not silently substitute newly resolved or different package bytes. The archive checksum identifies the downloaded package. The inspection's `result.digest` identifies the resulting installed prefix, and its Node executable/version/digest bind the executing runtime. These are different identities. Preserve the full JSON response and use the observed runtime digest below. Inspection checks at most 20,000 entries and 256 MiB; it does not certify release authenticity.

Prepare new installation and workspace roots without starting the service:

```text
ABS_RUNTIME/node_modules/.bin/evopilot-ontology install --root ABS_INSTALLATION --workspace-root ABS_WORKSPACE --workspace ID_WORKSPACE --project ID_PROJECT --principal ID_PRINCIPAL --runtime-root ABS_RUNTIME --runtime-digest SHA256_RUNTIME --mode create --json
```

The selected project scope is permitted but initially empty. Project creation and modeling are subsequent authenticated owner operations. Preserve the returned workspace/service/project and installation identities. The installation creates a private plugin template; its existence does not mean Desktop activation has occurred. Do not select attach, upgrade, reset or cleanup commands for this bounded procedure.

## Prepare and bind native executors

Use the exact inspect and prepare JSON schemas in [managed toolchain preparation](managed-toolchains-v090.md#inspect-a-distribution-candidate). Bind the selected catalog ID, artifact directory, inspected runtime identity and separate tool/installation/workspace roots. Save the complete successful inspection JSON outside the artifact and destination directories.

```text
ABS_RUNTIME/node_modules/.bin/evopilot-ontology distribution-inspect --input ABS_DISTRIBUTION_JSON --json
ABS_RUNTIME/node_modules/.bin/evopilot-ontology distribution-inventory --input ABS_DISTRIBUTION_JSON --json
ABS_RUNTIME/node_modules/.bin/evopilot-ontology distribution-prepare --input ABS_PREPARE_JSON --inspection ABS_SAVED_INSPECTION_JSON --json
ABS_RUNTIME/node_modules/.bin/evopilot-ontology distribution-prepare-status --input ABS_PREPARE_JSON --json
```

The preparation input binds the saved inspection digest and retained request ID. It materializes the fixed local payloads; it does not download runtimes, run Maven/pip or build replacement tools. Follow the returned original request/status if interrupted. `PREPARED` records file materialization and verified inventories, not executor loadability, successful reasoning, Host connection or acceptance. Keep Python at its final absolute path: moving the prepared tool tree is unsupported, and the Python manifest must preserve the virtual environment executable rather than resolving it to the underlying interpreter.

While the selected owner is stopped, inspect the actual user manager and bind both returned toolchain manifests and digests together:

```text
ABS_RUNTIME/node_modules/.bin/evopilot-ontology stop --installation ABS_INSTALLATION --json
ABS_RUNTIME/node_modules/.bin/evopilot-ontology worker-isolation-inspect --json
ABS_RUNTIME/node_modules/.bin/evopilot-ontology toolchains-bind --installation ABS_INSTALLATION --request-id ID_BINDING --previous-binding none --dl-toolchain ABS_DL_MANIFEST --dl-digest SHA256_DL --shacl-toolchain ABS_SHACL_MANIFEST --shacl-digest SHA256_SHACL --systemd-digest SHA256_INSPECTED_SYSTEMD --json
ABS_RUNTIME/node_modules/.bin/evopilot-ontology toolchains-inspect --installation ABS_INSTALLATION --json
```

Use the actual fresh manager digest; the command does not provision systemd or switch environments. `--previous-binding none` is for the first binding only. A replacement must use the exact current binding digest and reconcile unfinished formal work. An absent/drifted component or unavailable manager blocks this path. A `VERIFIED` toolchain inventory is not a standards PASS. See [worker isolation](worker-isolation-v090.md) and [recovery](worker-recovery-v090.md) for the existing limits and stopped-owner reconciliation rules.

## Start, read and stop

```text
ABS_RUNTIME/node_modules/.bin/evopilot-ontology start --installation ABS_INSTALLATION --json
ABS_RUNTIME/node_modules/.bin/evopilot-ontology installation-inspect --installation ABS_INSTALLATION --json
ABS_RUNTIME/node_modules/.bin/evopilot-ontology context --connection ABS_INSTALLATION/connection.json --json
ABS_RUNTIME/node_modules/.bin/evopilot-ontology read --connection ABS_INSTALLATION/connection.json --operation service.inspect --json
ABS_RUNTIME/node_modules/.bin/evopilot-ontology stop --installation ABS_INSTALLATION --json
```

The private connection file is generated from the observed managed service; it references the credential file without exposing a token in these commands. Check its workspace/service/project scope and actual permission grants. After startup, inspect `reasoningExecutionConfigured`, `shaclExecutionConfigured`, `validationExecutionConfigured` and exact toolchain identities. Configuration flags describe available executors, while `acceptanceStatus: "EXTERNAL_EVIDENCE_REQUIRED"` leaves acceptance to retained candidate evidence.

A successful operator check means the selected isolated service can be inspected and stopped. It does not establish model correctness or the limited release's completion. For modeling/read/validation, use the public contracts returned by `guide.read`; the [native model](../specifications/v2/models.md), [expectations](../specifications/v2/expectations.md) and [SHACL](../specifications/v2/shacl.md) references describe exact payloads and limits. Preserve request IDs, expected revisions and original receipts. A lost write response requires original receipt inspection before any new action.

## Acceptance and historical reads

Freeze and install first, then complete all required standards results and the full report. The user's exact report approval admits formal limited product evaluation; it does not authorize publication. Earlier product diagnostics cannot replace the subsequent formal OL02/03/05/06/07/08 results. The [limited release procedure](release-v090-limited.md) retains malformed-input and actual scope-permission negatives, packaged declaration checks and exact publication refusal. Following publication, OL09 public downloads and OL10 isolated reinstall/read/validation are mandatory.

Historical asset compatibility requires an explicitly supported read-only entry, an isolated copy and original/observed byte digests. New v2 service state must not silently import an old daily database. Consult the [historical service reference](native-service.md) for retained contracts; selecting a specific supported historical read path still needs its candidate evidence. It does not imply old-installation upgrade, cross-owner delivery, business approval or permission to clear assets. Existing RBAC applies; deferred promises are not a claim that all full-target APIs are physically disabled.

## 中文操作边界

本指南用于 Linux arm64 隔离候选评估，要求 Node 24.14.0、glibc 2.28 或以上、区分大小写的文件系统及受支持的 systemd 255.x 用户管理器。只使用精确选定并校验的包、依赖和原生组件；这里的命令是已核对源码的操作参考，不是安装验收记录。日常插件切换、真实桌面、跨组件交付、旧安装升级及资产清理仍暂缓。

先隔离安装并验证工具链，随后完成全部六个标准族和完整 OWL 2 DL 评测、完整报告及用户报告批准，再采集限定产品正式验收。发布决定单独办理，发布后还须公开下载及隔离重装验证。保留原始请求回执，未知结果不能变成 PASS；历史读取只操作隔离副本，不修改日常资产和凭据。
