---
title: 安全与部署清单
description: 上线前检查 HTTPS、CSP、跨源隔离、媒体授权、不可信 Project 和 Material。
---

视频编辑器同时处理用户文件、远端媒体、Worker、GPU、WASM、持久存储和大 JSON。安全边界必须由产品部署和 SDK 输入校验共同建立。

## 传输和响应头

- 全站 HTTPS；
- COOP `same-origin`；
- COEP `require-corp`；
- 对同源运行时资源设置合理 CORP；
- 所有跨源素材明确 CORS/CORP；
- 不在生产中使用通配凭据 CORS。

部署后用真实页面验证 `window.isSecureContext` 和 `window.crossOriginIsolated`，不能只检查 CDN 配置面板。

## CSP

根据实际部署收紧：

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
```

这只是起点。是否需要 `blob:` 取决于业务实现；官方 Vite 插件发布同源模块入口，不要求开放任意远端脚本。

## 媒体授权

- Project 保存稳定 asset key，不保存 token；
- 签名 URL 短期有效并绑定用户/资源/方法；
- Range 请求也要鉴权；
- Service Worker 不应把带凭据响应错误共享；
- contentHash 用于身份和缓存，不替代授权；
- 日志去除 query token 和 Authorization。

## 不可信 Project

始终把服务端、分享链接和用户导入的 Project 当作 `unknown` 交给 `loadProject()`。Admission 层在 Schema 前限制深度、值数量、数组/对象规模、字符串总量，并拒绝 accessor、循环、非 canonical number 等结构。

服务端 Remote Export 必须重新校验，不能信任“浏览器已经验证过”。

## Material 信任

声明式 Core Graph 可以在预算内执行。Trusted Shader/WASM 需要同时满足：

- 包完整性和签名有效；
- publisher 在 allowlist 且未吊销；
- 宿主显式授权 shader/wasm/network；
- 执行预算允许；
- 版本和 migration 链合法。

不要因为文件来自自己的 CDN 就默认可信；供应链、租户隔离和发布权限仍需验证。

## OPFS 和下载

- 文件名来自用户输入时清理路径；
- 定期扫描和清理取消/失败半成品；
- 处理 quota 和 eviction；
- Blob URL 用完立即 revoke；
- 不在公共设备长期保存敏感原片；
- 提供项目和缓存删除入口。

## 供应链

- 锁定依赖和 pnpm lockfile；
- CI 使用 frozen install；
- 只从 package exports 导入；
- 审查 Worker、WASM 和 codec 依赖；
- 发布后验证 provenance、tag 和包内容；
- 定期运行安全 corpus 和 fuzz 测试。

## 上线门禁

- [ ] 目标浏览器 capability 和关键 profile preflight 通过；
- [ ] 生产域名的 Worker/AudioWorklet 加载成功；
- [ ] COOP/COEP 与所有第三方资源兼容；
- [ ] CSP 无多余远程执行权限；
- [ ] 媒体 CDN Range + CORS + token 刷新通过；
- [ ] 非法 Project、损坏媒体和恶意 Material fail closed；
- [ ] 取消/失败导出无半成品泄漏；
- [ ] 日志不含 Project 内容、token 和签名 URL；
- [ ] Project 自动保存和恢复演练通过；
- [ ] 依赖、SDK 和服务端引擎版本可追踪。
