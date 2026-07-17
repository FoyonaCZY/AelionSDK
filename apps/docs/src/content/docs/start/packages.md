---
title: 我需要安装哪些包
description: 根据产品接入、Material 开发和引擎扩展选择 AelionSDK 包。
---

虽然仓库里有 13 个公开包，但做剪辑产品时通常只需要直接依赖三个。不要一开始就把所有底层包加进应用。

## 普通剪辑产品

```json
{
  "dependencies": {
    "@aelion/sdk": "workspace:*",
    "@aelion/export": "workspace:*"
  },
  "devDependencies": {
    "@aelion/vite-plugin": "workspace:*"
  }
}
```

它们分别解决：

| 包                    | 什么时候会直接用到                                                   |
| --------------------- | -------------------------------------------------------------------- |
| `@aelion/sdk`         | 创建 Project 和 Session，注册素材，连接 Canvas，播放，编辑和启动导出 |
| `@aelion/export`      | 创建内存或 OPFS Sink；定义远程导出适配器                             |
| `@aelion/vite-plugin` | 让 Vite 正确打包 Renderer Worker 和 AudioWorklet                     |

业务组件里大部分导入都应该来自 `@aelion/sdk`：

```ts
import { Aelion, ProductionMediaProvider, attachPreviewCanvas, createProject } from '@aelion/sdk';
```

只有创建导出落盘目标时，才会直接使用 `@aelion/export`：

```ts
import { OpfsSeekableSink, SeekableMemorySink } from '@aelion/export';
```

## 开发 Material

如果你要制作 Filter、Transition、Effect 或 Generator，再增加：

```json
{
  "dependencies": {
    "@aelion/material-sdk": "workspace:*"
  }
}
```

这个包用于定义参数、搭建声明式 Graph、校验和生成 Material package。应用在运行时仍然通过 `@aelion/sdk` 加载和使用 Material。

## 什么时候才需要底层包

以下场景可能需要直接使用引擎层：

- 你正在开发另一种宿主，而不是常规 Web 编辑器；
- 你需要自定义媒体容器、缓存或 RangeReader；
- 你要直接研究 Project 校验、事务或 Render IR；
- 你在为 AelionSDK 本身贡献代码。

| 包                          | 提供的底层接口                                   |
| --------------------------- | ------------------------------------------------ |
| `@aelion/core`              | 时间换算、Diagnostic、JSON 类型和通用错误        |
| `@aelion/project-schema`    | Project v1 类型、Schema 校验和 canonical JSON    |
| `@aelion/transaction`       | 编辑命令、事务、revision、undo/redo              |
| `@aelion/render-ir`         | 把 Project 编译成渲染执行图                      |
| `@aelion/media`             | RangeReader、MP4/WebM 索引、解码、缓存和代理选择 |
| `@aelion/audio`             | PCM 混音、AudioWorklet 时钟和音频传输            |
| `@aelion/renderer-worker`   | WebGL2/WebGPU 合成和 Worker 协议                 |
| `@aelion/capability`        | GPU、codec、音频和存储能力探测                   |
| `@aelion/material-compiler` | Material Graph 校验和 GPU 程序编译               |

直接依赖这些包意味着你要自己管理版本兼容和资源生命周期。能通过 Session 完成的功能，不需要绕过 `@aelion/sdk`。

## 版本和导入规则

- 一个应用内的所有 `@aelion/*` 包使用完全相同的版本；
- 只从 package exports 导入，不使用 `/src` 或 `/dist` 路径；
- alpha 升级时审阅 API Snapshot 和 CHANGELOG；
- 升级后至少重新跑一次媒体导入、预览、编辑和目标导出格式。

每个包的主要导出见[包与入口参考](/AelionSDK/reference/packages/)，单个函数和类型签名见侧栏中的 API Reference。
