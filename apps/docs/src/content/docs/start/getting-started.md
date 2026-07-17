---
title: 快速开始：从本地视频到 MP4
description: 跟着可运行的 Quickstart 认识 Project、Media Provider、Session、预览、编辑和导出。
---

这篇教程会用一个本地视频完成六件事：读取素材、创建 Project、显示第一帧、播放和拖动、把片段右移一秒、导出 H.264 MP4。

教程对应的完整应用在仓库 [`apps/quickstart`](https://github.com/FoyonaCZY/AelionSDK/tree/main/apps/quickstart)。你可以先运行它，再对照下面的解释看 `src/main.ts`。

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev:quickstart
```

## 先认识接入顺序

```text
File / URL
  ↓ 注册
ProductionMediaProvider
  ↓ 探测并写入素材描述
Project JSON
  ↓ loadProject
Session
  ├─ preview / player
  ├─ transaction
  └─ export
```

Project 不包含视频文件。它只保存素材 ID、轨道、片段和输出规格。运行时由 Media Provider 把素材 ID 映射回实际文件。这也是为什么保存工程时只保存 Project JSON，重新打开时还要重新绑定素材。

## 1. 准备页面

最小页面需要一个文件输入、一个 Canvas 和几个按钮：

```html
<input id="media-file" type="file" accept="video/*,audio/*" />
<canvas id="preview"></canvas>

<button id="play" disabled>播放</button>
<input id="scrubber" type="range" min="0" max="1" value="0" disabled />
<button id="move" disabled>片段右移 1 秒</button>
<button id="undo" disabled>撤销</button>
<button id="export" disabled>导出 H.264 MP4</button>
```

Canvas 的 CSS 尺寸只决定页面布局。`attachPreviewCanvas()` 会根据 CSS 尺寸和设备像素比设置真正的像素大小。

```css
#preview {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
}
```

## 2. 注册用户选择的文件

先创建 Provider，再给文件分配一个稳定的 `assetId`：

```ts
import { ProductionMediaProvider } from '@aelion/sdk';

const media = new ProductionMediaProvider();
media.registerFile('asset_main', file);

const probe = await media.probe('asset_main');
console.table(probe.index.tracks);
```

`probe()` 会读取容器信息。`probe.index.tracks` 中可以看到视频和音频轨、codec、画面尺寸等数据。这里的 `asset_main` 不是文件名，而是 Project 和 Provider 之间的关联键；同一个工程里不能重复。

运行到这里后，控制台应至少出现一条 video 或 audio 轨。如果报“不支持的容器”或解码错误，先用 Quickstart 的固定环境测试一个常见的 H.264/AAC MP4 或 VP9/Opus WebM。

## 3. 用探测结果创建 Project

`createProject()` 会建立一个空 Sequence。画布尺寸取素材视频轨；纯音频文件则使用 1920×1080 的默认值。

```ts
import { createProject } from '@aelion/sdk';

const videoTrack = probe.index.tracks.find(track => track.kind === 'video');
const builder = createProject({
  projectId: 'quickstart_project',
  sequenceId: 'main_sequence',
  title: file.name,
  width: videoTrack?.codedWidth ?? 1920,
  height: videoTrack?.codedHeight ?? 1080,
  frameRate: { numerator: 30, denominator: 1 },
});

const imported = await builder.importMedia({
  provider: media,
  assetId: 'asset_main',
  name: file.name,
  ...(file.type.length === 0 ? {} : { mimeType: file.type }),
});

const project = builder.build();
```

`importMedia()` 会做这些事：

- 把素材描述写入 `project.assets`；
- 有视频时创建 visual 轨和 video item；
- 有音频时创建 audio 轨和 audio item；
- 同时存在音视频时创建 `av-sync` link group，后续可以联动移动和切分；
- 返回创建出来的轨道 ID、片段 ID 和联动组 ID。

`builder.build()` 会校验并冻结 Project。此后如果还要继续往工程中添加片段，应在 `build()` 前完成，或者加载到 Session 后通过编辑命令修改。

## 4. 创建 Session 并显示第一帧

```ts
import { Aelion, attachPreviewCanvas } from '@aelion/sdk';

const session = await Aelion.createSession({ media });
await session.loadProject(project);

const canvas = document.querySelector<HTMLCanvasElement>('#preview')!;
const preview = attachPreviewCanvas(session, canvas, {
  quality: 'adaptive',
  fit: 'contain',
  pauseWhenHidden: true,
  onError: error => console.error(error),
});

