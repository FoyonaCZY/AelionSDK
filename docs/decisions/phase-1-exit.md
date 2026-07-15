# AelionSDK Phase 1 Exit Review

> 评审日期：2026-07-14  
> 评审状态：Accepted for Phase 1 source milestone；npm release pending  
> 对应 Goal：[Phase 1 可安装的 Alpha SDK](../GOAL-PHASE-1.md)  
> 证据索引：[Phase 1 Alpha Evidence](../evidence/phase-1-index.md)  
> 完成度审计：[Phase 1 完成度审计](../evidence/phase-1-completion-audit.md)  
> 兼容范围：[Phase 1 Alpha Matrix](../compatibility/phase-1-alpha-matrix.md)

## 1. 当前决议

AelionSDK `0.1.0-alpha.0` 的实现与冻结门禁已经满足 Phase 1 Required Outcomes：统一 `@aelion/sdk` 门面、高频原子编辑/history、多轨 premultiplied alpha-over、AudioWorklet Player、共享冻结 Render IR 的 Preview/Export、Material Authoring/Registry、13 个真实公开 tarball 和 Vite Worker/Worklet 分发均已落地。

最终 runner 在未改变源码身份的单一窗口中完成 14/14 命令，Chromium 59/59、Firefox 54/54、Golden 1/1、Node/Vitest 208/208，并刷新 exact-seek、1080p30/10-minute PCM 和 60 秒端到端 evidence。此前 Provider canceled queued load blocker已由请求/operation 上限、队列移除与专项回归关闭；独立预审发现的 Material UTF-8 路径碰撞与不可信 key coercion 也已修复，并由发现者在 pack/ZIP/verify/registry 四层复核通过。

Phase 1 源码工程里程碑接受：历史冻结 runner 14/14 通过，Provider resource blocker 与 Material UTF-8/no-coercion blocker 均已修复并通过专项复核。2026-07-15 的 MIT/真实 repository metadata 整理已由 CI、两浏览器源码测试、tgz consumer 和 release dry-run 另行验证。npm scope、真实 npm publish 和 provenance 仍属于后续发布动作。

## 2. 冻结认证范围

- Chromium 149/macOS：Tier A Alpha；Firefox 140/macOS：Tier B Alpha；
- Safari、iOS/iPadOS、Android：`uncertified`；
- 输入 MP4/H.264/AAC、WebM/VP9/Opus；输出 WebM/VP9/Opus；
- WebGL2 默认，WebGPU capability-selected experimental；
- SDR 8-bit、`srgb-linear`、normal premultiplied alpha-over；
- 60 秒 320×180/30 fps/48 kHz stereo 固定集成工程；
- declarative Material 默认；Shader/WASM 仅显式授权和 publisher allowlist；
- Vite 使用版本化 `@aelion/vite-plugin`；其他 bundler 未认证。

## 3. Required Outcomes 预签署

| Outcome | 状态 | 最终依据 |
|---|---|---|
| R1 开源与可分发 | Ready | MIT 与治理文件；13 包真实 GitHub metadata/exports/files；pack/consumer/release dry-run 全通过 |
| R2 `@aelion/sdk` API | Ready | Session/Player/Transaction/Preview/Export/Material/Capability/Diagnostic/Stats；API snapshot 通过 |
| R3 高频编辑 | Ready | insert/remove/move/trim/split/replace、Track Alpha 子集、atomic preparation/rollback/history tests |
| R4 多轨与 Player | Ready | 多轨/Transition parity；AudioWorklet；Provider/PCM/frame/request/chunk 有界与 cleanup evidence |
| R5 Material SDK | Ready | typed builders、DAG/budget、deterministic package、well-formed UTF-8 path、integrity、Registry/Resolver、trust、Golden |
| R6 Alpha DX/证据 | Ready | 公开 tgz consumer、Quick Start、59/54 browsers、seek/perf/60s fresh artifacts |
| R7 决策与退出 | Accepted for source milestone | ADR-012～015 Accepted；实现 runner、专项 reviewer 与开源提交验证形成闭环 |

## 4. 十项 Exit Review

