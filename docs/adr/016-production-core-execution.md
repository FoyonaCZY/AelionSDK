# ADR-016：生产核心使用冻结 IR、资源仲裁与 capability-selected 执行

- 状态：Accepted
- 日期：2026-07-15

## Context

专业编辑、曲线时间、文字、音频、多格式导出、长媒体和第三方 Material 会把同一 Project 扩展到多个线程、codec、GPU backend 与持久缓存。若每条路径自行解释时间、颜色或资源，Preview/Export 会分叉，浏览器还会因 decoder/context/heap 争用返回非确定结果。

## Decision

1. Transaction 成功前先准备 Render IR；失败不发布 Project、history 或部分 cache invalidation。
2. Preview、Player、本地 Export 和 Remote manifest 都绑定冻结 revision；TimeMap、Automation、音频与 Material 参数只在 Render IR 层解释一次。
3. 本地输出按 profile capability/preflight 选择。WebM encoder/mux/backpressure 默认进入 Worker；宿主只提供有界 frame/PCM RPC 与 sink。浏览器 codec probe 的假阳性用真实 canary 或稳定失败诊断处理。
4. Decoder、GPU bytes、cache bytes 和 frame/export queues 都有显式上限、优先级、取消、snapshot 与 release；长时任务不能靠累积帧或完整 Blob 换吞吐。
5. Material 包的签名身份与代码执行权限分离。声明式 Core Node 默认可审计；网络/Shader/WASM 需要宿主 policy 授权。
6. SDR/P3/Rec.2020/HDR contract 在 IR 中显式存在；执行 backend 不具备真实 bit depth/transfer/presentation 时 fail closed，不做隐式 tone-map。

## Consequences

- 同一编辑和时间语义可在 Preview/Export/Remote 重放，失败能以 revision 和 diagnostic 定位。
- Worker、GPU cache、OPFS 和 proxy 增加实现复杂度，但每项都有明确 owner、budget 和清理路径。
- 浏览器全局 GPU/context 配额不由单个 SDK 页面控制；认证测试文件串行，同页多实例由页面级 governor 和专门并发测试覆盖。
- MP4 Worker、HDR/10-bit 或 4K30 实时只在证据满足后提升默认；存在 API/contract 不等于已认证。
