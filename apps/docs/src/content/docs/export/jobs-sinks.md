---
title: 任务、进度与 Sink
description: 管理可取消导出 Job、内存/OPFS Sink、背压、失败清理和完成状态。
---

`start()`、`startProfile()` 和 `startRemote()` 返回 await-compatible Job。既可以直接 `await job`，也可以订阅状态和主动取消。

## Job 生命周期

```ts
const job = session.export.startProfile(options);
const unsubscribe = job.subscribe(snapshot => {
  renderExportState(snapshot.state, snapshot.progress);
});

try {
  const result = await job.result;
  console.log(result);
} finally {
  unsubscribe();
}
```

状态是 `running`、`completed`、`failed`、`cancelled`。Progress 范围为 0–1，应按非精确估算展示，不要把它转换成承诺的剩余秒数。

同一 Session 同时只暴露一个 active job。启动前检查产品任务状态，避免用户重复点击。

## 取消

```ts
await job.cancel(new DOMException('User cancelled', 'AbortError'));
// 或取消 Session 当前任务
await session.export.cancel();
```

取消会等待编码管线清理。UI 在 Promise 完成前显示“正在取消”，不要立即允许覆盖同一个文件名。

也可以传入 AbortSignal：

```ts
const controller = new AbortController();
const job = session.export.startProfile({ ...options, signal: controller.signal });
controller.abort();
```

## Memory Sink

```ts
const sink = new SeekableMemorySink();
await session.export.startProfile({ ...options, sink: sink.writable });
const bytes = sink.finalize();
```

只有 writer 正常 close 后才能 `finalize()`。失败时调用 `sink.cleanup()` 丢弃 chunks。Memory Sink 会保留所有写入块并在 finalize 分配最终连续数组，峰值可能明显高于文件大小。

## OPFS Sink

```ts
const sink = new OpfsSeekableSink('output.mp4');
await session.export.startProfile({
  ...options,
  sink: sink.writable,
  cleanupSink: reason => sink.cleanup(),
});

await sink.waitUntilFinalized();
const file = await sink.getFile();
```

OPFS 允许 seek 写入并控制内存峰值。文件名必须是单个 leaf name；目录型工作流可以用自定义 Sink。

## 自定义 Sink 契约

WritableStream 接收：

```ts
interface StreamTargetChunk {
  type: 'write';
  position: number;
  data: Uint8Array;
}
```

Sink 必须：

- 在 Promise resolve 前完成该块写入，提供真实背压；
- 支持非顺序 position；
- `close()` 后确保数据持久化完成；
- `abort()` 幂等；
- 失败时抛出可诊断错误；
- 不吞掉 quota、权限和磁盘错误。

## Cleanup 是必需契约

编码失败、取消或写入错误时，SDK 会 abort writer，并调用 `cleanupSink(reason)`。清理函数应幂等，因为业务层和管线都可能触发它。

```ts
cleanupSink: async reason => {
  await removePartialOutput().catch(() => undefined);
};
```

监控 `session.getStats().export` 可以看到 started/completed/failed/cancelled、activeJobId 和 progress。
