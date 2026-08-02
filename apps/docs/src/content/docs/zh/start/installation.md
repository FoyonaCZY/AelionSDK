---
title: 安装与工程配置
description: 从 npm 安装 AelionSDK 1.1 Release Candidate，启动 Quickstart，并配置自己的 Vite 应用。
---

AelionSDK 的 1.1 Release Candidate 通过 npm `next` tag 分发。普通应用至少安装 SDK；需要直接
使用导出 Sink/Profile 时安装导出包；Vite 应用同时安装官方插件：

```bash
npm install @aelionsdk/sdk@next @aelionsdk/export@next
npm install --save-dev @aelionsdk/vite-plugin@next vite
```

使用 pnpm 或 yarn 时保持相同的包名与 `next` tag。不要导入源码目录或复制仓库内
构建产物。

## 环境要求

- Node.js `>=24 <25`；仓库的 `.node-version` 和 `.nvmrc` 固定为 `24.15.0`；
- Corepack；
- pnpm `10.13.1`，版本已经写在根目录 `packageManager` 中；
- 支持 WebCodecs、WebGL2 和 AudioWorklet 的桌面浏览器。

先确认版本：

```bash
node --version
corepack pnpm --version
```

Node.js 25 或更高版本不在当前仓库的验证范围内。复现 CI 时优先使用仓库固定的
`24.15.0`；其他满足 engines 的 Node 24 版本属于兼容范围，但不等同于当前参考环境。
安装依赖时也不要改用 npm 或 yarn，否则会产生另一份锁文件。

## 运行仓库里的最小示例

```bash
git clone https://github.com/FoyonaCZY/AelionSDK.git
cd AelionSDK
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm dev:quickstart
```

终端会打印本地地址，默认是 `http://127.0.0.1:4175`。打开后选择一个 MP4 或 WebM 文件。如果能显示第一帧，说明以下几部分已经同时工作：

- workspace 包解析正确；
- Renderer Worker 和 AudioWorklet 已被 Vite 处理；
- 浏览器可以读取并探测素材；
- Canvas 预览链路可用。

如果页面能打开但选完文件没有画面，先看[故障排查](/AelionSDK/zh/production/troubleshooting/)中的“预览黑屏”。

## 在仓库中创建自己的应用

下面以 `apps/my-editor` 为例。目录必须位于 `apps/*`，这样它会被现有 workspace 自动识别。

```text
apps/my-editor/
├── package.json
├── index.html
├── vite.config.ts
└── src/
    └── main.ts
```

`package.json` 使用 workspace 版本：

```json title="apps/my-editor/package.json"
{
  "name": "@example/my-editor",
  "private": true,
  "type": "module",
  "dependencies": {
    "@aelionsdk/export": "workspace:*",
    "@aelionsdk/sdk": "workspace:*"
  },
  "devDependencies": {
    "@aelionsdk/vite-plugin": "workspace:*",
    "vite": "7.3.6"
  },
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  }
}
```

添加目录后，在仓库根目录再次运行 `corepack pnpm install`，让 pnpm 建立 workspace 链接。

## 配置 Vite

SDK 的渲染器在 Worker 中运行，播放音频还需要 AudioWorklet。`@aelionsdk/vite-plugin` 会把这些入口放进开发服务器和生产构建中。

```ts title="apps/my-editor/vite.config.ts"
import { aelion } from '@aelionsdk/vite-plugin';
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

通常不需要配置插件参数。如果你的应用明确不播放音频，可以关闭 Worklet 入口：

```ts
aelion({ rendererWorker: true, audioWorklets: false });
```

## 非 Vite / CDN 宿主

`@aelionsdk/vite-plugin` 也导出不依赖 Vite runtime 的 Webpack 5/Rspack 适配器：

```ts title="webpack.config.ts / rspack.config.ts"
import { AelionWebpackPlugin } from '@aelionsdk/vite-plugin';

export default {
  plugins: [new AelionWebpackPlugin()],
};
```

在 client-only 应用模块中使用同一稳定目录：

```ts
import { aelionRuntimeAssetUrls } from '@aelionsdk/vite-plugin';

const session = await Aelion.createSession({
  media,
  runtimeAssets: aelionRuntimeAssetUrls('/'),
});
```

Next.js 的组件边界必须显式放在客户端；其 `_next` 输出可这样配置：

```ts title="next.config.ts"
import { AelionWebpackPlugin } from '@aelionsdk/vite-plugin';

export default {
  webpack(config) {
    config.plugins.push(new AelionWebpackPlugin({ outputDirectory: 'static/aelion' }));
    return config;
  },
};
```

```ts title="app/aelion-client.ts"
'use client';

