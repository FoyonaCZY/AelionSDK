---
title: 时间、帧率和素材时间
description: 正确使用整数微秒、有理帧率、半开区间，以及时间线时间和原素材时间。
---

AelionSDK 的公开时间单位是整数微秒，带时间含义的字段通常以 `Us` 结尾。1 秒是 `1_000_000`，不是 `1`，也不是浮点秒。

## 不要在业务代码里到处乘 1e6

使用 SDK helper 会更清楚，也能统一检查范围：

```ts
import { frames, milliseconds, seconds } from '@aelion/sdk';

const introStartUs = seconds(2.5); // 2_500_000
const fadeDurationUs = milliseconds(180); // 180_000
const frame100Us = frames(100, { numerator: 30_000, denominator: 1_001 });
```

时间必须是 JavaScript safe integer。开始时间允许为 0；大多数 duration 必须大于 0。小数微秒、NaN、Infinity 和负数都会被拒绝。

## 为什么不用浮点秒

时间线会反复移动、裁剪、序列化和比较边界。浮点秒在这些操作中容易出现 `2.9999999997` 一类误差，最终影响吸附、相邻判断和导出帧数。

整数微秒适合媒体时间戳，也足以表达常见视频帧和音频采样边界。帧率仍然使用有理数，避免把 29.97 当作不精确小数。

## 常见帧率怎么写

| 显示名称  | Project 值                                |
| --------- | ----------------------------------------- |
| 24 fps    | `{ numerator: 24, denominator: 1 }`       |
| 25 fps    | `{ numerator: 25, denominator: 1 }`       |
| 29.97 fps | `{ numerator: 30000, denominator: 1001 }` |
| 30 fps    | `{ numerator: 30, denominator: 1 }`       |
| 59.94 fps | `{ numerator: 60000, denominator: 1001 }` |

把播放头吸附到帧时，使用 `frames(frameIndex, frameRate)`。不要在多个组件里分别写 `Math.round(frame / fps * 1e6)`，否则边界算法很容易不一致。

## 时间范围是左闭右开

`startUs + durationUs` 得到结束边界，但结束时间本身不属于这个片段：

```text
片段 A: [0, 1_000_000)
片段 B: [1_000_000, 2_000_000)
```

两段可以在 1 秒处无缝相接，不会同时拥有边界那一时刻。这条规则会用于片段命中、裁剪、转场和 affected range 计算。

判断播放头是否严格位于片段内部：

```ts
const startUs = item.range.startUs;
const endUs = startUs + item.range.durationUs;
const canSplit = playheadUs > startUs && playheadUs < endUs;
```

起点和终点都不能作为切分点，否则会产生 0 时长片段。

## 时间线时间和原素材时间不是一回事

假设一个片段放在时间线 10 秒处，但从原视频 3 秒处开始读取：

```text
timeline range: [10s, 15s)
source range:   [ 3s,  8s)
```

1× 正向播放时：

```text
sourceTime = sourceStart + (timelineTime - timelineStart)
```

- 移动片段：timeline start 变化，source range 不变；
- trim start：两者的开始通常一起变化；
- slip：timeline range 不变，source range 前后移动；
- 变速/反向：由 TimeMap 把两套时间关联起来。

音频和视频使用同一个映射，因此 edit、seek、preview 和 export 不应该分别发明一套换算。

## 当前变速行为

普通线性 TimeMap 可以设置速度和方向。音频目前采用 varispeed：速度变快时音高也升高，速度变慢时音高降低。当前版本没有把“保音高 time-stretch”作为已完成能力。

如果产品需要广播级变速音频，应把这项限制放进功能设计或使用独立音频处理服务，不能只在 UI 上写“保持音调”。

## UI 吸附由产品决定

SDK 会拒绝非法时间，但不会替你选择吸附规则。时间线通常收集：

- Sequence 开头和结尾；
- Item 入点和出点；
- Marker；
- 播放头；
- 当前帧边界。

把鼠标像素换成初始微秒，再在屏幕容差内选择最近候选，最后把确定的整数 `timeUs` 交给命令。吸附辅助线、容差和优先级留在 UI state，不要写进 Project。

## 发命令前做哪些检查

UI 预检查可以给用户更快的反馈：

- 结果时间不能小于 0；
- duration 不能为 0；
- 切分点必须在片段内部；
- source range 不能越过可用素材，除非 boundary 明确允许；
- 固定时长 Sequence 不能违反 overflow 设置；
- 转场需要左右片段都有足够 handle。

这些检查不能取代 SDK 校验。两个协作者可能同时修改工程，UI 看到合法的位置在提交时仍可能因 revision 或结构变化而失败。
