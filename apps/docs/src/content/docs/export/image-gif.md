---
title: 静帧与 GIF
description: 从任意时间点导出 PNG、JPEG、WebP，或导出完整 Sequence GIF。
---

## 导出静帧

```ts
const sink = new SeekableMemorySink();
const result = await session.export.startProfile({
  profile: 'still-jpeg',
  timeUs: 2_500_000,
  quality: 0.9,
  sink: sink.writable,
});

const bytes = sink.finalize();
if ('timeUs' in result) {
  console.log(result.mimeType, result.timeUs, result.bytesWritten);
}
```

支持 `still-png`、`still-jpeg`、`still-webp`。`quality` 范围为 0–1，主要影响有损格式；PNG 通常忽略该值。

`timeUs` 必须是非负 safe integer，并落在可渲染范围。输出尺寸使用 Sequence 画布尺寸。

## 导出 GIF

```ts
const sink = new OpfsSeekableSink('preview.gif');
const result = await session.export.startProfile({
  profile: 'animated-gif',
  loopCount: 0,
  sink: sink.writable,
  cleanupSink: reason => sink.cleanup(),
  onProgress: value => updateProgress(value),
});
```

`loopCount: 0` 表示无限循环。当前 profile 按 Sequence 完整时长和帧率生成 GIF。

## 质量和体积

GIF 使用有限色板，不适合长视频、照片级渐变或高分辨率交付。它更适合短循环、聊天预览和审核缩略动图。需要高质量动画时优先导出 WebM/MP4，再由交付服务生成多种预览规格。

静帧和 GIF 依赖 `OffscreenCanvas`。上线前对目标浏览器执行 `preflightProfile()`；不支持时可以用远程导出。

完成后像其他任务一样释放 Blob URL，并对 OPFS 半成品执行清理。
