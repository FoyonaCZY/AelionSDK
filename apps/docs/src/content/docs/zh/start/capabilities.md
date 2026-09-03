---
title: 当前已经支持什么
description: 按开发者会用到的功能查看编辑、预览、媒体、音频、导出和 Material 的完成情况。
---

本页回答两个问题：现在能用 AelionSDK 做什么，以及哪些地方还不能当作跨平台承诺。具体类型以 [`@aelionsdk/sdk` API Snapshot](https://github.com/FoyonaCZY/AelionSDK/blob/main/packages/sdk/api-snapshot.md) 和站内 API Reference 为准。

## 做一个基础剪辑器

下面这条接入路径已经存在，并在 Quickstart 和参考编辑器中实际使用：

```text
File / URL / OPFS
  → 创建 Project
  → 加载 Session
  → Canvas 预览与播放
  → 编辑命令 + Undo/Redo
  → MP4 / WebM / 图片 / GIF / WAV 导出
```

可以直接使用：

- Project Builder 创建空工程、轨道、Asset、媒体片段和 Marker；
- `ProductionMediaProvider` 读取 File、Blob、HTTP Range、OPFS 和自定义 RangeReader；
- `attachPreviewCanvas()` 显示首帧、拖动和播放画面；
- Player 控制 play、pause、seek、scrub 和预览画质；
- Transaction Commands 修改时间线；
- Session events 驱动 UI、自动保存、诊断和统计；
- 本地或远程导出。

完整最短示例见[从本地视频到 MP4](/AelionSDK/zh/start/getting-started/)。

## 时间线编辑

| 操作                   | 已有命令                                                                 |
| ---------------------- | ------------------------------------------------------------------------ |
| 插入、移除、移动、替换 | `insertItem`、`removeItem`、`moveItem`、`replaceItem`                    |
| 裁剪和切分             | `trimItem`、`splitItem`                                                  |
| Ripple                 | `rippleInsertItem`、`rippleRemoveItem`                                   |
| 专业修剪               | `rollEdit`、`slipItem`、`slideItem`                                      |
| 音视频联动             | `linkItems`、`moveLinkedGroup`、`trimLinkedGroup`、`splitLinkedGroup` 等 |
| 轨道                   | 排序、enabled、locked、mute、solo                                        |
| Marker                 | 添加、更新、删除；可属于 Sequence 或 Item                                |

每次命令都会校验引用、轨道类型、锁定状态、时间、source handle、Transition 和 revision。成功后可以 Undo/Redo。拖拽和滑块使用 `beginInteractive()`，中间实时更新，最后只保留一条撤销记录。

## 时间、变速和关键帧

- API 使用整数微秒，帧率使用有理数；
- TimeMap 支持线性速度、反向、hold/freeze 和分段曲线（可用 `buildRateEnvelope` 把速率包络编译为等价的曲线点）；
- Preview、seek、音频和 Export 使用同一套素材时间映射；
- Automation 支持 step、linear 和 cubic-bezier；
- 标量和 JSON vector/object 可以递归插值；
- 曲线区间外支持 hold、cycle 和 ping-pong；
- Nested Sequence 会检查循环引用。

线性 TimeMap 默认仍是 varispeed；音频 Clip 可以设置
`pitchPolicy: 'preserve'`，使用确定性的 WSOLA overlap-add 保持音高。非线性
TimeMap 无法用单一 stretch ratio 表达，会在 Project validation 阶段拒绝该策略。

## 画面合成、文字和颜色

- 多条 visual 轨按 Project 顺序合成；
- WebGL2 和 WebGPU 共享 12 种 blend mode 定义；
- 支持 alpha/luma mask、invert、feather 和 consumed matte；
- 支持文字和字幕布局、Unicode grapheme、CJK 换行、RTL shaping 路径、auto-fit、SRT/WebVTT 导入导出和静音感知对齐；
- 字体加载有数量、字节和生命周期上限；
- Generator 支持纯色和线性渐变；
- Adjustment 可以作用于已经合成的下层画面；
- 支持嵌套 Sequence、图片和 animated image 适配。

Project/Render IR 可以显式描述 BT.709、Display-P3、BT.2020、PQ、HLG、range、chroma、alpha、tone mapping 和 8/10-bit。当前本地执行契约仍只有 sRGB-linear / BT.709 / RGBA8 SDR；P3、BT.2020、PQ、HLG、10-bit、HDR 和尚未实现的 tone mapping 会在 renderer/export preflight 中明确拒绝，不会偷偷改成另一套颜色语义。

## 预览和播放

`attachPreviewCanvas()` 已处理：

- 快速拖动时只保留最新请求；
- Canvas DPR 和 ResizeObserver；
- 自适应、draft 和 full 画质；
- 页面隐藏时暂停；
- Player 帧订阅和 ImageBitmap 关闭；
- WebGL2/WebGPU backend 选择和 Renderer Worker；
- context lost、generation 和有上限的请求队列。

有声音时 AudioWorklet 是主时钟，视频跟随实际 PCM 消费进度。页面跨源隔离时使用 SharedArrayBuffer ring；否则使用有界 transferable queue。

## 音频处理

- 多轨 PCM 混音；
- Item/Track gain、equal-power pan、fade、mute/solo；
- 最多 8 声道 channel matrix；
- 44.1/48/96 kHz、1–8 声道的确定性流式重采样，任意 PCM 分块产生相同输出；
- `probeAudioExportMatrix()` 对 Opus/AAC 的 44.1/48/96 kHz、mono/stereo/5.1 组合同时执行配置探测和真实 encode/flush canary；
- 跨 PCM 块保持 overlap 状态的线性保音高变速；
- 与画面相同的 TimeMap 和 Automation 时间；
- Sidechain ducking 的 lookahead、attack/release；
- 可取消的 waveform min/max/RMS；
- EBU-style gated LUFS、4× true-peak estimate 和 lookahead limiter；
- 音频设备切换、interruption 和恢复状态机。

`StreamingPcmResampler` 用整数相位避免长时间浮点累积；最终 flush 后，输入与输出
时长误差小于 1 ms。`StreamingPitchPreservingTimeStretch` 保留跨块输入与
overlap 状态，适合自定义音频宿主按小块连续拉取。

基础播放通过 Session Player 使用；产品层的分析、波形、静音移除、节拍检测（`analyzeBeats`）、
场景边界检测（`analyzeScenes`，基于音频能量突变）和母带通过
`session.audio` 使用。只有自定义音频宿主或处理链时才需要直接依赖
`@aelionsdk/audio`。

## 媒体输入和缓存

- MP4/H.264/AAC、MOV/H.264/AAC、MKV/H.264/AAC、MPEG-TS/H.264/AAC 与 WebM/VP9/Opus 的容器索引、seek、VideoFrame 和 PCM decode；
- AVIF/JPEG/PNG/WebP 静帧解码；图像序列建模为 `image-sequence` 素材，通过帧映射确定性采样；
- 支持 MP4 moov 在头/尾、fragmented MP4、B-frame、非零 PTS、MOV、MKV、MPEG-TS 和 WebM VFR 固定语料；
- 损坏、截断和随机输入会有上限地失败；
- SampleIndex 有 resident LRU，也可以注入持久 CacheStore；
- 原片和 proxy 按用途选择，时长不一致时回退 original 并产生诊断；支持通过注入的编码器自动注册低分辨率代理（`registerAutomaticProxy`）；
- 页面级资源 Governor 控制 decoder、GPU 和 cache 预算；
- SegmentedIndex 支持长媒体按时间段加载。

`ByteMediaProvider` 只适合短媒体。产品代码应优先使用 `ProductionMediaProvider`。

## 导出

| 输出 | 当前格式        | 备注                                                      |
| ---- | --------------- | --------------------------------------------------------- |
| 视频 | VP9/Opus WebM   | Worker/inline，流式 mux                                   |
| 视频 | H.264/AAC MP4   | 必须通过 codec 检查和 AAC runtime canary                  |
| 视频 | AV1/AAC MP4     | capability/preflight 支持时启用                           |
| 视频 | HEVC/AAC MP4    | capability/preflight 支持时启用                           |
| 静帧 | PNG、JPEG、WebP | 指定时间点                                                |
| 动图 | GIF             | 当前按完整 Sequence                                       |
| 音频 | PCM WAV、RF64   | s16/f32，大文件用 OPFS                                    |
| 远程 | Provider v1     | 协商、内容寻址素材、短期鉴权、幂等、进度、取消、结果 hash |

H.264 会按尺寸/帧率自动协商 AVC profile/level；AV1 与 HEVC 也使用精确 codec
configuration 做能力门控。导出支持 preflight、冻结 revision、进度、取消、背压和
半成品清理。`exportResumableMuxed()` 将 MP4/WebM 按完整帧边界写成带 SHA-256 的独立单元，
可用 `IndexedDbResumableMuxedExportStore` 跨刷新从第一个缺失单元继续；30 分钟任务的
有界 checkpoint/restart 已进入浏览器回归。远程 Provider 先协商协议/profile/素材预算，
再按 content ID 与 idempotency key 恢复或去重。

## Material

Material 可以表达 Filter、Transition、Effect 和 Generator。默认方式是由标准 Core Node 组成的声明式 Graph；可以校验、编译到 WebGL2/WebGPU、打包、签名、安装和迁移。WebGL2 与 WebGPU 编译器共享完整的单 pass 节点集；多 pass 的 `blur.gaussian` 图在 WebGL2 上编译、在 WebGPU 上失败关闭（WebGPU 尚无多 pass 管线）。

Shader、WASM 和网络访问默认没有执行权限。签名只证明发布者和内容完整，宿主仍要按 publisher、租户和执行预算授权。

从实际 builder 开始见 [Material 创作与接入](/AelionSDK/zh/guides/materials/)。

## 当前不能直接承诺的范围

- 自动化覆盖 Chromium、Firefox、Playwright WebKit 公共合约和移动触控目标；
  Safari、iOS、Android 实体设备仍未认证；
- 4K 可以离线探测和导出，但没有跨设备 4K30 实时预览保证；
- HDR/10-bit 尚未实现；
- 保音高策略只支持线性 TimeMap；
- Vite、Webpack 5/Rspack 有构建适配器；Next.js 与 CDN 采用显式、版本一致的 runtime asset URL，仍需在最终部署做 200/MIME/CSP 验证；
- 公开包通过 npm `latest` tag 发布，当前版本是 2.0 正式版；
- 公开 API 变更遵循 SemVer；Project/Material 协议变化必须配迁移。

浏览器和平台细节见[兼容性与部署](/AelionSDK/zh/production/compatibility/)。
