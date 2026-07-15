# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/) 和 [Aelion Breaking Change Policy](docs/versioning-and-breaking-changes.md)。`0.x` 允许有记录的破坏性变更，但不允许静默改变公开 API、Project/Material 协议或资源所有权。

## [Unreleased]

### Changed

- Bound untrusted Project v1 input to 16,384 array entries and 4,096 properties per object before schema and semantic validation. The bundled Project schema now exposes the same Alpha safety budgets instead of advertising larger collections that the SDK cannot admit.
- Relicensed AelionSDK-owned code and all 13 public packages from Apache-2.0 to MIT and replaced placeholder repository metadata with `FoyonaCZY/AelionSDK`.
- Browser conformance now selects WebGPU only after a real adapter probe; transparent output assertions validate observable alpha-over results across headless platforms.

### Added

- Phase 1 最终 tarball browser consumer、API snapshot compare、全量门禁与 Exit Review 正在收口；60 秒 Chromium evidence 已生成并通过独立音视频回读。
- Material package paths now reject ill-formed Unicode before UTF-8 encoding, preventing archive-name collisions; invalid transport Map keys are rejected without invoking caller coercion hooks.

### Fixed

- Clean GitHub Actions browser jobs now build workspace exports before testing and resolve every `@aelion/*` test import through source aliases.
- Hermetic tarball consumers inherit the repository's exact `pnpm@10.13.1` package-manager pin, preventing Corepack from selecting an incompatible pnpm release under Node.js 20.

## [0.1.0-alpha.0] - 2026-07-13

> 状态：release candidate。只有 Phase 1 最终门禁与 Exit Review Accepted 后才创建对应 npm/Git release；本条记录候选内容，不声称远端 tag 或包已经发布。

### Added

- Project v1 Schema、normalized entity map、整数微秒/有理帧率、canonical JSON 和稳定 validator diagnostics。
- 原子 Transaction/revision/inverse/ChangeSet、bounded undo/redo，以及 insert/remove/move/trim/split/replace、Track reorder/lock/enabled/mute 语义命令。
- MP4/H.264/AAC 与 WebM/VP9/Opus 的统一 SampleIndex、Range reader、exact seek、VideoFrame 与 PCM decode。
- 共享 Render IR、Worker WebGL2/WebGPU Material compositor，以及按 Project 顺序执行的多轨 premultiplied normal alpha-over。
- AudioWorklet 主时钟、视频追随、seek generation、有界 SharedArrayBuffer/Transferable PCM、Track mute 与 loop time-mapping mixer。
- frozen Render IR 的 WebCodecs VP9/Opus 流式 WebM 导出、preflight、进度/取消、Writable/Memory/OPFS Sink、背压与 partial cleanup。
- Aelion Material Protocol、Core Node Graph compiler、Cross Dissolve/Warm Film/Soft Glow 示例与 Preview/Export 执行链。
- `@aelion/material-sdk` typed Definition/Graph builders、静态校验、canonical manifest、逐文件 SHA-256、确定性 `.aelionmat` ZIP、精确 Registry/Resolver 和 trusted-code publisher allowlist。
- `@aelion/sdk` 统一 Session facade，覆盖 Project load、Transaction/history、Player、Preview、Export、Capability、Material runtime 和有界 `ByteMediaProvider`。
- 13 个 MIT 公开 `@aelion/*` 包具备 ESM exports、`.d.ts`、npm metadata、LICENSE/README staging；第 13 个包 `@aelion/vite-plugin` 提供公开的 Vite Worker/AudioWorklet 资源集成。
- Worker/AudioWorklet 生产 URL 使用随包 `.js`，tarball gate 检查其目标存在且不发布 `src`/`.tsbuildinfo`。
- 开源治理文件、ADR-001～015、Alpha Quick Start、部署/Provider/资源/诊断/版本文档、60 秒合法 Project fixture 与 Phase 1 evidence/exit 模板。

### Changed

- 实时默认图形后端冻结为 WebGL2；WebGPU 保留 capability-selected 实验路径，不再把 API 存在等同于实时默认。
- Audio Track `muted` 进入 Render IR/evaluator，Preview Player 与离线 audio mixer 共享语义。
- Transition 结果作为一个 layer 与其他 visual Track 继续合成，不再短路多轨画面。
- SDK 内置 Project/Material v1 Schema 作为普通接入默认值；高级宿主仍可显式覆盖。

