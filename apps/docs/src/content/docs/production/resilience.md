---
title: 错误、恢复与可观测性
description: 处理结构化诊断、Session 事件、取消、重试、context loss 和长会话资源。
---

AelionSDK 的可恢复故障通过结构化 Diagnostic 表达。标准参数错误仍可能使用 `TypeError`、`RangeError`、`ReferenceError`，取消还可能是 `AbortError`。

## 订阅诊断

```ts
const unsubscribe = session.subscribe('diagnostic', ({ diagnostic }) => {
  telemetry.record({
    code: diagnostic.code,
    severity: diagnostic.severity,
    recoverable: diagnostic.recoverable,
    entityId: diagnostic.entityId,
    rangeUs: diagnostic.rangeUs,
  });
});
```

不要把 `cause`、token、URL query 或完整 Project 直接上传。日志应脱敏，并限制体积。

## 错误分类

```ts
import { AelionError } from '@aelion/core';

try {
  await action();
} catch (error) {
  if (error instanceof DOMException && error.name === 'AbortError') return;
  if (error instanceof AelionError) {
    handleDiagnostics(error.diagnostics);
    return;
  }
  if (error instanceof TypeError || error instanceof RangeError) {
    reportProgrammingOrInputError(error);
    return;
  }
  reportUnknown(error);
}
```

业务分支只依赖 `code`、`severity`、`recoverable` 和结构化 details，不解析英文 `message`。

## 重试原则

适合重试：临时网络失败、授权刷新后、释放资源后、quota 清理后、Remote Provider 的可重试服务错误。

不应原样重试：Schema 无效、revision conflict、codec config unsupported、Material integrity mismatch、永久权限拒绝。

重试必须有次数、退避和取消，并在新任务前重新检查输入和能力。

## Revision conflict

`REVISION_CONFLICT` 表示命令基于旧 snapshot。读取最新 Project，重新计算用户意图。不要只把 `baseRevision` 改成最新值继续提交旧坐标。

## GPU / Player 恢复

WebGL context lost、WebGPU device lost 或 Player runtime failure 后：

1. 暂停交互和播放；
2. 保留已保存的 Project snapshot；
3. 释放 Preview/Session；
4. 必要时降低 backend/quality；
5. 创建新 Session、重新 load Project 和 seek；
6. 记录恢复结果。

内核会执行允许的 backend fallback，但产品仍要展示质量变化和最终失败。

## 事件与统计

```ts
const unsubs = [
  session.subscribe('project-loaded', onLoaded),
  session.subscribe('project-changed', onChanged),
  session.subscribe('state-changed', onState),
  session.subscribe('capability-changed', onCapability),
  session.subscribe('stats-changed', onStats),
];
```

高频 stats 先在本地聚合再上报。推荐维度：SDK version、浏览器大版本、OS、capability tier、backend、Project 规格、profile 和 diagnostic code；避免资产名和用户内容。

## 退出与崩溃恢复

- project-changed debounce 自动保存；
- 导出中保存 job/provider ID；
- 页面卸载前不能依赖长异步清理；
- 再次进入时扫描 OPFS 半成品；
- Remote Export 按 idempotency key 恢复或查询；
- Session dispose 在应用正常路由切换中完成。

事件字段见[事件与统计](/AelionSDK/reference/events-stats/)，code 表见 [Diagnostic Codes](/AelionSDK/reference/diagnostic-codes/)。