| # | 问题 | 证据答案 |
|---:|---|---|
| 1 | 外部开发者能否只用公开 tarball 和文档完成接入？ | 是；13 包干净 consumer、public Vite plugin、两浏览器 build/run，无 source/workspace alias |
| 2 | 60 秒 Project 是否完成 edit → undo/redo → play/seek → preview → export → readback？ | 是；revision `0→1→2→3`、VP9/Opus、container + FFmpeg 双重回读 |
| 3 | Preview、Player 和 Export 是否共享冻结 Render IR、layer、Material 与 audio 语义？ | 是；IR parity、多轨/Transition pixel tests、Material Preview、frozen export/audio loop |
| 4 | 高频编辑是否原子、可逆、revision-safe？ | 是；commit preparation、validation/resolver/undo/redo rollback、canonical history tests |
| 5 | Player/Export 请求、PCM、frame、chunk 与 Sink 是否有界、可取消、可释放？ | 是；68/64/4 Provider 限额、PCM/Worker/Sink 上限、10-minute simulation、dispose 全清零 |
| 6 | Material 作者能否不改内核地创作、打包、校验和安装 declarative Material？ | 是；public Material SDK、3 examples、typed tests、Golden、Registry/Resolver |
| 7 | Material integrity 与 trusted-code 是否执行前 fail closed？ | 是；signed manifest bytes、tamper/budget/accessor/Unicode path/no-coercion/allowlist tests，Shader/WASM 默认拒绝 |
| 8 | API/协议版本和 breaking change 是否可审计？ | 是；API declaration snapshot、Project/Material schemas、breaking policy 与 CHANGELOG |
| 9 | 兼容矩阵是否只陈述实测范围？ | 是；Chromium Tier A、Firefox Tier B；Safari/iOS/Android 明确 uncertified |
| 10 | 是否没有数据损坏、安全、无界资源、包不可运行或 Preview/Export 分叉 blocker？ | 是；已发现 blocker均修复并复核，无已知 open release blocker |

## 5. 冻结证据与当前边界

- Source manifest：policy `3.1.0`，268 files / 2,485,843 bytes，SHA-256 `05c258c030ff2660829d7eb19d04db020be1cb5170cd10933ec7de9a25c3581c`；
- Runner：14/14 exit 0，pre/post identity 相同，postflight `passed: true`；
- 浏览器：Chromium 59/59、Firefox 54/54、Golden 1/1；
- 分发：13 个 tgz、3 个 runtime asset、Chromium/Firefox consumer、13 包 dry-run；
- Alpha：1,800 video frames、2,880,000 audio frames、A/V 尾差 333 μs；
- WebM：4,743,101 bytes，SHA-256 `b516854fceaade43e9c8cf46f8fe76531a40a395772b5ffda0d43f09f66e75c3`；
- 清理：Session disposed，media/renderer/player/audio/export/OPFS 资源归零。

以上 source manifest 与 14/14 是 2026-07-14 的实现冻结点，早于 MIT 和 repository metadata 迁移。当前 [`phase-1-gate-results.json`](../../reports/baseline/phase-1-gate-results.json) 是 2026-07-15 的诊断长跑：9 个 required gates 9/9 通过，但 Firefox evidence、seek 和 Alpha evidence 在同一进程窗口中出现瞬时失败，因此 postflight 为 `false`；三项随后独立重跑均通过。该诊断记录不替代历史冻结，也不被描述成当前 Git commit 的完整 14/14 绑定。

## 6. 明确保留项

以下不阻塞本 Alpha：ripple/roll/slip/slide 完整策略、Track solo、非 normal blend、mask/matte、完整文字、MP4 输出、WebGPU 持久管线、Remote Export、移动端/其他 OS-GPU、Material 公钥链/Marketplace、长视频/Proxy/协作、HDR/4K 与非 Vite adapter。

## 7. 首个开源提交范围

1. MIT 与 `FoyonaCZY/AelionSDK` metadata 全仓一致；
2. CI、真实 tgz consumer 与 release dry-run 通过；
3. 凭据与构建缓存未进入提交；baseline 中声明的测试 WebM 作为阶段证据保留；
4. 首个源码里程碑直接发布到空远端的 `main`；
5. npm 发布、Tag 与 GitHub Release 保持显式未执行。

## 8. 真实发布交接

阶段验收只表示 Phase 1 Complete、`0.1.0-alpha.0` 发布候选就绪。npm 发布仍需确认 scope，在受信 CI publish 13 包，并验证 registry tarball、dist-tag、依赖与 provenance。发布输入变化必须重新验证。
