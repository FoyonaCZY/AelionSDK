---
title: 包和公开入口
description: 查询 13 个 @aelionsdk 包的职责、主要导出和使用对象。
---

当前所有公开包版本都是 `1.2.0-rc.3`，通过 npm `next` tag 分发。只有
`package.json` 的 `exports` 暴露的入口属于公共 API；`src/*`、`dist/*` 和测试
helper 不在兼容范围内。

如果你在做普通剪辑应用，先看[我需要安装哪些包](/AelionSDK/zh/start/packages/)。本页主要供查询和底层扩展使用。

## 稳定性层级

所有包都会随同一个版本发布，但“已发布到 npm”不表示它们具有相同的兼容承诺：

| 层级         | 包                                                                                                         | 兼容承诺                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 产品应用入口 | `@aelionsdk/sdk`、`@aelionsdk/export`、`@aelionsdk/vite-plugin`                                            | 面向应用开发者；优先保持源码和行为兼容，弃用后按版本政策保留迁移窗口                                   |
| 扩展作者入口 | `@aelionsdk/material-sdk`、`@aelionsdk/project-schema`                                                     | 面向 Material、导入器和工程工具作者；协议与 Schema 有显式版本和 migration                              |
| 高级执行层   | `core`、`capability`、`media`、`material-compiler`、`render-ir`、`renderer-worker`、`audio`、`transaction` | 面向自定义宿主和引擎贡献者；公共 exports 仍受 API snapshot 管理，但 1.0 前允许有记录的预发布破坏性调整 |

应用应优先只依赖产品应用入口。直接依赖高级执行层等同于选择更窄的兼容边界，并需要
自行跟进 CHANGELOG、能力矩阵和资源生命周期变化。

## 产品应用直接依赖的包

### `@aelionsdk/sdk`

大多数业务代码的入口：

- `Aelion.createSession()`；
- `createComposition()`、`Composition`、`Layer`、`Clip`；
- `createProject()`、`ProjectBuilder`；
- `seconds()`、`milliseconds()`、`frames()`；
- `ProductionMediaProvider`、`ByteMediaProvider`；
- `attachPreviewCanvas()`；
- `session.audio` 的分析、波形、静音移除与母带；
- revision 持久化、WebAV/Diffusion 迁移和隔离 Worker 扩展；
- `aelion-migrate` 文件 CLI 和 `@aelionsdk/sdk/migrate-cli` Node 入口；
- Session、Player、Transaction、Preview、Export 的公开类型；
- `RuntimeMaterialRegistry` 和默认 Schema。

```ts
import {
  Aelion,
  ProductionMediaProvider,
  attachPreviewCanvas,
  createComposition,
  seconds,
} from '@aelionsdk/sdk';
```

`createComposition()` 是产品级创作入口；`createProject()` 是媒体导入和 Schema
级操作使用的 Builder 入口。两者不是两套工程格式。

### `@aelionsdk/export`

产品层通常直接使用 Sink 和远程导出类型：

- `SeekableMemorySink`；
- `OpfsSeekableSink`；
- `EXPORT_PROFILES`；
- `RemoteExportProvider` / `RemoteExportAuthorizer`；
- checkpoint、Worker exporter 和底层 profile 函数。

```ts
import { OpfsSeekableSink, type RemoteExportProvider } from '@aelionsdk/export';
```

通过 Session 导出时，不需要直接调用底层 `exportMp4()` 或 `exportWebM()`。

### `@aelionsdk/vite-plugin`

Vite 配置：

```ts
import { aelion } from '@aelionsdk/vite-plugin';

export default defineConfig({ plugins: [aelion()] });
```

它负责 Renderer Worker、Export Worker 和 AudioWorklet 构建入口。同一个包还导出
`AelionWebpackPlugin`（Webpack 5/Rspack）、`loadAelionRuntimeAssets()`（自定义复制）
和 `aelionRuntimeAssetUrls()`（Next client boundary / CDN）。所有路径最终都显式传给
`AelionSessionOptions.runtimeAssets`。

### `@aelionsdk/material-sdk`

给 Material 作者和 Catalog/安装系统使用：

- `materialGraph()`、`materialDefinition()`；
- `packMaterialPackage()`；
- `MaterialRegistry`、`MaterialCatalog`；
- `MaterialLabSession`；
- 签名、TrustStore、migration、Golden helper。
- `aelion-material` 脚手架、校验、类型生成、预览报告、Golden 和确定性打包 CLI。

## 引擎层包

| 包                             | 主要内容                                                             | 谁会直接用                      |
| ------------------------------ | -------------------------------------------------------------------- | ------------------------------- |
| `@aelionsdk/core`              | `AelionError`、Diagnostic、时间/帧/采样换算、JSON 类型               | 错误处理、底层扩展              |
| `@aelionsdk/project-schema`    | Project v1 类型、`ProjectValidator`、canonical clone、输入 admission | 自定义 Project 工具、服务端校验 |
| `@aelionsdk/transaction`       | `EditingCommands`、Transaction Engine、History、ChangeSet            | 引擎贡献者、自定义宿主          |
| `@aelionsdk/render-ir`         | Project 编译、音视频求值、色彩描述、compile stats                    | 自定义 renderer/exporter        |
| `@aelionsdk/media`             | RangeReader、MP4/WebM 索引、seek/decode、CacheStore、proxy/governor  | 自定义媒体来源和缓存            |
| `@aelionsdk/audio`             | PCM 混音、AudioWorklet clock、ring/queue、视频调度                   | 自定义音频宿主和分析            |
| `@aelionsdk/renderer-worker`   | Worker client/protocol、WebGL2/WebGPU 合成、帧结果                   | 自定义渲染表面                  |
| `@aelionsdk/capability`        | GPU、codec、音频、存储和 WASM 探测                                   | 独立能力实验和宿主              |
| `@aelionsdk/material-compiler` | Graph 类型检查、Core Node、WebGL2/WebGPU 编译和预算                  | Material 工具和自定义宿主       |

## 依赖方向

```text
Application
  ├─ @aelionsdk/sdk
  ├─ @aelionsdk/export        只为 Sink/Remote 类型
  └─ @aelionsdk/vite-plugin   可选，仅 Vite 构建配置

@aelionsdk/sdk
  → project-schema / transaction / render-ir
  → media / audio / renderer-worker / export
  → capability / material-compiler
```

应用不应把 SDK 内部依赖关系复制成自己的横向调用网络。能从 Session 获得的功能就从 Session 使用，这样升级时只需要跟踪公共接口。

每个符号的参数、返回类型和源码链接见侧栏 API Reference。RC 升级时还可以查看 [`packages/sdk/api-snapshot.md`](https://github.com/FoyonaCZY/AelionSDK/blob/main/packages/sdk/api-snapshot.md) 的导出变化。
