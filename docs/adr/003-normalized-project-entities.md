# ADR-003：Project 使用 normalized entity maps

- 状态：Accepted
- 日期：2026-07-10
- 负责人：Project Model

## Context

深层嵌套 JSON 难以稳定寻址、增量更新、撤销和引用校验；数组下标在重排后不稳定。

## Decision

Project 顶层使用按 ID 索引的 assets、sequences、tracks、items、materialInstances、transitions、markers 与 linkGroups。父实体通过有序 ID 数组表达宿主关系和顺序。

## Alternatives

- 深层 Sequence/Track/Item 树：拒绝，变更和引用成本高；
- 数组索引身份：拒绝，移动时身份变化；
- 通用 CRDT 文档直接作为内核：Phase 0 不采用，领域不变量需由 Transaction 保证。

## Consequences

加载和 commit 时必须做 key/id、引用、宿主、唯一 owner 与无环校验；canonical map key 排序不改变有序 ID 数组语义。

## Evidence

- schemas/project/v1/project.schema.json；
- packages/project-schema/src/validate.ts；
- 悬空引用、key/id 和 Material 多宿主反例测试。
