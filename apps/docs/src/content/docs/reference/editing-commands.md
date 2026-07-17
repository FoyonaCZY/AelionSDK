---
title: Editing Commands
description: Aelion 高层编辑命令、主要选项、返回值和拒绝条件。
---

所有命令位于 `session.transaction.commands`。通用选项是 `label?`、`baseRevision?`、`historyGroup?`。

## Item

| 命令               | 关键选项                                            | 返回              |
| ------------------ | --------------------------------------------------- | ----------------- |
| `insertItem`       | `item`, `beforeItemId?`                             | TransactionCommit |
| `removeItem`       | `itemId`                                            | TransactionCommit |
| `moveItem`         | `itemId`, `toTrackId?`, `startUs?`, `beforeItemId?` | TransactionCommit |
| `trimItem`         | `itemId`, `edge`, `toUs`                            | TransactionCommit |
| `splitItem`        | `itemId`, `rightItemId`, `atUs`                     | SplitItemResult   |
| `replaceItem`      | `itemId`, `replacement`                             | TransactionCommit |
| `rippleInsertItem` | insert options, `trackIds?`                         | TransactionCommit |
| `rippleRemoveItem` | remove options, `trackIds?`                         | TransactionCommit |

`replaceItem` 不允许改变 id、track 或 ownership topology；结构移动使用专门命令。

## Link Group

| 命令                | 关键选项                                          |
| ------------------- | ------------------------------------------------- |
| `linkItems`         | `groupId`, `itemIds`, `kind?`                     |
| `unlinkItems`       | `groupId`, `itemIds?`                             |
| `moveLinkedGroup`   | `groupId`, `deltaUs`                              |
| `trimLinkedGroup`   | `groupId`, `edge`, `amountUs`                     |
| `removeLinkedGroup` | `groupId`                                         |
| `splitLinkedGroup`  | `groupId`, `rightGroupId`, `atUs`, `rightItemIds` |

Linked split 要求所有成员包含切分点，并由调用方提供每个右侧 Item 的新 ID。

## 专业修剪

| 命令        | 关键选项                            | 语义                              |
| ----------- | ----------------------------------- | --------------------------------- |
| `slipItem`  | `itemId`, `deltaSourceUs`           | Timeline 不动，移动 source window |
| `rollEdit`  | `leftItemId`, `rightItemId`, `toUs` | 改相邻共享边界                    |
| `slideItem` | `itemId`, `deltaUs`                 | 平移中间片段，补偿邻居            |

命令会拒绝不足的 source handle、非邻接 Item、transition 冲突和无法安全修改的 TimeMap。

## Track

| 命令              | 关键选项                                  |
| ----------------- | ----------------------------------------- |
| `reorderTrack`    | `sequenceId`, `trackId`, `beforeTrackId?` |
| `setTrackLocked`  | `trackId`, `value`                        |
| `setTrackEnabled` | `trackId`, `value`                        |
| `setTrackMuted`   | `trackId`, `value`                        |
| `setTrackSolo`    | `trackId`, `value`                        |

Mute/Solo 只适用于带 audio mixer properties 的音频轨。

## Marker 与选择

| 命令                   | 关键选项                          |
| ---------------------- | --------------------------------- |
| `addMarker`            | 完整 `marker`                     |
| `updateMarker`         | `markerId` 和需要更新的字段       |
| `removeMarker`         | `markerId`                        |
| `setSelectionMetadata` | `sequenceId`, `itemIds`, `range?` |

`markerLabel: null` / `markerColor: null` 用于移除对应可选字段。

## 失败行为

命令执行前检查实体、track kind、lock、时间、source handle、transition、ownership 和 no-op。失败时抛出带 Diagnostic 的 `AelionError`，Project 和 revision 不变。

UI 应在可能时预检查并提供即时反馈，但不能绕过内核验证。完整拒绝 code 见 [Diagnostic Codes](./diagnostic-codes.md)，精确 TypeScript 类型见 API Reference 的 `@aelion/transaction`。
