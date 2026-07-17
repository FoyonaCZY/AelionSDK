---
title: 在真实设备上检查可用功能
description: 使用 Session capability 和 Export preflight 决定预览后端、音频模式、存储和导出选项。
---

“用户在 Chrome 里”不足以判断功能可用。相同浏览器版本会因为操作系统、GPU、codec、企业策略和跨源隔离而得到不同结果。

AelionSDK 提供两类检查：

- Session capability 描述当前页面环境；
- Export preflight 判断“当前 Project + 指定 profile + 当前 Sink”能否执行。

## 打开工程后探测一次环境

```ts
const report = await session.probeCapabilities();

console.table({
  tier: report.tier,
  isolated: report.environment.crossOriginIsolated,
  webgl2: report.gpu.webgl2.status,
  webgpu: report.gpu.webgpu.status,
  audioWorklet: report.audio.audioWorklet.status,
  opfs: report.storage.opfs.status,
});

console.table(report.codecs);
```

`tier` 是整体参考，值为 `a`、`b`、`c` 或 `unsupported`。产品开关不要只看 tier。例如一个 Tier B 设备可能能顺畅编辑 1080p，但不支持 H.264 导出；这时应该保留编辑并把 MP4 切到远程任务。

按功能读取具体字段：

```ts
const canUseSharedAudio = report.environment.crossOriginIsolated;
const canUseOpfs = report.storage.opfs.status === 'supported';
const canOfferWebGpu = report.gpu.webgpu.status === 'supported';
```

精确 status 值和字段以 API Reference 的 `CapabilityReport` 为准。

## 缓存报告，但不要永久记在用户账号上

```ts
const cached = session.getCapabilitySnapshot();

const unsubscribe = session.subscribe('capability-changed', event => {
  capabilityStore.set(event.capability);
});
```

报告属于当前页面和设备。GPU context、音频设备、权限、跨源隔离或浏览器升级后可能变化。可以在一次 Session 内缓存，不要把“这个用户支持 4K”永久写进账号属性。

需要重新探测的时机包括：重新创建 Session、设备/权限明显变化、从长期后台恢复，以及用户主动打开诊断面板。

## 每次导出都做 preflight

```ts
import { OpfsSeekableSink } from '@aelion/export';

const sink = new OpfsSeekableSink('output.mp4');
const options = {
  profile: 'mp4-h264-aac' as const,
  sink: sink.writable,
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
  cleanupSink: () => sink.cleanup(),
};

const report = await session.export.preflightProfile(options);
if (!report.ok) {
  await sink.cleanup();
  for (const issue of report.issues) {
    showIssue(issue.code, issue.recoverable, issue.details);
  }
  return;
}

await session.export.startProfile(options);
```

Preflight 会考虑当前 revision 的 width、height、frameRate、声道、色彩和 Material。用户改了输出 Sequence 后，要重新创建 Sink 并检查。已经 locked、closed 或失败过的 writable stream 不能复用。

## 把失败变成用户可以选择的方案

产品逻辑可以明确写成：

1. 先检查用户选择的 MP4 规格；
2. H.264/AAC 不支持时，允许改选 WebM；
3. 交付必须是 MP4 时，提交 Remote Export；
4. 4K 配置不支持时，提供 1080p，而不是自动降级；
5. OPFS 不可用时，只有预计输出很小时才提供 Memory Sink；
6. HDR 或 Material 无可用 backend 时明确拒绝。

不要悄悄改变格式或分辨率。用户看到的导出设置必须和最终文件一致。

## 常见 issue 怎么转成产品提示

| Code                                                | 可以怎么提示和处理                                           |
| --------------------------------------------------- | ------------------------------------------------------------ |
| `CAPABILITY_SHARED_ARRAY_BUFFER_ISOLATION_REQUIRED` | 当前仍能播放，但使用兼容音频模式；提示部署检查，不必阻止编辑 |
| `EXPORT_VIDEO_CONFIG_UNSUPPORTED`                   | 当前尺寸/帧率/codec 不支持；提供其他规格或远程导出           |
| `EXPORT_AUDIO_CONFIG_UNSUPPORTED`                   | 不输出无声文件；改 profile、声道或远程执行                   |
| `EXPORT_SINK_LOCKED`                                | 创建新的 Sink 后重试                                         |
| `EXPORT_STORAGE_WRITE_FAILED`                       | 清理半成品，检查空间和权限，再允许用户重试                   |

业务分支依赖 `issue.code`，不要解析英文 message。完整 code 列表见 [Diagnostic Codes](/AelionSDK/reference/diagnostic-codes/)。

## 什么时候禁用按钮，什么时候点后再检查

页面打开后就能确定的环境限制可以提前禁用，例如完全没有 OPFS。与当前 Project 相关的导出配置则适合在打开导出面板或点击“开始导出”时检查，并显示原因。

即使按钮此前可用，启动任务前仍要再检查一次，因为 Project revision 和 Sink 状态可能已经变化。
