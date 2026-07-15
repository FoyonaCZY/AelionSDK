# AelionSDK

AelionSDK 是一个 Browser-first 的实时音视频剪辑、预览、合成与导出 SDK。上层用可版本化 Project JSON 保存工程，用原子 Transaction 做实时编辑，用同一 Render IR 驱动 Preview、AudioWorklet Player 和流式 Export；滤镜、转场、特效与生成器通过 Aelion Material Protocol 扩展。

> 当前版本：`0.1.0-alpha.0`。Phase 1 的浏览器端实时剪辑闭环已经完成：Node/Vitest 208/208、Chromium 59/59、Firefox 54/54、Golden 1/1、13 个真实 tarball consumer 与 60 秒有声 WebM 导出/独立回读均已通过。桌面 Chromium Tier A 与 Firefox Tier B 是当前 Alpha 认证范围；Safari、iOS 和 Android **未认证**。本仓库已具备首个源码里程碑的开源发布条件，但尚未向 npm 发布任何包。

## 已有能力

- Project v1 Schema、normalized entities、整数微秒/有理帧率、canonical JSON；
- 原子 Transaction、revision conflict、inverse、bounded undo/redo、最小 affected ranges；
- insert/remove/move/trim/split/replace Item，Track reorder/lock/enabled/mute；
- MP4/H.264/AAC 与 WebM/VP9/Opus 的 SampleIndex、exact seek、VideoFrame 和 PCM decode；
- Worker WebGL2/WebGPU Material 合成，多视觉轨道按 Project 顺序做 premultiplied alpha-over；
- AudioWorklet 主时钟、视频追随、有界 SharedArrayBuffer/Transferable PCM；
- frozen Render IR 的 WebM/VP9/Opus 流式导出、Writable/OPFS Sink、背压与清理；
- Material Definition/Graph compiler、typed Authoring SDK、确定性 `.aelionmat`、SHA-256 integrity、精确 Registry 和 trusted-code 默认拒绝；
- `@aelion/sdk` Session facade：load/edit/undo/redo/player/preview/export/capability/diagnostic/state；
- 13 个 MIT 许可的公开包；`@aelion/vite-plugin` 是公开、版本化的 Vite Worker/AudioWorklet 资源适配器。

明确不在本 Alpha 认证范围：Safari/移动端、MP4 统一输出、非 `normal` blend mode、完整文字/字幕、mask/matte、ripple/roll/slip/slide、Track solo、长视频/4K/HDR，以及任意第三方 Shader/WASM 自动执行。

`ByteMediaProvider` 是短媒体 convenience provider：它完整读取 bytes，以有界 LRU、默认 4 路 load/index/decode 全局并发、64 个底层等待操作和 68 个公开调用全生命周期硬上限执行，并对同 asset bytes/SampleIndex 做可引用计数、可取消的 single-flight；按媒体类型使用零基 `streamIndex` 精确选择视频/音频流，请求不存在的流会稳定拒绝。大文件/CDN 仍应实现 range-backed `AelionMediaProvider`。

## Quick Start

> `@aelion/*` 尚未发布到 npm。以下命令是发布后的安装方式；当前请先 clone 本仓库，并按“安装与本地验证”运行源码工程。

```bash
pnpm add @aelion/sdk @aelion/export
pnpm add -D @aelion/vite-plugin
```

```ts
// vite.config.ts
import { aelion } from '@aelion/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [aelion()],
});
```

官方 Vite 插件会在开发和生产构建中自动处理 Aelion 的 module Worker 与 AudioWorklet 发布资源；应用无需引用包内 `dist` 路径或仓库源码。

```ts
import { Aelion, ByteMediaProvider } from '@aelion/sdk';

const media = new ByteMediaProvider({
  maxCachedBytes: 64 * 1024 * 1024,
  maxConcurrentOperations: 4,
  maxPendingOperations: 64,
  resolveAssetBytes: async (assetId, signal) => {
    const response = await fetch(`/media/${assetId}`, { signal });
    if (!response.ok) throw new Error(`Media fetch failed: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  },
});

const session = await Aelion.createSession({
  media,
  preferredBackend: 'webgl2',
});
const canvas = document.querySelector<HTMLCanvasElement>('#preview');
if (canvas === null) throw new Error('Preview canvas is unavailable');

