# Phase 1 完成度审计

> 审计日期：2026-07-14  
> 状态：Phase 1 implementation closed；首个开源源码里程碑完成  
> 依据：[Phase 1 Goal](../GOAL-PHASE-1.md)、[Exit Review](../decisions/phase-1-exit.md)、[Evidence Index](phase-1-index.md)  
> 规则：每个关闭项必须映射到冻结代码对应的 artifact；本地 dry-run 不冒充真实发布

## 1. 审计结论

Phase 1 的功能、分发、安全和证据实现已经收口。此前发现的 `ByteMediaProvider` canceled queued load 无界增长已通过请求/operation 双层硬上限、取消时队列移除、可取消 single-flight subscriber 和 clear/drain 语义关闭；专项回归已进入 208 项 Node/Vitest 和最终 60 秒资源快照。

2026-07-14 的最终 runner 对冻结源码 manifest `05c258c030ff2660829d7eb19d04db020be1cb5170cd10933ec7de9a25c3581c` 严格串行执行 14 条命令，全部 exit 0，pre/post source identity 相同，postflight 所有 freshness、semantic 和 Alpha media-pair checks 通过。独立预审发现的 Material UTF-8 路径碰撞与不可信 key coercion 已修复，并由发现者复核通过。

2026-07-15 的开源整理把仓库和 13 个包迁移到 MIT，并更新真实 GitHub metadata。该变化使实现冻结 hash 成为历史证据；开源输入已另行通过 CI、Chromium/Firefox 源码测试、tgz consumer 与 release dry-run。本审计不把 npm dry-run 冒充真实 publish。

## 2. 审计矩阵

| ID | 关闭依据 | 判定 |
|---|---|---|
| PKG-01 | 13 包统一 `0.1.0-alpha.0`、MIT、真实 GitHub metadata、ESM exports/`.d.ts`、public access 与 provenance 配置 | Closed |
| PKG-02 | Worker 和两个 AudioWorklet 随包 `.js` 发布；public Vite plugin production/dev smoke 通过 | Closed |
| PKG-03 | 真实 tgz consumer 无 workspace alias/source/private transform，独立 typecheck/build | Closed |
| PKG-04 | `test:pack`、Chromium/Firefox `test:consumer`、13 包 `release:dry-run` 全部 exit 0 | Closed |
| API-01 | `@aelion/sdk` 7 declaration files、31 exports 的 API snapshot compare 通过 | Closed |
| API-02 | Session/Transaction/Player/Preview/Export/Material/Capability/Diagnostic/Stats 统一门面 | Closed |
| API-03 | Project/IR/stats 深冻结；validation、resolver、undo/redo preparation 失败完整回滚 | Closed |
| API-04 | transaction/history reentrancy、listener exception、dispose/reload race fail closed | Closed |
| RES-01 | Provider max public requests 68、pending operations 64、concurrency 4；取消排队请求立即移除 | Closed |
| RES-02 | Player PCM、renderer/Worker requests、Export chunks/Sink 全部有界并支持 cancel/dispose | Closed |
| RES-03 | 10 分钟等价 PCM 无 underrun/线性 heap 增长；60 秒 dispose 后所有资源归零 | Closed |
| MAT-01 | typed authoring、DAG/budget、canonical package、integrity 与精确 Registry/Resolver | Closed |
| MAT-02 | 非授权 Shader/WASM 默认拒绝；tamper/missing payload/transport 边界测试通过 | Closed |
| MAT-03 | well-formed Unicode/UTF-8 byte path；pack/ZIP/verify/registry 拒绝 surrogate collision；Map key 不执行 coercion hook | Closed |
| TEST-01 | Node/Vitest 208/208、evidence scripts 21/21、Project Schema 28/28、Golden 1/1 | Closed |
| TEST-02 | Chromium 59/59、Firefox 54/54，无 failed/pending/todo | Closed |
| TEST-03 | exact seek 5 fixtures；1080p30/Long Task/heap/10-minute PCM 证据语义校验通过 | Closed |
| TEST-04 | 60 秒 facade edit/undo/redo/player/preview/export/FFmpeg readback/cleanup 通过 | Closed |
| EVD-01 | 14 个命令同一 runner 串行执行，7 个 artifact producer/mtime/timestamp/hash 被 postflight 绑定 | Closed |
| EVD-02 | workspace identity 拒绝非排除 symlink/special file，并精确绑定 policy 字段 | Closed |

## 3. 原子一致性专项结论

- Transaction 在 Project/revision 可见前准备派生 Render IR；preparation 或 publish 失败不改变 Project、revision、history、IR、stats 和 event。
- `IncrementalRenderCompiler.fork()` 只复用冻结基线，候选失败即丢弃；compile 期间 reentrant compile/clear 均拒绝，active baseline 不受污染。
- Session 在 Material resolver 同步 dispose/reload 或 replacement load pending 时不会复活 IR，也不会允许旧 Project 命令提交。
- `project-changed` listener 观察到的 Project revision、Render IR revision 与 history 已一致；listener 异常不把已提交编辑伪装成失败。

## 4. 门禁记录与当前复核

| 组 | 命令数 | 结果 |
|---|---:|---|
| CI、两浏览器、Golden、benchmark、pack/consumer、release dry-run、format | 9 | 9/9 exit 0 |
| Chromium/Firefox、seek、performance、Alpha evidence refresh | 5 | 5/5 exit 0 |
| 合计 | 14 | 14/14 exit 0 |

历史 runner 时间为 `2026-07-14T07:11:27.936Z`–`07:25:06.912Z`。输入为 268 files / 2,485,843 bytes，pre/post SHA-256 都是 `05c258c030ff2660829d7eb19d04db020be1cb5170cd10933ec7de9a25c3581c`。该身份早于 MIT 与仓库 metadata 迁移。

2026-07-15 对开源输入执行的新聚合 runner 中，前 9 个 required gates 为 9/9 exit 0；其后 Firefox evidence、seek 和 Alpha evidence 出现可复现记录完整的瞬时失败，故 [`phase-1-gate-results.json`](../../reports/baseline/phase-1-gate-results.json) 的 postflight 正确保持 `passed: false`。三项随后分别独立重跑成功，当前 baseline 为 Firefox 54/54、seek 五类 fixture 通过、60 秒 Alpha 导出/回读/清理通过。这里不把多个独立运行拼接成一次冻结源码的 14/14 绑定。

## 5. 开源里程碑动作

1. MIT 与真实 repository metadata 在根 manifest、13 个 public package、示例、文档和 consumer gate 中保持一致；
2. 首个源码里程碑通过 CI、tgz pack/consumer 与 13 包 release dry-run；
3. 首个 `main` commit 发布到 `FoyonaCZY/AelionSDK`；
4. npm publish、tag/release 与 provenance 另行执行。

## 6. 不阻塞本地 Phase 1 的外部事项

- 确认 npm scope 权限，在受信 CI 中 publish 13 包并验证 provenance；
- 创建 npm 发布对应的 tag/release；
- 对 Safari、iOS/iPadOS、Android、Windows/Linux、其他 GPU/driver 与其他 bundler另立认证；
- 对 ripple/roll/slip/slide、Track solo、非 normal blend、文字、Mask/Matte、MP4 输出、长视频/4K/HDR 另立 Goal。

冻结 artifact 保留为 Phase 1 实现证据；未来若要正式声明 npm release 与冻结 artifact逐字同一，则应在最终发布输入上重新执行完整门禁。
