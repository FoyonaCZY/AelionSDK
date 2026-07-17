---
title: 接入服务端导出
description: 实现 Authorizer 和 Provider，把冻结 Project 安全提交给自己的渲染服务。
---

AelionSDK 不包含托管渲染服务。Remote Export 是一组适配接口：SDK 负责固定 Project、生成内容 ID、管理幂等和 Job；你的代码负责鉴权、服务端任务、素材绑定和结果地址。

## 浏览器会把什么交给 Provider

启动时 SDK 会准备：

- canonical 的冻结 Project manifest；
- 选中的 profile ID；
- content ID 和 idempotency key；
- 当前任务的 AbortSignal；
- Authorizer 返回的短期授权。

Project 里的 Asset locator 应是稳定业务 key。服务端根据 key 和用户权限获取原片，不信任客户端传来的临时 URL。

## 实现短期授权

```ts
import type { RemoteExportAuthorizer } from '@aelion/export';

const authorizer: RemoteExportAuthorizer = {
  async authorize(signal) {
    const token = await getShortLivedExportToken(signal);
    return {
      scheme: 'Bearer',
      token: token.value,
      expiresAtMs: token.expiresAtMs,
    };
  },
};
```

Token 只在本次运行中使用，不会写入 Project、content ID 或默认日志。服务端应限制 token 的用户、项目、素材和用途，并让有效期覆盖任务启动阶段。

## 实现 Provider

```ts
import type { RemoteExportProvider } from '@aelion/export';

const provider: RemoteExportProvider = {
  id: 'my-render-service',

  async start(request, authorization, signal) {
    const response = await api.startRender(request, authorization, signal);

    return {
      providerJobId: response.jobId,
      events: api.watchRender(response.jobId, signal),
      cancel: reason => api.cancelRender(response.jobId, reason),
      cleanup: reason => api.cleanupRender(response.jobId, reason),
    };
  },
};
```

`api.watchRender()` 返回异步事件流。Progress 必须单调前进，completed 只能出现一次。完成结果里的 `providerJobId`、`contentId` 和 `profileId` 必须与请求对应；SDK 会拒绝串任务或被篡改的结果。

## 启动远程任务

```ts
const job = session.export.startRemote({
  profile: 'mp4-h264-aac',
  provider,
  authorizer,
  onProgress: (value, stage) => {
    remoteTaskStore.update({ progress: value, stage });
  },
});

try {
  const result = await job;
  console.log(result.outputUrl, result.outputToken);
} catch (error) {
  showRemoteExportError(error);
}
```

默认 manifest 来自当前冻结 Project。只有服务协议确实需要额外 JSON 绑定时才传 `manifest`。默认 idempotency key 按内容生成，重复点击或网络重试应落到同一个服务端任务；除非对接已有协议，不要自己随意覆盖。

## 服务端至少要做的检查

1. 验证用户、租户、Project、Asset 和 profile 权限；
2. 对 manifest 重新执行输入预算、Schema 和引用校验；
3. 根据稳定 Asset key 获取 original，不能信任客户端 URL；
4. 校验 Material 版本、完整性和服务端执行许可；
5. 按 idempotency key 返回已有任务，避免重复计费和重复文件；
6. 支持取消、过期和半成品清理；
7. 用短期 output URL 或一次性 token 交付结果；
8. 记录 contentId、Project revision、profile、SDK/服务端引擎版本和 diagnostic。

## 页面关闭后如何恢复任务

把 Provider Job ID、content ID 和业务任务 ID保存在服务端或本地任务记录。重新打开页面后，应用可以通过自己的 API 查询任务和结果；当前 Session Job 对象本身不能跨刷新序列化。

取消请求也要幂等：用户可能在浏览器、任务中心和自动超时路径中多次取消同一个任务。

## 保持本地预览与服务端成片一致

服务端不是把浏览器 UI 复刻一遍。它需要实现兼容的 Project、Render IR、Material 和字体/素材解析，并固定引擎版本。遇到未知版本或不支持的 Material 时应明确失败，不能静默忽略效果。

本地和远程的选择策略见[选择导出格式](/AelionSDK/export/overview/)，鉴权和日志要求见[安全与部署清单](/AelionSDK/production/security-deployment/)。
