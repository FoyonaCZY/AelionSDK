# AelionSDK Goal：完成 Audio Track Solo 闭环

> 状态：Complete
> 启动日期：2026-07-15
> 完成日期：2026-07-15
> 来源：[Phase 1 Backlog P1-EDIT-003](phase-1-backlog.md)
> 执行流程：[AelionSDK 开发流程](AelionSDK-Development-Workflow.md)

## Goal

> 在不改变既有 Project v1 文档含义的前提下，为 audio Track 增加显式、可验证、可撤销的 solo 状态，使 Transaction、Preview Player 与离线 Export 通过共享 Render IR 获得同一音频参与语义。

## 范围与语义

- `Track.audio.solo` 是可选 boolean；旧 Project 未提供时等价于 `false`；
- `EditingCommands.setTrackSolo()` 是唯一认证的领域命令，非 audio Track 稳定拒绝；
- 同一 Sequence 存在 enabled solo audio Track 时，只混入 enabled、solo 且未 muted 的 audio Track；
- `muted` 独立生效；所有 solo Track 均 muted 时输出静音；
- visual/caption Track solo、solo group、exclusive solo 与 UI 交互不在本 Goal 范围。

## Required Outcomes

- [x] Project Schema、TypeScript 类型和 SDK 内置 Schema 同步；
- [x] solo 命令保持 revision、inverse、undo/redo 与 affected range 契约；
- [x] Render IR evaluator 对缺省、solo、disabled solo 与 mute 组合给出确定结果；
- [x] 单元、Schema、类型、lint、format 与公开 API 门禁通过；
- [x] README、Changelog、编辑命令和 diagnostic 文档不再把 audio Track solo 标为未实现。

## 验证命令

```bash
corepack pnpm schemas:update
corepack pnpm exec vitest run packages/project-schema packages/transaction packages/render-ir
corepack pnpm run ci
```

## 完成证据

- Track solo 专项：Project Schema、Transaction、Render IR 共 62/62；Audio mixer 12/12；
- 全量 Node/Vitest：19 files、213/213；evidence scripts 21/21；Project Schema 29/29；
- Vite plugin production build 与 development server 测试通过；
- Chromium 10 files、59/59；Firefox 8 files、54/54；
- format、Schema drift、lint、typecheck、build 与 `@aelion/sdk` API snapshot 全部通过。
