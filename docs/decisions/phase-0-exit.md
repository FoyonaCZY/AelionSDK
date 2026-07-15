# AelionSDK Phase 0 Exit Review

> 评审日期：2026-07-13  
> 评审状态：Accepted  
> 对应 Goal：[Phase 0 架构验证](../GOAL.md)  
> 认证范围依据：[ADR-011](../adr/011-phase-0-certified-scope.md)

## 1. 结论摘要

Phase 0 的 browser-first 技术骨架已经形成完整证据链：Aelion Project 经原子事务生成增量 Render IR，MP4/WebM 媒体可随机访问解码，Material Graph 在 Worker GPU 后端执行，AudioWorklet/AudioContext 提供播放主时钟，冻结 revision 可逐帧流式导出 WebM/VP9/Opus，并由独立实现完整回读。

本次评审只认证冻结范围，不把“浏览器存在某 API”扩大为产品支持承诺：

- Chromium 149 / macOS：Tier A；
- Firefox 140 / macOS：Tier B；
- Safari、iOS Safari、Android：Phase 0 未认证，进入 Phase 1 真机门禁；
- 输入：MP4/H.264/AAC、WebM/VP9/Opus；
- 标准本地输出：WebM/VP9/Opus；
- 实时 1080p30 默认候选为 WebGL2；WebGPU 在 Phase 1 优化后重评；
- SDR 8-bit、模板短视频和最长约 10 分钟时间线；
- trusted Shader/WASM 只允许宿主 allowlist 授权。

Safari/WebKit 没有被伪造为通过。Playwright WebKit 运行时不可用的事实已记录在 `capability-webkit.json`；系统 Safari 的 Remote Automation 未开启，因此不构成 Phase 0 认证证据。

## 2. 固定垂直场景

30 秒垂直工程由 Project Document 驱动，而非演示层手写渲染图：

- 2 路真实视频、1 路音频，含 transform/opacity；
- Warm Film Filter 与 Cross Dissolve Transition 进入同一 Material/Render IR 执行链；
- Transaction 同时修改 Item 与 Material 参数，revision 从 0 变为 1；
- 增量编译只重编译 1 个 clip，复用 2 个 clip 与 1 个 transition；
- 离线输出 900 个视频帧、1,440,000 个音频帧；
- Sink 共 69 次写入，最大并发写入为 1；
- 回读得到 900 个视频 sample、1,501 个音频 sample；
- 视频尾与音频尾差为 333 μs；
- FFmpeg 完整解码视频和音频并生成内容 hash；
- compositor、decoded bitmap、PCM 引用和 OPFS 临时输出完成释放或清理。

主证据：[vertical-slice-30s.json](../../reports/baseline/vertical-slice-30s.json) 与 [vertical-slice-30s.webm](../../reports/baseline/vertical-slice-30s.webm)。

## 3. Required Outcomes 评审

| Outcome | 结论 | 核心证据 | 保留到 Phase 1 的事项 |
|---|---|---|---|
| R1 工程与门禁 | 通过 | pnpm workspace、strict TS、CI/nightly、干净副本复现记录 | 首次远端 CI 链接在仓库发布后补充 |
| R2 Project/Time/Transaction | 通过 | Schema、canonical、属性测试、原子提交/inverse/ChangeSet | 扩大公开编辑命令面 |
| R3 MP4/WebM Seek | 通过 | 五类 corpus、exact seek、AAC/Opus PCM、稳定 diagnostics、资源归零 | raw DTS/byte offset 按 ADR-010 capability 扩展 |
| R4 Worker GPU/Render IR | 通过 | WebGPU/WebGL2、双输入转场、Soft Glow 四 pass、lost/fallback、最多 8 pending | 持久 WebGPU device/pipeline、零拷贝呈现 |
| R5 AudioWorklet Clock | 通过 | SAB ring、Transferable fallback、音频主时钟视频调度、seek generation、10 分钟 0 underrun | 真机 interruption、更多输出设备切换测试 |
| R6 Streaming Export | 通过 | revision freeze、preflight、VP9/Opus、OPFS、失败注入、FFmpeg 回读 | MP4/H.264/AAC 按 capability 扩展；消除主线程 Long Task |
| R7 Material Runtime | 通过 | 四层协议、实例参数/关键帧/绑定/预算、三示例、WebGPU/WebGL2、稳定 diagnostics | Material SDK/Studio、节点数学规范与第三方签名分发 |
| R8 Compatibility/Performance | 通过（收缩范围） | Chromium Tier A、Firefox Tier B、固定设备数据、ADR-011 | Safari/iOS/Android 真机认证是 Phase 1 P0 |
| R9 ADR/Scope | 通过 | ADR-001～011 全部 Accepted；本记录与 Phase 1 backlog | 重大范围变化继续通过新 ADR 管理 |

## 4. 十项 Exit Review

