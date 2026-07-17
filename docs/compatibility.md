# 兼容性与部署

AelionSDK 的“可用”由浏览器、操作系统、codec、GPU、存储、页面隔离和具体 Project 共同决定。浏览器名称只能描述测试范围，不能替代运行时探测。

## 支持状态

| 状态        | 含义                                                 |
| ----------- | ---------------------------------------------------- |
| Tested      | 固定自动化场景在仓库当前版本通过                     |
| Degraded    | 语义保持，但 backend、性能或功能显式下降             |
| Unsupported | capability/preflight 已明确拒绝                      |
| Uncertified | 没有足够的目标环境证据；既不声明支持，也不声明不可用 |

每个 Session 调用 `probeCapabilities()`，每个 Export 调用 profile `preflight()`。不要依赖 UA 判断。

## 当前浏览器范围

| 环境                       | 当前结论                                            | 主要路径                                                         |
| -------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| Desktop Chromium           | 源码 CI 与本地 browser suite 持续通过               | WebGL2 默认；WebGPU 按 capability；WebCodecs、AudioWorklet、OPFS |
| Desktop Firefox            | macOS CI browser suite 与 tarball consumer 持续通过 | WebGL2；WebGPU 依设备；OPFS；不依赖 File System Access picker    |
| Desktop Safari             | Uncertified                                         | 需要真实 Safari 自动化、codec、GPU、AudioContext 和存储证据      |
| iOS / iPadOS Safari        | Uncertified                                         | 需要真机前后台、内存、音频 interruption 和导出验证               |
| Android Chromium / WebView | Uncertified                                         | 需要真机 codec、GPU、存储、内存和后台策略验证                    |

Windows、Linux 和新的 GPU/driver 组合没有独立产品认证。GitHub 的 Chromium Linux smoke 是源码回归证据，不等于对全部 Linux 桌面发行版作兼容承诺。

## 能力矩阵

| 能力                    | Chromium            | Firefox             | 运行规则                                     |
| ----------------------- | ------------------- | ------------------- | -------------------------------------------- |
| Project/Transaction     | Tested              | Tested              | 纯语义测试与浏览器集成都需通过               |
| Worker + WebGL2 Preview | Tested              | Tested              | context lost 可恢复；queue 和资源有界        |
| WebGPU Material         | Capability-selected | Capability-selected | 不可用时按策略回退 WebGL2 或拒绝             |
| AudioWorklet Player     | Tested              | Tested              | 用户手势、采样率和 interruption 仍由环境决定 |
| SharedArrayBuffer PCM   | 需要 COOP/COEP      | 需要 COOP/COEP      | 无隔离时使用有界 Transferable fallback       |
| MP4/H.264/AAC 输入      | Capability-selected | Capability-selected | 以实际 demux/decode probe 为准               |
| WebM/VP9/Opus 输入      | Tested fixtures     | Tested fixtures     | 具体 profile 仍需 probe                      |
| WebM/VP9/Opus 导出      | Tested              | Tested              | Worker/inline 由能力决定                     |
| MP4/H.264/AAC 导出      | Capability-selected | Capability-selected | 必须通过 AAC runtime canary；不静默换格式    |
| PNG/JPEG/WebP/GIF       | Capability-selected | Capability-selected | Canvas/ImageEncoder 不满足时拒绝             |
| WAV/RF64                | Tested core         | Tested core         | 大输出使用流式 Sink                          |
| OPFS Sink               | Capability-selected | Capability-selected | quota 和持久化策略由浏览器决定               |
| File System Access      | Capability-selected | 通常不可用          | Firefox 使用 OPFS 或自定义 Sink              |
| SDR / P3 working space  | RGBA8 SDR 执行      | RGBA8 SDR 执行      | surface presentation 由浏览器决定            |
| PQ/HLG/10-bit HDR       | Unsupported         | Unsupported         | contract 可校验，执行路径 fail closed        |

仓库内的媒体兼容语料不是只测扩展名：MP4 覆盖 moov 在头/尾、fragmented、H.264 B-frame 和非零 PTS；WebM 覆盖 VP9/Opus VFR 与多 cluster。Node 侧验证 SampleIndex/PTS/decode order，浏览器侧对每个 fixture 做 WebCodecs exact seek 和 PCM decode。随机、截断和损坏输入必须返回有界 diagnostic，不能泄漏未归类异常。

## 部署要求

### HTTPS 与跨源隔离

生产环境必须使用 secure context。推荐响应头：

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

启用后应确认 `window.crossOriginIsolated === true`。所有跨源脚本、字体、图片和媒体都必须与 COEP 策略兼容。

### 媒体 CDN

大媒体应支持：

```http
Access-Control-Allow-Origin: https://your-editor.example
Accept-Ranges: bytes
Content-Range: bytes 0-1048575/73400320
```

不要把 opaque response 当作可随机访问媒体。CDN、签名 URL 和 Service Worker 必须保留 Range 语义以及稳定的 asset identity。

### CSP 与 runtime assets

Vite 插件会发布 Worker 和 AudioWorklet `.js`。CSP 至少需要允许产品实际使用的同源 script/worker 资源；不要为了方便开放任意远程代码执行。

### Autoplay、存储与退出

- 在用户手势中调用 `player.play()` 或恢复 AudioContext。
- OPFS 和 quota 由浏览器管理，业务仍需处理空间不足和 eviction。
- 页面隐藏、路由切换和设备变化时暂停或释放不再需要的 Session。
- 取消导出时清理 partial output；成功文件由宿主决定保留或删除。

## 质量边界

- 4K 只存在离线 compositor probe，不承诺跨设备实时 4K30。
- 1080p30 数据是固定环境基线，不是所有设备的最低 SLA。
- HDR、移动端和 Safari 不应从其他浏览器结果推断。
- trusted Shader/WASM 的平台可执行性不等于安全授权。
- npm publish、provenance、Tag 和 Release 状态与源码兼容性是两件事。

当前验证记录见[项目状态](status.md)和 [`reports/baseline`](../reports/baseline/README.md)。
