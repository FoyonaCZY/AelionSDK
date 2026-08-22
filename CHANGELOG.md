# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/) 和 [Aelion 版本与迁移规则](apps/docs/src/content/docs/zh/project/development.md#版本与迁移)。预发布变更必须有记录、可迁移，不允许静默改变公开 API、协议或资源所有权。

## 1.2.0-rc.3 — 2026-08-22

### Fixed

- 预览视觉变换改为像素空间 Y-up：旋转后的正方形保持为正方形，WebGL2 与 WebGPU 的离中心图层位置一致；文字使用独立的 `builtin-text-visual-transform-v1`，图片仍使用 `builtin-visual-transform-v4`。
- 静图走合成 SampleIndex，不再把静态图送进容器 indexer。
- Vite 插件为 Worker/Worklet URL 加上 `/* @vite-ignore */`，避免 Vite 7 把公开模块 URL 改写成 `/@fs/@aelion…` 后 404。
- 事务 `historyGroup` 会传入 command edit options，连续拖动等高频编辑可以合并为同一历史条目。

### Changed

- Aelion Studio 参考剪辑器拆到独立仓库；SDK 工作区、CI 和发布清单不再包含 `apps/editor-demo`。

## 1.2.0-rc.2 — 2026-08-02

### Fixed

- 恢复不可变的 Project v1.0 Schema，并新增独立的 `v1.2.json / 1.2.0` 身份；默认校验器会在不修改调用方对象的前提下迁移 1.1/1.2 rc.1 产生的歧义身份文档。
- 把图像序列帧清单接入 Render IR、Renderer 预览和直接导出快路径，统一精确帧边界语义。
- 字幕导入改为先完整校验再写入，修复 `atUs` 偏移、静音对齐缩短时长和导出重叠未拒绝的问题。
- 修复 Bézier 求值：线性插值忽略手柄，支持仅入手柄，缺失切线按零处理。
- 速率包络支持正向、定格与反向区段，并校验源起点和安全整数范围。
- 代理生成增加 64 MiB 默认整缓冲上限、输出约束和 RangeReader 编码契约，超限时在读取前失败。
- 新增诚实命名的 `detectAudioEnergyChanges` / `analyzeAudioEnergyChanges`；旧 scene API 仅作弃用兼容，不再宣称视频场景检测。
- 明确 codec fallback 注册表只是能力描述符而非可执行 WASM 后端，并新增 `selectCodecAvailability`。
- 设备矩阵版本进入发布同步和常规 CI 校验。

### Documentation

- 逐项审计 1.1/1.2 为“已完成、部分完成、延期”，并按不可变 Schema、迁移、Project/Render IR 分层、消费者集成、API 冻结和全量认证重排 2.0 计划。

## 1.2.0-rc.1 — 2026-08-01

### Added

- Added subtitle track I/O: `importSubtitleTrack` parses SRT/WebVTT into
  caption clips (fail-closed on overlaps), `exportSubtitleTrack` writes a
  caption track back to SRT/VTT preserving cue settings, and
  `alignCueToSilenceUs`/`frameRangeToUs` support silence-aware cue alignment.
  Reuses the render-ir caption codecs; no schema change.
- Added curve time mapping and rate envelopes: `addMediaClip` accepts
  `curvePoints` (mutually exclusive with `rate`) producing a schema-valid
  curve timeMapping, and `buildRateEnvelope` compiles a segmented rate
  envelope into equivalent monotonic curve points.
- Added Bézier keyframe handles: Project keyframes gain optional
  `handleIn`/`handleOut` value-space tangents, persisted by `setKeyframes` and
  evaluated as a value-space cubic Bézier in render-ir, falling back to the
  existing easing path otherwise.
- Added offline beat and scene-boundary analysis: `detectBeats` (energy
  envelope onsets) and `detectScenes` (audio-energy discontinuities) in
  `@aelionsdk/audio`, driven by a `readFrames` source with bounded memory,
  AbortSignal and progress; exposed as
  `SessionAudioController.analyzeBeats`/`analyzeScenes`.
- Added automatic proxy registration: `registerAutomaticProxy` generates a
  low-resolution proxy from an original representation through an injected
  encoder and registers it as a proxy representation, so the provider serves
  it for preview while keeping the original for export.