| # | 问题 | 答案 | 依据 |
|---:|---|---|---|
| 1 | 垂直场景是否由 Project 驱动并可在新环境复现？ | 是 | 30 秒 fixture、干净临时副本复现记录 |
| 2 | Preview/Export 是否共用 Render IR 与核心语义？ | 是 | 同一 frozen IR frame evaluator 与 Material kernel 测试 |
| 3 | 时间、Seek、A/V sync 和容器是否通过 oracle？ | 是 | 五 corpus seek；30 秒回读；333 μs 尾差；FFmpeg 完整解码 |
| 4 | 队列和关键资源是否有界、可取消、可释放？ | 是 | Worker 最多 8 pending；Sink 最大并发 1；ring 32.8 KiB；失败/取消清理 |
| 5 | Material 是否从上层协议进入真实执行链？ | 是 | Definition/Graph/Instance → compiler → Render IR → Worker GPU |
| 6 | 浏览器差异是否由 capability/preflight/diagnostics 解释？ | 是 | Chromium/Firefox 报告、WebKit blocked 记录、codec/backend diagnostics |
| 7 | 性能与内存数据是否绑定环境且可复跑？ | 是 | 固定参考设备、报告命令、fixture、heap/资源采样 |
| 8 | 关键 ADR 和认证范围是否冻结？ | 是 | ADR-001～011 Accepted，ADR-010/011 收口索引与认证边界 |
| 9 | 是否不存在数据损坏、安全、无限资源或语义分叉 blocker？ | 是 | 回读、trusted-code deny、预算/背压、Preview/Export parity 门禁 |
| 10 | Phase 1 是否可不推翻基础架构继续扩展？ | 是 | [Phase 1 Backlog](../phase-1-backlog.md)沿 Project/Transaction/IR/Material 插件点扩展 |

## 5. 性能与资源结论

参考环境：MacBookPro16,1，Intel Core i7 2.6 GHz 6 核，16 GiB，macOS 15.6.1，Chrome 149.0.7827.201。

| 指标 | 最新结果 | Phase 0 判断 |
|---|---:|---|
| MP4/WebM cold exact seek 最坏 p95 | 207.07 ms | 达到候选 ≤ 350 ms |
| MP4/WebM warm exact seek 最坏 p95 | 12.59 ms | 达到候选 ≤ 100 ms |
| 最大单次 seek 解码 packet | 30 | 放大有界 |
| Warm Film WebGL2 1080p | 51.09 fps | 作为实时默认候选 |
| Warm Film WebGPU 1080p | 27.83 fps | 未达到 30 fps，Phase 1 优化后重评 |
| Soft Glow WebGL2 四 pass | 13.39 fps | 离线完整；预览降分辨率或显式降级 |
| 1080p30 5 秒导出 | 2.36× realtime | 达到候选 ≥ 1× |
| 10 分钟等价 PCM | 0 underrun，固定 32.8 KiB ring | 无随时长线性增长 |
| 30 秒导出 A/V 尾差 | 333 μs | 通过 |
| 导出主线程 Long Task | 1 次，最大 93 ms | 不影响离线正确性；阻止转为发布 SLA，列入 Phase 1 P0 |

这些数据是架构验证基线，不是 SDK 对外 SLA。

## 6. 最终质量门禁

以下命令已于 2026-07-13 全部返回 0：

```bash
corepack pnpm run ci
corepack pnpm test:browser
corepack pnpm test:browser:firefox
corepack pnpm test:golden
corepack pnpm bench
corepack pnpm format:check
```

结果：

- `corepack pnpm run ci`：通过；13 个单元测试文件、84 个测试全部通过，3 个 Material 包与 Project 示例通过校验，构建通过；
- `corepack pnpm test:browser`：通过；Chromium 38/38；
- `corepack pnpm test:browser:firefox`：通过；Firefox 35/35；
- `corepack pnpm test:golden`：通过；1/1；
- `corepack pnpm bench`：通过；1,000 clips 普通字段事务均值 0.504 ms、Schema 校验事务 7.782 ms、增量 no-op 1.446 ms、冷编译 101.24 ms；
- `corepack pnpm format:check`：通过。

Exit Review 十项均为“是”，R1～R9 已完成，没有数据损坏、安全、无限资源或 Preview/Export 语义分叉 blocker。Phase 0 正式退出。

## 7. 已知限制与非阻塞项

- Safari/iOS/Android 未认证，不能由 WebKit、UA 或单项 API probe 推断支持；
- Chromium 当前参考配置不支持 H.264 1080p encode；Firefox 不支持 AAC encode；标准输出因此冻结为 VP9/Opus WebM；
- Firefox 无 WebGPU 与 File System Access save picker，但 WebGL2、OPFS、VP9/Opus 路径满足 Tier B；
- raw DTS 与 physical byte offset 在当前 Mediabunny adapter 不可用，调用者必须检查 SampleIndex capability；
- WebGPU 当前实现慢于 WebGL2，不能作为实时默认；
- 5 秒离线导出观察到一次 93 ms 主线程 Long Task；
- HDR/P3、长视频、移动端本地导出、任意网络 Shader/WASM 不在认证范围。

上述项目都已通过范围限制、显式降级或 Phase 1 backlog 处理，不构成 Phase 0 架构 blocker。
