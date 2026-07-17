---
title: 快速开始
description: 用一个本地视频完成导入、Project 创建、实时预览、编辑和 H.264 导出。
---

这条路径只使用聚合入口 `@aelion/sdk`，目标是在一个页面里走通最小可用链路。当前版本尚未发布到 npm，请先按[安装与工程配置](./installation.md)从仓库运行。

## 1. 配置 Vite

Worker 和 AudioWorklet 必须作为独立模块进入构建产物。使用官方插件处理这些运行时入口：

```ts title="vite.config.ts"
import { aelion } from '@aelion/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [aelion()],
});
```

播放器使用 SharedArrayBuffer 音频通道时，页面还需要跨源隔离响应头。完整配置见[兼容性与部署](../production/compatibility.md)。

## 2. 准备画布和文件输入

```html
<input id="media" type="file" accept="video/*,audio/*,image/*" />
<canvas id="preview"></canvas>
<button id="play">播放</button>
```

```css
#preview {
  width: min(100%, 960px);
  aspect-ratio: 16 / 9;
  background: #000;
}
```

## 3. 导入媒体并创建 Project

Project 只保存可序列化的描述；`File` 和解码器由 `ProductionMediaProvider` 管理。

```ts
import {
  Aelion,
  ProductionMediaProvider,
  attachPreviewCanvas,
  createProject,
} from '@aelion/sdk';

const input = document.querySelector<HTMLInputElement>('#media')!;
const canvas = document.querySelector<HTMLCanvasElement>('#preview')!;

input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file) return;

  const media = new ProductionMediaProvider();
  media.registerFile('asset_main', file);

  const probe = await media.probe('asset_main');
  const video = probe.index.tracks.find(track => track.kind === 'video');
  const builder = createProject({
    projectId: 'project_main',
    sequenceId: 'sequence_main',
    title: file.name,
    width: video?.codedWidth ?? 1920,
    height: video?.codedHeight ?? 1080,
    frameRate: { numerator: 30, denominator: 1 },
  });

  const imported = await builder.importMedia({
    provider: media,
    assetId: 'asset_main',
    name: file.name,
    mimeType: file.type || undefined,
  });

  const session = await Aelion.createSession({ media });
  await session.loadProject(builder.build());
```

`importMedia()` 会根据探测结果创建视频轨、音频轨和对应片段；同时存在音视频时会建立 link group。需要自己控制轨道和片段时，改用 `addTrack()`、`addAsset()` 和 `addMediaClip()`。

## 4. 连接预览和播放

接在上一个代码块中：

```ts
const preview = attachPreviewCanvas(session, canvas, {
  quality: 'adaptive',
  fit: 'contain',
  pauseWhenHidden: true,
});

await preview.render(0);

document.querySelector('#play')?.addEventListener('click', async () => {
  if (session.player.state === 'playing') await session.player.pause();
  else await session.player.play();
});
```

Controller 会订阅 Player 帧、处理 DPR、窗口尺寸变化和被新请求取代的 scrub。不要把 `ImageBitmap` 长期保存在 UI 状态中。

## 5. 提交一次编辑

所有项目修改都通过事务提交。下面把导入的片段移动到 1 秒位置：

```ts
if (imported.videoItemId) {
  session.transaction.commands.moveItem({
    itemId: imported.videoItemId,
    toTrackId: imported.videoTrackId!,
    startUs: 1_000_000,
  });
}

await session.transaction.undo();
await session.transaction.redo();
```

拖拽类高频手势应使用 `beginInteractive()` 合并为一条撤销记录，见[事务、历史与交互编辑](../concepts/transactions.md)。

## 6. 导出 H.264 MP4

本地 MP4 依赖浏览器对 H.264/AAC WebCodecs 配置的支持，因此先执行 preflight：

```ts
import { SeekableMemorySink } from '@aelion/export';

const sink = new SeekableMemorySink();
const options = {
  profile: 'mp4-h264-aac' as const,
  sink: sink.writable,
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
};

const report = await session.export.preflightProfile(options);
if (!report.ok) {
  console.error(report.issues);
  return;
}

const job = session.export.startProfile(options);
const unsubscribe = job.subscribe(({ progress }) => {
  console.log(`${Math.round(progress * 100)}%`);
});

try {
  await job;
  const bytes = sink.finalize();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: 'aelion-output.mp4',
  });
  link.click();
  URL.revokeObjectURL(url);
} finally {
  unsubscribe();
}
```

长视频不要使用内存 Sink，改用 OPFS。格式、取消和清理规则见[导出概览](../export/overview.md)和[任务、进度与 Sink](../export/jobs-sinks.md)。

## 7. 释放资源

页面卸载、切换工程或销毁编辑器实例时，按所有权从外到内释放：

```ts
  preview.dispose();
  await session.dispose();
  media.dispose();
});
```

到这里，你已经走通 File → Project → Session → Preview/Player → Transaction → Export。接下来建议运行[参考编辑器](./reference-editor.md)，再按实际产品阅读[剪辑 UI 集成](../guides/editor-ui.md)。

:::tip[可编译的完整示例]
仓库中的 `examples/typescript/sdk-integration.ts` 由 CI 执行 TypeScript 检查，覆盖同一条 File → Canvas → H.264 路径。
:::
