# Ontology v0.9.0 limited Preview: release and isolated installation

This page routes operators to the independent **v0.9.0 Preview** distribution. The default `main` branch still contains the **v0.8.3 source line**; it has not absorbed the independent v0.9 implementation. Use the exact release source and package below for v0.9 installation, APIs and standards. Building `main`, following its legacy CLI commands or changing its package version is not that installation path.

[English](#release-identity) | [简体中文](#中文安装与发行说明)

## Release identity

| Material | Exact reference |
| --- | --- |
| Independent release | [v0.9.0 GitHub prerelease](https://github.com/yeliang-wang/evopilot-ontology/releases/tag/v0.9.0) |
| Source revision | [`ef5474ff0729db10386e1cb936b78742caf71b95`](https://github.com/yeliang-wang/evopilot-ontology/tree/ef5474ff0729db10386e1cb936b78742caf71b95) |
| Product archive | `evopilot-next-ontology-0.9.0.tgz` — SHA-256 `bb498ae04525aaf8197d2274dcfb1dce8755d2c813cfb15c97ff8996accc387f` |
| Source CI | [Run 45117064034](https://github.com/yeliang-wang/evopilot-ontology/actions/runs/45117064034) |
| Scope and exclusions | [Versioned limited profile](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/ontology-v090-limited-preview.md) |
| Complete operator procedure | [Versioned isolated installation guide](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/ontology-v090-limited-preview-install.md) |

The release page records publication and all **20 assets**: the product package, dependency lock, source revision, native catalog, bilingual release notes, thirteen native binary/source/notice materials, release manifest and checksums. Use them together. Confirm filenames, sizes and SHA-256 values before installation; do not substitute similarly named files from another run or the source branch.

## Supported edition and qualification

The limited edition covers native ontology modeling, retained source/model reads, declared standards validation, malformed-input rejection and actual authentication/project/permission boundaries. It retains the full **OWL 2 DL** semantic commitment, with Turtle and RDF/XML premise inputs. The six standard families are RDF 1.1 Turtle syntax, Turtle graph evaluation, RDF/XML, OWL 2 DL, SHACL Core and the declared local SHACL-SPARQL SELECT profile.

The reviewed candidate passed **876 source regression checks**, **42 governance checks**, **830 required standards cases** and **six limited product cases**. The complete standards report was reviewed before product acceptance. **35 predeclared exclusions are not passes:** ten RDF cases not marked Approved, twenty OWL cases available only in Functional Syntax, and five SHACL custom-component/dataset cases outside the local profile. The finite corpus is not W3C certification or proof of every OWL 2 DL consequence. Its complete OWL 2 DL semantic commitment remains unchanged.

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

Public-download verification and a fresh isolated reinstall/read/validation are separate post-publication checks. Prepublication acceptance does not substitute for those observations; this documentation page does not declare those checks complete. No daily plugin activation, asset reset or old-installation upgrade is part of these steps.

## Versioned technical references

| Need | Exact v0.9 reference |
| --- | --- |
| Standalone CLI, service and connection | [Independent operator](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/standalone-v090.md) |
| Formal toolchain preparation and identity | [Managed toolchains](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/managed-toolchains-v090.md) |
| Model, source and validation contracts | [Native v2 model](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/specifications/v2/models.md), [expectations](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/specifications/v2/expectations.md), [SHACL](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/specifications/v2/shacl.md) |
| Standards evaluation and approval boundary | [Standards protocol](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/standards-evaluation-v090.md), [limited release procedure](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/release-v090-limited.md) |

These source documents retain their original candidate-time wording. Current distribution identity and qualification statements belong to the versioned release and its bilingual release notes. This default-branch navigation update does not replace any tagged source, package, original report or user decision.

## 中文安装与发行说明

**默认 `main` 分支源码仍为 v0.8.3；独立 v0.9.0 Preview 使用自己的精确源码和发行文件。** 请从 [v0.9.0 预发行页](https://github.com/yeliang-wang/evopilot-ontology/releases/tag/v0.9.0)取得完整 **20 份附件**，核对文件名、大小及 SHA-256。源码为 `ef5474ff0729db10386e1cb936b78742caf71b95`，产品包摘要为 `bb498ae04525aaf8197d2274dcfb1dce8755d2c813cfb15c97ff8996accc387f`。构建 `main` 或使用本分支旧版 CLI 命令，不会得到独立发行。

本版用于 **Linux arm64 隔离环境**中的原生建模、来源与模型读取及声明标准验证，要求 **Node 24.14.0**、glibc 2.28 或以上、区分大小写的文件系统及受支持的 systemd 255.x 用户管理器。请按[固定版本隔离安装指南](https://github.com/yeliang-wang/evopilot-ontology/blob/ef5474ff0729db10386e1cb936b78742caf71b95/docs/ontology-v090-limited-preview-install.md)准备锁定依赖、独立 npm 前缀、原生工具、安装控制目录和业务工作区。使用已安装的 `evopilot-ontology runtime-inspect --runtime-root ABS_RUNTIME --json` 读取实际身份；`ABS_RUNTIME` 应替换为真实的规范绝对路径。包摘要与安装后的 runtime 摘要不同，所有 Ontology 操作命令均要求 `--json`。

完整 **OWL 2 DL** 承诺和六个标准族保持不变。经过审阅的候选通过 **876 项源码回归、42 项治理检查、830 项必测标准案例及 6 项限定产品验收**。**35 项预先排除不计为通过**：10 项未标为 Approved 的 RDF 案例、20 项仅有 Functional Syntax 的 OWL 案例，以及 5 项超出声明范围的 SHACL 自定义组件/数据集案例。有限语料不是 W3C 认证，不能单独证明所有 OWL 2 DL 推论。

历史只读兼容使用真实旧发布包生成的虚构格式夹具，不代表旧安装升级或业务语义验收。原始 **143 项完整目标**独立保留；真实 Desktop 流程、跨组件交付、日常安装或插件切换、旧安装升级和历史测试资产清理均暂缓。安装不自动重建业务资产或切换 Runtime/Harness，也不声明 GA 或生产就绪。

发布后的公开下载与全新隔离重装、读取和验证需要单独记录；本页不将发布前验收当成这两项检查的完成证明。保留现有日常安装、私有工作区和凭据。完整技术步骤及合约请使用上表的固定版本链接；这些版本文档保留原始候选阶段表述，实际发行状态和资格说明以预发行页及其双语说明为准。