await preview.render(0);
```

几个参数的含义：

| 参数                    | 这里为什么这样填                                 |
| ----------------------- | ------------------------------------------------ |
| `quality: 'adaptive'`   | 渲染变慢时自动降低内部比例，交互停止后再逐步恢复 |
| `fit: 'contain'`        | 完整显示画面，宽高比不同时留黑边                 |
| `pauseWhenHidden: true` | 页面切到后台时暂停播放，避免继续消耗资源         |
| `onError`               | 把异步预览错误交给产品的错误提示或日志系统       |

`preview.render(0)` 的单位是微秒，0 表示时间线起点。调用成功后 Canvas 会出现第一帧。快速连续调用时，Controller 会取消旧请求，旧帧即使晚到也不会盖住新帧。

## 5. 接上播放和拖动

```ts
playButton.addEventListener('click', async () => {
  if (session.player.state === 'playing') {
    await session.player.pause();
  } else {
    await session.player.seek(currentTimeUs);
    await session.player.play();
  }
});

scrubber.addEventListener('input', () => {
  currentTimeUs = Number(scrubber.value);
  void preview.render(currentTimeUs);
});
```

第一次 `play()` 要直接发生在 click 或 keydown 之类的用户手势中，否则浏览器可能拒绝启动 AudioContext。

拖动播放头时用 `preview.render()` 就够了；它只请求画面，不重建播放音频。用户松手并准备继续播放时，再调用 `player.seek()` 对齐播放器时钟。

## 6. 修改时间线并撤销

带音频的视频应该联动移动，否则声音和画面会错开：

```ts
import { seconds } from '@aelion/sdk';

if (imported.linkGroupId !== undefined) {
  session.transaction.commands.moveLinkedGroup({
    groupId: imported.linkGroupId,
    deltaUs: seconds(1),
  });
} else {
  const itemId = imported.videoItemId ?? imported.audioItemId;
  if (itemId !== undefined) {
    session.transaction.commands.moveItem({
      itemId,
      startUs: seconds(1),
    });
  }
}

if (session.transaction.canUndo) session.transaction.undo();
if (session.transaction.canRedo) session.transaction.redo();
```

命令成功后，Session 会产生新的 revision，并触发 `project-changed`。时间线界面和自动保存都应该订阅这个事件，而不是在 UI 中另存一份可以直接修改的 Project。

## 7. 导出 H.264 MP4

H.264 和 AAC 是否可用由浏览器、操作系统、硬件和当前工程共同决定，所以启动任务前要做 preflight。

```ts
import { SeekableMemorySink } from '@aelion/export';

const sink = new SeekableMemorySink();
const options = {
  profile: 'mp4-h264-aac' as const,
  sink: sink.writable,
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
  onProgress: (value: number) => {
    progress.value = value;
  },
  cleanupSink: () => sink.cleanup(),
};

const report = await session.export.preflightProfile(options);
if (!report.ok) {
  sink.cleanup();
  throw new Error(report.issues.map(issue => issue.code).join(', '));
}

await session.export.startProfile(options);
const bytes = sink.finalize();
```

这里的视频码率是 8 Mbps，适合作为 1080p 测试起点；它是编码目标，不是文件最终平均码率。Memory Sink 会把完整文件留在内存中，只适合短片。长视频请改用 `OpfsSeekableSink`。

下载文件：

```ts
const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
const link = Object.assign(document.createElement('a'), {
  href: url,
  download: 'output.mp4',
});
link.click();
URL.revokeObjectURL(url);
```

如果 preflight 不通过，不要直接把 profile 悄悄换成 WebM。把 `issue.code` 映射成明确选项，例如“改用 WebM”“降低分辨率”或“提交到服务端导出”。

## 8. 离开页面时释放资源

```ts
preview.dispose();
await session.dispose();
media.dispose();
```

顺序很重要：先停止 Canvas 和播放帧订阅，再销毁 Session，最后释放 Provider 持有的索引、读取器和解码资源。

## 跑通后的检查结果

完成这篇教程后，你应该能确认：

- 选择素材后能显示第一帧；
- 播放和拖动都能更新画面；
- 片段右移后开头出现一秒空白，撤销后恢复；
- 支持 H.264/AAC 的浏览器能下载并播放 MP4；
- 切换素材或刷新页面后，不会继续占用旧的播放和解码资源。

下一步通常是把这条主线接进自己的 UI。继续阅读[剪辑 UI 集成](/AelionSDK/guides/editor-ui/)；如果素材来自 CDN，先看[导入与管理媒体](/AelionSDK/guides/media-import/)。