try {
  const project = await fetch('/project.json').then(response => response.json());
  await session.loadProject(project);

  session.transaction.commands.moveItem({
    itemId: 'item_closing',
    startUs: 28_500_000,
  });
  session.transaction.undo();
  session.transaction.redo();

  const frame = await session.preview.renderFrame({ timeUs: 30_000_000 });
  try {
    canvas.getContext('2d')?.drawImage(frame.bitmap, 0, 0);
  } finally {
    frame.bitmap.close();
  }
} finally {
  await session.dispose();
  media.clear();
}
```

生产页面推荐使用 HTTPS + COOP/COEP，媒体 CDN 需配置 CORS/Range。完整代码、Player、Material 和 Export 示例见 [Alpha Quick Start](docs/guides/alpha-quick-start.md)。

## 安装与本地验证

要求 Node.js `>=20.19` 与 Corepack：

```bash
git clone https://github.com/FoyonaCZY/AelionSDK.git
cd AelionSDK
corepack pnpm install --frozen-lockfile
corepack pnpm run ci
corepack pnpm test:browser
corepack pnpm test:browser:firefox
corepack pnpm test:golden
corepack pnpm bench
corepack pnpm test:pack
corepack pnpm test:consumer
corepack pnpm dev:lab
```

`test:consumer` 属于 Phase 1 最终门禁，必须在真实 `.tgz` 上返回 0 并保存结论，不能用 `test:pack` 替代。它从 consumer 自己安装的 `@aelion/vite-plugin` 与 Vite tarball做 production build，不注入仓库私有 transform。浏览器测试会启动本机 Chrome/Firefox。Capability Lab 与 SharedArrayBuffer 快速路径需要安全上下文和跨源隔离响应头。

仓库内五类 CC0 媒体 fixture 保证核心测试不依赖本机 FFmpeg 生成输入；正式 evidence 使用独立 demux/decode，并在可用时用系统 FFmpeg 做进程外回读。

## 包结构

推荐接入 `@aelion/sdk`。高级调用方可以按边界安装：

| Package                     | 用途                                                    |
| --------------------------- | ------------------------------------------------------- |
| `@aelion/sdk`               | Session、Player、Preview/Export、MediaProvider 统一门面 |
| `@aelion/core`              | 时间、诊断、生命周期基础类型                            |
| `@aelion/project-schema`    | Project 类型、validator、canonical JSON                 |
| `@aelion/transaction`       | operation、语义命令、history                            |
| `@aelion/media`             | Range、SampleIndex、seek/decode                         |
| `@aelion/render-ir`         | Project → 共享执行语义                                  |
| `@aelion/renderer-worker`   | Worker GPU compositor/frame renderer                    |
| `@aelion/audio`             | PCM mixer、AudioWorklet clock、video scheduler          |
| `@aelion/export`            | WebM export、Memory/OPFS Sink                           |
| `@aelion/capability`        | 配置级 capability report                                |
| `@aelion/material-compiler` | Core Node Graph 校验/编译                               |
| `@aelion/material-sdk`      | Material authoring、pack、integrity、Registry           |
| `@aelion/vite-plugin`       | 官方 Vite Worker/AudioWorklet 资源集成                  |

发布前 `test:pack` 会生成真实 `.tgz`、安装到干净 consumer，检查全部公开入口、LICENSE/README、依赖重写和 Worker/AudioWorklet `.js` 资源。`test:consumer` 还必须从这些 tarball 启动实际浏览器链路。

项目仓库为 [FoyonaCZY/AelionSDK](https://github.com/FoyonaCZY/AelionSDK)。`publishConfig.provenance: true` 只是发布配置；只有受信发布 CI 成功后才能宣称 npm provenance 已生成。

## 兼容性与协议

- [Alpha 兼容性矩阵](docs/compatibility/phase-1-alpha-matrix.md)
- [Alpha Quick Start](docs/guides/alpha-quick-start.md)
- [浏览器部署与 COOP/COEP](docs/guides/browser-deployment.md)
- [MediaProvider 契约](docs/guides/media-provider.md)
- [AbortSignal 与资源所有权](docs/guides/resource-lifecycle.md)
- [Diagnostic Codes](docs/reference/diagnostic-codes.md)
- [版本与 Breaking Change Policy](docs/versioning-and-breaking-changes.md)
- [Project v1 完整示例](examples/aelion-project-v1.example.json)
- [60 秒 Alpha fixture](examples/aelion-alpha-60s.project.json)
- [Project 示例说明](examples/README.md)
- [Aelion Material Protocol v1](docs/Aelion-Material-Protocol-v1.md)
- [Material Authoring Guide](docs/guides/material-authoring.md)

## 项目状态与证据

- [Phase 1 Goal（阶段成果）](docs/GOAL-PHASE-1.md)
- [Phase 1 Evidence Index](docs/evidence/phase-1-index.md)
- [Phase 1 Exit Review](docs/decisions/phase-1-exit.md)
- [Phase 1 Backlog](docs/phase-1-backlog.md)
- [Phase 0 Exit Review（Accepted）](docs/decisions/phase-0-exit.md)
- [Architecture Decision Records](docs/adr/README.md)
- [技术设计 v0.1](docs/AelionSDK-Technical-Design-v0.1.md)
- [开发流程](docs/AelionSDK-Development-Workflow.md)

2026-07-14 的实现冻结门禁曾在同一源码窗口完成 14/14；MIT 许可证与 GitHub metadata 随后作为开源发布整理加入，因此该历史 source hash 不等于首个 Git commit。2026-07-15 的开源输入另行通过 CI、Chromium/Firefox 源码测试、Golden、benchmark、真实 tgz consumer、13 包 release dry-run 和 format check；Firefox evidence、seek 与 60 秒 Alpha 在聚合长跑中出现瞬时失败后，独立重跑均通过。最终 WebM 包含 1,800 个视频帧和 2,880,000 个音频帧，A/V 尾差 333 μs，并通过 FFmpeg 独立回读。精确证据边界见 [Evidence Index](docs/evidence/phase-1-index.md)。

这些结果表示源码工程和发布候选已就绪，不代表 npm 包、Tag 或 GitHub Release 已经发布。

## 开源与贡献

代码使用 [MIT License](LICENSE)，第三方组件和测试素材许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。参与项目请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md)、[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 和 [CHANGELOG.md](CHANGELOG.md)。问题与功能建议请提交到 [GitHub Issues](https://github.com/FoyonaCZY/AelionSDK/issues)，安全问题请按 [Security Policy](SECURITY.md) 私下报告。
