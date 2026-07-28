---
title: 导出任务、进度和文件写入
description: 管理可取消 Job，正确使用 Memory/OPFS Sink，并清理失败或取消的半成品。
---

`start()`、`startProfile()` 和 `startRemote()` 都返回 Job。Job 本身可以 `await`，也可以订阅状态、读取快照和取消。

## 把 Job 接进任务 UI

```ts
const job = session.export.startProfile(options);
const unsubscribe = job.subscribe(snapshot => {
  exportStore.update({
    id: snapshot.id,
    status: snapshot.state,
    progress: snapshot.progress,
  });
});

try {
  const result = await job.result;
  exportStore.complete(result);
} catch (error) {
  exportStore.fail(error);
} finally {
  unsubscribe();
}
```

状态有 `running`、`completed`、`failed` 和 `cancelled`。Progress 是 0–1 的完成比例，可以画进度条，但不代表稳定速度；没有足够历史数据时不要把它直接换算成承诺的剩余秒数。

同一个 Session 同时只运行一个 active export job：

```ts
if (session.export.activeJob !== null) {
  showMessage('当前已有导出任务');
  return;
}
```

产品任务队列可以跨 Session 排队，但不要让用户重复点击时意外覆盖同一个文件。

## 取消任务

```ts
await job.cancel(new DOMException('用户取消', 'AbortError'));
```

或者取消当前 Session 的 active job：

```ts
await session.export.cancel();
```

取消需要等 encoder、Worker 和 Sink 完成清理。按钮点击后先显示“正在取消”，等 Promise resolve 再允许用同一目标文件名开始新任务。

业务已经有 AbortController 时也可以传 signal：

```ts
const controller = new AbortController();
const job = session.export.startProfile({
  ...options,
  signal: controller.signal,
});

controller.abort(new DOMException('页面已离开', 'AbortError'));
```

## Memory Sink 的真实内存成本

```ts
const sink = new SeekableMemorySink();

try {
  await session.export.startProfile({
    ...options,
    sink: sink.writable,
    cleanupSink: () => sink.cleanup(),
  });

  const bytes = sink.finalize();
} catch (error) {
  sink.cleanup();
  throw error;
}
```

只有 writer 正常关闭后才能 `finalize()`。它会把已写入的块合并为一份连续 Uint8Array；转成 Blob 时还可能再占用内存。短片和静帧很方便，长视频和 WAV 不适合。

## OPFS Sink 的完成顺序

```ts
const sink = new OpfsSeekableSink('output.mp4');

try {
  await session.export.startProfile({
    ...options,
    sink: sink.writable,
    cleanupSink: () => sink.cleanup(),
  });

  await sink.waitUntilFinalized();
  const file = await sink.getFile();
  deliver(file);
} catch (error) {
  await sink.cleanup();
  throw error;
}
```

文件名必须是单个 leaf name，不能传 `folder/output.mp4`。需要目录管理时实现自己的 Sink 或先使用 OPFS API 获取目录句柄。

OPFS 仍受 quota、浏览器 eviction 和隐私模式影响。导出前可以探测存储，失败时显示空间提示并清理半成品。

## 自定义 Sink 要实现什么

导出 Writer 写入的是带位置的 chunk：

```ts
interface StreamTargetChunk {
  type: 'write';
  position: number;
  data: Uint8Array;
}
```

实现要求：

- 支持非顺序 position，因为容器可能回填头部；
- 写入 Promise resolve 时，该 chunk 才算真正完成，才能形成背压；
- `close()` resolve 前完成持久化；
- `abort()` 可以重复调用而不产生更大错误；
- quota、权限和磁盘错误必须向上抛出；
- 不在失败后返回一个看似成功的空文件。

如果目标是普通 HTTP 上传，不要假设所有容器都只顺序 append。可以先落 OPFS，再分片上传，或在服务端提供支持 seek/commit 的上传协议。

## cleanupSink 不是可选的善后

编码、Worker、页面取消和存储都可能失败。每次启动都提供幂等清理：

```ts
cleanupSink: async () => {
  await removePartialOutput().catch(() => undefined);
};
```

SDK 和业务层可能从不同路径触发 cleanup，因此重复执行必须安全。成功文件的保留和删除则由产品决定。

Session 级统计可以确认任务终态：

```ts
console.table(session.getStats().export);
```

started 数不断增加但 completed/failed/cancelled 不动，通常说明有任务卡在未完成资源或 Sink 上。
