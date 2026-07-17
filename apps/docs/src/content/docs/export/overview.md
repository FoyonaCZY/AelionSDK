---
title: 选择导出格式
description: 根据交付场景选择 MP4、WebM、图片、GIF、WAV、本地或远程导出。
---

导出从当前 Session 中已经加载的 Project 开始。任务启动时会固定当时的 revision，之后的编辑不会进入本次文件。

## 先选输出格式

| Profile         | 文件          | 适合什么场景                                  |
| --------------- | ------------- | --------------------------------------------- |
| `mp4-h264-aac`  | H.264/AAC MP4 | 社交平台、下载交付、通用播放器                |
| `webm-vp9-opus` | VP9/Opus WebM | Web 播放、开放格式流程、Chromium/Firefox 环境 |
| `still-png`     | PNG           | 无损截图、带清晰文字的静帧                    |
| `still-jpeg`    | JPEG          | 照片类封面和较小文件                          |
| `still-webp`    | WebP          | Web 图片和预览图                              |
| `animated-gif`  | GIF           | 很短的循环预览，不适合高质量长片              |
| `audio-wav`     | WAV/RF64      | 混音交付、后续音频处理                        |

MP4 最通用，但浏览器不一定能编码当前分辨率和 AAC。不要通过 UA 或扩展名判断，实际启动前调用 `preflightProfile()`。

## 一次完整的本地导出

```ts
import { SeekableMemorySink } from '@aelion/export';

const sink = new SeekableMemorySink();
const options = {
  profile: 'mp4-h264-aac' as const,
  sink: sink.writable,
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
  onProgress: (value: number) => updateProgress(value),
  cleanupSink: () => sink.cleanup(),
};

const report = await session.export.preflightProfile(options);
if (!report.ok) {
  sink.cleanup();
  showExportIssues(report.issues);
  return;
}

const revision = session.revision;
const job = session.export.startProfile(options);

try {
  const result = await job;
  const bytes = sink.finalize();
  saveFile(bytes, result.mimeType, 'output.mp4');
  console.log('导出的 revision：', revision);
} catch (error) {
  // cleanupSink 会处理半成品；这里更新业务任务状态。
  showExportError(error);
}
```

Preflight 会根据当前 Project 检查画布尺寸、帧率、色彩、Material、声道、codec 配置和 Sink 状态。Project 改变后要重新检查；检查过的旧结果不能当作整个会话永久有效。

## Sink 决定文件写到哪里

| Sink                 | 文件保存位置               | 什么时候用                                   |
| -------------------- | -------------------------- | -------------------------------------------- |
| `SeekableMemorySink` | JavaScript 内存            | 短片、截图、测试；完成后需要一次连续数组分配 |
| `OpfsSeekableSink`   | 浏览器 OPFS                | 长视频、高码率、WAV、4K 输出                 |
| 自定义 Sink          | 由你的 WritableStream 决定 | Electron 文件、业务存储、分片上传            |

Memory Sink 的峰值不只是最终文件大小：它保存写入块，`finalize()` 还要分配连续 `Uint8Array`，转成 Blob 时可能再增加一次内存。无法明确限制成片大小时，默认选择 OPFS。

## 本地导出还是服务端导出

本地导出的优点是素材不必上传，用户可以离线工作，也不占服务端算力。它适合时长可控、设备能力明确的项目。

下面这些情况更适合 Remote Export：

- 必须交付 MP4，但当前浏览器 H.264/AAC preflight 不通过；
- 长片或 4K 在目标设备上超出内存、温控和存储预算；
- 用户关闭页面后任务仍要继续；
- 产品需要稳定的服务端 SLA、多规格转码或审计记录。

远程接口不是内置云服务。你需要实现 Provider 和 Authorizer，把 Project 中的素材 ID 映射到服务端可访问的原片。

## 推荐的 UI 流程

1. 用户选择格式、分辨率或质量预设；
2. 创建新的 Sink；
3. 对当前 revision 执行 preflight；
4. 不支持时显示具体原因和替代方案；
5. 启动 Job，显示进度和“正在取消”状态；
6. 成功后下载/读取文件；失败或取消后清理半成品；
7. 记录 profile、revision、结果和 diagnostic code。

详细 Job 和落盘行为见[导出任务与文件写入](/AelionSDK/export/jobs-sinks/)。视频参数见[导出 MP4 和 WebM](/AelionSDK/export/video/)。
