# `@aelion/sdk` Alpha Quick Start

本页面向首次把 Aelion 接入浏览器应用的开发者。示例只使用公开包入口，不导入仓库 `src` 或 workspace alias。

## 1. 安装与运行要求

```bash
pnpm add @aelion/sdk @aelion/export
pnpm add -D @aelion/vite-plugin
```

Vite 项目添加官方集成：

```ts
// vite.config.ts
import { aelion } from '@aelion/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [aelion()],
});
```

`aelion()` 会在 `vite dev` 和 `vite build` 中处理 Aelion 的 module Worker 与两个 AudioWorklet 入口。不要手工复制 `node_modules/@aelion/*/dist`，也不要把 URL 改成 workspace `src/*.ts`。

推荐环境：TypeScript 5.8+、ESM bundler、secure context，以及已配置 COOP/COEP 的页面。当前认证边界是桌面 Chromium Tier A 与 Firefox Tier B candidate；Safari、iOS、Android 未认证。完整范围见[兼容性矩阵](../compatibility/phase-1-alpha-matrix.md)。

`@aelion/sdk` 默认内置 Project v1 与 Material Instance v1 Schema。高级宿主可以通过 `schemas` 覆盖进行协议迁移测试，但普通接入不需要复制 schema 文件。

`loadProject()` 会先把调用方对象捕获成 ownership-isolated、纯 JSON snapshot，再进入 Schema 与引用校验；它不会调用 accessor getter 或自定义 iterator。为防止不可信工程在 Ajv 前放大 CPU/内存，Alpha 准入上限为：深度 64、JSON value 262,144、单数组 16,384 项、单对象 4,096 个属性、单字符串 4 MiB、全部字符串 UTF-8 payload 合计 16 MiB。公开 Project v1 Schema 对数组和开放对象声明相同边界；超限返回 `PROJECT_INPUT_LIMIT_EXCEEDED`。稀疏数组、accessor、symbol、循环/共享对象别名及非 canonical number 返回 `PROJECT_INPUT_INVALID`。

## 2. 准备 Project 和媒体

Project 是可持久化 JSON snapshot，媒体 bytes/File/凭据不放入 Project。以下 fixture 使用 runtime binding；业务以 asset ID 绑定 URL：

```ts
import { Aelion, ByteMediaProvider } from '@aelion/sdk';

// This minimal snippet expects a valid Project without required Material, or a
// Project whose programs have already been registered as shown below.
const project = await fetch('/projects/basic.project.json').then(response => {
  if (!response.ok) throw new Error(`Project fetch failed: ${response.status}`);
  return response.json();
});

const assetUrls = new Map<string, string>([
  ['asset_opening', '/media/opening.mp4'],
  ['asset_closing', '/media/closing.webm'],
  ['asset_music', '/media/music.webm'],
]);

const media = new ByteMediaProvider({
  maxCachedBytes: 64 * 1024 * 1024,
  resolveAssetBytes: async (assetId, signal) => {
    const url = assetUrls.get(assetId);
    if (url === undefined) throw new ReferenceError(`No binding for ${assetId}`);
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

await session.loadProject(project);
```

`ByteMediaProvider` 会把完整 asset bytes 放入有界 LRU，适合短媒体。大文件/CDN 应实现 range-backed Provider，详见 [MediaProvider 接入契约](media-provider.md)。

如果 Project 引用 `previewPolicy: required` 的 Material，必须在 `loadProject` 前通过 `options.materials` 向宿主 runtime registry 精确注册对应程序；否则 Project 可以通过结构校验，但 Preview/Export 会因没有 executable backend 而拒绝。不要从 Project URL 动态执行 Shader/WASM。Package Registry 到 Session runtime 的完整桥接见 [Material Authoring Guide](material-authoring.md)。仓库 60 秒 fixture 含 Warm Film/Cross Dissolve，证据 runner 正是用该桥接运行，而不是绕过 Material。

## 3. 先探测能力

```ts
const capabilities = await session.probeCapabilities();

if (!capabilities.gpu.webgl2.available) {
  throw new Error('This project requires the certified WebGL2 path');
}

console.table({
  tier: capabilities.tier,
  isolated: capabilities.environment.crossOriginIsolated,
  audioWorklet: capabilities.audio.audioWorklet.available,
  opfs: capabilities.storage.opfs.available,
});
```

Capability 是当前配置报告，不是“浏览器品牌白名单”。Export 还必须单独 preflight codec、Sink 与 Material backend。

## 4. 原子编辑与 undo/redo

语义命令负责校验 Track lock、引用、时间映射和 ownership：

```ts
const before = session.revision;
if (before === null) throw new Error('Project is not loaded');

session.transaction.commands.moveItem({
  itemId: 'item_closing',
  startUs: 28_500_000,
  baseRevision: before,
  label: 'Move closing shot earlier',
});

session.transaction.undo();
session.transaction.redo();
```

一次复合更改使用 `edit`，所有 operation 要么一起通过 Schema/reference 校验并提交，要么完全不提交：

