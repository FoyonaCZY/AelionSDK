---
title: Export Profiles 速查
description: 查询本地和远程导出的 profile ID、codec、MIME、扩展名、参数和结果类型。
---

Profile ID 是稳定的格式选择，不是浏览器自动协商结果。产品选择 profile 后，仍要对当前 Project 调用 `session.export.preflightProfile()`。

## Profile 表

| ID              | Kind           | MIME         | 扩展名  | Video           | Audio       | 失败后继续方式     |
| --------------- | -------------- | ------------ | ------- | --------------- | ----------- | ------------------ |
| `webm-vp9-opus` | muxed-av       | `video/webm` | `.webm` | `vp09.00.10.08` | `opus`      | 本地从头重启       |
| `mp4-h264-aac`  | muxed-av       | `video/mp4`  | `.mp4`  | `avc1.640028`   | `mp4a.40.2` | 本地从头重启       |
| `still-png`     | still          | `image/png`  | `.png`  | —               | —           | 可作为独立单元重做 |
| `still-jpeg`    | still          | `image/jpeg` | `.jpg`  | —               | —           | 可作为独立单元重做 |
| `still-webp`    | still          | `image/webp` | `.webp` | —               | —           | 可作为独立单元重做 |
| `animated-gif`  | animated-image | `image/gif`  | `.gif`  | —               | —           | 可作为独立单元重做 |
| `audio-wav`     | audio-only     | `audio/wav`  | `.wav`  | —               | PCM         | 可作为独立单元重做 |

`EXPORT_PROFILES` 导出同一份机器可读元数据。`resumability` 说明协议类型，不代表当前 Session 能从任意 MP4/WebM 中断点自动继续。

## 所有本地 Profile 的共同选项

```ts
interface CommonProfileOptions {
  sink: WritableStream<StreamTargetChunk>;
  signal?: AbortSignal;
  cleanupSink?: (reason: unknown) => void | Promise<void>;
  onProgress?: (progress: number) => void;
}
```

分类选项：

| Profile    | 额外选项                         |
| ---------- | -------------------------------- |
| MP4 / WebM | `videoBitrate?`, `audioBitrate?` |
| WAV        | `sampleFormat?: 's16' \| 'f32'`  |
| Still      | `timeUs`, `quality?`             |
| GIF        | `loopCount?`                     |

Session 从当前 Render IR 填充 duration、width、height、frameRate、sampleRate 和声道，不在调用中重复传入。

## 结果中有什么

- MP4/WebM：MIME、视频/音频帧数、时长、实际提交给编码器的配置；
- WAV：MIME、音频帧数、时长、写入字节、是否 RF64；
- Still：MIME、写入字节和 timeUs；
- GIF：MIME、帧数、时长和写入字节。

文件内容留在 Sink，不放进 result。Memory Sink 使用 `finalize()` 取 Uint8Array，OPFS Sink 使用 `waitUntilFinalized()` + `getFile()`。

## Probe 和 Preflight 的差别

```ts
import { probeExportProfiles } from '@aelion/export';

const generic = await probeExportProfiles();
const exact = await session.export.preflightProfile(options);
```

`probeExportProfiles()` 用固定配置粗略查看 codec/Canvas 能力。`preflightProfile()` 还检查当前 Project 的尺寸、帧率、声道、色彩、Material 和 Sink，是开始任务前的最终依据。

完整调用见[选择导出格式](/AelionSDK/export/overview/)和[导出任务、进度和文件写入](/AelionSDK/export/jobs-sinks/)。
