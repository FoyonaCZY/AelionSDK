# AelionSDK Phase 1 Alpha Evidence

> 证据日期：2026-07-14 历史冻结；2026-07-15 开源输入刷新  
> 状态：Phase 1 源码里程碑接受；首个开源提交就绪；npm 发布待后续执行  
> 候选版本：`0.1.0-alpha.0`  
> 历史冻结源码身份：`05c258c030ff2660829d7eb19d04db020be1cb5170cd10933ec7de9a25c3581c`

## 1. 结论摘要

Phase 1 的实现冻结 runner 曾在同一窗口严格串行执行 9 个 required gates 和 5 个 evidence refresh，共 14/14 exit 0。运行前后 workspace identity 完全一致：policy `3.1.0`、268 个输入文件、2,485,843 bytes；仓库当时没有 Git HEAD，因此只绑定 workspace manifest，不伪造 commit。该成功 runner 的原始 JSON 后来被 2026-07-15 的诊断长跑覆盖，历史 hash 与 artifact binding 仍保留在 `phase-1-blocker-review.json`，但后者本身是未签署模板，不能冒充 release approval。

本轮已验证统一 SDK 门面、原子编辑/history、真正多轨 Preview/Export、AudioWorklet Player、Material Authoring/Registry、13 个公开 tarball、公开 Vite 资源适配、精确 seek、1080p30 性能和 60 秒 VP9+Opus 导出。冻结后又完成 MIT/真实仓库 metadata 整理；旧 manifest hash 只代表实现冻结点，不代表许可证迁移后的 Git commit。

2026-07-15 的开源输入复核中，9 个 required gates 9/9 通过。聚合长跑后段的 Firefox evidence、seek、Alpha evidence 分别因瞬时测试失败、cold p95 抖动和页面超时失败，随后独立重跑均通过。当前聚合 JSON 因而保持 `postflight.passed: false`，各单项 baseline 则保存最新成功产物；本索引不会把多个独立运行拼接成一次新的 14/14 source binding。

本索引记录源码工程证据，不表示已经 npm publish 或生成真实 npm provenance。源码阶段成果托管于 `FoyonaCZY/AelionSDK`；Safari、iOS/iPadOS、Android、其他 OS/GPU 和其他 bundler 均未认证。

## 2. 历史冻结与当前诊断长跑

| 项目 | 结果 |
|---|---|
| 历史 runner | 14/14 成功原始 JSON 已被后续长跑覆盖；历史结果 hash 保留在 `phase-1-blocker-review.json` |
| 时间窗口 | 2026-07-14T07:11:27.936Z–07:25:06.912Z |
| 命令 | 14/14 exit 0，严格串行 |
| 输入身份 | policy `3.1.0`；268 files；2,485,843 bytes |
| Manifest SHA-256 | `05c258c030ff2660829d7eb19d04db020be1cb5170cd10933ec7de9a25c3581c` |
| Pre/post identity | 完全一致 |
| Runner postflight | `passed: true`；所有 7 个 artifact freshness/semantic/binding checks 通过 |

CI 内包含 format/schema drift/lint/typecheck、19 个 Node/Vitest 文件 208/208、Vite plugin production/dev smoke、证据脚本 21/21、Project Schema 专项 28/28、build 和 API snapshot。额外门禁包含 Golden、benchmark、pack、真实浏览器 consumer、13 包 publish dry-run 和最终独立 format check。

当前 [`phase-1-gate-results.json`](../../reports/baseline/phase-1-gate-results.json) 记录 2026-07-15T03:37:34Z–04:14:34Z 的诊断长跑：source identity 在该窗口前后均为 policy `3.1.0`、268 files、2,475,572 bytes、SHA-256 `b800d94fa10f059bbf66645cdeef020e95cd58fc2f621c5a26f5081b423ba67c`。前 9 个 required gates 全部 exit 0；Chromium 和 performance refresh 也通过，但 Firefox、seek、Alpha refresh 在该窗口失败，所以 postflight 正确为 `false`。当前提交后续还包含状态文档收口，因此该 hash 同样不宣称等于首个 Git commit。

## 3. 浏览器、包与 API

| 领域 | 最终证据 | 结果 |
|---|---|---|
| Chromium Tier A | [`browser-smoke-chromium.json`](../../reports/baseline/browser-smoke-chromium.json) | 10 files、59/59 tests；0 failed/pending |
| Firefox Tier B | [`browser-smoke-firefox.json`](../../reports/baseline/browser-smoke-firefox.json) | 独立重跑：8 files、54/54 tests；0 failed/pending |
| Golden | `corepack pnpm test:golden` | 1/1 |
| Public packages | [`tarball-consumer.json`](../../reports/baseline/tarball-consumer.json) | 13 个 `@aelion/*@0.1.0-alpha.0` tgz；精确 package SHA-256 |
| Runtime assets | 同上 | WebGL2 Worker + 2 个 AudioWorklet；URL/bytes/SHA-256 均绑定 |
| Tarball browsers | 同上 | Chromium 149、Firefox 140；cross-origin isolated；Worker/Worklet/Session 全通过，PCM underrun 0 |
| Release dry-run | 当前诊断 runner command record | 13/13 包通过；不等于真实 publish |
| SDK API | [`api-snapshot.md`](../../packages/sdk/api-snapshot.md) | 7 declaration files、31 exported symbols；compare 通过 |

consumer 在临时工程安装真实 tgz 和 Vite tgz，独立运行 `tsc --noEmit` 与 production build；不使用 workspace alias、repository source、hoisted Aelion dependency 或测试私有 transform。Vite 插件是显式 adapter，当前不声明其他 bundler 支持。

## 4. Seek、性能与有界资源

