---
title: 运行参考编辑器
description: 用仓库内的参考编辑器验证导入、预览、剪辑、撤销与导出。
---

参考编辑器位于 `apps/editor-demo`。它只使用公开包入口，是 SDK 产品接入的可运行基线，不是另一套隐藏内核。

## 启动

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm dev:editor
```

浏览器打开终端提示的本地地址。选择一个本地音视频文件后，可以验证：

- File → Range Provider → 媒体探测；
- Project Builder 自动创建音视频轨和联动片段；
- Canvas 实时预览、scrub 和自适应质量；
- 片段选择、联动移动、分割、undo/redo；
- WebM VP9/Opus 与 MP4 H.264/AAC 本地导出。

## 用它做接入基线

建议先在目标浏览器和目标素材上完成以下检查：

1. 导入至少一个真实相机文件，而不只使用短测试素材。
2. 快速拖动播放头，确认旧帧不会覆盖新帧。
3. 播放含音频素材，观察启动、暂停和 seek 后是否同步。
4. 执行移动、分割、撤销和重做，确认 UI 与 Project revision 一致。
5. 分别执行 WebM、H.264 MP4 导出并播放成片。
6. 查看控制台和 capability/preflight 诊断，不忽略 fallback。

## 生产构建

```bash
corepack pnpm run build:editor
```

构建产物位于 `apps/editor-demo/dist`。参考应用的 Vite 配置展示了运行时资源和跨源隔离响应头；部署到你的平台时需要在 CDN 或 Web Server 上复现这些响应头。

## 应该复用什么

可以复用：Session 生命周期、Provider 注册方式、预览 Controller、交互命令映射、导出 Job 和清理顺序。

不应照搬：视觉样式、产品状态管理、权限模型、素材服务、快捷键体系和协作逻辑。这些属于上层产品，而不是 SDK 契约。

读完后继续看[剪辑 UI 集成](/AelionSDK/guides/editor-ui/)，了解如何把这些能力放入专业编辑器架构。
