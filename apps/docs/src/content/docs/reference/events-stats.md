---
title: 事件与统计
description: Session 事件、snapshot、Preview/Player/Export 统计与订阅生命周期。
---

## Session events

| type                 | 主要字段             | 何时触发                       |
| -------------------- | -------------------- | ------------------------------ |
| `project-loaded`     | projectId, revision  | Project 成功验证、编译并发布   |
| `project-changed`    | commit               | Transaction/undo/redo 成功发布 |
| `state-changed`      | previousState, state | empty/ready/disposed 变化      |
| `capability-changed` | capability           | Probe 产生新报告               |
| `stats-changed`      | stats                | 关键运行时统计变化             |
| `diagnostic`         | diagnostic           | Session 记录结构化诊断         |

```ts
const offAll = session.subscribe(event => console.log(event.type));
const offProject = session.subscribe('project-changed', event => {
  console.log(event.commit.revision);
});
```

两个 overload 都返回 unsubscribe。Session dispose 会终止自身资源，但 UI 仍应显式调用 unsubscribe，避免闭包保留外部状态。

## Session snapshot

`getSnapshot()` 返回：state、revision、只读 project、renderIr、capability、diagnostics、stats。它是某一调用时刻的整体视图；不要修改其中对象。

`getDiagnostics()` 返回有界历史。超过 `maxDiagnostics` 后旧条目被丢弃，统计中可看到 retained/dropped/limit。

## Compile / Preview

`stats.compile` 是最近编译统计或 null。Preview 统计包含：

- requested/rendered/failed frames；
- last backend、width、height、renderScale；
- pending/maxPendingFrames；
- renderer/worker pending、active、cancelled；
- 最近 disposed renderer 终态。

## Player

Player stats 包含 state、currentTimeUs、generation、rendered/dropped/errors、lastErrorCode、previewQuality 和 resources。

Resources 进一步报告 scheduler、音频模式、AudioContext state、buffered frames、listener 数和最后一次 runtime dispose 终态。

## Export

Session export stats：jobsStarted、jobsCompleted、jobsFailed、jobsCancelled、activeJobId、progress。每个 Job 自身还提供 `getSnapshot()` 和 `subscribe()`。

## 上报建议

高频 stats 先按窗口聚合，例如每 10–30 秒上报 p50/p95、最大 pending 和 drop ratio。不要每帧发送网络请求。

推荐附带：SDK version、capability tier、backend、画布规格、profile 和稳定 diagnostic code。不要上报 Project 内容、素材名、token 或完整 URL。

统计是诊断工具，不是跨设备性能承诺。测试基线见[项目状态](../project/status.md)。