- [`media-seek-chromium.json`](../../reports/baseline/media-seek-chromium.json) 覆盖 moov-head、moov-tail、fragmented、non-zero PTS MP4 与 VFR WebM 共 5 个 fixture；固定 4 个 target 与重复顺序，presentation oracle、p50/p95/max 和样本绑定；结束时 active decoders 与 retained frames 均为 0。
- [`performance-1080p30-chromium.json`](../../reports/baseline/performance-1080p30-chromium.json) 记录 Warm Film WebGL2 p95 `28.935 ms`、WebGPU p95 `60.065 ms`、Soft Glow 四 pass p95 `81.555 ms`，每个 compositor dispose 后 pending/active request 均为 0。
- 5 秒 1080p30 Export 输出 150 video frames、240,000 audio frames，耗时 `2,045.885 ms`，约 `2.444×` realtime；steady-state >50 ms Long Task 为 0，codec initialization 单独披露 1 个 100 ms Long Task；Sink 最大 in-flight 为 1。
- 10 分钟等价 PCM 模拟播放 28,800,000 frames，固定 4,096-frame ring、32,800 bounded bytes、underrun 0；逐分钟 heap 样本未线性增长。
- `ByteMediaProvider` 将公开请求、底层等待 operation 和并发分别硬限制为 68/64/4；取消排队请求立即移除，single-flight subscriber 可取消，`clear()`/dispose 后 assets/cache/active/pending/in-flight 全部归零。
- Material package 路径在 UTF-8 编码前必须是 well-formed Unicode 并满足 byte 限制；pack、ZIP、verify、registry 统一拒绝 surrogate collision。非字符串 Map key 以固定错误拒绝，不调用不可信 coercion hook。

## 5. 60 秒公开 facade 链路

固定输入为 [`aelion-alpha-60s.project.json`](../../examples/aelion-alpha-60s.project.json)，当前 fixture SHA-256 `1e57dfc32789960e4a69f652ba610a4bbb2ef690d53cc8f3771ba5d4daece17b`。独立重跑生成的 [`alpha-60s.json`](../../reports/baseline/alpha-60s.json) 与 [`alpha-60s.webm`](../../reports/baseline/alpha-60s.webm) 记录：

| 指标 | 结果 |
|---|---:|
| Revision | load `0` → edit `1` → undo `2` → redo `3` |
| Player | seek/play/pause；5 帧；终态 paused |
| Preview | 320×180、WebGL2、Warm Film + Cross Dissolve |
| Export | 1,800 VP9 video frames、2,880,000 Opus audio frames、60,000,000 μs |
| WebM | 4,743,101 bytes；SHA-256 `b516854fceaade43e9c8cf46f8fe76531a40a395772b5ffda0d43f09f66e75c3` |
| 容器回读 | 1,800 video samples、3,001 audio samples；A/V 尾差 333 μs |
| Sink | 135 writes；最大 in-flight 1；closed；未 aborted |
| 外部回读 | FFmpeg 8.1 video/audio decode passed；frame-MD5 document SHA 与 PCM MD5 非空绑定 |
| Heap | live heap 增长约 34.2 MiB，低于 64 MiB evidence budget |
| 清理 | Session disposed；media/renderer/player/audio/export 队列归零；OPFS 临时文件删除 |

短素材通过 Project `boundary: loop` 扩展到 60 秒；该证据不等于原生长素材、跨设备或正式性能 SLA。

## 6. 当前 baseline artifact

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `browser-smoke-chromium.json` | 21,749 | `c9aa35276ed4d1e704f91addaae7c1c7d8da269cd1945d257bb13f5562ac2349` |
| `browser-smoke-firefox.json` | 19,613 | `be29ff4005d10e7cff29de7e5f63da30ece251a3b4a5152e025795a4129b18ea` |
| `media-seek-chromium.json` | 21,541 | `71a44689d7bcb063938180db3ee2f2cf599d618de11a3a91ad90f8b7cff460b9` |
| `performance-1080p30-chromium.json` | 8,758 | `bb06ce76470d978748fd40df0c72ba7c471976c430747cf207f12d3c73ccbe19` |
| `tarball-consumer.json` | 8,601 | `8fd6e37fc1485fd968a949539915bc71f8ba8931e9185bff8eb97809725942cd` |
| `alpha-60s.json` | 113,769 | `c74b428f36c997423d6736cabef025a98d7db98e34e7448cc5fe418d333a5a83` |
| `alpha-60s.webm` | 4,743,101 | `b516854fceaade43e9c8cf46f8fe76531a40a395772b5ffda0d43f09f66e75c3` |

这些文件来自聚合长跑和后续独立重跑的组合，不是同一 runner 直接绑定的 artifact set。`phase-1-gate-results.json` 保留失败长跑的原始命令记录；正式 npm 发布前应在最终发布 commit 上重新执行完整门禁并归档新的不可变结果。

## 7. 开源提交与真实发布边界

冻结后复核覆盖 resource bounds、cancellation/cleanup、Material transport integrity、public API/distribution 和 evidence integrity。Material reviewer 曾发现 UTF-16 surrogate 到 UTF-8 replacement-character 的 archive path collision，以及错误消息触发不可信 key coercion；两项均已修复，pack/ZIP/verify/registry 回归和发现者 reproducer通过。MIT/repository metadata 迁移后的验证结果以当前提交 CI、pack/consumer 和 release dry-run 为准。

Phase 1 工程证据只说明 `0.1.0-alpha.0` 发布候选就绪。npm 发布仍需确认 scope 权限，在受信 CI 中 publish 13 包并验证 provenance。许可证、repository metadata 或其他发布输入变化需要重新运行 CI、pack/consumer 和 dry-run；如需沿用完整冻结结论，则重新执行全部门禁。
