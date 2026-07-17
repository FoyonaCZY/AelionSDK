---
title: Session 事件、Snapshot 和统计
description: 查询事件触发时机、读取一致快照，并监控 Preview、Player、Export 和资源终态。
---

Session 提供两种订阅：监听全部事件，或按 `type` 获得有类型的事件。两种形式都返回取消函数。

```ts
const offAll = session.subscribe(event => {
  console.log(event.type);
});

const offProject = session.subscribe('project-changed', event => {
  console.log(event.commit.revision);
});

offAll();
offProject();
```

## 事件表

| type                 | 主要字段                 | 什么时候触发                           |
| -------------------- | ------------------------ | -------------------------------------- |
| `project-loaded`     | `projectId`, `revision`  | Project 完成校验、编译并发布           |
| `project-changed`    | `commit`                 | 命令、transaction、undo 或 redo 成功   |
| `state-changed`      | `previousState`, `state` | Session 在 empty/ready/disposed 间变化 |
| `capability-changed` | `capability`             | 新的 capability probe 完成             |
| `stats-changed`      | `stats`                  | 关键运行统计变化                       |
| `diagnostic`         | `diagnostic`             | Session 记录新的结构化诊断             |

UI 常用的是 `project-changed`、`diagnostic` 和少量节流后的 `stats-changed`。

## Commit 里已经有对应 Project

```ts
session.subscribe('project-changed', event => {
  const { revision, snapshot, changeSet } = event.commit;

  timeline.setProject(snapshot);
  autosave.schedule(snapshot, revision);
  thumbnailCache.invalidate(changeSet.affectedRanges);
});
```

不要在回调里读取一份可能被后续异步操作替换的 UI Project；Commit snapshot 与本次 revision 是一致的。

## `getSnapshot()`

一次返回：

- `state`；
- `revision`；
- 只读 `project`；
- 当前 `renderIr`；
- capability report；
- diagnostic 历史；
- stats。

```ts
const snapshot = session.getSnapshot();
if (snapshot.state === 'ready' && snapshot.project !== null) {
  renderInspector(snapshot.project);
}
```

Snapshot 不能修改，也不要把里面的 Item 引用永久缓存。Project 变化后重新读取。

`getDiagnostics()` 返回有上限的历史。超过 `maxDiagnostics` 后会丢掉最旧条目，`stats.diagnostics` 中可以看到 retained、dropped 和 limit。

## Preview 统计

`stats.preview` 包含：

- requested/rendered/failed 帧；
- 最近 backend、width、height、renderScale；
- pending 和 maxPendingFrames；
- renderer/worker pending、active、cancelled；
- 最近一次已销毁 renderer 的终态。

快速拖动时 cancelled 增长正常；停止交互后 pending 不回落才值得告警。

## Player 统计

`stats.player` 包含 state、currentTimeUs、generation、rendered/dropped/errors、lastErrorCode 和 previewQuality。

`resources` 进一步包含 scheduler、音频模式、AudioContext state、buffered frames、listener 数和上一次 runtime dispose 结果。

## Export 统计

`stats.export` 包含 jobsStarted、jobsCompleted、jobsFailed、jobsCancelled、activeJobId 和 progress。每个 Job 还有独立的 `getSnapshot()` 和 `subscribe()`，任务 UI 应优先使用 Job 自己的状态。

## 遥测建议

高频 stats 在本地每 10–30 秒聚合 p50/p95、最大 pending 和 drop ratio。附带 SDK version、浏览器大版本、OS、capability tier、backend、Project 规格、profile 和 diagnostic code。

不要上报 Project JSON、素材名、token、完整 URL 和任意 `cause`。统计用于定位当前环境，不是跨设备性能承诺。
