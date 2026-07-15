# AelionSDK Phase 1 Goal：可安装的 Alpha SDK

> Goal 状态：Phase 1 源码工程与首个开源源码里程碑完成；npm 发布待后续执行  
> 启动日期：2026-07-13  
> 冻结门禁：2026-07-14 15:11:27–15:25:06（Asia/Shanghai）  
> 前置基线：[Phase 0 Exit Review](decisions/phase-0-exit.md)  
> 详细路线：[Phase 1 Backlog](phase-1-backlog.md)

## 1. Goal

> 在不推翻 Phase 0 Browser-first 架构的前提下，交付可安装的 `@aelion/sdk` 统一门面与稳定 Alpha API，打通 Project 加载、原子编辑/undo/redo、Player 精确播放、Material 注册与 Preview/Export 一键链路；补齐高频剪辑原子能力、真正多轨合成、Material Authoring SDK、安全与版本契约；修复 Worker/AudioWorklet 分发并通过真实 tgz consumer 测试；建立开源许可证、贡献/安全/变更文档、发布 CI 与兼容性范围，以自动测试、浏览器证据、性能报告、示例和 Exit Review 作为完成依据。

### 一句话成功定义

外部开发者可以从真实 npm tarball 安装 AelionSDK，仅使用公开 API 加载一个 60 秒以内的 Project，执行常用剪辑与 undo/redo，完成有声播放、Material 预览和 WebM 导出；同一流程在 Chromium/Firefox 的干净 consumer 应用中通过，失败组合在执行前给出稳定诊断。

## 2. Alpha 认证范围

- 桌面 Chromium 149/macOS：Tier A Alpha；
- 桌面 Firefox 140/macOS：Tier B Alpha；
- Safari、iOS Safari、Android：`uncertified`，本 Goal 不推断支持；
- 输入：MP4/H.264/AAC、WebM/VP9/Opus；
- 标准本地输出：WebM/VP9/Opus；
- 实时默认：WebGL2；WebGPU 保持 capability-selected experimental；
- SDR 8-bit、`srgb-linear`、normal premultiplied alpha-over；
- 固定集成工程：60 秒、320×180、30 fps、48 kHz stereo；
- Material：声明式 Graph 默认；Shader/WASM 仅在宿主显式授权和 publisher allowlist 下执行。

该范围是 Alpha 兼容边界，不是正式 SLA，也不认证长视频、4K/HDR、移动端或其他 OS/GPU。

## 3. Required Outcomes

### R1. 开源与可分发仓库

- [x] MIT、第三方声明、fixture 权利、CONTRIBUTING、SECURITY、CODE_OF_CONDUCT、CHANGELOG 完整；
- [x] 13 个公共包版本、metadata、ESM exports、`.d.ts`、files 与发布策略完整；
- [x] Worker/AudioWorklet 生产资源随包发布为 `.js`；
- [x] 真实 tarball 在干净 consumer 中 import、typecheck、build，并通过公开 `@aelion/vite-plugin` 在 Chromium/Firefox 运行；
- [x] pack、consumer 与 13 包 release dry-run 进入串行门禁。

### R2. `@aelion/sdk` Alpha API

- [x] `Aelion.createSession`、`loadProject`、`dispose`；
- [x] Transaction、语义编辑命令、undo/redo、revision conflict；
- [x] Player play/pause/seek/scrub 与帧回调；
- [x] Preview renderFrame 与 Export preflight/start/cancel；
- [x] Material registry/resolver；
- [x] capability、diagnostic、state/stats 订阅；
- [x] 7 个 declaration files、31 个 exported symbols 的 API 快照和 breaking-change 规则。

### R3. 高频剪辑原子能力

- [x] insert/remove/move/trim/split/replace Item；
- [x] Track reorder/lock/enabled/mute Alpha 子集；solo 明确保留；
- [x] 命令原子、可逆、revision-safe，并生成 affected entities/ranges；
- [x] validation、Material preparation、undo/redo preparation 失败时 Project、revision、history、Render IR、stats 与 event 均不泄漏；
- [x] 同步嵌套 transaction/history、listener 异常与 Session dispose/reload race 均 fail closed。

### R4. 多轨 Preview/Export 与 Player

- [x] 启用视觉轨按 Project 顺序执行 premultiplied alpha-over；Transition 后仍可合成后续轨道；
- [x] transform/crop/opacity、Item Material、Preview 与 Export 共用冻结 Render IR 和 frame evaluator；
- [x] AudioContext/AudioWorklet 为主时钟，视频追随；SharedArrayBuffer 与 Transferable fallback 均有界；
- [x] seek generation、预取、PCM、frame、Worker request、Export chunk/Sink 有背压、取消与释放；
- [x] `ByteMediaProvider` 使用 4 个并发、64 个底层等待 operation 和 68 个公开请求硬上限，取消排队请求可移除，clear/dispose 后归零；
- [x] 60 秒证据中媒体、renderer、player、audio、export 和 OPFS 临时输出全部清理。

### R5. Material Authoring SDK

