---
title: 播放与音频
description: 控制播放、暂停、seek、音频时钟、质量和播放器资源。
---

Player 使用音频时钟驱动视频调度。播放过程中迟到视频帧可以丢弃，但音频时间线保持连续。

## 基本控制

```ts
await session.player.play();
await session.player.pause();
await session.player.seek(2_000_000);

console.log(session.player.state, session.player.currentTimeUs);
```

`seek()` 目标必须位于 `[0, durationUs)`。如果当前位于结尾，重新 `play()` 会从 0 开始。

浏览器通常要求 `AudioContext` 在用户手势中启动，因此首次 `play()` 应由 click、keydown 等可信交互直接触发，并对拒绝 Promise 给出 UI 提示。

## Scrub 与 Seek 的区别

- `player.seek(timeUs)`：重置音频时钟、填充音频并发布定位帧；
- `player.scrub(timeUs)`：只渲染单帧，不改变播放时钟；
- `preview.render(timeUs)`：由 Canvas Controller 处理绘制和 latest-wins。

拖动播放头时通常 pause + preview.render；松手后再 seek。不要在每个 pointermove 中重建播放器运行时。

## 音频传输模式

在 cross-origin isolated 且支持 SharedArrayBuffer 时，Player 使用 `shared-ring`。否则回退到 `transferable-queue`。

```ts
const stats = session.player.getStats();
console.log(stats.resources.audio.mode);
```

Shared ring 的稳定性和延迟更适合专业播放。Transferable queue 是功能回退，不是部署时忽略 COOP/COEP 的理由。

## 预览质量

```ts
session.player.setPreviewQuality({ quality: 'draft', renderScale: 0.5 });
```

`attachPreviewCanvas()` 在自适应模式下会同步 Player 质量。自定义帧消费者需要自己决定何时降级和恢复。

## 订阅播放帧

```ts
const unsubscribe = session.player.subscribe(frame => {
  console.log(frame.timestampUs, frame.droppedFrames);
  // 消费并关闭 frame.result.bitmap
});
```

Player 强制单一帧 owner。推荐让 PreviewCanvasController 订阅；只有实现 WebGL/Canvas 自定义呈现层时才直接订阅。

## 编辑中的播放

Transaction 提交会使 Player 的生成代次失效，并让时钟停留在合法范围。上层可以选择：

- 播放中允许安全编辑并继续；
- 对结构性编辑先 pause；
- 提交后 seek 到当前 playhead 以刷新音频缓冲。

无论选择哪种产品策略，都让 `project-changed` 成为刷新来源，不要直接修改播放器内部状态。

## 监控与释放

```ts
const stats = session.player.getStats();
console.table({
  rendered: stats.renderedFrames,
  dropped: stats.droppedFrames,
  errors: stats.errors,
  buffered: stats.resources.audio.bufferedFrames,
});
```

播放质量指标应按设备档位和工程复杂度解释。销毁 Session 会释放 Player、关闭 AudioContext、停止 scheduler 和 transport。测试可检查 `lastDisposedRuntime` 验证资源终态。