- Verified and documented WebGPU/WebGL2 Material single-pass parity; multi-pass
  `blur.gaussian` compiles on WebGL2 and fails closed on WebGPU (which lacks
  the multi-pass pipeline), now an explicit capability gate.

## 1.1.0-rc.1 — 2026-08-01

### Added

- Added QuickTime (MOV), Matroska (MKV) and MPEG-TS container import. The
  `SampleIndex.container` union gains `'mov'`, `'mkv'` and `'ts'`, asset MIME
  derivation no longer collapses them into `video/webm`, and CC0 fixtures bound
  to generated SHA-256 cover each container in the media corpus.
- Added AVIF still decode certification (fixture + browser test) and an
  image-format capability probe that reports `avif`/`jpeg`/`png`/`webp` via
  `ImageDecoder`, reporting an honest `unknown` when the capability API is
  absent.
- Added image-sequence support: the Project schema gains an `image-sequence`
  asset kind with an optional frame manifest, validated by
  `PROJECT_IMAGE_SEQUENCE_FRAME_MISSING` / `PROJECT_IMAGE_SEQUENCE_FRAME_KIND_INVALID`;
  deterministic `imageSequenceFrameIndex` / `imageSequenceDurationUs` helpers
  and a builder `addImageSequenceClip()` register the asset and an image item.
- Added a diagnostic message localization layer in `@aelionsdk/core`:
  `DiagnosticCatalog`, `localizeDiagnostic` / `localizeDiagnostics`, and a
  default English catalog. The stable `code` and structured fields remain
  authoritative; unknown codes fall back to the original message.
- Added fast-check property tests for WAV export bytes invariants and
  transaction undo/redo round-trips, plus a 400-iteration long-session restart
  recovery soak that persists each edit through canonical serialization,
  re-admits and re-validates it as a fresh session, and replays the full
  session without drift. `test:soak` and the nightly CI include the soak.
- Added a software codec fallback contract in `@aelionsdk/capability`
  (`CodecFallbackProvider`, `CodecFallbackRegistry`, `selectCodecExecution`)
  that negotiates hardware first, then a ready provider, else fails closed with
  `CAPABILITY_CODEC_NO_BACKEND`. No WASM backend ships in 1.1.
- Added a device-matrix scaffold (`compatibility/device-matrix.json`) that
  records every profile's status and evidence checklist, with a capture script
  and `report:device-matrix` wiring in the nightly CI. Physical devices stay
  `pending-credentials` until their evidence checklist is complete.
- Added committed package-level README files for every public package, a
  release-document synchronization check, and a per-package TypeDoc narrative
  coverage baseline that rejects new undocumented public declarations.

### Changed

- CI quality job split into parallel `checks`, `docs` and `artifacts` jobs;
  the six Vitest configs share one `@aelionsdk/*` alias source derived from
  `tsconfig.base.json`.
- TypeDoc generation now removes its previous projection before every build,
  preventing duplicate content IDs and stale pages.
- Updated current-version CDN and Material engine-range examples, prerelease
  terminology and Trusted Publisher maintenance guidance.
- Documented the long-session operation guide in the resilience reference:
  what a service worker can and cannot do, and remote export as the durability
  ceiling for jobs that must outlive the page.

## 1.0.0-rc.1 — 2026-07-28

### Added

- Added a transactional `release:version` command that synchronizes all
  workspace manifests, exact public-package pins, curated current-version
  documentation, the pnpm lockfile and the SDK API snapshot, restoring the
  original tree when a generated step fails.
- Added explicit product, extension-author and advanced execution package
  stability tiers with a documented deprecation window.
- Added a versioned browser/device compatibility matrix, capability gates,
  privacy-safe diagnostic reports, bounded HTTP Range retries and a
  reproducible media corpus covering rotation, B-frames, non-zero PTS, VFR,
  long GOP, audio tails and sparse 30-minute sources.
- Added an explicit Project/Render IR color contract for primaries, transfer,
  matrix, range, chroma, alpha, tone mapping and bit depth. Unsupported
  wide-gamut/HDR combinations now fail closed; SDR exports carry explicit
  source metadata and have preview-versus-decoded-export pixel coverage.
