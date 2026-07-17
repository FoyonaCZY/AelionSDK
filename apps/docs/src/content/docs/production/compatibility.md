---
title: 浏览器兼容性与部署要求
description: 了解当前验证范围、HTTPS、COOP/COEP、媒体 CDN、Worker/Worklet 和平台限制。
---

本页区分“仓库测试通过”和“某台真实设备一定能用”。视频编辑依赖浏览器、操作系统、GPU、codec、音频和存储，最终判断仍来自运行时 capability 和 export preflight。

## 文档中的状态是什么意思

| 状态        | 含义                                                |
| ----------- | --------------------------------------------------- |
| Tested      | 仓库固定场景在当前版本持续通过                      |
| Degraded    | 可以运行，但后端、画质或性能明确降低                |
| Unsupported | SDK 已知无法满足，会返回 capability/preflight issue |
| Uncertified | 还没有足够目标设备证据，不能承诺支持                |

Uncertified 不是“肯定不能用”。它表示在正式对客户承诺前，需要你自己完成目标设备测试。

## 当前自动化覆盖

| 环境                       | 当前结论    | 已覆盖的主要路径                                         |
| -------------------------- | ----------- | -------------------------------------------------------- |
| Desktop Chromium           | Tested      | WebGL2、按能力选择 WebGPU、WebCodecs、AudioWorklet、OPFS |
| Desktop Firefox            | Tested      | WebGL2、按设备选择 WebGPU、WebCodecs、AudioWorklet、OPFS |
| Desktop Safari             | Uncertified | 需要 Safari 真机/自动化、codec、GPU、音频和存储验证      |
| iPhone / iPad Safari       | Uncertified | 需要前后台、内存、音频 interruption、温控和导出验证      |
| Android Chromium / WebView | Uncertified | 需要实际 codec、GPU、内存、存储和后台策略验证            |

Chromium Linux CI 证明固定 smoke 可以运行，不等于所有 Linux 发行版和显卡驱动都经过产品认证。Windows 和更广 GPU 组合也需要目标环境测试。

## 主要功能的判断方式

| 功能                    | 现状                   | 上线时怎么判断                    |
| ----------------------- | ---------------------- | --------------------------------- |
| Project / Transaction   | Chromium、Firefox 已测 | 单元和浏览器集成                  |
| Worker + WebGL2 Preview | Chromium、Firefox 已测 | `probeCapabilities()` + 实际首帧  |
| WebGPU Material         | 设备相关               | capability 支持后按策略启用       |
| AudioWorklet Player     | Chromium、Firefox 已测 | 用户手势 + 实际播放               |
| SharedArrayBuffer 音频  | 需要 COOP/COEP         | `window.crossOriginIsolated`      |
| MP4/H.264/AAC 输入      | 环境相关               | 实际 probe/decode                 |
| WebM/VP9/Opus 输入      | 固定语料已测           | 具体素材仍要 probe                |
| MP4/H.264/AAC 导出      | 环境相关               | `preflightProfile()` + AAC canary |
| WebM/VP9/Opus 导出      | Chromium、Firefox 已测 | 每个 Project preflight            |
| 图片/GIF                | Canvas 能力相关        | preflight                         |
| WAV/RF64                | 核心路径已测           | 大文件使用流式 Sink               |
| OPFS                    | 环境和 quota 相关      | capability + 实际写入             |
| HDR/PQ/HLG/10-bit       | 当前不支持             | preflight 会拒绝                  |

## 生产必须使用 HTTPS

WebCodecs、OPFS、Worker 和音频相关 API 应运行在 secure context。部署后检查：

```ts
if (!window.isSecureContext) {
  throw new Error('编辑器必须运行在 HTTPS 安全上下文中');
}
```

localhost 通常被浏览器视为安全环境，但这不能替代生产 HTTPS。

## 配置 COOP/COEP

为了使用 SharedArrayBuffer 音频通道，主页面需要：

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

如果同源静态资源需要明确声明，还可以配置：

```http
Cross-Origin-Resource-Policy: same-origin
```

上线后在最终页面检查：

```ts
console.log(window.crossOriginIsolated); // 应为 true
```

仅在 CDN 控制台看到响应头不够。登录跳转、HTML 缓存、错误页和 Service Worker 都可能让最终页面缺少头部。

COEP 会拦截没有 CORS/CORP 的第三方字体、图片、脚本和媒体。启用前把所有外部资源列出来逐一验证。

## 媒体 CDN 必须支持 Range 和 CORS

理想响应示例：

```http
HTTP/1.1 206 Partial Content
Access-Control-Allow-Origin: https://editor.example.com
Accept-Ranges: bytes
Content-Range: bytes 0-1048575/73400320
Content-Type: video/mp4
```

授权要覆盖 Range 请求。CDN 和 Service Worker 不能把 206 改成全量 200，也不能返回 opaque response。签名 URL 刷新后，Asset 身份仍应保持稳定。

## Worker、AudioWorklet 和 CSP

`@aelion/vite-plugin` 会在构建产物中发布 Renderer Worker 和 AudioWorklet JavaScript。部署后用 Network 面板确认：

- URL 不为 404；
- Content-Type 是 JavaScript；
- CSP 允许加载同源 worker/script；
- base path 和 CDN public path 正确；
- 缓存升级不会让主包和 Worker 版本错配。

CSP 起点见[安全与部署清单](/AelionSDK/production/security-deployment/)。不要为了让 Worker 运行而开放任意远程 script。

## 4K、移动端和 HDR 的边界

- 4K 有离线合成探测，不承诺所有设备实时 4K30 预览；
- 1080p30 基线来自固定环境，不是所有电脑的最低 SLA；
- 移动端需要单独验证前后台、内存、温控和 AudioContext interruption；
- 当前本地画面执行为 RGBA8 SDR，HDR/PQ/HLG/10-bit 会明确失败；
- Material 的 Shader/WASM 能执行，不代表已经获得安全授权。

当前源码测试和基线报告见[项目状态](/AelionSDK/project/status/)。
