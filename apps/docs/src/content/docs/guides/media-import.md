---
title: 导入与管理媒体
description: 把 File、URL、OPFS 文件和代理素材绑定到 Project，并处理重新授权与释放。
---

Project 里的 Asset 只是素材记录，真正的视频字节由 `ProductionMediaProvider` 提供。接入媒体时始终分两步：先向 Provider 注册读取来源，再把同一个 `assetId` 写入 Project。

## 根据素材来源选择注册方法

| 素材在什么地方           | 使用方法           | 典型场景                                  |
| ------------------------ | ------------------ | ----------------------------------------- |
| 用户刚选择的文件         | `registerFile()`   | 本地剪辑、上传前预览                      |
| 已经拿到的 Blob          | `registerBlob()`   | IndexedDB、下载结果、内存生成内容         |
| 支持 Range 的 HTTPS 地址 | `registerUrl()`    | 云端素材库、签名 CDN URL                  |
| 已缓存到浏览器 OPFS      | `registerOpfs()`   | 本地草稿、离线素材、长文件缓存            |
| 自有文件系统或鉴权协议   | `registerReader()` | Electron 宿主、分片存储、自定义刷新 token |

长视频优先使用 `ProductionMediaProvider`。`ByteMediaProvider` 会把媒体放在内存里，只适合体积明确受限的测试和短素材。

## 一个编辑器创建一个 Provider

```ts
import { ProductionMediaProvider } from '@aelion/sdk';

const media = new ProductionMediaProvider({
  maxCachedIndexes: 8,
  maxCachedIndexBytes: 64 * 1024 * 1024,
  maxConcurrentOperations: 4,
  maxPendingOperations: 64,
});
```

这些默认值可以直接用于第一版产品。`maxConcurrentOperations` 不是越高越好；它会同时增加 decoder、网络和内存压力。如果同一页面打开多个编辑器，应给它们共享页面级资源预算，而不是每个实例都按满额创建。

## 导入用户选择的 File

下面的函数完成注册、探测和 Project 创建。返回值中的 ID 可以直接交给时间线 UI。

```ts
import { createProject, type ImportedMedia } from '@aelion/sdk';

async function createProjectFromFile(
  media: ProductionMediaProvider,
  file: File,
): Promise<{ project: unknown; imported: ImportedMedia }> {
  const assetId = crypto.randomUUID().replaceAll('-', '_');
  const safeAssetId = `asset_${assetId}`;

  media.registerFile(safeAssetId, file, { role: 'original' });
  const probe = await media.probe(safeAssetId);
  const video = probe.index.tracks.find(track => track.kind === 'video');

  const builder = createProject({
    projectId: `project_${assetId}`,
    sequenceId: `sequence_${assetId}`,
    title: file.name,
    width: video?.codedWidth ?? 1920,
    height: video?.codedHeight ?? 1080,
    frameRate: { numerator: 30, denominator: 1 },
  });

  const imported = await builder.importMedia({
    provider: media,
    assetId: safeAssetId,
    name: file.name,
    ...(file.type.length === 0 ? {} : { mimeType: file.type }),
  });

  return { project: builder.build(), imported };
}
```

`assetId` 必须以字母开头，并且只能包含字母、数字、点、下划线、冒号和连字符。不要直接把任意文件名当 ID；文件名中可能有空格、斜杠或重复值。

探测成功后可以读取：

```ts
const probe = await media.probe(assetId);

console.log(probe.index.container); // mp4 或 webm
console.log(probe.index.durationUs); // 整数微秒
console.table(probe.index.tracks); // 视频/音频轨和 codec 信息
```

如果只是把一个普通音视频文件放到时间线，优先用 `builder.importMedia()`。它会自动创建轨道和音视频联动组，不需要手写 Asset/Item 的完整 JSON。

## 控制导入区间和位置

下面把原素材从 0.5 秒开始的 3 秒内容，放到时间线 2 秒处：

```ts
const imported = await builder.importMedia({
  provider: media,
  assetId: 'asset_hero',
  name: '开场镜头',
  atUs: 2_000_000,
  sourceStartUs: 500_000,
  durationUs: 3_000_000,
  video: true,
  audio: true,
  fit: 'cover',
});
```

| 参数              | 含义                                   |
| ----------------- | -------------------------------------- |
| `atUs`            | 片段在时间线上的开始时间               |
| `sourceStartUs`   | 从原素材的哪个时间点开始读             |
| `durationUs`      | 放进工程的时长；省略时使用剩余素材时长 |
| `video` / `audio` | 是否导入对应媒体轨；默认都为 `true`    |
| `fit`             | 画面如何放入 Sequence 画布             |

