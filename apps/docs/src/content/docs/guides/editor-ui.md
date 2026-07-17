---
title: 把 SDK 接进剪辑器 UI
description: 组织工程状态、视图状态、Session 生命周期、产品命令和异步任务。
---

AelionSDK 不绑定 React、Vue 或任何状态管理库。接入时最重要的不是选框架，而是分清哪些数据属于工程，哪些只是当前界面状态。

## 先把状态分成四类

| 状态       | 例子                                     | 放在哪里        |
| ---------- | ---------------------------------------- | --------------- |
| 工程数据   | 轨道、片段、效果、Marker、输出规格       | `Project` JSON  |
| 引擎状态   | revision、播放状态、diagnostic、导出 Job | `Session`       |
| 媒体运行时 | File、签名 URL、索引、decoder、proxy     | `MediaProvider` |
| 界面状态   | zoom、scroll、hover、面板开关、拖拽草稿  | 你的 UI store   |

播放头通常是界面状态；项目重新打开后不一定要回到上次位置。审核意见需要跨设备保存时，用 Marker。片段是否“当前选中”一般不用写进 Project，除非产品明确需要协作选区。

## 推荐的数据流

```text
鼠标 / 键盘 / 菜单
  ↓
产品命令：检查选择、权限、吸附和锁定状态
  ↓
SDK Transaction Command
  ↓
project-changed(commit)
  ↓
更新 Timeline / Inspector / 自动保存 / 预览
```

Project snapshot 是工程的最终结果。UI 可以在拖动时做临时视觉反馈，但命令失败后必须回到最新 snapshot，不能让界面里的一份可变副本继续领先于 SDK。

## 封装一个编辑器运行时

不论使用哪种框架，都可以把 SDK 生命周期封装成普通对象：

```ts
import {
  Aelion,
  ProductionMediaProvider,
  attachPreviewCanvas,
  type AelionSessionApi,
  type PreviewCanvasController,
} from '@aelion/sdk';

interface EditorRuntime {
  media: ProductionMediaProvider;
  session: AelionSessionApi;
  preview: PreviewCanvasController;
  dispose(): Promise<void>;
}

async function createEditorRuntime(
  project: unknown,
  canvas: HTMLCanvasElement,
  bindAssets: (media: ProductionMediaProvider) => Promise<void>,
): Promise<EditorRuntime> {
  const media = new ProductionMediaProvider();
  await bindAssets(media);

  const session = await Aelion.createSession({ media });
  await session.loadProject(project);

  const preview = attachPreviewCanvas(session, canvas, {
    quality: 'adaptive',
    fit: 'contain',
    pauseWhenHidden: true,
  });

  await preview.render(0);

  return {
    media,
    session,
    preview,
    dispose: async () => {
      preview.dispose();
      await session.dispose();
      media.dispose();
    },
  };
}
```

React 中可以在 effect 里创建并在 cleanup 中调用 `dispose()`；Vue 可以放在 `onMounted/onBeforeUnmount`；路由切换也使用同一套顺序。

初始化过程中任一步失败时，也要释放已经创建的前置对象。实际产品可以在 `try/catch` 中记录当前阶段，或使用自己的 disposable helper。

## 订阅 Session，写入 UI store

```ts
const unsubscribers = [
  session.subscribe('project-loaded', event => {
    store.setProject(session.getSnapshot().project, event.revision);
  }),
  session.subscribe('project-changed', event => {
    store.setProject(event.commit.snapshot, event.commit.revision);
    store.setHistory(session.transaction.canUndo, session.transaction.canRedo);
  }),
  session.subscribe('diagnostic', event => {
    store.addDiagnostic(event.diagnostic);
  }),
  session.subscribe('stats-changed', event => {
    performancePanel.update(event.stats);
  }),
];

function unsubscribeAll(): void {
  for (const unsubscribe of unsubscribers) unsubscribe();
}
```

不要把每一帧 stats 都放进会触发整棵组件树重渲染的全局 store。预览时间码和性能数据可以用局部订阅、节流或专门的 external store。

## 时间线坐标换算

