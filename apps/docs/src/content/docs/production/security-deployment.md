---
title: 上线前安全检查
description: 配置 HTTPS、CSP、COOP/COEP、媒体授权、Project 输入限制、Material 信任和本地文件清理。
---

浏览器剪辑器会同时接触用户文件、远端媒体、Worker、GPU、持久存储和大 JSON。SDK 会校验工程和资源预算，但部署、鉴权、日志和数据保留仍由产品负责。

## 1. HTTPS 和隔离响应头

生产页面使用 HTTPS，并配置：

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

部署后在最终页面验证：

```ts
console.table({
  secureContext: window.isSecureContext,
  crossOriginIsolated: window.crossOriginIsolated,
});
```

登录跳转、CDN 缓存、404 页面和 Service Worker 都可能漏掉头部。还要确认所有第三方字体、图片、脚本和媒体满足 CORS/CORP，否则启用 COEP 后会被浏览器拦截。

## 2. 收紧 CSP

可以从下面开始，再按实际资源调整：

```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  worker-src 'self' blob:;
  connect-src 'self' https://media.example.com;
  img-src 'self' blob: data:;
  media-src 'self' blob: https://media.example.com;
  object-src 'none';
  base-uri 'none';
  frame-ancestors 'none';
```

如果构建产物不使用 blob worker，可以去掉 `blob:`。不要为了第三方 Material 或临时排错开放任意远程 script、`unsafe-eval` 或过宽的 connect-src。

## 3. 素材授权

- Project 只保存稳定 Asset key，不保存 token；
- 签名 URL 短期有效，并绑定用户、资源和 HTTP 方法；
- Range 请求也必须鉴权；
- Service Worker 不能把带凭据的响应错误共享给另一用户；
- contentHash 用于内容身份和缓存，不代表访问许可；
- 日志删除 URL query token 和 Authorization。

服务端 Remote Export 重新检查 Project 中每个 Asset 的权限。客户端能读到素材，不等于服务端可以直接信任 locator。

## 4. 把 Project 当作不可信输入

从服务端、分享链接或用户文件读到的 JSON 都以 `unknown` 传给 `loadProject()`：

```ts
const project: unknown = JSON.parse(text);
await session.loadProject(project);
```

不要先 `as AelionProject` 后直接访问深层字段。SDK admission 会在 Schema 前限制对象深度、节点总数、数组长度、属性数和字符串体积，也会拒绝循环、accessor 和非标准数字。

这些检查保护当前浏览器进程；服务端渲染仍要独立执行同样的输入和语义校验。

## 5. Material 不只是“签名正确就能执行”

声明式 Core Graph 在 Schema、类型、拓扑和预算通过后可以执行。自定义 Shader/WASM 还需要同时满足：

- package integrity 和签名有效；
- publisher 在 allowlist 中且未被吊销；
- 宿主策略明确允许 shader/wasm/network；
- 运行预算允许当前 node、pass、纹理、内存和时间；
- 版本和 migration 链可验证。

文件来自自家 CDN 也不等于天然可信。签名回答“谁发布了这些字节”，执行策略回答“当前租户和设备是否允许运行”。

## 6. OPFS、Blob URL 和本地数据

- 用户输入文件名时只取 leaf name，拒绝路径片段；
- 取消或失败后删除半成品；
- 定期清理过期缓存和孤儿任务；
- 处理 quota、eviction 和隐私模式；
- Blob URL 用完立即 `URL.revokeObjectURL()`；
- 公共设备不长期保存敏感原片；
- 产品提供“删除项目和本地缓存”入口。

OPFS 在当前 origin 下，换域名或清站点数据都会失去访问。它不是云端备份。

## 7. 依赖和发布供应链

- 提交并锁定 `pnpm-lock.yaml`；
- CI 使用 `--frozen-lockfile`；
- 业务只从 package exports 导入；
- 审阅新增 Worker、WASM、codec 和原生依赖；
- 正式发布后验证 npm provenance、tag 和包内容；
- 定期运行 Project/媒体 fuzz、安全语料和 Material trust 测试。

## 上线验收表

- [ ] 最终生产域名是 HTTPS，`isSecureContext` 为 true；
- [ ] `crossOriginIsolated` 为 true，且第三方资源没有被 COEP 拦截；
- [ ] Renderer Worker 和 AudioWorklet 在生产构建中返回正确 MIME；
- [ ] CSP 没有多余远程执行权限；
- [ ] 媒体 CDN 的 Range、CORS 和 token 刷新通过；
- [ ] 外部 Project、损坏媒体和异常大输入能被安全拒绝；
- [ ] 未授权或被吊销的 Material 不能执行；
- [ ] 导出取消、编码失败和 quota 失败都不会留下半成品；
- [ ] 日志不含 Project 内容、素材名、token 和签名 URL；
- [ ] 自动保存、工程恢复和缺失素材重连演练通过；
- [ ] SDK、服务端引擎、Project Schema 和 Material 版本可追踪。

部署兼容信息见[浏览器兼容性与部署要求](/AelionSDK/production/compatibility/)。
