# EvoPilot Ontology · v0.8.3 Preview

[English](README.md) | 简体中文

Ontology 定义领域概念、关系、约束与来源，并保留经审阅的不可变语义资产。它与 [EvoPilot Expert](https://github.com/yeliang-wang/evopilot/blob/main/README_CN.md)、负责质量与证据的 [Harness](https://github.com/yeliang-wang/evopilot-harness/blob/main/README_CN.md)、负责执行与项目完成的 [Runtime](https://github.com/yeliang-wang/evopilot-runtime/blob/main/README_CN.md) 协作。

[快速开始](#快速开始) · [规范（英文）](specifications/README.md) · [原生 API（英文）](docs/native-service.md) · [中文文档入口](docs/zh-CN/README.md) · [发行版](https://github.com/yeliang-wang/evopilot-ontology/releases/tag/v0.8.3)

## 资产与标准

| 基础 | 支持范围 |
|---|---|
| RDF 1.1 / Turtle 1.1 | 使用稳定 IRI 的原生模型、形状与实例 |
| RDFS 1.1 / OWL 2 声明 | 有边界的概念、属性、关系与元数据，不包含完整 OWL 推理 |
| SHACL 2017 / pySHACL | Core 与受限本地 SELECT 验证，保留上游报告 |
| EvoPilot 约定 | 包布局、来源与要求绑定、审阅及不可变发布 |

可编辑模型是 `model.ttl`；`shapes/` 包含原生约束，`instances/` 包含真实或明确标注的合成事实。来源绑定区分观察事实与推断。独立覆盖清单在生成前固定预期标识、形状和案例。

当前 `service.native()` 操作覆盖包准入、验证、精确审阅、独立领域决定、发布与受保护读回。验证成功本身不批准业务含义，也不证明覆盖完整。历史 JSON 模型与 Catalog 查询保持只读，旧写入入口拒绝新工作。

参阅 [v1 规范（英文）](specifications/v1/README.md)、[支持矩阵（英文）](specifications/v1/support-matrix.json)、[工具版本（英文）](specifications/v1/standards.lock.json)、[重新提取指南（英文）](specifications/v1/re-extraction.md)。正向/反向建模、公开/私有项目采用同一基础。

## 快速开始

在 Codex 中使用时，从[总项目安装指南](https://github.com/yeliang-wang/evopilot/blob/main/docs/zh-CN/installation.md)和统一 Expert 开始。Expert 引导用途、范围、建模、验证与审阅，无需独立的 Ontology 插件。

### 安装 Preview 包

使用 **Node 24.14.0**。将 [v0.8.3 Preview](https://github.com/yeliang-wang/evopilot-ontology/releases/tag/v0.8.3) 的四个文件放入新目录：`evopilot-next-ontology-0.8.3.tgz`、`ontology-dependency-lock.json`、`source-revision.txt`、`SHA256SUMS`。

```sh
shasum -a 256 -c SHA256SUMS
cat source-revision.txt
mkdir ontology-0.8.3
tar -xzf evopilot-next-ontology-0.8.3.tgz -C ontology-0.8.3
cp ontology-dependency-lock.json ontology-0.8.3/package/package-lock.json
cd ontology-0.8.3/package
npm ci --omit=dev --ignore-scripts
node dist/cli.js help
node dist/cli.js version
```

校验失败时停止，并将源码修订与发行版本核对。发行渠道为 GitHub Releases，不是 npm registry。SDK 导出指向编译后的 JavaScript 与声明文件，安装后的 bin 为 `evopilot-next-ontology`。安装包不包含开发脚本和测试。

### 从源码开发

在源码检出目录中，准备总项目锁定的原生工具链并使用锁定的开发依赖：

```sh
npm ci --ignore-scripts
npm run build
npm run check
EVOPILOT_TEST_NATIVE_TOOLCHAIN=/absolute/path/to/verified/native-toolchain.json npm test
```

缺失原生工具会明确失败。工具路径由可信服务构造提供，资产 JSON 不能选择可执行程序。维护中的服务与生命周期逻辑采用严格 TypeScript，锁定的 Python 适配器调用 RDFLib/pySHACL。参阅[原生 API 与独立重放（英文）](docs/native-service.md)。

## 内容等级与建模范围

源码反向、文档驱动设计或资产组合开始前，必须固定用途、完整范围、源码修订、独立要求与目标等级。当前评定选择 `standardVersion: "v2"`：L1 为领域理解，L2 为实现规格，L3 为完整重建规格。Ontology 保存规范内容，Harness 负责评定。参阅 [v2 API（英文）](docs/readiness-v2.md)。

L3 不要求实际重建软件或原运行环境。`assetAssessment` 与 `reconstructionVerification` 分开记录，`L3 / NOT_REQUESTED` 是有效结果。它不证明生成软件功能等价、代码相同、生产就绪或获得发布授权。必需内容缺失会阻止授级。历史 usability v1 记录保留原有含义。

公开可见性不代表上传授权。收到执行反馈后可提出语义影响、精确版本复用或新交付建议，但反馈本身不会批准或发布资产。可选运维 profile 保留来源绑定与约束。Preview 不代表 GA。

## 文档与贡献

- [中文文档入口](docs/zh-CN/README.md)、[原生决定（英文）](docs/native-decisions.md)、[可读 API（英文）](docs/readable-api.md)、[运维 profile（英文）](docs/operations-profile.md)。
- [反馈（英文）](docs/feedback.md)、[变更记录（英文）](CHANGELOG.md)、[Roadmap（英文）](docs/roadmap.md)、[贡献指南（英文）](CONTRIBUTING.md)。
- [双语维护规则](docs/zh-CN/documentation-languages.md)、[安全政策（英文）](SECURITY.md)、[Apache-2.0 许可证（英文）](LICENSE)、[归属声明（英文）](NOTICE)。
- [总项目实现语言政策（英文）](https://github.com/yeliang-wang/evopilot/blob/main/docs/language-policy.md)、[发行与校验指南（英文）](https://github.com/yeliang-wang/evopilot/blob/main/docs/github-release.md)。

这些源码文档包含 v0.8.3 发布后的文档改进。既有 tag 归档保留原始文档，后续发行包将包含更新后的页面。