- Added a runtime-verified audio export capability matrix for Opus/AAC at
  44.1/48/96 kHz and mono/stereo/5.1, plus a bounded 30-minute resumable export
  checkpoint and restart boundary test.
- Added Remote Export Protocol 1.0 negotiation, content-addressed assets,
  per-asset ephemeral authorization, progress/cancellation, idempotency and
  result byte/hash verification.
- Added `aelion-material` author tooling for scaffold/build/validate/type
  generation/Lab reports/Golden comparison/prepublish/deterministic packaging,
  and `aelion-migrate` for strict or explicitly lossy WebAV/Diffusion file
  migration with dry runs, entity maps and SHA-256 loss reports.
- Added Webpack 5/Rspack runtime-asset emission and explicit Next.js/CDN asset
  URL/copy helpers alongside the existing Vite plugin.

### Changed

- Release artifacts now derive their npm dist-tag and GitHub release kind from
  strict SemVer: prereleases use `next` and GitHub prerelease, while stable
  versions use `latest` and a full GitHub Release.
- CI now rejects drift between the root version, all 18 workspace packages,
  exact internal package pins and the curated current-version documentation.
- Release tarball consumers now execute the installed Material and migration
  bins, type-check both Node subpath APIs and verify every published bin target
  before browser smoke tests.

## 0.1.0-beta.1 — 2026-07-27

### Changed

- Renamed every public package from the unavailable `@aelion/*` namespace to
  the project-owned `@aelionsdk/*` npm organization before the first publish.
- Muxed exports can opt into Worker orchestration through the public Session
  `execution` option; AVC negotiation is cached, sequential source decoding
  reuses bounded decoder sessions, and semantically opaque single-source
  frames use a zero-copy render fast path.
- The built-in compositor background is now a GPU graph node instead of a
  per-frame CPU canvas upload, removing measured >50 ms main-thread work from
  the real-media export path.
- MP4/H.264 preflight now negotiates the smallest viable AVC level/profile for
  the actual dimensions and frame rate; the selected string is carried
  unchanged through Session, Worker/inline export, result metadata and
  external FFmpeg readback.
- WebGPU presentation keeps VideoFrame inputs and intermediate graph textures
  on the GPU and renders directly into an OffscreenCanvas presentation
  context, removing the former texture-to-buffer-to-CPU-to-Canvas hot path.
- The official Vite plugin now emits the Export Worker in addition to the
  Renderer Worker and both AudioWorklets; standard ESM/CDN hosts can provide
  all four URLs through `AelionSessionOptions.runtimeAssets`.
- Reorganized product documentation around getting started, capabilities, architecture, Material, compatibility, development and current status; retired duplicated phase goals, backlogs, exit reviews and ADR files from the active documentation set.
- Bound untrusted Project v1 input to 16,384 array entries and 4,096 properties per object before schema and semantic validation. The bundled Project schema now exposes the same Alpha safety budgets instead of advertising larger collections that the SDK cannot admit.
- Relicensed AelionSDK-owned code and all 13 public packages from Apache-2.0 to MIT and replaced placeholder repository metadata with `FoyonaCZY/AelionSDK`.
- Browser conformance now selects WebGPU only after a real adapter probe; transparent output assertions validate observable alpha-over results across headless platforms.

### Added

- Added atomically persisted, SHA-256-verified WebM cluster and fragmented MP4
  checkpoints through `exportResumableMuxed()`, with IndexedDB resume from the
  first missing unit and FFmpeg semantic evidence at 25%, 50% and 90%
  interruption points.
- Added deterministic streaming PCM resampling for 44.1/48/96 kHz and 1–8
  channels, plus a stateful pitch-preserving time stretcher whose overlap state
  survives arbitrary source block boundaries.
- Added strict Phase 3 evidence gates requiring at least 1.5× real-time 4K30
  decode→render→audio→encode→mux→sink, zero >50 ms main-thread Long Tasks,
  exact recovery hashes and at most 1 ms logical A/V end drift.
- Added capability-negotiated `mp4-av1-aac` and `mp4-hevc-aac` profiles across
  probe, preflight, inline/Worker export and the public Session facade.
- Added deterministic WSOLA-style pitch-preserving linear time-stretch via
  `pitchPolicy: 'preserve'`, with fail-closed validation for non-linear
  TimeMaps.
