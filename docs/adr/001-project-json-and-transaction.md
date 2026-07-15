# ADR-001：JSON 是 Project 协议，不是实时命令流

- 状态：Accepted
- 日期：2026-07-10
- 负责人：AelionSDK Architecture

## Context

Project 需要可保存、跨语言、可审计；实时拖拽又要求原子提交、撤销、revision 和精确脏区间。每帧克隆完整 JSON 会产生序列化、校验与 GC 成本，也无法表达事务边界。

## Decision

- Project Document JSON 负责持久化、交换、模板和复现；
- Transaction API 负责运行时编辑；
- 内部 Render IR 负责执行；
- Project 对象只通过只读 snapshot 暴露，不能直接原地修改。

## Alternatives

- 只使用完整 JSON：拒绝，实时编辑成本和原子语义不足；
- 只使用命令日志：拒绝，跨语言交换和可审计快照不足；
- JSON Patch：不作为 canonical ChangeSet，数组下标与领域不变量不稳定。

## Consequences

需要维护 Schema、Transaction 与 Compiler 三个明确边界；协议变更必须同时更新类型、Schema、fixture 和迁移。

## Evidence

- packages/project-schema 提供 Project validator 与 canonical serialization；
- packages/transaction 已验证原子提交、revision、inverse 和失败零副作用；
- packages/transaction/test/transaction.test.ts。
