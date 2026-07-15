# 版本、兼容性与 Breaking Change Policy

AelionSDK 遵循 Semantic Versioning，但 `0.x` 与 prerelease 明确表示 API 尚未达到 1.0 稳定承诺。本政策约束公开 npm API、Project/Material 协议和可复现输出语义，避免用“Alpha”掩盖无记录破坏。

## 1. 版本域

| 域 | 当前版本/标识 | 兼容性边界 |
|---|---|---|
| npm release train | `0.1.0-alpha.0` | 13 个公开包使用同一版本；推荐稳定门面是 `@aelion/sdk`，Vite 分发入口是 `@aelion/vite-plugin` |
| Project Document | `$schema: .../project/v1.json`、`schemaVersion: 1.0.0` | JSON 字段、normalized references、时间和 ownership 语义 |
| Render IR | `irVersion: 1.0.0` | SDK 内部/高级 runtime 边界；不等同 Project 持久格式 |
| Material Protocol | `protocolVersion: 1.0.0` | Package/Definition/Graph/Instance 结构和执行契约 |
| Material package | 作者 SemVer + exact integrity | 每个 Project 固定 exact version 和内容 |
| Core Node set | `aelion.visual.nodes/1.0.0` | 节点端口、数学、颜色/alpha 和成本语义 |

这些版本独立演进。升级 SDK 不会自动重写 Project 或替换 Material integrity。

## 2. npm SemVer 规则

在正式 `1.0.0` 前：

- breaking public API change：提升 `0.MINOR.0`；若仍处 prerelease，至少发布新的 prerelease 标识，并在 changelog 明列 breaking 与迁移步骤；
- 向后兼容的新 API/能力：提升 minor；同一未稳定 Alpha train 内可以发布下一 `alpha.N`，但不能省略 changelog；
- 向后兼容 bug/security/doc fix：提升 patch 或下一 prerelease；
- 只改变内部实现且不改变 public signatures、Project/Material 语义、diagnostic code 或输出契约：可以 patch；
- 公开包使用同一 release train，避免 `@aelion/sdk` 与其底层依赖出现未经测试的版本拼装。

SemVer 对 prerelease 的优先级规则不等于“可以无通知破坏”。已发布 `alpha.N` 的使用者必须能从 CHANGELOG 和迁移文档理解下一版本变化。

## 3. 什么算 breaking

包括但不限于：

- 删除/重命名 package export、函数、字段、event 或 diagnostic code；
- 把 optional 参数改 required，收窄 TypeScript 类型或改变返回/取消/所有权规则；
- 改变 Project 时间单位、排序、默认值、reference/ownership 或 canonical JSON 语义；
- 相同 Project/Material/revision 在同一已认证 backend 上产生超出已声明容差的不同结果；
- 改变 `Sequence.trackIds` z-order、premultiplied alpha、Transition 输入或 Preview/Export parity；
- 改变 Material 参数默认值/范围/插值、Node 数学、color/alpha/time space、trust 或 integrity 规则；
- 删除已认证浏览器/codec/backend/Sink 且没有原本声明的 capability fallback；
- 让以前结构化、可预检的失败变成执行期静默降级；
- 改变 frame、Sink、Provider、Session dispose 的资源 ownership。

仅改进错误 `message` 文案、增加 optional diagnostic details、扩展未排序 map 的内部遍历，通常不 breaking；但 code/severity/recoverable 的语义变化仍需评审。

## 4. Project Schema 演进

- 已发布 `$id`/`schemaVersion` 的 schema 文件不可原地改变既有字段语义；
- 新 optional 字段只有在旧 runtime 能安全忽略且 canonical/ownership 不变时才可能作为兼容扩展；当前 strict schema 默认不接受未知字段，因此通常需要新 schema version；
- 删除、重命名、类型/默认值/单位变化必须发布新 schema version和纯数据 migration；
- migration 接收旧 snapshot、输出新 snapshot，必须 deterministic、可测试，并报告丢失/视觉变化；
- SDK 不在 `loadProject` 时静默覆盖用户原文；迁移由调用方显式触发并保存新 revision；
- `extensions` 使用反向域名 key，不能覆盖核心字段或逃避 executable-code 禁令。

## 5. Material 与 Node 演进

- Project 固定 `packageId + packageVersion + packageIntegrity + materialId`；Registry 不用 semver range 替代；
- payload 改动必然改变 integrity；不得用相同 integrity 指向新内容；
- patch 不得改变已有参数默认/数学/port/alpha/color/time 语义；
- compatible 新参数/新 Material 提升 minor；删除/重命名/语义变化提升 major；
- Node 行为变化发布新 `typeVersion`/node set，旧包继续解析旧数学；
- trusted-code 授权不能通过升级继承到新的 publisher/integrity；宿主重新审核并 allowlist；
- 签名、迁移或兼容声明不能绕过 payload hash 验证。

## 6. API 快照门禁

每个发布候选必须为推荐稳定门面 `@aelion/sdk` 生成/比对 TypeScript declaration snapshot：

1. 构建所有 package；
2. 只读取 `@aelion/sdk` 公开入口可达的 `.d.ts`，并在真实 tarball gate 中复核 package exports；
3. 与上一个已发布版本比较 removed/changed/added signature；
4. 对 removed/changed 项要求版本提升、CHANGELOG `Breaking` 和迁移说明；
5. 在真实 tarball consumer 中编译 Quick Start/contract fixture；
6. 确认 Worker/Worklet 和 schema 等 runtime assets 与声明一致。

首次 Alpha 的 snapshot 建立基线而非与不存在的旧版本比较。其他高级包在本 Alpha 中必须通过 tarball exports/import/type 文件门禁，但不因此自动获得与 `@aelion/sdk` 相同的稳定性承诺；后续某个包升级为独立稳定门面时，必须为它增加自己的 declaration snapshot。snapshot 工具和 CI 未返回 0 前，不能仅凭手工 review 宣称 API 已冻结。

## 7. Deprecation 与迁移

达到 beta/稳定前也优先采用：

- 新增替代 API；
- 在类型/JSDoc/CHANGELOG 标记 deprecated 和最后支持版本；
- 提供 before/after 示例和可机械迁移建议；
- 至少保留一个公开 prerelease 周期，再删除；安全漏洞或数据损坏风险可加速删除，但必须在 release note 明确。

每个 breaking release 的迁移说明至少包含：受影响版本、检测方式、Project/Material 是否需要迁移、代码 diff、取消/资源变化、兼容矩阵变化和 rollback 方法。

## 8. 发布检查

- 版本、tag、CHANGELOG 和所有 package manifest 一致；
- API snapshot compare 通过；
- Project/Material schema、fixture 和 migration test 通过；
- Preview/Export parity 与 Golden 没有无解释漂移；
- tarball Node/browser consumer 通过；
- compatibility matrix 已更新，uncertified 平台没有被提升；
- repository URL/provenance/许可证/SBOM 的声明与真实发布环境一致。
