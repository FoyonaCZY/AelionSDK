# AelionSDK `0.1.0-alpha.0` 兼容性矩阵

> 更新日期：2026-07-13  
> 发布状态：Phase 1 Alpha 候选，60 秒证据已完成；最终 tarball browser consumer、API snapshot 与全量门禁完成前不构成正式发布认证  
> 范围依据：[ADR-011](../adr/011-phase-0-certified-scope.md) 与 [Phase 1 Goal](../GOAL-PHASE-1.md)

## 1. 如何阅读

Aelion 的“支持”表示固定浏览器、操作系统、输入/输出配置和自动场景形成了完整证据，不表示只要浏览器暴露某个 API 就兼容。

- **Tier A**：Alpha 主路径。核心链路、默认 backend、诊断和资源门禁均需通过；
- **Tier B**：可用 Alpha 路径。核心链路通过，但存在明确且可探测的能力差异；
- **Uncertified**：未完成产品级实测。它既不等于支持，也不等于不支持；上层不得推断；
- **Unsupported**：已实测或 preflight 明确拒绝的组合。本矩阵不会把 uncertified 写成 unsupported。

每次 Session 仍应调用 `probeCapabilities()`，每次 Export 仍应调用 `preflight()`。Tier 是认证边界，不能替代当前设备的配置级探测。

## 2. 浏览器矩阵

| 平台 | Alpha 等级 | 已固定的参考环境 | 当前结论 |
|---|---|---|---|
| 桌面 Chromium | Tier A candidate | Chrome 149、macOS、secure context、cross-origin isolated | 源码链路与 60 秒 Project/export/readback 通过；以 WebGL2 为默认实时 backend。最终 `.tgz` browser consumer 与全量门禁仍是发布门禁 |
| 桌面 Firefox | Tier B candidate | Firefox 140、macOS、secure context、cross-origin isolated | WebGL2、WebCodecs、AudioWorklet、OPFS 与 VP9/Opus 路径可用；WebGPU 与 File System Access 不作为要求。最终 `.tgz` browser consumer 与全量门禁仍是发布门禁；60 秒全导出不是 Firefox Tier B 的单独要求 |
| 桌面 Safari | Uncertified | 无批准的自动化/真机报告 | 不宣称支持；Phase 0 的 WebKit 下载 blocker 和未开启 Safari Remote Automation 都不是通过证据 |
| iOS / iPadOS Safari | Uncertified | 无真机报告 | 不推断桌面 Safari 或 WebKit 结果；前后台、AudioContext interruption、内存和导出均待认证 |
| Android Chromium / WebView | Uncertified | 无真机报告 | 不推断桌面 Chromium 结果；codec、GPU、内存、存储和后台策略均待认证 |

本版本没有对 Windows、Linux 或不同 GPU/driver 组合形成独立认证矩阵。桌面 Chromium/Firefox 的 Tier 结论当前绑定上述 macOS 参考环境；其他桌面环境必须以 capability/preflight 结果和接入方测试为准。

## 3. 认证能力范围

| 能力 | Chromium Tier A | Firefox Tier B | Safari / iOS / Android |
|---|---|---|---|
| Project v1 load、Schema/reference 校验 | 候选支持 | 候选支持 | Uncertified |
| Transaction、语义编辑、undo/redo | 候选支持 | 候选支持 | 与浏览器无关的单元语义已验证；完整端到端仍 uncertified |
| MP4 / H.264 / AAC 输入 | 候选支持 | 候选支持 | Uncertified |
| WebM / VP9 / Opus 输入 | 候选支持 | 候选支持 | Uncertified |
| exact seek | 候选支持 | 候选支持 | Uncertified |
| Worker + OffscreenCanvas + WebGL2 | 默认路径 | 默认路径 | Uncertified |
| WebGPU | 可探测实验路径，不是实时默认 | 参考环境不可用，自动选择 WebGL2 | Uncertified |
| AudioWorklet 主时钟 | 候选支持 | 候选支持 | Uncertified |
| SharedArrayBuffer PCM 快速路径 | 需要 COOP/COEP | 需要 COOP/COEP | Uncertified |
| 非隔离 Transferable PCM fallback | 实现存在，但不等价于 Tier A 性能证据 | 实现存在，但不等价于 Tier B 性能证据 | Uncertified |
| OPFS Sink | 候选支持 | 候选支持 | Uncertified |
| File System Access picker | 参考环境可用 | 参考环境不可用；使用 OPFS/自定义 Sink | Uncertified |
| WebM / VP9 / Opus 本地导出 | 标准候选输出 | 标准候选输出 | Uncertified |
| MP4 / H.264 / AAC 本地导出 | 不认证；配置探测结果不统一 | 不认证；配置探测结果不统一 | Uncertified |
| declarative Material Graph | 候选支持 | 候选支持 | Uncertified |
| trusted Shader/WASM Material | 仅宿主双重授权；不构成任意第三方代码支持 | 同左 | Uncertified |

