---
title: WebAV 与 Diffusion 同机基准
description: 在同一个 Chromium 页面中对 Aelion、WebAV 和 Diffusion Studio Core 执行可复现的预览与 seek 基准。
---

仓库提供 `bench:competitors`，在同一台机器、同一个浏览器上下文和同一段 H.264 fixture 上运行三套引擎：

```bash
pnpm bench:competitors -- \
  --competitor-node-modules /absolute/path/to/node_modules
```

外部目录需要安装精确版本的 `@webav/av-cliper` 和 `@diffusionstudio/core`。脚本不会把竞品加入 Aelion 的生产依赖；报告会记录竞品版本、浏览器、CPU 并发、内存、cross-origin isolation 和 WebGPU 状态。

基准场景包含：

- 1920×1080、30 fps 输出；
- 两路独立 H.264/B-frame 解码会话；
- 文字叠加；
- dissolve 转场；
- 30 个连续帧样本；
- 20 个确定性的 warm seek；
- p50、p95、最大值和原始样本。

默认门禁要求 Aelion 在参考场景下连续预览 p95 不高于 33 ms、warm seek p95 不高于 150 ms。结果写入 `reports/baseline/competitor-benchmark-chromium.json`。

## 如何理解结果

这是一项同机、公开 API 级别的工程回归，不是通用跑分榜。当前 fixture 是 320×180 H.264 源，三者都缩放到 1080p 输出；它不能替代 1080p 原生长 GOP、4K、VFR、复杂 Shader、长时间播放和真实业务素材 corpus。

Diffusion、WebAV 和 Aelion 的缓存、渲染时机及 GPU readback 策略并不相同，因此单个 frame 调用耗时不能证明完整编辑器绝对更快。提交回归时应比较同一环境下的趋势，并结合 golden frame、资源快照、十分钟 soak 和用户操作延迟。

更新基线时要记录原因、硬件和版本，不要为了让门禁通过而删除慢样本。新增上位替代能力时，应先补等价竞品场景和正确性断言，再讨论性能结果。
