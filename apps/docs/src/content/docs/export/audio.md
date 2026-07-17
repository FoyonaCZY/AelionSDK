---
title: WAV 音频
description: 导出 s16 或 f32 PCM WAV，并了解 RF64、声道和大文件处理。
---

`audio-wav` 把当前 Sequence 的混音结果导出为 PCM WAV。采样率和声道布局来自 Project。

```ts
const sink = new OpfsSeekableSink('mix.wav');
const result = await session.export.startProfile({
  profile: 'audio-wav',
  sampleFormat: 'f32',
  sink: sink.writable,
  cleanupSink: reason => sink.cleanup(),
  onProgress: value => updateProgress(value),
});

await sink.waitUntilFinalized();
const file = await sink.getFile();
if ('rf64' in result) {
  console.log(result.audioFrames, result.rf64, file.size);
}
```

## Sample format

| 值    | 每采样字节 | 适用场景                   |
| ----- | ---------: | -------------------------- |
| `s16` |          2 | 通用播放和交付，默认值     |
| `f32` |          4 | 后续处理、保留浮点混音结果 |

WAV 是未压缩格式，文件体积约为：

```text
durationSeconds × sampleRate × channelCount × bytesPerSample
```

长音频或 5.1/f32 必须使用流式 Sink。数据超过 RIFF 32 位大小限制时，SDK 自动写 RF64，结果的 `rf64` 为 true。目标播放软件是否支持 RF64需要单独验证。

音量、pan、mute/solo、fade 和 TimeMap 在 Render IR 中完成后再进入 WAV。音频当前采用 varispeed pitch 语义。

需要 AAC/Opus 压缩音频时，使用 muxed 视频 profile 或在服务端做转码；当前没有独立 AAC/Opus 音频 profile。
