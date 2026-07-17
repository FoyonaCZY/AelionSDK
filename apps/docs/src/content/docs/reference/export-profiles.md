---
title: Export Profiles
description: 本地和远程导出 Profile 的 codec、MIME、扩展名和选项。
---

## Profile 表

| ID              | Kind           | MIME         | 扩展    | Video           | Audio       | Resumability       |
| --------------- | -------------- | ------------ | ------- | --------------- | ----------- | ------------------ |
| `webm-vp9-opus` | muxed-av       | `video/webm` | `.webm` | `vp09.00.10.08` | `opus`      | restart-local      |
| `mp4-h264-aac`  | muxed-av       | `video/mp4`  | `.mp4`  | `avc1.640028`   | `mp4a.40.2` | restart-local      |
| `still-png`     | still          | `image/png`  | `.png`  | —               | —           | checkpointed-units |
| `still-jpeg`    | still          | `image/jpeg` | `.jpg`  | —               | —           | checkpointed-units |
| `still-webp`    | still          | `image/webp` | `.webp` | —               | —           | checkpointed-units |
| `animated-gif`  | animated-image | `image/gif`  | `.gif`  | —               | —           | checkpointed-units |
| `audio-wav`     | audio-only     | `audio/wav`  | `.wav`  | —               | PCM         | checkpointed-units |

`resumability` 描述协议能力，不表示当前 Session Job 能从任意中断点自动继续。Muxed 本地文件失败后从头重启；Remote Provider 可以实现服务端恢复。

## Profile 选项

所有本地 profile 共享：`sink`、`signal?`、`cleanupSink?`、`onProgress?`。

| Profile 类别 | 额外选项                         |
| ------------ | -------------------------------- | ------ |
| WebM / MP4   | `videoBitrate?`, `audioBitrate?` |
| WAV          | `sampleFormat?: 's16'            | 'f32'` |
| Still        | `timeUs`, `quality?`             |
| GIF          | `loopCount?`                     |

Session 会从 Render IR 填充 duration、width、height、frameRate、sampleRate 和 channel count。

## 结果

- Muxed：mimeType、videoFrames、audioFrames、durationUs、encoderConfiguration；
- WAV：mimeType、audioFrames、durationUs、bytesWritten、rf64；
- Still：mimeType、bytesWritten、timeUs；
- GIF：mimeType、videoFrames、durationUs、bytesWritten。

文件字节由 Sink 持有，不包含在 result 中。

## Probe 与 Preflight

`probeExportProfiles()` 只检查通用 codec/canvas 能力。`session.export.preflightProfile()` 还检查当前 Project revision、尺寸、帧率、声道、色彩、Material 和 Sink，是启动前的最终依据。

Profile 常量由 `EXPORT_PROFILES` 导出。完整 Job 用法见[任务、进度与 Sink](../export/jobs-sinks.md)。