## 4. 内容与工程边界

- 输出画面：SDR、8-bit、`srgb-linear` 工作空间；HDR、P3、Rec.2020 和 10-bit 未认证；
- Player 会按 Sequence 的 44.1/48/96 kHz 请求 owned AudioContext，并要求浏览器实际返回相同采样率；源 PCM 必须匹配 Sequence，不在 mixer 边界隐式重采样；
- Audio Item 在本 Alpha 仅执行 forward 1x linear time mapping；audio reverse/变速由 Project validator 以 `PROJECT_AUDIO_TIME_MAPPING_UNSUPPORTED` fail closed；
- 标准画面合成：启用的视觉轨道按 Project 顺序做 premultiplied `normal` alpha-over；其他 blend mode 尚未认证；
- 标准本地输出：WebM/VP9/Opus；容器/codec 不能由文件扩展名或浏览器品牌推断；
- Alpha 固定集成 fixture：60 秒、320×180、30 fps、48 kHz stereo；它使用仓库短媒体的显式 `boundary: loop`，不代表长素材或 1080p60 SLA；
- 设计规模仍面向约 10 分钟模板短视频，但本版本没有对长视频、4K、多小时工程或移动端本地导出作发布承诺；
- 1080p30 单 pass WebGL2 有 Phase 0 性能基线，但不是跨设备最低帧率 SLA；Soft Glow 等多 pass Material 可在 Preview 降质或跳过，并必须报告。

## 5. 部署前提

- 必须运行在 secure context（生产 HTTPS；本地 `localhost`/`127.0.0.1` 可用于开发）；
- 推荐配置 COOP/COEP，使 `crossOriginIsolated === true` 并启用 SharedArrayBuffer 快速路径；无隔离时使用有界 Transferable fallback，但性能等级下降；
- 跨源媒体必须满足 CORS/COEP，并为大文件正确实现 byte range；
- autoplay 仍受浏览器用户激活策略约束，应在点击事件中调用 `player.play()`；
- Worker/AudioWorklet 必须从发布 tarball 的 ESM 资源 URL 加载，CSP 要允许同源 worker/worklet；
- 详细配置见[浏览器部署与跨源隔离](../guides/browser-deployment.md)。

## 6. 证据与更新规则

当前可审计的 Phase 0 与 60 秒 Alpha 报告位于 [baseline reports](../../reports/baseline/README.md)。Phase 1 最终门禁、tarball consumer 和 60 秒报告的状态统一记录在 [Phase 1 证据索引](../evidence/phase-1-index.md)。

只有在以下条件同时满足后，表中的 `candidate` 才能在发布说明中去掉：

1. 源码 Chromium/Firefox suite 返回 0；
2. 由真实 `.tgz` 安装的 Vite consumer 在相应浏览器创建 Worker/AudioWorklet 并跑通公开 Session；
3. 已通过的 60 秒 Project edit、undo/redo、seek/play、preview、export 和独立 readback 在最终代码上可复现；
4. 固定环境的资源、队列、Long Task 和 dispose 报告无发布 blocker；
5. [Phase 1 Exit Review](../decisions/phase-1-exit.md) Accepted。
