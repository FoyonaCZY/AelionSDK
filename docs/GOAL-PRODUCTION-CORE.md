# AelionSDK Goal：完成生产级剪辑渲染核心

> 状态：Complete
> 启动日期：2026-07-15
> 完成日期：2026-07-15
> 基线：`0.1.0-alpha.0` Phase 1 source milestone + [Audio Track Solo Goal](GOAL-TRACK-SOLO.md)
> 路线输入：[Phase 1 Backlog](phase-1-backlog.md)
> 执行流程：[AelionSDK 开发流程](AelionSDK-Development-Workflow.md)

## Goal

> 在保持 browser-first、Project/Transaction/Render IR 分层、Preview/Export 同语义和资源有界原则的前提下，完成多格式导出、专业编辑、完整时间映射、文字与高级合成、专业音频、长视频与大媒体、GPU/Worker 性能架构以及 Material 生态与安全链，使 AelionSDK 在已认证桌面浏览器范围内具备生产级剪辑与渲染核心能力。

## 明确排除

本 Goal 按产品决策明确不包含：

- Safari、iOS/iPadOS、Android、Windows/Linux 和新增 GPU/driver 的平台认证；
- npm publish、provenance、Tag/GitHub Release、非 Vite bundler；
- 1.0 API 稳定承诺及其远端发布流程。

排除项不得阻止核心实现和已有 Chromium/Firefox 回归，但也不得被本 Goal 的完成结论推断为已支持。

## R1. 多格式与可恢复导出

- [x] capability-selected MP4/H.264/AAC 输出；不支持时提供稳定诊断和 WebM/Remote 选项；
- [x] still、GIF/animated image、audio-only export profiles；
- [x] RemoteExport provider，支持内容身份、鉴权、取消、进度和失败清理；
- [x] 导出 checkpoint、恢复和幂等 sink 协议，不拼装完整成片 Blob；
- [x] 所有 profile 复用 frozen Render IR、统一 preflight、时间和资源报告。

## R2. 专业编辑命令

- [x] ripple delete/insert、roll、slip、slide 作为单个原子 Transaction；
- [x] group/link/unlink 与 linked group move/trim/split 策略；
- [x] marker/range/selection metadata 的领域命令；
- [x] nested sequence 的引用、循环诊断、时间映射、Render IR subgraph 和缓存失效；
- [x] 所有命令具备 revision、inverse、undo/redo、最小 affected ranges 和失败零副作用。

## R3. TimeMap 与动画

- [x] 统一 linear/curve/hold TimeMap，支持定速、曲线变速、freeze frame 和 reverse；
- [x] TimeMap 单调段可验证、可求值、可求逆，边界策略明确；
- [x] 视频 seek/decode、音频重采样、Preview 和 Export 使用同一映射；
- [x] step/linear/cubic-bezier、sequence/item time、pre/post infinity automation；
- [x] 入场、出场和循环动画具有确定的组合与降级语义。

## R4. 文字、高级合成与颜色

- [x] Text/Caption layout IR、字体加载/fallback、确定性 line break；
- [x] WebVTT/SRT 导入导出和字幕样式降级；
- [x] 文字/字幕 Material typed inputs；
- [x] multiply/screen/overlay 等 Project v1 blend mode 双后端一致执行；
- [x] alpha/luma mask、matte、invert、feather 和空间跟随；
- [x] background/canvas/blur fill、Generator/Adjustment 合成；
- [x] SDR/P3/Rec.2020/HDR、8/10-bit 颜色与 capability/preflight 契约。

## R5. 专业音频

- [x] sample-accurate gain/pan/fade automation，block 边界连续；
- [x] 定速/曲线/reverse 音频策略、重采样和显式音高策略；
- [x] ducking/sidechain、lookahead 与延迟补偿；
- [x] waveform/peak cache，可取消、分块、有界；
- [x] loudness、LUFS、true peak、limiter 与报告；
- [x] 声道映射、设备切换和 AudioContext interruption 状态机（不扩展移动端认证结论）。

## R6. 长视频、大媒体与资源治理

- [x] range-backed 分段 SampleIndex、thumbnail/waveform/index CacheStore；
- [x] proxy generation/use 与 source/proxy 时间一致性；
- [x] image/GIF/animated-image 输入和方向/颜色/帧时长；
- [x] OPFS 分层缓存、内容寻址、版本、配额、LRU 和清理；
- [x] 长时间线、4K、多实例的页面级 decoder/GPU/cache 仲裁；
- [x] 恢复式导出和资源快照证明内存不随时长线性增长。

## R7. Export Worker 与 GPU 持久运行时

- [x] frame production、encoder orchestration 和 mux backpressure 移入 Worker；
- [x] 主线程只保留控制、进度和最终 sink 协调，稳态无 SDK >50 ms Long Task；
- [x] WebGPU adapter/device/pipeline cache、纹理池和最少拷贝呈现；
- [x] WebGL2 program/texture/framebuffer 复用；
- [x] backend/device/context lost 重建与有界 fallback；
- [x] 1080p30/4K、长时间循环、吞吐、heap、资源计数进入证据门禁。

## R8. Material 生态、安全与工具

- [x] 公钥签名、publisher identity、信任链、撤回/吊销和审计记录；
- [x] CSP/网络/资源权限和 trusted Shader/WASM 的隔离执行策略；
- [x] protocol/package/definition/node 的纯数据 migration 与兼容报告；
- [x] Material composition、slot、pass fusion、cache key 和 adaptive quality；
- [x] Core Node 数学规范与双后端数值容差；
- [x] Material Lab：参数、时间、输入、pass/texture/budget、GPU timing、diagnostic、Golden 和 package export；
- [x] Marketplace-ready registry metadata 与审核/撤回接口；不包含真实远端 Marketplace 发布。

## R9. 统一验收

- [x] 所有新增公开状态、错误和资源边界有稳定 diagnostic；
- [x] strict typecheck、lint、format、Schema、unit/property/contract tests 全部通过；
- [x] Chromium 与 Firefox 的 Preview/Export 一致性和资源释放回归通过；
- [x] 长视频、4K、专业编辑、文字、音频、多格式导出和 Material 安全 evidence 可重复；
- [x] README、指南、兼容矩阵、ADR、Changelog 与完成度审计同步；
- [x] 不把排除的平台认证和远端发布动作写成已完成。

## 实施顺序

```text
专业编辑 + TimeMap
        ↓
文字/高级合成 + 专业音频
        ↓
多 Profile 导出 + Remote/恢复
        ↓
Proxy/Cache/长视频 + 页面级资源治理
        ↓
Export Worker + GPU 持久化
        ↓
Material 签名/迁移/Composition/Lab
        ↓
统一浏览器、性能、安全和资源审计
```

任何一项只有在协议、实现、失败路径、测试、资源结论和文档全部存在时才能勾选。

## Completion Review

完成证据见 [Production Core Evidence Index](evidence/production-core-index.md)。最终源码窗口通过 Node/unit/contract、Chromium、Firefox、Golden、Schema、format、lint、typecheck、build、API snapshot 与性能报告校验。

完成结论只覆盖本 Goal 的生产核心。明确排除的平台认证、npm/API 远端发布和 1.0 稳定承诺仍未执行，也不由本结论推断为完成。
