---
title: 实时预览与拖动播放头
description: 把 Session 连接到 Canvas，处理快速拖动、画质调整、缩略图和帧资源。
---

大多数编辑器都应该用 `attachPreviewCanvas()` 显示主监看画面。它会处理 Canvas 像素尺寸、播放器帧、窗口缩放、过期请求取消和 `ImageBitmap` 释放。

## 连接主预览 Canvas

HTML：

```html
<div class="monitor">
  <canvas id="preview"></canvas>
</div>
```

CSS：

```css
.monitor {
  aspect-ratio: 16 / 9;
  background: #000;
}

#preview {
  display: block;
  width: 100%;
  height: 100%;
}
```

TypeScript：

```ts
import { attachPreviewCanvas } from '@aelion/sdk';

const canvas = document.querySelector<HTMLCanvasElement>('#preview')!;
const preview = attachPreviewCanvas(session, canvas, {
  quality: 'adaptive',
  fit: 'contain',
  background: '#000000',
  pauseWhenHidden: true,
  renderOnResize: true,
  targetFrameMs: 1000 / 30,
  onFrame: frame => updateTimecode(frame.timeUs),
  onError: error => showPreviewError(error),
});

await preview.render(0);
```

`await preview.render(0)` 成功后，Canvas 应出现工程在 0 微秒处的画面。没有视频内容时会显示 Sequence 背景色，而不是自动显示文件封面。

## 这些选项怎么选

| 选项              | 建议初始值  | 说明                                          |
| ----------------- | ----------- | --------------------------------------------- |
| `quality`         | `adaptive`  | 根据近期渲染耗时在多个比例间调整              |
| `fit`             | `contain`   | 完整显示画布；`cover` 会裁切，`fill` 会拉伸   |
| `pixelRatio`      | 省略        | 默认使用设备 DPR；大屏可限制到 1–2 来节省像素 |
| `pauseWhenHidden` | `true`      | 页面隐藏时暂停播放，回到前台再恢复            |
| `renderOnResize`  | `true`      | Canvas 尺寸变化后重绘当前时间点               |
| `targetFrameMs`   | `1000 / 30` | 自适应质量的目标耗时，不是播放帧率            |

Canvas 的 CSS 大小和实际 `canvas.width/height` 是两回事。Controller 会用 CSS 尺寸乘 DPR 设置 backing store。不要在创建后反复手动覆盖 Canvas 的 width/height。

## 实现拖动播放头

简单版本可以直接在 range input 的 `input` 事件中请求画面：

```ts
scrubber.addEventListener('input', () => {
  const timeUs = Number(scrubber.value);
  void preview.render(timeUs);
});
```

每次 `render()` 都会取代尚未完成的旧请求。快速拖到 8 秒后，即使 3 秒那一帧解码得更晚，也不会覆盖当前画面。

复杂时间线通常每个 animation frame 只提交一次：

```ts
let pendingTimeUs = 0;
let scheduled = false;

function requestScrub(timeUs: number): void {
  pendingTimeUs = timeUs;
  if (scheduled) return;
  scheduled = true;

  requestAnimationFrame(() => {
    scheduled = false;
    void preview.render(pendingTimeUs);
  });
}
```

这会减少 UI 事件数量，但不替代 Controller 的过期请求取消。两层一起使用，既能合并 pointermove，也能处理已经发出的慢请求。

## 拖动与播放怎么配合

常见产品行为是：

```ts
async function beginScrub(): Promise<void> {
  if (session.player.state === 'playing') await session.player.pause();
}

function updateScrub(timeUs: number): void {
  requestScrub(timeUs);
}

async function endScrub(timeUs: number): Promise<void> {
  await session.player.seek(timeUs);
}
```

拖动过程中只画单帧，松手时再重置播放器的音频时钟。不要在每个 pointermove 中调用 `player.seek()`，它需要清空并重新填充音频运行时。

Controller 默认会订阅 Player。调用 `session.player.play()` 后，播放帧会自动画到同一个 Canvas，不需要自己再建定时器。

## 在交互和审片之间切换画质

```ts
preview.setQuality('draft', 0.5); // 复杂拖动或低端设备
preview.setQuality('full', 1); // 停帧审片
preview.setQuality('adaptive'); // 恢复自动调节
```

`renderScale` 必须大于 0 且不超过 1。缩小发生在文字、效果和合成之前，因此能实质减少渲染开销；导出不会继承这个设置，始终按完整尺寸执行。

默认自适应候选比例是 `[1, 0.75, 0.5, 0.35]`。可以根据产品目标修改：

```ts
const preview = attachPreviewCanvas(session, canvas, {
  quality: 'adaptive',
  adaptiveScales: [1, 0.67, 0.5],
});
```

## 生成缩略图

缩略图不需要另建主 Preview Controller，可以直接请求单帧：

```ts
const abort = new AbortController();
const result = await session.preview.renderFrame({
  timeUs,
  quality: 'draft',
  renderScale: 0.25,
  signal: abort.signal,
});

try {
  thumbnailContext.drawImage(result.bitmap, 0, 0);
} finally {
  result.bitmap.close();
}
```

只为视口内缩略图发请求，并限制并发。滚出视口或时间线缩放变化时，调用 `abort.abort()` 取消旧任务。缩略图和主预览会竞争解码与 GPU 资源，不能为整条长时间线一次性生成所有帧。

## 完全接管播放器帧

只有自定义 WebGL 呈现层时，才关闭 Controller 的 Player 订阅：

```ts
const preview = attachPreviewCanvas(session, canvas, {
  subscribePlayer: false,
});

const unsubscribe = session.player.subscribe(frame => {
  try {
    drawWithCustomRenderer(frame.result.bitmap);
  } finally {
    frame.result.bitmap.close();
  }
});
```

Player 只允许一个帧订阅者。接管之后，关闭 bitmap 和取消订阅都由你的代码负责。

## 看懂预览统计

```ts
console.log(preview.snapshot());
console.log(session.getStats().preview);
```

- `cancelledFrames` 在快速拖动时升高是正常的；
- `pending` 长时间为 true，说明当前帧一直没有完成；
- `failedFrames` 增长时查看 Session diagnostic；
- `workerPendingRequests` 持续增长通常表示生产请求太快或取消未生效；
- `lastRenderScale` 可以解释画面为何暂时变糊。

## 释放

组件卸载或切换工程时：

```ts
preview.dispose();
```

它会取消当前请求，断开 ResizeObserver、visibility listener 和 Player 帧订阅。之后再调用 `render()` 会失败；新工程应创建新的 Controller。

如果画面正常但播放没有声音，继续看[播放与音频](/AelionSDK/guides/player-audio/)。
