---
title: 导出 WAV 音频
description: 把 Sequence 混音结果写成 s16 或 f32 WAV，并处理 RF64 和大文件。
---

`audio-wav` 导出的是整条 Sequence 的最终混音，不是某个原始音频文件。轨道 mute/solo、Item gain/pan、fade、TimeMap 和效果都会先执行，再写成 PCM。

## 导出到 OPFS

```ts
import { OpfsSeekableSink } from '@aelion/export';

const sink = new OpfsSeekableSink('mix.wav');
const options = {
  profile: 'audio-wav' as const,
  sampleFormat: 'f32' as const,
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

if ('rf64' in result) {
  console.table({
    audioFrames: result.audioFrames,
    durationUs: result.durationUs,
    bytesWritten: result.bytesWritten,
    rf64: result.rf64,
    fileSize: file.size,
  });
}
```

采样率和声道布局来自 Sequence，不在导出调用中重新指定。

## s16 还是 f32

| `sampleFormat` | 每个采样的字节数 | 适合什么场景                 |
| -------------- | ---------------: | ---------------------------- |
| `s16`          |                2 | 通用播放、交付，默认值       |
| `f32`          |                4 | 后续混音或分析，保留浮点结果 |

估算未压缩 PCM 数据量：

```text
时长秒数 × sampleRate × channelCount × 每采样字节数
```

例如 60 分钟、48 kHz、立体声、f32 约为 1.38 GB，还没有算文件头和运行时开销。长音频不要使用 Memory Sink。

## 什么情况下会得到 RF64

普通 RIFF/WAV 的大小字段是 32 位，超出限制时 SDK 会自动写 RF64，并在结果中返回 `rf64: true`。RF64 适合大文件，但目标播放器、DAW 或上传平台是否接受，需要单独验证。

产品可以在导出前按时长和声道估算：预计接近 4 GiB 时提示用户“将生成 RF64”，或改用分段/远程流程。

## 当前没有独立 AAC 或 Opus 音频 Profile

只需要音频文件时，当前本地接口提供 WAV/RF64。AAC 和 Opus 只存在于 MP4/WebM 复合输出中。需要 `.m4a`、独立 Opus 或更多音频编码格式时，应在服务端转码，不能通过设置极低视频码率模拟音频导出。

音频变速目前采用 varispeed，速度改变会同时改变音高。这个行为与播放和视频导出一致。
