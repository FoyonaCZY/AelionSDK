---
title: 安装与工程配置
description: 在当前 alpha 阶段获取 AelionSDK，启动 Quickstart，并配置自己的 Vite 应用。
---

AelionSDK 还没有发布到 npm。现在最稳妥的接入方式是克隆仓库，在 pnpm workspace 中开发。这样使用的就是实际包入口和构建插件，不需要从源码目录做深层导入。

## 环境要求

- Node.js `20.19.x`；
- Corepack；
- pnpm `10.13.1`，版本已经写在根目录 `packageManager` 中；
- 支持 WebCodecs、WebGL2 和 AudioWorklet 的桌面浏览器。

先确认版本：

```bash
node --version
corepack pnpm --version
```

Node.js 21、22 或更高版本不在当前仓库的验证范围内。安装依赖时也不要改用 npm 或 yarn，否则会产生另一份锁文件。

## 先运行仓库里的最小示例

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

如果页面能打开但选完文件没有画面，先看[故障排查](/AelionSDK/production/troubleshooting/)中的“预览黑屏”。

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
    "@aelion/export": "workspace:*",
    "@aelion/sdk": "workspace:*"
  },
  "devDependencies": {
    "@aelion/vite-plugin": "workspace:*",
    "vite": "7.0.6"
  },
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  }
}
```

添加目录后，在仓库根目录再次运行 `corepack pnpm install`，让 pnpm 建立 workspace 链接。

## 配置 Vite

SDK 的渲染器在 Worker 中运行，播放音频还需要 AudioWorklet。`@aelion/vite-plugin` 会把这些入口放进开发服务器和生产构建中。

```ts title="apps/my-editor/vite.config.ts"
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

通常不需要配置插件参数。如果你的应用明确不播放音频，可以关闭 Worklet 入口：

```ts
aelion({ rendererWorker: true, audioWorklets: false });
```

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
import { Aelion, ProductionMediaProvider } from '@aelion/sdk';
import { OpfsSeekableSink } from '@aelion/export';
```

不要导入 `@aelion/sdk/src/*` 或 `dist/*`。这些路径不是公共接口，打包后的使用方式也可能不同。

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

## npm 发布后怎么安装

首个公开版本发布后，产品应用会使用下面的组合：

```bash
pnpm add @aelion/sdk @aelion/export
pnpm add -D @aelion/vite-plugin
```

在 npm 页面真正出现版本之前，不要把这组命令当作当前可用步骤。接下来打开[快速开始](/AelionSDK/start/getting-started/)，从素材导入开始接代码。
