---
title: 使用 Composition API 创作
description: 用 Composition、Layer 和 Clip 创建图片、文字、形状、字幕、效果、遮罩、关键帧和转场。
---

`createComposition()` 是面向产品代码的高层创作入口。它用
`Composition`、`Layer` 和 `Clip` 表达“画布、轨道和片段”，最终仍生成经过
Project v1 Schema 校验的普通 JSON。

如果你在生成模板、营销成片或以代码搭建时间线，优先从这里开始。需要批量导入
媒体、编辑已有 Project 或操作底层实体时，再使用 `ProjectBuilder` 或 Session
Transaction Commands。

## 创建一份 Composition

```ts
import { createComposition, seconds } from '@aelion/sdk';

const composition = createComposition({
  projectId: 'launch_card',
  sequenceId: 'main',
  title: 'Launch card',
  width: 1920,
  height: 1080,
  frameRate: { numerator: 30, denominator: 1 },
  durationUs: seconds(6),
});

composition
  .asset({
    id: 'hero_image',
    kind: 'image',
    name: 'Hero image',
    mimeType: 'image/png',
  })
  .asset({
    id: 'voice_over',
    kind: 'audio',
    name: 'Voice over',
    mimeType: 'audio/wav',
  });
```

Project 只保存稳定的 Asset ID 和描述，不保存 `File`、URL 凭据或已解码帧。加载到
Session 前，仍要把 `hero_image` 和 `voice_over` 注册到同一个 Media Provider。

## 添加图片、文字、形状和字幕

内容必须放到类型匹配的 Layer：图片、视频、文字和形状属于 `visual`，声音属于
`audio`，字幕属于 `caption`。

```ts
const visual = composition.layer('visual', {
  id: 'visual_main',
  name: 'Main visual',
});
const captions = composition.layer('caption', {
  id: 'captions',
  name: 'Captions',
});
const audio = composition.layer('audio', {
  id: 'voice',
  name: 'Voice over',
});

visual.image({
  id: 'hero',
  assetId: 'hero_image',
  durationUs: seconds(6),
  fit: 'cover',
});

const matte = visual.shape({
  id: 'title_matte',
  kind: 'rectangle',
  durationUs: seconds(6),
  box: { x: 260, y: 360, width: 1400, height: 360 },
  fill: '#ffffff',
  cornerRadiusPx: 48,
});

visual
  .text({
    id: 'title',
    text: 'Build video in the browser',
    durationUs: seconds(6),
    box: { x: 300, y: 400, width: 1320, height: 280 },
    style: { fontSize: 96, color: '#ffffff', fontWeight: 700 },
    overflow: 'auto-fit',
  })
  .mask(matte, { channel: 'alpha', featherPx: 6, consumeSource: true })
  .keyframes('opacity', [
    { timeUs: 0, value: 0 },
    { timeUs: seconds(1), value: 1, interpolation: 'linear' },
  ]);

captions.caption({
  id: 'caption_1',
  text: 'One portable Project, one render model.',
  atUs: seconds(1),
  durationUs: seconds(3),
});

audio.audio({
  id: 'voice_clip',
  assetId: 'voice_over',
  durationUs: seconds(6),
  fadeInUs: 100_000,
  fadeOutUs: 200_000,
});
```

`Clip` 的链式方法直接修改同一个待构建 Project。`keyframes()` 的时间是片段本地
时间；`visual()` 可以设置位置、缩放、旋转、透明度和混合模式。

## 复用 Material、效果和转场

一个 `Material` 是可复用定义，每次作为效果或转场使用时都会创建独立的 Project
Material Instance：

```ts
const dissolve = composition.material({
  packageId: 'dev.example.transitions',
  packageVersion: '0.1.0',
  packageIntegrity: `sha256:${'0'.repeat(64)}`,
  materialId: 'cross-dissolve',
  parameters: { curve: 'smooth' },
});

const from = visual
  .shape({
    id: 'scene_a',
    kind: 'rectangle',
    durationUs: seconds(4),
    box: { x: 0, y: 0, width: 1920, height: 1080 },
    fill: '#14213d',
  })
  .effect(dissolve, { parameters: { amount: 0.2 } });

const to = visual.shape({
  id: 'scene_b',
  kind: 'ellipse',
  atUs: seconds(3),
  durationUs: seconds(3),
  box: { x: 420, y: 0, width: 1080, height: 1080 },
  fill: '#fca311',
});

composition.transition(from, to, dissolve, {
  atUs: seconds(3),
  durationUs: seconds(1),
});
```

两个转场 Clip 必须属于同一个 Layer，并在转场区间提供画面。真实产品应使用已经由
`RuntimeMaterialRegistry` 安装的 package ID、版本和完整性，不要照抄示例 hash。

## 构建并加载

```ts
const project = composition.build();

const session = await Aelion.createSession({ media });
await session.loadProject(project);
```

`build()` 会验证引用、Layer/Clip 类型、时间范围、遮罩、动画、Material 和转场。
成功后返回不可变 Project；后续编辑通过 `session.transaction.commands` 完成。

## 什么时候使用 advanced()

`Composition` 故意只覆盖常用创作路径。需要 Marker、嵌套 Sequence、自定义
representation 或精细底层实体时，可以在 `build()` 前取得同一个 Builder：

```ts
composition.advanced().addMarker({
  timeUs: seconds(2),
  label: 'Review',
});
```

`advanced()` 不是绕过校验的后门。它和高层 API 修改同一个 Project，并由同一次
`build()` 校验。导入真实媒体请继续阅读[导入与管理媒体](/AelionSDK/guides/media-import/)，
加载后的交互编辑请阅读[时间线编辑](/AelionSDK/guides/timeline-editing/)。
