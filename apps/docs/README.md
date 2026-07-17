# AelionSDK 文档站

基于 Astro Starlight 的产品文档，随 SDK 源码一起维护并部署到 GitHub Pages。

```bash
corepack pnpm dev:docs
corepack pnpm build:docs
```

内容位于 `src/content/docs`。面向用户的 Guide 按任务组织；Reference 精确定义协议、诊断码和底层语义。合并到 `main` 后，`.github/workflows/docs.yml` 会构建并发布站点。
