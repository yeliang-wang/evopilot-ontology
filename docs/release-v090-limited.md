# Independent v0.9.0 Limited Preview publication

This is an operator contract, not a publication or acceptance claim. The package remains `@evopilot-next/ontology@0.9.0`. Its own repository is `yeliang-wang/evopilot-ontology`; the tag is exactly `v0.9.0` and the GitHub release is a prerelease. The [limited policy](../governance/limited-preview-v090.json) preserves the complete 143-case target separately. Standalone modeling, reading and declared standard validation are evaluated in isolation. Actual desktop selection, cross-component delivery, daily installation cutover and historical test-asset reset remain deferred.

The native distribution targets Linux ARM64, glibc 2.28 or newer, Node 24.14.0 and a verified systemd user manager. macOS source CI does not establish this platform's acceptance. The thirteen native payload/source/notice materials in the selected committed catalog remain mandatory.

## Candidate preparation and review

1. Freeze and commit the reviewed source. Obtain a successful original `ci.yml` run in this repository. Preserve its raw API run record, artifact metadata and the original artifact ZIP. `scripts/prepare-release-v090.mjs` checks those identities without rebuilding; `RELEASE_PROFILE=limited-preview-v090` changes its next-step guidance without granting release authority. The default `original-v090` route remains available.
2. Retain the exact package, dependency lock, selected catalog, every catalog artifact and complete source/license/rebuild evidence outside source. The public assets must have the frozen release names as their actual basenames. Evidence paths are canonical, contained, regular files without symlinks or hardlinks. Large native materials are hashed with a 512 MiB per-file bound; metadata uses a 32 MiB bound.
3. Execute the declared standards on the installed exact candidate. Present the complete report and obtain the actual user's limited-product admission. That decision uses its separate limited review ledger and binds candidate, corpus, toolchain, report, freeze, target and limited-policy digests. Execute every required pre-release limited case. Missing, skipped, stale or failed evidence is blocking.
4. Create a private publication request as described below. Run the read-only review preparation:

```sh
node scripts/limited-preview-release-v090.mjs prepare-review \
  --evidence ABS_PRIVATE_EVIDENCE \
  --request publication-request.json \
  --output ABS_NEW_REVIEW_DIRECTORY
```

The output contains `release-review.json`, its digest, `release-manifest.json` and `SHA256SUMS`. It retains `releaseAuthorized:false`. Review the exact source/CI identity, complete asset inventory, bilingual release notes, standards admission, limited acceptance and preserved exclusions with the user. Neither a successful preparer nor a technical gate is publication approval.

## Private publication request

The exact `ontology-limited-publication-request/v1` fields are:

| Field | Binding |
| --- | --- |
| `repository`, `tag`, `prerelease`, `profile` | `yeliang-wang/evopilot-ontology`, `v0.9.0`, `true`, `ontology-v090-limited-preview` |
| `sourceCommit`, `sourceRunId`, `candidateDigest` | Exact 40-character SHA, numeric run ID string, `sha256:` package digest |
| `publisherLogin` | Actual GitHub account to use for publication |
| `limitedRequest` | Relative path to the independent `ontology-limited-release-request/v1` accepted by `checkLimitedPreviewRelease` |
| `source` | `run`, `metadata`, `zip` references to original source-CI evidence |
| `catalogPath` | Committed `governance/distribution-linux-arm64-v090[-candidateN].json` |
| `assets` | Unique `{name,file}` records for the eighteen required input assets |
| `nativeClosure` | Reference to the complete native source/license closure record |

A file reference is exactly `{path,digest}` with a contained relative path and a `sha256:` digest of its original bytes. The eighteen supplied assets are the npm tarball, `ontology-dependency-lock.json`, `source-revision.txt`, `ontology-native-catalog.json`, `release-notes.md` and all thirteen names from the catalog. The operator deterministically adds `release-manifest.json` and `SHA256SUMS`; arbitrary additional assets are refused. The manifest lists the eighteen input assets; checksums cover those assets plus the manifest. The private review binds all twenty final upload bytes, including the checksums. Private user messages, acceptance ledgers and credential material are never part of that asset allowlist.

`nativeClosure` uses `ontology-private-native-license-source-closure/v1` with exactly `candidateDigest`, `catalogDigest`, `unresolved`, `sourceInventory`, `rebuild` and `sourceEmbeddedLicenses`. The unresolved list must be empty. Inventory/rebuild records must establish all locked binary/source/license identities, replayed source patches and identical worker output. Where original POM license declarations are absent, retain the exact source archive and original license/header members. This record is separately reviewed evidence; boolean declarations alone are not an upstream license determination or actual rebuild execution.

