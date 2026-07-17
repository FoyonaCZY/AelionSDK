---
title: 导出静帧和 GIF
description: 从指定时间点保存 PNG、JPEG、WebP，或把 Sequence 生成循环 GIF。
---

静帧导出使用 Sequence 的完整画布尺寸。它适合封面、审核截图和缩略图原图；如果只是 UI 中显示一个小缩略图，直接请求低比例 Preview 帧更快。

## 导出 JPEG

```ts
import { SeekableMemorySink } from '@aelion/export';

const sink = new SeekableMemorySink();
const options = {
  profile: 'still-jpeg' as const,
  timeUs: 2_500_000,
  quality: 0.9,
  sink: sink.writable,
  cleanupSink: () => sink.cleanup(),
};

const report = await session.export.preflightProfile(options);
if (!report.ok) {
  sink.cleanup();
  showIssues(report.issues);
  return;
}

const result = await session.export.startProfile(options);
const bytes = sink.finalize();

if ('timeUs' in result) {
  console.log(result.mimeType, result.timeUs, result.bytesWritten);
}
```

`timeUs` 必须是非负安全整数，并落在 Sequence 可渲染范围内。支持的 profile：

| Profile      | 特点                                     |
| ------------ | ---------------------------------------- |
| `still-png`  | 无损，文字和透明边缘更稳定，文件通常较大 |
| `still-jpeg` | 有损、无透明，适合照片类封面             |
| `still-webp` | Web 交付体积较小，目标系统需支持 WebP    |

`quality` 范围是 0–1，主要影响 JPEG/WebP。PNG 通常忽略它。不要把 quality 当作分辨率；输出像素仍由 Sequence width/height 决定。

## 下载图片

```ts
const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
const anchor = Object.assign(document.createElement('a'), {
  href: url,
  download: result.mimeType === 'image/png' ? 'frame.png' : 'frame.jpg',
});
anchor.click();
URL.revokeObjectURL(url);
```

如果要连续导出很多时间点，不要并发创建无限任务；一个 Session 同时只运行一个 active export job。可以按队列逐个执行，或把批量静帧交给远程服务。

## 导出 GIF

```ts
import { OpfsSeekableSink } from '@aelion/export';

const sink = new OpfsSeekableSink('preview.gif');
const options = {
  profile: 'animated-gif' as const,
  loopCount: 0,
  sink: sink.writable,
  cleanupSink: () => sink.cleanup(),
  onProgress: (value: number) => updateProgress(value),
};

const report = await session.export.preflightProfile(options);
if (!report.ok) {
  await sink.cleanup();
  showIssues(report.issues);
  return;
}

const result = await session.export.startProfile(options);
await sink.waitUntilFinalized();
const file = await sink.getFile();
console.log(result.mimeType, file.size);
```

`loopCount: 0` 表示无限循环。当前 GIF profile 按完整 Sequence 时长和帧率生成，没有单独的裁剪范围参数。要做 3 秒预览 GIF，可以先创建固定 3 秒的输出 Sequence，或交给服务端预览图任务。

GIF 色板有限，不适合长视频、照片渐变或高分辨率成片。它更适合很短的聊天预览和审核动图。高质量动画优先导出 MP4/WebM，再由交付服务生成多种预览规格。

静帧和 GIF 依赖浏览器 Canvas/OffscreenCanvas 能力。目标设备不支持时，preflight 会返回 issue；产品可以切换远程导出，而不是在运行到一半后才提示。
