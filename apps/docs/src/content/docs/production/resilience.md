---
title: 错误处理、恢复和日志
description: 区分 Diagnostic、参数错误和取消，处理 revision 冲突、GPU/Player 恢复与崩溃后的任务。
---

SDK 错误不是都用同一种形式：可诊断的引擎问题通常带 `Diagnostic`，非法 API 参数会抛 `TypeError`/`RangeError`/`ReferenceError`，主动取消通常是 `AbortError`。

## 统一错误入口

```ts
import { AelionError } from '@aelion/core';

function handleSdkError(error: unknown): void {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return; // 用户取消或请求被新请求取代，不弹红色错误
  }

  if (error instanceof AelionError) {
    for (const diagnostic of error.diagnostics) {
      showDiagnostic(diagnostic);
    }
    return;
  }

  if (
    error instanceof TypeError ||
    error instanceof RangeError ||
    error instanceof ReferenceError
  ) {
    reportProgrammingOrInputError(error);
    return;
  }

  reportUnknownError(error);
}
```

业务分支使用 `code`、`severity`、`recoverable` 和结构化 details，不解析 message。Message 可能为了调试改变，也不适合直接当最终中文文案。

## 订阅 Session Diagnostic

```ts
const unsubscribe = session.subscribe('diagnostic', ({ diagnostic }) => {
  diagnosticPanel.append(diagnostic);

  telemetry.record({
    code: diagnostic.code,
    severity: diagnostic.severity,
    recoverable: diagnostic.recoverable,
    entityId: diagnostic.entityId,
    rangeUs: diagnostic.rangeUs,
  });
});
```

遥测不要上传完整 Project、素材名、URL query、token 或原始 `cause`。Details 也要按字段 allowlist 过滤，并限制单条和单会话体积。

## 哪些错误可以重试

适合在条件变化后重试：

- 临时网络断开；
- 刷新授权后重新读取素材；
- 清理 quota 或释放资源后重建 Sink；
- Remote Provider 返回明确可重试的服务错误；
- GPU 丢失后重建 Session 并降低质量。

不应原样重试：

- Project Schema 或引用无效；
- `REVISION_CONFLICT`；
- codec 配置不支持；
- Material integrity 不匹配；
- 用户永久拒绝权限。

重试必须有次数上限、退避、AbortSignal，并在开始前重新获取输入和 preflight。对同一个 closed Sink 重试没有意义。

## Revision 冲突怎么恢复

命令基于旧 snapshot 时：

```ts
try {
  session.transaction.commands.moveItem(command);
} catch (error) {
  if (hasDiagnosticCode(error, 'REVISION_CONFLICT')) {
    const latest = session.getSnapshot();
    reconcileUserIntent(command, latest);
    return;
  }
  throw error;
}
```

`reconcileUserIntent` 应重新找到 Item、目标轨和吸附位置。不能只把 `baseRevision` 替换成最新值然后提交旧 `startUs`，那可能覆盖另一项刚完成的编辑。

## GPU 或 Player 运行时失败

WebGL context lost、WebGPU device lost 或音频运行时进入不可恢复状态时，产品可以：

1. 停止接收新的编辑手势和播放请求；
2. 保留最近成功保存的 Project snapshot 和播放头；
3. dispose Preview 和 Session；
4. 必要时改用 WebGL2、draft 质量或更低 DPR；
5. 创建新 Session，重新 load Project；
6. 连接 Preview，seek 到原播放头；
7. 记录恢复是否成功，并把质量变化告诉用户。

不要尝试继续使用已经 disposed 或 device-lost 的内部对象。

## 事件和统计如何组合

```ts
const unsubscribers = [
  session.subscribe('project-loaded', onLoaded),
  session.subscribe('project-changed', onChanged),
  session.subscribe('state-changed', onStateChanged),
  session.subscribe('capability-changed', onCapabilityChanged),
  session.subscribe('stats-changed', onStatsChanged),
  session.subscribe('diagnostic', onDiagnostic),
];
```

推荐遥测维度：SDK version、浏览器大版本、OS、capability tier、实际 backend、Project 规格、profile 和 diagnostic code。不要把高频 stats 原样逐帧上传，先聚合。

## 页面刷新和崩溃后恢复什么

- `project-changed` 后 debounce 保存 Project；
- 保存 remote provider job ID 和业务任务 ID；
- 页面卸载前不能依赖长时间异步 dispose，一般只做同步停止并依靠下一次启动清理；
- 启动时扫描 OPFS 中的半成品和过期任务；
- Remote Export 用 idempotency key 查询已有任务；
- 本地导出 Job 不能跨刷新恢复，连续 MP4/WebM 失败后从 profile 起点重启。

事件字段见[事件与统计](/AelionSDK/reference/events-stats/)，错误码见 [Diagnostic Codes](/AelionSDK/reference/diagnostic-codes/)。
