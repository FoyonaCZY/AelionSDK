---
title: 导出 MP4 和 WebM
description: 配置 H.264/AAC 或 VP9/Opus 视频导出，选择码率、分辨率和文件落盘方式。
---

视频导出使用当前 Sequence 的画布尺寸、帧率、采样率和声道。API 不单独接收 width/height；要导出不同分辨率，应创建或选择对应规格的 Sequence。

## H.264/AAC MP4

```ts
import { SeekableMemorySink } from '@aelion/export';

const sink = new SeekableMemorySink();
const options = {
  profile: 'mp4-h264-aac' as const,
  sink: sink.writable,
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
  onProgress: (progress: number) => {
    progressBar.value = progress;
  },
  cleanupSink: () => sink.cleanup(),
};

const report = await session.export.preflightProfile(options);
if (!report.ok) {
  sink.cleanup();
  console.table(report.issues);
  return;
}

const result = await session.export.startProfile(options);
const bytes = sink.finalize();

if ('encoderConfiguration' in result) {
  console.log(result.mimeType);
  console.log(result.encoderConfiguration);
  console.log(result.videoFrames, result.audioFrames);
}
```

当前 MP4 profile 请求 H.264 `avc1.640028` 和 AAC `mp4a.40.2`。这只是 SDK 的目标配置；浏览器是否接受当前画布、帧率和声道，以本次 preflight 结果为准。

AAC 不能只看 `AudioEncoder.isConfigSupported()`。SDK 还会做运行时 canary，避免浏览器声称支持但实际不能产出可用 AAC。

## VP9/Opus WebM

调用方式相同，只替换 profile 和码率：

```ts
const sink = new SeekableMemorySink();
const options = {
  profile: 'webm-vp9-opus' as const,
  sink: sink.writable,
  videoBitrate: 6_000_000,
  audioBitrate: 160_000,
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
```

WebM profile 使用 VP9 `vp09.00.10.08` 和 Opus。它在现代 Chromium/Firefox 上通常更容易满足，但最终交付平台未必接受 WebM，因此格式选择应由产品和目标渠道决定。

## 码率从多少开始

码率是 VBR 目标，不保证文件的实际平均码率。可以用下面数值建立第一批真实素材测试：

| 画布  | 视频码率测试起点 | 音频码率测试起点 |
| ----- | ---------------: | ---------------: |
| 720p  |         3–5 Mbps |     128–160 kbps |
| 1080p |        6–10 Mbps |     160–192 kbps |
| 4K    |       20–45 Mbps |     192–256 kbps |

运动、噪点、帧率、文字细节和目标平台二次压缩都会影响结果。不要仅凭分辨率固定一个“最佳码率”；用实际业务素材比较清晰度、体积和编码耗时。

产品预设可以这样组织：

```ts
const presets = {
  '1080p-standard': { videoBitrate: 8_000_000, audioBitrate: 192_000 },
  '1080p-small': { videoBitrate: 5_000_000, audioBitrate: 160_000 },
  '4k-standard': { videoBitrate: 30_000_000, audioBitrate: 256_000 },
} as const;
```

这些值仍需经过当前 Project preflight。

## 4K 能不能导出

Project 可以设置 3840×2160。能否在本地完成由真实设备决定：

- VideoEncoder 是否接受 H.264/VP9 的 4K 配置；
- GPU 最大纹理尺寸和可用内存；
- 原片 decoder、效果 pass 和轨道数量；
- OPFS quota 和剩余空间；
- 移动设备温控、后台和页面生命周期。

4K 不应只是一个永远可点的下拉选项。切换到 4K preset 后执行 preflight；失败时提供 1080p 或远程导出。

## 长视频写入 OPFS

```ts
import { OpfsSeekableSink } from '@aelion/export';

const sink = new OpfsSeekableSink('output.mp4');
const result = await session.export.startProfile({
  profile: 'mp4-h264-aac',
  sink: sink.writable,
  videoBitrate: 12_000_000,
  audioBitrate: 192_000,
  cleanupSink: () => sink.cleanup(),
});

await sink.waitUntilFinalized();
const file = await sink.getFile();
console.log(result.mimeType, file.size);
```

`waitUntilFinalized()` 等待 transferred stream 真正关闭。不要在 Job 完成前读取，也不要复用已经关闭或失败的 Sink。

## 下载 Memory Sink 的结果

```ts
function downloadVideo(bytes: Uint8Array, mimeType: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const anchor = Object.assign(document.createElement('a'), {
    href: url,
    download: filename,
  });
  anchor.click();
  URL.revokeObjectURL(url);
}
```

只有 Job completed 后才能 `finalize()`。失败和取消时调用 cleanup，不要下载 0 字节或半成品容器。
