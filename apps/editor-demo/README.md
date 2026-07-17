# Aelion Reference Editor

这是 `@aelion/sdk` 的产品集成样例，不是另一套编辑内核。应用只从公开包入口导入，覆盖：

- File → Range Provider → 自动媒体探测；
- 类型安全 Project Builder 与音视频联动导入；
- Canvas 实时预览、latest-wins scrub 和自适应画质；
- 片段选择、联动移动/分割、undo/redo；
- WebM VP9/Opus 与 MP4 H.264/AAC 本地导出。

```bash
corepack pnpm run build
corepack pnpm dev:editor
```

生产构建由根目录 `corepack pnpm run build:editor` 执行，并已进入 `ci`。Vite 配置没有源码 alias；Worker 与 AudioWorklet 由 `@aelion/vite-plugin` 从真实包出口处理。
