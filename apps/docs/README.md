# AelionSDK 文档站

基于 Astro Starlight 的产品文档，随 SDK 源码一起维护并部署到 GitHub Pages。线上地址：<https://foyonaczy.github.io/AelionSDK/>。

```bash
corepack pnpm dev:docs
corepack pnpm build:docs
```

内容位于 `src/content/docs`。面向用户的 Guide 按任务组织；Reference 精确定义协议、诊断码和底层语义。合并到 `main` 后，`.github/workflows/docs.yml` 会构建并发布站点。

## 信息架构

| 目录         | 用途                                         |
| ------------ | -------------------------------------------- |
| `start`      | 安装、快速开始、包选择、参考编辑器、能力概览 |
| `concepts`   | Project、时间、事务、媒体生命周期和执行模型  |
| `guides`     | 构建剪辑器时可直接完成的用户任务             |
| `export`     | 本地/远程格式、Job、Sink 和清理              |
| `production` | 能力探测、兼容性、性能、安全、恢复和排障     |
| `reference`  | 稳定字段、命令、Profile、事件、协议和术语    |
| `project`    | 仓库状态、开发和发布流程                     |
| `api`        | 构建时从 13 个公开包生成，不提交 Git         |

## 写作规则

- 一个页面只解决一个明确问题；先给可执行路径，再解释边界。
- Guide 使用公开包入口，示例参数与当前 TypeScript 类型一致。
- 精确字段写入 Reference；长期机制写入 Concepts；兼容声明只写入 Production。
- 不复制会快速过期的测试数量、浏览器版本和 API 签名。
- 新公开 API 同时更新相应 Guide/Reference；API Reference 由 TypeDoc 自动生成。
- 内部相对链接必须通过 `corepack pnpm run docs:check`。
- 合并前运行 `corepack pnpm run build:docs`，检查导航、搜索索引和生成 API。

API 生成使用与当前 Node 20 / Starlight 兼容的 `starlight-typedoc` 版本，入口为 `packages/*/src/index.ts`。生成目录已加入 `.gitignore`。
