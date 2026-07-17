---
title: 能力全景
description: AelionSDK 当前已经实现的编辑、渲染、音频、媒体、导出和 Material 能力。
---

本页描述当前源码中的产品能力和明确边界。公开 API 的精确类型以 [`@aelion/sdk` declaration snapshot](https://github.com/FoyonaCZY/AelionSDK/blob/main/packages/sdk/api-snapshot.md) 为准。

## 工程与编辑模型

- Project v1 是 normalized、可版本化、可 canonical serialize 的 JSON snapshot。
- 所有实体使用稳定 ID；顺序只存在于显式 ID list，不依赖对象属性顺序。
- Transaction 是唯一写入入口，提供 revision conflict、原子校验、inverse、ChangeSet 和最小 affected ranges。
- History 以成功事务为单位执行有界 undo/redo；`beginInteractive()` 把拖拽/调参的连续更新合并为一个历史项，`cancel()` 可回到交互开始前且不留下 redo。
- Project 不保存媒体 bytes、帧、波形、缓存、undo 栈或任意可执行代码。

### 时间线编辑

| 类型            | 命令                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| 基础            | `insertItem`、`removeItem`、`moveItem`、`trimItem`、`splitItem`、`replaceItem`                            |
| Ripple/三点编辑 | `rippleInsertItem`、`rippleRemoveItem`、`rollEdit`、`slipItem`、`slideItem`                               |
| 关联编辑        | `linkItems`、`unlinkItems`、`moveLinkedGroup`、`trimLinkedGroup`、`splitLinkedGroup`、`removeLinkedGroup` |
| Track           | `reorderTrack`、`setTrackLocked`、`setTrackEnabled`、`setTrackMuted`、`setTrackSolo`                      |
| 标记与选择      | `addMarker`、`updateMarker`、`removeMarker`、range/selection metadata                                     |

命令在一个 Transaction 中提交。Track lock、引用完整性、Transition ownership、LinkGroup 和 revision 都在发布新 Project/Render IR 前验证。复杂字段级改动可以使用 `transaction.edit()`，但它不替代语义命令的业务约束。

## 时间、变速与动画

- 对外时间统一为非负安全整数微秒；帧率使用有理数，避免累计帧时长取整误差。
- TimeMap 支持 linear、reverse、hold/freeze 和分段 curve，并提供正向求值与带方向提示的求逆。
- Preview、音频采样、seek 和 Export 使用同一个 source-time 映射。
- Automation 支持 step、linear、cubic-bezier，标量和 JSON vector/object 递归插值。
- pre/post infinity 支持 hold、cycle 和 ping-pong。
- Nested Sequence 在校验阶段拒绝循环引用，并编译为 Render IR subgraph。

音频变速当前使用显式 `varispeed`：速度和方向改变时音高随之变化；不声称已经实现保音高 time-stretch。

## 画面、文字与颜色

- 多视觉轨按 Project 顺序做 premultiplied alpha 合成。
- WebGL2/WebGPU 共用 12 种 blend mode 编号和公式。
- alpha/luma mask 支持 invert、feather、source/canvas 空间和 consumed matte。
- Text/Caption 提供 deterministic metrics、显式空格和 letter spacing、Unicode grapheme、CJK 换行、RTL shaping 路径、auto-fit、竖排 fallback、SRT/WebVTT 转换。
- `BrowserFontManager` 对字体数量、字节、加载、fallback 和卸载执行预算；像素复现应显式注册字体资源。
- Generator 支持 solid/linear-gradient；Adjustment 对已合成内容应用 Material stack。
- Nested Sequence、显式透明/不透明背景和 image/animated-image adapter 已进入共享 IR。
- 当前本地执行路径为 RGBA8 SDR。P3 working space 可进入线性处理；PQ/HLG/10-bit/HDR presentation 会在 renderer/export preflight 拒绝。

## 音频

- AudioWorklet 驱动有声播放主时钟，视频跟随音频进度。
- mixer 逐 sample 计算 clip/track gain、equal-power pan、fade、mute/solo 和最多 8 声道 matrix。
- TimeMap、Automation 和 Preview/Export 共享 sample-time 语义。
- `SidechainDucker` 提供 lookahead、attack/release 和 latency 报告。
- waveform 生成支持分块、取消、点数预算以及 min/max/RMS。
- 提供 EBU-style gated LUFS、4× true-peak estimate 和 lookahead limiter。
- `AudioRuntimeStateMachine` 管理 device switch、interruption、resume/recovery 和诊断上限。

## 媒体与资源治理

- `ProductionMediaProvider` 直接接入 File/Blob、HTTP Range URL、OPFS 和自定义 `RangeReader`；Preview 按输出尺寸选 proxy，Export 强制 original。
- SampleIndex 同时有有界 resident LRU 与可注入的内容寻址 `CacheStore`，相同 SHA-256/variant 可跨 Provider 实例复用。
- MP4/H.264/AAC 和 WebM/VP9/Opus 的 SampleIndex、同步样本定位、exact seek、VideoFrame 与 PCM decode。
- 固定真实语料覆盖 MP4 moov head/tail、fragmented MP4、B-frame、非零 PTS 和 WebM VFR；截断、损坏及随机有界输入必须 fail closed。
- `SegmentedIndex` 按时间段 single-flight 加载，并限制 resident segment。
- 内容寻址 `CacheStore`/OPFS cache 使用 namespace、content identity、version 和 variant 组成地址，支持 quota、LRU 和 clear。
- Proxy selection 校验 source/proxy duration，不一致时诊断并回退 original。
- image/animated-image adapter 保留方向、颜色描述、帧时长、循环和取消语义。
- `PageMediaResourceGovernor` 统一管理 decoder slot、GPU bytes 和 cache bytes，支持优先级、公平排队、取消和 lease 释放。

`ByteMediaProvider` 是短媒体 convenience provider。长视频、CDN 和大文件使用 `ProductionMediaProvider`，并按业务注入 proxy、持久 CacheStore 与共享 `PageMediaResourceGovernor`。

## Preview、Player 与渲染

- `attachPreviewCanvas()` 提供 latest-wins scrub、DPR/ResizeObserver、bitmap ownership、页面隐藏策略和自适应预览质量，可直接作为上层剪辑 UI 的画布控制器。
- Project 编译为 frozen Render IR；Preview、Player 和 Export 共享节点语义。
- Preview 支持 `quality: 'draft' | 'full'` 和 `(0, 1]` 的 `renderScale`；降采样发生在文字、Generator、变换、Material 与合成之前，不是对全尺寸结果做事后缩放。Export 始终使用 1.0。
- Player 可通过 `setPreviewQuality()` 切换播放/seek/scrub 的预览策略，当前策略和实际比例进入 `getStats()`。
- renderer 在 Dedicated Worker 中运行 WebGL2/WebGPU compositor，并复用 GPU pipeline 与资源。
- bounded queue、generation、AbortSignal 和 context-lost recovery 防止过期工作泄漏。
- Frame 所有权显式转移给调用方，`ImageBitmap` 必须关闭。
- Capability 选择 backend；不支持的 blend、color contract 或 Material 不会静默当作普通画面渲染。

## 导出

| 输出      | 当前实现                                                             |
| --------- | -------------------------------------------------------------------- |
| WebM      | VP9/Opus、Worker/inline、流式 mux、Writable/OPFS Sink                |
| MP4       | H.264/AAC、capability + AAC runtime canary，必要时 inline            |
| Still     | PNG、JPEG、WebP                                                      |
| Animation | GIF                                                                  |
| Audio     | WAV、RF64                                                            |
| Remote    | canonical frozen manifest、content ID、idempotency、鉴权、进度和取消 |

导出支持 profile preflight、冻结 revision、背压、进度、取消、partial cleanup 和 checkpoint unit。WebM/MP4 结果返回提交给编码器的 codec、尺寸、采样率、声道和 VBR target；target 不是输出文件的实测平均码率。`OpfsSeekableSink.getFile()` 会等待 transferred stream 真正 close 后再读取。连续 WebM/MP4 文件失败后从 profile 起点重启，不宣称容器中点恢复。

## Material

Material 统一表达 Filter、Transition、Effect 和 Generator：

- 默认安全路径是 typed declarative Graph；
- Package、Definition、Graph、Instance 分别承担分发、能力、执行和工程参数；
- Authoring SDK、Composition、Catalog、migration、deterministic package export 和 Material Lab 已实现；
- 支持 Ed25519/ECDSA publisher signature、TrustStore、revocation 和安装审计；
- Shader、WASM、网络访问需要宿主 execution policy 显式授权，签名不会自动赋予执行权限。

接入步骤见 [Material 创作](/AelionSDK/guides/materials/)，协议见 [Material Protocol v1](/AelionSDK/reference/material-protocol-v1/)。

## 运行边界

- 桌面 Chromium/Firefox 是当前自动化验证范围；其他平台需独立认证。
- 4K compositor 有离线 probe，没有跨设备 4K30 实时保证。
- 大型输出必须使用流式 Sink；内存 Sink 只适合有明确字节上限的任务。
- 浏览器暴露 API 不等于 codec/backend 可用；始终执行 capability probe 和 export preflight。
- Alpha API 仍可能变化，Project/Material 公共协议变更必须提供迁移策略。
