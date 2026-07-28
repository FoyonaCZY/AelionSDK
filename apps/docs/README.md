# AelionSDK 文档站

# AelionSDK documentation

Astro Starlight documentation for AelionSDK, maintained next to the SDK source and deployed to GitHub Pages.

- English (default): <https://foyonaczy.github.io/AelionSDK/>
- 简体中文: <https://foyonaczy.github.io/AelionSDK/zh/>

The site uses Starlight's locale switcher. English is the default locale; the complete Chinese documentation is kept under `src/content/docs/zh/` so translated pages can evolve independently.

## Local development

```bash
corepack pnpm --filter @aelionsdk/docs dev
corepack pnpm --filter @aelionsdk/docs build
```

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
- 站内链接统一使用 `/AelionSDK/.../` 目录路由，不写 `.md`、`.mdx` 或跨目录相对地址。
- 合并前依次运行 `corepack pnpm run docs:check`、`corepack pnpm run build:docs` 和 `corepack pnpm run docs:check:built`；最后一步会检查所有生成页面的真实 `href`，并拒绝 API narrative 覆盖率低于按包基线。

API 生成使用与当前 Node 20 / Starlight 兼容的 `starlight-typedoc` 版本，入口为 `packages/*/src/index.ts`。生成目录已加入 `.gitignore`，每次构建前会清理，避免删除或重命名符号后残留旧页面。新增公开声明应带 TSDoc narrative；现有缺口记录在 `api-doc-coverage-baseline.json`，只能减少，不能增加。
