---
title: 当前状态
description: 发布身份、已验证范围、补救内容和仍未认证的边界。
---

仓库版本：`1.2.0-rc.4`。预发布版由 13 个 `@aelionsdk/*` 包组成，通过 npm `next` tag
分发；当前实际发布版本以 npm badge 和 registry 为准。

## rc.4 交互预览

本候选版保留 rc.2 契约补救和 rc.3 预览运行时修复，并额外包含：

- 文字/字幕背景板，ink box 与光栅目标会膨胀；
- 可选 `transient` 媒体请求，缩略图和 filmstrip 绕过持久播放 decoder；
- 交互提交在事务边界准入调用方写入值，不再对整份 Project 深拷贝；
- 播放跟随时钟、跳过可恢复的 queue-full，被取代或已释放的 seek 仍会拒绝。

## rc.3 预览运行时

本候选版保留 rc.2 的契约补救，并额外包含：

- 像素空间 Y-up 预览变换，文字使用独立 visual shader；
- 静图使用合成 SampleIndex，不再走容器 indexer；
- Vite 7 不得把 Worker/Worklet URL 改写成 `/@fs/@aelion…`；
- `historyGroup` 传入 command edit options；
- Aelion Studio 拆到独立嵌套仓库。

## rc.2 补救

rc.2 修复了 1.1/1.2 发布后审计发现的问题：

- Project v1.0 与 v1.2 使用不同且不可变的 Schema 身份，并提供安全的旧文档迁移；
- 图像序列接入 Render IR、预览和导出执行；
- 字幕导入原子化，时间偏移、持续时间和导出重叠检查正确；
- 修正 Bézier 端点手柄语义并支持有符号速率包络；
- 整缓冲代理有内存上限，同时提供流式/RangeReader 编码契约；
- 音频能量分析与 codec 能力描述符使用诚实命名；
- 设备矩阵版本随发布同步，并进入常规 CI。

逐项状态见 [1.1 审计](/AelionSDK/zh/project/roadmap/1-1/)和
[1.2 审计](/AelionSDK/zh/project/roadmap/1-2/)。

## 已验证的引擎范围

仓库门禁覆盖 Project 准入/校验、事务与重启 replay、媒体索引/seek/decode、Render IR 与
确定性 golden 合成、播放和音频、本地/可恢复导出、真实包安装与浏览器消费者、取消清理和
资源预算、安全输入、性能场景、文档与产物可复现性。

证据由脚本生成到 `reports/baseline`，不能手工编辑报告来改写结论。发布证据只对其绑定的
源清单有效。

## 已知边界

- Safari/iOS/Android 实体设备，以及更广 OS/GPU/driver 矩阵仍未认证。
- 本地颜色执行是 RGBA8 SDR；HDR/PQ/HLG/10-bit 不会静默降级。
- 没有可执行的内置 WASM codec 回退。
- ASS/SSA 字幕和基于像素的视频场景检测尚未实现。
- 代理流程仍需要宿主提供编码器。
- WebGPU 尚未具备完整 WebGL2 多 pass parity 和实体设备认证。
- 脱离页面的长任务和 24 小时实体设备 soak 证据尚未交付。
- 首个稳定版本前，RC API 仍可能按文档化迁移/弃用规则变化。

## 本地复核

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run ci
corepack pnpm test:browser
corepack pnpm test:browser:firefox
corepack pnpm test:browser:webkit
corepack pnpm test:browser:mobile
corepack pnpm test:golden
corepack pnpm test:security
corepack pnpm test:soak
corepack pnpm test:pack
corepack pnpm release:dry-run
corepack pnpm release:reproducibility
```
