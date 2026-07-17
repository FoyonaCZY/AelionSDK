---
title: 开发与发布
description: 仓库环境、质量门禁、变更流程和发布检查。
---

本页面向仓库维护者。贡献者的行为与提交流程另见 [`CONTRIBUTING.md`](https://github.com/FoyonaCZY/AelionSDK/blob/main/CONTRIBUTING.md)。

## 环境

- Node.js `>=20.19 <21`
- pnpm `10.13.1`（由 Corepack 和 `packageManager` 锁定）
- Chromium/Firefox browser suite 需要可启动本机浏览器
- Capability Lab 和 SharedArrayBuffer 路径需要安全上下文与 COOP/COEP

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run ci
```

## 常用命令

| 命令                                 | 用途                                                       |
| ------------------------------------ | ---------------------------------------------------------- |
| `corepack pnpm run ci`               | format、Schema、lint、typecheck、unit、build、API snapshot |
| `corepack pnpm run docs:check`       | 检查全部 Markdown 本地链接                                 |
| `corepack pnpm run docs:typecheck`   | 编译文档引用的完整 TypeScript 集成示例                     |
| `corepack pnpm test:browser`         | Chromium source browser suite                              |
| `corepack pnpm test:browser:firefox` | Firefox source browser suite                               |
| `corepack pnpm test:golden`          | 确定性像素 Golden                                          |
| `corepack pnpm test:security`        | Project/媒体 fuzz、Package trust 与资源预算                |
| `corepack pnpm test:soak`            | 十分钟音频模拟和大工程增量编译/长时间线求值                |
| `corepack pnpm bench`                | 固定 benchmark                                             |
| `corepack pnpm test:pack`            | 真实 `.tgz` Node consumer                                  |
| `corepack pnpm test:consumer`        | 真实 `.tgz` Vite/browser consumer                          |
| `corepack pnpm release:dry-run`      | 13 个公开包的发布前检查                                    |
| `corepack pnpm dev:lab`              | Capability / Material Lab                                  |
| `corepack pnpm dev:editor`           | 只使用公开包 API 的参考剪辑器                              |

证据生成命令和产物说明位于 [`reports/baseline`](https://github.com/FoyonaCZY/AelionSDK/tree/main/reports/baseline)。

## 变更流程

### 1. 先定义语义

涉及持久化、时间、颜色、alpha、音频、公共 API、安全或浏览器支持时，先明确：

- 输入、输出、默认值和失败方式；
- owner、取消、dispose 和预算；
- Project/Transaction/Render IR/Material 的影响；
- capability、迁移和兼容性边界；
- correctness oracle、Golden 或独立回读方式。

### 2. 完成最短垂直链路

```text
Project / Transaction
  → affected entities and ranges
  → Render IR
  → Preview / Player / Export
  → diagnostic / oracle / resource report
```

不要在 Demo 中绕过 Project 或 Render IR 建立第二套效果逻辑。

### 3. 覆盖失败和资源路径

至少考虑：空输入、边界时间、过期 revision、取消、损坏媒体、不支持的 capability、backend lost、存储/编码失败、预算超限和重复 dispose。成功与失败必须有同等级的释放保证。

### 4. 按风险验证

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

- `quality`：完整 `pnpm run ci`、`test:pack`、`release:dry-run`；
- `browser-smoke`：Chromium；
- `firefox-smoke`：Firefox 和真实 tarball browser consumer。

Nightly/手动工作流额外运行 Golden、benchmark、capability、seek、performance 和 vertical evidence。失败不能通过手工修改生成 JSON 伪装成功。

## 版本与迁移

- Project、Material Protocol、Material Package 和 SDK 分别版本化。
- Patch 不改变现有字段、参数或错误码语义。
- 向后兼容的新可选字段通常属于 minor；删除、重命名、单位变化和默认语义变化属于 breaking change。
- Project/Material migration 必须是确定性纯数据变换，可 canonical hash 和测试。
- Alpha 允许 API 变化，但仍需 CHANGELOG、迁移说明和 declaration snapshot review。

## 发布门禁

发布候选至少需要：

- 全部 CI 与目标浏览器通过；
- 真实 `.tgz` Node 和 browser consumer 通过；
- 公开 exports、LICENSE、README、依赖重写和 runtime assets 正确；
- API/Schema diff、兼容矩阵、CHANGELOG、第三方许可和安全边界完成评审；
- Golden、性能和资源报告没有未解释回退；
- npm、provenance、Tag 和 Release 只在对应外部动作真实成功后声明。

## 文档规则

- 新的用户任务优先补充 Guide，不为每个 Issue 新建 Goal 文档。
- 长期架构约束更新[架构与执行模型](/AelionSDK/concepts/architecture/)，不再创建零散 ADR 文件。
- 当前支持范围只更新[兼容性与部署](/AelionSDK/production/compatibility/)。
- 阶段结果和可复现证据只更新[项目状态](/AelionSDK/project/status/)与 reports 索引。
- 已过期计划依靠 Git 历史追溯，避免现行文档同时存在多套口径。
