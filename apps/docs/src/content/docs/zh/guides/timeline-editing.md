---
title: 时间线编辑
description: 把移动、裁剪、切分、联动编辑和拖拽手势接到 Transaction Commands。
---

时间线 UI 不直接修改 Project。它先把鼠标位置换算成微秒，再调用 `session.transaction.commands`。命令成功后，Session 会发布新 Project 和 revision，撤销记录也会自动更新。

## 从当前 Project 读取片段

```ts
const snapshot = session.getSnapshot();
const project = snapshot.project;
if (project === null) throw new Error('还没有加载工程');

const item = project.items[selectedItemId];
if (item === undefined) throw new Error('选中的片段已经不存在');
```

Snapshot 是只读对象。每次 `project-changed` 后重新取最新 snapshot，不要长期保留某个 Item 对象并假设它会自动更新。

## 移动片段

```ts
session.transaction.commands.moveItem({
  itemId: item.id,
  toTrackId: 'track_visual_2',
  startUs: 4_000_000,
  beforeItemId: null,
  baseRevision: session.revision!,
  label: '移动片段',
});
```

- 省略 `toTrackId`：留在原轨；
- 省略 `startUs`：只改轨道或顺序；
- 同轨移动时省略 `beforeItemId`：保持现有列表位置；
- `beforeItemId: null`：把 Item 放到目标轨末尾；
- `baseRevision`：保证命令仍然基于用户开始操作时的工程版本。

轨道 kind 必须匹配。video Item 只能进入 visual 轨，audio Item 只能进入 audio 轨；目标轨 locked 时命令也会被拒绝。

## 裁剪片段

```ts
session.transaction.commands.trimItem({
  itemId: item.id,
  edge: 'end',
  toUs: 7_500_000,
  label: '裁剪片段结尾',
});
```

`toUs` 是时间线上的新边界，不是“要减少多少微秒”。例如片段从 4 秒开始，把 end 裁到 7.5 秒，最终时长就是 3.5 秒。

裁剪媒体片段时，命令也会更新 source range。超出原素材可用区间、时长变成 0、轨道锁定或与转场冲突都会失败。

## 切分片段

```ts
const result = session.transaction.commands.splitItem({
  itemId: item.id,
  rightItemId: `item_${crypto.randomUUID().replaceAll('-', '_')}`,
  atUs: playheadUs,
  label: '在播放头切分',
});

selectItem(result.rightItemId);
```

`atUs` 必须严格落在片段内部。右半段需要一个尚未使用的新 ID；SDK 不替调用方生成，是为了让协作、重放和测试使用稳定标识。

## 带声音的视频要联动编辑

`builder.importMedia()` 导入有声视频后，会创建 `av-sync` link group。判断当前 Item 是否属于组：

```ts
const groupId = item.linkGroupId;
```

联动移动：

```ts
if (groupId !== undefined) {
  session.transaction.commands.moveLinkedGroup({
    groupId,
    deltaUs: 500_000,
  });
}
```

联动切分需要为每个成员准备右侧 ID：

```ts
const group = project.linkGroups[groupId];
if (group === undefined) throw new Error('联动组不存在');

const rightItemIds = Object.fromEntries(
  group.itemIds.map(id => [id, `item_${crypto.randomUUID().replaceAll('-', '_')}`]),
);

session.transaction.commands.splitLinkedGroup({
  groupId,
  rightGroupId: `link_${crypto.randomUUID().replaceAll('-', '_')}`,
  atUs: playheadUs,
  rightItemIds,
});
```

如果产品允许用户临时取消联动，应在 UI 中明确显示状态。不要静默只移动视频，让声音留在原位置。

## Ripple、Slip、Roll 和 Slide

| 操作                                    | 片段在时间线上的范围 | 原素材读取区间    | 相邻内容         |
| --------------------------------------- | -------------------- | ----------------- | ---------------- |
| `rippleInsertItem` / `rippleRemoveItem` | 新增或减少           | 随插入/移除项变化 | 后续片段整体移动 |
| `slipItem`                              | 不变                 | 前后移动          | 不变             |
| `rollEdit`                              | 两个片段总范围不变   | 左右边界一起变化  | 只影响这两个片段 |
| `slideItem`                             | 中间片段移动         | 中间内容不变      | 两侧片段补偿     |

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

session.transaction.commands.slideItem({
  itemId: 'item_b',
  deltaUs: 300_000,
});
```

这些命令会检查相邻关系和 source handle。UI 可以提前算出允许范围，给用户显示边界；内核仍会在提交时再次验证。

## 轨道控制

```ts
session.transaction.commands.setTrackLocked({ trackId, value: true });
session.transaction.commands.setTrackEnabled({ trackId, value: false });
session.transaction.commands.setTrackMuted({ trackId: audioTrackId, value: true });
session.transaction.commands.setTrackSolo({ trackId: audioTrackId, value: true });

session.transaction.commands.reorderTrack({
  sequenceId,
  trackId,
  beforeTrackId,
});
```

Locked 轨不允许编辑；enabled 决定轨道是否参与工程；muted/solo 只适用于音频轨。这些是 Project 状态，会随工程保存。

## Marker

Marker 适合章节、审核意见、节拍点和业务锚点。它不会自动显示在成片中。

```ts
session.transaction.commands.addMarker({
  marker: {
    id: 'marker_review_1',
    owner: { type: 'sequence', id: sequenceId },
    timeUs: playheadUs,
    durationUs: 0,
    label: '这里需要换镜头',
    color: '#ffb020',
  },
});
```

更新和删除使用 `updateMarker()`、`removeMarker()`。临时 hover 和未提交的框选不要做成 Marker，它们属于 UI state。

## 实现顺滑拖拽

一次拖动会产生很多 pointermove，但用户只希望按一次撤销就回到拖动前。用 Interactive Edit 合并历史：

```ts
const drag = session.transaction.beginInteractive({
  label: '拖动片段',
  baseRevision: session.revision!,
});

function onPointerMove(nextStartUs: number): void {
  drag.update(tx => {
    tx.setField('items', item.id, ['range', 'startUs'], nextStartUs);
  });
}

function onPointerUp(): void {
  drag.commit();
}

function onPointerCancel(): void {
  drag.cancel();
}
```

`update()` 每次都会产生新 revision，因此预览和其他 UI 能跟随；最终历史里只保留一条。Escape、pointercancel 或权限变化时调用 `cancel()`，工程会回到 pointerdown 前，而且不会留下 redo 记录。

UI 还应在 pointermove 中处理：像素转微秒、不能小于 0、吸附候选、目标轨命中和联动组选择。SDK 负责合法性，不替产品决定吸附手感。

## 监听提交并刷新界面

```ts
const unsubscribe = session.subscribe('project-changed', event => {
  renderTimeline(event.commit.snapshot);
  invalidateThumbnails(event.commit.changeSet.affectedRanges);
  updateUndoButtons({
    canUndo: session.transaction.canUndo,
    canRedo: session.transaction.canRedo,
  });
});
```

不要在 listener 中同步发起另一个事务。需要连锁动作时排入微任务，或在产品命令层中把多个字段改动放进同一次 `transaction.edit()`。

所有命令参数和返回值见 [Editing Commands](/AelionSDK/reference/editing-commands/)。
