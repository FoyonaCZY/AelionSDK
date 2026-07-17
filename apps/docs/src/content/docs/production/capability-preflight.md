---
title: 能力探测与 Preflight
description: 在真实设备上判断 GPU、codec、音频、存储和具体导出任务是否可执行。
---

浏览器品牌和版本不能证明某项剪辑能力可用。AelionSDK 使用两层检查：Session capability 描述环境，Export preflight 判断当前 Project + Profile + Sink 是否可执行。

## Session capability

```ts
const report = await session.probeCapabilities();

console.log(report.tier);
console.log(report.environment.crossOriginIsolated);
console.log(report.gpu.webgl2.status, report.gpu.webgpu.status);
console.log(report.audio.audioWorklet.status);
console.log(report.storage.opfs.status);
console.table(report.codecs);
```

Tier 是整体分级：`a`、`b`、`c`、`unsupported`。具体产品决策应读取所需子能力和 diagnostics，而不是只看 tier。

## 缓存与变化

```ts
const cached = session.getCapabilitySnapshot();
const unsubscribe = session.subscribe('capability-changed', event => {
  updateCapabilityUi(event.capability);
});
```

Capability report 包含生成时间和环境快照。设备、权限、GPU context 或页面隔离变化后重新 probe；不要永久缓存成用户账户属性。

## 导出 Preflight

```ts
const sink = new OpfsSeekableSink('output.mp4');
const options = {
  profile: 'mp4-h264-aac' as const,
  sink: sink.writable,
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
};

const preflight = await session.export.preflightProfile(options);
if (!preflight.ok) {
  for (const issue of preflight.issues) {
    showIssue(issue.code, issue.recoverable, issue.details);
  }
  await sink.cleanup();
  return;
}
```

Preflight 绑定当前 revision；Project 变化后，在真正启动任务前重新执行。不要复用已经锁定或已关闭的 Sink。

## Fallback 策略

推荐把 fallback 写成显式产品规则：

1. 首选 H.264 MP4 本地；
2. 本地 H.264 不支持时，可选择 WebM；
3. 交付必须是 MP4 时，选择 Remote Export；
4. 4K 不支持时询问是否降到 1080p；
5. OPFS 不可用且输出较小时才使用 Memory Sink。

底层 `selectExportProfile()` 可以探测 profile codec，但 Session preflight 才包含当前 Project、色彩和 Sink 条件。

## 用户提示

把结构化 code 映射成产品文案和操作：

| Code                                                | 用户操作                                   |
| --------------------------------------------------- | ------------------------------------------ |
| `CAPABILITY_SHARED_ARRAY_BUFFER_ISOLATION_REQUIRED` | 仍可播放，但提示当前为性能回退；修复部署头 |
| `EXPORT_VIDEO_CONFIG_UNSUPPORTED`                   | 更换 profile、分辨率或远程导出             |
| `EXPORT_AUDIO_CONFIG_UNSUPPORTED`                   | 不静默输出无声文件；选择兼容 profile/远程  |
| `EXPORT_SINK_LOCKED`                                | 创建新 Sink，不重试同一个 stream           |
| `EXPORT_STORAGE_WRITE_FAILED`                       | 清理半成品、检查空间、允许重试             |

完整 code 表见 [Diagnostic Codes](/AelionSDK/reference/diagnostic-codes/)。业务逻辑不要解析 `message`。
