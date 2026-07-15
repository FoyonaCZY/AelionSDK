# AelionSDK Phase 1 Backlog

> 版本：1.0  
> 建立日期：2026-07-13  
> 输入：[Phase 0 Exit Review](decisions/phase-0-exit.md)  
> 性质：研发排序建议，不是公开发布时间或浏览器支持承诺

> 执行状态与已完成/阻塞证据不在本 backlog 重复维护；以 [Phase 1 Goal](GOAL-PHASE-1.md)、[Evidence Index](evidence/phase-1-index.md) 和 [Exit Review](decisions/phase-1-exit.md) 为准。

## 1. Phase 1 目标

把 Phase 0 已验证的 browser-first 内核扩展成可供上层产品持续集成的 Alpha SDK：补齐高频剪辑原子能力，冻结首批公开 TypeScript API，建立上层可创作和分发转场/滤镜/特效 Material 的工具链，并在明确的桌面与移动浏览器矩阵上形成可发布的降级策略。

Phase 1 不重建另一套 Timeline 或客户端内核。所有新能力必须沿以下扩展面进入：

- Project Document：稳定声明式状态与持久化；
- Transaction：实时编辑命令、原子提交、undo/redo；
- Render IR：Preview/Export 共享的内部执行语义；
- Material Protocol：上层自定义 Filter/Transition/Effect/Generator；
- Capability/Preflight/Diagnostic：浏览器差异与失败解释；
- Resource Budget：解码、GPU、音频、编码与缓存的统一上限。

## 2. 优先级定义

- **P0**：Alpha 发布或正确性门禁；缺失会阻止对外试用；
- **P1**：高频剪辑能力或重要 DX；应在 Alpha 周期完成；
- **P2**：生态与高级能力；有明确协议落点，但不阻塞首个 Alpha。

每项只有在代码、测试、浏览器证据、资源结论和文档同时存在时才能标记 Verified。

## 3. P0：发布与架构硬化

### P1-PLAT-001 Safari/iOS/Android 真机认证

交付：

- 最新稳定 Safari、iOS Safari、Android Chromium 的 CapabilityReport；
- Project load、MP4/WebM 输入、exact seek、Worker/Canvas、AudioWorklet、Material、导出/降级真机 smoke；
- 前后台、AudioContext interruption、内存压力、存储不足和反复 Session；
- 每个组合明确为支持、降级或不支持，不保留“应该可以”。

退出：发布矩阵经过产品、Runtime、QA 共同批准；若 iOS 无法本地导出，RemoteExport/明确拒绝路径可用。

### P1-GFX-001 WebGPU 持久运行时与零拷贝呈现

交付：持久 adapter/device/pipeline cache、纹理池、VideoFrame 外部纹理/最少拷贝路径、Worker 到显示面的直接呈现、device lost 重建。

退出：Warm Film 1080p30 p95 达到帧预算，且内存、pipeline 数和资源释放在循环测试中稳定；否则继续由 WebGL2 默认。

### P1-EXP-001 导出调度移出主线程

交付：frame production、encoder orchestration、mux backpressure 迁入 Worker；主线程只处理控制与进度；保留可取消和 partial cleanup。

退出：固定 1080p30 导出不存在 SDK 造成的 >50 ms 稳态 Long Task；吞吐不低于 Phase 0 基线。

### P1-API-001 Alpha Public API

冻结首批入口：

- `createSession` / `loadProject` / `dispose`；
- `transaction` / `undo` / `redo` / revision conflict；
- `player.play/pause/seek/scrub`；
- `export.preflight/start/cancel`；
- Material registry / package resolver；
- capability、diagnostic、stats、trace 订阅。

退出：API Extractor 或等价签名快照、语义版本规则、AbortSignal 契约、错误码目录和最小接入示例齐全。

### P1-SEC-001 Material 供应链安全

交付：package canonical manifest、integrity/signature 验证、宿主 allowlist、CSP/网络策略、trusted Shader/WASM 权限、预算隔离和审计日志。

退出：篡改、越权 backend、动态网络代码、超预算资源和不兼容版本均在执行前拒绝。

## 4. P1：剪辑原子能力覆盖

