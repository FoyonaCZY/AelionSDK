---
title: 快速开始
description: 从媒体导入和 Project 创建开始，走通预览、编辑、播放与导出。
---

本指南使用公开包入口完成 Project 加载、能力探测、编辑、预览、播放和导出。示例面向 Vite + TypeScript 应用。

## 1. 环境与安装

AelionSDK 当前处于 `0.1.0-alpha.0` 源码阶段，尚未发布到 npm。发布后的安装方式是：

```bash
pnpm add @aelion/sdk @aelion/export
pnpm add -D @aelion/vite-plugin
```

源码开发需要 Node.js `>=20.19 <21`、Corepack 和仓库锁定的 pnpm：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run ci
```

生产页面使用 HTTPS。推荐启用 COOP/COEP 以获得 `SharedArrayBuffer` PCM 快速路径；没有跨源隔离时，SDK 会使用有界 Transferable fallback。

## 2. 配置 Vite

```ts
// vite.config.ts
import { aelion } from '@aelion/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [aelion()],
});
```

插件会在开发和生产构建中处理 module Worker 与 AudioWorklet 资源。不要引用包内 `dist` 路径，也不要把生产 URL 指向仓库 `src/*.ts`。

## 3. 从媒体创建 Project

Project 是可持久化 JSON snapshot；媒体 bytes、File、URL 凭据和 decoder 状态属于运行时，不进入 Project。

```ts
import { Aelion, ProductionMediaProvider, createProject } from '@aelion/sdk';

const media = new ProductionMediaProvider({
  maxConcurrentOperations: 4,
  maxPendingOperations: 64,
  maxCachedIndexes: 8,
});
media.registerFile('asset_main', file);

const project = createProject({
  projectId: 'my_project',
  sequenceId: 'main_sequence',
  width: 1920,
  height: 1080,
});
await project.importMedia({
  provider: media,
  assetId: 'asset_main',
  name: file.name,
});

const session = await Aelion.createSession({
  media,
  preferredBackend: 'webgl2',
  allowBackendFallback: true,
});
await session.loadProject(project.build());
```

`ProductionMediaProvider` 是 File/Blob、URL、OPFS 和长媒体的默认接入层。它按 range demux/decode，限制并发和 resident index，支持内容寻址 CacheStore，并在 Preview 请求中自动选择合适的 proxy；Export 始终使用 original。

```ts
media.registerUrl('asset_cdn', 'https://cdn.example.com/video.mp4', {
  headers: { Authorization: 'Bearer …' },
  contentHash: '0'.repeat(64), // 真实使用时填写内容的 SHA-256
});

media.registerUrl('asset_cdn', 'https://cdn.example.com/video-720p.mp4', {
  id: 'asset_cdn:proxy-720',
  role: 'proxy',
  width: 1280,
  height: 720,
  durationUs: 60_000_000,
});

await media.registerOpfs('asset_cached', 'imports/video.mp4');
```

URL 服务必须正确返回 `Accept-Ranges`/`Content-Range` 并允许页面 CORS。`contentHash` 可让 OPFS/Tiered Cache 跨 Session 复用 SampleIndex。`ByteMediaProvider` 仍可用于有明确大小上限的短素材或测试夹具。

## 4. 探测当前设备能力

```ts
const capabilities = await session.probeCapabilities();

if (!capabilities.gpu.webgl2.available) {
  throw new Error('This project requires WebGL2');
}

console.table({
  tier: capabilities.tier,
  isolated: capabilities.environment.crossOriginIsolated,
  audioWorklet: capabilities.audio.audioWorklet.available,
  opfs: capabilities.storage.opfs.available,
});
```

Capability 是当前环境和配置的结果，不是浏览器品牌白名单。导出前还需要针对输出 profile 调用 `preflight()`。

## 5. 原子编辑

优先使用语义命令。命令负责 Track lock、引用、时间映射、revision 和 ownership 校验。

```ts
const revision = session.revision;
if (revision === null) throw new Error('Project is not loaded');

session.transaction.commands.moveItem({
  itemId: 'item_closing',
  startUs: 28_500_000,
  baseRevision: revision,
  label: 'Move closing shot',
});

session.transaction.undo();
session.transaction.redo();
```

需要同时修改多个实体时使用一次 `edit`。全部 operation 一起验证、提交或回滚：

```ts
session.transaction.edit(
  edit => {
    edit.setField('items', 'item_closing', ['visual', 'opacity'], 0.95);
    edit.setField('materialInstances', 'mat_warm', ['parameters', 'intensity'], 0.8);
  },
  { label: 'Tune closing look', baseRevision: session.revision ?? undefined },
);
```

完整命令及语义见[能力全景](../capabilities/#时间线编辑)。

拖拽片段、裁剪手柄或连续调参时使用交互事务。每次 `update()` 都会立即发布新的 Project/Render IR，`commit()` 后只占一个 undo 项；Escape 等取消动作调用 `cancel()`：

```ts
const drag = session.transaction.beginInteractive({ label: 'Drag closing shot' });

drag.update(edit => {
  edit.setField('items', 'item_closing', ['range', 'startUs'], 28_000_000);
});
drag.update(edit => {
  edit.setField('items', 'item_closing', ['range', 'startUs'], 28_500_000);
});

// Pointer up:
drag.commit();
// Escape 则调用 drag.cancel()，不会留下 redo 分支。
```

一个 Session 同时只允许一个交互事务。交互期间不能启动普通 edit、undo 或 redo。

## 6. Preview 与 Player

```ts
import { attachPreviewCanvas } from '@aelion/sdk';

const canvas = document.querySelector<HTMLCanvasElement>('#preview');
if (canvas === null) throw new Error('Preview canvas is unavailable');

const preview = attachPreviewCanvas(session, canvas, {
  quality: 'adaptive',
  fit: 'contain',
});

// 连续调用时自动取消上一帧，只呈现最后一次 scrub。
await preview.render(15_000_000);

await session.player.seek(15_000_000);
// 在用户点击事件中调用，避免浏览器 autoplay policy 拒绝 AudioContext。
await session.player.play();
```

Controller 是 Player 的 frame owner，负责关闭 `ImageBitmap`、适配 Canvas/DPR、页面隐藏暂停恢复，并在持续掉帧时降低预览比例。`setQuality('full' | 'draft' | 'adaptive')` 可以覆盖策略。一个 Player 同时只能有一个 frame owner。

如果直接调用底层 `session.preview.renderFrame()` 或 `player.subscribe()`，`ImageBitmap` 仍归调用方，必须 `close()`。Export 不读取预览策略，始终按 Project 全尺寸执行。

## 7. 导出

大输出优先写入 OPFS 或宿主提供的流式 Sink：

```ts
import { OpfsSeekableSink } from '@aelion/export';

const sink = new OpfsSeekableSink('output.webm');
const controller = new AbortController();
const options = {
  sink: sink.writable,
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
  signal: controller.signal,
  cleanupSink: () => sink.cleanup(),
  onProgress: (progress: number) => console.log(Math.round(progress * 100)),
};

const preflight = await session.export.preflight(options);
if (!preflight.ok) throw new Error(JSON.stringify(preflight.issues));

const job = session.export.start(options);
try {
  const result = await job;
  const file = await sink.getFile();
  console.log(result.encoderConfiguration, file.size);
} catch (error) {
  await sink.cleanup();
  throw error;
}
```

导出在启动时冻结 Project revision 和 Render IR。之后的编辑不会改变正在生成的文件。`sink.getFile()` 会等待 WritableStream 的 host-side close 完成，因此导出 Promise 已 resolve 但 transferred close 消息仍在路上时也不会读到半成品。

`encoderConfiguration.video.targetBitrate` 和 `audio.targetBitrate` 是提交给 VBR 编码器的目标，不是最终文件逐轨实测值。需要核算成品码率时，应对输出容器做独立 SampleIndex/文件大小回读。格式不会被静默替换；codec、backend 或 Sink 不满足要求时，preflight 必须明确失败或按调用方策略选择另一 profile。

## 8. 诊断与清理

```ts
const unsubscribeSession = session.subscribe(event => {
  if (event.type === 'diagnostic') {
    console.warn(event.diagnostic.code, event.diagnostic);
  }
});

try {
  console.log(session.getSnapshot());
  const stats = session.getStats();
  console.log({
    preview: stats.preview,
    player: stats.player,
    export: stats.export,
    diagnostics: stats.diagnostics,
  });
} finally {
  preview.dispose();
  unsubscribeSession();
  await session.dispose();
  media.dispose();
}
```

不要解析英文 `message` 做业务分支；使用稳定的 `code`、`severity`、`recoverable` 和上下文字段。代码表见 [Diagnostic Codes](../../reference/diagnostic-codes/)。

Session 不拥有调用方注入的 MediaProvider，也不会自动删除成功导出的文件。调用方负责：

- 关闭收到的 `ImageBitmap`、`VideoFrame` 和 `AudioData`；
- 取消过期 Preview、seek 和 export；
- 释放订阅、Session、Provider、Sink 和临时文件；
- 在路由切换和页面隐藏策略中处理 AudioContext interruption。

## 9. 上线检查

- HTTPS、COOP/COEP、CSP 和媒体 CORS/Range 已在真实域名验证；
- 生产 bundle 能加载 Vite 插件发布的 Worker/AudioWorklet；
- `probeCapabilities()` 和 export preflight 的失败有可见 UI；
- Preview/Player bitmap 全部关闭，取消和 dispose 会清理 partial output；
- 大媒体使用 `ProductionMediaProvider`，CDN 已验证 CORS/Range，proxy 时长与原片一致；
- 支持声明与[兼容性文档](../../production/compatibility/)一致。

完整 File→Project→Canvas→H.264 示例由 CI 编译：[`examples/typescript/sdk-integration.ts`](https://github.com/FoyonaCZY/AelionSDK/blob/main/examples/typescript/sdk-integration.ts)。可运行参考编辑器位于 [`apps/editor-demo`](https://github.com/FoyonaCZY/AelionSDK/tree/main/apps/editor-demo)，只从公开包入口导入。
