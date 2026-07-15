# AelionSDK Phase 0 兼容性矩阵

> 状态：Frozen，2026-07-13  
> 依据：[ADR-011](../adr/011-phase-0-certified-scope.md)  
> 这是一份固定环境实测台账，不是对外 SLA。

## 认证环境

| 环境 | 层级 | 结论 |
|---|---|---|
| Chrome 149.0.7827.201 / macOS 15.6.1 / Intel MacBook Pro 16 GiB | Tier A | Phase 0 已认证；浏览器 suite 38/38 |
| Firefox 140 / Playwright / 同一主机 | Tier B | Phase 0 已认证；浏览器 suite 35/35 |
| Safari 18.6 / macOS | 未认证 | SafariDriver Remote Automation 未开启，未产出产品级报告 |
| Playwright WebKit 26 | 未认证 | 运行时镜像不可用；blocker 已入报告 |
| iOS Safari / Android Chromium | 未认证 | Phase 0 范围外；进入 Phase 1 真机门禁 |

“未认证”不等于已证明不支持，也不允许上层推断为支持。SDK 必须以 capability/preflight 的具体结果决定运行或拒绝。

## 能力矩阵

| 能力 | Chromium 149 | Firefox 140 | Safari/WebKit/移动 | Phase 0 决策 |
|---|---|---|---|---|
| MP4 H.264/AAC 输入 | 通过 | 通过 | 未认证 | P0 输入 |
| WebM VP9/Opus 输入 | 通过 | 通过 | 未认证 | P0 输入 |
| exact seek：B-frame/VFR/非零 PTS/moov tail/fMP4 | 通过 | 通过 | 未认证 | SampleIndex 公共字段路径支持 |
| raw DTS / physical sample offset | 不可用，显式 diagnostic | 不可用，显式 diagnostic | 未认证 | 按 ADR-010 capability 门控 |
| Worker + OffscreenCanvas | 通过 | 通过 | 未认证 | 必需能力 |
| WebGL2 Material | 通过 | 通过 | 未认证 | 当前实时默认候选 |
| WebGPU Material | 通过，性能未达 30 fps | 不可用 | 未认证 | 实验候选；不是当前默认 |
| device/context lost | fallback/稳定失败通过 | WebGL2 路径通过 | 未认证 | 不静默失败 |
| AudioWorklet + SAB | 通过 | 通过 | 未认证 | cross-origin-isolated 首选 |
| 非隔离 Transferable PCM | 通过 | 通过 | 未认证 | 有界 acknowledged fallback |
| OPFS | 通过 | 通过 | 未认证 | 可作为 seekable Sink |
| File System Access save picker | 通过 | 不可用 | 未认证 | 可选宿主能力，Firefox 可走 OPFS/Host Sink |
| VP9/Opus WebM export | 通过 | 通过 | 未认证 | 标准本地输出 |
| H.264 1080p encode | 当前配置不支持 | probe 支持 | 未认证 | 不作统一承诺 |
| AAC encode | 通过 | 当前配置不支持 | 未认证 | 不作统一承诺 |
| trusted Shader/WASM | 仅宿主 allowlist | 仅宿主 allowlist | 未认证 | 默认拒绝动态网络代码 |

## 性能与降级

- WebGL2 Warm Film：51.09 fps；作为 1080p30 实时默认候选；
- WebGPU Warm Film：27.83 fps；Phase 1 完成持久 device/pipeline 与零拷贝后重评；
- WebGL2 Soft Glow 四 pass：13.39 fps；离线完整执行，实时预览降分辨率或按声明显式跳过；
- 5 秒 1080p30 VP9/Opus WebM 导出：2.36× realtime；
- 导出观察到 1 次 93 ms 主线程 Long Task，Phase 1 必须迁移调度；
- cold exact seek 最坏 p95 207.07 ms，warm 最坏 p95 12.59 ms；
- 10 分钟等价 PCM 使用固定 32.8 KiB ring，0 underrun，无随时长线性 heap 增长；
- 颜色范围冻结为 SDR 8-bit；HDR/P3 未认证。

## 层级语义

- **Tier A**：已验证 WebCodecs 输入/输出、Worker、WebGL2、WebGPU、AudioWorklet、SAB、OPFS 与标准导出组合；
- **Tier B**：已验证 WebGL2、Worker、AudioWorklet、输入和至少一套标准本地输出；允许 WebGPU/File picker/AAC encode 等能力缺失；
- **Tier C**：可预览但本地导出、低延迟音频或复杂 Material 受限；Phase 0 未认证 Tier C 环境；
- **Unsupported/Uncertified**：preflight 返回稳定 diagnostic，不静默跳过效果或改变格式。

## 证据入口

- [Chromium capability](../../reports/baseline/capability-chromium.json)
- [Firefox capability](../../reports/baseline/capability-firefox.json)
- [WebKit blocked record](../../reports/baseline/capability-webkit.json)
- [Chromium browser suite](../../reports/baseline/browser-smoke-chromium.json)
- [Firefox browser suite](../../reports/baseline/browser-smoke-firefox.json)
- [Seek report](../../reports/baseline/media-seek-chromium.json)
- [1080p30 performance](../../reports/baseline/performance-1080p30-chromium.json)
- [30-second vertical slice](../../reports/baseline/vertical-slice-30s.json)
