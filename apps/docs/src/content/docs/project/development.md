---
title: 维护仓库与准备发布
description: 给仓库贡献者的环境、常用命令、变更检查、CI 和发布前验收。
---

这篇文档面向修改 AelionSDK 本身的开发者。只接入 SDK 的产品团队不需要运行所有门禁；先看[安装与工程配置](/AelionSDK/start/installation/)。代码风格、提交和贡献流程另见 [`CONTRIBUTING.md`](https://github.com/FoyonaCZY/AelionSDK/blob/main/CONTRIBUTING.md)。

## 准备开发环境

- Node.js `>=20.19 <21`
- pnpm `10.13.1`（由 Corepack 和 `packageManager` 锁定）
- Chromium/Firefox browser suite 需要可启动本机浏览器
- Capability Lab 和 SharedArrayBuffer 路径需要安全上下文与 COOP/COEP

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run ci
```

## 常用命令

| 命令                                      | 用途                                                       |
| ----------------------------------------- | ---------------------------------------------------------- |
| `corepack pnpm run ci`                    | format、Schema、lint、typecheck、unit、build、API snapshot |
| `corepack pnpm run docs:check`            | 检查 Markdown 链接、发布状态和 13 个包 README              |
| `corepack pnpm run docs:check:built`      | 检查构建链接与 API 文档覆盖率防回退基线                    |
| `corepack pnpm run docs:typecheck`        | 编译文档引用的完整 TypeScript 集成示例                     |
| `corepack pnpm test:browser`              | Chromium source browser suite                              |
| `corepack pnpm test:browser:firefox`      | Firefox source browser suite                               |
| `corepack pnpm test:browser:webkit`       | WebKit capability/profile 公共合约 smoke                   |
| `corepack pnpm test:browser:mobile`       | 390×844、3× DPR、touch 目标 smoke                          |
| `corepack pnpm test:golden`               | 确定性像素 Golden                                          |
| `corepack pnpm test:security`             | Project/媒体 fuzz、Package trust 与资源预算                |
| `corepack pnpm test:soak`                 | 十分钟音频模拟和大工程增量编译/长时间线求值                |
| `corepack pnpm bench`                     | 固定 benchmark                                             |
| `corepack pnpm test:pack`                 | 真实 `.tgz` Node consumer                                  |
| `corepack pnpm test:consumer`             | 真实 `.tgz` Vite/browser consumer                          |
| `corepack pnpm release:dry-run`           | 13 个公开包的发布前检查                                    |
| `corepack pnpm release:reproducibility`   | 连续两次打包并验证 tarball 字节完全一致                    |
| `corepack pnpm release:version -- <版本>` | 原子同步工作区版本、内部依赖、锁文件、文档和 API 快照      |
| `corepack pnpm release:version:check`     | 检查所有版本化位置是否与根版本一致                         |
| `corepack pnpm dev:lab`                   | Capability / Material Lab                                  |
| `corepack pnpm dev:editor`                | 只使用公开包 API 的参考剪辑器                              |

证据生成命令和产物说明位于 [`reports/baseline`](https://github.com/FoyonaCZY/AelionSDK/tree/main/reports/baseline)。

## 开发一个引擎功能

### 先写清输入、结果和失败方式

涉及持久化、时间、颜色、alpha、音频、公共 API、安全或浏览器支持时，先明确：

- 输入、输出、默认值和失败方式；
- owner、取消、dispose 和预算；
- Project/Transaction/Render IR/Material 的影响；
- capability、迁移和兼容性边界；
- correctness oracle、Golden 或独立回读方式。

### 让功能走完整条执行路径

```text
Project / Transaction
  → affected entities and ranges
  → Render IR
  → Preview / Player / Export
  → diagnostic / oracle / resource report
```

Demo 只能调用公开能力，不能绕过 Project 或 Render IR 另写一套效果。否则页面上“看起来能用”，导出和真实 SDK 用户却得不到同样结果。

### 同时实现失败、取消和释放

至少考虑：空输入、边界时间、过期 revision、取消、损坏媒体、不支持的 capability、backend lost、存储/编码失败、预算超限和重复 dispose。成功与失败必须有同等级的释放保证。

### 按改动风险选择测试

- 纯语义：unit/property；
- 模块边界：contract；
- WebCodecs、Worker、GPU、AudioWorklet、OPFS：browser；
- 画面和声音：Golden/oracle；
- 完整产品链路：tarball consumer/vertical evidence；
- 队列、内存和吞吐：benchmark/soak。

`test:soak` 是适合 CI 的加速门禁：十分钟 PCM producer/consumer、1000 clips 增量编译和 5000 个长时间线求值点。Worker cancel/retry 与资源归零由 `test:browser` 覆盖。真实设备的小时级运行仍应使用 `report:performance` 捕获 heap、Long Task、GPU/decoder/Sink 资源并保存环境指纹；不能用加速模拟替代目标设备认证。

## 变更检查表

### Project / Transaction

- 新字段定义单位、缺省语义、引用和 migration；
- operation 定义 revision、inverse、affected ranges 和冲突规则；
- Project 保持纯 JSON，不嵌入缓存、帧、波形或可执行代码。

### Render / Material

- 节点定义 typed I/O、时间、坐标、颜色、alpha 和边界语义；
- WebGL2/WebGPU 使用同一 evaluator contract；
- pass、texture、uniform、采样和内存成本有上限；
- backend 缺失、lost 和降级返回稳定 diagnostic；
- Preview/Export 有 parity 或 Golden。

### Media / Audio / Export

- 时间换算不累计浮点误差；
- SampleIndex 不混淆 PTS、decode order 和未经证明的容器字段；
- decoder/frame/audio block/encoder chunk/Sink 有明确 owner；
- 每级队列传播背压和 AbortSignal；
- 输出 profile 不静默替换，partial output 可清理。

### 公共 API

- 更新类型、示例、API snapshot 和 CHANGELOG；
- Worker/AudioWorklet 入口通过真实 tarball consumer；
- capability 和兼容性文档不超出真实测试证据。

## CI

Push/PR 默认运行：

- `quality`：完整 `pnpm run ci`、`test:pack`、`release:dry-run` 和 tarball 可复现性；
- `browser-smoke`：Chromium；
- `firefox-smoke`：Firefox 和真实 tarball browser consumer。

Nightly/手动工作流额外运行 Golden、benchmark、capability、seek、performance、
持久恢复、Phase 3 严格校验和 vertical evidence。失败不能通过手工修改生成 JSON
伪装成功。

## 版本与迁移

- Project、Material Protocol、Material Package 和 SDK 分别版本化。
- Patch 不改变现有字段、参数或错误码语义。
- 向后兼容的新可选字段通常属于 minor；删除、重命名、单位变化和默认语义变化属于 breaking change。
- Project/Material migration 必须是确定性纯数据变换，可 canonical hash 和测试。
- 预发布版本允许有记录、可迁移的 API 变化，但仍需 CHANGELOG、迁移说明和 declaration
  snapshot review。
- 预发布版本（alpha、beta、rc）发布到 npm `next` 并创建 GitHub prerelease；不带
  prerelease 标识的版本发布到 npm `latest` 并创建正式 GitHub Release。脚本会根据
  版本自动选择渠道，调用者不能覆盖。
- 弃用必须先在类型、运行时 diagnostic、CHANGELOG 和迁移指南中同时声明。alpha、
  beta、rc 至少保留一个后续预发布版本；1.0 后至少保留一个 minor 或 90 天（取更长者），才可在
  下一个 major 删除。
- 发布版本先更新 `Unreleased` 内容并审核兼容性，再运行
  `corepack pnpm release:version -- <版本>`。命令失败会恢复所有已修改文件；成功后
  仍需审阅生成的锁文件和 API snapshot。

## 发布门禁

发布候选至少需要：

- 全部 CI 与目标浏览器通过；
- 真实 `.tgz` Node 和 browser consumer 通过；
- 公开 exports、LICENSE、README、依赖重写和 runtime assets 正确；
- API/Schema diff、兼容矩阵、CHANGELOG、第三方许可和安全边界完成评审；
- Golden、性能和资源报告没有未解释回退；
- npm、provenance、Tag 和 Release 只在对应外部动作真实成功后声明。

预发布版本使用 npm `next`，稳定版本使用 npm `latest`。发布提交必须先进入 `main`，并由
`corepack pnpm test:phase1:final` 生成与同一源码身份绑定的完整门禁记录。独立审阅
通过后，创建与根 `package.json` 版本完全一致的 `v*` Tag；Tag 会触发
`.github/workflows/release.yml`：

1. 先验证已提交的独立 blocker review，再用仓库锁定的 Node 20/pnpm 构建、复核并生成 13 个不可变 tarball；
2. 在 Node 24 的 GitHub-hosted runner 上发布并自动生成 provenance；
3. 从官方 registry 重新安装全部包并执行 Node import 与 Vite runtime-assets build；
4. 只有 registry smoke 成功后才创建附带 release manifest 与 tarball 的 GitHub
   Release；是否标记 prerelease 由版本自动决定。

现有 13 个 npm 包已经完成首发。后续发布应为每个包把 Trusted Publisher 精确绑定到
`FoyonaCZY/AelionSDK` 和 `release.yml`，由 GitHub Actions OIDC 发布并生成
provenance；确认全部绑定生效后，不应继续保留发布用 `NPM_TOKEN`。

新增包无法在首次发布前预配置 Trusted Publisher。只有这种 bootstrap 场景才创建
最小范围、短期有效的 granular access token 并暂存为 `NPM_TOKEN`；首发成功后立即
配置该包的 Trusted Publisher、验证 OIDC 发布路径并删除 token。不要把 bootstrap
token 当作常规发布凭据。

发布脚本会核对 tarball SHA-256/SHA-512；重跑时只接受 registry 上字节完全一致的
既有版本，不能覆盖已发布版本。

## 文档规则

- 新的用户任务优先补充 Guide，不为每个 Issue 新建 Goal 文档。
- 长期架构约束更新[架构与执行模型](/AelionSDK/concepts/architecture/)，不再创建零散 ADR 文件。
- 当前支持范围只更新[兼容性与部署](/AelionSDK/production/compatibility/)。
- 阶段结果和可复现证据只更新[项目状态](/AelionSDK/project/status/)与 reports 索引。
- 公开包必须提交包级 README；TypeDoc 每次生成前会清理旧投影，生成后按包检查
  declaration narrative 覆盖率，新增无说明的公开符号会让 CI 失败。
- 已过期计划依靠 Git 历史追溯，避免现行文档同时存在多套口径。