- Added display color/HDR capability reporting while retaining an explicit
  RGBA8 SDR local execution contract, plus a durable browser checkpoint store
  for independently committable export units.
- Added real-media 1080p/4K Session performance cases covering
  decode→render→audio→encode→mux→sink, strict WebGPU/incremental thresholds,
  MP4 FFmpeg readback, WebKit target smoke and a 390×844 touch/DPR smoke.
- Added a tarball consumer path that bundles runtime entries independently
  with esbuild and executes them through explicit non-Vite URLs.
- Added the product-level `Composition` / `Layer` / `Clip` authoring API for
  images, video, audio, text, captions, shapes, reusable Materials, effects,
  masks, keyframes and transitions, while preserving the same validated
  Project v1 output and a `ProjectBuilder` escape hatch.
- Added strict WebAV Sprite and Diffusion Studio Core checkpoint migration,
  including explicit asset rebinding, entity maps, renderable migration
  Materials and fail-closed diagnostics for semantics that cannot be
  represented without loss.
- Added persistent sequential/GOP WebCodecs decode sessions, bounded frame and
  image caches, first-class still-image decoding and whole-frame adaptive
  WebGL2/WebGPU frame graphs.
- Added Session-level waveform, loudness, true-peak, silence removal, ducking
  and limiter APIs; revision-bound IndexedDB persistence; isolated Worker
  extension RPC; Canvas pointer mapping and `captureStream()`.
- Added same-machine WebAV/Diffusion/Aelion benchmarks, browser/package
  consumers, release evidence binding and cross-platform API snapshots.
- Added the public `ProductionMediaProvider` for File/Blob, HTTP Range, OPFS and custom readers, including proxy-aware preview selection, content-addressed SampleIndex reuse, bounded resident indexes, decoder admission and deterministic disposal.
- Added a type-safe Project Builder with media probing/import, linked A/V clip creation and exact seconds/milliseconds/frame helpers, plus a latest-wins Preview Canvas Controller with bitmap ownership, DPR/resize handling, visibility lifecycle and adaptive quality.
- Added a production-built reference editor that imports only public packages and demonstrates import, scrub/playback, linked split/move, undo/redo and WebM or H.264 MP4 export. Its complete TypeScript integration example is compiled in CI.
- Preview now supports Draft/Full quality and explicit render scale, Player quality switching, actual output dimensions in frame results, and matching Session statistics; Export remains fixed at full Project resolution.
- Interactive transactions publish every drag update while coalescing the interaction into one undo entry, with commit/cancel lifecycle and cancel-without-redo semantics.
- Export results now report the exact codec/dimension/sample/channel/VBR target submitted to the encoders. OPFS reads wait for transferred WritableStream finalization instead of racing host-side close.
- Portable text regression now preserves explicit spacing and grapheme advances, covers CJK/emoji/RTL, and keeps complex RTL shaping on the browser text path.
- Added bounded Project/media fuzz gates and an accelerated production soak covering ten-minute PCM flow, 1,000-clip incremental compilation and 5,000 long-timeline evaluations; browser conformance continues to cover repeated Worker cancellation/release.
- Production editing commands now include ripple insert/remove, roll, slip, slide, linked groups, marker/range/selection metadata and nested Sequence subgraphs with atomic inverse/affected-range semantics.
- Render IR now has canonical curve/hold/reverse TimeMap evaluation and inversion, recursive automation, deterministic Text/Caption layout, SRT/WebVTT, Image/Generator/Adjustment clips, masks/mattes, 12 blend modes and explicit color/bit-depth contracts.
- Audio now supports sample-accurate gain/pan/fades, generic TimeMap varispeed, 1–8 channel matrices, ducking/sidechain, waveform peaks, LUFS/true-peak analysis, limiting and device/interruption recovery state.
- Export profiles now cover WebM, MP4, PNG/JPEG/WebP, GIF and WAV/RF64, with a WebM Export Worker, AAC runtime canary, checkpoint protocol and canonical provider-backed Remote Export exposed through `session.export.startRemote()`.
- Long-media infrastructure now includes segmented indexes, content-addressed CacheStore/OPFS LRU, proxy consistency, still/animated image adapters and a page-level decoder/GPU/cache resource governor.
- Material production tooling now includes Ed25519/ECDSA publisher trust and revocation, deterministic migrations, composition/fusion/adaptive quality, immutable catalog metadata and a headless Material Lab with Golden/package export.
- Product-facing Production Core documentation, compatibility boundaries, Core Node math specification and reproducible evidence mapping.
- Audio Track solo is now an explicit Project v1 mixer state with a validated `setTrackSolo` transaction command; shared Render IR audio evaluation applies identical solo/mute semantics to preview and export.
- Phase 1 tarball browser consumer、API snapshot compare 和全量门禁已完成；60 秒 Chromium evidence 已通过独立音视频回读。
- Material package paths now reject ill-formed Unicode before UTF-8 encoding, preventing archive-name collisions; invalid transport Map keys are rejected without invoking caller coercion hooks.

