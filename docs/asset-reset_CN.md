# 清理指定项目的本体资产

资产清理是显式的本地运维操作，执行前先停止选中的安装实例。日常 HTTP/MCP 建模工具不能清理 workspace，安装软件也不会自动清理资产。

在私有文件中保存准确的项目 ID JSON 数组，然后查看完整清点结果：

```sh
evopilot-ontology asset-reset-inspect --installation /absolute/installation --projects /absolute/project-ids.json --request-id reset-001 --json
```

核对 `result.report` 与 `result.reportDigest`。将 report 对象本身保存到私有文件，不包含 CLI 响应外层，然后执行准确匹配的清理：

```sh
evopilot-ontology asset-reset-apply --installation /absolute/installation --report /absolute/reset-report.json --expected-report sha256:INSPECTED_DIGEST --json
```

清理范围覆盖所选项目的原生模型、来源快照、意图、固定期望、派生视图、形式任务、审阅、交付、当前指针，以及包含内容的请求回执。项目身份、凭据、安装设置、其他项目和追加式审计保留，项目修订号递增。删除记录只保留旧内容身份和请求摘要：旧引用返回 `ASSET_PURGED`，原请求 ID 返回 `REQUEST_PURGED`，不能再次发起写入。重建是独立的主动操作，需要新内容身份和新请求 ID。

workspace 中 `asset-exports/<hex-project-id>/` 和 `asset-cache/<hex-project-id>/` 下的托管副本也会纳入清点。目录名使用项目 ID 的 UTF-8 字节的小写十六进制编码。只清理选中项目的目录，其他文件及原始需求文件保留。链接、不安全权限、内容变化或未知状态结构会阻止执行。

外部备份、历史资产存储、消费者引用和保存在其他位置的导出文件，需要各自明确的清点与所属产品的维护流程。本命令不会寻找或删除任意外部文件。发布切换阶段的 P6 必须处理这些副本，之后才能声明历史测试资产已清理。软件 Release、源代码备份、凭据和独立审计证据仍受保护。

先完成或协调未结束的任务，并通过 worker maintenance 清理其原始资源。运行中的服务或其他写入者会阻止清理准入。一旦准入，持久化清理日志会阻断 workspace 使用，直到原操作完成。如果中断，保留原 report 并重复相同的 apply 命令，不创建新的清理身份。已提交的数据库删除通过原审计回执识别，不重复执行；剩余副本逐一校验并删除，数据库完成整理，随后验证目标记录不存在、非目标数据未变，才记录完成。本操作不创建临时业务内容备份。

已完成操作的重放返回原回执及 `verification: NOT_RUN`，不表示重新检查了后续业务变更。冷备份包含清理记录。当前状态恢复若跨越不同的清理历史，将以 `RESTORE_RESET_CONFLICT` 拒绝，避免旧快照悄悄恢复已删除身份。本功能执行选定托管记录和副本的逻辑删除，不承诺存储设备级安全擦除。

v0.9 发布与日常测试资产清理仍须满足各自的候选绑定验收和执行决定。这些开发命令不构成语义批准或软件发布授权。