The operator verifies the original CI artifact ZIP, exact package bytes, actual package members, packaged catalog/native sources, committed dependency lock and all native artifact hashes. It calls the independent limited release checker and binds its result into the private review. Changed source, package, corpus, toolchain, report, policy or acceptance requires a newly frozen basis and applicable renewed review; an old user decision cannot carry forward.

## Separate exact user publication decision

After reviewing the concrete output, retain the actual user's message outside source. An assistant assertion, source-edit approval, standards approval or delegation is not a release decision. Software can verify retained record integrity and binding; JSON cannot authenticate who wrote a chat message. The operator must independently verify the original Host user message before recording it.

The decision is `ontology-limited-release-decision/v1` with exactly `actor:'USER'`, `action:'AUTHORIZE_RELEASE'`, `bindings`, `source`, `notBefore` and `expiresAt`. Its source reference must resolve to `ontology-user-release-source/v1` with `role:'user'`, the actual `threadId`, `turnId`, `messageId`, `text`, `occurredAt`, the same action and exact bindings. Bindings contain repository, tag, `prerelease:true`, sourceCommit, candidateDigest, reviewDigest, assetsDigest, targetDigest, policyDigest, acceptanceDigest, standardsDecisionDigest, publisherLogin, notBefore and expiresAt. The source and decision bind the same timing fields. `notBefore` equals the actual user decision time, which must postdate completed acceptance. `expiresAt` is null unless the actual user decision specifies an expiry; when provided, that deadline is enforced. The operator does not invent an authorization duration.

Only after this decision exists may the operator execute:

```sh
node scripts/limited-preview-release-v090.mjs publish \
  --evidence ABS_PRIVATE_EVIDENCE \
  --request publication-request.json \
  --decision actual-user-release-decision.json \
  --output ABS_NEW_PUBLICATION_EVIDENCE
```

The publisher recomputes the review, checks the authenticated GitHub account and own-repository numeric identity, refreshes original source-run/artifact metadata and requires unambiguous absence of both tag and release. It records each write request before executing it and preserves its original result. It creates the exact commit tag and an unpublished prerelease draft with `make_latest:false`, retaining the raw response and exact release ID. It then uploads one frozen asset per attempt using `gh release upload`. Only after a raw readback verifies that same draft’s complete asset set, notes, checksums and exact commit tag does it publish that draft by ID with `draft:false`, followed by another public release/tag readback. The official CLI handles binary transport; no manually supplied `Content-Length`, upload clobber or automatic retry is used.

Any failed or uncertain mutation stops. Preserve the evidence and inspect the original remote state before a separately reviewed continuation. An upload failure leaves the original unpublished draft, release ID and journal available for reconciliation. Existing tags, releases and assets are not deleted or silently replaced. The final metadata/tag readback verifies the published identities and bytes, but is not a downloaded-installation check.

## Post-release isolated readback

Download every published asset again, verify the exact approved checksums and manifest, and install into a new isolated runtime/control/workspace location on the declared platform. Run the limited modeling, reading and standard-validation readback through public product entry points. Complete the policy's post-release cases before reporting closure. Keep the daily installation and current desktop plugin selection unchanged; do not trigger historical asset reset or cross-component delivery. The original full target remains incomplete where its cases were deferred.

## 中文操作说明

本入口只负责 Ontology 独立仓库的 `v0.9.0` 限定 Preview；GitHub 必须标记为预发行。准备命令核对原始源码 CI 包、依赖锁、Linux ARM64 原生目录及全部十三项工具/来源/NOTICE 材料、标准报告的真实用户审阅和限定验收，生成精确发行审阅包。准备成功仍为 `releaseAuthorized:false`，原 143 项完整目标保留。

实际发布必须另有用户对确切提交、包摘要、全部资产、发布说明和验收结果的决定，并绑定发布账号和真实决定时间；只有用户明确指定到期时间时才设置并执行该期限，否则为 null。结构化 JSON 只能核对记录完整性，不能独立证明聊天消息的用户身份；记录前必须核对原始用户消息。先创建未公开草稿并保存其 ID；全部资产和标签读回核验通过后，才按同一 ID 公开。每次远端写入保留请求和原始结果；上传失败保留原草稿，未知结果停止，不能自动重试、删除或覆盖已有 tag/release/asset。

发布后重新下载全部资产、核对摘要，并在声明平台的新隔离安装中完成建模、读取和标准验证读回。真实桌面流程、跨组件交付、日常安装切换及历史测试资产清理继续暂缓，不能记为已通过。该流程无 npm registry 发布或生产部署。
