---
title: 运行参考编辑器
description: 启动仓库中的完整示例，并知道应该从哪些源码位置学习接入方式。
---

仓库提供两个可以直接运行的应用：

| 应用               | 适合什么时候看                                                 |
| ------------------ | -------------------------------------------------------------- |
| `apps/quickstart`  | 第一次接入。代码少，主线集中在一个文件中                       |
| `apps/editor-demo` | 已经跑通 SDK，想看时间线、选择、分割、撤销和多格式导出如何组合 |

如果你还没有成功显示过第一帧，先运行 Quickstart。参考编辑器功能更多，不适合拿来排查最初的工程配置。

## 启动参考编辑器

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm dev:editor
```

默认地址是 `http://127.0.0.1:4174`。选择本地音视频文件后，按下面的顺序操作：

1. 确认监看窗口出现第一帧；
2. 拖动播放头，再点击播放；
3. 在时间线上选择一个片段；
4. 点击左右移动或分割；
5. 撤销并重做；
6. 分别尝试 WebM 和 H.264 MP4 导出。

## 源码从哪里看

参考编辑器没有隐藏 API，核心都在公开包中。建议按调用顺序阅读：

| 文件                                                                                                                  | 可以学到什么                                                 |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`apps/editor-demo/vite.config.ts`](https://github.com/FoyonaCZY/AelionSDK/blob/main/apps/editor-demo/vite.config.ts) | Vite 插件、Worker/Worklet 和跨源隔离响应头                   |
| [`apps/editor-demo/src/main.ts`](https://github.com/FoyonaCZY/AelionSDK/blob/main/apps/editor-demo/src/main.ts)       | Provider、Project、Session、Preview 和 Export 的完整生命周期 |
| [`apps/editor-demo/src/style.css`](https://github.com/FoyonaCZY/AelionSDK/blob/main/apps/editor-demo/src/style.css)   | Demo 的布局；这部分不是 SDK 接口                             |

`main.ts` 中值得重点找的函数：

- `importFile()`：注册 File、探测、创建 Project、加载 Session；
- `refreshPreview()`：提交编辑后刷新时间线和画面；
- `moveSelection()`：普通片段和音视频联动组的移动方式；
- `splitSelection()`：普通切分和联动切分；
- `exportProject()`：创建 Sink、显示进度和下载文件；
- `releaseProject()`：切换素材时的释放顺序。

## 如何把 Demo 迁到自己的应用

不必复制整个文件。先保留下面这条生命周期：

```text
打开工程
  1. 创建 Media Provider
  2. 注册素材
  3. 创建 Session 并 loadProject
  4. 连接 Preview Controller
  5. 订阅 project-changed / diagnostic

关闭工程
  1. dispose Preview Controller
  2. await Session.dispose()
  3. dispose Media Provider
```

然后把 DOM 操作替换成你的组件和状态管理。时间线的 zoom、scroll、hover、框选和面板开关留在 UI state；轨道、片段、Marker 和效果写入 Project。

## 参考编辑器没有替你解决什么

它是 SDK 集成样例，不是可以直接上线的剪辑产品。正式产品还要补上：

- 项目保存、素材重新授权和缺失素材重连；
- 快捷键冲突、无障碍和移动端交互；
- 自动保存、崩溃恢复和协作；
- 任务队列、长片 OPFS 导出和远程导出；
- 设备分级、埋点、错误文案和灰度策略。

构建生产包：

```bash
corepack pnpm run build:editor
```

产物位于 `apps/editor-demo/dist`。接下来阅读[剪辑 UI 集成](/AelionSDK/guides/editor-ui/)，把 Demo 中的单文件状态拆成自己的产品架构。
