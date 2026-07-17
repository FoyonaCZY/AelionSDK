---
title: 事务、历史与交互编辑
description: 理解原子提交、revision、undo/redo 和高频拖拽的合并语义。
---

Session 加载 Project 后，所有修改通过 Transaction 进入内核。成功提交会产生新 revision、不可变 Project snapshot、ChangeSet 和 inverse operations。

## 高层命令优先

```ts
const result = session.transaction.commands.splitItem({
  itemId: 'item_video_1',
  rightItemId: 'item_video_2',
  atUs: 3_500_000,
});

console.log(result.commit.revision, result.commit.changeSet.affectedRanges);
```

高层命令会同时维护引用、轨道顺序、link group 和相关时间字段。只有实现高级功能时才直接使用 `session.transaction.edit()` 的原子操作。

## 原子事务

```ts
session.transaction.edit(
  tx => {
    tx.setField('tracks', 'track_audio_1', ['audio', 'muted'], true);
    tx.setField('items', 'item_title', ['enabled'], false);
  },
  { label: '静音并隐藏标题', baseRevision: session.revision! },
);
```

同一事务内的操作全部验证通过才发布。失败时 Project 不会停在中间状态。事务禁止重入，并有操作数量上限。

## Revision 和冲突

`baseRevision` 是乐观并发检查。UI 发出基于旧快照的命令时会得到 `REVISION_CONFLICT`，此时应读取最新 snapshot，重新计算意图，而不是盲目重试旧坐标。

```ts
const baseRevision = session.revision!;
// 用户交互期间可能有其他提交
session.transaction.commands.moveItem({
  itemId,
  toTrackId,
  startUs: timelineStartUs,
  baseRevision,
});
```

## Undo / Redo

```ts
if (session.transaction.canUndo) session.transaction.undo();
if (session.transaction.canRedo) session.transaction.redo();
```

每次普通命令是一条历史记录。新编辑会清空 redo 分支。UI 不要维护第二套独立 Project 历史；选择、滚动位置和面板开关等视图状态可以有自己的历史策略。

## 高频交互编辑

拖拽片段或调节参数时，每个 pointermove 都创建 undo 记录会破坏体验。使用 Interactive Edit：

```ts
const drag = session.transaction.beginInteractive({
  label: '移动片段',
  baseRevision: session.revision!,
});

function onPointerMove(timeUs: number) {
  drag.update(tx => {
    tx.setField('items', itemId, ['range', 'startUs'], timeUs);
  });
}

function onPointerUp() {
  drag.commit();
}

function onEscape() {
  drag.cancel();
}
```

`update()` 会产生 Project revision 并触发预览更新，但整个交互最终只保留一条 undo 记录。`commit()` 不额外创建 revision；`cancel()` 恢复交互开始前的 Project，并且不留下 redo 项。

## 订阅变化

```ts
const unsubscribe = session.subscribe('project-changed', event => {
  renderTimeline(event.commit.snapshot);
  invalidateThumbnails(event.commit.changeSet.affectedRanges);
});
```

Change listener 是提交后的观察者。不要在 listener 中同步启动另一个事务；把后续动作排入微任务或业务状态机。

命令的选项和约束见 [Editing Commands](/AelionSDK/reference/editing-commands/)。
