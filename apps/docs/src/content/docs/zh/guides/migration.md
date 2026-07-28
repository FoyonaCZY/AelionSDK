---
title: 从 WebAV 与 Diffusion Studio 迁移
description: 用严格迁移器把 WebAV Sprite 或 Diffusion checkpoint 转成 Aelion Project，并显式处理无法等价表达的功能。
---

`@aelionsdk/sdk` 提供两个数据适配器：

- `migrateWebAvProject()` 接受可序列化的 WebAV Sprite 投影；
- `migrateDiffusionCheckpoint()` 接受 Diffusion Studio Core 的 checkpoint 和显式素材绑定。

两者默认启用 `strict: true`。只要源工程里存在会改变画面或声音、但当前 Aelion 无法等价表达的字段，迁移就会抛出 `ProjectMigrationError`，而不是静默丢弃。

## WebAV

WebAV 的 `OffscreenSprite` 不公开底层 `IClip` 字节，因此迁移端必须显式提供 Asset：

```ts
import { migrateWebAvProject } from '@aelionsdk/sdk';

const result = migrateWebAvProject({
  width: 1920,
  height: 1080,
  assets: [
    {
      id: 'asset_intro',
      kind: 'video',
      locator: { type: 'runtime-binding', bindingId: 'intro_file' },
      width: 1920,
      height: 1080,
    },
  ],
  sprites: [
    {
      id: 'sprite_intro',
      kind: 'video',
      assetId: 'asset_intro',
      time: { offset: 0, duration: 5_000_000, playbackRate: 1.25 },
      includeAudio: true,
    },
  ],
});

await session.loadProject(result.project);
```

位置、尺寸、旋转、透明度、翻转、可见性、播放速率、源区间和显式动画都会被映射。素材类型冲突、无效 `includeAudio` 或不能还原的渲染状态会出现在 `diagnostics` 中。

## Diffusion Studio Core

Diffusion checkpoint 只存 Source ID，不存浏览器里的 `File`、URL 或凭据。迁移时用 `assets` 重新绑定：

```ts
import { migrateDiffusionCheckpoint } from '@aelionsdk/sdk';

const result = migrateDiffusionCheckpoint(checkpoint, {
  assets: [
    {
      sourceId: 'source-video-1',
      assetId: 'asset_video_1',
      kind: 'video',
      locator: { type: 'runtime-binding', bindingId: 'video_file_1' },
      width: 1920,
      height: 1080,
      hasAudio: true,
    },
  ],
});
```

适配器会保留 Layer/Clip data、marker payload 和 checkpoint 元数据；映射源区间、速度、淡入淡出、富文本 run、字重、字形、大小写、行距、对齐、首个描边、动画、效果和遮罩。Diffusion 的顶层 Layer 顺序会转换成 Aelion 的绘制顺序。

无法等价映射的多描边、描边端点、文字背景、阴影、发光、非 `source-over` Canvas 混合等能力会生成渲染损失诊断。

## 批量迁移 CLI

安装 `@aelionsdk/sdk` 后可以直接迁移文件：

```bash
pnpm exec aelion-migrate --from webav --input webav.json --out project.aelion.json
pnpm exec aelion-migrate --from diffusion --input checkpoint.json \
  --assets assets.json --out project.aelion.json --report migration-report.json
```

WebAV 的 `assets` 可以放在输入快照中，也可以用 `--assets` 提供数组或 `{ "assets": [...] }` 文件。Diffusion 的素材绑定通常需要单独的 `--assets` 文件。CLI 会输出并保存一个版本化报告，其中包含：

- `passed`、`lossy` 或 `failed` 状态；
- info/warning/error 计数和完整诊断；
- 源对象到 Aelion 实体的 `entityMap`；
- 输出 Project 的字节数和 SHA-256。

默认严格模式遇到 error diagnostic 时只写报告，不写 Project。`--strict=false` 会明确生成 `lossy` Project，`--dry-run` 则执行完整转换和 Schema/语义校验但不写 Project：

```bash
pnpm exec aelion-migrate --from diffusion --input checkpoint.json \
  --assets assets.json --dry-run
```

## 宽松模式只适合人工修复流程

```ts
const result = migrateDiffusionCheckpoint(checkpoint, {
  assets,
  strict: false,
});

for (const diagnostic of result.diagnostics) {
  showMigrationIssue(diagnostic);
}
```

`strict: false` 会返回尽可能完整的 Project，但不代表视觉等价。生产导入器应把诊断展示给用户，并要求确认或修复；自动批量迁移和回归测试应保持严格模式。

`entityMap` 可把源对象 ID 映射到新 Project 实体，适合恢复 UI 选择、评论和业务引用。迁移后仍应使用真实素材做 golden frame 与音频对比。
