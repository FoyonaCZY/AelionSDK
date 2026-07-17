---
title: 安装与工程配置
description: 安装 AelionSDK、配置 Vite、浏览器类型和跨源隔离。
---

## 当前获取方式

AelionSDK 当前版本为 `0.1.0-alpha.0`，公开包尚未发布到 npm。现阶段请 clone 仓库，以 workspace 方式开发和验证：

```bash
git clone https://github.com/FoyonaCZY/AelionSDK.git
cd AelionSDK
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm run build
```

仓库要求 Node.js `>=20.19 <21`，并通过 `packageManager` 固定 pnpm。不要在同一工作区混用 npm、yarn 和 pnpm 锁文件。

发布后，推荐的最小安装组合将是：

```bash
pnpm add @aelion/sdk @aelion/export
pnpm add -D @aelion/vite-plugin
```

`@aelion/sdk` 是应用层入口；`@aelion/export` 提供 Memory/OPFS Sink；`@aelion/vite-plugin` 负责 Worker 和 AudioWorklet 构建。其他底层包只在需要自定义引擎层时安装。

## TypeScript 配置

SDK 面向现代浏览器和 ESM。应用应包含 DOM 类型，并使用能够理解 package exports 的模块解析：

```json title="tsconfig.json"
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "verbatimModuleSyntax": true
  }
}
```

不要从 `@aelion/*/src` 或 `dist` 深层路径导入。公开契约只包括每个包 `exports` 暴露的入口。

## Vite 配置

```ts title="vite.config.ts"
import { aelion } from '@aelion/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [aelion()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  },
});
```

插件默认同时处理 renderer Worker 和两个 AudioWorklet。仅在明确不使用某个运行时时关闭：

```ts
aelion({ rendererWorker: true, audioWorklets: false });
```

## 生产响应头

SharedArrayBuffer 音频通道要求页面处于 cross-origin isolated 环境：

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

所有跨源脚本、字体和媒体也必须满足 CORP 或 CORS。若无法启用隔离，播放器会使用 transferable queue 回退通道；这能运行，但延迟和抖动余量较小。

## 验证安装

```ts
import { Aelion } from '@aelion/sdk';

const session = await Aelion.createSession();
const capability = await session.probeCapabilities();
console.table(capability);
await session.dispose();
```

然后运行生产构建，而不只测试开发服务器：

```bash
pnpm vite build
```

如果出现 Worker、AudioWorklet、MIME、CORS 或跨源隔离问题，查看[故障排查](../production/troubleshooting.md)。
