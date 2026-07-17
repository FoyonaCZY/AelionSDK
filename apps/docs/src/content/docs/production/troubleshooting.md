---
title: 故障排查
description: 按症状定位 Worker、音频、媒体、预览、导出、存储和资源生命周期问题。
---

先记录 SDK version、浏览器/OS、capability report、Project 规格、稳定 diagnostic code 和最小复现。不要先按 UA 猜结论。

## 页面能打开，但预览黑屏

1. 确认 `loadProject()` 成功且 Render IR duration > 0；
2. 检查 Asset ID 是否已在 Provider 注册；
3. 查看 `session.getDiagnostics()`；
4. 检查 Canvas CSS 尺寸和实际 width/height；
5. 运行 `preview.snapshot()`，看 failedFrames；
6. 查看 Worker 脚本是否 404/MIME 错误；
7. 检查 WebGL2/WebGPU capability 和 context lost。

## Scrub 越拖越卡

- 确认使用 PreviewCanvasController 的 latest-wins；
- 合并 pointermove 到 requestAnimationFrame；
- 使用 proxy 和 adaptive/draft；
- 查看 Provider pending、Renderer pending；
- 不要为每个时间点生成缩略图和主预览双重请求；
- 确认 Bitmap/VideoFrame 被 close。

取消帧数高不一定是故障；队列持续增长才是。

## 播放没有声音

1. 从用户手势调用 `play()`；
2. 查看 `player.getStats().resources.audio.contextState`；
3. 检查 Project sampleRate 与 AudioContext 实际 sampleRate；
4. 检查轨道 muted/solo、Item gain 和 Provider PCM；
5. 确认 AudioWorklet runtime asset 没有 404；
6. 检查跨源隔离；无隔离应回退为 transferable queue。

## 音画不同步

- 使用 group-aware 命令维护 av-sync；
- 检查 sourceStartUs、TimeMap 和 proxy sourceStartUs；
- 查看素材非零 PTS、VFR 和 B-frame 探测诊断；
- seek 后等待 Player 发布新 generation；
- 用导出成片区分“实时调度问题”和“工程时间语义问题”。

## H.264 导出按钮不可用

查看 `preflightProfile()` issues。常见原因：浏览器无 VideoEncoder/AudioEncoder、目标尺寸配置不支持、AAC runtime canary 失败、Sink locked、Material 无离线 backend。不要静默改成 WebM；让用户选择格式、分辨率或远程导出。

## 导出失败或文件为 0 字节

- 只有 Job completed 后才 finalize/getFile；
- Memory Sink 必须等 writer close；
- OPFS 先 `waitUntilFinalized()`；
- 检查 quota、磁盘和 cleanup 日志；
- 每次重试创建新 Sink；
- 检查导出期间原始 Asset 仍可访问；
- 不要在 job 运行中 dispose Session/Provider。

## 远端媒体不能 Seek

用 DevTools 检查请求是否带 Range，响应是否为正确的 206 和 Content-Range。确认 CORS 允许源、授权覆盖 Range 请求、CDN/Service Worker 没有把响应改成 200 全量或 opaque。

## 页面退出后仍占用资源

按顺序确认：

```ts
preview.dispose();
await session.dispose();
media.dispose();
```

取消导出、移除订阅和 UI interval；检查 Player `lastDisposedRuntime`、Preview `lastDisposedRenderer` 和 Provider `disposed`。

## 报告 Bug 时提供

- 最小 Project（移除敏感 locator/token）；
- 可公开的最小媒体或媒体 probe 信息；
- capability report（审查 userAgent 等隐私字段）；
- diagnostic code/details，不只提供截图；
- 重现步骤、期望和实际结果；
- 是否在参考编辑器可复现；
- 生产/开发构建差异。

完整代码表见 [Diagnostic Codes](/AelionSDK/reference/diagnostic-codes/)。