`ImportedMedia` 会返回 `videoItemId`、`audioItemId` 和 `linkGroupId`。把这些值保存在当前导入操作的结果中即可，它们本身已经写进 Project，不需要额外持久化一份映射表。

## 从 CDN 读取素材

```ts
media.registerUrl('asset_remote', signedUrl, {
  role: 'original',
  headers: { Authorization: `Bearer ${token}` },
});
```

服务器必须正确处理字节范围请求。用浏览器 Network 面板检查请求和响应：

```http
Range: bytes=0-1048575

HTTP/1.1 206 Partial Content
Accept-Ranges: bytes
Content-Range: bytes 0-1048575/73400320
Access-Control-Allow-Origin: https://editor.example.com
```

如果服务器忽略 Range 并总是返回完整文件，短素材可能看似可用，但 seek、长文件内存和打开速度都会出问题。Service Worker 也不能把 206 响应改写成不透明的 200 响应。

不要把短期签名 URL 和 Authorization header写进 Project。Project 只保存稳定业务 key；恢复工程时由应用重新申请 URL，再调用 `registerUrl()`。

## 给 4K 原片配一个预览代理

同一个 Asset 可以注册 original 和 proxy：

```ts
media.registerUrl('asset_hero', originalUrl, {
  id: 'asset_hero:original',
  role: 'original',
  contentHash: originalHash,
  width: 3840,
  height: 2160,
});

media.registerUrl('asset_hero', proxyUrl, {
  id: 'asset_hero:proxy-540p',
  role: 'proxy',
  width: 960,
  height: 540,
  sourceStartUs: 0,
});
```

预览会根据目标尺寸选择 proxy，导出始终请求 original。可以在调试面板显示实际选择：

```ts
const selected = media.representationFor('asset_hero', {
  purpose: 'preview',
  maxDimension: 960,
});

console.log(selected.representationId, selected.usedProxy, selected.diagnostics);
```

Proxy 必须与原片时间对齐。SDK 会校验时长；差异过大时会记录诊断并退回 original。转码服务还应保留旋转、像素宽高比和音频起始时间。

## 使用 OPFS

```ts
await media.registerOpfs('asset_cached', 'imports/camera-a.mp4', {
  role: 'original',
});
```

路径相对于当前 origin 的 OPFS 根目录，不能包含空段、`.` 或 `..`。OPFS 可能被浏览器清理，因此不能把路径当作工程唯一恢复依据。业务数据库仍应保留云端 asset key 或重新选择文件的办法。

## 什么时候手动创建轨道和片段

需要提前建立多条轨道、导入图片，或自己决定 Asset locator 时，可以直接使用 Builder：

```ts
const visualTrackId = builder.addTrack({
  id: 'track_broll',
  kind: 'visual',
  name: '补充画面',
});

builder.addAsset({
  id: 'asset_still',
  kind: 'image',
  mimeType: 'image/png',
  locator: { type: 'business-asset', key: 'hero-v3' },
});

builder.addMediaClip({
  id: 'item_still',
  kind: 'video',
  assetId: 'asset_still',
  trackId: visualTrackId,
  atUs: 0,
  durationUs: 3_000_000,
  boundary: 'hold',
  fit: 'contain',
});
```

图片在时间线上仍然是 visual/video 类型 Item；`boundary: 'hold'` 表示在片段时长内保持同一画面。

## 切换工程和释放

单个素材不再使用时：

```ts
media.unregister('asset_old');
```

整个编辑器关闭时：

```ts
preview.dispose();
await session.dispose();
media.dispose();
```

Provider dispose 后不能重新注册素材。先销毁仍在请求画面的 Preview 和 Session，再释放 Provider，避免运行中的解码请求突然失去来源。

## 常见失败怎么判断

| 现象                     | 先检查什么                                      |
| ------------------------ | ----------------------------------------------- |
| `probe()` 立即失败       | assetId 是否注册、容器是否支持、文件是否损坏    |
| URL 能下载但不能 seek    | 是否返回 206、Content-Range、CORS 和 Range 鉴权 |
| 预览能看，导出找不到素材 | original 是否注册；不能只注册 proxy             |
| 代理画面时间不对         | proxy 时长、`sourceStartUs` 和转码时间戳        |
| 多次打开工程越来越慢     | 旧 Preview/Session/Provider 是否按顺序释放      |

保存和重新绑定素材的完整流程见[保存、恢复与迁移](/AelionSDK/guides/persistence/)。
