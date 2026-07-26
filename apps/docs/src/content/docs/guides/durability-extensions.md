---
title: Revision 持久化与扩展隔离
description: 用有序快照恢复 Project，并通过受限 Worker RPC 执行扩展逻辑。
---

## Revision 驱动的持久化

`ProjectPersistenceController` 监听成功的 Project transaction，串行保存 immutable snapshot，并保证快速连续编辑最终一定写入最新 revision：

```ts
import {
  IndexedDbProjectRevisionStore,
  ProjectPersistenceController,
  restoreLatestProject,
} from '@aelion/sdk';

const store = new IndexedDbProjectRevisionStore({
  databaseName: 'my-editor-projects',
});

const restored = await restoreLatestProject(session, store, projectId);
if (restored === null) {
  await session.loadProject(initialProject);
}

const persistence = await ProjectPersistenceController.attach(session, store, {
  debounceMs: 500,
  onError: error => showSaveError(error),
});
```

Session revision 只在一次 Session 生命周期中递增；持久层 `generation` 跨刷新单调递增，防止迟到的保存覆盖更新记录。每条记录包含 canonical Project JSON 和内容 hash，恢复时先验 hash，再交给 `loadProject()` 做 Schema 校验。

关闭工程时等待尾部保存：

```ts
await persistence.dispose();
await session.dispose();
```

测试或服务端适配可以使用 `MemoryProjectRevisionStore`，业务数据库只需实现 `ProjectRevisionStore` 的原子“最大 generation 胜出”语义。

## Worker 扩展 RPC

```ts
const worker = new Worker(new URL('./extension.worker.js', import.meta.url), {
  type: 'module',
});
const extension = new AelionExtensionHost(worker, {
  maxPendingCalls: 4,
  maxPayloadBytes: 256 * 1024,
  invocationTimeoutMs: 2_000,
});

const manifest = await extension.ready;
const result = await extension.invoke('analyze-title', { title: 'Opening' });
```

扩展 Worker 只收到结构化克隆的 JSON，不会获得 Session、Media Provider、DOM 节点或应用凭据。Host 会校验协议、manifest、方法 allowlist、payload 大小、并发上限、取消与超时；协议错误和超时会终止 Worker 并拒绝 pending calls。

Worker 端使用 `exposeAelionExtension()`：

```ts
exposeAelionExtension(
  self,
  {
    id: 'com.example.metadata',
    version: '1.0.0',
    methods: ['analyze-title'],
  },
  {
    'analyze-title': payload => ({ length: String(payload.title).length }),
  },
);
```

这提供故障隔离和对象能力边界，不是针对恶意代码的完整安全沙箱。同源 Worker 仍可能发起网络请求并访问同源存储；不可信扩展需要独立 origin、严格 CSP/Permissions Policy、服务端权限边界和发布前审查。影响最终画面或声音的数据必须进入 Project transaction，扩展不能私自维护第二套成片状态。
