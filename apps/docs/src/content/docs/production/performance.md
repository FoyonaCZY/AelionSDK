---
title: 预览性能和资源预算
description: 为解码、Canvas、GPU、缩略图、Material、播放和导出设置可测量的上限。
---

剪辑器“卡”不一定是 GPU 帧率。打开素材可能卡在容器索引和网络，拖动可能卡在 seek 和 decoder，播放可能卡在效果和音频填充，导出还会受编码器和存储影响。

## 先定义要测的真实场景

不要只用开发机上一段 5 秒视频看平均 FPS。至少建立下面的矩阵：

| 维度 | 例子                                            |
| ---- | ----------------------------------------------- |
| 设备 | 桌面高配、桌面低配、目标移动设备                |
| 素材 | H.264 MP4、VP9 WebM、VFR、长 GOP、4K 原片       |
| 工程 | 1080p30/4K30、轨道数量、字幕和 Material 数量    |
| 操作 | 首帧、快速 scrub、连续播放、停帧、导出          |
| 指标 | p50/p95 延迟、丢帧、pending、内存峰值、导出倍率 |

把浏览器版本、OS、GPU、是否跨源隔离和素材 hash 一起记录，否则回归数据很难比较。

## 预览的第一层优化

```ts
const preview = attachPreviewCanvas(session, canvas, {
  quality: 'adaptive',
  fit: 'contain',
  adaptiveScales: [1, 0.75, 0.5, 0.35],
  targetFrameMs: 1000 / 30,
});
```

推荐策略：

- 拖动和播放默认 adaptive；
- 复杂工程允许下降到 0.5 或 0.35；
- 用户停止操作后恢复 full，用于停帧检查；
- 4K 原片配尺寸合适的 proxy；
- 每个主视图只保留最新 scrub；
- 缩略图只生成视口附近，并支持取消。

4K Project 不等于主监看窗口也要实时渲染 4K。如果 Canvas 在页面上只有 960×540，使用 4K backing store 通常没有价值。

## 注意 Canvas 的设备像素比

Retina 屏幕 DPR=2 时，像素数量是同尺寸 CSS 面积的 4 倍。可以按设备档位限制：

```ts
const preview = attachPreviewCanvas(session, canvas, {
  quality: 'adaptive',
  pixelRatio: Math.min(window.devicePixelRatio, 1.5),
});
```

`pixelRatio` 控制 Canvas 呈现表面的像素；`renderScale` 控制内部内容渲染比例。两者都会影响清晰度和成本，但作用位置不同。

## Provider 上限

```ts
const media = new ProductionMediaProvider({
  maxCachedIndexes: 8,
  maxCachedIndexBytes: 64 * 1024 * 1024,
  maxConcurrentOperations: 4,
  maxPendingOperations: 64,
});
```

查看压力：

```ts
const mediaStats = media.snapshot();
console.table({
  active: mediaStats.activeOperations,
  pending: mediaStats.pendingOperations,
  indexMiB: mediaStats.cachedIndexBytes / 1024 / 1024,
});
```

Pending 持续增长时，先减少缩略图请求、使用 proxy 和合并 scrub。盲目提高并发会同时增加 decoder、网络、内存和 GPU 压力。

## Session 上限

```ts
const session = await Aelion.createSession({
  media,
  maxPendingFrames: 2,
  maxDiagnostics: 256,
});
```

完整帧评估默认最多 2 个 in-flight，适合 latest-wins 交互。Diagnostic 历史也有上限，避免打开数小时后日志数组无限增长。

不要用很大的 `maxPendingFrames` 解决慢渲染；它会让旧帧占用资源更久，拖动体验反而更差。

## Material 和轨道成本

每条可见 visual 轨都可能增加合成工作；Material 还会增加 pass、纹理采样和中间表面。产品可以：

- 对设备 tier 限制同时启用的重效果数量；
- 在交互中旁路高成本效果，停下后恢复；
- 用 Material 静态预算限制 node、depth、pass 和 texture sample；
- 给第三方 Shader/WASM 更严格的单独预算；
- 提供“预览效果开关”，但导出前明确显示最终效果仍会执行。

## 导出不要与后台任务无限竞争

- 长输出使用 OPFS；
- Memory Sink 的 finalize 会再分配连续数组；
- 导出时减少后台缩略图和波形任务；
- 开始前估算 quota，失败后删除半成品；
- 4K/长片超过设备预算时转 Remote Export；
- 本地导出可以排队，不需要多个 Session 同时满载。

## 读取 Session 统计

```ts
const stats = session.getStats();
console.log(stats.compile);
console.log(stats.preview);
console.log(stats.player);
console.log(stats.export);
```

重点关注：

- compile 是否命中增量更新；
- preview requested/rendered/failed 和 pending；
- 实际 backend、width、height、renderScale；
- player dropped frames、errors 和 audio buffered frames；
- export started/completed/failed/cancelled；
- dispose 后 renderer、scheduler、audio、transport 是否终止。

Stats 更新频率可能很高。性能面板可以本地显示；遥测应每 10–30 秒聚合 p50/p95、最大 pending 和 drop ratio，不要每帧发网络请求。

## 长会话验收

至少循环执行：

1. 打开和关闭多个工程；
2. 快速拖动、seek、播放和暂停；
3. 页面后台/前台切换；
4. 多次成功、取消和故意失败的导出；
5. 网络断开、quota 失败和 context lost；
6. 记录操作前后资源是否回到稳定区间。

单次慢通常还能降质或提示；资源不回落会让两小时后的编辑器突然崩溃，是更危险的问题。
