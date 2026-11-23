# Ontology v0.9.0 limited Preview: release and isolated installation

This page routes operators to the independent **v0.9.0 Preview** distribution. The default `main` branch still contains the **v0.8.3 source line**; it has not absorbed the independent v0.9 implementation. Use the exact release source and package below for v0.9 installation, APIs and standards. Building `main`, following its legacy CLI commands or changing its package version is not that installation path.

[English](#release-identity) | [简体中文](#中文安装与发行说明)

## Release identity

| Material | Exact reference |
| --- | --- |
| Independent release | [v0.9.0 GitHub prerelease](https://github.com/yeliang-wang/evopilot-ontology/releases/tag/v0.9.0) |
| Source revision | [`ef5474ff0729db10386e1cb936b78742caf71b95`](https://github.com/yeliang-wang/evopilot-ontology/tree/ef5474ff0729db10386e1cb936b78742caf71b95) |
| Product archive | [`evopilot-next-ontology-0.9.0.tgz`](https://github.com/yeliang-wang/evopilot-ontology/releases/download/v0.9.0/evopilot-next-ontology-0.9.0.tgz) for `@evopilot-next/ontology@0.9.0`, SHA-256 `bb498ae04525aaf8197d2274dcfb1dce8755d2c813cfb15c97ff8996accc387f` |
| Distribution verification | [`release-manifest.json`](https://github.com/yeliang-wang/evopilot-ontology/releases/download/v0.9.0/release-manifest.json), [`SHA256SUMS`](https://github.com/yeliang-wang/evopilot-ontology/releases/download/v0.9.0/SHA256SUMS), [`ontology-dependency-lock.json`](https://github.com/yeliang-wang/evopilot-ontology/releases/download/v0.9.0/ontology-dependency-lock.json), [`ontology-native-catalog.json`](https://github.com/yeliang-wang/evopilot-ontology/releases/download/v0.9.0/ontology-native-catalog.json) |
| Source CI | [Run 45117064034](https://github.com/yeliang-wang/evopilot-ontology/actions/runs/45117064034) |
| Scope and exclusions | [Versioned limited profile](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/ontology-v090-limited-preview.md) |
| Complete operator procedure | [Versioned isolated installation guide](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/ontology-v090-limited-preview-install.md) |

GitHub published the prerelease on 2026-11-23. The **20 uploaded release attachments** comprise the product package, dependency lock, source revision, native catalog, bilingual release notes, thirteen native binary/source/notice files, release manifest and checksums. GitHub also lists two automatically generated source archives. Verify filenames and sizes against the release manifest, and check SHA-256 against `SHA256SUMS` in the download directory. The manifest inventories the 18 payload files, and the checksum file also covers the manifest itself.

## Supported edition and qualification

The limited edition covers native ontology modeling, retained source/model reads, declared standards validation, malformed-input rejection and actual authentication/project/permission boundaries. It retains the full **OWL 2 DL** semantic commitment, with Turtle and RDF/XML premise inputs. The six standard families are RDF 1.1 Turtle syntax, Turtle graph evaluation, RDF/XML, OWL 2 DL, SHACL Core and the declared local SHACL-SPARQL SELECT profile.

The exact candidate passed **876 source regression checks**, **42 governance checks** and **six limited product cases**. The standards report was reviewed before the six product cases ran. The standards qualification counted **830/830 required cases** and **35 predeclared exclusions**.

| Standards family | Required passes / required cases | Predeclared exclusions |
| --- | ---: | ---: |
| RDF 1.1 Turtle syntax | 166 / 166 | 2 |
| RDF 1.1 Turtle graph evaluation | 137 / 137 | 8 |
| RDF/XML | 166 / 166 | 0 |
| OWL 2 DL | 246 / 246 | 20 |
| SHACL Core | 98 / 98 | 0 |
| Local SHACL-SPARQL SELECT profile | 17 / 17 | 5 |

The ten excluded RDF cases lacked Approved status in the pinned manifests. The twenty excluded OWL cases supplied only Functional Syntax. Five SHACL cases used custom components or datasets outside the declared profile. SHACL checks compared the conformance boolean and complete report graph. The finite corpus records coverage of the selected cases. W3C certification and exhaustive OWL 2 DL coverage are outside that claim.

Historical read-only compatibility uses a fictional fixture produced by a pinned previously published package. It does not certify an old-installation upgrade or business semantics. The independent Expert/plugin files are included, while actual Desktop Expert journeys remain deferred.

The original [143-case complete v0.9 target](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/ontology-v090-plan.md) remains separate. Actual Desktop journeys, cross-component delivery, daily installation/plugin switching, old-installation upgrades and historical test-asset cleanup are deferred. The Preview does not automatically rebuild assets or switch Runtime/Harness installations and makes no GA or production-readiness claim. Existing scoped permissions apply; these limits do not assert that every full-target API is physically disabled.

## Isolated installation path

Use **Linux arm64**, **Node 24.14.0**, **glibc 2.28 or newer**, a case-sensitive filesystem and the supported **systemd 255.x user manager**. A different development host or an inventory scan of foreign-platform files does not establish supported-platform acceptance. Preserve daily installations, private workspaces and credentials.

1. Download and verify the complete release distribution. The archive digest above identifies the product package; the later installed-runtime digest is a different identity.
2. Provision the release's locked npm dependencies and install the selected archive into a new private prefix outside Git. Follow the versioned guide's cache and root requirements; a missing offline dependency is a prerequisite failure, not permission to resolve replacement versions.
3. Run the installed standalone `evopilot-ontology runtime-inspect --runtime-root ABS_RUNTIME --json`. Keep its actual runtime, package and Node identities. The legacy `evopilot-next-ontology` entry on `main` is a different interface.
4. Use the versioned guide's `install --mode create` procedure with separate private installation and workspace roots. Prepare the pinned native materials through the [versioned offline toolchain procedure](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/managed-toolchains-v090.md); bind both exact DL and SHACL executors while the owner is stopped. The preparer does not download a replacement runtime, run pip/Maven or build tools implicitly.
5. Start the isolated service, inspect its actual scope/configuration, read through its generated private connection and stop it with the supported installed operator. A configured executor is not business approval or proof of release acceptance.

All Ontology operator commands require `--json`; `ABS_RUNTIME` means the actual canonical absolute installed prefix. The full versioned guide supplies the complete commands and exact JSON input schemas. Keep the Python environment at its prepared final path and retain source/license materials alongside the distribution.

## Post-publication verification

| Check | Observed result for the published distribution |
| --- | --- |
| OL09 public download | All 20 uploaded attachments were downloaded anonymously. Names, sizes and SHA-256 matched the published release records. |
| OL10 isolated install | A fresh Linux arm64 installation used the public product archive, locked offline npm cache and published native artifacts. All 72 recorded commands succeeded. OWL consistency, SHACL validation and four fixed positive/negative checks matched the expected results. |
| OL10 restart and teardown | The model, original document content, request receipts and both task results matched after restart. The isolated service stopped with no remaining worker units, process groups or owned processes. |

The installed runtime digest belongs to the observed installation. Use your own `runtime-inspect` result when binding a new prefix.

## Versioned technical references

| Need | Exact v0.9 reference |
| --- | --- |
| Released modeling and validation workflow | [Standalone CLI, HTTP and MCP](ontology-v090-limited-preview-api.md) |
| Full source operator reference | [Independent operator](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/standalone-v090.md) |
| Formal toolchain preparation and identity | [Managed toolchains](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/managed-toolchains-v090.md) |
| Model, source and validation contracts | [Native v2 model](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/specifications/v2/models.md), [expectations](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/specifications/v2/expectations.md), [SHACL](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/specifications/v2/shacl.md) |
| Standards evaluation and approval boundary | [Standards protocol](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/standards-evaluation-v090.md), [limited release procedure](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/release-v090-limited.md) |

These source documents retain their original candidate-time wording. The prerelease and its bilingual release notes record the distribution identity and prepublication qualification. The post-publication observations above apply to that exact distribution.

## 中文安装与发行说明

**默认 `main` 分支源码仍为 v0.8.3；独立 v0.9.0 Preview 使用自己的精确源码和发行文件。** 请从 [v0.9.0 预发行页](https://github.com/yeliang-wang/evopilot-ontology/releases/tag/v0.9.0)取得完整 **20 份上传附件**，按发行清单和校验文件核对名称、大小及 SHA-256。GitHub 还会额外生成两份源码归档。源码为 `ef5474ff0729db10386e1cb936b78742caf71b95`，产品包摘要为 `bb498ae04525aaf8197d2274dcfb1dce8755d2c813cfb15c97ff8996accc387f`。构建 `main` 或使用本分支旧版 CLI 命令，不会得到独立发行。

本版用于 **Linux arm64 隔离环境**中的原生建模、来源与模型读取及声明标准验证，要求 **Node 24.14.0**、glibc 2.28 或以上、区分大小写的文件系统及受支持的 systemd 255.x 用户管理器。请按[固定版本隔离安装指南](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/ontology-v090-limited-preview-install.md)准备锁定依赖、独立 npm 前缀、原生工具、安装控制目录和业务工作区。使用已安装的 `evopilot-ontology runtime-inspect --runtime-root ABS_RUNTIME --json` 读取实际身份；`ABS_RUNTIME` 应替换为真实的规范绝对路径。包摘要与安装后的 runtime 摘要不同，所有 Ontology 操作命令均要求 `--json`。

完整 **OWL 2 DL** 承诺和六个标准族保持不变。经过审阅的候选通过 **876 项源码回归、42 项治理检查、830/830 项必测标准案例及 6 项限定产品验收**。上方标准族表列出各项结果。SHACL 同时比较符合性布尔值及完整报告图。**35 项预先排除不计为通过**：10 项未标为 Approved 的 RDF 案例、20 项仅有 Functional Syntax 的 OWL 案例，以及 5 项超出声明范围的 SHACL 自定义组件/数据集案例。有限语料不是 W3C 认证，不能单独证明所有 OWL 2 DL 推论。

历史只读兼容使用真实旧发布包生成的虚构格式夹具，不代表旧安装升级或业务语义验收。原始 **143 项完整目标**独立保留；真实 Desktop 流程、跨组件交付、日常安装或插件切换、旧安装升级和历史测试资产清理均暂缓。安装不自动重建业务资产或切换 Runtime/Harness，也不声明 GA 或生产就绪。

发布后已完成 **OL09** 和 **OL10**。20 份上传附件均可匿名下载，名称、大小和 SHA-256 与发行记录一致。使用公开归档及锁定离线依赖在 Linux arm64 全新安装，记录的 72 条命令均成功。OWL 一致性、SHACL 验证和四个固定正反例符合预期，重启后模型、原始文档内容、请求回执和两项任务结果一致。隔离服务已停止，无残留工作单元、进程组或工作进程。

保留现有日常安装、私有工作区及凭据。操作入口见[独立 CLI、HTTP 和 MCP](ontology-v090-limited-preview-api.md#中文操作参考)。上表固定源码文档保留候选阶段记录，发布资格以实际预发行记录和本页所列发布后验证结果为准。
