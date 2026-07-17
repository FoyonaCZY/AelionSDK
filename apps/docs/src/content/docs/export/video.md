---
title: WebM 与 H.264 MP4
description: 配置 VP9/Opus 或 H.264/AAC 本地视频导出。
---

视频导出使用 Sequence 的 width、height、frameRate、sampleRate 和 channelLayout。调用方提供 profile、码率和可 seek 的 Sink。

## H.264 MP4

```ts
import { SeekableMemorySink } from '@aelion/export';

const sink = new SeekableMemorySink();
const options = {
  profile: 'mp4-h264-aac' as const,
  sink: sink.writable,
  videoBitrate: 12_000_000,
  audioBitrate: 192_000,
  onProgress: (value: number) => updateProgress(value),
};

const report = await session.export.preflightProfile(options);
if (!report.ok) throw new Error(report.issues.map(issue => issue.code).join(', '));

const result = await session.export.startProfile(options);
const bytes = sink.finalize();
if ('encoderConfiguration' in result) {
  console.log(result.mimeType, result.encoderConfiguration);
}
```

当前 H.264 codec string 为 `avc1.640028`，音频为 `mp4a.40.2`。是否真正支持目标分辨率、帧率和声道由浏览器/硬件决定，以本次 preflight 为准。

## WebM

```ts
const result = await session.export.startProfile({
  profile: 'webm-vp9-opus',
  sink: sink.writable,
  videoBitrate: 6_000_000,
  audioBitrate: 160_000,
});
```

WebM 使用 VP9 `vp09.00.10.08` 和 Opus。它通常在现代 Chromium/Firefox 中支持良好，但交付平台兼容性仍需按目标验证。

## 码率怎么填

码率是 VBR 目标，不保证成片的实测平均值。可从以下范围开始做素材回归：

| 画布  | 视频码率起点 |     音频码率 |
| ----- | -----------: | -----------: |
| 720p  |     3–5 Mbps | 128–160 kbps |
| 1080p |    6–10 Mbps | 160–192 kbps |
| 4K    |   20–45 Mbps | 192–256 kbps |

运动量、噪点、帧率和交付平台会显著影响结果。最终值应以目标素材的主观质量和成片体积测试决定。

## 4K

Project 支持 3840×2160 及更高合法尺寸，内核没有“只能 1080p”的限制。但 4K 本地导出是否可用取决于：

- `VideoEncoder.isConfigSupported()` 的真实结果；
- GPU 最大纹理和内存预算；
- 原片 decoder 并发；
- OPFS 剩余空间；
- 移动设备温控和页面生命周期。

生产产品应把本地 4K 作为 capability，而不是静态承诺；失败时提供降级分辨率或远程导出。

## 音频为空或没有视频

Muxed profile 仍按 Sequence 音频格式生成轨道。只需要音频时使用 `audio-wav`；只需要单帧使用 still profile。不要通过设置极低视频码率模拟音频导出。

## 输出下载

```ts
const blob = new Blob([bytes], { type: result.mimeType });
const url = URL.createObjectURL(blob);
try {
  const anchor = Object.assign(document.createElement('a'), {
    href: url,
    download: result.mimeType === 'video/mp4' ? 'output.mp4' : 'output.webm',
  });
  anchor.click();
} finally {
  URL.revokeObjectURL(url);
}
```

长视频改用 OPFS，避免 `Uint8Array` + `Blob` 带来的额外内存峰值。
