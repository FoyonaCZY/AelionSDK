# AelionSDK 开发流程

> 文档版本：1.0  
> 更新日期：2026-07-13  
> 当前阶段：Phase 1 Alpha 开发  
> 当前 Goal：[交付可安装的 Phase 1 Alpha SDK](GOAL-PHASE-1.md)  
> 前置基线：[Phase 0 Exit Review](decisions/phase-0-exit.md)  
> 研发路线：[Phase 1 Backlog](phase-1-backlog.md)

## 1. 文档目的

本文定义 AelionSDK 从需求提出到代码、协议、浏览器证据和版本交付的统一流程。它适用于内核、剪辑原子能力、Material、兼容性、性能与开发者体验，不把某个业务 UI 的开发方式写进 SDK 内核。

核心原则：

1. **Browser-first**：以浏览器线程、媒体、GPU、安全、存储和内存约束为设计起点；
2. **协议与实时命令分离**：Project JSON 用于交换/持久化，Transaction 用于实时编辑；
3. **Preview/Export 同语义**：两条路径共用 Time、Render IR 和 Material kernel；
4. **能力显式**：所有 codec/backend/browser 差异经 capability/preflight/diagnostic 表达；
5. **资源有界**：所有帧、PCM、纹理、chunk、缓存和请求都有 owner、预算、背压、取消与 dispose；
6. **证据先于结论**：实现、测试、报告、ADR 和文档共同构成完成状态。

本文不沿用 Maas 客户端 SDK 的架构。Maas 可以作为能力对照和经验输入，但不能成为 Aelion Project、线程模型、浏览器 backend 或 Material 包的兼容约束。

## 2. 信息源与优先级

出现冲突时按以下顺序处理：

1. 已接受 ADR；
2. 已发布 JSON Schema 与协议版本；
3. [Aelion Material Protocol](Aelion-Material-Protocol-v1.md)；
4. [技术设计](AelionSDK-Technical-Design-v0.1.md)；
5. 本开发流程；
6. Issue、PR、会议记录和实验笔记。

低优先级内容不能静默覆盖高优先级契约。若证据推翻已有 ADR，必须新增 ADR 并标记原决策为 Superseded，随后在同一变更链更新 Schema、实现、示例和文档。

## 3. 仓库与模块边界

```text
apps/                   Capability Lab、证据运行器等内部应用
packages/sdk/           推荐的 Session/Player/Preview/Export 公共门面
packages/core/          时间、诊断、资源生命周期等公共基础
packages/project-schema Project v1 Schema、类型、validator、canonical
packages/transaction/   原子事务、revision、inverse、ChangeSet
packages/media/         Resolver、Range、demux、SampleIndex、seek/decode
packages/render-ir/     Project → 版本化共享执行图
packages/material-compiler/ Material 校验、预算、编译、实例求值
packages/material-sdk/  Material Definition/Graph authoring、pack、integrity、Registry
packages/renderer-worker/ Worker WebGPU/WebGL2 合成与资源管理
packages/audio/         PCM、AudioWorklet、主时钟与视频调度
packages/export/        Preflight、离线逐帧、encoder、mux、sink
schemas/                Project/Material 公共 JSON Schema
fixtures/               CC0 corpus、manifest、Golden 输入
benchmarks/             固定 benchmark
reports/baseline/       可复现兼容性、性能和垂直链路证据
docs/adr/               架构决策
```

依赖方向必须从公开语义指向执行层，不能形成业务 UI → 内核私有对象的反向耦合：

```text
Project Schema → Transaction → Render IR
       │                         │
       ├──── Material Instance ──┤→ Worker GPU → Preview
       │                         └→ Offline Export → Sink
       └──── Asset/Time → Media Decode / Audio Mix
```

## 4. 工作流与所有权

