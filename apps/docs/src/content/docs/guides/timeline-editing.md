---
title: 时间线编辑
description: 使用高层 Editing Commands 实现插入、移动、裁剪、切分和专业修剪操作。
---

时间线 UI 应把用户意图翻译成 `session.transaction.commands`。命令在一次原子提交中维护 Project 引用、顺序和历史。

## 基础命令

### 移动

```ts
session.transaction.commands.moveItem({
  itemId: 'item_broll',
  toTrackId: 'track_visual_2',
  startUs: 4_000_000,
  beforeItemId: null,
  baseRevision: session.revision!,
});
```

省略 `toTrackId` 保持原轨。省略 `beforeItemId` 在同轨移动时保持顺序；显式 `null` 表示移到末尾。

### 裁剪

```ts
session.transaction.commands.trimItem({
  itemId: 'item_broll',
  edge: 'end',
  toUs: 7_500_000,
});
```

`toUs` 是 Sequence 时间中的新边界。裁剪会同步调整媒体 source range 和时间映射。

### 切分

```ts
const split = session.transaction.commands.splitItem({
  itemId: 'item_broll',
  rightItemId: 'item_broll_right',
  atUs: 5_000_000,
});
```

调用方负责生成未占用的右片段 ID。切分点必须严格位于片段内部。

### 移除与插入

`removeItem()` 删除单个 Item；`insertItem()` 接收完整、合法的 `ItemEntity`。如果插入或移除需要让后续内容整体移动，使用 `rippleInsertItem()` / `rippleRemoveItem()`。

## 联动音视频

导入带音频的视频后通常存在 `av-sync` link group。使用 group-aware 命令维持同步：

```ts
session.transaction.commands.moveLinkedGroup({
  groupId: 'link_asset_main',
  deltaUs: 500_000,
});

session.transaction.commands.trimLinkedGroup({
  groupId: 'link_asset_main',
  edge: 'start',
  amountUs: 100_000,
});
```

还可以 `splitLinkedGroup()`、`removeLinkedGroup()`、`linkItems()` 和 `unlinkItems()`。UI 应明确提供“联动选择”开关，而不是悄悄只移动其中一条轨。

## 专业修剪

| 命令        | Timeline 范围 | Source 内容        | 邻接片段         |
| ----------- | ------------- | ------------------ | ---------------- |
| `slipItem`  | 不变          | 平移 source window | 不变             |
| `rollEdit`  | 总范围不变    | 改变共享边界       | 同时改左右片段   |
| `slideItem` | 中间片段平移  | 自身内容不变       | 补偿两侧边界     |
| `ripple*`   | 改变          | 按命令变化         | 后续片段整体移动 |

```ts
session.transaction.commands.slipItem({
  itemId: 'item_take_2',
  deltaSourceUs: -250_000,
});

session.transaction.commands.rollEdit({
  leftItemId: 'item_a',
  rightItemId: 'item_b',
  toUs: 6_200_000,
});
```

## 轨道、Marker 和选择元数据

```ts
session.transaction.commands.setTrackLocked({ trackId, value: true });
session.transaction.commands.setTrackMuted({ trackId: audioTrackId, value: true });
session.transaction.commands.setTrackSolo({ trackId: audioTrackId, value: false });
session.transaction.commands.reorderTrack({ sequenceId, trackId, beforeTrackId });
```

Marker 使用 `addMarker`、`updateMarker`、`removeMarker`。`setSelectionMetadata` 可把需要持久化或协作的选择范围写入 Sequence 扩展语义；普通临时选中更适合留在 UI 状态。

## 拖拽实现模式

1. pointerdown 时保存 revision、初始范围和命中对象；
2. pointermove 在 UI 中完成像素→时间、吸附和约束；
3. 使用 Interactive Edit 更新 Project；
4. pointerup `commit()`；Escape 或 pointercancel `cancel()`；
5. `project-changed` 事件驱动 Timeline 和预览刷新。

不要直接修改 `session.getSnapshot().project`；快照是只读、冻结且可能在下一 revision 被替换。

全部命令选项见 [Editing Commands](../reference/editing-commands.md)。
