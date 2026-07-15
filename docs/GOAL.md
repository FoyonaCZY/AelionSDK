# AelionSDK Phase 0 Goal：完成架构验证

> 历史 Goal：已 Complete。当前活动目标见 [Phase 1 Goal](GOAL-PHASE-1.md)。
> Goal 状态：Complete  
> 启动日期：2026-07-10  
> 最新更新：2026-07-13  
> 执行流程：[AelionSDK 开发流程](AelionSDK-Development-Workflow.md)  
> 退出评审：[Phase 0 Exit Review](decisions/phase-0-exit.md)

## 1. Goal

> 启动并完成 AelionSDK Phase 0 架构验证：建立可持续开发工程与质量门禁，冻结 Project/Material 核心协议原则，并打通精确时间模型、事务模型、MP4/WebM 随机访问解码、Worker GPU 合成、AudioWorklet 主时钟、逐帧编码与流式封装的最小可运行垂直链路，以可重复测试、性能数据和 ADR 作为验收证据。

### 成功定义

一个新环境可以加载固定 Aelion Project，完成原子编辑、精确 Seek、有声预览、Material 合成和本地流式导出；Preview/Export 使用同一 Render IR 与节点语义，所有关键资源有界且可释放，结果能由自动测试、独立回读、兼容报告和性能报告复现。

这是一项 browser-first 架构验证，不以 Maas 客户端 SDK 的对象模型、线程模型或文件格式为实现约束。

## 2. 冻结认证范围

依据 [ADR-011](adr/011-phase-0-certified-scope.md)，Phase 0 只对以下范围作出结论：

- Chromium 149 / macOS：Tier A；
- Firefox 140 / macOS：Tier B；
- Safari、iOS Safari、Android：未认证，进入 Phase 1；
- 输入：MP4/H.264/AAC 与 WebM/VP9/Opus；
- 标准本地输出：WebM/VP9/Opus；
- 实时 1080p30：WebGL2 为当前默认候选，WebGPU 优化后重评；
- Soft Glow 四 pass：离线完整执行，预览允许显式降分辨率或跳过；
- 颜色：SDR 8-bit；
- 工程：模板短视频与最长约 10 分钟时间线；
- trusted Shader/WASM：仅宿主 allowlist，动态网络代码默认拒绝。

未在该范围内的能力不是“默认支持”，必须由 capability/preflight 返回具体结论。

## 3. 固定垂直场景

- 30 秒 Project；
- 2 路真实视频、1 路音频；
- transform、opacity、Warm Film Filter、Cross Dissolve Transition；
- load、exact seek、play、pause；
- 一个 Transaction 同时修改 Item 与 Material 参数；
- ChangeSet 只使受影响实体/区间失效；
- AudioContext/AudioWorklet 为有声播放主时钟；
- Worker GPU 合成；
- 从冻结 revision 逐帧导出 VP9/Opus WebM；
- renderer → encoder → muxer → sink 全链有界并传播背压；
- Mediabunny 与 FFmpeg 独立回读；
- 输出 capability、diagnostics、stats 和资源释放结果。

最新结果：900 个视频帧、1,440,000 个音频帧、69 次 Sink 写入、最大并发 1、A/V 尾差 333 μs，音视频均被 FFmpeg 完整解码。

## 4. Required Outcomes

以下九项已全部满足，最终门禁与 Exit Review 已通过。

### R1. 可持续工程与质量门禁

- [x] Git 仓库、pnpm workspace、TypeScript strict 与固定工具链；
- [x] build、typecheck、lint、format、unit、schema、browser、golden、bench 命令；
- [x] PR CI 覆盖静态门禁与 Chromium/Firefox browser smoke；
- [x] nightly 覆盖 browser、Golden、benchmark、capability、seek、performance、vertical evidence；
- [x] fixture、report、benchmark、trace 与资源计数格式固定；
- [x] 干净临时副本完成 install、build、test 与 Capability Lab 启动复现；
- [x] 最终六条本地质量门禁全部返回 0。

### R2. Project、时间与事务

- [x] Project v1 JSON Schema、TypeScript 类型和 validator 一致；
- [x] normalized entity maps 与统一 `materialInstances`；
- [x] 安全整数微秒、有理数帧率、音频 sample 边界；
- [x] 24/25/30/50/60 与 1000/1001 系列属性测试；
- [x] 44.1/48/96 kHz 属性测试；
- [x] canonical serialize/parse/serialize 字节稳定；
- [x] Transaction revision、原子提交、inverse、affected entities/ranges；
- [x] 失败事务不改变 revision、snapshot 或事件；
- [x] apply + inverse 恢复 canonical hash。

### R3. MP4/WebM 随机访问解码

