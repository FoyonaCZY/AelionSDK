# Production Core Compatibility Matrix

本矩阵描述当前源码能力，不是 npm release 或新增 OS/GPU 认证。每次运行仍须调用 capability/preflight。

| 能力 | Chromium（当前桌面参考环境） | Firefox（当前桌面参考环境） | 运行规则 |
|---|---|---|---|
| Preview / Player / WebGL2 | 浏览器矩阵通过 | 浏览器矩阵通过 | context lost 重建；队列和资源有界 |
| WebGPU Material | capability-selected | capability-selected | adapter/device 不可用时按策略回退 WebGL2 |
| 12 blend modes | WebGL2/WebGPU parity 通过 | WebGL2 路径通过；WebGPU 依设备 | 不支持 backend 不得静默当 normal |
| Text/Caption/Generator/Adjustment/Mask | 通过 | 通过 | 字体像素复现需显式 font assets |
| WebM/VP9/Opus | Worker export 通过 | Worker/inline 由 capability 决定 | streaming sink，不组装完整成片 Blob |
| MP4/H.264/AAC | capability + AAC runtime canary | capability-selected | 当前 Chromium MP4 默认 inline；失败可选 WebM/Remote |
| Still/GIF/WAV/RF64 | capability-selected | capability-selected | Canvas/ImageEncoder 能力不足时 fail closed |
| SDR/P3 working space | RGBA8 SDR 执行 | RGBA8 SDR 执行 | P3 presentation 仍由 surface/browser 决定 |
| Rec.2020 PQ/HLG 10-bit | 未执行 | 未执行 | contract 可验证，renderer/export preflight 拒绝降级 |
| 4K | 离线 4K compositor probe 有证据 | 未单独测量 | 不承诺 4K30 实时；按 GPU budget/adaptive quality 决定 |
| 长时间线 | 10 分钟等价 PCM/heap 有界证据 | 核心算法同源 | 大文件需 range provider + segmented cache/proxy |

明确不在本 Goal：Safari/iOS/iPadOS/Android、Windows/Linux 与新增 driver 的认证；npm provenance/publish/Tag/Release；非 Vite bundler；1.0 API 稳定承诺。

证据入口见 [Production Core Evidence](../evidence/production-core-index.md)。