import { aelionRuntimeAssetUrls } from '@aelionsdk/vite-plugin';

export const runtimeAssets = aelionRuntimeAssetUrls('/_next/', 'static/aelion');
```

如果使用 `basePath` 或 `assetPrefix`，`publicBase` 也必须包含同一个前缀；不要在 Server
Component 或 SSR 阶段创建 Session、Worker、Canvas 或 AudioContext。

Rollup、自研 ESM loader 或纯 CDN 页面可以用
`loadAelionRuntimeAssets()` 在构建期复制四个入口，或给出版本化 CDN URL：

```ts
import { aelionRuntimeAssetUrls } from '@aelionsdk/vite-plugin';

const session = await Aelion.createSession({
  media,
  runtimeAssets: aelionRuntimeAssetUrls('https://cdn.example.com/aelionsdk/1.2.0-rc.2/'),
});
```

URL 可以是 `string` 或 `URL`，必须指向部署后真正可访问的 ESM 文件。若只设置部分
字段，未设置的入口仍使用包内 `import.meta.url` 默认值。应用 ESM、Worker 和 Worklet
必须来自同一个 SDK 版本。上线前用 Network 面板验证
四个入口的 200 响应、JavaScript MIME、CSP 与版本一致性。

## TypeScript 配置

SDK 是 ESM，并使用浏览器 API。应用的 TypeScript 配置至少应包含 DOM 类型和 Bundler 模块解析：

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

业务代码只从包名导入：

```ts
import { Aelion, ProductionMediaProvider } from '@aelionsdk/sdk';
import { OpfsSeekableSink } from '@aelionsdk/export';
```

不要导入 `@aelionsdk/sdk/src/*` 或 `dist/*`。这些路径不是公共接口，打包后的使用方式也可能不同。

## 为什么要配置跨源隔离

页面满足 COOP/COEP 后，播放器可以使用 `SharedArrayBuffer` 在主线程和 AudioWorklet 之间传输 PCM，延迟和抖动会更稳定。开发服务器只解决本地环境；上线时还要在 CDN 或 Web Server 上设置相同响应头。

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

启用后检查：

```ts
console.log(window.isSecureContext); // 生产环境应为 true
console.log(window.crossOriginIsolated); // 配置正确时为 true
```

COEP 会影响第三方字体、图片、脚本和媒体。所有跨源资源都要提供合适的 CORS 或 CORP 响应头，否则浏览器会直接拦截它们。

## 验证生产构建

开发服务器正常不代表部署产物正常。至少运行一次：

```bash
corepack pnpm --filter @example/my-editor build
```

在 `dist/assets` 中应该能看到 Renderer Worker 和 AudioWorklet 文件。部署后再用 Network 面板确认它们不是 404，MIME 类型也是 JavaScript。

## 锁定精确版本

生产集成不应长期跟随可移动的 `next` tag。验证完成后，把依赖锁定到当前 RC：

```bash
pnpm add @aelionsdk/sdk@1.2.0-rc.2 @aelionsdk/export@1.2.0-rc.2
pnpm add -D @aelionsdk/vite-plugin@1.2.0-rc.2
```

`npm install @aelionsdk/sdk` 默认读取 `latest`，在首个稳定版本发布前不会自动选中当前
RC。接下来打开[快速开始](/AelionSDK/zh/start/getting-started/)，从素材导入开始接代码。

## 验证发布身份

生产环境应锁定精确版本，并确认应用直接依赖的所有 `@aelionsdk/*` 包使用同一个
版本。下面的命令从官方 registry 读取版本、完整性和 provenance 声明，不依赖本地
锁文件：

```bash
npm install @aelionsdk/sdk@1.2.0-rc.2
npm view @aelionsdk/sdk@1.2.0-rc.2 version dist.integrity dist.attestations --json
npm view @aelionsdk/sdk dist-tags --json
```

预期精确版本为 `1.2.0-rc.2`，`next` 指向该版本，`dist.attestations` 包含来自
GitHub Actions 的 provenance。完整发布还应交叉核对：

- [Git Tag `v1.2.0-rc.2`](https://github.com/FoyonaCZY/AelionSDK/tree/v1.2.0-rc.2)；
- [发布工作流](https://github.com/FoyonaCZY/AelionSDK/actions/runs/30343884270)；
- [GitHub prerelease](https://github.com/FoyonaCZY/AelionSDK/releases/tag/v1.2.0-rc.2)。

使用多个 Aelion 包时，逐个运行 `npm view <包名>@1.2.0-rc.2 version
dist.integrity dist.attestations --json`。不要混用不同 RC，也不要把可移动的 `next`
tag 写入生产锁定策略。