### 4.1 时间线与编辑

| ID | 能力 | 协议/运行时落点 | 验收重点 |
|---|---|---|---|
| P1-EDIT-001 | insert/remove/move/trim/split/replace | Transaction operations | 原子、inverse、affected range 最小化 |
| P1-EDIT-002 | ripple/roll/slip/slide | 复合 Transaction | 失败不暴露中间态，多轨约束稳定 |
| P1-EDIT-003 | track reorder/lock/mute/solo/visibility | Project + Transaction | Preview/Export 一致，音视频独立控制 |
| P1-EDIT-004 | group/link/unlink | normalized entity refs | 跨轨移动、删除与 undo 不产生悬空引用 |
| P1-EDIT-005 | marker/range/selection metadata | Project metadata entities | 不污染渲染语义，可迁移、可协作 |
| P1-EDIT-006 | nested sequence | Sequence asset + Render IR subgraph | 循环引用诊断、时间映射和缓存失效 |

### 4.2 时间变换与动画

| ID | 能力 | 协议/运行时落点 | 验收重点 |
|---|---|---|---|
| P1-TIME-001 | 定速变速 | TimeMap node | 音视频时长一致、边界无累计误差 |
| P1-TIME-002 | 曲线变速 | 分段单调 time map | 可求逆、seek 有界、导出确定 |
| P1-TIME-003 | freeze frame | TimeMap hold segment | 音频策略显式 |
| P1-TIME-004 | reverse | reverse decode/cache policy | GOP 放大、内存预算与代理策略 |
| P1-ANIM-001 | 关键帧插值 | typed automation curve | step/linear/bezier、sequence/local time |
| P1-ANIM-002 | 入场/出场/循环动画 | Animation Material 或 preset | 可组合顺序、冲突规则、预览降级 |

### 4.3 画面、文字与合成

| ID | 能力 | 协议/运行时落点 | 验收重点 |
|---|---|---|---|
| P1-GFX-002 | crop/fit/fill/anchor/rotation | Core Render IR nodes | 像素坐标与归一化坐标明确 |
| P1-GFX-003 | blend modes | Core Node registry | WebGPU/WebGL2 数值容差 Golden |
| P1-GFX-004 | mask/matte | Material input/Mask IR | alpha/luma、反相、羽化、跟随空间 |
| P1-GFX-005 | background/canvas/blur fill | Generator + compositor | 画布比例变更不破坏布局 |
| P1-TEXT-001 | Text/Caption entity | Text layout IR | 字体加载、fallback、line break 确定性 |
| P1-TEXT-002 | 字幕导入导出 | WebVTT/SRT adapter | 时间边界、样式降级、语言与换行 |
| P1-TEXT-003 | 字幕/文字 Material | glyph/line/box typed inputs | 上层可创作动画且不能执行任意代码 |

### 4.4 音频

| ID | 能力 | 协议/运行时落点 | 验收重点 |
|---|---|---|---|
| P1-AUD-001 | gain/pan/mute/fade | Audio Render IR | sample-accurate，Preview/Export 一致 |
| P1-AUD-002 | 音频关键帧与 automation | PCM mixer | block 边界无爆音 |
| P1-AUD-003 | ducking/sidechain | Audio graph | lookahead、延迟补偿、离线确定 |
| P1-AUD-004 | waveform/peak cache | derived asset cache | 可取消、分块、不会写入 Project 大数组 |
| P1-AUD-005 | loudness/limiter | offline/preview audio node | LUFS/true peak 报告与预算 |
| P1-AUD-006 | 设备切换/interruption | Player state machine | Safari/iOS 真机恢复契约 |

### 4.5 媒体、代理与导出

| ID | 能力 | 协议/运行时落点 | 验收重点 |
|---|---|---|---|
| P1-MED-001 | thumbnail/waveform/index cache | CacheStore | hash/version/eviction、OPFS 配额 |
| P1-MED-002 | proxy generation/use | Asset rendition | source/proxy 时间一致，可透明切换 |
| P1-MED-003 | image/GIF/animated image | container adapter | 帧时长、方向、颜色与内存 |
| P1-MED-004 | raw DTS/byte offset adapter | SampleIndex capabilities | 只在公共可靠来源可用时启用 |
| P1-EXP-002 | MP4/H.264/AAC 输出 | capability-selected exporter | 不支持时显式给出 WebM/Remote 选项 |
| P1-EXP-003 | still/GIF/audio-only export | Export profiles | 复用 frozen IR、preflight 与 Sink |
| P1-EXP-004 | RemoteExport adapter | Export provider interface | 上传可取消、内容寻址、权限和进度 |

