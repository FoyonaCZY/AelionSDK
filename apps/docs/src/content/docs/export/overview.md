---
title: 导出概览
description: 选择本地或远程执行、输出格式、Sink，并在启动前完成 preflight。
---

Session Export 从当前冻结的 Project revision 和 Render IR 生成文件。预览可以动态降级，导出始终使用原始媒体表示和确定输出格式。

## 支持的 Profile

| Profile         | 输出              | 典型用途                             |
| --------------- | ----------------- | ------------------------------------ |
| `webm-vp9-opus` | WebM / VP9 / Opus | 开放 Web 分发、Chromium/Firefox 环境 |
| `mp4-h264-aac`  | MP4 / H.264 / AAC | 通用交付和社交平台                   |
| `still-png`     | PNG               | 无损静帧                             |
| `still-jpeg`    | JPEG              | 小体积照片静帧                       |
| `still-webp`    | WebP              | Web 静帧                             |
| `animated-gif`  | GIF               | 短循环预览                           |
| `audio-wav`     | WAV / RF64        | 音频交付和后期                       |

## 标准流程

```ts
const options = {
  profile: 'mp4-h264-aac' as const,
  sink: sink.writable,
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
};

const preflight = await session.export.preflightProfile(options);
if (!preflight.ok) {
  showIssues(preflight.issues);
  return;
}

const job = session.export.startProfile(options);
const result = await job;
```

Preflight 检查 frozen revision、色彩管线、channel layout、Sink、浏览器 codec 配置和关键运行时支持。它是启动按钮前的必要步骤，不是异常后的补救。

## 本地还是远程

本地导出适合：素材已在浏览器、时长可控、设备 codec 支持、用户希望不上传原片。

远程导出适合：设备不支持目标 codec、长片/4K 对资源要求高、需要稳定服务端 SLA、需要后台完成和跨设备取件。

两者都以 canonical Project manifest、profile 和 revision 为身份基础。远程 Provider 是业务适配接口，SDK 不捆绑某个云服务。

## Sink 选择

- 短输出：`SeekableMemorySink`，完成后获得 `Uint8Array`；
- 长输出：`OpfsSeekableSink`，边写边落盘，完成后获得 `File`；
- 自定义：实现支持 position 的 `WritableStream<StreamTargetChunk>`。

不要用预计成片大小作为唯一判断。4K、高码率或长音频会显著放大内存峰值，生产默认更适合 OPFS。

## 冻结语义

任务启动后继续编辑不会改变正在导出的内容。Job snapshot 和结果都对应启动时 revision。UI 应显示 revision 或“导出开始后修改不会进入本次文件”的提示。

## 失败和清理

传入 `cleanupSink`，让失败/取消时删除半成品：

```ts
const sink = new OpfsSeekableSink('draft.mp4');
const job = session.export.startProfile({
  profile: 'mp4-h264-aac',
  sink: sink.writable,
  cleanupSink: reason => sink.cleanup(),
});
```

任务详情见[任务、进度与 Sink](./jobs-sinks.md)，浏览器差异见[能力探测与 Preflight](../production/capability-preflight.md)。
