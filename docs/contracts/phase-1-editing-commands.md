# Phase 1 高频剪辑命令契约

> 状态：Implemented baseline  
> 范围：`@aelion/transaction`  
> 对应：P1-EDIT-001、P1-EDIT-002、P1-EDIT-003

## 1. API 分层

- `TransactionEngine` 是 Project 的唯一写入入口，负责 revision、原子验证、ChangeSet、inverse 和 affected ranges；
- `EditingCommands` 把领域命令编译成一个 `TransactionEngine.edit()`，不新增第二套 Timeline 或存档协议；
- `TransactionHistory` 包装一个 Engine，将成功的本地语义事务作为一条 undo 记录。

`EditingCommands` 可直接接收 `TransactionEngine`，也可接收 `TransactionHistory`。Project JSON 中只保存最终状态，不保存命令对象或 undo 栈。

## 2. 已实现命令

| 命令 | 最小语义 | 关联清理/保护 |
|---|---|---|
| `insertItem` | 创建完整 Item，并按 ID anchor 写入 Track `itemIds` | 校验 Track 存在、未锁、kind 匹配、ID/anchor 唯一 |
| `removeItem` | 从 Track 移除并删除 Item | 删除关联 Transition 及其专属 Material、Item Marker；退化 LinkGroup 一并解除 |
| `moveItem` | 修改 Sequence 起点，可在兼容 kind 的 Track 间移动，也可调整同轨合成顺序 | 锁定 Track 拒绝；参与 Transition 的 Item 不允许跨 Track；linked Item 默认拒绝 |
| `trimItem` | 在 Sequence 时间内缩短 start/end；线性媒体同步更新 sourceRange | linked/动画 Item 默认拒绝；不能裁穿 Transition；不允许空区间 |
| `splitItem` | 左 Item 保留 ID，右 Item 使用调用方提供的新 ID；精确切分线性 sourceRange | outgoing Transition 切换至右 Item；linked、带 Material/Marker/动画的 Item 需等待显式策略 |
| `replaceItem` | 原子替换一个完整 Item 内容 | 必须保留 id、trackId、Material/Marker/LinkGroup ownership；移动必须使用 `moveItem` |
| `reorderTrack` | 通过 Sequence `trackIds` 调整轨道顺序 | 使用稳定 ID anchor，不暴露数组下标 |
| `setTrackLocked` | 设置编辑锁 | lock 不改变渲染结果 |
| `setTrackEnabled` | 设置 Track 渲染开关 | 正常进入 ChangeSet/affected ranges |
| `setTrackMuted` | 设置 audio Track 的 `audio.muted` | 非 audio Track 拒绝 |
| `setTrackSolo` | 设置 audio Track 的 `audio.solo` | 非 audio Track 拒绝；旧 Project 缺省为 `false` |

所有时间均为非负 safe integer 微秒，区间保持半开语义。命令接受可选 `baseRevision`；陈旧 revision 仍由 `TransactionEngine` 以 `REVISION_CONFLICT` 拒绝。

`setTrackEnabled` 是 visual visibility/audio participation 开关；`setTrackMuted` 与 `setTrackSolo` 只控制 audio mixer。同一 Sequence 只要存在 enabled 的 solo audio Track，Render IR 音频求值便只混入 enabled、solo 且未 muted 的 audio Track。mute 仍是独立硬开关：若所有 solo Track 同时 muted，结果为静音，而不是恢复非 solo Track。

## 3. Source mapping

当前 trim/split 只自动变换 `timeMapping.type = linear` 的媒体 Item：

```text
source delta = floor(item-local delta × rate.numerator / rate.denominator)
```

- 正向 start trim 推进 sourceRange.start；end trim 保持 sourceRange.start；
- 反向 start trim 保持 sourceRange.start；end trim 推进 sourceRange.start；
- split 将原 sourceRange 分成两个相邻区间，反向时交换高、低源区间归属；
- 非媒体 Item 不修改 source 字段；curve mapping 必须由后续显式关键点策略处理。

## 4. Undo/Redo

`TransactionHistory` 保存每个成功事务的原 operations 与 Engine 生成的 inverse：

- `undo()` 把 inverse 作为一个新的、经过验证的 revision 提交；
- `redo()` 把原 operations 作为一个新的 revision 提交；
- 新编辑清空 redo 分支；
- `maxEntries` 限制历史条数，默认 100；
- 直接绕过 History 修改其 Engine 后，History 报 `HISTORY_REVISION_DIVERGED`，不会跨未知 revision 应用旧 inverse；
- 协作场景应生成基于当前 revision 的补偿事务，而不是复用本地 undo 栈。

## 5. Affected ranges

ChangeSet 同时收集编辑前与编辑后的 owner range，因此 move/trim/split 会覆盖旧画面和新画面。对 Track `itemIds` 的单项 insert/remove/move，脏区间只取该 value Item 的 range，不再因为触碰 Track 列表而无条件失效整轨；其他 Track 属性仍失效 Track 覆盖的全部区间。

## 6. 当前保守边界

以下行为没有静默猜测，命令会用稳定 diagnostic 拒绝：

- linked Item 的 move/trim/split；
- 带 item-local animation 的 trim/split；
- 带 Material/Marker ownership 的 split；
- split 点位于 Transition 内；
- curve time mapping 的 trim/split；
- move 到不兼容 kind 的 Track；
- replace 改变 ownership 或拓扑。

Ripple/roll/slip/slide、group/link/unlink 和 linked group split 尚无语义命令，属于后续 Alpha 路线，而不是本契约的隐式能力。

这些边界对应下一批 linked editing、keyframe split/trim policy 与 Material `splitPolicy`，不会污染 Project v1 数据结构。

## 7. 验证证据

- `packages/transaction/test/commands.test.ts` 覆盖 insert/remove/move/trim/split/replace、track commands、undo/redo、history branch/bound、失败零副作用和 affected ranges；
- `packages/transaction/test/transaction.test.ts` 继续覆盖原子失败、revision、inverse canonical hash；
- `packages/transaction/test/vertical-slice.test.ts` 继续覆盖 ChangeSet 到增量 Render IR。
