# EvoPilot Ontology · v0.9.0 Preview

[English](README.md) | 简体中文

<!-- distribution-status: source -->

EvoPilot-ontology 通过独立 Expert、CLI、MCP 服务和私有工作区开发并保存本体资产，覆盖需求正向建模、已接收来源的逆向建模、OWL 推理、SHACL 验证、解释、语义评审及不可变交付。Runtime 和 Harness 是可选消费者，使用 Ontology 不依赖它们。

[快速开始](#quickstart) · [原生 v2 标准](specifications/v2/models.md) · [文档](docs/README.md) · [发布列表](https://github.com/yeliang-wang/evopilot-ontology/releases)

这些源码文档描述 v0.9.0 的范围。实际发布状态和下载标识以发布列表为准，源码存在或测试通过均不代表软件发布或业务验收。[发布流程](docs/release-v090.md)要求先完成安装后标准评测报告与用户评审，再执行原定完整产品验收，并另行取得发布决定。

<a id="what-is-an-ontology-asset"></a>

## 资产与标准

| 依据 | 用途与范围 |
|---|---|
| RDF 1.1、Turtle 1.1、RDF/XML | 保存图中的原始项、文档基址、稳定 IRI 和准确来源字节，支持检查断言图输出。 |
| RDFS 1.1 与 OWL 2 DL | 完整 OWL 2 DL Direct Semantics 推理是交付承诺，包含合法性、一致性、蕴含、命名分类和具有证据的解释；承诺不包含 OWL Full。 |
| SHACL Core 与本地 SHACL-SPARQL | 检查断言图或明确选定的派生图并保留完整报告；业务验证还检查独立固定用例、需求及必需目标覆盖。 |
| JSON Schema 与 JSON 封装 | 校验 API 结构、元数据及回执，不作为另一套可编辑本体。 |
| EvoPilot 原生 v2 合约 | 绑定意图、原始来源、固定期望、模型、命名视图、精确评审及不可变交付。 |

RDF/OWL 文档和 SHACL shapes 是语义来源。未知结果、不支持的扩展、限制与未完成状态均明确呈现。图符合约束不等于业务模型已通过验证。请阅读[模型合约](specifications/v2/models.md)、[SHACL 范围](specifications/v2/shacl.md)及[推理指南](docs/reasoning-v090.md)。

例如，可以通过 OWL 限制从“服务访问敏感数据集”推断该服务属于敏感服务，再用 SHACL 要求它具有负责人。Expert 展示原始需求、固定正反例、实际推理、约束违规和支持公理。交付前，人类另行评审该精确模型。

<a id="quickstart"></a>

## 快速开始

使用 **Node 24.14.0**。独立入口为 `evopilot-ontology`，命令要求 `--json`。明确安装并连接插件后，在 Codex 选用独立 Ontology Expert。新的 v2 工作不再通过父项目 Expert 安装入口启动。

### 安装 Preview 包

产品归档名为 `evopilot-next-ontology-0.9.0.tgz`。从经过评审的分发中取得选定产品包、依赖锁、源码版本、校验和及原生组件、来源和声明材料，安装前验证全部所选材料。遵循[独立安装指南](docs/standalone-v090.md)和[离线工具链准备](docs/managed-toolchains-v090.md)；源码构建的测试包不代表已发布 Release。

固定原生分发方案面向 Linux ARM64、glibc 2.28 或以上，并要求可用的 systemd 用户管理器约束 worker。其他开发宿主或手动准备的工具不能证明该分发的平台验收。npm runtime、原生工具、安装控制目录与业务工作区应分别位于 Git 外的私有目录。包内插件模板需要实际连接配置，不包含凭据。

### 首次业务流程

1. 检查连接身份、项目范围、权限及可用工具链。
2. 记录目的、范围、排除项及来源版本，接收准确来源字节。
3. 在生成模型前固定独立正反例期望。
4. 保存 RDF/OWL 模型、SHACL shapes 和需求映射，运行推理与业务验证。
5. 检查违规和解释，修正模型并重复必需检查。
6. 准备精确语义评审，取得真实获授权的人类决定后，记录不可变交付并验证回读。

参见[独立 Expert 指南](docs/standalone-v090.md)、[期望合约](specifications/v2/expectations.md)与[评审及交付合约](specifications/v2/lifecycle.md)。写入结果不确定时，先检查原始回执，不自动提交替代请求。

### 从源码开发

源码工作流使用锁定依赖和严格 TypeScript：

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm run test:governance
```

原生测试还需要[推理指南](docs/reasoning-v090.md)和[SHACL 合约](specifications/v2/shacl.md)规定的精确且已验证工具链，缺失工具会明确失败。TypeScript 负责产品状态及策略，Java 执行 OWL 推理，Python 适配 RDF/SHACL。详见[语言分类](docs/language-policy-v090.md)。

## 兼容入口与私有资产

历史 v1 规范、兼容层及 vendor 字节和不可变记录保留原义。历史 `evopilot-next-ontology` CLI 与根 SDK 的 `VERSION` 保持旧 v0.8.3 接口标识，独立 runtime 清单报告安装的 v0.9.0 包版本。新的 v2 工作使用独立入口及合约，不隐式迁移、上传或自动重建业务资产。

保留的内容评估 API 选择 `standardVersion: "v2"`：L1 领域理解、L2 实现规格、L3 重建规格。`assetAssessment` 与 `reconstructionVerification` 保持独立，`L3 / NOT_REQUESTED` 有效。内容等级不证明实际重建、生产就绪或发布权限。参见[保留的内容就绪度 API](docs/readiness-v2.md)。

私有工作区和凭据不属于发布资产。选定历史测试资产的清理在安装验收后单独执行，业务资产之后由用户手动重建。Dashboard 不在本版本范围内。

## 文档与贡献

- [文档目录](docs/README.md)、[已接受方案](docs/ontology-v090-plan.md)、[路线图](docs/roadmap.md)与[变更记录](CHANGELOG.md)。
- [安装维护](docs/installation-maintenance-v090.md)、[worker 恢复](docs/worker-recovery-v090.md)与[标准评测](docs/standards-evaluation-v090.md)。
- [贡献指南](CONTRIBUTING.md)、[双语维护](docs/documentation-languages.md)、[安全](SECURITY.md)、[许可](LICENSE)与[声明](NOTICE)。
