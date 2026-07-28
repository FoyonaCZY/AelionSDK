---
title: Transaction、revision 和撤销
description: 理解编辑命令如何原子修改 Project，以及如何合并拖拽历史和处理版本冲突。
---

加载 Project 后，所有修改都通过 `session.transaction` 完成。成功提交会同时得到新 Project、递增 revision、撤销信息和受影响范围；任何一步失败，原工程保持不变。

## 普通编辑优先用命令

```ts
const result = session.transaction.commands.splitItem({
  itemId: 'item_video_1',
  rightItemId: 'item_video_2',
  atUs: 3_500_000,
  label: '切分片段',
});

console.log(result.commit.revision);
console.log(result.commit.changeSet.affectedRanges);
```

高层命令会一起维护轨道列表、Item 引用、source range 和 Link Group。移动、裁剪、切分、ripple、roll、slip、slide 等操作都有对应命令，业务代码不需要自己拼底层 operations。

## 一次改多个字段

确实需要把多项改动绑定成一步时，使用 `transaction.edit()`：

```ts
session.transaction.edit(
  tx => {
    tx.setField('tracks', 'track_audio_1', ['audio', 'muted'], true);
    tx.setField('items', 'item_title', ['enabled'], false);
  },
  {
    label: '静音并隐藏标题',
    baseRevision: session.revision!,
  },
);
```

两个字段要么都成功，要么都不发布。如果第二个路径无效，第一个也不会留下。

`transaction.edit()` 适合 Inspector 的组合修改和引擎扩展，不建议用它重新实现 `splitItem()` 等已有命令，因为很容易漏掉引用、历史或 affected ranges。

## revision 是什么

`session.revision` 是当前 Session 中的 bigint 版本。每次成功提交、撤销和重做都会产生新 revision。

用户开始拖动时记录版本：

```ts
const baseRevision = session.revision!;
```

提交时带回：

```ts
session.transaction.commands.moveItem({
  itemId,
  startUs: nextStartUs,
  baseRevision,
});
```

如果期间协作消息、自动操作或另一个 UI 命令已经修改工程，SDK 会返回 `REVISION_CONFLICT`。正确做法是读取最新 snapshot，重新计算用户意图；只把 `baseRevision` 改成最新值并重发旧坐标，可能覆盖别人的变化。

Revision 只在当前 Session 中单调增长。它不是跨设备数据库版本号，也不属于 Project JSON；协作系统可以建立自己的 server version 和操作协议。

## Undo 和 Redo

```ts
undoButton.disabled = !session.transaction.canUndo;
redoButton.disabled = !session.transaction.canRedo;

if (session.transaction.canUndo) session.transaction.undo();
if (session.transaction.canRedo) session.transaction.redo();
```

普通命令默认形成一条历史记录。Undo 后发起新编辑会清空 redo 分支。Timeline zoom、scroll、hover 等视图操作不经过 Transaction，因此不会污染工程撤销历史。

Undo/redo 也会触发 `project-changed`。时间线、Inspector、预览和自动保存不需要写另一套刷新分支。

## 拖拽只留一条撤销记录

一次拖动可能有几十次位置更新。用 Interactive Edit：

```ts
const drag = session.transaction.beginInteractive({
  label: '移动片段',
  baseRevision: session.revision!,
});

function onPointerMove(timeUs: number): void {
  drag.update(tx => {
    tx.setField('items', itemId, ['range', 'startUs'], timeUs);
  });
}

function onPointerUp(): void {
  drag.commit();
}

function onEscape(): void {
  drag.cancel();
}
```

每次 `update()` 都会发布新 revision，预览可以实时跟随；`commit()` 只封口，不再产生额外 revision。最后按一次 Undo 会回到整个拖动开始前。

`cancel()` 会恢复最初 Project，而且不会留下 redo 记录。组件卸载、pointercancel、权限变化或 Esc 都应进入取消逻辑。

## 订阅变化

```ts
const unsubscribe = session.subscribe('project-changed', event => {
  const { snapshot, changeSet, revision } = event.commit;

  timeline.render(snapshot);
  thumbnailCache.invalidate(changeSet.affectedRanges);
  autosave.schedule(snapshot, revision);
});
```

Commit 提供的是本次提交对应的 snapshot，不需要回调里再猜版本。`affectedRanges` 可以只刷新被编辑时间段的缩略图和缓存。

Listener 是提交完成后的观察者。不要在同一个同步回调里立刻开始另一次 Transaction；需要后续动作时，用微任务或产品状态机安排。

## 提交失败后 UI 怎么处理

常见失败包括：

- revision 已过期；
- Item 或 Track 已被删除；
- 目标轨 locked；
- 时间或 source handle 不合法；
- Link Group / Transition 引用冲突；
- 字段路径不符合 Schema。

失败时 Project 和 history 都不变。取消 UI 的乐观状态，读取最新 snapshot，把 Diagnostic code 映射成明确提示。完整命令参考见 [Editing Commands](/AelionSDK/reference/editing-commands/)。
