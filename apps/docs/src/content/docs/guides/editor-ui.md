---
title: 剪辑 UI 集成
description: 把 AelionSDK 放入专业剪辑产品的状态、手势、预览和任务架构。
---

SDK 提供编辑内核，不提供固定 UI。一个体验良好的上层应用通常把状态分成四类，避免 Project、视图和运行时互相污染。

## 状态分层

| 层      | 示例                              | 保存方式       |
| ------- | --------------------------------- | -------------- |
| Project | 轨道、片段、效果、Marker          | Project JSON   |
| Engine  | revision、IR、capability、job     | Session API    |
| Runtime | File、URL、decoder、cache         | Media Provider |
| View    | 缩放、滚动、hover、临时选择、面板 | UI store       |

播放头是否持久化取决于产品；它通常是 View 状态。审核锚点应使用 Marker，片段选择如果需要协作再写入 selection metadata。

## 单向数据流

```text
Pointer / Keyboard
  → UI 计算意图、吸附和约束
  → Transaction Command
  → project-changed(commit)
  → Timeline / Inspector / Preview 更新
```

Project snapshot 是唯一工程事实。不要先永久修改 UI 中的一份镜像，再异步尝试“同步给 SDK”。可以做乐观视觉反馈，但提交失败时必须以最新 snapshot 回滚。

## Timeline 映射

Timeline viewport 只维护：

- `pixelsPerSecond` 或等价 zoom；
- horizontal scroll；
- track layout；
- hit-test 索引；
- snap candidates。

像素最终转换为非负微秒整数，再调用命令。高帧率工程使用 `frames()` 对齐帧边界。

## 选择和 Inspector

Inspector 读取当前 Project snapshot。连续参数拖动使用 Interactive Edit；文本输入可以在 blur/Enter 时提交普通事务。

```ts
const interaction = session.transaction.beginInteractive({ label: '调整透明度' });

function updateOpacity(value: number) {
  interaction.update(tx => {
    tx.setField('items', itemId, ['opacity'], value);
  });
}
```

字段路径必须符合当前 Item Schema。面向业务用户的 Inspector 应通过 Material parameter schema 生成控件和范围，而不是允许任意 JSON。

## 预览和缩略图

- 主监看窗口使用一个 PreviewCanvasController；
- 缩略图使用低 scale 的直接 `renderFrame`，并限制并发；
- 快速 scrub 合并到 animation frame；
- 页面隐藏时暂停；
- 所有 Bitmap 在绘制后关闭。

不要让主预览、缩略图列表和导出无限竞争 decoder/GPU。高优先级交互请求先执行，后台缩略图可取消和重算。

## 命令、快捷键和历史

建立产品命令层，例如 `editor.moveSelection()`、`editor.splitAtPlayhead()`，内部调用 SDK 命令。菜单、快捷键和触控按钮复用同一产品命令，统一处理权限、locked track、选择和错误提示。

Undo/Redo 绑定 SDK history；视图操作如 zoom 不应进入工程历史。

## 异步任务

媒体探测、缩略图、波形、导出和上传都应有任务状态：queued/running/completed/failed/cancelled。使用 AbortSignal 取消已离开页面或被替换的任务。导出 Job 单独显示 frozen revision。

## 推荐的编辑器生命周期

1. 恢复 Project 元数据；
2. 获取素材授权并注册 Provider；
3. 创建 Session，执行 capability probe；
4. loadProject，连接预览；
5. 订阅 project-changed、diagnostic、stats；
6. 保存 canonical Project snapshot；
7. 离开时取消任务，释放 preview/session/provider。

仓库中的[参考编辑器](/AelionSDK/start/reference-editor/)展示了这个最小架构。复杂产品还需要自行实现快捷键冲突、可访问性、自动保存、协作、账户和素材服务。
