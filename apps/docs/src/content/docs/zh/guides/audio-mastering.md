---
title: 音频分析、静音移除与母带
description: 生成波形和响度报告，把静音移除、ducking、响度归一化与限幅接进可撤销工程和导出。
---

Session 的音频 API 使用与预览、导出相同的 Render IR 和 Media Provider：

```ts
const [loudness, waveform] = await Promise.all([
  session.audio.analyze({ trackIds: ['dialogue'] }),
  session.audio.waveform({
    trackIds: ['dialogue'],
    maxPoints: 2_000,
  }),
]);
```

分析和波形都支持 `AbortSignal`、进度回调以及按 Track 或 Item 选择。长素材应取消已经离开视口的波形请求，并缓存结果到 Asset representation。

## 静音移除是工程事务

```ts
const result = await session.audio.removeSilence({
  itemId: 'interview_take',
  thresholdDb: -42,
  minimumSilenceUs: 500_000,
  paddingUs: 120_000,
});

console.log(result.removedUs, result.itemIds);
session.transaction.undo();
```

检测结果会转换成分割和移动命令，因此 Project、预览、导出、撤销和持久化看到的是同一项编辑，不存在只在 UI 中生效的隐藏处理。

## 把母带设置写入 Project

```ts
session.audio.configureMastering({
  targetLufs: -16,
  maximumGainDb: 12,
  limiter: { ceilingDbtp: -1 },
  ducking: [
    {
      programTrackIds: ['music'],
      sidechainTrackIds: ['dialogue'],
      thresholdDb: -30,
      reductionDb: -10,
      attackUs: 10_000,
      releaseUs: 250_000,
    },
  ],
});
```

设置以 revisioned Project extension 保存，所以自动保存、Remote Export manifest 和本地导出使用相同参数。也可以通过导出的 `audioProcessing` 临时覆盖。

当前导出要求 limiter 与 ducking 的 `lookaheadUs` 为 `0`。非零 lookahead 会改变处理延迟，在补齐尾部 flush 和时间补偿前会被明确拒绝，不会产生音画错位。

响度分析先扫描冻结的 Render IR，然后导出按从零开始的连续 PCM block 应用增益、sidechain ducking 与 true-peak limiter。开始导出后继续编辑不会改变正在运行的任务。

## 先协商，再导出

```ts
const selection = await session.export.negotiate({
  preferred: 'mp4-h264-aac',
  fallbacks: ['webm-vp9-opus'],
  remoteAvailable: true,
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
});
```

协商会使用当前 Sequence 的真实宽高、帧率、采样率、声道与目标码率探测浏览器能力。根据结果选择本地 Profile、回退 Profile 或 Remote Export，不要只按浏览器名称猜测。
