<div align="center">

# AelionSDK

用 TypeScript 在浏览器中完成时间线编辑、实时预览、播放和音视频导出。

[![CI](https://github.com/FoyonaCZY/AelionSDK/actions/workflows/ci.yml/badge.svg)](https://github.com/FoyonaCZY/AelionSDK/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f.svg)](LICENSE)
[![Node.js 20](https://img.shields.io/badge/node-20.19%2B-43853d.svg)](package.json)

[文档](https://foyonaczy.github.io/AelionSDK/) · [快速开始](https://foyonaczy.github.io/AelionSDK/start/getting-started/) · [参考编辑器](https://foyonaczy.github.io/AelionSDK/start/reference-editor/) · [API](https://foyonaczy.github.io/AelionSDK/api/overview/)

</div>

## AelionSDK 是什么

AelionSDK 是一个运行在浏览器里的视频编辑与渲染引擎。它提供工程模型、编辑命令、媒体解码、画面合成、音频播放和导出能力，但不绑定 UI，也不要求使用特定前端框架。

你可以用它开发在线剪辑器、模板成片工具、营销素材编辑器，或者任何需要在网页中读取、编辑和导出视频的产品。React、Vue、Svelte 和原生 DOM 都可以接入。

SDK 中最重要的四个对象是：

- `Project`：一份可保存、可迁移的 JSON，记录素材、轨道、片段、效果和输出规格；
- `ProductionMediaProvider`：把 Project 中的素材 ID 绑定到 File、URL、OPFS 或自定义数据源；
- `Session`：加载 Project，提供编辑、预览、播放、导出、事件和诊断接口；
- `PreviewCanvasController`：把 Session 产生的画面绘制到 Canvas，并处理缩放、过期帧和资源释放。

```text
File / URL / OPFS ──→ Media Provider
                           │
Project JSON ──────────→ Session
                           ├── Transaction + Undo / Redo
                           ├── Preview + Player
                           └── Local / Remote Export
```

Project 只描述“剪什么”，Media Provider 负责“去哪里读取素材”，Session 则执行编辑和渲染。预览与导出消费同一份 Project 和 Render IR，时间映射、Material 与音频规则不会各维护一套实现。

## 先跑起来

当前版本为 `0.1.0-alpha.0`，源码可以运行，但尚未发布到 npm。现阶段最直接的体验方式是启动仓库内的 Quickstart：

```bash
git clone https://github.com/FoyonaCZY/AelionSDK.git
cd AelionSDK
corepack pnpm install --frozen-lockfile
corepack pnpm dev:quickstart
```

打开终端给出的本地地址，选择一个 MP4 或 WebM 文件。页面可以显示第一帧、拖动和播放素材、移动片段并撤销，以及在设备支持时导出 H.264/AAC MP4。

如果想看一个更接近剪辑产品的例子，可以运行参考编辑器：

```bash
corepack pnpm dev:editor
```

它包含本地素材导入、时间线、播放头拖动、音视频联动编辑、撤销/重做，以及 WebM 和 H.264 MP4 导出。两个示例都只使用公开包入口，没有调用仓库内部实现。

## 最小接入

使用 Vite 时先启用官方插件，它会处理 Renderer Worker、Export Worker 和 AudioWorklet 资源：

```ts
// vite.config.ts
import { aelion } from '@aelion/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [aelion()],
});
```

下面这段代码把用户选择的本地文件变成一个可预览的工程：

```ts
import { Aelion, ProductionMediaProvider, attachPreviewCanvas, createProject } from '@aelion/sdk';

async function openVideo(file: File, canvas: HTMLCanvasElement) {
  const media = new ProductionMediaProvider();
  media.registerFile('asset_main', file);

  const probe = await media.probe('asset_main');
  const video = probe.index.tracks.find(track => track.kind === 'video');

  const builder = createProject({
    width: video?.codedWidth ?? 1920,
    height: video?.codedHeight ?? 1080,
    frameRate: { numerator: 30, denominator: 1 },
  });

  await builder.importMedia({
    provider: media,
    assetId: 'asset_main',
    name: file.name,
    ...(file.type.length === 0 ? {} : { mimeType: file.type }),
  });

  const session = await Aelion.createSession({ media });
  await session.loadProject(builder.build());

  const preview = attachPreviewCanvas(session, canvas, {
    quality: 'adaptive',
    fit: 'contain',
  });
  await preview.render(0);

  return async () => {
    preview.dispose();
    await session.dispose();
    media.dispose();
  };
}
```

这里的时间单位是整数微秒。`preview.render(0)` 请求时间线起点的画面；快速连续请求时，Controller 会取消过期任务并释放旧帧。

完整可编译版本在 [`examples/typescript/sdk-integration.ts`](examples/typescript/sdk-integration.ts)。从素材导入一直走到 H.264 MP4 的教程见[快速开始](https://foyonaczy.github.io/AelionSDK/start/getting-started/)。

## 已有能力

| 模块       | 目前可以做什么                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| 时间线     | 多轨编辑、插入、移动、裁剪、切分、替换、ripple、roll、slip、slide、音视频联动、Marker、关键帧和变速    |
| 预览与播放 | Canvas 预览、play/pause/seek/scrub、AudioWorklet 音频时钟、自适应画质、WebGL2/WebGPU Worker 合成       |
| 画面       | 多轨合成、12 种混合模式、mask/matte、文字与字幕、Generator、Adjustment、嵌套 Sequence 和 Material      |
| 音频       | 多轨混音、gain/pan/fade、mute/solo、声道矩阵、ducking、waveform、响度、true peak 和 limiter            |
| 媒体       | MP4/WebM 索引与 seek、VideoFrame/PCM 解码、HTTP Range、代理素材、分段索引、缓存和资源预算              |
| 导出       | H.264/AAC MP4、VP9/Opus WebM、PNG、JPEG、WebP、GIF、WAV/RF64，以及 Memory、OPFS 和自定义 Writable Sink |
| 扩展       | 自定义 Material、远程导出 Provider、持久 CacheStore、媒体读取器和能力探测                              |

编辑操作通过 Transaction 提交。每次成功提交都会产生新的 revision，并可以 Undo/Redo；拖拽或滑块等连续交互可以实时更新，同时只占用一条撤销记录。

更完整的功能与限制说明见[当前能力](https://foyonaczy.github.io/AelionSDK/start/capabilities/)。

## 当前边界

AelionSDK 现在适合做产品原型、内部工具和目标设备上的集成验证，但版本仍处于 Alpha。使用前需要了解这些边界：

- 公开包还没有发布到 npm，API 在首个稳定版本前仍可能调整；
- 自动化测试覆盖桌面 Chromium 和 Firefox，Safari、iOS、Android 尚未完成认证；
- 本地画面管线目前是 RGBA8 SDR，不支持 HDR、PQ/HLG 或 10-bit 输出；
- 4K 可以探测和离线导出，但没有跨设备的 4K30 实时预览承诺；
- 音频变速目前会同时改变音高，还没有保音高的 time-stretch；
- 官方构建集成目前是 Vite，其他 bundler 尚未提供适配和兼容性保证。

MP4/H.264/AAC、WebGPU、SharedArrayBuffer 和高分辨率预览是否可用，取决于实际浏览器、操作系统和硬件。产品应在运行时做 capability probe 和 export preflight，而不是只按浏览器名称判断。

详见[兼容性与部署](https://foyonaczy.github.io/AelionSDK/production/compatibility/)和[当前版本状态](https://foyonaczy.github.io/AelionSDK/project/status/)。

## 从哪里继续读

- [从本地视频到 MP4](https://foyonaczy.github.io/AelionSDK/start/getting-started/)：第一次接入建议从这里开始；
- [Project 和时间线](https://foyonaczy.github.io/AelionSDK/concepts/project-timeline/)：理解保存格式、轨道、片段和素材引用；
- [把 SDK 接进剪辑器 UI](https://foyonaczy.github.io/AelionSDK/guides/editor-ui/)：连接状态管理、时间线、Inspector 和自动保存；
- [导出 MP4 和 WebM](https://foyonaczy.github.io/AelionSDK/export/video/)：选择 Profile、Sink、码率并处理 preflight；
- [包和公开入口](https://foyonaczy.github.io/AelionSDK/reference/packages/)：决定应用需要依赖哪些包；
- [API Reference](https://foyonaczy.github.io/AelionSDK/api/overview/)：查看所有公开类型和方法。

仓库内值得先看的目录：

- [`apps/quickstart`](apps/quickstart)：不依赖 UI 框架的最短完整示例；
- [`apps/editor-demo`](apps/editor-demo)：参考剪辑器；
- [`examples/typescript`](examples/typescript)：文档中的可编译代码；
- [`packages`](packages)：SDK 各模块源码；
- [`apps/docs`](apps/docs)：文档站源码。

大多数应用从 `@aelion/sdk` 开始，需要直接管理导出 Sink 时再使用 `@aelion/export`。底层媒体、渲染、音频和 Material 包可以按需单独接入。

## 本地开发

需要 Node.js `>=20.19 <21` 和 Corepack：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run ci
corepack pnpm test:browser
corepack pnpm test:browser:firefox
```

`pnpm run ci` 会检查格式、文档链接、Schema、类型、单元测试、应用构建和 API Snapshot；浏览器测试分别使用 Chromium 和 Firefox。

贡献代码前请阅读[贡献指南](CONTRIBUTING.md)。开发命令、包验证和发布流程见[维护仓库与准备发布](https://foyonaczy.github.io/AelionSDK/project/development/)。

## License

AelionSDK 使用 [MIT License](LICENSE)。第三方组件和测试素材许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。功能建议和问题可以提交到 [GitHub Issues](https://github.com/FoyonaCZY/AelionSDK/issues)；安全问题请按照 [Security Policy](SECURITY.md) 私下报告。
