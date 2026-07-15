# ADR-012：以 Session Facade 冻结 Alpha 公开 API

- 状态：Accepted
- 日期：2026-07-13
- 负责人：SDK/API

## Context

Phase 0 已分别验证 Project、Transaction、Render IR、Player、Material 和 Export，但这些内部包的组合方式、生命周期与资源所有权不应成为每个接入方都要重新发明的协议。浏览器编辑器还需要在同一工程 revision 上协调编辑、预览、播放和导出；如果上层直接拼装内部对象，很容易产生两套时间语义、导出读取最新状态而不是冻结状态、或 Worker/AudioWorklet 无法释放等问题。

公开入口不能把客户端剪辑 SDK 的 Timeline/Player 外形直接移植到 Web。浏览器的 Worker、AudioContext 用户激活、WebCodecs 配置探测、Streams 背压、CORS 和跨源隔离是产品契约的一部分。

## Decision

`@aelion/sdk` 是 Alpha 的推荐入口，以一个异步创建、显式释放的 Session 组织能力：

- `Aelion.createSession(options)` 不在模块 import 时创建 AudioContext、GPU 或全局监听；
- `loadProject` 先做 Project Schema 和 normalized reference 校验，再以 revision `0` 建立 Transaction/Render IR；SDK 提供内置 v1 Schema，`options.schemas` 仅作为高级覆盖点；
- `session.transaction` 暴露原子 `edit`、语义 `commands`、bounded `undo/redo` 和 revision conflict；Project JSON 是持久化快照，不是高频命令流；
- `session.player` 暴露 `play/pause/seek/scrub`，有声播放由 AudioWorklet/AudioContext 主时钟驱动；
- `session.preview.renderFrame` 是单帧预览门面；为迁移保留的同义入口不得形成第二套实现；
- `session.export.preflight/start/cancel` 从调用开始时冻结同一 Render IR revision，并使用与 Preview 相同的 frame renderer 和 audio mixer；`start` 返回 await-compatible、可订阅/取消的单一 active ExportJob；
- `probeCapabilities`、稳定 diagnostic event、state/stats snapshot 让上层解释浏览器差异，不以 UA 推断支持；Snapshot 是冻结的观测值，不暴露 runtime 可变对象；
- Material runtime 只按精确 package id/version/integrity/material id 解析宿主注册的程序；Authoring/Package Registry 由 `@aelion/material-sdk` 提供；
- 所有长操作接受或内部绑定 `AbortSignal`。`cancel()` 是导出任务的便捷控制面，不替代标准取消语义；
- Session、Player frame、Preview result、Sink 与 MediaProvider 的所有权必须在公开文档中显式说明；`dispose()` 幂等。

公开 API 签名由提交到仓库的声明快照管理。在 `0.x` 阶段允许破坏性变更，但必须提升 minor（Alpha prerelease 可提升下一 prerelease/minor）、记录 changelog 和迁移方式；patch 不得静默改变既有 Project 或 Material 语义。

## Alternatives

- 只发布底层包、让接入方自由组装：拒绝作为推荐接入面；无法统一生命周期、冻结 revision 和诊断语义；
- 把完整 Project JSON 当作每帧/每次拖动命令：拒绝；序列化和全量校验成本高，也无法表达原子 inverse；
- 暴露内部 Renderer/Decoder 对象图：拒绝；会固化可替换实现并扩大资源泄漏面；
- 用单例全局 SDK：拒绝；多编辑器实例、测试隔离和页面级资源治理都需要明确实例边界。

## Consequences

- 新能力优先沿 Session 子域增加，底层包仍可供高级集成，但不自动获得同等稳定性承诺；
- Player、Preview 与 Export 必须消费同一 Render IR/evaluator，不能在 Facade 复制时间线逻辑；
- API 快照变化成为发布门禁，文档示例必须只导入公开包入口；
- 浏览器必须在用户手势内调用 `play()`，Session 创建本身不会绕过 autoplay 策略；
- 当前 Alpha 支持一个 Player frame owner，回调接收的 `ImageBitmap` 由调用方关闭；这一约束以后放宽也必须保持所有权可判定。

## Evidence

- `packages/sdk/src`：Session、Player、MediaProvider 与 Material runtime facade；
- `packages/sdk/test/session.test.ts`：load/dispose、validator 与无媒体路径；
- `packages/sdk/test/session.browser.test.ts`：仅通过公开门面完成 load、edit、seek/play、preview、frozen export 和容器回读；
- `docs/guides/alpha-quick-start.md` 与 `docs/contracts/phase-1-editing-commands.md`：接入和编辑语义。
