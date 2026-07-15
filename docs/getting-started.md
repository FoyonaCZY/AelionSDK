# 快速开始

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

## 3. 准备 Project 与媒体

Project 是可持久化 JSON snapshot；媒体 bytes、File、URL 凭据和 decoder 状态属于运行时，不进入 Project。

```ts
import { Aelion, ByteMediaProvider } from '@aelion/sdk';

const assetUrls = new Map([
  ['asset_opening', '/media/opening.mp4'],
  ['asset_music', '/media/music.webm'],
]);

const media = new ByteMediaProvider({
  maxCachedBytes: 64 * 1024 * 1024,
  maxConcurrentOperations: 4,
  maxPendingOperations: 64,
  resolveAssetBytes: async (assetId, signal) => {
    const url = assetUrls.get(assetId);
    if (url === undefined) throw new ReferenceError(`Unknown asset: ${assetId}`);
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Media fetch failed: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  },
});

const session = await Aelion.createSession({
  media,
  preferredBackend: 'webgl2',
  allowBackendFallback: true,
});

const project = await fetch('/projects/main.json').then(response => response.json());
await session.loadProject(project);
```

`ByteMediaProvider` 会完整读取 asset，适合短媒体和原型。大文件或 CDN 应实现 range-backed `AelionMediaProvider`，并提供：

- 可取消的 byte range 请求；
- 正确的 CORS、`Accept-Ranges` 和 `Content-Range`；
- 按媒体类型选择的零基 `streamIndex`；
- 明确的并发、缓存和 decoder 上限；
- asset identity、版本和 proxy variant。

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

完整命令及语义见[能力全景](capabilities.md#时间线编辑)。

## 6. Preview 与 Player

```ts
const canvas = document.querySelector<HTMLCanvasElement>('#preview');
const context = canvas?.getContext('2d');
if (canvas === null || context === null) throw new Error('Preview canvas is unavailable');

const frame = await session.preview.renderFrame({ timeUs: 30_000_000 });
try {
  canvas.width = frame.bitmap.width;
  canvas.height = frame.bitmap.height;
  context.drawImage(frame.bitmap, 0, 0);
} finally {
  frame.bitmap.close();
}

const unsubscribe = session.player.subscribe(event => {
  try {
    context.drawImage(event.result.bitmap, 0, 0);
  } finally {
    event.result.bitmap.close();
  }
});

await session.player.seek(15_000_000);
// 在用户点击事件中调用，避免浏览器 autoplay policy 拒绝 AudioContext。
await session.player.play();
```

`ImageBitmap` 在回调或 Promise resolve 后归调用方，必须 `close()`。拖动时间轴时应取消上一帧请求，避免过期工作占满 renderer queue。

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
  console.log(result, file.size);
} catch (error) {
  await sink.cleanup();
  throw error;
}
```

导出在启动时冻结 Project revision 和 Render IR。之后的编辑不会改变正在生成的文件。格式不会被静默替换；codec、backend 或 Sink 不满足要求时，preflight 必须明确失败或按调用方策略选择另一 profile。

## 8. 诊断与清理

```ts
const unsubscribeSession = session.subscribe(event => {
  if (event.type === 'diagnostic') {
    console.warn(event.diagnostic.code, event.diagnostic);
  }
});

try {
  console.log(session.getSnapshot());
  console.log(session.getStats());
} finally {
  unsubscribe();
  unsubscribeSession();
  await session.dispose();
  media.clear();
}
```

不要解析英文 `message` 做业务分支；使用稳定的 `code`、`severity`、`recoverable` 和上下文字段。代码表见 [Diagnostic Codes](reference/diagnostic-codes.md)。

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
- 大媒体使用 range provider，而不是无限放大 `ByteMediaProvider` 缓存；
- 支持声明与[兼容性文档](compatibility.md)一致。
