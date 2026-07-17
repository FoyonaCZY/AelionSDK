---
title: 包和公开入口
description: 查询 13 个 @aelion 包的职责、主要导出和使用对象。
---

当前所有公开包版本都是 `0.1.0-alpha.0`。只有 `package.json` 的 `exports` 暴露的入口属于公共 API；`src/*`、`dist/*` 和测试 helper 不在兼容范围内。

如果你在做普通剪辑应用，先看[我需要安装哪些包](/AelionSDK/start/packages/)。本页主要供查询和底层扩展使用。

## 产品应用直接依赖的包

### `@aelion/sdk`

大多数业务代码的入口：

- `Aelion.createSession()`；
- `createProject()`、`ProjectBuilder`；
- `seconds()`、`milliseconds()`、`frames()`；
- `ProductionMediaProvider`、`ByteMediaProvider`；
- `attachPreviewCanvas()`；
- Session、Player、Transaction、Preview、Export 的公开类型；
- `RuntimeMaterialRegistry` 和默认 Schema。

```ts
import {
  Aelion,
  ProductionMediaProvider,
  attachPreviewCanvas,
  createProject,
  seconds,
} from '@aelion/sdk';
```

### `@aelion/export`

产品层通常直接使用 Sink 和远程导出类型：

- `SeekableMemorySink`；
- `OpfsSeekableSink`；
- `EXPORT_PROFILES`；
- `RemoteExportProvider` / `RemoteExportAuthorizer`；
- checkpoint、Worker exporter 和底层 profile 函数。

```ts
import { OpfsSeekableSink, type RemoteExportProvider } from '@aelion/export';
```

通过 Session 导出时，不需要直接调用底层 `exportMp4()` 或 `exportWebM()`。

### `@aelion/vite-plugin`

只在 Vite 配置中使用：

```ts
import { aelion } from '@aelion/vite-plugin';

export default defineConfig({ plugins: [aelion()] });
```

它负责 Renderer Worker 和 AudioWorklet 构建入口。

### `@aelion/material-sdk`

给 Material 作者和 Catalog/安装系统使用：

- `materialGraph()`、`materialDefinition()`；
- `packMaterialPackage()`；
- `MaterialRegistry`、`MaterialCatalog`；
- `MaterialLabSession`；
- 签名、TrustStore、migration、Golden helper。

## 引擎层包

| 包                          | 主要内容                                                             | 谁会直接用                      |
| --------------------------- | -------------------------------------------------------------------- | ------------------------------- |
| `@aelion/core`              | `AelionError`、Diagnostic、时间/帧/采样换算、JSON 类型               | 错误处理、底层扩展              |
| `@aelion/project-schema`    | Project v1 类型、`ProjectValidator`、canonical clone、输入 admission | 自定义 Project 工具、服务端校验 |
| `@aelion/transaction`       | `EditingCommands`、Transaction Engine、History、ChangeSet            | 引擎贡献者、自定义宿主          |
| `@aelion/render-ir`         | Project 编译、音视频求值、色彩描述、compile stats                    | 自定义 renderer/exporter        |
| `@aelion/media`             | RangeReader、MP4/WebM 索引、seek/decode、CacheStore、proxy/governor  | 自定义媒体来源和缓存            |
| `@aelion/audio`             | PCM 混音、AudioWorklet clock、ring/queue、视频调度                   | 自定义音频宿主和分析            |
| `@aelion/renderer-worker`   | Worker client/protocol、WebGL2/WebGPU 合成、帧结果                   | 自定义渲染表面                  |
| `@aelion/capability`        | GPU、codec、音频、存储和 WASM 探测                                   | 独立能力实验和宿主              |
| `@aelion/material-compiler` | Graph 类型检查、Core Node、WebGL2/WebGPU 编译和预算                  | Material 工具和自定义宿主       |

## 依赖方向

```text
Application
  ├─ @aelion/sdk
  ├─ @aelion/export        只为 Sink/Remote 类型
  └─ @aelion/vite-plugin   只在构建配置

@aelion/sdk
  → project-schema / transaction / render-ir
  → media / audio / renderer-worker / export
  → capability / material-compiler
```

应用不应把 SDK 内部依赖关系复制成自己的横向调用网络。能从 Session 获得的功能就从 Session 使用，这样升级时只需要跟踪公共接口。

每个符号的参数、返回类型和源码链接见侧栏 API Reference。Alpha 升级时还可以查看 [`packages/sdk/api-snapshot.md`](https://github.com/FoyonaCZY/AelionSDK/blob/main/packages/sdk/api-snapshot.md) 的导出变化。
