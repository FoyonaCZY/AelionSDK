---
title: 选择包与接入层级
description: 了解何时只使用 @aelion/sdk，何时直接组合底层公开包。
---

AelionSDK 是 monorepo，但不是要求业务同时理解 13 个包。绝大多数剪辑产品应从 `@aelion/sdk` 开始。

## 推荐入口

| 需求                                       | 包                     | 说明                      |
| ------------------------------------------ | ---------------------- | ------------------------- |
| 创建 Session、Project、媒体 Provider、预览 | `@aelion/sdk`          | 应用层首选入口            |
| 创建内存或 OPFS 导出 Sink                  | `@aelion/export`       | 与 SDK 的 export API 配合 |
| Vite 中打包 Worker/Worklet                 | `@aelion/vite-plugin`  | 应用构建依赖              |
| 创作 Material 包                           | `@aelion/material-sdk` | Material 作者入口         |

## 引擎层包

只有在扩展引擎、制作自定义宿主或研究底层协议时，才直接使用这些包：

| 包                          | 职责                                          |
| --------------------------- | --------------------------------------------- |
| `@aelion/core`              | 错误、诊断、JSON、时间和基础数学              |
| `@aelion/project-schema`    | Project v1 类型、Schema 校验、canonical clone |
| `@aelion/transaction`       | 编辑命令、事务、revision、undo/redo           |
| `@aelion/render-ir`         | Project 编译到确定性 Render IR                |
| `@aelion/media`             | RangeReader、容器索引、解码、缓存与资源治理   |
| `@aelion/audio`             | PCM 调度、ring/queue transport、AudioWorklet  |
| `@aelion/renderer-worker`   | GPU 合成 Worker 与帧结果                      |
| `@aelion/capability`        | 运行时能力探测和支持等级                      |
| `@aelion/material-compiler` | Material Graph 校验、编译与 GPU 程序          |

## 三种接入层级

### 产品接入

只依赖 SDK、Export 和构建插件。你负责 UI、业务数据、权限和服务端；SDK 负责 Project、编辑语义、预览、播放和导出。

```ts
import { Aelion, ProductionMediaProvider, createProject } from '@aelion/sdk';
import { OpfsSeekableSink } from '@aelion/export';
```

### 扩展接入

需要自定义 Material、Remote Export Provider 或媒体缓存时，在产品接入基础上增加对应包，但继续通过 Session 组织生命周期。

### 引擎接入

直接组装 validator、transaction、compiler、renderer 或 media decoder。这个层级获得更高控制力，也承担版本兼容、资源所有权和协议一致性责任。

## 版本原则

- 同一个应用中的所有 `@aelion/*` 包保持完全相同版本。
- 不对深层文件路径建立依赖。
- 升级前运行 Project fixture、导出 preflight 和关键浏览器回归。
- alpha 阶段把 API Snapshot 变化视为需要人工审阅的变更。

完整导出清单见[包与入口](../reference/packages.md)，精确签名见站点中的 API Reference。
