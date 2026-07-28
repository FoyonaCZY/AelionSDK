---
title: Project v1 字段参考
description: 查询 Project 顶层集合、实体关系、ID、Sequence、Track、Item、Asset 和加载校验。
---

机器可读的完整定义是 [`schemas/project/v1/project.schema.json`](https://github.com/FoyonaCZY/AelionSDK/blob/main/schemas/project/v1/project.schema.json)。本页用于日常查询；创建普通工程时优先用 `createProject()`，不要从空对象手写整份 JSON。

## 顶层字段

| 字段                | 类型            | 保存什么                       |
| ------------------- | --------------- | ------------------------------ |
| `$schema`           | string          | v1 Schema URL                  |
| `schemaVersion`     | string          | 当前为 `1.0.0`                 |
| `projectId`         | EntityId        | 工程稳定 ID                    |
| `metadata`          | object          | 标题等非渲染元数据             |
| `settings`          | ProjectSettings | 默认 Sequence 和缺失资源策略   |
| `assets`            | record          | 媒体、字体、LUT 和 binary 描述 |
| `sequences`         | record          | 输出规格、时长和轨道顺序       |
| `tracks`            | record          | visual/audio/caption 轨道      |
| `items`             | record          | 时间线内容                     |
| `materialInstances` | record          | Material 引用和参数            |
| `transitions`       | record          | 两个 Item 之间的转场           |
| `markers`           | record          | Sequence 或 Item 的时间标记    |
| `linkGroups`        | record          | `av-sync` / `edit-group`       |
| `extensions`        | object          | 命名空间业务 JSON              |

集合 key 必须等于实体自己的 `id`。

## Entity ID

规则：

- 以英文字母开头；
- 后面只使用字母、数字、`.`、`_`、`:`、`-`；
- 最长 128 个字符；
- 在 Project 内不能与其他实体 ID 冲突。

安全生成：

```ts
function nextEntityId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '_')}`;
}
```

不要直接使用文件名、用户输入标题或数组下标。标题可能含非法字符，数组下标在协作和重排后也不稳定。

## Settings

```ts
interface ProjectSettings {
  defaultSequenceId: string;
  defaultStillDurationUs: number;
  missingAssetPolicy: 'placeholder' | 'error';
  missingMaterialPolicy: 'placeholder' | 'error';
  missingPluginPolicy: 'placeholder' | 'error';
  locale?: string;
  timezone?: string;
}
```

Project Builder 默认把三个 missing policy 设为 `error`。这样缺素材或缺 Material 时加载失败，不会悄悄产出和预期不同的成片。

## Sequence

Sequence 必须包含 `format`、`duration`、`trackIds`、`transitionIds`、`materialInstanceIds` 和 `markerIds`。

`format` 的核心字段：

- `width` / `height`；
- `pixelAspectRatio`；
- `frameRate`；
- `sampleRate`；
- `channelLayout`；
- `workingColorSpace`；
- `backgroundColor`。

`duration` 可以是 `{ mode: 'content' }`，也可以固定时长并指定 overflow。Session 默认执行 `settings.defaultSequenceId` 指向的 Sequence。

## Track

```ts
interface TrackEntity {
  id: string;
  sequenceId: string;
  kind: 'visual' | 'audio' | 'caption';
  enabled: boolean;
  locked: boolean;
  itemIds: string[];
  materialInstanceIds: string[];
  audio?: {
    gainDb: JsonValue;
    pan: JsonValue;
    muted: boolean;
    solo?: boolean;
  };
}
```

Track 必须被自己的 Sequence `trackIds` 持有。audio mixer 字段只用于音频轨。`itemIds` 的顺序与 Item 的时间位置不是同一件事；时间由 `item.range` 决定。

## Item 公共字段

所有 Item 都有：

- `id`、`trackId`、`type`；
- `enabled`；
- `range: { startUs, durationUs }`；
- `materialInstanceIds`；
- 可选 `markerIds` 和 `linkGroupId`。

媒体 Item 的 source：

```json
{
  "assetId": "asset_1",
  "stream": { "type": "video", "index": 0 },
  "sourceRange": { "startUs": 0, "durationUs": 3000000 },
  "timeMapping": {
    "type": "linear",
    "rate": { "numerator": 1, "denominator": 1 },
    "reverse": false,
    "boundary": "hold"
  }
}
```

Item type 必须与 Track kind 匹配。完整 visual、audio、caption、text、generator、adjustment、nested sequence 和动画字段请查 JSON Schema 或 API Reference。

## Transition、Marker 和 Link Group

Transition 指定 `sequenceId`、`trackId`、`fromItemId`、`toItemId`、`range` 和 `materialInstanceId`。它必须落在同轨左右 Item 的有效重叠/handle 范围，visual transition 之间不能产生解释歧义的重叠。

Marker 的 owner 是 Sequence 或 Item，带 `timeUs`、`durationUs`、label、color 和 payload。它本身不渲染。

Link Group kind 是 `av-sync` 或 `edit-group`，保存 `itemIds` 和可选 `syncOffsetsUs`。联动编辑使用 group-aware 命令。

## `loadProject()` 会做什么

```ts
const input: unknown = JSON.parse(text);
await session.loadProject(input);
```

加载顺序：

1. 限制不可信输入的深度、节点、数组、属性和字符串大小；
2. 复制为纯 JSON，隔离调用方后续修改；
3. JSON Schema；
4. 实体 key、引用、所有权和顺序；
5. 时间、Transition、TimeMap、Mask 和 Material；
6. 编译 Render IR；
7. 全部成功后发布 Project 和 revision。

任一步失败都不会留下半加载 Session。根据返回的 `path`、`entityId` 和 code 定位，错误码见 [Diagnostic Codes](/AelionSDK/reference/diagnostic-codes/)。
