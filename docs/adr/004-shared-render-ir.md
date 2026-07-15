# ADR-004：Preview 与 Export 共用 Render IR

- 状态：Accepted
- 日期：2026-07-10
- 负责人：Graphics/Export

## Context

若实时预览和离线导出维护不同的效果、时间或混合实现，成片会与用户看到的画面分叉，Material 作者也需要维护两套语义。

## Decision

Project 编译为版本化内部 Render IR。Preview 与 Export 共用时间求值、Material compiler、颜色/Alpha 约定和核心渲染节点；两者只在调度、质量策略与输出目标上不同。

## Alternatives

- Preview 使用 DOM/Canvas，Export 使用独立服务：拒绝作为本地主路径；
- 两套专用效果：拒绝；
- Project JSON 直接作为 GPU 图：拒绝，会锁死优化与后端。

## Consequences

需要 Preview/Export Golden 门禁；Render IR 可内部迭代，但节点语义必须有版本。

## Evidence needed for Accepted

- 同一 30 秒 Project 驱动 Preview 和逐帧 Export；
- Filter/Transition 关键抽帧在定义容差内一致；
- Transaction 的 affectedRanges 能驱动增量重编译。

## Evidence

- `packages/render-ir` 已实现版本化 Project → Render IR 与 ChangeSet entity/range 驱动的增量重用；
- `packages/renderer-worker/test/ir-renderer.browser.test.ts` 证明 Preview/Export 通过同一 IR 帧求值与 Material Worker renderer 得到逐像素一致结果；
- 1,000 clip 最终 benchmark 中 no-op 增量编译均值 1.446 ms，冷编译均值 101.24 ms；
- 30 秒真实媒体垂直 fixture 仍属于 Goal 级退出证据，但不再阻塞此架构方向的接受。
