# Player、Export、AbortSignal 与资源所有权

浏览器媒体对象通常持有解码器、GPU texture、共享内存或文件句柄。Aelion 的调用方必须遵守本页所有权规则；依赖 GC 回收 `VideoFrame`/`ImageBitmap` 会造成不可预测的内存峰值。

## 1. 生命周期层级

```text
application
├── MediaProvider（调用方创建和释放，可跨 Session 共享）
├── Material Registry（调用方创建和撤销注册）
└── AelionSession
    ├── Transaction/History（Session 拥有）
    ├── Player + AudioContext/AudioWorklet（Session 拥有）
    ├── Renderer Worker（Session 拥有，按需创建）
    └── Export task（Session 跟踪；Sink 的持久化策略由调用方决定）
```

建议在组件卸载、路由离开或编辑器关闭时使用 `try/finally`：

```ts
const session = await Aelion.createSession({ media });
try {
  await session.loadProject(project);
  // edit / preview / play / export
} finally {
  await session.dispose(); // 幂等
  media.clear();            // 仅当应用确定没有其他 Session 共享它
}
```

## 2. Preview 与 Player frame

`session.preview.renderFrame()` 和 `player.scrub()` 返回包含 `ImageBitmap` 的结果。Promise resolve 后 bitmap 所有权归调用方：

```ts
const result = await session.preview.renderFrame({ timeUs: 1_000_000 });
try {
  canvas.getContext('2d')?.drawImage(result.bitmap, 0, 0);
} finally {
  result.bitmap.close();
}
```

Player 当前只允许一个 frame owner：

```ts
const unsubscribe = session.player.subscribe(frame => {
  try {
    context.drawImage(frame.result.bitmap, 0, 0);
  } finally {
    frame.result.bitmap.close();
  }
});

try {
  await session.player.play(); // 放在用户点击事件中
} finally {
  await session.player.pause();
  unsubscribe();
}
```

如果没有订阅者，Player 会关闭它产生的 bitmap。存在订阅者时，SDK 不会在回调后自动关闭，因为回调可能先复制/呈现；owner 必须对每帧恰好关闭一次。要把帧异步交给另一个消费者，应先创建受控副本并限制队列，不要无限缓存回调对象。

`seek(timeUs)` 改变播放时钟并发布一帧；`scrub(timeUs)` 只渲染并返回一帧，不隐式改变播放状态。`seek` 目标必须在 `[0, durationUs)`。

完整帧评估在媒体解码前有硬并发上限；过量并发会以 `RENDERER_FRAME_QUEUE_FULL` 拒绝，而不会建立无界 decoder/Worker 队列。拖动时间线时应取消上一条 scrub，再提交最新目标。`session.dispose()` 会 abort 仍在途的帧评估，并等待它们 settle 后才完成；注入的 MediaProvider 必须遵守传入的 `AbortSignal`，否则调用方自己的不可取消 Promise 也会阻止 dispose 完成。

## 3. AbortSignal

每个用户可取消动作使用独立 controller，不复用已 abort 的 signal：

```ts
const controller = new AbortController();
const previewPromise = session.preview.renderFrame({
  timeUs: 15_000_000,
  signal: controller.signal,
});

controller.abort(new DOMException('Superseded by a newer scrub', 'AbortError'));

try {
  const frame = await previewPromise;
  frame.bitmap.close();
} catch (error) {
  // AelionError may contain OPERATION_ABORTED; a lower browser primitive can
  // surface DOMException AbortError. Both mean no result ownership transferred.
}
```

取消是异步协作，不保证底层 GPU/codec 在同一微任务停止。契约是：

- 不再把已取消 generation 的 frame 发布给上层；
- 已取消的 Worker 请求在底层确认 GPU/帧资源清理前仍占 admission slot；结果到达时立即关闭；
- Export 尝试 cancel muxer、abort Sink 并调用 `cleanupSink`；
- 调用方仍要等待 Promise settle，再开始依赖相同 Sink 的操作。

`session.dispose()` 是最终兜底，不应替代频繁 scrub/export 的细粒度取消。

## 4. Export 与 Sink

始终先 preflight，再启动：

```ts
const sink = new OpfsSeekableSink('draft.webm');
const controller = new AbortController();
const options = {
  sink: sink.writable,
  signal: controller.signal,
  cleanupSink: () => sink.cleanup(),
};

const report = await session.export.preflight(options);
if (!report.ok) {
  console.error(report.issues);
  throw new Error('Aelion export preflight failed');
}

const task = session.export.start(options);
// UI cancel: await task.cancel(), await session.export.cancel(), or controller.abort()
const result = await task; // AelionExportJob is await-compatible
const file = await sink.getFile();
```

`start()` 返回 `AelionExportJob`：它本身可以 `await`，也提供 `id/state/result/getSnapshot/subscribe/cancel`。`session.export.activeJob` 暴露当前任务，`session.export.cancel()` 取消它并等待 pipeline cleanup。无论使用 job/session 便捷 `cancel()` 还是外部 controller，底层都走 AbortSignal。一个 `WritableStream` 在被 export lock/close/abort 后不能复用，重试必须创建新 Sink。

一个 Session 同时只允许一个 active export；要启动新任务，先等待前一任务 settle 或 `await session.export.cancel()`。`session.dispose()` 会先取消 active job 并等待其 cleanup，再终止 Player/renderer。

所有权：

- SDK 在 Export 成功时关闭 mux output，具体 Sink 决定最终文件/bytes 由谁保存；
- `OpfsSeekableSink.getFile()` 只在成功 close 后可用；失败/取消时调用 `cleanup()` 删除 partial file；
- `SeekableMemorySink` 适合测试和小输出；`finalize()` 会再分配完整连续 bytes，不应用于大导出；
- Export 在启动时冻结 Render IR revision；后续编辑不会改变本次输出。新 revision 要启动新任务；
- `onProgress` 是 UI 提示，不是可提交的帧计数或成功证明，只有 Promise resolve 和独立回读才能确认输出完成。

## 5. Dispose 后行为

`session.dispose()`：

- 停止 Player scheduler 与 AudioWorklet/AudioContext；
- 终止 renderer Worker 并 reject pending composition；
- 清除 Session listener、history、Project/Render IR 引用；
- 可重复调用；
- 此后调用 Session/Player 业务方法会 reject/throw `ReferenceError`。

它不会自动：

- 清除调用方注入的 MediaProvider cache；
- 撤销业务创建的 Object URL；
- 删除已经成功导出的 OPFS 文件；
- 关闭调用方在 frame callback 中仍持有的 bitmap 副本；
- 取消应用自己发起、未传入 Session 的 fetch。

在开发环境记录 `session.getSnapshot()`、`session.getStats()`、Provider snapshot、Sink snapshot 和浏览器 performance 数据，有助于确认反复创建/释放 Session 后资源回到基线。`stats.preview` 会报告 Renderer 帧队列及 Worker admission，`stats.player.resources` 会报告调度器、音频填充任务、AudioContext/AudioWorklet transport 和缓冲帧所有权；dispose 完成后这些字段应全部处于 disposed/closed/zero 状态。Session 的 capability/diagnostics/stats snapshot 是只读副本；订阅回调抛错会被 SDK 隔离，不能改变 Session 状态或阻止其他订阅者。