### Fixed

- Export preflight no longer trusts Chromium's AAC declaration alone; a real encode/flush canary converts runtime false positives into `EXPORT_AUDIO_CONFIG_UNSUPPORTED`.
- Browser certification files now run serially because GPU/context budgets are browser-global across tabs; same-page concurrency remains covered by explicit admission and release tests.
- WebGL2 composition checks context loss both before and after bitmap transfer and retries bounded context admission with a stable timeout diagnostic.
- Clean GitHub Actions browser jobs now build workspace exports before testing and resolve every `@aelionsdk/*` test import through source aliases.
- Hermetic tarball consumers inherit the repository's exact `pnpm@10.13.1` package-manager pin, preventing Corepack from selecting an incompatible pnpm release under Node.js 20.
- Render IR presentation normalizes the public `ImageBitmap` to straight alpha, avoiding double premultiplication on Linux headless Chromium/ANGLE paths.
- Browser CI follows the certified platform boundary: Chromium runs on Ubuntu, while Firefox 54/54 and the two-browser tarball consumer run on macOS Intel where Worker WebGL2, H.264/AAC and the null audio backend are available.

## 0.1.0-alpha.0 candidate baseline — 2026-07-13

> 这是 2026-07-13 的历史候选快照，不是 npm、Tag 或 GitHub Release。下面的
> Compatibility 与 Known limitations 记录当时基线，已由上方 Unreleased 变更和
> 当前状态页取代，不能当作当前能力表。

### Added

- Project v1 Schema、normalized entity map、整数微秒/有理帧率、canonical JSON 和稳定 validator diagnostics。
- 原子 Transaction/revision/inverse/ChangeSet、bounded undo/redo，以及 insert/remove/move/trim/split/replace、Track reorder/lock/enabled/mute 语义命令。
- MP4/H.264/AAC 与 WebM/VP9/Opus 的统一 SampleIndex、Range reader、exact seek、VideoFrame 与 PCM decode。
- 共享 Render IR、Worker WebGL2/WebGPU Material compositor，以及按 Project 顺序执行的多轨 premultiplied normal alpha-over。
- AudioWorklet 主时钟、视频追随、seek generation、有界 SharedArrayBuffer/Transferable PCM、Track mute 与 loop time-mapping mixer。
- frozen Render IR 的 WebCodecs VP9/Opus 流式 WebM 导出、preflight、进度/取消、Writable/Memory/OPFS Sink、背压与 partial cleanup。
- Aelion Material Protocol、Core Node Graph compiler、Cross Dissolve/Warm Film/Soft Glow 示例与 Preview/Export 执行链。
- `@aelionsdk/material-sdk` typed Definition/Graph builders、静态校验、canonical manifest、逐文件 SHA-256、确定性 `.aelionmat` ZIP、精确 Registry/Resolver 和 trusted-code publisher allowlist。
- `@aelionsdk/sdk` 统一 Session facade，覆盖 Project load、Transaction/history、Player、Preview、Export、Capability、Material runtime 和有界 `ByteMediaProvider`。
- 13 个 MIT 公开 `@aelionsdk/*` 包具备 ESM exports、`.d.ts`、npm metadata、LICENSE/README staging；第 13 个包 `@aelionsdk/vite-plugin` 提供公开的 Vite Worker/AudioWorklet 资源集成。
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
- Vite 应用必须显式启用公开 `@aelionsdk/vite-plugin`；其他 bundler 尚无认证适配器。
