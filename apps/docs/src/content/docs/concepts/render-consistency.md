---
title: 预览与导出一致性
description: 理解 Project、Render IR、Preview、Player 和 Export 之间的共享语义。
---

AelionSDK 不让预览和导出各自解释 Project。它们共享经过验证和编译的 Render IR，这是“所见接近所得”的基础。

## 编译链路

```text
Project JSON
  → admission / schema / semantic validation
  → frozen Project revision
  → deterministic Render IR
  → Preview / Player / Local Export / Remote manifest
```

Render IR 把编辑友好的实体图转换为按时间可求值的渲染计划，包含画布、轨道、片段、时间映射、音频、Material 和资源依赖。

## 共享什么

Preview、Player 和 Export 共享：

- 片段可见性、层级和时间范围；
- source 时间映射与边界策略；
- 变换、透明度、混合与 Material Graph；
- 音量、pan、mute/solo 和音频时间映射；
- 色彩工作空间和背景；
- 同一 Project revision 的实体引用。

因此，修复语义问题应发生在 Project validation、IR compiler 或公共 renderer，而不是在 UI 和 exporter 分别打补丁。

## 有意存在的差异

实时预览可以为了交互流畅度降低成本：

- `draft` 或 `renderScale < 1`；
- 使用 proxy representation；
- latest-wins 取消过期 scrub；
- 播放中允许丢弃迟到帧。

导出使用 original representation、冻结 revision、确定输出分辨率，并等待每帧完成。它不会继承预览的动态降级策略。

## 冻结 Revision

```ts
const job = session.export.startProfile(options);
// 此后继续编辑不会改变正在运行的 job
```

导出启动时冻结当前 Project/IR。UI 应显示“导出的是 revision N”，避免用户误以为后续修改会进入正在执行的任务。

## 如何验证一致性

生产项目至少建立三层回归：

1. IR golden：相同 Project 产生稳定 IR；
2. 帧 golden：关键时间点的像素结果在容差内稳定；
3. 成片检查：导出容器时长、codec、关键帧、音频和 A/V sync 正确。

对降分辨率预览不做逐像素等同要求，而是比较构图、时间和效果语义。需要精确审片时切换 `quality: 'full'`、`renderScale: 1`。

完整执行模型见[架构与执行模型](/AelionSDK/concepts/architecture/)，导出行为见[导出概览](/AelionSDK/export/overview/)。
