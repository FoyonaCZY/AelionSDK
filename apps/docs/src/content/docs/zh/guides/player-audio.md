---
title: 播放与音频
description: 接入播放、暂停和定位，处理浏览器手势限制、音频时钟与播放状态。
---

Session 创建后就有一个 `player`。它负责音频输出和视频帧调度，主预览 Canvas 通常由 `PreviewCanvasController` 自动接收这些帧。

## 最小播放控制

```ts
playButton.addEventListener('click', () => {
  void togglePlayback();
});

async function togglePlayback(): Promise<void> {
  if (session.player.state === 'playing') {
    await session.player.pause();
    playButton.textContent = '播放';
    return;
  }

  await session.player.seek(currentTimeUs);
  await session.player.play();
  playButton.textContent = '暂停';
}
```

第一次 `play()` 必须直接由 click、keydown 等可信用户手势触发。不要先等待网络请求再播放，否则浏览器可能认为已经离开手势调用栈并拒绝启动 AudioContext。

```ts
try {
  await session.player.play();
} catch (error) {
  showMessage('浏览器阻止了音频播放，请再次点击播放按钮。');
}
```

## Player 状态

`session.player.state` 可能是：

| 状态       | UI 通常怎么显示                  |
| ---------- | -------------------------------- |
| `idle`     | 工程刚加载，还没有开始播放       |
| `paused`   | 显示播放按钮                     |
| `playing`  | 显示暂停按钮                     |
| `ended`    | 播放头在结尾，再次播放会从头开始 |
| `error`    | 停用控制并显示 diagnostic        |
| `disposed` | 编辑器已经关闭，不能再调用       |

当前时间可从 `session.player.currentTimeUs` 读取。更适合更新 UI 的方式是通过 Preview Controller 的 `onFrame`，因为它对应实际显示出来的画面。

## seek、scrub 和 preview.render 的区别

| 方法                     | 会不会改变播放时钟 | 适合场景                             |
| ------------------------ | ------------------ | ------------------------------------ |
| `player.seek(timeUs)`    | 会                 | 用户松开播放头、跳转章节、播放前定位 |
| `player.scrub(timeUs)`   | 不会               | 自己接管 Player 帧时请求一帧         |
| `preview.render(timeUs)` | 不会               | 标准 Canvas 预览和拖动播放头         |

拖动时暂停播放并调用 `preview.render()`；松手后再调用 `player.seek()`。这样不会在每个 pointermove 中反复清空音频缓冲。

目标时间必须是非负安全整数，并且小于 Sequence 时长：

```ts
const durationUs = session.getSnapshot().renderIr?.durationUs ?? 0;
const targetUs = Math.min(requestedUs, Math.max(0, durationUs - 1));
await session.player.seek(targetUs);
```

## 为什么音频是主时钟

播放声音时，真正的时间进度来自 AudioContext/AudioWorklet 已经消费的 PCM。视频帧跟随这个时间：渲染来不及时可以丢帧，但不能让视频定时器拖慢或反向推动声音。

这意味着 `setInterval()` 不应该成为产品播放头的真实时钟。它可以用于低频 UI 刷新，但最终位置以 Player 发布的帧和状态为准。

## 检查音频传输模式

```ts
const stats = session.player.getStats();
console.log(stats.resources.audio.mode);
```

| 模式                 | 何时使用                             |
| -------------------- | ------------------------------------ |
| `shared-ring`        | 页面跨源隔离并支持 SharedArrayBuffer |
| `transferable-queue` | 没有跨源隔离时的兼容路径             |
| `none`               | 尚未初始化、没有音频或已经释放       |

`transferable-queue` 能播放，但高负载下的延迟余量更小。正式剪辑器应部署 COOP/COEP，而不是把回退模式当作最终配置。

## 设置播放预览质量

```ts
session.player.setPreviewQuality({
  quality: 'draft',
  renderScale: 0.5,
});
```

如果使用 `attachPreviewCanvas({ quality: 'adaptive' })`，Controller 会自动同步 Player 质量。只有不使用 Controller、自己消费帧时，才需要单独管理这项设置。

## 编辑发生在播放过程中

Transaction 提交后，旧一代尚未完成的帧会失效。产品可以选择两种策略：

- 移动、开关轨道等轻量操作允许边播边改；
- 分割、ripple 或大范围结构变化先暂停，提交后 seek 到当前播放头。

无论采用哪一种，刷新来源都是 `project-changed`：

```ts
const unsubscribe = session.subscribe('project-changed', async () => {
  const timeUs = session.player.currentTimeUs;
  if (session.player.state !== 'playing') {
    await preview.render(timeUs);
  }
});
```

不要直接写 Player 内部时间，也不要在 UI 中维护第二套媒体时钟。

## 监控卡顿和音频问题

```ts
const stats = session.player.getStats();

console.table({
  state: stats.state,
  renderedFrames: stats.renderedFrames,
  droppedFrames: stats.droppedFrames,
  errors: stats.errors,
  lastErrorCode: stats.lastErrorCode,
  audioMode: stats.resources.audio.mode,
  audioContext: stats.resources.audio.contextState,
  bufferedFrames: stats.resources.audio.bufferedFrames,
});
```

偶尔丢帧并不等于音画不同步；持续增长并伴随画面跳跃时，再结合 Preview 渲染耗时、Provider pending 和工程复杂度定位。完全没有声音时先检查：用户手势、轨道 mute/solo、素材是否真的含音频、Worklet 文件是否 404。

## 释放

不需要单独销毁 Player。`await session.dispose()` 会停止 scheduler、关闭 AudioContext 和音频传输。长会话测试可以读取 `lastDisposedRuntime`，确认这些资源确实进入终态。
