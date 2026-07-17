---
title: 为什么预览和导出应当一致
description: 理解 Render IR、代理素材、预览降质和导出冻结 revision 之间的关系。
---

预览和导出都从同一份 Project 编译结果执行。它们不会各自解释一遍片段时间、效果和音频，因此调整一次工程后，不需要再为导出维护另一套配置。

## Project 加载后发生什么

```text
Project JSON
  ↓ 输入、Schema 和引用校验
只读 Project snapshot + revision
  ↓ 编译
Render IR
  ├─ 单帧预览
  ├─ 实时播放
  ├─ 本地导出
  └─ 远程导出 manifest
```

Render IR 是内部执行图。它已经解析轨道顺序、片段可见范围、素材时间、效果参数、音频混音和资源依赖。上层应用不需要保存或编辑它，Project 改变后 Session 会更新编译结果。

## 哪些规则是共享的

预览、播放和导出使用相同的：

- Item 入点、出点和层级；
- source range、变速、反向和边界行为；
- 变换、透明度、混合、遮罩和 Material；
- gain、pan、mute/solo、fade 和音频时间映射；
- Sequence 背景、画布和工作色彩空间；
- 当前 Project revision 中的所有实体引用。

如果某个效果在预览和导出里意义不同，应修正 Project/Render IR/公共 renderer，而不是在 UI 和 exporter 里各写一份补丁。

## 预览为什么可以更模糊或偶尔跳帧

为了跟上交互，预览允许降低执行成本：

- 使用 `renderScale < 1`；
- 读取 proxy，而不是 4K original；
- 新 scrub 到来时取消旧请求；
- 播放中丢弃已经迟到的视频帧。

这些差异只影响实时成本，不应改变构图、片段时间和效果含义。导出会使用 original、完整画布和完整帧序列，不继承 Preview Controller 的自适应 scale。

停帧检查时可以临时切到完整质量：

```ts
preview.setQuality('full', 1);
await preview.render(playheadUs);
```

## 导出固定的是启动时版本

```ts
const revisionAtStart = session.revision;
const job = session.export.startProfile(options);
```

任务启动时会冻结当前 Render IR。此后继续移动片段，正在运行的 Job 仍然输出 `revisionAtStart` 的内容。

导出 UI 应明确提示“本次导出不包含开始后产生的修改”，并在任务记录中保存 revision。不要自动取消并重启，除非产品明确提供“始终导出最新版本”模式。

## 远程导出如何保持一致

Remote Export 会发送 canonical、冻结的 Project manifest 和稳定 content ID。服务端必须使用兼容的 Project、Render IR 和 Material 版本重新校验执行，不能把客户端画面截图或 UI 状态当作渲染输入。

如果服务端引擎版本不同，任务记录应包含双方版本，并在不兼容时明确失败。

## 产品应该怎么验证

至少保留三类回归素材：

1. **Project/IR fixture**：同一输入产生稳定结构和时长；
2. **关键帧截图**：开头、转场中点、效果边界等时间点在容差内一致；
3. **导出回读**：检查容器时长、codec、画面尺寸、音频和 A/V sync。

低分辨率预览不要求和导出逐像素相同，但物体位置、片段边界、效果进度和声音时间应一致。需要像素对比时，使用 full/1.0 预览和固定字体、素材、backend。

Render IR 的完整线程与资源模型见[架构与执行模型](/AelionSDK/concepts/architecture/)。