| 代码 | 工作流 | 主要交付 | 必须共同评审者 |
|---|---|---|---|
| FND | Foundation | workspace、构建、CI、日志、取消、资源追踪 | 各 package owner |
| CAP | Capability | probe、支持层级、preflight、兼容报告 | Runtime、QA |
| TIM | Time | 微秒/有理数、帧/sample 边界、time map | Media、Audio、Export |
| MOD | Project | Schema、canonical、validator、migration | Transaction、DX |
| TXN | Transaction | operation、revision、inverse、undo/redo、ChangeSet | Project、Render IR |
| MED | Media | Resolver、Range、demux、SampleIndex、seek、decode | Time、Export |
| GFX | Render | Render IR、Worker GPU、frame owner、compositor | Material、Export |
| AUD | Audio | PCM、mixer、AudioWorklet、clock、scheduler | Player、Export |
| EXP | Export | preflight、offline scheduler、encode、mux、sink | Media、Runtime |
| MAT | Material | Schema、Core Nodes、compiler、authoring、security | Graphics、DX |
| QUA | Quality | corpus、Golden、benchmark、真机、资源与报告 | 所有 owner |
| DX | Developer Experience | Public API、示例、Lab、错误目录、文档 | 上层接入方 |

每项工作只有一名直接负责人，但跨边界契约必须有两端 owner 评审。重点接口包括 Time↔SampleIndex、Transaction↔Render IR、Decoder↔Frame Owner、Audio Clock↔Video Scheduler、Material↔Render IR、Encoder↔Mux/Sink、Capability↔Preflight。

## 5. 路线图与当前状态

### Phase 0：架构验证

已完成：Project/Transaction/Time、五类 MP4/WebM corpus、exact seek、Worker WebGPU/WebGL2、AudioWorklet 主时钟、非隔离 PCM fallback、Material 三示例真实执行、VP9/Opus WebM 流式导出和 30 秒垂直回读。R1～R9、六条最终门禁和十项 Exit Review 均已通过。

Phase 0 的完成不等于 SDK 可对外发布；它只证明冻结范围内的技术骨架可继续扩展。实际退出结论以 [Exit Review](decisions/phase-0-exit.md) 为准。

### Phase 1：Alpha

Phase 1 当前以“真实外部 consumer 可安装、可接入、可验证”为发布目标，实施主线为：

1. 冻结 `@aelion/sdk` Alpha API、取消/所有权/diagnostic 与 signature snapshot；
2. 通过真实 `.tgz` consumer 的 Vite build、Worker、AudioWorklet 与 Session 链路；
3. 完成高频编辑、真正多轨合成、Player/audio mute/loop 和 Material Authoring/Registry；
4. 用固定 60 秒 Project 汇合 edit、undo/redo、seek/play、preview、export、独立回读与资源报告；
5. 更新 compatibility/release/Exit Review 后再判断首个 Alpha 是否可发布。

Safari/iOS/Android 真机认证、导出完整 Worker 化、Proxy/Cache、MP4/Remote Export、Text、Mask/Matte 与高级 time map 保留在后续路线。本 Goal 明确不通过推断把它们写成已支持。

Phase 1 的具体条目、优先级和退出条件见 [Goal](GOAL-PHASE-1.md)、[Backlog](phase-1-backlog.md) 和 [Evidence Index](evidence/phase-1-index.md)。

## 6. 工作项生命周期

```text
Backlog → Ready → In Progress → Review → Integrated → Verified
```

- **Backlog**：价值明确，但依赖、协议或验收证据尚不完整；
- **Ready**：满足 Definition of Ready，可直接领取；
- **In Progress**：唯一负责人正在实现或实验；
- **Review**：代码、文档与证据已提交；
- **Integrated**：进入主分支，基础 CI 通过；
- **Verified**：目标浏览器/fixture/benchmark 证据入库。

“代码已写完”或“PR 已合入”不等于 Verified。

### 6.1 Issue 命名

```text
P1-<WORKSTREAM>-<NNN>：动词 + 可观察结果
```

示例：`P1-EDIT-001：实现 trim/split 原子事务并保持 inverse hash`。

### 6.2 Definition of Ready

工作项进入 Ready 前必须包含：

- 用户/上层调用场景和非目标；
- 对应 package 与唯一 owner；
- 输入、输出、错误、取消和 dispose 契约；
- 对 Project/Transaction/Render IR/Material/Public API 的影响；
- 依赖的 capability 与浏览器范围；
- correctness oracle 或 Golden；
- 性能、队列与内存预算；
- 至少一个成功用例和一个失败/边界用例；
- 是否需要 ADR、Schema migration 或安全评审。

