---
title: 时间与帧
description: 掌握微秒整数、帧率有理数、时间区间、量化和 TimeMap。
---

AelionSDK 的标准时间单位是微秒整数，字段通常以 `Us` 结尾。不要把秒小数直接写入 Project。

## 为什么使用微秒整数

浮点秒在连续编辑、序列化和跨运行时计算中容易积累误差。微秒整数可以稳定比较、排序、生成 change set，并与媒体容器时间戳互相换算。

```ts
import { frames, milliseconds, seconds } from '@aelion/sdk';

const intro = seconds(2.5); // 2_500_000
const fade = milliseconds(180); // 180_000
const frame100 = frames(100, { numerator: 30_000, denominator: 1_001 });
```

所有时间必须是非负 safe integer；duration 必须满足对应字段的正数或非负约束。

## 帧率使用有理数

`frameRate` 是 `{ numerator, denominator }`，例如：

| 名义帧率  | 值                                        |
| --------- | ----------------------------------------- |
| 24 fps    | `{ numerator: 24, denominator: 1 }`       |
| 29.97 fps | `{ numerator: 30000, denominator: 1001 }` |
| 59.94 fps | `{ numerator: 60000, denominator: 1001 }` |

使用 `frames()` 获取某一帧的精确量化开始时间，不要用 `Math.round(frame / fps * 1e6)` 在多个地方自行实现。

## 半开区间

时间范围按 `[startUs, startUs + durationUs)` 理解。相邻片段可以在同一时间边界首尾相接，不会共享一帧。这对裁剪、转场和受影响范围计算很重要。

## Timeline 时间与 Source 时间

- Timeline 时间：片段在 Sequence 中出现的位置；
- Source 时间：读取原素材的时间；
- TimeMap：两者之间的映射。

普通 1× 片段可以理解为：

```text
sourceTime = sourceStart + (timelineTime - timelineStart)
```

变速、反向和分段速度由 TimeMap 定义。音频当前使用确定性的 varispeed pitch 策略，改变速度也会改变音高。

## 编辑时的吸附

SDK 保证编辑命令的合法性，但不会替产品决定吸附体验。上层 UI 通常构建候选集合：

- Sequence 开始和结束；
- Item 入点、出点；
- Marker；
- 播放头；
- 帧边界。

先在 UI 中计算最终 `timeUs`，再把整数交给 Transaction 命令。缩放和像素换算只属于视图层，不应写入 Project。

## 边界检查

在发出命令前检查：

- 结果不为负数；
- duration 不为零；
- source 区间不超出素材，或明确设置 boundary；
- 固定 Sequence 时长的 overflow 策略；
- transition 区间同时落在 from/to Item 可用范围内。

渲染端会再次校验；UI 预检查用于提供更及时、可理解的反馈，不替代内核校验。