## 5. P1：Material 创作与生态

### P1-MAT-001 Material Authoring SDK

面向上层提供：

- TypeScript builder：创建 Definition、Graph、Parameter、Resource、Input binding；
- Core Node 类型声明与端口自动补全；
- Schema、拓扑、类型、参数边界、静态预算和 backend lint；
- canonical pack、integrity、签名与版本兼容检查；
- 从同一 fixture 运行 Preview/Export Golden；
- CLI 输出 capability requirements 与降级说明。

上层产出的 material 是数据包，不是任意运行时代码。滤镜、转场、特效、生成器共享 Package/Definition/Graph/Instance 四层协议，通过 `kind`、typed input/output 和 host slot 区分。

### P1-MAT-002 Core Node 数学规范

为每个节点冻结：输入/输出类型、坐标空间、颜色空间、alpha 约定、边界行为、默认值、数值精度、WebGPU/WebGL2 容差和静态成本。新增节点必须带双后端测试或明确 backend requirement。

### P1-MAT-003 Material Composition

定义同一 Item 上多个 Material 的顺序、命名 slot、局部/全局空间、输入复用、pass fusion、缓存键、参数冲突和 adaptive quality。Transition 必须是显式双输入，Mask/Matte 必须是 typed auxiliary input。

### P1-MAT-004 Material DevTools / Lab

提供参数面板、时间拖动、输入替换、pass/texture/budget 检查、GPU timing、diagnostics、backend 切换、Golden 捕获和 package 导出。第一版可以是内部工具，不要求 Marketplace。

### P1-MAT-005 版本与迁移

- protocol、package、definition 分别版本化；
- patch 版本不得改变已有参数语义；
- graph/node 迁移是纯数据变换并可审计；
- Project 锁定 package version + integrity；
- 缺包、版本冲突、节点不支持不得静默跳过。

## 6. P2：高级能力与生态

- motion tracking 与跟踪数据协议；
- 抠像、分割和 AI 派生资产，但推理结果必须物化、可缓存、可替换；
- HDR/P3/Rec.2020、10-bit 和颜色管理；
- 长视频分段索引、代理、分层缓存和恢复式导出；
- 多实例资源调度与页面级 GPU/decoder 仲裁；
- 协作 operation log/CRDT adapter；Project 仍是 canonical snapshot；
- Material Marketplace、签名信任链、审核与撤回；
- 远端渲染/导出作为同一 Project/Material 协议的执行后端。

## 7. 推荐实施顺序

```text
真机认证 + Alpha API + 导出移出主线程
        ↓
高频 Transaction 原子能力 + Text/Audio 基础
        ↓
Material Authoring SDK + Core Node 数学规范
        ↓
Proxy/Cache + MP4/Remote Export
        ↓
高级时间变换、Mask/Matte、生态与长视频
```

前三条可以并行，但必须用同一 60 秒 Alpha Project 在集成阶段汇合。

## 8. Phase 1 候选退出条件

1. 新接入方仅依赖公开 API 和文档即可加载、编辑、播放并导出 60 秒工程；
2. 高频编辑命令全部支持原子提交、inverse、revision 与最小脏区间；
3. Chromium、Firefox 与批准的 Safari/iOS/Android 范围都有真机结论；
4. Preview/Export 对时间、文字、音频与 Material 抽帧/抽样一致；
5. 上层可用 Authoring SDK 创建 Filter、Transition、Effect，验证后无需改 Aelion 内核即可加载；
6. 导出主线程、内存、队列和资源达到批准的 Alpha SLO；
7. 不支持组合在 preflight 阶段给出稳定诊断和可选降级；
8. 协议/API 版本、迁移、安全和第三方许可可供外部团队审计。