- [x] typed Definition/Graph/parameter/port/resource builder 与静态预算校验；
- [x] canonical package、manifest、SHA-256 integrity；
- [x] package 路径必须是 well-formed Unicode，按 UTF-8 bytes 限长；ill-formed/collision 路径在 pack/ZIP/verify/registry 前 fail closed；
- [x] 不可信 transport Map key 不被字符串化，错误路径不会触发 `Symbol.toPrimitive`；
- [x] registry/resolver 按 package id/version/integrity 精确选择；
- [x] trusted-code 默认拒绝，宿主授权路径可审计；
- [x] Cross Dissolve、Warm Film、Soft Glow 示例、Golden 与错误用例进入 CI。

### R6. Alpha DX 与发布证据

- [x] consumer 只依赖公开 tgz，不使用 workspace alias、仓库源码或私有 transform；
- [x] Quick Start、COOP/COEP、MediaProvider、AbortSignal、资源所有权与 diagnostic 文档完整；
- [x] Node/Vitest 19 files、208/208；Chromium 10 files、59/59；Firefox 8 files、54/54；Golden 1/1；
- [x] exact seek 覆盖 5 个 MP4/WebM fixture，目标顺序、presentation oracle、重复次数与延迟样本绑定；
- [x] 1080p30 Material/Export、Long Task、heap、10 分钟等价 PCM 与资源释放报告通过；
- [x] 60 秒 Project 完成 edit → undo/redo → play/seek → preview → export → container/FFmpeg readback；
- [x] Safari/iOS/Android 始终为 `uncertified`。

### R7. 决策与退出

- [x] Alpha API、package strategy、multi-layer alpha、Material trust ADR Accepted；
- [x] Phase 0 证据不回退；
- [x] 所有 Required Outcomes 有代码、测试或明确范围决策；
- [x] 资源、安全、Material transport、分发与证据完整性已通过专项/机器复核；发现的 Provider queue 与 Unicode ZIP path blocker 已修复；
- [x] 实现冻结 runner 14/14 通过，作为 Phase 1 工程里程碑证据；
- [ ] MIT/repository metadata 迁移后的 npm publish、provenance、tag/release 仍是后续发布动作。

## 4. 明确保留项

以下不阻塞 `0.1.0-alpha.0`，但不得冒充已支持：

- ripple/roll/slip/slide、group/link/unlink 的完整高层策略；
- Track solo、非 normal blend、mask/matte、完整文字/字幕；
- WebGPU 持久 device/pipeline 与零拷贝呈现；
- MP4/H.264/AAC 统一输出、Remote Export；
- Safari/iOS/Android、Windows/Linux/其他 GPU 的独立认证；
- Material 公钥信任链、撤回、Marketplace；
- 长视频、Proxy、协作、HDR/P3/10-bit/4K；
- 非 Vite bundler 的正式 adapter 与 1.0 API 兼容承诺。

## 5. 历史冻结与开源输入复核

`corepack pnpm test:phase1:final` 对 workspace manifest SHA-256 `05c258c030ff2660829d7eb19d04db020be1cb5170cd10933ec7de9a25c3581c` 严格串行执行 14 条命令：

```bash
corepack pnpm run ci
corepack pnpm test:browser
corepack pnpm test:browser:firefox
corepack pnpm test:golden
corepack pnpm bench
corepack pnpm test:pack
corepack pnpm test:consumer
corepack pnpm release:dry-run
corepack pnpm format:check
corepack pnpm report:browser:chromium
corepack pnpm report:browser:firefox
corepack pnpm report:seek
corepack pnpm report:performance
corepack pnpm report:alpha
```

该历史冻结窗口 14/14 均 exit 0；门禁前后 268 个输入文件、2,485,843 bytes、policy `3.1.0` 与 manifest hash 完全一致，postflight 对 7 个输出 artifact 的 producer、语义、mtime、embedded timestamp、bytes/SHA 和 Alpha JSON/WebM 配对均判定 `passed`。

2026-07-15 为首次开源提交将 AelionSDK-owned code 与 13 个 package manifest 统一迁移到 MIT，并把 repository/homepage/bugs 指向 `FoyonaCZY/AelionSDK`。这会改变冻结 source identity，因此旧 hash 只代表实现冻结点，不代表当前 Git commit。

开源输入复核中，最新一次聚合 runner 的 9 个 required gates 全部通过，包括 CI、两浏览器源码测试、Golden、benchmark、pack、真实两浏览器 consumer、13 包 release dry-run 与 format check；Chromium 和 performance evidence 也在该长跑中通过。Firefox evidence、seek 与 Alpha evidence 在聚合长跑中分别因一次测试瞬时失败、cold seek p95 抖动和 15 分钟页面超时失败，随后独立重跑均通过：Firefox 54/54、seek 五类 fixture 满足预算且资源归零、60 秒 VP9/Opus 导出及 FFmpeg 回读完成。当前 [`phase-1-gate-results.json`](../reports/baseline/phase-1-gate-results.json) 保留这次失败的聚合长跑作为诊断记录，不冒充完整成功绑定；独立通过结果保存在对应 baseline artifact 中。

本阶段完成只代表源码工程验收与 `0.1.0-alpha.0` 发布候选就绪，不表示 npm 已实际发布。首次 npm 发布仍需确认 scope，在受信 CI 中 publish 并核验 provenance。
