---
title: 项目状态与证据
description: 当前版本成熟度、自动化证据和已知边界。
---

> 当前版本：`0.1.0-alpha.0 + Unreleased`
>
> 源码状态：Production Core 已实现
>
> 发布状态：尚未发布 npm package、Tag 或 GitHub Release

## 当前结论

AelionSDK 已具备完整的浏览器剪辑核心：Project/Transaction、专业时间线命令、TimeMap/Automation、Range 媒体接入、多轨画面与音频、Text/Caption、Material、Player、多格式本地/远程导出、缓存/代理和资源治理均已进入共享执行链。公开 SDK 还提供 Project Builder、媒体导入和自动托管 Canvas 的 Preview Controller；参考编辑器只依赖公开包入口。

当前 `main` 的 GitHub CI 覆盖：

- format、Schema、lint、typecheck、unit/contract、build 和 API snapshot；
- 真实 tarball Node consumer 与 13 包 release dry-run；
- Chromium source browser suite；
- Firefox source browser suite 与真实 tarball browser consumer。

Production Core 完成窗口还通过 Chromium、Firefox、Golden 和性能专项。精确、可重新生成的数据保存在 [`reports/baseline`](https://github.com/FoyonaCZY/AelionSDK/tree/main/reports/baseline)，不在本页复制容易过期的计数。

## 证据地图

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

## 本仓库之外的交付工作

以下事项不应从源码核心完成度中推断为已经交付：

- npm trusted publishing、provenance、正式版本号、Tag 和 GitHub Release；
- Safari、iOS、Android 以及更广 OS/GPU 矩阵；
- 1.0 API/SLA、长期兼容承诺和商业支持策略；
- 非 Vite bundler 的官方适配与认证；
- 真实业务部署后的设备分层和多租户运行数据积累。仓库内已有加速 soak、资源预算与可复现性能采集，运行数据不作为缺失的引擎实现项。

## 如何复核

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

## 历史说明

早期 Phase 0、Phase 1 和 Production Core 的 Goal、Backlog、Exit Review、ADR 与完成审计已经履行阶段性作用。它们的历史内容仍可从 Git 追溯；现行结论统一由本页、[能力全景](/AelionSDK/start/capabilities/)、[架构设计](/AelionSDK/concepts/architecture/)和[兼容性](/AelionSDK/production/compatibility/)维护。
