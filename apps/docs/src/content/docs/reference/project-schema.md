---
title: Project Schema
description: Project v1 顶层字段、集合、实体关系和加载校验参考。
---

Project v1 的机器可读 Schema 位于仓库 `schemas/project/v1/project.schema.json`。本页用于快速查找，不替代 JSON Schema。

## 顶层

| 字段                | 类型            | 说明                         |
| ------------------- | --------------- | ---------------------------- |
| `$schema`           | string          | v1 Schema URL                |
| `schemaVersion`     | string          | 当前 `1.0.0`                 |
| `projectId`         | EntityId        | 工程稳定 ID                  |
| `metadata`          | object          | 标题等非渲染元数据           |
| `settings`          | ProjectSettings | 默认 Sequence 和缺失资源策略 |
| `assets`            | record          | 媒体/字体/LUT/binary 描述    |
| `sequences`         | record          | 输出格式和轨道列表           |
| `tracks`            | record          | visual/audio/caption 轨道    |
| `items`             | record          | 时间线内容                   |
| `materialInstances` | record          | Material 定义和参数实例      |
| `transitions`       | record          | 相邻 Item 转场               |
| `markers`           | record          | Sequence/Item Marker         |
| `linkGroups`        | record          | av-sync/edit-group           |
| `extensions`        | object          | 命名空间业务扩展             |

Entity ID 必须以字母开头，只包含字母、数字、`.`、`_`、`:`、`-`，长度不超过 128。集合 key 必须等于实体 `id`。

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

ProjectBuilder 默认三个 missing policy 都为 `error`，保证生产路径 fail closed。

## Sequence

Sequence 拥有 `format`、`duration`、`trackIds`、`transitionIds`、`materialInstanceIds`、`markerIds`。

Format 的核心字段：width/height、pixelAspectRatio、frameRate、sampleRate、channelLayout、workingColorSpace、backgroundColor。Duration 可以按内容推导，或固定 duration + overflow 策略。

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
  audio?: { gainDb: JsonValue; pan: JsonValue; muted: boolean; solo?: boolean };
}
```

Item 的 type 必须与 Track kind 兼容；Track 只能由所属 Sequence 的 `trackIds` 持有。

## Item

所有 Item 共享：id、trackId、type、enabled、`range: { startUs, durationUs }`、materialInstanceIds，可选 markerIds 和 linkGroupId。

媒体 Item 还包含 source：

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

Audio properties支持 gainDb、pan、fadeInUs、fadeOutUs、varispeed pitchPolicy 和 channelMap。Visual properties、动画、嵌套 Sequence、Mask/Matte 的完整结构以 JSON Schema/API 为准。

## Transition

Transition 指定 sequenceId、trackId、fromItemId、toItemId、range 和 materialInstanceId。Visual transition 必须处于同轨相关 Item 的有效重叠/handle 范围；同一 Sequence 的 visual transition range 不能产生歧义重叠。

## Marker 与 Link Group

Marker owner 是 `{ type: 'sequence' | 'item', id }`，时间相对 owner 语义解释。Link Group kind 是 `av-sync` 或 `edit-group`，包含 itemIds 和可选 syncOffsetsUs。

## 加载校验

`session.loadProject(unknown)` 依次执行：

1. 不可信输入 admission 和预算；
2. canonical clone；
3. JSON Schema；
4. 实体 key、引用和所有权；
5. 时间、transition、mapping、mask 和 Material 语义；
6. 编译 Render IR。

任何一步失败都不会发布半加载 Session。错误码见 [Diagnostic Codes](./diagnostic-codes.md)。
