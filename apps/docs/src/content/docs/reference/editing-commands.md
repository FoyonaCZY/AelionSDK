---
title: Editing Commands 速查
description: 查询时间线命令的关键参数、返回值、共同选项和常见拒绝原因。
---

所有命令位于 `session.transaction.commands`，并同步返回 `TransactionCommit` 或带 commit 的结果。成功后 Project 和 revision 已经更新；不需要再调用 `commit()`。

通用选项：

| 选项            | 用途                                         |
| --------------- | -------------------------------------------- |
| `label?`        | 给历史记录和 ChangeSet 一个可读名称          |
| `baseRevision?` | 乐观并发检查；过期时返回 `REVISION_CONFLICT` |
| `historyGroup?` | 把相邻且 key 相同的编辑合成一条 undo 记录    |

## Item

| 命令               | 必填/关键选项                                       | 返回                |
| ------------------ | --------------------------------------------------- | ------------------- |
| `insertItem`       | `item`, `beforeItemId?`                             | `TransactionCommit` |
| `removeItem`       | `itemId`                                            | `TransactionCommit` |
| `moveItem`         | `itemId`, `toTrackId?`, `startUs?`, `beforeItemId?` | `TransactionCommit` |
| `trimItem`         | `itemId`, `edge`, `toUs`                            | `TransactionCommit` |
| `splitItem`        | `itemId`, `rightItemId`, `atUs`                     | `SplitItemResult`   |
| `replaceItem`      | `itemId`, `replacement`                             | `TransactionCommit` |
| `rippleInsertItem` | insert 选项，`trackIds?`                            | `TransactionCommit` |
| `rippleRemoveItem` | remove 选项，`trackIds?`                            | `TransactionCommit` |

```ts
const split = session.transaction.commands.splitItem({
  itemId: 'item_left',
  rightItemId: 'item_right',
  atUs: 5_000_000,
  baseRevision: session.revision!,
  label: '切分片段',
});

console.log(split.leftItemId, split.rightItemId, split.commit.revision);
```

`replaceItem` 不能改变 ID、Track 或所有权结构。结构变化使用 move/link 等专门命令。

## Link Group

| 命令                | 关键选项                                          |
| ------------------- | ------------------------------------------------- |
| `linkItems`         | `groupId`, `itemIds`, `kind?`                     |
| `unlinkItems`       | `groupId`, `itemIds?`                             |
| `moveLinkedGroup`   | `groupId`, `deltaUs`                              |
| `trimLinkedGroup`   | `groupId`, `edge`, `amountUs`                     |
| `removeLinkedGroup` | `groupId`                                         |
| `splitLinkedGroup`  | `groupId`, `rightGroupId`, `atUs`, `rightItemIds` |

Linked split 要求所有成员都包含切分点。调用方为每个右侧 Item 和新 Group 提供未使用的 ID。

```ts
const rightItemIds = Object.fromEntries(
  group.itemIds.map(itemId => [itemId, nextEntityId('item')]),
);

session.transaction.commands.splitLinkedGroup({
  groupId: group.id,
  rightGroupId: nextEntityId('link'),
  atUs: playheadUs,
  rightItemIds,
});
```

## 专业修剪

| 命令        | 参数                                | 结果                           |
| ----------- | ----------------------------------- | ------------------------------ |
| `slipItem`  | `itemId`, `deltaSourceUs`           | 时间线范围不动，移动原素材窗口 |
| `rollEdit`  | `leftItemId`, `rightItemId`, `toUs` | 改相邻边界，两个片段总范围不变 |
| `slideItem` | `itemId`, `deltaUs`                 | 移动中间片段，并补偿左右邻居   |

这些命令会检查 source handle、相邻关系、Transition 和 TimeMap。当前映射无法安全修改时返回 `COMMAND_TIME_MAPPING_UNSUPPORTED`。

## Track

| 命令              | 关键选项                                  |
| ----------------- | ----------------------------------------- |
| `reorderTrack`    | `sequenceId`, `trackId`, `beforeTrackId?` |
| `setTrackLocked`  | `trackId`, `value`                        |
| `setTrackEnabled` | `trackId`, `value`                        |
| `setTrackMuted`   | `trackId`, `value`                        |
| `setTrackSolo`    | `trackId`, `value`                        |

Mute/Solo 只适用于有 audio mixer 属性的音频轨。Locked 轨会拒绝对其 Item 的编辑。

## Marker 和选择元数据

| 命令                   | 关键选项                          |
| ---------------------- | --------------------------------- |
| `addMarker`            | 完整 `marker`                     |
| `updateMarker`         | `markerId` 和要更新的字段         |
| `removeMarker`         | `markerId`                        |
| `setSelectionMetadata` | `sequenceId`, `itemIds`, `range?` |

`markerLabel: null` 或 `markerColor: null` 用于删除可选字段。普通临时选择留在 UI state；只有需要保存或协作的选择才写 selection metadata。

## 失败后的保证

命令会检查实体存在、轨道类型、锁定、时间、source handle、Transition、引用、所有权和 no-op。失败时抛出带 Diagnostic 的 `AelionError`，Project、revision 和 history 都不变化。

选项的精确 TypeScript 类型见 API Reference 的 `@aelion/transaction`，实际拖拽模式见[时间线编辑](/AelionSDK/guides/timeline-editing/)。
