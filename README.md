<div align="center">

# AelionSDK

**在浏览器里构建真正的视频编辑产品。**

从时间线编辑、实时预览到音视频导出，使用同一套工程模型和渲染语义。

[![CI](https://github.com/FoyonaCZY/AelionSDK/actions/workflows/ci.yml/badge.svg)](https://github.com/FoyonaCZY/AelionSDK/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f.svg)](LICENSE)
[![Node.js 20](https://img.shields.io/badge/node-20.19%2B-43853d.svg)](package.json)

[快速开始](docs/getting-started.md) · [能力全景](docs/capabilities.md) · [架构设计](docs/architecture.md) · [文档中心](docs/README.md)

</div>

## 一套内核，覆盖完整剪辑链路

AelionSDK 是一套 Browser-first 音视频剪辑与渲染 SDK。业务保存的是可版本化的 Project JSON；每次编辑通过原子 Transaction 提交；Preview、Player 和 Export 共同消费 Render IR。画面、声音和导出不会各自维护一套容易漂移的规则。

```text
Project JSON → Transaction → Render IR → Preview / Player / Export
                       └────── Material Runtime ──────┘
```

它适合需要把剪辑能力直接嵌入产品的团队：模板成片、在线编辑器、内容创作工具、营销素材生产和自动化视频工作流。

## 为什么选择 AelionSDK

| 产品能力       | AelionSDK 的处理方式                                                  |
| -------------- | --------------------------------------------------------------------- |
| 可持续编辑     | normalized Project、稳定 ID、revision、原子提交和有界 undo/redo       |
| 预览与导出一致 | 同一 Render IR、时间映射、Material 和音频混音语义                     |
| 浏览器原生执行 | WebCodecs、Worker、WebGL2/WebGPU、AudioWorklet、OPFS                  |
| 专业时间线     | ripple、roll、slip、slide、link/group、nested sequence、关键帧与变速  |
| 可扩展视觉系统 | Filter、Transition、Effect、Generator 共用 Material Protocol          |
| 可控的生产资源 | 背压、取消、缓存预算、decoder/GPU 仲裁和确定性释放                    |
| 可部署、可诊断 | capability probe、export preflight、稳定 diagnostic code 和 Vite 集成 |

## 核心能力

- **时间线编辑**：插入、移除、移动、裁剪、切分、替换、ripple、roll、slip、slide、链接、分组、Marker 和选择区间。
- **时间与动画**：整数微秒、有理帧率、正放/倒放/定格/曲线 TimeMap，以及 step、linear、cubic、cycle、ping-pong automation。
- **画面合成**：多轨合成、12 种 blend mode、mask/matte、文字与字幕、Generator、Adjustment、嵌套 Sequence 和显式背景。
- **音频引擎**：AudioWorklet 主时钟、sample-accurate automation、mute/solo、声道矩阵、ducking、waveform、LUFS、true peak 和 limiter。
- **媒体管线**：MP4/WebM SampleIndex、exact seek、VideoFrame/PCM decode、代理选择、分段索引、内容寻址缓存和页面级资源仲裁。
- **多格式导出**：WebM、MP4、PNG/JPEG/WebP、GIF、WAV/RF64，以及 Worker、Remote、checkpoint、Writable/OPFS Sink。
- **Material 生态**：声明式 Graph、typed Authoring SDK、Composition、Catalog、迁移、签名/信任/吊销和 Material Lab。

完整边界和高级功能见[能力全景](docs/capabilities.md)。

## 快速体验

> 当前版本为 `0.1.0-alpha.0`，公开包尚未发布到 npm。下面的包安装命令代表发布后的接入方式；现在请 clone 仓库运行源码。

```bash
pnpm add @aelion/sdk @aelion/export
pnpm add -D @aelion/vite-plugin
```

```ts
// vite.config.ts
import { aelion } from '@aelion/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [aelion()] });
```

```ts
import { Aelion, ByteMediaProvider } from '@aelion/sdk';

const media = new ByteMediaProvider({
  maxCachedBytes: 64 * 1024 * 1024,
  resolveAssetBytes: async (assetId, signal) => {
    const response = await fetch(`/media/${assetId}`, { signal });
    if (!response.ok) throw new Error(`Media fetch failed: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  },
});

const session = await Aelion.createSession({
  media,
  preferredBackend: 'webgl2',
  allowBackendFallback: true,
});

try {
  const project = await fetch('/project.json').then(response => response.json());
  await session.loadProject(project);

  session.transaction.commands.moveItem({
    itemId: 'item_closing',
    startUs: 28_500_000,
  });

  const frame = await session.preview.renderFrame({ timeUs: 30_000_000 });
  try {
    document
      .querySelector<HTMLCanvasElement>('#preview')
      ?.getContext('2d')
      ?.drawImage(frame.bitmap, 0, 0);
  } finally {
    frame.bitmap.close();
  }
} finally {
  await session.dispose();
  media.clear();
}
```

完整的媒体绑定、Player、Export、取消和部署示例见[快速开始](docs/getting-started.md)。

## 当前状态

Production Core 已进入源码树，并由单元、契约、Schema、Chromium、Firefox、Golden、真实 tarball consumer 和性能证据持续验证。当前 GitHub CI 覆盖 `quality`、`browser-smoke` 与 `firefox-smoke`。

现阶段边界同样明确：

- 当前是 Alpha 源码里程碑，不代表 npm、Tag 或 GitHub Release 已发布；
- 桌面 Chromium 和 Firefox 是现有自动化验证范围；Safari、iOS、Android 仍未认证；
- 默认本地画面路径是 RGBA8 SDR；HDR、PQ/HLG 和 10-bit 会 fail closed；
- 4K 有离线探测证据，但没有跨设备的 4K30 实时承诺；
- 第三方 Shader/WASM 即使已签名，也必须经过宿主 execution policy 授权。

查看[兼容性与部署边界](docs/compatibility.md)和[项目状态与证据](docs/status.md)。

## 包

大多数应用只需要从 `@aelion/sdk` 开始。高级集成可以按边界选择独立包。

| Package                     | 作用                                                   |
| --------------------------- | ------------------------------------------------------ |
| `@aelion/sdk`               | Session、Transaction、Player、Preview、Export 统一入口 |
| `@aelion/project-schema`    | Project 类型、校验与 canonical JSON                    |
| `@aelion/transaction`       | 原子 operation、剪辑命令和 history                     |
| `@aelion/media`             | demux、seek、decode、cache、proxy 和资源治理           |
| `@aelion/render-ir`         | Project 到共享执行语义的编译与求值                     |
| `@aelion/renderer-worker`   | Worker GPU compositor 和 frame renderer                |
| `@aelion/audio`             | PCM mixer、AudioWorklet、处理、分析和设备状态          |
| `@aelion/export`            | 多 Profile、Worker/Remote export、checkpoint 和 Sink   |
| `@aelion/material-sdk`      | Material Authoring、信任、迁移、Catalog 和 Lab         |
| `@aelion/material-compiler` | Material Graph 校验与编译                              |
| `@aelion/capability`        | 运行环境与配置能力探测                                 |
| `@aelion/core`              | 时间、诊断和生命周期基础类型                           |
| `@aelion/vite-plugin`       | Worker 与 AudioWorklet 的官方 Vite 集成                |

## 本地开发

需要 Node.js `>=20.19 <21` 和 Corepack：

```bash
git clone https://github.com/FoyonaCZY/AelionSDK.git
cd AelionSDK
corepack pnpm install --frozen-lockfile
corepack pnpm run ci
corepack pnpm test:browser
corepack pnpm test:browser:firefox
```

更多命令和提交要求见[开发与发布](docs/development.md)和[贡献指南](CONTRIBUTING.md)。

## 开源

AelionSDK 使用 [MIT License](LICENSE)。第三方组件和测试素材许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。问题和功能建议请提交到 [GitHub Issues](https://github.com/FoyonaCZY/AelionSDK/issues)；安全问题请按 [Security Policy](SECURITY.md) 私下报告。