- [x] AssetResolver 支持 Range、取消、CORS/网络诊断；
- [x] MP4/WebM 规范化为统一 SampleIndex；
- [x] PTS、normalized decode time、duration、sync、size、codec config 与双 order 保留；
- [x] raw DTS/physical byte offset 按 [ADR-010](adr/010-sample-index-capability-gating.md) 显式门控，不伪造字段；
- [x] 从正确同步样本解码并选择目标展示帧；
- [x] corpus 覆盖 moov head/tail、fragmented MP4、非零 PTS、B-frame、VFR、多 cluster WebM；
- [x] AAC/Opus 规范化为 f32 PCM；
- [x] cold/warm seek、解码放大、adapter capability 与 diagnostics 入报告；
- [x] unsupported、CORS、Range 缺失和损坏输入返回稳定 diagnostic；
- [x] decoder/frame 在成功、取消和失败路径释放；报告计数归零。

### R4. Worker GPU 合成与 Render IR

- [x] Project 编译为版本化 Render IR；
- [x] 表达媒体源、时间映射、transform、opacity、blend 与 Material node；
- [x] WebGPU 与 WebGL2 Worker 后端真实执行；
- [x] 两层画面、单输入 Filter、双输入 Transition；
- [x] Soft Glow 真实四 pass 与有界中间纹理；
- [x] affectedRanges 驱动最小增量重编译；
- [x] pending request 上限为 8；资源 owner/dispose 明确；
- [x] WebGPU device lost 与 WebGL2 context lost 有 fallback 或稳定失败；
- [x] Preview/Export 共用 Render IR 求值与核心渲染实现。

### R5. AudioWorklet 主时钟

- [x] AAC/Opus 解码为统一 PCM block；
- [x] cross-origin-isolated 使用固定容量 SAB ring；
- [x] 非隔离模式使用有界、需确认的 Transferable PCM queue；
- [x] AudioContext/AudioWorklet clock 调度视频并丢弃过期帧；
- [x] seek generation、pause、resume、underrun、interruption 契约；
- [x] 10 分钟等价 48 kHz 场景 0 underrun；
- [x] 固定 ring 为 32.8 KiB，heap 不随时长线性增长；
- [x] dispose 后 Worklet、AudioContext、PCM 与引用释放；
- [x] 离线音频和视频使用同一整数微秒时间基准。

### R6. 逐帧编码与流式封装

- [x] Export 启动冻结 revision；
- [x] Preflight 在分配 encoder 前检查 codec、尺寸、backend、Material 与 Sink；
- [x] 按输出时间逐帧求值同一 Render IR；
- [x] VP9/Opus WebM 本地组合可运行；
- [x] OPFS 与宿主 Sink 流式输出，不以完整成片 Blob 作为标准中间结果；
- [x] renderer → encoder → muxer → sink 全链有界并背压；
- [x] progress、cancel、存储失败、编码 ingest 失败、partial cleanup；
- [x] 独立 demux/decode 与 FFmpeg 完整回读；
- [x] 30 秒 A/V 尾差 333 μs。

### R7. Material 协议进入真实执行链

- [x] Package、Definition、Graph、Instance 四层 v1 Schema；
- [x] Cross Dissolve、Warm Film、Soft Glow 三个完整示例包；
- [x] package id/version/integrity/material id 精确锁定；
- [x] DAG、类型、端口、参数、资源、输入绑定和静态预算校验；
- [x] 20 个 Phase 0 Core Node 签名与静态成本；
- [x] Instance 参数、边界、数值关键帧、resource/aux input binding；
- [x] Graph → WebGPU/WebGL2 的 Filter/Transition 执行；
- [x] Soft Glow 四 pass 执行；
- [x] backend 缺失、预算超限和 trusted-code 权限返回稳定 diagnostic；
- [x] Preview/Export 同语义、Golden 与浏览器测试进入门禁。

### R8. 兼容性、性能与资源

- [x] 桌面参考设备、浏览器与 benchmark fixture 固定；
- [x] Chromium 149 Tier A 与 Firefox 140 Tier B 报告；
- [x] Safari/iOS/Android 按 ADR-011 明确为 Phase 0 未认证；不保留含混“待测”；
- [x] P0 组合全部分类为支持、降级、不支持或未认证；
- [x] 1080p30 fps、seek、导出、主线程、heap 原始数据；
- [x] 10 分钟等价 PCM 无线性内存增长；
- [x] Session 重复创建/销毁资源归零；
- [x] Worker、PCM、Sink 等队列上限与压力测试；
- [x] codec/container/backend/browser 范围由 ADR-011 冻结；
- [x] WebGPU/Soft Glow/Long Task 未达候选值均有明确降级与 Phase 1 任务。

### R9. 架构决策冻结

- [x] ADR-001～011 全部为 Accepted；
- [x] 每个 ADR 包含 Context、Decision、Alternatives、Consequences 与 Evidence；
- [x] Project、Material、Schema、代码与 ADR 无已知语义冲突；
- [x] SampleIndex 理想字段与当前 adapter 能力由 ADR-010 收口；
- [x] 浏览器、codec、backend、颜色、工程规模和 trusted code 由 ADR-011 收口；
- [x] Phase 0 Exit Review 已建立；
- [x] Phase 1 backlog 已按实测重新排序。

## 5. 最新证据

