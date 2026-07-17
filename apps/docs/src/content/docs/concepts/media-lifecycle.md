---
title: 媒体表示与生命周期
description: 理解 Asset、Representation、RangeReader、Proxy、缓存和资源所有权。
---

媒体字节不会嵌入 Project。Project 的 Asset 保存“它是什么”，Media Provider 保存“当前运行时如何读取它”。

## Asset 与 Representation

同一个 Asset 可以注册多个表示：

- `original`：导出必须请求的原始表示；
- `proxy`：预览时可选择的低分辨率表示；
- `thumbnail`：上层缩略图工作流使用；
- `waveform`：上层波形工作流使用。

Provider 根据 `purpose` 和 `maxDimension` 为预览选择合适 proxy；导出始终请求 original。Proxy 可以有 `sourceStartUs`，用于和原片时间线对齐。

## Range-backed 读取

`ProductionMediaProvider` 支持 File/Blob、URL、OPFS 和自定义 RangeReader。它不会默认把整个长视频复制进 JavaScript 内存，而是按范围建立 SampleIndex 和解码请求。

```ts
const media = new ProductionMediaProvider({
  maxCachedIndexes: 8,
  maxCachedIndexBytes: 64 * 1024 * 1024,
  maxConcurrentOperations: 4,
  maxPendingOperations: 64,
});

media.registerFile('asset_1', file, { role: 'original' });
media.registerUrl('asset_1', proxyUrl, {
  role: 'proxy',
  width: 960,
  height: 540,
  headers: { Authorization: `Bearer ${token}` },
});
```

URL 源应支持 Range 请求，并通过 CORS 暴露必要响应头。短期授权 URL 过期后，重新注册表示或由自定义 Reader 刷新授权。

## SampleIndex 和缓存

Provider 为媒体容器创建 SampleIndex，记录轨道、样本、展示顺序和诊断。提供小写 SHA-256 `contentHash` 后，可以进行内容寻址的持久索引复用，避免每次打开工程都重新扫描。

缓存命中不代表 decoder 或 VideoFrame 可以永久保留。索引、解码器、GPU 帧和 PCM 分别受不同资源预算约束。

## 并发与背压

Provider 限制 active 和 pending 操作，并使用页面级 governor 管理 decoder slot、GPU 和 cache 预算。高频 scrub 应由 latest-wins 取消机制收敛，不能无限排队每个时间点。

```ts
const snapshot = media.snapshot();
console.log(snapshot.activeOperations, snapshot.pendingOperations);
```

当 pending 长期增长时，优先降低预览分辨率、取消过期请求、使用 proxy，而不是简单提高上限。

## 所有权顺序

一个典型编辑器实例拥有：

```text
UI
└─ PreviewCanvasController
   └─ Session
      └─ MediaProvider
```

销毁时按外到内释放：Controller → Session → Provider。`ImageBitmap`、`VideoFrame`、AudioData 等可关闭对象在消费后立即关闭。切换 Project 不等于自动释放业务创建的 Provider。

具体注册方式见[导入与管理媒体](../guides/media-import.md)，资源预算见[性能与资源预算](../production/performance.md)。
