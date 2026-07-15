# Production Core Guide

本文描述 `0.1.0-alpha.0 + Unreleased` 源码树已经实现的剪辑与渲染核心，以及接入方必须显式处理的能力差异。它不构成 npm 发布、1.0 API 稳定或新增平台认证。

## 编辑与时间

`EditingCommands` 提供 insert/remove/move/trim/split/replace、ripple insert/remove、roll、slip、slide、link/unlink/group move、Marker range 与 selection metadata。每个命令通过一个 Transaction 提交，成功时同时生成 revision、inverse 和 affected ranges；校验、IR preparation 或 observer 重入失败时 Project、history 与 Render IR 都不发布部分状态。

Item 的 `timeMapping` 支持 linear、reverse、hold/freeze 与分段 curve。Curve 可包含 linear、hold、cubic 段；编译器会验证端点和单调段，并提供正向求值及多解情况下带方向提示的求逆。视频 seek、音频采样、Preview 和 Export 使用同一个 Render IR 映射。音频的 Project v1 `pitchPolicy` 为显式 `varispeed`：速度和方向改变时，音高随 source time 确定性变化；本版本不把保音高算法伪装成已实现。

Automation 支持 step、linear、cubic-bezier，标量和 JSON vector/object 递归插值，sequence/item time，以及 hold/cycle/ping-pong 的 pre/post infinity。

Nested Sequence 会在 Project validation 阶段检查引用和循环，编译为 `RenderIr.subgraphs`，递归渲染仍使用相同 TimeMap、Material 和资源边界。

## 图像、文字与颜色

- Text/Caption 使用 portable deterministic metrics、grapheme line break、auto-fit 和竖排 fallback；SRT/WebVTT 可双向转换，SRT 无法保存 cue setting 时返回 warning。
- `BrowserFontManager` 对显式字体资源执行数量/字节预算、加载、fallback 检查和卸载。需要像素复现的 Export 应注册字体并用 `requireAvailable()` fail closed，不能依赖未知系统字体。
- Project v1 的 12 种 blend mode 在 WebGL2/WebGPU 共用编号和公式；alpha/luma mask 支持 invert、feather、source/canvas 空间声明及 consumed matte。
- Sequence background 是显式不透明/透明 canvas layer；Generator 支持 solid/linear-gradient，Adjustment 对已合成内容执行 Material stack。Blur fill 由“cover 背景副本 + `blur.gaussian` Material + contain 前景”组合，不需要特殊不可迁移 Item 类型。
- Image 与 animated image adapter 保留方向、颜色描述、帧时长、循环和取消语义。
- Render IR 明确携带 working color space、transfer function 和 8/10-bit contract。当前本地 Canvas/WebCodecs 路径只执行 RGBA8 SDR；P3 working space可进入线性处理，但 PQ/HLG/10-bit/HDR presentation 会在 renderer/export preflight fail closed，而不是静默降为 SDR。

## 音频

Render IR mixer 逐 sample 计算 clip/track gain、equal-power pan、fade、mute/solo 与最多 8 声道 matrix。任意 TimeMap（含 curve、reverse、freeze）按同一 source-time 函数请求 PCM，并在 block 边界保持确定性。

`@aelion/audio` 还提供：

- 有 lookahead/attack/release 和可报告 latency 的 `SidechainDucker`；
- 分块、可取消、点数有界的 waveform min/max/RMS 生成；
- EBU-style gated LUFS、4× true-peak estimate 与 lookahead limiter；
- `AudioRuntimeStateMachine` 的 device switch、interruption、resume/recovery 和有界 diagnostics。

## Media、Cache 与资源治理

`SegmentedIndex` 按时间段 single-flight 加载并限制 resident segment；`CacheStore` 的 address 包含 namespace、content identity、version 和 variant。`OpfsCacheStore` 使用内容寻址文件、持久 index、storage quota、字节预算、LRU eviction 和显式 clear。

Proxy selection 会校验 source/proxy duration，一致时保持 presentation time，不一致时诊断并回退 original。`PageMediaResourceGovernor` 对 decoder slots、GPU bytes 和 cache bytes 统一 admission，支持 export/preview/background priority、取消、公平排队、队列上限和 lease 释放。

这些组件用于 range-backed host provider；`ByteMediaProvider` 仍是完整读入小媒体的 convenience provider，不应被当作 CDN 大文件实现。

## Export

本地 profiles：WebM/VP9/Opus、MP4/H.264/AAC、PNG/JPEG/WebP still、GIF 和 WAV/RF64。所有 SDK profile 从调用时冻结同一个 Project/Render IR revision，使用同一个 frame renderer/audio mixer、Writable sink、进度、取消与 partial cleanup。

WebM 默认把 encoder orchestration、mux 和 sink backpressure 放入 Dedicated Worker；host 只响应有界 frame/PCM 请求。Chromium 当前会宣称 Worker AAC 可用但在编码时失败，因此 MP4 默认 inline，并在 preflight 中执行真实 AAC canary；显式 `execution: 'worker'` 仍为 opt-in。这个差异是 capability/fallback，不是静默换格式。

`session.export.startRemote()` 提交 canonical frozen Project manifest，按 profile + revision + manifest SHA-256 生成 content ID 和默认 idempotency key，并统一鉴权、进度单调性、取消、结果 identity 与失败 cleanup。`runCheckpointedExport()` 以原子 unit checkpoint 恢复 still/GIF/分段业务输出；连续 WebM/MP4 本地文件失败后按 profile 重新开始，不声称容器中点恢复。

## Material 生产链

Material 包支持 Ed25519/ECDSA publisher signature、TrustStore、revocation、安装审计、immutable catalog/deprecation、纯数据 protocol/package/definition/node migration、slot/order composition、pass fusion、cache key 和 adaptive quality。

声明式 Core Node 仍是默认安全边界。网络、Shader、WASM 需要 execution policy 显式授权；签名本身不会自动获得代码执行权限。`MaterialLabSession` 覆盖参数、时间、输入、双后端编译、pass/texture budget、GPU timing ring、Golden diff 与 deterministic package export。

Core Node 公式和容差见 [Core Node Math v1](../reference/core-node-math-v1.md)。

## 运行门禁

生产集成至少执行：

```bash
corepack pnpm run ci
corepack pnpm test:browser
corepack pnpm test:browser:firefox
corepack pnpm test:golden
corepack pnpm report:performance
```

浏览器文件按串行认证，避免多个测试 tab 争抢浏览器全局 GPU context；同页并发、取消、backpressure、multi-instance admission 和 release 由独立测试覆盖。
