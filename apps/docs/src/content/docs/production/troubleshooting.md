---
title: 按现象排查问题
description: 定位素材导入、预览、拖动、播放、音画同步、导出、OPFS 和资源泄漏。
---

先收集可比较的信息，再改配置：SDK 版本、浏览器/OS、capability report、Project 画布和帧率、素材 probe、Diagnostic code，以及能稳定复现的最短步骤。

## 选择文件后，`probe()` 失败

按顺序检查：

1. `registerFile()` / `registerUrl()` 使用的 assetId 和 `probe()` 是否完全相同；
2. 文件不是 0 字节，扩展名和实际容器一致；
3. 是否为当前支持的 MP4/H.264/AAC 或 WebM/VP9/Opus 路径；
4. URL 是否允许 CORS 和 Range；
5. `session.getDiagnostics()` 或捕获的 `AelionError` code；
6. 用 `apps/quickstart` 打开同一素材，区分业务接入和素材问题。

不要只根据 `.mp4` 判断。MP4 是容器，里面的 codec 仍可能不受支持。

## Project 加载成功，但 Canvas 黑屏

1. 检查 `session.state === 'ready'`；
2. 查看 `session.getSnapshot().renderIr?.durationUs` 是否大于 0；
3. Project Asset ID 是否都已在 Provider 注册；
4. `await preview.render(0)` 是否抛错；
5. Canvas CSS 尺寸和 `preview.snapshot().canvasWidth/Height` 是否大于 0；
6. Renderer Worker 请求是否 404 或 MIME 错误；
7. capability 中 WebGL2/WebGPU 状态；
8. 时间 0 是否本来就是空白，可尝试片段中间时间。

```ts
console.log(session.getSnapshot());
console.log(preview.snapshot());
console.log(session.getDiagnostics());
```

## 拖动播放头越来越卡

检查：

- 是否使用 `PreviewCanvasController`，而不是自己把每次请求排进 Promise 队列；
- pointermove 是否合并到 requestAnimationFrame；
- 是否同时生成整条时间线缩略图；
- 4K 原片是否有 proxy；
- Preview 是否为 adaptive/draft；
- `media.snapshot().pendingOperations` 和 `session.getStats().preview.pendingFrames`；
- 自己取得的 ImageBitmap/VideoFrame 是否 close。

快速拖动时 `cancelledFrames` 很高是正常现象。Pending 一直增长、停止拖动后仍不回落才是问题。

## 播放按钮无效或没有声音

1. `player.play()` 是否直接在用户 click/keydown 中调用；
2. Promise 是否被捕获并显示；
3. 素材 probe 是否包含 audio track；
4. audio 轨是否 muted，是否有其他 solo 轨；
5. `player.getStats().resources.audio.contextState`；
6. AudioWorklet 文件是否 404/MIME 错误；
7. `resources.audio.mode` 是 shared-ring 还是 transferable-queue；
8. 是否在页面隐藏或浏览器音频 interruption 后没有再次恢复。

无跨源隔离时应该回退到 transferable queue，而不是完全无声；如果 mode 是 none 且素材有音频，继续看 diagnostic。

## 音画不同步

- 导入有声视频后是否使用 Link Group；
- 移动/切分是否调用 group-aware 命令；
- sourceStartUs 和 proxy sourceStartUs 是否一致；
- Proxy 时长是否与原片对齐；
- 素材是否有非零 PTS、VFR 或 B-frame 诊断；
- seek 后是否仍显示旧 generation 的自定义帧；
- 导出的成片是否也不同步。

如果导出正确而实时播放错，重点查 Player 调度和音频；如果导出也错，重点查 Project source range、TimeMap 和素材时间戳。

## H.264 导出不可用

先打印 preflight issues：

```ts
const report = await session.export.preflightProfile(options);
console.table(report.issues);
```

常见原因：浏览器没有 VideoEncoder/AudioEncoder、当前尺寸/帧率的 H.264 不支持、AAC canary 失败、Sink 已 locked、Material 没有离线 backend，或当前颜色模式不支持。

不要静默改成 WebM。让用户选择：WebM、较低规格或 Remote Export。

## Job 失败或文件是 0 字节

- 只有 Job completed 后才调用 `finalize()` / `getFile()`；
- Memory Sink 必须等 writer close；
- OPFS 先 `waitUntilFinalized()`；
- 每次重试创建新的 Sink；
- 查看 quota、权限和 cleanup 日志；
- 导出期间 original Asset 仍然可访问；
- 不要在 Job 运行中 dispose Session 或 Provider；
- 失败后不要把半成品当结果下载。

```ts
console.log(job.getSnapshot());
console.log(session.getStats().export);
```

## 远端素材能播放开头，但不能 seek

在 Network 面板确认请求有：

```http
Range: bytes=...
```

响应应为 206 并带正确 Content-Range。常见问题是 CDN 忽略 Range、授权只允许普通 GET、Service Worker 把响应改成 200，或 CORS 没有允许编辑器 origin。

## 生产部署后 Worker / Worklet 404

- 确认使用 `@aelion/vite-plugin`；
- 构建产物中是否有对应资源；
- Vite `base` 和 CDN public path 是否正确；
- HTML 和静态资源是否来自不同版本缓存；
- CSP 的 worker-src/script-src；
- 服务器是否把 `.js` 返回成 `text/html` 错误页。

不要用关闭 CSP 或改成任意跨域脚本作为永久修复。

## 切换工程后内存没有回落

确认顺序：

```ts
preview.dispose();
await session.dispose();
media.dispose();
```

同时取消缩略图、波形、导出和上传任务，移除 Session/DOM 订阅、interval 和 Blob URL。查看 Player `lastDisposedRuntime`、Preview `lastDisposedRenderer` 和 Provider `disposed`。

GC 不保证立刻回落到完全相同数值，重点看多轮打开/关闭后是否持续阶梯增长。

## 提交 Bug 时附带什么

- 去除 token/敏感 locator 后的最小 Project；
- 可公开的最小媒体，或至少提供容器、codec、时长和 probe；
- capability report（先检查 userAgent 等隐私字段）；
- Diagnostic code/details，不只发截图；
- 明确的期望结果和实际结果；
- 是否能在 Quickstart 或参考编辑器复现；
- 开发构建与生产构建是否不同。

完整错误码见 [Diagnostic Codes](/AelionSDK/reference/diagnostic-codes/)。
