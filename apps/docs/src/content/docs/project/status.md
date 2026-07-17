---
title: 当前版本状态
description: 查看源码版本、已经验证的范围、已知限制和仍需仓库之外完成的发布工作。
---

> 当前版本：`0.1.0-alpha.0 + Unreleased`
>
> 源码状态：核心编辑、预览、播放和导出链路已实现
>
> 发布状态：尚未发布 npm package、Tag 或 GitHub Release

## 现在可以怎么使用

当前源码可以运行一个完整浏览器剪辑流程：注册素材，创建和加载 Project，预览与播放，修改时间线并撤销，最后本地或远程导出。Project Builder、ProductionMediaProvider、Preview Canvas Controller 和参考编辑器都只使用公开包入口。

版本仍是 alpha，也还没有发布到 npm。它适合继续做产品集成、功能验证和目标设备测试；如果要对外承诺浏览器矩阵、长期 API 兼容或商业 SLA，还需要完成本页后半部分列出的认证和发布工作。

当前 `main` 的 GitHub CI 覆盖：

- format、Schema、lint、typecheck、unit/contract、build 和 API snapshot；
- 真实 tarball Node consumer 与 13 包 release dry-run；
- Chromium source browser suite；
- Firefox source browser suite 与真实 tarball browser consumer。

仓库还保存 Chromium、Firefox、Golden 和性能专项报告。可以重新生成的数据位于 [`reports/baseline`](https://github.com/FoyonaCZY/AelionSDK/tree/main/reports/baseline)，本页不复制容易过期的测试计数。

## 在哪里复核测试结果

| 目标                                                    | 证据入口                                              |
| ------------------------------------------------------- | ----------------------------------------------------- |
| 单元、契约、Schema、类型与构建                          | `corepack pnpm run ci`                                |
| Chromium / Firefox 真实平台原语                         | `browser-smoke-*.json` 与 GitHub CI                   |
| 真实包安装与 runtime assets                             | `tarball-consumer.json`、`test:pack`、`test:consumer` |
| Project → edit/play/preview/export/readback             | `alpha-60s.json`、`alpha-60s.webm`                    |
| exact seek 与媒体资源归零                               | `media-seek-chromium.json`                            |
| 1080p30、4K probe、Long Task、Export Worker、长时间资源 | `performance-1080p30-chromium.json`                   |
| 确定性像素                                              | `corepack pnpm test:golden`                           |
| Project/媒体不可信输入与资源预算                        | `corepack pnpm test:security`                         |
| 十分钟音频和大工程增量编译/长时间线求值                 | `corepack pnpm test:soak`                             |
| 发布包结构                                              | `corepack pnpm release:dry-run`                       |

## 已知边界

- 桌面 Chromium/Firefox 是当前自动化范围；Safari、iOS、Android 未认证。
- Windows、Linux 发行版和不同 GPU/driver 没有独立产品认证。
- 当前本地颜色执行是 RGBA8 SDR；HDR/PQ/HLG/10-bit 不会静默降级。
- 4K 有离线 compositor probe，没有跨设备 4K30 实时 SLA。
- `ByteMediaProvider` 适合短媒体；长视频使用内置 `ProductionMediaProvider`，并根据部署注入 cache/proxy 和共享资源预算。
- MP4/H.264/AAC 导出由具体环境 capability 和 AAC runtime canary 决定。
- trusted Shader/WASM 默认拒绝，签名不能替代宿主执行授权。
- Alpha 公共 API 仍可能按迁移规则变化。

## 源码完成不等于已经交付的事项

下面这些事情目前没有完成，不能因为 main 分支测试通过就对外宣称已经具备：

- npm trusted publishing、provenance、正式版本号、Tag 和 GitHub Release；
- Safari、iOS、Android 以及更广 OS/GPU 矩阵；
- 1.0 API/SLA、长期兼容承诺和商业支持策略；
- 非 Vite bundler 的官方适配与认证；
- 真实业务部署后的设备分层和多租户运行数据积累。仓库内已有加速 soak、资源预算与可复现性能采集，运行数据不作为缺失的引擎实现项。

## 本地复核命令

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run ci
corepack pnpm test:browser
corepack pnpm test:browser:firefox
corepack pnpm test:golden
corepack pnpm test:security
corepack pnpm test:soak
corepack pnpm bench
corepack pnpm test:pack
corepack pnpm test:consumer
corepack pnpm release:dry-run
```

证据报告由脚本生成。报告生成失败、进程非零退出、浏览器崩溃或资源未释放都算失败，不能通过手工编辑 JSON 改写结论。

## 关于历史 Goal 和 ADR

早期 Goal、Backlog、Exit Review 和 ADR 仍可从 Git 历史查到，但不再作为当前说明入口。现在以本页、[当前已经支持什么](/AelionSDK/start/capabilities/)、[引擎执行模型](/AelionSDK/concepts/architecture/)和[浏览器兼容性](/AelionSDK/production/compatibility/)为准。
