---
title: 保存、恢复与迁移
description: 持久化 Project JSON、重新绑定媒体、处理版本和自动保存。
---

Project 是持久化边界；Session、Provider、File、Blob URL、decoder 和导出 Job 都是运行时对象，不能序列化为工程文件。

## 保存 Project

```ts
const snapshot = session.getSnapshot();
if (!snapshot.project) throw new Error('No project loaded');

const json = JSON.stringify(snapshot.project);
await saveProject({
  projectId: snapshot.project.projectId,
  revision: snapshot.revision!.toString(),
  schemaVersion: snapshot.project.schemaVersion,
  json,
});
```

保存 snapshot，而不是 UI 的草稿对象。`bigint` revision 是运行时并发标识，是否写入业务数据库取决于你的同步协议；它不属于 Project JSON。

## 自动保存

订阅 `project-changed`，对提交进行 debounce，并保存提交对应的 snapshot：

```ts
const unsubscribe = session.subscribe('project-changed', event => {
  scheduleSave(event.commit.revision, event.commit.snapshot);
});
```

保存成功前显示 dirty 状态。网络失败不要阻塞本地继续编辑，但需要明确重试、离线队列和关闭页面保护。

## 恢复工程

```ts
const project = JSON.parse(record.json) as unknown;
const media = new ProductionMediaProvider();

// 根据 project.assets 中的稳定业务 locator 重新获取授权并注册。
await bindProjectAssets(project, media);

const session = await Aelion.createSession({ media });
await session.loadProject(project);
```

先把外部输入当作 `unknown`，由 `loadProject()` 执行 admission、Schema、引用和语义校验。不要通过 TypeScript 类型断言跳过运行时校验。

## 媒体重新绑定

Asset locator 应保存稳定的业务 ID、内容 hash 或相对路径含义。恢复时：

1. 校验用户仍有访问权限；
2. 获取新的签名 URL 或 File handle；
3. 校验 hash/长度/MIME；
4. 注册 original 和可选 proxy；
5. 对缺失素材提供重新链接 UI。

不要保存 Blob URL、Bearer token 或短期签名 URL。

## Schema 版本

Project 包含 `$schema` 和 `schemaVersion`。读取时按版本路由 migration：

```ts
function migrateProject(value: unknown): unknown {
  // 先做输入预算与基本对象检查
  // 再按 schemaVersion 顺序执行纯函数迁移
  return value;
}
```

迁移应是确定性的纯函数，保留原文件备份，并有 fixture 测试。不要在加载时默默删除未知扩展数据。

当前是 v1 alpha；升级包版本前同时测试旧 Project corpus、当前 Schema 和导出 golden。

## 业务扩展

使用 `extensions` 下的命名空间 key，例如 `com.example.review`。扩展值必须是 JSON，不应改变内核渲染语义；需要参与渲染的内容应使用正式 Item、Marker 或 Material 协议。

字段定义见 [Project Schema](../reference/project-schema.md)，安全输入预算见[安全与部署清单](../production/security-deployment.md)。
