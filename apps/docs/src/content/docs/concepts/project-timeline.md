---
title: Project 与 Timeline
description: 理解 Aelion Project v1 的实体图、轨道、片段、转场、Marker 和扩展数据。
---

AelionSDK 的核心输入是一个可序列化的 Project JSON。它不是把 UI 状态原样保存下来，而是描述渲染和编辑所需的稳定工程事实。

## Project 是实体图

Project 顶层使用按 ID 索引的集合：

```text
Project
├─ assets              素材描述和定位信息
├─ sequences           画布格式、时长和有序轨道列表
├─ tracks              visual / audio / caption 轨道
├─ items               时间线片段
├─ materialInstances   Filter / Effect / Generator 参数实例
├─ transitions         两个片段之间的转场
├─ markers             序列或片段标记
├─ linkGroups          音视频同步组或编辑组
└─ extensions          有命名空间的业务扩展
```

集合使用对象而不是大数组，便于通过稳定 ID 引用、增量修改和计算受影响范围。有顺序的关系由 `sequence.trackIds`、`track.itemIds` 等 ID 列表表达。

## Sequence 决定输出格式

每个 Sequence 包含：

- `format.width` / `height`：输出画布尺寸；
- `pixelAspectRatio` 和 `frameRate`：像素、帧量化语义；
- `sampleRate` 和 `channelLayout`：音频输出格式；
- `workingColorSpace` 和 `backgroundColor`：合成空间；
- `duration`：按内容推导或固定时长；
- 有序的轨道、转场、Material 和 Marker ID。

当前 SDK 默认加载 `settings.defaultSequenceId`，也可以在创建 Session 时通过 `sequenceId` 指定。

## Track 与 Item

Track 有 `visual`、`audio`、`caption` 三种 kind，并拥有 `enabled`、`locked`、音频 `muted/solo` 等状态。Item 通过 `trackId` 归属轨道，通过 `range.startUs` 和 `range.durationUs` 占据时间线区间。

媒体 Item 还会描述：

- `assetId` 和 `streamIndex`；
- source 区间与 timeline 区间；
- 边界行为 `error`、`hold`、`loop` 或 `transparent`；
- 画面 fit、opacity、音量、pan；
- TimeMap、关键帧和 Material 实例引用。

Project Builder 覆盖常见媒体工程创建；更复杂的实体通过 Schema 和 Transaction API 操作。

## Asset 不是媒体字节

Asset 只保存稳定描述，例如 MIME、hash、字节数、locator、probe hint 和 representations。真正的 `File`、URL reader、OPFS handle、缓存和 decoder 属于 Media Provider 的运行时状态。

这条边界让 Project 能够：

- JSON 序列化和版本控制；
- 在另一台设备恢复；
- 把 locator 替换成授权后的 URL；
- 使用 proxy 预览而保持原片导出。

## Link Group

`av-sync` 用于表示同一素材的音视频联动，`edit-group` 用于上层定义的编辑组。移动、裁剪、移除和分割都有 group-aware 命令。Link Group 是编辑语义，不等同于视觉层级。

## Marker

Marker 可以属于 Sequence 或 Item，包含 `timeUs`、`durationUs`、label、color 和 JSON payload。它适合章节、审核意见、节拍点、字幕检查点和业务锚点，不参与渲染，除非上层把它转换成可见 Item 或 Material。

## 创建与加载

```ts
import { Aelion, createProject, seconds } from '@aelion/sdk';

const builder = createProject({
  projectId: 'project_campaign',
  sequenceId: 'sequence_landscape',
  width: 3840,
  height: 2160,
  frameRate: { numerator: 30, denominator: 1 },
});

const visualTrack = builder.addTrack({ kind: 'visual', name: '主画面' });
builder.addMarker({ timeUs: seconds(5), label: 'Logo 出现' });

const session = await Aelion.createSession();
await session.loadProject(builder.build());
```

`build()` 和 `loadProject()` 都会拒绝不符合 v1 约束的文档。字段级说明见 [Project Schema](/AelionSDK/reference/project-schema/)。
