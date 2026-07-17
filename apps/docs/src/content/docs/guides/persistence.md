---
title: 保存、恢复与素材重连
description: 保存 Project JSON，重新绑定 File 或 URL，处理自动保存、缺失素材和版本迁移。
---

能保存的只有 Project JSON。Session、Media Provider、File、Blob URL、decoder、撤销栈和导出任务都是本次页面运行时对象，不能写进工程文件。

## 保存当前 Project

```ts
interface SavedProjectRecord {
  projectId: string;
  schemaVersion: string;
  revision: string;
  json: string;
  savedAt: string;
}

async function saveCurrentProject(session: AelionSessionApi): Promise<void> {
  const snapshot = session.getSnapshot();
  if (snapshot.project === null || snapshot.revision === null) {
    throw new Error('当前没有可保存的工程');
  }

  const record: SavedProjectRecord = {
    projectId: snapshot.project.projectId,
    schemaVersion: snapshot.project.schemaVersion,
    revision: snapshot.revision.toString(),
    json: JSON.stringify(snapshot.project),
    savedAt: new Date().toISOString(),
  };

  await projectRepository.put(record);
}
```

保存 `snapshot.project`，不要保存 UI 正在拖动的一份临时副本。`revision` 是 Session 内的 bigint，不在 Project JSON 中；这里把它存下来只用于业务侧并发和 dirty 状态判断。

JSON 不带缩进可以节省存储；用户主动“导出工程文件”时可以用 `JSON.stringify(project, null, 2)` 提高可读性。

## 自动保存

每次成功编辑都会触发 `project-changed`。事件中的 commit 已经带了对应 snapshot：

```ts
const unsubscribe = session.subscribe('project-changed', event => {
  markDirty(event.commit.revision);
  scheduleSave(event.commit.snapshot, event.commit.revision);
});
```

一个实用策略是：

- 编辑后 500–1500 ms debounce；
- 保存进行中又有新 revision 时，完成后立即再保存一次；
- 网络失败保留 dirty 状态，并做有上限的重试；
- 页面关闭前提示尚未落盘的变更；
- 本地草稿和服务端版本使用明确的冲突策略。

不要在 Transaction listener 中同步阻塞网络保存。事件回调只安排任务，让编辑继续响应。

## Asset locator 应该存什么

Project 中的 Asset 可以保存稳定定位信息，例如：

```json
{
  "id": "asset_camera_a",
  "kind": "video",
  "locator": {
    "type": "business-asset",
    "assetKey": "media_01J7Y4Q0",
    "tenantId": "tenant_demo"
  },
  "mimeType": "video/mp4"
}
```

可以保存：稳定 asset key、内容 hash、用户可理解的文件名、相对业务路径。

不要保存：Bearer token、Authorization header、短期签名 URL、Blob URL、`File` 对象或 OPFS 作为唯一位置。

## 恢复工程的正确顺序

```ts
async function openSavedProject(record: SavedProjectRecord, canvas: HTMLCanvasElement) {
  const project: unknown = JSON.parse(record.json);
  const media = new ProductionMediaProvider();

  try {
    await bindProjectAssets(project, media);

    const session = await Aelion.createSession({ media });
    try {
      await session.loadProject(project);
      const preview = attachPreviewCanvas(session, canvas, {
        quality: 'adaptive',
      });
      await preview.render(0);
      return { media, session, preview };
    } catch (error) {
      await session.dispose();
      throw error;
    }
  } catch (error) {
    media.dispose();
    throw error;
  }
}
```

外部 JSON 始终保持 `unknown`，交给 `loadProject()` 做运行时校验。`as AelionProject` 只会骗过 TypeScript，不能阻止损坏或恶意 JSON 进入运行时。

`bindProjectAssets()` 是你的业务适配层。它通常需要：

1. 读取 Project 中每个 Asset 的稳定 locator；
2. 检查当前用户权限；
3. 获取新的签名 URL，或请求用户重新选择 File；
4. 校验 MIME、长度和可选 content hash；
5. 注册 original 和可用 proxy；
6. 收集缺失素材，供 UI 显示重连列表。

## 缺失素材重连

用户重新选择文件后，用原来的 Asset ID 注册：

```ts
function relinkFile(media: ProductionMediaProvider, assetId: string, file: File): void {
  media.unregister(assetId);
  media.registerFile(assetId, file, { role: 'original' });
}
```

重连 UI 应显示 Project 中记录的文件名、时长、画面尺寸和 hash，避免用户选错。提供 content hash 时可以严格验证；没有 hash 时至少检查基础 probe 信息，并明确提示风险。

如果 Session 已经因为缺失素材加载失败，可以完成全部重连后重新创建 Session。不要依赖半加载状态继续运行。

## Schema 版本和迁移

Project 顶层有 `$schema` 和 `schemaVersion`。读取旧版本时先按版本迁移，再交给当前 Session：

```ts
function migrateProject(input: unknown): unknown {
  const value = assertPlainJsonObjectWithinBudget(input);

  if (value.schemaVersion === '0.9.0') {
    return migrate090To100(value);
  }

  return value;
}
```

迁移函数应该：

- 只做确定的数据变换，不访问网络；
- 不修改原对象；
- 对同一输入总是产生同一输出；
- 保留无法识别的命名空间扩展；
- 有真实旧工程 fixture 测试；
- 迁移失败时保留原始文件，不能覆盖。

当前公共 Schema 是 v1 alpha。升级 SDK 前用真实 Project corpus 回归，而不是只测试一个空工程。

## 业务扩展放在哪里

非渲染业务数据可以放在顶层 `extensions` 的命名空间键下：

```json
{
  "extensions": {
    "com.example.review": {
      "reviewStatus": "needs-changes",
      "ownerTeam": "creative"
    }
  }
}
```

扩展值必须是纯 JSON。需要影响画面或声音的数据，应使用正式 Item、Marker 或 Material，而不是让某个前端组件私下解释扩展字段后改变成片。

## 关闭工程前的检查

- 最新 revision 已保存，或 UI 明确显示未保存；
- 进行中的保存和上传任务已取消或转交后台；
- Preview、Session、Provider 已按顺序释放；
- Blob URL 已 revoke；
- 临时 OPFS 文件有清理策略；
- 日志和保存记录中没有 token 或签名 URL。

Project 字段参考见 [Project Schema](/AelionSDK/reference/project-schema/)，输入预算和服务端复检见[安全与部署清单](/AelionSDK/production/security-deployment/)。
