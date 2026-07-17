---
title: 包与入口
description: AelionSDK 公开包、用途、主要导出和推荐使用层级。
---

所有公开包当前版本一致为 `0.1.0-alpha.0`，只保证 package `exports` 中的入口。不要导入 `src/*`、`dist/*` 或未导出的内部文件。

## 产品层

### `@aelion/sdk`

应用聚合入口。主要导出：

- `Aelion.createSession()`；
- `createProject()` / `ProjectBuilder` / 时间 helpers；
- `ProductionMediaProvider` / `ByteMediaProvider`；
- `attachPreviewCanvas()`；
- Session、Player、Preview、Transaction、Export 类型；
- Runtime Material Registry 和默认 Schema。

### `@aelion/export`

导出 Profile、preflight 底层实现和 Sink：

- `SeekableMemorySink`、`OpfsSeekableSink`；
- `EXPORT_PROFILES`、`probeExportProfiles()`、`selectExportProfile()`；
- WebM/MP4、WAV/RF64、静帧/GIF 类型；
- checkpoint 和 Remote Export 协议；
- Worker exporter。

### `@aelion/vite-plugin`

导出 `aelion()`，把 Renderer Worker 和 AudioWorklet 作为真实构建入口发布，并处理开发服务器 URL。

### `@aelion/material-sdk`

Material 作者工具：manifest/definition/graph 构建、校验、签名、迁移和测试相关公开契约。

## 引擎层

### `@aelion/core`

`AelionError`、Diagnostic、canonical JSON、微秒/帧/采样换算、Rational、JSON 类型和通用校验。

### `@aelion/project-schema`

Project v1 实体类型、`ProjectValidator`、input admission、canonical clone 和集合常量。

### `@aelion/transaction`

`TransactionEngine`、History、`EditingCommands`、atomic operations、ChangeSet、affected ranges、undo/redo 和交互合并。

### `@aelion/render-ir`

Project → Render IR compiler、IR 类型、音视频求值、色彩 contract、compile stats 和资源计划。

### `@aelion/media`

RangeReader、MP4/WebM SampleIndex、精确 seek、Video/Audio decode、CacheStore、proxy selection 和页面级资源 governor。

### `@aelion/audio`

PCM source/mix、AudioWorklet clock、shared ring/transferable queue 和 audio-driven video scheduler。

### `@aelion/renderer-worker`

Renderer Worker client/protocol、WebGL2/WebGPU composition、frame result 和队列/资源生命周期。

### `@aelion/capability`

环境、GPU、codec、音频、存储和 WASM 能力探测与分级。

### `@aelion/material-compiler`

Material Graph 的类型检查、Core Node 编译、WebGL2/WebGPU 程序和执行预算。

## 依赖方向

业务应用通常只直接依赖产品层。引擎层通过公开类型组合，但不应形成业务对内部实现的横向耦合。

```text
Application
  → @aelion/sdk
    → Project / Transaction / Render IR
    → Media / Audio / Renderer / Export
    → Capability / Material
```

每个符号的签名和 source link 见站点侧栏中的 API Reference。
