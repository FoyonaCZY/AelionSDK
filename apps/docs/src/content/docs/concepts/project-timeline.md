---
title: Project 和时间线数据
description: 看懂 Aelion Project v1 中的 Sequence、Track、Item、Asset、Link Group 和 Marker。
---

调用 `session.loadProject()` 时传入的是一份 Project JSON。它记录“这条片应该怎么剪”，但不包含视频文件、解码器、播放状态和撤销栈。

如果你只想先把一个文件跑起来，可以直接使用 `createProject()`；只有要保存工程、渲染复杂时间线或做自定义导入时，才需要理解本页结构。

## 一份 Project 里有什么

```text
Project
├─ assets              用到哪些素材
├─ sequences           输出画布、帧率、音频格式和轨道顺序
├─ tracks              visual / audio / caption 轨道
├─ items               时间线上的片段
├─ materialInstances   效果、滤镜和生成器参数
├─ transitions         两个片段之间的转场
├─ markers             章节、审核意见等时间标记
├─ linkGroups          音视频联动组或编辑组
└─ extensions          不影响渲染的业务扩展
```

这些集合都是按 ID 索引的对象。例如 `project.items.item_video_1` 对应 ID 为 `item_video_1` 的片段。真正有顺序的地方会另外存 ID 数组：

- `sequence.trackIds` 决定轨道顺序；
- `track.itemIds` 决定该轨的 Item 列表顺序；
- `sequence.transitionIds` 和 `markerIds` 也是显式列表。

这样移动单个片段时不用复制整棵嵌套 JSON，也能清楚计算哪些实体和时间范围受影响。

## Sequence 决定成片规格

一个 Sequence 可以理解为一条可以单独输出的时间线。常用字段：

```json
{
  "id": "sequence_main",
  "format": {
    "width": 1920,
    "height": 1080,
    "pixelAspectRatio": { "numerator": 1, "denominator": 1 },
    "frameRate": { "numerator": 30, "denominator": 1 },
    "sampleRate": 48000,
    "channelLayout": "stereo",
    "workingColorSpace": "srgb-linear",
    "backgroundColor": {
      "space": "srgb-linear",
      "rgba": [0, 0, 0, 1]
    }
  },
  "duration": { "mode": "content" },
  "trackIds": ["track_video", "track_audio"]
}
```

- `width`/`height` 是预览完整画布和导出的目标尺寸；
- `frameRate` 使用分数，29.97 fps 要写成 `30000/1001`；
- `sampleRate` 和 `channelLayout` 决定混音输出；
- `duration.mode: content` 根据内容末尾推导总时长；
- 固定广告时长可以改成 fixed，并配置超出部分怎么处理。

Session 默认加载 `settings.defaultSequenceId`。同一 Project 可以保存多个 Sequence，但一个 Session 当前只执行选中的那一个；创建 Session 时可传 `sequenceId` 指定。

## Track 是容器，Item 才是内容

Track 有三种：

| kind      | 能放什么                                    |
| --------- | ------------------------------------------- |
| `visual`  | 视频、图片、文字、生成器、调整层等画面 Item |
| `audio`   | 音频 Item，并带 mute、solo、gain 和 pan     |
| `caption` | 字幕 Item                                   |

每个 Item 都有时间范围：

```json
{
  "id": "item_video_1",
  "trackId": "track_video",
  "type": "video",
  "enabled": true,
  "range": {
    "startUs": 2000000,
    "durationUs": 3000000
  }
}
```

它表示片段从时间线 2 秒开始，占 3 秒，覆盖半开区间 `[2s, 5s)`。Item 的 `type` 必须与 Track 的 `kind` 兼容。

## 同一个媒体片段有两套时间

视频 Item 还需要说明从原素材哪里读取：

```json
{
  "source": {
    "assetId": "asset_camera_a",
    "stream": { "type": "video", "index": 0 },
    "sourceRange": {
      "startUs": 500000,
      "durationUs": 3000000
    },
    "timeMapping": {
      "type": "linear",
      "rate": { "numerator": 1, "denominator": 1 },
      "reverse": false,
      "boundary": "hold"
    }
  }
}
```

结合前一个例子，它的含义是：在时间线 2–5 秒显示原素材 0.5–3.5 秒。移动 Item 只改变 `range.startUs`；slip 则保持时间线位置不变，改变 `sourceRange`。

`boundary` 决定读取越过 source range 时怎么办：报错、保持最后一帧、循环或透明。普通视频导入由 Builder 设置合适缺省值，不需要每次手写。

## Asset 为什么不保存 File

Asset 记录素材身份：

```json
{
  "id": "asset_camera_a",
  "kind": "video",
  "name": "A001.mp4",
  "mimeType": "video/mp4",
  "locator": {
    "type": "business-asset",
    "assetKey": "media_01J7Y4Q0"
  }
}
```

Project 可以保存这段 JSON，但 `File`、签名 URL header、OPFS handle 和 decoder 不能序列化，也不应该进入工程。打开工程时，应用根据 locator 重新授权，然后向 Media Provider 注册同一个 Asset ID。

这使同一份 Project 可以在另一台设备打开，也可以预览时用 proxy、导出时换回 original。

## Link Group 保持音画联动

带声音的视频通常会产生两个 Item：visual 轨一个，audio 轨一个。它们通过 `av-sync` Link Group 关联：

```json
{
  "id": "link_av_1",
  "kind": "av-sync",
  "itemIds": ["item_video_1", "item_audio_1"],
  "syncOffsetsUs": {
    "item_video_1": 0,
    "item_audio_1": 0
  }
}
```

移动、裁剪和切分时使用 group-aware 命令，就不会只改画面或声音。`edit-group` 则可以表达产品定义的多个片段联动。Link Group 只影响编辑方式，不代表视觉父子层级。

## Marker 是不参与成片的时间标记

```ts
builder.addMarker({
  timeUs: 5_000_000,
  durationUs: 0,
  label: 'Logo 出现',
  color: '#ffb020',
  payload: { reviewId: 'review_42' },
});
```

Marker 可以属于 Sequence，也可以属于某个 Item。它适合章节、审核意见、节拍点和检查点。除非你的应用另外把它转换成文字或效果，Marker 本身不会出现在导出视频中。

## 用 Builder 创建工程

```ts
import { Aelion, createProject, seconds } from '@aelion/sdk';

const builder = createProject({
  projectId: 'project_campaign',
  sequenceId: 'sequence_landscape',
  title: '夏季活动主片',
  width: 3840,
  height: 2160,
  frameRate: { numerator: 30, denominator: 1 },
});

builder.addTrack({ id: 'track_visual_main', kind: 'visual', name: '主画面' });
builder.addMarker({ timeUs: seconds(5), label: 'Logo 出现' });

const project = builder.build();
const session = await Aelion.createSession();
await session.loadProject(project);
```

`build()` 会先检查 Builder 生成的结构，`loadProject()` 还会做完整输入、引用和执行检查。业务代码通常不需要手写完整 Project；需要查看字段时再查 [Project Schema](/AelionSDK/reference/project-schema/)。