```ts
const baseRevision = session.revision;
if (baseRevision === null) throw new Error('Project is not loaded');

session.transaction.edit(
  edit => {
    edit.setField('materialInstances', 'mat_warm', ['parameters', 'intensity'], 0.8);
    edit.setField('items', 'item_closing', ['visual', 'opacity'], 0.95);
  },
  { label: 'Tune closing look', baseRevision },
);
```

优先使用 `commands`；底层 `edit.setField` 适合已有明确协议语义的复合操作，不代表所有字段组合都已成为受支持剪辑命令。命令边界见 [Phase 1 Editing Commands](../contracts/phase-1-editing-commands.md)。

## 5. 单帧 Preview

```ts
const canvas = document.querySelector<HTMLCanvasElement>('#preview');
const context = canvas?.getContext('2d');
if (canvas === null || context === null) throw new Error('Preview canvas is unavailable');

const rendered = await session.preview.renderFrame({ timeUs: 30_000_000 });
try {
  canvas.width = rendered.bitmap.width;
  canvas.height = rendered.bitmap.height;
  context.drawImage(rendered.bitmap, 0, 0);
} finally {
  rendered.bitmap.close();
}
```

Promise resolve 后 `ImageBitmap` 归调用方，必须 `close()`。快速拖动时为每个新请求 abort 上一个请求，避免无用工作占用有界 renderer queue。

## 6. Player

```ts
const unsubscribe = session.player.subscribe(frame => {
  try {
    context.drawImage(frame.result.bitmap, 0, 0);
  } finally {
    frame.result.bitmap.close();
  }
});

document.querySelector('#play')?.addEventListener('click', () => {
  void session.player.play();
});

document.querySelector('#pause')?.addEventListener('click', () => {
  void session.player.pause();
});

await session.player.seek(15_000_000);
```

`play()` 应在用户手势中调用，以满足 autoplay/AudioContext 策略。有声播放以 AudioWorklet 为主时钟，视频跟随；当前只允许一个 frame subscriber/owner。

## 7. WebM Export

大输出优先 OPFS：

```ts
import { OpfsSeekableSink } from '@aelion/export';

const sink = new OpfsSeekableSink('aelion-output.webm');
const controller = new AbortController();
const options = {
  sink: sink.writable,
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
  signal: controller.signal,
  cleanupSink: () => sink.cleanup(),
  onProgress: (progress: number) => console.log(`Export ${Math.round(progress * 100)}%`),
};

const preflight = await session.export.preflight(options);
if (!preflight.ok) {
  console.error(preflight.issues);
  throw new Error('Aelion export preflight failed');
}

const job = session.export.start(options);
try {
  const unsubscribeExport = job.subscribe(snapshot => {
    console.log(snapshot.id, snapshot.state, snapshot.progress);
  });
  const result = await job;
  unsubscribeExport();
  const file = await sink.getFile();
  console.log(result, file.size, file.type);
} catch (error) {
  await sink.cleanup();
  throw error;
}

// UI cancel can use any one of these equivalent paths:
// await job.cancel(); await session.export.cancel(); or controller.abort();
```

当前标准本地输出固定为 WebM/VP9/Opus。`start()` 冻结当时的 Render IR revision；导出进行中的编辑不会改变结果。成功只由 Promise resolve 表示，关键业务应再用独立 demux/decode 实现回读输出。

## 8. 诊断与状态

```ts
const unsubscribeSession = session.subscribe(event => {
  if (event.type === 'diagnostic') {
    reportDiagnostic(event.diagnostic);
  }
});

const unsubscribeStats = session.subscribe('stats-changed', event => {
  console.log(event.stats);
});

console.log(session.getSnapshot());
console.log(session.getStats());
console.log(session.getCapabilitySnapshot());
console.log(session.getDiagnostics());
```

不要解析英文 `message` 做分支，使用稳定 `code`、`severity`、`recoverable`、`path/entityId/rangeUs`。目录见 [Diagnostic Codes](../reference/diagnostic-codes.md)。

## 9. 清理

```ts
unsubscribe();
unsubscribeSession();
unsubscribeStats();
await session.player.pause();
await session.dispose();
media.clear();
```

Session dispose 幂等，但不拥有调用方注入的 MediaProvider，也不会自动删除成功导出的文件。完整规则见 [Player、Export、AbortSignal 与资源所有权](resource-lifecycle.md)。

## 10. 最小上线检查

- 实际生产 URL 是 HTTPS，COOP/COEP 生效；
- 媒体 CDN 支持正确 CORS/Range；
- 生产 bundle 能加载包内 Worker/AudioWorklet `.js`；
- `probeCapabilities()` 与 `export.preflight()` 的失败都进入可见 UI；
- 每个 Preview/Player bitmap 都关闭，cancel/dispose 能清理 partial output；
- 测试范围与[兼容性矩阵](../compatibility/phase-1-alpha-matrix.md)一致，不把 Safari/移动端写成已支持。