### 6.3 Definition of Done

一项能力标记 Verified 前必须满足：

- 实现只进入批准的架构扩展点；
- TypeScript strict、lint、format、build 通过；
- 单元/属性/契约测试覆盖纯逻辑；
- 目标浏览器真实测试覆盖平台原语；
- Preview/Export 相关能力有一致性测试；
- 所有资源和队列具有预算、取消和 dispose 测试；
- 失败路径返回稳定 diagnostic，不依赖浏览器原始字符串作为公开错误码；
- 性能敏感变更有同环境前后数据；
- Schema、类型、示例、ADR、兼容矩阵和文档同步；
- 无未解释 warning、unhandled rejection、悬挂进程或 flaky retry；
- 证据文件包含命令、环境、fixture/hash 和生成时间。

## 7. 标准开发循环

### Step 1：建立基线

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run ci
```

浏览器或性能任务还应先运行相关专项并保存变更前数据。命令契约是 `corepack pnpm run ci`，不是不存在的 `pnpm ci`。

### Step 2：先冻结语义

优先写类型、Schema、operation、diagnostic 和测试 oracle，再实现 backend。涉及下列内容时必须先写或更新 ADR：

- 公开持久化语义或不可逆 Schema 变化；
- Preview/Export 共享边界；
- 时间、颜色、alpha、坐标或音频语义；
- browser/backend/codec 支持承诺；
- 第三方依赖替换；
- trusted code、安全和隐私边界；
- 可能造成长期兼容成本的性能取舍。

### Step 3：垂直实现

新能力应尽早打通最短闭环：

```text
Project/Transaction
  → affected entities/ranges
  → Render IR
  → Preview kernel
  → Export kernel
  → oracle / diagnostic / resource report
