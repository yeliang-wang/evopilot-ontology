# Ontology v0.9.0 limited Preview

This user-approved parallel release profile narrows the edition's promises to native ontology asset modeling, reading and validation against the declared standards in an isolated **Linux arm64** environment. It uses the existing formal toolchain platform. The independent repository is `yeliang-wang/evopilot-ontology`, the Git tag is **`v0.9.0`**, and GitHub publication must set **prerelease=true**. This document is a scope contract, not a passing acceptance record or a publication decision.

The [machine profile](../governance/limited-preview-v090.json), [Roadmap](../governance/roadmap.json) and [Target](../governance/target-v090.json) bind this edition. The [complete plan](ontology-v090-plan.md), [independence ADR](architecture/0001-ontology-v090-independence.md), original [143-case matrix](../governance/acceptance-v090.json) and [standards policy](../governance/standards-gate-v090.json) remain unchanged. The limited profile does not certify the complete v0.9 objective. Deferred cases remain unproven, never PASS.

## Promises and deferred work

The candidate must demonstrate installed native modeling and reads, standards validation, rejection of malformed input, and actual authentication, grant and project-scope boundaries. Historical asset reading must name an explicitly supported read-only entry, use an isolated copy, preserve the original bytes and bind its request/response evidence to original and observed digests. Successful historical reading does not certify an old installation upgrade or an implicit v1-to-v2 migration. No existing daily workspace, credentials or installation are repurposed.

Actual Desktop Expert journeys, cross-component delivery, daily installation or plugin switching, test-asset cleanup and old-installation upgrades remain deferred. These are limits on the edition's verified promises. They do **not** assert that the service physically disables every API used by the full plan. Existing scoped RBAC must be tested against the exact package, and documentation and plugin declarations must describe actual permissions accurately. Neither an available API nor a successful technical check authorizes semantic decisions, delivery, installation cutover or software publication.

## Standards admission and evidence order

The full **OWL 2 DL** promise is retained. The six required families remain `rdf11-turtle-syntax`, `rdf11-turtle-eval`, `rdfxml`, `owl2-dl`, `shacl-core` and `shacl-sparql-local`; this profile does not replace them with a smoke test or a declaration-only subset. Follow the existing [standards evaluation protocol](standards-evaluation-v090.md), including complete required results and the complete report.

The mandatory sequence is:

1. Freeze the exact source candidate, archive, manifest, corpus, toolchains and Target.
2. Install that archive into a new isolated Linux arm64 root.
3. Run the full required standards E2E against that installation.
4. Produce and retain the complete standards report.
5. Obtain the user's explicit review of that complete report. Bind the decision to `candidateDigest`, `corpusDigest`, `toolchainDigest`, `reportDigest`, `freezeDigest`, `targetDigest` and `limitedPolicyDigest` with scope `ENTER_LIMITED_PRODUCT_E2E_ONLY`.
6. Run the limited product acceptance against the same candidate.
7. Prepare exact candidate release review; obtain the separate publication decision before publishing.
8. Publicly download and independently reinstall/read/validate the approved release artifacts.

The existing full-product standards decision and its `ENTER_ORIGINAL_PRODUCT_E2E_ONLY` scope are unchanged. A limited decision admits only the limited product evaluation. It uses the separate `limited-review-ledger.json`, decision schema `ontology-limited-standards-review/v1`, action `APPROVE_LIMITED_PRODUCT_E2E` and user-source schema `ontology-limited-user-review-source/v1`, with the additional `limitedPolicyDigest` binding. The full gate must not accept this limited approval, even for the same candidate and Target. Source checks and product diagnostics performed before step 5 cannot be reused as formal product PASS: OL02, OL03, OL05, OL06, OL07 and OL08 must have eligible candidate-bound evidence collected after report approval. Installation needed for the standards run is prerequisite setup, not early OL02 acceptance.

## Fixed limited acceptance matrix

All ten cases are required. Their checked-in status is always `NOT_EVALUATED` with empty evidence; actual results and user decisions remain private and immutable. Missing, unknown, skipped, failed, stale or mismatched required evidence blocks the relevant gate. Zero required results cannot pass.

| ID | Phase | Required evidence |
| --- | --- | --- |
| OL01 | Admission | Exact source CI and frozen candidate archive/manifest/toolchain identities agree. |
| OL02 | Product | Exact isolated Linux arm64 installation, startup, inspection/read, stop and restart through supported installed entries. |
| OL03 | Product | Installed native modeling inputs and source-bound retained model/state reads. |
| OL04 | Admission | All six standards families pass, complete report retained, exact user report approval recorded. |
| OL05 | Product | Actual malformed-input, missing/invalid credential, insufficient-grant and cross-project rejection. |
| OL06 | Product | Historical asset read through a named supported read-only path in an isolated copy; unchanged digests. |
| OL07 | Product | Packaged English/Chinese documentation, plugin declarations, actual permissions and all exclusions agree. |
| OL08 | Product | Release refusal for missing/failed/unknown/stale/mismatched evidence and missing exact publication decision. |
| OL09 | Post-release | Every public release asset matches the approved name, size and digest. |
| OL10 | Post-release | Publicly downloaded package reinstalls in a new isolated root and passes start/stop, modeling/read and declared validation checks. |

OL01–OL08 are required before release review. OL09–OL10 follow publication and are required for closure; their future position never permits them to be represented as pre-release PASS. The executable entry is `scripts/limited-preview-gate-v090.mjs`; the [release procedure](release-v090-limited.md) specifies its private evidence requests and separate exact publication decision. Repository integrity checking with `node scripts/roadmap.mjs --check` establishes only that the bound source contracts agree.

## 中文范围与决定说明

本次独立 `v0.9.0` GitHub 预发行仅承诺 Linux arm64 隔离环境中的本体资产建模、读取和声明标准验证，并要求非法输入、真实权限边界以及明确受支持路径上的历史资产读取验证。完整 OWL 2 DL 与现有六个标准族、完整报告和用户报告审阅均保留。真实桌面、跨组件交付、日常安装或插件切换、测试资产清理及旧安装升级继续暂缓；不得把暂缓项记为通过，也不得据此宣称服务已物理禁用完整版本的所有 API。

先冻结并隔离安装，再完成标准评测、完整报告和用户报告批准，随后采集限定产品正式验收，最后办理精确候选发布决定。报告批准仅允许进入限定产品评测，不是软件发布许可。发布后必须完成公开下载摘要验证与隔离重装读回。原始 143 项矩阵及完整目标继续保留，私有证据和业务资产不进入公开源码或发行包。
