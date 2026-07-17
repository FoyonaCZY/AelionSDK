---
title: 实时预览与 Scrub
description: 将 Session 连接到 Canvas，处理 latest-wins、DPR、质量自适应和帧所有权。
---

`attachPreviewCanvas()` 是编辑器接入实时画面的推荐入口。它封装 Canvas 尺寸、Player 订阅、过期请求取消和可选的自适应分辨率。

## 连接 Canvas

```ts
import { attachPreviewCanvas } from '@aelion/sdk';

const preview = attachPreviewCanvas(session, canvas, {
  quality: 'adaptive',
  fit: 'contain',
  background: '#05070b',
  pixelRatio: window.devicePixelRatio,
  pauseWhenHidden: true,
  renderOnResize: true,
  targetFrameMs: 1000 / 30,
  onError: error => reportError(error),
});

await preview.render(0);
```

Canvas 的 CSS 尺寸决定页面布局，Controller 根据 CSS 尺寸和 DPR 更新实际像素尺寸。不要用 CSS 把一个固定低分辨率 backing store 拉伸到全屏。

## Scrub

```ts
function onPlayheadChanged(timeUs: number) {
  void preview.render(timeUs);
}
```

每次 `render()` 会取消被新请求取代的旧请求。即使旧解码晚返回，也不会覆盖较新的时间点。这是 timeline scrub 应有的 latest-wins 语义。

不需要为每个 pointermove 创建自己的 Promise 队列。可以在 UI 层按 `requestAnimationFrame` 合并输入，进一步降低无意义请求。

## 质量策略

| 模式       | 行为                            | 使用场景             |
| ---------- | ------------------------------- | -------------------- |
| `adaptive` | 根据渲染时长在给定 scale 间调整 | 默认交互预览         |
| `draft`    | 默认 0.5 scale                  | 低端设备、重效果工程 |
| `full`     | 默认 1.0 scale                  | 停帧审片、像素检查   |

```ts
preview.setQuality('draft', 0.5);
preview.setQuality('full', 1);
```

可通过 `adaptiveScales: [1, 0.75, 0.5, 0.35]` 调整候选值。Scale 必须大于 0 且不超过 1。

## 与 Player 配合

Controller 默认 `subscribePlayer: true`，成为 Player 唯一的帧所有者并绘制播放帧。Player 只允许一个帧订阅者；如果你需要完全自定义绘制，设置：

```ts
const preview = attachPreviewCanvas(session, canvas, {
  subscribePlayer: false,
});

const unsubscribe = session.player.subscribe(frame => {
  try {
    draw(frame.result.bitmap);
  } finally {
    frame.result.bitmap.close();
  }
});
```

接管帧后，消费方必须关闭 bitmap，并在退出时 unsubscribe。

## 直接渲染单帧

需要缩略图或自定义表面时可以绕过 Canvas Controller：

```ts
const controller = new AbortController();
const result = await session.preview.renderFrame({
  timeUs,
  quality: 'draft',
  renderScale: 0.25,
  signal: controller.signal,
});

try {
  thumbnailContext.drawImage(result.bitmap, 0, 0);
} finally {
  result.bitmap.close();
}
```

## 诊断

```ts
console.log(preview.snapshot());
console.log(session.getStats().preview);
```

关注 pending、cancelledFrames、failedFrames、renderScale、worker pending/active 和 renderer disposed 状态。大量取消在快速 scrub 时是正常的；pending 持续上升或销毁后仍有 active request 才是问题。

结束时调用 `preview.dispose()`，它会取消当前帧、断开 ResizeObserver 和 visibility listener。