### Fixed

- Worker/AudioWorklet 发布资源不再引用源 `.ts`。
- Player 保存绑定的 animation-frame 调用，避免浏览器 `Illegal invocation`；加入明确 `ended`、duration stop、seek generation 和单 frame owner 约束。
- Preview/Player/Export 在 frame transfer、丢弃过期 generation 和 dispose 路径明确关闭 bitmap/frame。
- 音频 `boundary: loop` 跨 sourceRange 请求由 mixer 分段，MediaProvider 只读取合法源范围。
- `ByteMediaProvider` 与底层 video decoder 按零基 `streamIndex` 精确选择 video Track；不存在的流以稳定 `RangeError` 拒绝，不再静默回退到首轨。
- 同一 Session 并发启动第二个 Export 现在以包含 `EXPORT_JOB_ACTIVE` diagnostic 的 `AelionError` 拒绝。
- Render IR/compile stats 在 compiler 边界深冻结，Session snapshot 不再能绕过 Transaction 篡改内部执行语义。
- Session diagnostic history 默认保留最近 256 条并记录淘汰数，避免长会话无界增长；Export/Player 运行失败进入统一 diagnostic 订阅。
- Player 的异步 PCM fill、seek、invalidate 与 dispose 使用 generation/AbortSignal 隔离，结束时暂停 AudioContext；sequence sample rate 传入 owned AudioContext。
- 音频 mixer 覆盖非整数微秒采样边界，不再周期性遗漏 block 尾 sample；Audio 变速/倒放在本 Alpha 由 validator fail closed。
- 内置 Project/Material Instance Schema 增加 canonical source drift 检查并进入 CI。
- `ByteMediaProvider` 对同 asset bytes/SampleIndex 使用可删除 subscriber 的 single-flight；load/index/decode 共用默认 4 路并发、64 个等待 operation 与 68 个公开请求全生命周期硬上限，并隔离单调用者取消与 `clear()` 后的旧请求回填。
- Renderer 对完整帧评估设置默认 2 路硬上限；Worker 只记录 active request 的取消状态，并在 worker error/dispose 时移除 pending abort listener。`session.dispose()` 会取消并等待在途帧评估 settle。
- Material package 在 defensive copy/hash/ZIP rebuild 前执行 256 文件（含 manifest）、32 MiB 单文件、64 MiB 总包与 65 MiB archive 默认预算，并拒绝伪造容器、危险路径及畸形 Manifest/Definition/Graph。

### Compatibility

- Alpha 候选认证：桌面 Chromium Tier A、桌面 Firefox Tier B；60 秒 Chromium export/readback 已通过，最终 tarball consumer、API snapshot 和全量门禁仍是 release gate。
- 输入候选范围：MP4/H.264/AAC、WebM/VP9/Opus。
- 标准本地输出：WebM/VP9/Opus。
- Safari、iOS/iPadOS 和 Android 未认证，不由 WebKit/桌面结果推断。
- SDR 8-bit；HDR/P3/10-bit/4K 未认证。

### Known limitations

- 尚无 ripple/roll/slip/slide、group/link 命令、Track solo、完整 Text/Caption、Mask/Matte 和非 normal blend mode 执行认证。
- 标准本地输出不包括统一 MP4/H.264/AAC；codec API 的单项 probe 不构成容器链支持。
- WebGPU 尚未使用持久 device/pipeline 与零拷贝呈现；WebGL2 是当前实时默认。
- 大文件/CDN 需要自定义 range-backed MediaProvider；`ByteMediaProvider` 会读取完整资源。
- Material 公钥签名链、撤回、Marketplace 和通用 trusted Shader/WASM 沙箱未实现；当前只提供 integrity 与宿主 allowlist，且 Worker/WASM 不被视为安全沙箱。
- Safari/iOS/Android、其他 OS/GPU、长视频/4K/HDR 和移动端本地导出尚未认证。
- npm provenance 尚未由真实 publish 证明。
- Vite 应用必须显式启用公开 `@aelion/vite-plugin`；其他 bundler 尚无认证适配器。

[Unreleased]: https://github.com/FoyonaCZY/AelionSDK/compare/v0.1.0-alpha.0...HEAD
[0.1.0-alpha.0]: https://github.com/FoyonaCZY/AelionSDK/releases/tag/v0.1.0-alpha.0
