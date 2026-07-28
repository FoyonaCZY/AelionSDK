<div align="center">

# AelionSDK

用 TypeScript 在浏览器中完成时间线编辑、实时预览、播放和音视频导出。

[![CI](https://github.com/FoyonaCZY/AelionSDK/actions/workflows/ci.yml/badge.svg)](https://github.com/FoyonaCZY/AelionSDK/actions/workflows/ci.yml)
[![npm next](https://img.shields.io/npm/v/@aelionsdk/sdk/next?label=npm%20next)](https://www.npmjs.com/package/@aelionsdk/sdk)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f.svg)](LICENSE)
[![Node.js 20](https://img.shields.io/badge/node-20.19%2B-43853d.svg)](package.json)

[文档](https://foyonaczy.github.io/AelionSDK/) · [快速开始](https://foyonaczy.github.io/AelionSDK/start/getting-started/) · [参考编辑器](https://foyonaczy.github.io/AelionSDK/start/reference-editor/) · [API](https://foyonaczy.github.io/AelionSDK/api/overview/)

</div>

## AelionSDK 是什么

AelionSDK 是一个运行在浏览器里的视频编辑与渲染引擎。它提供工程模型、编辑命令、媒体解码、画面合成、音频播放和导出能力，但不绑定 UI，也不要求使用特定前端框架。

你可以用它开发在线剪辑器、模板成片工具、营销素材编辑器，或者任何需要在网页中读取、编辑和导出视频的产品。React、Vue、Svelte 和原生 DOM 都可以接入。

SDK 中最重要的五个对象是：

- `Composition`：用 Layer 和 Clip 以产品级 API 创建图片、文字、形状、字幕、效果、遮罩、关键帧和转场；
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

以代码生成模板或成片时，从 `createComposition()` 开始；导入真实媒体、编辑已有
Project 或使用 Marker/嵌套 Sequence 等底层能力时，使用 `ProjectBuilder` 与
Session Transaction Commands。

## 先跑起来

当前 1.0 Release Candidate 是 `1.0.0-rc.1`，发布在 npm 的 `next` tag。Vite 应用安装 SDK、
导出入口和运行时资源插件：

```bash
npm install @aelionsdk/sdk@next @aelionsdk/export@next
npm install --save-dev @aelionsdk/vite-plugin@next vite
```

也可以克隆仓库并启动 Quickstart：

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

它包含本地素材导入、时间线、播放头拖动、音视频联动编辑、撤销/重做、IndexedDB 自动保存与恢复，以及 WebM 和 H.264 MP4 导出。两个示例都只使用公开包入口，没有调用仓库内部实现。

## 最小接入

使用 Vite 时先启用官方插件，它会处理 Renderer Worker、Export Worker 和 AudioWorklet 资源：

```ts
// vite.config.ts
import { aelion } from '@aelionsdk/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [aelion()],
});
```

非 Vite ESM/CDN 宿主可以把四个运行时入口复制到自己的静态目录，并显式传入 URL；
SDK 不再要求 bundler 理解 `new URL(..., import.meta.url)`：

```ts
const session = await Aelion.createSession({
  media,
  runtimeAssets: {
    rendererWorker: '/aelion/webgl2-worker.js',
    exportWorker: '/aelion/mux-export-worker.js',
    sharedAudioWorklet: '/aelion/pcm-player.worklet.js',
    transferableAudioWorklet: '/aelion/pcm-message-player.worklet.js',
  },
});
```

下面这段代码把用户选择的本地文件变成一个可预览的工程：

```ts
import {
  Aelion,
  ProductionMediaProvider,
  attachPreviewCanvas,
  createProject,
} from '@aelionsdk/sdk';

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

| 模块       | 目前可以做什么                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------- |
| 时间线     | 多轨编辑、插入、移动、裁剪、切分、替换、ripple、roll、slip、slide、音视频联动、Marker、关键帧和变速 |
| 预览与播放 | Canvas 预览、play/pause/seek/scrub、AudioWorklet 音频时钟、自适应画质、WebGL2/WebGPU Worker 合成    |
| 画面       | 多轨合成、12 种混合模式、mask/matte、文字与字幕、Generator、Adjustment、嵌套 Sequence 和 Material   |
| 音频       | 多轨混音、1–8 声道确定性流式重采样、连续保音高变速、ducking、waveform、响度、true peak 和 limiter   |
| 媒体       | MP4/WebM 索引与 seek、VideoFrame/PCM 解码、HTTP Range、代理素材、分段索引、缓存和资源预算           |
| 导出       | H.264/AV1/HEVC + AAC MP4、VP9/Opus WebM、持久分段恢复、图片、GIF、WAV/RF64，以及多种 Writable Sink  |
| 迁移       | WebAV Sprite 与 Diffusion checkpoint 严格迁移、CLI/dry-run、实体映射和无静默渲染损失报告            |
| 持久化     | canonical Project 快照、跨刷新 generation、内容 hash 校验和 IndexedDB 自动恢复                      |
| 扩展       | 自定义 Material、隔离 Worker RPC、远程导出 Provider、持久 CacheStore、媒体读取器和能力探测          |

编辑操作通过 Transaction 提交。每次成功提交都会产生新的 revision，并可以 Undo/Redo；拖拽或滑块等连续交互可以实时更新，同时只占用一条撤销记录。

更完整的功能与限制说明见[当前能力](https://foyonaczy.github.io/AelionSDK/start/capabilities/)。

## 性能基线

性能数据来自 2026-07-28 的同一台 Windows 参考机：AMD Ryzen 5 7500F（6 核
12 线程）、NVIDIA GeForce RTX 5060 Ti、32 GiB 内存、Google Chrome
150.0.7871.186、Node.js 20.20.2。所有浏览器项目在 cross-origin isolated
的全新 Headless Chrome 页面中串行运行；p50/p95 均由报告中保留的原始样本按
nearest-rank 计算。

这些数字是当前提交的回归基线，不是跨设备排行榜。WebCodecs 会受到浏览器版本、
驱动、硬件编码器策略、温度和电源模式影响，使用 Aelion 的产品应在自己的目标设备
和真实素材上重新测量。

### 合成、编译和导出

| 项目                                | 结果                                                     |
| ----------------------------------- | -------------------------------------------------------- |
| 720p、单 pass、WebGL2               | 帧调用 p50 0.23 ms，p95 0.49 ms                          |
| 1080p、单 pass、WebGL2              | 帧调用 p50 0.23 ms，p95 0.38 ms                          |
| 1080p、单 pass、WebGPU              | 帧调用 p50 0.73 ms，p95 1.12 ms                          |
| 1080p、四 pass Soft Glow、WebGL2    | 帧调用 p50 0.64 ms，p95 1.07 ms                          |
| 4K、单 pass、WebGL2                 | 帧调用 p50 1.09 ms，p95 1.13 ms                          |
| 1,000 clips / 32 tracks 冷编译      | p50 21.23 ms，p95 29.60 ms                               |
| 1,000 clips / 32 tracks warm 增量   | p50 1.92 ms，p95 2.20 ms                                 |
| 单音轨 1,024-frame 音频块           | p95 0.43 ms，整体约 63.91× 实时                          |
| 1080p30 VP9/Opus WebM，3 秒，4 Mbps | 两次导出 p50 377.84 ms，平均约 7.89× 实时                |
| 1080p30 H.264/AAC MP4，3 秒，4 Mbps | 两次导出 p50 374.85 ms，平均约 7.62× 实时                |
| 4K30 VP9/Opus WebM，1 秒，12 Mbps   | 493.67 ms，约 2.03× 实时                                 |
| 4K30 H.264/AAC MP4，1 秒，12 Mbps   | 449.66 ms，`avc1.640033`，约 2.22× 实时                  |
| OPFS 顺序写入，16 个 1 MiB 块       | 约 452 MiB/s；Memory Sink 约 6.87 GiB/s                  |
| 1080p WebGL2 180 帧 soak            | 前半 p95 0.98 ms，后半 p95 1.02 ms，dispose 后无 pending |

合成数据测量的是 `WorkerCompositor.compose()` 完成一次确定性 Material 调用的墙钟
时间，不等于完整播放器 FPS。导出矩阵使用生成的 Canvas 帧和静音，计时包含编码、
mux、Sink 关闭和 Memory Sink 最终连续数组组装，但不包含输入媒体解码。因此
1080p 的约 8× 是编码管线基线，不应当直接当作真实多轨工程的导出速度。

同页公开 Profile preflight 中，WebM、H.264 MP4、AV1 MP4 和 HEVC MP4 全部按
实际尺寸协商并通过；H.264 在 1080p 选择 `avc1.640028`，4K 选择
`avc1.640033`。AV1/HEVC 仍是能力门控路径，只有当前浏览器的 WebCodecs 与 muxer
同时接受精确配置才会开始写入。

### 真实媒体和端到端工程

五种公开 fixture 覆盖 moov 头/尾 MP4、fragmented MP4、非零 PTS MP4 和
VP9/VFR WebM。四个确定性目标点的 warm seek p95 为 2.72–7.49 ms，最慢
cold seek p95 为 15.34 ms；测试结束后活动 decoder 和保留 VideoFrame 都归零。

真实素材全链路基准把固定 H.264/AAC MP4 通过公开 Session 分别缩放并导出：
1080p30 用时 310.53 ms（约 3.22× 实时），4K30 用时 290.97 ms（约 3.44×
实时）。两项都覆盖输入解码、Render IR、PCM 解码/混音、编码、mux 和 sink close，
且主线程均没有观测到超过 50 ms 的 Long Task；1080p 产物还由 FFmpeg 解出
30 个视频帧并完成音频 PCM MD5 回读。

WebM/MP4 可恢复导出证据把 2 秒工程分成 10 个持久单元，在 25%、50% 和 90%
提交点强制中断并重建 IndexedDB store。恢复分别复用 3/5/9 个单元，只编码
7/5/1 个剩余单元，已提交帧的重复渲染数均为 0；恢复产物经 FFmpeg 解码后的
60 个逐帧 MD5 和完整 float32 PCM SHA-256 与无中断参考逐项一致。PCM 哈希包含
codec packet 的完整尾部填充；逻辑 A/V 末端按请求的 PCM 帧数计算，报告同时公开
`codecPacketEndUs` 与 `codecTailFrames`，避免把 packet 量化误报成时间线漂移。

60 秒端到端工程通过公开 Session API 完成编辑、播放、预览、VP9/Opus 导出和
外部 FFmpeg 全量解码回读。其输出为 320×180、30 fps、800 kbps，用时
10.13 秒，即约 5.93× 实时；成片包含 1,800 个视频帧、60 秒音频，音视频末端
偏差为 333 μs，主线程没有观测到超过 50 ms 的 Long Task。这个项目比生成帧
导出更接近完整调用链，但分辨率较低，不能用于推断 1080p 成片速度。

### Aelion、WebAV 与 Diffusion Studio Core 同机调用延迟

同页竞品基准使用两路 320×180 H.264/B-frame 素材，缩放到 1080p，叠加富文本
和 500 ms dissolve。结果是 API 调用返回延迟，不是长视频导出速度：

| 引擎                        | 连续预览 p95 | warm seek p95 |
| --------------------------- | -----------: | ------------: |
| Aelion                      |     13.99 ms |       7.36 ms |
| WebAV 1.2.8                 |     33.31 ms |     108.35 ms |
| Diffusion Studio Core 4.0.3 |      0.18 ms |       0.23 ms |

三者的缓存、GPU readback 和 `seek()` 完成语义不同；Diffusion 的低调用耗时尤其
不能单独证明最终像素已经以相同方式完成。该基准只适合监控同一环境、同一脚本下的
回归趋势，详细限制见[同机竞品基准](https://foyonaczy.github.io/AelionSDK/production/competitor-benchmark/)。

### 复现与原始数据

```bash
corepack pnpm report:performance
corepack pnpm report:recovery
corepack pnpm report:phase3:check
corepack pnpm report:seek
corepack pnpm report:alpha
corepack pnpm bench:competitors -- \
  --competitor-node-modules /absolute/path/to/node_modules
```

- [`performance-1080p30-chromium.json`](reports/baseline/performance-1080p30-chromium.json)：codec/WebGPU 能力、分辨率与 pass 矩阵、10/100/1,000 clip 编译、真实媒体 1080p/4K 全链路与 FFmpeg 回读、Memory/OPFS、10 分钟 PCM 和 compositor soak；
- [`recovery-chromium.json`](reports/baseline/recovery-chromium.json)：WebM/MP4 的 IndexedDB checkpoint、中断恢复、未提交单元重做计数、FFmpeg 逐帧 MD5、完整 PCM SHA-256 和 A/V 时间线末端；
- [`media-seek-chromium.json`](reports/baseline/media-seek-chromium.json)：五种真实容器的索引、cold/warm seek、解码包数和资源归零；
- [`alpha-60s.json`](reports/baseline/alpha-60s.json) 与 [`alpha-60s.webm`](reports/baseline/alpha-60s.webm)：60 秒端到端工程、成片 hash 和 FFmpeg 回读；
- [`competitor-benchmark-chromium.json`](reports/baseline/competitor-benchmark-chromium.json)：三引擎同机原始样本、版本与环境。

浏览器 JavaScript heap 不包含多数 decoder surface、GPU texture 和浏览器进程
内存；10 分钟 PCM 是资源上限模拟，不是 10 分钟真实视频导出。当前报告也不构成
Safari 真机、实体移动端、HDR 或 10-bit 认证。

## 当前边界

AelionSDK 现在适合做产品原型、内部工具和目标设备上的集成验证，但版本仍处于
1.0 RC 阶段。使用前需要了解这些边界：

- 13 个公开包通过 npm `next` tag 发布；RC API 在首个稳定版本前仍可能按迁移规则调整；
- 自动化覆盖 Chromium、Firefox、Playwright WebKit 和 390×844 触控目标；Safari
  真机、iOS 与 Android 实体设备仍未认证；
- 本地画面管线目前是 RGBA8 SDR，不支持 HDR、PQ/HLG 或 10-bit 输出；
- 4K 可以探测和离线导出，但没有跨设备的 4K30 实时预览承诺；
- 线性 TimeMap 可以选择 deterministic WSOLA 保音高；非线性 TimeMap 会在
  schema/validation 阶段拒绝 `pitchPolicy: 'preserve'`；
- Vite 有官方插件；其他 ESM/CDN 宿主必须显式部署并传入四个 `runtimeAssets` URL。

MP4/H.264/AAC、WebGPU、SharedArrayBuffer 和高分辨率预览是否可用，取决于实际浏览器、操作系统和硬件。产品应在运行时做 capability probe 和 export preflight，而不是只按浏览器名称判断。

详见[兼容性与部署](https://foyonaczy.github.io/AelionSDK/production/compatibility/)和[当前版本状态](https://foyonaczy.github.io/AelionSDK/project/status/)。

## 从哪里继续读

- [从本地视频到 MP4](https://foyonaczy.github.io/AelionSDK/start/getting-started/)：第一次接入建议从这里开始；
- [使用 Composition API 创作](https://foyonaczy.github.io/AelionSDK/guides/composition-api/)：用 Layer 和 Clip 创建图片、文字、形状、效果、遮罩、关键帧和转场；
- [Project 和时间线](https://foyonaczy.github.io/AelionSDK/concepts/project-timeline/)：理解保存格式、轨道、片段和素材引用；
- [把 SDK 接进剪辑器 UI](https://foyonaczy.github.io/AelionSDK/guides/editor-ui/)：连接状态管理、时间线、Inspector 和自动保存；
- [从 WebAV 与 Diffusion Studio 迁移](https://foyonaczy.github.io/AelionSDK/guides/migration/)：严格转换源工程并处理无法等价表达的能力；
- [Revision 持久化与扩展隔离](https://foyonaczy.github.io/AelionSDK/guides/durability-extensions/)：接入自动恢复和受限 Worker RPC；
- [导出 MP4 和 WebM](https://foyonaczy.github.io/AelionSDK/export/video/)：选择 Profile、Sink、码率并处理 preflight；
- [包和公开入口](https://foyonaczy.github.io/AelionSDK/reference/packages/)：决定应用需要依赖哪些包；
- [API Reference](https://foyonaczy.github.io/AelionSDK/api/overview/)：查看所有公开类型和方法。

仓库内值得先看的目录：

- [`apps/quickstart`](apps/quickstart)：不依赖 UI 框架的最短完整示例；
- [`apps/editor-demo`](apps/editor-demo)：参考剪辑器；
- [`examples/typescript`](examples/typescript)：文档中的可编译代码；
- [`packages`](packages)：SDK 各模块源码；
- [`apps/docs`](apps/docs)：文档站源码。

大多数应用从 `@aelionsdk/sdk` 开始，需要直接管理导出 Sink 时再使用 `@aelionsdk/export`。底层媒体、渲染、音频和 Material 包可以按需单独接入。

## 本地开发

需要 Node.js `>=20.19 <21` 和 Corepack：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run ci
corepack pnpm test:browser
corepack pnpm test:browser:firefox
corepack pnpm test:browser:webkit
corepack pnpm test:browser:mobile
```

`pnpm run ci` 会检查格式、文档链接、Schema、类型、单元测试、应用构建和 API
Snapshot；浏览器门禁覆盖 Chromium、Firefox、Playwright WebKit 公共合约和移动触控
目标。

贡献代码前请阅读[贡献指南](CONTRIBUTING.md)。开发命令、包验证和发布流程见[维护仓库与准备发布](https://foyonaczy.github.io/AelionSDK/project/development/)。

## 最新验证状态

2026-07-28 在 Windows 参考机上完成了与源清单
`714daf26de8ae2ba230da483be50c6faf1ae9f0c38544097f1a4f034b2d79be4`
绑定的串行最终门禁：21/21 个命令通过，门禁前后源清单一致，40 项产物 postflight
语义校验通过。Chromium 83 项和 Firefox 69 项浏览器测试均为零失败、零跳过；
13 个公开 tarball 的独立 Node/Chromium/Firefox 消费者、release dry-run、双打包
字节可复现性、golden、benchmark、1080p30/4K 性能、seek、可恢复导出与 60 秒导出
外部 FFmpeg readback 均通过。

完整机器可读结果见 `reports/baseline/phase-1-gate-results.json`，发布状态索引见
`docs/status.md`。绑定于相同源清单、门禁记录和证据集的独立 blocker review 已签署
`approved`；`1.0.0-rc.1` 已作为 13 个带 provenance 的 npm 包发布到 `next`，并创建
[`v1.0.0-rc.1`](https://github.com/FoyonaCZY/AelionSDK/tree/v1.0.0-rc.1) 和
[GitHub prerelease](https://github.com/FoyonaCZY/AelionSDK/releases/tag/v1.0.0-rc.1)。
精确安装与 registry 验证命令见[安装文档](https://foyonaczy.github.io/AelionSDK/start/installation/#验证发布身份)。

## License

AelionSDK 使用 [MIT License](LICENSE)。第三方组件和测试素材许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。功能建议和问题可以提交到 [GitHub Issues](https://github.com/FoyonaCZY/AelionSDK/issues)；安全问题请按照 [Security Policy](SECURITY.md) 私下报告。
