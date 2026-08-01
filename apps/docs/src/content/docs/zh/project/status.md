---
title: 当前版本状态
description: 查看已发布版本、验证证据、已知限制和后续认证工作。
---

> 当前版本：`1.2.0-rc.1`
>
> 源码状态：核心编辑、预览、播放和导出链路已实现
>
> 发布渠道：npm `next`、Git Tag `v1.2.0-rc.1` 和 GitHub prerelease

## 现在可以怎么使用

当前源码可以运行一个完整浏览器剪辑流程：注册素材，创建和加载 Project，预览与播放，修改时间线并撤销，最后本地或远程导出。Project Builder、ProductionMediaProvider、Preview Canvas Controller 和参考编辑器都只使用公开包入口。

当前版本是 1.2 Release Candidate，适合产品集成、功能验证和目标设备测试。RC 不等于所有
浏览器和设备都获得产品认证；如果要对外承诺更广浏览器矩阵、长期 API 兼容或商业
SLA，仍需完成本页后半部分列出的认证工作。

当前 `main` 的 GitHub CI 覆盖：

- format、Schema、lint、typecheck、unit/contract、build 和 API snapshot；
- 真实 tarball Node consumer 与 13 包 release dry-run；
- Chromium source browser suite；
- Firefox source browser suite 与真实 tarball browser consumer。
- Playwright WebKit 公共合约 smoke 与 390×844、3× DPR、触控移动目标 smoke。

仓库还保存 Chromium、Firefox、Golden 和性能专项报告。可以重新生成的数据位于 [`reports/baseline`](https://github.com/FoyonaCZY/AelionSDK/tree/main/reports/baseline)，本页不复制容易过期的测试计数。

最终发布候选由 `corepack pnpm test:phase1:final` 串行执行，并把命令结果、源身份和
产物 postflight 写入 `reports/baseline/phase-1-gate-results.json`。独立审阅者随后
对同一份源清单、门禁记录和证据集完成五项 blocker review，并在
`phase-1-blocker-review.json` 中签署 `approved`。

`1.2.0-rc.1` 已发布为 13 个 npm 包、Git Tag
[`v1.2.0-rc.1`](https://github.com/FoyonaCZY/AelionSDK/tree/v1.2.0-rc.1) 和
[GitHub prerelease](https://github.com/FoyonaCZY/AelionSDK/releases/tag/v1.2.0-rc.1)；
发布工作流同时生成 npm provenance 并完成 registry smoke。发布时的源代码、审阅
记录和证据以该不可变 Tag 为准；`main` 后续的文档或开发变更不改写这次发布结论。

## 发布身份

| 项目         | 值                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------- |
| 版本         | `1.2.0-rc.1`                                                                                      |
| npm dist-tag | `next`                                                                                            |
| 源提交       | `02b185d405dbb030df046cd6f58465e1ba1896f0`                                                        |
| 发布合并提交 | `5fb3b7743465c437c883a57012d7d7382f5f9ae2`                                                        |
| 发布工作流   | [GitHub Actions run 30343884270](https://github.com/FoyonaCZY/AelionSDK/actions/runs/30343884270) |
| 独立审阅结果 | `approved`                                                                                        |

安装和校验 registry/provenance 的命令见[安装与工程配置](/AelionSDK/zh/start/installation/#验证发布身份)。

## 在哪里复核测试结果

| 目标                                                    | 证据入口                                              |
| ------------------------------------------------------- | ----------------------------------------------------- |
| 单元、契约、Schema、类型与构建                          | `corepack pnpm run ci`                                |
| Chromium / Firefox 真实平台原语                         | `browser-smoke-*.json` 与 GitHub CI                   |
| 真实包安装与 runtime assets                             | `tarball-consumer.json`、`test:pack`、`test:consumer` |
| Project → edit/play/preview/export/readback             | `alpha-60s.json`、`alpha-60s.webm`                    |
| exact seek 与媒体资源归零                               | `media-seek-chromium.json`                            |
| 1080p30、4K probe、Long Task、Export Worker、长时间资源 | `performance-1080p30-chromium.json`                   |
| WebM/MP4 持久分段、中断恢复与 FFmpeg 语义哈希           | `recovery-chromium.json`                              |
| 确定性像素                                              | `corepack pnpm test:golden`                           |
| Project/媒体不可信输入与资源预算                        | `corepack pnpm test:security`                         |
| 十分钟音频和大工程增量编译/长时间线求值                 | `corepack pnpm test:soak`                             |
| 发布包结构                                              | `corepack pnpm release:dry-run`                       |
| 发布包字节可复现性                                      | `corepack pnpm release:reproducibility`               |

## 已知边界

- Chromium/Firefox、Playwright WebKit 公共合约和移动触控目标进入自动化；
  Safari、iOS、Android 实体设备仍未认证。
- Windows、Linux 发行版和不同 GPU/driver 没有独立产品认证。
- 当前本地颜色执行是 RGBA8 SDR；HDR/PQ/HLG/10-bit 不会静默降级。
- 4K 有离线 compositor probe，没有跨设备 4K30 实时 SLA。
- `ByteMediaProvider` 适合短媒体；长视频使用内置 `ProductionMediaProvider`，并根据部署注入 cache/proxy 和共享资源预算。
- H.264/AV1/HEVC MP4 导出由精确 codec capability、尺寸协商和 AAC runtime
  canary 决定。
- WebM/MP4 可以通过 `exportResumableMuxed()` 和 IndexedDB 原子 checkpoint
  从第一个未提交单元继续；普通 Session 导出不会自动选择业务 Job ID。
- trusted Shader/WASM 默认拒绝，签名不能替代宿主执行授权。
- RC 公共 API 在首个稳定版本前仍可能按迁移规则变化。

## 源码完成不等于已经交付的事项

下面这些事情不属于本次 1.2 RC 的承诺，不能因为 main 分支测试通过就对外宣称
已经具备：

- Safari、iOS、Android 以及更广 OS/GPU 矩阵；
- 1.0 API/SLA、长期兼容承诺和商业支持策略；
- 非 Vite 宿主已有显式 runtime-assets 合约，但逐 bundler 产品认证仍未完成；
- 真实业务部署后的设备分层和多租户运行数据积累。仓库内已有加速 soak、资源预算与可复现性能采集，运行数据不作为缺失的引擎实现项。

## 本地复核命令

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run ci
corepack pnpm test:browser
corepack pnpm test:browser:firefox
corepack pnpm test:browser:webkit
corepack pnpm test:browser:mobile
corepack pnpm test:golden
corepack pnpm test:security
corepack pnpm test:soak
corepack pnpm bench
corepack pnpm test:pack
corepack pnpm test:consumer
corepack pnpm release:dry-run
corepack pnpm release:reproducibility
corepack pnpm test:phase1:final
```

证据报告由脚本生成。报告生成失败、进程非零退出、浏览器崩溃或资源未释放都算失败，不能通过手工编辑 JSON 改写结论。

## 关于历史 Goal 和 ADR

早期 Goal、Backlog、Exit Review 和 ADR 仍可从 Git 历史查到，但不再作为当前说明入口。现在以本页、[当前已经支持什么](/AelionSDK/zh/start/capabilities/)、[引擎执行模型](/AelionSDK/zh/concepts/architecture/)和[浏览器兼容性](/AelionSDK/zh/production/compatibility/)为准。
