---
title: 素材表示、缓存和生命周期
description: 理解 Asset、original/proxy、Range 读取、SampleIndex、资源上限和释放顺序。
---

Project 只记录素材身份，Media Provider 才持有当前页面中可读取的 File、URL 和缓存。把这两部分拆开后，工程可以跨设备保存，也可以预览用代理文件、导出用原片。

## Asset 和 Representation

一个 Asset 可以有多个实际表示：

| role        | 用途                   |
| ----------- | ---------------------- |
| `original`  | 原片。导出必须使用它   |
| `proxy`     | 较低分辨率的预览文件   |
| `thumbnail` | 业务自己的缩略图来源   |
| `waveform`  | 业务自己的波形数据来源 |

例如同一个 `asset_camera_a` 可以同时注册 4K original 和 540p proxy：

```ts
media.registerUrl('asset_camera_a', originalUrl, {
  id: 'asset_camera_a:original',
  role: 'original',
  width: 3840,
  height: 2160,
});

media.registerUrl('asset_camera_a', proxyUrl, {
  id: 'asset_camera_a:proxy-540p',
  role: 'proxy',
  width: 960,
  height: 540,
});
```

预览请求会带目标最大尺寸，Provider 选择合适 proxy；导出请求明确要求 original。产品不用在 Project 中把 Asset ID 换来换去。

## Range 读取为什么重要

打开长视频时，不应该先把完整文件复制进 JavaScript 内存。`ProductionMediaProvider` 通过 RangeReader 按区间读取容器和媒体数据，支持：

- `File` / `Blob`；
- 支持 HTTP Range 的 URL；
- OPFS 文件；
- 自定义 `RangeReader`。

它先建立 SampleIndex，再根据目标时间从最近同步样本开始解码。快速 seek 不需要顺序解码整个前半段视频。

远端 URL 必须保留 206、Content-Range 和 CORS。浏览器能下载文件，不代表它适合随机读取。

## SampleIndex 是什么

SampleIndex 记录容器中可以可靠得到的信息：媒体轨、时长、codec、样本位置、展示顺序、解码顺序和同步样本。它不是解码后的帧缓存。

给 original 提供 SHA-256 后，可以按内容身份复用索引：

```ts
media.registerFile('asset_camera_a', file, {
  role: 'original',
  contentHash: '0123456789abcdef...共 64 位小写十六进制',
});
```

同一内容再次打开时，可以避免重复扫描容器。Hash 只证明内容身份，不代替访问权限，也不要为了主线程同步算 hash 而卡住 UI；大文件可以在 Worker 中分块计算。

## Provider 为什么有并发上限

拖动播放头、播放、缩略图和导出可能同时请求媒体。Provider 默认限制 active 和 pending 操作：

```ts
const media = new ProductionMediaProvider({
  maxCachedIndexes: 8,
  maxCachedIndexBytes: 64 * 1024 * 1024,
  maxConcurrentOperations: 4,
  maxPendingOperations: 64,
});
```

查看当前压力：

```ts
const snapshot = media.snapshot();
console.table({
  active: snapshot.activeOperations,
  pending: snapshot.pendingOperations,
  cachedIndexes: snapshot.cachedIndexes,
  cachedIndexBytes: snapshot.cachedIndexBytes,
});
```

Pending 持续接近上限时，优先取消过期请求、限制缩略图并发、使用 proxy 和降低预览 scale。直接把并发从 4 改成 32，通常只会把卡顿转移到 decoder、网络或内存。

## 谁负责关闭帧

浏览器媒体对象经常持有 GPU 或系统资源：`ImageBitmap`、`VideoFrame`、`AudioData` 用完必须关闭或释放。

标准 `PreviewCanvasController` 会在绘制后关闭 bitmap。直接调用 `session.preview.renderFrame()` 时由调用方负责：

```ts
const frame = await session.preview.renderFrame({ timeUs, quality: 'draft' });
try {
  context.drawImage(frame.bitmap, 0, 0);
} finally {
  frame.bitmap.close();
}
```

把这些对象放进长期 UI store 会导致资源无法及时回收。Store 只保存时间、ID 和普通 JSON 数据。

## 生命周期和释放顺序

一个编辑器实例通常这样拥有资源：

```text
UI component
└─ PreviewCanvasController
   └─ Session
      └─ MediaProvider
```

关闭时从外到内：

```ts
preview.dispose();
await session.dispose();
media.dispose();
```

原因很直接：Preview 不再发新帧请求后，Session 才能安全停止 Player、Renderer 和导出；Session 完成清理后，Provider 才不会被正在执行的任务继续访问。

切换 Project 不会自动释放业务创建的 Provider。最简单的做法是一个打开的工程拥有一套 runtime，切换时整套销毁后重建。

注册方法和错误排查见[导入与管理媒体](/AelionSDK/guides/media-import/)，长会话资源检查见[性能与资源预算](/AelionSDK/production/performance/)。