```

不要先堆完整 API 壳层后再集成，也不要在 Demo 中手写一套绕过 Project/Render IR 的效果。

### Step 4：边界与失败

至少覆盖：空输入、边界时间、取消、过期 revision、unsupported capability、损坏媒体、backend lost、存储/编码失败、预算超限、反复 dispose。异常路径和成功路径必须具有同等级资源释放保证。

### Step 5：验证与报告

按风险选择测试层，完成后运行质量门禁和专项证据。性能结论必须绑定设备/浏览器/fixture；单次体感不能成为架构结论。

### Step 6：评审与落盘

PR 同时提交代码、测试、文档和小型证据。大型视频或报告按仓库阈值使用 artifact/LFS；Phase 0 固定的小型 CC0 corpus 与基准 WebM 可直接入库以保持 hermetic。

## 8. 分支、提交与评审

采用短分支、频繁集成的 trunk-based 流程：

- 主分支始终可构建、可测试；
- 普通功能分支尽量不超过 2–3 个工作日；
- 大能力以协议、fixture、backend、集成和开关拆分；
- 不把生成缓存、浏览器 profile、私有素材、令牌或稳定设备标识提交入库；
- 工作区可能包含他人改动，禁止用 destructive reset 清理不相关内容。

分支示例：

```text
feat/edit-trim-transaction
feat/material-authoring-sdk
fix/audio-transferable-ack
perf/webgpu-pipeline-cache
docs/adr-color-management
test/safari-ios-capability
```

提交采用精简 Conventional Commits：`feat`、`fix`、`perf`、`refactor`、`test`、`docs`、`build`、`ci`。

PR 必须说明：结果、Issue、协议影响、测试环境、正确性/性能证据、资源影响、浏览器差异、风险与回滚。纯格式化、生成 Schema 与功能逻辑应尽量分开。

## 9. 测试策略

### 9.1 测试金字塔

| 层级 | 目的 | 典型内容 |
|---|---|---|
| Unit/Property | 快速验证纯语义 | Time、canonical、Transaction、Graph、预算、queue |
| Contract | 锁定模块边界 | Time↔SampleIndex、ChangeSet↔IR、Encoder↔Mux/Sink |
| Browser | 验证真实平台原语 | WebCodecs、Worker、WebGPU/WebGL2、AudioWorklet、OPFS |
| Golden/Oracle | 验证输出语义 | 像素、shader identity、选帧、PCM、A/V sync |
| Vertical | 验证完整链路 | 固定 Project → Preview/Export → 独立回读 |
| Benchmark/Soak | 验证性能与资源 | fps、seek、Long Task、heap、反复 Session、10 分钟 |

### 9.2 本地质量门禁

```bash
corepack pnpm run ci
corepack pnpm test:browser
corepack pnpm test:browser:firefox
corepack pnpm test:golden
corepack pnpm bench
corepack pnpm format:check
```

`run ci` 已包含 format check、lint、typecheck、unit、Schema 与 build。浏览器测试需要本机启动安全上下文测试服务器；Capability Lab 依赖 cross-origin isolation headers。

### 9.3 证据命令

```bash
corepack pnpm report:browser:chromium
corepack pnpm report:browser:firefox
corepack pnpm report:capability:matrix
corepack pnpm report:seek
corepack pnpm report:performance
corepack pnpm report:vertical
```

报告生成失败不能通过手工修改 JSON 伪造通过。若测试断言全绿但进程/报告退出失败，仍作为门禁缺陷处理。

### 9.4 Flaky 处理

- 不用增加重试掩盖时序问题；
- 等待跨线程/Worklet/Worker 事件时等待可观察条件，并设置有意义的超时；
- 固定随机 seed、fixture hash、帧率与输出 profile；
- 浏览器崩溃、悬挂句柄和 unhandled error 都算失败；
- 只有确认外部实验环境不可用时才能标记 blocked，并记录 diagnostic。

## 10. 浏览器与 Capability 流程

任何新 codec、backend、存储或浏览器支持按以下流程进入：

1. API existence probe；
2. configuration-level `isConfigSupported` 或最小真实操作；
3. 目标 fixture 的功能 smoke；
4. 失败、取消、lost、dispose；
5. 性能与资源数据；
6. capability tier 与 preflight 规则；
7. 兼容矩阵和 ADR 评审。

不得根据 UA、Can I Use、Playwright WebKit 或另一平台同浏览器结果推断真机支持。Safari/iOS/Android 必须在批准设备上产出报告。

支持状态只有：

- `supported`：冻结组合有真实证据；
- `degraded`：语义保持但质量/能力显式下降；
- `unsupported`：当前配置明确不支持；
- `uncertified`：尚未在目标环境认证，不能当作支持。

## 11. Project 与 Transaction 变更流程

### Project Schema

- Project 是 normalized canonical snapshot，不是高频命令流；
- 新字段必须定义单位、默认值、缺省语义、引用完整性与 migration；
- map key 与 entity id 必须一致；
- 顺序语义只存在于明确的 id list；
- 大型派生数据、帧、波形、缩略图和缓存不得内嵌 Project；
- Project 不携带任意可执行代码。

### Transaction Operation

新原子编辑能力必须定义：

- 输入前置条件与 revision；
- 原子失败规则；
- inverse 或可证明的不可逆边界；
- affected entity ids 与 sequence ranges；
- undo/redo、合并和并发冲突；
- 对缓存、Preview、Export 的失效范围；
- property/sequence 测试。

复杂命令如 ripple、roll、slip、slide 应由复合 Transaction 完成，但只向订阅者提交一次 revision 和一次 ChangeSet。

## 12. Media 与时间流程

- 对外时间为安全整数微秒，帧率为有理数；
- sample 边界使用整数/有理数换算，不累计取整帧时长；
- SampleIndex 必须区分 presentation order 与 decode order；
- `presentationTimestampUs` 是 PTS；`normalizedDecodeTimeUs` 是内部单调时间，不能声称为 raw DTS；
- raw DTS 与 physical byte offset 必须由 capability 门控；
- exact seek 从同步样本开始，按冻结策略选择目标展示帧；
- 所有 decoder、chunk、VideoFrame/AudioData 有明确 owner；
- 新容器 adapter 必须进入 Range/CORS/损坏/取消 corpus。

## 13. Render 与 Material 开发流程

### 13.1 Render Node

新增核心渲染节点时必须定义：

- typed input/output；
- 时间、坐标、颜色、alpha 和边界语义；
- WebGPU/WebGL2/WASM requirement；
- Preview/Export 同一 evaluator；
- 纹理、pass、uniform、采样和内存静态成本；
- backend lost、降级与 diagnostic；
- 数值/像素 Golden 容差。

### 13.2 上层 Material

上层创作的 Filter、Transition、Effect、Generator 使用统一四层协议：

```text
Package → Definition → Graph → Instance
```

开发步骤：

1. 选择 `kind`、host slot、typed inputs/outputs；
2. 声明 parameter、resource、auxiliary input 与默认/边界；
3. 只用已注册 Core Node 组成 DAG；
4. 运行 Schema、类型、拓扑、预算和 backend lint；
5. 生成 canonical package、integrity 和 capability requirements；
6. 以固定输入做 Preview/Export Golden；
7. 测试最小/最大参数、缺资源、backend 缺失和降级；
8. 宿主注册 package 后由 Project `materialInstances` 引用。

Transition 必须是显式双输入；Mask/Matte 是 typed auxiliary input；多 pass 必须声明预算与 `skippable-when-degraded` 策略。任何未知 Material 都不能静默跳过。

trusted Shader/WASM 不属于普通声明式 Material。它需要宿主 allowlist、integrity/signature、CSP、安全评审和独立预算；网络下载的动态代码默认拒绝。

## 14. Audio 与播放流程

- 有声播放以 AudioContext/AudioWorklet 消费进度为主时钟；
- 视频调度追随音频，可丢弃过期帧，不能让 UI wall clock 反向驱动音频；
- cross-origin-isolated 优先 SAB ring；非隔离使用有界 acknowledged Transferable queue；
- seek 必须 flush PCM、增加 generation，并丢弃旧 generation 视频/音频结果；
- pause/resume/interruption/device change 必须进入状态机；
- Preview 与 Export audio mixer 使用同一 sequence/sample time base；
- block 边界自动化需要 sample-accurate 测试并避免爆音。

## 15. Export 开发流程

```text
Preflight
  → freeze Project revision / Render IR
  → offline frame & sample scheduler
  → renderer / audio mixer
  → VideoEncoder / AudioEncoder
  → streaming mux
  → bounded Sink
  → independent readback
