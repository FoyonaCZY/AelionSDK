---
title: 当前已经支持什么
description: 按开发者会用到的功能查看编辑、预览、媒体、音频、导出和 Material 的完成情况。
---

本页回答两个问题：现在能用 AelionSDK 做什么，以及哪些地方还不能当作跨平台承诺。具体类型以 [`@aelion/sdk` API Snapshot](https://github.com/FoyonaCZY/AelionSDK/blob/main/packages/sdk/api-snapshot.md) 和站内 API Reference 为准。

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

完整最短示例见[从本地视频到 MP4](/AelionSDK/start/getting-started/)。

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
- TimeMap 支持线性速度、反向、hold/freeze 和分段曲线；
- Preview、seek、音频和 Export 使用同一套素材时间映射；
- Automation 支持 step、linear 和 cubic-bezier；
- 标量和 JSON vector/object 可以递归插值；
- 曲线区间外支持 hold、cycle 和 ping-pong；
- Nested Sequence 会检查循环引用。

音频变速目前是 varispeed：速度改变时音高也改变。当前没有“保持音高”的 time-stretch，这一点不能只靠 UI 参数补上。

## 画面合成、文字和颜色

- 多条 visual 轨按 Project 顺序合成；
- WebGL2 和 WebGPU 共享 12 种 blend mode 定义；
- 支持 alpha/luma mask、invert、feather 和 consumed matte；
- 支持文字和字幕布局、Unicode grapheme、CJK 换行、RTL shaping 路径、auto-fit、SRT/WebVTT；
- 字体加载有数量、字节和生命周期上限；
- Generator 支持纯色和线性渐变；
- Adjustment 可以作用于已经合成的下层画面；
- 支持嵌套 Sequence、图片和 animated image 适配。

当前本地画面管线是 RGBA8 SDR。P3 可以进入线性工作空间，但 PQ、HLG、10-bit 和 HDR 输出会在 renderer/export preflight 中明确拒绝，不会偷偷转成 SDR。

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
- 与画面相同的 TimeMap 和 Automation 时间；
- Sidechain ducking 的 lookahead、attack/release；
- 可取消的 waveform min/max/RMS；
- EBU-style gated LUFS、4× true-peak estimate 和 lookahead limiter；
- 音频设备切换、interruption 和恢复状态机。

基础播放通过 Session Player 使用；音频分析和底层处理接口位于 `@aelion/audio`。

## 媒体输入和缓存

- MP4/H.264/AAC 与 WebM/VP9/Opus 的容器索引、seek、VideoFrame 和 PCM decode；
- 支持 MP4 moov 在头/尾、fragmented MP4、B-frame、非零 PTS 和 WebM VFR 固定语料；
- 损坏、截断和随机输入会有上限地失败；
- SampleIndex 有 resident LRU，也可以注入持久 CacheStore；
- 原片和 proxy 按用途选择，时长不一致时回退 original 并产生诊断；
- 页面级资源 Governor 控制 decoder、GPU 和 cache 预算；
- SegmentedIndex 支持长媒体按时间段加载。

`ByteMediaProvider` 只适合短媒体。产品代码应优先使用 `ProductionMediaProvider`。

## 导出

| 输出 | 当前格式        | 备注                                       |
| ---- | --------------- | ------------------------------------------ |
| 视频 | VP9/Opus WebM   | Worker/inline，流式 mux                    |
| 视频 | H.264/AAC MP4   | 必须通过 codec 检查和 AAC runtime canary   |
| 静帧 | PNG、JPEG、WebP | 指定时间点                                 |
| 动图 | GIF             | 当前按完整 Sequence                        |
| 音频 | PCM WAV、RF64   | s16/f32，大文件用 OPFS                     |
| 远程 | 自定义 Provider | canonical manifest、幂等、鉴权、进度、取消 |

导出支持 preflight、冻结 revision、进度、取消、背压和半成品清理。连续 MP4/WebM 文件中途失败后从 profile 起点重启；当前不声称能从任意容器位置继续。

## Material

Material 可以表达 Filter、Transition、Effect 和 Generator。默认方式是由标准 Core Node 组成的声明式 Graph；可以校验、编译到 WebGL2/WebGPU、打包、签名、安装和迁移。

Shader、WASM 和网络访问默认没有执行权限。签名只证明发布者和内容完整，宿主仍要按 publisher、租户和执行预算授权。

从实际 builder 开始见 [Material 创作与接入](/AelionSDK/guides/materials/)。

## 当前不能直接承诺的范围

- 目前自动化重点是桌面 Chromium 和 Firefox；Safari、iOS、Android 未认证；
- 4K 可以离线探测和导出，但没有跨设备 4K30 实时预览保证；
- HDR/10-bit 尚未实现；
- 音频变速不保音高；
- 非 Vite bundler 还没有官方适配和认证；
- 公开包尚未发布 npm，版本仍是 alpha；
- API 可能变化，Project/Material 协议变化必须配迁移。

浏览器和平台细节见[兼容性与部署](/AelionSDK/production/compatibility/)。
