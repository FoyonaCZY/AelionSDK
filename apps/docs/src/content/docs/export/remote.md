---
title: 远程导出
description: 实现 Provider 和 Authorizer，把冻结 Project manifest 安全提交到服务端。
---

Remote Export 是宿主适配协议。SDK 负责 canonical manifest、content ID、idempotency、Job 生命周期和事件校验；你负责鉴权、上传素材、启动服务端任务和返回结果。

## Authorizer

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

凭据只存在运行时，不进入 Project manifest、日志或 content ID。Token 应短期、限用途并由服务端验证项目权限。

## Provider

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

Event stream 只能产生单调 progress 或 completed。完成结果的 providerJobId、contentId 和 profileId 必须与请求一致，否则 SDK 拒绝结果。

## 启动任务

```ts
const job = session.export.startRemote({
  profile: 'mp4-h264-aac',
  provider,
  authorizer,
  onProgress: (progress, stage) => updateRemoteProgress(progress, stage),
});

const result = await job;
console.log(result.outputUrl, result.outputToken);
```

默认 manifest 来自冻结 Project。只有 Provider 需要额外资源绑定时才传 `manifest`；它仍必须是 JSON object。默认 idempotency key 从内容推导，除非对接已有服务协议，否则不要覆盖。

## 服务端责任

- 验证用户、项目、素材和 profile 权限；
- 对 manifest 重新执行 Schema 和语义校验；
- 用稳定 Asset binding 获取原片，不信任客户端 URL；
- 幂等处理重复 start；
- 支持取消和过期任务清理；
- 结果 URL 短期授权或通过 output token 换取；
- 记录 contentId、revision、profile、引擎版本和诊断。

Remote Export 不是把浏览器 Session 搬到服务端；服务端实现必须遵守相同 Project/Render IR/Material 协议，才能维持预览和成片语义一致。
