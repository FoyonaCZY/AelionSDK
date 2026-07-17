---
title: 导入与管理媒体
description: 从 File、Blob、URL、OPFS 或自定义 RangeReader 注册媒体并创建 Project 片段。
---

媒体导入分两步：先把字节源注册到 `ProductionMediaProvider`，再把对应 Asset 和 Item 写入 Project。两者使用相同 `assetId` 关联。

## 创建 Provider

```ts
import { ProductionMediaProvider } from '@aelion/sdk';

const media = new ProductionMediaProvider({
  maxCachedIndexes: 8,
  maxCachedIndexBytes: 64 * 1024 * 1024,
  maxConcurrentOperations: 4,
  maxPendingOperations: 64,
});
```

默认值适合作为起点。不要为了缩短单次等待而盲目提高并发；多个编辑器实例应共享页面级资源预算。

## 注册本地文件

```ts
media.registerFile('asset_camera_a', file, {
  role: 'original',
  contentHash: sha256,
});

const probe = await media.probe('asset_camera_a');
console.table(probe.index.tracks);
```

`contentHash` 必须是 64 位小写 SHA-256，用于内容寻址的 SampleIndex 缓存。计算 hash 是业务选择；大文件可以在 Worker 中流式计算。

## 注册 URL

```ts
media.registerUrl('asset_remote', signedUrl, {
  role: 'original',
  headers: { Authorization: `Bearer ${token}` },
});
```

远端必须允许 Range 读取，并正确配置 CORS。授权过期、服务器忽略 Range、内容长度不稳定都会影响 seek 和索引建立。

## 注册原片与 Proxy

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

Preview 会根据目标尺寸选择合适表示，Export 强制 original。使用 `representationFor()` 可以在 UI 中展示实际选择：

```ts
const selection = media.representationFor('asset_hero', {
  purpose: 'preview',
  maxDimension: 960,
});
```

## 注册 OPFS 文件

```ts
await media.registerOpfs('asset_cached', 'imports/camera-a.mp4', {
  role: 'original',
});
```

路径是 origin 根下的相对文件路径，不允许空段、`.` 或 `..`。OPFS 是浏览器本地缓存，不应是 Project 唯一可恢复的业务定位方式。

## 自动创建 Project 片段

```ts
import { createProject } from '@aelion/sdk';

const builder = createProject({ projectId: 'p1', sequenceId: 's1' });
const imported = await builder.importMedia({
  provider: media,
  assetId: 'asset_hero',
  name: 'Hero shot',
  atUs: 2_000_000,
  sourceStartUs: 500_000,
  video: true,
  audio: true,
  fit: 'cover',
});

console.log(imported.videoItemId, imported.audioItemId, imported.linkGroupId);
```

不传 `durationUs` 时使用探测到的素材时长扣除 source start。只需要一种媒体轨时设置 `video: false` 或 `audio: false`。

## 手动控制轨道和片段

```ts
const visualTrack = builder.addTrack({ kind: 'visual', name: 'B-roll' });
builder.addAsset({
  id: 'asset_still',
  kind: 'image',
  mimeType: 'image/png',
  locator: { kind: 'business-asset', key: 'hero-v3' },
});

builder.addMediaClip({
  id: 'item_still',
  kind: 'video',
  assetId: 'asset_still',
  trackId: visualTrack,
  atUs: 0,
  durationUs: 3_000_000,
  boundary: 'hold',
  fit: 'contain',
});
```

## 替换与释放

素材下线或切换工程时：

```ts
media.unregister('asset_old');
// 整个 Provider 不再使用时
media.dispose();
```

Provider 被释放后不能重新注册。Session 仍引用对应 Asset 时，后续预览或导出会产生缺失媒体诊断。

:::caution[不要把凭据写进 Project]
Project locator 可以保存稳定业务 key，但不要持久化短期签名 URL、Authorization header 或用户密钥。恢复工程时由业务层重新授权并注册 Provider。
:::
