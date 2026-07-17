---
title: 性能与资源预算
description: 为预览、播放、解码、缓存和导出建立有界资源策略。
---

视频编辑性能不是单一 FPS 指标。它同时受媒体 seek、decoder slot、GPU 内存、画布尺寸、Material pass、音频缓冲、存储和主线程响应影响。

## 先定义场景预算

按产品目标建立矩阵：

| 维度 | 示例                                 |
| ---- | ------------------------------------ |
| 设备 | 桌面高配、桌面低配、移动端           |
| 工程 | 1080p30/4K30、轨道数、Material 数    |
| 操作 | scrub、播放、停帧、导出              |
| 指标 | p50/p95 帧延迟、drop、内存、导出倍率 |

不要把开发机上一个短素材的平均 FPS 当成生产 SLA。

## 预览策略

- 默认 `quality: 'adaptive'`；
- 交互中允许 0.5 或 0.35 scale；
- 停止拖动后恢复 full 供审片；
- 使用尺寸匹配的 proxy；
- 每个视图只保留一个最新 scrub；
- 缩略图限制并发，并在离开 viewport 后取消。

4K Project 不意味着 4K 实时预览。监看窗口按实际 CSS 尺寸和 DPR 渲染通常更合理。

## Provider 预算

```ts
const media = new ProductionMediaProvider({
  maxCachedIndexes: 8,
  maxCachedIndexBytes: 64 * 1024 * 1024,
  maxConcurrentOperations: 4,
  maxPendingOperations: 64,
});
```

提高并发可能同时增加 decoder、内存、网络和 GPU 压力。观察 `media.snapshot()`，如果 pending 接近上限，先减少生产速率和使用 proxy。

## Session 预算

```ts
const session = await Aelion.createSession({
  media,
  maxPendingFrames: 2,
  maxDiagnostics: 256,
});
```

完整帧评估默认最多 2 个 in-flight，适合 latest-wins 交互。诊断历史有上限，避免长会话无限增长。

## Canvas 和 DPR

Retina 画布像素数可能是 CSS 面积的 4 倍。大屏预览不一定需要完全使用 `devicePixelRatio`；可以按设备档位把 `pixelRatio` 限制为 1–2。质量模式控制内容渲染 scale，pixelRatio 控制呈现表面的清晰度，两者要一起预算。

## Material 成本

Material Graph 在加载时受 node、depth、pass 和 texture sample 静态预算约束。产品还应按设备 tier 限制同时启用的重效果，提供旁路开关，并对第三方 Shader/WASM 使用更严格的执行预算。

## 导出内存

- 长输出使用 OPFS；
- Memory Sink finalize 会创建连续数组；
- 导出与后台缩略图不要并发争抢；
- 检查 quota，并在失败时删除半成品；
- 4K/长片在不满足设备预算时转 Remote Export。

## 可观测指标

```ts
const stats = session.getStats();
console.log(stats.compile);
console.log(stats.preview);
console.log(stats.player);
console.log(stats.export);
```

关键指标包括 compile 时间/缓存、requested/rendered/failed 帧、pending、实际 backend、player dropped frames、音频 buffered frames、export 终态和资源 disposed 状态。

## 长会话测试

生产上线前运行至少：

- 反复打开/关闭工程；
- 连续 scrub 和 seek；
- 播放、暂停、后台/前台；
- 多次成功/取消/失败导出；
- context lost、网络中断、quota 错误；
- 观察资源是否回到基线。

资源没有回落比单次操作慢更危险，它会把长时间编辑变成不可预测的崩溃。
