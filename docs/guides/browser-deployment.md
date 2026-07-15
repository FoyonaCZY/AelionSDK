# 浏览器部署、COOP/COEP 与媒体跨域

本指南描述 `0.1.0-alpha.0` 的推荐生产部署。Aelion 可以在未隔离页面使用有界 Transferable PCM fallback，但 Tier A/B 的参考证据使用 secure、cross-origin isolated 页面。

## 1. 顶层文档响应头

至少为编辑器 HTML 配置：

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

前两项共同使兼容浏览器中的 `globalThis.crossOriginIsolated` 为 `true`，从而启用 SharedArrayBuffer AudioWorklet ring。`Cross-Origin-Resource-Policy: same-origin` 适合编辑器自己的 HTML/JS/Worker；不要把它无条件复制到需要被其他站点使用的公共媒体 CDN。

本地 Vite 示例：

```ts
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
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  },
});
```

Nginx 示例：

```nginx
location /editor/ {
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "require-corp" always;
    add_header Cross-Origin-Resource-Policy "same-origin" always;
    try_files $uri /editor/index.html;
}
```

不要只给首页 `200` 响应加 header，而让 SPA fallback、错误页或重定向丢失 header。部署后在实际编辑器页面检查：

```js
console.table({
  secureContext: globalThis.isSecureContext,
  crossOriginIsolated: globalThis.crossOriginIsolated,
  sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
});
```

## 2. 跨源媒体与字体

在 `COEP: require-corp` 下，跨源资源必须得到资源服务器许可。对于 `fetch` 驱动的媒体 provider，推荐使用 CORS：

```http
Access-Control-Allow-Origin: https://editor.example.com
Vary: Origin
Accept-Ranges: bytes
Access-Control-Expose-Headers: Accept-Ranges, Content-Length, Content-Range, ETag
```

如果请求携带 cookie/Authorization，还需要精确 origin 和：

```http
Access-Control-Allow-Credentials: true
```

此时不能使用 `Access-Control-Allow-Origin: *`。资源也可以显式返回适合其分发模型的 `Cross-Origin-Resource-Policy: cross-origin`，但 CORP 不会自动替代业务鉴权或所有 fetch CORS 要求。

面向大媒体的 Range 服务必须满足：

- `HEAD` 或 `Range: bytes=0-0` 能确定大小；
- Range 请求返回 `206`，并给出正确 `Content-Range`；
- 不支持 Range 时明确返回完整响应，SDK 会产生 `MEDIA_RANGE_UNSUPPORTED`，接入方不能把整个长文件意外读入内存；
- CDN cache key 正确考虑 `Range`、Authorization 和内容版本；
- URL 更新但内容不变时最好有稳定 hash/ETag；Project 的业务 locator 不应充当内容完整性证明。

## 3. Worker、AudioWorklet 与 CSP

Aelion 从 npm 包内的 `new URL('./asset.js', import.meta.url)` 加载 ESM Worker/AudioWorklet。Vite 接入必须启用公开 `@aelion/vite-plugin` 的 `aelion()`；它会在开发服务器暴露三个发布资源，并在生产构建中生成 hashed chunk、重写依赖包 URL。不要手工复制 `dist`，也不要把路径重写到源 `.ts`。

一个保守的 CSP 起点：

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self' https://media.example.com; img-src 'self' blob: data:; media-src 'self' blob: https://media.example.com; font-src 'self' https://fonts.example.com; object-src 'none'; base-uri 'none'; frame-ancestors 'self'
```

按实际资源域名收紧或扩展。只有宿主明确启用 trusted WASM 时，才评估浏览器所需的 `wasm-unsafe-eval`；不要为了一个未使用的 Material 全局放开 `unsafe-eval`。Aelion 不会根据 Project URL 动态 `import()` JavaScript、Shader 或 WASM。

若应用必须使用 `blob:` worker，需显式加入 `worker-src blob:`，但当前标准包资源不依赖这一权限。

## 4. Autoplay 与 AudioContext

Session 创建和 Project 加载不会主动播放。多数浏览器要求 AudioContext 在用户手势内启动：

```ts
playButton.addEventListener('click', () => {
  void session.player.play();
});
```

把 `play()` 放在页面加载后的异步定时器中可能得到浏览器策略拒绝，这不是 capability probe 能绕过的限制。页面进入后台、输出设备切换和系统 interruption 在 Safari/移动端尚未认证。

## 5. 部署自检

上线前至少检查：

1. HTTPS、COOP/COEP 和 `crossOriginIsolated`；
2. `session.probeCapabilities()` 的 WebCodecs、WebGL2、AudioWorklet、codec 和 storage 项；
3. 真实媒体域名的 CORS、Range 和凭据行为；
4. 生产构建中的 Worker/Worklet URL 能返回 JavaScript 而非 HTML fallback；
5. CSP 没有拦截 Worker、Worklet、媒体、字体或明确授权的 WASM；
6. `session.export.preflight()` 在创建大输出前返回 `ok: true`；
7. cancel/dispose 后临时 OPFS 文件、VideoFrame/ImageBitmap 和业务 cache 被释放。
