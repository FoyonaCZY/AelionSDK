# AelionSDK Baseline Reports

此目录保存可提交、可复现的 Phase 0/Phase 1 原始基线。报告包含命令、环境、生成时间和 fixture/artifact hash（适用时）。本地 evidence 不代表已经创建 Git release 或向 npm registry 发布。

## Phase 1 证据状态

2026-07-14 的实现冻结曾在同一 source manifest 上完成 14/14；随后完成了 Provider queue、Material Unicode path/no-coercion 修复，以及 MIT/真实 GitHub metadata 迁移。旧 source hash 仅是历史冻结点，不等于首个 Git commit。

2026-07-15 的最新聚合 runner 对开源输入完成 9/9 required gates，但 Firefox evidence、seek 和 Alpha evidence 在长跑中分别出现瞬时测试失败、cold p95 抖动和页面超时，因此 `phase-1-gate-results.json` 的 postflight 正确为失败。三项之后独立重跑均成功，当前各自 baseline 是最新通过产物。不要把这些独立重跑拼接成一次 source-bound 的 14/14。

| 证据                                | 内容                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `phase-1-final-gates.json`          | 历史修复前聚合，仅用于追溯，不是当前退出结论                                                         |
| `phase-1-blocker-review.json`       | 历史审计模板，明确为 `not-approved`，不是当前批准文件                                                |
| `phase-1-gate-results.json`         | 2026-07-15 诊断长跑的 exact command、时间、exit code、输出摘要与失败 postflight                      |
| `tarball-consumer.json`             | 13 个真实 `.tgz`、公开 `@aelion/vite-plugin`、3 个 emitted runtime assets、Chromium/Firefox consumer |
| `browser-smoke-chromium.json`       | Chromium Phase 1 source suite：59/59 tests                                                           |
| `browser-smoke-firefox.json`        | Firefox 140 Phase 1 source suite：54/54 tests；独立重跑通过                                          |
| `media-seek-chromium.json`          | 五类媒体 exact seek；独立重跑通过，decoder/frame 资源归零                                            |
| `performance-1080p30-chromium.json` | 1080p30 Material/Export、Long Task 与 10 分钟等价 PCM                                                |
| `alpha-60s.json`                    | 60 秒公开 SDK edit/play/preview/export/readback、Long Task、queue 与 dispose 数据                    |
| `alpha-60s.webm`                    | 60 秒 WebM/VP9/Opus 成片，SHA-256 `b516854fceaade43e9c8cf46f8fe76531a40a395772b5ffda0d43f09f66e75c3` |

验证环境为 Node.js `v20.20.2`、pnpm `10.13.1`、macOS `15.6.1` x64。首次提交前仓库没有 Git HEAD，因此报告保存 workspace manifest，而不伪造 commit。当前产品结论和证据地图见[项目状态](../../apps/docs/src/content/docs/project/status.md)。

## Phase 0 历史基线

以下保留 Phase 0 当时的历史口径，不用 Phase 1 计数回写：

| 证据                                | 内容                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `capability-chromium.json`          | Chromium 配置级能力，Tier A                                                                 |
| `capability-firefox.json`           | Firefox 配置级能力，Tier B                                                                  |
| `capability-webkit.json`            | WebKit runtime blocker；不是支持报告                                                        |
| `media-seek-chromium.json`          | 五类 MP4/WebM index、cold/warm exact seek、资源与 SampleIndex capability                    |
| `performance-1080p30-chromium.json` | WebGL2/WebGPU/Soft Glow、导出、Long Task、10 分钟等价 PCM                                   |
| `vertical-slice-30s.*`              | 30 秒 Project → Export → 独立回读 JSON 与 WebM 成片                                         |
| `export-webm-vp9-opus.*`            | 1 秒基础导出与三层回读样例                                                                  |
| `clean-environment-2026-07-10.json` | 干净临时副本 install/build/test/Lab 复现                                                    |
| `model-render-2026-07-10.json`      | Phase 0 单元/浏览器/Golden/Render IR benchmark 摘要，其中记录 Chromium 38/38、Firefox 35/35 |

## 重新生成

Phase 1 完整串行门禁与聚合：

```bash
corepack pnpm test:phase1:final
```

单项证据：

```bash
corepack pnpm report:browser:chromium
corepack pnpm report:browser:firefox
corepack pnpm report:alpha
corepack pnpm report:capability:matrix
corepack pnpm report:seek
corepack pnpm report:performance
corepack pnpm report:vertical
```

报告不包含访问令牌、浏览器 profile 或可用于跨环境跟踪的稳定硬件标识。Safari/iOS/Android 未认证，不能由 WebKit blocked 记录或其他浏览器结果推断兼容。