```

要求：

- Preflight 在创建 encoder/GPU 大资源前完成；
- 每一级有队列上限并传播背压；
- 标准路径不聚合完整成片 Blob；
- 输出 profile 不可被静默替换；
- progress 单调、cancel 可传播；
- 存储不足、encoder failure 和取消都清理 partial output；
- 回读验证 codec、sample count、timestamp、duration、关键帧、抽帧、PCM 和 A/V sync；
- 导出期间 Project 可继续编辑，但当前任务只消费 frozen revision。

## 16. 性能与资源流程

### 16.1 性能变更

1. 固定设备、浏览器、fixture、分辨率、帧率和 warm-up；
2. 记录变更前 p50/p95/throughput/heap/queue；
3. 用 trace 区分 demux、decode、upload、GPU、readback、encode、mux、sink；
4. 实施优化；
5. 同环境至少复跑三轮，保存原始样本；
6. 若未达目标，通过范围/降级/ADR 处理，不能只修改目标数字。

### 16.2 资源清单

以下对象必须有 owner、上限与释放计数：

- Range 请求与 demux cache；
- decoder 与 VideoFrame/AudioData；
- Worker request、ImageBitmap、GPU texture/buffer/pipeline；
- PCM ring/queue/block；
- encoder queue 与 encoded chunk；
- mux pending writes、OPFS/File/Host Sink；
- WASM memory、Material resource、字体和代理缓存。

测试必须覆盖成功、取消、失败、backend lost 和多轮 Session。仅观察 JS heap 下降不足以证明 GPU/decoder 资源释放。

## 17. CI 与 Nightly

PR/push 门禁：

- format、lint、typecheck、unit、Schema、build；
- Chromium 和 Firefox source browser smoke；
- 真实 npm tarball Node consumer；
- public declaration/API snapshot compare。

Phase 1 release candidate 还必须运行真实 tarball browser consumer：从 `.tgz` 安装到干净 Vite 应用，在 Chromium/Firefox 实际启动 Worker、AudioWorklet 和公开 Session。workspace alias 的 browser smoke 不能替代该门禁。

Nightly/手动 evidence：

- Chromium/Firefox browser；
- deterministic Golden 与 benchmark；
- capability matrix；
- media seek；
- 1080p30 performance；
- 30 秒垂直导出及 WebM artifact；
- Phase 1 的 60 秒 edit/play/preview/export/独立回读与资源报告；
- JSON/WebM artifact 上传。

WebKit 安装或真机实验失败应产出 blocked record，但不能让矩阵显示为通过。若目标发布范围包含 Safari，则环境不可用是发布 blocker，而不是可以忽略的 CI warning。

## 18. 版本、迁移与发布

### 协议版本

- Project、Material Protocol、Material Package、Render IR 分别版本化；
- Render IR 是内部协议，可随 SDK 变化但必须通过 fixture migration；
- Project/Material 公共 Schema 采用 semver 兼容规则；
- patch 不改变既有字段/参数语义；
- migration 是纯数据变换，输入输出可 canonical hash 和审计；
- Project 锁定 Material package version + integrity。

### 发布层级

- **Phase evidence**：架构实验，不承诺公共 API；
- **Alpha**：允许公开试用，API 可能按迁移规则变化；
- **Beta**：协议与核心 API 基本冻结，支持矩阵和 SLO 有候选承诺；
- **1.0**：兼容策略、迁移、安全、许可、诊断和支持矩阵正式生效。

发布前必须有：release notes、breaking change/migration、SBOM/第三方许可、浏览器矩阵、已知限制、安全审计、API/Schema diff、Golden/benchmark diff、真实 tarball consumer 和回滚方案。详细 SemVer 与 breaking 判定见 [版本政策](versioning-and-breaking-changes.md)。

## 19. Goal 与 Exit Review

Goal 只用于一个有清晰完成条件的阶段目标。状态定义：

- **Active**：仍有安全可执行工作；
- **Complete**：Required Outcomes、门禁和 Exit Review 全部通过；
- **Blocked**：同一外部阻塞连续重复且没有安全替代路径；
- **Cancelled/Superseded**：方向被明确替代。

每次 Goal 更新应记录：已交付证据、关键数据、接受的 ADR、范围变化、新风险、下一关键路径。不能因为时间到期、Demo 成功一次或文档完成而标记 Complete。

Exit Review 必须回答：

1. 是否由 Project 驱动且可在新环境复现；
2. Preview/Export 是否同语义；
3. 时间、seek、A/V 与容器是否通过 oracle；
4. 队列/资源是否有界可释放；
5. Material 是否进入真实执行链；
6. 浏览器差异是否可解释；
7. 性能/内存是否绑定环境并可复跑；
8. ADR 和范围是否冻结；
9. 是否无数据、安全、资源或语义 blocker；
10. 下一阶段能否不推翻基础架构继续扩展。

## 20. 新开发者启动清单

1. 阅读 README、当前 Goal、ADR index 与对应 package README/类型；
2. 使用 Node 20.20.x、pnpm 10.13.1；
3. `corepack pnpm install --frozen-lockfile`；
4. `corepack pnpm run ci`；
5. 运行 Chromium/Firefox browser smoke；
6. 涉及发布边界时运行 `test:pack`、`test:consumer` 与 `release:dry-run`；
7. `corepack pnpm dev:lab` 查看 capability 与 diagnostics；
8. 选择一个 Ready Issue，确认 owner、依赖、oracle 和预算；
9. 先写失败测试/协议 diff，再做最短垂直实现；
10. PR 前跑相关 evidence，并检查工作区没有私有素材/缓存；
11. 由接口两端 owner 评审后进入 Integrated，目标浏览器报告入库后进入 Verified。