| 项目 | 结果 | 入口 |
|---|---:|---|
| 单元测试 | 13 files / 84 tests | `corepack pnpm test` |
| Chromium browser | 38/38 | [browser-smoke-chromium.json](../reports/baseline/browser-smoke-chromium.json) |
| Firefox browser | 35/35 | [browser-smoke-firefox.json](../reports/baseline/browser-smoke-firefox.json) |
| Deterministic Golden | 1/1 | `corepack pnpm test:golden` |
| Chromium capability | Tier A | [capability-chromium.json](../reports/baseline/capability-chromium.json) |
| Firefox capability | Tier B | [capability-firefox.json](../reports/baseline/capability-firefox.json) |
| Safari/WebKit | 未认证；运行时阻塞有记录 | [capability-webkit.json](../reports/baseline/capability-webkit.json) |
| cold exact seek 最坏 p95 | 207.07 ms | [media-seek-chromium.json](../reports/baseline/media-seek-chromium.json) |
| warm exact seek 最坏 p95 | 12.59 ms | 同上 |
| Warm Film WebGL2 | 51.09 fps | [performance-1080p30-chromium.json](../reports/baseline/performance-1080p30-chromium.json) |
| Warm Film WebGPU | 27.83 fps | 同上 |
| Soft Glow 四 pass | 13.39 fps | 同上 |
| 1080p30 导出 | 2.36× realtime | 同上 |
| 30 秒垂直导出 | 900 视频帧；A/V 尾差 333 μs | [vertical-slice-30s.json](../reports/baseline/vertical-slice-30s.json) |
| 干净环境 | install/build/test/Lab 通过 | [clean-environment-2026-07-10.json](../reports/baseline/clean-environment-2026-07-10.json) |
| 最终质量门禁 | 6/6 命令返回 0 | [Phase 0 Exit Review](decisions/phase-0-exit.md) |

测试计数必须以本轮命令输出为准；旧的 `60`、`18/18`、`33/33` 不再作为当前结论。

## 6. 候选性能判断

这些是 Phase 0 架构判断，不是对外 SLA。

| 指标 | 候选目标 | 结果 | 判断 |
|---|---:|---:|---|
| warm exact seek | p95 ≤ 100 ms | 12.59 ms | 通过 |
| local cold exact seek | p95 ≤ 350 ms | 207.07 ms | 通过 |
| 轻量 1080p30 | ≥ 29 fps | WebGL2 51.09；WebGPU 27.83 | WebGL2 通过；WebGPU 降级 |
| AudioWorklet underrun | 10 分钟为 0 | 0 | 通过 |
| 简单硬件导出 | ≥ 1× realtime | 2.36× | 通过 |
| SDK 稳态主线程 Long Task | 0 次 > 50 ms | 导出 1 次，93 ms | 未转为发布 SLO；Phase 1 P0 |
| dispose 后资源 | 无随轮次增长 | 关键计数归零 | 通过 |

## 7. 非目标

本 Goal 不要求：

- 完整专业剪辑命令矩阵；
- 对外发布 Alpha/Beta/1.0；
- Safari、移动端或所有 codec/container 的统一承诺；
- Text/Caption、Nested Sequence、Mask/Matte、曲线变速、倒放；
- 代理、波形、缩略图、协作和云端渲染；
- Material Studio/Marketplace；
- 任意第三方网络 Shader/WASM；
- 4K/HDR/P3 或长视频正式性能承诺；
- 与 Maas 客户端 Timeline/Project/Material 格式兼容；
- 冻结全部公开 TypeScript API。

这些能力已在 [Phase 1 Backlog](phase-1-backlog.md) 中按扩展点排序。

## 8. Stop Conditions

以下任一问题会阻止完成或后续发布：

- Project/Schema/Runtime 对同一字段解释不一致；
- 时间不能稳定选帧或对齐 sample；
- Transaction 暴露中间态或失败留下部分修改；
- Preview/Export 分叉实现节点语义；
- 任一媒体/GPU/PCM/encoder/mux 队列没有上限；
- 资源无 owner 或 dispose；
- 导出失败报告成功或留下被当作完整成片的损坏输出；
- 未知 Material 或不支持 backend 被静默跳过；
- trusted code 绕过宿主授权；
- capability/preflight 无法提前解释已知失败；
- benchmark/兼容结论不可由非作者复现。

## 9. 最终完成门禁

```bash
corepack pnpm run ci
corepack pnpm test:browser
corepack pnpm test:browser:firefox
corepack pnpm test:golden
corepack pnpm bench
corepack pnpm format:check
```

完成条件：六条命令全部返回 0，Exit Review 十项答案均为“是”，且没有数据损坏、安全、无限资源或语义分叉 blocker。不能因为文档写完、Demo 能跑一次或开发周期结束而标记 Complete。

本 Goal 已于 2026-07-13 达到上述完成条件。后续工作进入 [Phase 1 Backlog](phase-1-backlog.md)，不得回退 Phase 0 的协议、测试、兼容性和资源基线。