时间线视口至少维护：

```ts
interface TimelineViewport {
  pixelsPerSecond: number;
  scrollLeftPx: number;
}

function clientXToTimeUs(clientX: number, laneLeft: number, viewport: TimelineViewport): number {
  const contentX = clientX - laneLeft + viewport.scrollLeftPx;
  const seconds = contentX / viewport.pixelsPerSecond;
  return Math.max(0, Math.round(seconds * 1_000_000));
}
```

得到微秒后再做吸附和帧量化。29.97/59.94 fps 不要用小数帧率硬算，使用 `frames()` 或 core 时间 helper。

Zoom、scroll 和 lane 高度不写入 Project。它们只影响“怎么展示时间线”，不影响最终成片。

## 建立产品命令层

菜单、快捷键、右键菜单和触控按钮应调用同一组产品命令：

```ts
async function splitSelectionAtPlayhead(): Promise<void> {
  const { selectedItemId, playheadUs } = store.getState();
  if (selectedItemId === undefined) return;

  const project = session.getSnapshot().project;
  const item = project?.items[selectedItemId];
  if (item === undefined) return;

  if (
    playheadUs <= item.range.startUs ||
    playheadUs >= item.range.startUs + item.range.durationUs
  ) {
    toast('请把播放头放到片段内部');
    return;
  }

  session.transaction.commands.splitItem({
    itemId: item.id,
    rightItemId: nextEntityId('item'),
    atUs: playheadUs,
    label: '切分片段',
  });
}
```

产品命令层统一处理：是否有选择、轨道是否锁定、用户权限、联动开关、错误文案和埋点。UI 组件不需要各自重复这些判断。

## Inspector 中的连续参数调整

滑块拖动不应产生几十条撤销记录：

```ts
const interaction = session.transaction.beginInteractive({
  label: '调整透明度',
  baseRevision: session.revision!,
});

function updateOpacity(value: number): void {
  interaction.update(tx => {
    tx.setField('items', itemId, ['visual', 'opacity'], value);
  });
}

function finishOpacity(): void {
  interaction.commit();
}

function cancelOpacity(): void {
  interaction.cancel();
}
```

字段路径必须匹配当前 Item 结构。普通产品 Inspector 更适合封装明确操作；Material 参数面板则可以根据 parameter schema 生成控件、范围和缺省值。

## 主预览、缩略图和后台任务

资源优先级建议：

1. 播放和用户正在拖动的主预览；
2. 当前可见区域的缩略图和波形；
3. 预取、后台分析和不可见区域缩略图；
4. 本地导出或远程任务根据产品策略单独排队。

主预览只创建一个 `PreviewCanvasController`。缩略图使用低 renderScale 的直接帧请求，并限制并发。滚出视口后取消，不要让后台列表把 decoder 和 GPU 占满。

## 异步任务状态

媒体探测、波形、缩略图、保存、导出和上传至少区分：

```ts
type TaskState =
  | { status: 'queued' }
  | { status: 'running'; progress?: number }
  | { status: 'completed' }
  | { status: 'failed'; code?: string; message: string }
  | { status: 'cancelled' };
```

任务被新请求取代、组件卸载或用户取消时传递 AbortSignal。导出 UI 还要显示“导出的是启动时的 revision”，因为用户可以继续编辑，但当前 Job 不会跟随变化。

## 打开和关闭工程

打开：

1. 读取 Project JSON；
2. 根据 Asset locator 重新授权并注册素材；
3. 创建 Session，执行 `loadProject()`；
4. 连接 Preview Controller；
5. 订阅变化、诊断和必要统计；
6. 渲染当前播放头。

关闭：

1. 停止 UI 新请求并取消任务；
2. 取消 Session 订阅；
3. dispose Preview Controller；
4. await Session dispose；
5. dispose Media Provider；
6. 清空只属于这个工程的 UI state。

参考实现见[Quickstart](/AelionSDK/start/getting-started/)和[参考编辑器](/AelionSDK/start/reference-editor/)。工程保存请继续阅读[保存、恢复与迁移](/AelionSDK/guides/persistence/)。
